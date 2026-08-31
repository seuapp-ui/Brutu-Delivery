$DataDir = Join-Path $env:LOCALAPPDATA "BrutusDeliveryData"
$PidFile = Join-Path $DataDir "brutus.pid"
if (-not (Test-Path $PidFile)) { Write-Host "Servidor já está parado."; exit 0 }
$idProcesso = [int](Get-Content $PidFile -ErrorAction Stop)
$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$idProcesso" -ErrorAction SilentlyContinue
if ($proc -and $proc.CommandLine -match "backend[/\\]server\.js") {
  Stop-Process -Id $idProcesso -Force
  Write-Host "Servidor Brutu's encerrado."
}
Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
