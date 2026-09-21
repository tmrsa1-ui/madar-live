/**
 * Simulated global air traffic. Used when OpenSky is unreachable or rate-limited,
 * so the experience never goes blank. Flights follow great-circle routes between
 * real airports with plausible climb / cruise / descent profiles.
 */
import { greatCircleAt, haversineKm, initialBearing } from '../lib/geo.js';

const HUBS = [
  // Middle East
  'DXB', 'DOH', 'AUH', 'RUH', 'JED', 'DMM', 'KWI', 'BAH', 'MCT', 'AMM', 'CAI', 'IST', 'SAW', 'TLV', 'BEY', 'MED', 'SHJ',
  // Europe
  'LHR', 'LGW', 'CDG', 'ORY', 'FRA', 'MUC', 'AMS', 'MAD', 'BCN', 'FCO', 'MXP', 'ZRH', 'VIE', 'CPH', 'OSL', 'ARN', 'HEL',
  'DUB', 'BRU', 'LIS', 'ATH', 'WAW', 'PRG', 'BUD', 'MAN', 'EDI', 'NCE', 'PMI', 'AGP', 'OTP',
  // Americas
  'JFK', 'EWR', 'LGA', 'BOS', 'ORD', 'ATL', 'DFW', 'IAH', 'DEN', 'LAX', 'SFO', 'SEA', 'MIA', 'MCO', 'LAS', 'PHX', 'MSP',
  'DTW', 'CLT', 'PHL', 'IAD', 'YYZ', 'YVR', 'YUL', 'MEX', 'CUN', 'BOG', 'LIM', 'GRU', 'GIG', 'EZE', 'SCL', 'PTY',
  // Asia-Pacific
  'HND', 'NRT', 'KIX', 'ICN', 'PEK', 'PKX', 'PVG', 'CAN', 'SZX', 'CTU', 'HKG', 'TPE', 'SIN', 'KUL', 'BKK', 'CGK', 'MNL',
  'SGN', 'HAN', 'DEL', 'BOM', 'BLR', 'MAA', 'HYD', 'CMB', 'DAC', 'KTM', 'SYD', 'MEL', 'BNE', 'PER', 'AKL',
  // Africa
  'JNB', 'CPT', 'ADD', 'NBO', 'LOS', 'ACC', 'CMN', 'ALG', 'TUN', 'DAR',
];

const AIRLINES = [
  ['UAE', 'United Arab Emirates'], ['QTR', 'Qatar'], ['ETD', 'United Arab Emirates'], ['SVA', 'Saudi Arabia'],
  ['FDB', 'United Arab Emirates'], ['KAC', 'Kuwait'], ['GFA', 'Bahrain'], ['OMA', 'Oman'], ['RJA', 'Jordan'],
  ['MSR', 'Egypt'], ['THY', 'Turkey'], ['BAW', 'United Kingdom'], ['EZY', 'United Kingdom'], ['DLH', 'Germany'],
  ['AFR', 'France'], ['KLM', 'Netherlands'], ['IBE', 'Spain'], ['RYR', 'Ireland'], ['SWR', 'Switzerland'],
  ['SAS', 'Sweden'], ['FIN', 'Finland'], ['AAL', 'United States'], ['DAL', 'United States'], ['UAL', 'United States'],
  ['SWA', 'United States'], ['ACA', 'Canada'], ['AMX', 'Mexico'], ['LAN', 'Chile'], ['TAM', 'Brazil'], ['AVA', 'Colombia'],
  ['CCA', 'China'], ['CES', 'China'], ['CSN', 'China'], ['CPA', 'Hong Kong'], ['JAL', 'Japan'], ['ANA', 'Japan'],
  ['KAL', 'Republic of Korea'], ['SIA', 'Singapore'], ['MAS', 'Malaysia'], ['THA', 'Thailand'], ['GIA', 'Indonesia'],
  ['AIC', 'India'], ['IGO', 'India'], ['QFA', 'Australia'], ['ANZ', 'New Zealand'], ['ETH', 'Ethiopia'],
  ['KQA', 'Kenya'], ['SAA', 'South Africa'], ['RAM', 'Morocco'],
];

