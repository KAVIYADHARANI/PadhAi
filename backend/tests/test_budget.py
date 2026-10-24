"""Tests for Budget enforcement: request caps, missing usage data estimation, and daily user quotas."""

import time

import pytest

from app.ai.harness.budget import DailyUserBudget, RequestBudget
from app.ai.harness.exceptions import BudgetExhaustedError
from app.db.models import User


def test_request_budget_max_calls_exhaustion():
    budget = RequestBudget(max_calls=3)
    budget.consume(calls=1)
    budget.consume(calls=1)
    assert budget.calls_used == 2

    # Consuming the 3rd call is allowed (calls_used == 3)
    budget.consume(calls=1)
    assert budget.calls_used == 3

    # Consuming the 4th call exceeds max_calls and raises
    with pytest.raises(BudgetExhaustedError, match="call limit reached"):
        budget.consume(calls=1)


def test_request_budget_token_cap_exhaustion():
    budget = RequestBudget(max_tokens=100)
    budget.consume(calls=1, tokens_in=60, tokens_out=30)
    assert budget.tokens_used == 90

    with pytest.raises(BudgetExhaustedError, match="token limit reached"):
        budget.consume(calls=1, tokens_in=20, tokens_out=0)


def test_request_budget_tool_rounds_exhaustion():
    budget = RequestBudget(max_tool_rounds=2)
    budget.consume(calls=1, tool_rounds=1)
    budget.consume(calls=1, tool_rounds=1)
    assert budget.tool_rounds_used == 2

    # Exceeding tool rounds raises
    with pytest.raises(BudgetExhaustedError, match="tool round limit reached"):
        budget.consume(calls=1, tool_rounds=1)


def test_request_budget_wall_clock_timeout():
    budget = RequestBudget(max_wall_time_s=0.1)
    time.sleep(0.12)
    with pytest.raises(BudgetExhaustedError, match="wall-clock time limit reached"):
        budget.check_budget()


def test_request_budget_missing_usage_data_never_zero_cost():
    budget = RequestBudget(max_tokens=1000)
    # Provider reports 0 tokens in and 0 tokens out
    budget.consume(calls=1, tokens_in=0, tokens_out=0, prompt_chars=200, completion_chars=100)

    # Must estimate conservatively rather than treating as 0
    assert budget.tokens_used > 0
    # 200 // 4 = 50, 100 // 4 = 25 -> 75 tokens
    assert budget.tokens_used == 75


def test_daily_user_budget_quota_and_db_tracking(db_session):
    # Create test user
    user = User(firebase_uid="uid_budget_test", email="budget@example.com")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    # Record 10 calls for user today
    DailyUserBudget.record_usage(
        db_session,
        user_id=user.id,
        provider="openrouter",
        model="test-model",
        calls=10,
        tokens_in=500,
        tokens_out=200,
    )

    used = DailyUserBudget.check_daily_quota(db_session, user_id=user.id, daily_limit=15)
    assert used == 10

    # Record 5 more calls to reach limit 15
    DailyUserBudget.record_usage(
        db_session,
        user_id=user.id,
        provider="openrouter",
        model="test-model",
        calls=5,
        tokens_in=250,
        tokens_out=100,
    )

    # Reaching limit fails closed
    with pytest.raises(BudgetExhaustedError, match="Daily quota of 15 LLM calls exceeded"):
        DailyUserBudget.check_daily_quota(db_session, user_id=user.id, daily_limit=15)
