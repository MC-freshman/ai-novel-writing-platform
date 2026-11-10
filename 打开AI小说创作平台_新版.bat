@echo off
chcp 65001 >nul
for %%F in ("%~dp0release\AI-Novel-Writing-Platform-Portable-*-x64.exe") do set "APP=%%~fF"
if not defined APP (
  echo 未找到便携版 exe，请先运行 npm run dist 或从发布页下载。
  pause
  exit /b 1
)
start "" "%APP%"
