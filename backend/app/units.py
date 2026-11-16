"""Units an item is sold in. Stored as a short code, printed as words ("2 pieces", "1.5 metres").

Pieces, sets, pairs, rolls and jobs can't be split, so their quantities must be whole numbers.
"""
from decimal import Decimal

# code: (one, many, whole numbers only)
UNITS: dict[str, tuple[str, str, bool]] = {
    "pcs": ("piece", "pieces", True),
    "m": ("metre", "metres", False),
    "yd": ("yard", "yards", False),
    "set": ("set", "sets", True),
    "pair": ("pair", "pairs", True),
    "roll": ("roll", "rolls", True),
    "job": ("job", "jobs", True),
}

ALIASES = {
    "pc": "pcs", "piece": "pcs", "pieces": "pcs", "metre": "m", "metres": "m", "meter": "m", "meters": "m",
    "yard": "yd", "yards": "yd", "sets": "set", "pairs": "pair", "rolls": "roll", "jobs": "job",
}

DEFAULT_FOR_KIND = {"fabric": "m", "trim": "pcs", "retail": "pcs", "service": "job"}


def normalize_unit(value: str) -> str:
    key = value.strip().lower()
    key = ALIASES.get(key, key)
    if key not in UNITS:
        raise ValueError("Choose a unit: pieces, metres, yards, sets, pairs, rolls or jobs")
    return key


def is_whole_unit(code: str | None) -> bool:
    return bool(code) and UNITS.get(code, ("", "", False))[2]


def unit_word(code: str | None, quantity) -> str:
    if not code:
        return ""
    if code not in UNITS:
        return code
    one, many, _ = UNITS[code]
    return one if abs(Decimal(quantity)) == 1 else many


def whole_problem(quantity, code: str | None, name: str) -> str | None:
    """The message to show when a split quantity is used with a whole-number unit, else None."""
    if quantity is None or not is_whole_unit(code):
        return None
    if Decimal(quantity) == Decimal(quantity).to_integral_value():
        return None
    return f"{name} is counted in {UNITS[code][1]}, so use a whole number (1, 2, 3...)."
