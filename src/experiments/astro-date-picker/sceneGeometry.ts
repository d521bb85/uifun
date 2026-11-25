import * as THREE from "three";
import { galacticToEclipticDirection } from "./astronomy";
import { seededRandom, TWO_PI } from "./sceneMath";
import {
  galacticGuideFragmentShader,
  galacticGuideVertexShader,
  galacticStreamVertexShader,
  lunarGuideFragmentShader,
  lunarGuideVertexShader,
  orbitGuideFragmentShader,
  orbitGuideVertexShader,
  starfieldFragmentShader,
  starfieldVertexShader,
} from "./shaders";
import { BRIGHT_STARS, bvToRgb } from "./starCatalog";

export const EARTH_ORBIT_RADIUS = 6.2;
export const MEAN_LUNAR_DISTANCE_KM = 384400;
export const MOON_PHYSICAL_RADIUS = 0.2725;
export const HERO_MOON_ORBIT_RADIUS = 3.2;
export const CAROUSEL_MOON_ORBIT_RADIUS = 1.75;
export const CAROUSEL_EARTH_SCALE = 1.0;
export const J2000_OBLIQUITY_RAD = THREE.MathUtils.degToRad(23.43929111);

export const UP_AXIS = new THREE.Vector3(0, 1, 0);
export const DAY_MOON_BASE_RADIUS = 0.5;
export const DAY_MOON_POS = new THREE.Vector3(-0.06, 2.38, -3.6);
export const DAY_CAM_LOCAL_POS = new THREE.Vector3(0.0, 1.28, 4.6);
export const DAY_CAM_LOCAL_TARGET = new THREE.Vector3(0.0, 1.18, -4.0);
export const DAY_MOON_DIR = DAY_MOON_POS.clone().sub(DAY_CAM_LOCAL_POS).normalize();
export const DAY_GUIDE_HALF_SPAN = 4.2;
export const DAY_GUIDE_DAY_SPACING = 0.215;

// Constant-speed coastal tidal drift: gentle ramp-up/down with steady cruise velocity
export const TIDE_DRIFT_SPEED = 0.16;
export const TIDE_DRIFT_ACCEL = 0.7;
export const TIDE_ARRIVAL_BAND = 0.035;

// Constant-speed lunar orbital catch-up relative to Earth (co-orbiting the Sun with Earth)
export const MOON_ORBIT_DRIFT_SPEED = 0.72;
export const MOON_ORBIT_DRIFT_ACCEL = 2.4;
export const MOON_ORBIT_ARRIVAL_BAND = 0.24;

export interface EarthCameraRig {
  radial: number;
  tangent: number;
  height: number;
  targetWeight: number;
  targetY: number;
}

// Hero (idle) framing: Earth fills the left corner (~1/3 of the card) with static Sun upper-right
// and the Moon orbiting honestly across its true 360° geocentric ecliptic path.
export const HERO_RIG: EarthCameraRig = {
  radial: 1.12,
  tangent: 2.29,
  height: 0.8,
  targetWeight: 0.67,
  targetY: 0.02,
};

// Orbital Carousel (month) framing: three-quarter sunlit angle on Earth (~30% lit disc) with
// static Sun anchored upper-right while Earth stays locked in frame as the orbit advances.
export const CAROUSEL_RIG: EarthCameraRig = {
  radial: 2.5,
  tangent: 4.9,
  height: 3.1,
  targetWeight: 0.65,
  targetY: -0.22,
};

