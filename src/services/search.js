// Unified search: airports, cities, countries, live flights and satellites (Arabic + English),
// with an OpenStreetMap Nominatim fallback for anything else.
import { OFFLINE } from '../lib/env.js';
import { flightStore } from './flightStore.js';
import { satStore } from './satellites.js';
import { getJSON } from '../lib/http.js';

let index = null;
let loading = null;

/** Normalise Latin + Arabic text so "القاهرة", "القاهره" and "cairo" all match sensibly. */
export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // Arabic diacritics + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u0300-\u036f]/g, '') // Latin accents
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function ensureIndex() {
  if (index) return index;
  if (loading) return loading;
  loading = (async () => {
    const [airports, cities, countries] = await Promise.all([
      import('../data/airports.json').then((m) => m.default),
      import('../data/cities.json').then((m) => m.default),
      import('../data/countries.json').then((m) => m.default),
    ]);
    const items = [];
    // English city name (+country) -> Arabic name, so "دبي" also finds DXB / DWC.
    const cityAr = new Map();
    for (const c of cities) {
      if (!c[1]) continue;
      const k = `${c[0].toLowerCase()}|${c[2]}`;
      if (!cityAr.has(k)) cityAr.set(k, c[1]);
      if (!cityAr.has(c[0].toLowerCase())) cityAr.set(c[0].toLowerCase(), c[1]);
    }
    for (const a of airports) {
      const [iata, icao, name, city, country, lat, lng, large] = a;
      const lc = (city || '').toLowerCase();
      const ar = cityAr.get(`${lc}|${country}`) || cityAr.get(lc) || '';
      items.push({
        kind: 'airport', id: `ap-${iata}`, title: `${name}`, code: iata, sub: `${iata} / ${icao}`, city, cityAr: ar, country, lat, lng,
        weight: large ? 2 : 0.6,
        keys: [normalize(iata), normalize(icao), normalize(name), normalize(city), normalize(ar)],
      });
    }
    for (const c of cities) {
      const [name, nameAr, iso2, country, lat, lng, pop, capital] = c;
      items.push({ kind: 'city', id: `ct-${name}-${lat}`, title: name, titleAr: nameAr, country, iso2, lat, lng, weight: 1 + Math.log10(Math.max(pop, 10)) / 4 + (capital ? 0.5 : 0), keys: [normalize(name), normalize(nameAr)] });
    }
    for (const f of countries.features) {
      const p = f.properties;
      const b = bboxCenter(f.geometry);
      items.push({ kind: 'country', id: `co-${p.iso3}`, title: p.name, titleAr: p.nameAr, iso2: p.iso2, lat: b.lat, lng: b.lng, span: b.span, props: p, weight: 3, keys: [normalize(p.name), normalize(p.nameAr), normalize(p.iso3 || '')] });
    }
    index = items;
    return index;
  })();
  return loading;
}

function bboxCenter(geometry) {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  // Use the largest polygon to avoid overseas territories skewing the centre.
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = polys[0];
  let bestLen = 0;
  for (const p of polys) if (p[0].length > bestLen) (best = p), (bestLen = p[0].length);
  for (const [lng, lat] of best[0]) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2, span: Math.max(maxLat - minLat, maxLng - minLng) };
}

function score(keys, q) {
  let best = 0;
  for (const k of keys) {
    if (!k) continue;
    if (k === q) best = Math.max(best, 100);
    else if (k.startsWith(q)) best = Math.max(best, 60 - Math.min(20, k.length - q.length));
    else if (k.includes(` ${q}`)) best = Math.max(best, 35);
    else if (q.length >= 3 && k.includes(q)) best = Math.max(best, 20);
  }
  return best;
}

export async function searchLocal(query, limit = 8) {
  const q = normalize(query);
  if (q.length < 2) return [];
  const items = await ensureIndex();
  const scored = [];

  // Live flights by callsign or ICAO24 hex.
  const qUpper = query.trim().toUpperCase().replace(/\s/g, '');
  if (qUpper.length >= 3) {
    let n = 0;
    for (const f of flightStore.list) {
      const cs = (f.callsign || '').toUpperCase();
      if (cs.startsWith(qUpper) || f.icao24 === qUpper.toLowerCase()) {
        scored.push({ s: cs === qUpper ? 120 : 70, item: { kind: 'flight', id: `fl-${f.icao24}`, title: f.callsign || f.icao24.toUpperCase(), sub: f.icao24, country: f.country, icao24: f.icao24 } });
        if (++n > 5) break;
      }
    }
    satStore.sats.forEach((s, i) => {
      if (normalize(s.name).includes(q) || String(s.norad) === q) scored.push({ s: s.norad === 25544 ? 90 : 40, item: { kind: 'sat', id: `sat-${s.norad}`, title: s.name, sub: `NORAD ${s.norad}`, index: i } });
    });
  }
  if (/^(iss|محطه الفضاء|محطة الفضاء)/.test(q)) {
    const i = satStore.indexOfNorad(25544);
    scored.push({ s: 110, item: { kind: 'sat', id: 'sat-25544', title: 'ISS (ZARYA)', sub: 'NORAD 25544', index: i, norad: 25544 } });
  }

  for (const it of items) {
    const s = score(it.keys, q);
    if (s > 0) scored.push({ s: s + it.weight * 4, item: it });
  }
  scored.sort((a, b) => b.s - a.s);
  const seen = new Set();
  const out = [];
  for (const { item } of scored) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

let lastNominatim = 0;
export async function searchPlaces(query, lang) {
  if (OFFLINE) return [];
  // Nominatim usage policy: max 1 request/second, identify the app via Referer (browser sends it).
  const wait = 1100 - (Date.now() - lastNominatim);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=${lang}&q=${encodeURIComponent(query)}`;
  const rows = await getJSON(url, { timeout: 8000 });
  return rows.map((r) => ({
    kind: 'place',
    id: `osm-${r.osm_type}-${r.osm_id}`,
    title: r.name || r.display_name.split(',')[0],
    sub: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
    span: r.boundingbox ? Math.abs(Number(r.boundingbox[1]) - Number(r.boundingbox[0])) : 1,
  }));
}