let airportsByIata = null;
let hubs = [];
let flights = [];
let routes = {};
let rng = mulberry32(20260918);

function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const hex = () => Math.floor(rng() * 0xffffff).toString(16).padStart(6, '0');

async function ensureAirports() {
  if (airportsByIata) return;
  const { default: rows } = await import('../data/airports.json');
  airportsByIata = new Map(rows.map((r) => [r[0], { iata: r[0], icao: r[1], name: r[2], city: r[3], country: r[4], lat: r[5], lng: r[6] }]));
  hubs = HUBS.map((c) => airportsByIata.get(c)).filter(Boolean);
}

function newFlight(existingProgress) {
  let a;
  let b;
  let dist = 0;
  for (let i = 0; i < 20 && (dist < 350 || dist > 14500); i++) {
    a = pick(hubs);
    b = pick(hubs);
    dist = a === b ? 0 : haversineKm(a.lat, a.lng, b.lat, b.lng);
  }
  const [code, country] = pick(AIRLINES);
  const cruiseAlt = dist < 900 ? 9000 + rng() * 2500 : 10300 + rng() * 2200;
  const speed = dist < 900 ? 200 + rng() * 30 : 235 + rng() * 25; // m/s
  return {
    icao24: hex(),
    callsign: `${code}${Math.floor(10 + rng() * 989)}`,
    country,
    from: a,
    to: b,
    dist,
    cruiseAlt,
    speed,
    progress: existingProgress ?? 0,
    startedAt: Date.now(),
  };
}

function stateOf(f, now) {
  const elapsed = (now - f.startedAt) / 1000;
  const p = Math.min(1, f.progress + (elapsed * f.speed) / 1000 / f.dist);
  const [lat, lng] = greatCircleAt(f.from.lat, f.from.lng, f.to.lat, f.to.lng, p);
  const [lat2, lng2] = greatCircleAt(f.from.lat, f.from.lng, f.to.lat, f.to.lng, Math.min(1, p + 0.001));
  const km = p * f.dist;
  const kmLeft = f.dist - km;
  const climb = Math.min(1, km / 180);
  const descent = Math.min(1, kmLeft / 220);
  const alt = f.cruiseAlt * Math.min(climb, descent);
  const vrate = climb < 1 ? 12 : descent < 1 ? -9 : 0;
  const speed = f.speed * (0.72 + 0.28 * Math.min(climb, descent));
  return { p, row: [f.icao24, f.callsign, f.country, lng, lat, Math.round(alt), 0, speed, Math.round(initialBearing(lat, lng, lat2, lng2)), vrate, Math.floor(now / 1000), '', 3] };
}

export async function initDemoFlights(count = 2600) {
  await ensureAirports();
  if (flights.length) return;
  rng = mulberry32(Math.floor(Date.now() / 3.6e6)); // stable within the hour
  flights = Array.from({ length: count }, () => newFlight(0.04 + rng() * 0.9));
}

/** Returns { states, routes } for the current instant. */
export function demoSnapshot() {
  const now = Date.now();
  const states = [];
  routes = {};
  for (let i = 0; i < flights.length; i++) {
    let f = flights[i];
    let s = stateOf(f, now);
    if (s.p >= 0.985) {
      f = flights[i] = newFlight(0.01);
      s = stateOf(f, now);
    }
    states.push(s.row);
    routes[f.icao24] = { origin: f.from, destination: f.to };
  }
  return { states, routes };
}

export function demoRoute(icao24) {
  return routes[icao24] || null;
}

/** Past track for a simulated flight: great circle from origin to the current position. */
export function demoTrack(f, currentLat, currentLng) {
  const r = routes[f.icao24];
  if (!r) return null;
  const pts = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const [lat, lng] = greatCircleAt(r.origin.lat, r.origin.lng, currentLat, currentLng, i / steps);
    const alt = Math.min(f.altM || 10000, (i / steps) * 60000);
    pts.push([lat, lng, alt]);
  }
  return pts;
}
