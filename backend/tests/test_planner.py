"""Tests for the pure deterministic planner and re-planning engine.

Verifies:
1. Total hours respected: sum of estimated minutes <= goal_days * hours_per_day * 60.
2. Daily minutes bounded: no individual day exceeds hours_per_day * 60.
3. Weak topics prioritized: topics with lower mastery appear on earlier days.
4. Level adaptation: task subdivision and review frequency adapt to beginner/intermediate/advanced.
5. Re-plan preserves completed items: completed milestones are strictly immutable in day & tasks.
6. Re-plan redistributes remaining days based on updated mastery scores.
7. Contract tests for /api/courses/{course_id}/roadmap/replan and alias /api/roadmap/{course_id}.
"""

from __future__ import annotations

import json

import pytest

from app.ai.harness.fake import FakeLLM
from app.ai.harness.gateway import LLMGateway
from app.core.auth import get_current_user
from app.db.models import Course, Document, Mastery, RoadmapItem, Topic, User
from app.learning.planner import (
    PlannedDay,
    PlannedTask,
    TopicInfo,
    plan_course_schedule,
    replan_roadmap,
)
from app.main import app


def test_planner_total_hours_and_daily_budget():
    """Planner strictly respects daily limit and overall time budget."""
    topics = [
        TopicInfo(id=1, name="Limits & Continuity"),
        TopicInfo(id=2, name="Derivatives & Rules"),
        TopicInfo(id=3, name="Integrals & Area"),
    ]

    goal_days = 5
    hours_per_day = 2.0
    daily_budget = int(hours_per_day * 60)  # 120 minutes

    schedule = plan_course_schedule(
        goal_days=goal_days,
        hours_per_day=hours_per_day,
        level="intermediate",
        topics=topics,
    )

    assert len(schedule) == goal_days
    total_minutes = sum(d.estimated_minutes for d in schedule)
    assert total_minutes <= goal_days * daily_budget

    for day in schedule:
        assert day.estimated_minutes <= daily_budget
        # Tasks in the day must sum to the day's estimated minutes
        assert sum(t.estimated_minutes for t in day.tasks) == day.estimated_minutes
        assert len(day.tasks) >= 2


def test_planner_weak_topics_scheduled_earlier():
    """Topics with lower mastery scores are prioritized on earlier days."""
    t_strong = TopicInfo(id=10, name="Basic Arithmetic")
    t_medium = TopicInfo(id=20, name="Algebraic Equations")
    t_weak = TopicInfo(id=30, name="Eigenvalue Decomposition")

    mastery = {
        10: 0.95,  # Strong
        20: 0.60,  # Medium
        30: 0.15,  # Very weak
    }

    # Pass in random initial topic order
    topics = [t_strong, t_medium, t_weak]

    schedule = plan_course_schedule(
        goal_days=3,
        hours_per_day=1.5,
        level="intermediate",
        topics=topics,
        mastery_by_topic=mastery,
    )

    # Day 1 must be the weakest topic
    assert schedule[0].topic_id == 30
    assert schedule[0].topic_name == "Eigenvalue Decomposition"

    # Day 2 should be the medium topic
    assert schedule[1].topic_id == 20
    assert schedule[1].topic_name == "Algebraic Equations"

    # Day 3 should be the strongest topic
    assert schedule[2].topic_id == 10
    assert schedule[2].topic_name == "Basic Arithmetic"


def test_planner_level_pacing_and_chunking():
    """Different learner levels produce adapted task sizes and review frequencies."""
    topics = [TopicInfo(id=1, name="Topic A"), TopicInfo(id=2, name="Topic B")]

    # Beginner schedule: smaller chunks (~25 min), more review
    beginner_plan = plan_course_schedule(
        goal_days=6,
        hours_per_day=1.5,
        level="beginner",
        topics=topics,
    )
    # Check that review days exist for beginner across 6 days
    has_review = any(d.is_review for d in beginner_plan)
    assert has_review is True

    # Advanced schedule: longer chunks (~50 min), less review
    advanced_plan = plan_course_schedule(
        goal_days=4,
        hours_per_day=2.0,
        level="advanced",
        topics=topics,
    )
    for day in advanced_plan:
        for task in day.tasks:
            assert task.estimated_minutes >= 30


