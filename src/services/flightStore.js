/**
 * FlightStore — the single source of truth for aircraft.
 *
 * Kept outside React on purpose: thousands of aircraft updating every 10 s would
 * thrash React. Renderers (3D globe shader, 2D deck.gl layer) read typed arrays
 * from here; React only receives a version number + aggregate stats.
 *
 * Motion model (identical on CPU and GPU):
 *   - each aircraft has a "prev" and a "cur" kinematic state {lat,lng,altKm,heading,speed,t0}
 *   - position(state, t) = dead-reckoning along the great circle, capped to MAX_EXTRAP seconds
 *   - displayed position = mix(position(prev), position(cur), smoothstep((t - blendStart) / BLEND))
 *   When a new report arrives, "prev" becomes wherever the plane is drawn right now,
 *   so there is never a visible jump between updates.
 */
import { destination, toCartesian, planeAltRatio, smoothstep, toGeo, clamp } from '../lib/geo.js';
import { countryToIso2 } from '../lib/countryNames.js';

export const T0 = Math.floor(Date.now() / 1000);
export const nowRel = () => Date.now() / 1000 - T0;
export const BLEND = 3.0; // seconds
export const MAX_EXTRAP = 90; // seconds

const tmpA = { x: 0, y: 0, z: 0 };
const tmpB = { x: 0, y: 0, z: 0 };

function extrapolate(s, t) {
  const dt = clamp(t - s.t0, 0, MAX_EXTRAP);
  return destination(s.lat, s.lng, s.hdg, s.spd * dt);
}

class FlightStore {
  constructor() {
    this.map = new Map();
    this.list = [];
    this.snapshot = 0;
    this.source = 'none';
    this.listeners = new Set();
    this.countryCounts = new Map();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  clear() {
    this.map.clear();
    this.list = [];
    this.emit();
  }

  /**
   * @param {Array} states compact rows [icao24, callsign, country, lng, lat, altM, onGround, velocity, track, vrate, tpos, squawk, category]
   * @param {string} source 'live' | 'demo'
   * @param {object} extras optional per-icao data (e.g. demo routes)
   */
  ingest(states, source, extras = null) {
    if (source !== this.source) {
      this.map.clear();
      this.source = source;
    }
    const t = nowRel();
    const snap = ++this.snapshot;

    for (const row of states) {
      const [icao24, callsign, country, lng, lat, altM, onGround, velocity, track, vrate, tpos, squawk, category] = row;
      const cur = {
        lat,
        lng,
        altKm: Math.max(0, altM) / 1000,
        hdg: track || 0,
        spd: onGround ? 0 : Math.max(0, velocity) / 1000, // km/s
        t0: Math.min(t, (tpos || T0 + t) - T0),
      };
      let f = this.map.get(icao24);
      if (!f) {
        f = {
          icao24,
          callsign,
          country,
          iso2: countryToIso2(country),
          prev: cur,
          cur,
          blendStart: -1e6,
          trail: [],
          seen: snap,
        };
        this.map.set(icao24, f);
      } else {
        // Freeze the currently displayed position as the new starting point.
        const g = this.geoAt(f, t);
        f.prev = { lat: g.lat, lng: g.lng, altKm: g.altKm, hdg: g.hdg, spd: f.cur.spd, t0: t };
        f.cur = cur;
        f.blendStart = t;
        f.callsign = callsign || f.callsign;
        f.seen = snap;
      }
      f.altM = altM;
      f.velocity = velocity;
      f.vrate = vrate;
      f.onGround = !!onGround;
      f.squawk = squawk;
      f.category = category;
      f.updatedAt = Date.now();
      if (extras?.[icao24]) f.demo = extras[icao24];

      const last = f.trail[f.trail.length - 1];
      if (!last || Math.abs(last[0] - lat) + Math.abs(last[1] - lng) > 0.02) {
        f.trail.push([lat, lng, altM]);
        if (f.trail.length > 120) f.trail.shift();
      }
    }

    // Drop aircraft missing from the last two snapshots.
    for (const [id, f] of this.map) if (snap - f.seen >= 2) this.map.delete(id);

    this.list = Array.from(this.map.values());
    this.countryCounts = new Map();
    let airborne = 0;
    for (const f of this.list) {
      if (!f.onGround) airborne++;
      if (f.country) this.countryCounts.set(f.country, (this.countryCounts.get(f.country) || 0) + 1);
    }
    this.airborne = airborne;
    this.emit();
  }

  get(icao24) {
    return this.map.get(icao24);
  }

  /** Current interpolated geographic position (CPU twin of the shader). */
  geoAt(f, t = nowRel()) {
    const w = smoothstep((t - f.blendStart) / BLEND);
    const b = extrapolate(f.cur, t);
    if (w >= 1) return { lat: b[0], lng: b[1], altKm: f.cur.altKm, hdg: f.cur.hdg };
    const a = extrapolate(f.prev, t);
    toCartesian(a[0], a[1], 0, tmpA);
    toCartesian(b[0], b[1], 0, tmpB);
    const g = toGeo(tmpA.x + (tmpB.x - tmpA.x) * w, tmpA.y + (tmpB.y - tmpA.y) * w, tmpA.z + (tmpB.z - tmpA.z) * w);
    let dh = ((f.cur.hdg - f.prev.hdg + 540) % 360) - 180;
    return { lat: g.lat, lng: g.lng, altKm: f.prev.altKm + (f.cur.altKm - f.prev.altKm) * w, hdg: (f.prev.hdg + dh * w + 360) % 360 };
  }

  /** World-space xyz (globe units) of an aircraft, matching the shader's altitude exaggeration. */
  worldAt(f, t, out) {
    const g = this.geoAt(f, t);
    return toCartesian(g.lat, g.lng, planeAltRatio(g.altKm), out);
  }

  isVisible(f, filters) {
    if (filters.hideGround && f.onGround) return false;
    if (filters.country !== 'all' && f.country !== filters.country) return false;
    const alt = f.altM ?? 0;
    if (!f.onGround && (alt < filters.altMin || (filters.altMax < 13000 && alt > filters.altMax))) return false;
    return true;
  }

  /** Visible list for the current filters (cached per snapshot + filter object). */
  visible(filters) {
    if (this._visKey === this.snapshot && this._visFilters === filters) return this._vis;
    this._vis = this.list.filter((f) => this.isVisible(f, filters));
    this._visKey = this.snapshot;
    this._visFilters = filters;
    return this._vis;
  }
}

export const flightStore = new FlightStore();
