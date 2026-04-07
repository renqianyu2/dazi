const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { db } = require('../database');
const security = require('../utils/security');

function buildSchoolFilter(school) {
  if (school === '谷山小学部') {
    return { condition: ' AND s.school = ? AND s.grade >= ? AND s.grade <= ?', params: ['谷山学校', 1, 5] };
  }
  if (school === '谷山初中部') {
    return { condition: ' AND s.school = ? AND s.grade >= ?', params: ['谷山学校', 6] };
  }
  if (school) {
    return { condition: ' AND s.school = ?', params: [school] };
  }
  return { condition: '', params: [] };
}

// 管理员登录
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  db.get(
    'SELECT * FROM admins WHERE username = ? AND password = ?',
    [username, password],
    (err, admin) => {
      if (err) {
        return res.status(500).json({ error: '数据库错误' });
      }
      if (!admin) {
        return res.status(401).json({ error: '用户名或密码错误' });
      }
      res.json({ success: true, admin: { id: admin.id, username: admin.username } });
    }
  );
});

// 获取所有学生列表
router.get('/students', (req, res) => {
  const query = `
    SELECT s.*,
      COUNT(t.id) as test_count,
      AVG(t.speed) as avg_speed,
      AVG(t.accuracy) as avg_accuracy,
      MAX(t.speed) as max_speed
    FROM students s
    LEFT JOIN test_records t ON s.id = t.student_id AND t.is_valid = 1
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `;

  db.all(query, [], (err, students) => {
    if (err) {
      return res.status(500).json({ error: '数据库错误' });
    }
    res.json({ students });
  });
});

// 获取单个学生详情
router.get('/student/:id', (req, res) => {
  const studentId = req.params.id;

  db.get('SELECT * FROM students WHERE id = ?', [studentId], (err, student) => {
    if (err || !student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    db.all(
      'SELECT * FROM test_records WHERE student_id = ? ORDER BY created_at DESC',
      [studentId],
      (err, records) => {
        if (err) {
          return res.status(500).json({ error: '数据库错误' });
        }
        res.json({ student, records });
      }
    );
  });
});

// 删除学生
router.delete('/student/:id', (req, res) => {
  const studentId = req.params.id;

  db.run('DELETE FROM test_records WHERE student_id = ?', [studentId], (err) => {
    if (err) {
      return res.status(500).json({ error: '删除失败' });
    }

    db.run('DELETE FROM students WHERE id = ?', [studentId], (err) => {
      if (err) {
        return res.status(500).json({ error: '删除失败' });
      }
      res.json({ success: true });
    });
  });
});

// 更新学生信息
router.put('/student/:id', (req, res) => {
  const { id } = req.params;
  const { name, grade, class_number, teacher } = req.body;

  const gradeLabels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级'];
  const classText = `${gradeLabels[grade - 1]}${class_number}班`;

  // 如果传了教师字段则更新，否则不修改
  if (teacher !== undefined) {
    db.run(
      'UPDATE students SET name = ?, grade = ?, class_number = ?, class = ?, teacher = ? WHERE id = ?',
      [name, grade, class_number, classText, teacher || null, id],
      function(err) {
        if (err) return res.status(500).json({ error: '更新失败' });
        res.json({ success: true });
      }
    );
  } else {
    db.run(
      'UPDATE students SET name = ?, grade = ?, class_number = ?, class = ? WHERE id = ?',
      [name, grade, class_number, classText, id],
      function(err) {
        if (err) return res.status(500).json({ error: '更新失败' });
        res.json({ success: true });
      }
    );
  }
});

// 创建学生（管理员）
router.post('/student', async (req, res) => {
  const { name, school, grade, class_number, teacher } = req.body;

  if (!name || !school || !grade || !class_number) {
    return res.status(400).json({ error: '缺少必填字段' });
  }

  const gradeLabels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级'];
  const classText = `${gradeLabels[grade - 1]}${class_number}班`;

  // 获取学校缩写
  const schoolPrefix = school === '谷山学校' ? 'GS' : 'ZHL';

  // 查询该年级该班级当前最大序号
  db.get(
    `SELECT MAX(CAST(SUBSTR(student_no, -2) AS INTEGER)) as max_seq
     FROM students
     WHERE school = ? AND grade = ? AND class_number = ?`,
    [school, grade, class_number],
    (err, row) => {
      if (err) return res.status(500).json({ error: '查询失败' });

      const seq = String((row?.max_seq || 0) + 1).padStart(2, '0');
      const studentNo = `${schoolPrefix}${String(grade).padStart(2, '0')}${String(class_number).padStart(2, '0')}${seq}`;

      // 默认密码为 123456
      const password = bcrypt.hashSync('123456', 10);

      db.run(
        'INSERT INTO students (name, school, grade, class_number, class, student_no, password, teacher) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [name, school, grade, class_number, classText, studentNo, password, teacher || null],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE')) {
              return res.status(400).json({ error: '学生已存在' });
            }
            return res.status(500).json({ error: '创建失败' });
          }
          res.json({ success: true, studentId: this.lastID, studentNo });
        }
      );
    }
  );
});

