const express = require('express');
const router = express.Router();
const { db } = require('../database');

// 需要屏蔽的账号名称前缀（测试账号）
// 屏蔽任芊x、任千x、大黄、以及任何包含"测试账户"的账号
const BLOCKED_NAME_PREFIXES = ['任', '大黄', '测试账户'];

// ======== 缓存机制 ========
// 排行榜数据缓存（每个排行榜API缓存5秒）
const rankingCache = {
  data: {},
  timestamps: {},
  TTL: 5000, // 5秒缓存

  // 获取缓存
  get(key) {
    if (this.data[key] && (Date.now() - this.timestamps[key]) < this.TTL) {
      return this.data[key];
    }
    return null;
  },

  // 设置缓存
  set(key, value) {
    this.data[key] = value;
    this.timestamps[key] = Date.now();
  },

  // 清除指定key缓存
  invalidate(key) {
    delete this.data[key];
    delete this.timestamps[key];
  },

  // 清除所有缓存
  clearAll() {
    this.data = {};
    this.timestamps = {};
  }
};

function getBlockedConditionSimple() {
  const conditions = BLOCKED_NAME_PREFIXES.map(prefix => 
    `name NOT LIKE '${prefix}%'`
  ).join(' AND ');
  return conditions + ' AND exclude_ranking = 0';
}

function getBlockedCondition() {
  const conditions = BLOCKED_NAME_PREFIXES.map(prefix => 
    `s.name NOT LIKE '${prefix}%'`
  ).join(' AND ');
  return conditions + ' AND s.exclude_ranking = 0';
}

// 生成筛选条件 SQL
function getFilterConditions(req) {
  const conditions = [];
  const { school, grade, class_number } = req.query;
  
  if (school && school !== 'all') {
    conditions.push(`s.school = '${school.replace(/'/g, "''")}'`);
  }
  if (grade && grade !== 'all' && grade !== '') {
    conditions.push(`s.grade = ${parseInt(grade)}`);
  }
  if (class_number && class_number !== 'all' && class_number !== '') {
    conditions.push(`s.class_number = ${parseInt(class_number)}`);
  }
  
  return conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
}

// 获取筛选选项列表（学校、年级、班级）- 优化：并行查询
router.get('/filter-options', (req, res) => {
  const blockedCond = getBlockedConditionSimple();
  
  // 并行查询三个数据
  const schoolSql = `SELECT DISTINCT school FROM students WHERE ${blockedCond} ORDER BY school`;
  const gradeSql = `SELECT DISTINCT grade FROM students WHERE ${blockedCond} ORDER BY grade`;
  const classSql = `SELECT DISTINCT grade, class_number, class FROM students WHERE ${blockedCond} ORDER BY grade, class_number`;
  
  db.all(schoolSql, [], (err, schools) => {
    if (err) return res.status(500).json({ error: '获取学校列表失败: ' + err.message });
    
    db.all(gradeSql, [], (err, grades) => {
      if (err) return res.status(500).json({ error: '获取年级列表失败: ' + err.message });
      
      db.all(classSql, [], (err, classes) => {
        if (err) return res.status(500).json({ error: '获取班级列表失败: ' + err.message });
        
        res.json({
          schools: schools.map(s => s.school),
          grades: grades.map(g => g.grade),
          classes: classes.map(c => ({
            grade: c.grade,
            class_number: c.class_number,
            class: c.class
          }))
        });
      });
    });
  });
});

