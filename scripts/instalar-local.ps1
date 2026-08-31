$ErrorActionPreference = "Stop"
$Origem = Split-Path -Parent $PSScriptRoot
$Destino = Join-Path $env:LOCALAPPDATA "Programs\BrutusDelivery"
$DataDir = Join-Path $env:LOCALAPPDATA "BrutusDeliveryData"
$BackupDir = Join-Path $DataDir "backups"

Write-Host "=== INSTALADOR BRUTU'S DELIVERY ===" -ForegroundColor Yellow
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js não encontrado. Instale o Node.js 24 LTS e execute novamente." -ForegroundColor Red
  Start-Process "https://nodejs.org/"
  exit 1
}
New-Item -ItemType Directory -Force -Path $Destino, $DataDir, $BackupDir | Out-Null
$env:DATABASE_PATH = Join-Path $DataDir "brutus.db"
$env:BRUTUS_BACKUP_DIR = $BackupDir
if ((Test-Path $env:DATABASE_PATH) -and (Test-Path (Join-Path $Destino "scripts\backup-local.js"))) {
  Write-Host "Criando backup antes da atualização..."
  & node (Join-Path $Destino "scripts\backup-local.js")
  if ($LASTEXITCODE -ne 0) { throw "O backup de segurança falhou; a atualização foi cancelada." }
}
Write-Host "Copiando o sistema..."
if ([IO.Path]::GetFullPath($Origem).TrimEnd('\') -ne [IO.Path]::GetFullPath($Destino).TrimEnd('\')) {
  & robocopy $Origem $Destino /E /XD node_modules .git /XF "*.db" "*.db-wal" "*.db-shm" | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Falha ao copiar os arquivos." }
}
Push-Location $Destino
Write-Host "Instalando componentes..."
& npm install --omit=dev
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar os componentes." }
Pop-Location

if (-not (Test-Path $env:DATABASE_PATH)) {
  do {
    $segura = Read-Host "Crie a senha do painel (mínimo 8 caracteres)" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
    try { $senha = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  } while ($senha.Length -lt 8)
  $usuario = Read-Host "Usuário do painel [admin]"
  if ([string]::IsNullOrWhiteSpace($usuario)) { $usuario = "admin" }
  $env:BRUTUS_SETUP_PASSWORD = $senha
  $env:BRUTUS_SETUP_USER = $usuario
  & node (Join-Path $Destino "scripts\configurar-local.js")
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível configurar o acesso." }
  Remove-Item Env:BRUTUS_SETUP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Variable senha -ErrorAction SilentlyContinue
}

$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [Environment]::GetFolderPath("Desktop")
$atalho = $WshShell.CreateShortcut((Join-Path $Desktop "Brutu's Delivery.lnk"))
$atalho.TargetPath = Join-Path $Destino "INICIAR-BRUTUS.bat"
$atalho.WorkingDirectory = $Destino
$atalho.Save()
$Startup = [Environment]::GetFolderPath("Startup")
Copy-Item (Join-Path $Destino "scripts\iniciar-silencioso.vbs") (Join-Path $Startup "BrutusDelivery.vbs") -Force

Write-Host "Configurando acesso pela rede local..."
$regra = "Brutus Delivery Porta 3000"
$cmd = "if (-not (Get-NetFirewallRule -DisplayName '$regra' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '$regra' -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private | Out-Null }"
try { Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"$cmd`"" } catch { Write-Warning "Firewall não configurado; o sistema ainda funcionará neste PC." }
$qzInstalado = (Test-Path (Join-Path $env:ProgramFiles "QZ Tray\qz-tray.exe")) -or (Test-Path (Join-Path ${env:ProgramFiles(x86)} "QZ Tray\qz-tray.exe"))
if (-not $qzInstalado) {
  Write-Warning "QZ Tray não foi encontrado. Ele é necessário para impressão automática."
  Start-Process "https://qz.io/download/"
}
Write-Host "Instalação concluída. Dados permanentes: $DataDir" -ForegroundColor Green
Start-Process (Join-Path $Destino "INICIAR-BRUTUS.bat")
Read-Host "Pressione Enter para fechar"
