from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from conftest import Api


def retail_sale(world, client=None, quantity="1", **kw):
    return (client or world.cashier).post("/api/orders", {
        "kind": "retail",
        "items": [{"inventory_item_id": str(world.tie_id), "quantity": quantity}],
        "payments": [{"method": "cash", "amount": str(Decimal("500.00") * Decimal(quantity)), "tendered": "2000.00"}]
        if "payments" not in kw else kw.pop("payments"),
        **kw,
    })


class TestCheckout:
    def test_split_tender_deposit_leaves_balance(self, world):
        res = world.bespoke(payments=[
            {"method": "cash", "amount": "3000.00"},
            {"method": "mpesa", "amount": "2000.00", "reference": "sgk7qx2m9l"},
        ])
        assert res.status_code == 201, res.json
        order = res.json
        assert order["total"] == "13500.00"
        assert order["amount_paid"] == "5000.00"
        assert order["balance"] == "8500.00"
        assert order["payment_status"] == "partial"
        assert order["status"] == "confirmed"
        assert len(order["payments"]) == 2
        assert order["payments"][1]["reference"] == "SGK7QX2M9L"

    def test_fractional_fabric_is_deducted_exactly(self, world):
        world.bespoke(quantity="2.75")
        assert world.stock(world.fabric_id) == Decimal("7.250")

    def test_retail_sale_completes_and_records_change(self, world):
        res = retail_sale(world)
        assert res.status_code == 201, res.json
        assert res.json["status"] == "completed"
        assert res.json["payments"][0]["change"] == "1500.00"

    def test_retail_sale_must_be_fully_paid(self, world):
        res = retail_sale(world, payments=[{"method": "cash", "amount": "100.00"}])
        assert res.status_code == 409
        assert res.json["error"]["code"] == "payment_required"
        assert world.stock(world.tie_id) == Decimal("5.000")

    def test_overpayment_rejected_and_nothing_saved(self, world):
        res = world.bespoke(payments=[{"method": "cash", "amount": "99999.00"}])
        assert res.status_code == 409
        assert res.json["error"]["code"] == "overpayment"
        assert world.owner.get("/api/orders").json["total"] == 0
        assert world.stock(world.fabric_id) == Decimal("10.000")

    def test_insufficient_stock_rolls_back_everything(self, world):
        res = world.bespoke(quantity="50")
        assert res.status_code == 409
        assert res.json["error"]["code"] == "insufficient_stock"
        assert world.owner.get("/api/orders").json["total"] == 0

    def test_order_number_not_burned_by_failed_order(self, world):
        world.bespoke(quantity="50")
        first = world.bespoke(quantity="1")
        assert first.status_code == 201, first.json
        assert first.json["number"] == 1
        assert world.bespoke(quantity="1").json["number"] == 2

    def test_mpesa_needs_valid_code(self, world):
        res = world.bespoke(payments=[{"method": "mpesa", "amount": "5000.00"}])
        assert res.status_code == 422
        assert res.json["error"]["code"] == "invalid_mpesa_reference"

    def test_duplicate_mpesa_code_rejected_unless_owner_overrides(self, world):
        pay = {"method": "mpesa", "amount": "5000.00", "reference": "ABCD123456"}
        assert world.bespoke(payments=[pay]).status_code == 201
        res = world.bespoke(payments=[pay])
        assert res.status_code == 409
        assert res.json["error"]["code"] == "duplicate_reference"
        ok = world.bespoke(client=world.owner, payments=[{**pay, "allow_duplicate_reference": True}])
        assert ok.status_code == 201

    def test_rounding_uses_decimal_not_float(self, world):
        res = world.owner.post("/api/orders", {
            "kind": "bespoke", "customer_id": str(world.customer_id),
            "items": [{"description": "Lace", "quantity": "1.333", "unit_price": "333.33"}],
        })
        assert res.json["total"] == "444.33"

    def test_bad_input_returns_422_not_500(self, world):
        for payload in (
            {"items": []},
            {"items": [{"description": "x", "quantity": "-1", "unit_price": "10"}]},
            {"items": [{"description": "x", "unit_price": "NaN"}]},
            {"items": [{"description": "x", "unit_price": "1.999"}]},
            {"kind": "nonsense", "items": [{"description": "x", "unit_price": "1"}]},
        ):
            assert world.owner.post("/api/orders", payload).status_code == 422, payload

    def test_non_json_body_returns_400(self, world):
        res = world.owner.client.post(
            "/api/orders", data="not json", content_type="text/plain",
            headers={"Authorization": f"Bearer {world.owner.token}"},
        )
        assert res.status_code == 400


