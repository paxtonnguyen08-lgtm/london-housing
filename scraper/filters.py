"""The rules a listing must pass to be kept. Shared by every source."""
from __future__ import annotations

from datetime import date
from typing import List, Optional

from . import config
from .models import Listing


def bedrooms_ok(n: Optional[int]) -> bool:
    return n is not None and config.MIN_BEDROOMS <= n <= config.MAX_BEDROOMS


def lease_start_ok(d: Optional[date]) -> bool:
    return d is not None and config.LEASE_START_EARLIEST <= d <= config.LEASE_START_LATEST


def why_rejected(listing: Listing) -> List[str]:
    """Empty list = keep it. Otherwise the reasons it was dropped (handy for debugging)."""
    reasons = []
    if listing.housing_type and listing.housing_type not in config.WHOLE_UNIT_TYPES:
        reasons.append(f"type {listing.housing_type}")
    if not bedrooms_ok(listing.bedrooms):
        reasons.append(f"{listing.bedrooms} bedrooms")
    if listing.distance_km is not None and listing.distance_km > config.MAX_DISTANCE_KM:
        reasons.append(f"{listing.distance_km} km away")
    start = date.fromisoformat(listing.lease_start) if listing.lease_start else None
    if not lease_start_ok(start):
        reasons.append(f"starts {listing.lease_start or 'unknown'}")
    if listing.price_per_person is None:
        reasons.append("no price")
    return reasons
