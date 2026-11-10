"""Orders (job cards), the status history, and the payment ledger."""
from decimal import Decimal
from enum import Enum

from ..extensions import db
from .base import enum_col, iso, make_append_only, money, tenant_fk, utcnow, uuid_pk


class OrderKind(str, Enum):
    RETAIL = "retail"
    BESPOKE = "bespoke"


class OrderStatus(str, Enum):
    """Production stage only. Whether it is paid is derived from the ledger, not stored here."""

    DRAFT = "draft"
    CONFIRMED = "confirmed"
    CUTTING = "cutting"
    STITCHING = "stitching"
    FITTING = "fitting"
    ALTERATIONS = "alterations"
    READY = "ready"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class PaymentMethod(str, Enum):
    CASH = "cash"
    MPESA = "mpesa"
    CARD = "card"
    BANK = "bank"
    OTHER = "other"


class PaymentKind(str, Enum):
    PAYMENT = "payment"
    REFUND = "refund"


class Order(db.Model):
    __tablename__ = "orders"

    id = uuid_pk()
    shop_id = tenant_fk()
    number = db.Column(db.Integer, nullable=False)
    kind = enum_col(OrderKind, nullable=False, default=OrderKind.BESPOKE)
    status = enum_col(OrderStatus, nullable=False, default=OrderStatus.DRAFT)

    customer_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    # The exact fitting this job is cut from. Measurements are immutable, so this reference is the lock.
    measurement_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("measurements.id", ondelete="RESTRICT"), index=True)
    assigned_to_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("users.id", ondelete="RESTRICT"))
    created_by_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("users.id", ondelete="RESTRICT"))

    subtotal = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    discount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    total = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    tax_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)

    due_date = db.Column(db.Date)
    notes = db.Column(db.Text)
    cancel_reason = db.Column(db.String(300))
    stock_committed = db.Column(db.Boolean, nullable=False, default=False)
    created_offline = db.Column(db.Boolean, nullable=False, default=False)

    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
    completed_at = db.Column(db.DateTime(timezone=True))

    customer = db.relationship("Customer", lazy="joined")
    measurement = db.relationship("Measurement", lazy="joined")
    assigned_to = db.relationship("User", foreign_keys=[assigned_to_id], lazy="joined")
    created_by = db.relationship("User", foreign_keys=[created_by_id], lazy="joined")
    items = db.relationship("OrderItem", back_populates="order", order_by="OrderItem.position", lazy="selectin", cascade="all, delete-orphan")
    payments = db.relationship("Payment", back_populates="order", order_by="Payment.created_at", lazy="selectin")
    events = db.relationship("OrderStatusEvent", back_populates="order", order_by="OrderStatusEvent.created_at", lazy="select")

    __table_args__ = (
        db.UniqueConstraint("shop_id", "number", name="uq_orders_shop_number"),
        db.CheckConstraint("subtotal >= 0", name="ck_orders_subtotal"),
        db.CheckConstraint("discount >= 0 AND discount <= subtotal", name="ck_orders_discount"),
        db.CheckConstraint("total >= 0", name="ck_orders_total"),
        db.Index("ix_orders_shop_status", "shop_id", "status"),
        db.Index("ix_orders_shop_due", "shop_id", "due_date"),
    )

    @property
    def amount_paid(self) -> Decimal:
        # Always summed from the ledger, so a stored total can never drift from the actual payments.
        return sum((p.amount for p in self.payments), Decimal("0.00"))

    @property
    def balance(self) -> Decimal:
        if self.status == OrderStatus.CANCELLED:
            return Decimal("0.00")
        return self.total - self.amount_paid

    @property
    def payment_status(self) -> str:
        paid = self.amount_paid
        if paid <= 0:
            return "unpaid"
        return "paid" if paid >= self.total else "partial"

    def to_dict(self, include_events: bool = False) -> dict:
        data = {
            "id": str(self.id),
            "number": self.number,
            "kind": self.kind.value,
            "status": self.status.value,
            "customer": self.customer.to_dict() if self.customer else None,
            "measurement_id": str(self.measurement_id) if self.measurement_id else None,
            "measurement": self.measurement.to_dict() if self.measurement else None,
            "assigned_to": {"id": str(self.assigned_to.id), "name": self.assigned_to.name} if self.assigned_to else None,
            "created_by": self.created_by.name if self.created_by else None,
            "items": [i.to_dict() for i in self.items],
            "payments": [p.to_dict() for p in self.payments],
            "subtotal": money(self.subtotal),
            "discount": money(self.discount),
            "total": money(self.total),
            "tax_amount": money(self.tax_amount),
            "amount_paid": money(self.amount_paid),
            "balance": money(self.balance),
            "payment_status": self.payment_status,
            "due_date": iso(self.due_date),
            "notes": self.notes,
            "cancel_reason": self.cancel_reason,
            "created_offline": self.created_offline,
            "created_at": iso(self.created_at),
            "completed_at": iso(self.completed_at),
        }
        if include_events:
            data["events"] = [e.to_dict() for e in self.events]
        return data

    def to_job_card(self) -> dict:
        """What the workshop floor sees. No prices or payment details."""
        return {
            "id": str(self.id),
            "number": self.number,
            "status": self.status.value,
            "customer_name": self.customer.full_name if self.customer else "Walk-in",
            "assigned_to": {"id": str(self.assigned_to.id), "name": self.assigned_to.name} if self.assigned_to else None,
            "items": [{"description": i.description, "quantity": money(i.quantity), "notes": i.notes} for i in self.items],
            "measurement": self.measurement.to_dict() if self.measurement else None,
            "due_date": iso(self.due_date),
            "notes": self.notes,
        }


