const jwt = require('jsonwebtoken');
const presence = require('./presence');

// Room naming convention: every conversation gets its own Socket.io room,
// named `conversation:<id>`. All participants of a conversation join that
// room, and broadcasting a new message is just emitting to the room.
const roomName = (conversationId) => `conversation:${conversationId}`;

// Same authorization check used by the REST routes in conversations.js
// (see the `/:id/messages` and `/:id/read` handlers) — a user only acts on
// a conversation they are actually a participant in. We can't reuse that
// Express middleware directly here (it's request/response shaped), so we
// re-run the same query against the pool.
async function isParticipant(pool, conversationId, userId) {
  const [rows] = await pool.query(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
  return rows.length > 0;
}

// Max one relayed `typing: true` per socket per conversation in this window.
// `false` is never throttled.
const TYPING_THROTTLE_MS = 1000;
// How long a failed participant check is remembered before it is retried.
const TYPING_DENIED_TTL_MS = 5000;

module.exports = function setupSockets(io, pool) {
  // --- Handshake authentication ---
  // The client connects with `io(url, { auth: { token } })`. We verify that
  // JWT the same way the REST middleware (backend/src/middleware/auth.js)
  // does, and stash the resulting userId on the socket. Every event handler
  // below trusts socket.userId — and ONLY socket.userId — as the identity of
  // whoever is on the other end of this connection. A client can never claim
  // to be a different user by passing a different id in an event payload.
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Authentication failed'));
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return next(new Error('Authentication failed'));
      }
      socket.userId = decoded.userId;
      next();
    });
  });

  io.on('connection', async (socket) => {
    console.log(`Socket connected: userId=${socket.userId}, socketId=${socket.id}`);

    // --- Presence bookkeeping ---
    // Registered synchronously, BEFORE the first await below: if the socket
    // drops while we're still doing the room-join query, these listeners must
    // already exist or the user would be stuck "online" forever.
    //
    // `disconnecting` (not `disconnect`) because socket.rooms is still
    // populated there, so we know which conversations to tell. user_offline
    // and the last_seen_at write only happen when this was the user's LAST
    // open socket — closing one of two tabs leaves them online.
    const cameOnline = presence.add(socket.userId, socket.id);
    let wentOffline = false;

    socket.on('disconnecting', () => {
      wentOffline = presence.remove(socket.userId, socket.id);
      if (!wentOffline) return;

      // An empty room list would make socket.to(...) broadcast to everyone.
      const rooms = [...socket.rooms].filter((r) => r.startsWith('conversation:'));
      if (rooms.length === 0) return;

      socket.to(rooms).emit('user_offline', {
        userId: socket.userId,
        lastSeenAt: new Date().toISOString(),
      });
    });

    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: userId=${socket.userId}, socketId=${socket.id}`);
      if (!wentOffline) return;

      try {
        await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [socket.userId]);
      } catch (err) {
        console.error('Failed to update last_seen_at on disconnect:', err.message);
      }
    });

    // --- Rejoin every conversation this user already belongs to ---
    // This covers reconnects: a user who goes offline and comes back gets
    // dropped back into every room they were already part of, with no
    // manual step on their end. It does NOT cover conversations created
    // *after* this socket connected — see the `join_conversation` handler
    // below for that case.
    let conversationIds = [];
    try {
      const [rows] = await pool.query(
        'SELECT conversation_id FROM conversation_participants WHERE user_id = ?',
        [socket.userId]
      );

      conversationIds = rows.map((row) => row.conversation_id);
      conversationIds.forEach((id) => socket.join(roomName(id)));

      console.log(`Socket ${socket.id} (userId=${socket.userId}) joined ${rows.length} conversation room(s)`);
    } catch (err) {
      console.error('Failed to join existing conversation rooms:', err.message);
    }

    // --- Presence snapshot + online announcement + delivery catch-up ---
    if (!socket.disconnected && conversationIds.length > 0) {
      try {
        // Who among my co-participants is online right now? Events alone only
        // cover changes after this client connects, so tell it up front.
        const [peers] = await pool.query(
          'SELECT DISTINCT user_id FROM conversation_participants WHERE conversation_id IN (?) AND user_id <> ?',
          [conversationIds, socket.userId]
        );
        socket.emit('presence_snapshot', {
          onlineUserIds: presence.onlineAmong(peers.map((p) => p.user_id)),
        });

        if (cameOnline) {
          socket.to(conversationIds.map(roomName)).emit('user_online', { userId: socket.userId });
        }

        // Messages sent to me while I had no open socket never got a
        // `message_delivered` ack from my client. They count as delivered now
        // that I'm connected; tell their senders.
        const [pending] = await pool.query(
          'SELECT id, conversation_id FROM messages WHERE is_delivered = FALSE AND sender_id <> ? AND conversation_id IN (?)',
          [socket.userId, conversationIds]
        );
        if (pending.length > 0) {
          await pool.query('UPDATE messages SET is_delivered = TRUE WHERE id IN (?)', [pending.map((m) => m.id)]);

          const byConversation = new Map();
          pending.forEach((m) => {
            if (!byConversation.has(m.conversation_id)) byConversation.set(m.conversation_id, []);
            byConversation.get(m.conversation_id).push(m.id);
          });
          byConversation.forEach((messageIds, conversationId) => {
            io.to(roomName(conversationId)).emit('message_delivered', { conversationId, messageIds });
          });
        }
      } catch (err) {
        console.error('Presence/delivery catch-up failed:', err.message);
      }
    }

    // --- join_conversation ---
    // Needed because the auto-join above only runs once, at connection
    // time. If this user is already online and then creates a brand-new
    // conversation via POST /api/conversations, their existing socket has
    // no idea that room exists yet. The client is expected to emit this
    // event right after a successful conversation-create call, so the
    // creator's own socket joins immediately instead of waiting for a
    // reconnect.
    //
    // KNOWN MVP LIMITATION: this only fixes it for the participant whose
    // client emits the event (typically the creator). The *other*
    // participant added to that new conversation has no automatic way to
    // learn it exists in real time yet — there's no conversation-list REST
    // endpoint for their client to notice a new entry, and nothing here
    // pushes a "you were added to a conversation" event to their socket.
    // That's acceptable for this phase; it'll be resolved naturally once
    // Phase 5 (frontend) has a conversation list the user opens or that
    // refreshes, at which point that client would emit join_conversation
    // itself.
    socket.on('join_conversation', async ({ conversationId } = {}) => {
      try {
        const authorized = await isParticipant(pool, conversationId, socket.userId);

        if (!authorized) {
          socket.emit('error', { message: 'Not a participant in this conversation' });
          return;
        }

        socket.join(roomName(conversationId));
      } catch (err) {
        console.error('join_conversation error:', err.message);
        socket.emit('error', { message: 'Something went wrong, please try again' });
      }
    });

    // --- send_message ---
    // Same two-principle pattern carried over from the REST layer:
    //   1. socket.userId (set at handshake) is the only source of truth for
    //      who the sender is — the payload's job is just to say what room
    //      and what text, never who.
    //   2. Being authenticated doesn't imply membership in this specific
    //      conversation — that's checked independently, every time.
    //
    // Reply support: an optional `replied_to_message_id` links this message
    // to an earlier one in the same conversation (originals only — no
    // reply-to-reply chains). An optional acknowledgement callback lets the
    // sender know whether the write succeeded; clients that don't pass one
    // behave exactly as before.
    //
    // `clientId` is an opaque id the sender's UI made up for its optimistic
    // bubble. It is never stored; it is echoed back on `new_message` as
    // `client_id` so the sender can swap the local bubble for the real row.
    socket.on('send_message', async ({ conversationId, body, clientId, replied_to_message_id } = {}, ack) => {
      const reply = (payload) => {
        if (typeof ack === 'function') ack(payload);
      };
      const fail = (message) => {
        socket.emit('error', { message });
        reply({ ok: false, error: message });
      };

      try {
        const authorized = await isParticipant(pool, conversationId, socket.userId);

        if (!authorized) {
          fail('Not a participant in this conversation');
          return;
        }

        const repliedTo = replied_to_message_id ?? null;
        if (repliedTo !== null) {
          const [targetRows] = await pool.query(
            'SELECT replied_to_message_id FROM messages WHERE id = ? AND conversation_id = ?',
            [repliedTo, conversationId]
          );
          if (targetRows.length === 0) {
            fail('The message you are replying to no longer exists');
            return;
          }
          if (targetRows[0].replied_to_message_id !== null) {
            fail('You cannot reply to a reply');
            return;
          }
        }

        // Write to MySQL first...
        const [result] = await pool.query(
          'INSERT INTO messages (conversation_id, sender_id, body, replied_to_message_id) VALUES (?, ?, ?, ?)',
          [conversationId, socket.userId, body, repliedTo]
        );

        const [rows] = await pool.query(
          `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.created_at, m.replied_to_message_id, m.is_delivered,
                  r.body AS replied_body, r.sender_id AS replied_sender_id, ru.username AS replied_sender_username
           FROM messages m
           LEFT JOIN messages r ON r.id = m.replied_to_message_id
           LEFT JOIN users ru ON ru.id = r.sender_id
           WHERE m.id = ?`,
          [result.insertId]
        );
        const message = rows[0];
        message.is_delivered = Boolean(message.is_delivered);
        if (typeof clientId === 'string' && clientId.length > 0 && clientId.length <= 64) {
          message.client_id = clientId;
        }

        // ...and only broadcast once the write has succeeded, so nobody
        // ever sees a message over the socket that isn't actually durable.
        io.to(roomName(conversationId)).emit('new_message', message);
        reply({ ok: true, id: message.id });
      } catch (err) {
        console.error('send_message error:', err.message);
        fail('Something went wrong, please try again');
      }
    });

    // --- message_delivered ---
    // Emitted by the RECIPIENT's client when a `new_message` reaches it. Flips
    // is_delivered and tells the room so the sender's ✓ becomes ✓✓. Like
    // `typing`, bad input is dropped silently. Acks are idempotent: the
    // `is_delivered = FALSE` guard means a duplicate (second tab, or the
    // on-connect catch-up racing a live ack) changes nothing and emits nothing.
    socket.on('message_delivered', async (payload) => {
      try {
        const { messageId: rawMessageId, conversationId: rawConversationId } = payload || {};
        const messageId = Number(rawMessageId);
        const conversationId = Number(rawConversationId);
        if (!Number.isInteger(messageId) || messageId <= 0) return;
        if (!Number.isInteger(conversationId) || conversationId <= 0) return;

        const authorized = await isParticipant(pool, conversationId, socket.userId);
        if (!authorized) return;

        // sender_id <> me: you can't acknowledge your own message.
        const [result] = await pool.query(
          'UPDATE messages SET is_delivered = TRUE WHERE id = ? AND conversation_id = ? AND sender_id <> ? AND is_delivered = FALSE',
          [messageId, conversationId, socket.userId]
        );
        if (result.affectedRows === 0) return;

        io.to(roomName(conversationId)).emit('message_delivered', {
          conversationId,
          messageIds: [messageId],
        });
      } catch (err) {
        console.error('message_delivered error:', err.message);
      }
    });

    // --- typing ---
    // Ephemeral "X is typing" signal: relayed to the rest of the room, never
    // written to MySQL, never logged. Because this fires on keystrokes, every
    // rejection is silent — an `error` emit per bad event would flood the
    // client. userId always comes from socket.userId, never the payload.
    //
    // Per-socket state (gone with the connection):
    //   typingAllowed    — conversations already authorized, so a keystroke
    //                      costs a Set lookup rather than a DB query
    //   typingDeniedAt   — recent failed checks, so a non-participant spamming
    //                      events can't turn into a DB query per event
    //   typingActive     — conversations we last relayed `true` for; flushed
    //                      as `false` on disconnect
    //   typingLastTrueAt — throttle clock for relayed `true` events
    const typingAllowed = new Set();
    const typingDeniedAt = new Map();
    const typingActive = new Set();
    const typingLastTrueAt = new Map();

    socket.on('typing', async (payload) => {
      try {
        const { conversationId: rawId, isTyping } = payload || {};
        if (typeof isTyping !== 'boolean') return;

        const conversationId = Number(rawId);
        if (!Number.isInteger(conversationId) || conversationId <= 0) return;

        if (isTyping) {
          const last = typingLastTrueAt.get(conversationId);
          if (last !== undefined && Date.now() - last < TYPING_THROTTLE_MS) return;
        }

        if (!typingAllowed.has(conversationId)) {
          const deniedAt = typingDeniedAt.get(conversationId);
          if (deniedAt !== undefined && Date.now() - deniedAt < TYPING_DENIED_TTL_MS) return;

          const authorized = await isParticipant(pool, conversationId, socket.userId);
          if (!authorized) {
            typingDeniedAt.set(conversationId, Date.now());
            return;
          }
          typingDeniedAt.delete(conversationId);
          typingAllowed.add(conversationId);
        }

        // The socket may have dropped while we were awaiting the lookup.
        if (socket.disconnected) return;

        if (isTyping) {
          typingLastTrueAt.set(conversationId, Date.now());
          typingActive.add(conversationId);
        } else {
          typingActive.delete(conversationId);
        }

        // socket.to (not io.to): the sender's own socket doesn't get it back.
        socket.to(roomName(conversationId)).emit('user_typing', {
          conversationId,
          userId: socket.userId,
          isTyping,
        });
      } catch (err) {
        // Stay quiet toward the client; a failed lookup just means no relay.
        console.error('typing error:', err.message);
      }
    });

    // `disconnecting` (not `disconnect`) so the socket is still in its rooms
    // when we tell them it stopped typing.
    socket.on('disconnecting', () => {
      typingActive.forEach((conversationId) => {
        socket.to(roomName(conversationId)).emit('user_typing', {
          conversationId,
          userId: socket.userId,
          isTyping: false,
        });
      });
      typingActive.clear();
    });
    // (The `disconnect` handler — last_seen_at — lives with the presence
    // bookkeeping near the top of this connection handler.)
  });
};
