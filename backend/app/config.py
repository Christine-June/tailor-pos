"""Environment-driven configuration. Production refuses to boot with weak or missing secrets."""
import os
from datetime import timedelta


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "postgresql+psycopg://tailor:tailor@localhost:5432/tailor_pos")
    # Hosting providers commonly hand out the postgres:// or postgresql:// forms.
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class Config:
    APP_ENV = os.environ.get("APP_ENV", "development")

    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-secret-key-not-for-production-use")
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-only-jwt-secret-not-for-production-use")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=int(os.environ.get("JWT_ACCESS_MINUTES", "60")))
    # Long enough that a shop can sit through a multi-week connectivity problem without losing its outbox.
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=int(os.environ.get("JWT_REFRESH_DAYS", "30")))
    # Tolerates small server clock corrections (seen with Docker Desktop and cloud VMs). Without it a
    # token issued a moment before the clock steps back is briefly "not yet valid" and staff get a 401.
    JWT_DECODE_LEEWAY = 10

    SQLALCHEMY_DATABASE_URI = _database_url()
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True, "pool_recycle": 1800}
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

    RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")
    RATELIMIT_ENABLED = os.environ.get("RATELIMIT_ENABLED", "true").lower() == "true"
    LOGIN_RATE_LIMIT = os.environ.get("LOGIN_RATE_LIMIT", "10 per minute")

    # Number of reverse proxies in front of the app, so rate limits see the real client IP.
    TRUSTED_PROXIES = int(os.environ.get("TRUSTED_PROXIES", "0"))

    # Direct TCP printing makes the API server open sockets to a host a tenant typed in.
    # Only safe when self-hosted on the shop's own LAN, so it is off unless explicitly enabled.
    ALLOW_DIRECT_PRINT = os.environ.get("ALLOW_DIRECT_PRINT", "false").lower() == "true"
    PRINT_SOCKET_TIMEOUT = float(os.environ.get("PRINT_SOCKET_TIMEOUT", "5"))
    PRINT_JOB_RECLAIM_SECONDS = int(os.environ.get("PRINT_JOB_RECLAIM_SECONDS", "90"))
    PRINT_JOB_MAX_ATTEMPTS = int(os.environ.get("PRINT_JOB_MAX_ATTEMPTS", "5"))

    MAX_CONTENT_LENGTH = 2 * 1024 * 1024

    # A public demo for prospects: the sign-in page offers the demo accounts, and anything that
    # would lock the next visitor out (passwords, staff accounts, printer keys) is switched off.
    DEMO_MODE = os.environ.get("DEMO_MODE", "false").lower() == "true"

    # Error monitoring. Empty means off. Never sends request bodies or user details (see monitoring.py).
    SENTRY_DSN = os.environ.get("SENTRY_DSN", "")
    SENTRY_TRACES_SAMPLE_RATE = float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0"))
    RELEASE = os.environ.get("RELEASE", "dev")

    @classmethod
    def validate(cls, cfg) -> None:
        if cfg.get("APP_ENV") != "production":
            return
        for key in ("SECRET_KEY", "JWT_SECRET_KEY"):
            value = cfg.get(key) or ""
            if value.startswith("dev-only") or len(value) < 32:
                raise RuntimeError(f"{key} must be set to a random value of at least 32 characters in production")
