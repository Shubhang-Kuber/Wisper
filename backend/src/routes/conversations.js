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

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

module.exports = router;
