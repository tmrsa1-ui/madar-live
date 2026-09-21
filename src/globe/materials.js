import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Earth: day / night blend with city lights, ocean glint, twilight    */
/* ------------------------------------------------------------------ */

export function createEarthMaterial({ day, night, water }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: day },
      nightMap: { value: night },
      waterMap: { value: water },
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
      uDayNight: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vUv = uv;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayMap;
      uniform sampler2D nightMap;
      uniform sampler2D waterMap;
      uniform vec3 sunDir;
      uniform float uDayNight;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 s = normalize(sunDir);
        float d = dot(n, s);
        float dayMix = mix(1.0, smoothstep(-0.10, 0.20, d), uDayNight);

        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb;
        float water = texture2D(waterMap, vUv).r;

        float lambert = mix(1.0, clamp(d * 0.85 + 0.35, 0.22, 1.0), uDayNight);
        vec3 dayCol = day * lambert * 1.2;

        // City lights: warm sodium tint, boosted, with a faint blue-hour fill on the night side.
        vec3 lights = pow(night, vec3(1.7)) * vec3(2.9, 2.05, 1.2);
        vec3 nightCol = day * vec3(0.018, 0.028, 0.06) + lights;

        vec3 V = normalize(cameraPosition - vPosW);
        vec3 H = normalize(s + V);
        // Tight sun glint on water + a faint wide sheen (kept subtle: output is sRGB-encoded).
        float nh = max(dot(n, H), 0.0);
        float spec = (pow(nh, 900.0) * 0.32 + pow(nh, 110.0) * 0.012) * water * dayMix;

        // Golden hour: warm the sunlit side just before the terminator (multiplicative, so it never
        // paints the dark ocean), plus a very faint glow — values are linear, sRGB output boosts them.
        float tw = clamp(1.0 - abs(d - 0.04) / 0.14, 0.0, 1.0) * uDayNight;
        dayCol *= mix(vec3(1.0), vec3(1.08, 0.78, 0.58), tw);

        vec3 col = mix(nightCol, dayCol, dayMix) + spec * vec3(1.0, 0.92, 0.78);
        col += vec3(1.0, 0.45, 0.2) * tw * tw * 0.0035;

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/* ------------------------------------------------------------------ */
/* Aircraft: every plane is an instance; motion is computed on the GPU */
/* ------------------------------------------------------------------ */

function planeShape() {
  const right = [
    [0, 0.5], [0.055, 0.42], [0.065, 0.14], [0.48, -0.06], [0.48, -0.14], [0.065, -0.04],
    [0.05, -0.3], [0.19, -0.4], [0.19, -0.47], [0, -0.42],
  ];
  const left = right.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  const pts = [...right, ...left].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.ShapeGeometry(new THREE.Shape(pts));
}

export const AIRCRAFT_ATTRS = ['aPrev', 'aCur', 'aMotion', 'aExtra'];

