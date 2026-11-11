"""Error monitoring with Sentry, off unless SENTRY_DSN is set.

Customer names, phone numbers and measurements are personal data under Kenya's Data Protection
Act, so nothing personal leaves the server: no request bodies, no cookies or auth headers, no
user emails or IPs. Errors carry the shop id and user id (opaque UUIDs) for tracing only.
"""
import logging

from flask import Blueprint, Flask, g, jsonify, request

from .extensions import limiter

log = logging.getLogger("tailorpos.client")

SENSITIVE_HEADERS = {"authorization", "cookie", "x-agent-token"}


def _scrub(event, _hint):
    req = event.get("request") or {}
    req.pop("data", None)
    req.pop("cookies", None)
    req.pop("query_string", None)
    headers = req.get("headers") or {}
    for key in list(headers):
        if key.lower() in SENSITIVE_HEADERS:
            headers[key] = "[removed]"
    event.pop("user", None)
    return event


def init_monitoring(app: Flask) -> None:
    dsn = app.config.get("SENTRY_DSN")
    if not dsn:
        return
    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=app.config["APP_ENV"],
        release=app.config.get("RELEASE"),
        traces_sample_rate=app.config.get("SENTRY_TRACES_SAMPLE_RATE", 0.0),
        send_default_pii=False,
        max_request_body_size="never",
        before_send=_scrub,
    )

    # Set after require_auth has run; opaque tags only, never names or emails.
    @app.after_request
    def _tag_scope(response):
        shop = getattr(g, "shop", None)
        user = getattr(g, "user", None)
        if shop is not None:
            sentry_sdk.set_tag("shop_id", str(shop.id))
        if user is not None:
            sentry_sdk.set_tag("role", user.role.value)
        return response


bp = Blueprint("client_errors", __name__, url_prefix="/api")


@bp.post("/client-errors")
@limiter.limit("30 per minute")
def client_error():
    """Browser errors (a crashed screen) land in the server log and in Sentry, without personal data.
    No sign-in needed (a crash can happen on the login page), so it is rate-limited and size-capped."""
    body = request.get_json(silent=True) or {}
    message = str(body.get("message", ""))[:500]
    stack = str(body.get("stack", ""))[:4000]
    path = str(body.get("path", ""))[:200]
    release = str(body.get("release", ""))[:40]
    if not message:
        return jsonify({"ok": False}), 400
    log.warning("client error on %s (%s): %s", path, release, message)
    try:
        import sentry_sdk

        if sentry_sdk.get_client().is_active():
            with sentry_sdk.new_scope() as scope:
                scope.set_tag("source", "browser")
                scope.set_tag("path", path)
                scope.set_extra("stack", stack)
                scope.set_extra("browser_release", release)
                sentry_sdk.capture_message(f"Browser: {message}", level="error")
    except ImportError:
        pass
    return jsonify({"ok": True}), 202
