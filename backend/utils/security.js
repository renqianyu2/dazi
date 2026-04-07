/**
 * 安全中间件模块
 * 实现防恶意注册与防扫号安全机制
 */
const crypto = require('crypto');
const { db } = require('../database');

// ==================== 配置常量 ====================
const CONFIG = {
  REG_CODE_EXPIRE_MINUTES: 5,    // 注册码有效期（分钟）
  DEVICE_COOLDOWN_MINUTES: 10,   // 设备冷却时间（分钟）
  CHINESE_NAME_REGEX: /^[\u4e00-\u9fa5]{2,4}$/,  // 2-4个中文字符
  PRESET_TEACHERS_KEY: 'preset_teachers',
  CURRENT_REG_CODE_KEY: 'current_reg_code',
  CODE_EXPIRE_TIME_KEY: 'code_expire_time'
};

// ==================== 工具函数 ====================

/**
 * 获取客户端IP地址
 */
function getClientIp(req) {
  return req.ip || 
         req.connection.remoteAddress || 
         req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         'unknown';
}

/**
 * 生成随机注册码（6位数字）
 */
function generateRegCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * 检查是否在冷却期内
 * @param {string} deviceId - 设备ID
 * @param {string} actionType - 操作类型 ('register' | 'login' | 'update')
 * @returns {Promise<{allowed: boolean, remainingTime: number, lastActionTime: string}>}
 */
function checkCooldown(deviceId, actionType) {
  return new Promise((resolve) => {
    const cooldownMs = CONFIG.DEVICE_COOLDOWN_MINUTES * 60 * 1000;
    const cutoffTime = new Date(Date.now() - cooldownMs).toISOString();

    db.get(
      `SELECT MAX(created_at) as last_action_time 
       FROM action_logs 
       WHERE device_id = ? AND action_type = ? AND success = 1 AND created_at > ?`,
      [deviceId, actionType, cutoffTime],
      (err, row) => {
        if (err || !row || !row.last_action_time) {
          resolve({ allowed: true, remainingTime: 0, lastActionTime: null });
          return;
        }

        const lastTime = new Date(row.last_action_time);
        const now = new Date();
        const elapsed = now - lastTime;
        const remaining = cooldownMs - elapsed;

        resolve({
          allowed: remaining <= 0,
          remainingTime: Math.ceil(remaining / 1000),
          lastActionTime: row.last_action_time
        });
      }
    );
  });
}

/**
 * 记录操作日志
 */
function logAction(deviceId, actionType, studentId, ipAddress, success) {
  return new Promise((resolve) => {
    db.run(
      `INSERT INTO action_logs (device_id, action_type, student_id, ip_address, success) 
       VALUES (?, ?, ?, ?, ?)`,
      [deviceId, actionType, studentId || null, ipAddress, success ? 1 : 0],
      (err) => {
        resolve(!err);
      }
    );
  });
}

/**
 * 清理过期的操作日志（保留7天）
 */
function cleanupOldLogs() {
  const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  db.run(`DELETE FROM action_logs WHERE created_at < ?`, [cutoffDate], (err) => {
    if (!err) {
      console.log('已清理过期操作日志');
    }
  });
}

// 每天清理一次过期日志
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

// ==================== 注册码相关 ====================

/**
 * 生成新的课堂注册码
 * @returns {Promise<{code: string, expiresAt: string}>}
 */
