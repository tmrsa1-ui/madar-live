import { create } from 'zustand';

const prefersReducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const isNarrow = typeof window !== 'undefined' && window.innerWidth < 900;

function initialLang() {
  try {
    const saved = localStorage.getItem('madar.lang');
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'ar';
  return nav.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

/** Camera distance (globe radii) that fits the whole globe: portrait phones need to sit further back. */
export function defaultAltitude() {
  if (typeof window === 'undefined') return 2.35;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  return aspect < 0.62 ? 3.9 : aspect < 0.9 ? 3.1 : 2.35;
}

/** Rough starting longitude from the visitor's timezone so the globe opens facing them. */
function initialView() {
  const offsetH = -new Date().getTimezoneOffset() / 60;
  return { lat: 24, lng: Math.max(-150, Math.min(150, offsetH * 15)), altitude: defaultAltitude() };
}

let toastId = 0;

export const useStore = create((set, get) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem('madar.lang', lang);
    } catch {
      /* ignore */
    }
    set({ lang });
  },

  mode: '3d', // '3d' | '2d'
  setMode: (mode) => set({ mode }),
  basemap: 'satellite', // 2D base map: 'satellite' | 'dark'
  setBasemap: (basemap) => set({ basemap }),

  panelOpen: !isNarrow,
  setPanelOpen: (panelOpen) => set({ panelOpen }),

  layers: {
    flights: true,
    arcs: true,
    heatmap: false,
    countries: true,
    quakes: true,
    satellites: false,
    starlink: false,
    weather: false,
    radar: false,
    clouds: true,
    dayNight: true,
    autoRotate: !prefersReducedMotion,
  },
  toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
  setLayer: (key, value) => set((s) => ({ layers: { ...s.layers, [key]: value } })),

  filters: { country: 'all', altMin: 0, altMax: 13000, hideGround: true },
  setFilter: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),

  // Selection: { kind: 'flight', id } | { kind: 'quake', data } | { kind: 'sat', id } | { kind: 'country', data }
  selection: null,
  select: (selection) => set({ selection, follow: false, selectedDetails: null }),
  clearSelection: () => set({ selection: null, follow: false, selectedDetails: null }),
  selectedDetails: null, // { route, track } for the selected flight
  setSelectedDetails: (patch) => set((s) => ({ selectedDetails: { ...(s.selectedDetails || {}), ...patch } })),
  follow: false,
  setFollow: (follow) => set({ follow }),

  hover: null, // { kind, data }
  setHover: (hover) => {
    const prev = get().hover;
    if (prev === hover || (prev && hover && prev.kind === hover.kind && prev.key === hover.key)) return;
    set({ hover });
  },

  view: initialView(), // last known camera { lat, lng, altitude }
  setView: (view) => set({ view }),
  flyTo: null, // { lat, lng, altitude, nonce }
  requestFlyTo: (target) => set({ flyTo: { altitude: 0.6, ...target, nonce: Math.random() } }),

  stats: { airborne: 0, total: 0, countries: 0, quakesToday: 0, maxMag: 0, satellites: 0 },
  setStats: (patch) => set((s) => ({ stats: { ...s.stats, ...patch } })),

  sources: { flights: 'loading', quakes: 'loading', satellites: 'idle', weather: 'idle' },
  setSource: (key, value) => set((s) => ({ sources: { ...s.sources, [key]: value } })),
  lastFlightUpdate: 0,
  flightsVersion: 0,
  bumpFlights: () => set((s) => ({ flightsVersion: s.flightsVersion + 1, lastFlightUpdate: Date.now() })),

  quakes: [],
  setQuakes: (quakes) => set({ quakes }),
  weather: [],
  setWeather: (weather) => set({ weather }),
  radar: null, // { tileUrl, time }
  setRadar: (radar) => set({ radar }),
  satVersion: 0,
  bumpSats: () => set((s) => ({ satVersion: s.satVersion + 1 })),

  loading: { textures: 0, flights: false, ready: false },
  setLoading: (patch) => set((s) => ({ loading: { ...s.loading, ...patch } })),

  toasts: [],
  pushToast: (toast) => {
    const id = ++toastId;
    const existing = get().toasts.find((t) => t.key && t.key === toast.key);
    if (existing) return existing.id;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, tone: 'info', ...toast }] }));
    if (toast.ttl !== 0) setTimeout(() => get().dismissToast(id), toast.ttl || 7000);
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