export interface SceneResourceCollector {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

export function getCappedPixelRatio(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(window.devicePixelRatio || 1, 2);
}

export function createHipparcosStarfield(
  initialMoonIllum: number,
  collector: SceneResourceCollector,
) {
  const bgCount = 3200;
  const total = BRIGHT_STARS.length + bgCount;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const phases = new Float32Array(total);

  const radius = 165;
  const cosE = Math.cos(J2000_OBLIQUITY_RAD);
  const sinE = Math.sin(J2000_OBLIQUITY_RAD);
  let idx = 0;

  for (const star of BRIGHT_STARS) {
    const ra = (star.raHours / 24) * TWO_PI;
    const dec = THREE.MathUtils.degToRad(star.decDeg);
    const cosDec = Math.cos(dec);

    // J2000 equatorial -> ecliptic world frame via R_x(-ε) so constellations align with the ecliptic
    const xEq = cosDec * Math.cos(ra);
    const yEq = Math.sin(dec);
    const zEq = -cosDec * Math.sin(ra);

    positions[idx * 3] = radius * xEq;
    positions[idx * 3 + 1] = radius * (yEq * cosE + zEq * sinE);
    positions[idx * 3 + 2] = radius * (-yEq * sinE + zEq * cosE);

    const [r, g, b] = bvToRgb(star.bv);
    const brightness = THREE.MathUtils.clamp(1.3 - (star.mag + 1.5) * 0.13, 0.55, 1.45);
    colors[idx * 3] = r * brightness;
    colors[idx * 3 + 1] = g * brightness;
    colors[idx * 3 + 2] = b * brightness;
    sizes[idx] = THREE.MathUtils.clamp(4.2 - star.mag * 0.55, 1.9, 5.2);
    phases[idx] = idx * 0.73;
    idx += 1;
  }

  const rand = seededRandom(20261124);
  for (let i = 0; i < bgCount; i += 1) {
    const u = rand() * 2 - 1;
    const inBand = rand() < 0.45;
    const lat = inBand ? (rand() - 0.5 + (rand() - 0.5)) * 0.34 : Math.asin(u);
    const lon = rand() * TWO_PI;

    // Exact IAU J2000 Galactic -> Ecliptic transform so Milky Way band aligns with Hipparcos stars
    const [ex, ey, ez] = galacticToEclipticDirection(lon, lat);
    positions[idx * 3] = radius * ex;
    positions[idx * 3 + 1] = radius * ey;
    positions[idx * 3 + 2] = radius * ez;

    const bv = -0.15 + rand() * 1.45;
    const [r, g, b] = bvToRgb(bv);
    const magPower = rand() ** 2.6;
    const dim = 0.32 + magPower * 0.78;
    colors[idx * 3] = r * dim;
    colors[idx * 3 + 1] = g * dim;
    colors[idx * 3 + 2] = b * dim;
    sizes[idx] = 1.15 + magPower * 2.35;
    phases[idx] = rand() * TWO_PI;
    idx += 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  collector.geometries.push(geometry);

  const uniforms = {
    uPixelRatio: { value: getCappedPixelRatio() },
    uTime: { value: 0 },
    uSizeScale: { value: 1 },
    uOpacity: { value: 0.96 },
    uHorizonClip: { value: 0 },
    uMoonDir: { value: DAY_MOON_DIR.clone() },
    uMoonIllum: { value: initialMoonIllum },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: starfieldVertexShader,
    fragmentShader: starfieldFragmentShader,
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  collector.materials.push(material);

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return { points, uniforms };
}

export function createGalacticRibbon(collector: SceneResourceCollector) {
  const group = new THREE.Group();
  const count = 1400;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const rand = seededRandom(88421);

  for (let i = 0; i < count; i += 1) {
    const along = (rand() - 0.5) * 46;
    const spread = (rand() - 0.5) * (rand() - 0.5) * 18;
    const thickness = (rand() - 0.5) * (rand() - 0.5) * 6.5;

    // Store local offsets; galacticStreamVertexShader wraps along X seamlessly
    positions[i * 3] = along;
    positions[i * 3 + 1] = thickness;
    positions[i * 3 + 2] = -6.5 + spread;

    const warmCore = Math.exp(-((along + 3) * (along + 3)) / 140);
    const tint = rand();
    const r = THREE.MathUtils.lerp(0.68, 1.0, warmCore * 0.65 + tint * 0.35);
    const g = THREE.MathUtils.lerp(0.76, 0.88, warmCore * 0.5 + tint * 0.3);
    const b = THREE.MathUtils.lerp(0.98, 0.72, warmCore * 0.6);

    const intensity = 0.25 + rand() * 0.65;
    colors[i * 3] = r * intensity;
    colors[i * 3 + 1] = g * intensity;
    colors[i * 3 + 2] = b * intensity;
    sizes[i] = rand() < 0.08 ? 4.5 + rand() * 3.5 : 1.0 + rand() * 2.1;
    phases[i] = rand() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  collector.geometries.push(geometry);

  const uniforms = {
    uPixelRatio: { value: getCappedPixelRatio() },
    uTime: { value: 0 },
    uSizeScale: { value: 1.15 },
    uOpacity: { value: 0 },
    uDrift: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: galacticStreamVertexShader,
    fragmentShader: starfieldFragmentShader,
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  collector.materials.push(material);

  const points = new THREE.Points(geometry, material);
  // Vertex shader wraps positions dynamically along X and slopes Y; disable static bounding-sphere culling
  points.frustumCulled = false;
  group.add(points);
  return { group, uniforms };
}

export function createOrbitGuide(initialOrbitAngle: number, collector: SceneResourceCollector) {
  const segments = 256;
  const halfW = 0.14 / EARTH_ORBIT_RADIUS;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * TWO_PI;
    const cosA = Math.cos(angle);
    const sinA = -Math.sin(angle);
    const innerR = 1 - halfW;
    const outerR = 1 + halfW;

    const v0 = i * 2;
    const v1 = v0 + 1;
    positions[v0 * 3] = cosA * innerR;
    positions[v0 * 3 + 1] = 0;
    positions[v0 * 3 + 2] = sinA * innerR;

    positions[v1 * 3] = cosA * outerR;
    positions[v1 * 3 + 1] = 0;
    positions[v1 * 3 + 2] = sinA * outerR;

    uvs[v0 * 2] = angle;
    uvs[v0 * 2 + 1] = 0;
    uvs[v1 * 2] = angle;
    uvs[v1 * 2 + 1] = 1;

    if (i < segments) {
      const next0 = v0 + 2;
      const next1 = v0 + 3;
      indices.push(v0, v1, next0, v1, next1, next0);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  collector.geometries.push(geometry);

  const uniforms = {
    uOpacity: { value: 0 },
    uEarthAngle: { value: initialOrbitAngle },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: orbitGuideVertexShader,
    fragmentShader: orbitGuideFragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    side: THREE.DoubleSide,
  });
  collector.materials.push(material);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 6;
  mesh.visible = false;
  return { mesh, uniforms };
}

export function createGalacticGuide(collector: SceneResourceCollector) {
  const segments = 160;
  const spanHalf = 5.4;
  const halfW = 0.11;
  const slope = 0.48 / 1.45;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= segments; i += 1) {
    const s = -spanHalf + (i / segments) * spanHalf * 2;
    const cx = s;
    const cy = s * slope - 0.012 * s * s;
    const cz = -0.055 * s * s;

    const tx = 1;
    const ty = slope - 0.024 * s;
    const sideLen = Math.hypot(ty, tx) || 1;
    const sx = (ty / sideLen) * halfW;
    const sy = (-tx / sideLen) * halfW;

    const v0 = i * 2;
    const v1 = v0 + 1;
    positions[v0 * 3] = cx - sx;
    positions[v0 * 3 + 1] = cy - sy;
    positions[v0 * 3 + 2] = cz;

    positions[v1 * 3] = cx + sx;
    positions[v1 * 3 + 1] = cy + sy;
    positions[v1 * 3 + 2] = cz;

    uvs[v0 * 2] = s;
    uvs[v0 * 2 + 1] = 0;
    uvs[v1 * 2] = s;
    uvs[v1 * 2 + 1] = 1;

    if (i < segments) {
      const next0 = v0 + 2;
      const next1 = v0 + 3;
      indices.push(v0, v1, next0, v1, next1, next0);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  collector.geometries.push(geometry);

  const uniforms = {
    uOpacity: { value: 0 },
    uDrift: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: galacticGuideVertexShader,
    fragmentShader: galacticGuideFragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  collector.materials.push(material);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 6;
  mesh.visible = false;
  return { mesh, uniforms };
}

export function createLunarGuide(initialSynodicAge: number, collector: SceneResourceCollector) {
  const segments = 160;
  const halfSpan = DAY_GUIDE_HALF_SPAN;
  const halfW = 0.088;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= segments; i += 1) {
    const s = -halfSpan + (i / segments) * halfSpan * 2;
    // Subtle ecliptic arc passing horizontally through the Moon's center
    const cx = s;
    const cy = -0.0085 * s * s;
    const cz = 0;

    const tx = 1;
    const ty = -0.017 * s;
    const sideLen = Math.hypot(ty, tx) || 1;
    const sx = (ty / sideLen) * halfW;
    const sy = (-tx / sideLen) * halfW;

    const v0 = i * 2;
    const v1 = v0 + 1;
    positions[v0 * 3] = cx - sx;
    positions[v0 * 3 + 1] = cy - sy;
    positions[v0 * 3 + 2] = cz;

    positions[v1 * 3] = cx + sx;
    positions[v1 * 3 + 1] = cy + sy;
    positions[v1 * 3 + 2] = cz;

    uvs[v0 * 2] = s;
    uvs[v0 * 2 + 1] = 0;
    uvs[v1 * 2] = s;
    uvs[v1 * 2 + 1] = 1;

    if (i < segments) {
      const next0 = v0 + 2;
      const next1 = v0 + 3;
      indices.push(v0, v1, next0, v1, next1, next0);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  collector.geometries.push(geometry);

  const uniforms = {
    uOpacity: { value: 0 },
    uSynodicAge: { value: initialSynodicAge },
    uMoonClearInner: { value: DAY_MOON_BASE_RADIUS * 1.16 },
    uMoonClearOuter: { value: DAY_MOON_BASE_RADIUS * 1.56 },
    uHalfSpan: { value: halfSpan },
    uDaySpacing: { value: DAY_GUIDE_DAY_SPACING },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: lunarGuideVertexShader,
    fragmentShader: lunarGuideFragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  collector.materials.push(material);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(DAY_MOON_POS);
  mesh.renderOrder = 6;
  mesh.visible = false;
  return { mesh, uniforms };
}

export function createCoastalGeometry(collector: SceneResourceCollector) {
  // Non-uniform coastal mesh concentrating vertex density in the foreground swash & surf zone
  // while extending cleanly out to the distant oceanic horizon (z = -115) and back to z = +5.8
  // so elevated atmospheric descent/ascent glides never reveal a near or side mesh edge.
  const segX = 180;
  const segZ = 168;
  const cols = segX + 1;
  const rows = segZ + 1;
  const positions = new Float32Array(cols * rows * 3);
  const indices: number[] = [];

  for (let iz = 0; iz <= segZ; iz += 1) {
    const tz = iz / segZ;
    // Smooth non-linear depth stretch: very dense near z in [+5.8, -16], wide toward horizon
    const z = 5.8 - 120.8 * tz ** 2.35;
    // Horizontal span expands proportionally with perspective depth so full FOV is always covered
    const depthFromCam = Math.max(2.0, DAY_CAM_LOCAL_POS.z - z);
    const halfWidth = Math.max(8.5, depthFromCam * 0.78);

    for (let ix = 0; ix <= segX; ix += 1) {
      const tx = (ix / segX) * 2 - 1;
      // Slightly denser X resolution near the center & diagonal shoreline
      const shapedTx = Math.sign(tx) * (Math.abs(tx) * 0.58 + Math.abs(tx) ** 1.65 * 0.42);
      const x = shapedTx * halfWidth;

      const idx = (iz * cols + ix) * 3;
      positions[idx] = x;
      positions[idx + 1] = 0;
      positions[idx + 2] = z;
    }
  }

  for (let iz = 0; iz < segZ; iz += 1) {
    for (let ix = 0; ix < segX; ix += 1) {
      const a = iz * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Front face (+Y upward normal): (b - a) x (c - a) = (+X) x (-Z) = +Y
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  // Generous bounding sphere since vertex shader displaces surface height dynamically
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -50), 140);
  collector.geometries.push(geometry);
  return geometry;
}