class OrderItem(db.Model):
    __tablename__ = "order_items"

    id = uuid_pk()
    shop_id = tenant_fk()
    order_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    inventory_item_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("inventory_items.id", ondelete="RESTRICT"), index=True)
    position = db.Column(db.Integer, nullable=False, default=0)
    # Name and price are copied so renaming or repricing an item never alters a past invoice.
    description = db.Column(db.String(200), nullable=False)
    unit = db.Column(db.String(10))
    quantity = db.Column(db.Numeric(12, 3), nullable=False)
    unit_price = db.Column(db.Numeric(12, 2), nullable=False)
    line_total = db.Column(db.Numeric(12, 2), nullable=False)
    notes = db.Column(db.Text)

    order = db.relationship("Order", back_populates="items")
    inventory_item = db.relationship("InventoryItem", lazy="joined")

    __table_args__ = (
        db.CheckConstraint("quantity > 0", name="ck_order_items_quantity"),
        db.CheckConstraint("unit_price >= 0", name="ck_order_items_price"),
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "inventory_item_id": str(self.inventory_item_id) if self.inventory_item_id else None,
            "description": self.description,
            "unit": self.unit,
            "quantity": money(self.quantity),
            "unit_price": money(self.unit_price),
            "line_total": money(self.line_total),
            "notes": self.notes,
        }


class Payment(db.Model):
    """Append-only ledger entry. One row per tender, so a split payment is simply several rows. Refunds are negative."""

    __tablename__ = "payments"

    id = uuid_pk()
    shop_id = tenant_fk()
    order_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True)
    kind = enum_col(PaymentKind, nullable=False, default=PaymentKind.PAYMENT)
    method = enum_col(PaymentMethod, nullable=False)
    amount = db.Column(db.Numeric(12, 2), nullable=False)
    tendered = db.Column(db.Numeric(12, 2))
    reference = db.Column(db.String(40), index=True)
    note = db.Column(db.String(300))
    received_by_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("users.id", ondelete="RESTRICT"))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)

    order = db.relationship("Order", back_populates="payments")
    received_by = db.relationship("User", lazy="joined")

    __table_args__ = (
        db.CheckConstraint(
            "(kind = 'payment' AND amount > 0) OR (kind = 'refund' AND amount < 0)",
            name="ck_payments_sign",
        ),
    )

    @property
    def change_given(self) -> Decimal | None:
        if self.tendered is None or self.tendered <= self.amount:
            return None
        return self.tendered - self.amount

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "order_id": str(self.order_id),
            "kind": self.kind.value,
            "method": self.method.value,
            "amount": money(self.amount),
            "tendered": money(self.tendered),
            "change": money(self.change_given),
            "reference": self.reference,
            "note": self.note,
            "received_by": self.received_by.name if self.received_by else None,
            "created_at": iso(self.created_at),
        }


class OrderStatusEvent(db.Model):
    __tablename__ = "order_status_events"

    id = uuid_pk()
    shop_id = tenant_fk()
    order_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True)
    from_status = enum_col(OrderStatus)
    to_status = enum_col(OrderStatus, nullable=False)
    note = db.Column(db.String(300))
    user_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("users.id", ondelete="RESTRICT"))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    order = db.relationship("Order", back_populates="events")
    user = db.relationship("User", lazy="joined")

    def to_dict(self) -> dict:
        return {
            "from_status": self.from_status.value if self.from_status else None,
            "to_status": self.to_status.value,
            "note": self.note,
            "user": self.user.name if self.user else None,
            "created_at": iso(self.created_at),
        }


make_append_only(Payment)
make_append_only(OrderStatusEvent)
