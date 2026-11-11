from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, select

from ..errors import APIError
from ..extensions import db
from ..models import Customer, InventoryItem, Order, OrderItem, OrderKind, OrderStatus, Payment, PaymentKind, User
from ..models.base import money
from ..utils.auth import STAFF, require_auth

bp = Blueprint("reports", __name__, url_prefix="/api/reports")

CLOSED = (OrderStatus.COMPLETED, OrderStatus.CANCELLED)


def _day_range(shop, day: date) -> tuple[datetime, datetime]:
    # "Today" means the shop's day in Nairobi, not the server's UTC day.
    tz = ZoneInfo(shop.timezone)
    start = datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    return start, end


@bp.get("/daily")
@require_auth(*STAFF)
def daily():
    shop = g.shop
    today = datetime.now(ZoneInfo(shop.timezone)).date()
    raw = request.args.get("date")
    try:
        day = date.fromisoformat(raw) if raw else today
    except ValueError:
        raise APIError(400, "invalid_date", "Use YYYY-MM-DD") from None
    start, end = _day_range(shop, day)

    rows = db.session.execute(
        select(Payment.method, Payment.kind, func.sum(Payment.amount), func.count())
        .where(Payment.shop_id == shop.id, Payment.created_at >= start, Payment.created_at < end)
        .group_by(Payment.method, Payment.kind)
    ).all()
    methods: dict[str, dict] = {}
    received = refunded = Decimal("0.00")
    for method, kind, amount, count in rows:
        entry = methods.setdefault(method.value, {"method": method.value, "received": Decimal("0.00"), "refunded": Decimal("0.00"), "count": 0})
        entry["count"] += count
        if kind == PaymentKind.PAYMENT:
            entry["received"] += amount
            received += amount
        else:
            entry["refunded"] += -amount
            refunded += -amount

    # Each tender, so the cashier can tick M-Pesa codes off against the M-Pesa statement.
    payments = db.session.execute(
        select(Payment, Order.number)
        .join(Order, Order.id == Payment.order_id)
        .where(Payment.shop_id == shop.id, Payment.created_at >= start, Payment.created_at < end)
        .order_by(Payment.created_at)
        .limit(1000)
    ).all()

    orders_created, sales_value = db.session.execute(
        select(func.count(), func.coalesce(func.sum(Order.total), 0)).where(
            Order.shop_id == shop.id, Order.created_at >= start, Order.created_at < end,
            Order.status.not_in((OrderStatus.CANCELLED, OrderStatus.DRAFT)),
        )
    ).one()

    return jsonify({
        "date": day.isoformat(),
        "by_method": [
            {**m, "received": money(m["received"]), "refunded": money(m["refunded"]), "net": money(m["received"] - m["refunded"])}
            for m in sorted(methods.values(), key=lambda m: m["method"])
        ],
        "total_received": money(received),
        "total_refunded": money(refunded),
        "net_takings": money(received - refunded),
        "orders_created": orders_created,
        "sales_value": money(sales_value),
        "payments": [{**p.to_dict(), "order_number": number} for p, number in payments],
    })


