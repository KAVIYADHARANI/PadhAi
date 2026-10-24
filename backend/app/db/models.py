"""SQLAlchemy 2 database models for Phase 0.

Strictly defines ONLY the tables specified in Phase 0:
- users
- courses
- documents
- llm_usage
- guardrail_events (without message text)
"""

import json
from datetime import UTC, datetime
from pathlib import Path

from pgvector.sqlalchemy import HALFVEC, VECTOR
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import relationship
from sqlalchemy.types import TypeDecorator

from app.core.config import settings
from app.db.session import Base


class SQLiteVectorType(TypeDecorator):
    """Custom type to support vector arrays in SQLite for local testing without pgvector."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and isinstance(value, (list, tuple)):
            return json.dumps(value)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return value
        return value


vector_type = HALFVEC(settings.EMBED_DIM) if settings.USE_HALFVEC else VECTOR(settings.EMBED_DIM)
EmbeddingType = vector_type.with_variant(SQLiteVectorType(), "sqlite")
TSVectorType = TSVECTOR().with_variant(Text, "sqlite")


class User(Base):
    """Users table keyed by firebase_uid."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    firebase_uid = Column(String(128), unique=True, nullable=False, index=True)
    email = Column(String(255), nullable=True)
    display_name = Column(String(255), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    courses = relationship("Course", back_populates="user", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="user", cascade="all, delete-orphan")
    chunks = relationship("Chunk", back_populates="user", cascade="all, delete-orphan")
    llm_usage = relationship("LLMUsage", back_populates="user", cascade="all, delete-orphan")
    guardrail_events = relationship(
        "GuardrailEvent", back_populates="user", cascade="all, delete-orphan"
    )
    attempts = relationship("Attempt", back_populates="user", cascade="all, delete-orphan")
    masteries = relationship("Mastery", back_populates="user", cascade="all, delete-orphan")
    roadmap_items = relationship("RoadmapItem", back_populates="user", cascade="all, delete-orphan")
    chat_threads = relationship("ChatThread", back_populates="user", cascade="all, delete-orphan")
    chat_messages = relationship(
        "ChatMessageRecord", back_populates="user", cascade="all, delete-orphan"
    )
    study_sessions = relationship(
        "StudySession", back_populates="user", cascade="all, delete-orphan"
    )
    break_events = relationship("BreakEvent", back_populates="user", cascade="all, delete-orphan")
    buddy_state = relationship(
        "BuddyState", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class Course(Base):
    """Courses owned by a user."""

    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    goal_days = Column(Integer, default=30, nullable=False)
    hours_per_day = Column(Float, default=1.0, nullable=False)
    level = Column(String(50), default="beginner", nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    user = relationship("User", back_populates="courses")
    documents = relationship("Document", back_populates="course", cascade="all, delete-orphan")
    chunks = relationship("Chunk", back_populates="course", cascade="all, delete-orphan")
    topics = relationship("Topic", back_populates="course", cascade="all, delete-orphan")
    questions = relationship("Question", back_populates="course", cascade="all, delete-orphan")
    attempts = relationship("Attempt", back_populates="course", cascade="all, delete-orphan")
    masteries = relationship("Mastery", back_populates="course", cascade="all, delete-orphan")
    roadmap_items = relationship(
        "RoadmapItem", back_populates="course", cascade="all, delete-orphan"
    )
    chat_threads = relationship("ChatThread", back_populates="course", cascade="all, delete-orphan")
    chat_messages = relationship(
        "ChatMessageRecord", back_populates="course", cascade="all, delete-orphan"
    )
    study_sessions = relationship(
        "StudySession", back_populates="course", cascade="all, delete-orphan"
    )


class Document(Base):
    """Uploaded course documents awaiting ingestion or ready."""

    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    course_id = Column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_uri = Column(String(1024), nullable=False)
    pages = Column(Integer, nullable=True)
    pages_ocr = Column(Integer, nullable=True)
    ocr_avg_conf = Column(Float, nullable=True)
    status = Column(String(50), default="queued", nullable=False, index=True)
    error = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    user = relationship("User", back_populates="documents")
    course = relationship("Course", back_populates="documents")
    chunks = relationship("Chunk", back_populates="document", cascade="all, delete-orphan")

    @property
    def filename(self) -> str:
        return Path(self.file_uri).name

    @property
    def size_bytes(self) -> int | None:
        try:
            p = Path(self.file_uri)
            if p.exists():
                return p.stat().st_size
        except Exception:
            pass
        return None

    @property
    def chunks_count(self) -> int:
        return len(self.chunks) if self.chunks is not None else 0

    __table_args__ = (Index("ix_documents_user_course", "user_id", "course_id"),)


class LLMUsage(Base):
    """Per-user daily token and call tracking."""

    __tablename__ = "llm_usage"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day = Column(Date, default=lambda: datetime.now(UTC).date(), nullable=False, index=True)
    provider = Column(String(100), nullable=False)
    model = Column(String(100), nullable=False)
    calls = Column(Integer, default=0, nullable=False)
    tokens_in = Column(Integer, default=0, nullable=False)
    tokens_out = Column(Integer, default=0, nullable=False)

    # Relationships
    user = relationship("User", back_populates="llm_usage")

    __table_args__ = (Index("ix_llm_usage_user_day", "user_id", "day"),)


class GuardrailEvent(Base):
    """Audit log of guardrail actions.

    SECURITY RULE: Contains NO message text or document text.
    """

    __tablename__ = "guardrail_events"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    layer = Column(String(100), nullable=False)
    rule = Column(String(100), nullable=False)
    action = Column(String(100), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    user = relationship("User", back_populates="guardrail_events")


class ChunkTopic(Base):
    """Many-to-many relationship mapping chunks to topics."""

    __tablename__ = "chunk_topics"

    chunk_id = Column(Integer, ForeignKey("chunks.id", ondelete="CASCADE"), primary_key=True)
    topic_id = Column(Integer, ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True)


class Chunk(Base):
    """Text chunk extracted from a document, indexed for lexical and semantic retrieval."""

    __tablename__ = "chunks"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    document_id = Column(
        Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_id = Column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    page = Column(Integer, nullable=False, default=1)
    heading_path = Column(String(512), nullable=True)
    text = Column(Text, nullable=False)
    low_conf = Column(Boolean, default=False, nullable=False)
    injection_flag = Column(Boolean, default=False, nullable=False)
    embedding = Column(EmbeddingType, nullable=True)
    tsv = Column(TSVectorType, nullable=True)

    # Relationships
    document = relationship("Document", back_populates="chunks")
    course = relationship("Course", back_populates="chunks")
    user = relationship("User", back_populates="chunks")
    topics = relationship("Topic", secondary="chunk_topics", back_populates="chunks")

    __table_args__ = (
        Index("ix_chunks_user_course", "user_id", "course_id"),
        Index("ix_chunks_tsv", "tsv", postgresql_using="gin"),
        Index(
            "ix_chunks_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={
                "embedding": "halfvec_cosine_ops" if settings.USE_HALFVEC else "vector_cosine_ops"
            },
        ),
    )


class Topic(Base):
    """Course topics for syllabus hierarchy and quiz/flashcard grouping."""

    __tablename__ = "topics"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    course_id = Column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    parent_id = Column(
        Integer, ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True
    )
    module_name = Column(String(255), nullable=True, index=True)
    description = Column(Text, nullable=True)
    learning_objective = Column(Text, nullable=True)

    # Relationships
    course = relationship("Course", back_populates="topics")
    chunks = relationship("Chunk", secondary="chunk_topics", back_populates="topics")
    questions = relationship("Question", back_populates="topic", cascade="all, delete-orphan")
    attempts = relationship("Attempt", back_populates="topic", cascade="all, delete-orphan")
    masteries = relationship("Mastery", back_populates="topic", cascade="all, delete-orphan")
    roadmap_items = relationship("RoadmapItem", back_populates="topic")

    __table_args__ = (Index("ix_topics_course", "course_id"),)


class Question(Base):
    """Quiz questions grounded in source chunks."""

    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    course_id = Column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    topic_id = Column(
        Integer, ForeignKey("topics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    stem = Column(Text, nullable=False)
    question_type = Column(String(50), default="mcq", nullable=False)
    options = Column(JSON, nullable=False)
    answer = Column(String(255), nullable=False)
    explanation = Column(Text, nullable=False)
    source_chunk_ids = Column(JSON, nullable=False)
    difficulty = Column(Float, default=1.0, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    course = relationship("Course", back_populates="questions")
    topic = relationship("Topic", back_populates="questions")
    attempts = relationship("Attempt", back_populates="question", cascade="all, delete-orphan")

    __table_args__ = (Index("ix_questions_course_topic", "course_id", "topic_id"),)


class Attempt(Base):
    """Student attempt records for quiz questions."""

    __tablename__ = "attempts"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    question_id = Column(
        Integer, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_id = Column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    topic_id = Column(
        Integer, ForeignKey("topics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    selected_answer = Column(String(255), nullable=False)
    correct = Column(Boolean, nullable=False)
    time_ms = Column(Integer, default=0, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    user = relationship("User", back_populates="attempts")
    question = relationship("Question", back_populates="attempts")
    course = relationship("Course", back_populates="attempts")
    topic = relationship("Topic", back_populates="attempts")

    __table_args__ = (
        Index("ix_attempts_user_topic", "user_id", "topic_id"),
        Index("ix_attempts_user_course", "user_id", "course_id"),
    )


class Mastery(Base):
    """Topic mastery score tracking per user."""

    __tablename__ = "mastery"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_id = Column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    topic_id = Column(
        Integer, ForeignKey("topics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    score = Column(Float, default=0.0, nullable=False)
    attempts_count = Column(Integer, default=0, nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    user = relationship("User", back_populates="masteries")
    course = relationship("Course", back_populates="masteries")
    topic = relationship("Topic", back_populates="masteries")

    __table_args__ = (
        UniqueConstraint("user_id", "topic_id", name="uq_mastery_user_topic"),
        Index("ix_mastery_user_course", "user_id", "course_id"),
    )


class RoadmapItem(Base):
    """Daily study plan milestone for a personalized course roadmap."""

    __tablename__ = "roadmap_items"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    course_id = Column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day = Column(Integer, nullable=False)
    topic_id = Column(
        Integer, ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True
    )
    topic_name = Column(String(255), nullable=False)
    title = Column(String(255), nullable=False)
    learning_objectives = Column(JSON, nullable=False, default=list)
    tasks = Column(JSON, nullable=False, default=list)
    estimated_minutes = Column(Integer, default=60, nullable=False)
    completed = Column(Boolean, default=False, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    course = relationship("Course", back_populates="roadmap_items")
    user = relationship("User", back_populates="roadmap_items")
    topic = relationship("Topic", back_populates="roadmap_items")

    __table_args__ = (
        Index("ix_roadmap_items_user_course", "user_id", "course_id"),
        Index("ix_roadmap_items_course_day", "course_id", "day"),
    )


class ChatThread(Base):
    """Persistent chat thread for a user and course conversation."""

    __tablename__ = "chat_threads"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_id = Column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    user = relationship("User", back_populates="chat_threads")
    course = relationship("Course", back_populates="chat_threads")
    messages = relationship(
        "ChatMessageRecord", back_populates="thread", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_chat_threads_user_course", "user_id", "course_id"),)


class ChatMessageRecord(Base):
    """Individual message in a course chat thread."""

    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    thread_id = Column(
        Integer, ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_id = Column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role = Column(String(50), nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    citations = Column(JSON, nullable=False, default=list)
    tone = Column(String(50), nullable=True)
    is_sufficient = Column(Boolean, default=True, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    thread = relationship("ChatThread", back_populates="messages")
    user = relationship("User", back_populates="chat_messages")
    course = relationship("Course", back_populates="chat_messages")

    __table_args__ = (
        Index("ix_chat_messages_thread", "thread_id"),
        Index("ix_chat_messages_user_course", "user_id", "course_id"),
    )


class StudySession(Base):
    """Recorded study session aggregating Pomodoro cycles and focus metrics."""

    __tablename__ = "study_sessions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    course_id = Column(
        Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    ended_at = Column(DateTime(timezone=True), nullable=True)
    pomodoros = Column(Integer, default=0, nullable=False)
    focus_avg = Column(Float, nullable=True)
    drowsy_minutes = Column(Float, nullable=True)

    # Relationships
    user = relationship("User", back_populates="study_sessions")
    course = relationship("Course", back_populates="study_sessions")
    break_events = relationship(
        "BreakEvent", back_populates="session", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_study_sessions_user_course", "user_id", "course_id"),)


class BreakEvent(Base):
    """Logged outcome of proactive or user-initiated break suggestions."""

    __tablename__ = "break_events"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    session_id = Column(
        Integer, ForeignKey("study_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    break_type = Column(String(50), nullable=False)
    outcome = Column(String(50), nullable=False)  # "accepted" | "dismissed" | "ignored"
    cooldown_at_time_s = Column(Integer, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    session = relationship("StudySession", back_populates="break_events")
    user = relationship("User", back_populates="break_events")

    __table_args__ = (
        Index("ix_break_events_session", "session_id"),
        Index("ix_break_events_user", "user_id"),
    )


class BuddyState(Base):
    """User-level study companion preferences and mode settings."""

    __tablename__ = "buddy_state"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True
    )
    persona_pack = Column(String(50), default="tanglish", nullable=False)
    tone_mode = Column(String(50), default="balanced", nullable=False)
    address_term = Column(String(50), default="boss", nullable=False)
    sensitivity = Column(String(50), default="balanced", nullable=False)
    camera_enabled = Column(Boolean, default=False, nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # Relationships
    user = relationship("User", back_populates="buddy_state")

    __table_args__ = (Index("ix_buddy_state_user", "user_id"),)
