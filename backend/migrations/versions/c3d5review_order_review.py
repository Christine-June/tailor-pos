"""Offline sales that broke a rule wait for the owner to check them.

Revision ID: c3d5review
Revises: b2c4units
"""
import sqlalchemy as sa
from alembic import op

revision = "c3d5review"
down_revision = "b2c4units"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("orders", sa.Column("review_reason", sa.String(300), nullable=True))
    # The dashboard looks these up on every load; only a handful are ever waiting.
    op.create_index(
        "ix_orders_shop_review", "orders", ["shop_id"], postgresql_where=sa.text("review_reason IS NOT NULL")
    )


def downgrade():
    op.drop_index("ix_orders_shop_review", table_name="orders")
    op.drop_column("orders", "review_reason")
