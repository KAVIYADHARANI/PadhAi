"""Tests for grounded course chat history persistence and endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.core.auth import get_current_user
from app.db.models import Course, User
from app.main import app


@pytest.fixture
def chat_user(db_session):
    user = User(firebase_uid="uid_chat_1", email="chat1@example.com", display_name="Chat User")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def other_chat_user(db_session):
    user = User(firebase_uid="uid_chat_2", email="chat2@example.com", display_name="Other Chat User")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def chat_course(db_session, chat_user):
    course = Course(
        user_id=chat_user.id,
        name="Computer Systems",
        goal_days=14,
        hours_per_day=2.0,
    )
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)
    return course


def test_chat_persistence_and_history_lifecycle(
    client, chat_user, other_chat_user, chat_course
):
    """Verifies that chat conversations are persisted to DB, retrievable, clearable, and isolated."""
    app.dependency_overrides[get_current_user] = lambda: chat_user

    try:
        # 1. Initial history is empty
        res = client.get(f"/api/courses/{chat_course.id}/chat/history")
        assert res.status_code == 200
        data = res.json()
        assert data["messages"] == []
        assert data["thread_id"] is None

        # 2. Mock tutor_app.ainvoke to return a grounded response
        mock_pipeline_result = {
            "final_reply": "Virtual memory provides an abstraction of main memory [doc p.42].",
            "citations": ["[doc p.42]"],
            "tone": "patient",
            "is_sufficient": True,
        }

        with patch("app.api.chat.tutor_app.ainvoke", new=AsyncMock(return_value=mock_pipeline_result)):
            post_res = client.post(
                f"/api/courses/{chat_course.id}/chat",
                json={"message": "What is virtual memory?"},
            )
            assert post_res.status_code == 200
            post_data = post_res.json()
            assert "Virtual memory" in post_data["reply"]
            assert post_data["citations"] == ["[doc p.42]"]

        # 3. Retrieve history and assert both user and assistant messages exist
        hist_res = client.get(f"/api/courses/{chat_course.id}/chat/history")
        assert hist_res.status_code == 200
        hist_data = hist_res.json()
        assert len(hist_data["messages"]) == 2

        user_msg = hist_data["messages"][0]
        assert user_msg["role"] == "user"
        assert user_msg["content"] == "What is virtual memory?"

        bot_msg = hist_data["messages"][1]
        assert bot_msg["role"] == "assistant"
        assert "[doc p.42]" in bot_msg["content"]
        assert bot_msg["citations"] == ["[doc p.42]"]
        assert bot_msg["tone"] == "patient"

        # 4. Cross-user isolation check
        app.dependency_overrides[get_current_user] = lambda: other_chat_user
        isolated_res = client.get(f"/api/courses/{chat_course.id}/chat/history")
        assert isolated_res.status_code == 404

        # 5. Clear history as owner
        app.dependency_overrides[get_current_user] = lambda: chat_user
        del_res = client.delete(f"/api/courses/{chat_course.id}/chat/history")
        assert del_res.status_code == 204

        # Verify history is now empty
        empty_res = client.get(f"/api/courses/{chat_course.id}/chat/history")
        assert empty_res.status_code == 200
        assert empty_res.json()["messages"] == []

    finally:
        app.dependency_overrides.pop(get_current_user, None)
