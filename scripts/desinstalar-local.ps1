$ErrorActionPreference = "Stop"
$AppDir = Join-Path $env:LOCALAPPDATA "Programs\BrutusDelivery"
$DataDir = Join-Path $env:LOCALAPPDATA "BrutusDeliveryData"
& (Join-Path $PSScriptRoot "parar-local.ps1")
Remove-Item (Join-Path ([Environment]::GetFolderPath("Startup")) "BrutusDelivery.vbs") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath("Desktop")) "Brutu's Delivery.lnk") -Force -ErrorAction SilentlyContinue
$apagarDados = Read-Host "Deseja APAGAR também banco e backups? Digite APAGAR para confirmar; qualquer outra resposta preserva os dados"
if ($apagarDados -ceq "APAGAR") { Remove-Item $DataDir -Recurse -Force -ErrorAction SilentlyContinue }
Remove-Item $AppDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Brutu's removido. Dados preservados: $($apagarDados -cne 'APAGAR')"
Read-Host "Enter para sair"
