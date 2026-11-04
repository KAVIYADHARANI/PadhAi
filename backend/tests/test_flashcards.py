"""Tests for Phase 5A: Flashcards and Spaced Repetition (SM-2).

Covers:
1. SM-2 calculation engine:
   - Initial interval (1 day) and reps=1 on first successful recall.
   - Second interval (6 days) and reps=2 on second successful recall.
   - Multiplicative interval growth with ease factor on subsequent reviews.
   - Failure (quality < 3) resets repetitions to 0 and interval to 1 day.
   - Ease factor clamp (minimum 1.3).
   - Input validation (0 <= quality <= 5).
2. Deduplication helper tests.
3. Flashcards API endpoints:
   - POST /api/flashcards/generate with FakeLLM.
   - Deduplication prevents duplicate cards on subsequent generation.
   - GET /api/flashcards/due returns only cards due for review.
   - GET /api/flashcards returns all cards with counts.
   - POST /api/flashcards/{id}/review updates intervals and due dates according to SM-2.
   - DELETE /api/flashcards/{id} deletes card.
4. Security & Isolation:
   - Cross-user generation, retrieval, review, and deletion return 404.
"""

import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.ai.flashcards.flashcard_gen import normalize_card_text
from app.ai.harness.fake import FakeLLM
from app.ai.harness.gateway import LLMGateway
from app.api.flashcards import get_llm_gateway
from app.db.models import Chunk, Course, Document, Flashcard, Topic, User
from app.learning.srs import MIN_EASE_FACTOR, calculate_sm2
from app.main import app

# ---------------------------------------------------------------------------
# 1. Pure SM-2 Engine Unit Tests
# ---------------------------------------------------------------------------

def test_sm2_first_review_perfect():
    now = datetime(2026, 10, 26, 12, 0, 0, tzinfo=UTC)
    result = calculate_sm2(reps=0, interval_days=0, ease_factor=2.5, quality=5, now=now)

    assert result.reps == 1
    assert result.interval_days == 1
    assert result.ease_factor == 2.6  # 2.5 + (0.1 - 0) = 2.6
    assert result.due_date == now + timedelta(days=1)


def test_sm2_second_review_perfect():
    now = datetime(2026, 10, 26, 12, 0, 0, tzinfo=UTC)
    result = calculate_sm2(reps=1, interval_days=1, ease_factor=2.6, quality=5, now=now)

    assert result.reps == 2
    assert result.interval_days == 6
    assert result.ease_factor == 2.7
    assert result.due_date == now + timedelta(days=6)


def test_sm2_third_review_good():
    now = datetime(2026, 10, 26, 12, 0, 0, tzinfo=UTC)
    result = calculate_sm2(reps=2, interval_days=6, ease_factor=2.7, quality=4, now=now)

    assert result.reps == 3
    # delta for quality=4: 0.1 - (1) * (0.08 + 0.02) = 0.1 - 0.1 = 0.0
    assert result.ease_factor == 2.7
    # interval: round(6 * 2.7) = round(16.2) = 16
    assert result.interval_days == 16
    assert result.due_date == now + timedelta(days=16)


def test_sm2_failure_resets_streak_and_interval():
    now = datetime(2026, 10, 26, 12, 0, 0, tzinfo=UTC)
    # Review with quality < 3
    result = calculate_sm2(reps=4, interval_days=30, ease_factor=2.5, quality=1, now=now)

    assert result.reps == 0
    assert result.interval_days == 1
    assert result.ease_factor < 2.5
    assert result.due_date == now + timedelta(days=1)


def test_sm2_ease_factor_minimum_clamp():
    now = datetime(2026, 10, 26, 12, 0, 0, tzinfo=UTC)
    # Multiple failures down to minimum
    ef = 1.4
    result = calculate_sm2(reps=0, interval_days=1, ease_factor=ef, quality=0, now=now)
    assert result.ease_factor == MIN_EASE_FACTOR


def test_sm2_invalid_quality_raises():
    with pytest.raises(ValueError):
        calculate_sm2(reps=0, interval_days=0, ease_factor=2.5, quality=6)

    with pytest.raises(ValueError):
        calculate_sm2(reps=0, interval_days=0, ease_factor=2.5, quality=-1)


def test_normalize_card_text():
    assert normalize_card_text("What is React's Virtual DOM?") == "whatisreactsvirtualdom"
    assert normalize_card_text("   WHAT is   React?! ") == "whatisreact"