class TestPermissions:
    def test_cashier_cannot_discount_or_undercut(self, world):
        res = world.bespoke(discount="100.00")
        assert res.status_code == 403
        res = world.cashier.post("/api/orders", {
            "kind": "retail",
            "items": [{"inventory_item_id": str(world.tie_id), "unit_price": "1.00"}],
            "payments": [{"method": "cash", "amount": "1.00"}],
        })
        assert res.status_code == 403
        assert res.json["error"]["code"] == "price_override_forbidden"

    def test_owner_can_discount(self, world):
        res = world.bespoke(client=world.owner, discount="500.00")
        assert res.json["total"] == "13000.00"

    def test_tailor_cannot_see_money_or_take_orders(self, world):
        assert world.tailor.get("/api/orders").status_code == 403
        assert world.bespoke(client=world.tailor).status_code == 403
        assert world.tailor.get("/api/reports/daily").status_code == 403
        world.bespoke()
        board = world.tailor.get("/api/workshop/board").json["items"]
        assert len(board) == 1
        for forbidden in ("total", "balance", "payments", "amount_paid"):
            assert forbidden not in board[0]
        assert "unit_price" not in board[0]["items"][0]

    def test_anonymous_is_rejected_everywhere(self, world):
        for path in ("/api/orders", "/api/customers", "/api/inventory", "/api/workshop/board", "/api/reports/daily"):
            res = world.anon.get(path)
            assert res.status_code == 401
            assert res.json["error"]["code"] == "unauthorized"

    def test_print_endpoints_require_auth(self, world):
        order = world.bespoke().json
        assert world.anon.post(f"/api/print/orders/{order['id']}/receipt").status_code == 401


class TestTenantIsolation:
    def test_other_shop_cannot_read_or_touch_order(self, world):
        order = world.bespoke().json
        spy = world.other_owner
        assert spy.get(f"/api/orders/{order['id']}").status_code == 404
        assert spy.post(f"/api/orders/{order['id']}/payments", {"method": "cash", "amount": "1.00"}).status_code == 404
        assert spy.post(f"/api/orders/{order['id']}/transition", {"to_status": "cutting"}).status_code == 404
        assert spy.post(f"/api/orders/{order['id']}/cancel", {"reason": "spying"}).status_code == 404
        assert spy.post(f"/api/print/orders/{order['id']}/receipt").status_code == 404
        assert spy.get("/api/orders").json["total"] == 0
        assert spy.get("/api/workshop/board").json["items"] == []

    def test_cannot_use_another_shops_customer_or_item(self, world):
        res = world.owner.post("/api/orders", {
            "kind": "bespoke", "customer_id": str(world.other_customer_id),
            "items": [{"description": "x", "unit_price": "1"}],
        })
        assert res.status_code == 422
        res = world.other_owner.post("/api/orders", {
            "kind": "bespoke", "customer_id": str(world.other_customer_id),
            "items": [{"inventory_item_id": str(world.fabric_id), "quantity": "1"}],
        })
        assert res.status_code == 422
        assert world.stock(world.fabric_id) == Decimal("10.000")

    def test_reused_client_id_across_shops_does_not_leak(self, world, uid):
        order_id = uid()
        world.bespoke(id=order_id)
        res = world.other_owner.post("/api/orders", {
            "id": order_id, "kind": "bespoke", "customer_id": str(world.other_customer_id),
            "items": [{"description": "x", "unit_price": "1"}],
        })
        assert res.status_code == 409
        assert "customer" not in res.json

    def test_order_numbers_are_per_shop(self, world):
        assert world.bespoke().json["number"] == 1
        res = world.other_owner.post("/api/orders", {
            "kind": "bespoke", "customer_id": str(world.other_customer_id),
            "items": [{"description": "x", "unit_price": "1"}],
        })
        assert res.json["number"] == 1


