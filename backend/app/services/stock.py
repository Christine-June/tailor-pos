"""Stock changes. Every quantity change goes through here and writes a movement row."""
from decimal import Decimal

from sqlalchemy import select

from ..errors import conflict
from ..extensions import db
from ..models import InventoryItem, MovementReason, StockMovement


def lock_items(shop_id, item_ids) -> dict:
    """Locks rows in a stable order, so two checkouts of the same items can't deadlock."""
    ids = sorted(set(item_ids), key=str)
    if not ids:
        return {}
    rows = db.session.scalars(
        select(InventoryItem)
        .where(InventoryItem.shop_id == shop_id, InventoryItem.id.in_(ids))
        .order_by(InventoryItem.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    return {row.id: row for row in rows}


def apply_movement(
    item: InventoryItem,
    delta: Decimal,
    reason: MovementReason,
    user_id=None,
    order_id=None,
    note: str | None = None,
    allow_negative: bool = False,
) -> StockMovement:
    """The caller must already hold the row lock from lock_items."""
    new_balance = item.quantity_on_hand + delta
    if delta < 0 and new_balance < 0 and not allow_negative:
        raise conflict(
            "insufficient_stock",
            f"Only {item.quantity_on_hand.normalize():f} {item.unit} of {item.name} in stock.",
            {"item_id": str(item.id), "available": str(item.quantity_on_hand)},
        )
    item.quantity_on_hand = new_balance
    movement = StockMovement(
        shop_id=item.shop_id,
        item_id=item.id,
        order_id=order_id,
        reason=reason,
        quantity_delta=delta,
        balance_after=new_balance,
        note=note,
        user_id=user_id,
    )
    db.session.add(movement)
    return movement
