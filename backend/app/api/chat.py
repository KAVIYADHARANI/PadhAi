"""Chat endpoint providing grounded tutor interactions via the LangGraph pipeline."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.ai.harness.exceptions import AuthenticationError
from app.ai.tutor.graph import tutor_app
from app.api.schemas import ChatHistoryResponse, ChatMessageItem, SourceReference
from app.buddy.tone import ToneContext
from app.core.auth import get_current_user
from app.core.quota import check_daily_llm_quota, check_rate_limit
from app.db.models import ChatMessageRecord, ChatThread, Course, User
from app.db.session import get_db

router = APIRouter(prefix="/api/courses/{course_id}/chat", tags=["chat"])


def format_sse(event: str, data: dict[str, Any]) -> str:
    """Formats a message payload as a Server-Sent Events (SSE) block."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


class ChatRequest(BaseModel):
    """Payload for asking the tutor a question."""

    message: str = Field(..., min_length=1, max_length=4000)
    intent: str | None = Field(default=None, description="Explicit UI intent, e.g. quiz, cards, plan, progress")
    stream: bool = Field(default=False, description="Enable SSE token streaming response")
    academic_integrity: bool = Field(default=True, description="Enforce academic integrity scaffolding for graded work")
    minutes_since_last_session: float | None = None
    recent_miss_count: int = Field(default=0, ge=0)
    quiz_active: bool = False
    mastery_event: bool = False
    break_prompt: bool = False
    teased_this_session: bool = False
    user_tone_setting: Literal["full", "balanced", "serious", "english_only"] = "balanced"


class ChatResponse(BaseModel):
    """Response returned by the tutor and multi-agent router."""

    reply: str
    clean_answer: str | None = None
    sources: list[SourceReference] = Field(default_factory=list)
    citations: list[str] = Field(default_factory=list)
    tone: str = "patient"
    is_sufficient: bool = True
    grounding_status: str = "grounded"
    agent: str = "tutor"
    route_source: str = "rule"
    route_confidence: float = 1.0
    confirmation_chip: str | None = None
    follow_up_chip: str | None = None


