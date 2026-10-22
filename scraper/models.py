"""The shape of one listing, shared by every source."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields
from typing import List, Optional


@dataclass
class Listing:
    source: str
    source_id: str
    url: str
    title: str
    address: str
    neighbourhood: Optional[str] = None
    housing_type: Optional[str] = None
    bedrooms: Optional[int] = None
    baths: Optional[float] = None
    price: Optional[int] = None  # the number as advertised
    price_basis: Optional[str] = None  # "per_room" or "whole_unit"
    price_assumed: bool = False  # True when we guessed the basis (listing didn't say)
    total_rent: Optional[int] = None
    price_per_person: Optional[int] = None
    utilities_included: str = "unknown"  # "yes", "no" or "unknown"
    est_cost_per_person: Optional[int] = None  # price_per_person + utilities estimate if not included
    lease_start: Optional[str] = None  # ISO date, e.g. "2027-05-01"
    lease_term_months: Optional[int] = None
    furnished: Optional[bool] = None
    amenities: List[str] = field(default_factory=list)
    distance_km: Optional[float] = None  # best estimate, straight line to main campus
    site_distance_km: Optional[float] = None  # what the listing site itself says (often off)
    lat: Optional[float] = None
    lng: Optional[float] = None
    geo_precision: Optional[str] = None  # "house", "street", "unreliable" (point dropped) or None (not found)
    walk_min_campus: Optional[int] = None
    walk_min_huron: Optional[int] = None
    images: List[str] = field(default_factory=list)
    highlights: List[str] = field(default_factory=list)
    heads_up: List[str] = field(default_factory=list)
    # Not saved in listings.json: what the site's list page showed (e.g. "1045|2027-05-01"),
    # so we can tell next time whether a listing we rejected has changed.
    change_marker: Optional[str] = field(default=None, repr=False)

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("change_marker")
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Listing":
        """Rebuild a Listing from saved JSON, ignoring bookkeeping keys like first_seen."""
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in names})
