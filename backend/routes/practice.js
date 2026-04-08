const express = require('express');
const router = express.Router();
const { db } = require('../database');

// 积分权重配置
const SCORE_WEIGHTS = {
    interstellar: 0.30,
    fruit: 0.25,
    adventure: 0.25,
    classics: 0.20
};

// 计算单个项目的积分
function calculateItemScore(score, wpm, accuracy) {
    const normalizedScore = Math.min(score / 10000, 1) * 100;
    const normalizedWpm = Math.min(wpm / 200, 1) * 100;
    return Math.round(normalizedScore * 0.4 + normalizedWpm * 0.4 + accuracy * 0.2);
}

// 计算综合积分
function calculateTotalScore(interstellar, fruit, adventure, classics) {
    return Math.round(
        interstellar * SCORE_WEIGHTS.interstellar +
        fruit * SCORE_WEIGHTS.fruit +
        adventure * SCORE_WEIGHTS.adventure +
        classics * SCORE_WEIGHTS.classics
    );
}

// 更新学生积分
function updateStudentScoreRecord(studentId, callback) {
    const queries = {
        interstellar: `SELECT 
            MAX(score) as best_score, MAX(wpm) as best_wpm, MAX(accuracy) as best_accuracy,
            COUNT(*) as play_count, SUM(duration) as total_time
            FROM practice_records WHERE student_id = ? AND mode = 'interstellar-typist'`,
        fruit: `SELECT 
            MAX(score) as best_score, MAX(wpm) as best_wpm, MAX(accuracy) as best_accuracy,
            MAX(max_combo) as best_combo, COUNT(*) as play_count, SUM(duration) as total_time
            FROM practice_records WHERE student_id = ? AND mode = 'fruit-catch'`,
        adventure: `SELECT 
            MAX(score) as best_score, MAX(wpm) as best_wpm, MAX(accuracy) as best_accuracy,
            COUNT(DISTINCT CONCAT(category, '-', level)) as levels_completed, COUNT(*) as play_count
            FROM practice_records WHERE student_id = ? AND mode LIKE 'adventure-%'`,
        classics: `SELECT 
            MAX(score) as best_speed, MAX(wpm) as best_wpm, MAX(accuracy) as best_accuracy,
            COUNT(*) as play_count, SUM(duration) as total_time
            FROM practice_records WHERE student_id = ? AND mode LIKE 'classics-%'`
    };
    
    const results = {};
    let completed = 0;
    
    ['interstellar', 'fruit', 'adventure', 'classics'].forEach(mode => {
        db.get(queries[mode], [studentId], (err, row) => {
            if (err) { callback(err); return; }
            results[mode] = row || { best_score: 0, best_wpm: 0, best_accuracy: 0, play_count: 0 };
            results[mode].best_score = results[mode].best_score || 0;
            results[mode].best_wpm = results[mode].best_wpm || 0;
            results[mode].best_accuracy = results[mode].best_accuracy || 0;
            completed++;
            if (completed === 4) {
                const interstellarScore = calculateItemScore(results.interstellar.best_score, results.interstellar.best_wpm, results.interstellar.best_accuracy);
                const fruitScore = calculateItemScore(results.fruit.best_score, results.fruit.best_wpm, results.fruit.best_accuracy);
                const adventureScore = calculateItemScore(results.adventure.best_score, results.adventure.best_wpm, results.adventure.best_accuracy);
                const classicsScore = calculateItemScore(results.classics.best_speed || results.classics.best_wpm, results.classics.best_wpm, results.classics.best_accuracy);
                const totalScore = calculateTotalScore(interstellarScore, fruitScore, adventureScore, classicsScore);
                
                db.get('SELECT * FROM practice_scores WHERE student_id = ?', [studentId], (err, existing) => {
                    if (err) { callback(err); return; }
                    
                    if (!existing) {
                        db.run('INSERT INTO practice_scores (student_id, interstellar_score, fruit_score, adventure_score, classics_score, total_score, interstellar_best_score, interstellar_best_wpm, interstellar_best_accuracy, interstellar_play_count, interstellar_total_time, fruit_best_score, fruit_best_wpm, fruit_best_accuracy, fruit_best_combo, fruit_play_count, fruit_total_time, adventure_best_score, adventure_best_wpm, adventure_best_accuracy, adventure_levels_completed, adventure_play_count, classics_best_speed, classics_best_wpm, classics_best_accuracy, classics_play_count, classics_total_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                            [studentId, interstellarScore, fruitScore, adventureScore, classicsScore, totalScore, results.interstellar.best_score, results.interstellar.best_wpm, results.interstellar.best_accuracy, results.interstellar.play_count || 0, results.interstellar.total_time || 0, results.fruit.best_score, results.fruit.best_wpm, results.fruit.best_accuracy, results.fruit.best_combo || 0, results.fruit.play_count || 0, results.fruit.total_time || 0, results.adventure.best_score, results.adventure.best_wpm, results.adventure.best_accuracy, results.adventure.levels_completed || 0, results.adventure.play_count || 0, results.classics.best_speed || results.classics.best_wpm, results.classics.best_wpm, results.classics.best_accuracy, results.classics.play_count || 0, results.classics.total_time || 0],
                            callback);
                    } else {
                        db.run(`UPDATE practice_scores SET
                            interstellar_score = ?, fruit_score = ?, adventure_score = ?, classics_score = ?, total_score = ?,
                            interstellar_best_score = ?, interstellar_best_wpm = ?, interstellar_best_accuracy = ?, interstellar_play_count = ?, interstellar_total_time = ?,
                            fruit_best_score = ?, fruit_best_wpm = ?, fruit_best_accuracy = ?, fruit_best_combo = ?, fruit_play_count = ?, fruit_total_time = ?,
                            adventure_best_score = ?, adventure_best_wpm = ?, adventure_best_accuracy = ?, adventure_levels_completed = ?, adventure_play_count = ?,
                            classics_best_speed = ?, classics_best_wpm = ?, classics_best_accuracy = ?, classics_play_count = ?, classics_total_time = ?,
                            updated_at = CURRENT_TIMESTAMP WHERE student_id = ?`,
                            [interstellarScore, fruitScore, adventureScore, classicsScore, totalScore,
                            results.interstellar.best_score, results.interstellar.best_wpm, results.interstellar.best_accuracy, results.interstellar.play_count || 0, results.interstellar.total_time || 0,
                            results.fruit.best_score, results.fruit.best_wpm, results.fruit.best_accuracy, results.fruit.best_combo || 0, results.fruit.play_count || 0, results.fruit.total_time || 0,
                            results.adventure.best_score, results.adventure.best_wpm, results.adventure.best_accuracy, results.adventure.levels_completed || 0, results.adventure.play_count || 0,
                            results.classics.best_speed || results.classics.best_wpm, results.classics.best_wpm, results.classics.best_accuracy, results.classics.play_count || 0, results.classics.total_time || 0,
                            studentId], callback);
                    }
                });
            }
        });
    });
}

