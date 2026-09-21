// Geographic helpers shared by the 3D globe, the 2D map and the data services.
// Coordinates follow three-globe's convention so they line up with globe.getCoords().

export const EARTH_RADIUS_KM = 6371;
export const GLOBE_RADIUS = 100;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smoothstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

/** Aircraft altitude exaggeration so planes float above the cloud layer. Must match the aircraft shader. */
export const planeAltRatio = (altKm) => 0.0065 + Math.max(0, altKm) * 0.00045;

/** lat/lng/relative altitude -> xyz (same maths as three-globe polar2Cartesian). */
export function toCartesian(lat, lng, relAlt = 0, out = { x: 0, y: 0, z: 0 }) {
  const phi = (90 - lat) * D2R;
  const theta = (90 - lng) * D2R;
  const r = GLOBE_RADIUS * (1 + relAlt);
  const s = Math.sin(phi);
  out.x = r * s * Math.cos(theta);
  out.y = r * Math.cos(phi);
  out.z = r * s * Math.sin(theta);
  return out;
}

export function toGeo(x, y, z) {
  const r = Math.sqrt(x * x + y * y + z * z);
  const lat = 90 - Math.acos(y / r) * R2D;
  const lng = wrapLng(90 - Math.atan2(z, x) * R2D);
  return { lat, lng, alt: r / GLOBE_RADIUS - 1 };
}

/** Destination point given start, bearing (deg, clockwise from north) and distance (km). */
export function destination(lat, lng, bearing, distKm) {
  if (!distKm) return [lat, lng];
  const d = distKm / EARTH_RADIUS_KM;
  const lat1 = lat * D2R;
  const lng1 = lng * D2R;
  const b = bearing * D2R;
  const sinLat2 = Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b);
  const lat2 = Math.asin(clamp(sinLat2, -1, 1));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * sinLat2);
  return [lat2 * R2D, wrapLng(lng2 * R2D)];
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLng = (lng2 - lng1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function initialBearing(lat1, lng1, lat2, lng2) {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lng2 - lng1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point at fraction t along the great circle between a and b. */
export function greatCircleAt(lat1, lng1, lat2, lng2, t) {
  const p1 = lat1 * D2R;
  const l1 = lng1 * D2R;
  const p2 = lat2 * D2R;
  const l2 = lng2 * D2R;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return [lat1, lng1];
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return [Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D, Math.atan2(y, x) * R2D];
}

export function greatCirclePath(lat1, lng1, lat2, lng2, steps = 64) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(greatCircleAt(lat1, lng1, lat2, lng2, i / steps));
  return pts;
}

/**
 * Sub-solar point (where the sun is directly overhead) for a given date.
 * Low-precision solar ephemeris (≈0.01°), plenty for a day/night terminator.
 */
export function sunPosition(date = new Date()) {
  const d = date.valueOf() / 86400000 - 0.5 + 2440588 - 2451545; // days since J2000
  const M = D2R * (357.5291 + 0.98560028 * d);
  const C = D2R * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + D2R * 102.9372 + Math.PI; // ecliptic longitude
  const e = D2R * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const gmst = D2R * (280.16 + 360.9856235 * d);
  return { lat: dec * R2D, lng: wrapLng((ra - gmst) * R2D) };
}

/** Night-side polygon (lng/lat ring) for flat maps. */
export function nightPolygon(date = new Date(), step = 2) {
  const sun = sunPosition(date);
  const tanDec = Math.tan((Math.abs(sun.lat) < 0.05 ? 0.05 * Math.sign(sun.lat || 1) : sun.lat) * D2R);
  const ring = [];
  for (let lng = -180; lng <= 180; lng += step) {
    const lat = Math.atan(-Math.cos((lng - sun.lng) * D2R) / tanDec) * R2D;
    ring.push([lng, clamp(lat, -85, 85)]);
  }
  const pole = sun.lat > 0 ? -85 : 85;
  ring.push([180, pole], [-180, pole], ring[0]);
  return ring;
}

/** Splits a lat/lng path wherever it crosses the antimeridian (for flat maps). */
export function splitAntimeridian(points) {
  const out = [];
  let current = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (current.length) {
      const prev = current[current.length - 1];
      if (Math.abs(p[0] - prev[0]) > 180) {
        out.push(current);
        current = [];
      }
    }
    current.push(p);
  }
  if (current.length > 1) out.push(current);
  return out;
}

/** 3D camera altitude (globe radii) <-> web-mercator zoom (approximate). */
export const altitudeToZoom = (alt) => clamp(Math.log2(4.2 / Math.max(alt, 0.02)), 0.6, 16);
export const zoomToAltitude = (zoom) => clamp(4.2 / 2 ** zoom, 0.05, 6);
