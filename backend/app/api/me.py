"""User profile and identity router."""

from fastapi import APIRouter, Depends

from app.api.schemas import UserResponse
from app.core.auth import get_current_user
from app.db.models import User

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """Returns the authenticated user details."""
    return UserResponse.model_validate(current_user)
