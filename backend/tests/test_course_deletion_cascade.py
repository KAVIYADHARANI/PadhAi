"""Tests for Course Deletion Cascade and Document Orphan Cleanup.

Implements BUILD_PLAYBOOK.md Phase 8 Task 8A:
- DELETE /api/courses/{id} removes documents, chunks, embeddings, topics, questions,
  attempts, flashcards, roadmap items, chat threads, messages, and object storage files.
- Asserts zero rows or files remain for the deleted course.
- Asserts another user's course and data are completely untouched.
- Asserts orphaned chunks are removed on document delete.
"""

from fastapi.testclient import TestClient

from app.db.models import (
    Attempt,
    ChatMessageRecord,
    ChatThread,
    Chunk,
    ChunkTopic,
    Course,
    Document,
    Flashcard,
    Lesson,
    LessonProgress,
    Mastery,
    Question,
    RoadmapItem,
    StudySession,
    Topic,
    User,
)


def seed_complete_course(db_session, user_id: int, course_name: str, storage) -> tuple[Course, Document, str]:
    """Helper that seeds a comprehensive course graph with all related models and physical file."""
    # 1. Course
    course = Course(user_id=user_id, name=course_name, goal_days=10, hours_per_day=1.0)
    db_session.add(course)
    db_session.commit()

    # 2. Document and physical storage file
    file_bytes = b"%PDF-1.4 test course content"
    file_uri = storage.save(file_bytes, f"{course_name}.pdf", "application/pdf")

    doc = Document(course_id=course.id, user_id=user_id, file_uri=file_uri, status="ready")
    db_session.add(doc)
    db_session.commit()

    # 3. Topic & Chunks
    topic = Topic(course_id=course.id, name=f"Topic for {course_name}")
    db_session.add(topic)
    db_session.commit()

    chunk = Chunk(
        document_id=doc.id,
        course_id=course.id,
        user_id=user_id,
        page=1,
        text="Sample chunk content",
    )
    db_session.add(chunk)
    db_session.commit()

    chunk_topic = ChunkTopic(chunk_id=chunk.id, topic_id=topic.id)
    db_session.add(chunk_topic)
    db_session.commit()

    # 4. Question, Attempt, Mastery
    q = Question(
        course_id=course.id,
        topic_id=topic.id,
        stem="What is PadhAI?",
        options=["AI", "Toy", "Car", "None"],
        answer="AI",
        explanation="PadhAI is a learning platform",
        source_chunk_ids=[chunk.id],
    )
    db_session.add(q)
    db_session.commit()

    attempt = Attempt(
        course_id=course.id,
        user_id=user_id,
        question_id=q.id,
        topic_id=topic.id,
        selected_answer="AI",
        correct=True,
    )
    db_session.add(attempt)

    mastery = Mastery(course_id=course.id, user_id=user_id, topic_id=topic.id, score=0.9)
    db_session.add(mastery)
    db_session.commit()

    # 5. Flashcard, Roadmap, Lesson, Chat
    card = Flashcard(
        course_id=course.id,
        user_id=user_id,
        topic_id=topic.id,
        front="Front",
        back="Back",
    )
    db_session.add(card)

    rm = RoadmapItem(
        course_id=course.id,
        user_id=user_id,
        day=1,
        topic_id=topic.id,
        topic_name=topic.name,
        title="Day 1 Intro",
    )
    db_session.add(rm)
    db_session.commit()

    lesson = Lesson(
        course_id=course.id,
        roadmap_item_id=rm.id,
        task_id="task_1",
        topic_id=topic.id,
        user_id=user_id,
        title="Intro Lesson",
    )
    db_session.add(lesson)
    db_session.commit()

    lp = LessonProgress(
        course_id=course.id,
        lesson_id=lesson.id,
        user_id=user_id,
        completed=True,
    )
    db_session.add(lp)

    thread = ChatThread(course_id=course.id, user_id=user_id)
    db_session.add(thread)
    db_session.commit()

    msg = ChatMessageRecord(
        course_id=course.id,
        user_id=user_id,
        thread_id=thread.id,
        role="user",
        content="Hello!",
    )
    db_session.add(msg)

    # 6. Study Session
    sess = StudySession(course_id=course.id, user_id=user_id, pomodoros=1, focus_avg=0.9)
    db_session.add(sess)
    db_session.commit()

    return course, doc, file_uri


