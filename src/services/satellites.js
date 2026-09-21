/**
 * Satellites: TLEs from CelesTrak (through the proxy), propagated in a Web Worker.
 * Positions are double-buffered (t, t+step) and interpolated on the GPU for smooth motion.
 */
import { getText, firstOk } from '../lib/http.js';
import { useStore } from '../store/useStore.js';
import SatWorker from '../workers/satWorker.js?worker&inline';
import { OFFLINE } from '../lib/env.js';

/** Same message protocol as the worker, run on the main thread (CSP-blocked workers, offline demo). */
class MainThreadWorker {
  constructor() {
    this.onmessage = null;
    this.core = import('../workers/satCore.js');
    this.dead = false;
  }
  postMessage(msg) {
    this.core.then(({ handleMessage }) =>
      setTimeout(() => !this.dead && handleMessage(msg, (reply) => !this.dead && this.onmessage?.({ data: reply })), 0),
    );
  }
  terminate() {
    this.dead = true;
  }
}

function createWorker() {
  if (OFFLINE) return new MainThreadWorker();
  try {
    return new SatWorker();
  } catch {
    return new MainThreadWorker();
  }
}

export const STEP_MS = 2000;
export const GROUP_COLORS = {
  stations: '#ffb23e',
  visual: '#38e1ff',
  'gps-ops': '#b58cff',
  starlink: '#cfe3ff',
  fallback: '#38e1ff',
};

class SatStore {
  constructor() {
    this.sats = [];
    this.n = 0;
    this.frame = null; // { t, step, posA, posB, geo }
    this.listeners = new Set();
    this.orbits = new Map();
    this.simulated = false;
    this.loadedGroups = new Set();
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(kind) {
    for (const fn of this.listeners) fn(kind);
  }
  indexOfNorad(id) {
    return this.sats.findIndex((s) => s.norad === id);
  }
  /** Interpolated geo for index i (lat, lng, altKm, speed). */
  geo(i) {
    const f = this.frame;
    if (!f || i < 0 || f.geo[i * 4 + 2] < 0) return null;
    return { lat: f.geo[i * 4], lng: f.geo[i * 4 + 1], altKm: f.geo[i * 4 + 2], speed: f.geo[i * 4 + 3] };
  }
  mix(now = Date.now()) {
    const f = this.frame;
    if (!f) return 0;
    return Math.min(1.5, Math.max(0, (now - f.t) / f.step));
  }
}

export const satStore = new SatStore();

let worker = null;
let tickTimer = null;
let pending = false;
let nextT = 0;

function parseTLE(text, group) {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      const name = i > 0 && !lines[i - 1].startsWith('2 ') ? lines[i - 1].replace(/^0 /, '').trim() : `NORAD ${lines[i].slice(2, 7)}`;
      out.push({ name, l1: lines[i], l2: lines[i + 1], group, norad: Number(lines[i].slice(2, 7)) });
      i++;
    }
  }
  return out;
}

async function loadGroup(group) {
  // Validate the payload: static hosts answer unknown /api/* paths with index.html (HTTP 200).
  const loader = async (url, opts) => {
    const text = await getText(url, opts);
    if (!/^1 [0-9 ]{5}/m.test(text)) throw new Error(`not a TLE payload from ${url}`);
    return text;
  };
  const text = await firstOk([`/api/tle?group=${group}`, `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`], loader, { timeout: 20000 });
  return parseTLE(text, group);
}

async function loadIssDirect() {
  // wheretheiss.at exposes a fresh ISS TLE with CORS enabled.
  const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544/tles?format=text');
  if (!res.ok) throw new Error('iss tle');
  return parseTLE(await res.text(), 'stations');
}

function epochMs(l1) {
  const yy = Number(l1.slice(18, 20));
  const doy = Number(l1.slice(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
}

function requestTick() {
  if (!worker || pending) return;
  pending = true;
  worker.postMessage({ type: 'tick', t: nextT, step: STEP_MS });
  nextT += STEP_MS;
}

function schedule() {
  clearInterval(tickTimer);
  nextT = Date.now();
  requestTick();
  // Ask for the next window ~0.8 s before the current one runs out.
  tickTimer = setInterval(() => {
    if (Date.now() > nextT - 800) requestTick();
    if (Date.now() > nextT + 5000) nextT = Date.now(); // tab was asleep
  }, 200);
}

async function boot(sats, simOffsetMs) {
  worker?.terminate();
  worker = createWorker();
  pending = false;
  satStore.sats = sats;
  satStore.n = sats.length;
  satStore.frame = null;
  satStore.orbits.clear();
  let heard = false;
  // A page CSP can block blob: workers asynchronously; fall back to the main thread then.
  worker.onerror = () => {
    if (heard || worker instanceof MainThreadWorker) return;
    worker.terminate();
    worker = new MainThreadWorker();
    worker.onmessage = onMessage;
    pending = false;
    worker.postMessage({ type: 'init', sats, simOffsetMs });
  };
  const onMessage = (e) => {
    heard = true;
    const m = e.data;
    if (m.type === 'tick') {
      pending = false;
      satStore.frame = m;
      satStore.emit('frame');
    } else if (m.type === 'orbit') {
      satStore.orbits.set(m.key, m.points);
      satStore.emit('orbit');
    }
  };
  worker.onmessage = onMessage;
  worker.postMessage({ type: 'init', sats, simOffsetMs });
  schedule();
  useStore.getState().setStats({ satellites: sats.length });
  useStore.getState().bumpSats();
}

export async function startSatellites({ starlink = false } = {}) {
  const s = useStore.getState();
  const wanted = ['stations', 'visual', 'gps-ops', ...(starlink ? ['starlink'] : [])];
  const key = wanted.join(',');
  if (satStore.key === key) {
    if (!tickTimer) schedule();
    return;
  }
  s.setSource('satellites', 'loading');
  const results = OFFLINE ? [] : await Promise.allSettled(wanted.map(loadGroup));
  let sats = [];
  const seen = new Set();
  results.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    for (const sat of r.value) {
      if (seen.has(sat.norad)) continue;
      seen.add(sat.norad);
      sats.push(sat);
    }
  });

  let simOffset = 0;
  if (!sats.length && !OFFLINE) {
    try {
      sats = await loadIssDirect();
    } catch {
      /* next fallback */
    }
  }
  if (sats.length) {
    s.setSource('satellites', 'live');
    satStore.simulated = false;
  } else {
    const { default: text } = await import('../data/tle-fallback.txt?raw');
    sats = parseTLE(text, 'fallback');
    // Archived elements: replay "now" relative to their epoch so orbits stay plausible.
    simOffset = Date.now() - epochMs(sats[0].l1) - 3600000;
    satStore.simulated = true;
    s.setSource('satellites', 'demo');
    if (!OFFLINE) s.pushToast({ key: 'sats-demo', tone: 'warn', messageKey: 'toast.satsDemo' });
  }
  if (starlink && results[3]?.status !== 'fulfilled' && !satStore.simulated) {
    s.pushToast({ key: 'starlink-missing', tone: 'warn', messageKey: 'toast.starlinkMissing' });
  }
  satStore.key = key;
  await boot(sats, simOffset);
}

export function stopSatellites() {
  clearInterval(tickTimer);
  tickTimer = null;
}

export function requestOrbit(index) {
  if (!worker || index < 0) return;
  const key = `${index}:${Math.floor(Date.now() / 60000)}`;
  if (satStore.orbits.has(key)) return key;
  worker.postMessage({ type: 'orbit', index, t: Date.now(), key });
  return key;
}
