import hashlib
import secrets
from zoneinfo import available_timezones

from flask import Blueprint, g, jsonify
from sqlalchemy import select

from ..errors import APIError, conflict
from ..extensions import db
from ..models import PrinterMode, User, UserRole
from ..models.shop import audit
from ..schemas import ShopPatch, UserIn, UserPatch, parse
from ..utils.auth import OWNER, demo_locked, get_scoped, require_auth

bp = Blueprint("settings", __name__, url_prefix="/api")


@bp.patch("/settings/shop")
@require_auth(*OWNER)
def update_shop():
    data = parse(ShopPatch)
    if data.timezone and data.timezone not in available_timezones():
        raise APIError(422, "invalid_timezone", "Unknown timezone")
    required = {"name", "timezone", "vat_registered", "vat_rate", "min_deposit_pct", "measurement_unit", "printer_mode", "printer_port", "printer_width"}
    for name in data.model_fields_set:
        value = getattr(data, name)
        if name in required and value is None:
            continue
        setattr(g.shop, name, value)
    audit(g.shop.id, g.user.id, "shop.updated", "shop", g.shop.id, fields=sorted(data.model_fields_set))
    db.session.commit()
    return jsonify(g.shop.to_dict())


@bp.post("/settings/print-agent-token")
@require_auth(*OWNER)
@demo_locked
def new_agent_token():
    """Shown once. Only its hash is stored, and generating a new one disconnects the old agent."""
    token = secrets.token_urlsafe(32)
    g.shop.agent_token_hash = hashlib.sha256(token.encode()).hexdigest()
    g.shop.printer_mode = PrinterMode.AGENT
    audit(g.shop.id, g.user.id, "shop.agent_token_rotated", "shop", g.shop.id)
    db.session.commit()
    return jsonify({"token": token, "shop": g.shop.to_dict()})


@bp.get("/staff")
@require_auth()
def staff_names():
    """Names only, for assigning work. All roles need this."""
    rows = db.session.scalars(
        select(User).where(User.shop_id == g.shop.id, User.active.is_(True)).order_by(User.name)
    ).all()
    return jsonify({"items": [{"id": str(u.id), "name": u.name, "role": u.role.value} for u in rows]})


@bp.get("/users")
@require_auth(*OWNER)
def list_users():
    rows = db.session.scalars(select(User).where(User.shop_id == g.shop.id).order_by(User.name)).all()
    return jsonify({"items": [u.to_dict() for u in rows]})


@bp.post("/users")
@require_auth(*OWNER)
@demo_locked
def create_user():
    data = parse(UserIn)
    if not data.email:
        raise APIError(422, "validation_error", "Email is required.")
    if db.session.scalar(select(User.id).where(User.email == data.email)):
        raise conflict("email_taken", "That email is already registered.")
    user = User(shop_id=g.shop.id, name=data.name, email=data.email, role=data.role)
    user.set_password(data.password)
    db.session.add(user)
    db.session.flush()
    audit(g.shop.id, g.user.id, "user.created", "user", user.id, role=data.role.value)
    db.session.commit()
    return jsonify(user.to_dict()), 201


@bp.patch("/users/<uuid:user_id>")
@require_auth(*OWNER)
@demo_locked
def update_user(user_id):
    user = get_scoped(User, user_id, "User")
    data = parse(UserPatch)
    demoting = data.role is not None and data.role != UserRole.OWNER and user.role == UserRole.OWNER
    deactivating = data.active is False and user.role == UserRole.OWNER and user.active
    if demoting or deactivating:
        owners = db.session.scalars(
            select(User).where(User.shop_id == g.shop.id, User.role == UserRole.OWNER, User.active.is_(True))
        ).all()
        if len(owners) <= 1:
            raise conflict("last_owner", "A shop must keep at least one active owner.")
    if data.name is not None:
        user.name = data.name
    if data.role is not None:
        user.role = data.role
    if data.active is not None:
        if not data.active:
            user.token_version += 1
        user.active = data.active
    if data.password:
        user.set_password(data.password)
        user.token_version += 1
    audit(g.shop.id, g.user.id, "user.updated", "user", user.id, fields=sorted(f for f in data.model_fields_set if f != "password"))
    db.session.commit()
    return jsonify(user.to_dict())
