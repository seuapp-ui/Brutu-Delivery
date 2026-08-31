$ErrorActionPreference = "Stop"
$DataDir = Join-Path $env:LOCALAPPDATA "BrutusDeliveryData"
$BackupDir = Join-Path $DataDir "backups"
$Banco = Join-Path $DataDir "brutus.db"
$lista = Get-ChildItem $BackupDir -Filter "brutus-*.db" -File | Sort-Object LastWriteTime -Descending
if (-not $lista) { Write-Host "Nenhum backup encontrado."; Read-Host "Enter para sair"; exit 1 }
Write-Host "Backups disponíveis:"
for ($i=0; $i -lt $lista.Count; $i++) { Write-Host "[$($i+1)] $($lista[$i].Name) - $($lista[$i].LastWriteTime)" }
$escolha = [int](Read-Host "Digite o número do backup que deseja restaurar")
if ($escolha -lt 1 -or $escolha -gt $lista.Count) { throw "Escolha inválida." }
$confirmar = Read-Host "Restaurar $($lista[$escolha-1].Name)? Digite RESTAURAR para confirmar"
if ($confirmar -cne "RESTAURAR") { Write-Host "Operação cancelada."; exit 0 }
& (Join-Path $PSScriptRoot "parar-local.ps1")
if (Test-Path $Banco) { Copy-Item $Banco "$Banco.antes-da-restauracao" -Force }
Copy-Item $lista[$escolha-1].FullName $Banco -Force
Write-Host "Backup restaurado. Uma cópia do banco anterior foi preservada."
Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'iniciar-local.ps1')`""
Read-Host "Enter para sair"
