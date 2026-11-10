"""Order lifecycle rules. Each function runs inside the caller's transaction; the route commits."""
import re
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select, update

from ..errors import APIError, conflict, not_found
from ..extensions import db
from ..models import (
    Customer,
    Measurement,
    MovementReason,
    Order,
    OrderItem,
    OrderKind,
    OrderStatus,
    OrderStatusEvent,
    Payment,
    PaymentKind,
    PaymentMethod,
    Shop,
    User,
    UserRole,
)
from ..models.base import utcnow
from ..models.shop import audit
from .stock import apply_movement, lock_items

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
MPESA_RE = re.compile(r"^[A-Z0-9]{8,12}$")

S = OrderStatus
ALLOWED_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    S.DRAFT: {S.CONFIRMED, S.CANCELLED},
    S.CONFIRMED: {S.CUTTING, S.READY, S.CANCELLED},
    S.CUTTING: {S.CONFIRMED, S.STITCHING, S.CANCELLED},
    S.STITCHING: {S.CUTTING, S.FITTING, S.READY, S.CANCELLED},
    S.FITTING: {S.STITCHING, S.ALTERATIONS, S.READY, S.CANCELLED},
    S.ALTERATIONS: {S.FITTING, S.READY, S.CANCELLED},
    S.READY: {S.ALTERATIONS, S.FITTING, S.COMPLETED, S.CANCELLED},
    S.COMPLETED: {S.ALTERATIONS, S.CANCELLED},
    S.CANCELLED: set(),
}
WORKSHOP_STAGES = {S.CONFIRMED, S.CUTTING, S.STITCHING, S.FITTING, S.ALTERATIONS, S.READY}
# After cutting, the cloth is gone: a cancelled order doesn't put it back on the shelf by default.
RESTOCK_BY_DEFAULT = {S.DRAFT, S.CONFIRMED}


def round_money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def lock_order(shop_id, order_id) -> Order:
    order = db.session.scalars(
        select(Order)
        .where(Order.id == order_id, Order.shop_id == shop_id)
        # of=Order: Postgres cannot lock the nullable side of the joined customer/measurement loads.
        .with_for_update(of=Order)
        .execution_options(populate_existing=True)
    ).unique().one_or_none()
    if order is None:
        raise not_found("Order")
    return order


def _build_lines(shop: Shop, user: User, inputs, offline: bool, start_position: int = 0) -> list[OrderItem]:
    catalog = lock_items(shop.id, [i.inventory_item_id for i in inputs if i.inventory_item_id])
    lines = []
    for position, data in enumerate(inputs, start=start_position):
        item = None
        if data.inventory_item_id:
            item = catalog.get(data.inventory_item_id)
            if item is None:
                raise APIError(422, "unknown_item", "An item in this order no longer exists.")
            if item.archived and not offline:
                raise conflict("item_archived", f"{item.name} is no longer sold.")
        description = data.description or (item.name if item else None)
        if not description:
            raise APIError(422, "validation_error", "Each line needs a description.")
        unit_price = data.unit_price
        if unit_price is None:
            if item is None:
                raise APIError(422, "validation_error", f"{description} needs a price.")
            unit_price = item.sell_price
        # Offline carts may hold a price that has since changed; that sale has already happened.
        if item and unit_price < item.sell_price and user.role != UserRole.OWNER and not offline:
            raise APIError(403, "price_override_forbidden", f"Only the owner can sell {item.name} below its listed price.")
        lines.append(
            OrderItem(
                shop_id=shop.id,
                inventory_item_id=item.id if item else None,
                position=position,
                description=description,
                unit=item.unit if item else None,
                quantity=data.quantity,
                unit_price=unit_price,
                line_total=round_money(data.quantity * unit_price),
                notes=data.notes,
            )
        )
    return lines


def recompute_totals(order: Order, shop: Shop) -> None:
    order.subtotal = sum((i.line_total for i in order.items), ZERO)
    if order.discount > order.subtotal:
        raise APIError(422, "invalid_discount", "Discount can't be more than the order value.")
    order.total = order.subtotal - order.discount
    if shop.vat_registered and shop.vat_rate:
        # Listed prices include VAT, as Kenyan retail prices normally do.
        order.tax_amount = round_money(order.total * shop.vat_rate / (100 + shop.vat_rate))
    else:
        order.tax_amount = ZERO


