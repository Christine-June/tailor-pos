import base64
import socket
import threading
from datetime import timedelta
from types import SimpleNamespace

from app.extensions import db
from app.models import PrintJob
from app.models.base import utcnow
from app.utils.escpos import Ticket, build_job_card, build_receipt, clean, wrap


class FakePrinter:
    """A real TCP server standing in for a thermal printer on port 9100."""

    def __enter__(self):
        self.received = bytearray()
        self.server = socket.socket()
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(1)
        self.port = self.server.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()
        return self

    def _serve(self):
        conn, _ = self.server.accept()
        with conn:
            while data := conn.recv(4096):
                self.received += data

    def __exit__(self, *_):
        self.thread.join(timeout=3)
        self.server.close()


def agent_client(world):
    token = world.owner.post("/api/settings/print-agent-token").json["token"]
    client = world.app.test_client()
    headers = {"X-Agent-Token": token}
    return (
        lambda: client.post("/api/print-agent/jobs/claim", headers=headers),
        lambda job_id, **body: client.post(f"/api/print-agent/jobs/{job_id}/ack", json=body, headers=headers),
    )


class TestEscPos:
    def test_control_characters_cannot_inject_commands(self):
        assert "\x1b" not in clean("Bad\x1bV\x00Name")
        t = Ticket(32)
        before = len(t.buf)
        t.line("Evil\x1d\x56\x00Name")
        assert b"\x1d" not in t.buf[before:]

    def test_unicode_never_raises(self):
        t = Ticket(32)
        t.line("Nyambura – café \U0001F454 Ж")
        assert t.cut()

    def test_columns_stay_within_paper_width(self):
        t = Ticket(32)
        before = len(t.buf)
        t.columns("A very long item description that keeps going on and on", "KES 1,234,567.00")
        lines = bytes(t.buf[before:]).decode("cp437").strip("\n").split("\n")
        assert all(len(line) <= 32 for line in lines)

    def test_wrap_handles_words_longer_than_the_line(self):
        assert all(len(p) <= 10 for p in wrap("x" * 25 + " short", 10))

    def test_real_order_renders_for_all_paper_widths(self, app, world):
        order_id = world.bespoke(notes="Peak lapel, side vents").json["id"]
        from app.models import Order, Shop

        with app.app_context():
            order = db.session.get(Order, order_id)
            shop = db.session.get(Shop, world.shop_id)
            for width in (32, 42, 48):
                shop.printer_width = width
                receipt = build_receipt(shop, order)
                assert b"BALANCE DUE" in receipt
                assert b"8,500.00" in receipt
                card = build_job_card(shop, order)
                assert b"JOB #1" in card
                assert b"8,500" not in card  # the workshop ticket carries no money
            db.session.rollback()

    def test_cut_command_terminates_ticket(self):
        assert Ticket(32).cut().endswith(b"\x1dV\x42\x00")


class TestNetworkMode:
    def test_receipt_reaches_the_printer(self, world):
        order = world.bespoke().json
        with FakePrinter() as printer:
            world.owner.patch("/api/settings/shop", {"printer_mode": "network", "printer_host": "127.0.0.1", "printer_port": printer.port})
            res = world.cashier.post(f"/api/print/orders/{order['id']}/receipt")
            assert res.status_code == 200, res.json
        assert b"BALANCE DUE" in printer.received

    def test_dead_printer_is_a_clear_error_and_keeps_the_sale(self, world):
        order = world.bespoke().json
        world.owner.patch("/api/settings/shop", {"printer_mode": "network", "printer_host": "127.0.0.1", "printer_port": 1})
        res = world.cashier.post(f"/api/print/orders/{order['id']}/receipt")
        assert res.status_code == 502
        assert res.json["error"]["code"] == "printer_unreachable"
        assert world.owner.get(f"/api/orders/{order['id']}").json["amount_paid"] == "5000.00"

    def test_direct_mode_blocked_on_cloud_deployments(self, app, world):
        order = world.bespoke().json
        world.owner.patch("/api/settings/shop", {"printer_mode": "network", "printer_host": "169.254.169.254", "printer_port": 80})
        app.config["ALLOW_DIRECT_PRINT"] = False
        try:
            res = world.cashier.post(f"/api/print/orders/{order['id']}/receipt")
        finally:
            app.config["ALLOW_DIRECT_PRINT"] = True
        assert res.status_code == 409
        assert res.json["error"]["code"] == "direct_print_disabled"

    def test_unconfigured_printer_gives_guidance(self, world):
        order = world.bespoke().json
        res = world.cashier.post(f"/api/print/orders/{order['id']}/receipt")
        assert res.status_code == 409
        assert res.json["error"]["code"] == "printer_not_configured"


