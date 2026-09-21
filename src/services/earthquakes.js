// Live earthquakes from the USGS GeoJSON feed (CORS-enabled, updated every minute).
import { OFFLINE } from '../lib/env.js';
import { getJSON } from '../lib/http.js';
import { useStore } from '../store/useStore.js';

const FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const REFRESH_MS = 60000;
let timer = null;

function normalize(json) {
  return (json.features || [])
    .filter((f) => f.geometry?.coordinates && f.properties?.mag != null)
    .map((f) => ({
      id: f.id,
      mag: f.properties.mag,
      place: f.properties.place || '',
      time: f.properties.time,
      url: f.properties.url,
      tsunami: !!f.properties.tsunami,
      alert: f.properties.alert,
      felt: f.properties.felt,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depth: f.geometry.coordinates[2],
    }))
    .sort((a, b) => a.mag - b.mag);
}

// Offline sample along real plate boundaries (only used when USGS is unreachable).
function sample() {
  const now = Date.now();
  const spots = [
    [38.3, 142.4, 'Off the east coast of Honshu, Japan'], [-33.5, -71.9, 'Offshore Valparaíso, Chile'],
    [36.1, -117.6, 'Central California'], [61.2, -150.1, 'Southern Alaska'], [-6.2, 130.4, 'Banda Sea'],
    [38.4, 38.9, 'Eastern Türkiye'], [28.2, 84.7, 'Central Nepal'], [-41.3, 174.7, 'Cook Strait, New Zealand'],
    [13.1, -89.4, 'Offshore El Salvador'], [19.4, -155.3, 'Island of Hawaii'], [35.7, 51.4, 'Northern Iran'],
    [-17.9, -178.6, 'Fiji region'], [44.9, 147.6, 'Kuril Islands'], [15.6, 119.8, 'Luzon, Philippines'],
    [33.8, -116.5, 'Southern California'], [64.0, -21.9, 'Reykjanes Peninsula, Iceland'], [12.3, 43.3, 'Gulf of Aden'],
  ];
  return spots
    .map(([lat, lng, place], i) => ({
      id: `demo-${i}`, mag: +(1.2 + ((i * 37) % 55) / 10).toFixed(1), place, time: now - i * 3400000,
      url: 'https://earthquake.usgs.gov/earthquakes/map/', tsunami: false, lat, lng, depth: 10 + ((i * 13) % 80), demo: true,
    }))
    .sort((a, b) => a.mag - b.mag);
}

async function refresh() {
  const s = useStore.getState();
  let quakes;
  try {
    if (OFFLINE) throw new Error('offline build');
    quakes = normalize(await getJSON(FEED, { timeout: 15000 }));
    s.setSource('quakes', 'live');
  } catch {
    if (s.quakes.length && !s.quakes[0].demo) return; // keep the last good data
    quakes = sample();
    s.setSource('quakes', 'demo');
    if (!OFFLINE) s.pushToast({ key: 'quakes-demo', tone: 'warn', messageKey: 'toast.quakesDemo' });
  }
  const maxMag = quakes.reduce((m, q) => Math.max(m, q.mag), 0);
  s.setQuakes(quakes);
  s.setStats({ quakesToday: quakes.length, maxMag });
}

export function startEarthquakes() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
}

export const magColor = (m) =>
  m >= 6 ? '#ff2f6d' : m >= 5 ? '#ff4f7b' : m >= 4 ? '#ff7a59' : m >= 3 ? '#ffb23e' : m >= 2 ? '#ffe07a' : '#b8f5ff';
