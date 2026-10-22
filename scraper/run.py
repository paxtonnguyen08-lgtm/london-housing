"""Run every source, keep what passes the filters, and update data/listings.json.

Usage:  .venv/bin/python -m scraper.run
"""
from __future__ import annotations

import logging
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from typing import List, Optional

from . import config, filters, store
from .geo import Geocoder
from .polite import PoliteSession
from .sources import SOURCES

log = logging.getLogger("scraper")
REJECTED_KEEP_DAYS = 60  # forget old rejections so a listing gets a fresh look now and then


def run(sources=None, path: Path = config.LISTINGS_PATH, session=None, geocoder=None,
        today: Optional[str] = None) -> List[dict]:
    """Returns the listings that are new this run (Phase 3 will send alerts about these).

    Listings we drop are remembered in rejected.json (next to listings.json), so their
    detail pages aren't downloaded again unless their price or date changes.
    """
    sources = SOURCES if sources is None else sources
    session = session or PoliteSession()
    geocoder = geocoder or Geocoder()
    today = today or date.today().isoformat()
    data = store.load(path)
    rejected_path = Path(path).parent / "rejected.json"
    rejected_all = store.load_rejected(rejected_path)

    kept, sources_run = [], set()
    for source in sources:
        try:
            rejected = rejected_all.setdefault(source.name, {})
            listings = source.fetch(session, geocoder, store.known_for(data, source.name), rejected)
        except Exception:
            log.exception("%s failed; keeping its old listings as they were", source.name)
            continue
        sources_run.add(source.name)
        reasons = Counter()
        kept_here = 0
        for listing in listings:
            why = filters.why_rejected(listing)
            if why:
                reasons.update(why)
                rejected[listing.source_id] = {"reasons": why, "price": listing.price, "available": listing.lease_start,
                                               "marker": listing.change_marker, "rejected_on": today}
            else:
                kept.append(listing)
                kept_here += 1
                rejected.pop(listing.source_id, None)
        log.info("%s: %d candidates, %d kept. Dropped for: %s", source.name, len(listings), kept_here,
                 dict(reasons) or "nothing")

    new = store.merge(data, kept, sources_run, today)
    store.save(path, data)
    cutoff = (date.fromisoformat(today) - timedelta(days=REJECTED_KEEP_DAYS)).isoformat()
    for by_id in rejected_all.values():
        for source_id in [i for i, r in by_id.items() if r["rejected_on"] < cutoff]:
            del by_id[source_id]
    store.save(rejected_path, rejected_all)
    if hasattr(geocoder, "save"):
        geocoder.save()

    active = sum(1 for l in data["listings"] if l["active"])
    log.info("Saved %d active listings (%d new) to %s", active, len(new), path)
    for l in new:
        log.info("  NEW  $%s/person  %s bd  %s min to Huron  %s", l["price_per_person"], l["bedrooms"],
                 l["walk_min_huron"] if l["walk_min_huron"] is not None else "?", l["title"])
    return new


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    run()
