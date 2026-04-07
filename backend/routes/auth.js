const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { db } = require('../database');
const security = require('../utils/security');

// 生成学号
function generateStudentNo(school, grade, classNumber, callback) {
  const gradeStr = String(grade).padStart(2, '0');
  const classStr = String(classNumber).padStart(2, '0');
  const schoolPrefix = school === '谷山学校' ? 'GS' : 'ZHL';

  db.get(
    `SELECT MAX(CAST(SUBSTR(student_no, -2) AS INTEGER)) as max_seq
     FROM students
     WHERE school = ? AND grade = ? AND class_number = ?`,
    [school, grade, classNumber],
    (err, row) => {
      if (err) return callback(err);
      const studentNum = String((row?.max_seq || 0) + 1).padStart(2, '0');
      callback(null, `${schoolPrefix}${gradeStr}${classStr}${studentNum}`);
    }
  );
}

// 注册
router.post('/register', async (req, res) => {
  const { name, school, grade, class_number, password, confirmPassword, regCode, deviceId, birthday, teacher } = req.body;
  const clientIp = security.getClientIp(req);

  // 基础字段验证
  if (!name || !school || !grade || !class_number || !password || !confirmPassword) {
    return res.status(400).json({ error: '所有字段都是必填的' });
  }

  // 1. 姓名格式验证（2-4个中文字符）
  const nameValidation = security.validateName(name);
  if (!nameValidation.valid) {
    return res.status(400).json({ error: nameValidation.message });
  }

  // 2. 教师验证（必须从预设列表选择）
  if (teacher) {
    const isValidTeacher = await security.validateTeacher(teacher);
    if (!isValidTeacher) {
      return res.status(400).json({ error: '请选择预设教师，不支持自定义输入' });
    }
  }

  // 3. 生日验证
  if (!birthday) {
    return res.status(400).json({ error: '生日为必填项，用于登录验证' });
  }
  const birthdayValidation = security.validateBirthday(birthday);
  if (!birthdayValidation.valid) {
    return res.status(400).json({ error: birthdayValidation.message });
  }

  // 4. 设备ID获取（优先使用前端传入的UUID）
  const finalDeviceId = deviceId || `unknown_${clientIp}`;

  // 5. 注册码验证
  if (!regCode) {
    return res.status(400).json({ error: '请输入课堂注册码' });
  }
  const regCodeValidation = await security.verifyRegistrationCode(regCode);
  if (!regCodeValidation.valid) {
    // 记录失败的注册尝试
    security.logAction(finalDeviceId, 'register', null, clientIp, false);
    return res.status(400).json({ error: regCodeValidation.message });
  }

  // 6. 设备冷却检查
  const cooldownCheck = await security.checkCooldown(finalDeviceId, 'register');
  if (!cooldownCheck.allowed) {
    const minutes = Math.ceil(cooldownCheck.remainingTime / 60);
    return res.status(429).json({ 
      error: `操作过于频繁，请${minutes}分钟后再试`,
      remainingTime: cooldownCheck.remainingTime
    });
  }

  // 7. 设备绑定检查（防止扫号）
  if (finalDeviceId && finalDeviceId !== `unknown_${clientIp}`) {
    const deviceBinding = await security.checkDeviceBinding(finalDeviceId, null);
    if (deviceBinding.bound) {
      return res.status(403).json({ 
        error: `本终端已锁定账号 [${deviceBinding.boundStudentName}]，无法注册新账号`,
        locked: true
      });
    }
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: '两次密码输入不一致' });
  }

  if (grade < 1 || grade > 8) {
    return res.status(400).json({ error: '年级必须在 1-8 之间' });
  }

  if (class_number < 1 || class_number > 10) {
    return res.status(400).json({ error: '班级必须在 1-10 之间' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    generateStudentNo(school, grade, class_number, (err, student_no) => {
      if (err) return res.status(500).json({ error: '生成学号失败' });

      const gradeLabels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级'];
      const classText = `${gradeLabels[grade - 1]}${class_number}班`;

      db.run(
        'INSERT INTO students (name, school, grade, class_number, class, student_no, password, birthday, device_id, teacher) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, school, grade, class_number, classText, student_no, hashedPassword, birthday, finalDeviceId, teacher || null],
        function(err) {
          if (err) {
            security.logAction(finalDeviceId, 'register', null, clientIp, false);
            return res.status(500).json({ error: '注册失败，该学号可能已存在' });
          }
          
          const newStudentId = this.lastID;
          
          // 记录成功注册
          security.logAction(finalDeviceId, 'register', newStudentId, clientIp, true);

          res.json({
            success: true,
            student: {
              id: newStudentId,
              name,
              school,
              grade,
              class_number,
              class: classText,
              student_no,
              device_id: finalDeviceId
            }
          });
        }
      );
    });
  } catch (err) {
    security.logAction(finalDeviceId, 'register', null, clientIp, false);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  const { identifier, school, grade, class_number, password, birthday, deviceId } = req.body;
  const clientIp = security.getClientIp(req);

  if (!identifier || !school || !grade || !class_number || !password) {
    return res.status(400).json({ error: '所有字段都是必填的' });
  }

  // 获取生日验证开关状态
  const birthdayEnabled = await new Promise((resolve) => {
    db.get(
      "SELECT config_value FROM system_configs WHERE config_key = 'birthday_verification_enabled'",
      [],
      (err, row) => {
        resolve(row && row.config_value === 'true');
      }
    );
  });

  // 生日验证（双因子）- 仅当启用时才验证
  if (birthdayEnabled && !birthday) {
    return res.status(400).json({ error: '请输入生日进行身份验证' });
  }

  // 设备ID
  const finalDeviceId = deviceId || `unknown_${clientIp}`;

  // 设备冷却检查
  const cooldownCheck = await security.checkCooldown(finalDeviceId, 'login');
  if (!cooldownCheck.allowed) {
    const minutes = Math.ceil(cooldownCheck.remainingTime / 60);
    return res.status(429).json({ 
      error: `登录尝试过于频繁，请${minutes}分钟后再试`,
      remainingTime: cooldownCheck.remainingTime
    });
  }

  let query, params;
  if ((identifier.startsWith('GS') || identifier.startsWith('ZHL')) && (identifier.length === 8 || identifier.length === 9)) {
    query = 'SELECT * FROM students WHERE student_no = ?';
    params = [identifier];
  } else {
    query = 'SELECT * FROM students WHERE name = ? AND school = ? AND grade = ? AND class_number = ?';
    params = [identifier, school, grade, class_number];
  }

  db.get(query, params, async (err, student) => {
    if (err) {
      return res.status(500).json({ error: '数据库错误' });
    }

    if (!student) {
      // 记录失败的登录尝试
      security.logAction(finalDeviceId, 'login', null, clientIp, false);
      return res.status(401).json({ error: '学号/姓名或密码错误' });
    }

    try {
      // 1. 验证生日（双因子认证）- 仅当启用时才验证
      if (birthdayEnabled) {
        if (!student.birthday || student.birthday !== birthday) {
          security.logAction(finalDeviceId, 'login', student.id, clientIp, false);
          return res.status(401).json({ error: '生日验证失败，请检查输入的生日是否正确' });
        }
      }

      // 2. 设备绑定检查
      if (finalDeviceId && finalDeviceId !== `unknown_${clientIp}` && student.device_id) {
        // 如果设备ID不匹配，且该设备已绑定其他账号
        if (student.device_id !== finalDeviceId) {
          const deviceBinding = await security.checkDeviceBinding(finalDeviceId, student.id);
          if (deviceBinding.bound) {
            security.logAction(finalDeviceId, 'login', student.id, clientIp, false);
            return res.status(403).json({ 
              error: `本终端已锁定账号 [${deviceBinding.boundStudentName}]，无法登录其他账号`,
              locked: true
            });
          }
        }
      }

      const match = await bcrypt.compare(password, student.password);
      if (!match) {
        security.logAction(finalDeviceId, 'login', student.id, clientIp, false);
        return res.status(401).json({ error: '学号/姓名或密码错误' });
      }

      // 检查单点登录：同账号在其他IP有活跃session则拒绝
      if (student.session_token && student.login_ip && student.login_ip !== clientIp) {
        return res.status(403).json({
          error: '该账号已在其他设备登录',
          login_ip: student.login_ip,
          login_time: student.login_time
        });
      }

      // 生成新session token
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const loginTime = new Date().toISOString();

      // 更新session信息和设备绑定
      db.run(
        'UPDATE students SET session_token = ?, login_ip = ?, login_time = ?, device_id = ?, last_action_time = ? WHERE id = ?',
        [sessionToken, clientIp, loginTime, finalDeviceId, loginTime, student.id]
      );

      // 记录成功登录
      security.logAction(finalDeviceId, 'login', student.id, clientIp, true);

      // 记录签到（今天首次登录记录）
      const today = new Date().toISOString().split('T')[0];
      db.get('SELECT id FROM login_logs WHERE student_id = ? AND date = ?', [student.id, today], (err, existing) => {
        if (!existing) {
          db.run('INSERT INTO login_logs (student_id, date) VALUES (?, ?)', [student.id, today]);
        }
      });

      const { password: _, ...studentData } = student;
      res.json({
        success: true,
        student: { ...studentData, session_token: sessionToken },
        needPasswordChange: student.must_change_password === 1
      });
    } catch (err) {
      security.logAction(finalDeviceId, 'login', student.id, clientIp, false);
      res.status(500).json({ error: '服务器错误' });
    }
  });
});

// 登出
router.post('/logout', (req, res) => {
  const { student_id, session_token } = req.body;

  if (!student_id || !session_token) {
    return res.status(400).json({ error: '参数不完整' });
  }

  db.run(
    'UPDATE students SET session_token = NULL, login_ip = NULL, login_time = NULL WHERE id = ? AND session_token = ?',
    [student_id, session_token],
    function(err) {
      if (err) {
        return res.status(500).json({ error: '服务器错误' });
      }
      res.json({ success: true });
    }
  );
});

// 强制踢出（管理员用）
router.post('/force-logout/:student_id', (req, res) => {
  db.run(
    'UPDATE students SET session_token = NULL, login_ip = NULL, login_time = NULL WHERE id = ?',
    [req.params.student_id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: '服务器错误' });
      }
      res.json({ success: true });
    }
  );
});