# ---------------------------------------------------------------------------
# 2. Database and API Integration Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def test_course_with_chunks(db_session: Session) -> Course:
    user = User(firebase_uid="firebase_uid_1", email="user1@example.com", display_name="User One")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    course = Course(user_id=user.id, name="Distributed Systems", goal_days=30, hours_per_day=1.5, level="intermediate")
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    topic = Topic(course_id=course.id, name="Raft Consensus", description="Leader election and log replication")
    db_session.add(topic)
    db_session.commit()
    db_session.refresh(topic)

    doc = Document(course_id=course.id, user_id=user.id, file_uri="/docs/raft.pdf", status="ready")
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    chunk1 = Chunk(
        document_id=doc.id,
        course_id=course.id,
        user_id=user.id,
        page=1,
        heading_path="Raft / Leader Election",
        text="Raft divides time into terms of arbitrary length. Terms are numbered with consecutive integers.",
    )
    chunk2 = Chunk(
        document_id=doc.id,
        course_id=course.id,
        user_id=user.id,
        page=2,
        heading_path="Raft / Heartbeats",
        text="Leaders send periodic heartbeats (AppendEntries RPCs with no log entries) to maintain authority.",
    )
    db_session.add_all([chunk1, chunk2])
    db_session.commit()
    db_session.refresh(chunk1)
    db_session.refresh(chunk2)

    return course


def test_generate_and_review_flashcards_flow(client: TestClient, test_course_with_chunks: Course):
    fake_cards_payload = {
        "cards": [
            {
                "front": "What does Raft divide time into?",
                "back": "Raft divides time into terms of arbitrary length, numbered with consecutive integers.",
                "source_chunk_ids": [1],
            },
            {
                "front": "How do Raft leaders maintain authority?",
                "back": "By sending periodic heartbeats (AppendEntries RPCs with empty entries).",
                "source_chunk_ids": [2],
            },
        ]
    }

    fake_llm = FakeLLM(default_response=json.dumps(fake_cards_payload))
    fake_gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    app.dependency_overrides[get_llm_gateway] = lambda: fake_gateway

    headers = {"Authorization": "Bearer token_user_1"}

    # 1. Generate flashcards
    resp = client.post(
        "/api/flashcards/generate",
        headers=headers,
        json={"course_id": test_course_with_chunks.id, "count": 2},
    )
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    assert len(cards) == 2
    card_id = cards[0]["id"]
    assert cards[0]["reps"] == 0
    assert cards[0]["interval_days"] == 0
    assert cards[0]["ease_factor"] == 2.5

    # 2. Re-generating the same cards dedupes and returns empty or new unique cards
    resp_dedup = client.post(
        "/api/flashcards/generate",
        headers=headers,
        json={"course_id": test_course_with_chunks.id, "count": 2},
    )
    assert resp_dedup.status_code == 200
    assert len(resp_dedup.json()) == 0

    # 3. GET /api/flashcards
    resp_list = client.get(
        f"/api/flashcards?course_id={test_course_with_chunks.id}",
        headers=headers,
    )
    assert resp_list.status_code == 200
    data = resp_list.json()
    assert data["total_count"] == 2
    assert data["due_count"] == 2

    # 4. GET /api/flashcards/due
    resp_due = client.get(
        f"/api/flashcards/due?course_id={test_course_with_chunks.id}",
        headers=headers,
    )
    assert resp_due.status_code == 200
    assert len(resp_due.json()) == 2

    # 5. POST /api/flashcards/{id}/review with quality=5 (perfect)
    resp_review = client.post(
        f"/api/flashcards/{card_id}/review",
        headers=headers,
        json={"quality": 5},
    )
    assert resp_review.status_code == 200
    review_data = resp_review.json()
    assert review_data["new_interval_days"] == 1
    assert review_data["card"]["reps"] == 1
    assert review_data["card"]["interval_days"] == 1
    assert review_data["card"]["ease_factor"] > 2.5

    # 6. DELETE /api/flashcards/{id}
    resp_delete = client.delete(
        f"/api/flashcards/{card_id}",
        headers=headers,
    )
    assert resp_delete.status_code == 204

    # Verify deleted
    resp_list_after = client.get(
        f"/api/flashcards?course_id={test_course_with_chunks.id}",
        headers=headers,
    )
    assert resp_list_after.json()["total_count"] == 1

    app.dependency_overrides.pop(get_llm_gateway, None)


def test_cross_user_isolation(client: TestClient, test_course_with_chunks: Course, db_session: Session):
    # Create card for User 1
    card = Flashcard(
        user_id=test_course_with_chunks.user_id,
        course_id=test_course_with_chunks.id,
        front="Private question",
        back="Private answer",
        due_date=datetime.now(UTC),
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)

    headers_user_2 = {"Authorization": "Bearer token_user_2"}

    # User 2 cannot generate flashcards for User 1's course
    resp_gen = client.post(
        "/api/flashcards/generate",
        headers=headers_user_2,
        json={"course_id": test_course_with_chunks.id},
    )
    assert resp_gen.status_code == 404

    # User 2 cannot list User 1's flashcards
    resp_list = client.get(
        f"/api/flashcards?course_id={test_course_with_chunks.id}",
        headers=headers_user_2,
    )
    assert resp_list.status_code == 404

    # User 2 cannot review User 1's flashcard
    resp_review = client.post(
        f"/api/flashcards/{card.id}/review",
        headers=headers_user_2,
        json={"quality": 5},
    )
    assert resp_review.status_code == 404

    # User 2 cannot delete User 1's flashcard
    resp_del = client.delete(
        f"/api/flashcards/{card.id}",
        headers=headers_user_2,
    )
    assert resp_del.status_code == 404
