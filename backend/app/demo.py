"""Two weeks of believable trading for the demo shop, so a prospect sees a dashboard that's alive.

Records are written directly with past timestamps (payments and history can't be edited after
insert, so the dates must be right the first time). Always the same data: the random generator
is seeded, which keeps demos and screenshots consistent.
"""
import random
import string
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from .extensions import db
from .models import (
    Customer,
    InventoryItem,
    ItemKind,
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
    StockMovement,
    User,
    UserRole,
)
from .schemas import normalize_phone

CENT = Decimal("0.01")

CUSTOMERS = [
    ("Wanjiru", "Kamau"), ("Otieno", "Odhiambo"), ("Amina", "Hassan"), ("Kiprono", "Cheruiyot"),
    ("Achieng", "Atieno"), ("Mwangi", "Njoroge"), ("Fatuma", "Ali"), ("Brian", "Mutua"),
    ("Grace", "Wambui"), ("Kevin", "Ouma"), ("Nyokabi", "Githinji"), ("Hassan", "Omar"),
]
FITTING = {"neck": "15.50", "shoulders": "18.00", "chest": "40.00", "waist": "34.00", "hips": "39.50", "sleeve_length": "25.00", "inseam": "31.00"}


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _mpesa_code(rng: random.Random, used: set[str]) -> str:
    while True:
        code = "T" + "".join(rng.choices(string.ascii_uppercase + string.digits, k=9))
        if code not in used:
            used.add(code)
            return code


