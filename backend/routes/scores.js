const express = require('express');
const router = express.Router();
const { db } = require('../database');

// 积分权重配置
const SCORE_WEIGHTS = {
    interstellar: 0.30,  // 星际打字权重 30%
    fruit: 0.25,         // 拼音入门权重 25%
    adventure: 0.25,      // 英语闯关权重 25%
    classics: 0.20         // 国学打字权重 20%
};

// 计算单个项目的综合能力分 (Composite Proficiency Index)
function calculateItemScore(wpm, accuracy, score, masteryValue, masteryTarget) {
    // 1. 速度分 (Speed Score) - 目标 80 WPM (对应学生级优秀标准)
    // 允许适度超过 100% 封顶，最高 120
    const sScore = Math.min((wpm || 0) / 80, 1.2) * 100;
    
    // 2. 准确率分 (Accuracy Score) - 保持百分比映射
    const aScore = accuracy || 0;
    
    // 3. 游戏与技战术分 (Mastery/Game Score)
    // 如果有特定的 masteryTP 目标（如连击、关卡），则基于目标百分比；否则基于游戏分标准化
    let mScore;
    if (masteryTarget) {
        mScore = Math.min((masteryValue || 0) / masteryTarget, 1) * 100;
    } else {
        // 后备方案：游戏得分标准化 (假设 5000 分为一局的高分参考)
        mScore = Math.min((score || 0) / 5000, 1) * 100;
    }

    // 最终加权公式：速度(50%) + 准确率(30%) + 技战术/成就(20%)
    return Math.round(
        sScore * 0.5 + 
        aScore * 0.3 + 
        mScore * 0.2
    );
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

// 获取或创建学生积分记录
function getOrCreateScoreRecord(studentId, callback) {
    db.get('SELECT * FROM practice_scores WHERE student_id = ?', [studentId], (err, row) => {
        if (err) {
            callback(err);
            return;
        }
        if (!row) {
            db.run('INSERT INTO practice_scores (student_id) VALUES (?)', [studentId], function(err) {
                if (err) {
                    callback(err);
                    return;
                }
                db.get('SELECT * FROM practice_scores WHERE student_id = ?', [studentId], callback);
            });
        } else {
            callback(null, row);
        }
    });
}

// 更新学生积分（自动计算）
router.post('/update/:student_id', (req, res) => {
    const studentId = req.params.student_id;
    
    // 查询各项目的最佳记录
    const queries = {
        interstellar: `SELECT 
            MAX(score) as best_score,
            MAX(wpm) as best_wpm,
            MAX(accuracy) as best_accuracy,
            COUNT(*) as play_count,
            SUM(duration) as total_time
            FROM practice_records WHERE student_id = ? AND mode = 'interstellar-typist'`,
        
        fruit: `SELECT 
            MAX(score) as best_score,
            MAX(wpm) as best_wpm,
            MAX(accuracy) as best_accuracy,
            MAX(max_combo) as best_combo,
            COUNT(*) as play_count,
            SUM(duration) as total_time
            FROM practice_records WHERE student_id = ? AND mode = 'fruit-catch'`,
        
        adventure: `SELECT 
            MAX(score) as best_score,
            MAX(wpm) as best_wpm,
            MAX(accuracy) as best_accuracy,
            COUNT(DISTINCT category || '-' || level) as levels_completed,
            COUNT(*) as play_count
            FROM practice_records WHERE student_id = ? AND mode LIKE 'adventure-%'`,
        
        classics: `SELECT 
            MAX(score) as best_speed,
            MAX(wpm) as best_wpm,
            MAX(accuracy) as best_accuracy,
            COUNT(*) as play_count,
            SUM(duration) as total_time
            FROM practice_records WHERE student_id = ? AND mode LIKE 'classics-%'`
    };
    
    const results = {};
    let completed = 0;
    
    ['interstellar', 'fruit', 'adventure', 'classics'].forEach(mode => {
        db.get(queries[mode], [studentId], (err, row) => {
            if (err) {
                res.status(500).json({ error: '查询失败' });
                return;
            }
            results[mode] = row || { best_score: 0, best_wpm: 0, best_accuracy: 0, play_count: 0 };
            results[mode].best_score = results[mode].best_score || 0;
            results[mode].best_wpm = results[mode].best_wpm || 0;
            results[mode].best_accuracy = results[mode].best_accuracy || 0;
            
            completed++;
            if (completed === 4) {
                // 计算各项目积分 (根据各模式特点传入 mastery 目标)
                const interstellarScore = calculateItemScore(
                    results.interstellar.best_wpm,
                    results.interstellar.best_accuracy,
                    results.interstellar.best_score,
                    // 星际打字：关注连击 (假设目标 100 连击)
                    results.interstellar.best_combo || 0, 100 
                );
                const fruitScore = calculateItemScore(
                    results.fruit.best_wpm,
                    results.fruit.best_accuracy,
                    results.fruit.best_score,
                    // 接水果：关注连击 (假设目标 50 连击)
                    results.fruit.best_combo || 0, 50
                );
                const adventureScore = calculateItemScore(
                    results.adventure.best_wpm,
                    results.adventure.best_accuracy,
                    results.adventure.best_score,
                    // 英语闯关：关注关卡进度 (假设目标 15 关)
                    results.adventure.levels_completed || 0, 15
                );
                const classicsScore = calculateItemScore(
                    results.classics.best_wpm,
                    results.classics.best_accuracy,
                    results.classics.best_speed || results.classics.best_score,
                    // 国学打字：关注打字速度 CPM (假设目标 120 字/分)
                    results.classics.best_wpm, 120
                );
                const totalScore = calculateTotalScore(interstellarScore, fruitScore, adventureScore, classicsScore);
                
                // 更新数据库
                const updateSql = `UPDATE practice_scores SET
                    interstellar_score = ?,
                    fruit_score = ?,
                    adventure_score = ?,
                    classics_score = ?,
                    total_score = ?,
                    interstellar_best_score = ?,
                    interstellar_best_wpm = ?,
                    interstellar_best_accuracy = ?,
                    interstellar_play_count = ?,
                    interstellar_total_time = ?,
                    fruit_best_score = ?,
                    fruit_best_wpm = ?,
                    fruit_best_accuracy = ?,
                    fruit_best_combo = ?,
                    fruit_play_count = ?,
                    fruit_total_time = ?,
                    adventure_best_score = ?,
                    adventure_best_wpm = ?,
                    adventure_best_accuracy = ?,
                    adventure_levels_completed = ?,
                    adventure_play_count = ?,
                    classics_best_speed = ?,
                    classics_best_wpm = ?,
                    classics_best_accuracy = ?,
                    classics_play_count = ?,
                    classics_total_time = ?,
                    updated_at = CURRENT_TIMESTAMP
                    WHERE student_id = ?`;
                
                db.run(updateSql, [
                    interstellarScore, fruitScore, adventureScore, classicsScore, totalScore,
                    results.interstellar.best_score,
                    results.interstellar.best_wpm,
                    results.interstellar.best_accuracy,
                    results.interstellar.play_count || 0,
                    results.interstellar.total_time || 0,
                    results.fruit.best_score,
                    results.fruit.best_wpm,
                    results.fruit.best_accuracy,
                    results.fruit.best_combo || 0,
                    results.fruit.play_count || 0,
                    results.fruit.total_time || 0,
                    results.adventure.best_score,
                    results.adventure.best_wpm,
                    results.adventure.best_accuracy,
                    results.adventure.levels_completed || 0,
                    results.adventure.play_count || 0,
                    results.classics.best_speed || results.classics.best_wpm,
                    results.classics.best_wpm,
                    results.classics.best_accuracy,
                    results.classics.play_count || 0,
                    results.classics.total_time || 0,
                    studentId
                ], function(err) {
                    if (err) {
                        res.status(500).json({ error: '更新积分失败' });
                        return;
                    }
                    res.json({
                        success: true,
                        scores: {
                            interstellar: interstellarScore,
                            fruit: fruitScore,
                            adventure: adventureScore,
                            classics: classicsScore,
                            total: totalScore
                        },
                        details: results
                    });
                });
            }
        });
    });
});

// 获取学生积分
router.get('/:student_id', (req, res) => {
    const studentId = req.params.student_id;
    
    db.get('SELECT * FROM practice_scores WHERE student_id = ?', [studentId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: '查询失败' });
        }
        if (!row) {
            // 如果没有记录，先创建再返回
            db.run('INSERT INTO practice_scores (student_id) VALUES (?)', [studentId], function(err) {
                if (err) {
                    return res.status(500).json({ error: '创建积分记录失败' });
                }
                db.get('SELECT * FROM practice_scores WHERE student_id = ?', [studentId], (err, row) => {
                    if (err) {
                        return res.status(500).json({ error: '查询失败' });
                    }
                    res.json(row);
                });
            });
        } else {
            res.json(row);
        }
    });
});

