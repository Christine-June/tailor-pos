"""Tests run against real PostgreSQL, with the schema built by the actual migrations."""
import os
import uuid
from decimal import Decimal

import pytest
from flask_migrate import upgrade
from sqlalchemy import text
from werkzeug.security import generate_password_hash

from app import create_app
from app.extensions import db
from app.models import Customer, InventoryItem, ItemKind, Shop, User, UserRole

# Production uses scrypt, which is deliberately slow; fixtures shouldn't pay that on every test.
FAST_HASH = generate_password_hash("password123", method="pbkdf2:sha256:1")


@pytest.fixture(scope="session")
def app():
    application = create_app({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": os.environ["TEST_DATABASE_URL"],
        "RATELIMIT_ENABLED": False,
        "ALLOW_DIRECT_PRINT": True,
    })
    with application.app_context():
        upgrade()
    yield application


@pytest.fixture(autouse=True)
def clean_db(app):
    with app.app_context():
        tables = ", ".join(t.name for t in db.metadata.sorted_tables)
        db.session.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        db.session.commit()
    yield


class Api:
    """Test client that signs in as one user and sends JSON."""

    def __init__(self, app, email=None, password="password123"):
        self.client = app.test_client()
        self.token = None
        if email:
            res = self.client.post("/api/auth/login", json={"email": email, "password": password})
            assert res.status_code == 200, res.json
            self.token = res.json["access_token"]
            self.refresh_token = res.json["refresh_token"]

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def get(self, path, **kw):
        return self.client.get(path, headers=self._headers(), **kw)

    def post(self, path, json=None):
        return self.client.post(path, json=json if json is not None else {}, headers=self._headers())

    def patch(self, path, json=None):
        return self.client.patch(path, json=json or {}, headers=self._headers())


class World:
    """Two shops, so every test can also check that data doesn't leak between tenants."""

    def __init__(self, app):
        self.app = app
        with app.app_context():
            self.shop_id = self._shop("Shop A", "a")
            self.other_shop_id = self._shop("Shop B", "b")
            self.fabric_id = self._item(self.shop_id, "Wool", ItemKind.FABRIC, "m", "1000.00", "10.000")
            self.tie_id = self._item(self.shop_id, "Tie", ItemKind.RETAIL, "pcs", "500.00", "5.000")
            self.labour_id = self._item(self.shop_id, "Suit labour", ItemKind.SERVICE, "job", "10000.00", "0", track=False)
            self.customer_id = self._customer(self.shop_id, "Jane", "+254712000001")
            self.other_customer_id = self._customer(self.other_shop_id, "Other", "+254712000002")
            db.session.commit()
        self.owner = Api(app, "owner@a.test")
        self.cashier = Api(app, "cashier@a.test")
        self.tailor = Api(app, "tailor@a.test")
        self.other_owner = Api(app, "owner@b.test")
        self.anon = Api(app)

    def _shop(self, name, key):
        shop = Shop(name=name)
        db.session.add(shop)
        db.session.flush()
        for role in UserRole:
            user = User(shop_id=shop.id, name=f"{role.value} {key}", email=f"{role.value}@{key}.test", role=role)
            user.password_hash = FAST_HASH
            db.session.add(user)
        return shop.id

    def _item(self, shop_id, name, kind, unit, price, qty, track=True):
        item = InventoryItem(
            shop_id=shop_id, name=name, kind=kind, unit=unit, sell_price=Decimal(price),
            quantity_on_hand=Decimal(qty), track_stock=track,
        )
        db.session.add(item)
        db.session.flush()
        return item.id

    def _customer(self, shop_id, name, phone):
        customer = Customer(shop_id=shop_id, first_name=name, phone=phone)
        db.session.add(customer)
        db.session.flush()
        return customer.id

    def stock(self, item_id) -> Decimal:
        with self.app.app_context():
            value = db.session.get(InventoryItem, item_id).quantity_on_hand
            db.session.rollback()
            return value

    def bespoke(self, client=None, payments=None, quantity="3.5", **overrides):
        """A suit: 3.5 m of wool (KES 3,500) plus labour (KES 10,000). Total 13,500."""
        body = {
            "kind": "bespoke",
            "customer_id": str(self.customer_id),
            "due_date": "2030-01-15",
            "items": [
                {"inventory_item_id": str(self.fabric_id), "quantity": quantity},
                {"inventory_item_id": str(self.labour_id)},
            ],
            "payments": payments if payments is not None else [{"method": "cash", "amount": "5000.00"}],
            **overrides,
        }
        return (client or self.cashier).post("/api/orders", body)


@pytest.fixture
def world(app):
    return World(app)


@pytest.fixture
def uid():
    return lambda: str(uuid.uuid4())
