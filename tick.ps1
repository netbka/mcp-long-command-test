param([string]$Tag, [int]$N = 60)
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$p = Join-Path $logs $Tag
Set-Content "$p.pid" $PID -Encoding ascii
Remove-Item "$p.ticks" -ErrorAction SilentlyContinue
1..$N | ForEach-Object { $l = "tick $_ $(Get-Date -Format 'HH:mm:ss')"; Write-Output $l; Add-Content "$p.ticks" $l; Start-Sleep -Seconds 1 }
Write-Output "done $Tag"