@router.get("/history", response_model=ChatHistoryResponse)
def get_chat_history(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatHistoryResponse:
    """Retrieves conversation history with the course tutor.

    Strictly scoped to the authenticated user and course ID at the SQL level.
    """
    course = (
        db.query(Course).filter(Course.id == course_id, Course.user_id == current_user.id).first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    thread = (
        db.query(ChatThread)
        .filter(ChatThread.course_id == course_id, ChatThread.user_id == current_user.id)
        .first()
    )
    if not thread:
        return ChatHistoryResponse(course_id=course_id, thread_id=None, messages=[])

    messages = (
        db.query(ChatMessageRecord)
        .filter(ChatMessageRecord.thread_id == thread.id)
        .order_by(ChatMessageRecord.created_at.asc())
        .all()
    )

    return ChatHistoryResponse(
        course_id=course_id,
        thread_id=thread.id,
        messages=[ChatMessageItem.model_validate(m) for m in messages],
    )


@router.delete("/history", status_code=status.HTTP_204_NO_CONTENT)
def clear_chat_history(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Clears conversation history for this course.

    Strictly scoped to the authenticated user and course ID at the SQL level.
    """
    course = (
        db.query(Course).filter(Course.id == course_id, Course.user_id == current_user.id).first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    thread = (
        db.query(ChatThread)
        .filter(ChatThread.course_id == course_id, ChatThread.user_id == current_user.id)
        .first()
    )
    if thread:
        db.delete(thread)
        db.commit()


@router.post("", response_model=ChatResponse | None, status_code=status.HTTP_200_OK)
async def chat_with_tutor(
    course_id: int,
    payload: ChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Any:
    """Send a question to the tutor for a specific course.

    Ensures the course belongs to the authenticated user.
    Executes the LangGraph pipeline with layered guardrails and deterministic persona.
    Supports standard JSON responses and SSE streaming (when stream=True or Accept: text/event-stream).
    Persists user questions and grounded assistant replies to the chat history.
    """
    # 0. Enforce per-user rate limits and daily LLM quota
    check_rate_limit(current_user.id, "chat")
    check_daily_llm_quota(db, current_user.id)

    # 1. Enforce course ownership at the SQL level
    course = (
        db.query(Course).filter(Course.id == course_id, Course.user_id == current_user.id).first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # 2. Find or create persistent chat thread
    thread = (
        db.query(ChatThread)
        .filter(ChatThread.course_id == course_id, ChatThread.user_id == current_user.id)
        .first()
    )
    if not thread:
        thread = ChatThread(course_id=course_id, user_id=current_user.id)
        db.add(thread)
        db.flush()

    # 3. Persist user message record
    user_msg_record = ChatMessageRecord(
        thread_id=thread.id,
        user_id=current_user.id,
        course_id=course_id,
        role="user",
        content=payload.message,
        citations=[],
        tone=None,
        is_sufficient=True,
    )
    db.add(user_msg_record)
    db.flush()

    # 4. Build ToneContext from payload
    tone_ctx = ToneContext(
        minutes_since_last_session=payload.minutes_since_last_session,
        recent_miss_count=payload.recent_miss_count,
        quiz_active=payload.quiz_active,
        mastery_event=payload.mastery_event,
        break_prompt=payload.break_prompt,
        teased_this_session=payload.teased_this_session,
        user_tone_setting=payload.user_tone_setting,
    )

    # 5. Extract short conversation history (at most 3 previous messages, no document text)
    recent_history: list[dict[str, str]] = []
    if thread:
        prior_messages = (
            db.query(ChatMessageRecord)
            .filter(ChatMessageRecord.thread_id == thread.id, ChatMessageRecord.id != user_msg_record.id)
            .order_by(ChatMessageRecord.created_at.desc())
            .limit(3)
            .all()
        )
        for m in reversed(prior_messages):
            recent_history.append({"role": m.role, "content": m.content})

    # 6. Invoke LangGraph
    initial_state = {
        "db": db,
        "user_id": current_user.id,
        "course_id": course.id,
        "message": payload.message,
        "intent": payload.intent,
        "history": recent_history,
        "tone_context": tone_ctx,
        "academic_integrity": payload.academic_integrity,
    }

    try:
        result = await tutor_app.ainvoke(initial_state)
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No LLM provider API key configured. Please set GROQ_API_KEY, "
                "OPENROUTER_API_KEY, or GOOGLE_API_KEY in your .env file."
            ),
        ) from exc
    except Exception as exc:
        err_msg = str(exc)
        if "No LLM provider API key configured" in err_msg:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=err_msg,
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Chat generation failed: {exc}",
        ) from exc

    reply_text = result.get("final_reply", "")
    clean_ans = result.get("clean_answer", reply_text)
    citations_list = result.get("citations", [])
    raw_sources = result.get("sources", [])
    grounding_status = result.get("grounding_status", "grounded")
    sources_list = [SourceReference(**s) if isinstance(s, dict) else s for s in raw_sources]
    tone_str = result.get("tone", "patient")
    is_sufficient_bool = result.get("is_sufficient", True)

    # 7. Persist assistant response record
    assistant_msg_record = ChatMessageRecord(
        thread_id=thread.id,
        user_id=current_user.id,
        course_id=course_id,
        role="assistant",
        content=reply_text,
        citations=citations_list,
        tone=tone_str,
        is_sufficient=is_sufficient_bool,
    )
    db.add(assistant_msg_record)
    thread.updated_at = datetime.now(UTC)
    db.commit()

    # 8. Check if client requested SSE streaming
    is_stream = payload.stream or ("text/event-stream" in request.headers.get("accept", ""))
    if is_stream:
        async def event_generator() -> AsyncGenerator[str, None]:
            # Emit agent and route source
            yield format_sse(
                "agent",
                {
                    "agent": result.get("route_agent", "tutor"),
                    "confidence": result.get("route_confidence", 1.0),
                },
            )
            yield format_sse("route_source", {"source": result.get("route_source", "rule")})

            # Emit confirmation or follow-up chip if present
            conf_chip = result.get("confirmation_chip")
            follow_chip = result.get("follow_up_chip")
            if conf_chip or follow_chip:
                yield format_sse(
                    "chip",
                    {
                        "confirmation_chip": conf_chip,
                        "follow_up_chip": follow_chip,
                    },
                )

            # Stream words / token chunks
            words = reply_text.split(" ")
            for i, word in enumerate(words):
                token = word + (" " if i < len(words) - 1 else "")
                yield format_sse("token", {"token": token})
                await asyncio.sleep(0.002)

            # Emit replace event if post-generation grounding failed
            if grounding_status in ("unverified", "failed"):
                safe_fallback = "I could not verify this from your uploaded course documents."
                yield format_sse("replace", {"reply": safe_fallback, "reason": "unverified_grounding"})

            # Emit citations and sources
            yield format_sse(
                "citations",
                {
                    "citations": citations_list,
                    "sources": [s.model_dump() if hasattr(s, "model_dump") else s for s in sources_list],
                },
            )

            # Emit done event
            yield format_sse(
                "done",
                {
                    "status": "completed",
                    "tone": tone_str,
                    "is_sufficient": is_sufficient_bool,
                    "grounding_status": grounding_status,
                },
            )

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return ChatResponse(
        reply=reply_text,
        clean_answer=clean_ans,
        sources=sources_list,
        citations=citations_list,
        tone=tone_str,
        is_sufficient=is_sufficient_bool,
        grounding_status=grounding_status,
        agent=result.get("route_agent", "tutor"),
        route_source=result.get("route_source", "rule"),
        route_confidence=result.get("route_confidence", 1.0),
        confirmation_chip=result.get("confirmation_chip"),
        follow_up_chip=result.get("follow_up_chip"),
    )
