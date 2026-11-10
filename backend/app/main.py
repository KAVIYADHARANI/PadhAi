"""FastAPI application entrypoint."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api import buddy as api_buddy
from app.api import chat as api_chat
from app.api import courses as api_courses
from app.api import documents as api_documents
from app.api import flashcards as api_flashcards
from app.api import lessons as api_lessons
from app.api import me as api_me
from app.api import progress as api_progress
from app.api import quizzes as api_quizzes
from app.api import roadmap as api_roadmap
from app.api import sessions as api_sessions
from app.core.config import settings
from app.core.logging import get_logger, setup_logging
from app.core.observability import setup_observability
from app.db.session import engine, get_db

# Configure structured logging
setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Verify startup dependencies cleanly and dispose SQLAlchemy pool on shutdown."""
    db_status = "disconnected"
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "connected"
    except SQLAlchemyError as exc:
        logger.warning("Startup database connectivity check failed: %s", type(exc).__name__)

    logger.info("Backend application started (database=%s)", db_status)
    try:
        yield
    finally:
        engine.dispose()
        logger.info("Backend application stopped; database engine disposed")


app = FastAPI(
    title=settings.PRODUCT_NAME,
    description="Adaptive Learning Platform API",
    version="0.1.0",
    lifespan=lifespan,
)

# Initialize error monitoring hook
setup_observability(app)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
def health_check(db: Session = Depends(get_db)) -> dict:
    """Public healthcheck endpoint. Confirms API availability and reports live database status."""
    db_status = "disconnected"
    try:
        db.execute(text("SELECT 1"))
        db_status = "connected"
    except SQLAlchemyError as exc:
        logger.warning("Health check database probe failed: %s", type(exc).__name__)

    return {
        "status": "ok",
        "database": db_status,
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
app.include_router(api_roadmap.alias_router)
app.include_router(api_lessons.router)
app.include_router(api_flashcards.router)
app.include_router(api_sessions.router)
app.include_router(api_buddy.router)
