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
         lm.sender_id AS lastMessageSenderId
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
      [req.userId]
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

    let rows;
    if (before) {
      [rows] = await pool.query(
        `SELECT id, sender_id, body, created_at FROM messages
         WHERE conversation_id = ? AND id < ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [conversationId, before, limit]
      );
    } else {
      [rows] = await pool.query(
        `SELECT id, sender_id, body, created_at FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [conversationId, limit]
      );
    }

    rows.reverse();

    return res.status(200).json({ messages: rows });
  } catch (err) {
    console.error('Fetch messages error:', err);
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

module.exports = router;