// 获取积分排行榜
router.get('/ranking/:field', (req, res) => {
    const { field } = req.params;
    const { limit = 50, grade, class_number } = req.query;
    
    // 允许排序的字段
    const allowedFields = ['total_score', 'interstellar_score', 'fruit_score', 'adventure_score', 'classics_score'];
    const orderField = allowedFields.includes(field) ? field : 'total_score';
    
    let whereClause = 's.exclude_ranking = 0';
    const params = [];
    
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
            ps.*,
            s.name,
            s.class,
            s.grade,
            s.school,
            s.student_no,
            ROW_NUMBER() OVER (ORDER BY ps.${orderField} DESC) as rank
        FROM practice_scores ps
        JOIN students s ON ps.student_id = s.id
        WHERE ${whereClause}
        ORDER BY ps.${orderField} DESC
        LIMIT ?
    `;
    params.push(parseInt(limit));
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: '查询失败' });
        }
        res.json({ ranking: rows });
    });
});

// 获取班级/年级排名
router.get('/rank/:student_id', (req, res) => {
    const { student_id } = req.params;
    const { grade, class_number } = req.query;
    
    // 先获取学生的班级和年级
    db.get('SELECT grade, class_number FROM students WHERE id = ?', [student_id], (err, student) => {
        if (err || !student) {
            return res.status(404).json({ error: '学生不存在' });
        }
        
        const targetGrade = grade || student.grade;
        const targetClass = class_number || student.class_number;
        
        // 查询班级排名
        const classSql = `
            SELECT COUNT(*) + 1 as class_rank
            FROM practice_scores ps
            JOIN students s ON ps.student_id = s.id
            WHERE s.grade = ? AND s.class_number = ? AND s.exclude_ranking = 0 AND ps.total_score > 
                (SELECT COALESCE(total_score, 0) FROM practice_scores WHERE student_id = ?)
        `;
        
        // 查询年级排名
        const gradeSql = `
            SELECT COUNT(*) + 1 as grade_rank
            FROM practice_scores ps
            JOIN students s ON ps.student_id = s.id
            WHERE s.grade = ? AND s.exclude_ranking = 0 AND ps.total_score > 
                (SELECT COALESCE(total_score, 0) FROM practice_scores WHERE student_id = ?)
        `;
        
        // 查询总分排名
        const totalSql = `
            SELECT COUNT(*) + 1 as total_rank
            FROM practice_scores ps
            JOIN students s ON ps.student_id = s.id
            WHERE s.exclude_ranking = 0 AND COALESCE(ps.total_score, 0) > 
                (SELECT COALESCE(total_score, 0) FROM practice_scores WHERE student_id = ?)
        `;
        
        db.get(classSql, [targetGrade, targetClass, student_id], (err, classRow) => {
            if (err) {
                return res.status(500).json({ error: '查询失败' });
            }
            db.get(gradeSql, [targetGrade, student_id], (err, gradeRow) => {
                if (err) {
                    return res.status(500).json({ error: '查询失败' });
                }
                db.get(totalSql, [student_id], (err, totalRow) => {
                    if (err) {
                        return res.status(500).json({ error: '查询失败' });
                    }
                    res.json({
                        class_rank: classRow?.class_rank || 1,
                        grade_rank: gradeRow?.grade_rank || 1,
                        total_rank: totalRow?.total_rank || 1
                    });
                });
            });
        });
    });
});

module.exports = router;
