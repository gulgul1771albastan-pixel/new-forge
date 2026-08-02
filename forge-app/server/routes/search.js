const express = require('express');
const router = express.Router();

const SEARXNG_BASE_URL = (process.env.SEARXNG_BASE_URL || '').replace(/\/+$/, '');

function safeHostname(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

// GET /api/search/youtube?q=... -> video results via SearXNG's video category
// (no YouTube API key needed; SearXNG aggregates YouTube + other video sources)
router.get('/youtube', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ videos: [] });
  if (!SEARXNG_BASE_URL) {
    return res.status(503).json({ error: 'SearXNG is not configured on the server yet (set SEARXNG_BASE_URL)', videos: [] });
  }

  try {
    const params = new URLSearchParams({ q, format: 'json', categories: 'videos' });
    const r = await fetch(`${SEARXNG_BASE_URL}/search?${params.toString()}`, {
      headers: { Accept: 'application/json' }
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({ error: 'SearXNG did not return JSON for video search', videos: [] });
    }
    if (!r.ok) {
      return res.status(r.status).json({ error: data.error || 'SearXNG video search failed', videos: [] });
    }

    const videos = (data.results || []).slice(0, 8).map(item => ({
      title: item.title,
      url: item.url,
      thumbnail: item.thumbnail || item.img_src || '',
      channel: safeHostname(item.url)
    }));
    res.json({ videos });
  } catch (err) {
    console.error('Video search error:', err.message);
    res.status(500).json({ error: err.message, videos: [] });
  }
});

// GET /api/search/forge-posts?q=... -> search your own Forge posts (Postgres)
router.get('/forge-posts', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ posts: [] });

  try {
    const { pool } = require('../db');
    const like = `%${q}%`;
    const { rows } = await pool.query(
      `SELECT posts.id, posts.title, posts.body, posts.topic, posts.image_url, users.username
       FROM posts
       JOIN users ON users.id = posts.user_id
       WHERE posts.title ILIKE $1 OR posts.body ILIKE $1 OR posts.topic ILIKE $1
       ORDER BY posts.created_at DESC
       LIMIT 8`,
      [like]
    );
    res.json({ posts: rows });
  } catch (err) {
    console.error('Forge post search error:', err.message);
    // Fail soft — the frontend just shows "no posts found" rather than an error banner
    res.json({ posts: [] });
  }
});

module.exports = router;
