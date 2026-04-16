@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 未安装，请先按页面步骤安装 Node.js。
  exit /b 1
)

call npm install
if errorlevel 1 exit /b 1

call node bridge.js
