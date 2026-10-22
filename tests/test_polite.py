import pytest
import requests

from scraper.polite import BlockedByRobots, PoliteSession, Robots

UWO_ROBOTS = """
User-agent: *
Disallow: /honeypot.html
Crawl-delay: 10
User-agent: *
Allow: /core/*.css$
Disallow: /core/
Disallow: /admin/
"""


def test_robots_reads_every_group():
    r = Robots(UWO_ROBOTS, "my-bot")
    assert r.can_fetch("https://x.ca/Listings/Details/1")
    assert not r.can_fetch("https://x.ca/honeypot.html")  # first group
    assert not r.can_fetch("https://x.ca/admin/page")  # second group, missed by Python's parser alone
    assert r.crawl_delay() == 10


def test_robots_empty_allows_everything():
    r = Robots("", "my-bot")
    assert r.can_fetch("https://x.ca/anything")
    assert r.crawl_delay() is None


class FakeResponse:
    def __init__(self, status=200, text=""):
        self.status_code = status
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))


class FakeSession:
    """Stands in for requests.Session so tests never touch the internet."""

    def __init__(self, robots_text, responses):
        self.headers = {}
        self.robots_text = robots_text
        self.responses = list(responses)
        self.calls = []

    def get(self, url, timeout=None):
        return FakeResponse(200, self.robots_text)

    def request(self, method, url, **kwargs):
        self.calls.append((method, url))
        return self.responses.pop(0)


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def sleep(self, s):
        self.sleeps.append(round(s, 2))
        self.now += s

    def __call__(self):
        return self.now


def make(robots_text, responses, min_delay=3):
    clock = FakeClock()
    fake = FakeSession(robots_text, responses)
    ps = PoliteSession(user_agent="my-bot", min_delay=min_delay, session=fake, sleep=clock.sleep, clock=clock)
    return ps, fake, clock


def test_waits_crawl_delay_between_requests():
    ps, fake, clock = make(UWO_ROBOTS, [FakeResponse(), FakeResponse(), FakeResponse()])
    ps.get("https://x.ca/a")
    ps.get("https://x.ca/b")
    ps.post("https://x.ca/c")
    assert clock.sleeps == [10, 10]  # robots says 10 s, more than our 3 s minimum
    assert [c[0] for c in fake.calls] == ["GET", "GET", "POST"]


def test_uses_own_minimum_when_robots_has_no_delay():
    ps, _, clock = make("User-agent: *\nDisallow:", [FakeResponse(), FakeResponse()])
    ps.get("https://x.ca/a")
    ps.get("https://x.ca/b")
    assert clock.sleeps == [3]


def test_refuses_disallowed_url():
    ps, fake, _ = make(UWO_ROBOTS, [])
    with pytest.raises(BlockedByRobots):
        ps.get("https://x.ca/honeypot.html")
    assert fake.calls == []


def test_retries_on_server_error_then_succeeds():
    ps, fake, clock = make("", [FakeResponse(503), FakeResponse(200, "ok")])
    assert ps.get("https://x.ca/a").text == "ok"
    assert len(fake.calls) == 2
    assert 30 in clock.sleeps  # backed off before retrying


def test_gives_up_after_max_retries():
    ps, fake, _ = make("", [FakeResponse(503)] * 3)
    with pytest.raises(requests.HTTPError):
        ps.get("https://x.ca/a")
    assert len(fake.calls) == 3


def test_does_not_retry_not_found():
    ps, fake, _ = make("", [FakeResponse(404)])
    with pytest.raises(requests.HTTPError):
        ps.get("https://x.ca/missing")
    assert len(fake.calls) == 1