def seed_history(shop: Shop, staff: dict[UserRole, User], days: int = 14) -> int:
    rng = random.Random(20261111)
    tz = ZoneInfo(shop.timezone)
    today = datetime.now(tz).date()
    owner, cashier, tailor = staff[UserRole.OWNER], staff[UserRole.CASHIER], staff[UserRole.TAILOR]

    def at(day: date, hour: int, minute: int) -> datetime:
        return datetime.combine(day, time(hour, minute), tzinfo=tz)

    # More customers, each with a fitting on record.
    customers = list(db.session.scalars(db.select(Customer).where(Customer.shop_id == shop.id)))
    known = {(c.first_name, c.last_name) for c in customers}
    for i, (first, last) in enumerate(CUSTOMERS):
        if (first, last) in known:
            continue
        c = Customer(shop_id=shop.id, first_name=first, last_name=last, phone=normalize_phone(f"07{rng.randint(10000000, 99999999)}"),
                     created_at=at(today - timedelta(days=days + 5 - i % 5), 10, 0))
        db.session.add(c)
        db.session.flush()
        db.session.add(Measurement(shop_id=shop.id, customer_id=c.id, unit="in", taken_by_id=tailor.id, label="First fitting",
                                   values=dict(FITTING), recorded_at=at(today - timedelta(days=days + 4 - i % 5), 11, 0)))
        customers.append(c)
    db.session.flush()
    fittings = {m.customer_id: m for m in db.session.scalars(db.select(Measurement).where(Measurement.shop_id == shop.id))}

    items = list(db.session.scalars(db.select(InventoryItem).where(InventoryItem.shop_id == shop.id)))
    by_kind = {k: [i for i in items if i.kind == k] for k in ItemKind}
    labour = [i for i in by_kind[ItemKind.SERVICE] if "labour" in i.name.lower()]
    alterations = [i for i in by_kind[ItemKind.SERVICE] if "labour" not in i.name.lower()]

    # Plenty of opening stock, dated before the history starts.
    for item in items:
        if item.track_stock:
            extra = Decimal(rng.choice([60, 80, 120])) if item.kind == ItemKind.FABRIC else Decimal(rng.choice([30, 40, 60]))
            item.quantity_on_hand += extra
            db.session.add(StockMovement(shop_id=shop.id, item_id=item.id, reason=MovementReason.PURCHASE, quantity_delta=extra,
                                         balance_after=item.quantity_on_hand, note="Opening stock", user_id=owner.id,
                                         created_at=at(today - timedelta(days=days + 1), 9, 0)))

    used_codes: set[str] = set()
    number = shop.order_counter
    created = 0

    def pay(order: Order, amount: Decimal, when: datetime, by: User) -> None:
        method = rng.choices([PaymentMethod.MPESA, PaymentMethod.CASH, PaymentMethod.CARD], weights=[55, 35, 10])[0]
        tendered = None
        if method == PaymentMethod.CASH:
            tendered = _money(((amount // 500) + (1 if amount % 500 else 0)) * 500)
        order.payments.append(Payment(shop_id=shop.id, kind=PaymentKind.PAYMENT, method=method, amount=amount, tendered=tendered,
                                      reference=_mpesa_code(rng, used_codes) if method == PaymentMethod.MPESA else None,
                                      received_by_id=by.id, created_at=when))

    def event(order: Order, frm, to, when: datetime, by: User) -> None:
        db.session.add(OrderStatusEvent(shop_id=shop.id, order_id=order.id, from_status=frm, to_status=to, user_id=by.id, created_at=when))

    for back in range(days - 1, -1, -1):
        day = today - timedelta(days=back)
        # Saturdays are busiest, Sundays quiet; today has only the morning so far.
        count = {5: rng.randint(8, 11), 6: rng.randint(2, 4)}.get(day.weekday(), rng.randint(4, 8))
        # A shop that is growing: this week runs about a third ahead of last week.
        if back < 7:
            count = round(count * 1.35) + 1
        if back == 0:
            count = max(3, count // 2)
        for _ in range(count):
            number += 1
            when = at(day, rng.randint(9, 17 if back else 11), rng.randint(0, 59))
            seller = rng.choice([cashier, cashier, owner])
            bespoke = rng.random() < 0.4 and labour
            lines: list[tuple[InventoryItem, Decimal]] = []
            if bespoke:
                lines.append((rng.choice(labour), Decimal(1)))
                lines.append((rng.choice(by_kind[ItemKind.FABRIC]), Decimal(rng.choice(["2.5", "3", "3.5", "4"]))))
                if rng.random() < 0.5:
                    lines.append((rng.choice(by_kind[ItemKind.TRIM]), Decimal(1)))
            else:
                pool = by_kind[ItemKind.RETAIL] + by_kind[ItemKind.TRIM] + alterations
                for item in rng.sample(pool, k=rng.randint(1, 2)):
                    lines.append((item, Decimal(rng.randint(1, 2)) if item.kind != ItemKind.SERVICE else Decimal(1)))
                if rng.random() < 0.25:
                    lines.append((rng.choice(by_kind[ItemKind.FABRIC]), Decimal(rng.choice(["1.5", "2", "2.75"]))))

            customer = rng.choice(customers) if bespoke or rng.random() < 0.4 else None
            order = Order(shop_id=shop.id, number=number, kind=OrderKind.BESPOKE if bespoke else OrderKind.RETAIL,
                          status=OrderStatus.CONFIRMED, customer=customer, created_by=seller, created_at=when,
                          measurement=fittings.get(customer.id) if bespoke and customer else None, stock_committed=True)
            db.session.add(order)
            db.session.flush()
            subtotal = Decimal("0.00")
            for position, (item, qty) in enumerate(lines):
                total = _money(qty * item.sell_price)
                subtotal += total
                order.items.append(OrderItem(shop_id=shop.id, inventory_item_id=item.id, position=position, description=item.name,
                                             unit=item.unit, quantity=qty, unit_price=item.sell_price, line_total=total))
                if item.track_stock:
                    item.quantity_on_hand -= qty
                    db.session.add(StockMovement(shop_id=shop.id, item_id=item.id, order_id=order.id, reason=MovementReason.SALE,
                                                 quantity_delta=-qty, balance_after=item.quantity_on_hand, note=f"Order #{number}",
                                                 user_id=seller.id, created_at=when))
            order.subtotal = order.total = subtotal
            order.discount = Decimal("0.00")
            order.tax_amount = Decimal("0.00")

            if not bespoke:
                pay(order, subtotal, when, seller)
                order.status = OrderStatus.COMPLETED
                order.completed_at = when
                event(order, None, OrderStatus.COMPLETED, when, seller)
            else:
                deposit = _money(subtotal * Decimal(rng.choice(["0.4", "0.5", "0.6", "1"])))
                pay(order, deposit, when, seller)
                order.due_date = day + timedelta(days=rng.randint(7, 12))
                order.assigned_to = tailor if rng.random() < 0.7 else None
                order.notes = rng.choice([None, "Slim fit", "Extra lining", "Side vents", "Customer brings buttons"])
                event(order, None, OrderStatus.CONFIRMED, when, seller)
                # Older jobs have moved further through the workshop.
                path = [OrderStatus.CUTTING, OrderStatus.STITCHING, OrderStatus.FITTING, OrderStatus.READY, OrderStatus.COMPLETED]
                steps = min(len(path), max(0, (back - 1) // 2 + rng.randint(-1, 1)))
                current, moment = OrderStatus.CONFIRMED, when
                for target in path[:steps]:
                    moment = moment + timedelta(hours=rng.randint(10, 30))
                    if moment.date() > today:
                        break
                    if target == OrderStatus.COMPLETED:
                        balance = subtotal - deposit
                        if balance > 0:
                            pay(order, balance, moment, rng.choice([cashier, owner]))
                        order.completed_at = moment
                    event(order, current, target, moment, tailor if target != OrderStatus.COMPLETED else cashier)
                    current = target
                order.status = current
            created += 1

    shop.order_counter = number
    db.session.flush()
    return created
