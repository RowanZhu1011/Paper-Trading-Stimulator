#!/bin/zsh
cd "/Users/peggy/Documents/New project"
NODE="/Applications/Codex.app/Contents/Resources/node"
PORT="4173"

clear
echo "正在启动模拟炒股训练场..."
echo ""

"$NODE" server.js &
SERVER_PID=$!

sleep 1
open "http://localhost:${PORT}"

echo ""
echo "电脑浏览器会自动打开：http://localhost:${PORT}"
echo ""
echo "手机访问方式："
echo "1. 手机和电脑连接同一个 Wi-Fi"
echo "2. 在手机浏览器输入下面显示的 http://数字.数字.数字.数字:${PORT} 地址"
echo "3. 如果 Mac 弹出防火墙提示，请选择允许"
echo ""
echo "保持这个窗口打开；关闭窗口后网页服务会停止。"
echo ""

wait $SERVER_PID
