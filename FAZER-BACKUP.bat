@echo off
set "DATABASE_PATH=%LOCALAPPDATA%\BrutusDeliveryData\brutus.db"
set "BRUTUS_BACKUP_DIR=%LOCALAPPDATA%\BrutusDeliveryData\backups"
cd /d "%~dp0"
node scripts\backup-local.js
pause
