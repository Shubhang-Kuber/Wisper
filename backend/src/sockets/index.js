const jwt = require('jsonwebtoken');

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

    // --- Rejoin every conversation this user already belongs to ---
    // This covers reconnects: a user who goes offline and comes back gets
    // dropped back into every room they were already part of, with no
    // manual step on their end. It does NOT cover conversations created
    // *after* this socket connected — see the `join_conversation` handler
    // below for that case.
    try {
      const [rows] = await pool.query(
        'SELECT conversation_id FROM conversation_participants WHERE user_id = ?',
        [socket.userId]
      );

      rows.forEach((row) => socket.join(roomName(row.conversation_id)));

      console.log(`Socket ${socket.id} (userId=${socket.userId}) joined ${rows.length} conversation room(s)`);
    } catch (err) {
      console.error('Failed to join existing conversation rooms:', err.message);
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
    socket.on('send_message', async ({ conversationId, body } = {}) => {
      try {
        const authorized = await isParticipant(pool, conversationId, socket.userId);

        if (!authorized) {
          socket.emit('error', { message: 'Not a participant in this conversation' });
          return;
        }

        // Write to MySQL first...
        const [result] = await pool.query(
          'INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)',
          [conversationId, socket.userId, body]
        );

        const [rows] = await pool.query(
          'SELECT id, conversation_id, sender_id, body, created_at FROM messages WHERE id = ?',
          [result.insertId]
        );
        const message = rows[0];

        // ...and only broadcast once the write has succeeded, so nobody
        // ever sees a message over the socket that isn't actually durable.
        io.to(roomName(conversationId)).emit('new_message', message);
      } catch (err) {
        console.error('send_message error:', err.message);
        socket.emit('error', { message: 'Something went wrong, please try again' });
      }
    });

    // --- disconnect ---
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: userId=${socket.userId}, socketId=${socket.id}`);

      try {
        await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = ?', [socket.userId]);
      } catch (err) {
        console.error('Failed to update last_seen_at on disconnect:', err.message);
      }
    });
  });
};
