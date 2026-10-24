"""FastAPI application entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat as api_chat
from app.api import courses as api_courses
from app.api import documents as api_documents
from app.api import me as api_me
from app.api import progress as api_progress
from app.api import quizzes as api_quizzes
from app.api import roadmap as api_roadmap
from app.core.config import settings
from app.core.logging import setup_logging

# Configure structured logging
setup_logging()

app = FastAPI(
    title=settings.PRODUCT_NAME,
    description="Adaptive Learning Platform API",
    version="0.1.0",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
def health_check() -> dict:
    """Public healthcheck endpoint. No authentication required."""
    return {
        "status": "ok",
        "product": settings.PRODUCT_NAME,
        "mascot": settings.MASCOT_NAME,
    }


# Include API routers
app.include_router(api_me.router)
app.include_router(api_courses.router)
app.include_router(api_documents.router)
app.include_router(api_chat.router)
app.include_router(api_quizzes.router)
app.include_router(api_progress.router)
app.include_router(api_roadmap.router)


