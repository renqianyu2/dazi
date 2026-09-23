const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./database.db');
const gradeLabels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级'];
const SCHOOL = '谷山学校';

// 名单: [name, grade, class_number]  来自用户提供的六/七年级花名册
const roster = [
  ['胡梓嫣', 6, 1], ['杨书淼', 6, 1], ['阮艳慧', 6, 1],
  ['余亚瞳', 6, 2], ['文雨馨', 6, 2],
  ['万柏萱', 6, 3], ['陈红莹', 6, 3], ['徐梦涵', 6, 3],
  ['黄彦慧', 6, 4],
  ['姜若彤', 6, 5], ['范瑾汐', 6, 5], ['肖雨薇', 6, 5], ['孙锦菡', 6, 5],
  ['高鑫悦', 7, 1], ['胡紫琳', 7, 1],
  ['李雨婷', 7, 2], ['李子瑶', 7, 2],
  ['王诗语', 7, 3], ['刘嘉怡', 7, 3],
  ['席诗颖', 7, 4], ['周泽霜', 7, 4], ['肖成洁', 7, 4],
  ['周文馨', 7, 5], ['张语妍', 7, 5], ['陈嘉棋', 7, 5],
  ['赵安心', 7, 6], ['柴诗语', 7, 6], ['卢敏萱', 7, 6], ['夏芷涵', 7, 6], ['陶美怡', 7, 6],
  ['孙嘉美', 7, 8], ['秦美辰', 7, 8], ['刘书源', 7, 8],
];

function getNextStudentNo(grade, classNumber) {
  const prefix = `GS${String(grade).padStart(2, '0')}${String(classNumber).padStart(2, '0')}`;
  return new Promise((resolve, reject) => {
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

async function run(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (e) { e ? reject(e) : resolve(this); });
  });
}

async function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows));
  });
}

async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

async function main() {
  const hash = bcrypt.hashSync('123456', 10);
  const rosterNames = new Set(roster.map(([n]) => n));

  // 1) 删除名单外的六、七年级学生
  const old67 = await all('SELECT id, name, grade, class_number, class FROM students WHERE grade IN (6,7)');
  let deleted = 0;
  for (const s of old67) {
    if (!rosterNames.has(s.name)) {
      await run('DELETE FROM students WHERE id = ?', [s.id]);
      console.log(`DELETE ${s.name} ${s.class} (不在名单)`);
      deleted++;
    } else {
      console.log(`KEEP   ${s.name} ${s.class} (在名单中,稍后校准)`);
    }
  }

  // 2) 按名单插入/改班
  let inserted = 0, updated = 0, skipped = 0;
  for (const [name, grade, classNumber] of roster) {
    const classText = `${gradeLabels[grade - 1]}${classNumber}班`;
    const byName = await get('SELECT id, name, grade, class_number, class, school FROM students WHERE name = ? ORDER BY id LIMIT 1', [name]);

    if (byName) {
      if (byName.grade === grade && byName.class_number === classNumber) {
        console.log(`SKIP   ${name}: 已在 ${classText}`);
        skipped++;
      } else {
        await run('UPDATE students SET grade = ?, class_number = ?, class = ? WHERE id = ?',
          [grade, classNumber, classText, byName.id]);
        console.log(`UPDATE ${name}: ${byName.class} -> ${classText}`);
        updated++;
      }
      continue;
    }

    const studentNo = await getNextStudentNo(grade, classNumber);
    await run(
      'INSERT INTO students (name, school, grade, class_number, class, student_no, password) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, SCHOOL, grade, classNumber, classText, studentNo, hash]
    );
    console.log(`INSERT ${name}: ${classText} ${studentNo}`);
    inserted++;
  }

  console.log(`\n完成: 新增 ${inserted}, 改班 ${updated}, 跳过 ${skipped}, 删除 ${deleted}`);

  const after = await all(
    'SELECT grade, class_number, class, COUNT(*) c FROM students WHERE grade IN (6,7) GROUP BY grade, class_number ORDER BY grade, class_number'
  );
  console.log('\n替换后六/七年级:');
  after.forEach(r => console.log(`  ${r.class}: ${r.c}`));
  const total = await get('SELECT COUNT(*) c FROM students WHERE grade IN (6,7)');
  console.log(`合计: ${total.c}`);

  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
