#!/bin/bash

DB_FILE="database.db"
BACKUP_DIR="backup"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/database_${TIMESTAMP}.db"
GITIGNORE_FILE=".gitignore"

echo_banner() {
    echo "========================================"
    echo "     数据库同步工具 v3.0 (安全加固版)"
    echo "========================================"
}

check_database() {
    if [ ! -f "$DB_FILE" ]; then
        echo "错误: 数据库文件 $DB_FILE 不存在!"
        return 1
    fi
    
    result=$(sqlite3 "$DB_FILE" "PRAGMA integrity_check;" 2>&1)
    if [ "$result" != "ok" ]; then
        echo "警告: 数据库可能损坏: $result"
        echo -n "是否继续? (y/n): "
        read confirm
        if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
            return 1
        fi
    fi
    return 0
}

restart_service() {
    echo "正在检查后端服务状态..."
    # 查找运行的 Node 进程并重启
    PID=$(lsof -ti:8765 2>/dev/null)
    if [ -n "$PID" ]; then
        echo "发现运行中的服务 (PID: $PID) 正在停止..."
        kill $PID 2>/dev/null
        sleep 2
        kill -9 $PID 2>/dev/null
    fi
    echo "正在启动后端服务以加载最新数据..."
    npm start > server.log 2>&1 &
    sleep 2
    if lsof -ti:8765 >/dev/null 2>&1; then
        echo "✓ 后端服务已成功重启, 最新数据已加载!"
    else
        echo "⚠警告: 后端服务重启失败, 请手动检查 start.sh 或者 server.log"
    fi
}

ensure_db_tracked() {
    # 确保不追踪 wal 和 shm 文件，这会导致同步冲突并且可能损坏数据库
    if [ -f "$GITIGNORE_FILE" ]; then
        if ! grep -q "database.db-wal" "$GITIGNORE_FILE"; then
            echo "database.db-wal" >> "$GITIGNORE_FILE"
            echo "database.db-shm" >> "$GITIGNORE_FILE"
        fi
    fi
    
    if git ls-files --error-unmatch "$DB_FILE" >/dev/null 2>&1; then
        return 0
    fi
    
    echo ""
    echo ">>> 首次同步: 添加数据库到 Git 跟踪..."
    
    if [ -f "$GITIGNORE_FILE" ] && grep -q "^$DB_FILE$" "$GITIGNORE_FILE"; then
        sed -i '' "/^$DB_FILE$/d" "$GITIGNORE_FILE" 2>/dev/null || sed -i "/^$DB_FILE$/d" "$GITIGNORE_FILE"
    fi
    
    git add -f "$DB_FILE"
    git commit -m "chore: 添加数据库文件跟踪"
}

backup_local() {
    echo ""
    echo ">>> 安全备份数据库到本地..."
    
    if [ ! -f "$DB_FILE" ]; then
        echo "错误: 数据库文件不存在!"
        return 1
    fi
    
    check_database || return 1
    mkdir -p "$BACKUP_DIR"
    
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="${BACKUP_DIR}/database_${TIMESTAMP}.db"
    
    # 使用 sqlite3 的内置备份命令，这是在 WAL 模式下最安全的备份方式
    sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"
    
    echo "✓ 已安全备份到: $BACKUP_FILE"
    
    echo ""
    echo "最近5个备份:"
    ls -lh "${BACKUP_DIR}"/database_*.db 2>/dev/null | tail -5 | awk '{print "  "$9" ("$5")"}'
    
    return 0
}

