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

from pgvector.sqlalchemy import HALFVEC, VECTOR
from sqlalchemy import (
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
    guardrail_events = relationship("GuardrailEvent", back_populates="user", cascade="all, delete-orphan")


class Course(Base):
    """Courses owned by a user."""

    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
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


class Document(Base):
    """Uploaded course documents awaiting ingestion or ready."""

    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
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

    __table_args__ = (
        Index("ix_documents_user_course", "user_id", "course_id"),
    )


class LLMUsage(Base):
    """Per-user daily token and call tracking."""

    __tablename__ = "llm_usage"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    day = Column(Date, default=lambda: datetime.now(UTC).date(), nullable=False, index=True)
    provider = Column(String(100), nullable=False)
    model = Column(String(100), nullable=False)
    calls = Column(Integer, default=0, nullable=False)
    tokens_in = Column(Integer, default=0, nullable=False)
    tokens_out = Column(Integer, default=0, nullable=False)

    # Relationships
    user = relationship("User", back_populates="llm_usage")

    __table_args__ = (
        Index("ix_llm_usage_user_day", "user_id", "day"),
    )


class GuardrailEvent(Base):
    """Audit log of guardrail actions.

    SECURITY RULE: Contains NO message text or document text.
    """

    __tablename__ = "guardrail_events"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
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
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
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
    course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    parent_id = Column(Integer, ForeignKey("topics.id", ondelete="SET NULL"), nullable=True, index=True)

    # Relationships
    course = relationship("Course", back_populates="topics")
    chunks = relationship("Chunk", secondary="chunk_topics", back_populates="topics")

    __table_args__ = (
        Index("ix_topics_course", "course_id"),
    )