class TestOfflineRetries:
    def test_same_order_id_twice_creates_one_order_and_one_deduction(self, world, uid):
        order_id, pay_id = uid(), uid()
        payments = [{"id": pay_id, "method": "cash", "amount": "5000.00"}]
        first = world.bespoke(id=order_id, payments=payments)
        second = world.bespoke(id=order_id, payments=payments)
        assert (first.status_code, second.status_code) == (201, 200)
        assert first.json["number"] == second.json["number"]
        assert world.owner.get("/api/orders").json["total"] == 1
        assert world.stock(world.fabric_id) == Decimal("6.500")

    def test_same_payment_id_twice_counts_once(self, world, uid):
        order = world.bespoke().json
        pay = {"id": uid(), "method": "cash", "amount": "1000.00"}
        assert world.cashier.post(f"/api/orders/{order['id']}/payments", pay).status_code == 201
        res = world.cashier.post(f"/api/orders/{order['id']}/payments", pay)
        assert res.status_code == 200
        assert res.json["amount_paid"] == "6000.00"

    def test_offline_sale_can_oversell_rather_than_lose_the_sale(self, world, uid):
        res = world.bespoke(id=uid(), quantity="50", offline=True, payments=[{"method": "cash", "amount": "5000.00"}])
        assert res.status_code == 201, res.json
        assert res.json["created_offline"] is True
        assert world.stock(world.fabric_id) == Decimal("-40.000")

    def test_simultaneous_retries_of_one_order(self, app, world, uid):
        order_id = uid()
        token = world.cashier.token
        body = {
            "id": order_id, "kind": "bespoke", "customer_id": str(world.customer_id),
            "items": [{"inventory_item_id": str(world.fabric_id), "quantity": "1"}],
        }

        def fire(_):
            res = app.test_client().post("/api/orders", json=body, headers={"Authorization": f"Bearer {token}"})
            return res.status_code

        with ThreadPoolExecutor(6) as pool:
            codes = list(pool.map(fire, range(6)))
        assert all(c in (200, 201) for c in codes), codes
        assert world.stock(world.fabric_id) == Decimal("9.000")
        assert world.owner.get("/api/orders").json["total"] == 1


class TestConcurrency:
    def test_last_stock_cannot_be_sold_twice(self, app, world):
        token = world.cashier.token
        body = {
            "kind": "retail",
            "items": [{"inventory_item_id": str(world.tie_id), "quantity": "5"}],
            "payments": [{"method": "cash", "amount": "2500.00"}],
        }

        def fire(_):
            return app.test_client().post("/api/orders", json=body, headers={"Authorization": f"Bearer {token}"}).status_code

        with ThreadPoolExecutor(5) as pool:
            codes = list(pool.map(fire, range(5)))
        assert sorted(codes) == [201, 409, 409, 409, 409], codes
        assert world.stock(world.tie_id) == Decimal("0.000")

    def test_simultaneous_payments_cannot_overpay(self, app, world):
        order = world.bespoke().json  # balance 8,500
        token = world.cashier.token

        def fire(_):
            return app.test_client().post(
                f"/api/orders/{order['id']}/payments",
                json={"method": "cash", "amount": "8500.00"},
                headers={"Authorization": f"Bearer {token}"},
            ).status_code

        with ThreadPoolExecutor(5) as pool:
            codes = list(pool.map(fire, range(5)))
        assert sorted(codes) == [201, 409, 409, 409, 409], codes
        assert world.owner.get(f"/api/orders/{order['id']}").json["balance"] == "0.00"

    def test_order_numbers_never_collide(self, app, world):
        token = world.cashier.token
        body = {"kind": "bespoke", "customer_id": str(world.customer_id), "items": [{"description": "x", "unit_price": "1"}]}

        def fire(_):
            return app.test_client().post("/api/orders", json=body, headers={"Authorization": f"Bearer {token}"}).json["number"]

        with ThreadPoolExecutor(8) as pool:
            numbers = list(pool.map(fire, range(16)))
        assert sorted(numbers) == list(range(1, 17))