// 修改密码
router.put('/password', async (req, res) => {
  const { student_id, password, old_password } = req.body;

  if (!student_id || !password) {
    return res.status(400).json({ error: '参数不完整' });
  }

  db.get('SELECT * FROM students WHERE id = ?', [student_id], async (err, student) => {
    if (err || !student) {
      return res.status(404).json({ error: '用户不存在' });
    }

    try {
      // 如果传了旧密码，验证旧密码
      if (old_password) {
        const match = await bcrypt.compare(old_password, student.password);
        if (!match) {
          return res.status(401).json({ error: '原密码错误' });
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      db.run(
        'UPDATE students SET password = ?, must_change_password = 0 WHERE id = ?',
        [hashedPassword, student_id],
        function(err) {
          if (err) {
            return res.status(500).json({ error: '修改失败' });
          }
          res.json({ success: true });
        }
      );
    } catch (err) {
      res.status(500).json({ error: '服务器错误' });
    }
  });
});

// 获取当前登录状态
router.get('/status', (req, res) => {
  const studentId = parseInt(req.query.student_id);

  if (!studentId) {
    return res.status(400).json({ error: '参数不完整' });
  }

  db.get('SELECT session_token, login_ip, login_time FROM students WHERE id = ?', [studentId], (err, student) => {
    if (err || !student) {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.json({
      isOnline: !!student.session_token,
      login_ip: student.login_ip,
      login_time: student.login_time
    });
  });
});

// ==================== 安全相关 API ====================

// 获取注册码（供教师端或前端轮询）
router.get('/reg-code', async (req, res) => {
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

// 获取教师列表（带关联班级）
router.get('/teachers', async (req, res) => {
  try {
    // 从新的 teachers 表获取教师列表
    db.all(
      `SELECT id, name, created_at, updated_at FROM teachers ORDER BY name`,
      [],
      (err, teachers) => {
        if (err) {
          return res.status(500).json({ error: '获取教师列表失败' });
        }

        if (!teachers || teachers.length === 0) {
          return res.json({ success: true, teachers: [] });
        }

        // 获取每个教师的关联班级
        const teacherIds = teachers.map(t => t.id);
        const placeholders = teacherIds.map(() => '?').join(',');

        db.all(
          `SELECT tc.teacher_id, tc.school, tc.grade, tc.class_number 
           FROM teacher_classes tc 
           WHERE tc.teacher_id IN (${placeholders})`,
          teacherIds,
          (err, classRelations) => {
            if (err) {
              return res.status(500).json({ error: '获取班级关联失败' });
            }

            // 构建教师-班级映射
            const teacherClassMap = {};
            classRelations.forEach(rel => {
              if (!teacherClassMap[rel.teacher_id]) {
                teacherClassMap[rel.teacher_id] = [];
              }
              const gradeNames = ['', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级'];
              teacherClassMap[rel.teacher_id].push({
                school: rel.school,
                grade: rel.grade,
                class_number: rel.class_number,
                class_name: `${gradeNames[rel.grade]}${rel.class_number}班`
              });
            });

            // 合并数据
            const result = teachers.map(t => ({
              id: t.id,
              name: t.name,
              created_at: t.created_at,
              updated_at: t.updated_at,
              classes: teacherClassMap[t.id] || []
            }));

            res.json({ success: true, teachers: result });
          }
        );
      }
    );
  } catch (err) {
    res.status(500).json({ error: '获取教师列表失败' });
  }
});

// 获取注册码状态（不生成新码，只查询）
router.get('/reg-code/status', async (req, res) => {
  const { db } = require('../database');
  db.get(
    `SELECT config_value, expires_at FROM system_configs WHERE config_key = ?`,
    [security.CONFIG.CURRENT_REG_CODE_KEY],
    (err, row) => {
      if (err || !row) {
        res.json({ 
          success: true, 
          hasCode: false, 
          message: '暂无注册码' 
        });
        return;
      }

      const now = new Date();
      const expiresAt = new Date(row.expires_at);
      const isExpired = now > expiresAt;

      res.json({
        success: true,
        hasCode: !isExpired,
        expiresAt: row.expires_at,
        isExpired,
        expireMinutes: security.CONFIG.REG_CODE_EXPIRE_MINUTES
      });
    }
  );
});

// ==================== 教师管理 API ====================

// 添加教师
router.post('/teacher', (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: '教师姓名不能为空' });
  }
  
  // 验证姓名格式（2-4个中文字符，可带"老师"后缀）
  const cleanName = name.replace(/老师$/, ''); // 去掉"老师"后缀，统一存储
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(cleanName)) {
    return res.status(400).json({ error: '教师姓名必须为2-4个中文字符' });
  }
  
  const teacherName = cleanName + '老师'; // 统一加上"老师"后缀
  
  // 检查是否已存在
  db.get(
    `SELECT id FROM teachers WHERE name = ?`,
    [teacherName],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: '数据库错误' });
      }
      if (row) {
        return res.status(400).json({ error: '该教师已存在' });
      }
      
      // 插入新教师
      db.run(
        `INSERT INTO teachers (name, updated_at) VALUES (?, datetime('now'))`,
        [teacherName],
        function(err) {
          if (err) {
            return res.status(500).json({ error: '添加教师失败' });
          }
          res.json({ 
            success: true, 
            message: '添加成功', 
            teacher: { id: this.lastID, name: teacherName, classes: [] } 
          });
        }
      );
    }
  );
});

