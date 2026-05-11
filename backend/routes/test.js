const express = require('express');
const router = express.Router();
const { db } = require('../database');

// 提交测试结果
router.post('/submit', (req, res) => {
  const { student_id, text_id, speed, accuracy, correct_count, error_count, is_valid } = req.body;

  db.run(
    'INSERT INTO test_records (student_id, text_id, speed, accuracy, correct_count, error_count, is_valid) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [student_id, text_id, speed, accuracy, correct_count, error_count, is_valid ? 1 : 0],
    function(err) {
      if (err) {
        return res.status(500).json({ error: '提交失败' });
      }
      res.json({ success: true, recordId: this.lastID });
    }
  );
});

// 获取排行榜（历史最高分，去重，每人取最高分，支持学校/年级/班级筛选）
router.get('/ranking', (req, res) => {
  const { school, grade, class_number } = req.query;

  let whereClause = 's.exclude_ranking = 0';
  const params = [];

  if (school) {
    whereClause += ' AND s.school = ?';
    params.push(school);
  }
  if (grade) {
    whereClause += ' AND s.grade = ?';
    params.push(grade);
  }
  if (class_number) {
    whereClause += ' AND s.class_number = ?';
    params.push(class_number);
  }

  const query = `
    SELECT s.id, s.name, s.class, t1.speed, t1.accuracy
    FROM students s
    JOIN (
      SELECT student_id, MAX(speed) as max_speed, accuracy
      FROM test_records 
      WHERE is_valid = 1
      GROUP BY student_id
    ) t1 ON s.id = t1.student_id
    WHERE ${whereClause}
    ORDER BY t1.speed DESC, t1.accuracy DESC
    LIMIT 20
  `;

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: '数据库错误: ' + err.message });
    }
    // 重命名为speed
    rows.forEach(row => {
      row.speed = row.max_speed;
      delete row.max_speed;
    });
    // 取前10名
    res.json({ ranking: rows.slice(0, 10) });
  });
});

// 获取在线人数（占位符，返回随机数）
router.get('/online', (req, res) => {
  const count = Math.floor(Math.random() * 50) + 20;
  res.json({ count });
});

// 获取所有测试记录（管理员）
router.get('/records', (req, res) => {
  const { student_id, grade, class_number, start_date, end_date } = req.query;

  let query = `
    SELECT t.*, s.name, s.class, s.student_no, s.grade, s.class_number
    FROM test_records t
    JOIN students s ON t.student_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (student_id) {
    query += ' AND t.student_id = ?';
    params.push(student_id);
  }
  if (grade) {
    query += ' AND s.grade = ?';
    params.push(grade);
  }
  if (class_number) {
    query += ' AND s.class_number = ?';
    params.push(class_number);
  }
  if (start_date) {
    query += ' AND DATE(t.created_at) >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND DATE(t.created_at) <= ?';
    params.push(end_date);
  }

  query += ' ORDER BY t.created_at DESC LIMIT 500';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ records: rows });
  });
});

// 标记测试记录为无效
router.put('/records/:id/invalid', (req, res) => {
  const { id } = req.params;
  const { is_valid } = req.body;

  db.run(
    'UPDATE test_records SET is_valid = ? WHERE id = ?',
    [is_valid ? 1 : 0, id],
    function(err) {
      if (err) return res.status(500).json({ error: '更新失败' });
      res.json({ success: true });
    }
  );
});

// 获取单条测试记录详情
router.get('/records/:id', (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT t.*, s.name, s.class, s.student_no
     FROM test_records t
     JOIN students s ON t.student_id = s.id
     WHERE t.id = ?`,
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: '数据库错误' });
      if (!row) return res.status(404).json({ error: '记录不存在' });
      res.json({ record: row });
    }
  );
});

module.exports = router;