// 获取文本库列表
router.get('/texts', (req, res) => {
  db.all('SELECT * FROM texts ORDER BY created_at DESC', [], (err, texts) => {
    if (err) {
      return res.status(500).json({ error: '数据库错误' });
    }
    res.json({ texts });
  });
});

// 添加文本
router.post('/text', (req, res) => {
  const { content, level, category } = req.body;

  db.run(
    'INSERT INTO texts (content, level, category) VALUES (?, ?, ?)',
    [content, level || 'level1', category || 'general'],
    function(err) {
      if (err) {
        return res.status(500).json({ error: '添加失败' });
      }
      res.json({ success: true, textId: this.lastID });
    }
  );
});

// 更新文本
router.put('/text/:id', (req, res) => {
  const { content, level, category } = req.body;
  const textId = req.params.id;

  db.run(
    'UPDATE texts SET content = ?, level = ?, category = ? WHERE id = ?',
    [content, level, category, textId],
    (err) => {
      if (err) {
        return res.status(500).json({ error: '更新失败' });
      }
      res.json({ success: true });
    }
  );
});

// 删除文本
router.delete('/text/:id', (req, res) => {
  const textId = req.params.id;

  db.run('DELETE FROM texts WHERE id = ?', [textId], (err) => {
    if (err) {
      return res.status(500).json({ error: '删除失败' });
    }
    res.json({ success: true });
  });
});

// 获取统计数据
router.get('/statistics', (req, res) => {
  const stats = {};

  db.get('SELECT COUNT(*) as count FROM students', [], (err, row) => {
    stats.totalStudents = row ? row.count : 0;

    db.get('SELECT COUNT(*) as count FROM test_records WHERE is_valid = 1', [], (err, row) => {
      stats.totalTests = row ? row.count : 0;

      db.get('SELECT AVG(speed) as avg FROM test_records WHERE is_valid = 1', [], (err, row) => {
        stats.avgSpeed = row && row.avg ? Math.round(row.avg) : 0;

        db.get('SELECT COUNT(*) as count FROM test_records WHERE is_valid = 1 AND speed >= 30 AND accuracy >= 85', [], (err, row) => {
          stats.passedTests = row ? row.count : 0;
          stats.passRate = stats.totalTests > 0 ? Math.round((stats.passedTests / stats.totalTests) * 100) : 0;

          res.json({ stats });
        });
      });
    });
  });
});

