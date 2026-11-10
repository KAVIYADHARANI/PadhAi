# PadhAI Backend Service

Core backend service for **PadhAI**, powered by FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, and PostgreSQL (`pgvector`).

---

## Prerequisites

- **Python**: `>=3.11` (tested with `3.11.15`)
- **Node.js**: `>=20` (required for the React/Vite frontend and optional Firebase Auth Emulator)
- **PostgreSQL + pgvector**: Running locally or via Docker (`docker compose up -d postgres`)
- **uv** *(recommended)* or `pip`

---

## Dependency Installation

### Backend (`backend/`)

```powershell
cd backend
uv venv --python 3.11
uv pip install -e ".[dev]"
```

*(If running without `uv`, activate a Python 3.11 virtualenv and run `pip install -r requirements.txt`.)*

### Frontend (`frontend/`)

```powershell
cd frontend
npm install
```

---

## Environment Configuration

Both frontend and backend load configuration from the shared root `.env` file (resolved automatically relative to `backend/app/core/config.py` and `frontend/vite.config.ts`):

1. Copy `.env.example` to `.env` in the repository root.
2. Verify `DATABASE_URL` matches your running Postgres instance (for `docker-compose.yml` default port `5433`: `postgresql+psycopg://padhai:padhai@localhost:5433/padhai`).
3. Configure Firebase authentication (`GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099`) and at least one hosted LLM API key (`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, or `CEREBRAS_API_KEY`).

---

## Running Locally (Windows PowerShell)

### Option 1: Unified Startup Script (Recommended)

From the project root (`C:\PROJECTS\PadhAi`):

```powershell
.\start_dev.ps1
```

Starts PostgreSQL (via Docker if available), runs `alembic upgrade head`, and opens separate terminal windows for the backend (`127.0.0.1:8000`) and frontend (`localhost:5173`). Use `.\start_dev.ps1 -Background` to run in background jobs instead.

### Option 2: Start Manually in Two Terminals

**Terminal 1 — Backend (`127.0.0.1:8000`):**

```powershell
cd backend
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — Frontend (`localhost:5173`):**

```powershell
cd frontend
npm run dev
```

---

## Health Check & Documentation URLs

- **Health Check (direct)**: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
- **Health Check (via Vite proxy)**: [http://localhost:5173/health](http://localhost:5173/health)
- **Swagger UI**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Frontend App**: [http://localhost:5173](http://localhost:5173)

`GET /health` returns JSON confirming backend availability (`status: "ok"`) alongside live PostgreSQL connectivity (`database: "connected"` or `"disconnected"`).

---

## Running Tests

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -v tests
.\.venv\Scripts\ruff.exe check .
```

---

## Windows Troubleshooting

### `error: uv trampoline failed to canonicalize script path`
- **Cause**: Console script wrappers (`.venv\Scripts\uvicorn.exe`, `pytest.exe`, `alembic.exe`) embed the original path of `.venv\Scripts\python.exe`. Moving or renaming the repository directory invalidates those wrappers.
- **Fix**: Prefer invoking tools through the interpreter (`.\.venv\Scripts\python.exe -m uvicorn ...` / `-m pytest` / `-m alembic`), or regenerate wrappers in `backend\`:
  ```powershell
  cd backend
  uv venv --allow-existing --python 3.11 .venv
  uv pip install --python .\.venv\Scripts\python.exe --reinstall --no-deps uvicorn pytest alembic mypy fastapi httpx
  ```

### `[vite] http proxy error: /api/courses — connect ECONNREFUSED 127.0.0.1:8000`
- **Cause**: Vite (`localhost:5173`) forwards `/api` and `/health` requests to `http://127.0.0.1:8000`, which fails whenever the FastAPI server is stopped or crashed.
- **Fix**: Verify the backend terminal is listening on port `8000` (`curl.exe http://127.0.0.1:8000/health`) and restart using `.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`.

### `database: "disconnected"` on `/health`
- Ensure PostgreSQL with `pgvector` is running (`docker compose up -d postgres`) and `DATABASE_URL` in root `.env` matches the exposed port (e.g., `5433` for the Docker container or `5432` for local Postgres).
