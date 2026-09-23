const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./database.db');
const gradeLabels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级'];

// 名单: [name, grade, class_number]
const roster = [
  ['刘让溪', 2, 1], ['彭佳钰', 2, 1], ['马鸿铭', 2, 2], ['吴一', 2, 2],
  ['王一鸣', 2, 3], ['汪博轩', 2, 3], ['任婧媛', 2, 4], ['李卿墨', 2, 4],
  ['熊依然', 2, 5], ['王雨豪', 2, 5], ['胡兴杰', 2, 6], ['艾梦辰', 2, 6],
  ['张妤希', 3, 1], ['邹业郎', 3, 1], ['刘子妤', 3, 2], ['庄俊纬', 3, 2],
  ['钟歆翊', 3, 2], ['张孝臻', 3, 3], ['舒梓琪', 3, 4], ['戴铭泽', 3, 4],
  ['胡喻博', 5, 1], ['陈梓涵', 5, 1], ['宋林峰', 5, 2],
  ['胡广第', 5, 3], ['王俊杰', 5, 3], ['马文杰', 5, 3], ['冯嘉晨', 5, 3], ['赵彬睿', 5, 3],
  ['景晨旭', 5, 4], ['阮敬洪', 5, 4],
  ['李睿雪', 4, 1], ['刘梦洁', 4, 1],
  ['阳浩宇', 4, 2], ['苗悦欣', 4, 2], ['苗悦然', 4, 2], ['龚子媱', 4, 2], ['石欣雨', 4, 2],
  ['陈嘉一', 4, 3], ['陈俊逸', 4, 3], ['陈梓璇', 4, 3],
  ['周亦辰', 4, 4], ['高文卓', 4, 4],
  ['张浩宇', 4, 5], ['彭玉瑶', 4, 5],
];

const SCHOOL = '谷山学校';

function getNextStudentNo(grade, classNumber) {
  const prefix = `GS${String(grade).padStart(2, '0')}${String(classNumber).padStart(2, '0')}`;
  return new Promise((resolve, reject) => {
    // 按学号前缀取最大序号，并保证全局唯一（年级升级后旧学号年级段可能重叠）
    db.get(
      `SELECT MAX(CAST(SUBSTR(student_no, -2) AS INTEGER)) as max_seq
       FROM students WHERE student_no LIKE ?`,
      [`${prefix}%`],
      (err, row) => {
        if (err) return reject(err);
        let seq = (row?.max_seq || 0) + 1;
        const tryNext = () => {
          const candidate = `${prefix}${String(seq).padStart(2, '0')}`;
          db.get('SELECT 1 FROM students WHERE student_no = ?', [candidate], (e2, hit) => {
            if (e2) return reject(e2);
            if (hit) { seq++; return tryNext(); }
            resolve(candidate);
          });
        };
        tryNext();
      }
    );
  });
}

async function main() {
  const hash = bcrypt.hashSync('123456', 10);
  const existing = await new Promise((res, rej) =>
    db.all('SELECT name, grade, class_number FROM students', [], (e, r) => e ? rej(e) : res(r))
  );
  const byName = new Map(existing.map(s => [s.name, s]));

  let inserted = 0, updated = 0, skipped = 0;

  for (const [name, grade, classNumber] of roster) {
    const classText = `${gradeLabels[grade - 1]}${classNumber}班`;
    const found = byName.get(name);

    if (found) {
      if (found.grade !== grade || found.class_number !== classNumber) {
        await new Promise((res, rej) =>
          db.run('UPDATE students SET grade = ?, class_number = ?, class = ? WHERE name = ?',
            [grade, classNumber, classText, name], function (e) { e ? rej(e) : res(this); })
        );
        console.log(`UPDATE ${name}: -> ${classText}`);
        updated++;
      } else {
        console.log(`SKIP   ${name}: 已存在 ${classText}`);
        skipped++;
      }
      continue;
    }

    const studentNo = await getNextStudentNo(grade, classNumber);
    await new Promise((res, rej) =>
      db.run(
        'INSERT INTO students (name, school, grade, class_number, class, student_no, password) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, SCHOOL, grade, classNumber, classText, studentNo, hash],
        function (e) { e ? rej(e) : res(this); }
      )
    );
    console.log(`INSERT ${name}: ${classText} ${studentNo}`);
    inserted++;
  }

  console.log(`\n完成: 新增 ${inserted}, 修改 ${updated}, 跳过 ${skipped}`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