// 修改教师姓名
router.put('/teacher/:id', (req, res) => {
  const teacherId = parseInt(req.params.id);
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: '教师姓名不能为空' });
  }
  
  // 验证姓名格式
  const cleanName = name.replace(/老师$/, '');
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(cleanName)) {
    return res.status(400).json({ error: '教师姓名必须为2-4个中文字符' });
  }
  
  const teacherName = cleanName + '老师';
  
  // 检查教师是否存在
  db.get(
    `SELECT id, name FROM teachers WHERE id = ?`,
    [teacherId],
    (err, teacher) => {
      if (err || !teacher) {
        return res.status(404).json({ error: '教师不存在' });
      }
      
      // 检查新名字是否与其他教师重复
      db.get(
        `SELECT id FROM teachers WHERE name = ? AND id != ?`,
        [teacherName, teacherId],
        (err, row) => {
          if (err) {
            return res.status(500).json({ error: '数据库错误' });
          }
          if (row) {
            return res.status(400).json({ error: '该教师姓名已存在' });
          }
          
          // 更新教师姓名
          db.run(
            `UPDATE teachers SET name = ?, updated_at = datetime('now') WHERE id = ?`,
            [teacherName, teacherId],
            function(err) {
              if (err) {
                return res.status(500).json({ error: '更新教师失败' });
              }
              
              // 同时更新 students 表中关联该教师的学生的 teacher 字段
              db.run(
                `UPDATE students SET teacher = ? WHERE teacher = ?`,
                [teacherName, teacher.name],
                (err) => {
                  res.json({ 
                    success: true, 
                    message: '教师姓名已更新，相关学生记录已同步更新',
                    oldName: teacher.name,
                    newName: teacherName
                  });
                }
              );
            }
          );
        }
      );
    }
  );
});

