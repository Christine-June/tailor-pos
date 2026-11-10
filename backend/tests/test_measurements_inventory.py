from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.extensions import db
from app.models import Measurement
from app.models.base import ImmutableRecordError


def record(world, client=None, **values):
    return (client or world.tailor).post(
        f"/api/customers/{world.customer_id}/measurements",
        {"unit": "in", "values": values or {"chest": "40", "waist": "34"}},
    )


class TestMeasurementHistory:
    def test_new_fitting_never_changes_the_one_an_invoice_uses(self, world):
        first = record(world, chest="40").json
        order = world.bespoke(measurement_id=first["id"]).json
        record(world, chest="44")

        fetched = world.owner.get(f"/api/orders/{order['id']}").json
        assert fetched["measurement"]["values"]["chest"] == "40.00"

        history = world.tailor.get(f"/api/customers/{world.customer_id}/measurements").json["items"]
        assert [m["values"]["chest"] for m in history] == ["44.00", "40.00"]
        assert history[1]["orders"][0]["number"] == order["number"]
        assert history[0]["orders"] == []

    def test_no_edit_or_delete_routes_exist(self, world):
        m = record(world).json
        path = f"/api/customers/{world.customer_id}/measurements/{m['id']}"
        assert world.owner.patch(path, {"values": {"chest": "1"}}).status_code in (404, 405)
        assert world.owner.client.delete(path, headers=world.owner._headers()).status_code in (404, 405)

    def test_orm_refuses_to_change_a_measurement(self, app, world):
        m_id = record(world).json["id"]
        with app.app_context():
            m = db.session.get(Measurement, m_id)
            m.values = {"chest": "1"}
            with pytest.raises(ImmutableRecordError):
                db.session.flush()
            db.session.rollback()

    @pytest.mark.parametrize("statement", [
        "UPDATE measurements SET spec_values = '{}'",
        "DELETE FROM measurements",
    ])
    def test_database_refuses_even_raw_sql(self, app, world, statement):
        record(world)
        with app.app_context():
            with pytest.raises(DBAPIError, match="append-only"):
                db.session.execute(text(statement))
            db.session.rollback()

    def test_payment_ledger_is_protected_by_database(self, app, world):
        world.bespoke()
        with app.app_context():
            with pytest.raises(DBAPIError, match="append-only"):
                db.session.execute(text("UPDATE payments SET amount = 1"))
            db.session.rollback()

    def test_locked_after_cutting_starts(self, world):
        first = record(world, chest="40").json
        second = record(world, chest="44").json
        order = world.bespoke(measurement_id=first["id"]).json
        res = world.cashier.patch(f"/api/orders/{order['id']}", {"measurement_id": second["id"]})
        assert res.status_code == 200
        world.tailor.post(f"/api/orders/{order['id']}/transition", {"to_status": "cutting"})
        res = world.cashier.patch(f"/api/orders/{order['id']}", {"measurement_id": first["id"]})
        assert res.status_code == 409
        assert res.json["error"]["code"] == "measurement_locked"

    def test_other_customers_measurement_cannot_be_attached(self, world):
        other = world.tailor.post("/api/customers", {"first_name": "Second", "phone": "0700000111"}).json
        m = world.tailor.post(f"/api/customers/{other['id']}/measurements", {"values": {"chest": "30"}}).json
        res = world.bespoke(measurement_id=m["id"])
        assert res.status_code == 422
        assert res.json["error"]["code"] == "measurement_mismatch"

    def test_custom_fields_are_accepted(self, world):
        res = record(world, kanzu_collar="7.25")
        assert res.status_code == 201
        assert res.json["values"]["kanzu_collar"] == "7.25"

    @pytest.mark.parametrize("values", [{}, {"chest": "-1"}, {"chest": "5000"}, {"Bad Key!": "1"}, {"chest": "abc"}])
    def test_invalid_values_rejected(self, world, values):
        res = world.tailor.post(f"/api/customers/{world.customer_id}/measurements", {"values": values})
        assert res.status_code == 422

    def test_retry_does_not_duplicate(self, world, uid):
        body = {"id": uid(), "values": {"chest": "40"}}
        path = f"/api/customers/{world.customer_id}/measurements"
        assert world.tailor.post(path, body).status_code == 201
        assert world.tailor.post(path, body).status_code == 200
        assert len(world.tailor.get(path).json["items"]) == 1