router.get('/school', (req, res) => {
  const { limit = 10, orderBy = 'speed' } = req.query;
  
  let orderClause = 'avg_speed DESC';
  if (orderBy === 'accuracy') orderClause = 'avg_accuracy DESC';
  if (orderBy === 'comprehensive') orderClause = '(avg_speed * 0.6 + avg_accuracy * 0.4) DESC';

  const blockedCond = getBlockedCondition();
  const sql = `
    SELECT s.id, s.name, s.class, s.student_no, s.grade, s.class_number,
           COUNT(t.id) as test_count,
           ROUND(AVG(t.speed)) as avg_speed,
           ROUND(AVG(t.accuracy)) as avg_accuracy,
           ROUND(AVG(t.speed) * 0.6 + AVG(t.accuracy) * 0.4) as comprehensive_score
    FROM students s
    LEFT JOIN test_records t ON s.id = t.student_id AND t.is_valid = 1
    WHERE ${blockedCond}
    GROUP BY s.id
    HAVING test_count >= 3
    ORDER BY ${orderClause}
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ ranking: rows });
  });
});

// 获取各班级排行榜
router.get('/classes', (req, res) => {
  const { limit = 3 } = req.query;

  const sql = `
    SELECT grade, class_number, class, 
           json_group_array(
             json_object(
               'id', id, 'name', name, 'student_no', student_no,
               'avg_speed', avg_speed, 'avg_accuracy', avg_accuracy,
               'comprehensive_score', comprehensive_score, 'rank', rank
             )
           ) as students
    FROM (
      SELECT s.id, s.name, s.student_no, s.grade, s.class_number, s.class,
             ROUND(AVG(t.speed)) as avg_speed,
             ROUND(AVG(t.accuracy)) as avg_accuracy,
             ROUND(AVG(t.speed) * 0.6 + AVG(t.accuracy) * 0.4) as comprehensive_score,
             ROW_NUMBER() OVER (PARTITION BY s.grade, s.class_number ORDER BY AVG(t.speed) * 0.6 + AVG(t.accuracy) * 0.4 DESC) as rank
      FROM students s
      LEFT JOIN test_records t ON s.id = t.student_id AND t.is_valid = 1
      WHERE s.exclude_ranking = 0
      GROUP BY s.id
      HAVING COUNT(t.id) >= 3
    )
    WHERE rank <= ?
    GROUP BY grade, class_number
    ORDER BY grade, class_number
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    
    const result = rows.map(r => ({
      grade: r.grade,
      class_number: r.class_number,
      class: r.class,
      students: JSON.parse(r.students)
    }));
    
    res.json({ classes: result });
  });
});

// ============ 星际字航员排行榜 API ============

// 1. 最高分数王 - 单局最高分（优化：使用JOIN替代子查询）
router.get('/interstellar-typist/highest-score', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  // 使用子查询获取每个学生的最高分，再JOIN获取学生信息
  const sql = `
    SELECT 
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      p.score,
      p.created_at
    FROM students s
    JOIN practice_records p ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND ${blockedCond}
      ${filterCond}
      AND p.score = (
        SELECT MAX(p2.score) 
        FROM practice_records p2 
        WHERE p2.student_id = s.id 
          AND p2.mode = 'interstellar-typist'
      )
    ORDER BY p.score DESC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误: ' + err.message });
    res.json({ ranking: rows });
  });
});

// 2. 速度之星 - 单局最高WPM（优化：每个学生只取最高WPM）
router.get('/interstellar-typist/fastest-speed', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  const sql = `
    SELECT 
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      p.score,
      p.created_at,
      CAST(JSON_EXTRACT(p.extra_data, '$.wpm') AS INTEGER) as wpm
    FROM students s
    JOIN practice_records p ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND JSON_EXTRACT(p.extra_data, '$.wpm') IS NOT NULL
      AND ${blockedCond}
      ${filterCond}
      AND CAST(JSON_EXTRACT(p.extra_data, '$.wpm') AS INTEGER) = (
        SELECT MAX(CAST(JSON_EXTRACT(p2.extra_data, '$.wpm') AS INTEGER))
        FROM practice_records p2
        WHERE p2.student_id = s.id
          AND p2.mode = 'interstellar-typist'
          AND JSON_EXTRACT(p2.extra_data, '$.wpm') IS NOT NULL
      )
    ORDER BY wpm DESC, p.created_at DESC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误: ' + err.message });
    res.json({ ranking: rows });
  });
});

// 3. 精准射手 - 个人累计平均准确率最高（至少5局，每局≥5分钟）
router.get('/interstellar-typist/best-accuracy', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  const sql = `
    SELECT
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      ROUND(AVG(CAST(REPLACE(JSON_EXTRACT(p.extra_data, '$.accuracy'), '%', '') AS REAL))) as accuracy,
      COUNT(*) as game_count
    FROM practice_records p
    JOIN students s ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND p.duration >= 300
      AND JSON_EXTRACT(p.extra_data, '$.accuracy') IS NOT NULL
      AND REPLACE(JSON_EXTRACT(p.extra_data, '$.accuracy'), '%', '') != ''
      AND CAST(REPLACE(JSON_EXTRACT(p.extra_data, '$.accuracy'), '%', '') AS REAL) >= 0
      AND ${blockedCond}
      ${filterCond}
    GROUP BY s.id
    HAVING game_count >= 5
    ORDER BY accuracy DESC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误: ' + err.message });
    res.json({ ranking: rows });
  });
});

// 4. 连击大师 - 单局最大连击数（优化：每个学生只取最高连击）
router.get('/interstellar-typist/max-combo', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  const sql = `
    SELECT 
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      p.score,
      p.created_at,
      CAST(JSON_EXTRACT(p.extra_data, '$.maxCombo') AS INTEGER) as max_combo
    FROM students s
    JOIN practice_records p ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND JSON_EXTRACT(p.extra_data, '$.maxCombo') IS NOT NULL
      AND ${blockedCond}
      ${filterCond}
      AND CAST(JSON_EXTRACT(p.extra_data, '$.maxCombo') AS INTEGER) = (
        SELECT MAX(CAST(JSON_EXTRACT(p2.extra_data, '$.maxCombo') AS INTEGER))
        FROM practice_records p2
        WHERE p2.student_id = s.id
          AND p2.mode = 'interstellar-typist'
          AND JSON_EXTRACT(p2.extra_data, '$.maxCombo') IS NOT NULL
      )
    ORDER BY max_combo DESC, p.created_at DESC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误: ' + err.message });
    res.json({ ranking: rows });
  });
});