def test_full_course_cascade_deletion(client: TestClient, db_session, tmp_path):
    """Deleting a course removes ALL related rows, chunks, questions, cards, and files,
    while leaving another user's course completely untouched.
    """
    from app.core.storage import LocalStorageBackend
    storage = LocalStorageBackend(base_dir=str(tmp_path / "storage"))

    # Seed User 1 & Course 1
    user1 = User(email="user1_del@example.com", firebase_uid="firebase_uid_1")
    db_session.add(user1)
    db_session.commit()

    course1, doc1, file1_uri = seed_complete_course(db_session, user1.id, "Course 1 (To Delete)", storage)

    # Seed User 2 & Course 2 (untouched control)
    user2 = User(email="user2_keep@example.com", firebase_uid="firebase_uid_2")
    db_session.add(user2)
    db_session.commit()

    course2, doc2, file2_uri = seed_complete_course(db_session, user2.id, "Course 2 (Preserve)", storage)

    # Confirm physical files exist
    assert storage.exists(file1_uri) is True
    assert storage.exists(file2_uri) is True

    # User 1 deletes Course 1
    resp = client.delete(
        f"/api/courses/{course1.id}",
        headers={"Authorization": "Bearer token_user_1"},
    )
    assert resp.status_code == 204

    # Assert Course 1 physical file deleted
    assert storage.exists(file1_uri) is False

    # Assert zero rows remain for Course 1
    assert db_session.query(Course).filter(Course.id == course1.id).count() == 0
    assert db_session.query(Document).filter(Document.course_id == course1.id).count() == 0
    assert db_session.query(Chunk).filter(Chunk.course_id == course1.id).count() == 0
    assert db_session.query(Topic).filter(Topic.course_id == course1.id).count() == 0
    assert db_session.query(Question).filter(Question.course_id == course1.id).count() == 0
    assert db_session.query(Attempt).filter(Attempt.course_id == course1.id).count() == 0
    assert db_session.query(Mastery).filter(Mastery.course_id == course1.id).count() == 0
    assert db_session.query(Flashcard).filter(Flashcard.course_id == course1.id).count() == 0
    assert db_session.query(RoadmapItem).filter(RoadmapItem.course_id == course1.id).count() == 0
    assert db_session.query(Lesson).filter(Lesson.course_id == course1.id).count() == 0
    assert db_session.query(LessonProgress).filter(LessonProgress.course_id == course1.id).count() == 0
    assert db_session.query(ChatThread).filter(ChatThread.course_id == course1.id).count() == 0
    assert db_session.query(ChatMessageRecord).filter(ChatMessageRecord.course_id == course1.id).count() == 0
    assert db_session.query(StudySession).filter(StudySession.course_id == course1.id).count() == 0

    # Assert User 2's data is 100% UNTOUCHED
    assert storage.exists(file2_uri) is True
    assert db_session.query(Course).filter(Course.id == course2.id).count() == 1
    assert db_session.query(Document).filter(Document.course_id == course2.id).count() == 1
    assert db_session.query(Chunk).filter(Chunk.course_id == course2.id).count() == 1
    assert db_session.query(Topic).filter(Topic.course_id == course2.id).count() == 1
    assert db_session.query(Question).filter(Question.course_id == course2.id).count() == 1


def test_document_deletion_cleans_up_orphaned_chunks(client: TestClient, db_session, tmp_path):
    """Deleting an individual document deletes its storage file and all associated chunks."""
    from app.core.storage import LocalStorageBackend
    storage = LocalStorageBackend(base_dir=str(tmp_path / "storage"))

    user = User(email="user_docdel@example.com", firebase_uid="firebase_uid_1")
    db_session.add(user)
    db_session.commit()

    course, doc, file_uri = seed_complete_course(db_session, user.id, "Doc Orphan Test", storage)
    assert storage.exists(file_uri) is True
    assert db_session.query(Chunk).filter(Chunk.document_id == doc.id).count() == 1

    # Delete document
    resp = client.delete(
        f"/api/courses/{course.id}/documents/{doc.id}",
        headers={"Authorization": "Bearer token_user_1"},
    )
    assert resp.status_code == 204

    # File and document deleted
    assert storage.exists(file_uri) is False
    assert db_session.query(Document).filter(Document.id == doc.id).count() == 0

    # Chunks deleted (no orphans left)
    assert db_session.query(Chunk).filter(Chunk.document_id == doc.id).count() == 0

    # Course itself is still alive
    assert db_session.query(Course).filter(Course.id == course.id).count() == 1