class TestWorkflow:
    def walk(self, world, order_id, *stages):
        for stage in stages:
            res = world.tailor.post(f"/api/orders/{order_id}/transition", {"to_status": stage})
            assert res.status_code == 200, res.json

    def test_full_journey_to_collection(self, world):
        order = world.bespoke().json
        self.walk(world, order["id"], "cutting", "stitching", "fitting", "alterations", "fitting", "ready")
        res = world.cashier.post(f"/api/orders/{order['id']}/payments", {"method": "cash", "amount": "8500.00"})
        assert res.json["balance"] == "0.00"
        res = world.cashier.post(f"/api/orders/{order['id']}/transition", {"to_status": "completed"})
        assert res.json["status"] == "completed"
        assert res.json["completed_at"]
        assert [e["to_status"] for e in res.json["events"]] == [
            "confirmed", "cutting", "stitching", "fitting", "alterations", "fitting", "ready", "completed",
        ]

    def test_cannot_skip_stages(self, world):
        order = world.bespoke().json
        res = world.tailor.post(f"/api/orders/{order['id']}/transition", {"to_status": "fitting"})
        assert res.status_code == 409
        assert res.json["error"]["code"] == "invalid_transition"

    def test_cannot_hand_over_with_balance(self, world):
        order = world.bespoke().json
        self.walk(world, order["id"], "ready")
        res = world.cashier.post(f"/api/orders/{order['id']}/transition", {"to_status": "completed"})
        assert res.status_code == 409
        assert res.json["error"]["code"] == "balance_outstanding"
        # A cashier can't grant credit, even by sending the flag.
        res = world.cashier.post(f"/api/orders/{order['id']}/transition", {"to_status": "completed", "allow_outstanding_balance": True})
        assert res.status_code == 409
        res = world.owner.post(f"/api/orders/{order['id']}/transition", {"to_status": "completed", "allow_outstanding_balance": True})
        assert res.status_code == 200

    def test_tailor_cannot_complete_or_cancel(self, world):
        order = world.bespoke().json
        self.walk(world, order["id"], "ready")
        assert world.tailor.post(f"/api/orders/{order['id']}/transition", {"to_status": "completed"}).status_code == 403
        assert world.tailor.post(f"/api/orders/{order['id']}/cancel", {"reason": "nope"}).status_code == 403

    def test_stale_kanban_drag_gets_conflict(self, world):
        order = world.bespoke().json
        self.walk(world, order["id"], "cutting", "stitching")
        res = world.tailor.post(f"/api/orders/{order['id']}/transition", {"from_status": "confirmed", "to_status": "cutting"})
        assert res.status_code == 409
        assert res.json["error"]["code"] == "stale_status"
        assert res.json["error"]["details"]["current_status"] == "stitching"

    def test_repeating_a_drag_is_harmless(self, world):
        order = world.bespoke().json
        self.walk(world, order["id"], "cutting", "cutting")
        events = world.owner.get(f"/api/orders/{order['id']}").json["events"]
        assert [e["to_status"] for e in events] == ["confirmed", "cutting"]

    def test_retail_stays_out_of_workshop(self, world):
        order = retail_sale(world).json
        res = world.owner.post(f"/api/orders/{order['id']}/transition", {"to_status": "alterations"})
        assert res.status_code == 409
        assert world.owner.get("/api/workshop/board").json["items"] == []


class TestDeposits:
    def require_30_percent(self, world):
        assert world.owner.patch("/api/settings/shop", {"min_deposit_pct": "30"}).status_code == 200

    def test_low_deposit_blocked_for_cashier(self, world):
        self.require_30_percent(world)
        res = world.bespoke(payments=[{"method": "cash", "amount": "100.00"}])
        assert res.status_code == 409
        assert res.json["error"]["code"] == "deposit_required"
        assert res.json["error"]["details"]["required"] == "4050.00"

    def test_owner_can_waive_deposit(self, world):
        self.require_30_percent(world)
        assert world.bespoke(client=world.owner, payments=[]).json["status"] == "confirmed"

    def test_offline_low_deposit_is_kept_as_draft(self, world, uid):
        self.require_30_percent(world)
        res = world.bespoke(id=uid(), offline=True, payments=[{"method": "cash", "amount": "100.00"}])
        assert res.status_code == 201
        assert res.json["status"] == "draft"
        assert world.stock(world.fabric_id) == Decimal("10.000")

    def test_draft_confirms_when_deposit_arrives_and_stock_is_then_taken(self, world):
        self.require_30_percent(world)
        order = world.bespoke(payments=[], confirm=False).json
        assert order["status"] == "draft"
        assert world.stock(world.fabric_id) == Decimal("10.000")
        res = world.cashier.post(f"/api/orders/{order['id']}/payments", {"method": "cash", "amount": "4050.00"})
        assert res.json["status"] == "confirmed"
        assert world.stock(world.fabric_id) == Decimal("6.500")