@bp.get("/dashboard")
@require_auth(*STAFF)
def dashboard():
    """Everything the home dashboard shows, for the last 7 shop-local days against the 7 before."""
    shop = g.shop
    days = 7
    today = datetime.now(ZoneInfo(shop.timezone)).date()
    first = today - timedelta(days=days - 1)
    prev_first = first - timedelta(days=days)
    start, _ = _day_range(shop, first)
    prev_start, _ = _day_range(shop, prev_first)
    _, end = _day_range(shop, today)

    pay_day = func.date(func.timezone(shop.timezone, Payment.created_at))
    takings = dict(db.session.execute(
        select(pay_day, func.sum(Payment.amount))
        .where(Payment.shop_id == shop.id, Payment.created_at >= prev_start, Payment.created_at < end)
        .group_by(pay_day)
    ).all())
    live = Order.status.not_in((OrderStatus.CANCELLED, OrderStatus.DRAFT))
    order_day = func.date(func.timezone(shop.timezone, Order.created_at))
    order_rows = db.session.execute(
        select(order_day, func.count(), func.coalesce(func.sum(Order.total), 0))
        .where(Order.shop_id == shop.id, live, Order.created_at >= prev_start, Order.created_at < end)
        .group_by(order_day)
    ).all()
    orders = {d: (n, total) for d, n, total in order_rows}

    def window(begin: date) -> list[date]:
        return [begin + timedelta(days=i) for i in range(days)]

    def totals(begin: date) -> dict:
        span = window(begin)
        return {
            "takings": money(sum((takings.get(d, Decimal("0")) for d in span), Decimal("0.00"))),
            "orders": sum(orders.get(d, (0, 0))[0] for d in span),
            "sales_value": money(sum((Decimal(orders.get(d, (0, 0))[1]) for d in span), Decimal("0.00"))),
        }

    methods = db.session.execute(
        select(Payment.method, func.sum(Payment.amount), func.count())
        .where(Payment.shop_id == shop.id, Payment.created_at >= start, Payment.created_at < end)
        .group_by(Payment.method)
    ).all()
    top = db.session.execute(
        select(OrderItem.description, func.sum(OrderItem.quantity), func.sum(OrderItem.line_total), func.max(OrderItem.unit))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.shop_id == shop.id, live, Order.created_at >= start, Order.created_at < end)
        .group_by(OrderItem.description)
        .order_by(func.sum(OrderItem.line_total).desc())
        .limit(5)
    ).all()
    recent = db.session.execute(
        select(Payment, Order.number, Customer.first_name, Customer.last_name)
        .join(Order, Order.id == Payment.order_id)
        .outerjoin(Customer, Customer.id == Order.customer_id)
        .where(Payment.shop_id == shop.id)
        .order_by(Payment.created_at.desc())
        .limit(6)
    ).all()
    staff = dict(db.session.execute(
        select(User.role, func.count()).where(User.shop_id == shop.id, User.active.is_(True)).group_by(User.role)
    ).all())
    items_count, low_count = db.session.execute(
        select(
            func.count(),
            func.count().filter(InventoryItem.track_stock.is_(True), InventoryItem.quantity_on_hand <= InventoryItem.reorder_level),
        ).where(InventoryItem.shop_id == shop.id, InventoryItem.archived.is_(False))
    ).one()
    customers_total, customers_new = db.session.execute(
        select(func.count(), func.count().filter(Customer.created_at >= start)).where(Customer.shop_id == shop.id, Customer.archived_at.is_(None))
    ).one()
    workshop = dict(db.session.execute(
        select(Order.status, func.count())
        .where(Order.shop_id == shop.id, Order.kind == OrderKind.BESPOKE,
               Order.status.in_((OrderStatus.CONFIRMED, OrderStatus.CUTTING, OrderStatus.STITCHING, OrderStatus.FITTING, OrderStatus.ALTERATIONS, OrderStatus.READY)))
        .group_by(Order.status)
    ).all())
    overdue = db.session.scalar(
        select(func.count()).where(
            Order.shop_id == shop.id, Order.kind == OrderKind.BESPOKE, Order.due_date < today,
            Order.status.in_((OrderStatus.CONFIRMED, OrderStatus.CUTTING, OrderStatus.STITCHING, OrderStatus.FITTING, OrderStatus.ALTERATIONS)),
        )
    )

    return jsonify({
        "today": today.isoformat(),
        "this_period": totals(first),
        "previous_period": totals(prev_first),
        "daily": [
            {"date": d.isoformat(), "takings": money(takings.get(d, Decimal("0.00"))), "orders": orders.get(d, (0, 0))[0]}
            for d in window(first)
        ],
        "by_method": [{"method": m.value, "amount": money(a), "count": n} for m, a, n in sorted(methods, key=lambda r: -r[1])],
        "top_products": [{"name": name, "quantity": money(q), "unit": unit, "revenue": money(r)} for name, q, r, unit in top],
        "recent_payments": [
            {**p.to_dict(), "order_number": number, "customer_name": f"{first_name} {last_name or ''}".strip() if first_name else "Walk-in"}
            for p, number, first_name, last_name in recent
        ],
        "staff": {role.value: count for role, count in staff.items()},
        "products": {"active": items_count, "low": low_count},
        "customers": {"total": customers_total, "new": customers_new},
        "workshop": {status.value: count for status, count in workshop.items()},
        "overdue": overdue,
    })


