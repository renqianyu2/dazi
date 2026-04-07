#!/bin/bash

DB_FILE="database.db"
BACKUP_DIR="backup"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/database_${TIMESTAMP}.db"

echo "========================================"
echo "     数据库同步工具 v1.0"
echo "========================================"
echo "1. 备份数据库到本地"
echo "2. 上传到GitHub"
echo "3. 从GitHub下载并导入"
echo "4. 双向同步 (本地与GitHub)"
echo "0. 退出"
echo "========================================"
echo -n "请选择操作 [0-4]: "
read choice

case $choice in
    1)
        echo ""
        echo ">>> 开始备份数据库..."
        
        if [ ! -f "$DB_FILE" ]; then
            echo "错误: 数据库文件 $DB_FILE 不存在!"
            exit 1
        fi
        
        mkdir -p "$BACKUP_DIR"
        cp "$DB_FILE" "$BACKUP_FILE"
        
        if [ -f "database.db-wal" ]; then
            cp "database.db-wal" "${BACKUP_FILE}-wal"
        fi
        if [ -f "database.db-shm" ]; then
            cp "database.db-shm" "${BACKUP_FILE}-shm"
        fi
        
        echo "备份成功: $BACKUP_FILE"
        echo ""
        echo "本地备份文件列表:"
        ls -lh "${BACKUP_DIR}"/database_*.db 2>/dev/null | tail -5
        ;;

    2)
        echo ""
        echo ">>> 准备上传到GitHub..."
        
        if [ ! -f "$DB_FILE" ]; then
            echo "错误: 数据库文件不存在!"
            exit 1
        fi
        
        echo "检查Git状态..."
        if [ ! -d ".git" ]; then
            echo "错误: 当前目录不是Git仓库!"
            exit 1
        fi
        
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        cp "$DB_FILE" "${DB_FILE}.bak"
        
        git add "$DB_FILE" "database.db-wal" "database.db-shm" 2>/dev/null
        
        git status
        
        echo ""
        echo -n "确认提交并推送? (y/n): "
        read confirm
        if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
            git commit -m "backup: 数据库更新 ${TIMESTAMP}"
            git push origin main
            echo "上传成功!"
        else
            echo "已取消"
        fi
        ;;

    3)
        echo ""
        echo ">>> 从GitHub下载并导入数据库..."
        
        echo -n "此操作会覆盖本地数据库,确认继续? (y/n): "
        read confirm
        if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
            echo "已取消"
            exit 0
        fi
        
        echo "拉取最新代码..."
        git pull origin main
        
        if [ -f "database.db" ]; then
            TIMESTAMP=$(date +%Y%m%d_%H%M%S)
            if [ ! -d "$BACKUP_DIR" ]; then
                mkdir -p "$BACKUP_DIR"
            fi
            cp "database.db" "${BACKUP_DIR}/database_local_${TIMESTAMP}.db"
            echo "已备份当前本地数据库到: ${BACKUP_DIR}/database_local_${TIMESTAMP}.db"
            echo "下载并导入成功!"
        else
            echo "错误: GitHub上未找到数据库文件"
        fi
        ;;

    4)
        echo ""
        echo ">>> 双向同步..."
        
        echo "检测网络连接..."
        if ! git pull origin main 2>&1 | grep -q "Already up to date\|Updating\|Merge"; then
            echo "注意: 无法连接GitHub,将使用本地数据库"
            echo "本地数据库保持不变"
        else
            echo ""
            echo "GitHub上有更新,已合并到本地"
        fi
        
        if [ -f "database.db" ]; then
            echo ""
            echo "准备上传本地更新..."
            TIMESTAMP=$(date +%Y%m%d_%H%M%S)
            git add "$DB_FILE" "database.db-wal" "database.db-shm" 2>/dev/null
            
            if git diff --cached --stat | grep -q "database"; then
                git commit -m "sync: 双向同步数据库 ${TIMESTAMP}"
                git push origin main
                echo "同步完成!"
            else
                echo "数据库无变化,无需上传"
            fi
        fi
        ;;

    0)
        echo "退出"
        exit 0
        ;;

    *)
        echo "无效选择"
        exit 1
        ;;
esac

echo ""
echo "操作完成!"