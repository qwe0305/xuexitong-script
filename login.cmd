@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  第一步：登录（只需一次）
echo  在弹出的浏览器里登录学习通，进一次课程，然后关掉窗口
echo ============================================
node driver\launch.mjs --url "https://mooc1.chaoxing.com/"
pause
