const express = require('express');
const router = express.Router();
const { db } = require('../database');
const bcrypt = require('bcrypt');

// 学生登录
router.post('/login', (req, res) => {
  const { name, school, class: studentClass, student_no } = req.body;

  db.get(
    'SELECT * FROM students WHERE student_no = ?',
    [student_no],
    (err, student) => {
      if (err) {
        return res.status(500).json({ error: '数据库错误' });
      }

      if (student) {
        return res.json({ success: true, student });
      }

      // 新学生，插入数据库
      db.run(
        'INSERT INTO students (name, school, class, student_no) VALUES (?, ?, ?, ?)',
        [name, school, studentClass, student_no],
        function(err) {
          if (err) {
            return res.status(500).json({ error: '注册失败' });
          }
          res.json({
            success: true,
            student: { id: this.lastID, name, school, class: studentClass, student_no }
          });
        }
      );
    }
  );
});

// 获取学生个人信息和统计
router.get('/profile/:id', (req, res) => {
  const studentId = req.params.id;

  db.get('SELECT * FROM students WHERE id = ?', [studentId], (err, student) => {
    if (err || !student) {
      return res.status(404).json({ error: '学生不存在' });
    }

    db.all(
      'SELECT * FROM test_records WHERE student_id = ? AND is_valid = 1 ORDER BY created_at DESC',
      [studentId],
      (err, records) => {
        if (err) {
          return res.status(500).json({ error: '数据库错误' });
        }

        const stats = {
          avgSpeed: 0,
          maxSpeed: 0,
          avgAccuracy: 0,
          testCount: records.length
        };

        if (records.length > 0) {
          stats.avgSpeed = Math.round(
            records.reduce((sum, r) => sum + r.speed, 0) / records.length
          );
          stats.maxSpeed = Math.max(...records.map(r => r.speed));
          stats.avgAccuracy = Math.round(
            records.reduce((sum, r) => sum + r.accuracy, 0) / records.length
          );
        }

        res.json({ student, stats, records: records.slice(0, 10) });
      }
    );
  });
});

// 获取特定班级学生列表
router.get('/list', (req, res) => {
  const { school, grade, class_number } = req.query;
  
  if (!school || !grade || !class_number) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  db.all(
    'SELECT id, name, student_no FROM students WHERE school = ? AND grade = ? AND class_number = ? ORDER BY name ASC',
    [school, grade, class_number],
    (err, students) => {
      if (err) {
        return res.status(500).json({ error: '数据库错误' });
      }
      res.json({ success: true, students });
    }
  );
});

// 修改密码
router.post('/change-password', (req, res) => {
  const { student_id, current_password, new_password } = req.body;
  
  if (!student_id || !current_password || !new_password) {
    return res.json({ success: false, error: '参数不完整' });
  }

  db.get('SELECT password FROM students WHERE id = ?', [student_id], (err, student) => {
    if (err || !student) {
      return res.json({ success: false, error: '学生不存在' });
    }

    // 验证当前密码（支持明文和加密两种格式）
    let passwordMatch = false;
    if (student.password.startsWith('$2')) {
      // bcrypt 加密格式
      passwordMatch = bcrypt.compareSync(current_password, student.password);
    } else {
      // 明文格式
      passwordMatch = student.password === current_password;
    }
    
    if (!passwordMatch) {
      return res.json({ success: false, error: '当前密码错误' });
    }

    // 加密新密码
    const hashedPassword = bcrypt.hashSync(new_password, 10);

    // 更新密码
    db.run('UPDATE students SET password = ? WHERE id = ?', [hashedPassword, student_id], function(err) {
      if (err) {
        return res.json({ success: false, error: '修改失败' });
      }
      res.json({ success: true });
    });
  });
});

// 换班冷却时间（分钟）
const CLASS_CHANGE_COOLDOWN_MINUTES = 30;