// 获取增强统计数据（管理员）
router.get('/dashboard-stats', (req, res) => {
  const queries = {
    totalStudents: 'SELECT COUNT(*) as value FROM students',
    totalTests: 'SELECT COUNT(*) as value FROM test_records WHERE is_valid = 1',
    avgSpeed: 'SELECT ROUND(AVG(speed)) as value FROM test_records WHERE is_valid = 1',
    passRate: `SELECT ROUND(COUNT(CASE WHEN speed >= 30 AND accuracy >= 85 THEN 1 END) * 100.0 / COUNT(*)) as value FROM test_records WHERE is_valid = 1`,
    todayActive: `SELECT COUNT(DISTINCT student_id) as value FROM test_records WHERE DATE(created_at) = DATE('now', 'localtime')`,
    weekActive: `SELECT COUNT(DISTINCT student_id) as value FROM test_records WHERE DATE(created_at) >= DATE('now', '-7 days', 'localtime')`,
    totalPractice: 'SELECT COUNT(*) as value FROM practice_records',
    recentTests: `SELECT t.*, s.name, s.class FROM test_records t JOIN students s ON t.student_id = s.id WHERE t.is_valid = 1 ORDER BY t.created_at DESC LIMIT 10`,
    gradeStats: `SELECT s.grade, COUNT(DISTINCT s.id) as student_count, ROUND(AVG(t.speed)) as avg_speed, ROUND(AVG(t.accuracy)) as avg_accuracy FROM students s LEFT JOIN test_records t ON s.id = t.student_id AND t.is_valid = 1 GROUP BY s.grade ORDER BY s.grade`,
    speedTrend: `SELECT DATE(created_at) as date, ROUND(AVG(speed)) as avg_speed FROM test_records WHERE is_valid = 1 AND DATE(created_at) >= DATE('now', '-7 days', 'localtime') GROUP BY DATE(created_at) ORDER BY date`
  };

  const results = {};
  let completed = 0;
  const total = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    if (key === 'recentTests' || key === 'gradeStats' || key === 'speedTrend') {
      db.all(query, [], (err, rows) => {
        results[key] = rows || [];
        if (++completed === total) res.json(results);
      });
    } else {
      db.get(query, [], (err, row) => {
        results[key] = row ? row.value || 0 : 0;
        if (++completed === total) res.json(results);
      });
    }
  });
});

// 获取学生整体统计
router.get('/student-stats', (req, res) => {
  const queries = {
    // 总数
    totalStudents: 'SELECT COUNT(*) as value FROM students',
    // 各学校数量
    schoolStats: 'SELECT school, COUNT(*) as count FROM students GROUP BY school',
    // 各年级数量
    gradeStats: 'SELECT grade, COUNT(*) as count FROM students GROUP BY grade',
    // 各班级数量
    classStats: 'SELECT school, grade, class_number, COUNT(*) as count FROM students GROUP BY school, grade, class_number',
    // 今日签到
    todayCheckin: 'SELECT COUNT(DISTINCT student_id) as value FROM login_logs WHERE date = date(\'now\', \'localtime\')',
    // 本周签到
    weekCheckin: 'SELECT COUNT(DISTINCT student_id) as value FROM login_logs WHERE date >= date(\'now\', \'-7 days\', \'localtime\')',
    // 本月签到
    monthCheckin: 'SELECT COUNT(DISTINCT student_id) as value FROM login_logs WHERE date >= date(\'now\', \'-30 days\', \'localtime\')',
    // 各年级签到情况
    gradeCheckin: `SELECT s.grade, COUNT(DISTINCT l.student_id) as checked_count 
      FROM login_logs l JOIN students s ON l.student_id = s.id 
      WHERE l.date >= date('now', '-7 days', 'localtime') 
      GROUP BY s.grade`,
    // 各学校签到情况
    schoolCheckin: `SELECT s.school, COUNT(DISTINCT l.student_id) as checked_count 
      FROM login_logs l JOIN students s ON l.student_id = s.id 
      WHERE l.date >= date('now', '-7 days', 'localtime') 
      GROUP BY s.school`,
    // 测试统计
    testStats: 'SELECT COUNT(DISTINCT student_id) as tested_students, AVG(speed) as avg_speed FROM test_records WHERE is_valid = 1',
    // 本月每日签到趋势
    monthStats: `SELECT date, COUNT(*) as count FROM login_logs WHERE date >= date('now', '-30 days', 'localtime') GROUP BY date ORDER BY date`
  };

  const results = {};
  let completed = 0;
  const keys = Object.keys(queries);
  const total = keys.length;

  keys.forEach(key => {
    if (['schoolStats', 'gradeStats', 'classStats', 'gradeCheckin', 'schoolCheckin', 'monthStats'].includes(key)) {
      db.all(queries[key], [], (err, rows) => {
        results[key] = rows || [];
        if (++completed === total) res.json(results);
      });
    } else {
      db.get(queries[key], [], (err, row) => {
        results[key] = row ? (row.value !== undefined ? row.value : row) : 0;
        if (++completed === total) res.json(results);
      });
    }
  });
});