@bp.get("/trend")
@require_auth(*STAFF)
def trend():
    """Net takings per shop-local day for the last N days (default 7), oldest first, including empty days."""
    shop = g.shop
    try:
        days = max(1, min(int(request.args.get("days", 7)), 90))
    except ValueError:
        raise APIError(400, "invalid_days", "days must be a number") from None
    today = datetime.now(ZoneInfo(shop.timezone)).date()
    first = today - timedelta(days=days - 1)
    start, _ = _day_range(shop, first)
    _, end = _day_range(shop, today)
    local_day = func.date(func.timezone(shop.timezone, Payment.created_at))
    rows = db.session.execute(
        select(local_day, func.sum(Payment.amount))
        .where(Payment.shop_id == shop.id, Payment.created_at >= start, Payment.created_at < end)
        .group_by(local_day)
    ).all()
    totals = {day: amount for day, amount in rows}
    return jsonify({
        "days": [
            {"date": (first + timedelta(days=i)).isoformat(), "net_takings": money(totals.get(first + timedelta(days=i), Decimal("0.00")))}
            for i in range(days)
        ],
    })


@bp.get("/overview")
@require_auth(*STAFF)
def overview():
    shop = g.shop
    today = datetime.now(ZoneInfo(shop.timezone)).date()
    paid = (
        select(Payment.order_id, func.sum(Payment.amount).label("paid"))
        .where(Payment.shop_id == shop.id)
        .group_by(Payment.order_id)
        .subquery()
    )
    outstanding_expr = Order.total - func.coalesce(paid.c.paid, 0)
    outstanding_count, outstanding_total = db.session.execute(
        select(func.count(), func.coalesce(func.sum(outstanding_expr), 0))
        .select_from(Order)
        .outerjoin(paid, paid.c.order_id == Order.id)
        .where(
            Order.shop_id == shop.id,
            Order.status.not_in((OrderStatus.CANCELLED, OrderStatus.DRAFT)),
            outstanding_expr > 0,
        )
    ).one()

    active = (Order.shop_id == shop.id, Order.kind == OrderKind.BESPOKE, Order.status.not_in((*CLOSED, OrderStatus.DRAFT)))
    overdue = db.session.scalars(
        select(Order).where(*active, Order.status != OrderStatus.READY, Order.due_date < today).order_by(Order.due_date).limit(50)
    ).unique().all()
    due_soon = db.session.scalars(
        select(Order)
        .where(*active, Order.status != OrderStatus.READY, Order.due_date >= today, Order.due_date <= today + timedelta(days=3))
        .order_by(Order.due_date)
        .limit(50)
    ).unique().all()
    awaiting_collection = db.session.scalars(
        select(Order).where(Order.shop_id == shop.id, Order.status == OrderStatus.READY).order_by(Order.due_date).limit(50)
    ).unique().all()
    low_stock = db.session.scalars(
        select(InventoryItem)
        .where(
            InventoryItem.shop_id == shop.id, InventoryItem.archived.is_(False), InventoryItem.track_stock.is_(True),
            InventoryItem.quantity_on_hand <= InventoryItem.reorder_level,
        )
        .order_by(InventoryItem.quantity_on_hand)
        .limit(50)
    ).all()

    def brief(order: Order) -> dict:
        return {
            "id": str(order.id),
            "number": order.number,
            "status": order.status.value,
            "customer_name": order.customer.full_name if order.customer else "Walk-in",
            "customer_phone": order.customer.phone if order.customer else None,
            "due_date": order.due_date.isoformat() if order.due_date else None,
            "balance": money(order.balance),
        }

    return jsonify({
        "today": today.isoformat(),
        "outstanding_count": outstanding_count,
        "outstanding_total": money(outstanding_total),
        "overdue": [brief(o) for o in overdue],
        "due_soon": [brief(o) for o in due_soon],
        "awaiting_collection": [brief(o) for o in awaiting_collection],
        "low_stock": [i.to_dict() for i in low_stock],
    })