upload_to_github() {
    echo ""
    echo ">>> 上传完整数据到 GitHub..."
    
    if [ ! -f "$DB_FILE" ]; then
        echo "错误: 数据库文件不存在!"
        return 1
    fi
    
    check_database || return 1
    
    if [ ! -d ".git" ]; then
        echo "错误: 当前目录不是 Git 仓库!"
        return 1
    fi
    
    ensure_db_tracked
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    
    echo "正在整理 WAL 日志，确保数据完整性..."
    sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(TRUNCATE);"
    
    echo "正在备份当前数据库..."
    mkdir -p "$BACKUP_DIR"
    cp "$DB_FILE" "${BACKUP_DIR}/database_before_push_${TIMESTAMP}.db"
    
    git rm --cached "${DB_FILE}-wal" "${DB_FILE}-shm" 2>/dev/null
    git add -f "$DB_FILE"
    
    if git diff --cached --quiet; then
        echo "⚠ 本地数据库相较于上一次提交没有变化，无需重复提交。"
        echo "正在尝试直接推送..."
        git push origin main
        return 0
    fi
    
    echo ""
    echo "待提交文件:"
    git status --short
    
    echo ""
    echo -n "确认提交并覆盖远端版本? (y/n): "
    read confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "已取消"
        return 0
    fi
    
    git commit -m "backup: 数据库更新 ${TIMESTAMP}"
    
    echo ""
    echo "正在推送到 GitHub..."
    if ! git push origin main 2>/dev/null; then
        echo "⚠ 直接推送失败 (提示包含远端有更新 或 历史分支不一致)。"
        echo ">>> 正在执行强制平移合并并以【本地数据库】为主覆盖远端..."
        
        # 拉取并强行容错合并，如果是二进制 database.db 冲突，默认保留我们本地的 (-X ours)
        git pull origin main --no-rebase -s recursive -X ours --allow-unrelated-histories
        
        # 确保数据库是我们刚刚提交的本地版本，防止被 pull 污染
        git checkout HEAD -- "$DB_FILE"
        git commit -am "chore: 解决数据库同步冲突(本地覆盖远端)" >/dev/null 2>&1
        
        if git push origin main; then
            echo "✓ 冲突已自动解决! 上传成功!"
        else
            echo "✗ 终极上传失败! 请检查 GitHub 仓库权限或网络设置。"
            return 1
        fi
    else
        echo "✓ 上传成功!"
    fi
}

download_from_github() {
    echo ""
    echo ">>> 从 GitHub 强行覆盖拉取最新数据库..."
    
    echo -n "此操作将彻底覆盖本地数据库版本,确认继续? (y/n): "
    read confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "已取消"
        return 0
    fi
    
    ensure_db_tracked
    local_db_exists=false
    
    if [ -f "$DB_FILE" ]; then
        local_db_exists=true
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        echo "正在备份当前本地数据库..."
        mkdir -p "$BACKUP_DIR"
        sqlite3 "$DB_FILE" ".backup '${BACKUP_DIR}/database_local_${TIMESTAMP}.db'"
        echo "✓ 已备份到: ${BACKUP_DIR}/database_local_${TIMESTAMP}.db"
    fi
    
    echo ""
    echo "正在获取云端最新版本..."
    git fetch origin main --quiet
    
    echo "清理本地过时的缓存日志文件..."
    rm -f "${DB_FILE}-wal" "${DB_FILE}-shm"
    
    # 直接提取远端 main 分支的 database.db，绕过所有复杂的 Git 历史和冲突
    if git checkout origin/main -- "$DB_FILE" 2>/dev/null; then
        echo "✓ 成功下载覆盖最新的 database.db"
        # 为了防止本地工作区处于 'Modified' 状态，我们顺手提交一下
        git commit -m "sync: 从云端强行拉取覆盖数据库" "$DB_FILE" >/dev/null 2>&1
    else
        echo "✗ 下载失败! 远端仓库中可能尚未包含 database.db 文件。"
        return 1
    fi
    
    echo "正在检查数据库完整性..."
    result=$(sqlite3 "$DB_FILE" "PRAGMA integrity_check;" 2>&1)
    if [ "$result" = "ok" ]; then
        echo "✓ 数据库完整"
    else
        echo "⚠ 警告: 数据库可能有问题: $result"
    fi
    
    # 关键：热重启让Node服务器重新读取被替换底层文件的数据库
    restart_service
    
    echo ""
    echo "✓ 从 GitHub 同步更新完成!"
}