// 5. 成语收藏家 - 用户累计获得的成语总数（去重）
router.get('/interstellar-typist/most-idioms', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  // 获取所有符合条件的练习记录，统计每个用户的成语总数
  const sql = `
    SELECT
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      p.extra_data
    FROM practice_records p
    JOIN students s ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND JSON_EXTRACT(p.extra_data, '$.idioms') IS NOT NULL
      AND ${blockedCond}
      ${filterCond}
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误: ' + err.message });
    
    // 统计每个用户的成语总数（去重）
    const studentIdioms = {};
    
    rows.forEach(row => {
      try {
        const extra = typeof row.extra_data === 'string' ? JSON.parse(row.extra_data) : row.extra_data;
        if (extra && extra.idioms && Array.isArray(extra.idioms)) {
          if (!studentIdioms[row.student_id]) {
            studentIdioms[row.student_id] = {
              student_id: row.student_id,
              name: row.name,
              school: row.school,
              grade: row.grade,
              class: row.class,
              idioms: new Set()
            };
          }
          extra.idioms.forEach(idiom => {
            // 成语可能是对象 {word, meaning} 或字符串
            if (typeof idiom === 'object' && idiom.word) {
              studentIdioms[row.student_id].idioms.add(idiom.word);
            } else if (typeof idiom === 'string') {
              studentIdioms[row.student_id].idioms.add(idiom);
            }
          });
        }
      } catch(e) {
        // 忽略解析错误
      }
    });
    
    // 转换为排行数组
    const ranking = Object.values(studentIdioms)
      .map(item => ({
        student_id: item.student_id,
        name: item.name,
        school: item.school,
        grade: item.grade,
        class: item.class,
        idiom_count: item.idioms.size
      }))
      .filter(item => item.idiom_count > 0)
      .sort((a, b) => b.idiom_count - a.idiom_count)
      .slice(0, parseInt(limit));
    
    res.json({ ranking });
  });
});

// 6. 马拉松选手 - 单局最长游戏时长（优化：每个学生只取最长时长）
router.get('/interstellar-typist/longest-duration', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  const sql = `
    SELECT 
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      p.score,
      p.created_at,
      p.duration
    FROM students s
    JOIN practice_records p ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND ${blockedCond}
      ${filterCond}
      AND p.duration = (
        SELECT MAX(p2.duration)
        FROM practice_records p2
        WHERE p2.student_id = s.id
          AND p2.mode = 'interstellar-typist'
      )
    ORDER BY p.duration DESC, p.created_at DESC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误: ' + err.message });
    res.json({ ranking: rows });
  });
});

// ============ 累计成就排行榜 ============

// 7. 总分霸主 - 累计总分
router.get('/interstellar-typist/total-score', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  const sql = `
    SELECT
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      SUM(p.score) as total_score,
      COUNT(*) as game_count,
      MAX(p.score) as max_score
    FROM practice_records p
    JOIN students s ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND ${blockedCond}
      ${filterCond}
    GROUP BY s.id
    ORDER BY total_score DESC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ ranking: rows });
  });
});

// 8. 勤奋之星 - 总游戏时长
router.get('/interstellar-typist/total-duration', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  const sql = `
    SELECT
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      SUM(p.duration) as total_duration,
      COUNT(*) as game_count,
      ROUND(AVG(p.duration)) as avg_duration
    FROM practice_records p
    JOIN students s ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND ${blockedCond}
      ${filterCond}
    GROUP BY s.id
    ORDER BY total_duration DESC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ ranking: rows });
  });
});