function generateRegistrationCode() {
  return new Promise((resolve) => {
    const code = generateRegCode();
    const expiresAt = new Date(Date.now() + CONFIG.REG_CODE_EXPIRE_MINUTES * 60 * 1000).toISOString();

    // 更新或插入注册码
    db.run(
      `INSERT OR REPLACE INTO system_configs (config_key, config_value, expires_at, updated_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [CONFIG.CURRENT_REG_CODE_KEY, code, expiresAt],
      (err) => {
        if (err) {
          console.error('生成注册码失败:', err);
          resolve(null);
          return;
        }
        resolve({ code, expiresAt });
      }
    );
  });
}

/**
 * 校验注册码
 * @param {string} code - 待校验的注册码
 * @returns {Promise<{valid: boolean, message: string}>}
 */
function verifyRegistrationCode(code) {
  return new Promise((resolve) => {
    db.get(
      `SELECT config_value, expires_at FROM system_configs WHERE config_key = ?`,
      [CONFIG.CURRENT_REG_CODE_KEY],
      (err, row) => {
        if (err || !row) {
          resolve({ valid: false, message: '暂无注册码，请联系教师获取' });
          return;
        }

        const now = new Date();
        const expiresAt = new Date(row.expires_at);

        if (now > expiresAt) {
          resolve({ valid: false, message: '注册码已过期，请刷新页面获取新码' });
          return;
        }

        if (row.config_value !== code) {
          resolve({ valid: false, message: '注册码错误，请重新输入' });
          return;
        }

        resolve({ valid: true, message: '注册码有效' });
      }
    );
  });
}

// ==================== 设备绑定相关 ====================

/**
 * 检查设备是否已绑定其他账号
 * @param {string} deviceId - 设备ID
 * @param {number} currentStudentId - 当前学生ID
 * @returns {Promise<{bound: boolean, boundStudentName: string | null}>}
 */
function checkDeviceBinding(deviceId, currentStudentId) {
  return new Promise((resolve) => {
    if (!deviceId) {
      resolve({ bound: false, boundStudentName: null });
      return;
    }

    db.get(
      `SELECT id, name FROM students WHERE device_id = ? AND id != ?`,
      [deviceId, currentStudentId || 0],
      (err, student) => {
        if (err || !student) {
          resolve({ bound: false, boundStudentName: null });
          return;
        }
        resolve({ bound: true, boundStudentName: student.name });
      }
    );
  });
}

/**
 * 绑定设备到账号
 * @param {number} studentId - 学生ID
 * @param {string} deviceId - 设备ID
 */
function bindDevice(studentId, deviceId) {
  return new Promise((resolve) => {
    if (!deviceId) {
      resolve(false);
      return;
    }

    db.run(
      `UPDATE students SET device_id = ?, last_action_time = datetime('now') WHERE id = ?`,
      [deviceId, studentId],
      (err) => {
        resolve(!err);
      }
    );
  });
}

// ==================== 教师列表相关 ====================

/**
 * 获取预设教师列表（从 teachers 表）
 */
function getPresetTeachers() {
  return new Promise((resolve) => {
    // 首先尝试从新的 teachers 表获取
    db.all(
      `SELECT name FROM teachers ORDER BY name`,
      [],
      (err, rows) => {
        if (err || !rows || rows.length === 0) {
          // 如果 teachers 表为空，回退到 system_configs
          db.get(
            `SELECT config_value FROM system_configs WHERE config_key = ?`,
            [CONFIG.PRESET_TEACHERS_KEY],
            (err, row) => {
              if (err || !row) {
                resolve(['黄老师', '张老师', '李老师', '王老师']);
                return;
              }
              try {
                resolve(JSON.parse(row.config_value));
              } catch (e) {
                resolve(['黄老师', '张老师', '李老师', '王老师']);
              }
            }
          );
          return;
        }
        
        // 从新表读取教师姓名
        resolve(rows.map(r => r.name));
      }
    );
  });
}

/**
 * 验证教师名称是否在教师列表中
 * @param {string} teacherName 
 */
function validateTeacher(teacherName) {
  return new Promise(async (resolve) => {
    const teachers = await getPresetTeachers();
    resolve(teachers.includes(teacherName));
  });
}

// ==================== 字段验证 ====================

/**
 * 验证姓名格式（2-4个中文字符）
 */
function validateName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: '姓名为必填项' };
  }
  if (!CONFIG.CHINESE_NAME_REGEX.test(name)) {
    return { valid: false, message: '姓名必须为2-4个中文字符' };
  }
  return { valid: true, message: '姓名格式正确' };
}

/**
 * 验证生日格式（YYYY-MM-DD）
 */
function validateBirthday(birthday) {
  if (!birthday || typeof birthday !== 'string') {
    return { valid: false, message: '生日为必填项' };
  }
  // 简单的日期格式验证
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(birthday)) {
    return { valid: false, message: '生日格式应为YYYY-MM-DD' };
  }
  const date = new Date(birthday);
  if (isNaN(date.getTime())) {
    return { valid: false, message: '生日日期无效' };
  }
  // 检查合理范围（1900-2020年）
  const year = parseInt(birthday.split('-')[0]);
  if (year < 1900 || year > 2020) {
    return { valid: false, message: '生日年份应在1900-2020年之间' };
  }
  return { valid: true, message: '生日格式正确' };
}

module.exports = {
  CONFIG,
  getClientIp,
  generateRegCode,
  generateRegistrationCode,
  verifyRegistrationCode,
  checkCooldown,
  logAction,
  checkDeviceBinding,
  bindDevice,
  getPresetTeachers,
  validateTeacher,
  validateName,
  validateBirthday,
  cleanupOldLogs
};
