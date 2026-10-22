# London student-house finder

A personal tool for our friend group. It finds 2–5 bedroom houses and apartments near Western for a May 2027 lease.

**Phase 1 (this part)** is a scraper that reads Western's Off-Campus Housing listings and saves the good ones to `data/listings.json`. Later phases add:
- a shared swipe-and-vote web page
- daily automatic runs with phone alerts
- suggestions based on what the group likes

## Setup (once)

```bash
python3 -m venv .venv
```
```bash
.venv/bin/pip install -r requirements.txt
```

`.venv` is a private Python environment for this project, so these packages don't mix with anything else on your computer.

## Run the scraper

```bash
.venv/bin/python -m scraper.run
```

The site asks bots to wait 10 seconds between requests, so the first run takes a while (about 20–30 min). It has to open each matching listing once. Later runs only open listings they haven't seen before, so they're much faster.

## Run the tests

```bash
.venv/bin/pytest
```

The tests use saved copies of the site's pages in `tests/fixtures/`, with contact details removed. They never touch the internet.

## What's in `data/listings.json`

```json
{ "last_run": "...", "listings": [ { ... one listing ... } ] }
```

| field | meaning |
|---|---|
| `price_per_person` | rent per person (one person per bedroom) |
| `price_basis` | `per_room` if the ad priced each bedroom, `whole_unit` if it priced the whole place |
| `price_assumed` | `true` if the ad didn't say and we guessed (e.g. "$900" for 4 bedrooms must be per room) |
| `est_cost_per_person` | price per person + about $100 for utilities if they aren't included |
| `walk_min_campus` / `walk_min_huron` | estimated walk: straight-line distance × 1.3 at 5 km/h |
| `geo_precision` | `street` means we only know the street, not the exact house, so Huron walk times can be off by a few minutes |
| `highlights` / `heads_up` | short bullets pulled from the ad (furnished, basement bedrooms, …) |
| `is_new` | first seen on the latest run |
| `active` | `false` once the listing disappears from the site (kept so votes aren't lost) |

Landlord names, phone numbers, emails and ad descriptions are **never saved**, because this file will be public.

## How it's organized

```
scraper/
  config.py        settings: filters, campus locations, delays
  run.py           the entry point: runs sources, filters, saves
  sources/         one file per website; add a site by adding a file and listing it in __init__.py
  polite.py        follows robots.txt and waits between requests
  normalize.py     prices, dates, addresses
  geo.py           map lookups (OpenStreetMap) and walk times
  rundown.py       highlight / heads-up bullets
  filters.py       the keep/drop rules
  store.py         merging into listings.json
```

## Being a good citizen

- It follows each site's `robots.txt`, including its crawl delay.
- It identifies itself honestly in the User-Agent.
- It only re-downloads pages it hasn't seen.
- rentals.ca blocks bots with a Cloudflare challenge, so we don't scrape it.