export function createAircraftMesh(capacity) {
  const base = planeShape();
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  for (const name of AIRCRAFT_ATTRS) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, attr);
  }
  geo.instanceCount = 0;

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uSizeFactor: { value: 0.004 },
      uBlendDur: { value: 3 },
      uMaxExtrap: { value: 90 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSizeFactor;
      uniform float uBlendDur;
      uniform float uMaxExtrap;
      attribute vec4 aPrev;   // lat, lng, altKm, heading
      attribute vec4 aCur;    // lat, lng, altKm, heading
      attribute vec4 aMotion; // prevSpeedKmS, prevT0, curSpeedKmS, curT0
      attribute vec4 aExtra;  // blendStart, visible, selected, onGround
      varying vec3 vColor;

      const float R = 100.0;
      const float EARTH_KM = 6371.0;

      vec2 destination(vec2 ll, float brngDeg, float distKm) {
        float lat1 = radians(ll.x);
        float lng1 = radians(ll.y);
        float b = radians(brngDeg);
        float d = distKm / EARTH_KM;
        float sinLat2 = sin(lat1) * cos(d) + cos(lat1) * sin(d) * cos(b);
        float lat2 = asin(clamp(sinLat2, -1.0, 1.0));
        float lng2 = lng1 + atan(sin(b) * sin(d) * cos(lat1), cos(d) - sin(lat1) * sinLat2);
        return vec2(degrees(lat2), degrees(lng2));
      }
      vec3 toCart(vec2 ll, float altRatio) {
        float phi = radians(90.0 - ll.x);
        float theta = radians(90.0 - ll.y);
        float r = R * (1.0 + altRatio);
        return vec3(r * sin(phi) * cos(theta), r * cos(phi), r * sin(phi) * sin(theta));
      }
      float altRatio(float altKm) { return 0.0065 + max(altKm, 0.0) * 0.00045; }
      vec3 posFor(vec4 s, float spd, float t0) {
        float dt = clamp(uTime - t0, 0.0, uMaxExtrap);
        return toCart(destination(s.xy, s.w, spd * dt), altRatio(s.z));
      }
      vec3 forwardFor(vec3 up, float hdg) {
        vec3 east = cross(vec3(0.0, 1.0, 0.0), up);
        east = length(east) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(east);
        vec3 north = cross(up, east);
        float h = radians(hdg);
        return normalize(cos(h) * north + sin(h) * east);
      }

      void main() {
        if (aExtra.y < 0.5) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          vColor = vec3(0.0);
          return;
        }
        vec3 pPrev = posFor(aPrev, aMotion.x, aMotion.y);
        vec3 pCur = posFor(aCur, aMotion.z, aMotion.w);
        float w = smoothstep(0.0, 1.0, clamp((uTime - aExtra.x) / uBlendDur, 0.0, 1.0));
        vec3 p = mix(pPrev, pCur, w);
        vec3 up = normalize(p);
        vec3 fwd = mix(forwardFor(normalize(pPrev), aPrev.w), forwardFor(normalize(pCur), aCur.w), w);
        fwd = normalize(fwd - up * dot(fwd, up));
        vec3 right = normalize(cross(fwd, up));

        float sel = aExtra.z;
        float dist = length(cameraPosition - p);
        float scale = uSizeFactor * dist * mix(1.0, 2.1, sel);
        vec3 world = p + (right * position.x + fwd * position.y + up * position.z) * scale;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

        // Non-linear ramp so the busy cruise band (9-12 km) spans cyan -> violet.
        float a = pow(clamp(aCur.z / 13.0, 0.0, 1.0), 1.8);
        vec3 low = vec3(0.36, 1.0, 0.80);
        vec3 mid = vec3(0.22, 0.88, 1.0);
        vec3 high = vec3(0.68, 0.48, 1.0);
        vColor = a < 0.5 ? mix(low, mid, a * 2.0) : mix(mid, high, (a - 0.5) * 2.0);
        if (aExtra.w > 0.5) vColor = vec3(0.55, 0.6, 0.72);
        vColor = mix(vColor, vec3(1.0, 0.70, 0.24), sel);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() { gl_FragColor = vec4(vColor, 1.0); }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Satellites: GPU-interpolated points                                 */
/* ------------------------------------------------------------------ */

export function createSatellitePoints(n, colors, sizes) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aPosB', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uMix: { value: 0 }, uPixelRatio: { value: 1 }, uSelected: { value: -1 } },
    vertexShader: /* glsl */ `
      uniform float uMix;
      uniform float uPixelRatio;
      uniform float uSelected;
      attribute vec3 aPosB;
      attribute vec3 aColor;
      attribute float aSize;
      varying vec3 vColor;
      varying float vSel;
      void main() {
        vec3 p = mix(position, aPosB, uMix);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float sel = abs(float(gl_VertexID) - uSelected) < 0.5 ? 1.0 : 0.0;
        vSel = sel;
        vColor = mix(aColor, vec3(1.0, 0.75, 0.3), sel);
        gl_PointSize = (aSize + sel * 10.0) * uPixelRatio;
        if (length(position) < 1.0) gl_PointSize = 0.0;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vSel;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c);
        if (r > 0.5) discard;
        float core = smoothstep(0.5, 0.0, r);
        float ring = vSel * smoothstep(0.08, 0.0, abs(r - 0.38));
        gl_FragColor = vec4(vColor * (core * 1.4 + ring), core + ring);
      }
    `,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  return points;
}

/* ------------------------------------------------------------------ */
/* Starfield                                                           */
/* ------------------------------------------------------------------ */

export function createStarfield(count = 6000, radius = 9000) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const palette = [
    [0.75, 0.85, 1.0], [1.0, 1.0, 1.0], [1.0, 0.92, 0.8], [0.7, 0.8, 1.0], [0.85, 0.75, 1.0],
  ];
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = radius * (0.85 + Math.random() * 0.3);
    const s = Math.sqrt(1 - u * u);
    pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
    col.set(palette[(Math.random() * palette.length) | 0], i * 3);
    size[i] = Math.random() < 0.97 ? 0.6 + Math.random() * 1.3 : 2 + Math.random() * 1.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute vec3 aColor;
      attribute float aSize;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        float tw = 0.75 + 0.25 * sin(uTime * (0.6 + fract(position.x * 0.013) * 1.8) + position.y);
        vAlpha = tw;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        if (r > 0.5) discard;
        gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.1, r));
      }
    `,
  });
  const stars = new THREE.Points(geo, material);
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  return stars;
}
