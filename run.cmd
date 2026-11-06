@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  学习通刷课脚本 - 无扩展后台驱动
echo ============================================
if "%~1"=="" (
  node driver\drive.mjs
) else (
  node driver\drive.mjs --url "%~1"
)
pause
