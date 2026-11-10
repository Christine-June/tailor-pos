from decimal import Decimal

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, or_, select

from ..errors import conflict
from ..extensions import db
from ..models import Customer, Measurement, Order
from ..models.base import utcnow
from ..models.customer import MEASUREMENT_FIELDS
from ..models.shop import audit
from ..schemas import CustomerIn, CustomerPatch, MeasurementIn, parse
from ..utils.auth import STAFF, get_scoped, paging, require_auth

bp = Blueprint("customers", __name__, url_prefix="/api")


def _check_duplicate_phone(phone: str | None, allow: bool, exclude_id=None) -> None:
    if not phone or allow:
        return
    query = select(Customer).where(Customer.shop_id == g.shop.id, Customer.phone == phone, Customer.archived_at.is_(None))
    if exclude_id:
        query = query.where(Customer.id != exclude_id)
    existing = db.session.scalars(query.limit(1)).first()
    if existing:
        raise conflict(
            "duplicate_phone",
            f"{existing.full_name} already uses this number.",
            {"existing": existing.to_dict()},
        )


@bp.get("/customers")
@require_auth()
def list_customers():
    limit, offset = paging()
    query = select(Customer).where(Customer.shop_id == g.shop.id, Customer.archived_at.is_(None))
    term = (request.args.get("q") or "").strip()
    if term:
        digits = "".join(c for c in term if c.isdigit()).lstrip("0")
        conditions = [
            func.concat(Customer.first_name, " ", Customer.last_name).icontains(term, autoescape=True),
            Customer.email.icontains(term, autoescape=True),
        ]
        if digits:
            conditions.append(Customer.phone.contains(digits, autoescape=True))
        query = query.where(or_(*conditions))
    total = db.session.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.session.scalars(query.order_by(Customer.first_name, Customer.last_name).limit(limit).offset(offset)).all()
    return jsonify({"items": [c.to_dict() for c in rows], "total": total})


@bp.post("/customers")
@require_auth()
def create_customer():
    data = parse(CustomerIn)
    if data.id:
        existing = db.session.get(Customer, data.id)
        if existing is not None:
            if existing.shop_id != g.shop.id:
                raise conflict("id_conflict", "Customer id already in use.")
            return jsonify(existing.to_dict()), 200
    _check_duplicate_phone(data.phone, data.allow_duplicate_phone)
    customer = Customer(
        shop_id=g.shop.id,
        first_name=data.first_name,
        last_name=data.last_name,
        phone=data.phone,
        email=data.email,
        notes=data.notes,
    )
    if data.id:
        customer.id = data.id
    db.session.add(customer)
    db.session.commit()
    return jsonify(customer.to_dict()), 201


@bp.get("/customers/<uuid:customer_id>")
@require_auth()
def get_customer(customer_id):
    customer = get_scoped(Customer, customer_id, "Customer")
    return jsonify(customer.to_dict())


@bp.patch("/customers/<uuid:customer_id>")
@require_auth(*STAFF)
def update_customer(customer_id):
    customer = get_scoped(Customer, customer_id, "Customer")
    data = parse(CustomerPatch)
    fields = data.model_fields_set
    if "phone" in fields and data.phone != customer.phone:
        _check_duplicate_phone(data.phone, data.allow_duplicate_phone, exclude_id=customer.id)
        customer.phone = data.phone
    for name in ("email", "notes"):
        if name in fields:
            setattr(customer, name, getattr(data, name))
    for name in ("first_name", "last_name"):
        if name in fields and getattr(data, name) is not None:
            setattr(customer, name, getattr(data, name))
    if "archived" in fields and data.archived is not None:
        customer.archived_at = utcnow() if data.archived else None
    db.session.commit()
    return jsonify(customer.to_dict())


@bp.get("/customers/<uuid:customer_id>/orders")
@require_auth(*STAFF)
def customer_orders(customer_id):
    get_scoped(Customer, customer_id, "Customer")
    rows = db.session.scalars(
        select(Order).where(Order.shop_id == g.shop.id, Order.customer_id == customer_id).order_by(Order.created_at.desc()).limit(200)
    ).unique().all()
    return jsonify({"items": [o.to_dict() for o in rows]})


@bp.get("/measurement-fields")
@require_auth()
def measurement_fields():
    return jsonify({"items": MEASUREMENT_FIELDS})


@bp.get("/customers/<uuid:customer_id>/measurements")
@require_auth()
def list_measurements(customer_id):
    get_scoped(Customer, customer_id, "Customer")
    rows = db.session.scalars(
        select(Measurement)
        .where(Measurement.shop_id == g.shop.id, Measurement.customer_id == customer_id)
        .order_by(Measurement.recorded_at.desc())
    ).all()
    links = db.session.execute(
        select(Order.measurement_id, Order.id, Order.number, Order.status).where(
            Order.shop_id == g.shop.id, Order.customer_id == customer_id, Order.measurement_id.is_not(None)
        )
    ).all()
    by_measurement: dict = {}
    for measurement_id, order_id, number, status in links:
        by_measurement.setdefault(measurement_id, []).append({"id": str(order_id), "number": number, "status": status.value})
    return jsonify({"items": [{**m.to_dict(), "orders": by_measurement.get(m.id, [])} for m in rows]})


@bp.post("/customers/<uuid:customer_id>/measurements")
@require_auth()
def create_measurement(customer_id):
    get_scoped(Customer, customer_id, "Customer")
    data = parse(MeasurementIn)
    if data.id:
        existing = db.session.get(Measurement, data.id)
        if existing is not None:
            if existing.shop_id != g.shop.id or existing.customer_id != customer_id:
                raise conflict("id_conflict", "Measurement id already in use.")
            return jsonify({**existing.to_dict(), "orders": []}), 200
    measurement = Measurement(
        shop_id=g.shop.id,
        customer_id=customer_id,
        unit=data.unit,
        values={k: str(v.quantize(Decimal("0.01"))) for k, v in data.values.items()},
        label=data.label,
        notes=data.notes,
        taken_by_id=g.user.id,
    )
    if data.id:
        measurement.id = data.id
    db.session.add(measurement)
    db.session.flush()
    audit(g.shop.id, g.user.id, "measurement.recorded", "customer", customer_id, measurement_id=str(measurement.id))
    db.session.commit()
    return jsonify({**measurement.to_dict(), "orders": []}), 201