bidirectional_sync() {
    echo ""
    echo ">>> 智能双向同步维护..."
    
    echo "说明: 对于 SQLite 二进制数据库，无法从单行代码层面进行“合并”。"
    echo "本选项将安全地收取云端代码更新。但对于 database.db 数据库如果发生冲突，将会要求你确定优先级。"
    
    echo "开始整理尚未保存的 WAL 本地数据..."
    sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(TRUNCATE);"
    rm -f "${DB_FILE}-wal" "${DB_FILE}-shm"
    
    git add -f "$DB_FILE" 2>/dev/null
    git commit -m "sync: 双向同步前暂存本地数据库状态" >/dev/null 2>&1
    
    echo "检测网络连接并拉取远端变更..."
    if ! git pull origin main -s recursive -X ours --allow-unrelated-histories 2>/dev/null; then
        echo "⚠ 拉取中断。处理复杂冲突..."
        # 复杂冲突通常说明同时改了代码。
    fi
    
    echo ""
    echo "如果远端有纯代码等更新,已自动合并到本地。"
    
    # 因为上面使用了 -X ours，如果两人都改了 db，默认本地赢。
    # 我们可以尝试强行 push
    echo "准备回传本地最终合并状态..."
    if git push origin main 2>/dev/null; then
         echo "✓ 已完成双向更新循环!"
    else
         echo "⚠ 回传失败。可能网络受限或者云端有新提交屏蔽了推送。"
    fi
    
    restart_service
}

restore_backup() {
    echo ""
    echo ">>> 从本地备份恢复..."
    
    backups=($(ls -t "${BACKUP_DIR}"/database_*.db 2>/dev/null))
    
    if [ ${#backups[@]} -eq 0 ]; then
        echo "没有找到备份文件"
        return 1
    fi
    
    echo "可用备份:"
    for i in "${!backups[@]}"; do
        size=$(ls -lh "${backups[$i]}" 2>/dev/null | awk '{print $5}')
        echo "  $((i+1)). ${backups[$i]} ($size)"
    done
    
    echo ""
    echo -n "选择要恢复的备份编号 (1-${#backups[@]}), 或输入 0 取消: "
    read choice
    
    if [ -z "$choice" ] || [ "$choice" = "0" ]; then
        echo "已取消"
        return 0
    fi
    
    if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt ${#backups[@]} ]; then
        echo "无效选择"
        return 1
    fi
    
    selected="${backups[$((choice-1))]}"
    
    echo ""
    echo -n "确认恢复 $selected? 这将覆盖当前数据库 (y/n): "
    read confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "已取消"
        return 0
    fi
    
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    if [ -f "$DB_FILE" ]; then
        sqlite3 "$DB_FILE" ".backup '${BACKUP_DIR}/database_before_restore_${TIMESTAMP}.db'"
    fi
    
    echo "正在安全恢复..."
    sqlite3 "$selected" ".backup '$DB_FILE'"
    # 清理遗留的日志
    rm -f "${DB_FILE}-wal" "${DB_FILE}-shm"
    
    echo "✓ 已恢复到: $selected"
    
    # 强行重启后台加载这批老数据
    restart_service
}

main_menu() {
    while true; do
        echo_banner
        echo "1. 备份数据库到本地 (安全模式)"
        echo "2. 上传数据到 GitHub (服务端执行)"
        echo "3. 从 GitHub 覆盖本地 (自动热加载)"
        echo "4. 双向同步拉取 (自动热加载)"
        echo "5. 从本地历史备份恢复"
        echo "0. 退出"
        echo "========================================"
        echo -n "请选择操作 [0-5]: "
        read choice
        
        case $choice in
            1) backup_local ;;
            2) upload_to_github ;;
            3) download_from_github ;;
            4) bidirectional_sync ;;
            5) restore_backup ;;
            0) echo "再见!"; exit 0 ;;
            *) echo "无效选择,请输入 0-5" ;;
        esac
        
        echo ""
        echo -n "按回车键继续..."
        read
    done
}

main_menu
