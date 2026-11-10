"""ESC/POS document rendering. Pure functions from order data to printer bytes, with no I/O."""
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

ESC = b"\x1b"
GS = b"\x1d"

_UNICODE_FALLBACKS = str.maketrans({
    "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"',
    "…": "...", " ": " ", "−": "-",
})


def clean(text) -> str:
    """Removes control characters. A customer name must never be able to inject printer commands."""
    text = str(text if text is not None else "").translate(_UNICODE_FALLBACKS)
    return "".join(ch if ch.isprintable() else " " for ch in text)


def fmt_money(value, currency: str = "KES") -> str:
    return f"{currency} {Decimal(value):,.2f}"


def fmt_qty(value) -> str:
    text = f"{Decimal(value):f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def wrap(text: str, width: int) -> list[str]:
    lines, current = [], ""
    for word in clean(text).split():
        while len(word) > width:
            if current:
                lines.append(current)
                current = ""
            lines.append(word[:width])
            word = word[width:]
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= width:
            current += " " + word
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


class Ticket:
    def __init__(self, width: int = 42):
        self.width = width
        self.buf = bytearray()
        self.buf += ESC + b"@"       # initialize
        self.buf += ESC + b"t\x00"   # code page CP437, matching the encoding below

    def _write(self, text: str) -> None:
        self.buf += text.encode("cp437", errors="replace")

    def line(self, text: str = "") -> "Ticket":
        self._write(clean(text)[: self.width] + "\n")
        return self

    def wrapped(self, text: str) -> "Ticket":
        for part in wrap(text, self.width):
            self.line(part)
        return self

    def center(self) -> "Ticket":
        self.buf += ESC + b"a\x01"
        return self

    def left(self) -> "Ticket":
        self.buf += ESC + b"a\x00"
        return self

    def bold(self, on: bool = True) -> "Ticket":
        self.buf += ESC + b"E" + (b"\x01" if on else b"\x00")
        return self

    def large(self, on: bool = True) -> "Ticket":
        self.buf += GS + b"!" + (b"\x11" if on else b"\x00")
        return self

    def rule(self) -> "Ticket":
        return self.line("-" * self.width)

    def columns(self, left: str, right: str) -> "Ticket":
        left, right = clean(left), clean(right)
        room = self.width - len(right) - 1
        if room < 1:
            return self.line(left).line(right.rjust(self.width))
        parts = wrap(left, room)
        for part in parts[:-1]:
            self.line(part)
        return self.line(parts[-1].ljust(room) + " " + right)

    def cut(self) -> bytes:
        self.buf += ESC + b"d\x03"      # feed past the cutter
        self.buf += GS + b"V\x42\x00"   # partial cut, on models with or without an auto-cutter
        return bytes(self.buf)


def _header(ticket: Ticket, shop) -> None:
    ticket.center().bold().wrapped(shop.name).bold(False)
    for value in (shop.address, shop.phone):
        if value:
            ticket.wrapped(value)
    if shop.kra_pin:
        ticket.line(f"PIN: {shop.kra_pin}")
    ticket.left().line()


def _local_time(shop, value: datetime) -> str:
    return value.astimezone(ZoneInfo(shop.timezone)).strftime("%d %b %Y %H:%M")


METHOD_LABELS = {"cash": "Cash", "mpesa": "M-Pesa", "card": "Card", "bank": "Bank", "other": "Other"}


def build_receipt(shop, order) -> bytes:
    t = Ticket(shop.printer_width)
    cur = shop.currency
    _header(t, shop)
    t.columns("Receipt", f"#{order.number}")
    t.line(_local_time(shop, order.created_at))
    if order.customer:
        t.wrapped(f"Customer: {order.customer.full_name}")
        if order.customer.phone:
            t.line(f"Phone: {order.customer.phone}")
    if order.created_by:
        t.wrapped(f"Served by: {order.created_by.name}")
    t.rule()
    for item in order.items:
        t.wrapped(item.description)
        unit = f" {item.unit}" if item.unit else ""
        t.columns(f"  {fmt_qty(item.quantity)}{unit} x {Decimal(item.unit_price):,.2f}", f"{Decimal(item.line_total):,.2f}")
    t.rule()
    if order.discount:
        t.columns("Subtotal", fmt_money(order.subtotal, cur))
        t.columns("Discount", "-" + fmt_money(order.discount, cur))
    t.bold().columns("TOTAL", fmt_money(order.total, cur)).bold(False)
    if shop.vat_registered and order.tax_amount:
        t.columns(f"Includes VAT {fmt_qty(shop.vat_rate)}%", fmt_money(order.tax_amount, cur))
    t.line()
    for pay in order.payments:
        label = METHOD_LABELS.get(pay.method.value, pay.method.value)
        if pay.kind.value == "refund":
            label = f"Refund ({label})"
        if pay.reference:
            label += f" {pay.reference}"
        t.columns(label, fmt_money(pay.amount, cur))
        if pay.change_given:
            t.columns("  Change", fmt_money(pay.change_given, cur))
    t.columns("Paid", fmt_money(order.amount_paid, cur))
    if order.balance > 0:
        t.line()
        t.bold().large().center().line("BALANCE DUE").line(fmt_money(order.balance, cur)).large(False).bold(False).left()
    else:
        t.bold().columns("Balance", fmt_money(0, cur)).bold(False)
    if order.due_date:
        t.line()
        t.bold().line(f"Collection: {order.due_date.strftime('%a %d %b %Y')}").bold(False)
    t.line()
    t.center()
    if shop.receipt_footer:
        t.wrapped(shop.receipt_footer)
    else:
        t.line("Thank you")
    t.left()
    return t.cut()


def build_job_card(shop, order, labels: dict[str, str] | None = None) -> bytes:
    """Workshop ticket: what to make and the exact measurements. No prices."""
    labels = labels or {}
    t = Ticket(shop.printer_width)
    t.center().bold().large().line(f"JOB #{order.number}").large(False).bold(False).left().line()
    if order.customer:
        t.bold().wrapped(order.customer.full_name).bold(False)
    if order.due_date:
        t.bold().line(f"Due: {order.due_date.strftime('%a %d %b %Y')}").bold(False)
    if order.assigned_to:
        t.wrapped(f"Tailor: {order.assigned_to.name}")
    t.rule()
    for item in order.items:
        unit = f" {item.unit}" if item.unit else ""
        t.wrapped(f"{fmt_qty(item.quantity)}{unit}  {item.description}")
        if item.notes:
            for part in wrap(item.notes, t.width - 2):
                t.line("  " + part)
    if order.notes:
        t.rule().wrapped(order.notes)
    if order.measurement:
        m = order.measurement
        t.rule()
        t.bold().line(f"MEASUREMENTS ({m.unit})").bold(False)
        t.line(f"Taken {_local_time(shop, m.recorded_at)}")
        for key, value in m.values.items():
            t.columns(labels.get(key, key.replace("_", " ").capitalize()), fmt_qty(value))
        if m.notes:
            t.wrapped(m.notes)
    return t.cut()


def build_test_page(shop) -> bytes:
    t = Ticket(shop.printer_width)
    _header(t, shop)
    t.center().bold().line("PRINTER TEST").bold(False).left().rule()
    t.columns("Left column", "Right column")
    t.line("0123456789" * (t.width // 10))
    t.bold().line("Bold text").bold(False)
    return t.cut()
