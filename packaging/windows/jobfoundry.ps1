<#
  JobFoundry - Windows control CLI (bundled in the MSIX payload at
  usr\share\jobfoundry\windows\jobfoundry.ps1).

  Usage: powershell -ExecutionPolicy Bypass -File jobfoundry.ps1 {start|stop|status|restart|logs [service]|open}

  Mirrors packaging/jobfoundry-ctl.sh for the Windows package.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command = 'status',

    [Parameter(Position = 1)]
    [string]$Target = ''
)

$ErrorActionPreference = 'Stop'

$PKG_ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$NODE_BIN = Join-Path $PKG_ROOT 'usr\lib\node\node.exe'
$LAUNCHER = Join-Path $PKG_ROOT 'usr\share\jobfoundry\windows\launcher.mjs'

$DATA_DIR = Join-Path $env:LOCALAPPDATA 'JobFoundry'
$LOGS_DIR = Join-Path $DATA_DIR 'logs'
$RUNTIME_DIR = Join-Path $DATA_DIR 'run'

$INGEST_PORT = 8080
$DASHBOARD_URL = "http://localhost:$INGEST_PORT"

New-Item -ItemType Directory -Force -Path $LOGS_DIR, $RUNTIME_DIR | Out-Null

function Read-PidFile([string]$Name) {
    $f = Join-Path $RUNTIME_DIR "$Name.pid"
    if (Test-Path $f) {
        try { return [int](Get-Content $f -TotalCount 1) } catch { }
    }
    return 0
}

function Is-Alive($PidValue) {
    if (-not $PidValue) { return $false }
    return [bool](Get-Process -Id $PidValue -ErrorAction SilentlyContinue)
}

function Is-Service([int]$PidValue, [string]$Marker) {
    if (-not (Is-Alive $PidValue)) { return $false }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$PidValue" -ErrorAction SilentlyContinue
    return ($null -ne $proc -and $proc.CommandLine -match $Marker)
}

function Is-LauncherRunning {
    $pidValue = Read-PidFile 'launcher'
    return (Is-Service $pidValue 'launcher\.mjs')
}

