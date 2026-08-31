$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $env:LOCALAPPDATA "BrutusDeliveryData"
$BackupDir = Join-Path $DataDir "backups"
$PidFile = Join-Path $DataDir "brutus.pid"
$LogDir = Join-Path $DataDir "logs"

New-Item -ItemType Directory -Force -Path $DataDir, $BackupDir, $LogDir | Out-Null

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 2
  if ($health.ok) {
    Start-Process "http://localhost:3000/painel.html"
    exit 0
  }
} catch {}

$qz = @(
  (Join-Path $env:ProgramFiles "QZ Tray\qz-tray.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "QZ Tray\qz-tray.exe"),
  (Join-Path $env:LOCALAPPDATA "Programs\QZ Tray\qz-tray.exe")
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($qz) { Start-Process $qz -ErrorAction SilentlyContinue }

$env:DATABASE_PATH = Join-Path $DataDir "brutus.db"
$env:BRUTUS_BACKUP_DIR = $BackupDir
$env:ALLOW_LOCAL_ORIGINS = "true"
$env:ALLOW_LAN_ORIGINS = "true"
$env:PORT = "3000"
$stdout = Join-Path $LogDir "servidor.log"
$stderr = Join-Path $LogDir "servidor-erros.log"
$proc = Start-Process -FilePath "node" -ArgumentList "backend/server.js" -WorkingDirectory $AppDir -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
Set-Content -Path $PidFile -Value $proc.Id -Encoding ascii

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 2
    if ($health.ok) { $ok = $true; break }
  } catch {}
}
if (-not $ok) { throw "O servidor local não iniciou. Consulte $stderr" }

Start-Process "http://localhost:3000/"
Start-Process "http://localhost:3000/painel.html"
