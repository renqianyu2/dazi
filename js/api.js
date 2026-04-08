// API基础URL
const API_BASE = '/api';

// 学生注册
async function register(name, school, grade, classNumber, password, confirmPassword) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, school, grade, class_number: classNumber, password, confirmPassword })
  });
  return res.json();
}

// 学生登录
async function login(identifier, school, grade, classNumber, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, school, grade, class_number: classNumber, password })
  });
  return res.json();
}

// 学生登录（旧版，保持兼容）
async function studentLogin(name, studentClass, studentNo) {
  const res = await fetch(`${API_BASE}/student/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, class: studentClass, student_no: studentNo })
  });
  return res.json();
}

// 获取学生信息
async function getStudentProfile(studentId) {
  const res = await fetch(`${API_BASE}/student/profile/${studentId}`);
  return res.json();
}

// 获取随机文本
async function getRandomText(level = 'level1') {
  const res = await fetch(`${API_BASE}/text/random?level=${level}`);
  return res.json();
}

// 提交测试结果
async function submitTest(data) {
  const res = await fetch(`${API_BASE}/test/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
}

// 获取排行榜
async function getRanking() {
  const res = await fetch(`${API_BASE}/test/ranking`);
  return res.json();
}

// 获取在线人数
async function getOnlineCount() {
  const res = await fetch(`${API_BASE}/test/online`);
  return res.json();
}

// 管理员登录
async function adminLogin(username, password) {
  const res = await fetch(`${API_BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return res.json();
}

// 获取特定班级学生列表
async function getStudentsByClass(school, grade, classNumber) {
  const res = await fetch(`${API_BASE}/student/list?school=${encodeURIComponent(school)}&grade=${grade}&class_number=${classNumber}`);
  return res.json();
}

// 获取所有学生
async function getAllStudents() {
  const res = await fetch(`${API_BASE}/admin/students`);
  return res.json();
}

// 获取学生详情
async function getStudentDetail(studentId) {
  const res = await fetch(`${API_BASE}/admin/student/${studentId}`);
  return res.json();
}

// 删除学生
async function deleteStudent(studentId) {
  const res = await fetch(`${API_BASE}/admin/student/${studentId}`, {
    method: 'DELETE'
  });
  return res.json();
}

// 管理员创建学生（用于导入）
async function adminCreateStudent(name, school, grade, classNumber) {
  const res = await fetch(`${API_BASE}/admin/student`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, school, grade, class_number: classNumber })
  });
  return res.json();
}

// 获取文本库
async function getAllTexts() {
  const res = await fetch(`${API_BASE}/admin/texts`);
  return res.json();
}

// 添加文本
async function addText(content, level, category) {
  const res = await fetch(`${API_BASE}/admin/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, level, category })
  });
  return res.json();
}

// 更新文本
async function updateText(textId, content, level, category) {
  const res = await fetch(`${API_BASE}/admin/text/${textId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, level, category })
  });
  return res.json();
}

// 删除文本
async function deleteText(textId) {
  const res = await fetch(`${API_BASE}/admin/text/${textId}`, {
    method: 'DELETE'
  });
  return res.json();
}

// 获取统计数据
async function getStatistics() {
  const res = await fetch(`${API_BASE}/admin/statistics`);
  return res.json();
}
// 保存练习记录
async function submitPractice(data) {
  const res = await fetch(`${API_BASE}/practice/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return res.json();
}

// 获取练习记录
async function getPracticeRecords(studentId) {
  const res = await fetch(`${API_BASE}/practice/records/${studentId}`);
  return res.json();
}

// 获取练习统计
async function getPracticeStats(studentId) {
  const res = await fetch(`${API_BASE}/practice/stats/${studentId}`);
  return res.json();
}

// 获取星际字航员最高分排行榜
async function getInterstellarHighestScoreRanking(limit = 10) {
  const res = await fetch(`${API_BASE}/ranking/interstellar-typist/highest-score?limit=${limit}`);
  return res.json();
}

// 获取正式测试排行榜
async function getTestRanking() {
  const res = await fetch(`${API_BASE}/test/ranking`);
  return res.json();
}

// 获取练习记录排行榜 - 多维度
async function getPracticeRanking(mode, field = 'score', limit = 50) {
  const res = await fetch(`${API_BASE}/practice/ranking/${mode}?field=${field}&limit=${limit}`);
  return res.json();
}

// 获取学生最佳记录
async function getStudentBestRecords(studentId, mode) {
  const res = await fetch(`${API_BASE}/practice/best/${studentId}${mode ? `?mode=${mode}` : ''}`);
  return res.json();
}

// 获取练习趋势数据
async function getPracticeTrend(studentId, mode, days = 30) {
  const res = await fetch(`${API_BASE}/practice/trend/${studentId}?mode=${mode}&days=${days}`);
  return res.json();
}

// 获取增强版练习统计
async function getEnhancedPracticeStats(mode, grade, classNumber) {
  let url = `${API_BASE}/practice/stats`;
  const params = [];
  if (mode) params.push(`mode=${mode}`);
  if (grade) params.push(`grade=${grade}`);
  if (classNumber) params.push(`class_number=${classNumber}`);
  if (params.length > 0) url += '?' + params.join('&');
  const res = await fetch(url);
  return res.json();
}

// 获取练习记录（增强版，支持日期筛选）
async function getPracticeRecordsEx(studentId, mode, grade, classNumber, startDate, endDate) {
  let url = `${API_BASE}/practice/records`;
  const params = [];
  if (studentId) params.push(`student_id=${studentId}`);
  if (mode) params.push(`mode=${mode}`);
  if (grade) params.push(`grade=${grade}`);
  if (classNumber) params.push(`class_number=${classNumber}`);
  if (startDate) params.push(`start_date=${startDate}`);
  if (endDate) params.push(`end_date=${endDate}`);
  if (params.length > 0) url += '?' + params.join('&');
  const res = await fetch(url);
  return res.json();
}

// ==================== 练习积分系统 ====================

// 获取学生积分
async function getStudentScores(studentId) {
  const res = await fetch(`${API_BASE}/scores/${studentId}`);
  return res.json();
}

// 更新学生积分（每次练习后调用）
async function updateStudentScores(studentId) {
  const res = await fetch(`${API_BASE}/scores/update/${studentId}`, {
    method: 'POST'
  });
  return res.json();
}

// 获取积分排行榜
async function getScoresRanking(field = 'total_score', limit = 50, grade, classNumber) {
  let url = `${API_BASE}/scores/ranking/${field}?limit=${limit}`;
  if (grade) url += `&grade=${grade}`;
  if (classNumber) url += `&class_number=${classNumber}`;
  const res = await fetch(url);
  return res.json();
}

// 获取学生在班级/年级/全校的排名
async function getStudentRank(studentId, grade, classNumber) {
  let url = `${API_BASE}/scores/rank/${studentId}`;
  const params = [];
  if (grade) params.push(`grade=${grade}`);
  if (classNumber) params.push(`class_number=${classNumber}`);
  if (params.length > 0) url += '?' + params.join('&');
  const res = await fetch(url);
  return res.json();
}