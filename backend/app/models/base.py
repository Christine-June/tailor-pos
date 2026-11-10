"""Column helpers shared by all models."""
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import event

from ..extensions import db


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


def uuid_pk():
    # Client-suppliable UUID keys make every offline create naturally idempotent.
    return db.Column(db.Uuid(as_uuid=True), primary_key=True, default=new_uuid)


def tenant_fk():
    return db.Column(db.Uuid(as_uuid=True), db.ForeignKey("shops.id", ondelete="RESTRICT"), nullable=False, index=True)


def enum_col(enum_cls, length=20, **kwargs):
    # Stored as a plain string so adding a value later doesn't need ALTER TYPE.
    return db.Column(
        db.Enum(enum_cls, native_enum=False, length=length, values_callable=lambda e: [m.value for m in e]),
        **kwargs,
    )


def money(value: Decimal | int | str | None) -> str | None:
    """Money and quantities leave the API as strings so no client ever rounds them as floats."""
    return None if value is None else str(value)


def iso(value) -> str | None:
    return None if value is None else value.isoformat()


class ImmutableRecordError(Exception):
    pass


def make_append_only(model) -> None:
    """Application-level guard; migrations add a matching database trigger as the last line of defence."""

    def _refuse(_mapper, _connection, target):
        raise ImmutableRecordError(f"{type(target).__name__} records are append-only")

    event.listen(model, "before_update", _refuse)
    event.listen(model, "before_delete", _refuse)
