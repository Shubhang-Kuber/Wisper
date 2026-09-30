const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// POST /api/conversations
// Finds an existing 1:1 conversation between the requester and another user, or creates one.
router.post('/', authenticateToken, async (req, res) => {
  const { otherUserId } = req.body;

  if (!otherUserId) {
    return res.status(400).json({ error: 'otherUserId is required' });
  }

  if (otherUserId === req.userId) {
    return res.status(400).json({ error: 'Cannot start a conversation with yourself' });
  }

  try {
    const [existing] = await pool.query(
      `SELECT cp1.conversation_id FROM conversation_participants cp1
       JOIN conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
       WHERE cp1.user_id = ? AND cp2.user_id = ?`,
      [req.userId, otherUserId]
    );

    if (existing.length > 0) {
      return res.status(200).json({ conversationId: existing[0].conversation_id, created: false });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [result] = await connection.query(
        'INSERT INTO conversations (is_group) VALUES (false)'
      );
      const conversationId = result.insertId;

      await connection.query(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)',
        [conversationId, req.userId, conversationId, otherUserId]
      );

      await connection.commit();

      return res.status(201).json({ conversationId, created: true });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Create conversation error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

// GET /api/conversations
// Lists every conversation the requesting user is a participant in, each
// row already carrying the other participant's identity (id, username,
// last_seen_at) and a preview of the most recent message, so the frontend
// never needs a second round trip per conversation just to render a list
// item. Phase 5B addition, approved as a scoped exception alongside
// GET /api/users/search: nothing before this phase exposed a "list my
// conversations" view at all, and the chat UI has no other way to know
// what conversations exist to render. Read-only; assumes 1:1 conversations
// only (is_group is never set true anywhere in this codebase yet), the
// same assumption POST / above already makes.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         c.id AS conversationId,
         ou.id AS otherUserId,
         ou.username AS otherUsername,
         ou.last_seen_at AS otherLastSeenAt,
         ocp.last_read_at AS otherLastReadAt,
         lm.body AS lastMessageBody,
         lm.created_at AS lastMessageAt,
         lm.sender_id AS lastMessageSenderId,
         (SELECT COUNT(*) FROM messages m
           WHERE m.conversation_id = c.id
             AND m.sender_id <> ?
             AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)) AS unread_count
       FROM conversation_participants cp
       JOIN conversations c ON c.id = cp.conversation_id
       JOIN conversation_participants ocp
         ON ocp.conversation_id = cp.conversation_id AND ocp.user_id != cp.user_id
       JOIN users ou ON ou.id = ocp.user_id
       LEFT JOIN (
         SELECT m1.conversation_id, m1.body, m1.created_at, m1.sender_id
         FROM messages m1
         INNER JOIN (
           SELECT conversation_id, MAX(id) AS max_id
           FROM messages
           GROUP BY conversation_id
         ) latest ON latest.conversation_id = m1.conversation_id AND latest.max_id = m1.id
       ) lm ON lm.conversation_id = c.id
       WHERE cp.user_id = ?
       ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
      [req.userId, req.userId]
    );

    return res.status(200).json({ conversations: rows });
  } catch (err) {
    console.error('List conversations error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

// GET /api/conversations/:id/messages
// Paginated message history, oldest-to-newest, cursor-based via `before`.
router.get('/:id/messages', authenticateToken, async (req, res) => {
  const conversationId = req.params.id;

  try {
    const [participantRows] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, req.userId]
    );

    if (participantRows.length === 0) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(Math.max(parsedLimit > 0 ? parsedLimit : 20, 1), 100);
    const before = req.query.before;

    // replied_* come from joining the original message (and its sender), so
    // the frontend can render the reply preview without a second fetch —
    // even when the original is older than the loaded page. replied_body is
    // NULL when the original was deleted for everyone or hidden by the
    // requester, which the frontend already renders as a deleted quote.
    // Messages the requester deleted "for me" (their id in deleted_by_users)
    // are left out entirely. Messages deleted for everyone stay in the list as
    // tombstones (is_deleted, body null) so the thread shows "[deleted message]".
    const requesterJson = `CAST(? AS JSON)`;
    const columns = `m.id, m.sender_id, m.body, m.created_at, m.replied_to_message_id, m.is_deleted,
                     CASE WHEN r.is_deleted OR JSON_CONTAINS(COALESCE(r.deleted_by_users, JSON_ARRAY()), ${requesterJson})
                          THEN NULL ELSE r.body END AS replied_body,
                     r.sender_id AS replied_sender_id, ru.username AS replied_sender_username`;
    const joins = `LEFT JOIN messages r ON r.id = m.replied_to_message_id
                   LEFT JOIN users ru ON ru.id = r.sender_id`;
    const notHiddenForMe = `NOT JSON_CONTAINS(COALESCE(m.deleted_by_users, JSON_ARRAY()), ${requesterJson})`;

    let rows;
    if (before) {
      [rows] = await pool.query(
        `SELECT ${columns} FROM messages m ${joins}
         WHERE m.conversation_id = ? AND m.id < ? AND ${notHiddenForMe}
         ORDER BY m.created_at DESC
         LIMIT ?`,
        [req.userId, conversationId, before, req.userId, limit]
      );
    } else {
      [rows] = await pool.query(
        `SELECT ${columns} FROM messages m ${joins}
         WHERE m.conversation_id = ? AND ${notHiddenForMe}
         ORDER BY m.created_at DESC
         LIMIT ?`,
        [req.userId, conversationId, req.userId, limit]
      );
    }

    rows = rows.map((row) => {
      const isDeleted = Boolean(row.is_deleted);
      return { ...row, is_deleted: isDeleted, body: isDeleted ? null : row.body };
    });
    rows.reverse();

    return res.status(200).json({ messages: rows });
  } catch (err) {
    console.error('Fetch messages error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

// GET /api/conversations/:id/search?q=<query>
// Full-text search within one conversation, last 90 days, newest first.
// Relies on the FULLTEXT index idx_body_fulltext on messages(body).
router.get('/:id/search', authenticateToken, async (req, res) => {
  const conversationId = req.params.id;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (!q) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    const [participantRows] = await pool.query(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, req.userId]
    );

    if (participantRows.length === 0) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    const [rows] = await pool.query(
      `SELECT id, sender_id, body, created_at
       FROM messages
       WHERE conversation_id = ?
         AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
         AND MATCH(body) AGAINST(? IN BOOLEAN MODE)
       ORDER BY created_at DESC
       LIMIT 500`,
      [conversationId, q]
    );

    return res.status(200).json(rows);
  } catch (err) {
    console.error('Search messages error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

// POST /api/conversations/:id/read
// Marks the conversation as read up to now, for the requesting user only.
router.post('/:id/read', authenticateToken, async (req, res) => {
  const conversationId = req.params.id;

  try {
    const [result] = await pool.query(
      'UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [conversationId, req.userId]
    );

    if (result.affectedRows === 0) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    // --- Scoped backend exception (Phase 5B) ---
    // The UPDATE above updates last_read_at in MySQL, but nothing told the
    // *other* participant's browser it happened — without a live push, the
    // "seen" indicator can't update without a manual refresh. Read back the
    // exact value just written (rather than re-deriving "now" in JS, which
    // could drift from what MySQL's NOW() actually stored) and broadcast it
    // to the conversation's room. `io` is stashed on the Express app in
    // index.js (`app.set('io', io)`) so this route doesn't need to import
    // backend/src/sockets/index.js directly. Nothing else about this
    // route's logic, response shape, or authorization check changes.
    const [[participantRow]] = await pool.query(
      'SELECT last_read_at FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, req.userId]
    );

    const io = req.app.get('io');
    if (io && participantRow) {
      io.to(`conversation:${conversationId}`).emit('conversation_read', {
        conversationId: Number(conversationId),
        userId: req.userId,
        readAt: participantRow.last_read_at,
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

// --- Message pins -----------------------------------------------------------
// Pins are shared by both participants and fetched on demand (no socket
// events). expires_at is the source of truth for "active": the stored
// is_active column is never flipped when a pin lapses, so every active/expired
// check below compares expires_at with NOW() instead of reading is_active.
const MAX_ACTIVE_PINS = 5;
const PIN_EXPIRY_DAYS = [1, 7, 30];

async function isParticipant(conversationId, userId) {
  const [rows] = await pool.query(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
  return rows.length > 0;
}

// POST /api/conversations/:id/pin
// Body: { message_id, expiry_days } with expiry_days one of 1, 7, 30.
router.post('/:id/pin', authenticateToken, async (req, res) => {
  const conversationId = req.params.id;
  const messageId = Number(req.body.message_id);
  const expiryDays = Number(req.body.expiry_days);

  if (!Number.isInteger(messageId) || messageId <= 0) {
    return res.status(400).json({ error: 'message_id is required' });
  }
  if (!PIN_EXPIRY_DAYS.includes(expiryDays)) {
    return res.status(400).json({ error: 'expiry_days must be 1, 7, or 30' });
  }

  try {
    if (!(await isParticipant(conversationId, req.userId))) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    const [messageRows] = await pool.query(
      'SELECT 1 FROM messages WHERE id = ? AND conversation_id = ?',
      [messageId, conversationId]
    );
    if (messageRows.length === 0) {
      return res.status(404).json({ error: 'Message not found in this conversation' });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Serialise pins per conversation so two simultaneous requests can't
      // both pass the count check and push the conversation past the cap.
      await connection.query('SELECT id FROM conversations WHERE id = ? FOR UPDATE', [conversationId]);

      const [existing] = await connection.query(
        'SELECT 1 FROM pinned_messages WHERE conversation_id = ? AND message_id = ?',
        [conversationId, messageId]
      );
      if (existing.length > 0) {
        await connection.rollback();
        return res.status(409).json({ error: 'Message already pinned' });
      }

      const [[{ activeCount }]] = await connection.query(
        `SELECT COUNT(*) AS activeCount FROM pinned_messages
         WHERE conversation_id = ? AND expires_at > NOW()`,
        [conversationId]
      );
      if (activeCount >= MAX_ACTIVE_PINS) {
        await connection.rollback();
        return res.status(400).json({ error: 'Maximum 5 pins reached. Unpin a message first.' });
      }

      const [result] = await connection.query(
        `INSERT INTO pinned_messages (conversation_id, message_id, pinned_by_user_id, expires_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
        [conversationId, messageId, req.userId, expiryDays]
      );

      const [[pin]] = await connection.query(
        `SELECT id, conversation_id, message_id, pinned_by_user_id, pinned_at, expires_at, is_active
         FROM pinned_messages WHERE id = ?`,
        [result.insertId]
      );

      await connection.commit();

      return res.status(201).json({ ...pin, is_active: Boolean(pin.is_active) });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Create pin error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

// GET /api/conversations/:id/pins
// Every pin for the conversation, active first (newest pinned first), then
// expired. Messages that no longer exist come back as "[deleted message]".
router.get('/:id/pins', authenticateToken, async (req, res) => {
  const conversationId = req.params.id;

  try {
    if (!(await isParticipant(conversationId, req.userId))) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    const [rows] = await pool.query(
      `SELECT p.id, p.conversation_id, p.message_id, p.pinned_by_user_id, p.pinned_at, p.expires_at,
              CASE WHEN p.expires_at < NOW() THEN FALSE ELSE TRUE END AS is_active,
              m.id IS NULL AS message_deleted,
              m.body, m.sender_id, m.created_at, u.username
       FROM pinned_messages p
       LEFT JOIN messages m ON p.message_id = m.id
       LEFT JOIN users u ON m.sender_id = u.id
       WHERE p.conversation_id = ?
       ORDER BY CASE WHEN p.expires_at >= NOW() THEN 0 ELSE 1 END, p.pinned_at DESC, p.id DESC`,
      [conversationId]
    );

    const pins = rows.map((row) => ({
      ...row,
      is_active: Boolean(row.is_active),
      message_deleted: Boolean(row.message_deleted),
      body: row.body ?? '[deleted message]',
    }));

    return res.status(200).json(pins);
  } catch (err) {
    console.error('List pins error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

// DELETE /api/conversations/:id/pin/:pin_id
// Either participant can remove any pin in the conversation.
router.delete('/:id/pin/:pin_id', authenticateToken, async (req, res) => {
  const conversationId = req.params.id;
  const pinId = req.params.pin_id;

  try {
    if (!(await isParticipant(conversationId, req.userId))) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    const [result] = await pool.query(
      'DELETE FROM pinned_messages WHERE id = ? AND conversation_id = ?',
      [pinId, conversationId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Pin not found' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Delete pin error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

// DELETE /api/conversations/:id/pins
// Removes every pin (active and expired) in the conversation. Either
// participant may do this, matching single unpin. Succeeds with deleted: 0
// when there was nothing to remove.
router.delete('/:id/pins', authenticateToken, async (req, res) => {
  const conversationId = req.params.id;

  try {
    if (!(await isParticipant(conversationId, req.userId))) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    const [result] = await pool.query('DELETE FROM pinned_messages WHERE conversation_id = ?', [
      conversationId,
    ]);

    return res.status(200).json({ success: true, deleted: result.affectedRows });
  } catch (err) {
    console.error('Delete all pins error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

// POST /api/conversations/:id/delete/:message_id
// Body: { delete_type: "everyone" | "me" }.
//  - "everyone": soft delete (is_deleted, deleted_at, body cleared). Sender only,
//    and only within DELETE_FOR_EVERYONE_HOURS of sending. Emits `message_deleted`.
//  - "me": appends the requester's id to deleted_by_users, so only they stop
//    seeing it. Any participant, no time limit, no socket event. The row is
//    shared with the other participant, so it is never physically removed.
// body is NOT NULL in the schema, so "cleared" is '' in the table; GET returns
// null for it.
const DELETE_FOR_EVERYONE_HOURS = 60;

router.post('/:id/delete/:message_id', authenticateToken, async (req, res) => {
  const conversationId = req.params.id;
  const messageId = Number(req.params.message_id);
  const deleteType = req.body && req.body.delete_type;

  if (deleteType !== 'everyone' && deleteType !== 'me') {
    return res.status(400).json({ error: 'delete_type must be "everyone" or "me"' });
  }
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return res.status(400).json({ error: 'Invalid message id' });
  }

  try {
    if (!(await isParticipant(conversationId, req.userId))) {
      return res.status(403).json({ error: 'You are not a participant in this conversation' });
    }

    const [messageRows] = await pool.query(
      `SELECT sender_id, is_deleted, TIMESTAMPDIFF(HOUR, created_at, NOW()) AS age_hours
       FROM messages WHERE id = ? AND conversation_id = ?`,
      [messageId, conversationId]
    );
    if (messageRows.length === 0) {
      return res.status(404).json({ error: 'Message not found in this conversation' });
    }
    const message = messageRows[0];

    if (deleteType === 'everyone') {
      if (Number(message.sender_id) !== Number(req.userId)) {
        return res.status(403).json({ error: 'Only the sender can delete a message for everyone' });
      }
      if (message.age_hours > DELETE_FOR_EVERYONE_HOURS) {
        return res
          .status(400)
          .json({ error: `Cannot delete message older than ${DELETE_FOR_EVERYONE_HOURS} hours` });
      }
      if (message.is_deleted) {
        return res.status(400).json({ error: 'Message is already deleted' });
      }

      await pool.query(
        `UPDATE messages SET is_deleted = TRUE, deleted_at = NOW(), body = ''
         WHERE id = ? AND conversation_id = ?`,
        [messageId, conversationId]
      );

      const io = req.app.get('io');
      if (io) {
        io.to(`conversation:${conversationId}`).emit('message_deleted', {
          message_id: messageId,
          delete_type: 'everyone',
        });
      }

      return res.status(200).json({ success: true, delete_type: 'everyone' });
    }

    // Single statement, and skipped when the id is already in the array, so a
    // repeated request can't add a duplicate.
    await pool.query(
      `UPDATE messages
       SET deleted_by_users = JSON_ARRAY_APPEND(COALESCE(deleted_by_users, JSON_ARRAY()), '$', ?)
       WHERE id = ? AND conversation_id = ?
         AND NOT JSON_CONTAINS(COALESCE(deleted_by_users, JSON_ARRAY()), CAST(? AS JSON))`,
      [req.userId, messageId, conversationId, req.userId]
    );

    return res.status(200).json({ success: true, delete_type: 'me' });
  } catch (err) {
    console.error('Delete message error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

module.exports = router;
