"""Settings for the scraper. Change values here, not in the code."""
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
LISTINGS_PATH = DATA_DIR / "listings.json"
GEOCACHE_PATH = DATA_DIR / "geocache.json"

# What we're looking for
MIN_BEDROOMS = 2
MAX_BEDROOMS = 5
MAX_DISTANCE_KM = 5.0
LEASE_START_EARLIEST = date(2027, 4, 1)
LEASE_START_LATEST = date(2027, 6, 30)
WHOLE_UNIT_TYPES = {"House", "Apartment"}

# Places we measure walk times to (lat, lng), from OpenStreetMap
MAIN_CAMPUS = (43.0084, -81.2733)  # University College / UCC area
HURON = (43.0087105, -81.2786155)  # Huron University College, 1349 Western Rd

# Walking estimate: straight-line distance x detour factor, at walking speed
WALK_SPEED_KMH = 5.0
DETOUR_FACTOR = 1.3

# Added to price per person when utilities aren't included, so places compare fairly
UTILITIES_ESTIMATE_PER_PERSON = 100

# Being polite to websites
USER_AGENT = "london-housing-student-project/0.1 (personal, non-commercial; daily)"
MIN_DELAY_SECONDS = 3.0  # used when robots.txt doesn't ask for more
GEOCODE_DELAY_SECONDS = 1.1  # Nominatim's rule is max 1 request per second
