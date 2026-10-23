// The Home tab's map. Leaflet loads only the first time someone opens the map.
import { money, walkLabel } from "./logic.js";
import { BANDS, PLACES, boundsOf } from "./mapdata.js";
import { esc, num } from "./ui.js";

const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
const LEAFLET_JS_SRI = "sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==";
const LEAFLET_CSS_SRI = "sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==";
// OpenStreetMap's own tiles: free for a small personal site like this, with attribution.
// style.css greys them out (and darkens them in dark mode) so the price colours stand out.
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

let leaflet = null; // the loaded library
let loading = null;
let map = null;
let pins = null; // layer holding the house markers
let drawn = ""; // what's on the map now, so a 30 s group refresh doesn't close an open popup

function addTag(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = Object.assign(document.createElement(tag), attrs, { crossOrigin: "anonymous" });
    el.onload = resolve;
    el.onerror = () => reject(new Error("Couldn't load the map. Check your connection."));
    document.head.append(el);
  });
}

function loadLeaflet() {
  loading ??= Promise.all([
    addTag("link", { rel: "stylesheet", href: LEAFLET + "leaflet.min.css", integrity: LEAFLET_CSS_SRI }),
    addTag("script", { src: LEAFLET + "leaflet.min.js", integrity: LEAFLET_JS_SRI }),
  ]).then(() => window.L);
  return loading;
}

// Marker colours come from the page's own colour tokens, so they match light and dark mode.
function colours() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return { fits: v("--good"), stretch: v("--warn"), over: v("--bad"), unknown: v("--text-3"), ink: v("--ink"), bg: v("--bg") };
}

function popup(l, p) {
  const votes = p.match ? "Everyone liked it" : p.likes ? `${p.likes} liked` : "No likes yet";
  return `<div class="map-pop">
    <strong>${esc(l.title)}</strong>
    <div>${money(p.cost)} <span class="muted">/ person · ${num(l.bedrooms)} bed</span></div>
    <div class="muted small">${esc(walkLabel(l))} · ${esc(votes)}</div>
    <button class="pill" type="button" data-open="${esc(l.key)}">Open</button>
  </div>`;
}

function setUp(el, points) {
  const L = leaflet;
  map = L.map(el, { zoomControl: true, scrollWheelZoom: true });
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  for (const place of PLACES) {
    L.marker([place.lat, place.lng], {
      icon: L.divIcon({
        className: "map-place",
        html: `<i></i><span class="${place.side}">${esc(place.name)}</span>`,
        iconSize: null,
      }),
      keyboard: false,
      interactive: false,
    }).addTo(map);
  }
  pins = L.layerGroup().addTo(map);
  map.fitBounds(boundsOf(points), { padding: [24, 24], maxZoom: 15 });
}

// Draw (or redraw) the pins. `byKey` maps a house key to its listing, for the popups.
export async function renderMap(el, points, byKey) {
  leaflet ??= await loadLeaflet();
  if (!map) setUp(el, points);
  else map.invalidateSize(); // the map was hidden while the list showed

  const signature = points.map((p) => `${p.key}:${p.band}:${p.likes}:${p.match}`).join("|");
  if (signature === drawn) return;
  drawn = signature;

  const c = colours();
  pins.clearLayers();
  // Matches last, so they sit on top of nearby pins
  for (const p of [...points].sort((a, b) => Number(a.match) - Number(b.match))) {
    leaflet.circleMarker([p.lat, p.lng], {
      radius: p.match ? 10 : p.likes ? 8 : 6,
      color: p.match ? c.ink : c.bg,
      weight: p.match ? 3 : 1.5,
      fillColor: c[p.band],
      fillOpacity: 0.9,
    }).bindPopup(popup(byKey[p.key], p), { closeButton: false, minWidth: 180 }).addTo(pins);
  }
}

export function legendHtml() {
  return ["fits", "stretch", "over"]
    .map((band) => `<span class="map-key"><i class="dot ${band}"></i>${esc(BANDS[band])}</span>`)
    .join("") + '<span class="map-key"><i class="dot match"></i>Everyone liked it</span>';
}