// 检查换班状态
router.get('/class-change-status', (req, res) => {
  const { student_id } = req.query;
  
  if (!student_id) {
    return res.json({ canChange: true, remainingSeconds: 0 });
  }

  db.get('SELECT last_class_change_time FROM students WHERE id = ?', [student_id], (err, student) => {
    if (err || !student || !student.last_class_change_time) {
      // 从未换过班，可以换班
      return res.json({ canChange: true, remainingSeconds: 0 });
    }

    // 计算距离上次换班的时间
    const lastChangeTime = new Date(student.last_class_change_time);
    const now = new Date();
    const diffMs = now - lastChangeTime;
    const cooldownMs = CLASS_CHANGE_COOLDOWN_MINUTES * 60 * 1000;
    const remainingMs = cooldownMs - diffMs;

    if (remainingMs <= 0) {
      return res.json({ canChange: true, remainingSeconds: 0 });
    }

    const remainingSeconds = Math.ceil(remainingMs / 1000);
    res.json({ canChange: false, remainingSeconds });
  });
});

// 执行换班
router.post('/change-class', (req, res) => {
  const { student_id, school, grade, class_number } = req.body;

  if (!student_id || !school || !grade || !class_number) {
    return res.json({ success: false, error: '参数不完整' });
  }

  // 首先检查冷却时间
  db.get('SELECT last_class_change_time FROM students WHERE id = ?', [student_id], (err, student) => {
    if (err || !student) {
      return res.json({ success: false, error: '学生不存在' });
    }

    // 检查冷却
    if (student.last_class_change_time) {
      const lastChangeTime = new Date(student.last_class_change_time);
      const now = new Date();
      const diffMs = now - lastChangeTime;
      const cooldownMs = CLASS_CHANGE_COOLDOWN_MINUTES * 60 * 1000;

      if (diffMs < cooldownMs) {
        const remainingMinutes = Math.ceil((cooldownMs - diffMs) / 60000);
        return res.json({ success: false, error: `换班冷却中，请${remainingMinutes}分钟后再试` });
      }
    }

    // 获取年级对应的标签
    const gradeLabels = ['', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级'];
    const classLabel = `${gradeLabels[grade]}${class_number}班`;

    // 更新学生班级信息
    db.run(
      'UPDATE students SET school = ?, grade = ?, class_number = ?, class = ?, last_class_change_time = ? WHERE id = ?',
      [school, grade, class_number, classLabel, new Date().toISOString(), student_id],
      function(err) {
        if (err) {
          return res.json({ success: false, error: '数据库错误' });
        }
        res.json({ success: true });
      }
    );
  });
});

// 保存个人资料（生日和班级，学校和年级不可修改）
router.post('/profile', (req, res) => {
  const { student_id, birthday, class_number } = req.body;

  if (!student_id) {
    return res.json({ success: false, error: '参数不完整' });
  }

  // 检查学生是否存在
  db.get('SELECT * FROM students WHERE id = ?', [student_id], (err, student) => {
    if (err || !student) {
      return res.json({ success: false, error: '学生不存在' });
    }

    // 如果要更新班级信息，需要检查冷却时间
    if (class_number) {
      db.get('SELECT last_class_change_time FROM students WHERE id = ?', [student_id], (err, studentData) => {
        if (err || !studentData) {
          return res.json({ success: false, error: '学生不存在' });
        }

        // 检查班级修改冷却
        if (studentData.last_class_change_time) {
          const lastChangeTime = new Date(studentData.last_class_change_time);
          const now = new Date();
          const diffMs = now - lastChangeTime;
          const cooldownMs = CLASS_CHANGE_COOLDOWN_MINUTES * 60 * 1000;

          if (diffMs < cooldownMs) {
            const remainingMinutes = Math.ceil((cooldownMs - diffMs) / 60000);
            return res.json({ success: false, error: `换班冷却中，请${remainingMinutes}分钟后再试` });
          }
        }

        // 更新生日和班级
        const gradeLabels = ['', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级'];
        const classLabel = `${gradeLabels[student.grade]}${class_number}班`;

        db.run(
          'UPDATE students SET birthday = ?, class_number = ?, class = ?, last_class_change_time = ? WHERE id = ?',
          [birthday || student.birthday, class_number, classLabel, new Date().toISOString(), student_id],
          function(err) {
            if (err) {
              return res.json({ success: false, error: '保存失败' });
            }
            res.json({ success: true });
          }
        );
      });
    } else {
      // 只更新生日
      db.run(
        'UPDATE students SET birthday = ? WHERE id = ?',
        [birthday, student_id],
        function(err) {
          if (err) {
            return res.json({ success: false, error: '保存失败' });
          }
          res.json({ success: true });
        }
      );
    }
  });
});

module.exports = router;
