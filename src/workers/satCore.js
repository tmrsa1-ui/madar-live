/* SGP4 propagation core (satellite.js), shared by the Web Worker and the main-thread fallback.
 *
 * in : { type:'init', sats:[{name,l1,l2,group}], simOffsetMs }
 *      { type:'tick', t, step }         -> positions at t and t+step (globe xyz) + geodetic at t
 *      { type:'orbit', index, t, key }  -> one orbital period of ground-relative positions
 */
import { twoline2satrec } from '@sgp4/io.js';
import { propagate, gstime } from '@sgp4/propagation.js';
import { eciToGeodetic, degreesLat, degreesLong } from '@sgp4/transforms.js';

const R = 100;
const EARTH_KM = 6371;
let recs = [];
let simOffset = 0;

function geodeticAt(rec, date) {
  const pv = propagate(rec, date);
  if (!pv || !pv.position || typeof pv.position !== 'object') return null;
  const g = eciToGeodetic(pv.position, gstime(date));
  const v = pv.velocity;
  return {
    lat: degreesLat(g.latitude),
    lng: degreesLong(g.longitude),
    altKm: g.height,
    speed: v ? Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) : 0,
  };
}

function writeXYZ(arr, i, g) {
  const phi = ((90 - g.lat) * Math.PI) / 180;
  const theta = ((90 - g.lng) * Math.PI) / 180;
  const r = R * (1 + g.altKm / EARTH_KM);
  const s = Math.sin(phi);
  arr[i * 3] = r * s * Math.cos(theta);
  arr[i * 3 + 1] = r * Math.cos(phi);
  arr[i * 3 + 2] = r * s * Math.sin(theta);
}

/** Handles one request; `post(message, transferables?)` sends the reply. */
export function handleMessage(msg, post) {
  if (msg.type === 'init') {
    simOffset = msg.simOffsetMs || 0;
    recs = msg.sats.map((s) => {
      try {
        return twoline2satrec(s.l1, s.l2);
      } catch {
        return null;
      }
    });
    post({ type: 'ready', count: recs.length });
    return;
  }
  if (msg.type === 'tick') {
    const n = recs.length;
    const posA = new Float32Array(n * 3);
    const posB = new Float32Array(n * 3);
    const geo = new Float32Array(n * 4);
    const dA = new Date(msg.t - simOffset);
    const dB = new Date(msg.t + msg.step - simOffset);
    for (let i = 0; i < n; i++) {
      const rec = recs[i];
      const a = rec && geodeticAt(rec, dA);
      const b = rec && geodeticAt(rec, dB);
      if (!a || !b || !Number.isFinite(a.lat) || a.altKm < 80) {
        geo[i * 4 + 2] = -1; // invalid / decayed
        continue;
      }
      writeXYZ(posA, i, a);
      writeXYZ(posB, i, b);
      geo[i * 4] = a.lat;
      geo[i * 4 + 1] = a.lng;
      geo[i * 4 + 2] = a.altKm;
      geo[i * 4 + 3] = a.speed;
    }
    post({ type: 'tick', t: msg.t, step: msg.step, posA, posB, geo }, [posA.buffer, posB.buffer, geo.buffer]);
    return;
  }
  if (msg.type === 'orbit') {
    const rec = recs[msg.index];
    if (!rec) return;
    const meanMotion = rec.no; // rad/min
    const periodMin = meanMotion ? (2 * Math.PI) / meanMotion : 92;
    const points = [];
    const steps = 180;
    for (let k = -steps / 2; k <= steps / 2; k++) {
      const d = new Date(msg.t - simOffset + (k / steps) * periodMin * 60000);
      const g = geodeticAt(rec, d);
      if (g) points.push([g.lat, g.lng, g.altKm / EARTH_KM]);
    }
    post({ type: 'orbit', key: msg.key, index: msg.index, points, periodMin });
  }
}