// 9. 游戏达人 - 游戏局数
router.get('/interstellar-typist/most-games', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  const sql = `
    SELECT
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      COUNT(*) as game_count,
      SUM(p.duration) as total_duration,
      ROUND(AVG(p.score)) as avg_score
    FROM practice_records p
    JOIN students s ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND ${blockedCond}
      ${filterCond}
    GROUP BY s.id
    ORDER BY game_count DESC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ ranking: rows });
  });
});

// 10. 平均分王者 - 平均得分（至少3局）
router.get('/interstellar-typist/avg-score', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  const sql = `
    SELECT
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      ROUND(AVG(p.score)) as avg_score,
      COUNT(*) as game_count,
      MAX(p.score) as max_score
    FROM practice_records p
    JOIN students s ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND ${blockedCond}
      ${filterCond}
    GROUP BY s.id
    HAVING game_count >= 3
    ORDER BY avg_score DESC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ ranking: rows });
  });
});

// 11. 方差稳如泰山 - 得分方差最小（至少3局）
router.get('/interstellar-typist/lowest-variance', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  // 方差 = Σ(xi - x̄)² / n
  // 需要计算每个学生的得分方差，按方差升序（越小越稳定）
  const sql = `
    SELECT
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      AVG(p.score) as avg_score,
      COUNT(*) as game_count,
      -- 方差计算：(每局得分 - 平均分)² 的平均
      SUM((p.score - (SELECT AVG(score) FROM practice_records p2 WHERE p2.student_id = p.student_id AND p2.mode = 'interstellar-typist')) * 
           (p.score - (SELECT AVG(score) FROM practice_records p2 WHERE p2.student_id = p.student_id AND p2.mode = 'interstellar-typist'))) / COUNT(*) as variance
    FROM practice_records p
    JOIN students s ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND ${blockedCond}
      ${filterCond}
    GROUP BY s.id
    HAVING game_count >= 3
    ORDER BY variance ASC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误: ' + err.message });
    // 保留两位小数
    rows.forEach(row => {
      row.variance = Math.round(row.variance * 100) / 100;
    });
    res.json({ ranking: rows });
  });
});

// 11.5 中位数之巅 - 成绩中位数最高（至少10局）
router.get('/interstellar-typist/median-score', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  const sql = `
    SELECT
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      p.score
    FROM practice_records p
    JOIN students s ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND ${blockedCond}
      ${filterCond}
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误: ' + err.message });
    
    // 按学生分组，收集所有成绩
    const studentScores = {};
    rows.forEach(row => {
      if (!studentScores[row.student_id]) {
        studentScores[row.student_id] = {
          student_id: row.student_id,
          name: row.name,
          school: row.school,
          grade: row.grade,
          class: row.class,
          scores: []
        };
      }
      studentScores[row.student_id].scores.push(row.score);
    });
    
    // 计算每个学生的中位数，只保留10局以上的
    const ranking = Object.values(studentScores)
      .filter(item => item.scores.length >= 10)
      .map(item => {
        // 排序后计算中位数
        const sorted = item.scores.sort((a, b) => a - b);
        const len = sorted.length;
        const median = len % 2 === 0
          ? (sorted[len/2 - 1] + sorted[len/2]) / 2
          : sorted[Math.floor(len/2)];
        return {
          student_id: item.student_id,
          name: item.name,
          school: item.school,
          grade: item.grade,
          class: item.class,
          median: Math.round(median),
          game_count: len
        };
      })
      .sort((a, b) => b.median - a.median)
      .slice(0, parseInt(limit));
    
    res.json({ ranking });
  });
});

// ============ 特殊条件排行榜 ============

