from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, or_, select

from ..errors import APIError, conflict, not_found
from ..extensions import db
from ..models import InventoryItem, MovementReason, StockMovement, UserRole
from ..models.shop import audit
from ..schemas import InventoryIn, InventoryPatch, StockAdjustIn, parse
from ..services.stock import apply_movement, lock_items
from ..utils.auth import OWNER, STAFF, get_scoped, paging, require_auth

bp = Blueprint("inventory", __name__, url_prefix="/api/inventory")


def _serialize(item: InventoryItem) -> dict:
    return item.to_dict(include_cost=g.user.role == UserRole.OWNER)


def _check_sku(sku: str | None, exclude_id=None) -> None:
    if not sku:
        return
    query = select(InventoryItem.id).where(InventoryItem.shop_id == g.shop.id, InventoryItem.sku == sku)
    if exclude_id:
        query = query.where(InventoryItem.id != exclude_id)
    if db.session.scalar(query.limit(1)):
        raise conflict("duplicate_sku", f"SKU {sku} is already in use.")


@bp.get("")
@require_auth(*STAFF)
def list_items():
    limit, offset = paging()
    query = select(InventoryItem).where(InventoryItem.shop_id == g.shop.id)
    if request.args.get("include_archived") != "true":
        query = query.where(InventoryItem.archived.is_(False))
    term = (request.args.get("q") or "").strip()
    if term:
        query = query.where(or_(InventoryItem.name.icontains(term, autoescape=True), InventoryItem.sku.icontains(term, autoescape=True)))
    if request.args.get("kind"):
        query = query.where(InventoryItem.kind == request.args["kind"])
    if request.args.get("low_stock") == "true":
        query = query.where(InventoryItem.track_stock.is_(True), InventoryItem.quantity_on_hand <= InventoryItem.reorder_level)
    total = db.session.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.session.scalars(query.order_by(InventoryItem.name).limit(limit).offset(offset)).all()
    return jsonify({"items": [_serialize(i) for i in rows], "total": total})


@bp.post("")
@require_auth(*OWNER)
def create_item():
    data = parse(InventoryIn)
    sku = data.sku or None
    _check_sku(sku)
    item = InventoryItem(
        shop_id=g.shop.id,
        sku=sku,
        name=data.name,
        kind=data.kind,
        category=data.category,
        unit=data.unit,
        sell_price=data.sell_price,
        cost_price=data.cost_price,
        track_stock=data.track_stock,
        quantity_on_hand=0,
        reorder_level=data.reorder_level,
    )
    if data.id:
        item.id = data.id
    db.session.add(item)
    db.session.flush()
    if data.opening_quantity and data.track_stock:
        apply_movement(item, data.opening_quantity, MovementReason.PURCHASE, user_id=g.user.id, note="Opening stock", allow_negative=True)
    db.session.commit()
    return jsonify(_serialize(item)), 201


@bp.patch("/<uuid:item_id>")
@require_auth(*OWNER)
def update_item(item_id):
    item = get_scoped(InventoryItem, item_id, "Item")
    data = parse(InventoryPatch)
    if "sku" in data.model_fields_set and (data.sku or None) != item.sku:
        _check_sku(data.sku or None, exclude_id=item.id)
        item.sku = data.sku or None
    changed = {}
    for name in ("name", "kind", "category", "unit", "sell_price", "cost_price", "track_stock", "reorder_level", "archived"):
        if name in data.model_fields_set and (getattr(data, name) is not None or name == "category"):
            old, new = getattr(item, name), getattr(data, name)
            if old != new:
                changed[name] = [str(old), str(new)]
                setattr(item, name, new)
    if changed:
        audit(g.shop.id, g.user.id, "inventory.updated", "inventory_item", item.id, **changed)
    db.session.commit()
    return jsonify(_serialize(item))


@bp.post("/<uuid:item_id>/adjust")
@require_auth(*STAFF)
def adjust_stock(item_id):
    data = parse(StockAdjustIn)
    if (data.delta is None) == (data.counted_quantity is None):
        raise APIError(422, "validation_error", "Provide either a change or a counted quantity.")
    item = lock_items(g.shop.id, [item_id]).get(item_id)
    if item is None:
        raise not_found("Item")
    if not item.track_stock:
        raise conflict("not_tracked", f"Stock isn't tracked for {item.name}.")
    if data.counted_quantity is not None and data.counted_quantity < 0:
        raise APIError(422, "validation_error", "Counted quantity can't be negative.")
    delta = data.delta if data.delta is not None else data.counted_quantity - item.quantity_on_hand
    if delta == 0:
        return jsonify(_serialize(item))
    movement = apply_movement(item, delta, data.reason, user_id=g.user.id, note=data.note)
    db.session.flush()
    audit(g.shop.id, g.user.id, "inventory.adjusted", "inventory_item", item.id, delta=str(delta), reason=data.reason.value, movement_id=str(movement.id))
    db.session.commit()
    return jsonify(_serialize(item))


@bp.get("/<uuid:item_id>/movements")
@require_auth(*STAFF)
def movements(item_id):
    get_scoped(InventoryItem, item_id, "Item")
    limit, offset = paging(default=100, maximum=500)
    rows = db.session.scalars(
        select(StockMovement)
        .where(StockMovement.shop_id == g.shop.id, StockMovement.item_id == item_id)
        .order_by(StockMovement.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return jsonify({"items": [m.to_dict() for m in rows]})
