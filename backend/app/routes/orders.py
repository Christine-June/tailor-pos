from datetime import datetime
from zoneinfo import ZoneInfo

from flask import Blueprint, g, jsonify, request
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError

from ..errors import APIError
from ..extensions import db
from ..models import Customer, Order, OrderKind, OrderStatus, Payment, UserRole
from ..schemas import AddItemsIn, CancelIn, OrderIn, OrderPatch, PaymentIn, RefundIn, TransitionIn, parse
from ..services import orders as service
from ..utils.auth import OWNER, STAFF, get_scoped, paging, require_auth

bp = Blueprint("orders", __name__, url_prefix="/api")

BOARD_STATUSES = [
    OrderStatus.CONFIRMED, OrderStatus.CUTTING, OrderStatus.STITCHING,
    OrderStatus.FITTING, OrderStatus.ALTERATIONS, OrderStatus.READY,
]


def _paid_subquery():
    return (
        select(func.coalesce(func.sum(Payment.amount), 0))
        .where(Payment.order_id == Order.id)
        .correlate(Order)
        .scalar_subquery()
    )


@bp.get("/orders")
@require_auth(*STAFF)
def list_orders():
    limit, offset = paging(default=50, maximum=200)
    query = select(Order).where(Order.shop_id == g.shop.id)
    if request.args.get("status"):
        try:
            statuses = [OrderStatus(s) for s in request.args["status"].split(",")]
        except ValueError:
            raise APIError(400, "invalid_status", "Unknown status filter") from None
        query = query.where(Order.status.in_(statuses))
    if request.args.get("kind"):
        try:
            query = query.where(Order.kind == OrderKind(request.args["kind"]))
        except ValueError:
            raise APIError(400, "invalid_kind", "Unknown kind filter") from None
    if request.args.get("outstanding") == "true":
        query = query.where(Order.status != OrderStatus.CANCELLED, Order.total > _paid_subquery())
    term = (request.args.get("q") or "").strip()
    if term:
        conditions = [
            func.concat(Customer.first_name, " ", Customer.last_name).icontains(term, autoescape=True),
            Customer.phone.contains("".join(c for c in term if c.isdigit()).lstrip("0") or term, autoescape=True),
        ]
        if term.lstrip("#").isdigit() and len(term) < 10:
            conditions.append(Order.number == int(term.lstrip("#")))
        query = query.outerjoin(Customer, Order.customer_id == Customer.id).where(or_(*conditions))
    total = db.session.scalar(select(func.count()).select_from(query.with_only_columns(Order.id).subquery()))
    rows = db.session.scalars(query.order_by(Order.created_at.desc()).limit(limit).offset(offset)).unique().all()
    return jsonify({"items": [o.to_dict() for o in rows], "total": total})


def _retry_safe(fn, model, record_id):
    """Two simultaneous retries of one id: the loser hits the primary key and gets the winner's result."""
    try:
        result = fn()
        db.session.commit()
        return result
    except IntegrityError:
        db.session.rollback()
        if record_id and db.session.get(model, record_id) is not None:
            return None
        raise


@bp.post("/orders")
@require_auth(*STAFF)
def create_order():
    data = parse(OrderIn)
    result = _retry_safe(lambda: service.create_order(g.shop, g.user, data), Order, data.id)
    if result is None:
        return jsonify(get_scoped(Order, data.id, "Order").to_dict()), 200
    order, created = result
    return jsonify(order.to_dict()), 201 if created else 200


@bp.get("/orders/<uuid:order_id>")
@require_auth(*STAFF)
def get_order(order_id):
    return jsonify(get_scoped(Order, order_id, "Order").to_dict(include_events=True))


@bp.patch("/orders/<uuid:order_id>")
@require_auth(*STAFF)
def update_order(order_id):
    order = service.update_order(g.shop, g.user, order_id, parse(OrderPatch))
    db.session.commit()
    return jsonify(order.to_dict(include_events=True))


@bp.post("/orders/<uuid:order_id>/items")
@require_auth(*STAFF)
def add_items(order_id):
    order = service.add_items(g.shop, g.user, order_id, parse(AddItemsIn))
    db.session.commit()
    return jsonify(order.to_dict(include_events=True))


@bp.post("/orders/<uuid:order_id>/payments")
@require_auth(*STAFF)
def add_payment(order_id):
    data = parse(PaymentIn)
    result = _retry_safe(lambda: service.add_payment(g.shop, g.user, order_id, data), Payment, data.id)
    if result is None:
        return jsonify(get_scoped(Order, order_id, "Order").to_dict(include_events=True)), 200
    order, _payment, created = result
    return jsonify(order.to_dict(include_events=True)), 201 if created else 200


@bp.post("/orders/<uuid:order_id>/refunds")
@require_auth(*OWNER)
def refund(order_id):
    data = parse(RefundIn)
    result = _retry_safe(lambda: service.refund(g.shop, g.user, order_id, data), Payment, data.id)
    if result is None:
        return jsonify(get_scoped(Order, order_id, "Order").to_dict(include_events=True)), 200
    order, _payment, created = result
    return jsonify(order.to_dict(include_events=True)), 201 if created else 200


@bp.post("/orders/<uuid:order_id>/transition")
@require_auth()
def transition(order_id):
    order = service.transition(g.shop, g.user, order_id, parse(TransitionIn))
    db.session.commit()
    if g.user.role == UserRole.TAILOR:
        return jsonify(order.to_job_card())
    return jsonify(order.to_dict(include_events=True))


@bp.post("/orders/<uuid:order_id>/cancel")
@require_auth(*STAFF)
def cancel(order_id):
    order = service.cancel(g.shop, g.user, order_id, parse(CancelIn))
    db.session.commit()
    return jsonify(order.to_dict(include_events=True))


@bp.get("/workshop/board")
@require_auth()
def board():
    rows = db.session.scalars(
        select(Order)
        .where(Order.shop_id == g.shop.id, Order.kind == OrderKind.BESPOKE, Order.status.in_(BOARD_STATUSES))
        .order_by(case((Order.due_date.is_(None), 1), else_=0), Order.due_date, Order.number)
        .limit(500)
    ).unique().all()
    today = datetime.now(ZoneInfo(g.shop.timezone)).date().isoformat()
    return jsonify({"items": [o.to_job_card() for o in rows], "today": today})
