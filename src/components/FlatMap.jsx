/**
 * Flat 2D map (deck.gl, Web Mercator).
 *
 * Shares every data source with the 3D globe: aircraft come from the FlightStore (same motion
 * model, re-sampled at ~20 fps into binary attributes), satellites from the worker frames,
 * everything else from the zustand store. The camera stays in sync with the globe through
 * store.view (altitude <-> zoom).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Deck, MapView, FlyToInterpolator, WebMercatorViewport, COORDINATE_SYSTEM } from '@deck.gl/core';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer, GeoJsonLayer, IconLayer, ScatterplotLayer, ArcLayer, PathLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { MaskExtension } from '@deck.gl/extensions';

import { useStore } from '../store/useStore.js';
import { flightStore, nowRel } from '../services/flightStore.js';
import { satStore, GROUP_COLORS, requestOrbit } from '../services/satellites.js';
import { magColor } from '../services/earthquakes.js';
import { weatherIcon, tempColor } from '../services/weather.js';
import { hydrateCountryNames } from '../lib/countryNames.js';
import { altitudeToZoom, zoomToAltitude, nightPolygon, splitAntimeridian, toGeo, clamp } from '../lib/geo.js';
import nightUrl from '../assets/textures/earth-night.jpg';
import dayUrl from '../assets/textures/earth-day.jpg';
import { OFFLINE } from '../lib/env.js';

const FRAME_MS = 50; // aircraft / satellite re-sampling interval (20 fps)
const VIEW = new MapView({ id: 'map', repeat: true });
const MASK = [new MaskExtension()];

const BASEMAPS = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 18,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  dark: {
    url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors © CARTO',
  },
};

const hexRgb = (hex, a = 255) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
};

// Same altitude ramp as the aircraft vertex shader (low -> mid -> high).
const LOW = [92, 255, 204];
const MID = [56, 224, 255];
const HIGH = [173, 122, 255];
function altColor(altKm, out, o) {
  const a = Math.pow(clamp(altKm / 13, 0, 1), 1.8);
  const [p, q, w] = a < 0.5 ? [LOW, MID, a * 2] : [MID, HIGH, (a - 0.5) * 2];
  out[o] = p[0] + (q[0] - p[0]) * w;
  out[o + 1] = p[1] + (q[1] - p[1]) * w;
  out[o + 2] = p[2] + (q[2] - p[2]) * w;
  out[o + 3] = 255;
}

/** 64×64 plane silhouette pointing north, used as an SDF-free mask icon. */
function makePlaneAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  g.fillStyle = '#fff';
  g.beginPath();
  // fuselage
  g.moveTo(0, -28);
  g.bezierCurveTo(4, -24, 4, -16, 4, -10);
  // right wing
  g.lineTo(27, 4);
  g.lineTo(27, 9);
  g.lineTo(4, 3);
  g.lineTo(3.5, 17);
  // right tail
  g.lineTo(11, 23);
  g.lineTo(11, 27);
  g.lineTo(0, 24);
  // left tail
  g.lineTo(-11, 27);
  g.lineTo(-11, 23);
  g.lineTo(-3.5, 17);
  g.lineTo(-4, 3);
  // left wing
  g.lineTo(-27, 9);
  g.lineTo(-27, 4);
  g.lineTo(-4, -10);
  g.bezierCurveTo(-4, -16, -4, -24, 0, -28);
  g.closePath();
  g.fill();
  return c;
}

const ICON_MAPPING = { plane: { x: 0, y: 0, width: 64, height: 64, mask: true } };

/* Growable typed buffers; a fresh subarray() view each frame makes deck.gl re-upload. */
function grow(buf, Type, n) {
  return buf && buf.length >= n ? buf : new Type(Math.max(n, buf ? buf.length * 2 : 1024));
}

/** Decode an image once and hand deck.gl the element (no fetch() of data: URLs, which a CSP may block). */
function useImage(url) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    const el = new Image();
    el.decoding = 'async';
    el.onload = () => setImg(el);
    el.src = url;
    return () => {
      el.onload = null;
    };
  }, [url]);
  return img;
}

