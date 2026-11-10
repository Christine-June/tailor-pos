"""Request validation. Money and quantities are Decimals, parsed from the strings the client sends."""
import re
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from flask import request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .errors import APIError
from .models import ItemKind, MovementReason, OrderKind, OrderStatus, PaymentMethod, PrinterMode, UserRole

Money = Annotated[Decimal, Field(max_digits=12, decimal_places=2, ge=0, allow_inf_nan=False)]
PositiveMoney = Annotated[Decimal, Field(max_digits=12, decimal_places=2, gt=0, allow_inf_nan=False)]
Quantity = Annotated[Decimal, Field(max_digits=12, decimal_places=3, gt=0, allow_inf_nan=False)]
Stock = Annotated[Decimal, Field(max_digits=12, decimal_places=3, allow_inf_nan=False)]
Percent = Annotated[Decimal, Field(max_digits=5, decimal_places=2, ge=0, le=100, allow_inf_nan=False)]

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
FIELD_KEY_RE = re.compile(r"^[a-z0-9_]{1,40}$")


class Schema(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)


def normalize_phone(raw: str | None) -> str | None:
    """Stores Kenyan numbers as +254..., so 0712... and 254712... find the same customer."""
    if raw is None:
        return None
    phone = re.sub(r"[\s\-().]", "", raw)
    if not phone:
        return None
    if re.fullmatch(r"0[17]\d{8}", phone):
        phone = "+254" + phone[1:]
    elif re.fullmatch(r"254[17]\d{8}", phone):
        phone = "+" + phone
    elif re.fullmatch(r"[17]\d{8}", phone):
        phone = "+254" + phone
    if not re.fullmatch(r"\+?\d{7,15}", phone):
        raise ValueError("Enter a valid phone number, e.g. 0712 345 678")
    return phone


