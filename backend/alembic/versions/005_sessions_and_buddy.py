"""Study sessions, break events, and buddy state migration.

Revision ID: 005_sessions_and_buddy
Revises: 004_roadmap_and_chat_history
Create Date: 2026-10-25 02:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic (max 32 characters for alembic_version.version_num)
revision: str = "005_sessions_and_buddy"
down_revision: str | None = "004_roadmap_and_chat_history"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Study sessions
    op.create_table(
        "study_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pomodoros", sa.Integer(), server_default="0", nullable=False),
        sa.Column("focus_avg", sa.Float(), nullable=True),
        sa.Column("drowsy_minutes", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_study_sessions_id", "study_sessions", ["id"])
    op.create_index("ix_study_sessions_user_course", "study_sessions", ["user_id", "course_id"])

    # 2. Break events
    op.create_table(
        "break_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("break_type", sa.String(50), nullable=False),
        sa.Column("outcome", sa.String(50), nullable=False),
        sa.Column("cooldown_at_time_s", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["study_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_break_events_id", "break_events", ["id"])
    op.create_index("ix_break_events_session", "break_events", ["session_id"])
    op.create_index("ix_break_events_user", "break_events", ["user_id"])

    # 3. Buddy state
    op.create_table(
        "buddy_state",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("persona_pack", sa.String(50), server_default="tanglish", nullable=False),
        sa.Column("tone_mode", sa.String(50), server_default="balanced", nullable=False),
        sa.Column("address_term", sa.String(50), server_default="boss", nullable=False),
        sa.Column("sensitivity", sa.String(50), server_default="balanced", nullable=False),
        sa.Column("camera_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_buddy_state_id", "buddy_state", ["id"])
    op.create_index("ix_buddy_state_user", "buddy_state", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_buddy_state_user", table_name="buddy_state")
    op.drop_index("ix_buddy_state_id", table_name="buddy_state")
    op.drop_table("buddy_state")

    op.drop_index("ix_break_events_user", table_name="break_events")
    op.drop_index("ix_break_events_session", table_name="break_events")
    op.drop_index("ix_break_events_id", table_name="break_events")
    op.drop_table("break_events")

    op.drop_index("ix_study_sessions_user_course", table_name="study_sessions")
    op.drop_index("ix_study_sessions_id", table_name="study_sessions")
    op.drop_table("study_sessions")
