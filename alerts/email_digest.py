"""Email the group a short digest of houses that are new since the last scraper run.

Usage:
  .venv/bin/python -m alerts.email_digest                       # send it (or print it if email isn't set up)
  .venv/bin/python -m alerts.email_digest --preview out.html    # save the email as a page to look at

Email settings come from environment variables (GitHub secrets in the daily run):
  SMTP_USER       the Gmail address that sends the email
  SMTP_PASSWORD   a Gmail "app password" (not your normal password; see docs/github-setup.md)
  ALERT_TO        who gets it, comma-separated: "you@gmail.com, friend@gmail.com"
  SITE_URL        optional link to the group page
  SMTP_HOST / SMTP_PORT / SMTP_SECURITY   optional, default smtp.gmail.com / 465 / ssl
"""
from __future__ import annotations

import argparse
import html
import json
import logging
import os
import smtplib
import ssl
import sys
from dataclasses import dataclass, field
from datetime import date
from email.message import EmailMessage
from pathlib import Path
from typing import Callable, List, Mapping, Optional

from scraper import config

log = logging.getLogger("alerts")

MAX_IN_EMAIL = 15  # the first run can find dozens; the rest are on the site


# ---------- picking and describing listings ----------

def cost(l: dict) -> Optional[int]:
    """What one person pays per month, utilities estimate included."""
    return l.get("est_cost_per_person") if l.get("est_cost_per_person") is not None else l.get("price_per_person")


def walk_label(l: dict) -> Optional[str]:
    if l.get("walk_min_huron") is not None:
        return f"{l['walk_min_huron']} min walk to Huron"
    if l.get("walk_min_campus") is not None:
        return f"{l['walk_min_campus']} min walk to campus"
    return None


def money(n: Optional[int]) -> str:
    return "?" if n is None else f"${n:,}"


def short_date(iso: Optional[str]) -> Optional[str]:
    if not iso:
        return None
    d = date.fromisoformat(iso)
    return f"{d.strftime('%b')} {d.day}"


def new_listings(data: dict) -> List[dict]:
    """Houses first seen in the latest run and still listed, cheapest first."""
    new = [l for l in data.get("listings", []) if l.get("is_new") and l.get("active", True)]
    big = 10 ** 9
    return sorted(new, key=lambda l: (cost(l) if cost(l) is not None else big,
                                      l.get("walk_min_huron") or l.get("walk_min_campus") or big))


def subject(new: List[dict]) -> str:
    cheapest = next((cost(l) for l in new if cost(l) is not None), None)
    if len(new) == 1:
        title = " ".join(str(new[0]["title"]).split())  # a line break in a header would crash sending
        return f"New house near Western: {money(cheapest)}/person, {title}"
    return f"{len(new)} new houses near Western, from {money(cheapest)}/person"


def facts(l: dict) -> str:
    """'4 bed · 2 bath · 12 min walk to Huron · May 1'"""
    parts = []
    if l.get("bedrooms"):
        parts.append(f"{l['bedrooms']} bed")
    if l.get("baths"):
        parts.append(f"{l['baths']:g} bath")
    if walk_label(l):
        parts.append(walk_label(l))
    if short_date(l.get("lease_start")):
        parts.append(short_date(l["lease_start"]))
    return " · ".join(parts)


def price_note(l: dict) -> str:
    if l.get("utilities_included") == "yes":
        return "utilities included"
    if l.get("utilities_included") == "no":
        return f"incl. ~${config.UTILITIES_ESTIMATE_PER_PERSON} utilities estimate"
    return "utilities not stated"


# ---------- the email itself ----------

def render_text(new: List[dict], site_url: Optional[str] = None) -> str:
    lines = [subject(new), ""]
    for l in new[:MAX_IN_EMAIL]:
        lines.append(f"{money(cost(l))}/person ({price_note(l)})  {l['title']}")
        lines.append(f"  {facts(l)}")
        if l.get("highlights"):
            lines.append("  + " + ", ".join(l["highlights"]))
        if l.get("heads_up"):
            lines.append("  ! " + ", ".join(l["heads_up"]))
        lines.append(f"  {l['url']}")
        lines.append("")
    if len(new) > MAX_IN_EMAIL:
        lines.append(f"...and {len(new) - MAX_IN_EMAIL} more on the group page.")
    if site_url:
        lines.append(f"Vote on them: {site_url}")
    return "\n".join(lines).rstrip() + "\n"


_SERIF = "Georgia, 'Times New Roman', serif"
_SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"


