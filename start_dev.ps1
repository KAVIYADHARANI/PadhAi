<#
.SYNOPSIS
    Starts both the Backend (FastAPI / Uvicorn) and Frontend (Vite / React) development servers.

.DESCRIPTION
    Launches the backend on port 8000 and the frontend on port 5173 in separate PowerShell windows
    for optimal log viewing, or as background jobs if -Background is specified.

.EXAMPLE
    .\start_dev.ps1
    Starts both servers in dedicated windows.

.EXAMPLE
    .\start_dev.ps1 -Background
    Runs both servers as background jobs in the current console.
#>

[CmdletBinding()]
param (
    [switch]$Background
)

$ErrorActionPreference = "Stop"
$rootDir = $PSScriptRoot
if (-not $rootDir) { $rootDir = Get-Location }

$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend"
$backendVenvPy = Join-Path $backendDir ".venv\Scripts\python.exe"
$backendVenvUvicorn = Join-Path $backendDir ".venv\Scripts\uvicorn.exe"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "            Starting Development Environment                " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Pre-flight Checks
if (-not (Test-Path $backendVenvPy)) {
    Write-Warning "Backend virtual environment not found at: $backendVenvPy"
    Write-Warning "Please create it using: cd backend; uv venv; uv pip install -e ."
}

if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Warning "Frontend node_modules not found in: $frontendDir"
    Write-Warning "Running 'npm install' in frontend directory..."
    Push-Location $frontendDir
    try {
        npm install
    } finally {
        Pop-Location
    }
}

# 2. Execution Mode
if ($Background) {
    Write-Host "`nStarting Backend as background job..." -ForegroundColor Yellow
    $backendJob = Start-Job -ScriptBlock {
        param($bDir, $uExe)
        Set-Location $bDir
        & $uExe app.main:app --reload --host 127.0.0.1 --port 8000
    } -ArgumentList $backendDir, $backendVenvUvicorn

    Write-Host "Starting Frontend as background job..." -ForegroundColor Yellow
    $frontendJob = Start-Job -ScriptBlock {
        param($fDir)
        Set-Location $fDir
        npm run dev
    } -ArgumentList $frontendDir

    Write-Host "`n[OK] Servers started in background:" -ForegroundColor Green
    Write-Host "   - Backend Job ID : $($backendJob.Id)"
    Write-Host "   - Frontend Job ID: $($frontendJob.Id)"
    Write-Host "`nTo view logs:   Receive-Job -Id $($backendJob.Id) -Keep"
    Write-Host "To stop both:   Stop-Job -Id $($backendJob.Id), $($frontendJob.Id); Remove-Job -Id $($backendJob.Id), $($frontendJob.Id)"
} else {
    Write-Host "`nLaunching Backend in dedicated window..." -ForegroundColor Green
    $backendCmd = "Set-Location '$backendDir'; & '$backendVenvUvicorn' app.main:app --reload --host 127.0.0.1 --port 8000"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "$backendCmd"

    Write-Host "Launching Frontend in dedicated window..." -ForegroundColor Green
    $frontendCmd = "Set-Location '$frontendDir'; npm run dev"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "$frontendCmd"
}

# 3. Print URLs
Write-Host "`n------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host " [Frontend UI]   --> http://localhost:5173" -ForegroundColor Cyan
Write-Host " [Backend API]   --> http://127.0.0.1:8000" -ForegroundColor Cyan
Write-Host " [API Docs]      --> http://127.0.0.1:8000/docs" -ForegroundColor Cyan
Write-Host " [Health Check]  --> http://127.0.0.1:8000/health" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------`n" -ForegroundColor DarkGray