// 删除教师
router.delete('/teacher/:id', (req, res) => {
  const teacherId = parseInt(req.params.id);
  
  // 检查教师是否存在
  db.get(
    `SELECT id, name FROM teachers WHERE id = ?`,
    [teacherId],
    (err, teacher) => {
      if (err || !teacher) {
        return res.status(404).json({ error: '教师不存在' });
      }
      
      // 删除教师与班级的关联（会自动级联删除）
      // 手动删除关联记录
      db.run(
        `DELETE FROM teacher_classes WHERE teacher_id = ?`,
        [teacherId],
        (err) => {
          if (err) {
            return res.status(500).json({ error: '删除班级关联失败' });
          }
          
          // 删除教师
          db.run(
            `DELETE FROM teachers WHERE id = ?`,
            [teacherId],
            function(err) {
              if (err) {
                return res.status(500).json({ error: '删除教师失败' });
              }
              
              // 同时清除 students 表中该教师的关联
              db.run(
                `UPDATE students SET teacher = NULL WHERE teacher = ?`,
                [teacher.name],
                (err) => {
                  res.json({ success: true, message: '教师已删除，相关班级关联和学生记录已更新' });
                }
              );
            }
          );
        }
      );
    }
  );
});

// 为教师分配班级
router.post('/teacher/:id/classes', (req, res) => {
  const teacherId = parseInt(req.params.id);
  const { school, grade, class_number } = req.body;
  
  if (!school || !grade || !class_number) {
    return res.status(400).json({ error: '缺少班级信息（学校、年级、班级）' });
  }
  
  // 检查教师是否存在
  db.get(
    `SELECT id, name FROM teachers WHERE id = ?`,
    [teacherId],
    (err, teacher) => {
      if (err || !teacher) {
        return res.status(404).json({ error: '教师不存在' });
      }
      
      // 检查班级关联是否已存在
      db.get(
        `SELECT id FROM teacher_classes WHERE teacher_id = ? AND school = ? AND grade = ? AND class_number = ?`,
        [teacherId, school, grade, class_number],
        (err, row) => {
          if (err) {
            return res.status(500).json({ error: '数据库错误' });
          }
          if (row) {
            return res.status(400).json({ error: '该班级关联已存在' });
          }
          
          // 添加班级关联
          db.run(
            `INSERT INTO teacher_classes (teacher_id, school, grade, class_number) VALUES (?, ?, ?, ?)`,
            [teacherId, school, grade, class_number],
            function(err) {
              if (err) {
                return res.status(500).json({ error: '分配班级失败' });
              }
              res.json({ success: true, message: '班级分配成功' });
            }
          );
        }
      );
    }
  );
});

