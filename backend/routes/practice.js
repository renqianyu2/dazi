const express = require('express');
const router = express.Router();
const { db } = require('../database');

// 保存练习记录
router.post('/submit', (req, res) => {
  const { student_id, mode, score, duration, extra_data } = req.body;

  const sql = `INSERT INTO practice_records (student_id, mode, score, duration, extra_data)
               VALUES (?, ?, ?, ?, ?)`;

  db.run(sql, [student_id, mode, score, duration, JSON.stringify(extra_data || {})], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, message: '练习记录保存成功' });
  });
});

// 获取学生练习记录
router.get('/records/:student_id', (req, res) => {
  const { student_id } = req.params;

  const sql = `SELECT * FROM practice_records
               WHERE student_id = ?
               ORDER BY created_at DESC`;

  db.all(sql, [student_id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// 获取练习统计
router.get('/stats/:student_id', (req, res) => {
  const { student_id } = req.params;

  const sql = `SELECT
                mode,
                COUNT(*) as count,
                MAX(score) as max_score,
                AVG(score) as avg_score,
                SUM(duration) as total_duration
               FROM practice_records
               WHERE student_id = ?
               GROUP BY mode`;

  db.all(sql, [student_id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// 获取所有练习记录（管理员）
router.get('/records', (req, res) => {
  const { student_id, mode, grade, class_number } = req.query;

  let query = `
    SELECT p.*, s.name, s.class, s.student_no, s.grade, s.class_number
    FROM practice_records p
    JOIN students s ON p.student_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (student_id) {
    query += ' AND p.student_id = ?';
    params.push(student_id);
  }
  if (mode) {
    query += ' AND p.mode = ?';
    params.push(mode);
  }
  if (grade) {
    query += ' AND s.grade = ?';
    params.push(grade);
  }
  if (class_number) {
    query += ' AND s.class_number = ?';
    params.push(class_number);
  }

  query += ' ORDER BY p.created_at DESC LIMIT 500';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ records: rows });
  });
});

// 获取练习统计（管理员）
router.get('/stats', (req, res) => {
  const sql = `
    SELECT
      mode,
      COUNT(*) as total_count,
      COUNT(DISTINCT student_id) as student_count,
      AVG(score) as avg_score,
      SUM(duration) as total_duration
    FROM practice_records
    GROUP BY mode
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ stats: rows });
  });
});

module.exports = router;