class TestCustomers:
    def test_phone_formats_normalize_to_one_number(self, world):
        for raw in ("0722 111 222", "254722111222", "+254722111222", "722111222"):
            res = world.cashier.post("/api/customers", {"first_name": "A", "phone": raw, "allow_duplicate_phone": True})
            assert res.json["phone"] == "+254722111222", raw

    def test_duplicate_phone_warns_then_allows_a_family_member(self, world):
        world.cashier.post("/api/customers", {"first_name": "Parent", "phone": "0722111222"})
        res = world.cashier.post("/api/customers", {"first_name": "Child", "phone": "0722 111 222"})
        assert res.status_code == 409
        assert res.json["error"]["code"] == "duplicate_phone"
        assert res.json["error"]["details"]["existing"]["first_name"] == "Parent"
        res = world.cashier.post("/api/customers", {"first_name": "Child", "phone": "0722111222", "allow_duplicate_phone": True})
        assert res.status_code == 201

    def test_search_by_name_and_any_phone_format(self, world):
        world.cashier.post("/api/customers", {"first_name": "Wanjiru", "last_name": "Kamau", "phone": "0722111222"})
        for term in ("wanj", "Wanjiru Kamau", "0722111222", "722111", "%2B254722111222"):
            items = world.cashier.get(f"/api/customers?q={term}").json["items"]
            assert any(c["first_name"] == "Wanjiru" for c in items), term

    def test_search_wildcards_are_literal(self, world):
        assert world.cashier.get("/api/customers?q=%25").json["total"] == 0

    def test_invalid_phone_rejected(self, world):
        assert world.cashier.post("/api/customers", {"first_name": "A", "phone": "12"}).status_code == 422

    def test_archived_customer_leaves_search_but_keeps_history(self, world):
        order = world.bespoke().json
        world.owner.patch(f"/api/customers/{world.customer_id}", {"archived": True})
        assert world.owner.get("/api/customers?q=Jane").json["total"] == 0
        assert world.owner.get(f"/api/orders/{order['id']}").json["customer"]["first_name"] == "Jane"


class TestInventory:
    def test_create_with_opening_stock_writes_ledger(self, world):
        item = world.owner.post("/api/inventory", {
            "name": "Silk", "kind": "fabric", "unit": "m", "sell_price": "2000.00", "opening_quantity": "12.5",
        }).json
        assert item["quantity_on_hand"] == "12.500"
        moves = world.owner.get(f"/api/inventory/{item['id']}/movements").json["items"]
        assert moves[0]["balance_after"] == "12.500"

    def test_stock_count_records_the_difference(self, world):
        res = world.cashier.post(f"/api/inventory/{world.fabric_id}/adjust", {"reason": "stock_count", "counted_quantity": "9.25"})
        assert res.json["quantity_on_hand"] == "9.250"
        move = world.owner.get(f"/api/inventory/{world.fabric_id}/movements").json["items"][0]
        assert move["quantity_delta"] == "-0.750"

    def test_ledger_always_matches_balance(self, world):
        world.bespoke(quantity="1.25")
        world.cashier.post(f"/api/inventory/{world.fabric_id}/adjust", {"reason": "waste", "delta": "-0.5", "note": "Offcut"})
        moves = world.owner.get(f"/api/inventory/{world.fabric_id}/movements").json["items"]
        assert moves[0]["balance_after"] == "8.250"
        assert world.stock(world.fabric_id) == Decimal("8.250")

    def test_adjust_cannot_go_negative(self, world):
        res = world.cashier.post(f"/api/inventory/{world.fabric_id}/adjust", {"reason": "waste", "delta": "-100"})
        assert res.status_code == 409

    def test_cashier_cannot_create_or_see_cost(self, world):
        assert world.cashier.post("/api/inventory", {"name": "X"}).status_code == 403
        items = world.cashier.get("/api/inventory").json["items"]
        assert "cost_price" not in items[0]
        assert "cost_price" in world.owner.get("/api/inventory").json["items"][0]

    def test_duplicate_sku_rejected(self, world):
        assert world.owner.post("/api/inventory", {"name": "A", "sku": "S1"}).status_code == 201
        res = world.owner.post("/api/inventory", {"name": "B", "sku": "S1"})
        assert res.status_code == 409
        assert res.json["error"]["code"] == "duplicate_sku"
        # The same SKU is fine in another shop.
        assert world.other_owner.post("/api/inventory", {"name": "B", "sku": "S1"}).status_code == 201

    def test_renaming_item_leaves_old_invoice_alone(self, world):
        order = world.bespoke().json
        world.owner.patch(f"/api/inventory/{world.fabric_id}", {"name": "Renamed", "sell_price": "9999.00"})
        fetched = world.owner.get(f"/api/orders/{order['id']}").json
        assert fetched["items"][0]["description"] == "Wool"
        assert fetched["items"][0]["unit_price"] == "1000.00"
