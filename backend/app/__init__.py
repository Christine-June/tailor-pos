"""Application factory."""
import logging

from flask import Flask, jsonify
from flask_jwt_extended.exceptions import JWTExtendedException
from jwt.exceptions import PyJWTError
from sqlalchemy import text
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import Config
from .errors import register_error_handlers
from .extensions import cors, db, jwt, limiter, migrate
from .monitoring import init_monitoring


def create_app(overrides: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    if overrides:
        app.config.update(overrides)
    Config.validate(app.config)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    init_monitoring(app)
    if app.config["APP_ENV"] == "production" and app.config["RATELIMIT_STORAGE_URI"].startswith("memory"):
        logging.getLogger(__name__).warning(
            "Login rate limits are per worker (memory://). Set RATELIMIT_STORAGE_URI=redis://... so they're shared."
        )

    if app.config["TRUSTED_PROXIES"]:
        hops = app.config["TRUSTED_PROXIES"]
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops, x_host=hops)

    db.init_app(app)
    from . import models  # noqa: F401  (registers tables on the metadata for Alembic)

    migrate.init_app(app, db, compare_type=True)
    jwt.init_app(app)
    limiter.init_app(app)
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        allow_headers=["Authorization", "Content-Type"],
        methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    )

    register_error_handlers(app)
    _register_jwt_errors(app)

    from .routes import register_blueprints

    register_blueprints(app)

    from .cli import register_cli

    register_cli(app)

    @app.get("/api/health")
    def health():
        try:
            db.session.execute(text("SELECT 1"))
        except Exception:
            db.session.rollback()
            return jsonify({"status": "degraded", "database": "unreachable"}), 503
        return jsonify({"status": "ok", "database": "ok"})

    return app


def _register_jwt_errors(app: Flask) -> None:
    def unauthorized(message="Please sign in again."):
        return jsonify({"error": {"code": "unauthorized", "message": message, "details": None}}), 401

    jwt.unauthorized_loader(lambda _reason: unauthorized("Sign in required."))
    jwt.invalid_token_loader(lambda _reason: unauthorized())
    jwt.expired_token_loader(
        lambda _h, _p: (jsonify({"error": {"code": "token_expired", "message": "Session expired.", "details": None}}), 401)
    )
    jwt.revoked_token_loader(lambda _h, _p: unauthorized())

    # Token problems must not fall through to the generic 500 handler.
    app.register_error_handler(JWTExtendedException, lambda _e: unauthorized())
    app.register_error_handler(PyJWTError, lambda _e: unauthorized())
