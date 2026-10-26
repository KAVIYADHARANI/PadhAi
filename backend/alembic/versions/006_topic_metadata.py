"""Topic metadata: module_name, description, learning_objective.

Revision ID: 006_topic_metadata
Revises: 005_sessions_and_buddy
Create Date: 2026-10-25 03:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "006_topic_metadata"
down_revision: str | None = "005_sessions_and_buddy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("topics", sa.Column("module_name", sa.String(length=255), nullable=True))
    op.add_column("topics", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("topics", sa.Column("learning_objective", sa.Text(), nullable=True))
    op.create_index("ix_topics_module_name", "topics", ["module_name"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_topics_module_name", table_name="topics")
    op.drop_column("topics", "learning_objective")
    op.drop_column("topics", "description")
    op.drop_column("topics", "module_name")