// 12. 乱按键盘的文盲 - 正确率平均最低（至少3局）
router.get('/interstellar-typist/lowest-accuracy', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  const sql = `
    SELECT
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      ROUND(AVG(CAST(REPLACE(JSON_EXTRACT(p.extra_data, '$.accuracy'), '%', '') AS INTEGER))) as avg_accuracy,
      COUNT(*) as game_count,
      MIN(CAST(REPLACE(JSON_EXTRACT(p.extra_data, '$.accuracy'), '%', '') AS INTEGER)) as min_accuracy
    FROM practice_records p
    JOIN students s ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND JSON_EXTRACT(p.extra_data, '$.accuracy') IS NOT NULL
      AND REPLACE(JSON_EXTRACT(p.extra_data, '$.accuracy'), '%', '') != ''
      AND CAST(REPLACE(JSON_EXTRACT(p.extra_data, '$.accuracy'), '%', '') AS INTEGER) > 0
      AND ${blockedCond}
      ${filterCond}
    GROUP BY s.id
    HAVING game_count >= 3
    ORDER BY avg_accuracy ASC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误: ' + err.message });
    res.json({ ranking: rows });
  });
});

// 13. 效率专家 - 单位时间得分（优化：每个学生只取最高效率）
router.get('/interstellar-typist/best-efficiency', (req, res) => {
  const { limit = 100, school, grade, class_number } = req.query;
  const filterCond = getFilterConditions(req);
  const blockedCond = getBlockedCondition();

  const sql = `
    SELECT 
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      p.created_at,
      ROUND(CAST(p.score AS FLOAT) / p.duration, 2) as efficiency
    FROM students s
    JOIN practice_records p ON p.student_id = s.id
    WHERE p.mode = 'interstellar-typist'
      AND p.duration > 0
      AND ${blockedCond}
      ${filterCond}
      AND ROUND(CAST(p.score AS FLOAT) / p.duration, 2) = (
        SELECT MAX(ROUND(CAST(p2.score AS FLOAT) / p2.duration, 2))
        FROM practice_records p2
        WHERE p2.student_id = s.id
          AND p2.mode = 'interstellar-typist'
          AND p2.duration > 0
      )
    ORDER BY efficiency DESC, p.created_at DESC
    LIMIT ?
  `;

  db.all(sql, [parseInt(limit)], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误: ' + err.message });
    res.json({ ranking: rows });
  });
});

// ============ 手动标记优秀学生 API ============

// 获取学校下的所有班级及学生数据（用于弹窗展示）
router.get('/school-students', (req, res) => {
  const { school } = req.query;
  if (!school) return res.status(400).json({ error: '缺少学校参数' });

  const blockedCond = getBlockedCondition();

  // 获取该学校所有班级的学生及其累计数据
  const sql = `
    SELECT 
      s.id as student_id,
      s.name,
      s.school,
      s.grade,
      s.class,
      COALESCE(SUM(p.score), 0) as total_score,
      COUNT(p.id) as game_count,
      COALESCE(AVG(p.duration), 0) as avg_duration
    FROM students s
    LEFT JOIN practice_records p ON p.student_id = s.id AND p.mode = 'interstellar-typist'
    WHERE s.school = ? AND ${blockedCond}
    GROUP BY s.id
    ORDER BY s.grade, s.class_number, total_score DESC
  `;

  db.all(sql, [school], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误: ' + err.message });

    // 按班级分组
    const classData = {};
    rows.forEach(student => {
      const className = student.class;
      if (!classData[className]) {
        classData[className] = [];
      }
      classData[className].push(student);
    });

    res.json(classData);
  });
});

// 添加学生到手动标记列表
router.post('/manual-excellent', (req, res) => {
  const { student_id, name, class: className, school, grade, score, ranking_name, reason } = req.body;
  
  if (!student_id || !name) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  // 检查是否已存在
  const checkSql = `SELECT id FROM manual_excellent_students WHERE student_id = ?`;
  db.get(checkSql, [student_id], (err, existing) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    
    if (existing) {
      // 更新已有记录
      const updateSql = `
        UPDATE manual_excellent_students 
        SET score = ?, ranking_name = ?, reason = ?, added_at = CURRENT_TIMESTAMP
        WHERE student_id = ?
      `;
      db.run(updateSql, [score, ranking_name, reason, student_id], (err) => {
        if (err) return res.status(500).json({ error: '更新失败' });
        res.json({ success: true });
      });
    } else {
      // 插入新记录
      const insertSql = `
        INSERT INTO manual_excellent_students (student_id, name, class, school, grade, score, ranking_name, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      db.run(insertSql, [student_id, name, className, school, grade, score, ranking_name, reason], (err) => {
        if (err) return res.status(500).json({ error: '添加失败' });
        res.json({ success: true });
      });
    }
  });
});

// 获取手动标记的学生列表
router.get('/manual-excellent-list', (req, res) => {
  const sql = `SELECT * FROM manual_excellent_students ORDER BY added_at DESC`;
  
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ list: rows });
  });
});

// 删除手动标记的学生
router.delete('/manual-excellent/:id', (req, res) => {
  const { id } = req.params;
  
  db.run(`DELETE FROM manual_excellent_students WHERE id = ?`, [id], (err) => {
    if (err) return res.status(500).json({ error: '删除失败' });
    res.json({ success: true });
  });
});

module.exports = router;