class TestAgentQueue:
    def test_full_round_trip(self, world):
        order = world.bespoke().json
        claim, ack = agent_client(world)
        assert claim().status_code == 204

        assert world.cashier.post(f"/api/print/orders/{order['id']}/receipt").status_code == 202
        job = claim().json
        assert b"BALANCE DUE" in base64.b64decode(job["payload_b64"])
        assert claim().status_code == 204  # claimed once, not handed out twice

        assert ack(job["id"], ok=True).json["status"] == "done"
        assert claim().status_code == 204

    def test_failed_job_is_retried_then_given_up(self, world):
        order = world.bespoke().json
        claim, ack = agent_client(world)
        world.cashier.post(f"/api/print/orders/{order['id']}/receipt")
        for attempt in range(1, 6):
            job = claim().json
            res = ack(job["id"], ok=False, error="Out of paper")
            assert res.json["attempts"] == attempt
        assert res.json["status"] == "failed"
        assert claim().status_code == 204

    def test_unconfirmed_job_is_reclaimed(self, app, world):
        order = world.bespoke().json
        claim, _ack = agent_client(world)
        world.cashier.post(f"/api/print/orders/{order['id']}/receipt")
        job_id = claim().json["id"]
        with app.app_context():
            db.session.get(PrintJob, job_id).claimed_at = utcnow() - timedelta(minutes=10)
            db.session.commit()
        assert claim().json["id"] == job_id

    def test_old_jobs_expire_instead_of_printing_days_later(self, app, world):
        order = world.bespoke().json
        claim, _ack = agent_client(world)
        world.cashier.post(f"/api/print/orders/{order['id']}/receipt")
        with app.app_context():
            db.session.query(PrintJob).update({"created_at": utcnow() - timedelta(days=3)})
            db.session.commit()
        assert claim().status_code == 204

    def test_bad_token_rejected(self, world):
        res = world.anon.client.post("/api/print-agent/jobs/claim", headers={"X-Agent-Token": "wrong"})
        assert res.status_code == 401
        assert world.anon.client.post("/api/print-agent/jobs/claim").status_code == 401

    def test_agent_cannot_touch_another_shops_job(self, world):
        order = world.bespoke().json
        _claim, ack_a = agent_client(world)
        world.cashier.post(f"/api/print/orders/{order['id']}/receipt")
        job_id = world.cashier.get("/api/print/jobs").json["items"][0]["id"]
        token_b = world.other_owner.post("/api/settings/print-agent-token").json["token"]
        client = world.app.test_client()
        assert client.post("/api/print-agent/jobs/claim", headers={"X-Agent-Token": token_b}).status_code == 204
        res = client.post(f"/api/print-agent/jobs/{job_id}/ack", json={"ok": True}, headers={"X-Agent-Token": token_b})
        assert res.status_code == 404

    def test_agent_program_prints_a_job(self, world):
        import importlib.util
        import pathlib

        spec = importlib.util.spec_from_file_location("agent", pathlib.Path(__file__).parent.parent / "print_agent" / "agent.py")
        agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)

        order = world.bespoke().json
        claim, ack = agent_client(world)
        world.cashier.post(f"/api/print/orders/{order['id']}/receipt")
        fake_client = SimpleNamespace(
            claim=lambda: claim().json,
            ack=lambda job_id, ok, error=None: ack(job_id, ok=ok, error=error),
        )
        with FakePrinter() as printer:
            assert agent.run_once(fake_client, lambda payload: agent.send_tcp("127.0.0.1", printer.port, payload)) is True
        assert b"BALANCE DUE" in printer.received
        assert world.cashier.get("/api/print/jobs").json["items"][0]["status"] == "done"


def test_health_endpoint(world):
    assert world.anon.get("/api/health").json == {"status": "ok", "database": "ok"}
