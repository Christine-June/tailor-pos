"""Standard units for stock items.

The unit used to be free text, so some items hold a number (e.g. "3") or a spelling like "pieces".
Known spellings become their code; anything else becomes the usual unit for the item's type.

Revision ID: b2c4units
Revises: a1f0append0only
"""
from alembic import op

revision = "b2c4units"
down_revision = "a1f0append0only"
branch_labels = None
depends_on = None

ALIASES = {
    "pc": "pcs", "piece": "pcs", "pieces": "pcs", "metre": "m", "metres": "m", "meter": "m", "meters": "m",
    "yard": "yd", "yards": "yd", "sets": "set", "pairs": "pair", "rolls": "roll", "jobs": "job",
}
CODES = ("pcs", "m", "yd", "set", "pair", "roll", "job")


def upgrade():
    op.execute("UPDATE inventory_items SET unit = lower(trim(unit))")
    for alias, code in ALIASES.items():
        op.execute(f"UPDATE inventory_items SET unit = '{code}' WHERE unit = '{alias}'")
    known = ", ".join(f"'{c}'" for c in CODES)
    op.execute(
        f"""
        UPDATE inventory_items SET unit = CASE kind::text
            WHEN 'fabric' THEN 'm' WHEN 'service' THEN 'job' ELSE 'pcs' END
        WHERE unit NOT IN ({known})
        """
    )


def downgrade():
    pass
