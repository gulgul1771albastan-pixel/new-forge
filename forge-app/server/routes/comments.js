const express = require('express');
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../auth');

const router = express.Router();

// GET /api/posts/:postId/comments
router.get('/:postId/comments', optionalAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const result = await pool.query(`
      SELECT comments.*, users.username, users.avatar_color
      FROM comments JOIN users ON comments.user_id = users.id
      WHERE comments.post_id=$1
      ORDER BY comments.created_at ASC
    `, [postId]);
    res.json({ comments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

// POST /api/posts/:postId/comments
router.post('/:postId/comments', requireAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });

    const result = await pool.query(
      `INSERT INTO comments (post_id, user_id, body) VALUES ($1,$2,$3) RETURNING *`,
      [postId, req.user.id, body.trim()]
    );
    const full = await pool.query(`
      SELECT comments.*, users.username, users.avatar_color
      FROM comments JOIN users ON comments.user_id = users.id
      WHERE comments.id=$1
    `, [result.rows[0].id]);
    res.status(201).json({ comment: full.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// DELETE /api/posts/:postId/comments/:commentId
router.delete('/:postId/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const { commentId } = req.params;
    const result = await pool.query('SELECT * FROM comments WHERE id=$1', [commentId]);
    const comment = result.rows[0];
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.user_id !== req.user.id) return res.status(403).json({ error: 'Not your comment' });

    await pool.query('DELETE FROM comments WHERE id=$1', [commentId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

module.exports = router;
