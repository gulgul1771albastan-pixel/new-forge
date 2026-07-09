const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { signToken, requireAuth } = require('../auth');

const router = express.Router();

const COLORS = ['#FF5A2B', '#6E8FA6', '#FF9457', '#A9C2D3', '#E85A4F', '#6FAE7D'];
function randomColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }

router.post('/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    const existing = await pool.query(
      'SELECT id FROM users WHERE username=$1 OR email=$2',
      [cleanUsername, cleanEmail]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already in use' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, avatar_color)
       VALUES ($1,$2,$3,$4) RETURNING id, username, email, avatar_color, created_at`,
      [cleanUsername, cleanEmail, hash, randomColor()]
    );
    const user = result.rows[0];
    const token = signToken(user);
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const cleanUsername = username.trim().toLowerCase();
    const result = await pool.query(
      'SELECT * FROM users WHERE username=$1 OR email=$1',
      [cleanUsername]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

    const token = signToken(user);
    delete user.password_hash;
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT id, username, email, avatar_color, created_at FROM users WHERE id=$1',
    [req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: result.rows[0] });
});

module.exports = router;
