@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 学习通刷课脚本
echo ============================================
echo   学习通刷课脚本 - 一键启动
echo ============================================
node -v >nul 2>nul
if errorlevel 1 goto nonode
echo.
echo 即将弹出浏览器。第一次使用请在窗口里：
echo   1. 登录学习通
echo   2. 点进任意一门课程
echo   3. 脚本会自己接管播放，之后窗口可以最小化
echo.
node driver\drive.mjs --windowed %*
echo.
echo 已退出。若异常，把上面的输出发给你的 Agent。
pause
exit /b 0
:nonode
echo [x] 没有检测到 Node.js
echo     请先安装 Node.js 22+ ：https://nodejs.org/zh-cn/download
start https://nodejs.org/zh-cn/download
pause
