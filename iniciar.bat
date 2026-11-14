@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js nao encontrado. Instale em https://nodejs.org ^(versao LTS^) e rode de novo.
  echo.
  pause
  exit /b 1
)
node server.js
pause
