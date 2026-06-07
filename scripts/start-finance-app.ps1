$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AppUrl = "http://127.0.0.1:3000"
$NodeDir = "C:\Program Files\nodejs"
$NpmPath = Join-Path $NodeDir "npm.cmd"
$NextBin = Join-Path $ProjectRoot "node_modules\next\dist\bin\next"

function Test-AppHealthy {
  try {
    $response = Invoke-WebRequest -UseBasicParsing $AppUrl -TimeoutSec 2
    if ($response.StatusCode -ne 200) {
      return $false
    }

    $assetMatches = [regex]::Matches($response.Content, '\s(?:src|href)="([^"]*/_next/static/[^"]+\.(?:js|css)(?:\?[^"]*)?)"')

    if ($assetMatches.Count -eq 0) {
      return $false
    }

    foreach ($match in $assetMatches) {
      $assetPath = $match.Groups[1].Value.Replace("&amp;", "&")
      $assetUrl = [Uri]::new([Uri]$AppUrl, $assetPath).AbsoluteUri
      $assetResponse = Invoke-WebRequest -UseBasicParsing $assetUrl -TimeoutSec 2

      if ($assetResponse.StatusCode -ne 200) {
        return $false
      }
    }

    return $true
  } catch {
    return $false
  }
}

function Stop-Port3000Listeners {
  $portOwners = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -and $_ -ne $PID }

  foreach ($owner in $portOwners) {
    try {
      Stop-Process -Id $owner -Force -ErrorAction Stop
    } catch {}
  }
}

function Open-AppInChrome {
  $chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  )

  $chromePath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

  if ($chromePath) {
    Start-Process -FilePath $chromePath -ArgumentList @("--new-window", $AppUrl)
    return
  }

  Start-Process $AppUrl
}

function Show-StartupError {
  param([string] $Message)

  Write-Host ""
  Write-Host $Message -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
}

Set-Location $ProjectRoot
$env:Path = "$NodeDir;$env:Path"

if (-not (Test-Path $NpmPath)) {
  Show-StartupError "Node/npm was not found at $NpmPath. Install Node.js or update this launcher path."
  exit 1
}

if (-not (Test-Path $NextBin)) {
  Show-StartupError "Project dependencies are missing. Open PowerShell in this folder and run: npm install"
  exit 1
}

Write-Host "Restarting Personal Finance app..." -ForegroundColor Cyan
Stop-Port3000Listeners
Start-Sleep -Seconds 2

$portOwner = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique

if ($portOwner) {
  Show-StartupError "Port 3000 is still being used by another process. Close that app or stop the old server, then launch Personal Finance again."
  exit 1
}

$devCommand = @"
Set-Location '$ProjectRoot'
`$env:Path = '$NodeDir;' + `$env:Path
& '$NpmPath' run dev:clean
"@

Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $devCommand
) -WorkingDirectory $ProjectRoot

Write-Host "Starting Personal Finance app..." -ForegroundColor Cyan

$ready = $false
for ($attempt = 1; $attempt -le 45; $attempt += 1) {
  Start-Sleep -Seconds 1

  if (Test-AppHealthy) {
    $ready = $true
    break
  }
}

if (-not $ready) {
  Show-StartupError "The app did not become ready within 45 seconds. Check the dev-server PowerShell window for details."
  exit 1
}

Open-AppInChrome
