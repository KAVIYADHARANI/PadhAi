"""Chat endpoint providing grounded tutor interactions via the LangGraph pipeline."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.tutor.graph import tutor_app
from app.buddy.tone import ToneContext
from app.core.auth import get_current_user
from app.db.models import Course, User
from app.db.session import get_db

router = APIRouter(prefix="/api/courses/{course_id}/chat", tags=["chat"])


class ChatRequest(BaseModel):
    """Payload for asking the tutor a question."""

    message: str = Field(..., min_length=1, max_length=4000)
    minutes_since_last_session: float | None = None
    recent_miss_count: int = Field(default=0, ge=0)
    quiz_active: bool = False
    mastery_event: bool = False
    break_prompt: bool = False
    teased_this_session: bool = False
    user_tone_setting: Literal["full", "balanced", "serious", "english_only"] = "balanced"


class ChatResponse(BaseModel):
    """Response returned by the tutor."""

    reply: str
    citations: list[str] = Field(default_factory=list)
    tone: str = "patient"
    is_sufficient: bool = True


@router.post("", response_model=ChatResponse, status_code=status.HTTP_200_OK)
async def chat_with_tutor(
    course_id: int,
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    """Send a question to the tutor for a specific course.

    Ensures the course belongs to the authenticated user.
    Executes the LangGraph pipeline with layered guardrails and deterministic persona.
    """
    # 1. Enforce course ownership at the SQL level
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.user_id == current_user.id)
        .first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # 2. Build ToneContext from payload
    tone_ctx = ToneContext(
        minutes_since_last_session=payload.minutes_since_last_session,
        recent_miss_count=payload.recent_miss_count,
        quiz_active=payload.quiz_active,
        mastery_event=payload.mastery_event,
        break_prompt=payload.break_prompt,
        teased_this_session=payload.teased_this_session,
        user_tone_setting=payload.user_tone_setting,
    )

    # 3. Invoke LangGraph
    initial_state = {
        "db": db,
        "user_id": current_user.id,
        "course_id": course.id,
        "message": payload.message,
        "tone_context": tone_ctx,
    }

    result = await tutor_app.ainvoke(initial_state)

    return ChatResponse(
        reply=result.get("final_reply", ""),
        citations=result.get("citations", []),
        tone=result.get("tone", "patient"),
        is_sufficient=result.get("is_sufficient", True),
    )