def test_replan_roadmap_preserves_completed_items():
    """Completed items are strictly preserved in day index and task data."""
    completed_day_1 = PlannedDay(
        day=1,
        topic_id=101,
        topic_name="Vectors",
        title="Day 1: Intro to Vectors",
        learning_objectives=["Understand vectors"],
        tasks=[
            PlannedTask(id="d1_t1", task="Read section 1", estimated_minutes=45, completed=True),
            PlannedTask(id="d1_t2", task="Solve exercise 1", estimated_minutes=45, completed=True),
        ],
        estimated_minutes=90,
        completed=True,
    )

    uncompleted_day_2 = PlannedDay(
        day=2,
        topic_id=102,
        topic_name="Matrices",
        title="Day 2: Matrix Multiplication",
        learning_objectives=["Multiply matrices"],
        tasks=[
            PlannedTask(id="d2_t1", task="Read section 2", estimated_minutes=45, completed=False),
            PlannedTask(id="d2_t2", task="Solve exercise 2", estimated_minutes=45, completed=False),
        ],
        estimated_minutes=90,
        completed=False,
    )

    all_topics = [
        TopicInfo(id=101, name="Vectors"),
        TopicInfo(id=102, name="Matrices"),
        TopicInfo(id=103, name="Determinants"),
    ]

    # Student took quiz: Vectors is 0.90, Matrices is 0.20 (struggling!), Determinants is 0.50
    updated_mastery = {101: 0.90, 102: 0.20, 103: 0.50}

    replanned = replan_roadmap(
        existing_items=[completed_day_1, uncompleted_day_2],
        updated_mastery=updated_mastery,
        goal_days=3,
        hours_per_day=1.5,
        level="intermediate",
        topics=all_topics,
    )

    assert len(replanned) == 3

    # Day 1 MUST be the exact completed item
    assert replanned[0].day == 1
    assert replanned[0].completed is True
    assert replanned[0].topic_id == 101
    assert replanned[0].tasks[0].task == "Read section 1"
    assert replanned[0].tasks[0].completed is True

    # Day 2 should now prioritize the weakest remaining topic (102: Matrices, score 0.20)
    assert replanned[1].day == 2
    assert replanned[1].topic_id == 102
    assert replanned[1].completed is False

    # Day 3 covers topic 103: Determinants
    assert replanned[2].day == 3
    assert replanned[2].topic_id == 103


def test_replan_endpoint_and_aliases(client, db_session):
    """Verifies POST /api/courses/{id}/roadmap/replan and GET /api/roadmap/{id} alias."""
    user = User(firebase_uid="uid_planner_api", email="planner@example.com", display_name="Planner User")
    db_session.add(user)
    db_session.commit()

    course = Course(
        user_id=user.id,
        name="Discrete Math",
        goal_days=3,
        hours_per_day=1.0,
        level="intermediate",
    )
    db_session.add(course)
    db_session.commit()

    doc = Document(course_id=course.id, user_id=user.id, file_uri="/docs/dm.pdf", status="ready")
    t1 = Topic(course_id=course.id, name="Sets & Relations")
    t2 = Topic(course_id=course.id, name="Graph Theory")
    db_session.add_all([doc, t1, t2])
    db_session.commit()

    # Pre-populate completed item for Day 1
    item1 = RoadmapItem(
        course_id=course.id,
        user_id=user.id,
        day=1,
        topic_id=t1.id,
        topic_name=t1.name,
        title="Day 1: Sets",
        learning_objectives=["Understand set unions"],
        tasks=[{"id": "d1_t1", "task": "Study sets", "estimated_minutes": 60, "completed": True}],
        estimated_minutes=60,
        completed=True,
    )
    db_session.add(item1)
    db_session.commit()

    # Record weak mastery for Graph Theory
    mastery_gt = Mastery(course_id=course.id, user_id=user.id, topic_id=t2.id, score=0.25)
    db_session.add(mastery_gt)
    db_session.commit()

    app.dependency_overrides[get_current_user] = lambda: user

    fake_llm = FakeLLM(
        default_response=json.dumps(
            {
                "days": [
                    {
                        "day": 2,
                        "title": "Day 2: Graph Theory Exploration",
                        "learning_objectives": ["Understand graph vertices and edges"],
                        "task_descriptions": ["Read graph basics", "Solve graph traversal problems"],
                    },
                    {
                        "day": 3,
                        "title": "Day 3: Advanced Graphs & Sets",
                        "learning_objectives": ["Connect sets to graph representations"],
                        "task_descriptions": ["Analyze set relations", "Complete final exercises"],
                    },
                ]
            }
        )
    )
    fake_gw = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)

    try:
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr("app.ai.roadmap.roadmap_gen.LLMGateway", lambda: fake_gw)

            # 1. Test alias endpoint GET /api/roadmap/{course_id}
            alias_res = client.get(f"/api/roadmap/{course.id}")
            assert alias_res.status_code == 200
            data = alias_res.json()
            assert data["course_id"] == course.id
            assert data["completed_days"] == 1

            # 2. Test replan endpoint POST /api/courses/{course_id}/roadmap/replan
            replan_res = client.post(f"/api/courses/{course.id}/roadmap/replan")
            assert replan_res.status_code == 200
            replan_data = replan_res.json()
            assert replan_data["total_days"] == 3
            assert replan_data["completed_days"] == 1
            items = replan_data["items"]

            # Day 1 is preserved as completed
            assert items[0]["day"] == 1
            assert items[0]["completed"] is True
            assert items[0]["tasks"][0]["completed"] is True

            # Day 2 is scheduled for weak topic Graph Theory
            assert items[1]["day"] == 2
            assert items[1]["topic_name"] == "Graph Theory"
            assert items[1]["completed"] is False

            # 3. Test replan alias POST /api/roadmap/{course_id}/replan
            replan_alias_res = client.post(f"/api/roadmap/{course.id}/replan")
            assert replan_alias_res.status_code == 200
            assert replan_alias_res.json()["total_days"] == 3
    finally:
        app.dependency_overrides.pop(get_current_user, None)