// 获取签到详细列表
router.get('/checkin-list', (req, res) => {
  const { date, school, grade, class_number, status } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  const schoolFilter = buildSchoolFilter(school);
  let filterConditions = [];
  let filterParams = [];

  if (schoolFilter.condition) {
    filterConditions.push(schoolFilter.condition.trim().replace(/^AND\s+/, ''));
    filterParams.push(...schoolFilter.params);
  }
  if (grade) {
    filterConditions.push('s.grade = ?');
    filterParams.push(grade);
  }
  if (class_number) {
    filterConditions.push('s.class_number = ?');
    filterParams.push(class_number);
  }

  const where = filterConditions.length ? filterConditions.join(' AND ') : '1 = 1';

  if (status === 'unchecked') {
    db.all(`
      SELECT s.id, s.name, s.school, s.grade, s.class_number, s.student_no, NULL as login_time
      FROM students s
      WHERE ${where}
        AND s.id NOT IN (
          SELECT student_id FROM login_logs WHERE date = ?
        )
      ORDER BY s.grade, s.class_number, s.name
    `, [...filterParams, targetDate], (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json({ date: targetDate, checkins: rows || [] });
    });
    return;
  }

  const joinType = status === 'checked' ? 'JOIN' : 'LEFT JOIN';

  db.all(`
    SELECT s.id, s.name, s.school, s.grade, s.class_number, s.student_no, l.login_time
    FROM students s
    ${joinType} (
      SELECT student_id, MAX(login_time) as login_time
      FROM login_logs
      WHERE date = ?
      GROUP BY student_id
    ) l ON l.student_id = s.id
    WHERE ${where}
    ORDER BY l.login_time DESC, s.grade, s.class_number, s.name
  `, [targetDate, ...filterParams], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json({ date: targetDate, checkins: rows || [] });
  });
});

// 获取签到统计
router.get('/checkin-stats', (req, res) => {
  const { date, school, grade, class_number } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  const schoolFilter = buildSchoolFilter(school);
  let studentFilterCondition = schoolFilter.condition;
  const studentFilterParams = [...schoolFilter.params];

  if (grade) {
    studentFilterCondition += ' AND s.grade = ?';
    studentFilterParams.push(grade);
  }
  if (class_number) {
    studentFilterCondition += ' AND s.class_number = ?';
    studentFilterParams.push(class_number);
  }

  const totalStudentsQuery = `
    SELECT COUNT(*) as total_students
    FROM students s
    WHERE 1 = 1 ${studentFilterCondition}
  `;

  const todayCheckinQuery = `
    SELECT COUNT(DISTINCT l.student_id) as today_checkin
    FROM login_logs l
    JOIN students s ON l.student_id = s.id
    WHERE l.date = ? ${studentFilterCondition}
  `;

  const uncheckedQuery = `
    SELECT COUNT(*) as unchecked_students
    FROM students s
    WHERE 1 = 1 ${studentFilterCondition}
      AND s.id NOT IN (
        SELECT DISTINCT l.student_id
        FROM login_logs l
        WHERE l.date = ?
      )
  `;

  const unpracticedQuery = `
    SELECT COUNT(*) as unpracticed_students
    FROM students s
    WHERE 1 = 1 ${studentFilterCondition}
      AND s.id NOT IN (
        SELECT DISTINCT p.student_id
        FROM practice_records p
      )
  `;

  db.get(totalStudentsQuery, studentFilterParams, (err, totalRow) => {
    if (err) return res.status(500).json({ error: '查询失败' });

    db.get(todayCheckinQuery, studentFilterParams, (err, todayRow) => {
      if (err) return res.status(500).json({ error: '查询失败' });

      db.get(uncheckedQuery, studentFilterParams, (err, uncheckedRow) => {
        if (err) return res.status(500).json({ error: '查询失败' });

        db.get(unpracticedQuery, studentFilterParams, (err, unpracticedRow) => {
          if (err) return res.status(500).json({ error: '查询失败' });

          res.json({
            totalStudents: totalRow?.total_students || 0,
            todayCheckin: todayRow?.today_checkin || 0,
            uncheckedStudents: uncheckedRow?.unchecked_students || 0,
            unpracticedStudents: unpracticedRow?.unpracticed_students || 0
          });
        });
      });
    });
  });
});

