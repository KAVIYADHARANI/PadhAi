---
trigger: always_on
---

# PadhAI project rules

You are building PadhAI. The design source of truth is /README.md. If a task conflicts with the README, stop and ask. Do not silently deviate.

## Process
- Always start in Planning mode for multi-file work. Produce an implementation plan and wait for approval.
- Work only on the task given. Do not refactor unrelated code or add features not requested.
- After changes, run the relevant tests and linters, and paste the actual output. Never claim tests pass without running them.
- Keep commits small and describe what changed.

## Stack
- Backend: Python 3.11+, FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, LangGraph.
- Frontend: React 18, Vite, TypeScript, Tailwind, Recharts.
- DB: Postgres + pgvector (halfvec 1024). Embeddings: BGE-M3, dense only; lexical via tsvector.
- No local models, no Ollama, no GPU. All LLM and embedding calls go through LLMGateway.

## Libraries and APIs
- Before using Indra OCR, Rive, MediaPipe, LangGraph, Firebase Admin, or any library you are not certain about, read its official documentation or package README first. Never invent function names or parameters. If you cannot verify an API, say so and ask.

## Quality
- Type hints everywhere (Python) and strict TypeScript.
- Every module has tests. Backend tests run against FakeLLM and the Firebase Auth Emulator with no network.
- No hard-coded model names, limits or provider URLs; read from config.