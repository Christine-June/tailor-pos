from flask import Blueprint, current_app, g, jsonify
from flask_jwt_extended import create_access_token, create_refresh_token
from sqlalchemy import select
from werkzeug.security import check_password_hash, generate_password_hash

from ..errors import APIError
from ..extensions import db, limiter
from ..models import User
from ..models.shop import audit
from ..schemas import ChangePasswordIn, LoginIn, parse
from ..utils.auth import require_auth

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

# Compared against when the email is unknown, so response time doesn't reveal which emails exist.
_DUMMY_HASH = generate_password_hash("not-a-real-password")


def _tokens(user: User) -> dict:
    claims = {"tv": user.token_version}
    return {
        "access_token": create_access_token(identity=str(user.id), additional_claims=claims),
        "refresh_token": create_refresh_token(identity=str(user.id), additional_claims=claims),
    }


def _session(user: User) -> dict:
    return {"user": user.to_dict(), "shop": user.shop.to_dict()}


@bp.post("/login")
@limiter.limit(lambda: current_app.config["LOGIN_RATE_LIMIT"])
def login():
    data = parse(LoginIn)
    user = db.session.scalar(select(User).where(User.email == data.email.lower()))
    if user is None:
        check_password_hash(_DUMMY_HASH, data.password)
        raise APIError(401, "invalid_credentials", "Wrong email or password.")
    if not user.check_password(data.password) or not user.active:
        raise APIError(401, "invalid_credentials", "Wrong email or password.")
    return jsonify({**_tokens(user), **_session(user)})


@bp.post("/refresh")
@require_auth(refresh=True)
def refresh():
    return jsonify({"access_token": create_access_token(identity=str(g.user.id), additional_claims={"tv": g.user.token_version})})


@bp.get("/me")
@require_auth()
def me():
    return jsonify(_session(g.user))


@bp.post("/change-password")
@require_auth()
def change_password():
    data = parse(ChangePasswordIn)
    if not g.user.check_password(data.current_password):
        raise APIError(422, "invalid_credentials", "Current password is wrong.")
    g.user.set_password(data.new_password)
    g.user.token_version += 1  # signs out every other device
    audit(g.shop.id, g.user.id, "user.password_changed", "user", g.user.id)
    db.session.commit()
    return jsonify(_tokens(g.user))
