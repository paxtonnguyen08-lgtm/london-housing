"""Saving listings to data/listings.json: merging duplicates and tracking what's new."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set

from .models import Listing
from .normalize import has_house_number, normalize_address, unit_of


def load(path: Path) -> dict:
    path = Path(path)
    if path.exists():
        return json.loads(path.read_text())
    return {"last_run": None, "listings": []}


def load_rejected(path: Path) -> dict:
    """{source: {source_id: {"reasons", "price", "available", "marker", "rejected_on"}}}"""
    path = Path(path)
    return json.loads(path.read_text()) if path.exists() else {}


def save(path: Path, data: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def listing_key(listing: dict) -> str:
    """One site's listing number is always its own listing, even if the address matches another."""
    return f"{listing['source']}:{listing['source_id']}"


def address_key(listing: dict) -> Optional[str]:
    """For spotting the same place on two *different* sites. Includes the unit, so
    'Unit 2 - 45 Western Rd' and 'Unit 3 - 45 Western Rd' stay apart. Vague addresses
    with no house number ("Trott drive") never match anything."""
    title = listing["title"]
    if not has_house_number(title):
        return None
    unit = unit_of(title)
    return normalize_address(title) + (f" #{unit}" if unit else "")


def known_for(data: dict, source: str) -> Dict[str, dict]:
    """What we already saved from one source, by that source's listing id.

    (A listing merged in from a second site only lives in its record's `also_listed`, so
    that site will re-check its detail page each run. Fine until we have several sources.)
    """
    return {l["source_id"]: l for l in data["listings"] if l["source"] == source}


def merge(data: dict, fresh: Iterable[Listing], sources_run: Set[str], today: str) -> List[dict]:
    """Fold this run's listings into `data` (in place). Returns the listings that are new.

    - Seen before: keep first_seen, refresh everything else.
    - Same address as a listing from a different site: recorded on that listing's
      `also_listed` instead of becoming a second card.
    - Never seen: first_seen = today, is_new = True.
    - Saved but missing this run: active = False (kept, not deleted). Only for sources
      that ran without errors, so a site being down doesn't hide its listings.
    """
    existing = {l["key"]: l for l in data["listings"]}
    by_address = {address_key(l): l["key"] for l in existing.values() if address_key(l)}
    seen: Set[str] = set()
    new: List[dict] = []
    for listing in fresh:
        record = listing.to_dict()
        key = listing_key(record)
        addr = address_key(record)
        if key in seen:
            continue
        twin_key = by_address.get(addr) if addr else None
        if key not in existing and twin_key and existing[twin_key]["source"] != record["source"]:
            twin = existing[twin_key]
            also = [a for a in twin.get("also_listed", []) if a["source"] != record["source"]]
            twin["also_listed"] = also + [{"source": record["source"], "source_id": record["source_id"],
                                           "url": record["url"]}]
            twin.update(last_seen=today, active=True)
            seen.update({key, twin_key})
            continue
        seen.add(key)
        old = existing.get(key)
        record.update(key=key, last_seen=today, active=True, also_listed=(old or {}).get("also_listed", []))
        if old:
            record.update(first_seen=old["first_seen"], is_new=False)
        else:
            record.update(first_seen=today, is_new=True)
            new.append(record)
        existing[key] = record
        if addr:
            by_address.setdefault(addr, key)

    for key, record in existing.items():
        if key not in seen:
            record["is_new"] = False
            if record["source"] in sources_run:
                record["active"] = False

    # Newest first, inactive at the bottom (Python's sort is stable, so sort by the least important key first)
    listings = sorted(existing.values(), key=lambda l: l["key"])
    listings.sort(key=lambda l: l["first_seen"], reverse=True)
    listings.sort(key=lambda l: not l["active"])
    data["listings"] = listings
    data["last_run"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return new
