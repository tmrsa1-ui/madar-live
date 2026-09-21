/**
 * Polls live aircraft positions and feeds the FlightStore.
 *
 *  live   -> /api/opensky (proxy) every POLL_MS
 *  429    -> switch to simulated traffic, retry live after the server's retry-after (capped)
 *  errors -> keep extrapolating last live data briefly, then fall back to simulation
 */
import { OFFLINE } from '../lib/env.js';
import { flightStore } from './flightStore.js';
import { initDemoFlights, demoSnapshot, demoRoute, demoTrack } from './demoFlights.js';
import { getJSON, fetchWithTimeout, HttpError } from '../lib/http.js';
import { useStore } from '../store/useStore.js';

const POLL_MS = 12000;
const DIRECT_POLL_MS = 20000; // browser -> OpenSky directly: anonymous quota is per visitor IP
const OPENSKY_DIRECT = 'https://opensky-network.org/api';
const DEMO_TICK_MS = 10000;
const MAX_LIVE_FAILURES = 2;

let started = false;
let liveTimer = null;
let demoTimer = null;
let failures = 0;
let mode = 'loading';
let proxyMissing = false; // static hosting without /api functions -> talk to OpenSky from the browser

/** Same compact row format as the server proxy (see server/handlers.js). */
function compactStates(json) {
  const out = [];
  for (const s of json?.states || []) {
    if (s[5] == null || s[6] == null) continue;
    out.push([
      s[0], (s[1] || '').trim(), s[2] || '', s[5], s[6], Math.round(s[7] ?? s[13] ?? 0), s[8] ? 1 : 0,
      s[9] ?? 0, s[10] ?? 0, s[11] ?? 0, s[3] ?? s[4] ?? json.time, s[14] || '', s[17] ?? 0,
    ]);
  }
  return out;
}

const isNoProxy = (err) =>
  err instanceof HttpError && (err.status === 404 || err.status === 405 || err.body === 'not json');

function publishStats() {
  const s = useStore.getState();
  s.setStats({
    airborne: flightStore.airborne || 0,
    total: flightStore.list.length,
    countries: flightStore.countryCounts.size,
  });
  s.bumpFlights();
  if (!s.loading.flights) s.setLoading({ flights: true });
}

function setMode(next, toast) {
  if (mode === next) return;
  mode = next;
  const s = useStore.getState();
  s.setSource('flights', next);
  if (toast) s.pushToast(toast);
}

async function startDemo(reasonKey) {
  if (demoTimer) return;
  await initDemoFlights();
  const tick = () => {
    const { states, routes } = demoSnapshot();
    flightStore.ingest(states, 'demo', routes);
    publishStats();
  };
  tick();
  demoTimer = setInterval(tick, DEMO_TICK_MS);
  setMode('demo', { key: 'flights-demo', tone: OFFLINE ? 'info' : 'warn', messageKey: reasonKey, ttl: OFFLINE ? 12000 : 9000 });
}

function stopDemo() {
  clearInterval(demoTimer);
  demoTimer = null;
}

async function fetchLive() {
  if (!proxyMissing) {
    try {
      const data = await getJSON('/api/opensky?type=states', { timeout: 25000 });
      if (!data?.states?.length) throw new Error('empty state vector list');
      return data;
    } catch (err) {
      if (!isNoProxy(err)) throw err;
      proxyMissing = true;
      console.info('[madar] no /api proxy on this host — polling OpenSky directly from the browser');
    }
  }
  const json = await getJSON(`${OPENSKY_DIRECT}/states/all?extended=1`, { timeout: 25000 });
  const states = compactStates(json);
  if (!states.length) throw new Error('empty state vector list');
  return { states, direct: true };
}

async function pollLive() {
  clearTimeout(liveTimer);
  let next = POLL_MS;
  try {
    const data = await fetchLive();
    failures = 0;
    stopDemo();
    flightStore.ingest(data.states, 'live');
    publishStats();
    if (data.direct) next = DIRECT_POLL_MS;
    setMode('live', mode === 'demo' ? { key: 'flights-live', tone: 'ok', messageKey: 'toast.liveRestored' } : null);
  } catch (err) {
    failures++;
    if (err instanceof HttpError && err.status === 429) {
      const retryAfter = Number(err.body?.retryAfter) || 60;
      next = Math.min(Math.max(retryAfter, 30), 600) * 1000;
      await startDemo('toast.rateLimited');
    } else if (failures >= MAX_LIVE_FAILURES || !flightStore.list.length) {
      next = 60000;
      await startDemo('toast.liveUnavailable');
    } else {
      next = 5000;
    }
  }
  liveTimer = setTimeout(pollLive, next);
}

export function startFlightFeed() {
  if (started) return;
  started = true;
  if (OFFLINE) {
    startDemo('toast.offlineDemo');
    return;
  }
  pollLive();
  document.addEventListener('visibilitychange', () => {
    // Save API credits while the tab is hidden.
    if (document.hidden) {
      clearTimeout(liveTimer);
    } else if (mode !== 'demo' || failures) {
      pollLive();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Per-flight lookups                                                  */
/* ------------------------------------------------------------------ */

const routeCache = new Map();

export async function lookupRoute(f) {
  if (!f) return null;
  if (flightStore.source === 'demo') {
    const r = f.demo || demoRoute(f.icao24);
    return r ? { origin: r.origin, destination: r.destination, simulated: true } : null;
  }
  const cs = (f.callsign || '').trim().toUpperCase();
  if (!cs) return null;
  if (routeCache.has(cs)) return routeCache.get(cs);
  try {
    let json;
    try {
      json = await getJSON(`/api/route?callsign=${encodeURIComponent(cs)}`, { timeout: 12000 });
    } catch {
      // adsbdb allows CORS, so try it directly if the proxy is missing (static hosting).
      const res = await fetchWithTimeout(`https://api.adsbdb.com/v0/callsign/${cs}`, { timeout: 12000 });
      const raw = res.ok ? await res.json() : null;
      const fr = raw?.response?.flightroute;
      const ap = (a) => a && { iata: a.iata_code, icao: a.icao_code, name: a.name, city: a.municipality, country: a.country_name, lat: a.latitude, lng: a.longitude };
      json = { route: fr ? { airline: fr.airline, origin: ap(fr.origin), destination: ap(fr.destination) } : null };
    }
    routeCache.set(cs, json.route || null);
    return json.route || null;
  } catch {
    return null;
  }
}

/** Past path as [lat, lng, altMetres][]. */
export async function lookupTrack(f, geoNow) {
  if (!f) return null;
  if (flightStore.source === 'demo') return demoTrack(f, geoNow.lat, geoNow.lng);
  try {
    let path;
    if (proxyMissing) {
      const raw = await getJSON(`${OPENSKY_DIRECT}/tracks/all?icao24=${f.icao24}&time=0`, { timeout: 15000 });
      path = (raw?.path || []).map((p) => [p[1], p[2], p[3] ?? 0]);
    } else {
      path = (await getJSON(`/api/opensky?type=track&icao24=${f.icao24}`, { timeout: 15000 }))?.path;
    }
    if (path?.length > 1) {
      const pts = path.map((p) => [p[0], p[1], p[2] || 0]);
      pts.push([geoNow.lat, geoNow.lng, f.altM || 0]);
      return pts;
    }
  } catch {
    /* fall through to the locally recorded trail */
  }
  return f.trail.length > 1 ? [...f.trail, [geoNow.lat, geoNow.lng, f.altM || 0]] : null;
}
