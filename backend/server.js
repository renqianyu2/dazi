const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const { initDatabase } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = 8765;

// === Typist Multiplayer State ===
// 使用 Map 存储玩家数据，性能优于普通 Object
const activePlayers = new Map(); 
// { socketId: { userId, username, score, wpm, bestRank: null, lastUpdate } }
let classTotalScore = 0;
const CLASS_GOAL = 10000;
let leaderboardDirty = false;

// 缓存优化：文本数据缓存（避免频繁查询数据库）
const textCache = {
    data: null,
    timestamp: 0,
    TTL: 60000 // 缓存1分钟
};

// 获取缓存的文本数据
function getCachedTexts() {
    const now = Date.now();
    if (textCache.data && (now - textCache.timestamp) < textCache.TTL) {
        return textCache.data;
    }
    return null;
}

// 设置文本缓存
function setTextCache(data) {
    textCache.data = data;
    textCache.timestamp = Date.now();
}

// 玩家 socket 映射表，用于快速查找
const playerSocketMap = new Map(); // socketId -> username

io.on('connection', (socket) => {
    console.log(`[Socket] 新连接: ${socket.id} (当前在线: ${activePlayers.size})`);

    socket.on('join_typist', (data) => {
        if(!data.username || !data.user_id) return;

        // 清理旧的 socket 连接（如果存在）
        for (const [sid, uname] of playerSocketMap.entries()) {
            if (uname === data.username) {
                activePlayers.delete(uname);
                playerSocketMap.delete(sid);
                console.log(`[Socket] 清理旧连接: ${uname} (${sid})`);
                break;
            }
        }

        activePlayers.set(data.username, {
            userId: data.user_id,
            username: data.username,
            socketId: socket.id,
            score: 0,
            wpm: 0,
            bestRank: null,
            lastUpdate: Date.now()
        });
        playerSocketMap.set(socket.id, data.username);
        leaderboardDirty = true;
        console.log(`[Socket] 玩家加入: ${data.username} (${data.user_id}), 当前在线: ${activePlayers.size}`);
    });

    socket.on('update_score', (data) => {
        // 使用映射表快速查找玩家 O(1)
        const username = playerSocketMap.get(socket.id);
        const player = username ? activePlayers.get(username) : null;
        
        if(!player) return;

        // Anti-cheat limit (e.g. max 1000 points per update per 500ms)
        const now = Date.now();
        const scoreDiff = data.score - player.score;
        const timeDiff = now - player.lastUpdate;
        
        if (timeDiff > 0 && (scoreDiff / timeDiff) > 5) {
            console.warn(`[Anti-Cheat] Possible hack detected from user ${player.username}`);
        } else {
            // Update class total based on delta
            if (scoreDiff > 0) {
                classTotalScore += scoreDiff;
                // 使用节流：每2秒广播一次班级进度，避免频繁广播
                if (!this._classProgressThrottle) {
                    io.emit('class_progress_update', { current: classTotalScore, target: CLASS_GOAL });
                    this._classProgressThrottle = true;
                    setTimeout(() => { this._classProgressThrottle = false; }, 2000);
                }
            }
        }
        
        player.score = data.score;
        player.wpm = data.wpm;
        player.lastUpdate = now;

        leaderboardDirty = true;
    });

    socket.on('reset_score', () => {
        const username = playerSocketMap.get(socket.id);
        const player = username ? activePlayers.get(username) : null;
        
        if(!player) return;
        player.score = 0;
        player.lastUpdate = Date.now();
        leaderboardDirty = true;
    });

    socket.on('disconnect', () => {
        const username = playerSocketMap.get(socket.id);
        if (username) {
            activePlayers.delete(username);
            playerSocketMap.delete(socket.id);
            leaderboardDirty = true;
            console.log(`[Socket] 玩家断开: ${username}, 当前在线: ${activePlayers.size}`);
        }
    });
});

// Broadcast Loop - 优化：使用高效的数据结构和批量处理
// 使用 Map 缓存排序结果，减少重复计算
let cachedLeaderboard = [];
let lastBroadcastTime = 0;
const BROADCAST_INTERVAL = 1000; // 1秒广播一次
const MAX_PLAYERS_DISPLAY = 20; // 排行榜最多显示20人

setInterval(() => {
    const now = Date.now();
    if (!leaderboardDirty && (now - lastBroadcastTime) < BROADCAST_INTERVAL) {
        return; // 数据没变化且未到广播间隔，跳过
    }
    
    // 构建排行榜数据
    const list = Array.from(activePlayers.values())
        .map(p => ({ 
            username: p.username, 
            score: p.score, 
            wpm: p.wpm, 
            bestRank: p.bestRank 
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_PLAYERS_DISPLAY); // 只取前20名
    
    // 更新最佳排名
    list.forEach((p, index) => {
        const currentRank = index + 1;
        const playerEntry = activePlayers.get(p.username);
        if (playerEntry && (playerEntry.bestRank === null || currentRank < playerEntry.bestRank)) {
            playerEntry.bestRank = currentRank;
            p.bestRank = playerEntry.bestRank;
        }
    });

    // 检查是否有显著变化才广播（减少不必要的网络传输）
    const hasSignificantChange = cachedLeaderboard.length !== list.length ||
        list.some((p, i) => cachedLeaderboard[i]?.score !== p.score || 
                          cachedLeaderboard[i]?.username !== p.username);
    
    if (hasSignificantChange || (now - lastBroadcastTime) > BROADCAST_INTERVAL * 2) {
        io.emit('leaderboard_update', list);
        cachedLeaderboard = list;
        lastBroadcastTime = now;
    }
    
    leaderboardDirty = false;
}, 500); // 500ms 检查一次，但实际广播会根据需要节流

function getSortedLeaderboard() {
    return Array.from(activePlayers.values())
        .map(p => ({ username: p.username, score: p.score, wpm: p.wpm, bestRank: p.bestRank }))
        .sort((a, b) => b.score - a.score);
}
// ================================

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// 路由
const studentRoutes = require('./routes/student');
const testRoutes = require('./routes/test');
const textRoutes = require('./routes/text');
const adminRoutes = require('./routes/admin');
const practiceRoutes = require('./routes/practice');
const gradeRoutes = require('./routes/grade');
const authRoutes = require('./routes/auth');
const rankingRoutes = require('./routes/ranking');
const testcodeRoutes = require('./routes/testcode');
const scoresRoutes = require('./routes/scores');

app.use('/api/student', studentRoutes);
app.use('/api/test', testRoutes);
app.use('/api/text', textRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/practice', practiceRoutes);
app.use('/api/grade', gradeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/ranking', rankingRoutes);
app.use('/api/testcode', testcodeRoutes);
app.use('/api/scores', scoresRoutes);

// 初始化数据库
initDatabase();

// 启动服务器
server.listen(PORT, () => {
  console.log(`\n🚀 服务器启动成功！`);
  console.log(`\n学生端访问地址：`);
  console.log(`  本机：http://localhost:${PORT}`);
  console.log(`  局域网：http://你的IP地址:${PORT}`);
  console.log(`\n管理端访问地址：`);
  console.log(`  http://localhost:${PORT}/admin/login.html`);
  console.log(`\n默认管理员账号：`);
  console.log(`  用户名：admin`);
  console.log(`  密码：admin123\n`);
  console.log(`\nWebSocket 已在端口 ${PORT} 启动 (Typist Multiplayer)\n`);
});
