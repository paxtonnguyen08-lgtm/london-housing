import json

import pytest

from alerts import email_digest as ed
from scraper import config


def listing(i, cost=1000, **kw):
    base = dict(title=f"{i} Test St", url=f"https://offcampus.uwo.ca/Listings/Details/{i}", is_new=True,
                active=True, est_cost_per_person=cost, price_per_person=cost, utilities_included="yes",
                bedrooms=4, baths=2, walk_min_huron=12, walk_min_campus=10, lease_start="2027-05-01",
                highlights=["Furnished"], heads_up=[])
    base.update(kw)
    return base


GMAIL_ENV = {"SMTP_USER": "house.finder@gmail.com", "SMTP_PASSWORD": "abcd efgh ijkl mnop",
             "ALERT_TO": "a@x.ca, b@x.ca ,", "SITE_URL": "https://me.github.io/london-housing/"}


class FakeSMTP:
    """Records what would be sent instead of talking to a mail server."""
    instances = []

    def __init__(self, host, port, timeout=None, **kwargs):
        self.host, self.port, self.kwargs = host, port, kwargs
        self.calls = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self, context=None):
        self.calls.append("starttls")

    def login(self, user, password):
        self.calls.append(("login", user, password))

    def send_message(self, msg):
        self.calls.append(("send", msg))


@pytest.fixture(autouse=True)
def reset_fake():
    FakeSMTP.instances = []


def write_data(tmp_path, listings):
    p = tmp_path / "listings.json"
    p.write_text(json.dumps({"last_run": "x", "listings": listings}))
    return p


# ---------- picking listings ----------

def test_new_listings_only_new_and_active_cheapest_first():
    data = {"listings": [listing(1, 1200), listing(2, 900), listing(3, 800, is_new=False),
                         listing(4, 700, active=False), listing(5, None, price_per_person=None)]}
    assert [l["title"] for l in ed.new_listings(data)] == ["2 Test St", "1 Test St", "5 Test St"]


def test_cost_falls_back_to_price_per_person():
    assert ed.cost({"est_cost_per_person": None, "price_per_person": 950}) == 950
    assert ed.cost({}) is None


def test_subject_one_vs_many():
    assert ed.subject([listing(1, 1050)]) == "New house near Western: $1,050/person, 1 Test St"
    assert ed.subject([listing(1, 900), listing(2, 1200)]) == "2 new houses near Western, from $900/person"


def test_subject_survives_line_breaks_in_titles():
    # A line break in an email header crashes Python's email library
    new = [listing(1, title="12 Odd\nStreet  Unit\r2")]
    assert "\n" not in ed.subject(new) and "\r" not in ed.subject(new)
    msg = ed.build_message(new, ed.Settings.from_env(GMAIL_ENV))
    assert msg["Subject"].endswith("12 Odd Street Unit 2")


def test_facts_and_price_note():
    assert ed.facts(listing(1)) == "4 bed · 2 bath · 12 min walk to Huron · May 1"
    assert ed.facts(listing(1, walk_min_huron=None, baths=None)) == "4 bed · 10 min walk to campus · May 1"
    assert ed.price_note(listing(1)) == "utilities included"
    assert ed.price_note(listing(1, utilities_included="no")) == \
        f"incl. ~${config.UTILITIES_ESTIMATE_PER_PERSON} utilities estimate"
    assert ed.price_note(listing(1, utilities_included="unknown")) == "utilities not stated"


# ---------- rendering ----------

def test_text_caps_the_list_and_links_the_site():
    new = [listing(i, 800 + i) for i in range(ed.MAX_IN_EMAIL + 3)]
    text = ed.render_text(new, "https://site/")
    assert text.count("https://offcampus.uwo.ca/Listings/Details/") == ed.MAX_IN_EMAIL
    assert "...and 3 more on the group page." in text
    assert "Vote on them: https://site/" in text


def test_html_escapes_listing_text():
    new = [listing(1, title="<script>alert(1)</script> & Co", highlights=["<b>big</b>"])]
    page = ed.render_html(new)
    assert "<script>alert" not in page and "&lt;script&gt;" in page
    assert "&lt;b&gt;big&lt;/b&gt;" in page
    assert "Vote with the group" not in page  # no site link given


def test_html_has_button_and_more_row():
    new = [listing(i) for i in range(ed.MAX_IN_EMAIL + 1)]
    page = ed.render_html(new, "https://me.github.io/london-housing/")
    assert "Vote with the group" in page and "And 1 more on the group page." in page


