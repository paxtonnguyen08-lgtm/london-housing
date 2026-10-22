from datetime import date
from pathlib import Path

from scraper import filters
from scraper.sources.western_och import (
    BASE, WesternOCH, build_listing, card_passes, form_defaults, max_page, parse_cards,
    parse_detail, search_form, update_from_card,
)

FIX = Path(__file__).parent / "fixtures"


def read(name):
    return (FIX / name).read_text()


class NoGeocoder:
    def geocode(self, street):
        return None


class FakeGeocoder:
    def geocode(self, street):
        return {"lat": 43.0066, "lng": -81.2652, "precision": "street"}


def cards_by_id():
    return {c["id"]: c for c in parse_cards(read("och_search_page.html"))}


def test_form_defaults_and_search_form():
    defaults = form_defaults(read("och_landing_form.html"))
    assert ("MaximumRent", "7000") in defaults
    assert ("requestType", "Normal") in defaults
    data = search_form(defaults, 3)
    assert ("PageNumber", "3") in data and ("PageNumber", "0") not in data
    assert ("SelectedHousing", "1") in data and ("SelectedHousing", "2") in data


def test_parse_cards_skips_spacer_and_reads_fields():
    cards = cards_by_id()
    assert len(cards) == 6
    c = cards["63606"]
    assert c["title"] == "Oxford & Wharncliffe"
    assert c["neighbourhood"] == "Near South"
    assert (c["price"], c["basis"], c["bedrooms"]) == (1045, "per_room", 5)
    assert c["plus_utilities"] is True
    assert c["available"] == date(2027, 5, 1)
    assert c["url"] == BASE + "/Listings/Details/63606"
    assert c["image"].endswith("63606-1.jpg")
    assert cards["62248"]["available"] is None  # "Available Immediately"
    assert cards["59322"]["plus_utilities"] is False


def test_max_page():
    assert max_page(read("och_search_page.html")) == 8
    assert max_page("<html></html>") is None


def test_card_quick_check():
    cards = cards_by_id()
    passing = {i for i, c in cards.items() if card_passes(c)}
    # 59322: Feb 2027; 62248: immediately; 63703: 7 bd; 63734: 6 bd
    assert passing == {"63606", "63711"}


def test_parse_detail_fields():
    d = parse_detail(read("och_detail_63747.html"))
    assert d["fields"]["Housing Type"] == "House"
    assert d["fields"]["Bedroom(s)"] == "5"
    assert d["fields"]["Utilities"] == "Included"
    assert d["fields"]["Distance"] == "0.90 Km"
    assert d["fields"]["Location"] == "Old North"
    assert d["amenities"] == ["Utilities Incl", "Laundry", "Dishwasher"]
    assert d["images"] == ["https://offcampus.uwo.ca/assets/listing_images/63747-1.jpg"]
    assert "SUNSET STREET" in d["description"]
    assert "per bdrm" in d["rent_text"]


def test_build_listing_per_bedroom_price():
    card = {"id": "63747", "url": BASE + "/Listings/Details/63747", "title": "1100 Sunset", "neighbourhood": "Old North",
            "price": 1150, "basis": "per_room", "plus_utilities": False, "bedrooms": 5,
            "available": date(2027, 5, 1), "image": None}
    l = build_listing(card, parse_detail(read("och_detail_63747.html")), FakeGeocoder())
    assert (l.price_per_person, l.total_rent, l.price_basis, l.price_assumed) == (1150, 5750, "per_room", False)
    assert l.utilities_included == "yes" and l.est_cost_per_person == 1150
    assert (l.housing_type, l.bedrooms, l.lease_start, l.lease_term_months) == ("House", 5, "2027-05-01", 12)
    # The street point (0.69 km) agrees with the site's 0.90 km, so our straight-line number is used
    assert l.site_distance_km == 0.9 and l.distance_km == 0.69 and l.walk_min_campus == 11
    assert l.walk_min_huron is not None and l.geo_precision == "street"
    assert "Utilities included" in l.highlights
    assert "Viewings by invite only" in l.heads_up
    assert filters.why_rejected(l) == []


