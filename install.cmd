@echo off
chcp 65001 >nul
title XueXiTong Installer
echo ============================================
echo   Installing XueXiTong auto-study script...
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/qwe0305/xuexitong-script/main/install.ps1 | iex"
echo.
pause
