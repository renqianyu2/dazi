const express = require('express');
const router = express.Router();
const { db } = require('../database');

// 生成随机验证码（6位，避免混淆字符）
function generateCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 生成新验证码
router.post('/generate', (req, res) => {
  db.run('UPDATE test_codes SET is_active = 0', [], (err) => {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    db.run(
      'INSERT INTO test_codes (code, expires_at) VALUES (?, ?)',
      [code, expiresAt],
      function(err) {
        if (err) return res.status(500).json({ error: '生成失败' });
        res.json({ success: true, code, expires_at: expiresAt });
      }
    );
  });
});

// 获取当前有效验证码
router.get('/current', (req, res) => {
  db.get(
    "SELECT * FROM test_codes WHERE is_active = 1 AND datetime(expires_at) > datetime('now') ORDER BY created_at DESC LIMIT 1",
    [],
    (err, row) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json({ code: row || null });
    }
  );
});

// 验证验证码
router.post('/verify', (req, res) => {
  const { code } = req.body;

  db.get(
    "SELECT * FROM test_codes WHERE code = ? AND is_active = 1 AND datetime(expires_at) > datetime('now')",
    [code],
    (err, row) => {
      if (err) return res.status(500).json({ error: '验证失败' });
      res.json({ valid: !!row });
    }
  );
});

// 获取历史记录
router.get('/history', (req, res) => {
  db.all(
    'SELECT * FROM test_codes ORDER BY created_at DESC LIMIT 20',
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json({ codes: rows });
    }
  );
});

module.exports = router;
