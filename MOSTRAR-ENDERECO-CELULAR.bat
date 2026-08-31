@echo off
title Endereco do Brutu's no celular
powershell.exe -NoProfile -Command "$ips=Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object {$_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown'}; Write-Host ''; Write-Host 'Abra no celular conectado ao mesmo Wi-Fi:' -ForegroundColor Yellow; $ips ^| ForEach-Object {Write-Host ('http://' + $_.IPAddress + ':3000/') -ForegroundColor Green}; Write-Host ''; Read-Host 'Enter para fechar'"
