// Current weather for major cities (Open-Meteo, no key) + radar tiles (RainViewer, 2D map).
import { OFFLINE } from '../lib/env.js';
import { getJSON } from '../lib/http.js';
import { haversineKm } from '../lib/geo.js';
import { useStore } from '../store/useStore.js';

let timer = null;
let cities = null;

async function pickCities(max = 64) {
  if (cities) return cities;
  const { default: rows } = await import('../data/cities.json');
  const chosen = [];
  for (const r of rows) {
    const c = { name: r[0], nameAr: r[1], iso2: r[2], lat: r[4], lng: r[5], pop: r[6] };
    if (chosen.every((o) => haversineKm(o.lat, o.lng, c.lat, c.lng) > 900)) chosen.push(c);
    if (chosen.length >= max) break;
  }
  cities = chosen;
  return cities;
}

/** Plausible weather for the offline demo: climatology by latitude + season + local solar time. */
function syntheticWeather(list) {
  const now = new Date();
  const doy = (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5;
  const hourUTC = now.getUTCHours() + now.getUTCMinutes() / 60;
  const hourSeed = Math.floor(Date.now() / 3600000);
  const hash = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  const CODES = [0, 0, 0, 1, 1, 2, 2, 3, 3, 45, 61, 63, 80, 95];
  return list.map((c) => {
    const latR = (c.lat * Math.PI) / 180;
    const base = 31 * Math.cos(latR) ** 1.6 - 4;
    const season = Math.sign(c.lat || 1) * -Math.cos(((doy - 15) / 365) * 2 * Math.PI) * Math.min(1, Math.abs(c.lat) / 40) * 11;
    const solar = (((hourUTC + c.lng / 15) % 24) + 24) % 24;
    const diurnal = -Math.cos(((solar - 3) / 24) * 2 * Math.PI) * 5;
    const h = hash(`${c.name}:${hourSeed}`);
    const temp = Math.round((base + season + diurnal + ((h % 50) / 10 - 2.5)) * 10) / 10;
    let code = CODES[h % CODES.length];
    if (temp < 0 && code >= 61 && code < 95) code = 71;
    return { ...c, temp, code, wind: 4 + (h % 26), humidity: 25 + (h % 65), isDay: solar > 6 && solar < 18 ? 1 : 0 };
  });
}

async function refresh() {
  const s = useStore.getState();
  if (OFFLINE) {
    s.setWeather(syntheticWeather(await pickCities()));
    s.setSource('weather', 'demo');
    return;
  }
  try {
    const list = await pickCities();
    const lat = list.map((c) => c.lat.toFixed(3)).join(',');
    const lng = list.map((c) => c.lng.toFixed(3)).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,is_day&timezone=GMT`;
    const json = await getJSON(url, { timeout: 15000 });
    const arr = Array.isArray(json) ? json : [json];
    s.setWeather(
      list.map((c, i) => ({
        ...c,
        temp: arr[i]?.current?.temperature_2m,
        code: arr[i]?.current?.weather_code,
        wind: arr[i]?.current?.wind_speed_10m,
        humidity: arr[i]?.current?.relative_humidity_2m,
        isDay: arr[i]?.current?.is_day,
      })).filter((c) => c.temp != null),
    );
    s.setSource('weather', 'live');
  } catch {
    s.setSource('weather', 'error');
    s.pushToast({ key: 'weather-error', tone: 'warn', messageKey: 'toast.weatherError' });
  }
  try {
    const maps = await getJSON('https://api.rainviewer.com/public/weather-maps.json', { timeout: 10000 });
    const frame = maps?.radar?.past?.[maps.radar.past.length - 1];
    if (frame) s.setRadar({ tileUrl: `${maps.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, time: frame.time * 1000 });
  } catch {
    /* radar is optional */
  }
}

export function startWeather() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, 15 * 60 * 1000);
}

export function stopWeather() {
  clearInterval(timer);
  timer = null;
}

export function weatherIcon(code, isDay = 1) {
  if (code == null) return '·';
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code <= 2) return isDay ? '🌤️' : '☁️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

export function tempColor(t) {
  if (t == null) return '#8698bd';
  if (t <= -10) return '#9d6bff';
  if (t <= 0) return '#7aa7ff';
  if (t <= 10) return '#38e1ff';
  if (t <= 20) return '#5ef2c1';
  if (t <= 28) return '#ffe07a';
  if (t <= 35) return '#ffb23e';
  return '#ff4f7b';
}