// 保存练习记录 - 多维度版本
router.post('/submit', (req, res) => {
  const { 
    student_id, 
    mode, 
    score, 
    duration, 
    wpm,
    accuracy,
    total_chars,
    correct_chars,
    error_chars,
    combo,
    max_combo,
    level,
    difficulty,
    category,
    category_name,
    extra_data 
  } = req.body;

  const sql = `INSERT INTO practice_records (
    student_id, mode, score, duration, 
    wpm, accuracy, total_chars, correct_chars, error_chars,
    combo, max_combo, level, difficulty, category, category_name,
    extra_data
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  db.run(sql, [
    student_id, mode, score, duration,
    wpm || 0, accuracy || 0, total_chars || 0, correct_chars || 0, error_chars || 0,
    combo || 0, max_combo || 0, level || 0, difficulty || 0, category || null, category_name || null,
    JSON.stringify(extra_data || {})
  ], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    // 保存成功后自动更新积分
    updateStudentScoreRecord(student_id, (err) => {
      if (err) {
        console.error('更新积分失败:', err);
      }
    });
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

// 获取练习统计 - 增强版
router.get('/stats/:student_id', (req, res) => {
  const { student_id } = req.params;

  const sql = `SELECT
                mode,
                COUNT(*) as count,
                MAX(score) as max_score,
                AVG(score) as avg_score,
                SUM(duration) as total_duration,
                MAX(wpm) as max_wpm,
                AVG(wpm) as avg_wpm,
                MAX(accuracy) as max_accuracy,
                AVG(accuracy) as avg_accuracy,
                MAX(max_combo) as max_combo,
                SUM(total_chars) as total_chars,
                SUM(correct_chars) as correct_chars
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
  const { student_id, mode, grade, class_number, start_date, end_date } = req.query;

  let query = `
    SELECT p.*, s.name, s.class, s.student_no, s.grade, s.class_number, s.school
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
  if (start_date) {
    query += ' AND DATE(p.created_at) >= DATE(?)';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND DATE(p.created_at) <= DATE(?)';
    params.push(end_date);
  }

  query += ' ORDER BY p.created_at DESC LIMIT 1000';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ records: rows });
  });
});

// 获取练习统计（管理员）
router.get('/stats', (req, res) => {
  const { mode, grade, class_number } = req.query;

  let whereClause = '1=1';
  const params = [];

  if (mode) {
    whereClause += ' AND mode = ?';
    params.push(mode);
  }
  if (grade) {
    whereClause += ' AND student_id IN (SELECT id FROM students WHERE grade = ?)';
    params.push(grade);
  }
  if (class_number) {
    whereClause += ' AND student_id IN (SELECT id FROM students WHERE class_number = ?)';
    params.push(class_number);
  }

  const sql = `
    SELECT
      mode,
      COUNT(*) as total_count,
      COUNT(DISTINCT student_id) as student_count,
      AVG(score) as avg_score,
      AVG(wpm) as avg_wpm,
      AVG(accuracy) as avg_accuracy,
      MAX(score) as max_score,
      MAX(wpm) as max_wpm,
      MAX(accuracy) as max_accuracy,
      SUM(duration) as total_duration,
      AVG(duration) as avg_duration,
      SUM(total_chars) as total_chars,
      AVG(combo) as avg_combo,
      MAX(max_combo) as max_combo
    FROM practice_records
    WHERE ${whereClause}
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ stats: rows });
  });
});

