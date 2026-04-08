const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath);

// 启用 WAL 模式以提高并发性能（对 50 人同时在线很重要）
db.run("PRAGMA journal_mode=WAL", (err) => {
    if (err) console.error("WAL模式启用失败:", err);
    else console.log("数据库已启用 WAL 模式");
});

// 优化：设置合适的缓存大小
db.run("PRAGMA cache_size=-64000", (err) => {}); // 64MB 缓存
db.run("PRAGMA synchronous=NORMAL", (err) => {}); // 更快的同步模式
db.run("PRAGMA temp_store=MEMORY", (err) => {}); // 临时表存内存

// 初始化数据库
function initDatabase() {
  db.serialize(() => {
    // 启用 WAL 模式（如果在主程序中没有设置的话）
    db.run("PRAGMA journal_mode=WAL", () => {});
    db.run("PRAGMA cache_size=-64000", () => {});
    db.run("PRAGMA synchronous=NORMAL", () => {});

    // 学生表
    db.run(`CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      school TEXT NOT NULL,
      grade INTEGER NOT NULL,
      class_number INTEGER NOT NULL,
      class TEXT NOT NULL,
      student_no TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      must_change_password INTEGER DEFAULT 0,
      session_token TEXT,
      login_ip TEXT,
      login_time DATETIME,
      exclude_ranking INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 创建索引以提高查询性能
    db.run(`CREATE INDEX IF NOT EXISTS idx_students_student_no ON students(student_no)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_students_school_grade_class ON students(school, grade, class_number)`, () => {});

    // 给已有表添加新字段（兼容老数据库）
    db.run(`ALTER TABLE students ADD COLUMN must_change_password INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE students ADD COLUMN session_token TEXT`, () => {});
    db.run(`ALTER TABLE students ADD COLUMN login_ip TEXT`, () => {});
    db.run(`ALTER TABLE students ADD COLUMN login_time DATETIME`, () => {});
    // 安全机制新字段
    db.run(`ALTER TABLE students ADD COLUMN birthday TEXT`, () => {});
    db.run(`ALTER TABLE students ADD COLUMN device_id TEXT`, () => {});
    db.run(`ALTER TABLE students ADD COLUMN last_action_time DATETIME`, () => {});
    db.run(`ALTER TABLE students ADD COLUMN teacher TEXT`, () => {});
    // 换班相关字段
    db.run(`ALTER TABLE students ADD COLUMN last_class_change_time DATETIME`, () => {});
    db.run(`ALTER TABLE students ADD COLUMN exclude_ranking INTEGER DEFAULT 0`, () => {});

    // 系统配置表（存储注册码等信息）
    db.run(`CREATE TABLE IF NOT EXISTS system_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT NOT NULL UNIQUE,
      config_value TEXT,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 操作日志表（用于冷却机制）
    db.run(`CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      student_id INTEGER,
      ip_address TEXT,
      success INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 预设教师列表
    const presetTeachers = ['黄老师', '张老师', '李老师', '王老师', '刘老师', '陈老师', '杨老师', '赵老师'];
    const teacherStmt = db.prepare('INSERT OR IGNORE INTO system_configs (config_key, config_value) VALUES (?, ?)');
    teacherStmt.run('preset_teachers', JSON.stringify(presetTeachers));
    teacherStmt.finalize();

    // 测试记录表
    db.run(`CREATE TABLE IF NOT EXISTS test_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      text_id INTEGER NOT NULL,
      speed INTEGER NOT NULL,
      accuracy INTEGER NOT NULL,
      correct_count INTEGER NOT NULL,
      error_count INTEGER NOT NULL,
      is_valid INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id)
    )`);

    // 为测试记录表创建索引
    db.run(`CREATE INDEX IF NOT EXISTS idx_test_records_student_id ON test_records(student_id)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_test_records_created_at ON test_records(created_at)`, () => {});

    // 文本库表
    db.run(`CREATE TABLE IF NOT EXISTS texts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      level TEXT DEFAULT 'level1',
      category TEXT DEFAULT 'general',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 为文本表创建索引
    db.run(`CREATE INDEX IF NOT EXISTS idx_texts_level ON texts(level)`, () => {});

    // 管理员表
    db.run(`CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 学校表
    db.run(`CREATE TABLE IF NOT EXISTS schools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 练习记录表 - 增强版多维度记录
    db.run(`CREATE TABLE IF NOT EXISTS practice_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      score INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 0,
      -- 多维度核心数据
      wpm INTEGER DEFAULT 0,           -- 每分钟字数/词数
      accuracy INTEGER DEFAULT 0,      -- 准确率 (百分比)
      total_chars INTEGER DEFAULT 0,    -- 总字符数
      correct_chars INTEGER DEFAULT 0,   -- 正确字符数
      error_chars INTEGER DEFAULT 0,     -- 错误字符数
      -- 游戏特定数据
      combo INTEGER DEFAULT 0,          -- 连击数
      max_combo INTEGER DEFAULT 0,      -- 最大连击数
      level INTEGER DEFAULT 0,         -- 关卡等级
      difficulty INTEGER DEFAULT 0,     -- 难度等级
      -- 分类数据
      category TEXT,                   -- 词库/主题分类
      category_name TEXT,              -- 分类名称
      -- 扩展数据 (JSON格式存储其他数据)
      extra_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id)
    )`);

    // 为练习记录表创建索引（大幅提升排行榜查询速度）
    db.run(`CREATE INDEX IF NOT EXISTS idx_practice_records_student_id ON practice_records(student_id)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_practice_records_mode ON practice_records(mode)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_practice_records_mode_student ON practice_records(mode, student_id)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_practice_records_score ON practice_records(score)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_practice_records_created_at ON practice_records(created_at)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_practice_records_duration ON practice_records(duration)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_practice_records_wpm ON practice_records(wpm)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_practice_records_accuracy ON practice_records(accuracy)`, () => {});

    // 为已有表添加新字段（兼容老数据库）
    db.run(`ALTER TABLE practice_records ADD COLUMN wpm INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_records ADD COLUMN accuracy INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_records ADD COLUMN total_chars INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_records ADD COLUMN correct_chars INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_records ADD COLUMN error_chars INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_records ADD COLUMN combo INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_records ADD COLUMN max_combo INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_records ADD COLUMN level INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_records ADD COLUMN difficulty INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_records ADD COLUMN category TEXT`, () => {});
    db.run(`ALTER TABLE practice_records ADD COLUMN category_name TEXT`, () => {});

    // 学生练习积分表
    db.run(`CREATE TABLE IF NOT EXISTS practice_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL UNIQUE,
      -- 各项目积分
      interstellar_score INTEGER DEFAULT 0,     -- 星际打字积分
      fruit_score INTEGER DEFAULT 0,           -- 拼音入门积分
      adventure_score INTEGER DEFAULT 0,      -- 英语闯关积分
      classics_score INTEGER DEFAULT 0,       -- 国学打字积分
      -- 综合积分（所有项目加权总和）
      total_score INTEGER DEFAULT 0,
      -- 各项目详细数据
      interstellar_best_score INTEGER DEFAULT 0,
      interstellar_best_wpm INTEGER DEFAULT 0,
      interstellar_best_accuracy INTEGER DEFAULT 0,
      interstellar_play_count INTEGER DEFAULT 0,
      interstellar_total_time INTEGER DEFAULT 0,
      fruit_best_score INTEGER DEFAULT 0,
      fruit_best_wpm INTEGER DEFAULT 0,
      fruit_best_accuracy INTEGER DEFAULT 0,
      fruit_best_combo INTEGER DEFAULT 0,
      fruit_play_count INTEGER DEFAULT 0,
      fruit_total_time INTEGER DEFAULT 0,
      adventure_best_score INTEGER DEFAULT 0,
      adventure_best_wpm INTEGER DEFAULT 0,
      adventure_best_accuracy INTEGER DEFAULT 0,
      adventure_levels_completed INTEGER DEFAULT 0,
      adventure_play_count INTEGER DEFAULT 0,
      classics_best_speed INTEGER DEFAULT 0,
      classics_best_accuracy INTEGER DEFAULT 0,
      classics_best_wpm INTEGER DEFAULT 0,
      classics_play_count INTEGER DEFAULT 0,
      classics_total_time INTEGER DEFAULT 0,
      -- 更新时间
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id)
    )`, () => {});

    // 为积分表创建索引
    db.run(`CREATE INDEX IF NOT EXISTS idx_practice_scores_total ON practice_scores(total_score)`, () => {});
    db.run(`CREATE INDEX IF NOT EXISTS idx_practice_scores_student ON practice_scores(student_id)`, () => {});

    // 为已有表添加积分字段（兼容老数据库）
    db.run(`ALTER TABLE practice_scores ADD COLUMN interstellar_best_score INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN interstellar_best_wpm INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN interstellar_best_accuracy INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN interstellar_play_count INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN interstellar_total_time INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN fruit_best_score INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN fruit_best_wpm INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN fruit_best_accuracy INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN fruit_best_combo INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN fruit_play_count INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN fruit_total_time INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN adventure_best_score INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN adventure_best_wpm INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN adventure_best_accuracy INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN adventure_levels_completed INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN adventure_play_count INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN classics_best_speed INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN classics_best_accuracy INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN classics_best_wpm INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN classics_play_count INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE practice_scores ADD COLUMN classics_total_time INTEGER DEFAULT 0`, () => {});

    // 测试验证码表
    db.run(`CREATE TABLE IF NOT EXISTS test_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      is_active INTEGER DEFAULT 1,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 登录签到记录表
    db.run(`CREATE TABLE IF NOT EXISTS login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      date DATE DEFAULT (date('now')),
      FOREIGN KEY (student_id) REFERENCES students(id)
    )`);

    // 教师表（支持教师管理与班级关联）
    db.run(`CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 教师与班级关联表
    db.run(`CREATE TABLE IF NOT EXISTS teacher_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      school TEXT NOT NULL,
      grade INTEGER NOT NULL,
      class_number INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
      UNIQUE(teacher_id, school, grade, class_number)
    )`);

    // 从 system_configs 迁移预设教师到 teachers 表（如果 teachers 表为空）
    db.get("SELECT COUNT(*) as count FROM teachers", (err, row) => {
      if (row && row.count === 0) {
        db.get(
          "SELECT config_value FROM system_configs WHERE config_key = 'preset_teachers'",
          (err, teacherRow) => {
            if (teacherRow && teacherRow.config_value) {
              try {
                const presetTeachers = JSON.parse(teacherRow.config_value);
                const insertTeacher = db.prepare('INSERT OR IGNORE INTO teachers (name) VALUES (?)');
                presetTeachers.forEach(name => {
                  insertTeacher.run(name);
                });
                insertTeacher.finalize();
                console.log('已迁移预设教师到 teachers 表');
              } catch (e) {
                console.error('迁移教师数据失败:', e);
              }
            }
          }
        );
      }
    });

// 插入初始文本数据
    const texts = [
      '春天来了，小草从地里钻出来，嫩嫩的，绿绿的。桃花笑红了脸，柳树摇着绿色的长辫子。',
      '小燕子从南方飞回来了，在屋檐下搭窝。它们忙着衔泥，一趟又一趟，真勤劳啊！',
      '夏天的荷花开了，粉红色的花瓣真漂亮。小鱼在荷叶下游来游去，快乐极了。',
      '秋天到了，树叶变黄了，一片片飘落下来，像一只只蝴蝶在空中飞舞。',
      '冬天下雪了，雪花飘飘洒洒，大地披上了白色的衣裳。小朋友们堆雪人，打雪仗。',
      '太阳升起来了，金色的阳光照在大地上，温暖又明亮。小鸟在树枝上唱歌。',
      '小猫咪很可爱，它有一双明亮的眼睛，还有柔软的毛。它最喜欢玩毛线球。',
      '我爱我的学校，学校里有宽敞的教室，美丽的花园，还有亲爱的老师和同学们。'
    ];

    const stmt = db.prepare('INSERT OR IGNORE INTO texts (content, level) VALUES (?, ?)');
    texts.forEach((text, i) => {
      const level = i < 3 ? 'level1' : i < 6 ? 'level2' : 'level3';
      stmt.run(text, level);
    });
    stmt.finalize();

    // 插入预设学校数据
    const schools = ['谷山学校', '中华路小学'];
    const schoolStmt = db.prepare('INSERT OR IGNORE INTO schools (name) VALUES (?)');
    schools.forEach(school => {
      schoolStmt.run(school);
    });
    schoolStmt.finalize();

    // 插入默认管理员 (用户名：admin, 密码：admin123)
    db.run(`INSERT OR IGNORE INTO admins (username, password) VALUES ('admin', 'admin123')`);

    // 生日验证开关（默认关闭）
    db.run(`INSERT OR IGNORE INTO system_configs (config_key, config_value) VALUES ('birthday_verification_enabled', 'false')`);

    // 手动标记优秀学生表
    db.run(`CREATE TABLE IF NOT EXISTS manual_excellent_students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      class TEXT NOT NULL,
      school TEXT,
      grade INTEGER,
      score INTEGER DEFAULT 0,
      ranking_name TEXT,
      reason TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('数据库初始化完成');
  });
}

// 如果直接运行此文件，则初始化数据库
if (require.main === module) {
  initDatabase();
  db.close();
}

module.exports = { db, initDatabase };
