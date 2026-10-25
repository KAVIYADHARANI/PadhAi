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

# 1c. Docker Desktop & PostgreSQL (pgvector) Setup
Write-Host "`n============================================================" -ForegroundColor DarkCyan
Write-Host "            Checking Docker & PostgreSQL (pgvector)         " -ForegroundColor DarkCyan
Write-Host "============================================================" -ForegroundColor DarkCyan

if (Get-Command docker -ErrorAction SilentlyContinue) {
    # Check if Docker daemon is running
    $dockerRunning = $false
    try {
        $null = docker info 2>&1
        if ($LASTEXITCODE -eq 0) { $dockerRunning = $true }
    } catch {
        $dockerRunning = $false
    }

    if (-not $dockerRunning) {
        Write-Host "Docker daemon is not running. Looking for Docker Desktop..." -ForegroundColor Yellow
        $dockerDesktopCandidates = @(
            (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"),
            (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
            (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe")
        )

        $dockerExe = $null
        foreach ($candidate in $dockerDesktopCandidates) {
            if ($candidate -and (Test-Path $candidate)) {
                $dockerExe = $candidate
                break
            }
        }

        if ($dockerExe) {
            Write-Host "Launching Docker Desktop ($dockerExe)..." -ForegroundColor Cyan
            Start-Process $dockerExe

            Write-Host "Waiting for Docker daemon to initialize" -NoNewline -ForegroundColor Yellow
            $maxWaitSeconds = 60
            $waited = 0
            while ($waited -lt $maxWaitSeconds) {
                Start-Sleep -Seconds 3
                $waited += 3
                Write-Host "." -NoNewline -ForegroundColor Yellow
                try {
                    $null = docker info 2>&1
                    if ($LASTEXITCODE -eq 0) {
                        $dockerRunning = $true
                        break
                    }
                } catch {}
            }
            Write-Host ""
        } else {
            Write-Warning "Docker Desktop executable not found. Please start Docker Desktop manually."
        }
    }

    if ($dockerRunning) {
        Write-Host "[OK] Docker daemon is ready." -ForegroundColor Green


        # Start PostgreSQL + pgvector container
        Write-Host "Starting PostgreSQL (pgvector) container..." -ForegroundColor Cyan
        docker compose up -d postgres

        # Wait for database container readiness
        Write-Host "Waiting for PostgreSQL container to become ready" -NoNewline -ForegroundColor Cyan
        $dbReady = $false
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 1
            Write-Host "." -NoNewline -ForegroundColor Cyan
            try {
                $null = docker exec padhai-postgres pg_isready -U padhai -d padhai 2>&1
                if ($LASTEXITCODE -eq 0) {
                    $dbReady = $true
                    break
                }
            } catch {}
        }
        Write-Host ""

        if ($dbReady) {
            Write-Host "[OK] PostgreSQL + pgvector is healthy and accepting connections." -ForegroundColor Green

            # Automatically apply database migrations
            if (Test-Path $backendVenvPy) {
                Write-Host "Applying database migrations (Alembic upgrade head)..." -ForegroundColor Cyan
                try {
                    & $backendVenvPy -m alembic upgrade head
                    if ($LASTEXITCODE -eq 0) {
                        Write-Host "[OK] Database schema is up to date." -ForegroundColor Green
                    } else {
                        Write-Warning "Alembic upgrade exited with code $LASTEXITCODE."
                    }
                } catch {
                    Write-Warning "Failed to run Alembic migration: $($_.Exception.Message)"
                }
            }
        } else {
            Write-Warning "PostgreSQL container was not ready within timeout. Check 'docker logs padhai-postgres'."
        }
    } else {
        Write-Warning "Docker daemon is not reachable. Ensure Docker Desktop is running."
    }
} else {
    Write-Warning "Docker is not found in PATH. Ensure PostgreSQL with pgvector is accessible on localhost:5432."
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
