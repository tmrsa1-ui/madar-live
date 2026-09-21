// Shareable URLs: #v=lat,lng,altitude&m=2d&f=icao24
// Read once at startup, then kept in sync (replaceState, debounced) as the user explores.
import { useStore } from '../store/useStore.js';
import { flightStore } from '../services/flightStore.js';

const num = (x, lo, hi) => {
  const n = Number(x);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

function parseHash() {
  const raw = (typeof location !== 'undefined' ? location.hash : '').replace(/^#/, '');
  if (!raw) return {};
  const q = new URLSearchParams(raw);
  const out = {};
  const v = (q.get('v') || '').split(',');
  const lat = num(v[0], -90, 90);
  const lng = num(v[1], -180, 180);
  const alt = num(v[2], 0.02, 10);
  if (lat != null && lng != null) out.view = { lat, lng, altitude: alt ?? 1.2 };
  if (q.get('m') === '2d' || q.get('m') === '3d') out.mode = q.get('m');
  const f = (q.get('f') || '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(f)) out.flight = f;
  return out;
}

/** Apply the URL state before the first render; returns a cleanup function for the sync. */
export function initPermalink() {
  const st = useStore.getState();
  const parsed = parseHash();
  if (parsed.view) useStore.setState({ view: parsed.view });
  if (parsed.mode) st.setMode(parsed.mode);

  let unsubFlights = null;
  if (parsed.flight) {
    // Select the aircraft as soon as it shows up in a feed snapshot (give up after ~1 min).
    const deadline = Date.now() + 60000;
    const trySelect = () => {
      const f = flightStore.get(parsed.flight);
      if (f) {
        const s = useStore.getState();
        if (!s.selection) s.select({ kind: 'flight', id: f.icao24 });
        unsubFlights?.();
        unsubFlights = null;
      } else if (Date.now() > deadline) {
        unsubFlights?.();
        unsubFlights = null;
      }
    };
    unsubFlights = flightStore.subscribe(trySelect);
  }

  let timer = 0;
  const write = () => {
    const s = useStore.getState();
    const v = s.view;
    const params = new URLSearchParams();
    params.set('v', `${v.lat.toFixed(3)},${v.lng.toFixed(3)},${v.altitude.toFixed(2)}`);
    if (s.mode === '2d') params.set('m', '2d');
    if (s.selection?.kind === 'flight') params.set('f', s.selection.id);
    const next = `#${params.toString().replace(/%2C/g, ',')}`;
    if (next !== location.hash) history.replaceState(null, '', next);
  };
  const unsubStore = useStore.subscribe((n, p) => {
    if (n.view === p.view && n.mode === p.mode && n.selection === p.selection) return;
    clearTimeout(timer);
    timer = setTimeout(write, 600);
  });

  return () => {
    clearTimeout(timer);
    unsubStore();
    unsubFlights?.();
  };
}
