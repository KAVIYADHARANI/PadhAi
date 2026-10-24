"""Session logging endpoints for study sessions and break events.

Enforces strict user_id filtering at the SQL level.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.schemas import (
    BreakEventCreateRequest,
    BreakEventResponse,
    StudySessionCreateRequest,
    StudySessionResponse,
    StudySessionUpdateRequest,
)
from app.core.auth import get_current_user
from app.db.models import BreakEvent, Course, StudySession, User
from app.db.session import get_db

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=StudySessionResponse, status_code=status.HTTP_201_CREATED)
def start_session(
    payload: StudySessionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StudySessionResponse:
    """Start a new study session for an authenticated user and course."""
    # Enforce course ownership at the SQL level
    course = (
        db.query(Course)
        .filter(Course.id == payload.course_id, Course.user_id == current_user.id)
        .first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    session = StudySession(
        user_id=current_user.id,
        course_id=course.id,
        started_at=datetime.now(UTC),
        pomodoros=0,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.patch("/{session_id}", response_model=StudySessionResponse)
def update_session(
    session_id: int,
    payload: StudySessionUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StudySessionResponse:
    """Update or conclude an active study session with aggregate metrics."""
    session = (
        db.query(StudySession)
        .filter(StudySession.id == session_id, StudySession.user_id == current_user.id)
        .first()
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Study session not found",
        )

    if payload.pomodoros is not None:
        session.pomodoros = payload.pomodoros
    if payload.focus_avg is not None:
        session.focus_avg = payload.focus_avg
    if payload.drowsy_minutes is not None:
        session.drowsy_minutes = payload.drowsy_minutes
    if payload.ended and session.ended_at is None:
        session.ended_at = datetime.now(UTC)

    db.commit()
    db.refresh(session)
    return session


@router.post(
    "/{session_id}/breaks",
    response_model=BreakEventResponse,
    status_code=status.HTTP_201_CREATED,
)
def record_break_event(
    session_id: int,
    payload: BreakEventCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BreakEventResponse:
    """Record a break prompt outcome for adaptive threshold tuning."""
    session = (
        db.query(StudySession)
        .filter(StudySession.id == session_id, StudySession.user_id == current_user.id)
        .first()
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Study session not found",
        )

    event = BreakEvent(
        session_id=session.id,
        user_id=current_user.id,
        break_type=payload.break_type,
        outcome=payload.outcome,
        cooldown_at_time_s=payload.cooldown_at_time_s,
        created_at=datetime.now(UTC),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
