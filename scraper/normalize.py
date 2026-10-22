"""Turn messy listing text into clean values (prices, dates, addresses)."""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional, Tuple

from . import config

_STREET_SUFFIXES = {
    "street": "st", "avenue": "ave", "av": "ave", "drive": "dr", "road": "rd",
    "crescent": "cres", "cr": "cres", "court": "crt", "ct": "crt", "boulevard": "blvd",
    "place": "pl", "lane": "ln", "terrace": "terr", "parkway": "pkwy", "circle": "cir",
    "square": "sq", "trail": "trl", "gate": "gt", "heights": "hts",
}
_DIRECTIONS = {"north": "n", "south": "s", "east": "e", "west": "w"}


def parse_price(text: str) -> Tuple[Optional[int], str]:
    """'$1150 per bdrm' -> (1150, 'per_room'); '$1,195' -> (1195, 'whole_unit')."""
    m = re.search(r"\$\s*([\d,]+)", text or "")
    if not m:
        return None, "unknown"
    amount = int(m.group(1).replace(",", ""))
    basis = "per_room" if re.search(r"per\s*(bdrm|bedroom|room)", text, re.I) else "whole_unit"
    return amount, basis


def per_person(price: Optional[int], basis: str, bedrooms: Optional[int]) -> Tuple[Optional[int], Optional[int]]:
    """Return (total_rent, price_per_person). Assumes one person per bedroom."""
    if price is None or not bedrooms:
        return None, None
    if basis == "per_room":
        return price * bedrooms, price
    return price, round(price / bedrooms)


def est_cost(price_per_person: Optional[int], utilities: str) -> Optional[int]:
    """Price per person plus the utilities estimate when utilities aren't included."""
    if price_per_person is None:
        return None
    if utilities == "yes":
        return price_per_person
    return price_per_person + config.UTILITIES_ESTIMATE_PER_PERSON


def parse_available(text: str) -> Optional[date]:
    """'Available May 1, 2027' -> date(2027, 5, 1). 'Available Immediately' -> None."""
    m = re.search(r"([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})", text or "")
    if not m:
        return None
    month = m.group(1)[:3].title()  # "September", "Sept", "sep" -> "Sep"
    try:
        return datetime.strptime(f"{month} {m.group(2)} {m.group(3)}", "%b %d %Y").date()
    except ValueError:
        return None


def parse_utilities(text: str) -> str:
    t = (text or "").strip().lower()
    if not t:
        return "unknown"
    if "not" in t or "extra" in t or "excluded" in t or t == "no":
        return "no"
    if "includ" in t or t == "yes":
        return "yes"
    return "unknown"


def parse_float(text: str) -> Optional[float]:
    m = re.search(r"\d+(?:\.\d+)?", text or "")
    return float(m.group()) if m else None


def parse_int(text: str) -> Optional[int]:
    m = re.search(r"\d+", text or "")
    return int(m.group()) if m else None


def has_house_number(address: str) -> bool:
    return bool(re.match(r"\s*(unit\s*\w+\s*[-,]?\s*|#\s*\w+\s*[-,]?\s*)?\d+", address or "", re.I))


def unit_of(address: str) -> Optional[str]:
    """'Unit 2 - 45 Western Rd' -> '2'; '3-45 Western Rd' -> '3'; '#B 45 Elm' -> 'b'; no unit -> None."""
    a = (address or "").lower()
    m = (re.search(r"\b(?:unit|apt|suite)\s*(\w+)", a) or re.search(r"#\s*(\w+)", a)
         or re.match(r"\s*(\w+)\s*-\s*\d", a))
    return m.group(1) if m else None


def normalize_address(address: str) -> str:
    """Make one comparable key per address so the same house from two sites merges.

    '1100 Sunset Street, London, ON' and '1100 sunset st.' both -> '1100 sunset st'.
    """
    a = (address or "").lower()
    a = a.split(",")[0]  # drop ", London, ON ..."
    a = re.sub(r"\b(unit|apt|suite)\s*\w+\b", " ", a)
    a = re.sub(r"#\s*\w+", " ", a)
    a = re.sub(r"^\s*\w+\s*-\s*(?=\d)", "", a)  # "3-123 Main" -> "123 Main"
    a = re.sub(r"[^\w\s]", " ", a)
    words = [_STREET_SUFFIXES.get(w, _DIRECTIONS.get(w, w)) for w in a.split()]
    return " ".join(words)
