import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TilesRenderer } from '3d-tiles-renderer';
import { CesiumIonAuthPlugin, ImageOverlayPlugin, CesiumIonOverlay, ReorientationPlugin, TilesFadePlugin } from '3d-tiles-renderer/plugins';

// ---------- config ----------
// Public token, restricted in Cesium ion to https://nyxtaku.github.io and localhost:3000.
const ION_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjlzdnZhd2dMaTNlb1pTOTAiLCJqdGkiOiIyYjRhOWU2ZS00NGQ5LTRjMDEtYTNmOC02MDMyZGU0MzNmMGMiLCJpZCI6NTU4MjkxLCJzdWIiOiJuWXhUYWt1IiwiaXNzIjoiaHR0cHM6Ly9hcGkuY2VzaXVtLmNvbSIsImF1ZCI6Im1lcmlkaWFuLXdlYiIsImlhdCI6MTc5NTgwNDY0N30.ZLaXM5_Men1LzUSh_RMqdTr04Thd6FHdj4VbynXeN4E';
const TERRAIN_ASSET = '1';   // Cesium World Terrain
const IMAGERY_ASSET = '2';   // Bing Maps Aerial
const START = { lat: 37.925, lon: 23.600, heading: 330 }; // off Piraeus, bow toward Psyttaleia and the Salamis strait
const DEG = Math.PI / 180;
const EARTH_R = 6371000;
const LAND_H = 0.8;          // terrain this far above sea level counts as land

// ---------- renderer / scene ----------
const canvas = document.getElementById('c');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true }); }
catch (e) { document.getElementById('err').style.display = 'flex'; throw e; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 150000);

const SUN_DIR = new THREE.Vector3(0.35, 0.32, -0.88).normalize();
const C = { zenith: new THREE.Color('#4F86BA'), horizon: new THREE.Color('#C6D9E4'), deep: new THREE.Color('#0A3346'), crest: new THREE.Color('#2A8C8C') };
const FOG_DENSITY = 1 / 24000;
scene.fog = new THREE.FogExp2(C.horizon.getHex(), FOG_DENSITY);
scene.add(new THREE.HemisphereLight(0xdfeaf2, 0x3d5560, 1.15));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.copy(SUN_DIR).multiplyScalar(200);
scene.add(sun);

const statusEl = document.getElementById('status');
const setStatus = (txt) => { if (txt) { statusEl.textContent = txt; statusEl.classList.remove('hide'); } else statusEl.classList.add('hide'); };

// ---------- ships ----------
const SHIPS = [
  { id: 'fishing',   name: 'Fishing boat',   file: 'fishing_boat.glb',   scale: 1.0, lift: 0.9, maxSpeed: 10.0, accel: 0.60, turn: 0.42,  resp: 3.2, heel: 0.12, zoom: 24,  pitch: 0.26,
    stats: { speed: 5, turning: 5, stability: 2 }, blurb: 'Small and quick. Turns sharply, rides every wave.' },
  { id: 'freighter', name: 'Freighter',      file: 'freighter.glb',      scale: 3.0, lift: 0.5, maxSpeed: 7.5,  accel: 0.20, turn: 0.15,  resp: 1.5, heel: 0.05, zoom: 72,  pitch: 0.32,
    stats: { speed: 3, turning: 3, stability: 4 }, blurb: 'Mid-size cargo vessel. Steady, with a wider turn.' },
  { id: 'container', name: 'Container ship', file: 'container_ship.glb', scale: 7.0, lift: 0.6, maxSpeed: 6.5,  accel: 0.13, turn: 0.075, resp: 0.9, heel: 0.02, zoom: 140, pitch: 0.38,
    stats: { speed: 2, turning: 1, stability: 5 }, blurb: 'Large and heavy. Slow to speed up and to turn.' },
];

// ---------- waves (shared by GPU and CPU) ----------
const WAVE_DEF = [[0.30, 60, 0.18], [1.10, 31, 0.14], [-0.60, 18, 0.12], [2.20, 9, 0.10], [-1.80, 5, 0.08]];
const WAVES = WAVE_DEF.map(([ang, L, s]) => ({ dx: Math.cos(ang), dz: Math.sin(ang), L, s, k: 2 * Math.PI / L, c: Math.sqrt(9.8 / (2 * Math.PI / L)) }));
let seaScale = 0.75;
const waveOff = new THREE.Vector2(); // keeps the wave pattern continuous when the world recentres
const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const _d = { x: 0, y: 0, z: 0 };
function dispAt(x, z, t, out) {
  let ox = 0, oy = 0, oz = 0;
  const dist = Math.hypot(camera.position.x - x, camera.position.z - z);
  const px = x + waveOff.x, pz = z + waveOff.y;
  for (const w of WAVES) {
    const st = w.s * seaScale * (1 - smoothstep(w.L * 4, w.L * 14, dist));
    const f = w.k * (w.dx * px + w.dz * pz - w.c * t);
    const a = st / w.k, cf = Math.cos(f);
    ox += w.dx * a * cf; oy += a * Math.sin(f); oz += w.dz * a * cf;
  }
  out.x = ox; out.y = oy; out.z = oz; return out;
}
function heightAt(x, z, t) {
  let px = x, pz = z;
  for (let i = 0; i < 3; i++) { dispAt(px, pz, t, _d); px = x - _d.x; pz = z - _d.z; }
  return dispAt(px, pz, t, _d).y;
}
const totalAmp = () => WAVES.reduce((s, w) => s + (w.s * seaScale) / w.k, 0);

