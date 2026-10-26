"""Tests for quiz generation, attempts grading, mastery engine, and progress endpoints.

Follows BUILD_PLAYBOOK.md Phase 3 Task 3B:
- Unit validation catches bad answer-not-in-options, bad source ids, duplicate stems.
- Quiz generation agent retries and fails closed.
- Attempts grade deterministically and update mastery.
- Cross-user quiz and attempt isolation.
- Scripted attempt history through the API yields expected weak topics.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.ai.harness.exceptions import StructuredOutputError
from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import LLMResponse
from app.ai.quiz.quiz_gen import (
    GeneratedQuestion,
    GeneratedQuiz,
    generate_quiz,
    validate_generated_quiz,
)
from app.db.models import (
    Attempt,
    Chunk,
    ChunkTopic,
    Course,
    Document,
    Mastery,
    Question,
    Topic,
    User,
)
from app.learning.mastery import AttemptRecord, mastery_score


@pytest.fixture
def test_user(db_session):
    user = User(firebase_uid="firebase_uid_1", email="user1@example.com", display_name="User One")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def other_user(db_session):
    user = User(firebase_uid="firebase_uid_2", email="user2@example.com", display_name="User Two")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def course_with_materials(db_session, test_user):
    course = Course(
        name="Computer Architecture",
        goal_days=30,
        hours_per_day=2.0,
        level="intermediate",
        user_id=test_user.id,
    )
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    doc = Document(
        course_id=course.id,
        user_id=test_user.id,
        file_uri="storage/test_ca.pdf",
        status="ready",
    )
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    topic = Topic(
        course_id=course.id,
        name="Pipelining & Hazards",
    )
    db_session.add(topic)
    db_session.commit()
    db_session.refresh(topic)

    chunk = Chunk(
        document_id=doc.id,
        course_id=course.id,
        user_id=test_user.id,
        page=12,
        heading_path="Chapter 4 > Pipelining",
        text="Data hazards occur when instructions that exhibit data dependence modify data in different pipeline stages.",
        low_conf=False,
        injection_flag=False,
    )
    db_session.add(chunk)
    db_session.commit()
    db_session.refresh(chunk)

    mapping = ChunkTopic(chunk_id=chunk.id, topic_id=topic.id)
    db_session.add(mapping)
    db_session.commit()

    return course, topic, chunk


def test_validate_generated_quiz_rules():
    """Validates that domain rules catch bad answers, missing chunks, empty explanations, and duplicates."""
    valid_chunk_ids = {10, 11}
    existing_stems = {"what is pipelining?"}

    # 1. Answer not in options
    bad_ans_quiz = GeneratedQuiz(
        questions=[
            GeneratedQuestion(
                stem="What causes a data hazard?",
                options=["Instruction dependency", "Branch misprediction", "Cache miss"],
                answer="Structural collision",  # NOT in options
                explanation="Caused by dependencies [10].",
                source_chunk_ids=[10],
                difficulty=1.0,
            )
        ]
    )
    errors = validate_generated_quiz(bad_ans_quiz, valid_chunk_ids, existing_stems)
    assert any("not in options" in e for e in errors)

    # 2. Invalid source chunk ID
    bad_chunk_quiz = GeneratedQuiz(
        questions=[
            GeneratedQuestion(
                stem="What causes a data hazard?",
                options=["Instruction dependency", "Branch misprediction"],
                answer="Instruction dependency",
                explanation="Caused by dependencies [999].",
                source_chunk_ids=[999],  # NOT in valid_chunk_ids
                difficulty=1.0,
            )
        ]
    )
    errors = validate_generated_quiz(bad_chunk_quiz, valid_chunk_ids, existing_stems)
    assert any("not among retrieved chunks" in e for e in errors)

    # 3. Empty explanation
    empty_exp_quiz = GeneratedQuiz(
        questions=[
            GeneratedQuestion(
                stem="What causes a data hazard?",
                options=["Instruction dependency", "Branch misprediction"],
                answer="Instruction dependency",
                explanation="   ",
                source_chunk_ids=[10],
                difficulty=1.0,
            )
        ]
    )
    errors = validate_generated_quiz(empty_exp_quiz, valid_chunk_ids, existing_stems)
    assert any("explanation cannot be empty" in e for e in errors)

    # 4. Duplicate stem
    dup_stem_quiz = GeneratedQuiz(
        questions=[
            GeneratedQuestion(
                stem="What is pipelining?",  # In existing_stems
                options=["Technique A", "Technique B"],
                answer="Technique A",
                explanation="Standard pipeline [10].",
                source_chunk_ids=[10],
                difficulty=1.0,
            )
        ]
    )
    errors = validate_generated_quiz(dup_stem_quiz, valid_chunk_ids, existing_stems)
    assert any("duplicate question stem" in e for e in errors)

    # 5. Valid quiz
    valid_quiz = GeneratedQuiz(
        questions=[
            GeneratedQuestion(
                stem="What causes a data hazard?",
                options=["Instruction dependency", "Branch misprediction"],
                answer="Instruction dependency",
                explanation="Caused by instruction dependency [10].",
                source_chunk_ids=[10],
                difficulty=1.5,
            )
        ]
    )
    errors = validate_generated_quiz(valid_quiz, valid_chunk_ids, existing_stems)
    assert errors == []


@pytest.mark.asyncio
async def test_quiz_generator_success_and_caching(db_session, test_user, course_with_materials):
    """Quiz generator calls LLM, saves valid questions, and returns cached questions on repeat."""
    course, topic, chunk = course_with_materials

    valid_response_json = json.dumps(
        {
            "questions": [
                {
                    "stem": "When do data hazards occur in pipelining?",
                    "options": [
                        "When instructions modify data in different stages",
                        "When cache lines are invalidated",
                        "When clock frequency drops",
                        "When registers are powered down",
                    ],
                    "answer": "When instructions modify data in different stages",
                    "explanation": "Data hazards occur when dependent instructions modify data in different stages [chunk "
                    + str(chunk.id)
                    + "].",
                    "source_chunk_ids": [chunk.id],
                    "difficulty": 1.5,
                }
            ]
        }
    )

    mock_llm_res = LLMResponse(
        content=valid_response_json,
        provider="fake",
        model="fake-smart",
        role="smart",
        tokens_in=50,
        tokens_out=60,
        latency_ms=15.0,
    )

    with patch.object(LLMGateway, "complete", new_callable=AsyncMock) as mock_complete:
        mock_complete.return_value = mock_llm_res

        gateway = LLMGateway()
        questions = await generate_quiz(
            db=db_session,
            gateway=gateway,
            course_id=course.id,
            topic_id=topic.id,
            user_id=test_user.id,
            count=1,
        )

        assert len(questions) == 1
        q = questions[0]
        assert q.stem == "When do data hazards occur in pipelining?"
        assert q.difficulty == 1.5
        assert q.answer == "When instructions modify data in different stages"
        assert q.source_chunk_ids == [chunk.id]
        assert mock_complete.call_count == 1

        # Second call with force_fresh=False should return cached question with 0 LLM calls
        cached_questions = await generate_quiz(
            db=db_session,
            gateway=gateway,
            course_id=course.id,
            topic_id=topic.id,
            user_id=test_user.id,
            count=1,
            force_fresh=False,
        )
        assert len(cached_questions) == 1
        assert cached_questions[0].id == q.id
        assert mock_complete.call_count == 1  # No additional call


@pytest.mark.asyncio
async def test_quiz_generator_retries_and_fails_closed(
    db_session, test_user, course_with_materials
):
    """Quiz generator retries on invalid output and fails closed if retries are exhausted."""
    course, topic, chunk = course_with_materials

    # LLM always returns answer not in options
    invalid_response_json = json.dumps(
        {
            "questions": [
                {
                    "stem": "Unfixable question stem",
                    "options": ["Option A", "Option B"],
                    "answer": "Option Z",  # INVALID
                    "explanation": "Invalid explanation.",
                    "source_chunk_ids": [chunk.id],
                    "difficulty": 1.0,
                }
            ]
        }
    )

    mock_llm_res = LLMResponse(
        content=invalid_response_json,
        provider="fake",
        model="fake-smart",
        role="smart",
        tokens_in=50,
        tokens_out=60,
        latency_ms=15.0,
    )

    with patch.object(LLMGateway, "complete", new_callable=AsyncMock) as mock_complete:
        mock_complete.return_value = mock_llm_res

        gateway = LLMGateway()
        with pytest.raises(StructuredOutputError) as exc_info:
            await generate_quiz(
                db=db_session,
                gateway=gateway,
                course_id=course.id,
                topic_id=topic.id,
                user_id=test_user.id,
                count=1,
            )

        assert "Quiz validation failed after 2 retries" in str(exc_info.value)
        # 1 initial + 2 retries = 3 calls
        assert mock_complete.call_count == 3


def test_attempt_submission_and_mastery_endpoints(
    client,
    db_session,
    test_user,
    course_with_materials,
    auth_headers_user1,
):
    """Tests attempt submission, deterministic grading, and live mastery calculation."""
    course, topic, chunk = course_with_materials

    question = Question(
        course_id=course.id,
        topic_id=topic.id,
        stem="What causes a pipeline stall?",
        question_type="mcq",
        options=["Hazard", "High cache hit rate", "Cooling fan", "ALU overflow"],
        answer="Hazard",
        explanation="Pipeline hazards cause stalls to preserve instruction semantics [chunk 1].",
        source_chunk_ids=[chunk.id],
        difficulty=1.5,
    )
    db_session.add(question)
    db_session.commit()
    db_session.refresh(question)

    # 1. Submit correct answer
    res_correct = client.post(
        "/api/attempts",
        json={"question_id": question.id, "selected_answer": "Hazard", "time_ms": 3200},
        headers=auth_headers_user1,
    )
    assert res_correct.status_code == 201
    data_c = res_correct.json()
    assert data_c["correct"] is True
    assert data_c["answer"] == "Hazard"
    assert data_c["explanation"] == question.explanation
    assert data_c["new_mastery_score"] == 1.0

    # 2. Submit incorrect answer
    res_incorrect = client.post(
        "/api/attempts",
        json={"question_id": question.id, "selected_answer": "Cooling fan", "time_ms": 1500},
        headers=auth_headers_user1,
    )
    assert res_incorrect.status_code == 201
    data_inc = res_incorrect.json()
    assert data_inc["correct"] is False
    assert data_inc["new_mastery_score"] < 1.0


def test_cross_user_isolation(
    client,
    db_session,
    test_user,
    other_user,
    course_with_materials,
    auth_headers_user2,
):
    """Verifies that User 2 cannot access User 1's quizzes, submit attempts, or view progress."""
    course, topic, chunk = course_with_materials

    question = Question(
        course_id=course.id,
        topic_id=topic.id,
        stem="Private question stem",
        question_type="mcq",
        options=["A", "B"],
        answer="A",
        explanation="Exp",
        source_chunk_ids=[chunk.id],
        difficulty=1.0,
    )
    db_session.add(question)
    db_session.commit()
    db_session.refresh(question)

    # User 2 attempts to generate quiz for User 1's course
    res_gen = client.post(
        "/api/quizzes",
        json={"course_id": course.id, "topic_id": topic.id, "count": 2},
        headers=auth_headers_user2,
    )
    assert res_gen.status_code == 404

    # User 2 attempts to submit attempt for User 1's question
    res_att = client.post(
        "/api/attempts",
        json={"question_id": question.id, "selected_answer": "A", "time_ms": 1000},
        headers=auth_headers_user2,
    )
    assert res_att.status_code == 403

    # User 2 attempts to view progress for User 1's course
    res_prog = client.get(
        f"/api/progress/{course.id}",
        headers=auth_headers_user2,
    )
    assert res_prog.status_code == 404


