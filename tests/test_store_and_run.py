import json

from scraper import store
from scraper.models import Listing
from scraper.run import run


def make(source_id, title="1100 Sunset", source="western_och", **kw):
    base = dict(source=source, source_id=source_id, url=f"https://x/{source_id}", title=title,
                address=f"{title}, London, ON", housing_type="House", bedrooms=4, price=1000,
                price_basis="per_room", total_rent=4000, price_per_person=1000, utilities_included="yes",
                est_cost_per_person=1000, lease_start="2027-05-01", distance_km=1.0)
    base.update(kw)
    return Listing(**base)


def empty():
    return {"last_run": None, "listings": []}


def test_listing_key_and_address_key():
    assert store.listing_key({"title": "1100 Sunset Street", "source": "a", "source_id": "1"}) == "a:1"
    assert store.address_key({"title": "1100 Sunset Street"}) == "1100 sunset st"
    assert store.address_key({"title": "Unit 2 - 45 Western Rd"}) == "45 western rd #2"
    assert store.address_key({"title": "Trott drive"}) is None


def test_first_run_marks_everything_new():
    data = empty()
    new = store.merge(data, [make("1"), make("2", title="45 Western Rd")], {"western_och"}, "2026-10-22")
    assert len(new) == 2
    assert all(l["is_new"] and l["active"] and l["first_seen"] == "2026-10-22" for l in data["listings"])
    assert data["last_run"]


def test_second_run_keeps_first_seen_and_clears_new():
    data = empty()
    store.merge(data, [make("1")], {"western_och"}, "2026-10-22")
    new = store.merge(data, [make("1", price=1050, price_per_person=1050)], {"western_och"}, "2026-10-26")
    assert new == []
    [l] = data["listings"]
    assert (l["first_seen"], l["last_seen"], l["is_new"], l["price_per_person"]) == ("2026-10-22", "2026-10-26", False, 1050)


def test_missing_listing_goes_inactive_but_is_kept():
    data = empty()
    store.merge(data, [make("1"), make("2", title="45 Western Rd")], {"western_och"}, "2026-10-22")
    store.merge(data, [make("1")], {"western_och"}, "2026-10-26")
    by_id = {l["source_id"]: l for l in data["listings"]}
    assert by_id["2"]["active"] is False and by_id["1"]["active"] is True
    assert data["listings"][-1]["source_id"] == "2"  # inactive sorted last


def test_failed_source_does_not_hide_its_listings():
    data = empty()
    store.merge(data, [make("1")], {"western_och"}, "2026-10-22")
    store.merge(data, [], set(), "2026-10-26")  # western_och crashed, so it isn't in sources_run
    assert data["listings"][0]["active"] is True


def test_same_house_on_two_sites_is_one_listing():
    data = empty()
    new = store.merge(data, [make("1", title="1100 Sunset Street"),
                             make("abc", title="1100 sunset st.", source="other_site")], {"western_och", "other_site"},
                      "2026-10-22")
    assert len(new) == 1 and len(data["listings"]) == 1
    assert data["listings"][0]["also_listed"] == [{"source": "other_site", "source_id": "abc", "url": "https://x/abc"}]
    # Next run: same again -> still one card, and the twin isn't listed twice
    store.merge(data, [make("1", title="1100 Sunset Street"),
                       make("abc", title="1100 sunset st.", source="other_site")], {"western_och", "other_site"},
                "2026-10-26")
    assert len(data["listings"]) == 1 and len(data["listings"][0]["also_listed"]) == 1


def test_units_in_one_building_are_separate_listings():
    # Review finding 2: these used to share a key and one was dropped
    data = empty()
    new = store.merge(data, [make("12", title="Unit 2 - 45 Western Rd"), make("13", title="Unit 3 - 45 Western Rd")],
                      {"western_och"}, "2026-10-22")
    assert len(new) == 2 and len(data["listings"]) == 2


def test_same_site_same_address_different_ids_are_not_merged():
    data = empty()
    store.merge(data, [make("1", title="45 Western Rd"), make("2", title="45 Western Road")], {"western_och"},
                "2026-10-22")
    assert len(data["listings"]) == 2


