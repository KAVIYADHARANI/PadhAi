"""Tests for Interactive Lessons, Web Research, YouTube Discovery, and Progress Tracking."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.ai.lesson.lesson_gen import StructuredLessonContent
from app.ai.research.web_search import MockSearchProvider, is_safe_url
from app.ai.research.youtube import DirectSearchFallbackProvider, MockYouTubeProvider
from app.db.models import Course, RoadmapItem, Topic, User


def test_is_safe_url():
    """Verify SSRF protection and scheme enforcement."""
    # Permitted
    assert is_safe_url("https://docs.python.org/3/tutorial/")
    assert is_safe_url("http://developer.mozilla.org/en-US/")
    assert is_safe_url("https://en.wikipedia.org/wiki/Machine_learning")

    # Rejected schemes
    assert not is_safe_url("javascript:alert(1)")
    assert not is_safe_url("file:///etc/passwd")
    assert not is_safe_url("data:text/html,<script>alert(1)</script>")
    assert not is_safe_url("ftp://ftp.example.com")

    # Rejected SSRF / internal hosts
    assert not is_safe_url("http://localhost:8000/api")
    assert not is_safe_url("http://127.0.0.1:5432")
    assert not is_safe_url("http://0.0.0.0:80")
    assert not is_safe_url("http://192.168.1.1/admin")
    assert not is_safe_url("http://10.0.0.5/secrets")
    assert not is_safe_url("http://169.254.169.254/latest/meta-data/")
    assert not is_safe_url("")
    assert not is_safe_url(None)  # type: ignore


@pytest.mark.asyncio
async def test_web_search_and_youtube_providers():
    """Verify mock research and youtube providers produce valid structured resources."""
    web_provider = MockSearchProvider()
    resources = await web_provider.search(
        query="Neural networks",
        topic="Deep Learning",
        objectives=["Understand backpropagation"],
        limit=2,
    )
    assert len(resources) == 2
    assert resources[0].domain == "developer.mozilla.org"
    assert is_safe_url(resources[0].url)
    assert "Deep Learning" in resources[0].title

    yt_provider = MockYouTubeProvider()
    videos = await yt_provider.discover_tutorials(
        topic="Deep Learning",
        learning_objectives=["Understand backpropagation"],
        limit=2,
    )
    assert len(videos) == 2
    assert videos[0].video_id == "kqtD5dpn9C8"
    assert "youtube-nocookie.com" in videos[0].embed_url

    fallback_yt = DirectSearchFallbackProvider()
    unconfigured_videos = await fallback_yt.discover_tutorials("Deep Learning", ["Objectives"])
    assert unconfigured_videos == []


def _seed_course_and_roadmap(db_session: Session) -> tuple[User, Course, RoadmapItem]:
    user = User(firebase_uid="firebase_uid_1", email="user1@example.com", display_name="User One")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    course = Course(
        user_id=user.id,
        name="Data Structures & Algorithms",
        goal_days=10,
        hours_per_day=1.5,
        level="intermediate",
    )
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    topic = Topic(course_id=course.id, name="Binary Search Trees", module_name="Trees")
    db_session.add(topic)
    db_session.commit()
    db_session.refresh(topic)

    roadmap_item = RoadmapItem(
        course_id=course.id,
        user_id=user.id,
        day=1,
        topic_id=topic.id,
        topic_name="Binary Search Trees",
        title="Day 1: BST Fundamentals & Traversal",
        learning_objectives=["Understand BST property", "Implement in-order traversal"],
        tasks=[
            {"id": "d1_t1", "task": "Study BST properties and invariants", "estimated_minutes": 30, "completed": False},
            {"id": "d1_t2", "task": "Trace in-order, pre-order, and post-order", "estimated_minutes": 30, "completed": False},
        ],
        estimated_minutes=60,
        completed=False,
    )
    db_session.add(roadmap_item)
    db_session.commit()
    db_session.refresh(roadmap_item)

    return user, course, roadmap_item


def test_lesson_generation_and_progress_flow(client: TestClient, db_session: Session, auth_headers_user1):
    """Full lifecycle: generate lesson, read, update progress, and check roadmap sync."""
    user, course, item = _seed_course_and_roadmap(db_session)

    # 1. Lesson initially does not exist (404)
    res = client.get(
        f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson",
        headers=auth_headers_user1,
    )
    assert res.status_code == 404

    # 2. Mock LLMGateway structured output for deterministic lesson generation
    mock_lesson_content = StructuredLessonContent(
        title="Mastering Binary Search Tree Invariants",
        introduction="Binary Search Trees allow logarithmic lookup and efficient sorted operations.",
        prerequisites=["Basic recursion", "Node-pointer memory models"],
        sections=[
            {
                "id": "sec_1",
                "title": "The BST Ordering Invariant",
                "content": "For every node N, all keys in left subtree are strictly smaller than N.key [doc p.1].",
                "key_concepts": ["Left < Node < Right", "Total ordering"],
                "code_snippet": "class BSTNode:\n    def __init__(self, key):\n        self.key = key",
                "source_citations": ["[doc p.1]"],
            },
            {
                "id": "sec_2",
                "title": "In-Order Traversal Walkthrough",
                "content": "Visiting left, node, right visits all keys in ascending order.",
                "key_concepts": ["LNR sequence", "Monotonic output"],
                "code_snippet": "def inorder(node):\n    if node: inorder(node.left); print(node.key); inorder(node.right)",
                "source_citations": [],
            },
        ],
        key_terms=[
            {"term": "Invariant", "definition": "A condition that can rely on being true at all times."},
            {"term": "BST Property", "definition": "Left subtree <= Node <= Right subtree."},
        ],
        worked_examples=[
            {
                "problem": "Insert keys [8, 3, 10, 1] into an empty BST.",
                "step_by_step_solution": [
                    "Root is 8.",
                    "3 < 8, so 3 becomes left child of 8.",
                    "10 > 8, so 10 becomes right child of 8.",
                    "1 < 8 and 1 < 3, so 1 becomes left child of 3.",
                ],
                "explanation": "At each node, compare key and branch left or right.",
            }
        ],
        misconceptions=[
            {
                "misconception": "Any binary tree with ordered immediate children is a BST.",
                "correction": "All nodes in the left subtree must be less than the ancestor, not just direct children.",
                "explanation": "A right child of a left child must still be less than the root.",
            }
        ],
        summary="BSTs maintain sorted order across all descendants.",
        takeaways=["Search cost is proportional to tree height.", "In-order traversal yields sorted sequence."],
        exercises=[
            {
                "id": "ex_1",
                "prompt": "Determine if a binary tree [5, 2, 8, null, 7] is a valid BST.",
                "exercise_type": "conceptual",
                "difficulty": "medium",
                "hints": ["Look closely at node 7: it is in the left subtree of 5."],
                "solution": "Invalid BST because 7 is greater than root 5.",
                "explanation": "All nodes in root's left subtree must be strictly less than 5.",
            }
        ],
        self_check_questions=[
            {
                "id": "q_1",
                "question": "What is the time complexity of searching in a balanced BST?",
                "options": ["O(1)", "O(log N)", "O(N)", "O(N^2)"],
                "answer": "O(log N)",
                "explanation": "Each comparison cuts the search space in half.",
            },
            {
                "id": "q_2",
                "question": "Which traversal prints BST keys in sorted ascending order?",
                "options": ["Pre-order", "In-order", "Post-order", "Level-order"],
                "answer": "In-order",
                "explanation": "In-order traversal follows Left -> Node -> Right.",
            },
        ],
        deeper_learning=["AVL Trees and Red-Black self-balancing mechanisms."],
    )

    with patch(
        "app.ai.lesson.lesson_gen.StructuredCall.execute",
        new=AsyncMock(return_value=mock_lesson_content),
    ):
        gen_res = client.post(
            f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson",
            headers=auth_headers_user1,
        )

    assert gen_res.status_code == 200
    lesson_data = gen_res.json()
    assert lesson_data["title"] == "Mastering Binary Search Tree Invariants"
    assert len(lesson_data["content"]["sections"]) == 2
    assert len(lesson_data["exercises"]) == 1
    assert len(lesson_data["web_resources"]) >= 1

    # 3. Retrieve lesson progress
    prog_res = client.get(
        f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson/progress",
        headers=auth_headers_user1,
    )
    assert prog_res.status_code == 200
    prog_data = prog_res.json()
    assert prog_data["completed"] is False
    assert prog_data["sections_completed"] == []

    # 4. Mark section read and record exercise attempt
    update_res = client.patch(
        f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson/progress",
        headers=auth_headers_user1,
        json={
            "section_id": "sec_1",
            "section_completed": True,
            "exercise_id": "ex_1",
            "exercise_attempt": {"solved": True, "answer": "Invalid BST because 7 > 5"},
            "quiz_score": 100.0,
            "add_time_seconds": 180,
            "reflection": "Understood BST invariants and traversal rules well.",
            "completed": True,
        },
    )
    assert update_res.status_code == 200
    updated_prog = update_res.json()
    assert updated_prog["completed"] is True
    assert "sec_1" in updated_prog["sections_completed"]
    assert updated_prog["quiz_score"] == 100.0
    assert updated_prog["time_spent_seconds"] >= 180

    # 5. Verify task completion synchronized in parent RoadmapItem
    db_session.expire_all()
    reloaded_item = db_session.query(RoadmapItem).filter(RoadmapItem.id == item.id).first()
    assert reloaded_item is not None
    d1_t1 = next(t for t in reloaded_item.tasks if t["id"] == "d1_t1")
    assert d1_t1["completed"] is True
    # d1_t2 is not complete, so day is not yet complete
    assert reloaded_item.completed is False

    # 6. Complete second task and check that day completes automatically
    client.patch(
        f"/api/courses/{course.id}/roadmap/{item.id}",
        headers=auth_headers_user1,
        json={"task_id": "d1_t2", "task_completed": True},
    )
    db_session.expire_all()
    reloaded_item_day = db_session.query(RoadmapItem).filter(RoadmapItem.id == item.id).first()
    assert reloaded_item_day.completed is True


def test_lesson_sql_authorization_isolation(client: TestClient, db_session: Session, auth_headers_user1, auth_headers_user2):
    """Verify User 2 cannot access or mutate User 1's lesson or progress."""
    user1, course, item = _seed_course_and_roadmap(db_session)

    # User 2 tries to access User 1's lesson
    res = client.get(
        f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson",
        headers=auth_headers_user2,
    )
    assert res.status_code == 404

    # User 2 tries to update User 1's progress
    res_update = client.patch(
        f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson/progress",
        headers=auth_headers_user2,
        json={"completed": True},
    )
    assert res_update.status_code == 404
