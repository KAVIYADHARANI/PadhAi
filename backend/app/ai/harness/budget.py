"""Budget tracking and quota enforcement for AI Agent Harness.

Enforces per-request limits (calls, tokens, tool rounds, wall-clock time)
and per-user daily quotas backed by the llm_usage database table.
Fails closed when limits are reached, and never assumes missing usage is zero cost.
"""

import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.harness.exceptions import BudgetExhaustedError, DailyQuotaExhaustedError
from app.core.config import settings
from app.db.models import LLMUsage


@dataclass
class RequestBudget:
    """Per-request budget tracker and guard.

    Enforces caps on total calls, tokens, tool rounds, and elapsed wall-clock time.
    """

    max_calls: int = field(default_factory=lambda: settings.REQUEST_MAX_LLM_CALLS)
    max_tokens: int = 16_384
    max_tool_rounds: int = 2
    max_wall_time_s: float = 60.0

    calls_used: int = 0
    tokens_used: int = 0
    tool_rounds_used: int = 0
    start_time: float = field(default_factory=time.time)

    def check_budget(self) -> None:
        """Validate that current usage has not reached or exceeded any configured limits.

        Fails closed by raising BudgetExhaustedError immediately before a new call or round is attempted.
        """
        if self.calls_used >= self.max_calls:
            raise BudgetExhaustedError(
                f"Per-request LLM call limit reached ({self.calls_used}/{self.max_calls})"
            )

        if self.tokens_used >= self.max_tokens:
            raise BudgetExhaustedError(
                f"Per-request token limit reached ({self.tokens_used}/{self.max_tokens})"
            )

        if self.tool_rounds_used >= self.max_tool_rounds:
            raise BudgetExhaustedError(
                f"Per-request tool round limit reached ({self.tool_rounds_used}/{self.max_tool_rounds})"
            )

        elapsed = time.time() - self.start_time
        if elapsed >= self.max_wall_time_s:
            raise BudgetExhaustedError(
                f"Per-request wall-clock time limit reached ({elapsed:.1f}s/{self.max_wall_time_s:.1f}s)"
            )

    def consume(
        self,
        *,
        calls: int = 1,
        tokens_in: int = 0,
        tokens_out: int = 0,
        tool_rounds: int = 0,
        prompt_chars: int = 0,
        completion_chars: int = 0,
    ) -> None:
        """Record resource consumption against the budget.

        SECURITY RULE: Do not assume missing usage data is zero cost.
        If tokens are reported as 0, estimate conservatively based on character counts
        or apply a mandatory floor.
        """
        # Conservative token estimation if provider returns missing / 0 usage
        resolved_in = tokens_in
        resolved_out = tokens_out

        if resolved_in <= 0 and calls > 0:
            resolved_in = max(25, prompt_chars // 4) if prompt_chars > 0 else 25

        if resolved_out <= 0 and calls > 0:
            resolved_out = max(25, completion_chars // 4) if completion_chars > 0 else 25

        self.calls_used += calls
        self.tokens_used += (resolved_in + resolved_out)
        self.tool_rounds_used += tool_rounds

        if self.tokens_used > self.max_tokens:
            raise BudgetExhaustedError(
                f"Per-request token limit reached ({self.tokens_used}/{self.max_tokens})"
            )

        if self.calls_used > self.max_calls:
            raise BudgetExhaustedError(
                f"Per-request LLM call limit reached ({self.calls_used}/{self.max_calls})"
            )

        if self.tool_rounds_used > self.max_tool_rounds:
            raise BudgetExhaustedError(
                f"Per-request tool round limit reached ({self.tool_rounds_used}/{self.max_tool_rounds})"
            )


class DailyUserBudget:
    """Enforces daily call quotas per user against the llm_usage table."""

    @staticmethod
    def check_daily_quota(
        db: Session,
        user_id: int,
        daily_limit: int | None = None,
    ) -> int:
        """Verify that the user has not exceeded their daily LLM call quota.

        Fails closed by raising BudgetExhaustedError.
        """
        limit = daily_limit or settings.USER_DAILY_LLM_CALLS
        today = datetime.now(UTC).date()

        stmt = select(func.coalesce(func.sum(LLMUsage.calls), 0)).where(
            LLMUsage.user_id == user_id,
            LLMUsage.day == today,
        )
        total_calls: int = db.scalar(stmt) or 0

        if total_calls >= limit:
            raise DailyQuotaExhaustedError(
                f"Daily quota of {limit} LLM calls exceeded for user {user_id} (used: {total_calls})"
            )

        return total_calls

    @staticmethod
    def record_usage(
        db: Session,
        *,
        user_id: int,
        provider: str,
        model: str,
        calls: int = 1,
        tokens_in: int = 0,
        tokens_out: int = 0,
        prompt_chars: int = 0,
        completion_chars: int = 0,
    ) -> LLMUsage:
        """Update or insert usage record for user, day, provider, and model."""
        today = datetime.now(UTC).date()

        # Conservative estimation if missing usage data
        resolved_in = tokens_in
        resolved_out = tokens_out
        if resolved_in <= 0:
            resolved_in = max(25, prompt_chars // 4) if prompt_chars > 0 else 25
        if resolved_out <= 0:
            resolved_out = max(25, completion_chars // 4) if completion_chars > 0 else 25

        stmt = select(LLMUsage).where(
            LLMUsage.user_id == user_id,
            LLMUsage.day == today,
            LLMUsage.provider == provider,
            LLMUsage.model == model,
        )
        usage_row = db.scalar(stmt)

        if usage_row is None:
            usage_row = LLMUsage(
                user_id=user_id,
                day=today,
                provider=provider,
                model=model,
                calls=calls,
                tokens_in=resolved_in,
                tokens_out=resolved_out,
            )
            db.add(usage_row)
        else:
            usage_row.calls += calls
            usage_row.tokens_in += resolved_in
            usage_row.tokens_out += resolved_out

        db.commit()
        db.refresh(usage_row)
        return usage_row
