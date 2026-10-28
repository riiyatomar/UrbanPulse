@echo off
title UrbanPulse Backend Launcher
echo ===================================================
echo   URBANPULSE BACKEND SERVICES LAUNCHER
echo ===================================================
echo.

:: 1. Boot up Docker infrastructure (PostgreSQL/PostGIS, Redis, MinIO)
echo [1/4] Spinning up Docker containers (DB, Redis, S3)...
docker compose up -d
if %errorlevel% neq 0 (
    echo.
    echo WARNING: Docker compose failed to run. Ensure Docker Desktop is active.
    echo Services will run in fallback/offline mode.
    echo.
) else (
    echo Docker containers are starting...
)
echo.

:: 2. Wait for infrastructure to be healthy before launching services
echo [2/4] Waiting for infrastructure to be ready...
echo   Checking PostgreSQL...
set /a RETRIES=0
:wait_db
set /a RETRIES+=1
if %RETRIES% gtr 20 (
    echo   WARNING: PostgreSQL did not become ready after 20 attempts. Proceeding anyway...
    goto db_done
)
docker compose exec -T db pg_isready -U postgres >nul 2>&1
if %errorlevel% neq 0 (
    echo   Attempt %RETRIES%/20: PostgreSQL not ready, waiting 3s...
    timeout /t 3 /nobreak >nul
    goto wait_db
)
echo   PostgreSQL is ready!

:db_done
echo   Checking Redis...
set /a RETRIES=0
:wait_redis
set /a RETRIES+=1
if %RETRIES% gtr 10 (
    echo   WARNING: Redis did not become ready after 10 attempts. Proceeding anyway...
    goto redis_done
)
docker compose exec -T redis redis-cli ping >nul 2>&1
if %errorlevel% neq 0 (
    echo   Attempt %RETRIES%/10: Redis not ready, waiting 2s...
    timeout /t 2 /nobreak >nul
    goto wait_redis
)
echo   Redis is ready!

:redis_done
echo   Checking MinIO...
set /a RETRIES=0
:wait_minio
set /a RETRIES+=1
if %RETRIES% gtr 10 (
    echo   WARNING: MinIO did not become ready after 10 attempts. Proceeding anyway...
    goto minio_done
)
curl -sf http://localhost:9000/minio/health/live >nul 2>&1
if %errorlevel% neq 0 (
    echo   Attempt %RETRIES%/10: MinIO not ready, waiting 2s...
    timeout /t 2 /nobreak >nul
    goto wait_minio
)
echo   MinIO is ready!

:minio_done
echo.
echo   All infrastructure services are healthy!
echo.

:: 3. Setup virtual environments and install dependencies
echo [3/4] Preparing virtual environments...

set SERVICES=ingestion-api detection-service dedup-service scoring-service routing-service notification-service verification-service

for %%s in (%SERVICES%) do (
    echo Processing services/%%s...
    if not exist "services\%%s\venv" (
        echo Creating virtual environment for %%s...
        python -m venv services\%%s\venv
        services\%%s\venv\Scripts\pip install -r services\%%s\requirements.txt
    )
)
echo All virtual environments prepared.
echo.

:: 4. Launch services (consolidated: 3 windows instead of 7)
echo [4/4] Launching backend microservices...

:: Ingestion API (Port 8006) — main HTTP API
start "UrbanPulse Ingestion API" cmd /k "cd services\ingestion-api && venv\Scripts\activate && uvicorn app.main:app --port 8006 --host 0.0.0.0"

:: Verification API (Port 8002) — repair verification HTTP API
start "UrbanPulse Verification API" cmd /k "cd services\verification-service && venv\Scripts\activate && uvicorn app.main:app --port 8002 --host 0.0.0.0"

:: All background workers (detection, dedup, scoring, routing, notification)
:: Consolidated into a single window using worker_launcher.py
start "UrbanPulse Workers" cmd /k "services\ingestion-api\venv\Scripts\activate && python services\worker_launcher.py"

echo.
echo ===================================================
echo   3 service windows launched:
echo     1. Ingestion API    (http://localhost:8001)
echo     2. Verification API (http://localhost:8002)
echo     3. Background Workers (detection, dedup, scoring, routing, notification)
echo ===================================================
echo.
pause