// 移除教师的班级关联
router.delete('/teacher/:id/classes', (req, res) => {
  const teacherId = parseInt(req.params.id);
  const { school, grade, class_number } = req.body;
  
  if (!school || !grade || !class_number) {
    return res.status(400).json({ error: '缺少班级信息' });
  }
  
  db.run(
    `DELETE FROM teacher_classes WHERE teacher_id = ? AND school = ? AND grade = ? AND class_number = ?`,
    [teacherId, school, grade, class_number],
    function(err) {
      if (err) {
        return res.status(500).json({ error: '移除班级关联失败' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: '该班级关联不存在' });
      }
      res.json({ success: true, message: '班级关联已移除' });
    }
  );
});

// 获取所有班级（带关联教师信息）
router.get('/classes-with-teachers', (req, res) => {
  const query = `
    SELECT s.school, s.grade, s.class_number, s.class,
           COUNT(s.id) as student_count,
           GROUP_CONCAT(DISTINCT t.name) as teachers
    FROM students s
    LEFT JOIN teacher_classes tc ON s.school = tc.school AND s.grade = tc.grade AND s.class_number = tc.class_number
    LEFT JOIN teachers t ON tc.teacher_id = t.id
    GROUP BY s.school, s.grade, s.class_number
    ORDER BY s.school, s.grade, s.class_number
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: '查询失败' });
    }
    res.json({ success: true, classes: rows || [] });
  });
});

// ==================== 班级管理 API ====================

// 获取班级列表（带关联教师）
router.get('/classes', (req, res) => {
  const { db } = require('../database');
  
  const query = `
    SELECT s.school, s.grade, s.class_number, s.class,
           COUNT(s.id) as student_count,
           GROUP_CONCAT(DISTINCT t.name) as teachers
    FROM students s
    LEFT JOIN teacher_classes tc ON s.school = tc.school AND s.grade = tc.grade AND s.class_number = tc.class_number
    LEFT JOIN teachers t ON tc.teacher_id = t.id
    GROUP BY s.school, s.grade, s.class_number
    ORDER BY s.school, s.grade, s.class_number
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: '查询失败' });
    }
    // 处理 teachers 字段
    const classes = (rows || []).map(row => ({
      ...row,
      teachers: row.teachers ? row.teachers.split(',').filter(t => t) : []
    }));
    res.json({ success: true, classes });
  });
});