def required_deposit(order: Order, shop: Shop) -> Decimal:
    return round_money(order.total * shop.min_deposit_pct / 100)


def _commit_stock(order: Order, lines, user: User, allow_negative: bool) -> None:
    catalog = lock_items(order.shop_id, [l.inventory_item_id for l in lines if l.inventory_item_id])
    for line in sorted(lines, key=lambda l: str(l.inventory_item_id)):
        item = catalog.get(line.inventory_item_id)
        if item is not None and item.track_stock:
            apply_movement(
                item, -line.quantity, MovementReason.SALE,
                user_id=user.id, order_id=order.id, note=f"Order #{order.number}", allow_negative=allow_negative,
            )
    order.stock_committed = True


def _release_stock(order: Order, user: User) -> None:
    catalog = lock_items(order.shop_id, [l.inventory_item_id for l in order.items if l.inventory_item_id])
    for line in sorted(order.items, key=lambda l: str(l.inventory_item_id)):
        item = catalog.get(line.inventory_item_id)
        if item is not None and item.track_stock:
            apply_movement(item, line.quantity, MovementReason.ORDER_CANCELLED, user_id=user.id, order_id=order.id, note=f"Order #{order.number} cancelled")
    order.stock_committed = False


def _record_event(order: Order, from_status, to_status, user: User, note: str | None = None) -> None:
    db.session.add(
        OrderStatusEvent(shop_id=order.shop_id, order_id=order.id, from_status=from_status, to_status=to_status, note=note, user_id=user.id)
    )


def _check_reference(shop: Shop, user: User, method: PaymentMethod, reference: str | None, allow_duplicate: bool) -> str | None:
    if reference:
        reference = reference.strip().upper() if method == PaymentMethod.MPESA else reference.strip()
    if method != PaymentMethod.MPESA:
        return reference or None
    if not reference or not MPESA_RE.match(reference):
        raise APIError(422, "invalid_mpesa_reference", "Enter the M-Pesa confirmation code from the SMS, e.g. SGK7QX2M9L.")
    # Stops the same SMS being shown twice. One payment can legitimately cover two orders, so the owner may override.
    duplicate = db.session.scalar(
        select(Payment.id).where(
            Payment.shop_id == shop.id, Payment.reference == reference, Payment.kind == PaymentKind.PAYMENT
        ).limit(1)
    )
    if duplicate and not (allow_duplicate and user.role == UserRole.OWNER):
        raise conflict("duplicate_reference", f"M-Pesa code {reference} has already been recorded.")
    return reference


def _new_payment(order: Order, data, shop: Shop, user: User) -> Payment:
    reference = _check_reference(shop, user, data.method, data.reference, data.allow_duplicate_reference)
    if data.tendered is not None and data.tendered < data.amount:
        raise APIError(422, "invalid_tendered", "Cash tendered can't be less than the amount applied.")
    if data.tendered is not None and data.method != PaymentMethod.CASH:
        raise APIError(422, "invalid_tendered", "Tendered is only for cash payments.")
    payment = Payment(
        shop_id=shop.id,
        kind=PaymentKind.PAYMENT,
        method=data.method,
        amount=data.amount,
        tendered=data.tendered,
        reference=reference,
        note=data.note,
        received_by_id=user.id,
    )
    if data.id:
        payment.id = data.id
    order.payments.append(payment)
    return payment