// ---------- ocean: dense near the camera, out to ~40 km, curved with the Earth ----------
const SEG = 512, OA = 16.4, OB = 7.805; // f(u) = a(e^(b|u|) - 1) -> 0.5 m spacing at the centre, 40 km at the edge
const oceanGeo = new THREE.PlaneGeometry(2, 2, SEG, SEG);
oceanGeo.rotateX(-Math.PI / 2);
{ const p = oceanGeo.attributes.position; const f = u => Math.sign(u) * OA * (Math.exp(OB * Math.abs(u)) - 1);
  for (let i = 0; i < p.count; i++) { p.setX(i, f(p.getX(i))); p.setZ(i, f(p.getZ(i))); } }
oceanGeo.computeBoundingSphere();
const oceanMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 }, uScale: { value: seaScale }, uOff: { value: waveOff },
    uWaves: { value: WAVES.map(w => new THREE.Vector4(w.dx, w.dz, w.s, w.L)) },
    uSunDir: { value: SUN_DIR }, uDeep: { value: C.deep }, uCrest: { value: C.crest },
    uZenith: { value: C.zenith }, uHorizon: { value: C.horizon }, uFogColor: { value: C.horizon },
    uFogDensity: { value: FOG_DENSITY }, uFoamH: { value: 1 },
  },
  vertexShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    uniform float uTime; uniform float uScale; uniform vec2 uOff; uniform vec4 uWaves[5];
    varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
    void main() {
      vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
      float dist = length(cameraPosition.xz - p.xz);
      vec3 disp = vec3(0.0); vec3 t = vec3(1.0, 0.0, 0.0); vec3 b = vec3(0.0, 0.0, 1.0);
      vec2 q = p.xz + uOff;
      for (int i = 0; i < 5; i++) {
        vec4 w = uWaves[i];
        float L = w.w;
        float steep = w.z * uScale * (1.0 - smoothstep(L * 4.0, L * 14.0, dist));
        float k = 6.2831853 / L;
        float c = sqrt(9.8 / k);
        vec2 d = normalize(w.xy);
        float f = k * (dot(d, q) - c * uTime);
        float a = steep / k;
        float sf = sin(f); float cf = cos(f);
        disp += vec3(d.x * a * cf, a * sf, d.y * a * cf);
        t += vec3(-d.x * d.x * steep * sf, d.x * steep * cf, -d.x * d.y * steep * sf);
        b += vec3(-d.x * d.y * steep * sf, d.y * steep * cf, -d.y * d.y * steep * sf);
      }
      vec3 wp = p + disp;
      wp.y -= dot(p.xz, p.xz) / (2.0 * ${EARTH_R.toFixed(1)}); // Earth curvature, matches the terrain
      vNormal = normalize(cross(b, t));
      vWorld = wp; vCrest = disp.y;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform vec3 uSunDir; uniform vec3 uDeep; uniform vec3 uCrest; uniform vec3 uZenith; uniform vec3 uHorizon;
    uniform vec3 uFogColor; uniform float uFogDensity; uniform float uFoamH;
    varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
    void main() {
      #include <logdepthbuf_fragment>
      vec3 n = normalize(vNormal);
      vec3 v = normalize(cameraPosition - vWorld);
      float ndv = max(dot(n, v), 0.0);
      float fres = 0.02 + 0.55 * pow(1.0 - ndv, 4.0);
      vec3 r = reflect(-v, n);
      float ry = clamp(r.y, 0.0, 1.0);
      vec3 sky = mix(uHorizon, uZenith, pow(ry, 0.5)) * 0.82;
      float crestMix = clamp(vCrest / (uFoamH * 2.0) + 0.5, 0.0, 1.0);
      vec3 water = mix(uDeep, uCrest, crestMix * crestMix);
      float sss = pow(max(dot(v, -uSunDir), 0.0), 4.0) * crestMix;
      water += uCrest * sss * 0.5;
      vec3 col = mix(water, sky, fres);
      float spec = pow(max(dot(r, uSunDir), 0.0), 600.0);
      col += vec3(1.0, 0.92, 0.8) * spec * 6.0;
      float foam = smoothstep(uFoamH * 0.75, uFoamH * 1.3, vCrest);
      col = mix(col, vec3(0.80, 0.86, 0.87), foam * 0.45);
      float d = length(cameraPosition - vWorld);
      float fog = 1.0 - exp(-pow(d * uFogDensity, 2.0));
      col = mix(col, uFogColor, fog);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const ocean = new THREE.Mesh(oceanGeo, oceanMat);
ocean.frustumCulled = false;
scene.add(ocean);

// ---------- sky ----------
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false,
  uniforms: { uZenith: { value: C.zenith }, uHorizon: { value: C.horizon }, uSunDir: { value: SUN_DIR } },
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      vec3 col = mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.45));
      float s = max(dot(d, uSunDir), 0.0);
      col += vec3(1.0, 0.9, 0.72) * (pow(s, 900.0) * 18.0 + pow(s, 12.0) * 0.28);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(100000, 32, 16), skyMat);
