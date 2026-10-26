"""Phase 1 migration: chunks, topics, chunk_topics with vector and tsvector indexes.

Revision ID: 002_phase1_chunks_and_topics
Revises: 001_phase0_initial
Create Date: 2026-10-24 19:55:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import HALFVEC, VECTOR
from sqlalchemy.dialects.postgresql import TSVECTOR

from alembic import op
from app.core.config import settings

# revision identifiers, used by Alembic.
revision: str = "002_phase1_chunks_and_topics"
down_revision: str | None = "001_phase0_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    embedding_col_type = (
        HALFVEC(settings.EMBED_DIM) if settings.USE_HALFVEC else VECTOR(settings.EMBED_DIM)
    )
    hnsw_ops = "halfvec_cosine_ops" if settings.USE_HALFVEC else "vector_cosine_ops"

    # 1. Chunks table
    op.create_table(
        "chunks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("page", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("heading_path", sa.String(length=512), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("low_conf", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("injection_flag", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("embedding", embedding_col_type, nullable=True),
        sa.Column("tsv", TSVECTOR(), nullable=True),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chunks_id", "chunks", ["id"], unique=False)
    op.create_index("ix_chunks_document_id", "chunks", ["document_id"], unique=False)
    op.create_index("ix_chunks_course_id", "chunks", ["course_id"], unique=False)
    op.create_index("ix_chunks_user_id", "chunks", ["user_id"], unique=False)
    op.create_index("ix_chunks_user_course", "chunks", ["user_id", "course_id"], unique=False)
    op.create_index("ix_chunks_tsv", "chunks", ["tsv"], postgresql_using="gin")
    op.create_index(
        "ix_chunks_embedding",
        "chunks",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_ops={"embedding": hnsw_ops},
    )

    # 2. Topics table
    op.create_table(
        "topics",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["topics.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_topics_id", "topics", ["id"], unique=False)
    op.create_index("ix_topics_course_id", "topics", ["course_id"], unique=False)
    op.create_index("ix_topics_parent_id", "topics", ["parent_id"], unique=False)

    # 3. Chunk Topics mapping table
    op.create_table(
        "chunk_topics",
        sa.Column("chunk_id", sa.Integer(), nullable=False),
        sa.Column("topic_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["chunk_id"], ["chunks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("chunk_id", "topic_id"),
    )
    op.create_index("ix_chunk_topics_chunk_id", "chunk_topics", ["chunk_id"], unique=False)
    op.create_index("ix_chunk_topics_topic_id", "chunk_topics", ["topic_id"], unique=False)


def downgrade() -> None:
    op.drop_table("chunk_topics")
    op.drop_table("topics")
    op.drop_table("chunks")
