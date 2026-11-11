from app.monitoring import _scrub


class TestMonitoring:
    def test_scrub_removes_personal_data(self):
        event = {
            "request": {
                "data": {"first_name": "Wanjiru", "phone": "+254722111222"},
                "cookies": {"session": "x"},
                "query_string": "q=0722",
                "headers": {"Authorization": "Bearer abc", "X-Agent-Token": "t", "User-Agent": "Chrome"},
            },
            "user": {"email": "owner@shop.test", "ip_address": "1.2.3.4"},
        }
        scrubbed = _scrub(event, None)
        assert "data" not in scrubbed["request"]
        assert "cookies" not in scrubbed["request"]
        assert "query_string" not in scrubbed["request"]
        assert scrubbed["request"]["headers"] == {"Authorization": "[removed]", "X-Agent-Token": "[removed]", "User-Agent": "Chrome"}
        assert "user" not in scrubbed

    def test_browser_errors_are_accepted_without_sign_in_and_size_capped(self, world):
        res = world.anon.client.post("/api/client-errors", json={"message": "x" * 5000, "stack": "at App", "path": "/sell"})
        assert res.status_code == 202
        assert world.anon.client.post("/api/client-errors", json={}).status_code == 400
