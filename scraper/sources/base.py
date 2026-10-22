"""What every listing source looks like. To add a site, subclass Source."""
from __future__ import annotations

from typing import Dict, List

from ..geo import Geocoder
from ..models import Listing
from ..polite import PoliteSession


class Source:
    name = "base"

    def fetch(self, session: PoliteSession, geocoder: Geocoder, known: Dict[str, dict],
              rejected: Dict[str, dict]) -> List[Listing]:
        """Return candidate listings from this site.

        `known` maps this source's listing ids to what we saved last time, and `rejected`
        maps ids we dropped before to {"marker", ...} (the Listing.change_marker it had), so a source can skip
        re-downloading detail pages it has already seen.
        """
        raise NotImplementedError
