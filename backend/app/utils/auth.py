"""Authentication, role checks and tenant-scoped lookups."""
from functools import wraps
from uuid import UUID

from flask import g, request
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request

from ..errors import APIError, not_found
from ..extensions import db
from ..models import User, UserRole


def require_auth(*roles: UserRole, refresh: bool = False):
    """Loads the user on every request, so deactivating staff takes effect at once."""

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request(refresh=refresh)
            try:
                user = db.session.get(User, UUID(get_jwt_identity()))
            except (ValueError, TypeError):
                user = None
            if user is None or not user.active or get_jwt().get("tv") != user.token_version:
                raise APIError(401, "unauthorized", "Please sign in again.")
            if roles and user.role not in roles:
                raise APIError(403, "forbidden", "Your role doesn't allow this action.")
            g.user = user
            g.shop = user.shop
            return fn(*args, **kwargs)

        return wrapper

    return decorator


STAFF = (UserRole.OWNER, UserRole.CASHIER)
OWNER = (UserRole.OWNER,)


def get_scoped(model, record_id, what: str = "Record"):
    """The only way routes fetch by id: a record from another shop looks exactly like a missing one."""
    record = db.session.get(model, record_id)
    if record is None or record.shop_id != g.shop.id:
        raise not_found(what)
    return record


def paging(default: int = 50, maximum: int = 2000) -> tuple[int, int]:
    try:
        limit = int(request.args.get("limit", default))
        offset = int(request.args.get("offset", 0))
    except ValueError:
        raise APIError(400, "invalid_paging", "limit and offset must be numbers") from None
    return max(1, min(limit, maximum)), max(0, offset)
