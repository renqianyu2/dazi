const express = require('express');
const router = express.Router();
const { db } = require('../database');

// 获取年级统计数据
router.get('/stats', (req, res) => {
    const { grade } = req.query;

    if (!grade) {
        return res.status(400).json({ error: '缺少年级参数' });
    }

    // 获取年级总人数
    db.get('SELECT COUNT(*) as total FROM students WHERE class LIKE ?', [`%${grade}%`], (err, countResult) => {
        if (err) return res.status(500).json({ error: err.message });

        const totalStudents = countResult.total;

        // 获取年级平均速度和准确率
        db.get(`SELECT AVG(speed) as avgSpeed, AVG(accuracy) as avgAccuracy
                FROM test_records tr
                JOIN students s ON tr.student_id = s.id
                WHERE s.class LIKE ?`, [`%${grade}%`], (err, avgResult) => {
            if (err) return res.status(500).json({ error: err.message });

            // 速度排行
            db.all(`SELECT s.id, s.name, s.class, MAX(tr.speed) as value
                    FROM students s
                    LEFT JOIN test_records tr ON s.id = tr.student_id
                    WHERE s.class LIKE ?
                    GROUP BY s.id
                    ORDER BY value DESC NULLS LAST`, [`%${grade}%`], (err, speedRank) => {
                if (err) return res.status(500).json({ error: err.message });

                // 准确率排行
                db.all(`SELECT s.id, s.name, s.class, ROUND(AVG(tr.accuracy)) as value
                        FROM students s
                        LEFT JOIN test_records tr ON s.id = tr.student_id
                        WHERE s.class LIKE ?
                        GROUP BY s.id
                        ORDER BY value DESC NULLS LAST`, [`%${grade}%`], (err, accuracyRank) => {
                    if (err) return res.status(500).json({ error: err.message });

                    // 练习时长排行
                    db.all(`SELECT s.id, s.name, s.class, ROUND(SUM(pr.duration)/60) as value
                            FROM students s
                            LEFT JOIN practice_records pr ON s.id = pr.student_id
                            WHERE s.class LIKE ?
                            GROUP BY s.id
                            ORDER BY value DESC NULLS LAST`, [`%${grade}%`], (err, practiceRank) => {
                        if (err) return res.status(500).json({ error: err.message });

                        // 连续天数排行（简化版，返回测试天数）
                        db.all(`SELECT s.id, s.name, s.class, COUNT(DISTINCT DATE(tr.created_at)) as value
                                FROM students s
                                LEFT JOIN test_records tr ON s.id = tr.student_id
                                WHERE s.class LIKE ?
                                GROUP BY s.id
                                ORDER BY value DESC NULLS LAST`, [`%${grade}%`], (err, consecutiveRank) => {
                            if (err) return res.status(500).json({ error: err.message });

                            // 计算当前学生排名
                            const myRank = speedRank.findIndex(r => r.id === parseInt(req.query.student_id)) + 1;

                            res.json({
                                totalStudents,
                                avgSpeed: Math.round(avgResult.avgSpeed || 0),
                                avgAccuracy: Math.round(avgResult.avgAccuracy || 0),
                                myRank: myRank > 0 ? myRank : '-',
                                rankings: {
                                    speed: speedRank.map(r => ({ ...r, value: r.value || 0 })),
                                    accuracy: accuracyRank.map(r => ({ ...r, value: r.value || 0 })),
                                    practice: practiceRank.map(r => ({ ...r, value: r.value || 0 })),
                                    consecutive: consecutiveRank.map(r => ({ ...r, value: r.value || 0 }))
                                }
                            });
                        });
                    });
                });
            });
        });
    });
});

// 获取所有班级列表（管理员）
router.get('/classes', (req, res) => {
  const sql = `
    SELECT grade, class_number, COUNT(*) as student_count
    FROM students
    GROUP BY grade, class_number
    ORDER BY grade, class_number
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ classes: rows });
  });
});

// 获取指定班级详情（管理员）
router.get('/:grade/class/:class_number', (req, res) => {
  const { grade, class_number } = req.params;

  const studentsSql = `
    SELECT s.*,
           COUNT(DISTINCT t.id) as test_count,
           COALESCE(AVG(t.speed), 0) as avg_speed,
           COALESCE(MAX(t.speed), 0) as max_speed,
           COALESCE(AVG(t.accuracy), 0) as avg_accuracy
    FROM students s
    LEFT JOIN test_records t ON s.id = t.student_id AND t.is_valid = 1
    WHERE s.grade = ? AND s.class_number = ?
    GROUP BY s.id
    ORDER BY s.name
  `;

  db.all(studentsSql, [grade, class_number], (err, students) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ students });
  });
});

// 获取各班级统计数据（管理员）
router.get('/class-stats', (req, res) => {
  const sql = `
    SELECT s.grade, s.class_number, s.class,
           COUNT(DISTINCT s.id) as student_count,
           COUNT(DISTINCT t.id) as test_count,
           COALESCE(AVG(t.speed), 0) as avg_speed,
           COALESCE(AVG(t.accuracy), 0) as avg_accuracy
    FROM students s
    LEFT JOIN test_records t ON s.id = t.student_id AND t.is_valid = 1
    GROUP BY s.grade, s.class_number
    ORDER BY s.grade, s.class_number
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ stats: rows });
  });
});

module.exports = router;