// 为班级分配教师
router.post('/class/teacher', (req, res) => {
  const { school, grade, class_number, teacher_id } = req.body;
  
  if (!school || !grade || !class_number || !teacher_id) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  // 检查教师是否存在
  db.get(
    `SELECT id, name FROM teachers WHERE id = ?`,
    [teacher_id],
    (err, teacher) => {
      if (err || !teacher) {
        return res.status(404).json({ error: '教师不存在' });
      }
      
      // 检查班级是否有学生
      db.get(
        `SELECT id FROM students WHERE school = ? AND grade = ? AND class_number = ? LIMIT 1`,
        [school, grade, class_number],
        (err, student) => {
          // 即使没有学生也可以分配教师
          
          // 检查关联是否已存在
          db.get(
            `SELECT id FROM teacher_classes WHERE teacher_id = ? AND school = ? AND grade = ? AND class_number = ?`,
            [teacher_id, school, grade, class_number],
            (err, existing) => {
              if (err) {
                return res.status(500).json({ error: '数据库错误' });
              }
              if (existing) {
                return res.status(400).json({ error: '该教师已关联此班级' });
              }
              
              // 添加关联
              db.run(
                `INSERT INTO teacher_classes (teacher_id, school, grade, class_number) VALUES (?, ?, ?, ?)`,
                [teacher_id, school, grade, class_number],
                function(err) {
                  if (err) {
                    return res.status(500).json({ error: '分配教师失败' });
                  }
                  res.json({ success: true, message: `已分配 ${teacher.name} 到该班级` });
                }
              );
            }
          );
        }
      );
    }
  );
});

// 移除班级的教师
router.delete('/class/teacher', (req, res) => {
  const { school, grade, class_number, teacher_id } = req.body;
  
  if (!school || !grade || !class_number || !teacher_id) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  db.run(
    `DELETE FROM teacher_classes WHERE teacher_id = ? AND school = ? AND grade = ? AND class_number = ?`,
    [teacher_id, school, grade, class_number],
    function(err) {
      if (err) {
        return res.status(500).json({ error: '移除教师失败' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: '该班级没有关联此教师' });
      }
      res.json({ success: true, message: '已移除该教师' });
    }
  );
});