class TestCancelAndRefund:
    def test_cancel_paid_order_needs_a_decision(self, world):
        order = world.bespoke().json
        res = world.owner.post(f"/api/orders/{order['id']}/cancel", {"reason": "Customer changed mind"})
        assert res.status_code == 409
        assert res.json["error"]["code"] == "paid_handling_required"

    def test_cashier_cannot_cancel_paid_order(self, world):
        order = world.bespoke().json
        res = world.cashier.post(f"/api/orders/{order['id']}/cancel", {"reason": "oops", "paid_handling": "retain"})
        assert res.status_code == 403

    def test_cancel_with_refund_restores_stock_and_zeroes_paid(self, world):
        order = world.bespoke().json
        res = world.owner.post(f"/api/orders/{order['id']}/cancel", {
            "reason": "Customer changed mind", "paid_handling": "refund", "refund_method": "cash",
        })
        assert res.status_code == 200, res.json
        assert res.json["status"] == "cancelled"
        assert res.json["amount_paid"] == "0.00"
        assert world.stock(world.fabric_id) == Decimal("10.000")

    def test_cancel_retaining_deposit_keeps_money(self, world):
        order = world.bespoke().json
        res = world.owner.post(f"/api/orders/{order['id']}/cancel", {"reason": "No show", "paid_handling": "retain"})
        assert res.json["amount_paid"] == "5000.00"
        assert res.json["balance"] == "0.00"

    def test_cut_cloth_does_not_return_to_stock_by_default(self, world):
        order = world.bespoke().json
        world.tailor.post(f"/api/orders/{order['id']}/transition", {"to_status": "cutting"})
        world.owner.post(f"/api/orders/{order['id']}/cancel", {"reason": "No show", "paid_handling": "retain"})
        assert world.stock(world.fabric_id) == Decimal("6.500")

    def test_cancel_is_idempotent(self, world):
        order = world.bespoke(payments=[]).json
        for _ in range(2):
            assert world.cashier.post(f"/api/orders/{order['id']}/cancel", {"reason": "Mistake"}).status_code == 200
        assert world.stock(world.fabric_id) == Decimal("10.000")

    def test_void_completed_retail_sale(self, world):
        order = retail_sale(world).json
        assert world.stock(world.tie_id) == Decimal("4.000")
        res = world.owner.post(f"/api/orders/{order['id']}/cancel", {"reason": "Returned", "paid_handling": "refund", "refund_method": "cash"})
        assert res.status_code == 200, res.json
        assert world.stock(world.tie_id) == Decimal("5.000")

    def test_refund_cannot_exceed_paid(self, world):
        order = world.bespoke().json
        res = world.owner.post(f"/api/orders/{order['id']}/refunds", {"method": "cash", "amount": "9999.00", "note": "typo fix"})
        assert res.status_code == 409

    def test_refund_requires_owner(self, world):
        order = world.bespoke().json
        res = world.cashier.post(f"/api/orders/{order['id']}/refunds", {"method": "cash", "amount": "1.00", "note": "typo fix"})
        assert res.status_code == 403

    def test_no_payment_on_cancelled_order(self, world):
        order = world.bespoke(payments=[]).json
        world.cashier.post(f"/api/orders/{order['id']}/cancel", {"reason": "Mistake"})
        res = world.cashier.post(f"/api/orders/{order['id']}/payments", {"method": "cash", "amount": "1.00"})
        assert res.status_code == 409


class TestOrderEdits:
    def test_add_item_raises_total_and_takes_stock(self, world):
        order = world.bespoke().json
        res = world.cashier.post(f"/api/orders/{order['id']}/items", {"items": [{"inventory_item_id": str(world.fabric_id), "quantity": "1"}]})
        assert res.json["total"] == "14500.00"
        assert world.stock(world.fabric_id) == Decimal("5.500")

    def test_discount_below_paid_is_refused(self, world):
        order = world.bespoke(client=world.owner, payments=[{"method": "cash", "amount": "13000.00"}]).json
        res = world.owner.patch(f"/api/orders/{order['id']}", {"discount": "1000.00"})
        assert res.status_code == 409
        assert res.json["error"]["code"] == "overpayment"


