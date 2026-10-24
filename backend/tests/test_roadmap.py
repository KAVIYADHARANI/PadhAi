"""Tests for personalized study roadmap generation, persistence, and progress tracking."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import LLMResponse
from app.ai.roadmap.roadmap_gen import generate_course_roadmap
from app.core.auth import get_current_user
from app.db.models import Course, Document, RoadmapItem, Topic, User
from app.main import app


@pytest.fixture
def test_user(db_session):
    user = User(
        firebase_uid="uid_roadmap_1", email="user1@example.com", display_name="Roadmap User"
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def other_user(db_session):
    user = User(firebase_uid="uid_roadmap_2", email="other@example.com", display_name="Other User")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def course_with_materials(db_session, test_user):
    course = Course(
        user_id=test_user.id,
        name="Linear Algebra",
        goal_days=5,
        hours_per_day=1.5,
        level="intermediate",
    )
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    doc = Document(
        course_id=course.id,
        user_id=test_user.id,
        file_uri="/fake/path.pdf",
        status="ready",
        pages=20,
    )
    db_session.add(doc)

    t1 = Topic(course_id=course.id, name="Vector Spaces")
    t2 = Topic(course_id=course.id, name="Eigenvalues & Eigenvectors")
    db_session.add_all([t1, t2])
    db_session.commit()

    return course


@pytest.fixture
def fake_gateway():
    plan_json = {
        "days": [
            {
                "day": 1,
                "topic_name": "Vector Spaces",
                "title": "Introduction to Vector Spaces & Subspaces",
                "learning_objectives": [
                    "Understand linear independence",
                    "Identify subspace properties",
                ],
                "tasks": [
                    {
                        "id": "d1_t1",
                        "task": "Read section 1.1 on vector definitions",
                        "estimated_minutes": 45,
                        "completed": False,
                    },
                    {
                        "id": "d1_t2",
                        "task": "Solve practice problems 1 to 5",
                        "estimated_minutes": 45,
                        "completed": False,
                    },
                ],
                "estimated_minutes": 90,
            },
            {
                "day": 2,
                "topic_name": "Eigenvalues & Eigenvectors",
                "title": "Diagonalization and Characteristic Polynomials",
                "learning_objectives": [
                    "Compute determinants and characteristic roots",
                    "Find eigenvectors for 2x2 matrices",
                ],
                "tasks": [
                    {
                        "id": "d2_t1",
                        "task": "Review chapter 5 on characteristic equations",
                        "estimated_minutes": 45,
                        "completed": False,
                    },
                    {
                        "id": "d2_t2",
                        "task": "Calculate eigenvalues for sample systems",
                        "estimated_minutes": 45,
                        "completed": False,
                    },
                ],
                "estimated_minutes": 90,
            },
        ]
    }

    mock_resp = LLMResponse(
        content=json.dumps(plan_json),
        role="assistant",
        provider="fake",
        model="fake-model",
        tokens_in=100,
        tokens_out=250,
        latency_ms=15.0,
    )

    gw = LLMGateway()
    gw.complete = AsyncMock(return_value=mock_resp)
    return gw


@pytest.mark.asyncio
async def test_generate_roadmap_requires_materials(db_session, test_user):
    """Roadmap generation fails closed if no course materials have been uploaded."""
    empty_course = Course(
        user_id=test_user.id,
        name="Empty Course",
        goal_days=10,
        hours_per_day=1.0,
    )
    db_session.add(empty_course)
    db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await generate_course_roadmap(
            course_id=empty_course.id,
            user_id=test_user.id,
            db=db_session,
        )
    assert exc_info.value.status_code == 400
    assert "No study materials uploaded yet" in exc_info.value.detail


@pytest.mark.asyncio
async def test_generate_roadmap_requires_ingestion_ready(db_session, test_user):
    """Roadmap generation explains that ingestion is still running if docs are processing."""
    course = Course(
        user_id=test_user.id,
        name="Processing Course",
        goal_days=7,
        hours_per_day=1.0,
    )
    db_session.add(course)
    db_session.commit()

    doc = Document(
        course_id=course.id,
        user_id=test_user.id,
        file_uri="/fake/doc.pdf",
        status="processing",
    )
    db_session.add(doc)
    db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await generate_course_roadmap(
            course_id=course.id,
            user_id=test_user.id,
            db=db_session,
        )
    assert exc_info.value.status_code == 400
    assert "still being processed" in exc_info.value.detail


@pytest.mark.asyncio
async def test_generate_roadmap_success_and_persistence(
    db_session, test_user, course_with_materials, fake_gateway
):
    """Generates structured roadmap items and persists them in the database."""
    items = await generate_course_roadmap(
        course_id=course_with_materials.id,
        user_id=test_user.id,
        db=db_session,
        gateway=fake_gateway,
        overwrite=False,
    )

    assert len(items) == 2
    assert items[0].day == 1
    assert items[0].topic_name == "Vector Spaces"
    assert len(items[0].tasks) == 2
    assert items[0].completed is False
    assert items[1].day == 2
    assert items[1].topic_name == "Eigenvalues & Eigenvectors"

    # Verify rows exist in DB
    persisted = (
        db_session.query(RoadmapItem)
        .filter(RoadmapItem.course_id == course_with_materials.id)
        .all()
    )
    assert len(persisted) == 2


def test_roadmap_api_endpoints_and_progress_tracking(
    client, test_user, other_user, course_with_materials, fake_gateway
):
    """Tests GET, POST, and PATCH roadmap endpoints and progress calculation."""
    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        # 1. Initially GET returns empty roadmap
        res = client.get(f"/api/courses/{course_with_materials.id}/roadmap")
        assert res.status_code == 200
        data = res.json()
        assert data["total_days"] == 0
        assert data["percent_complete"] == 0.0

        # 2. Mock LLM and call POST to generate roadmap
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(
                "app.ai.roadmap.roadmap_gen.LLMGateway",
                lambda: fake_gateway,
            )
            gen_res = client.post(f"/api/courses/{course_with_materials.id}/roadmap")
            assert gen_res.status_code == 200
            plan_data = gen_res.json()
            assert plan_data["total_days"] == 2
            assert plan_data["total_tasks"] == 4
            assert plan_data["completed_tasks"] == 0
            assert plan_data["percent_complete"] == 0.0

            item_1 = plan_data["items"][0]
            item_1_id = item_1["id"]

            # 3. Toggle single task
            patch_res = client.patch(
                f"/api/courses/{course_with_materials.id}/roadmap/{item_1_id}",
                json={"task_id": "d1_t1", "task_completed": True},
            )
            assert patch_res.status_code == 200
            updated_item = patch_res.json()
            assert updated_item["tasks"][0]["completed"] is True
            assert updated_item["completed"] is False  # second task still incomplete

            # 4. Check updated progress calculation
            prog_res = client.get(f"/api/courses/{course_with_materials.id}/roadmap")
            assert prog_res.status_code == 200
            prog_data = prog_res.json()
            assert prog_data["completed_tasks"] == 1
            assert prog_data["percent_complete"] == 25.0

            # 5. Mark second task complete -> day 1 completes automatically
            client.patch(
                f"/api/courses/{course_with_materials.id}/roadmap/{item_1_id}",
                json={"task_id": "d1_t2", "task_completed": True},
            )
            prog_res_2 = client.get(f"/api/courses/{course_with_materials.id}/roadmap")
            prog_data_2 = prog_res_2.json()
            assert prog_data_2["completed_tasks"] == 2
            assert prog_data_2["completed_days"] == 1
            assert prog_data_2["percent_complete"] == 50.0

        # 6. Cross-user isolation check
        app.dependency_overrides[get_current_user] = lambda: other_user
        isolated_res = client.get(f"/api/courses/{course_with_materials.id}/roadmap")
        assert isolated_res.status_code == 404

    finally:
        app.dependency_overrides.pop(get_current_user, None)
