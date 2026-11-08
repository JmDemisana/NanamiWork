# NanamiWork Rotator Auto-Installer & Watcher
# Automatically monitors the latest rotator GitHub Actions build, catches errors,
# downloads the resulting installer, terminates any active NanamiWork process,
# runs the installer silently, and relaunches the fresh app.

param (
    [string]$Repo = "JmDemisana/NanamiWork",
    [switch]$SkipWatch = $false
)

$ErrorActionPreference = "Stop"
$appPath = "$env:LOCALAPPDATA\Programs\@openworkdesktop\NanamiWork.exe"
$tempInstaller = "$env:TEMP\NanamiWork-rotator-setup.exe"

Write-Host "=== NanamiWork Rotator Auto-Installer ===" -ForegroundColor Cyan

Write-Host "Querying latest rotator run on $Repo..." -ForegroundColor Yellow
$latestRun = gh run list --workflow=rotator.yml -R $Repo --limit 1 --json databaseId,status,conclusion | ConvertFrom-Json
if (-not $latestRun -or -not $latestRun[0].databaseId) {
    Write-Error "No rotator workflow run found on $Repo."
}

$latestRunId = $latestRun[0].databaseId
$status = $latestRun[0].status
$conclusion = $latestRun[0].conclusion

Write-Host "Latest run: ID $latestRunId (Status: $status, Conclusion: $conclusion)" -ForegroundColor Cyan

if (-not $SkipWatch -and $status -ne "completed") {
    Write-Host "Watching workflow run $latestRunId until completion..." -ForegroundColor Cyan
    gh run watch $latestRunId -R $Repo --exit-status
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Workflow run $latestRunId failed or was cancelled."
    }
    Write-Host "Workflow run $latestRunId finished successfully!" -ForegroundColor Green
} elseif ($status -eq "completed" -and $conclusion -ne "success" -and -not $SkipWatch) {
    Write-Error "Workflow run $latestRunId finished with conclusion '$conclusion'. Check GitHub Actions logs."
}

Write-Host "Fetching newest installer..." -ForegroundColor Cyan
if (Test-Path $tempInstaller) {
    Remove-Item $tempInstaller -Force -ErrorAction SilentlyContinue
}

$tempDir = "$env:TEMP\NanamiWork-dl-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    # Attempt 1: Download the exact artifact produced by the specific run
    Write-Host "Attempting download from run artifact ($latestRunId)..." -ForegroundColor Yellow
    $dlSuccess = $false
    try {
        gh run download $latestRunId -R $Repo -n rotator-windows-installer -D $tempDir
        $dlSuccess = $true
    } catch {
        Write-Warning "Could not download artifact directly from run. Falling back to release assets..."
    }

    if (-not $dlSuccess) {
        gh release download rotator-test -R $Repo -p "*win-x64.exe" -D $tempDir --clobber
    }

    # Pick the newest installer file by LastWriteTime
    $downloadedFile = Get-ChildItem -Path $tempDir -Filter "*win-x64.exe" -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $downloadedFile) {
        throw "Could not find any downloaded installer file (*win-x64.exe) in $tempDir"
    }

    Write-Host "Found installer: $($downloadedFile.Name) ($([math]::Round($downloadedFile.Length / 1MB, 2)) MB)" -ForegroundColor Green
    Copy-Item -Path $downloadedFile.FullName -Destination $tempInstaller -Force
} finally {
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Checking for running NanamiWork processes..." -ForegroundColor Yellow
$runningProcesses = Get-Process -Name "NanamiWork" -ErrorAction SilentlyContinue
if ($runningProcesses) {
    Write-Host "Closing active NanamiWork process(es)..." -ForegroundColor Yellow
    $runningProcesses | Stop-Process -Force
    Start-Sleep -Seconds 2
}

Write-Host "Installing NanamiWork silently (/S)..." -ForegroundColor Cyan
$installProcess = Start-Process -FilePath $tempInstaller -ArgumentList "/S", "--updated" -PassThru -Wait
if ($installProcess.ExitCode -ne 0) {
    Write-Warning "Installer exited with code $($installProcess.ExitCode)"
} else {
    Write-Host "Installation completed successfully!" -ForegroundColor Green
}

# Allow NSIS child extraction process to wrap up
Start-Sleep -Seconds 4

if (Test-Path $tempInstaller) {
    Remove-Item $tempInstaller -Force -ErrorAction SilentlyContinue
}

if (Test-Path $appPath) {
    Write-Host "Relaunching NanamiWork..." -ForegroundColor Cyan
    Start-Process -FilePath $appPath
    Write-Host "NanamiWork is up and running!" -ForegroundColor Green
} else {
    Write-Warning "Could not find NanamiWork at $appPath. Please start it manually from your Desktop shortcut."
}
