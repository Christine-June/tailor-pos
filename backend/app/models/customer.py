"""Customer profiles and their append-only measurement history."""
from ..extensions import db
from .base import iso, make_append_only, tenant_fk, utcnow, uuid_pk

# Starter catalogue for the measurement form. Custom keys are also accepted, because every
# designer measures slightly differently and that must not need a schema migration.
MEASUREMENT_FIELDS = [
    {"group": "Upper body", "key": "neck", "label": "Neck"},
    {"group": "Upper body", "key": "shoulders", "label": "Shoulders"},
    {"group": "Upper body", "key": "chest", "label": "Chest"},
    {"group": "Upper body", "key": "bust", "label": "Bust"},
    {"group": "Upper body", "key": "underbust", "label": "Under-bust"},
    {"group": "Upper body", "key": "waist", "label": "Waist"},
    {"group": "Upper body", "key": "back_width", "label": "Back width"},
    {"group": "Upper body", "key": "top_length", "label": "Top / jacket length"},
    {"group": "Arms", "key": "sleeve_length", "label": "Sleeve length"},
    {"group": "Arms", "key": "bicep", "label": "Bicep"},
    {"group": "Arms", "key": "armhole", "label": "Armhole"},
    {"group": "Arms", "key": "wrist", "label": "Wrist"},
    {"group": "Lower body", "key": "hips", "label": "Hips"},
    {"group": "Lower body", "key": "thigh", "label": "Thigh"},
    {"group": "Lower body", "key": "knee", "label": "Knee"},
    {"group": "Lower body", "key": "ankle", "label": "Ankle"},
    {"group": "Lower body", "key": "rise", "label": "Rise"},
    {"group": "Lower body", "key": "inseam", "label": "Inseam"},
    {"group": "Lower body", "key": "outseam", "label": "Outseam"},
    {"group": "Lower body", "key": "skirt_length", "label": "Skirt length"},
    {"group": "Lower body", "key": "dress_length", "label": "Dress length"},
]


class Customer(db.Model):
    __tablename__ = "customers"

    id = uuid_pk()
    shop_id = tenant_fk()
    first_name = db.Column(db.String(50), nullable=False)
    last_name = db.Column(db.String(50), nullable=False, default="")
    # Deliberately not unique: a parent's number is often used for their children. The API
    # warns about duplicates and lets staff confirm instead of blocking the sale.
    phone = db.Column(db.String(20), index=True)
    email = db.Column(db.String(120))
    notes = db.Column(db.Text)
    archived_at = db.Column(db.DateTime(timezone=True))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    measurements = db.relationship(
        "Measurement", back_populates="customer", order_by="Measurement.recorded_at.desc()", lazy="select"
    )

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "first_name": self.first_name,
            "last_name": self.last_name,
            "full_name": self.full_name,
            "phone": self.phone,
            "email": self.email,
            "notes": self.notes,
            "archived": self.archived_at is not None,
            "created_at": iso(self.created_at),
        }


class Measurement(db.Model):
    """One immutable fitting. A correction is a new record, so invoices keep pointing at what was cut."""

    __tablename__ = "measurements"

    id = uuid_pk()
    shop_id = tenant_fk()
    customer_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True)
    unit = db.Column(db.String(2), nullable=False, default="in")
    # {"chest": "42.50", ...}; strings keep the exact value the tailor entered.
    values = db.Column("spec_values", db.JSON, nullable=False)
    label = db.Column(db.String(80))
    notes = db.Column(db.Text)
    taken_by_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("users.id", ondelete="RESTRICT"))
    recorded_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    customer = db.relationship("Customer", back_populates="measurements")
    taken_by = db.relationship("User", lazy="joined")

    __table_args__ = (db.CheckConstraint("unit IN ('in', 'cm')", name="ck_measurements_unit"),)

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "customer_id": str(self.customer_id),
            "unit": self.unit,
            "values": self.values,
            "label": self.label,
            "notes": self.notes,
            "taken_by": self.taken_by.name if self.taken_by else None,
            "recorded_at": iso(self.recorded_at),
        }


make_append_only(Measurement)
