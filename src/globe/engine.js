/**
 * GlobeEngine — imperative owner of the 3D scene.
 *
 * globe.gl provides the globe, atmosphere, camera controls and the "vector" layers
 * (countries, quake points/rings, arcs, paths, hexbin density, HTML weather chips).
 * Custom Three.js objects handle what needs raw GPU throughput:
 *   - aircraft: one InstancedBufferGeometry, motion computed in the vertex shader
 *   - satellites: one Points object, interpolated between worker frames
 *   - day/night earth shader, clouds shader, starfield
 */
import Globe from 'globe.gl';
import * as THREE from 'three';
import { useStore } from '../store/useStore.js';
import { flightStore, nowRel, BLEND, MAX_EXTRAP } from '../services/flightStore.js';
import { satStore, GROUP_COLORS, requestOrbit } from '../services/satellites.js';
import { magColor } from '../services/earthquakes.js';
import { weatherIcon, tempColor } from '../services/weather.js';
import { sunPosition, planeAltRatio, greatCircleAt, toGeo, clamp } from '../lib/geo.js';
import { createEarthMaterial, createAircraftMesh, createSatellitePoints, createStarfield, AIRCRAFT_ATTRS } from './materials.js';

import dayUrl from '../assets/textures/earth-day.jpg';
import nightUrl from '../assets/textures/earth-night.jpg';
import waterUrl from '../assets/textures/earth-water.jpg';
import cloudsUrl from '../assets/textures/clouds.jpg';

const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const PLANE_PX = isTouch ? 15 : 13;
const CLOUD_ALT = 0.0045;
const RESUME_ROTATE_MS = 12000;

const hexToRgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const HEAT_STOPS = ['#1d6fff', '#38e1ff', '#9d6bff', '#ff4fd8', '#ffb23e'];
function heatColor(v, max) {
  const t = clamp(Math.log1p(v) / Math.log1p(max || 1), 0, 1) * (HEAT_STOPS.length - 1);
  return HEAT_STOPS[Math.min(HEAT_STOPS.length - 1, Math.round(t))];
}

