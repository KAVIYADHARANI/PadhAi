"""Spaced repetition flashcards table.

Revision ID: 008_flashcards
Revises: 007_learning_companion
Create Date: 2026-10-26 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "008_flashcards"
down_revision: str | None = "007_learning_companion"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "flashcards",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("topic_id", sa.Integer(), nullable=True),
        sa.Column("front", sa.Text(), nullable=False),
        sa.Column("back", sa.Text(), nullable=False),
        sa.Column("source_chunk_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("reps", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("interval_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ease_factor", sa.Float(), nullable=False, server_default="2.5"),
        sa.Column(
            "due_date",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index("ix_flashcards_user_course", "flashcards", ["user_id", "course_id"])
    op.create_index("ix_flashcards_user_due", "flashcards", ["user_id", "due_date"])
    op.create_index("ix_flashcards_course_topic", "flashcards", ["course_id", "topic_id"])


def downgrade() -> None:
    op.drop_index("ix_flashcards_course_topic", table_name="flashcards")
    op.drop_index("ix_flashcards_user_due", table_name="flashcards")
    op.drop_index("ix_flashcards_user_course", table_name="flashcards")
    op.drop_table("flashcards")