def _clean_email(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip().lower()
    if not EMAIL_RE.match(value):
        raise ValueError("Enter a valid email address")
    return value


class LoginIn(Schema):
    email: str = Field(max_length=120)
    password: str = Field(max_length=200)


class ChangePasswordIn(Schema):
    current_password: str = Field(max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


class CustomerIn(Schema):
    id: UUID | None = None
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(default="", max_length=50)
    phone: str | None = None
    email: str | None = None
    notes: str | None = Field(default=None, max_length=2000)
    allow_duplicate_phone: bool = False

    _phone = field_validator("phone")(normalize_phone)
    _email = field_validator("email")(_clean_email)


class CustomerPatch(Schema):
    first_name: str | None = Field(default=None, min_length=1, max_length=50)
    last_name: str | None = Field(default=None, max_length=50)
    phone: str | None = None
    email: str | None = None
    notes: str | None = Field(default=None, max_length=2000)
    archived: bool | None = None
    allow_duplicate_phone: bool = False

    _phone = field_validator("phone")(normalize_phone)
    _email = field_validator("email")(_clean_email)


class MeasurementIn(Schema):
    id: UUID | None = None
    unit: Literal["in", "cm"] = "in"
    values: dict[str, Decimal]
    label: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("values")
    @classmethod
    def _check_values(cls, values: dict[str, Decimal]) -> dict[str, Decimal]:
        if not values:
            raise ValueError("Enter at least one measurement")
        for key, value in values.items():
            if not FIELD_KEY_RE.match(key):
                raise ValueError(f"Invalid measurement name: {key}")
            if not value.is_finite() or value <= 0 or value >= 1000:
                raise ValueError(f"{key} must be between 0 and 1000")
        return values


class InventoryIn(Schema):
    id: UUID | None = None
    sku: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    kind: ItemKind = ItemKind.RETAIL
    category: str | None = Field(default=None, max_length=60)
    unit: str = Field(default="pcs", min_length=1, max_length=10)
    sell_price: Money = Decimal("0")
    cost_price: Money = Decimal("0")
    track_stock: bool = True
    opening_quantity: Stock = Decimal("0")
    reorder_level: Stock = Decimal("0")


class InventoryPatch(Schema):
    sku: str | None = Field(default=None, max_length=40)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: ItemKind | None = None
    category: str | None = Field(default=None, max_length=60)
    unit: str | None = Field(default=None, min_length=1, max_length=10)
    sell_price: Money | None = None
    cost_price: Money | None = None
    track_stock: bool | None = None
    reorder_level: Stock | None = None
    archived: bool | None = None


class StockAdjustIn(Schema):
    reason: MovementReason
    # Exactly one: a signed change, or the physically counted quantity.
    delta: Stock | None = None
    counted_quantity: Stock | None = None
    note: str | None = Field(default=None, max_length=300)

    @field_validator("reason")
    @classmethod
    def _manual_reasons(cls, value: MovementReason) -> MovementReason:
        if value in (MovementReason.SALE, MovementReason.ORDER_CANCELLED):
            raise ValueError("That reason is recorded automatically by orders")
        return value


class OrderItemIn(Schema):
    inventory_item_id: UUID | None = None
    description: str | None = Field(default=None, max_length=200)
    quantity: Quantity = Decimal("1")
    unit_price: Money | None = None
    notes: str | None = Field(default=None, max_length=2000)


class PaymentIn(Schema):
    id: UUID | None = None
    method: PaymentMethod
    amount: PositiveMoney
    tendered: Money | None = None
    reference: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=300)
    allow_duplicate_reference: bool = False


class OrderIn(Schema):
    id: UUID | None = None
    kind: OrderKind = OrderKind.BESPOKE
    customer_id: UUID | None = None
    measurement_id: UUID | None = None
    assigned_to_id: UUID | None = None
    items: list[OrderItemIn] = Field(min_length=1, max_length=200)
    discount: Money = Decimal("0")
    due_date: date | None = None
    notes: str | None = Field(default=None, max_length=4000)
    payments: list[PaymentIn] = Field(default_factory=list, max_length=20)
    confirm: bool = True
    offline: bool = False


class OrderPatch(Schema):
    measurement_id: UUID | None = None
    assigned_to_id: UUID | None = None
    due_date: date | None = None
    notes: str | None = Field(default=None, max_length=4000)
    discount: Money | None = None


class AddItemsIn(Schema):
    items: list[OrderItemIn] = Field(min_length=1, max_length=50)


class TransitionIn(Schema):
    to_status: OrderStatus
    from_status: OrderStatus | None = None
    note: str | None = Field(default=None, max_length=300)
    allow_outstanding_balance: bool = False
    allow_low_deposit: bool = False


class RefundIn(Schema):
    id: UUID | None = None
    method: PaymentMethod
    amount: PositiveMoney
    reference: str | None = Field(default=None, max_length=40)
    note: str = Field(min_length=3, max_length=300)


class CancelIn(Schema):
    reason: str = Field(min_length=3, max_length=300)
    paid_handling: Literal["refund", "retain"] | None = None
    refund_method: PaymentMethod | None = None
    refund_reference: str | None = Field(default=None, max_length=40)
    restock: bool | None = None


class ShopPatch(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=120)
    kra_pin: str | None = Field(default=None, max_length=20)
    receipt_footer: str | None = Field(default=None, max_length=300)
    timezone: str | None = Field(default=None, max_length=50)
    vat_registered: bool | None = None
    vat_rate: Percent | None = None
    min_deposit_pct: Percent | None = None
    measurement_unit: Literal["in", "cm"] | None = None
    printer_mode: PrinterMode | None = None
    printer_host: str | None = Field(default=None, max_length=120)
    printer_port: int | None = Field(default=None, ge=1, le=65535)
    printer_width: Literal[32, 42, 48] | None = None


class UserIn(Schema):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(max_length=120)
    password: str = Field(min_length=8, max_length=200)
    role: UserRole = UserRole.CASHIER

    _email = field_validator("email")(_clean_email)


class UserPatch(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    role: UserRole | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=200)


class AgentAckIn(Schema):
    ok: bool
    error: str | None = Field(default=None, max_length=300)


def parse(schema: type[Schema]):
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise APIError(400, "invalid_json", "Request body must be a JSON object")
    try:
        return schema.model_validate(body)
    except ValidationError as err:
        details = [
            {"field": ".".join(str(p) for p in e["loc"]), "message": e["msg"].removeprefix("Value error, ")}
            for e in err.errors()
        ]
        first = details[0]
        raise APIError(422, "validation_error", f"{first['field']}: {first['message']}", details) from None
