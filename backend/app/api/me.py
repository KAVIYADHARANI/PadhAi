"""User profile and identity router."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.schemas import UserResponse
from app.core.auth import get_current_user
from app.core.storage import StorageBackend, get_storage
from app.db.models import User
from app.db.session import get_db

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """Returns the authenticated user details."""
    return UserResponse.model_validate(current_user)


@router.delete("", status_code=204)
def delete_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: StorageBackend = Depends(get_storage),
) -> None:
    """Account-level 'delete everything' flow per README Section 5 and Phase 8 Task 8A.
    Completely purges all courses, files, documents, chats, flashcards, buddy state, and the user.
    """
    from app.api.courses import delete_course
    from app.db.models import BuddyState, Course, GuardrailEvent, LLMUsage

    # 1. Cascade delete every course owned by the user
    courses = db.query(Course).filter(Course.user_id == current_user.id).all()
    for course in courses:
        delete_course(course.id, current_user, db, storage)

    # 2. Delete buddy state, usage, guardrail events
    db.query(BuddyState).filter(BuddyState.user_id == current_user.id).delete(synchronize_session=False)
    db.query(LLMUsage).filter(LLMUsage.user_id == current_user.id).delete(synchronize_session=False)
    db.query(GuardrailEvent).filter(GuardrailEvent.user_id == current_user.id).delete(synchronize_session=False)

    # 3. Delete user row
    db.delete(current_user)
    db.commit()
