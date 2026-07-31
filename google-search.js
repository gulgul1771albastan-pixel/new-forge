const express = require('express');

const router = express.Router();

const BASE_URL = 'https://www.googleapis.com/customsearch/v1';

function googleConfigured() {
  return !!(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX);
}

async function googleSearch(query, extraParams = {}) {
  const params = new URLSearchParams({
    key: process.env.GOOGLE_SEARCH_API_KEY,
    cx: process.env.GOOGLE_SEARCH_CX,
    q: query,
    ...extraParams
  });
  const res = await fetch(`${BASE_URL}?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error?.message || 'Google Search API request failed');
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// GET /api/search/google/web?q=...  -> real Google web results
router.get('/web', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ results: [] });
  if (!googleConfigured()) return res.status(503).json({ error: 'Google Search is not configured on the server yet', results: [] });

  try {
    const data = await googleSearch(q, { num: '8' });
    const results = (data.items || []).map(item => ({
      title: item.title,
      link: item.link,
      displayLink: item.displayLink,
      snippet: item.snippet,
      thumbnail: item.pagemap?.cse_thumbnail?.[0]?.src || item.pagemap?.cse_image?.[0]?.src || null
    }));
    res.json({ results });
  } catch (err) {
    console.error('Google web search error:', err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, results: [] });
  }
});

// GET /api/search/google/images?q=... -> real Google Image results
router.get('/images', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ images: [] });
  if (!googleConfigured()) return res.status(503).json({ error: 'Google Search is not configured on the server yet', images: [] });

  try {
    const data = await googleSearch(q, { searchType: 'image', num: '8', safe: 'active' });
    const images = (data.items || []).map(item => ({
      title: item.title,
      imageUrl: item.link,
      thumbnail: item.image?.thumbnailLink || item.link,
      sourcePage: item.image?.contextLink,
      sourceSite: item.displayLink
    }));
    res.json({ images });
  } catch (err) {
    console.error('Google image search error:', err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, images: [] });
  }
});

// GET /api/search/google/news?q=... -> Google web results biased toward news sources.
// Note: there is no official "Google News API" — this uses Custom Search with
// sorting/date bias toward recent results, which is the closest real equivalent.
router.get('/news', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ results: [] });
  if (!googleConfigured()) return res.status(503).json({ error: 'Google Search is not configured on the server yet', results: [] });

  try {
    const data = await googleSearch(q, { num: '8', sort: 'date' });
    const results = (data.items || []).map(item => ({
      title: item.title,
      link: item.link,
      displayLink: item.displayLink,
      snippet: item.snippet,
      thumbnail: item.pagemap?.cse_thumbnail?.[0]?.src || null
    }));
    res.json({ results });
  } catch (err) {
    console.error('Google news search error:', err.details || err.message);
    res.status(err.status || 500).json({ error: err.message, results: [] });
  }
});

module.exports = router;