function Is-PortListening([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Invoke-Start {
    if (Is-LauncherRunning) {
        Write-Host "[jobfoundry] Already running."
        Write-Host "[jobfoundry] Dashboard: $DASHBOARD_URL"
        return
    }
    if (-not (Test-Path $NODE_BIN) -or -not (Test-Path $LAUNCHER)) {
        Write-Host "[jobfoundry] ERROR: bundled launcher not found" -ForegroundColor Red
        exit 1
    }
    Write-Host "[jobfoundry] Starting services in the background..."
    $outLog = Join-Path $LOGS_DIR 'launcher.out.log'
    $errLog = Join-Path $LOGS_DIR 'launcher.err.log'
    $p = Start-Process -FilePath $NODE_BIN -ArgumentList @($LAUNCHER) `
        -WorkingDirectory $PKG_ROOT -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    Set-Content -Path (Join-Path $RUNTIME_DIR 'launcher.pid') -Value $p.Id

    $elapsed = 0
    while (-not (Is-PortListening $INGEST_PORT)) {
        Start-Sleep -Seconds 2
        $elapsed += 2
        if (-not (Is-LauncherRunning)) {
            Write-Host "[jobfoundry] ERROR: launcher exited during startup (see $LOGS_DIR)" -ForegroundColor Red
            exit 1
        }
        if ($elapsed -ge 180) {
            Write-Host "[jobfoundry] ERROR: ingest unhealthy after 180s (see $LOGS_DIR)" -ForegroundColor Red
            Invoke-Stop | Out-Null
            exit 1
        }
    }
    Write-Host "[jobfoundry] All services running."
    Write-Host "[jobfoundry] Dashboard: $DASHBOARD_URL"
}

function Invoke-Stop {
    $stopped = $false
    $launcherPid = Read-PidFile 'launcher'
    if (Is-Service $launcherPid 'launcher\.mjs') {
        Write-Host "[jobfoundry] Stopping launcher (pid $launcherPid)..."
        Stop-Process -Id $launcherPid -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $RUNTIME_DIR 'launcher.pid') -Force -ErrorAction SilentlyContinue
        $stopped = $true
    } elseif ($launcherPid) {
        Write-Host "[jobfoundry] WARN: launcher.pid does not match launcher process; ignoring" -ForegroundColor Yellow
        Remove-Item (Join-Path $RUNTIME_DIR 'launcher.pid') -Force -ErrorAction SilentlyContinue
    }

    $svcs = @(
        @{ Name = 'tailor'; Marker = 'resume_ops_api' },
        @{ Name = 'scorer'; Marker = 'src\.main' },
        @{ Name = 'ingest'; Marker = 'ingest' }
    )
    foreach ($svc in $svcs) {
        $svcPid = Read-PidFile $svc.Name
        if (Is-Service $svcPid $svc.Marker) {
            Stop-Process -Id $svcPid -Force -ErrorAction SilentlyContinue
            $stopped = $true
        }
        Remove-Item (Join-Path $RUNTIME_DIR "$($svc.Name).pid") -Force -ErrorAction SilentlyContinue
    }

    if ($stopped) {
        Write-Host "[jobfoundry] All services stopped."
    } else {
        Write-Host "[jobfoundry] Not running."
    }
}

function Invoke-Status {
    if (Is-LauncherRunning) {
        $lpid = Read-PidFile 'launcher'
        Write-Host "[jobfoundry] launcher: running (pid $lpid)"
    } else {
        Write-Host "[jobfoundry] launcher: not running"
    }
    $svcs = @(
        @{ Name = 'tailor'; Port = 8081; Marker = 'resume_ops_api' },
        @{ Name = 'scorer'; Port = 8001; Marker = 'src\.main' },
        @{ Name = 'ingest'; Port = 8080; Marker = 'ingest' }
    )
    foreach ($svc in $svcs) {
        $svcPid = Read-PidFile $svc.Name
        if ((Is-Service $svcPid $svc.Marker) -and (Is-PortListening $svc.Port)) {
            Write-Host "[jobfoundry] $($svc.Name): running (pid $svcPid, port $($svc.Port))"
        } elseif (Is-Service $svcPid $svc.Marker) {
            Write-Host "[jobfoundry] $($svc.Name): starting... (pid $svcPid)"
        } elseif (Is-PortListening $svc.Port) {
            Write-Host "[jobfoundry] $($svc.Name): running (external process, port $($svc.Port))"
        } else {
            Write-Host "[jobfoundry] $($svc.Name): stopped"
        }
    }
    if (Is-PortListening $INGEST_PORT) {
        Write-Host "[jobfoundry] dashboard: healthy at $DASHBOARD_URL"
    } else {
        Write-Host "[jobfoundry] dashboard: not responding"
    }
}

function Invoke-Logs([string]$Service) {
    if ($Service) {
        $f = Join-Path $LOGS_DIR "$Service.log"
        if (-not (Test-Path $f)) {
            Write-Host "[jobfoundry] ERROR: no such log: $Service (choose: tailor, scorer, ingest, launcher)" -ForegroundColor Red
            exit 1
        }
        Get-Content -Path $f -Tail 100 -Wait
        return
    }
    Get-Content -Path (Join-Path $LOGS_DIR '*.log') -Tail 50 -Wait
}

function Invoke-Open {
    Start-Process $DASHBOARD_URL
}

switch ($Command.ToLowerInvariant()) {
    'start'   { Invoke-Start }
    'stop'    { Invoke-Stop }
    'status'  { Invoke-Status }
    'restart' { Invoke-Stop; Start-Sleep -Seconds 2; Invoke-Start }
    'logs'    { Invoke-Logs $Target }
    'open'    { Invoke-Open }
    default {
        Write-Host "Usage: jobfoundry.ps1 {start|stop|status|restart|logs [service]|open}" -ForegroundColor Yellow
        exit 1
    }
}