def create_order(shop: Shop, user: User, data) -> tuple[Order, bool]:
    """Returns (order, created). Retrying the same client-generated id returns the first result."""
    if data.id:
        existing = db.session.get(Order, data.id)
        if existing is not None:
            if existing.shop_id != shop.id:
                raise conflict("id_conflict", "Order id already in use.")
            return existing, False

    if data.kind == OrderKind.BESPOKE and not data.customer_id:
        raise APIError(422, "customer_required", "A bespoke order needs a customer.")
    customer = None
    if data.customer_id:
        customer = db.session.get(Customer, data.customer_id)
        if customer is None or customer.shop_id != shop.id:
            raise APIError(422, "unknown_customer", "That customer doesn't exist.")
    measurement = _resolve_measurement(shop, customer, data.measurement_id)
    assignee = _resolve_assignee(shop, data.assigned_to_id)

    if data.discount and user.role != UserRole.OWNER:
        raise APIError(403, "discount_forbidden", "Only the owner can give a discount.")

    number = db.session.execute(
        update(Shop)
        .where(Shop.id == shop.id)
        .values(order_counter=Shop.order_counter + 1)
        .returning(Shop.order_counter)
        .execution_options(synchronize_session=False)
    ).scalar_one()

    order = Order(
        shop_id=shop.id,
        number=number,
        kind=data.kind,
        status=OrderStatus.DRAFT,
        customer=customer,
        measurement=measurement,
        assigned_to=assignee,
        created_by=user,
        due_date=data.due_date,
        notes=data.notes,
        created_offline=data.offline,
    )
    if data.id:
        order.id = data.id
    db.session.add(order)
    # Assigns the UUID default so stock movements and payments can reference the order.
    db.session.flush()

    order.items = _build_lines(shop, user, data.items, data.offline)
    # Set after the lines exist: the database requires discount <= subtotal on every flush.
    order.discount = data.discount
    recompute_totals(order, shop)

    paid = sum((p.amount for p in data.payments), ZERO)
    if paid > order.total:
        raise conflict("overpayment", f"Payments ({paid}) exceed the order total ({order.total}).")
    for payment in data.payments:
        if payment.id and db.session.get(Payment, payment.id) is not None:
            raise conflict("id_conflict", "Payment id already in use.")
        _new_payment(order, payment, shop, user)

    target = _initial_status(order, shop, user, data, paid)
    if target != OrderStatus.DRAFT:
        _commit_stock(order, order.items, user, allow_negative=data.offline)
        order.status = target
    if target == OrderStatus.COMPLETED:
        order.completed_at = utcnow()
    _record_event(order, None, order.status, user, "Created offline" if data.offline else None)
    audit(shop.id, user.id, "order.created", "order", order.id, number=number, total=str(order.total), offline=data.offline)
    db.session.flush()
    return order, True


def _initial_status(order: Order, shop: Shop, user: User, data, paid: Decimal) -> OrderStatus:
    if order.kind == OrderKind.RETAIL:
        if not data.confirm:
            return OrderStatus.DRAFT
        if paid < order.total:
            raise conflict("payment_required", "A retail sale must be paid in full.")
        return OrderStatus.COMPLETED
    if not data.confirm:
        return OrderStatus.DRAFT
    needed = required_deposit(order, shop)
    if paid >= needed or user.role == UserRole.OWNER:
        return OrderStatus.CONFIRMED
    if data.offline:
        # Keep the offline order instead of losing it. Staff will see it waiting as a draft.
        return OrderStatus.DRAFT
    raise conflict("deposit_required", f"A deposit of at least {needed} is required.", {"required": str(needed)})


def _resolve_measurement(shop: Shop, customer: Customer | None, measurement_id) -> Measurement | None:
    if not measurement_id:
        return None
    measurement = db.session.get(Measurement, measurement_id)
    if measurement is None or measurement.shop_id != shop.id:
        raise APIError(422, "unknown_measurement", "That measurement record doesn't exist.")
    if customer is None or measurement.customer_id != customer.id:
        raise APIError(422, "measurement_mismatch", "Those measurements belong to a different customer.")
    return measurement


def _resolve_assignee(shop: Shop, user_id) -> User | None:
    if not user_id:
        return None
    assignee = db.session.get(User, user_id)
    if assignee is None or assignee.shop_id != shop.id or not assignee.active:
        raise APIError(422, "unknown_user", "That staff member doesn't exist.")
    return assignee


