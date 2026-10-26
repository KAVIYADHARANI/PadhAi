"""Interactive lessons and learning companion progress tracking.

Revision ID: 007_lessons_and_learning_companion
Revises: 006_topic_metadata
Create Date: 2026-10-25 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "007_learning_companion"
down_revision: str | None = "006_topic_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Create lessons table
    op.create_table(
        "lessons",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("roadmap_item_id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("topic_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("estimated_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("web_resources", sa.JSON(), nullable=False),
        sa.Column("youtube_resources", sa.JSON(), nullable=False),
        sa.Column("exercises", sa.JSON(), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="ready"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["roadmap_item_id"], ["roadmap_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "course_id", "roadmap_item_id", "task_id", name="uq_lessons_course_item_task"
        ),
    )
    op.create_index("ix_lessons_id", "lessons", ["id"], unique=False)
    op.create_index("ix_lessons_course_id", "lessons", ["course_id"], unique=False)
    op.create_index("ix_lessons_roadmap_item_id", "lessons", ["roadmap_item_id"], unique=False)
    op.create_index("ix_lessons_task_id", "lessons", ["task_id"], unique=False)
    op.create_index("ix_lessons_topic_id", "lessons", ["topic_id"], unique=False)
    op.create_index("ix_lessons_user_id", "lessons", ["user_id"], unique=False)
    op.create_index("ix_lessons_user_course", "lessons", ["user_id", "course_id"], unique=False)
    op.create_index("ix_lessons_roadmap_task", "lessons", ["roadmap_item_id", "task_id"], unique=False)

    # 2. Create lesson_progress table
    op.create_table(
        "lesson_progress",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("lesson_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("sections_completed", sa.JSON(), nullable=False),
        sa.Column("exercises_completed", sa.JSON(), nullable=False),
        sa.Column("quiz_score", sa.Float(), nullable=True),
        sa.Column("quiz_completed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("time_spent_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reflection", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "lesson_id", name="uq_lesson_progress_user_lesson"),
    )
    op.create_index("ix_lesson_progress_id", "lesson_progress", ["id"], unique=False)
    op.create_index("ix_lesson_progress_lesson_id", "lesson_progress", ["lesson_id"], unique=False)
    op.create_index("ix_lesson_progress_user_id", "lesson_progress", ["user_id"], unique=False)
    op.create_index("ix_lesson_progress_course_id", "lesson_progress", ["course_id"], unique=False)
    op.create_index("ix_lesson_progress_user_course", "lesson_progress", ["user_id", "course_id"], unique=False)


def downgrade() -> None:
    op.drop_table("lesson_progress")
    op.drop_table("lessons")