def test_vague_addresses_are_not_merged():
    data = empty()
    store.merge(data, [make("1", title="Trott drive"), make("2", title="Trott drive")], {"western_och"}, "2026-10-22")
    assert len(data["listings"]) == 2


def test_known_for():
    data = empty()
    store.merge(data, [make("1"), make("x", title="9 Elm St", source="other")], {"western_och", "other"}, "2026-10-22")
    assert set(store.known_for(data, "western_och")) == {"1"}


def test_save_and_load_round_trip(tmp_path):
    data = empty()
    store.merge(data, [make("1")], {"western_och"}, "2026-10-22")
    store.save(tmp_path / "l.json", data)
    assert store.load(tmp_path / "l.json") == data
    assert store.load(tmp_path / "missing.json") == empty()


class FakeSource:
    name = "western_och"

    def __init__(self, listings, fail=False):
        self.listings, self.fail, self.known_seen = listings, fail, None

    def fetch(self, session, geocoder, known, rejected):
        self.known_seen = known
        if self.fail:
            raise RuntimeError("site down")
        return self.listings


def test_run_end_to_end(tmp_path):
    path = tmp_path / "listings.json"
    good = make("1")
    too_big = make("2", title="2 Big St", bedrooms=7)
    too_far = make("3", title="3 Far St", distance_km=8.0)
    wrong_month = make("4", title="4 Late St", lease_start="2027-09-01")
    a_room = make("5", title="5 Room St", housing_type="Rooms")
    new = run(sources=[FakeSource([good, too_big, too_far, wrong_month, a_room])], path=path,
              session=object(), geocoder=object(), today="2026-10-22")
    assert [l["source_id"] for l in new] == ["1"]
    saved = json.loads(path.read_text())
    assert [l["source_id"] for l in saved["listings"]] == ["1"]

    # Second run: the source is told what we already have, and nothing is new
    src = FakeSource([good])
    assert run(sources=[src], path=path, session=object(), geocoder=object(), today="2026-10-26") == []
    assert set(src.known_seen) == {"1"}


def test_run_survives_a_failing_source(tmp_path):
    path = tmp_path / "listings.json"
    run(sources=[FakeSource([make("1")])], path=path, session=object(), geocoder=object(), today="2026-10-22")
    run(sources=[FakeSource([], fail=True)], path=path, session=object(), geocoder=object(), today="2026-10-26")
    saved = json.loads(path.read_text())
    assert saved["listings"][0]["active"] is True


def test_run_remembers_rejections_and_forgets_them_after_60_days(tmp_path):
    path = tmp_path / "listings.json"
    far = make("3", title="3 Far St", distance_km=8.0)
    run(sources=[FakeSource([far])], path=path, session=object(), geocoder=object(), today="2026-10-22")
    rejected = json.loads((tmp_path / "rejected.json").read_text())
    assert rejected["western_och"]["3"]["reasons"] == ["8.0 km away"]
    assert rejected["western_och"]["3"]["price"] == 1000

    src = FakeSource([])
    run(sources=[src], path=path, session=object(), geocoder=object(), today="2026-11-01")
    assert "3" in json.loads((tmp_path / "rejected.json").read_text())["western_och"]
    run(sources=[src], path=path, session=object(), geocoder=object(), today="2027-01-01")
    assert json.loads((tmp_path / "rejected.json").read_text())["western_och"] == {}


def test_listing_that_now_passes_is_removed_from_rejected(tmp_path):
    path = tmp_path / "listings.json"
    run(sources=[FakeSource([make("3", title="3 Far St", distance_km=8.0)])], path=path, session=object(),
        geocoder=object(), today="2026-10-22")
    new = run(sources=[FakeSource([make("3", title="3 Far St", distance_km=2.0)])], path=path, session=object(),
              geocoder=object(), today="2026-10-26")
    assert [l["source_id"] for l in new] == ["3"]
    assert json.loads((tmp_path / "rejected.json").read_text())["western_och"] == {}
