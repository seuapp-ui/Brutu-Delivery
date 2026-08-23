@echo off
title Brutu's Delivery v1.0
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js 24 LTS e tente novamente.
  pause
  exit /b 1
)
if not exist "node_modules\express\package.json" (
  echo Instalando componentes na primeira execucao...
  call npm install
  if errorlevel 1 (
    echo Nao foi possivel instalar os componentes. Verifique a internet.
    pause
    exit /b 1
  )
)
if "%ADMIN_PASSWORD%"=="" set /p "ADMIN_PASSWORD=Digite a senha do painel: "
if "%ADMIN_PASSWORD%"=="" (
  echo A senha nao pode ficar vazia.
  pause
  exit /b 1
)
if "%ADMIN_USER%"=="" set "ADMIN_USER=admin"
start "" "http://localhost:3000/"
start "" "http://localhost:3000/painel.html"
npm start
pause
