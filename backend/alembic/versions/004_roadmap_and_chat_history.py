"""Roadmap and chat history tables migration.

Revision ID: 004_roadmap_and_chat_history
Revises: 003_phase3_quizzes_and_mastery
Create Date: 2026-10-25 01:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004_roadmap_and_chat_history"
down_revision: str | None = "003_phase3_quizzes_and_mastery"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Roadmap items
    op.create_table(
        "roadmap_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Integer(), nullable=False),
        sa.Column("topic_id", sa.Integer(), nullable=True),
        sa.Column("topic_name", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("learning_objectives", sa.JSON(), nullable=False),
        sa.Column("tasks", sa.JSON(), nullable=False),
        sa.Column("estimated_minutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_roadmap_items_id", "roadmap_items", ["id"], unique=False)
    op.create_index("ix_roadmap_items_course_id", "roadmap_items", ["course_id"], unique=False)
    op.create_index("ix_roadmap_items_user_id", "roadmap_items", ["user_id"], unique=False)
    op.create_index("ix_roadmap_items_topic_id", "roadmap_items", ["topic_id"], unique=False)
    op.create_index(
        "ix_roadmap_items_user_course", "roadmap_items", ["user_id", "course_id"], unique=False
    )
    op.create_index(
        "ix_roadmap_items_course_day", "roadmap_items", ["course_id", "day"], unique=False
    )

    # 2. Chat threads
    op.create_table(
        "chat_threads",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_threads_id", "chat_threads", ["id"], unique=False)
    op.create_index("ix_chat_threads_user_id", "chat_threads", ["user_id"], unique=False)
    op.create_index("ix_chat_threads_course_id", "chat_threads", ["course_id"], unique=False)
    op.create_index(
        "ix_chat_threads_user_course", "chat_threads", ["user_id", "course_id"], unique=False
    )

    # 3. Chat messages
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("thread_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("citations", sa.JSON(), nullable=False),
        sa.Column("tone", sa.String(length=50), nullable=True),
        sa.Column("is_sufficient", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["thread_id"], ["chat_threads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_id", "chat_messages", ["id"], unique=False)
    op.create_index("ix_chat_messages_thread_id", "chat_messages", ["thread_id"], unique=False)
    op.create_index("ix_chat_messages_user_id", "chat_messages", ["user_id"], unique=False)
    op.create_index("ix_chat_messages_course_id", "chat_messages", ["course_id"], unique=False)
    op.create_index("ix_chat_messages_thread", "chat_messages", ["thread_id"], unique=False)
    op.create_index(
        "ix_chat_messages_user_course", "chat_messages", ["user_id", "course_id"], unique=False
    )


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("chat_threads")
    op.drop_table("roadmap_items")