export class GlobeEngine {
  constructor(el) {
    this.el = el;
    this.disposed = false;
    this.capacity = 0;
    this.visibleFlags = new Uint8Array(0);
    this.recentRoutes = [];
    this.lastInteraction = 0;
    this.suppressClickUntil = 0;
    this.hoverCountry = null;
    this.selectedCountry = null;
    this.globeHover = null;
    this.pickHover = null;
    this.lastFrame = performance.now();
    this.unsubs = [];
    this.orbitKeys = {};
    this.strokeScale = 1;

    const s = useStore.getState();
    this.state = s;

    this.globe = new Globe(el, {
      waitForGlobeReady: false,
      animateIn: false,
      rendererConfig: { antialias: true, alpha: false, powerPreference: 'high-performance' },
    });
    const g = this.globe;
    this.renderer = g.renderer();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.75 : 2));
    this.scene = g.scene();
    this.camera = g.camera();
    this.controls = g.controls();

    g.width(el.clientWidth)
      .height(el.clientHeight)
      .backgroundColor('#02040b')
      .showAtmosphere(true)
      .atmosphereColor('#4fc8ff')
      .atmosphereAltitude(0.17)
      .showGraticules(false)
      .pointOfView({ ...s.view, altitude: 6.5 }, 0);

    this.controls.autoRotateSpeed = 0.28;
    this.controls.addEventListener('start', () => {
      this.lastInteraction = Date.now();
      this.userDragging = true;
    });
    this.controls.addEventListener('end', () => {
      this.lastInteraction = Date.now();
      this.userDragging = false;
    });
    this.controls.addEventListener('change', () => this.onCameraChange());

    this.setupEarth();
    this.setupStars();
    this.setupAircraft();
    this.setupLayers();
    this.setupPointer();
    this.setupOverlay();

    this.scene.onBeforeRender = () => this.frame();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(el);

    this.unsubs.push(flightStore.subscribe(() => this.syncAircraft()));
    this.unsubs.push(satStore.subscribe((kind) => (kind === 'frame' ? this.syncSatFrame() : this.syncPaths())));
    this.unsubs.push(useStore.subscribe((next, prev) => this.sync(next, prev)));

    this.sunTimer = setInterval(() => this.updateSun(), 30000);
    this.followTimer = setInterval(() => this.followTick(), 500);
    this.sync(s, {});
    this.syncAircraft();
  }

  /* ---------------------------------------------------------------- */
  /* Scene setup                                                       */
  /* ---------------------------------------------------------------- */

  setupEarth() {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => useStore.getState().setLoading({ textures: loaded / total });
    const loader = new THREE.TextureLoader(manager);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const load = (url, srgb) =>
      loader.load(url, (t) => {
        t.anisotropy = Math.min(8, maxAniso);
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
      });

    const day = load(dayUrl, true);
    const night = load(nightUrl, true);
    const water = load(waterUrl, false);
    const clouds = load(cloudsUrl, false);

    this.earthMaterial = createEarthMaterial({ day, night, water });
    this.globe.globeMaterial(this.earthMaterial);

    this.cloudsMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { map: { value: clouds }, sunDir: this.earthMaterial.uniforms.sunDir, uDayNight: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN;
        void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 sunDir; uniform float uDayNight;
        varying vec2 vUv; varying vec3 vN;
        void main() {
          float a = texture2D(map, vUv).g;
          float light = mix(1.0, smoothstep(-0.15, 0.3, dot(normalize(vN), normalize(sunDir))), uDayNight);
          vec3 col = mix(vec3(0.04, 0.05, 0.09), vec3(1.0), light);
          gl_FragColor = vec4(col, a * mix(0.28, 0.9, light));
        }
      `,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(100 * (1 + CLOUD_ALT), 96, 64), this.cloudsMaterial);
    this.clouds.rotation.y = -Math.PI / 2; // align texture with the globe's prime meridian
    this.clouds.renderOrder = 1;
    this.clouds.raycast = () => {};
    this.scene.add(this.clouds);

    manager.onLoad = () => {
      if (this.disposed) return;
      useStore.getState().setLoading({ textures: 1, texturesDone: true });
      this.updateSun();
      const v = useStore.getState().view;
      setTimeout(() => this.globe.pointOfView({ lat: v.lat, lng: v.lng, altitude: v.altitude }, 2600), 250);
    };
    manager.onError = () => useStore.getState().pushToast({ key: 'tex', tone: 'error', messageKey: 'toast.textureError' });
  }

  setupStars() {
    this.stars = createStarfield(isTouch ? 3500 : 6500, 9000);
    this.stars.raycast = () => {};
    this.scene.add(this.stars);
  }

  setupAircraft() {
    this.ensureCapacity(8192);
  }

  ensureCapacity(n) {
    if (n <= this.capacity) return;
    const cap = Math.max(8192, 2 ** Math.ceil(Math.log2(n)));
    if (this.aircraft) {
      this.scene.remove(this.aircraft);
      this.aircraft.geometry.dispose();
      this.aircraft.material.dispose();
    }
    this.aircraft = createAircraftMesh(cap);
    this.aircraft.raycast = () => {};
    this.aircraft.material.uniforms.uBlendDur.value = BLEND;
    this.aircraft.material.uniforms.uMaxExtrap.value = MAX_EXTRAP;
    this.aircraft.visible = this.state.layers.flights;
    this.scene.add(this.aircraft);
    this.capacity = cap;
    this.visibleFlags = new Uint8Array(cap);
  }

  setupLayers() {
    const g = this.globe;
    this.capNone = new THREE.MeshBasicMaterial({ color: '#38e1ff', transparent: true, opacity: 0, depthWrite: false });
    this.capHover = new THREE.MeshBasicMaterial({ color: '#38e1ff', transparent: true, opacity: 0.22, depthWrite: false });
    this.capSelected = new THREE.MeshBasicMaterial({ color: '#9d6bff', transparent: true, opacity: 0.26, depthWrite: false });

    g.polygonGeoJsonGeometry('geometry')
      .polygonsTransitionDuration(180)
      .polygonCapCurvatureResolution(3)
      .onPolygonHover((poly) => {
        if (isTouch) return;
        this.hoverCountry = poly;
        this.refreshPolygons();
        this.globeHover = poly ? { kind: 'country', key: poly.properties.iso3 || poly.properties.name, data: poly.properties } : null;
        this.pushHover();
      })
      .onPolygonClick((poly) => {
        if (performance.now() < this.suppressClickUntil) return;
        useStore.getState().select({ kind: 'country', data: poly.properties });
      });
    this.refreshPolygons();

    g.pointLat('lat')
      .pointLng('lng')
      .pointAltitude((d) => 0.006 + Math.max(0, d.mag) * 0.0035)
      .pointRadius((d) => 0.12 + Math.max(0, d.mag) * 0.085)
      .pointColor((d) => magColor(d.mag))
      .pointResolution(10)
      .pointsMerge(false)
      .pointsTransitionDuration(0)
      .onPointHover((q) => {
        if (isTouch) return;
        this.globeHover = q ? { kind: 'quake', key: q.id, data: q } : this.hoverCountry ? this.globeHover : null;
        this.pushHover();
      })
      .onPointClick((q) => {
        if (performance.now() < this.suppressClickUntil) return;
        useStore.getState().select({ kind: 'quake', data: q });
      });

    g.ringLat('lat')
      .ringLng('lng')
      .ringAltitude(0.006)
      .ringColor((d) => (t) => hexToRgba(magColor(d.mag), Math.max(0, 1 - t) * 0.9))
      .ringMaxRadius((d) => 0.8 + d.mag * 0.85)
      .ringPropagationSpeed((d) => 0.9 + d.mag * 0.35)
      .ringRepeatPeriod((d) => Math.max(700, 2400 - d.mag * 220));

    g.arcStartLat((d) => d.o.lat)
      .arcStartLng((d) => d.o.lng)
      .arcEndLat((d) => d.d.lat)
      .arcEndLng((d) => d.d.lng)
      .arcColor((d) => d.color)
      .arcStroke((d) => d.stroke * this.strokeScale)
      .arcAltitudeAutoScale(0.28)
      .arcDashLength(0.4)
      .arcDashGap(0.18)
      .arcDashInitialGap((d) => d.gap)
      .arcDashAnimateTime((d) => d.speed)
      .arcsTransitionDuration(0);

    g.pathPoints('points')
      .pathPointLat((p) => p[0])
      .pathPointLng((p) => p[1])
      .pathPointAlt((p) => p[2])
      .pathColor((d) => d.color)
      .pathStroke((d) => (d.stroke == null ? null : d.stroke * this.strokeScale))
      .pathDashLength((d) => (d.dash ? 0.012 : 1))
      .pathDashGap((d) => (d.dash ? 0.006 : 0))
      .pathDashAnimateTime((d) => (d.dash ? 40000 : 0))
      .pathResolution(2)
      .pathTransitionDuration(0);

    g.hexBinPointLat('lat')
      .hexBinPointLng('lng')
      .hexBinPointWeight(1)
      .hexBinResolution(3)
      .hexMargin(0.22)
      .hexBinMerge(true)
      .hexTransitionDuration(0)
      .hexAltitude((d) => Math.min(0.08, 0.004 + d.sumWeight * 0.0009))
      .hexTopColor((d) => hexToRgba(heatColor(d.sumWeight, this.heatMax), 0.85))
      .hexSideColor((d) => hexToRgba(heatColor(d.sumWeight, this.heatMax), 0.35));

    g.htmlLat('lat')
      .htmlLng('lng')
      .htmlAltitude(0.012)
      .htmlTransitionDuration(0)
      .htmlElement((d) => d.el)
      .htmlElementVisibilityModifier((el, visible) => el.classList.toggle('is-hidden', !visible));

    g.onGlobeClick(() => {
      if (performance.now() < this.suppressClickUntil) return;
      const st = useStore.getState();
      if (st.selection) st.clearSelection();
    });
  }

  refreshPolygons() {
    const hov = this.hoverCountry;
    const sel = this.selectedCountry;
    this.globe
      .polygonAltitude((d) => (d === hov || d === sel ? 0.009 : 0.0028))
      .polygonCapMaterial((d) => (d === sel ? this.capSelected : d === hov ? this.capHover : this.capNone))
      .polygonSideColor((d) => (d === hov || d === sel ? 'rgba(56,225,255,0.18)' : 'rgba(0,0,0,0)'))
      .polygonStrokeColor((d) => (d === sel ? '#c7a8ff' : d === hov ? '#8ff3ff' : 'rgba(120,220,255,0.26)'));
  }

  setupOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'globe-overlay';
    this.el.appendChild(this.overlay);
    this.issLabel = document.createElement('div');
    this.issLabel.className = 'iss-label';
    this.issLabel.textContent = 'ISS';
    this.overlay.appendChild(this.issLabel);
  }

  /* ---------------------------------------------------------------- */
  /* Pointer picking (aircraft + satellites are not raycast targets)   */
  /* ---------------------------------------------------------------- */

  setupPointer() {
    const el = this.el;
    let down = null;
    let lastMove = 0;

    this.onPointerDown = (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    this.onPointerUp = (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 6) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const radius = e.pointerType === 'touch' ? 22 : 12;
      const st = useStore.getState();
      const f = st.layers.flights ? this.pickFlight(x, y, radius) : null;
      if (f) {
        this.suppressClickUntil = performance.now() + 400;
        st.select({ kind: 'flight', id: f.icao24 });
        return;
      }
      const si = st.layers.satellites ? this.pickSat(x, y, radius) : -1;
      if (si >= 0) {
        this.suppressClickUntil = performance.now() + 400;
        st.select({ kind: 'sat', id: satStore.sats[si].norad, index: si });
      }
    };
    this.onPointerMove = (e) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.mouse = { x, y };
      if (e.pointerType !== 'mouse' || down) return;
      const now = performance.now();
      if (now - lastMove < 60) return;
      lastMove = now;
      const st = useStore.getState();
      const f = st.layers.flights ? this.pickFlight(x, y, 9) : null;
      let hover = f ? { kind: 'flight', key: f.icao24 } : null;
      if (!hover && st.layers.satellites) {
        const si = this.pickSat(x, y, 8);
        if (si >= 0) hover = { kind: 'sat', key: String(satStore.sats[si].norad), index: si };
      }
      this.pickHover = hover;
      el.style.cursor = hover ? 'pointer' : '';
      this.pushHover();
    };
    this.onPointerLeave = () => {
      this.pickHover = null;
      this.globeHover = null;
      this.pushHover();
    };

    el.addEventListener('pointerdown', this.onPointerDown, true);
    el.addEventListener('pointerup', this.onPointerUp, true);
    el.addEventListener('pointermove', this.onPointerMove, true);
    el.addEventListener('pointerleave', this.onPointerLeave);
  }

  pushHover() {
    useStore.getState().setHover(this.pickHover || this.globeHover || null);
  }

  projectToScreen(v) {
    // Occluded by the globe?
    const cam = this.camera.position;
    if (v.x * cam.x + v.y * cam.y + v.z * cam.z < v.x * v.x + v.y * v.y + v.z * v.z) return null;
    const p = this.tmpV || (this.tmpV = new THREE.Vector3());
    p.set(v.x, v.y, v.z).project(this.camera);
    if (p.z > 1) return null;
    return { x: ((p.x + 1) / 2) * this.el.clientWidth, y: ((1 - p.y) / 2) * this.el.clientHeight };
  }

  pickFlight(x, y, radius) {
    const t = nowRel();
    const list = this.aircraftList || [];
    const out = { x: 0, y: 0, z: 0 };
    let best = null;
    let bestD = radius * radius;
    for (let i = 0; i < list.length; i++) {
      if (!this.visibleFlags[i]) continue;
      flightStore.worldAt(list[i], t, out);
      const s = this.projectToScreen(out);
      if (!s) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = list[i];
      }
    }
    return best;
  }

  pickSat(x, y, radius) {
    const f = satStore.frame;
    if (!f || !this.satPoints) return -1;
    const m = satStore.mix();
    let best = -1;
    let bestD = radius * radius;
    const v = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < satStore.n; i++) {
      const j = i * 3;
      if (f.geo[i * 4 + 2] < 0) continue;
      v.x = f.posA[j] + (f.posB[j] - f.posA[j]) * m;
      v.y = f.posA[j + 1] + (f.posB[j + 1] - f.posA[j + 1]) * m;
      v.z = f.posA[j + 2] + (f.posB[j + 2] - f.posA[j + 2]) * m;
      const s = this.projectToScreen(v);
      if (!s) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /* ---------------------------------------------------------------- */
  /* Per-frame                                                         */
  /* ---------------------------------------------------------------- */

  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const h = this.el.clientHeight || 1;
    const fov = THREE.MathUtils.degToRad(this.camera.fov || 50);

    const u = this.aircraft.material.uniforms;
    u.uTime.value = nowRel();
    // Smaller icons from far away (thousands of aircraft), full size when zoomed in.
    const camAlt = this.camera.position.length() / 100 - 1;
    const zoomK = clamp(1.12 - (camAlt - 0.35) * 0.22, 0.58, 1.12);
    u.uSizeFactor.value = (PLANE_PX * zoomK * 2 * Math.tan(fov / 2)) / h;

    this.stars.material.uniforms.uTime.value = now / 1000;
    this.stars.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    this.clouds.rotation.y += dt * 0.0035;

    if (this.satPoints) {
      this.satPoints.material.uniforms.uMix.value = satStore.mix();
      this.satPoints.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
      this.updateIssLabel();
    }

    const st = this.state;
    const idle = Date.now() - this.lastInteraction > RESUME_ROTATE_MS;
    this.controls.autoRotate = !!(st.layers.autoRotate && idle && !st.selection && !this.flying && !this.userDragging);
  }

  updateIssLabel() {
    const i = this.issIndex;
    const f = satStore.frame;
    if (i == null || i < 0 || !f || !this.state.layers.satellites) {
      this.issLabel.style.opacity = '0';
      return;
    }
    const m = satStore.mix();
    const j = i * 3;
    const v = {
      x: f.posA[j] + (f.posB[j] - f.posA[j]) * m,
      y: f.posA[j + 1] + (f.posB[j + 1] - f.posA[j + 1]) * m,
      z: f.posA[j + 2] + (f.posB[j + 2] - f.posA[j + 2]) * m,
    };
    const s = this.projectToScreen(v);
    if (!s) {
      this.issLabel.style.opacity = '0';
      return;
    }
    this.issLabel.style.opacity = '1';
    this.issLabel.style.transform = `translate(${s.x + 10}px, ${s.y - 22}px)`;
  }

  updateSun() {
    const sun = sunPosition(new Date());
    const c = this.globe.getCoords(sun.lat, sun.lng, 0);
    this.earthMaterial.uniforms.sunDir.value.set(c.x, c.y, c.z).normalize();
  }

  /** Arc / path widths are in globe units, so thin them out as the camera closes in. */
  updateStrokeScale() {
    const alt = this.camera.position.length() / 100 - 1;
    const k = Math.round(clamp(alt / 1.9, 0.08, 1) * 20) / 20; // quantised: avoid rebuilding every frame
    if (k === this.strokeScale) return;
    this.strokeScale = k;
    this.globe.arcStroke(this.globe.arcStroke()); // re-evaluate accessors with the new scale
    this.globe.pathStroke(this.globe.pathStroke());
  }

  onCameraChange() {
    clearTimeout(this.strokeTimer);
    this.strokeTimer = setTimeout(() => !this.disposed && this.updateStrokeScale(), 120);
    clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => {
      if (this.disposed) return;
      const pov = this.globe.pointOfView();
      useStore.getState().setView({ lat: pov.lat, lng: pov.lng, altitude: pov.altitude });
    }, 350);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.el;
    if (w && h) this.globe.width(w).height(h);
  }

  /* ---------------------------------------------------------------- */
  /* Data sync                                                         */
  /* ---------------------------------------------------------------- */

  syncAircraft() {
    const list = flightStore.list;
    const n = list.length;
    this.ensureCapacity(n);
    const geo = this.aircraft.geometry;
    const [aPrev, aCur, aMotion, aExtra] = AIRCRAFT_ATTRS.map((k) => geo.getAttribute(k).array);
    const st = this.state;
    const selId = st.selection?.kind === 'flight' ? st.selection.id : null;
    const heat = [];

    for (let i = 0; i < n; i++) {
      const f = list[i];
      const o = i * 4;
      aPrev[o] = f.prev.lat;
      aPrev[o + 1] = f.prev.lng;
      aPrev[o + 2] = f.prev.altKm;
      aPrev[o + 3] = f.prev.hdg;
      aCur[o] = f.cur.lat;
      aCur[o + 1] = f.cur.lng;
      aCur[o + 2] = f.cur.altKm;
      aCur[o + 3] = f.cur.hdg;
      aMotion[o] = f.prev.spd;
      aMotion[o + 1] = f.prev.t0;
      aMotion[o + 2] = f.cur.spd;
      aMotion[o + 3] = f.cur.t0;
      const vis = flightStore.isVisible(f, st.filters) ? 1 : 0;
      this.visibleFlags[i] = vis;
      aExtra[o] = f.blendStart;
      aExtra[o + 1] = vis;
      aExtra[o + 2] = f.icao24 === selId ? 1 : 0;
      aExtra[o + 3] = f.onGround ? 1 : 0;
      if (vis && !f.onGround) heat.push({ lat: f.cur.lat, lng: f.cur.lng });
    }
    for (const k of AIRCRAFT_ATTRS) {
      const attr = geo.getAttribute(k);
      attr.clearUpdateRanges?.();
      attr.addUpdateRange?.(0, n * 4);
      attr.needsUpdate = true;
    }
    geo.instanceCount = n;
    this.aircraftList = list;
    this.heatPoints = heat;
    if (st.layers.heatmap) this.syncHeatmap();
    this.syncArcs();
  }

  syncHeatmap() {
    const on = this.state.layers.heatmap && this.state.layers.flights;
    if (!on) {
      this.globe.hexBinPointsData([]);
      return;
    }
    // Rough max for the colour scale: busiest res-3 hex ≈ sqrt(total) * 1.6
    this.heatMax = Math.max(8, Math.sqrt(this.heatPoints?.length || 1) * 1.6);
    this.globe.hexBinPointsData(this.heatPoints || []);
  }

  syncArcs() {
    const st = this.state;
    if (!st.layers.arcs || !st.layers.flights) {
      this.globe.arcsData([]);
      this.arcKey = '';
      return;
    }
    const arcs = [];
    const details = st.selectedDetails;
    const selRoute = details?.route;
    if (selRoute?.origin && selRoute?.destination) {
      arcs.push({ o: selRoute.origin, d: selRoute.destination, color: ['#38e1ff', '#ffb23e'], stroke: 0.55, gap: 0, speed: 2200, key: 'sel' });
    }
    for (const r of this.recentRoutes) {
      if (selRoute && r.key === `${selRoute.origin?.iata}-${selRoute.destination?.iata}`) continue;
      arcs.push({ o: r.o, d: r.d, color: ['rgba(56,225,255,0.55)', 'rgba(157,107,255,0.55)'], stroke: 0.25, gap: 0.5, speed: 4200, key: r.key });
    }
    if (flightStore.source === 'demo') {
      // In simulation mode every route is known: show a sample of the network.
      const bucket = Math.floor(Date.now() / 120000);
      if (this.demoArcBucket !== bucket || !this.demoArcs) {
        this.demoArcBucket = bucket;
        this.demoArcs = flightStore.list
          .filter((f, i) => f.demo && i % 30 === 0)
          .slice(0, 80)
          .map((f, i) => ({ o: f.demo.origin, d: f.demo.destination, color: ['rgba(56,225,255,0.5)', 'rgba(157,107,255,0.5)'], stroke: 0.18, gap: (i % 10) / 10, speed: 3200 + (i % 5) * 500, key: `demo-${f.icao24}` }));
      }
      arcs.push(...this.demoArcs);
    } else {
      this.demoArcs = null;
    }
    const key = arcs.map((a) => a.key).join('|');
    if (key === this.arcKey) return; // avoid restarting dash animations
    this.arcKey = key;
    this.globe.arcsData(arcs);
  }

  syncPaths() {
    const st = this.state;
    const paths = [];
    const track = st.selectedDetails?.track;
    if (st.selection?.kind === 'flight' && track?.length > 1) {
      paths.push({
        points: track.map((p) => [p[0], p[1], planeAltRatio((p[2] || 0) / 1000)]),
        color: ['rgba(255,178,62,0.1)', 'rgba(255,178,62,0.95)'],
        stroke: 0.35,
        dash: false,
      });
    }
    if (st.layers.satellites && satStore.n) {
      const wanted = [this.issIndex];
      if (st.selection?.kind === 'sat') wanted.push(st.selection.index);
      for (const idx of wanted) {
        if (idx == null || idx < 0) continue;
        const k = requestOrbit(idx);
        this.orbitKeys[idx] = k;
        const pts = satStore.orbits.get(k);
        if (pts) {
          const selected = st.selection?.kind === 'sat' && st.selection.index === idx;
          paths.push({ points: pts, color: selected ? 'rgba(255,178,62,0.85)' : 'rgba(255,190,90,0.45)', stroke: null, dash: true });
        }
      }
    }
    this.globe.pathsData(paths);
  }

  syncSatellites() {
    const on = this.state.layers.satellites;
    if (!on) {
      if (this.satPoints) this.satPoints.visible = false;
      this.syncPaths();
      return;
    }
    if (!satStore.n) return;
    if (!this.satPoints || this.satPointsN !== satStore.n || this.satKey !== satStore.key) {
      if (this.satPoints) {
        this.scene.remove(this.satPoints);
        this.satPoints.geometry.dispose();
        this.satPoints.material.dispose();
      }
      const n = satStore.n;
      const colors = new Float32Array(n * 3);
      const sizes = new Float32Array(n);
      const c = new THREE.Color();
      satStore.sats.forEach((s, i) => {
        c.set(GROUP_COLORS[s.group] || GROUP_COLORS.fallback);
        colors.set([c.r, c.g, c.b], i * 3);
        sizes[i] = s.norad === 25544 ? 9 : s.group === 'starlink' ? 2.4 : s.group === 'stations' ? 6 : 4;
      });
      this.satPoints = createSatellitePoints(n, colors, sizes);
      this.satPoints.raycast = () => {};
      this.scene.add(this.satPoints);
      this.satPointsN = n;
      this.satKey = satStore.key;
      this.issIndex = satStore.indexOfNorad(25544);
      this.syncSatFrame();
    }
    this.satPoints.visible = true;
    this.satPoints.material.uniforms.uSelected.value = this.state.selection?.kind === 'sat' ? this.state.selection.index : -1;
    this.syncPaths();
  }

  syncSatFrame() {
    const f = satStore.frame;
    if (!this.satPoints || !f || f.posA.length !== this.satPointsN * 3) return;
    const geo = this.satPoints.geometry;
    geo.getAttribute('position').array.set(f.posA);
    geo.getAttribute('aPosB').array.set(f.posB);
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('aPosB').needsUpdate = true;
    if (!this.orbitRefreshed || Date.now() - this.orbitRefreshed > 60000) {
      this.orbitRefreshed = Date.now();
      this.syncPaths();
    }
  }

  syncQuakes() {
    const st = this.state;
    const on = st.layers.quakes;
    const quakes = on ? st.quakes : [];
    this.globe.pointsData(quakes);
    this.globe.ringsData(quakes.filter((q) => q.mag >= 2.5 || (st.selection?.kind === 'quake' && st.selection.data.id === q.id)));
  }

  syncWeather() {
    const st = this.state;
    if (!st.layers.weather) {
      this.globe.htmlElementsData([]);
      return;
    }
    const lang = st.lang;
    const data = st.weather.map((w) => {
      const el = document.createElement('div');
      el.className = 'wx-chip';
      el.style.setProperty('--wx', tempColor(w.temp));
      const name = lang === 'ar' && w.nameAr ? w.nameAr : w.name;
      el.innerHTML = `<span class="wx-icon">${weatherIcon(w.code, w.isDay)}</span><b>${Math.round(w.temp)}°</b><span class="wx-name">${name}</span>`;
      el.title = `${name}: ${Math.round(w.temp)}°C, ${Math.round(w.wind ?? 0)} km/h`;
      return { lat: w.lat, lng: w.lng, el };
    });
    this.globe.htmlElementsData(data);
  }

  syncCountries() {
    const st = this.state;
    if (!st.layers.countries) {
      this.globe.polygonsData([]);
      return;
    }
    if (this.countryFeatures) {
      this.globe.polygonsData(this.countryFeatures);
      return;
    }
    import('../data/countries.json').then(async ({ default: fc }) => {
      if (this.disposed) return;
      const { hydrateCountryNames } = await import('../lib/countryNames.js');
      hydrateCountryNames(fc.features);
      this.countryFeatures = fc.features;
      if (this.state.layers.countries) this.globe.polygonsData(fc.features);
    });
  }

  selectCountryFeature(props) {
    const f = this.countryFeatures?.find((c) => c.properties === props || (props && c.properties.iso3 === props.iso3));
    this.selectedCountry = f || null;
    this.refreshPolygons();
  }

  /* ---------------------------------------------------------------- */
  /* Camera                                                            */
  /* ---------------------------------------------------------------- */

  flyTo({ lat, lng, altitude = 0.6, duration }) {
    const g = this.globe;
    const cur = g.pointOfView();
    const angle = Math.acos(
      clamp(
        Math.sin((cur.lat * Math.PI) / 180) * Math.sin((lat * Math.PI) / 180) +
          Math.cos((cur.lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.cos(((lng - cur.lng) * Math.PI) / 180),
        -1,
        1,
      ),
    );
    clearTimeout(this.flyTimer);
    this.flying = true;
    this.lastInteraction = Date.now();
    const done = (ms) => {
      this.flyTimer = setTimeout(() => {
        this.flying = false;
      }, ms);
    };
    if (duration != null) {
      g.pointOfView({ lat, lng, altitude }, duration);
      done(duration + 50);
    } else if (angle > 0.5) {
      // Cinematic two-stage move: pull back towards the midpoint, then dive in.
      const [mLat, mLng] = greatCircleAt(cur.lat, cur.lng, lat, lng, 0.5);
      const midAlt = Math.max(cur.altitude, 1.6 + angle * 0.6);
      g.pointOfView({ lat: mLat, lng: mLng, altitude: midAlt }, 1300);
      this.flyTimer = setTimeout(() => {
        g.pointOfView({ lat, lng, altitude }, 1900);
        done(2000);
      }, 1300);
    } else {
      g.pointOfView({ lat, lng, altitude }, 1700);
      done(1800);
    }
  }

  followTick() {
    const st = this.state;
    if (!st.follow || st.selection?.kind !== 'flight' || this.flying || this.userDragging) return;
    const f = flightStore.get(st.selection.id);
    if (!f) return;
    const g = flightStore.geoAt(f);
    this.globe.pointOfView({ lat: g.lat, lng: g.lng }, 480);
  }

  /* ---------------------------------------------------------------- */
  /* Store -> scene                                                    */
  /* ---------------------------------------------------------------- */

  sync(next, prev) {
    this.state = next;
    const L = next.layers;
    const P = prev.layers || {};

    if (L.flights !== P.flights && this.aircraft) this.aircraft.visible = L.flights;
    if (L.clouds !== P.clouds) this.clouds.visible = L.clouds;
    if (L.dayNight !== P.dayNight) {
      this.earthMaterial.uniforms.uDayNight.value = L.dayNight ? 1 : 0;
      this.cloudsMaterial.uniforms.uDayNight.value = L.dayNight ? 1 : 0;
    }
    if (L.heatmap !== P.heatmap || L.flights !== P.flights) this.syncHeatmap();
    if (L.countries !== P.countries) this.syncCountries();
    if (L.quakes !== P.quakes || next.quakes !== prev.quakes) this.syncQuakes();
    if (L.weather !== P.weather || next.weather !== prev.weather || (L.weather && next.lang !== prev.lang)) this.syncWeather();
    if (L.satellites !== P.satellites || next.satVersion !== prev.satVersion) this.syncSatellites();

    const selChanged = next.selection !== prev.selection;
    if (next.filters !== prev.filters || selChanged) this.syncAircraft();
    if (selChanged) {
      if (next.selection?.kind === 'country') this.selectCountryFeature(next.selection.data);
      else if (this.selectedCountry) this.selectCountryFeature(null);
      if (next.selection?.kind === 'quake' || prev.selection?.kind === 'quake') this.syncQuakes();
      if (this.satPoints) this.satPoints.material.uniforms.uSelected.value = next.selection?.kind === 'sat' ? next.selection.index : -1;
      this.syncPaths();
    }
    if (next.selectedDetails !== prev.selectedDetails) {
      const r = next.selectedDetails?.route;
      if (r?.origin && r?.destination && !r.simulated) {
        const key = `${r.origin.iata}-${r.destination.iata}`;
        this.recentRoutes = [{ o: r.origin, d: r.destination, key }, ...this.recentRoutes.filter((x) => x.key !== key)].slice(0, 8);
      }
      this.syncArcs();
      this.syncPaths();
    }
    if (L.arcs !== P.arcs || L.flights !== P.flights) this.syncArcs();
    if (next.flyTo && next.flyTo !== prev.flyTo) this.flyTo(next.flyTo);
    if (next.follow && !prev.follow) this.followTick();
  }

  pause() {
    this.globe.pauseAnimation();
  }

  resume() {
    this.globe.resumeAnimation();
    const v = this.state.view;
    if (v) this.globe.pointOfView(v, 0);
    this.resize();
  }

  destroy() {
    this.disposed = true;
    clearInterval(this.sunTimer);
    clearInterval(this.followTimer);
    clearTimeout(this.flyTimer);
    this.unsubs.forEach((u) => u());
    this.resizeObserver.disconnect();
    this.el.removeEventListener('pointerdown', this.onPointerDown, true);
    this.el.removeEventListener('pointerup', this.onPointerUp, true);
    this.el.removeEventListener('pointermove', this.onPointerMove, true);
    this.el.removeEventListener('pointerleave', this.onPointerLeave);
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => {
        Object.values(m.uniforms || {}).forEach((u) => u.value?.isTexture && u.value.dispose());
        m.dispose?.();
      });
    });
    this.globe._destructor?.();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.el.innerHTML = '';
  }
}

export { toGeo };
