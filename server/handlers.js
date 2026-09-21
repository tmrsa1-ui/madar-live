/**
 * Shared API handlers (Web-standard Request -> Response).
 * Used by: Vercel (api/*.js), Netlify (netlify/functions/api.mjs) and the Vite dev server.
 *
 * Why a proxy?
 *  - Avoids CORS problems with OpenSky / CelesTrak from the browser.
 *  - Keeps OpenSky OAuth2 credentials server-side.
 *  - Caches upstream responses so many visitors share one upstream call
 *    (OpenSky has daily credit quotas, CelesTrak blocks clients that re-download too often).
 */

const OPENSKY_API = 'https://opensky-network.org/api';
const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const ADSBDB_API = 'https://api.adsbdb.com/v0';
const CELESTRAK_GP = 'https://celestrak.org/NORAD/elements/gp.php';

const TLE_GROUPS = new Set(['stations', 'visual', 'gps-ops', 'starlink', 'weather', 'science']);

const env = (key) => (typeof process !== 'undefined' && process.env ? process.env[key] : undefined);

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': 'madar-live/1.0 (+https://github.com)', ...(options.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

function respond(body, status = 200, headers = {}) {
  const isText = typeof body === 'string';
  return new Response(isText ? body : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...headers,
    },
  });
}

/**
 * In-memory cache with request coalescing and stale fallback.
 * Survives between invocations on warm serverless instances; the CDN cache
 * headers (s-maxage) do the heavy lifting across instances.
 */
const store = new Map();
const inflight = new Map();

async function cached(key, ttlMs, producer) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return { ...hit.value, cache: 'HIT' };
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    try {
      const value = await producer();
      if (value.status === 200) {
        store.set(key, { value, expires: Date.now() + ttlMs });
        return { ...value, cache: 'MISS' };
      }
      if (hit) return { ...hit.value, cache: 'STALE', upstreamStatus: value.status };
      return { ...value, cache: 'MISS' };
    } catch (err) {
      if (hit) return { ...hit.value, cache: 'STALE' };
      return { status: 502, body: { error: 'upstream_unreachable', message: String(err?.message || err) } };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

/* ------------------------------------------------------------------ */
/* OpenSky                                                             */
/* ------------------------------------------------------------------ */

let accessToken = null;
let tokenExpiresAt = 0;
let openSkyBlockedUntil = 0;

async function getOpenSkyToken() {
  const clientId = env('OPENSKY_CLIENT_ID');
  const clientSecret = env('OPENSKY_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;

  const res = await fetchWithTimeout(
    OPENSKY_TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    },
    10000,
  );
  if (!res.ok) throw new Error(`OpenSky token request failed (${res.status})`);
  const json = await res.json();
  accessToken = json.access_token;
  tokenExpiresAt = Date.now() + Math.max(60, (json.expires_in || 1800) - 60) * 1000;
  return accessToken;
}

async function openSkyFetch(path) {
  if (Date.now() < openSkyBlockedUntil) {
    const retryAfter = Math.ceil((openSkyBlockedUntil - Date.now()) / 1000);
    return { status: 429, body: { error: 'rate_limited', retryAfter } };
  }
  let token = null;
  try {
    token = await getOpenSkyToken();
  } catch {
    token = null; // fall back to anonymous access
  }
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetchWithTimeout(`${OPENSKY_API}${path}`, { headers }, 20000);

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('x-rate-limit-retry-after-seconds')) || 60;
    openSkyBlockedUntil = Date.now() + Math.min(retryAfter, 6 * 3600) * 1000;
    return { status: 429, body: { error: 'rate_limited', retryAfter } };
  }
  if (res.status === 401 || res.status === 403) {
    accessToken = null;
    return { status: res.status, body: { error: 'unauthorized' } };
  }
  if (!res.ok) return { status: res.status, body: { error: 'upstream_error', status: res.status } };
  const remaining = res.headers.get('x-rate-limit-remaining');
  return { status: 200, json: await res.json(), authed: !!token, remaining };
}

/** Compact the OpenSky state vectors (~60% smaller payload). */
function compactStates(json, authed, remaining) {
  const states = [];
  for (const s of json.states || []) {
    const lng = s[5];
    const lat = s[6];
    if (lat == null || lng == null) continue;
    const alt = s[7] ?? s[13] ?? 0;
    states.push([
      s[0], // icao24
      (s[1] || '').trim(), // callsign
      s[2] || '', // origin country
      Math.round(lng * 1e4) / 1e4,
      Math.round(lat * 1e4) / 1e4,
      Math.round(alt), // metres
      s[8] ? 1 : 0, // on ground
      s[9] != null ? Math.round(s[9] * 10) / 10 : 0, // m/s
      s[10] != null ? Math.round(s[10]) : 0, // true track (deg)
      s[11] != null ? Math.round(s[11] * 10) / 10 : 0, // vertical rate m/s
      s[3] ?? s[4] ?? json.time, // time of position
      s[14] || '', // squawk
      s[17] ?? 0, // category
    ]);
  }
  return {
    time: json.time,
    authed,
    creditsRemaining: remaining != null ? Number(remaining) : null,
    fields: ['icao24', 'callsign', 'country', 'lng', 'lat', 'alt', 'onGround', 'velocity', 'track', 'vrate', 'tpos', 'squawk', 'category'],
    states,
  };
}

