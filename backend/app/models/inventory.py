"""Catalogue items with fractional stock (2.75 m of fabric) and a movement ledger."""
from enum import Enum

from ..extensions import db
from .base import enum_col, iso, make_append_only, money, tenant_fk, utcnow, uuid_pk


class ItemKind(str, Enum):
    FABRIC = "fabric"
    TRIM = "trim"
    RETAIL = "retail"
    SERVICE = "service"


class MovementReason(str, Enum):
    PURCHASE = "purchase"
    SALE = "sale"
    ORDER_CANCELLED = "order_cancelled"
    ADJUSTMENT = "adjustment"
    STOCK_COUNT = "stock_count"
    WASTE = "waste"
    RETURN = "return"


class InventoryItem(db.Model):
    __tablename__ = "inventory_items"

    id = uuid_pk()
    shop_id = tenant_fk()
    sku = db.Column(db.String(40))
    name = db.Column(db.String(120), nullable=False)
    kind = enum_col(ItemKind, nullable=False, default=ItemKind.RETAIL)
    category = db.Column(db.String(60))
    unit = db.Column(db.String(10), nullable=False, default="pcs")
    sell_price = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    cost_price = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    track_stock = db.Column(db.Boolean, nullable=False, default=True)
    # Can go negative only via a sale made offline. That is surfaced in reports rather than
    # refused, because the customer has already left with the goods.
    quantity_on_hand = db.Column(db.Numeric(12, 3), nullable=False, default=0)
    reorder_level = db.Column(db.Numeric(12, 3), nullable=False, default=0)
    archived = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        db.UniqueConstraint("shop_id", "sku", name="uq_inventory_shop_sku"),
        db.CheckConstraint("sell_price >= 0", name="ck_inventory_sell_price"),
        db.CheckConstraint("cost_price >= 0", name="ck_inventory_cost_price"),
    )

    @property
    def is_low(self) -> bool:
        return self.track_stock and self.quantity_on_hand <= self.reorder_level

    def to_dict(self, include_cost: bool = False) -> dict:
        data = {
            "id": str(self.id),
            "sku": self.sku,
            "name": self.name,
            "kind": self.kind.value,
            "category": self.category,
            "unit": self.unit,
            "sell_price": money(self.sell_price),
            "track_stock": self.track_stock,
            "quantity_on_hand": money(self.quantity_on_hand),
            "reorder_level": money(self.reorder_level),
            "is_low": self.is_low,
            "archived": self.archived,
        }
        if include_cost:
            data["cost_price"] = money(self.cost_price)
        return data


class StockMovement(db.Model):
    __tablename__ = "stock_movements"

    id = uuid_pk()
    shop_id = tenant_fk()
    item_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False, index=True)
    order_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    reason = enum_col(MovementReason, nullable=False)
    quantity_delta = db.Column(db.Numeric(12, 3), nullable=False)
    balance_after = db.Column(db.Numeric(12, 3), nullable=False)
    note = db.Column(db.String(300))
    user_id = db.Column(db.Uuid(as_uuid=True), db.ForeignKey("users.id", ondelete="RESTRICT"))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, index=True)

    user = db.relationship("User", lazy="joined")

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "item_id": str(self.item_id),
            "order_id": str(self.order_id) if self.order_id else None,
            "reason": self.reason.value,
            "quantity_delta": money(self.quantity_delta),
            "balance_after": money(self.balance_after),
            "note": self.note,
            "user": self.user.name if self.user else None,
            "created_at": iso(self.created_at),
        }


make_append_only(StockMovement)
