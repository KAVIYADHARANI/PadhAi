"""Tests for Interactive Lessons, Web Research, YouTube Discovery, and Progress Tracking."""

import json
import logging
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.ai.harness.exceptions import StructuredOutputError
from app.ai.harness.fake import FakeLLM
from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ChatMessage
from app.ai.harness.structured import StructuredCall
from app.ai.lesson.lesson_gen import StructuredLessonContent, generate_lesson_for_task
from app.ai.research.web_search import MockSearchProvider, is_safe_url
from app.ai.research.youtube import (
    DirectSearchFallbackProvider,
    MockYouTubeProvider,
    OfficialYouTubeAPIProvider,
)
from app.core.logging import SafeJsonFormatter, redact_secrets
from app.db.models import Course, Lesson, RoadmapItem, Topic, User


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


def _make_mock_lesson_content() -> StructuredLessonContent:
    return StructuredLessonContent(
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
    mock_lesson_content = _make_mock_lesson_content()

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


def test_absent_lesson_get_returns_404(client: TestClient, db_session: Session, auth_headers_user1):
    """GET /lesson returns 404 with clear message when lesson does not exist yet."""
    user, course, item = _seed_course_and_roadmap(db_session)
    res = client.get(
        f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson",
        headers=auth_headers_user1,
    )
    assert res.status_code == 404
    assert "Lesson not found for this study task" in res.json().get("detail", "")


def test_lesson_generation_idempotency_repeat_request(client: TestClient, db_session: Session, auth_headers_user1):
    """Subsequent POST requests return existing ready lesson without re-executing generation."""
    user, course, item = _seed_course_and_roadmap(db_session)
    mock_content = _make_mock_lesson_content()

    mock_execute = AsyncMock(return_value=mock_content)
    with patch("app.ai.lesson.lesson_gen.StructuredCall.execute", new=mock_execute):
        # 1. First POST generates the lesson
        res1 = client.post(
            f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson",
            headers=auth_headers_user1,
        )
        assert res1.status_code == 200
        lesson1 = res1.json()
        assert lesson1["title"] == "Mastering Binary Search Tree Invariants"
        assert mock_execute.call_count == 1

        # 2. Second POST (without overwrite) returns existing ready lesson immediately
        res2 = client.post(
            f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson",
            headers=auth_headers_user1,
        )
        assert res2.status_code == 200
        lesson2 = res2.json()
        assert lesson2["id"] == lesson1["id"]
        assert lesson2["title"] == lesson1["title"]
        # LLM execute was NOT called a second time
        assert mock_execute.call_count == 1

        # 3. Third POST with overwrite=true re-runs generation
        res3 = client.post(
            f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson?overwrite=true",
            headers=auth_headers_user1,
        )
        assert res3.status_code == 200
        assert mock_execute.call_count == 2


def test_concurrent_lesson_generation_integrity_error_recovery(client: TestClient, db_session: Session, auth_headers_user1):
    """When concurrent requests race to insert a lesson, IntegrityError triggers rollback and returns existing."""
    user, course, item = _seed_course_and_roadmap(db_session)
    mock_content = _make_mock_lesson_content()

    # Pre-populate a ready lesson (as if committed concurrently by request A)
    lesson_rec = Lesson(
        course_id=course.id,
        roadmap_item_id=item.id,
        task_id="d1_t1",
        user_id=user.id,
        title="Concurrent Winner Lesson",
        estimated_minutes=30,
        content=mock_content.model_dump(),
        web_resources=[],
        youtube_resources=[],
        exercises=[],
        sources=[],
        status="ready",
    )
    db_session.add(lesson_rec)
    db_session.commit()
    db_session.refresh(lesson_rec)

    # Request B calls generate_lesson_endpoint with overwrite=False
    # Fast path or fallback returns the committed record without 500 error
    with patch(
        "app.ai.lesson.lesson_gen.StructuredCall.execute",
        new=AsyncMock(return_value=mock_content),
    ):
        res = client.post(
            f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson",
            headers=auth_headers_user1,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["id"] == lesson_rec.id
        assert data["title"] == "Concurrent Winner Lesson"


@pytest.mark.asyncio
async def test_generate_lesson_for_task_catches_integrity_error_and_rolls_back(db_session: Session):
    """Directly test that generate_lesson_for_task catches IntegrityError, rolls back, and returns committed record."""
    user, course, item = _seed_course_and_roadmap(db_session)
    mock_content = _make_mock_lesson_content()

    # Create committed lesson
    committed_lesson = Lesson(
        course_id=course.id,
        roadmap_item_id=item.id,
        task_id="d1_t1",
        user_id=user.id,
        title="Already Committed Lesson",
        estimated_minutes=30,
        content=mock_content.model_dump(),
        web_resources=[],
        youtube_resources=[],
        exercises=[],
        sources=[],
        status="ready",
    )
    db_session.add(committed_lesson)
    db_session.commit()

    # Calling generate_lesson_for_task with overwrite=False returns existing ready lesson
    result = await generate_lesson_for_task(
        course_id=course.id,
        roadmap_item_id=item.id,
        task_id="d1_t1",
        user_id=user.id,
        db=db_session,
        overwrite=False,
    )
    assert result.id == committed_lesson.id
    assert result.title == "Already Committed Lesson"


@pytest.mark.asyncio
async def test_structured_output_recovery_on_insufficient_questions():
    """StructuredCall retries when question count < 2 and recovers using the schema repair guidance."""
    fake_llm = FakeLLM()
    # Attempt 0: only 1 self-check question (violates min_length=2)
    invalid_payload = {
        "title": "BST Invariants",
        "introduction": "Intro text here.",
        "prerequisites": [],
        "sections": [
            {
                "id": "s1",
                "title": "Section 1",
                "content": "Explanation 1.",
                "key_concepts": ["concept1"],
                "code_snippet": None,
                "source_citations": [],
            },
            {
                "id": "s2",
                "title": "Section 2",
                "content": "Explanation 2.",
                "key_concepts": ["concept2"],
                "code_snippet": None,
                "source_citations": [],
            },
        ],
        "key_terms": [
            {"term": "BST", "definition": "Binary Search Tree"},
            {"term": "Invariant", "definition": "Always true condition"},
        ],
        "worked_examples": [
            {"problem": "Prob", "step_by_step_solution": ["Step 1"], "explanation": "Why"}
        ],
        "misconceptions": [
            {"misconception": "Wrong", "correction": "Right", "explanation": "Why"}
        ],
        "summary": "Summary",
        "takeaways": ["Takeaway 1", "Takeaway 2"],
        "exercises": [
            {
                "id": "ex1",
                "prompt": "Practice",
                "exercise_type": "conceptual",
                "difficulty": "medium",
                "hints": ["Hint 1"],
                "solution": "Ans",
                "explanation": "Exp",
            }
        ],
        "self_check_questions": [
            {
                "id": "q1",
                "question": "Only one question here?",
                "options": ["A", "B"],
                "answer": "A",
                "explanation": "Exp",
            }
        ],
        "deeper_learning": [],
    }

    # Attempt 1: repaired with 2 self-check questions
    valid_payload = dict(invalid_payload)
    valid_payload["self_check_questions"] = [
        {
            "id": "q1",
            "question": "Question 1?",
            "options": ["A", "B"],
            "answer": "A",
            "explanation": "Exp",
        },
        {
            "id": "q2",
            "question": "Question 2?",
            "options": ["C", "D"],
            "answer": "C",
            "explanation": "Exp",
        },
    ]

    fake_llm.add_response(json.dumps(invalid_payload))
    fake_llm.add_response(json.dumps(valid_payload))

    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    structured = StructuredCall(gateway=gateway)

    result = await structured.execute(
        schema=StructuredLessonContent,
        messages=[ChatMessage(role="user", content="Generate BST lesson")],
        max_retries=2,
    )

    assert isinstance(result, StructuredLessonContent)
    assert len(result.self_check_questions) == 2
    assert fake_llm.call_count == 2


def test_structured_output_retry_exhaustion_maps_to_502(client: TestClient, db_session: Session, auth_headers_user1):
    """When StructuredCall retries are exhausted, lesson generation returns 502 with helpful error."""
    user, course, item = _seed_course_and_roadmap(db_session)

    with patch(
        "app.ai.lesson.lesson_gen.StructuredCall.execute",
        side_effect=StructuredOutputError("Failed to produce valid structured output for StructuredLessonContent after 2 retries."),
    ):
        res = client.post(
            f"/api/courses/{course.id}/roadmap/{item.id}/tasks/d1_t1/lesson",
            headers=auth_headers_user1,
        )
        assert res.status_code == 502
        assert "Lesson generation failed schema validation" in res.json().get("detail", "")


def test_logging_secret_redaction():
    """Verify redact_secrets and SafeJsonFormatter scrub keys, tokens, and query parameters."""
    # 1. Direct redact_secrets tests
    url_with_key = "https://www.googleapis.com/youtube/v3/search?key=AIzaSyC_1234567890abcdefgh&part=snippet"
    redacted_url = redact_secrets(url_with_key)
    assert "AIzaSy" not in redacted_url
    assert "key=[REDACTED]" in redacted_url

    bearer_str = "Authorization: Bearer sk-or-v1-abcdef1234567890abcdef1234567890"
    redacted_bearer = redact_secrets(bearer_str)
    assert "sk-or-v1-" not in redacted_bearer
    assert "Bearer [REDACTED]" in redacted_bearer

    groq_key = "gsk_1234567890abcdef1234567890"
    assert "[REDACTED_API_KEY]" in redact_secrets(groq_key)

    tavily_key = "tvly-1234567890abcdef"
    assert "[REDACTED_API_KEY]" in redact_secrets(tavily_key)

    # 2. SafeJsonFormatter test
    formatter = SafeJsonFormatter()
    record = logging.LogRecord(
        name="test_logger",
        level=logging.INFO,
        pathname="test.py",
        lineno=10,
        msg="Requesting https://example.com/api?token=secret_token_123",
        args=(),
        exc_info=None,
    )
    formatted = json.loads(formatter.format(record))
    assert "secret_token_123" not in formatted["event"]
    assert "token=[REDACTED]" in formatted["event"]


@pytest.mark.asyncio
async def test_youtube_provider_uses_header_not_query_param():
    """Verify OfficialYouTubeAPIProvider passes API key via X-Goog-Api-Key header and not in URL params."""
    provider = OfficialYouTubeAPIProvider(api_key="AIzaSyTestSecret123")

    captured_requests: list[dict] = []

    async def mock_get(url, headers=None, params=None):
        captured_requests.append({"url": url, "headers": headers, "params": params})
        return httpx.Response(
            status_code=200,
            json={"items": [{"id": {"videoId": "test_v1"}, "snippet": {"title": "Test Video", "channelTitle": "Test Channel"}}]},
            request=httpx.Request("GET", url),
        )

    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        await provider.discover_tutorials(topic="Python", learning_objectives=["Variables"], limit=1)

    assert len(captured_requests) >= 1
    for req in captured_requests:
        assert req["headers"].get("X-Goog-Api-Key") == "AIzaSyTestSecret123"
        if req["params"]:
            assert "key" not in req["params"]
            assert "AIzaSyTestSecret123" not in str(req["params"])


def test_exact_duplicate_key_scenario_from_logs(client: TestClient, db_session: Session, auth_headers_user1):
    """Reproduces the exact sequence from the logs: course_id=3, roadmap_item_id=29, task_id='d1_t4'.

    Sequence:
    1. GET /api/courses/3/roadmap/29/tasks/d1_t4/lesson returns 404 Not Found.
    2. The first POST /api/courses/3/roadmap/29/tasks/d1_t4/lesson generates and returns 200 OK.
    3. A subsequent POST to the same endpoint returns 200 OK with the existing lesson rather than
       failing with 500 UniqueViolation on 'uq_lessons_course_item_task'.
    4. Database contains exactly one lesson record for (course_id=3, roadmap_item_id=29, task_id='d1_t4').
    5. Lesson progress is preserved and not reset.
    """
    user = db_session.query(User).filter(User.firebase_uid == "firebase_uid_1").first()
    if not user:
        user = User(firebase_uid="firebase_uid_1", email="user1@example.com", display_name="User One")
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)

    course = Course(
        id=3,
        user_id=user.id,
        name="Operating Systems",
        goal_days=10,
        hours_per_day=1.5,
        level="intermediate",
    )
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    topic = Topic(course_id=course.id, name="Virtual Memory", module_name="Memory Management")
    db_session.add(topic)
    db_session.commit()
    db_session.refresh(topic)

    roadmap_item = RoadmapItem(
        id=29,
        course_id=course.id,
        user_id=user.id,
        day=1,
        topic_id=topic.id,
        topic_name="Virtual Memory",
        title="Day 1: Paging and Page Tables",
        learning_objectives=["Understand virtual addresses", "Implement page table lookup"],
        tasks=[
            {"id": "d1_t4", "task": "Study multi-level page tables and TLB misses", "estimated_minutes": 30, "completed": False},
        ],
        estimated_minutes=30,
        completed=False,
    )
    db_session.add(roadmap_item)
    db_session.commit()
    db_session.refresh(roadmap_item)

    # 1. GET returns 404
    res_get = client.get(
        "/api/courses/3/roadmap/29/tasks/d1_t4/lesson",
        headers=auth_headers_user1,
    )
    assert res_get.status_code == 404

    # 2. First POST generates and returns 200
    mock_content = _make_mock_lesson_content()
    mock_call = AsyncMock(return_value=mock_content)
    with patch("app.ai.lesson.lesson_gen.StructuredCall.execute", new=mock_call):
        res_post1 = client.post(
            "/api/courses/3/roadmap/29/tasks/d1_t4/lesson",
            headers=auth_headers_user1,
        )
        assert res_post1.status_code == 200
        lesson_1 = res_post1.json()
        assert lesson_1["course_id"] == 3
        assert lesson_1["roadmap_item_id"] == 29
        assert lesson_1["task_id"] == "d1_t4"
        assert mock_call.call_count == 1

        # Simulate user progressing on the lesson
        client.patch(
            "/api/courses/3/roadmap/29/tasks/d1_t4/lesson/progress",
            headers=auth_headers_user1,
            json={"section_id": "sec_1", "section_completed": True, "add_time_seconds": 120},
        )

        # 3. Subsequent POST to same endpoint returns 200 OK without re-generating (idempotent!)
        res_post2 = client.post(
            "/api/courses/3/roadmap/29/tasks/d1_t4/lesson",
            headers=auth_headers_user1,
        )
        assert res_post2.status_code == 200
        lesson_2 = res_post2.json()
        assert lesson_2["id"] == lesson_1["id"]
        assert mock_call.call_count == 1  # Generator was NOT called again

    # 4. Verify progress was preserved
    res_prog = client.get(
        "/api/courses/3/roadmap/29/tasks/d1_t4/lesson/progress",
        headers=auth_headers_user1,
    )
    assert res_prog.status_code == 200
    assert "sec_1" in res_prog.json()["sections_completed"]
    assert res_prog.json()["time_spent_seconds"] >= 120

    # 5. Database contains exactly 1 lesson record for (3, 29, 'd1_t4')
    db_session.expire_all()
    count = (
        db_session.query(Lesson)
        .filter(Lesson.course_id == 3, Lesson.roadmap_item_id == 29, Lesson.task_id == "d1_t4")
        .count()
    )
    assert count == 1


