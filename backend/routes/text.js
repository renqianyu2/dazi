const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { getPinyinHints } = require('../utils/pinyin');

// 获取随机测试文本
router.get('/random', (req, res) => {
  const level = req.query.level || 'level1';

  db.get(
    'SELECT * FROM texts WHERE level = ? ORDER BY RANDOM() LIMIT 1',
    [level],
    (err, text) => {
      if (err || !text) {
        return res.status(500).json({ error: '获取文本失败' });
      }

      const pinyinHints = getPinyinHints(text.content);
      res.json({ text, pinyinHints });
    }
  );
});

module.exports = router;