def test_build_listing_whole_unit_price_that_is_really_per_room():
    card = cards_by_id()["63711"]
    l = build_listing(card, parse_detail(read("och_detail_63711.html")), NoGeocoder())
    # "$900 +", 4 bedrooms, no "per bdrm" -> must be $900 each, not $225
    assert (l.price_per_person, l.total_rent, l.price_basis, l.price_assumed) == (900, 3600, "per_room", True)
    assert l.utilities_included == "no"  # site says "Extra"
    assert l.est_cost_per_person == 1000
    assert l.baths == 2 and l.furnished is True
    assert len(l.images) == 6
    assert "Price didn't say per bedroom; assumed per room" in l.heads_up
    assert l.walk_min_campus == 36  # 2.30 km from the site x 1.3 / 5 km/h = 35.9 min
    assert l.walk_min_huron == 36 and l.geo_precision is None  # no map point: estimated from campus distance
    assert filters.why_rejected(l) == []


def test_saved_listing_has_no_contact_details():
    card = cards_by_id()["63711"]
    l = build_listing(card, parse_detail(read("och_detail_63711.html")), NoGeocoder())
    text = str(l.to_dict())
    assert "519-555-0100" not in text and "landlord@example.com" not in text


def test_update_from_card_refreshes_price():
    card = cards_by_id()["63711"]
    saved = build_listing(card, parse_detail(read("och_detail_63711.html")), NoGeocoder()).to_dict()
    saved["first_seen"] = "2026-10-01"  # bookkeeping keys are ignored
    changed = dict(card, price=950)
    l = update_from_card(saved, changed)
    assert (l.price, l.price_per_person, l.total_rent, l.est_cost_per_person) == (950, 950, 3800, 1050)


class FakeSite:
    """Pretends to be offcampus.uwo.ca so we can test the whole fetch loop offline.

    `search_edit` / `detail_edit` let a test tweak the pages (e.g. change a price)."""

    def __init__(self, search_edit=lambda h: h, detail_edit=lambda h: h):
        self.gets, self.posts = [], []
        self.search_edit, self.detail_edit = search_edit, detail_edit

    def get(self, url, **kw):
        self.gets.append(url)
        if url.endswith("/listings/"):
            return type("R", (), {"text": read("och_landing_form.html")})
        if url.endswith("/Listings/SearchListings"):
            return type("R", (), {"text": self.search_edit(read("och_search_page.html"))})
        if url.endswith("/63711"):
            return type("R", (), {"text": read("och_detail_63711.html")})
        return type("R", (), {"text": self.detail_edit(read("och_detail_63747.html"))})

    def post(self, url, data=None, **kw):
        self.posts.append(dict(data))
        return type("R", (), {"text": ""})


def test_fetch_pages_until_nothing_new_and_skips_known_details():
    site = FakeSite()
    known = {"63606": {"source": "western_och", "source_id": "63606", "url": "u", "title": "Oxford & Wharncliffe",
                       "address": "a", "bedrooms": 5, "price": 1045, "price_basis": "per_room",
                       "utilities_included": "no", "lease_start": "2027-05-01"}}
    listings = WesternOCH().fetch(site, NoGeocoder(), known, {})
    # Page 0 has cards; page 1 returns the same cards -> stop
    assert [p["PageNumber"] for p in site.posts] == ["0", "1"]
    assert {l.source_id for l in listings} == {"63606", "63711"}
    detail_gets = [u for u in site.gets if "/Details/" in u]
    assert detail_gets == [BASE + "/Listings/Details/63711"]  # 63606 was already known


def synthetic(price, bedrooms, description, rent_text=None, fields=None):
    """A made-up card + detail page, for testing price rules in isolation."""
    card = {"id": "1", "url": BASE + "/Listings/Details/1", "title": "45 Test St", "neighbourhood": "Old North",
            "price": price, "basis": "whole_unit", "plus_utilities": False, "bedrooms": bedrooms,
            "available": date(2027, 5, 1), "image": None}
    f = {"Housing Type": "House", "Bedroom(s)": str(bedrooms), "Utilities": "Included",
         "Date Available": "Available May 1, 2027", "Distance": "1.20 Km"}
    f.update(fields or {})
    detail = {"fields": f, "description": description, "amenities": [], "images": [],
              "rent_text": rent_text if rent_text is not None else f"${price}"}
    return card, detail