# ---------- settings ----------

def test_settings_gmail_defaults():
    s = ed.Settings.from_env(GMAIL_ENV)
    assert (s.host, s.port, s.security) == ("smtp.gmail.com", 465, "ssl")
    assert s.recipients == ["a@x.ca", "b@x.ca"]
    assert s.sender == "house.finder@gmail.com"
    assert s.missing == []


def test_settings_ports_follow_security():
    assert ed.Settings.from_env({"SMTP_SECURITY": "starttls"}).port == 587
    assert ed.Settings.from_env({"SMTP_SECURITY": "none"}).port == 25
    assert ed.Settings.from_env({"SMTP_SECURITY": "ssl", "SMTP_PORT": "2465"}).port == 2465


def test_settings_bad_port_is_a_clear_error():
    with pytest.raises(SystemExit) as err:
        ed.Settings.from_env({"SMTP_PORT": "four-six-five"})
    assert "SMTP_PORT" in str(err.value)


def test_settings_missing_lists_what_to_add():
    assert set(ed.Settings.from_env({}).missing) == {"ALERT_TO", "SMTP_USER or ALERT_FROM", "SMTP_USER", "SMTP_PASSWORD"}
    # Blank secrets count as missing (GitHub passes "" for secrets that don't exist)
    assert "SMTP_PASSWORD" in ed.Settings.from_env(dict(GMAIL_ENV, SMTP_PASSWORD="  ")).missing


# ---------- main: when it sends and when it doesn't ----------

def test_no_data_file_sends_nothing(tmp_path):
    assert ed.main(["--data", str(tmp_path / "none.json")], GMAIL_ENV, FakeSMTP) == 0
    assert FakeSMTP.instances == []


def test_nothing_new_sends_nothing(tmp_path):
    p = write_data(tmp_path, [listing(1, is_new=False)])
    assert ed.main(["--data", str(p)], GMAIL_ENV, FakeSMTP) == 0
    assert FakeSMTP.instances == []


def test_not_set_up_yet_prints_instead_of_sending(tmp_path, caplog):
    p = write_data(tmp_path, [listing(1)])
    with caplog.at_level("INFO", logger="alerts"):
        assert ed.main(["--data", str(p)], {}, FakeSMTP) == 0
    assert FakeSMTP.instances == []
    assert "isn't set up yet" in caplog.text and "1 Test St" in caplog.text


def test_preview_writes_html_and_sends_nothing(tmp_path):
    p = write_data(tmp_path, [listing(1)])
    out = tmp_path / "preview.html"
    assert ed.main(["--data", str(p), "--preview", str(out)], GMAIL_ENV, FakeSMTP) == 0
    assert "1 Test St" in out.read_text() and FakeSMTP.instances == []


def test_sends_through_gmail_ssl(tmp_path):
    p = write_data(tmp_path, [listing(1, 1100), listing(2, 900)])
    assert ed.main(["--data", str(p)], GMAIL_ENV, FakeSMTP) == 0
    [smtp] = FakeSMTP.instances
    assert (smtp.host, smtp.port) == ("smtp.gmail.com", 465) and "context" in smtp.kwargs
    assert smtp.calls[0] == ("login", "house.finder@gmail.com", "abcd efgh ijkl mnop")
    msg = smtp.calls[1][1]
    assert msg["To"] == "a@x.ca, b@x.ca"
    assert msg["From"] == "House finder <house.finder@gmail.com>"
    assert msg["Subject"] == "2 new houses near Western, from $900/person"
    kinds = [part.get_content_type() for part in msg.iter_parts()]
    assert kinds == ["text/plain", "text/html"]


def test_starttls_mode(tmp_path):
    p = write_data(tmp_path, [listing(1)])
    env = dict(GMAIL_ENV, SMTP_SECURITY="starttls", SMTP_HOST="smtp.example.com")
    ed.main(["--data", str(p)], env, FakeSMTP)
    [smtp] = FakeSMTP.instances
    assert smtp.port == 587 and smtp.calls[0] == "starttls" and smtp.calls[1][0] == "login"


def test_send_failure_is_reported_not_hidden(tmp_path):
    class BadLogin(FakeSMTP):
        def login(self, user, password):
            raise ed.smtplib.SMTPAuthenticationError(535, b"Username and Password not accepted")

    p = write_data(tmp_path, [listing(1)])
    assert ed.main(["--data", str(p)], GMAIL_ENV, BadLogin) == 1
