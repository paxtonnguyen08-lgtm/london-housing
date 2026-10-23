// What goes on the map: plain data, no Leaflet, so it can be tested without a browser.
import { costOf, filterListings, isMatch, statusOf, votesFor } from "./logic.js";

// Landmarks shown on every map (same points the scraper measures walk times to).
// `side` keeps the two labels apart: they're only ~430 m from each other.
export const PLACES = [
  { name: "Western", lat: 43.0084, lng: -81.2733, side: "right" },
  { name: "Huron", lat: 43.0087105, lng: -81.2786155, side: "left" },
];

// How far over budget still counts as a "stretch" rather than "over".
export const STRETCH = 100;

export const BANDS = {
  fits: "Fits your budget",
  stretch: `Up to $${STRETCH} over`,
  over: `More than $${STRETCH} over`,
  unknown: "No budget set",
};

// Colour band for one house: compared with my budget, per person, utilities included.
export function priceBand(cost, budget) {
  if (cost == null || !budget) return "unknown";
  if (cost <= budget) return "fits";
  if (cost <= budget + STRETCH) return "stretch";
  return "over";
}

const hasPoint = (l) => Number.isFinite(l.lat) && Number.isFinite(l.lng);

// The houses to pin: same filters as the list, minus ones the group rejected.
// Houses without a trustworthy location can't be pinned; they're counted in `missing`.
export function mapPoints(listings, filters, state, { budget, members = [] } = {}) {
  const points = [];
  const missing = [];
  for (const l of filterListings(listings, filters)) {
    if (statusOf(state, l.key) === "rejected") continue;
    if (!hasPoint(l)) {
      missing.push(l.key);
      continue;
    }
    const cost = costOf(l);
    points.push({
      key: l.key,
      lat: l.lat,
      lng: l.lng,
      cost,
      band: priceBand(cost, budget),
      likes: votesFor(state, l.key).likes.length,
      match: isMatch(state, l.key, members),
    });
  }
  return { points, missing };
}

// [[south, west], [north, east]] around every pin and landmark, so nothing starts off-screen.
export function boundsOf(points, places = PLACES) {
  const all = [...points, ...places];
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
}