sky.renderOrder = -1; sky.frustumCulled = false;
scene.add(sky);

// ---------- real-world terrain ----------
let seaHeight = 36;            // ellipsoid height of the local sea surface, refined by calibrate()
let originLat = START.lat * DEG, originLon = START.lon * DEG;
const tiles = new TilesRenderer();
tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: ION_TOKEN, assetId: TERRAIN_ASSET, autoRefreshToken: true }));
tiles.registerPlugin(new ImageOverlayPlugin({ renderer, overlays: [new CesiumIonOverlay({ apiToken: ION_TOKEN, assetId: IMAGERY_ASSET, autoRefreshToken: true })] }));
const reorient = new ReorientationPlugin({ lat: originLat, lon: originLon, height: seaHeight, recenter: true });
tiles.registerPlugin(reorient);
tiles.registerPlugin(new TilesFadePlugin());
const TERRAIN_ERROR = 10;  // higher = coarser terrain, fewer tiles to load
tiles.errorTarget = TERRAIN_ERROR;
tiles.loadSiblings = false;
tiles.maxTilesProcessed = 120;
tiles.setCamera(camera);
scene.add(tiles.group);
let terrainLoaded = false, terrainError = false;
tiles.addEventListener('load-model', (e) => { terrainLoaded = true; styleDirty = true; });
tiles.addEventListener('load-error', (e) => {
  console.warn('Terrain load error', e);
  if (!terrainLoaded && !terrainError) { terrainError = true; setStatus('TERRAIN COULD NOT LOAD — CHECK THE CESIUM TOKEN'); }
});

