@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 学习通刷课脚本-后台
node -v >nul 2>nul
if errorlevel 1 goto nonode
echo 纯后台运行（无窗口）。前提：已经用 start.cmd 完成过一次登录。
node driver\drive.mjs %*
pause
exit /b 0
:nonode
echo [x] 没有检测到 Node.js，请先安装 Node.js 22+：https://nodejs.org/zh-cn/download
start https://nodejs.org/zh-cn/download
pause