def render_html(new: List[dict], site_url: Optional[str] = None) -> str:
    """Email-safe HTML: tables and inline styles, because email apps ignore most CSS."""
    e = html.escape
    rows = []
    for l in new[:MAX_IN_EMAIL]:
        highlights = " · ".join(e(h) for h in l.get("highlights", []))
        heads_up = " · ".join(e(h) for h in l.get("heads_up", []))
        rows.append(f"""
        <tr><td style="padding:20px 0;border-top:1px solid #e6e4df;">
          <div style="font-family:{_SERIF};font-size:30px;line-height:1.1;color:#141413;">{e(money(cost(l)))}
            <span style="font-family:{_SANS};font-size:13px;color:#73726c;">/person · {e(price_note(l))}</span></div>
          <div style="font-family:{_SANS};font-size:16px;font-weight:600;color:#141413;padding-top:6px;">
            <a href="{e(l['url'])}" style="color:#141413;text-decoration:none;">{e(l['title'])}</a></div>
          <div style="font-family:{_SANS};font-size:14px;color:#73726c;padding-top:2px;">{e(facts(l))}</div>
          {f'<div style="font-family:{_SANS};font-size:13px;color:#2f6b3a;padding-top:8px;">{highlights}</div>' if highlights else ''}
          {f'<div style="font-family:{_SANS};font-size:13px;color:#8a5a00;padding-top:4px;">{heads_up}</div>' if heads_up else ''}
          <div style="padding-top:10px;"><a href="{e(l['url'])}" style="font-family:{_SANS};font-size:13px;color:#141413;">View listing</a></div>
        </td></tr>""")
    more = (f'<tr><td style="padding:16px 0;border-top:1px solid #e6e4df;font-family:{_SANS};font-size:14px;color:#73726c;">'
            f'And {len(new) - MAX_IN_EMAIL} more on the group page.</td></tr>') if len(new) > MAX_IN_EMAIL else ""
    button = (f'<tr><td style="padding:24px 0 8px;"><a href="{e(site_url)}" style="display:inline-block;background:#141413;'
              f'color:#ffffff;font-family:{_SANS};font-size:15px;text-decoration:none;padding:12px 24px;border-radius:999px;">'
              f'Vote with the group</a></td></tr>') if site_url else ""
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(subject(new))}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
  <tr><td style="font-family:{_SANS};font-size:13px;color:#73726c;padding-bottom:4px;">House hunt · new since last check</td></tr>
  <tr><td style="font-family:{_SERIF};font-size:28px;line-height:1.2;color:#141413;padding-bottom:12px;">{e(subject(new))}</td></tr>
  {''.join(rows)}
  {more}
  {button}
  <tr><td style="font-family:{_SANS};font-size:12px;color:#9c9a92;padding-top:24px;">From your London house finder. Listings from Western Off-Campus Housing.</td></tr>
</table></td></tr></table>
</body></html>
"""


@dataclass
class Settings:
    user: Optional[str] = None
    password: Optional[str] = None
    recipients: List[str] = field(default_factory=list)
    sender: Optional[str] = None
    site_url: Optional[str] = None
    host: str = "smtp.gmail.com"
    port: int = 465
    security: str = "ssl"  # "ssl", "starttls" or "none" (none is only for local testing)

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "Settings":
        def get(name: str) -> Optional[str]:
            value = (env.get(name) or "").strip()
            return value or None

        security = (get("SMTP_SECURITY") or "ssl").lower()
        port = get("SMTP_PORT")
        if port is not None and not port.isdigit():
            raise SystemExit(f"SMTP_PORT should be a number like 465, not {port!r}")
        return cls(
            user=get("SMTP_USER"),
            password=get("SMTP_PASSWORD"),
            recipients=[r.strip() for r in (get("ALERT_TO") or "").split(",") if r.strip()],
            sender=get("ALERT_FROM") or get("SMTP_USER"),
            site_url=get("SITE_URL"),
            host=get("SMTP_HOST") or "smtp.gmail.com",
            port=int(port or (587 if security == "starttls" else 25 if security == "none" else 465)),
            security=security,
        )

    @property
    def missing(self) -> List[str]:
        """Which settings still need filling in before we can send."""
        needed = {"ALERT_TO": self.recipients, "SMTP_USER or ALERT_FROM": self.sender}
        if self.security != "none":
            needed.update({"SMTP_USER": self.user, "SMTP_PASSWORD": self.password})
        return [name for name, value in needed.items() if not value]


def build_message(new: List[dict], settings: Settings) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject(new)
    msg["From"] = f"House finder <{settings.sender}>"
    msg["To"] = ", ".join(settings.recipients)
    msg.set_content(render_text(new, settings.site_url))
    msg.add_alternative(render_html(new, settings.site_url), subtype="html")
    return msg


def send(msg: EmailMessage, settings: Settings, smtp_factory: Optional[Callable] = None) -> None:
    if smtp_factory is None:
        smtp_factory = smtplib.SMTP_SSL if settings.security == "ssl" else smtplib.SMTP
    kwargs = {"context": ssl.create_default_context()} if settings.security == "ssl" else {}
    with smtp_factory(settings.host, settings.port, timeout=30, **kwargs) as smtp:
        if settings.security == "starttls":
            smtp.starttls(context=ssl.create_default_context())
        if settings.user and settings.password:
            smtp.login(settings.user, settings.password)
        smtp.send_message(msg)


def main(argv: Optional[List[str]] = None, env: Optional[Mapping[str, str]] = None,
         smtp_factory: Optional[Callable] = None) -> int:
    parser = argparse.ArgumentParser(description="Email the group about new houses.")
    parser.add_argument("--data", type=Path, default=config.LISTINGS_PATH)
    parser.add_argument("--preview", type=Path, help="save the email as an HTML file instead of sending")
    args = parser.parse_args(argv)
    settings = Settings.from_env(os.environ if env is None else env)

    data = json.loads(args.data.read_text()) if args.data.exists() else {"listings": []}
    new = new_listings(data)
    if not new:
        log.info("No new houses this run, so no email.")
        return 0

    if args.preview:
        args.preview.write_text(render_html(new, settings.site_url))
        log.info("Saved a preview of the email to %s", args.preview)
        return 0

    if settings.missing:
        log.info("Email isn't set up yet (missing: %s). Here's what it would say:\n\n%s",
                 ", ".join(settings.missing), render_text(new, settings.site_url))
        return 0

    try:
        send(build_message(new, settings), settings, smtp_factory)
    except smtplib.SMTPAuthenticationError:
        log.error("Gmail didn't accept the login. SMTP_PASSWORD must be a 16-letter Gmail *app password* "
                  "(see docs/github-setup.md), not your normal Gmail password.")
        return 1
    except (smtplib.SMTPException, OSError) as err:
        log.error("Couldn't send the email: %s", err)
        return 1
    log.info("Emailed %d new house(s) to %d people.", len(new), len(settings.recipients))
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    sys.exit(main())