// Stylized look: satellite colours snapped to a small palette, flat-shaded facets,
// and Cesium's flat sea surface pushed under the animated ocean.
const hexToVec = h => { const c = new THREE.Color(); c.setHex(parseInt(h.slice(1), 16), THREE.SRGBColorSpace); const s = c.clone().convertLinearToSRGB(); return new THREE.Vector3(s.r, s.g, s.b); };
const PALETTE = [ // [typical imagery colour (sRGB), stylized output]
  ['#3B4630', '#4F6E3F'], // dark forest
  ['#6E7150', '#7C8A55'], // olive scrub
  ['#A39274', '#CDB98F'], // dry soil, fields
  ['#C8BEA6', '#D2C29C'], // limestone, sand
  ['#8A867E', '#938C7E'], // bare rock
  ['#D6D2CA', '#E0DACD'], // white town
  ['#A2654F', '#C47A5E'], // terracotta roofs
  ['#3A3936', '#5E5A52'], // shadow, asphalt
  ['#2A4656', '#3E7F8C'], // inland water
];
const styleUniforms = {
  uStyleSrc: { value: PALETTE.map(p => hexToVec(p[0])) },
  uStyleDst: { value: PALETTE.map(p => new THREE.Color(p[1])) },
  uSandC: { value: new THREE.Color('#E2D6B8') }, uGrassC: { value: new THREE.Color('#5F7D4A') }, uRockC: { value: new THREE.Color('#9A958A') },
};
const STYLED = Symbol('styled');
function injectStyle(shader) {
  if (shader.fragmentShader.includes('/*STYLIZED*/')) return;
  Object.assign(shader.uniforms, styleUniforms);
  shader.vertexShader = shader.vertexShader
    .replace(/void main\(\s*\)\s*{/, m => 'varying float vStyleY;\n' + m)
    .replace('#include <project_vertex>', /* glsl */`
      vec4 styWp = modelMatrix * vec4( transformed, 1.0 );
      float styH = styWp.y + dot( styWp.xz, styWp.xz ) / ( 2.0 * ${EARTH_R.toFixed(1)} );
      float styDrop = ( 1.0 - smoothstep( 0.3, 1.6, styH ) ) * 14.0;
      styWp.y -= styDrop;
      vStyleY = styH;
      vec4 mvPosition = viewMatrix * styWp;
      gl_Position = projectionMatrix * mvPosition;`);
  shader.fragmentShader = shader.fragmentShader
    .replace(/void main\(\s*\)\s*{/, m => 'uniform vec3 uStyleSrc[9]; uniform vec3 uStyleDst[9]; uniform vec3 uSandC; uniform vec3 uGrassC; uniform vec3 uRockC; varying float vStyleY;\n' + m)
    .replace('#include <alphamap_fragment>', /* glsl */`/*STYLIZED*/
      {
        #ifdef LAYER_COUNT
          #if LAYER_COUNT > 0
            #define STY_IMAGERY
          #endif
        #endif
        #ifdef STY_IMAGERY
          vec3 sc = pow( max( diffuseColor.rgb, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) );
          float best = 1e9; vec3 outc = sc;
          for ( int i = 0; i < 9; i ++ ) { vec3 dd = sc - uStyleSrc[ i ]; float e = dot( dd, dd ); if ( e < best ) { best = e; outc = uStyleDst[ i ]; } }
          diffuseColor.rgb = outc;
        #else
          diffuseColor.rgb = vStyleY < 3.0 ? uSandC : ( vStyleY < 320.0 ? uGrassC : uRockC );
        #endif
        if ( vStyleY < 1.8 ) diffuseColor.rgb = mix( diffuseColor.rgb, uSandC, 0.6 );
      }
      #include <alphamap_fragment>`);
}
function styleMaterial(mat) {
  if (mat[STYLED] && mat[STYLED] === mat.onBeforeCompile) return;
  const prev = mat.onBeforeCompile;
  const fn = function (shader, r) { if (prev) prev.call(this, shader, r); injectStyle(shader); };
  mat.onBeforeCompile = fn; mat[STYLED] = fn;
  mat.flatShading = true;
  if ('roughness' in mat) { mat.roughness = 1; mat.metalness = 0; }
  mat.defines = { ...(mat.defines || {}), STYLIZED: 1 };
  mat.needsUpdate = true;
}
let styleTimer = 0, styleDirty = true;
function styleTerrain() {
  styleDirty = false;
  tiles.group.traverse(o => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(styleMaterial); });
}

// terrain queries: height above sea level under (x, z), or null if not loaded
const ray = new THREE.Raycaster(); ray.firstHitOnly = true; ray.far = 20000;
const DOWN = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3();
function terrainAt(x, z) {
  ray.set(_o.set(x, 8000, z), DOWN);
  const hit = ray.intersectObject(tiles.group, true)[0];
  return hit ? hit.point.y + (x * x + z * z) / (2 * EARTH_R) : null;
}
const _inv = new THREE.Matrix4(), _ecef = new THREE.Vector3(), cart = {};
function latLonAt(x, z) {
  _ecef.set(x, 0, z).applyMatrix4(_inv.copy(tiles.group.matrixWorld).invert());
  tiles.ellipsoid.getPositionToCartographic(_ecef, cart);
  return { lat: cart.lat, lon: cart.lon };
}

// ---------- wake ----------
const WAKE_N = 260;
const foamTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const wakeGeo = new THREE.PlaneGeometry(1, 1); wakeGeo.rotateX(-Math.PI / 2);
const wakeMesh = new THREE.InstancedMesh(wakeGeo, new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), WAKE_N);
wakeMesh.frustumCulled = false;
const wake = Array.from({ length: WAKE_N }, () => ({ x: 0, z: 0, vx: 0, vz: 0, age: 99, life: 1, s0: 1, grow: 1, power: 0 }));
let wakeIdx = 0, wakeTimer = 0;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
for (let i = 0; i < WAKE_N; i++) { wakeMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); wakeMesh.setColorAt(i, _c.setRGB(0, 0, 0)); }
scene.add(wakeMesh);
function spawnWake(x, z, vx, vz, s0, grow, life, power) {
  const w = wake[wakeIdx]; wakeIdx = (wakeIdx + 1) % WAKE_N;
  Object.assign(w, { x, z, vx, vz, s0, grow, life, power, age: 0 });
}

// ---------- state ----------
const THROTTLE = [-0.25, 0, 0.35, 0.65, 1.0];
const TIME_STEPS = [1, 5, 20, 50];
let timeIdx = 0, timeScale = 1;
// world frame: +Z north, -X east, +Y up. Heading H -> yaw = -H.
const ship = { x: 0, z: 0, yaw: -START.heading * DEG, v: 0, level: 1, rudder: 0, y: 0, pitch: 0, roll: 0 };
let def = null, shipObj = null, L = 8, W = 4;
const input = { left: false, right: false };
let playing = false;
const shipRoot = new THREE.Group(); scene.add(shipRoot);

