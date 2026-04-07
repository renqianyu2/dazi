#!/bin/bash

PORT=8765

check_port() {
    lsof -ti:$PORT > /dev/null 2>&1
    return $?
}

stop_service() {
    if check_port; then
        echo "正在停止服务..."
        PID=$(lsof -ti:$PORT)
        kill $PID 2>/dev/null
        sleep 2
        if check_port; then
            kill -9 $PID 2>/dev/null
        fi
        echo "✅ 服务已停止"
    else
        echo "⚠️  服务未运行"
    fi
}

start_service() {
    if check_port; then
        echo "⚠️  服务已在运行中"
        return 1
    fi

    echo "正在启动服务..."
    npm start > server.log 2>&1 &
    sleep 2

    if check_port; then
        echo "✅ 服务启动成功！"
        echo ""
        echo "📍 访问地址:"
        echo "   学生入口: http://localhost:$PORT/index.html"
        echo "   管理员入口: http://localhost:$PORT/admin/dashboard.html"
    else
        echo "❌ 服务启动失败，请查看 server.log"
        return 1
    fi
}

restart_service() {
    echo "正在重启服务..."
    stop_service
    sleep 1
    start_service
}

status_service() {
    if check_port; then
        PID=$(lsof -ti:$PORT)
        echo "✅ 服务运行中 (PID: $PID)"
        echo ""
        echo "📍 访问地址:"
        echo "   学生入口: http://localhost:$PORT/index.html"
        echo "   管理员入口: http://localhost:$PORT/admin/dashboard.html"
    else
        echo "❌ 服务未运行"
    fi
}

show_menu() {
    echo ""
    echo "================================"
    echo "   拼音打字测试系统 - 服务管理"
    echo "================================"
    echo "1. 启动服务"
    echo "2. 停止服务"
    echo "3. 重启服务"
    echo "4. 查看状态"
    echo "5. 退出"
    echo "================================"
    echo -n "请选择操作 [1-5]: "
}

while true; do
    show_menu
    read choice

    case $choice in
        1)
            start_service
            ;;
        2)
            stop_service
            ;;
        3)
            restart_service
            ;;
        4)
            status_service
            ;;
        5)
            echo "再见！"
            exit 0
            ;;
        *)
            echo "❌ 无效选择，请输入 1-5"
            ;;
    esac

    echo ""
    echo -n "按回车键继续..."
    read
done