def add_payment(shop: Shop, user: User, order_id, data) -> tuple[Order, Payment, bool]:
    if data.id:
        existing = db.session.get(Payment, data.id)
        if existing is not None:
            if existing.shop_id != shop.id or existing.order_id != order_id:
                raise conflict("id_conflict", "Payment id already in use.")
            return existing.order, existing, False

    order = lock_order(shop.id, order_id)
    if order.status == OrderStatus.CANCELLED:
        raise conflict("order_cancelled", "This order was cancelled.")
    if data.amount > order.balance:
        raise conflict(
            "overpayment",
            f"Payment of {data.amount} is more than the balance of {order.balance}.",
            {"balance": str(order.balance)},
        )
    payment = _new_payment(order, data, shop, user)
    audit(shop.id, user.id, "payment.recorded", "order", order.id, amount=str(data.amount), method=data.method.value)
    db.session.flush()

    # A draft becomes a real job as soon as its deposit is in.
    if order.status == OrderStatus.DRAFT and order.kind == OrderKind.BESPOKE and order.amount_paid >= required_deposit(order, shop):
        _commit_stock(order, order.items, user, allow_negative=False)
        _record_event(order, OrderStatus.DRAFT, OrderStatus.CONFIRMED, user, "Deposit received")
        order.status = OrderStatus.CONFIRMED
    elif order.status == OrderStatus.DRAFT and order.kind == OrderKind.RETAIL and order.balance <= 0:
        _commit_stock(order, order.items, user, allow_negative=False)
        _record_event(order, OrderStatus.DRAFT, OrderStatus.COMPLETED, user, "Paid in full")
        order.status = OrderStatus.COMPLETED
        order.completed_at = utcnow()
    return order, payment, True


def refund(shop: Shop, user: User, order_id, data) -> tuple[Order, Payment, bool]:
    if data.id:
        existing = db.session.get(Payment, data.id)
        if existing is not None:
            if existing.shop_id != shop.id or existing.order_id != order_id:
                raise conflict("id_conflict", "Payment id already in use.")
            return existing.order, existing, False
    order = lock_order(shop.id, order_id)
    payment = _refund_locked(order, user, data.amount, data.method, data.reference, data.note, data.id)
    return order, payment, True


def _refund_locked(order: Order, user: User, amount: Decimal, method, reference, note, payment_id=None) -> Payment:
    if amount > order.amount_paid:
        raise conflict("refund_too_large", f"Only {order.amount_paid} has been paid on this order.")
    payment = Payment(
        shop_id=order.shop_id,
        kind=PaymentKind.REFUND,
        method=method,
        amount=-amount,
        reference=reference,
        note=note,
        received_by_id=user.id,
    )
    if payment_id:
        payment.id = payment_id
    order.payments.append(payment)
    audit(order.shop_id, user.id, "payment.refunded", "order", order.id, amount=str(amount), method=method.value, note=note)
    db.session.flush()
    return payment


def transition(shop: Shop, user: User, order_id, data) -> Order:
    order = lock_order(shop.id, order_id)
    target = data.to_status

    # A retried or double-fired drag lands here harmlessly.
    if order.status == target:
        return order
    if target == OrderStatus.CANCELLED:
        raise APIError(422, "use_cancel", "Cancel an order through the cancel action.")
    if order.kind == OrderKind.RETAIL:
        raise conflict("invalid_transition", "Retail sales don't go through the workshop.")
    if data.from_status and order.status != data.from_status:
        raise conflict(
            "stale_status",
            f"Order #{order.number} has already moved to {order.status.value}.",
            {"current_status": order.status.value},
        )
    if target not in ALLOWED_TRANSITIONS[order.status]:
        raise conflict("invalid_transition", f"Can't move an order from {order.status.value} to {target.value}.")

    if user.role == UserRole.TAILOR and not (order.status in WORKSHOP_STAGES and target in WORKSHOP_STAGES):
        raise APIError(403, "forbidden", "Only front-desk staff can do that.")
    if order.status == OrderStatus.COMPLETED and user.role != UserRole.OWNER:
        raise APIError(403, "forbidden", "Only the owner can reopen a collected order.")

    if order.status == OrderStatus.DRAFT and target == OrderStatus.CONFIRMED:
        needed = required_deposit(order, shop)
        owner_override = data.allow_low_deposit and user.role == UserRole.OWNER
        if order.amount_paid < needed and not owner_override:
            raise conflict("deposit_required", f"A deposit of at least {needed} is required.", {"required": str(needed)})
        _commit_stock(order, order.items, user, allow_negative=False)

    if target == OrderStatus.COMPLETED:
        if order.balance > 0 and not (data.allow_outstanding_balance and user.role == UserRole.OWNER):
            raise conflict(
                "balance_outstanding",
                f"Collect the balance of {order.balance} before handing over.",
                {"balance": str(order.balance)},
            )
        if order.balance > 0:
            audit(shop.id, user.id, "order.released_on_credit", "order", order.id, balance=str(order.balance))
        order.completed_at = utcnow()
    elif order.status == OrderStatus.COMPLETED:
        order.completed_at = None

    _record_event(order, order.status, target, user, data.note)
    order.status = target
    return order


