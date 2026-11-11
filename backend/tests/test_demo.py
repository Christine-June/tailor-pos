from decimal import Decimal

from sqlalchemy import func, select

from app.extensions import db
from app.models import Order, OrderStatus, Payment


class TestDemoMode:
    def test_meta_reports_demo_off_by_default(self, world):
        assert world.anon.client.get("/api/meta").json == {"demo": False, "demo_accounts": [], "demo_password": None}

    def test_demo_locks_account_changes(self, world, app):
        app.config["DEMO_MODE"] = True
        try:
            assert world.anon.client.get("/api/meta").json["demo"] is True
            res = world.owner.post("/api/users", {"name": "X", "email": "x@x.test", "password": "longenough1", "role": "cashier"})
            assert res.status_code == 403 and res.json["error"]["code"] == "demo_locked"
            owner = next(u for u in world.owner.get("/api/users").json["items"] if u["role"] == "owner")
            assert world.owner.patch(f"/api/users/{owner['id']}", {"name": "Y"}).status_code == 403
            assert world.owner.post("/api/auth/change-password", {"current_password": "a", "new_password": "bbbbbbbb"}).status_code == 403
            assert world.owner.post("/api/settings/print-agent-token", {}).status_code == 403
            # Everyday work still works in the demo.
            assert world.bespoke().status_code == 201
        finally:
            app.config["DEMO_MODE"] = False


def test_seed_demo_builds_two_weeks_of_consistent_history(app):
    runner = app.test_cli_runner()
    result = runner.invoke(args=["seed-demo"])
    assert result.exit_code == 0, result.output
    assert "orders over two weeks" in result.output
    with app.app_context():
        orders = db.session.scalars(select(Order)).unique().all()
        assert len(orders) > 50
        for order in orders:
            paid = sum((p.amount for p in order.payments), Decimal("0"))
            assert Decimal("0") < paid <= order.total
            if order.status == OrderStatus.COMPLETED:
                assert paid == order.total
        days = {o.created_at.date() for o in orders}
        assert len(days) >= 10
        assert db.session.scalar(select(func.count(func.distinct(Payment.reference))).where(Payment.reference.is_not(None))) == db.session.scalar(
            select(func.count()).where(Payment.reference.is_not(None)).select_from(Payment)
        )
    # Running it twice changes nothing.
    assert "already present" in runner.invoke(args=["seed-demo"]).output


def test_seed_demo_refused_in_production_unless_demo(app):
    # Uses the shared app: building a second one would re-initialise the shared rate limiter.
    app.config["APP_ENV"] = "production"
    try:
        assert "disabled in production" in app.test_cli_runner().invoke(args=["seed-demo"]).output
    finally:
        app.config["APP_ENV"] = "development"
