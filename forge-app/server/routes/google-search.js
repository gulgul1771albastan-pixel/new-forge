const express = require('express');

const router = express.Router();

const BASE_URL = (process.env.SEARXNG_BASE_URL || '').replace(/\/+$/, '');

function searxConfigured() {
  return !!BASE_URL;
}

async function searxSearch(query, extraParams = {}) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    ...extraParams
  });
  const res = await fetch(`${BASE_URL}/search?${params.toString()}`, {
    headers: { 'Accept': 'application/json' }
  });
  const text = await res.text();
  console.log('SearXNG raw response (first 300 chars):', text.slice(0, 300));
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const err = new Error('SearXNG did not return JSON — check that "json" is enabled in search.formats in settings.yml');
    err.status = 502;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(data.error || 'SearXNG request failed');
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

// GET /api/search/google/web?q=...  -> web results via SearXNG
router.get('/web', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ results: [] });
  if (!searxConfigured()) return res.status(503).json({ error: 'SearXNG is not configured on the server yet (set SEARXNG_BASE_URL)', results: [] });

  try {
    const data = await searxSearch(q, { categories: 'general' });
    const results = (data.results || []).slice(0, 8).map(item => ({
      title: item.title,
      link: item.url,
      displayLink: safeHostname(item.url),
      snippet: item.content || '',
      thumbnail: item.thumbnail || item.img_src || null
    }));
    res.json({ results });
  } catch (err) {
    console.error('SearXNG web search error:', err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, results: [] });
  }
});

// GET /api/search/google/images?q=... -> image results via SearXNG
router.get('/images', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ images: [] });
  if (!searxConfigured()) return res.status(503).json({ error: 'SearXNG is not configured on the server yet (set SEARXNG_BASE_URL)', images: [] });

  try {
    const data = await searxSearch(q, { categories: 'images' });
    const images = (data.results || []).slice(0, 8).map(item => ({
      title: item.title,
      imageUrl: item.img_src || item.url,
      thumbnail: item.thumbnail_src || item.thumbnail || item.img_src || item.url,
      sourcePage: item.url,
      sourceSite: safeHostname(item.url)
    }));
    res.json({ images });
  } catch (err) {
    console.error('SearXNG image search error:', err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, images: [] });
  }
});

// GET /api/search/google/news?q=... -> news results via SearXNG
router.get('/news', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ results: [] });
  if (!searxConfigured()) return res.status(503).json({ error: 'SearXNG is not configured on the server yet (set SEARXNG_BASE_URL)', results: [] });

  try {
    const data = await searxSearch(q, { categories: 'news' });
    const results = (data.results || []).slice(0, 8).map(item => ({
      title: item.title,
      link: item.url,
      displayLink: safeHostname(item.url),
      snippet: item.content || '',
      thumbnail: item.thumbnail || item.img_src || null
    }));
    res.json({ results });
  } catch (err) {
    console.error('SearXNG news search error:', err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, results: [] });
  }
});

module.exports = router;
