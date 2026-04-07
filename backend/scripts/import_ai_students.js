const bcrypt = require('bcrypt');
const { db } = require('../database');

const studentsData = [
    // 三年级 (1)班
    { name: '魏佳颖', grade: 3, class_number: 1 },
    { name: '张君雅', grade: 3, class_number: 1 },
    { name: '周雯', grade: 3, class_number: 1 },
    { name: '何书涵', grade: 3, class_number: 1 },
    { name: '鲁慧欣', grade: 3, class_number: 1 },
    
    // 三年级 (2)班
    { name: '谢正杨', grade: 3, class_number: 2 },
    { name: '万佳成', grade: 3, class_number: 2 },
    { name: '张宇泽', grade: 3, class_number: 2 },
    { name: '龚宸宇', grade: 3, class_number: 2 },
    { name: '张峻杨', grade: 3, class_number: 2 },
    
    // 三年级 (3)班
    { name: '周净好', grade: 3, class_number: 3 },
    { name: '李浩然', grade: 3, class_number: 3 },
    { name: '张城宇', grade: 3, class_number: 3 },
    { name: '唐楚玥', grade: 3, class_number: 3 },
    { name: '周琪涵', grade: 3, class_number: 3 },
    
    // 五年级 (1)班
    { name: '程心怡', grade: 5, class_number: 1 },
    { name: '赵善如', grade: 5, class_number: 1 },
    { name: '冯语萱', grade: 5, class_number: 1 },
    { name: '毕佳欣', grade: 5, class_number: 1 },
    { name: '何天星', grade: 5, class_number: 1 },
    
    // 五年级 (2)班
    { name: '吴艺冉', grade: 5, class_number: 2 },
    { name: '谭晓苒', grade: 5, class_number: 2 },
    { name: '夏于凡', grade: 5, class_number: 2 },
    { name: '申采菲扬', grade: 5, class_number: 2 },
    { name: '宋慧怡', grade: 5, class_number: 2 },
    
    // 六年级 (1)班
    { name: '任子怡', grade: 6, class_number: 1 },
    { name: '张玉龙', grade: 6, class_number: 1 },
    { name: '尚厚材', grade: 6, class_number: 1 },
    { name: '龚俊哲', grade: 6, class_number: 1 },
    { name: '刘思雨', grade: 6, class_number: 1 },
    
    // 六年级 (2)班
    { name: '陈沙蕊', grade: 6, class_number: 2 },
    { name: '汤欣磊', grade: 6, class_number: 2 },
    { name: '孙瑞燃', grade: 6, class_number: 2 },
    { name: '陈登阳', grade: 6, class_number: 2 },
    { name: '熊天成', grade: 6, class_number: 2 }
];

const school = '中华路小学';
const defaultPassword = '123456';
const defaultPasswordHash = bcrypt.hashSync(defaultPassword, 10);
const gradeLabels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级'];

function generateStudentNo(db, school, grade, classNumber, callback) {
    const gradeStr = String(grade).padStart(2, '0');
    const classStr = String(classNumber).padStart(2, '0');
    const schoolPrefix = school === '谷山学校' ? 'GS' : 'ZHL';

    db.get(
      'SELECT COUNT(*) as count FROM students WHERE school = ? AND grade = ? AND class_number = ?',
      [school, grade, classNumber],
      (err, row) => {
        if (err) return callback(err);
        const studentNum = String(row.count + 1).padStart(2, '0');
        callback(null, `${schoolPrefix}${gradeStr}${classStr}${studentNum}`);
      }
    );
  }

async function insertStudent(s) {
    return new Promise((resolve, reject) => {
        generateStudentNo(db, school, s.grade, s.class_number, (err, student_no) => {
            if (err) return reject(err);
            const classText = `${gradeLabels[s.grade - 1]}${s.class_number}班`;
            db.run(
                'INSERT INTO students (name, school, grade, class_number, class, student_no, password) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [s.name, school, s.grade, s.class_number, classText, student_no, defaultPasswordHash],
                function(err) {
                    if (err) {
                        console.error('Failed to insert ' + s.name, err);
                        resolve(false);
                    } else {
                        console.log(`Inserted ${s.name} - ${school} - ${classText} - ${student_no}`);
                        resolve(true);
                    }
                }
            );
        });
    });
}

async function run() {
    console.log('Starting data import...');
    for (const student of studentsData) {
        // we await sequentially because generateStudentNo relies on COUNT(*)
        await insertStudent(student);
    }
    console.log('Import complete.');
    db.close();
}

run();