// ---------- ship models ----------
const loader = new GLTFLoader();
const MODEL_DIR = new URL('../assets/models/', import.meta.url).href;
const loadGLB = f => new Promise((res, rej) => loader.load(MODEL_DIR + f, g => res(g.scene), undefined, rej));
async function loadShips() {
  const shipScenes = await Promise.all(SHIPS.map(s => loadGLB(s.file)));
  SHIPS.forEach((s, i) => {
    const g = new THREE.Group(); const m = shipScenes[i]; m.scale.setScalar(s.scale);
    m.position.y = s.lift * s.scale;
    g.add(m);
    const box = new THREE.Box3().setFromObject(g); const size = box.getSize(new THREE.Vector3());
    s.obj = g; s.L = size.z; s.W = size.x; s.H = size.y;
  });
  makeCards();
}

// ---------- ship select ----------
const cardsEl = document.getElementById('cards');
function thumbnail(s) {
  const tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  tr.setSize(480, 300); tr.outputColorSpace = THREE.SRGBColorSpace;
  const ts = new THREE.Scene();
  ts.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.0));
  const dl = new THREE.DirectionalLight(0xffffff, 2.0); dl.position.set(4, 6, 5); ts.add(dl);
  const o = s.obj.clone(); ts.add(o);
  const box = new THREE.Box3().setFromObject(o); const c = box.getCenter(new THREE.Vector3()); const r = box.getSize(new THREE.Vector3()).length() / 2;
  const tc = new THREE.PerspectiveCamera(30, 480 / 300, 0.1, 5000);
  tc.position.set(c.x + r * 2.1, c.y + r * 1.0, c.z + r * 2.4); tc.lookAt(c);
  tr.render(ts, tc);
  const url = tr.domElement.toDataURL('image/png');
  tr.dispose(); tr.forceContextLoss();
  return url;
}
const dots = n => '<span class="dots">' + [1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('') + '</span>';
function makeCards() {
  cardsEl.innerHTML = '';
  SHIPS.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'card';
    b.innerHTML = `<img alt="${s.name}" src="${thumbnail(s)}">
      <div class="num disp">0${i + 1}</div>
      <h3 class="disp">${s.name.toUpperCase()}</h3>
      <div class="meta">${Math.round(s.L)} m long · top speed ${(s.maxSpeed * 1.94384).toFixed(0)} kn<br>${s.blurb}</div>
      <div class="stat"><span class="lbl">SPEED</span>${dots(s.stats.speed)}</div>
      <div class="stat"><span class="lbl">TURNING</span>${dots(s.stats.turning)}</div>
      <div class="stat"><span class="lbl">STABILITY</span>${dots(s.stats.stability)}</div>
      <div class="go disp">SAIL — ${i + 1}</div>`;
    b.addEventListener('click', () => chooseShip(i));
    cardsEl.appendChild(b);
  });
  document.getElementById('loading').style.display = 'none';
}
function chooseShip(i) {
  def = SHIPS[i];
  if (shipObj) shipRoot.remove(shipObj);
  shipObj = def.obj; shipRoot.add(shipObj);
  L = def.L; W = def.W;
  ship.v = 0; ship.level = 1; ship.rudder = 0; updateTele();
  cam.zoom = def.zoom; cam.orbitYaw = 0; cam.orbitPitch = 0;
  document.getElementById('shipName').textContent = def.name;
  document.getElementById('select').classList.remove('show'); document.body.classList.remove('choosing');
  playing = true; window.focus();
}
function openSelect() { document.body.classList.add('choosing'); playing = false; input.left = input.right = false; document.getElementById('select').classList.add('show'); }
document.getElementById('changeShip').addEventListener('click', openSelect);
const about = document.getElementById('about');
document.getElementById('aboutBtn').addEventListener('click', () => about.classList.add('show'));
document.getElementById('aboutClose').addEventListener('click', () => about.classList.remove('show'));

// ---------- camera control ----------
const cam = { orbitYaw: 0, orbitPitch: 0, zoom: 40, dragging: false, lastX: 0, lastY: 0, idle: 0, spin: 0 };
canvas.addEventListener('pointerdown', e => { cam.dragging = true; cam.lastX = e.clientX; cam.lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!cam.dragging) return;
  cam.orbitYaw -= (e.clientX - cam.lastX) * 0.006;
  cam.orbitPitch = Math.min(Math.max(cam.orbitPitch + (e.clientY - cam.lastY) * 0.004, -0.22), 1.2);
  cam.lastX = e.clientX; cam.lastY = e.clientY; cam.idle = 0;
});
canvas.addEventListener('pointerup', () => { cam.dragging = false; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const base = def ? def.zoom : 40;
  cam.zoom = Math.min(Math.max(cam.zoom * (1 + e.deltaY * 0.001), base * 0.45), base * 12);
}, { passive: false });