// 删除班级（删除该班所有学生）
router.delete('/class', (req, res) => {
  const { school, grade, class_number } = req.body;
  
  if (!school || !grade || !class_number) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  const { db } = require('../database');
  
  // 先获取该班级的学生ID
  db.all(
    `SELECT id FROM students WHERE school = ? AND grade = ? AND class_number = ?`,
    [school, grade, class_number],
    (err, students) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      
      // 删除教师与班级的关联
      db.run(
        `DELETE FROM teacher_classes WHERE school = ? AND grade = ? AND class_number = ?`,
        [school, grade, class_number],
        (err) => {
          if (students.length === 0) {
            return res.json({ success: true, message: '班级为空，已清理班级关联' });
          }
      
          const studentIds = students.map(s => s.id);
          const placeholders = studentIds.map(() => '?').join(',');
          
          // 删除相关记录
          db.run(`DELETE FROM test_records WHERE student_id IN (${placeholders})`, studentIds, (err) => {
            if (err) return res.status(500).json({ error: '删除测试记录失败' });
            
            db.run(`DELETE FROM practice_records WHERE student_id IN (${placeholders})`, studentIds, (err) => {
              if (err) return res.status(500).json({ error: '删除练习记录失败' });
              
              db.run(`DELETE FROM login_logs WHERE student_id IN (${placeholders})`, studentIds, (err) => {
                if (err) return res.status(500).json({ error: '删除登录记录失败' });
                
                db.run(
                  `DELETE FROM students WHERE school = ? AND grade = ? AND class_number = ?`,
                  [school, grade, class_number],
                  function(err) {
                    if (err) return res.status(500).json({ error: '删除学生失败' });
                    res.json({ success: true, message: `已删除 ${this.changes} 名学生及班级关联` });
                  }
                );
              });
            });
          });
        }
      );
    }
  );
});

// 获取所有可分配的教师列表（用于班级分配教师时选择）
router.get('/available-teachers', (req, res) => {
  const { school, grade, class_number } = req.query;
  
  let query = `
    SELECT id, name FROM teachers ORDER BY name
  `;
  
  db.all(query, [], (err, allTeachers) => {
    if (err) {
      return res.status(500).json({ error: '查询失败' });
    }
    
    // 如果指定了班级，获取已关联的教师
    if (school && grade && class_number) {
      db.all(
        `SELECT teacher_id FROM teacher_classes WHERE school = ? AND grade = ? AND class_number = ?`,
        [school, parseInt(grade), parseInt(class_number)],
        (err, assigned) => {
          if (err) {
            return res.status(500).json({ error: '查询失败' });
          }
          
          const assignedIds = assigned.map(a => a.teacher_id);
          const available = allTeachers.filter(t => !assignedIds.includes(t.id));
          
          res.json({ 
            success: true, 
            allTeachers,
            assignedTeacherIds: assignedIds
          });
        }
      );
    } else {
      res.json({ success: true, allTeachers });
    }
  });
});

// 获取生日验证开关状态
router.get('/birthday-verification-status', (req, res) => {
  db.get(
    "SELECT config_value FROM system_configs WHERE config_key = 'birthday_verification_enabled'",
    [],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: '查询失败' });
      }
      const enabled = row ? row.config_value === 'true' : false;
      res.json({ success: true, enabled });
    }
  );
});

// 更新生日验证开关
router.post('/birthday-verification-toggle', (req, res) => {
  const { enabled } = req.body;
  
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: '参数错误' });
  }

  db.run(
    `UPDATE system_configs SET config_value = ?, updated_at = CURRENT_TIMESTAMP WHERE config_key = 'birthday_verification_enabled'`,
    [enabled ? 'true' : 'false'],
    function(err) {
      if (err) {
        return res.status(500).json({ error: '更新失败' });
      }
      res.json({ success: true, enabled });
    }
  );
});

module.exports = router;
