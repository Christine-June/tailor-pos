"""Tenancy, staff accounts and the audit trail."""
from enum import Enum

from werkzeug.security import check_password_hash, generate_password_hash

from ..extensions import db
from .base import enum_col, iso, make_append_only, money, new_uuid, tenant_fk, utcnow, uuid_pk


class UserRole(str, Enum):
    OWNER = "owner"
    CASHIER = "cashier"
    TAILOR = "tailor"


class PrinterMode(str, Enum):
    NONE = "none"        # browser printing only
    AGENT = "agent"      # cloud deployment: print agent on a shop PC collects jobs
    NETWORK = "network"  # self-hosted on the shop LAN: server talks to printer directly


class Shop(db.Model):
    __tablename__ = "shops"

    id = uuid_pk()
    name = db.Column(db.String(120), nullable=False)
    address = db.Column(db.String(200))
    phone = db.Column(db.String(30))
    email = db.Column(db.String(120))
    kra_pin = db.Column(db.String(20))
    receipt_footer = db.Column(db.String(300))
    currency = db.Column(db.String(3), nullable=False, default="KES")
    timezone = db.Column(db.String(50), nullable=False, default="Africa/Nairobi")

    vat_registered = db.Column(db.Boolean, nullable=False, default=False)
    vat_rate = db.Column(db.Numeric(5, 2), nullable=False, default=16)
    min_deposit_pct = db.Column(db.Numeric(5, 2), nullable=False, default=0)
    measurement_unit = db.Column(db.String(2), nullable=False, default="in")

    printer_mode = enum_col(PrinterMode, nullable=False, default=PrinterMode.NONE)
    printer_host = db.Column(db.String(120))
    printer_port = db.Column(db.Integer, nullable=False, default=9100)
    printer_width = db.Column(db.Integer, nullable=False, default=42)
    agent_token_hash = db.Column(db.String(64), index=True)
    agent_last_seen = db.Column(db.DateTime(timezone=True))

    order_counter = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    __table_args__ = (
        db.CheckConstraint("vat_rate >= 0 AND vat_rate <= 100", name="ck_shops_vat_rate"),
        db.CheckConstraint("min_deposit_pct >= 0 AND min_deposit_pct <= 100", name="ck_shops_min_deposit"),
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "name": self.name,
            "address": self.address,
            "phone": self.phone,
            "email": self.email,
            "kra_pin": self.kra_pin,
            "receipt_footer": self.receipt_footer,
            "currency": self.currency,
            "timezone": self.timezone,
            "vat_registered": self.vat_registered,
            "vat_rate": money(self.vat_rate),
            "min_deposit_pct": money(self.min_deposit_pct),
            "measurement_unit": self.measurement_unit,
            "printer_mode": self.printer_mode.value,
            "printer_host": self.printer_host,
            "printer_port": self.printer_port,
            "printer_width": self.printer_width,
            "agent_configured": bool(self.agent_token_hash),
            "agent_last_seen": iso(self.agent_last_seen),
        }


class User(db.Model):
    __tablename__ = "users"

    id = uuid_pk()
    shop_id = tenant_fk()
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), nullable=False, unique=True, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = enum_col(UserRole, nullable=False, default=UserRole.CASHIER)
    active = db.Column(db.Boolean, nullable=False, default=True)
    # Bumped on password change or deactivation; older tokens stop working immediately.
    token_version = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    shop = db.relationship("Shop", lazy="joined")

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "name": self.name,
            "email": self.email,
            "role": self.role.value,
            "active": self.active,
        }


class AuditLog(db.Model):
    __tablename__ = "audit_log"

    id = uuid_pk()
    shop_id = tenant_fk()
    user_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("users.id", ondelete="RESTRICT"))
    action = db.Column(db.String(60), nullable=False)
    entity = db.Column(db.String(40), nullable=False)
    entity_id = db.Column(db.String(40))
    data = db.Column(db.JSON)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)


make_append_only(AuditLog)


def audit(shop_id, user_id, action: str, entity: str, entity_id=None, **data) -> None:
    db.session.add(
        AuditLog(
            id=new_uuid(),
            shop_id=shop_id,
            user_id=user_id,
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id else None,
            data=data or None,
        )
    )