def test_utilities_per_person_text_does_not_flip_whole_house_price():
    # Review finding 1: "$100 per person" utilities used to turn a $3600 house into $3600 *per room*
    card, detail = synthetic(3600, 4, "Whole 4 bed house, $3600/month. Utilities about $100 per person.")
    l = build_listing(card, detail, NoGeocoder())
    assert (l.price_basis, l.price_assumed, l.price_per_person, l.total_rent) == ("whole_unit", False, 900, 3600)


def test_per_room_text_matching_the_price_still_flips():
    # $1,000 for 2 bedrooms is plausible as a whole unit, but the ad says it's per room
    card, detail = synthetic(1000, 2, "Two bedroom flat. $1,000 per room, utilities included.")
    l = build_listing(card, detail, NoGeocoder())
    assert (l.price_basis, l.price_assumed, l.price_per_person, l.total_rent) == ("per_room", True, 1000, 2000)


def test_says_per_room_tolerance():
    from scraper.sources.western_och import says_per_room
    assert says_per_room("$900.00/room plus utilities", 900)
    assert says_per_room("about $950 per bedroom", 900)  # within 15%
    assert not says_per_room("utilities $100 per person", 900)
    assert not says_per_room("", 900)


class PointGeocoder:
    def __init__(self, lat, lng):
        self.point = {"lat": lat, "lng": lng, "precision": "street"}

    def geocode(self, street):
        return self.point


def test_far_off_street_point_is_not_trusted():
    # Review finding 3: a long street (Richmond) geocoded ~4 km from campus gave a 68 min walk to Huron
    from scraper import config, geo
    card, detail = synthetic(1000, 4, "Nice.", fields={"Distance": "1.20 Km"})
    far = (config.MAIN_CAMPUS[0] + 0.036, config.MAIN_CAMPUS[1])  # ~4 km north
    assert 3.8 < geo.haversine_km(far, config.MAIN_CAMPUS) < 4.2
    l = build_listing(card, detail, PointGeocoder(*far))
    assert l.geo_precision == "unreliable" and l.lat is None and l.lng is None
    assert l.walk_min_campus == 19 and l.walk_min_huron == 19  # 1.2 km x 1.3 / 5 km/h


def test_close_street_point_is_used():
    from scraper import config
    card, detail = synthetic(1000, 4, "Nice.", fields={"Distance": "0.90 Km"})
    l = build_listing(card, detail, PointGeocoder(43.0066085, -81.2652139))  # Sunset St, ~0.7 km from campus
    assert l.geo_precision == "street" and l.lat == 43.0066085
    assert l.walk_min_huron != l.walk_min_campus  # measured to Huron itself


def test_no_site_distance_uses_geocoded_point():
    card, detail = synthetic(1000, 4, "Nice.", fields={"Distance": ""})
    l = build_listing(card, detail, PointGeocoder(43.0066085, -81.2652139))
    assert 0.6 < l.distance_km < 0.8 and l.geo_precision == "street"


def test_rejected_detail_pages_are_not_fetched_again(tmp_path):
    # Review finding 4: listings dropped after reading their detail page were re-downloaded every run
    from scraper.run import run
    too_far = lambda h: h.replace("0.90 Km", "8.00 Km")  # 63606 now fails the 5 km rule
    path = tmp_path / "listings.json"

    site1 = FakeSite(detail_edit=too_far)
    new = run(sources=[WesternOCH()], path=path, session=site1, geocoder=NoGeocoder(), today="2026-10-22")
    assert [l["source_id"] for l in new] == ["63711"]
    assert sorted(u.split("/")[-1] for u in site1.gets if "/Details/" in u) == ["63606", "63711"]

    site2 = FakeSite(detail_edit=too_far)
    run(sources=[WesternOCH()], path=path, session=site2, geocoder=NoGeocoder(), today="2026-10-26")
    assert [u for u in site2.gets if "/Details/" in u] == []  # 63711 known, 63606 rejected before

    # The price changes -> worth a fresh look
    site3 = FakeSite(detail_edit=too_far, search_edit=lambda h: h.replace("$1045", "$995"))
    run(sources=[WesternOCH()], path=path, session=site3, geocoder=NoGeocoder(), today="2026-10-29")
    assert [u.split("/")[-1] for u in site3.gets if "/Details/" in u] == ["63606"]


