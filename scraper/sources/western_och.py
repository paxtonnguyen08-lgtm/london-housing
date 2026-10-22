"""Western University's Off-Campus Housing listings (offcampus.uwo.ca/listings).

How the site works: the search form is saved to your session with a POST to
/Listings/SaveFilters, then GET /Listings/SearchListings returns that page of results.
We copy that, one page at a time, then open each new listing's detail page.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Dict, List, Optional, Tuple

from bs4 import BeautifulSoup

from .. import config, filters, geo, rundown
from ..geo import Geocoder
from ..models import Listing
from ..normalize import (
    est_cost, parse_available, parse_float, parse_int, parse_price, parse_utilities, per_person,
)
from ..polite import PoliteSession
from .base import Source

log = logging.getLogger(__name__)

BASE = "https://offcampus.uwo.ca"
HOUSING_APARTMENT, HOUSING_HOUSE = "1", "2"  # values in the site's "Housing" filter
MAX_PAGES = 40  # safety stop
# Below this per person, a "whole unit" price must really be per room (no London room is this cheap)
MIN_PLAUSIBLE_PER_PERSON = 450
_PER_ROOM_TEXT = re.compile(
    r"\$\s*([\d,]+(?:\.\d+)?)\s*(?:/|per|a|each)\s*(?:room|bedroom|bdrm|person|student|tenant)", re.I)
GEO_MISMATCH_KM = 0.5  # see add_location
# A "whole unit" price under this per person might really be per room (the cheapest real
# room on the site is ~$650), so the card gets a "check the ad" heads-up
UNCLEAR_PER_PERSON = 650
TOTAL_MATCH_TOLERANCE = 0.10
PER_ROOM_MATCH_TOLERANCE = 0.15  # "$900.00/room" counts for a $900 ad; "$100 per person" utilities doesn't


def says_per_room(description: str, price: int) -> bool:
    """Does the description quote the advertised price as a per-room/per-person amount?"""
    for m in _PER_ROOM_TEXT.finditer(description or ""):
        amount = float(m.group(1).replace(",", ""))
        if abs(amount - price) <= PER_ROOM_MATCH_TOLERANCE * price:
            return True
    return False


# ---------- parsing (pure functions, tested against saved pages) ----------

def form_defaults(html: str) -> List[Tuple[str, str]]:
    """Read the search form's default values, the same way the site's JavaScript sends them."""
    form = BeautifulSoup(html, "html.parser").select_one("form.search_listings_form")
    data = []
    for el in form.select("input, select"):
        name = el.get("name")
        if not name:
            continue
        if el.name == "select":
            data += [(name, o.get("value", "")) for o in el.select("option[selected]")]
        elif el.get("type") == "checkbox":
            if el.has_attr("checked"):
                data.append((name, el.get("value", "on")))
        else:
            data.append((name, el.get("value", "")))
    return data


def search_form(defaults: List[Tuple[str, str]], page: int) -> List[Tuple[str, str]]:
    """Form data for one results page: houses and apartments only."""
    data = [(k, v) for k, v in defaults if k not in ("PageNumber", "SelectedHousing")]
    return data + [("PageNumber", str(page)), ("SelectedHousing", HOUSING_APARTMENT), ("SelectedHousing", HOUSING_HOUSE)]


def parse_cards(html: str) -> List[dict]:
    """Each result card -> dict with the summary info shown in the list."""
    soup = BeautifulSoup(html, "html.parser")
    cards = []
    for card in soup.select("div.rental-listing"):
        link = card.select_one("h2 a[href*='/Listings/Details/']")
        if not link:
            continue  # the site puts an empty spacer card first
        rent_text = card.select_one("h3").get_text(" ", strip=True) if card.select_one("h3") else ""
        price, basis = parse_price(rent_text)
        vacant = re.search(r"(\d+)\s*Bedroom", rent_text)
        hood = card.select_one(".location_map_link")
        img = card.select_one(".rental-listing-img")
        img_url = re.search(r"url\(([^)]+)\)", img.get("style", "")) if img else None
        h4 = card.select_one("h4")
        cards.append({
            "id": link["href"].rstrip("/").split("/")[-1],
            "url": BASE + link["href"],
            "title": link.get_text(" ", strip=True),
            "neighbourhood": hood.get_text(strip=True) if hood else None,
            "price": price,
            "basis": basis,
            "plus_utilities": bool(re.search(r"\$\s*[\d,]+\s*\+", rent_text)),
            "bedrooms": int(vacant.group(1)) if vacant else None,
            "available": parse_available(h4.get_text(strip=True) if h4 else ""),
            "image": img_url.group(1).strip("'\"") if img_url else None,
        })
    return cards


def max_page(html: str) -> Optional[int]:
    pages = [int(p) for p in re.findall(r"Page\((\d+)\)", html)]
    return max(pages) if pages else None


def parse_detail(html: str) -> dict:
    """A detail page -> {'fields': {label: value}, 'description', 'amenities', 'images', 'rent_text'}."""
    soup = BeautifulSoup(html, "html.parser")
    section = soup.select_one(".details-description-section")
    fields: Dict[str, str] = {}
    description = ""
    if section:
        grid = section.select_one(".grds")
        cells = [c.get_text(" ", strip=True) for c in grid.find_all("div", class_="grd-2", recursive=False)] if grid else []
        for label, value in zip(cells[0::2], cells[1::2]):
            fields[label.strip()] = value.strip()
        p = section.select_one("p")
        description = p.get_text("\n", strip=True) if p else ""
    amenities = [a.get_text(strip=True) for a in soup.select(".details-amenities-section .grd-2") if a.get_text(strip=True)]
    images: List[str] = []
    img_input = soup.select_one("#JSONImages")
    if img_input and img_input.get("value"):
        try:
            images = json.loads(img_input["value"])
        except ValueError:
            pass
    rent = soup.select_one(".rent_display")
    return {
        "fields": fields,
        "description": description,
        "amenities": amenities,
        "images": images,
        "rent_text": rent.get_text(" ", strip=True) if rent else "",
    }


def card_passes(card: dict) -> bool:
    """Cheap check on the summary card, before we spend a request on the detail page."""
    return filters.bedrooms_ok(card["bedrooms"]) and filters.lease_start_ok(card["available"])


def build_listing(card: dict, detail: dict, geocoder: Optional[Geocoder]) -> Listing:
    f = detail["fields"]
    description = detail["description"]
    bedrooms = parse_int(f.get("Bedroom(s)", "")) or card["bedrooms"]

    price, basis = parse_price(detail["rent_text"]) if detail["rent_text"] else (None, "unknown")
    if price is None:
        price, basis = card["price"], card["basis"]
    assumed = unclear = False
    if basis == "whole_unit" and price and bedrooms:
        if (says_per_room(description, price) or quotes_total(description, price, bedrooms)
                or price / bedrooms < MIN_PLAUSIBLE_PER_PERSON):
            basis, assumed = "per_room", True
        elif price / bedrooms < UNCLEAR_PER_PERSON:
            unclear = True
    total, pp = per_person(price, basis, bedrooms)

    utilities = parse_utilities(f.get("Utilities", ""))
    if utilities == "unknown" and card["plus_utilities"]:
        utilities = "no"
    available = parse_available(f.get("Date Available", "")) or card["available"]
    site_km = parse_float(f.get("Distance", "")) or None  # the site sometimes says 0.00 km; treat as unknown
    baths = rundown.count_baths(rundown.clean(description))
    highlights, heads_up = rundown.build(description, detail["amenities"], utilities, bedrooms, baths, assumed,
                                         price_unclear=unclear)

    listing = Listing(
        source=WesternOCH.name,
        source_id=card["id"],
        url=card["url"],
        title=card["title"],
        address=f"{card['title']}, London, ON",
        neighbourhood=f.get("Location") or card["neighbourhood"],
        housing_type=f.get("Housing Type"),
        bedrooms=bedrooms,
        baths=baths,
        price=price,
        price_basis=basis,
        price_assumed=assumed,
        total_rent=total,
        price_per_person=pp,
        utilities_included=utilities,
        est_cost_per_person=est_cost(pp, utilities),
        lease_start=available.isoformat() if available else None,
        lease_term_months=parse_int(f.get("Lease Term", "")),
        furnished=rundown.is_furnished(description, detail["amenities"]),
        amenities=detail["amenities"],
        site_distance_km=site_km,
        images=detail["images"] or ([card["image"]] if card["image"] else []),
        highlights=highlights,
        heads_up=heads_up,
        change_marker=card_marker(card),
    )
    add_location(listing, geocoder)
    return listing


def add_location(listing: Listing, geocoder: Optional[Geocoder]) -> None:
    """Fill in coordinates, distance to campus and walk times.

    Which location to believe:
    - OpenStreetMap found the exact house: use it. (The site's own distances are often
      off, e.g. "0.00 km" or a driving distance.)
    - OpenStreetMap only found the street: that's *some* point on the street, which can
      be kilometres off on long streets like Richmond. Use it only if it roughly agrees
      with the site's distance (within GEO_MISMATCH_KM); otherwise mark it "unreliable".
    - No usable point: use the site's distance, and estimate the Huron walk from it
      (Huron is ~430 m from main campus).
    """
    listing.lat = listing.lng = listing.geo_precision = listing.walk_min_huron = None
    listing.distance_km = None
    site_km = listing.site_distance_km
    point = geocoder.geocode(listing.title) if geocoder else None
    if point:
        here = (point["lat"], point["lng"])
        to_campus = geo.haversine_km(here, config.MAIN_CAMPUS)
        trusted = (point["precision"] == "house" or site_km is None
                   or abs(to_campus - site_km) <= GEO_MISMATCH_KM)
        if trusted:
            listing.lat, listing.lng, listing.geo_precision = point["lat"], point["lng"], point["precision"]
            listing.distance_km = round(to_campus, 2)
            listing.walk_min_huron = geo.walk_minutes(geo.haversine_km(here, config.HURON))
        else:
            listing.geo_precision = "unreliable"
    if listing.distance_km is None:
        listing.distance_km = site_km
    listing.walk_min_campus = geo.walk_minutes(listing.distance_km)
    if listing.walk_min_huron is None:
        listing.walk_min_huron = listing.walk_min_campus  # best estimate without a trustworthy point


def update_from_card(saved: dict, card: dict, geocoder: Optional[Geocoder] = None) -> Listing:
    """A listing we already have: refresh what the summary card can tell us (price, date),
    and recompute location from the cached map lookups (no new web requests)."""
    listing = Listing.from_dict(saved)
    if "site_distance_km" not in saved:  # saved before we kept the site's number separately
        listing.site_distance_km = saved.get("distance_km") or None
    if geocoder is not None:
        add_location(listing, geocoder)
    if card["price"] is not None and card["price"] != listing.price:
        basis = "per_room" if listing.price_assumed else card["basis"]
        listing.price = card["price"]
        listing.total_rent, listing.price_per_person = per_person(card["price"], basis, listing.bedrooms)
        listing.est_cost_per_person = est_cost(listing.price_per_person, listing.utilities_included)
    if card["available"]:
        listing.lease_start = card["available"].isoformat()
    listing.change_marker = card_marker(card)
    return listing


def card_marker(card: dict) -> str:
    """Price and date exactly as the list page shows them."""
    return f"{card['price']}|{card['available'].isoformat() if card['available'] else ''}"


def unchanged_since_rejected(previous: Optional[dict], card: dict) -> bool:
    """We dropped this listing before; skip it unless its price or date has changed since."""
    return bool(previous) and previous.get("marker") == card_marker(card)


def quotes_total(description: str, price: int, bedrooms: int) -> bool:
    """Does the description mention a monthly total of about price x bedrooms?

    e.g. listed at "$1090", 2 bedrooms, text says "$2,190/month for the entire apartment"
    -> the $1090 was per person.
    """
    if bedrooms < 2:
        return False
    target = price * bedrooms
    for m in re.finditer(r"\$\s*([\d,]+(?:\.\d+)?)", description or ""):
        amount = float(m.group(1).replace(",", ""))
        if abs(amount - target) <= TOTAL_MATCH_TOLERANCE * target:
            return True
    return False


# ---------- fetching (talks to the website) ----------

class WesternOCH(Source):
    name = "western_och"

    def fetch(self, session: PoliteSession, geocoder: Geocoder, known: Dict[str, dict],
              rejected: Dict[str, dict]) -> List[Listing]:
        landing = session.get(BASE + "/listings/")
        defaults = form_defaults(landing.text)
        cards: Dict[str, dict] = {}
        last_page = None
        for page in range(MAX_PAGES):
            session.post(BASE + "/Listings/SaveFilters", data=search_form(defaults, page))
            html = session.get(BASE + "/Listings/SearchListings").text
            page_cards = parse_cards(html)
            new_ids = [c["id"] for c in page_cards if c["id"] not in cards]
            log.info("page %d: %d cards (%d new)", page, len(page_cards), len(new_ids))
            if not new_ids:
                break
            cards.update({c["id"]: c for c in page_cards})
            shown = max_page(html)  # re-read every page, in case the pager only shows nearby pages
            if shown is not None:
                last_page = shown if last_page is None else max(last_page, shown)
            if last_page is not None and page >= last_page:
                break

        candidates = [c for c in cards.values() if card_passes(c)]
        log.info("%d cards total, %d pass the quick check", len(cards), len(candidates))
        listings = []
        skipped = 0
        for c in candidates:
            if c["id"] in known:
                listings.append(update_from_card(known[c["id"]], c, geocoder))
                continue
            if unchanged_since_rejected(rejected.get(c["id"]), c):
                skipped += 1
                continue
            detail = parse_detail(session.get(c["url"]).text)
            listings.append(build_listing(c, detail, geocoder))
        log.info("skipped %d detail pages we rejected before (price and date unchanged)", skipped)
        return listings