def cancel(shop: Shop, user: User, order_id, data) -> Order:
    order = lock_order(shop.id, order_id)
    if order.status == OrderStatus.CANCELLED:
        return order
    if order.status == OrderStatus.COMPLETED and order.kind != OrderKind.RETAIL:
        raise conflict("invalid_transition", "A collected bespoke order can't be cancelled. Record a refund instead.")

    paid = order.amount_paid
    if (paid > 0 or order.status == OrderStatus.COMPLETED) and user.role != UserRole.OWNER:
        raise APIError(403, "forbidden", "Only the owner can cancel an order with payments.")
    if paid > 0:
        if data.paid_handling is None:
            raise conflict(
                "paid_handling_required",
                f"{paid} has been paid on this order. Choose whether to refund or retain it.",
                {"amount_paid": str(paid)},
            )
        if data.paid_handling == "refund":
            if data.refund_method is None:
                raise APIError(422, "validation_error", "Choose how the refund is paid.")
            _refund_locked(order, user, paid, data.refund_method, data.refund_reference, f"Cancelled: {data.reason}")

    if order.stock_committed:
        should_restock = data.restock if data.restock is not None else (
            order.status in RESTOCK_BY_DEFAULT or order.kind == OrderKind.RETAIL
        )
        if should_restock:
            _release_stock(order, user)

    _record_event(order, order.status, OrderStatus.CANCELLED, user, data.reason)
    order.status = OrderStatus.CANCELLED
    order.cancel_reason = data.reason
    audit(shop.id, user.id, "order.cancelled", "order", order.id, reason=data.reason, paid=str(paid), paid_handling=data.paid_handling)
    return order


def add_items(shop: Shop, user: User, order_id, data) -> Order:
    order = lock_order(shop.id, order_id)
    if order.status in (OrderStatus.COMPLETED, OrderStatus.CANCELLED):
        raise conflict("order_closed", "This order is closed.")
    lines = _build_lines(shop, user, data.items, offline=False, start_position=len(order.items))
    order.items.extend(lines)
    recompute_totals(order, shop)
    if order.stock_committed:
        _commit_stock(order, lines, user, allow_negative=False)
    audit(shop.id, user.id, "order.items_added", "order", order.id, count=len(lines), total=str(order.total))
    return order


def update_order(shop: Shop, user: User, order_id, data) -> Order:
    order = lock_order(shop.id, order_id)
    fields = data.model_fields_set
    if "notes" in fields:
        order.notes = data.notes
    if "due_date" in fields:
        order.due_date = data.due_date
    if "assigned_to_id" in fields:
        order.assigned_to = _resolve_assignee(shop, data.assigned_to_id)
    if "measurement_id" in fields and data.measurement_id != order.measurement_id:
        # Once cloth is cut, the job stays tied to the fitting it was cut from.
        if order.status not in (OrderStatus.DRAFT, OrderStatus.CONFIRMED):
            raise conflict("measurement_locked", "Measurements are locked once cutting has started.")
        order.measurement = _resolve_measurement(shop, order.customer, data.measurement_id)
        audit(shop.id, user.id, "order.measurement_changed", "order", order.id, measurement_id=str(data.measurement_id))
    if "discount" in fields and data.discount is not None and data.discount != order.discount:
        if user.role != UserRole.OWNER:
            raise APIError(403, "discount_forbidden", "Only the owner can give a discount.")
        if order.status in (OrderStatus.COMPLETED, OrderStatus.CANCELLED):
            raise conflict("order_closed", "This order is closed.")
        order.discount = data.discount
        recompute_totals(order, shop)
        if order.amount_paid > order.total:
            raise conflict("overpayment", "Customer has paid more than the new total. Refund the difference first.")
        audit(shop.id, user.id, "order.discount_changed", "order", order.id, discount=str(data.discount))
    return order