// ---------- input ----------
const tele = document.getElementById('tele').children;
function updateTele() { for (let i = 0; i < tele.length; i++) tele[i].classList.toggle('on', i === ship.level); }
function throttle(d) { if (!playing) return; ship.level = Math.min(Math.max(ship.level + d, 0), 4); updateTele(); }
const timeEl = document.getElementById('time').children;
function setTime(i) { timeIdx = (i + TIME_STEPS.length) % TIME_STEPS.length; timeScale = TIME_STEPS[timeIdx]; for (let j = 0; j < timeEl.length; j++) timeEl[j].classList.toggle('on', j === timeIdx); }
for (let j = 0; j < timeEl.length; j++) timeEl[j].addEventListener('click', () => setTime(j));
function resetShip() { recenterTo(START.lat * DEG, START.lon * DEG); Object.assign(ship, { x: 0, z: 0, yaw: -START.heading * DEG, v: 0, level: 1, rudder: 0 }); spawnChecked = false; updateTele(); }
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (!playing) { if (['1', '2', '3'].includes(k) && SHIPS[0].obj) chooseShip(+k - 1); return; }
  if (k === 'a' || k === 'arrowleft') input.left = true;
  if (k === 'd' || k === 'arrowright') input.right = true;
  if (e.repeat) return;
  if (k === 'w' || k === 'arrowup') throttle(1);
  if (k === 's' || k === 'arrowdown') throttle(-1);
  if (k === 'c') { cam.orbitYaw = 0; cam.orbitPitch = 0; cam.zoom = def.zoom; }
  if (k === 'r') resetShip();
  if (k === 't') setTime(timeIdx + 1);
});
window.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k === 'a' || k === 'arrowleft') input.left = false;
  if (k === 'd' || k === 'arrowright') input.right = false;
});
const hold = (id, on, off) => { const b = document.getElementById(id); b.addEventListener('pointerdown', e => { e.preventDefault(); on(); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, off)); };
hold('tL', () => { if (playing) input.left = true; }, () => input.left = false);
hold('tR', () => { if (playing) input.right = true; }, () => input.right = false);
hold('tU', () => throttle(1), () => {});
hold('tD', () => throttle(-1), () => {});

const sea = document.getElementById('sea'), seaLbl = document.getElementById('seaLbl');
function setSea() {
  const v = +sea.value / 100;
  seaScale = 0.3 + 1.1 * v;
  oceanMat.uniforms.uScale.value = seaScale;
  oceanMat.uniforms.uFoamH.value = totalAmp() * 0.55;
  seaLbl.textContent = v < 0.25 ? 'CALM' : v < 0.6 ? 'MODERATE' : v < 0.85 ? 'ROUGH' : 'VERY ROUGH';
}
sea.addEventListener('input', setSea); setSea();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  tiles.setResolutionFromRenderer(camera, renderer);
}
window.addEventListener('resize', resize); resize();

// ---------- floating origin + sea level ----------
function recenterTo(lat, lon) {
  originLat = lat; originLon = lon;
  reorient.transformLatLonHeightToOrigin(lat, lon, seaHeight);
}
function recenterOnShip() {
  const ll = latLonAt(ship.x, ship.z);
  const dx = ship.x, dz = ship.z;
  recenterTo(ll.lat, ll.lon);
  ship.x = 0; ship.z = 0;
  camera.position.x -= dx; camera.position.z -= dz;
  for (const w of wake) { w.x -= dx; w.z -= dz; }
  waveOff.x += dx; waveOff.y += dz;
  calibrated = false; calibTimer = 0; camGround = null;
}
// Cesium heights are ellipsoidal; its sea surface sits at the local geoid height.
// Sample flat open water around the ship and move the world so that surface is y = 0.
let calibrated = false, calibTimer = 0;
function calibrate() {
  const pts = [[0, 0], [400, 0], [-400, 0], [0, 400], [0, -400], [280, 280], [-280, -280]];
  const hs = pts.map(([x, z]) => terrainAt(ship.x + x, ship.z + z)).filter(h => h !== null);
  if (hs.length < 5) return false;
  hs.sort((a, b) => a - b);
  const lo = hs[0], mid = hs[Math.floor(hs.length / 2)];
  // the sea is the lowest flat surface; accept when most samples agree within 1.5 m
  const flat = hs.filter(h => Math.abs(h - lo) < 1.5);
  if (flat.length < 4) return false;
  const off = flat.reduce((s, h) => s + h, 0) / flat.length;
  if (Math.abs(off) > 0.15) { seaHeight += off; reorient.transformLatLonHeightToOrigin(originLat, originLon, seaHeight); }
  return true;
}
// If the start point turns out to be on land, find the nearest open water.
let spawnChecked = false;
function checkSpawn() {
  const h0 = terrainAt(ship.x, ship.z);
  if (h0 === null) return false;
  if (h0 < LAND_H) return true;
  for (let r = 100; r <= 4000; r += 100) {
    for (let a = 0; a < 24; a++) {
      const x = ship.x + Math.cos(a / 24 * Math.PI * 2) * r, z = ship.z + Math.sin(a / 24 * Math.PI * 2) * r;
      const h = terrainAt(x, z);
      if (h !== null && h < -0.5) { ship.x = x; ship.z = z; return true; }
    }
  }
  return true;
}

