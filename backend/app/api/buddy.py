"""Study companion preferences and configuration endpoints.

Enforces strict user_id filtering at the SQL level.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.schemas import (
    BuddySettingsResponse,
    BuddySettingsUpdateRequest,
)
from app.core.auth import get_current_user
from app.db.models import BuddyState, User
from app.db.session import get_db

router = APIRouter(prefix="/api/buddy", tags=["buddy"])


@router.get("/settings", response_model=BuddySettingsResponse)
def get_buddy_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuddySettingsResponse:
    """Fetch user's study companion preferences, creating default record if missing."""
    state = (
        db.query(BuddyState)
        .filter(BuddyState.user_id == current_user.id)
        .first()
    )
    if not state:
        state = BuddyState(
            user_id=current_user.id,
            persona_pack="tanglish",
            tone_mode="balanced",
            address_term="boss",
            sensitivity="balanced",
            camera_enabled=False,
            updated_at=datetime.now(UTC),
        )
        db.add(state)
        db.commit()
        db.refresh(state)

    return state


@router.patch("/settings", response_model=BuddySettingsResponse)
def update_buddy_settings(
    payload: BuddySettingsUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BuddySettingsResponse:
    """Update user's study companion preferences."""
    state = (
        db.query(BuddyState)
        .filter(BuddyState.user_id == current_user.id)
        .first()
    )
    if not state:
        state = BuddyState(
            user_id=current_user.id,
            persona_pack=payload.persona_pack or "tanglish",
            tone_mode=payload.tone_mode or "balanced",
            address_term=payload.address_term or "boss",
            sensitivity=payload.sensitivity or "balanced",
            camera_enabled=payload.camera_enabled or False,
            updated_at=datetime.now(UTC),
        )
        db.add(state)
    else:
        if payload.persona_pack is not None:
            state.persona_pack = payload.persona_pack
        if payload.tone_mode is not None:
            state.tone_mode = payload.tone_mode
        if payload.address_term is not None:
            state.address_term = payload.address_term
        if payload.sensitivity is not None:
            state.sensitivity = payload.sensitivity
        if payload.camera_enabled is not None:
            state.camera_enabled = payload.camera_enabled
        state.updated_at = datetime.now(UTC)

    db.commit()
    db.refresh(state)
    return state
