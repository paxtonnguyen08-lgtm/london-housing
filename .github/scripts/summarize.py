"""Summarize data/listings.json for the daily GitHub Actions run.

    python .github/scripts/summarize.py data/listings.json --count     -> "3" (new listings)
    python .github/scripts/summarize.py data/listings.json --markdown  -> a table for the run's summary page
"""
import json
import sys


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return {"last_run": None, "listings": []}


def new_listings(data):
    return [l for l in data["listings"] if l.get("is_new") and l.get("active", True)]


def money(n):
    return f"${n:,}" if isinstance(n, int) else "?"


def markdown(data):
    active = [l for l in data["listings"] if l.get("active", True)]
    new = new_listings(data)
    lines = [f"### {len(new)} new · {len(active)} active listings", ""]
    if not new:
        lines.append("Nothing new this run.")
        return "\n".join(lines)
    lines += ["| Cost / person | Beds | Walk to Huron | Starts | Listing |", "|---|---|---|---|---|"]
    for l in sorted(new, key=lambda l: l.get("est_cost_per_person") or 10**9):
        walk = l.get("walk_min_huron") if l.get("walk_min_huron") is not None else l.get("walk_min_campus")
        walk_text = f"{walk} min" if walk is not None else "?"
        title = str(l.get("title", "")).replace("|", "/")
        lines.append(f"| {money(l.get('est_cost_per_person'))} | {l.get('bedrooms', '?')} | {walk_text} "
                     f"| {l.get('lease_start') or '?'} | [{title}]({l.get('url', '')}) |")
    return "\n".join(lines)


if __name__ == "__main__":
    path, mode = sys.argv[1], sys.argv[2]
    data = load(path)
    print(len(new_listings(data)) if mode == "--count" else markdown(data))
