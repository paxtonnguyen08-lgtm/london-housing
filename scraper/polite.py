"""A web session that follows each site's robots.txt and never hammers a server."""
from __future__ import annotations

import re
import time
import urllib.robotparser
from typing import Callable, Dict, List, Optional
from urllib.parse import urlsplit

import requests

from . import config


class BlockedByRobots(Exception):
    """The site's robots.txt asks bots not to fetch this URL."""


class Robots:
    """robots.txt rules for one site.

    Python's built-in parser only reads the first rule group that applies to us, but some
    sites (like offcampus.uwo.ca) split their rules over several groups. We read every
    group and obey the strictest answer.
    """

    def __init__(self, text: str, user_agent: str):
        self.parsers: List[urllib.robotparser.RobotFileParser] = []
        for group in self._split_groups(text):
            p = urllib.robotparser.RobotFileParser()
            p.parse(group)
            self.parsers.append(p)
        self.user_agent = user_agent

    @staticmethod
    def _split_groups(text: str) -> List[List[str]]:
        groups: List[List[str]] = []
        current: List[str] = []
        seen_rule = False
        for raw in text.splitlines():
            line = raw.split("#")[0].strip()
            if not line:
                continue
            if re.match(r"(?i)user-agent\s*:", line):
                if seen_rule:
                    groups.append(current)
                    current, seen_rule = [], False
            else:
                seen_rule = True
            current.append(line)
        if current:
            groups.append(current)
        return groups

    def can_fetch(self, url: str) -> bool:
        return all(p.can_fetch(self.user_agent, url) for p in self.parsers)

    def crawl_delay(self) -> Optional[float]:
        delays = []
        for p in self.parsers:
            d = p.crawl_delay(self.user_agent)
            if d is not None:
                delays.append(float(d))
        return max(delays) if delays else None


class PoliteSession:
    """Wraps requests.Session: checks robots.txt, waits between requests, retries gently."""

    def __init__(
        self,
        user_agent: str = config.USER_AGENT,
        min_delay: float = config.MIN_DELAY_SECONDS,
        session: Optional[requests.Session] = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        max_retries: int = 3,
    ):
        self.session = session or requests.Session()
        self.session.headers["User-Agent"] = user_agent
        self.user_agent = user_agent
        self.min_delay = min_delay
        self.sleep = sleep
        self.clock = clock
        self.max_retries = max_retries
        self._robots: Dict[str, Robots] = {}
        self._last_request: Dict[str, float] = {}

    def robots_for(self, url: str) -> Robots:
        parts = urlsplit(url)
        host = f"{parts.scheme}://{parts.netloc}"
        if host not in self._robots:
            resp = self.session.get(host + "/robots.txt", timeout=20)
            text = resp.text if resp.status_code == 200 else ""  # no robots.txt = everything allowed
            self._robots[host] = Robots(text, self.user_agent)
        return self._robots[host]

    def delay_for(self, url: str) -> float:
        robots_delay = self.robots_for(url).crawl_delay() or 0
        return max(self.min_delay, robots_delay)

    def _wait_turn(self, url: str) -> None:
        host = urlsplit(url).netloc
        last = self._last_request.get(host)
        if last is not None:
            wait = self.delay_for(url) - (self.clock() - last)
            if wait > 0:
                self.sleep(wait)
        self._last_request[host] = self.clock()

    def request(self, method: str, url: str, **kwargs) -> requests.Response:
        if not self.robots_for(url).can_fetch(url):
            raise BlockedByRobots(url)
        kwargs.setdefault("timeout", 30)
        for attempt in range(1, self.max_retries + 1):
            self._wait_turn(url)
            try:
                resp = self.session.request(method, url, **kwargs)
            except requests.ConnectionError:
                if attempt == self.max_retries:
                    raise
            else:
                if resp.status_code not in (429, 500, 502, 503, 504) or attempt == self.max_retries:
                    resp.raise_for_status()
                    return resp
            self.sleep(30 * attempt)  # back off: 30 s, then 60 s
        raise RuntimeError("unreachable")

    def get(self, url: str, **kwargs) -> requests.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> requests.Response:
        return self.request("POST", url, **kwargs)
