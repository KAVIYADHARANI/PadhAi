"""Rate limiting and user quota management.

Implements BUILD_PLAYBOOK.md Phase 8 Task 8B and README Section 10 & 14:
- Per-user sliding-window rate limits for chat, upload, and Buddy-line endpoints.
- User daily LLM call quota check against USER_DAILY_LLM_CALLS.
- Returns clean, user-friendly 429 Too Many Requests errors with Retry-After headers.
"""

import math
import threading
import time
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import LLMUsage

# In-memory sliding window history: dict[(user_id, endpoint_type), list[float]]
_rate_limit_lock = threading.Lock()
_request_history: dict[tuple[int, str], list[float]] = defaultdict(list)


def reset_rate_limits() -> None:
    """Clears in-memory rate limit request history. Useful for unit tests."""
    with _rate_limit_lock:
        _request_history.clear()


def check_rate_limit(user_id: int, endpoint_type: str) -> None:
    """Enforces sliding-window per-minute rate limits for a user and endpoint.

    Args:
        user_id: The authenticated user's ID.
        endpoint_type: One of 'chat', 'upload', 'buddy'.

    Raises:
        HTTPException 429 if the request rate exceeds configured thresholds.
    """
    now = time.time()
    window_s = 60.0

    if endpoint_type == "chat":
        limit = settings.RATE_LIMIT_CHAT_RPM
        friendly_name = "AI chat and tutoring"
    elif endpoint_type == "upload":
        limit = settings.RATE_LIMIT_UPLOAD_RPM
        friendly_name = "document uploads"
    elif endpoint_type == "buddy":
        limit = settings.RATE_LIMIT_BUDDY_RPM
        friendly_name = "companion updates"
    else:
        limit = 60
        friendly_name = endpoint_type

    key = (user_id, endpoint_type)

    with _rate_limit_lock:
        timestamps = _request_history[key]
        # Prune entries older than 60 seconds
        cutoff = now - window_s
        pruned = [ts for ts in timestamps if ts > cutoff]

        if len(pruned) >= limit:
            # Exceeded limit. Calculate wait time until the oldest request in the window expires.
            oldest = pruned[0]
            retry_after = max(1, math.ceil(oldest + window_s - now))
            _request_history[key] = pruned
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded for {friendly_name}. You have reached the maximum of {limit} requests per minute. Please try again in {retry_after} second{'s' if retry_after != 1 else ''}.",
                headers={"Retry-After": str(retry_after)},
            )

        # Record this request
        pruned.append(now)
        _request_history[key] = pruned


def check_daily_llm_quota(db: Session, user_id: int) -> None:
    """Enforces daily total LLM call quota per user per README Section 17.

    Args:
        db: SQLAlchemy database session.
        user_id: The authenticated user's ID.

    Raises:
        HTTPException 429 if the user has reached or exceeded USER_DAILY_LLM_CALLS today.
    """
    today_utc = datetime.now(UTC).date()
    max_daily_calls = settings.USER_DAILY_LLM_CALLS

    # Query sum of calls today for user
    total_calls = (
        db.query(func.coalesce(func.sum(LLMUsage.calls), 0))
        .filter(LLMUsage.user_id == user_id, LLMUsage.day == today_utc)
        .scalar()
        or 0
    )

    if total_calls >= max_daily_calls:
        # Calculate seconds until midnight UTC
        now_utc = datetime.now(UTC)
        tomorrow_utc = datetime.combine(today_utc + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
        seconds_until_reset = max(1, int((tomorrow_utc - now_utc).total_seconds()))

        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Daily AI study assistant quota reached ({max_daily_calls} calls/day). Your allowance resets at midnight UTC.",
            headers={"Retry-After": str(seconds_until_reset)},
        )
