const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// GET /api/users/search?q=<query>
// Phase 5B addition, approved as a scoped exception alongside the
// conversation-list endpoint below: before this, there was no way for the
// frontend to discover another user at all. POST /api/conversations
// (routes/conversations.js) requires an otherUserId that has to come from
// somewhere, and nothing in Phases 1-4 exposed a user directory. Read-only,
// substring match on username, excludes the requester, capped at 10 rows.
router.get('/search', authenticateToken, async (req, res) => {
  const q = (req.query.q || '').trim();

  if (!q) {
    return res.status(200).json({ users: [] });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, username FROM users WHERE username LIKE ? AND id != ? ORDER BY username LIMIT 10',
      [`%${q}%`, req.userId]
    );

    return res.status(200).json({ users: rows });
  } catch (err) {
    console.error('User search error:', err);
    return res.status(500).json({ error: 'Something went wrong, please try again' });
  }
});

module.exports = router;
