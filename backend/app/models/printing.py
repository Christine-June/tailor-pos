"""Print queue. A cloud server cannot reach a printer on a shop's LAN, so a local agent collects jobs."""
from enum import Enum

from ..extensions import db
from .base import enum_col, iso, tenant_fk, utcnow, uuid_pk


class PrintJobStatus(str, Enum):
    QUEUED = "queued"
    CLAIMED = "claimed"
    DONE = "done"
    FAILED = "failed"


class PrintJob(db.Model):
    __tablename__ = "print_jobs"

    id = uuid_pk()
    shop_id = tenant_fk()
    order_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    document = db.Column(db.String(20), nullable=False)
    payload = db.Column(db.LargeBinary, nullable=False)
    status = enum_col(PrintJobStatus, nullable=False, default=PrintJobStatus.QUEUED)
    attempts = db.Column(db.Integer, nullable=False, default=0)
    error = db.Column(db.String(300))
    claimed_at = db.Column(db.DateTime(timezone=True))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "order_id": str(self.order_id) if self.order_id else None,
            "document": self.document,
            "status": self.status.value,
            "attempts": self.attempts,
            "error": self.error,
            "created_at": iso(self.created_at),
        }