// 获取排行榜 - 多维度
router.get('/ranking/:mode', (req, res) => {
  const { mode } = req.params;
  const { field = 'score', limit = 50, grade, class_number } = req.query;

  // 允许排序的字段
  const allowedFields = ['score', 'wpm', 'accuracy', 'max_combo', 'duration'];
  const orderField = allowedFields.includes(field) ? field : 'score';

  let whereClause = 'WHERE p.mode = ?';
  const params = [mode];

  if (grade) {
    whereClause += ' AND s.grade = ?';
    params.push(grade);
  }
  if (class_number) {
    whereClause += ' AND s.class_number = ?';
    params.push(class_number);
  }

  const sql = `
    SELECT 
      p.*,
      s.name,
      s.class,
      s.grade,
      s.school,
      ROW_NUMBER() OVER (ORDER BY p.${orderField} DESC) as rank
    FROM practice_records p
    JOIN students s ON p.student_id = s.id
    ${whereClause}
    ORDER BY p.${orderField} DESC
    LIMIT ?
  `;
  params.push(parseInt(limit));

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ ranking: rows });
  });
});

// 获取学生最佳记录
router.get('/best/:student_id', (req, res) => {
  const { student_id } = req.params;
  const { mode } = req.query;

  let whereClause = 'WHERE student_id = ?';
  const params = [student_id];

  if (mode) {
    whereClause += ' AND mode = ?';
    params.push(mode);
  }

  const sql = `
    SELECT 
      mode,
      MAX(score) as best_score,
      MAX(wpm) as best_wpm,
      MAX(accuracy) as best_accuracy,
      MAX(max_combo) as best_combo,
      COUNT(*) as play_count,
      AVG(score) as avg_score,
      AVG(wpm) as avg_wpm,
      AVG(accuracy) as avg_accuracy,
      SUM(duration) as total_time
    FROM practice_records
    ${whereClause}
    GROUP BY mode
  `;

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ best: rows });
  });
});

// 获取趋势数据
router.get('/trend/:student_id', (req, res) => {
  const { student_id } = req.params;
  const { mode, days = 30 } = req.query;

  const sql = `
    SELECT 
      DATE(created_at) as date,
      COUNT(*) as play_count,
      AVG(score) as avg_score,
      AVG(wpm) as avg_wpm,
      AVG(accuracy) as avg_accuracy,
      MAX(score) as max_score
    FROM practice_records
    WHERE student_id = ? 
      AND mode = ?
      AND created_at >= DATE('now', '-${days} days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  db.all(sql, [student_id, mode], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ trend: rows });
  });
});

module.exports = router;
