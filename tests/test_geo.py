import json

from scraper import config
from scraper.geo import Geocoder, haversine_km, walk_minutes


def test_haversine_known_distance():
    # Huron to main campus is roughly 430 m
    assert 0.35 < haversine_km(config.HURON, config.MAIN_CAMPUS) < 0.5
    assert haversine_km(config.HURON, config.HURON) == 0


def test_walk_minutes():
    # 1 km straight line -> 1.3 km walked at 5 km/h -> about 16 min
    assert walk_minutes(1.0) == 16
    assert walk_minutes(0.9) == 14
    assert walk_minutes(None) is None


def _hit(lat, lng, house_number=None):
    return [{"lat": str(lat), "lon": str(lng), "address": {"house_number": house_number} if house_number else {}}]


def test_geocoder_uses_structured_search_first_and_caches(tmp_path):
    calls = []

    def fake_fetch(params):
        calls.append(params)
        return _hit(43.0066, -81.2652)

    g = Geocoder(cache_path=tmp_path / "cache.json", fetch=fake_fetch)
    assert g.geocode("1100 Sunset") == {"lat": 43.0066, "lng": -81.2652, "precision": "street"}
    assert g.geocode("1100 sunset ") == {"lat": 43.0066, "lng": -81.2652, "precision": "street"}
    assert len(calls) == 1 and "street" in calls[0]

    g.save()
    saved = json.loads((tmp_path / "cache.json").read_text())
    assert "1100 sunset" in saved
    # A new Geocoder reads the cache and makes no calls
    g2 = Geocoder(cache_path=tmp_path / "cache.json", fetch=lambda p: 1 / 0)
    assert g2.geocode("1100 Sunset")["lat"] == 43.0066


def test_geocoder_falls_back_to_free_text_then_none(tmp_path):
    calls = []

    def fake_fetch(params):
        calls.append(params)
        return _hit(43.0, -81.2, house_number="12") if "q" in params else []

    g = Geocoder(cache_path=tmp_path / "c.json", fetch=fake_fetch)
    assert g.geocode("12 Odd Place")["precision"] == "house"
    assert len(calls) == 2

    g2 = Geocoder(cache_path=tmp_path / "d.json", fetch=lambda p: [])
    assert g2.geocode("Nowhere") is None
    assert "nowhere" in g2.cache  # misses are cached too, so we don't ask again