// ---------- loop ----------
const spd = document.getElementById('spd'), hdg = document.getElementById('hdg'), rud = document.getElementById('rud'), posEl = document.getElementById('pos'), warnEl = document.getElementById('warn');
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const clock = new THREE.Clock();
const ease = (k, dt) => 1 - Math.exp(-k * dt);
const desired = new THREE.Vector3();
let t = 0, hudTimer = 0, landAhead = false, probeTimer = 0, camGroundTimer = 0, camGround = null;
camera.position.set(0, 20, -40);

function step() {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;

  // terrain housekeeping
  if (tiles.errorTarget !== TERRAIN_ERROR) tiles.errorTarget = TERRAIN_ERROR; // the terrain plugin resets this on load
  styleTimer += dt; if (styleDirty || styleTimer > 1.5) { styleTimer = 0; styleTerrain(); }
  if (terrainLoaded && !calibrated) { calibTimer += dt; if (calibTimer > 1.5) { calibTimer = 0; calibrated = calibrate(); } }
  if (terrainLoaded && calibrated && !spawnChecked) spawnChecked = checkSpawn();
  if (terrainLoaded && calibrated && spawnChecked && !terrainError) setStatus(null);
  else if (!terrainError) setStatus(terrainLoaded ? 'FINDING SEA LEVEL…' : 'LOADING TERRAIN…');

  if (def) {
    // helm
    const rTarget = playing ? (input.left ? 1 : 0) - (input.right ? 1 : 0) : 0;
    ship.rudder += (rTarget - ship.rudder) * ease(3, dt);
    const target = THROTTLE[ship.level] * def.maxSpeed;
    ship.v += (target - ship.v) * ease(def.accel * (target === 0 ? 0.6 : 1), dt);
    const steer = Math.min(Math.abs(ship.v) / (def.maxSpeed * 0.3), 1) * Math.sign(ship.v);
    ship.yaw += ship.rudder * def.turn * steer * dt * timeScale;
    const fx0 = Math.sin(ship.yaw), fz0 = Math.cos(ship.yaw);
    const cy = Math.cos(ship.yaw), sy = Math.sin(ship.yaw);

    // land check: probe ahead of the bow (or behind the stern when going astern)
    probeTimer += dt;
    if (probeTimer > 0.12) {
      probeTimer = 0; landAhead = false;
      if (terrainLoaded && calibrated && Math.abs(ship.v) > 0.05) {
        const dir = Math.sign(ship.v), reach = (L * 0.5 + 4 + Math.abs(ship.v) * (1.5 + 0.25 * timeScale)) * dir;
        for (const [lx, lz] of [[0, reach], [W * 0.45, reach * 0.8], [-W * 0.45, reach * 0.8]]) {
          const h = terrainAt(ship.x + lx * cy + lz * sy, ship.z - lx * sy + lz * cy);
          if (h !== null && h > LAND_H) { landAhead = true; break; }
        }
      }
    }
    if (landAhead) { ship.v *= 1 - ease(4, dt); if (Math.abs(ship.v) < 0.15) ship.v = 0; }
    ship.x += fx0 * ship.v * dt * timeScale; ship.z += fz0 * ship.v * dt * timeScale;

    // float: bow, stern, port, starboard
    const at = (lx, lz) => heightAt(ship.x + lx * cy + lz * sy, ship.z - lx * sy + lz * cy, t);
    const hl = L * 0.42, hw = W * 0.45;
    const hBow = at(0, hl), hStern = at(0, -hl), hPort = at(hw, 0), hStbd = at(-hw, 0);
    const yT = (hBow + hStern + hPort + hStbd) / 4;
    const pitchT = Math.atan2(hBow - hStern, hl * 2);
    const rollT = Math.atan2(hPort - hStbd, hw * 2) - ship.rudder * (ship.v / def.maxSpeed) * def.heel;
    ship.y += (yT - ship.y) * ease(def.resp * 1.3, dt);
    ship.pitch += (pitchT - ship.pitch) * ease(def.resp, dt);
    ship.roll += (rollT - ship.roll) * ease(def.resp * 0.8, dt);
    shipRoot.position.set(ship.x, ship.y, ship.z);
    shipRoot.rotation.set(-ship.pitch, ship.yaw, ship.roll, 'YXZ');

    // wake
    const sp = Math.abs(ship.v), pw = Math.min(sp / (def.maxSpeed * 0.6), 1);
    wakeTimer += dt;
    if (sp > def.maxSpeed * 0.06 && wakeTimer > 0.09 - 0.05 * pw) {
      wakeTimer = 0;
      const lat = (Math.random() - 0.5) * W * 0.25;
      spawnWake(ship.x - fx0 * L * 0.48 + lat * cy, ship.z - fz0 * L * 0.48 - lat * sy, 0, 0, W * 0.55, W * 1.6, 7 + Math.random() * 2, pw);
      for (const side of [1, -1]) {
        const lx = side * W * 0.5, lz = L * 0.25, out = (0.6 + sp * 0.12) * side;
        spawnWake(ship.x + lx * cy + lz * sy, ship.z - lx * sy + lz * cy, out * cy, -out * sy, W * 0.25, W * 0.9, 5 + Math.random() * 1.5, pw * 0.8);
      }
    }
    if (Math.hypot(ship.x, ship.z) > 3000) recenterOnShip();
  }
  for (let i = 0; i < WAKE_N; i++) {
    const w = wake[i];
    if (w.age > w.life) continue;
    w.age += dt; w.x += w.vx * dt; w.z += w.vz * dt; w.vx *= 1 - ease(0.4, dt); w.vz *= 1 - ease(0.4, dt);
    const k = Math.min(w.age / w.life, 1), s = w.s0 + k * w.grow;
    _p.set(w.x, dispAt(w.x, w.z, t, _d).y + 0.15, w.z); _s.set(s, 1, s);
    wakeMesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    const b = (1 - k) * (1 - k) * 0.075 * w.power;
    wakeMesh.setColorAt(i, _c.setRGB(b, b, b));
  }
  wakeMesh.instanceMatrix.needsUpdate = true;
  if (wakeMesh.instanceColor) wakeMesh.instanceColor.needsUpdate = true;

  // camera: chase while playing, slow orbit on the select screen
  if (!playing) cam.spin += dt * 0.12;
  if (!cam.dragging && playing) { cam.idle += dt; if (cam.idle > 2.5 && Math.abs(ship.v) > 1) { cam.orbitYaw *= 1 - ease(0.8, dt); cam.orbitPitch *= 1 - ease(0.8, dt); } }
  const z = def ? cam.zoom : 40, lookH = def ? Math.max(2, def.H * 0.35) : 2;
  const cYaw = ship.yaw + Math.PI + cam.orbitYaw + (playing ? 0 : cam.spin + 0.9);
  const cPitch = (def ? def.pitch : 0.3) + cam.orbitPitch;
  desired.set(ship.x + Math.sin(cYaw) * Math.cos(cPitch) * z, ship.y + lookH + Math.sin(cPitch) * z, ship.z + Math.cos(cYaw) * Math.cos(cPitch) * z);
  camera.position.lerp(desired, cam.dragging ? 0.35 : ease(3, dt));
  let floor = heightAt(camera.position.x, camera.position.z, t) + 1.5;
  camGroundTimer += dt;
  if (terrainLoaded && camGroundTimer > 0.2) { camGroundTimer = 0; camGround = terrainAt(camera.position.x, camera.position.z); }
  if (camGround !== null) floor = Math.max(floor, camGround + 5);
  if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(ship.x, ship.y + lookH, ship.z);
  camera.updateMatrixWorld();

  ocean.position.set(Math.round(camera.position.x / 8) * 8, 0, Math.round(camera.position.z / 8) * 8);
  sky.position.copy(camera.position);
  oceanMat.uniforms.uTime.value = t;
  tiles.update();

  // HUD
  const fx = Math.sin(ship.yaw), fz = Math.cos(ship.yaw);
  spd.textContent = (ship.v * 1.94384).toFixed(1) + ' kn';
  const deg = (Math.atan2(-fx, fz) * 180 / Math.PI + 360) % 360;
  hdg.textContent = String(Math.round(deg) % 360).padStart(3, '0') + '° ' + DIRS[Math.round(deg / 45) % 8];
  rud.style.left = (50 - ship.rudder * 45) + '%';
  warnEl.classList.toggle('show', landAhead && playing);
  hudTimer += dt;
  if (hudTimer > 0.5 && tiles.root) {
    hudTimer = 0;
    const ll = latLonAt(ship.x, ship.z);
    const la = ll.lat / DEG, lo = ll.lon / DEG;
    posEl.textContent = `${Math.abs(la).toFixed(3)}° ${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(3)}° ${lo >= 0 ? 'E' : 'W'}`;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(step);
}
requestAnimationFrame(step);

loadShips().catch(e => { document.getElementById('loading').textContent = 'COULD NOT LOAD THE SHIP MODELS. RELOAD TO TRY AGAIN.'; console.error(e); });

// debug handle for inspecting the live page
window.__meridian = { tiles, ship, camera, scene, terrainAt, get seaHeight() { return seaHeight; }, get calibrated() { return calibrated; }, get terrainLoaded() { return terrainLoaded; }, get spawnChecked() { return spawnChecked; } };
