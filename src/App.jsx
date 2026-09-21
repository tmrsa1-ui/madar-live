import { lazy, Suspense, useEffect, useState } from 'react';
import { useStore } from './store/useStore.js';
import { useDocumentLanguage, useT } from './i18n/index.js';
import { hasWebGL } from './hooks.js';
import { startFlightFeed, lookupRoute, lookupTrack } from './services/flightFeed.js';
import { flightStore } from './services/flightStore.js';
import { startEarthquakes } from './services/earthquakes.js';
import { satStore, startSatellites, stopSatellites } from './services/satellites.js';
import { hydrateCountryNames } from './lib/countryNames.js';
import TopBar from './components/TopBar.jsx';
import StatsBar from './components/StatsBar.jsx';
import LayerPanel from './components/LayerPanel.jsx';
import DetailsPanel from './components/DetailsPanel.jsx';
import HoverTip from './components/HoverTip.jsx';
import Toasts from './components/Toasts.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import Attribution from './components/Attribution.jsx';
import MapControls from './components/MapControls.jsx';

// Heavy renderers are code-split: three.js/globe.gl for 3D, deck.gl only when 2D is first opened.
const GlobeView = lazy(() => import('./components/GlobeView.jsx'));
const FlatMap = lazy(() => import('./components/FlatMap.jsx'));

const webgl = typeof window !== 'undefined' && hasWebGL();

// Dev-only handle for debugging / automated checks (stripped from production builds).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__madar = { useStore, flightStore };
}

export default function App() {
  useDocumentLanguage();
  useDataFeeds();
  useSelectionEffects();
  useKeyboard();
  const mode = useStore((s) => s.mode);
  const t = useT();
  // deck.gl is only downloaded the first time the flat map is opened, then kept mounted (idle in 3D).
  const [flatOpened, setFlatOpened] = useState(mode === '2d');
  useEffect(() => {
    if (mode === '2d') setFlatOpened(true);
  }, [mode]);

  if (!webgl) {
    return (
      <div className="app no-webgl">
        <div className="glass fatal">
          <div className="brand-mark big">◎</div>
          <p>{t('app.noWebgl')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app mode-${mode}`}>
      <Suspense fallback={null}>
        <GlobeView active={mode === '3d'} />
        {flatOpened && <FlatMap active={mode === '2d'} />}
      </Suspense>
      <div className="vignette" aria-hidden="true" />
      <TopBar />
      <StatsBar />
      <LayerPanel />
      <DetailsPanel />
      <MapControls />
      <HoverTip />
      <Toasts />
      <Attribution />
      <LoadingScreen />
    </div>
  );
}

/** Starts live data sources; optional layers are loaded lazily the first time they are switched on. */
function useDataFeeds() {
  const satellites = useStore((s) => s.layers.satellites);
  const starlink = useStore((s) => s.layers.starlink);
  const weather = useStore((s) => s.layers.weather || s.layers.radar);

  useEffect(() => {
    let cancelled = false;
    // Country names first, so every aircraft gets an ISO code (flags, filters) on its first ingest.
    import('./data/countries.json')
      .then(({ default: fc }) => hydrateCountryNames(fc.features))
      .catch(() => {})
      .finally(() => {
        if (!cancelled) startFlightFeed();
      });
    startEarthquakes();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (satellites) startSatellites({ starlink });
    else stopSatellites();
  }, [satellites, starlink]);

  useEffect(() => {
    import('./services/weather.js').then(({ startWeather, stopWeather }) => (weather ? startWeather() : stopWeather()));
  }, [weather]);
}

/** Fetches route / past track for the selected flight, and keeps satellite selections valid. */
function useSelectionEffects() {
  const selection = useStore((s) => s.selection);
  const satVersion = useStore((s) => s.satVersion);

  useEffect(() => {
    if (selection?.kind !== 'flight') return undefined;
    const { setSelectedDetails } = useStore.getState();
    const f = flightStore.get(selection.id);
    if (!f) return undefined;
    let cancelled = false;
    const isCurrent = () => !cancelled && useStore.getState().selection === selection;

    lookupRoute(f)
      .then((route) => isCurrent() && setSelectedDetails({ route: route || null }))
      .catch(() => isCurrent() && setSelectedDetails({ route: null }));
    lookupTrack(f, flightStore.geoAt(f))
      .then((track) => isCurrent() && setSelectedDetails({ track: track || null }))
      .catch(() => isCurrent() && setSelectedDetails({ track: null }));

    // Extend the past path locally with every new report instead of re-querying the API.
    const unsub = flightStore.subscribe(() => {
      if (!isCurrent()) return;
      const cur = flightStore.get(selection.id);
      const track = useStore.getState().selectedDetails?.track;
      if (!cur || !track?.length) return;
      const last = track[track.length - 1];
      if (Math.abs(last[0] - cur.cur.lat) + Math.abs(last[1] - cur.cur.lng) > 0.01) {
        setSelectedDetails({ track: [...track, [cur.cur.lat, cur.cur.lng, cur.altM || 0]] });
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [selection]);

  // Satellite indices change when the catalogue reloads (e.g. Starlink toggled): remap by NORAD id.
  useEffect(() => {
    const st = useStore.getState();
    if (st.selection?.kind !== 'sat') return;
    const index = satStore.indexOfNorad(st.selection.id);
    if (index < 0) st.clearSelection();
    else if (index !== st.selection.index) st.select({ kind: 'sat', id: st.selection.id, index });
  }, [satVersion]);
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        document.getElementById('madar-search')?.focus();
      } else if (e.key === 'Escape' && !typing) {
        useStore.getState().clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