function parseBBox(params) {
  const keys = ['lamin', 'lomin', 'lamax', 'lomax'];
  const values = keys.map((k) => params.get(k));
  if (values.some((v) => v == null)) return null;
  const nums = values.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [lamin, lomin, lamax, lomax] = nums;
  if (lamin < -90 || lamax > 90 || lomin < -180 || lomax > 180 || lamin >= lamax || lomin >= lomax) return null;
  return nums.map((n) => n.toFixed(2));
}

export async function handleOpenSky(request) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'states';

  if (type === 'track') {
    const icao24 = (url.searchParams.get('icao24') || '').toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(icao24)) return respond({ error: 'invalid_icao24' }, 400);
    const result = await cached(`track:${icao24}`, 30000, async () => {
      const r = await openSkyFetch(`/tracks/all?icao24=${icao24}&time=0`);
      if (r.status !== 200) return r;
      const path = (r.json?.path || []).map((p) => [p[1], p[2], p[3] ?? 0, p[0]]); // lat,lng,baroAlt,time
      return { status: 200, body: { icao24, callsign: (r.json?.callsign || '').trim(), path } };
    });
    return respond(result.body, result.status, {
      'Cache-Control': result.status === 200 ? 'public, s-maxage=30, stale-while-revalidate=60' : 'no-store',
      'X-Cache': result.cache || 'MISS',
    });
  }

  const bbox = parseBBox(url.searchParams);
  const qs = bbox ? `?extended=1&lamin=${bbox[0]}&lomin=${bbox[1]}&lamax=${bbox[2]}&lomax=${bbox[3]}` : '?extended=1';
  const key = `states:${bbox ? bbox.join(',') : 'world'}`;

  const result = await cached(key, 10000, async () => {
    const r = await openSkyFetch(`/states/all${qs}`);
    if (r.status !== 200) return r;
    return { status: 200, body: compactStates(r.json, r.authed, r.remaining) };
  });

  return respond(result.body, result.status, {
    'Cache-Control': result.status === 200 ? 'public, s-maxage=10, stale-while-revalidate=20' : 'no-store',
    'X-Cache': result.cache || 'MISS',
  });
}

/* ------------------------------------------------------------------ */
/* Flight route lookup (origin / destination) via adsbdb               */
/* ------------------------------------------------------------------ */

function compactAirport(a) {
  if (!a) return null;
  return {
    iata: a.iata_code || '',
    icao: a.icao_code || '',
    name: a.name || '',
    city: a.municipality || '',
    country: a.country_name || '',
    countryIso: a.country_iso_name || '',
    lat: a.latitude,
    lng: a.longitude,
  };
}

export async function handleRoute(request) {
  const url = new URL(request.url);
  const callsign = (url.searchParams.get('callsign') || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{2,8}$/.test(callsign)) return respond({ error: 'invalid_callsign' }, 400);

  const result = await cached(`route:${callsign}`, 6 * 3600 * 1000, async () => {
    const res = await fetchWithTimeout(`${ADSBDB_API}/callsign/${callsign}`, {}, 10000);
    if (res.status === 404) return { status: 200, body: { callsign, route: null } };
    if (!res.ok) return { status: res.status, body: { error: 'upstream_error' } };
    const json = await res.json();
    const fr = json?.response?.flightroute;
    if (!fr) return { status: 200, body: { callsign, route: null } };
    return {
      status: 200,
      body: {
        callsign,
        route: {
          flightIata: fr.callsign_iata || '',
          airline: fr.airline ? { name: fr.airline.name, iata: fr.airline.iata, icao: fr.airline.icao, country: fr.airline.country } : null,
          origin: compactAirport(fr.origin),
          destination: compactAirport(fr.destination),
        },
      },
    };
  });

  return respond(result.body, result.status, {
    'Cache-Control': result.status === 200 ? 'public, s-maxage=21600, stale-while-revalidate=86400' : 'no-store',
  });
}

/* ------------------------------------------------------------------ */
/* Satellite TLEs via CelesTrak                                        */
/* ------------------------------------------------------------------ */

export async function handleTle(request) {
  const url = new URL(request.url);
  const group = url.searchParams.get('group') || 'stations';
  if (!TLE_GROUPS.has(group)) return respond({ error: 'unknown_group' }, 400);

  // CelesTrak updates GP data a few times per day and asks clients not to re-download within 2h.
  const result = await cached(`tle:${group}`, 2 * 3600 * 1000, async () => {
    const res = await fetchWithTimeout(`${CELESTRAK_GP}?GROUP=${group}&FORMAT=tle`, {}, 20000);
    if (!res.ok) return { status: res.status, body: `upstream error ${res.status}` };
    const text = await res.text();
    if (!/^1 /m.test(text)) return { status: 502, body: 'invalid TLE payload' };
    return { status: 200, body: text };
  });

  return respond(result.body, result.status, {
    'Cache-Control': result.status === 200 ? 'public, s-maxage=7200, stale-while-revalidate=86400' : 'no-store',
  });
}

export const routes = {
  opensky: handleOpenSky,
  route: handleRoute,
  tle: handleTle,
};