function initialViewState(view) {
  return {
    longitude: view.lng,
    latitude: clamp(view.lat, -70, 75),
    zoom: altitudeToZoom(view.altitude),
    pitch: 0,
    bearing: 0,
    minZoom: 0.6,
    maxZoom: 16,
  };
}

export default function FlatMap({ active }) {
  const lang = useStore((s) => s.lang);
  const layersOn = useStore((s) => s.layers);
  const filters = useStore((s) => s.filters);
  const selection = useStore((s) => s.selection);
  const details = useStore((s) => s.selectedDetails);
  const quakes = useStore((s) => s.quakes);
  const weather = useStore((s) => s.weather);
  const radar = useStore((s) => s.radar);
  const basemap = useStore((s) => s.basemap);
  const flightsVersion = useStore((s) => s.flightsVersion);
  const satVersion = useStore((s) => s.satVersion);

  const [viewState, setViewState] = useState(() => initialViewState(useStore.getState().view));
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [tick, setTick] = useState(0);
  const viewStateRef = useRef(null);
  const sizeRef = useRef(null);
  const [countries, setCountries] = useState(null);
  // Overlap ±180° slightly so repeated world copies don't show a hairline gap at the seam.
  const makeNight = () => nightPolygon(new Date()).map(([x, y]) => [x <= -180 ? -180.7 : x >= 180 ? 180.7 : x, y]);
  const [night, setNight] = useState(makeNight);
  const [orbitVersion, setOrbitVersion] = useState(0);
  const wrapRef = useRef(null);
  const deckRef = useRef(null); // imperative Deck instance
  const deckHostRef = useRef(null);
  const handlers = useRef({});
  const bufs = useRef({});
  const frame = useRef({ aircraft: null, sats: null, list: [] });
  const viewTimer = useRef(0);
  const atlas = useMemo(() => makePlaneAtlas(), []);
  const dayImage = useImage(dayUrl);
  const nightImage = useImage(nightUrl);

  const selectedFlightId = selection?.kind === 'flight' ? selection.id : null;
  const selectedSatIndex = selection?.kind === 'sat' ? selection.index : -1;

  /* ---------------- data that changes slowly ---------------- */

  useEffect(() => {
    let alive = true;
    import('../data/countries.json').then(({ default: fc }) => {
      hydrateCountryNames(fc.features);
      if (alive) setCountries(fc.features);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNight(makeNight()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => satStore.subscribe((kind) => kind === 'orbit' && setOrbitVersion((v) => v + 1)), []);

  useEffect(() => {
    if (import.meta.env.DEV) window.__madarDeck = { getDeck: () => deckRef.current, getView: () => viewStateRef.current, getSize: () => sizeRef.current };
  }, []);

  // Keep deck.gl sized to its container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // When (re)activated, start from wherever the 3D camera was.
  useEffect(() => {
    if (active) setViewState((v) => ({ ...v, ...initialViewState(useStore.getState().view), transitionDuration: 0 }));
  }, [active]);

  // Fly-to requests from search / details panels.
  useEffect(
    () =>
      useStore.subscribe((next, prev) => {
        if (!active || !next.flyTo || next.flyTo === prev.flyTo) return;
        const { lat, lng, altitude, duration } = next.flyTo;
        setViewState((v) => ({
          ...v,
          longitude: lng,
          latitude: clamp(lat, -80, 84),
          zoom: altitudeToZoom(altitude ?? 0.6),
          transitionDuration: duration ?? 'auto',
          transitionInterpolator: new FlyToInterpolator({ speed: 1.8, curve: 1.5 }),
        }));
      }),
    [active],
  );

  /* ---------------- per-frame resampling (aircraft, satellites) ---------------- */

  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let last = 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS || document.hidden) return;
      last = now;
      const st = useStore.getState();
      const t = nowRel();
      const B = bufs.current;

      // Aircraft
      if (st.layers.flights) {
        const list = flightStore.visible(st.filters);
        const n = list.length;
        B.pos = grow(B.pos, Float32Array, n * 2);
        B.ang = grow(B.ang, Float32Array, n);
        B.col = grow(B.col, Uint8Array, n * 4);
        let sel = null;
        for (let i = 0; i < n; i++) {
          const f = list[i];
          const g = flightStore.geoAt(f, t);
          B.pos[i * 2] = g.lng;
          B.pos[i * 2 + 1] = g.lat;
          B.ang[i] = -g.hdg;
          if (f.onGround) B.col.set([140, 153, 184, 255], i * 4);
          else altColor(f.cur.altKm, B.col, i * 4);
          if (f.icao24 === st.selection?.id) sel = { f, g };
        }
        frame.current.list = list;
        frame.current.aircraft = {
          length: n,
          attributes: {
            getPosition: { value: B.pos.subarray(0, n * 2), size: 2 },
            getAngle: { value: B.ang.subarray(0, n), size: 1 },
            getColor: { value: B.col.subarray(0, n * 4), size: 4, normalized: true },
          },
        };
        frame.current.selected = sel;
        if (st.follow && sel) {
          setViewState((v) => (v.transitionDuration ? v : { ...v, longitude: sel.g.lng, latitude: sel.g.lat }));
        }
      } else {
        frame.current.aircraft = null;
        frame.current.selected = null;
      }

      // Satellites (interpolate between worker frames in xyz, then back to lat/lng)
      const sf = satStore.frame;
      if (st.layers.satellites && sf && satStore.n) {
        const n = satStore.n;
        const m = satStore.mix();
        B.spos = grow(B.spos, Float32Array, n * 2);
        B.srad = grow(B.srad, Float32Array, n);
        if (B.scolKey !== satStore.key || !B.scol || B.scol.length < n * 4) {
          B.scol = new Uint8Array(n * 4);
          B.sbase = new Float32Array(n);
          satStore.sats.forEach((s, i) => {
            B.scol.set(hexRgb(GROUP_COLORS[s.group] || GROUP_COLORS.fallback, s.group === 'starlink' ? 190 : 255), i * 4);
            B.sbase[i] = s.norad === 25544 ? 6 : s.group === 'stations' ? 4.2 : s.group === 'starlink' ? 1.5 : 2.6;
          });
          B.scolKey = satStore.key;
        }
        for (let i = 0; i < n; i++) {
          const j = i * 3;
          if (sf.geo[i * 4 + 2] < 0 || sf.posA.length < j + 3) {
            B.srad[i] = 0;
            continue;
          }
          const g = toGeo(
            sf.posA[j] + (sf.posB[j] - sf.posA[j]) * m,
            sf.posA[j + 1] + (sf.posB[j + 1] - sf.posA[j + 1]) * m,
            sf.posA[j + 2] + (sf.posB[j + 2] - sf.posA[j + 2]) * m,
          );
          B.spos[i * 2] = g.lng;
          B.spos[i * 2 + 1] = g.lat;
          B.srad[i] = i === st.selection?.index && st.selection?.kind === 'sat' ? 8 : B.sbase[i];
        }
        frame.current.sats = {
          length: n,
          attributes: {
            getPosition: { value: B.spos.subarray(0, n * 2), size: 2 },
            getRadius: { value: B.srad.subarray(0, n), size: 1 },
            getFillColor: { value: B.scol.subarray(0, n * 4), size: 4, normalized: true },
          },
        };
        const iss = satStore.indexOfNorad(25544);
        frame.current.iss = iss >= 0 && B.srad[iss] > 0 ? [B.spos[iss * 2], B.spos[iss * 2 + 1]] : null;
      } else {
        frame.current.sats = null;
        frame.current.iss = null;
      }
      setTick((x) => (x + 1) % 1e6);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // Orbits for the ISS and the selected satellite.
  useEffect(() => {
    if (!layersOn.satellites || !satStore.n) return;
    const iss = satStore.indexOfNorad(25544);
    if (iss >= 0) requestOrbit(iss);
    if (selectedSatIndex >= 0) requestOrbit(selectedSatIndex);
  }, [layersOn.satellites, selectedSatIndex, satVersion, orbitVersion]);

  /* ---------------- camera ---------------- */

  const onViewStateChange = useCallback(({ viewState: vs, interactionState }) => {
    setViewState(vs);
    if (interactionState?.isDragging && useStore.getState().follow) useStore.getState().setFollow(false);
    clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(() => {
      useStore.getState().setView({ lat: vs.latitude, lng: vs.longitude, altitude: zoomToAltitude(vs.zoom) });
    }, 300);
  }, []);

  /* ---------------- picking ---------------- */

  const describe = useCallback((info) => {
    const id = info?.layer?.id;
    if (!id || info.index < 0) return null;
    if (id === 'aircraft') {
      const f = frame.current.list[info.index];
      return f ? { kind: 'flight', key: f.icao24, id: f.icao24 } : null;
    }
    if (id === 'aircraft-selected' && info.object) return { kind: 'flight', key: info.object.f.icao24, id: info.object.f.icao24 };
    if (id === 'quakes' && info.object) return { kind: 'quake', key: info.object.id, data: info.object };
    if (id === 'satellites') {
      const s = satStore.sats[info.index];
      return s ? { kind: 'sat', key: String(s.norad), id: s.norad, index: info.index } : null;
    }
    if (id === 'countries' && info.object) {
      const p = info.object.properties;
      return { kind: 'country', key: p.iso3 || p.name, data: p };
    }
    return null;
  }, []);

  const onHover = useCallback(
    (info) => {
      const d = describe(info);
      useStore.getState().setHover(d ? { kind: d.kind, key: d.key, data: d.data, index: d.index } : null);
    },
    [describe],
  );

  const onClick = useCallback(
    (info) => {
      const d = describe(info);
      const st = useStore.getState();
      if (!d) {
        if (st.selection) st.clearSelection();
        return;
      }
      if (d.kind === 'flight') st.select({ kind: 'flight', id: d.id });
      else if (d.kind === 'sat') st.select({ kind: 'sat', id: d.id, index: d.index });
      else st.select({ kind: d.kind, data: d.data });
    },
    [describe],
  );


  /* ---------------- layers ---------------- */

  const zoom = viewState.zoom;
  const planeSize = zoom < 1.5 ? 8 : zoom < 2.5 ? 10 : zoom < 4 ? 13 : zoom < 6 ? 16 : 20;
  const selectedCountryIso = selection?.kind === 'country' ? selection.data.iso3 : null;
  const selectedQuakeId = selection?.kind === 'quake' ? selection.data.id : null;
  const pulse = (performance.now() / 1000) % 1000;

  const heatData = useMemo(() => {
    if (!layersOn.heatmap || !layersOn.flights) return [];
    return flightStore.visible(filters).filter((f) => !f.onGround).map((f) => [f.cur.lng, f.cur.lat]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layersOn.heatmap, layersOn.flights, filters, flightsVersion]);

  const arcs = useMemo(() => {
    if (!layersOn.arcs || !layersOn.flights) return [];
    const out = [];
    const r = details?.route;
    if (r?.origin && r?.destination) out.push({ o: r.origin, d: r.destination, sel: true });
    if (flightStore.source === 'demo') {
      flightStore.list.forEach((f, i) => {
        if (f.demo && i % 30 === 0 && out.length < 80) out.push({ o: f.demo.origin, d: f.demo.destination });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layersOn.arcs, layersOn.flights, details, Math.floor(flightsVersion / 10)]);

  const trackPaths = useMemo(() => {
    const tr = details?.track;
    if (!selectedFlightId || !tr || tr.length < 2) return [];
    return splitAntimeridian(tr.map((p) => [p[1], p[0]])).map((path) => ({ path }));
  }, [details, selectedFlightId]);

  const orbitPaths = useMemo(() => {
    if (!layersOn.satellites) return [];
    const out = [];
    const minute = Math.floor(Date.now() / 60000);
    const iss = satStore.indexOfNorad(25544);
    for (const idx of [iss, selectedSatIndex]) {
      if (idx == null || idx < 0) continue;
      const pts = satStore.orbits.get(`${idx}:${minute}`) || satStore.orbits.get(`${idx}:${minute - 1}`);
      if (!pts) continue;
      for (const path of splitAntimeridian(pts.map((p) => [p[1], p[0]]))) out.push({ path, sel: idx === selectedSatIndex });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layersOn.satellites, selectedSatIndex, orbitVersion]);

  const base = BASEMAPS[basemap] || BASEMAPS.satellite; // attribution text lives in <Attribution/>
  const f = frame.current;

  const layers = [
    // Bundled Blue Marble underlay: always present, so the map is never blank if tiles fail
    // (and it is the only basemap in the offline demo build).
    dayImage &&
    new BitmapLayer({
      id: 'base-image',
      image: dayImage,
      bounds: [-180, -85.05, 180, 85.05],
      _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      opacity: basemap === 'dark' && !OFFLINE ? 0.25 : 1,
      updateTriggers: { opacity: basemap },
    }),
    !OFFLINE &&
    new TileLayer({
      id: `basemap-${basemap}`,
      data: base.url,
      minZoom: 0,
      maxZoom: base.maxZoom,
      tileSize: 256,
      maxRequests: 12,
      renderSubLayers: (props) => {
        const [[w, s], [e, n]] = props.tile.boundingBox;
        return new BitmapLayer(props, { data: null, image: props.data, bounds: [w, s, e, n] });
      },
    }),

    layersOn.dayNight &&
      new SolidPolygonLayer({
        id: 'night-mask',
        data: [{ polygon: night }],
        getPolygon: (d) => d.polygon,
        operation: 'mask',
      }),
    layersOn.dayNight &&
      new SolidPolygonLayer({
        id: 'night-shade',
        data: [{ polygon: night }],
        getPolygon: (d) => d.polygon,
        getFillColor: [2, 6, 20, basemap === 'dark' ? 90 : 120],
        updateTriggers: { getFillColor: basemap },
      }),
    layersOn.dayNight &&
      nightImage &&
      new BitmapLayer({
        id: 'night-lights',
        image: nightImage,
        bounds: [-180, -85.05, 180, 85.05],
        _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        opacity: 0.85,
        extensions: MASK,
        maskId: 'night-mask',
      }),

    !OFFLINE &&
      layersOn.radar &&
      radar?.tileUrl &&
      new TileLayer({
        id: `radar-${radar.time}`,
        data: radar.tileUrl,
        minZoom: 0,
        maxZoom: 7,
        tileSize: 256,
        opacity: 0.72,
        renderSubLayers: (props) => {
          const [[w, s], [e, n]] = props.tile.boundingBox;
          return new BitmapLayer(props, { data: null, image: props.data, bounds: [w, s, e, n] });
        },
      }),

    layersOn.countries &&
      countries &&
      new GeoJsonLayer({
        id: 'countries',
        data: countries,
        stroked: true,
        filled: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [56, 225, 255, 55],
        lineWidthUnits: 'pixels',
        getLineWidth: (d) => (d.properties.iso3 === selectedCountryIso ? 2 : 0.8),
        getLineColor: (d) => (d.properties.iso3 === selectedCountryIso ? [199, 168, 255, 255] : [120, 220, 255, 90]),
        getFillColor: (d) => (d.properties.iso3 === selectedCountryIso ? [157, 107, 255, 60] : [0, 0, 0, 0]),
        updateTriggers: { getLineWidth: selectedCountryIso, getLineColor: selectedCountryIso, getFillColor: selectedCountryIso },
      }),

    layersOn.heatmap &&
      layersOn.flights &&
      new HeatmapLayer({
        id: 'traffic-heat',
        data: heatData,
        getPosition: (d) => d,
        getWeight: 1,
        radiusPixels: 38,
        intensity: 1.1,
        threshold: 0.04,
        colorRange: [
          [29, 111, 255],
          [56, 225, 255],
          [94, 242, 193],
          [157, 107, 255],
          [255, 79, 216],
          [255, 178, 62],
        ],
      }),

    arcs.length &&
      new ArcLayer({
        id: 'route-arcs',
        data: arcs,
        greatCircle: true,
        getSourcePosition: (d) => [d.o.lng, d.o.lat],
        getTargetPosition: (d) => [d.d.lng, d.d.lat],
        getSourceColor: (d) => (d.sel ? [56, 225, 255, 255] : [56, 225, 255, 110]),
        getTargetColor: (d) => (d.sel ? [255, 178, 62, 255] : [157, 107, 255, 110]),
        getWidth: (d) => (d.sel ? 3 : 1),
        widthUnits: 'pixels',
      }),

    trackPaths.length &&
      new PathLayer({
        id: 'flight-track',
        data: trackPaths,
        getPath: (d) => d.path,
        getColor: [255, 178, 62, 230],
        getWidth: 2.5,
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true,
      }),

    layersOn.quakes &&
      new ScatterplotLayer({
        id: 'quake-rings',
        data: quakes.filter((q) => q.mag >= 2.5 || q.id === selectedQuakeId),
        getPosition: (q) => [q.lng, q.lat],
        stroked: true,
        filled: false,
        radiusUnits: 'pixels',
        lineWidthUnits: 'pixels',
        getLineWidth: 1.6,
        getRadius: (q) => {
          const period = Math.max(0.8, 2.4 - q.mag * 0.22);
          const p = ((pulse + (q.time % 997) / 331) % period) / period;
          return 4 + p * (8 + q.mag * 5);
        },
        getLineColor: (q) => {
          const period = Math.max(0.8, 2.4 - q.mag * 0.22);
          const p = ((pulse + (q.time % 997) / 331) % period) / period;
          return hexRgb(magColor(q.mag), Math.round((1 - p) * 230));
        },
        updateTriggers: { getRadius: tick, getLineColor: tick },
      }),
    layersOn.quakes &&
      new ScatterplotLayer({
        id: 'quakes',
        data: quakes,
        getPosition: (q) => [q.lng, q.lat],
        radiusUnits: 'pixels',
        getRadius: (q) => 2.5 + Math.max(0, q.mag) * 1.8,
        getFillColor: (q) => hexRgb(magColor(q.mag), 220),
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: (q) => (q.id === selectedQuakeId ? 2.5 : 0.6),
        getLineColor: (q) => (q.id === selectedQuakeId ? [255, 255, 255, 255] : [0, 0, 0, 120]),
        pickable: true,
        updateTriggers: { getLineWidth: selectedQuakeId, getLineColor: selectedQuakeId },
      }),

    orbitPaths.length &&
      new PathLayer({
        id: 'sat-orbits',
        data: orbitPaths,
        getPath: (d) => d.path,
        getColor: (d) => (d.sel ? [255, 178, 62, 220] : [255, 190, 90, 110]),
        getWidth: (d) => (d.sel ? 2 : 1.2),
        widthUnits: 'pixels',
        getDashArray: [6, 4],
      }),
    f.sats &&
      new ScatterplotLayer({
        id: 'satellites',
        data: f.sats,
        radiusUnits: 'pixels',
        pickable: true,
        stroked: false,
      }),
    f.iss &&
      new TextLayer({
        id: 'iss-label',
        data: [{ p: f.iss }],
        getPosition: (d) => d.p,
        getText: () => 'ISS',
        getSize: 12,
        getColor: [255, 190, 90, 255],
        getPixelOffset: [0, -16],
        fontFamily: '"Chakra Petch", system-ui, sans-serif',
        fontWeight: 700,
        outlineWidth: 2,
        outlineColor: [2, 4, 11, 255],
        fontSettings: { sdf: true },
      }),

    f.aircraft &&
      new IconLayer({
        id: 'aircraft',
        data: f.aircraft,
        iconAtlas: atlas,
        iconMapping: ICON_MAPPING,
        getIcon: () => 'plane',
        getSize: planeSize,
        sizeUnits: 'pixels',
        pickable: true,
        alphaCutoff: 0.2,
        updateTriggers: { getSize: planeSize },
      }),
    f.selected &&
      new ScatterplotLayer({
        id: 'aircraft-halo',
        data: [f.selected],
        getPosition: (d) => [d.g.lng, d.g.lat],
        radiusUnits: 'pixels',
        getRadius: 16 + Math.sin(pulse * 4) * 2,
        getFillColor: [255, 178, 62, 40],
        stroked: true,
        getLineColor: [255, 178, 62, 200],
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
        updateTriggers: { getRadius: tick },
      }),
    f.selected &&
      new IconLayer({
        id: 'aircraft-selected',
        data: [f.selected],
        iconAtlas: atlas,
        iconMapping: ICON_MAPPING,
        getIcon: () => 'plane',
        getPosition: (d) => [d.g.lng, d.g.lat],
        getAngle: (d) => -d.g.hdg,
        getColor: [255, 178, 62, 255],
        getSize: planeSize * 1.9,
        sizeUnits: 'pixels',
        pickable: true,
        updateTriggers: { getPosition: tick, getAngle: tick, getSize: planeSize },
      }),
  ].filter(Boolean);

  viewStateRef.current = viewState;
  sizeRef.current = size;
  handlers.current = { onViewStateChange, onHover, onClick };

  // One Deck instance for the component's lifetime. The core class runs its own animation loop
  // (and canvas resize handling); React only pushes props into it.
  useEffect(() => {
    const deck = new Deck({
      parent: deckHostRef.current,
      views: VIEW,
      viewState: viewStateRef.current,
      controller: { dragRotate: false, touchRotate: false, inertia: 300, scrollZoom: { smooth: true, speed: 0.012 } },
      onViewStateChange: (p) => handlers.current.onViewStateChange(p),
      onHover: (info) => handlers.current.onHover(info),
      onClick: (info) => handlers.current.onClick(info),
      getCursor: ({ isDragging, isHovering }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
      pickingRadius: 6,
      useDevicePixels: Math.min(window.devicePixelRatio || 1, 2),
      layers: [],
      onError: (err) => console.error('[madar] deck.gl', err),
    });
    deckRef.current = deck;
    return () => {
      deckRef.current = null;
      deck.finalize();
    };
  }, []);

  // Push the latest layers / camera on every render (cheap: deck.gl diffs layer props itself).
  useEffect(() => {
    deckRef.current?.setProps({ layers, viewState });
  });

  /* ---------------- HTML weather chips ---------------- */

  const chips = useMemo(() => {
    if (!layersOn.weather || !weather.length || !size.width) return [];
    const vp = new WebMercatorViewport({ ...viewState, width: size.width, height: size.height });
    return weather
      .map((w) => {
        const [x, y] = vp.project([w.lng, w.lat]);
        return { w, x, y };
      })
      .filter((c) => c.x > -60 && c.y > -30 && c.x < size.width + 60 && c.y < size.height + 30);
  }, [layersOn.weather, weather, viewState, size]);

  return (
    <div className="flatmap" ref={wrapRef} aria-hidden={!active}>
      <div className="deck-host" ref={deckHostRef} />
      {chips.length > 0 && (
        <div className="flat-overlay">
          {chips.map(({ w, x, y }) => {
            const name = lang === 'ar' && w.nameAr ? w.nameAr : w.name;
            return (
              <div
                key={`${w.name}-${w.lat}`}
                className="wx-chip"
                style={{ '--wx': tempColor(w.temp), transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}
                title={`${name}: ${Math.round(w.temp)}°C, ${Math.round(w.wind ?? 0)} km/h`}
              >
                <span className="wx-icon">{weatherIcon(w.code, w.isDay)}</span>
                <b>{Math.round(w.temp)}°</b>
                <span className="wx-name">{name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
