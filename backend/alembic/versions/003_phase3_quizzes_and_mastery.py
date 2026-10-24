"""Phase 3 migration: questions, attempts, and mastery tables.

Revision ID: 003_phase3_quizzes_and_mastery
Revises: 002_phase1_chunks_and_topics
Create Date: 2026-10-25 00:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003_phase3_quizzes_and_mastery"
down_revision: str | None = "002_phase1_chunks_and_topics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Questions table
    op.create_table(
        "questions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("topic_id", sa.Integer(), nullable=False),
        sa.Column("stem", sa.Text(), nullable=False),
        sa.Column("question_type", sa.String(length=50), nullable=False, server_default="mcq"),
        sa.Column("options", sa.JSON(), nullable=False),
        sa.Column("answer", sa.String(length=255), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("source_chunk_ids", sa.JSON(), nullable=False),
        sa.Column("difficulty", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_questions_id", "questions", ["id"], unique=False)
    op.create_index("ix_questions_course_id", "questions", ["course_id"], unique=False)
    op.create_index("ix_questions_topic_id", "questions", ["topic_id"], unique=False)
    op.create_index(
        "ix_questions_course_topic", "questions", ["course_id", "topic_id"], unique=False
    )

    # 2. Attempts table
    op.create_table(
        "attempts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("question_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("topic_id", sa.Integer(), nullable=False),
        sa.Column("selected_answer", sa.String(length=255), nullable=False),
        sa.Column("correct", sa.Boolean(), nullable=False),
        sa.Column("time_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_attempts_id", "attempts", ["id"], unique=False)
    op.create_index("ix_attempts_user_id", "attempts", ["user_id"], unique=False)
    op.create_index("ix_attempts_question_id", "attempts", ["question_id"], unique=False)
    op.create_index("ix_attempts_course_id", "attempts", ["course_id"], unique=False)
    op.create_index("ix_attempts_topic_id", "attempts", ["topic_id"], unique=False)
    op.create_index("ix_attempts_user_topic", "attempts", ["user_id", "topic_id"], unique=False)
    op.create_index("ix_attempts_user_course", "attempts", ["user_id", "course_id"], unique=False)

    # 3. Mastery table
    op.create_table(
        "mastery",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("topic_id", sa.Integer(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("attempts_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "topic_id", name="uq_mastery_user_topic"),
    )
    op.create_index("ix_mastery_id", "mastery", ["id"], unique=False)
    op.create_index("ix_mastery_user_id", "mastery", ["user_id"], unique=False)
    op.create_index("ix_mastery_course_id", "mastery", ["course_id"], unique=False)
    op.create_index("ix_mastery_topic_id", "mastery", ["topic_id"], unique=False)
    op.create_index("ix_mastery_user_course", "mastery", ["user_id", "course_id"], unique=False)


def downgrade() -> None:
    op.drop_table("mastery")
    op.drop_table("attempts")
    op.drop_table("questions")