class TestVat:
    def test_vat_extracted_from_inclusive_price(self, world):
        world.owner.patch("/api/settings/shop", {"vat_registered": True, "vat_rate": "16"})
        res = world.owner.post("/api/orders", {
            "kind": "bespoke", "customer_id": str(world.customer_id),
            "items": [{"description": "Suit", "unit_price": "11600.00"}],
        })
        assert res.json["tax_amount"] == "1600.00"
        assert res.json["total"] == "11600.00"


class TestAuthLifecycle:
    def test_deactivated_user_is_locked_out_immediately(self, app, world):
        users = world.owner.get("/api/users").json["items"]
        cashier = next(u for u in users if u["role"] == "cashier")
        assert world.cashier.get("/api/customers").status_code == 200
        world.owner.patch(f"/api/users/{cashier['id']}", {"active": False})
        assert world.cashier.get("/api/customers").status_code == 401

    def test_password_change_invalidates_old_tokens(self, app, world):
        old = Api(app, "cashier@a.test")
        res = world.cashier.post("/api/auth/change-password", {"current_password": "password123", "new_password": "new-password-1"})
        assert res.status_code == 200
        assert old.get("/api/customers").status_code == 401

    def test_refresh_token_flow(self, app, world):
        res = world.cashier.client.post("/api/auth/refresh", headers={"Authorization": f"Bearer {world.cashier.refresh_token}"})
        assert res.status_code == 200
        # A refresh token isn't an access token.
        assert world.cashier.client.get("/api/customers", headers={"Authorization": f"Bearer {world.cashier.refresh_token}"}).status_code == 401

    def test_wrong_password_gives_generic_error(self, world):
        for email in ("owner@a.test", "nobody@nowhere.test"):
            res = world.anon.post("/api/auth/login", {"email": email, "password": "wrong"})
            assert res.status_code == 401
            assert res.json["error"]["message"] == "Wrong email or password."

    def test_garbage_token_is_401_not_500(self, world):
        res = world.anon.client.get("/api/customers", headers={"Authorization": "Bearer garbage"})
        assert res.status_code == 401

    def test_last_owner_cannot_be_removed(self, world):
        owner = next(u for u in world.owner.get("/api/users").json["items"] if u["role"] == "owner")
        res = world.owner.patch(f"/api/users/{owner['id']}", {"active": False})
        assert res.status_code == 409
        assert res.json["error"]["code"] == "last_owner"


class TestReports:
    def test_daily_cash_up_by_method(self, world):
        world.bespoke(payments=[
            {"method": "cash", "amount": "3000.00"},
            {"method": "mpesa", "amount": "2000.00", "reference": "SGK7QX2M9L"},
        ])
        order = world.bespoke(payments=[{"method": "cash", "amount": "1000.00"}]).json
        world.owner.post(f"/api/orders/{order['id']}/refunds", {"method": "cash", "amount": "400.00", "note": "Overcharged"})
        report = world.owner.get("/api/reports/daily").json
        methods = {m["method"]: m for m in report["by_method"]}
        assert methods["cash"]["received"] == "4000.00"
        assert methods["cash"]["refunded"] == "400.00"
        assert methods["cash"]["net"] == "3600.00"
        assert methods["mpesa"]["net"] == "2000.00"
        assert report["net_takings"] == "5600.00"

    def test_overview_finds_outstanding_and_low_stock(self, world):
        world.owner.patch(f"/api/inventory/{world.fabric_id}", {"reorder_level": "2"})
        world.bespoke(quantity="9.5")
        overview = world.owner.get("/api/reports/overview").json
        assert overview["outstanding_count"] == 1
        # 9.5 m x 1,000 + 10,000 labour = 19,500, less the 5,000 deposit.
        assert Decimal(overview["outstanding_total"]) == Decimal("14500.00")
        assert overview["low_stock"][0]["name"] == "Wool"

    def test_reports_do_not_cross_shops(self, world):
        world.bespoke()
        assert world.other_owner.get("/api/reports/daily").json["net_takings"] == "0.00"
        assert world.other_owner.get("/api/reports/overview").json["outstanding_count"] == 0