class WindowedPagerSite:
    """A fake site with 6 result pages whose pager only shows the next two page numbers."""

    LAST = 5

    def __init__(self):
        self.page, self.posts = 0, []

    def get(self, url, **kw):
        if url.endswith("/listings/"):
            return type("R", (), {"text": read("och_landing_form.html")})
        p = self.page
        cards = "".join(
            f'<div class="rental-listing"><h2><strong><a href="/Listings/Details/{p}{i}">{i} Test St</a>'
            f'</strong></h2><h3><strong>$1000 per bdrm</strong>, 9 Bedroom(s) Vacant</h3>'
            f'<h4>Available May 1, 2027</h4></div>' for i in range(3)) if p <= self.LAST else ""
        pager = "".join(f'<a onclick="Page({k})">{k}</a>' for k in range(1, min(p + 2, self.LAST) + 1))
        return type("R", (), {"text": cards + pager})

    def post(self, url, data=None, **kw):
        self.page = int(dict(data)["PageNumber"])
        self.posts.append(self.page)
        return type("R", (), {"text": ""})


def test_pager_window_does_not_stop_paging_early():
    site = WindowedPagerSite()
    WesternOCH().fetch(site, NoGeocoder(), {}, {})
    assert site.posts == [0, 1, 2, 3, 4, 5]  # page 0 only showed "Page(2)", but we kept going


def test_exact_house_point_beats_a_wrong_site_distance():
    # Real case: 911 Richmond St, the site says 4.10 km but it's ~1.6 km straight-line
    card, detail = synthetic(1000, 4, "Nice.", fields={"Distance": "4.10 Km"})
    geocoder = PointGeocoder(43.0011838, -81.2562918)
    geocoder.point["precision"] = "house"
    l = build_listing(card, detail, geocoder)
    assert l.geo_precision == "house" and l.site_distance_km == 4.1
    assert 1.5 < l.distance_km < 1.7 and l.walk_min_campus == 25


def test_site_zero_km_is_treated_as_unknown():
    # Real case: 144 Empress Ave listed at "0.00 Km"
    card, detail = synthetic(1000, 4, "Nice.", fields={"Distance": "0.00 Km"})
    l = build_listing(card, detail, NoGeocoder())
    assert l.site_distance_km is None and l.distance_km is None and l.walk_min_campus is None


def test_update_from_card_recomputes_location_from_cache():
    # Listings saved before site_distance_km existed get migrated and recomputed
    card, detail = synthetic(1000, 4, "Nice.", fields={"Distance": "4.10 Km"})
    saved = build_listing(card, detail, NoGeocoder()).to_dict()
    del saved["site_distance_km"]
    saved["distance_km"] = 4.1
    geocoder = PointGeocoder(43.0011838, -81.2562918)
    geocoder.point["precision"] = "house"
    l = update_from_card(saved, dict(card, id="1"), geocoder)
    assert l.site_distance_km == 4.1 and 1.5 < l.distance_km < 1.7 and l.geo_precision == "house"


def test_description_total_reveals_per_person_price():
    # Real case: 300 Princess Ave listed "$1090", 2 bd; text says $2,190 for the entire apartment
    card, detail = synthetic(1090, 2, "Rent is $2,190/month for the entire apartment, plus hydro.")
    l = build_listing(card, detail, NoGeocoder())
    assert (l.price_basis, l.price_assumed, l.price_per_person, l.total_rent) == ("per_room", True, 1090, 2180)


def test_cheap_unclear_whole_unit_price_gets_a_check_the_ad_warning():
    # Real case: 310 Grosvenor, $1100 for a 2-bed apartment, nothing in the text says which
    card, detail = synthetic(1100, 2, "2 Bedrooms. Newly renovated.")
    l = build_listing(card, detail, NoGeocoder())
    assert (l.price_basis, l.price_assumed, l.price_per_person) == ("whole_unit", False, 550)
    assert "Cheap for the whole place; price may be per person. Check the ad" in l.heads_up


def test_normal_whole_unit_price_has_no_warning():
    card, detail = synthetic(2400, 2, "Whole apartment.")
    l = build_listing(card, detail, NoGeocoder())
    assert l.price_per_person == 1200 and not any("Check the ad" in h for h in l.heads_up)


def test_quotes_total():
    from scraper.sources.western_och import quotes_total
    assert quotes_total("$2,190/month for the entire apartment", 1090, 2)
    assert quotes_total("$4975/month or $995 per person", 995, 5)
    assert not quotes_total("Utilities about $100 per person", 900, 4)
    assert not quotes_total("$2,190 total", 1090, 1)
