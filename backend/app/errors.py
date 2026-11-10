"""One error shape for the whole API: {"error": {"code", "message", "details"}}."""
import logging

from flask import Flask, jsonify
from sqlalchemy.exc import IntegrityError
from werkzeug.exceptions import HTTPException

from .extensions import db

log = logging.getLogger(__name__)


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str, details=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def not_found(what: str = "Record") -> APIError:
    return APIError(404, "not_found", f"{what} not found")


def conflict(code: str, message: str, details=None) -> APIError:
    return APIError(409, code, message, details)


def _body(code, message, details=None):
    return jsonify({"error": {"code": code, "message": message, "details": details}})


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(APIError)
    def _api_error(err: APIError):
        db.session.rollback()
        return _body(err.code, err.message, err.details), err.status

    @app.errorhandler(IntegrityError)
    def _integrity(err: IntegrityError):
        db.session.rollback()
        log.warning("integrity error: %s", err.orig)
        return _body("conflict", "This change conflicts with existing data. Refresh and try again."), 409

    @app.errorhandler(HTTPException)
    def _http(err: HTTPException):
        db.session.rollback()
        return _body(err.name.lower().replace(" ", "_"), err.description), err.code

    @app.errorhandler(Exception)
    def _unhandled(err: Exception):
        db.session.rollback()
        log.exception("unhandled error")
        # Internal details stay in the log, never in a response.
        return _body("server_error", "Something went wrong on our side. Your data was not changed."), 500
