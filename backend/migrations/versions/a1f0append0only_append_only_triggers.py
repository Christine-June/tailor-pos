"""Enforce append-only history in the database itself.

Measurements locked to invoices and the money ledger must stay correct even if a future bug
or a manual SQL session tries to change them.

Revision ID: a1f0append0only
Revises: d77361a366a2
"""
from alembic import op

revision = "a1f0append0only"
down_revision = "d77361a366a2"
branch_labels = None
depends_on = None

TABLES = ("measurements", "payments", "stock_movements", "order_status_events", "audit_log")


def upgrade():
    op.execute(
        """
        CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    for table in TABLES:
        op.execute(
            f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION forbid_mutation();"
        )


def downgrade():
    for table in TABLES:
        op.execute(f"DROP TRIGGER {table}_append_only ON {table};")
    op.execute("DROP FUNCTION forbid_mutation();")
