"""Distances, walk times, and turning addresses into map coordinates."""
from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Callable, Optional, Tuple

import requests

from . import config

LatLng = Tuple[float, float]
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


def haversine_km(a: LatLng, b: LatLng) -> float:
    """Straight-line distance between two points on Earth, in km."""
    lat1, lng1 = map(math.radians, a)
    lat2, lng2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def walk_minutes(km: Optional[float]) -> Optional[int]:
    """Estimated walk: streets aren't straight, so stretch the distance by the detour factor."""
    if km is None:
        return None
    return round(km * config.DETOUR_FACTOR / config.WALK_SPEED_KMH * 60)


class Geocoder:
    """Looks up addresses on OpenStreetMap (Nominatim), remembering answers in a cache file.

    The cache means each address is only ever looked up once, which keeps us within
    Nominatim's usage rules and makes later runs fast.
    """

    def __init__(self, cache_path: Path = config.GEOCACHE_PATH, fetch: Optional[Callable[[dict], list]] = None):
        self.cache_path = Path(cache_path)
        self.cache = json.loads(self.cache_path.read_text()) if self.cache_path.exists() else {}
        self._fetch = fetch or self._nominatim
        self._last_call = 0.0

    def _nominatim(self, params: dict) -> list:
        wait = config.GEOCODE_DELAY_SECONDS - (time.time() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        self._last_call = time.time()
        params = {**params, "format": "jsonv2", "limit": 1, "addressdetails": 1, "countrycodes": "ca"}
        resp = requests.get(NOMINATIM_URL, params=params, headers={"User-Agent": config.USER_AGENT}, timeout=20)
        resp.raise_for_status()
        return resp.json()

    def geocode(self, street: str) -> Optional[dict]:
        """'1100 Sunset' -> {'lat': .., 'lng': .., 'precision': 'house' | 'street'} or None."""
        key = street.strip().lower()
        if key in self.cache:
            return self.cache[key]
        result = None
        for params in (
            {"street": street, "city": "London", "state": "Ontario", "country": "Canada"},
            {"q": f"{street}, London, Ontario"},
        ):
            hits = self._fetch(params)
            if hits:
                hit = hits[0]
                precision = "house" if hit.get("address", {}).get("house_number") else "street"
                result = {"lat": float(hit["lat"]), "lng": float(hit["lon"]), "precision": precision}
                break
        self.cache[key] = result
        return result

    def save(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(self.cache, indent=1, sort_keys=True))