def test_scripted_history_replay_matches_expected_weak(
    client,
    db_session,
    test_user,
    course_with_materials,
    auth_headers_user1,
):
    """Replays tests/fixtures/attempt_history.json and asserts GET /api/progress yields expected weak topics."""
    course, _, chunk = course_with_materials

    # Load fixture files
    fixture_dir = Path(__file__).parent / "fixtures"
    history_file = fixture_dir / "attempt_history.json"
    expected_file = fixture_dir / "expected_weak.json"

    with open(history_file, encoding="utf-8") as f:
        history_data = json.load(f)["attempts"]

    with open(expected_file, encoding="utf-8") as f:
        expected_weak_names = json.load(f)["ranked_weak_topics"]

    # 1. Create topics in course
    unique_topics = sorted({item["topic"] for item in history_data})
    topic_map: dict[str, Topic] = {}
    for t_name in unique_topics:
        existing_t = (
            db_session.query(Topic)
            .filter(Topic.course_id == course.id, Topic.name == t_name)
            .first()
        )
        if not existing_t:
            existing_t = Topic(course_id=course.id, name=t_name)
            db_session.add(existing_t)
            db_session.commit()
            db_session.refresh(existing_t)
        topic_map[t_name] = existing_t

    # 2. Create questions for each topic
    q_map: dict[str, Question] = {}
    for t_name, topic_obj in topic_map.items():
        q = Question(
            course_id=course.id,
            topic_id=topic_obj.id,
            stem=f"Test question for {t_name}",
            question_type="mcq",
            options=["True", "False"],
            answer="True",
            explanation=f"Explanation for {t_name}",
            source_chunk_ids=[chunk.id],
            difficulty=1.0,
        )
        db_session.add(q)
        db_session.commit()
        db_session.refresh(q)
        q_map[t_name] = q

    # 3. Insert historical attempts with timestamp reflecting days_ago
    now = datetime.now(UTC)
    for att in history_data:
        topic_name = att["topic"]
        topic_obj = topic_map[topic_name]
        q_obj = q_map[topic_name]
        ts = now - timedelta(days=att["days_ago"])

        db_attempt = Attempt(
            user_id=test_user.id,
            question_id=q_obj.id,
            course_id=course.id,
            topic_id=topic_obj.id,
            selected_answer="True" if att["is_correct"] else "False",
            correct=att["is_correct"],
            time_ms=2500,
            created_at=ts,
        )
        db_session.add(db_attempt)
    db_session.commit()

    # 4. Compute mastery for each topic using history
    for topic_name, topic_obj in topic_map.items():
        # Match difficulty from attempt history items for this topic
        topic_history_items = [item for item in history_data if item["topic"] == topic_name]
        records = [
            AttemptRecord(
                is_correct=item["is_correct"],
                difficulty=item["difficulty"],
                days_ago=item["days_ago"],
            )
            for item in topic_history_items
        ]
        score = mastery_score(records)

        mastery_row = Mastery(
            user_id=test_user.id,
            course_id=course.id,
            topic_id=topic_obj.id,
            score=score,
            attempts_count=len(records),
            updated_at=now,
        )
        db_session.add(mastery_row)
    db_session.commit()

    # 5. Query progress API
    res = client.get(f"/api/progress/{course.id}", headers=auth_headers_user1)
    assert res.status_code == 200
    res_data = res.json()

    # Map weak topic IDs back to names
    id_to_name = {t.id: t.name for t in topic_map.values()}
    ranked_weak_names = [id_to_name[tid] for tid in res_data["weak_topics"]]

    assert ranked_weak_names == expected_weak_names
