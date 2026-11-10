"""Thermal printing.

agent:   the server queues ESC/POS bytes and a small agent on a shop PC prints them (cloud deployments).
network: the server opens a TCP socket to the printer itself (only when self-hosted on the shop LAN).
A printer problem never affects the sale: the order is already committed before any print is attempted.
"""
import base64
import hashlib
import socket
from datetime import timedelta
from functools import wraps

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import select, update

from ..errors import APIError, not_found
from ..extensions import db
from ..models import Order, PrinterMode, PrintJob, PrintJobStatus, Shop
from ..models.base import utcnow
from ..models.customer import MEASUREMENT_FIELDS
from ..schemas import AgentAckIn, parse
from ..utils.auth import OWNER, STAFF, get_scoped, require_auth
from ..utils.escpos import build_job_card, build_receipt, build_test_page

bp = Blueprint("printing", __name__, url_prefix="/api/print")
agent_bp = Blueprint("print_agent", __name__, url_prefix="/api/print-agent")

QUEUED_JOB_LIFETIME = timedelta(hours=24)


def send_to_network_printer(shop: Shop, payload: bytes) -> None:
    timeout = current_app.config["PRINT_SOCKET_TIMEOUT"]
    with socket.create_connection((shop.printer_host, shop.printer_port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(payload)


def _dispatch(shop: Shop, payload: bytes, document: str, order_id=None):
    mode = shop.printer_mode
    if mode == PrinterMode.NONE:
        raise APIError(409, "printer_not_configured", "No thermal printer is set up. Use browser printing or set one up in Settings.")

    if mode == PrinterMode.AGENT:
        if not shop.agent_token_hash:
            raise APIError(409, "printer_not_configured", "The print agent isn't connected yet. Set it up in Settings.")
        job = PrintJob(shop_id=shop.id, order_id=order_id, document=document, payload=payload)
        db.session.add(job)
        db.session.commit()
        return jsonify({"status": "queued", "job": job.to_dict()}), 202

    if not current_app.config["ALLOW_DIRECT_PRINT"]:
        raise APIError(409, "direct_print_disabled", "Direct network printing is disabled on this server. Use the print agent.")
    if not shop.printer_host:
        raise APIError(409, "printer_not_configured", "Enter the printer's IP address in Settings.")
    try:
        send_to_network_printer(shop, payload)
    except OSError as err:
        current_app.logger.warning("printer %s unreachable: %s", shop.printer_host, err)
        raise APIError(502, "printer_unreachable", "Couldn't reach the printer. Check that it is on and connected. The sale is saved.") from None
    return jsonify({"status": "printed"}), 200


@bp.post("/orders/<uuid:order_id>/receipt")
@require_auth(*STAFF)
def print_receipt(order_id):
    order = get_scoped(Order, order_id, "Order")
    return _dispatch(g.shop, build_receipt(g.shop, order), "receipt", order.id)


@bp.post("/orders/<uuid:order_id>/job-card")
@require_auth()
def print_job_card(order_id):
    order = get_scoped(Order, order_id, "Order")
    labels = {f["key"]: f["label"] for f in MEASUREMENT_FIELDS}
    return _dispatch(g.shop, build_job_card(g.shop, order, labels), "job_card", order.id)


@bp.post("/test")
@require_auth(*OWNER)
def print_test():
    return _dispatch(g.shop, build_test_page(g.shop), "test")


@bp.get("/jobs")
@require_auth(*STAFF)
def recent_jobs():
    rows = db.session.scalars(
        select(PrintJob).where(PrintJob.shop_id == g.shop.id).order_by(PrintJob.created_at.desc()).limit(30)
    ).all()
    return jsonify({"items": [j.to_dict() for j in rows]})


def _require_agent(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = request.headers.get("X-Agent-Token", "")
        shop = None
        if token:
            digest = hashlib.sha256(token.encode()).hexdigest()
            shop = db.session.scalar(select(Shop).where(Shop.agent_token_hash == digest))
        if shop is None:
            raise APIError(401, "unauthorized", "Invalid print agent token.")
        g.shop = shop
        return fn(*args, **kwargs)

    return wrapper


def _expire_old_jobs(shop_id) -> None:
    now = utcnow()
    # A printer that has been off for days shouldn't suddenly print a stack of old receipts.
    db.session.execute(
        update(PrintJob)
        .where(PrintJob.shop_id == shop_id, PrintJob.status == PrintJobStatus.QUEUED, PrintJob.created_at < now - QUEUED_JOB_LIFETIME)
        .values(status=PrintJobStatus.FAILED, error="Expired before it could be printed")
        .execution_options(synchronize_session=False)
    )
    reclaim = now - timedelta(seconds=current_app.config["PRINT_JOB_RECLAIM_SECONDS"])
    db.session.execute(
        update(PrintJob)
        .where(
            PrintJob.shop_id == shop_id, PrintJob.status == PrintJobStatus.CLAIMED, PrintJob.claimed_at < reclaim,
            PrintJob.attempts >= current_app.config["PRINT_JOB_MAX_ATTEMPTS"],
        )
        .values(status=PrintJobStatus.FAILED, error="Agent didn't confirm printing")
        .execution_options(synchronize_session=False)
    )


@agent_bp.post("/jobs/claim")
@_require_agent
def claim_job():
    shop = g.shop
    now = utcnow()
    shop.agent_last_seen = now
    _expire_old_jobs(shop.id)
    reclaim = now - timedelta(seconds=current_app.config["PRINT_JOB_RECLAIM_SECONDS"])
    job = db.session.scalars(
        select(PrintJob)
        .where(
            PrintJob.shop_id == shop.id,
            (PrintJob.status == PrintJobStatus.QUEUED)
            | ((PrintJob.status == PrintJobStatus.CLAIMED) & (PrintJob.claimed_at < reclaim)),
        )
        .order_by(PrintJob.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    ).first()
    if job is None:
        db.session.commit()
        return "", 204
    job.status = PrintJobStatus.CLAIMED
    job.claimed_at = now
    job.attempts += 1
    db.session.commit()
    return jsonify({"id": str(job.id), "document": job.document, "payload_b64": base64.b64encode(job.payload).decode()})


@agent_bp.post("/jobs/<uuid:job_id>/ack")
@_require_agent
def ack_job(job_id):
    data = parse(AgentAckIn)
    job = db.session.get(PrintJob, job_id)
    if job is None or job.shop_id != g.shop.id:
        raise not_found("Print job")
    if data.ok:
        job.status = PrintJobStatus.DONE
        job.error = None
    elif job.attempts >= current_app.config["PRINT_JOB_MAX_ATTEMPTS"]:
        job.status = PrintJobStatus.FAILED
        job.error = data.error
    else:
        job.status = PrintJobStatus.QUEUED
        job.error = data.error
    db.session.commit()
    return jsonify(job.to_dict())
