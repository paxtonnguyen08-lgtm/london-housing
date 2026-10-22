import pytest

from scraper import config
from scraper.rundown import build, clean, count_baths, is_furnished

SUNSET = (
    "Spacious, fully furnished student house. 5-minute walk to Ontario Hall. "
    "6 bedrooms, with 3 on the main floor and 3 in the basement. 2 bathrooms. "
    "Utilities, high-speed internet, and parking included. "
    "Seeking respectful, clean, quiet male students. Text: 778-555-1234 Email: someone@uwo.ca "
    "Photos: https://drive.google.com/drive/folders/abc"
)


def test_clean_strips_contact_details_and_links():
    out = clean(SUNSET)
    assert "778" not in out and "@" not in out and "drive.google" not in out
    assert "fully furnished" in out


def test_highlights_and_heads_up_for_a_typical_listing():
    hi, hu = build(SUNSET, ["Utilities Incl", "Laundry"], "yes", 6, count_baths(SUNSET))
    assert hi == ["Fully furnished", "2 bathrooms", "Utilities included", "5 min walk to Ontario Hall"]
    assert "Male tenants only" in hu
    assert "Some bedrooms in the basement" in hu


def test_bullets_never_contain_contact_details():
    hi, hu = build(SUNSET + " call 519 555 0100", [], "yes", 5, 2)
    joined = " ".join(hi + hu)
    assert "555" not in joined and "778" not in joined and "@" not in joined and "http" not in joined


def test_limits_bullet_counts():
    text = "Fully furnished, ensuite, parking, laundry, dishwasher, A/C, internet included."
    hi, _ = build(text, [], "yes", 4, 4)
    assert len(hi) == 4


def test_utilities_and_bathroom_heads_up():
    _, hu = build("Nice house. 1 bathroom.", [], "no", 4, 1)
    assert f"Utilities extra (about ${config.UTILITIES_ESTIMATE_PER_PERSON}/person)" in hu
    assert "1 bathroom for 4 people" in hu


def test_damage_deposit_is_flagged_first():
    _, hu = build("First, last and a $500 damage deposit required. Female students only.", [], "yes", 3, None)
    assert hu[0].startswith("Asks for a damage")
    assert "Female tenants only" in hu


def test_price_assumed_heads_up():
    _, hu = build("Nice.", [], "yes", 4, None, price_assumed=True)
    assert "Price didn't say per bedroom; assumed per room" in hu


def test_invite_only_and_no_parking():
    hi, hu = build("Showing by invite only. No parking.", [], "yes", 4, None)
    assert "Viewings by invite only" in hu and "No parking" in hu
    assert "Parking" not in hi


def test_count_baths():
    assert count_baths("Two full bathrooms") == 2
    assert count_baths("1.5 bath") == 1.5
    assert count_baths("5 ensuite bathrooms") is None  # ensuites get their own highlight instead
    assert count_baths("a 6-bathroom home") == 6
    assert count_baths("no info") is None


def test_is_furnished():
    assert is_furnished("", ["Furniture Incl"]) is True
    assert is_furnished("Unfurnished unit", []) is False
    assert is_furnished("Partially furnished", []) is True
    assert is_furnished("Nice house", []) is None


@pytest.mark.parametrize("text", [
    "Male or female students welcome.",
    "Open to male and female tenants.",
    "Female/male tenants welcome.",
    "Co-ed house, all genders welcome.",
])
def test_mixed_gender_wording_gives_no_gender_heads_up(text):
    # Review finding 5: these used to say "Female tenants only"
    _, hu = build(text, [], "yes", 4, None)
    assert not any("tenants only" in h for h in hu)


@pytest.mark.parametrize("text,expected", [
    ("Seeking female students only.", "Female tenants only"),
    ("Seeking respectful, clean, quiet, and considerate male students", "Male tenants only"),  # 301 Neville
    ("Male students only please.", "Male tenants only"),
])
def test_single_gender_wording_still_flagged(text, expected):
    _, hu = build(text, [], "yes", 4, None)
    assert expected in hu