// ==================== 安全相关 API ====================

// 生成新的课堂注册码（管理员）
router.post('/generate-reg-code', async (req, res) => {
  try {
    const result = await security.generateRegistrationCode();
    if (result) {
      res.json({
        success: true,
        code: result.code,
        expiresAt: result.expiresAt,
        expireMinutes: security.CONFIG.REG_CODE_EXPIRE_MINUTES
      });
    } else {
      res.status(500).json({ error: '生成注册码失败' });
    }
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取当前注册码状态（管理员）
router.get('/reg-code-status', (req, res) => {
  db.get(
    `SELECT config_value, expires_at, updated_at FROM system_configs WHERE config_key = ?`,
    [security.CONFIG.CURRENT_REG_CODE_KEY],
    (err, row) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      
      if (!row) {
        return res.json({ 
          hasCode: false, 
          message: '暂无注册码，请生成新的注册码' 
        });
      }

      const now = new Date();
      const expiresAt = new Date(row.expires_at);
      const isExpired = now > expiresAt;

      res.json({
        hasCode: !isExpired,
        code: row.config_value,
        expiresAt: row.expires_at,
        updatedAt: row.updated_at,
        isExpired,
        expireMinutes: security.CONFIG.REG_CODE_EXPIRE_MINUTES
      });
    }
  );
});

// 获取操作日志（管理员）
router.get('/action-logs', (req, res) => {
  const { device_id, action_type, limit = 50 } = req.query;
  
  let query = 'SELECT * FROM action_logs WHERE 1 = 1';
  const params = [];

  if (device_id) {
    query += ' AND device_id = ?';
    params.push(device_id);
  }
  if (action_type) {
    query += ' AND action_type = ?';
    params.push(action_type);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));

  db.all(query, params, (err, logs) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json({ logs: logs || [] });
  });
});

// 手动解除设备锁定（管理员）
router.post('/unlock-device', (req, res) => {
  const { student_id } = req.body;
  
  if (!student_id) {
    return res.status(400).json({ error: '缺少学生ID' });
  }

  db.run(
    'UPDATE students SET device_id = NULL, last_action_time = NULL WHERE id = ?',
    [student_id],
    function(err) {
      if (err) return res.status(500).json({ error: '解锁失败' });
      res.json({ success: true, message: '设备已解锁' });
    }
  );
});

// 重置学生密码（管理员）
router.post('/reset-password/:id', (req, res) => {
  const studentId = req.params.id;
  
  // 默认密码为 123456
  const defaultPassword = '123456';
  const hashedPassword = bcrypt.hashSync(defaultPassword, 10);

  db.run(
    'UPDATE students SET password = ? WHERE id = ?',
    [hashedPassword, studentId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: '重置密码失败' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: '学生不存在' });
      }
      res.json({ success: true, message: '密码已重置为默认密码：123456' });
    }
  );
});

// 强制学生登出（管理员）
router.post('/student/:id/logout', (req, res) => {
  const studentId = req.params.id;

  db.run(
    'UPDATE students SET session_token = NULL, login_ip = NULL, login_time = NULL WHERE id = ?',
    [studentId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: '强制登出失败' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: '学生不存在' });
      }
      res.json({ success: true, message: '强制登出成功' });
    }
  );
});

module.exports = router;
