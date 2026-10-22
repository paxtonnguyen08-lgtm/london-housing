"""Build the swipe card's rundown: short highlight and heads-up bullets from a description.

Only these bullets are ever saved. The description itself (which often has landlord phone
numbers and emails) is thrown away, because data/listings.json is public.
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

from . import config

MAX_HIGHLIGHTS = 4
MAX_HEADS_UP = 3

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_PHONE = re.compile(r"(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}")
_URL = re.compile(r"(https?://|www\.)\S+", re.I)
_NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7}


def clean(text: str) -> str:
    """Remove contact details and links, and tidy whitespace."""
    text = _EMAIL.sub("", text or "")
    text = _URL.sub("", text)
    text = _PHONE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def count_baths(text: str) -> Optional[float]:
    """'2 full bathrooms' -> 2.0, 'two baths' -> 2.0, '1.5 bath' -> 1.5."""
    m = re.search(r"\b(\d(?:\.5)?|one|two|three|four|five|six|seven)[\s-]+(?:full\s+|private\s+)?(?:bath|bathroom|washroom)s?\b",
                  text or "", re.I)
    if not m:
        return None
    word = m.group(1).lower()
    return float(_NUMBER_WORDS.get(word, word))


def is_furnished(text: str, amenities: List[str]) -> Optional[bool]:
    if any("furni" in a.lower() for a in amenities):
        return True
    t = (text or "").lower()
    if re.search(r"\bunfurnished\b", t):
        return False
    if re.search(r"\b(fully |partially |partly )?furnished\b", t):
        return True
    return None


def build(description: str, amenities: List[str], utilities: str, bedrooms: Optional[int],
          baths: Optional[float], price_assumed: bool = False,
          price_unclear: bool = False) -> Tuple[List[str], List[str]]:
    """Return (highlights, heads_up) for one listing."""
    text = clean(description)
    low = text.lower()
    amen = " ".join(amenities).lower()
    highlights: List[str] = []
    heads_up: List[str] = []

    def add(bucket: List[str], item: str) -> None:
        if item not in bucket:
            bucket.append(item)

    # Highlights, most useful first
    if re.search(r"\bfully furnished\b", low):
        add(highlights, "Fully furnished")
    elif is_furnished(text, amenities):
        add(highlights, "Furnished")
    if re.search(r"\ben[\s-]?suite", low):
        add(highlights, "Ensuite bathrooms")
    elif baths and baths >= 2:
        add(highlights, f"{baths:g} bathrooms")
    if utilities == "yes":
        add(highlights, "Utilities included")
    walk = re.search(r"(\d+)[\s-]*(?:minute|min)s?\s+walk\s+to\s+([A-Z][\w&' ]{2,30}?)(?=\s*(?:[.,;!(]|and\b|$))", text)
    if walk:
        add(highlights, f"{walk.group(1)} min walk to {walk.group(2).strip()}")
    if re.search(r"\bparking\b", low) and not re.search(r"\bno parking\b", low) or "parking" in amen:
        add(highlights, "Parking")
    if "laundry" in amen or re.search(r"\b(laundry|washer)\b", low):
        add(highlights, "Laundry")
    if re.search(r"\b(internet|wi-?fi)\b[^.]{0,40}\binclud", low):
        add(highlights, "Internet included")
    if "dishwasher" in amen or "dishwasher" in low:
        add(highlights, "Dishwasher")
    if "a/c" in amen or re.search(r"\b(a/c|air condition)", low):
        add(highlights, "Air conditioning")

    # Heads-ups, most important first
    if re.search(r"damage deposit|security deposit", low):
        add(heads_up, "Asks for a damage/security deposit (not allowed in Ontario)")
    mixed = re.search(r"\b(?:fe)?male\s*(?:or|and|&|/)\s*(?:fe)?male\b|\bco-?ed\b|\ball genders\b|\bany gender\b", low)
    gender = None if mixed else re.search(
        r"\b(male|female)\s+(?:students?|tenants?|only)|(?:seeking|looking for)[^.]{0,60}\b(male|female)\b", low)
    if gender:
        add(heads_up, f"{(gender.group(1) or gender.group(2)).title()} tenants only")
    if re.search(r"\bbasement\b[^.]{0,40}\bbed|\bbed\w*[^.]{0,40}\bin the basement\b", low):
        add(heads_up, "Some bedrooms in the basement")
    if re.search(r"invit(e|ation) only|by invite", low):
        add(heads_up, "Viewings by invite only")
    if price_assumed:
        add(heads_up, "Price didn't say per bedroom; assumed per room")
    if price_unclear:
        add(heads_up, "Cheap for the whole place; price may be per person. Check the ad")
    if utilities in ("no", "unknown"):
        add(heads_up, f"Utilities extra (about ${config.UTILITIES_ESTIMATE_PER_PERSON}/person)" if utilities == "no"
            else "Utilities not stated")
    if baths == 1 and bedrooms and bedrooms >= 4:
        add(heads_up, f"1 bathroom for {bedrooms} people")
    if re.search(r"\bno parking\b", low):
        add(heads_up, "No parking")

    return highlights[:MAX_HIGHLIGHTS], heads_up[:MAX_HEADS_UP]
