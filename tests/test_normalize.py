from datetime import date

import pytest

from scraper import config
from scraper.normalize import (
    est_cost, has_house_number, normalize_address, parse_available, parse_float,
    parse_int, parse_price, parse_utilities, per_person, unit_of,
)


@pytest.mark.parametrize("text,expected", [
    ("$1150 per bdrm", (1150, "per_room")),
    ("$1,195", (1195, "whole_unit")),
    ("$ 2,400  ", (2400, "whole_unit")),
    ("$995 per bedroom", (995, "per_room")),
    ("Call for price", (None, "unknown")),
])
def test_parse_price(text, expected):
    assert parse_price(text) == expected


def test_per_person_per_room_multiplies():
    assert per_person(1150, "per_room", 5) == (5750, 1150)


def test_per_person_whole_unit_divides_and_rounds():
    assert per_person(3000, "whole_unit", 4) == (3000, 750)
    assert per_person(2500, "whole_unit", 3) == (2500, 833)


def test_per_person_missing_data():
    assert per_person(None, "per_room", 4) == (None, None)
    assert per_person(2000, "whole_unit", None) == (None, None)
    assert per_person(2000, "whole_unit", 0) == (None, None)


def test_est_cost_adds_utilities_only_when_not_included():
    extra = config.UTILITIES_ESTIMATE_PER_PERSON
    assert est_cost(1000, "yes") == 1000
    assert est_cost(1000, "no") == 1000 + extra
    assert est_cost(1000, "unknown") == 1000 + extra
    assert est_cost(None, "yes") is None


@pytest.mark.parametrize("text,expected", [
    ("Available May 1, 2027", date(2027, 5, 1)),
    ("Available December 20, 2026", date(2026, 12, 20)),
    ("Available Sept 1 2027", date(2027, 9, 1)),
    ("Available Sep. 1, 2027", date(2027, 9, 1)),
    ("available may 1, 2027", date(2027, 5, 1)),
    ("Available Smarch 1, 2027", None),
    ("Available Immediately", None),
    ("", None),
])
def test_parse_available(text, expected):
    assert parse_available(text) == expected


@pytest.mark.parametrize("text,expected", [
    ("Included", "yes"), ("Not Included", "no"), ("Extra", "no"),
    ("", "unknown"), ("Some", "unknown"),
])
def test_parse_utilities(text, expected):
    assert parse_utilities(text) == expected


def test_parse_numbers():
    assert parse_float("0.90 Km") == 0.9
    assert parse_float("n/a") is None
    assert parse_int("\n   12\n ") == 12
    assert parse_int("") is None


@pytest.mark.parametrize("a,b", [
    ("1100 Sunset Street, London, ON", "1100 sunset st."),
    ("1100 SUNSET ST", "1100 Sunset Street"),
    ("Unit 3 - 45 Western Road", "45 Western Rd"),
    ("3-45 Western Road", "45 western rd"),
    ("#2 45 Western Road North", "45 Western Rd N"),
])
def test_normalize_address_same_house(a, b):
    assert normalize_address(a) == normalize_address(b)


def test_normalize_address_different_houses_differ():
    assert normalize_address("1100 Sunset St") != normalize_address("1104 Sunset St")
    assert normalize_address("45 Western Rd") != normalize_address("45 Western Rd N")


@pytest.mark.parametrize("addr,expected", [
    ("1100 Sunset", True), ("Unit 3 - 45 Western Rd", True), ("Trott drive", False), ("", False),
])
def test_has_house_number(addr, expected):
    assert has_house_number(addr) is expected


@pytest.mark.parametrize("addr,unit", [
    ("Unit 2 - 45 Western Rd", "2"), ("3-45 Western Rd", "3"), ("#B 45 Elm St", "b"),
    ("Apt 10, 99 Oxford St", "10"), ("45 Western Rd", None), ("Trott drive", None),
])
def test_unit_of(addr, unit):
    assert unit_of(addr) == unit
