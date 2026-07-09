const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../auth');
const { upload, cloudinary } = require('../upload');

const router = express.Router();

// Shape a post row for the frontend, including counts and whether the
// requesting user has liked it.
async function attachCounts(posts, userId) {
  if (posts.length === 0) return posts;
  const ids = posts.map(p => p.id);

  const likeCounts = await pool.query(
    `SELECT post_id, COUNT(*)::int AS count FROM likes WHERE post_id = ANY($1) GROUP BY post_id`,
    [ids]
  );
  const commentCounts = await pool.query(
    `SELECT post_id, COUNT(*)::int AS count FROM comments WHERE post_id = ANY($1) GROUP BY post_id`,
    [ids]
  );
  const likeMap = {}, commentMap = {};
  likeCounts.rows.forEach(r => { likeMap[r.post_id] = r.count; });
  commentCounts.rows.forEach(r => { commentMap[r.post_id] = r.count; });

  let likedByUser = {};
  if (userId) {
    const mine = await pool.query(
      `SELECT post_id FROM likes WHERE post_id = ANY($1) AND user_id=$2`,
      [ids, userId]
    );
    mine.rows.forEach(r => { likedByUser[r.post_id] = true; });
  }

  return posts.map(p => ({
    ...p,
    likes: likeMap[p.id] || 0,
    comments: commentMap[p.id] || 0,
    likedByMe: !!likedByUser[p.id]
  }));
}

// GET /api/posts - list all posts, newest first
router.get('/', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT posts.*, users.username, users.avatar_color
      FROM posts JOIN users ON posts.user_id = users.id
      ORDER BY posts.created_at DESC
      LIMIT 200
    `);
    const withCounts = await attachCounts(result.rows, req.user && req.user.id);
    res.json({ posts: withCounts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// GET /api/posts/:id - single post + register a view
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT posts.*, users.username, users.avatar_color
      FROM posts JOIN users ON posts.user_id = users.id
      WHERE posts.id=$1
    `, [id]);
    const post = result.rows[0];
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // Count a view once per visitor (cookie-less: hash of IP + UA + post id)
    // so refreshing the page doesn't inflate the count endlessly.
    const viewerKey = crypto
      .createHash('sha256')
      .update((req.headers['x-forwarded-for'] || req.ip || '') + (req.headers['user-agent'] || '') + id)
      .digest('hex');

    const inserted = await pool.query(
      `INSERT INTO post_views (post_id, viewer_key) VALUES ($1,$2)
       ON CONFLICT (post_id, viewer_key) DO NOTHING RETURNING id`,
      [id, viewerKey]
    );
    if (inserted.rows.length > 0) {
      await pool.query('UPDATE posts SET views = views + 1 WHERE id=$1', [id]);
      post.views = post.views + 1;
    }

    const [withCounts] = await attachCounts([post], req.user && req.user.id);
    res.json({ post: withCounts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

// POST /api/posts - create a post, optional image upload
router.post('/', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { title, body, topic } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'Title and body are required' });
    }
    const imageUrl = req.file ? req.file.path : null;
    const imagePublicId = req.file ? req.file.filename : null;

    const result = await pool.query(
      `INSERT INTO posts (user_id, title, body, topic, image_url, image_public_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, title, body, topic || 'general', imageUrl, imagePublicId]
    );

    const full = await pool.query(`
      SELECT posts.*, users.username, users.avatar_color
      FROM posts JOIN users ON posts.user_id = users.id
      WHERE posts.id=$1
    `, [result.rows[0].id]);

    const [withCounts] = await attachCounts([full.rows[0]], req.user.id);
    res.status(201).json({ post: withCounts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// DELETE /api/posts/:id - only the author can delete
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM posts WHERE id=$1', [id]);
    const post = result.rows[0];
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.user_id !== req.user.id) return res.status(403).json({ error: 'Not your post' });

    if (post.image_public_id) {
      cloudinary.uploader.destroy(post.image_public_id).catch(() => {});
    }
    await pool.query('DELETE FROM posts WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// POST /api/posts/:id/like - toggle like
router.post('/:id/like', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query(
      'SELECT id FROM likes WHERE post_id=$1 AND user_id=$2',
      [id, req.user.id]
    );
    let liked;
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM likes WHERE post_id=$1 AND user_id=$2', [id, req.user.id]);
      liked = false;
    } else {
      await pool.query('INSERT INTO likes (post_id, user_id) VALUES ($1,$2)', [id, req.user.id]);
      liked = true;
    }
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM likes WHERE post_id=$1', [id]);
    res.json({ liked, likes: count.rows[0].count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

module.exports = router;
