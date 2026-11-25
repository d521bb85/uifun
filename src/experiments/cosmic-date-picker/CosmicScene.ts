import * as THREE from "three";
import {
  addDateSegment,
  type CosmicState,
  computeCosmicState,
  computeSolarState,
  daysInMonth,
  toJulianDay,
} from "./astronomy";
import {
  atmosphereFragmentShader,
  atmosphereVertexShader,
  cloudsFragmentShader,
  cloudsVertexShader,
  earthFragmentShader,
  earthVertexShader,
  galacticStreamVertexShader,
  moonFragmentShader,
  moonVertexShader,
  oceanFragmentShader,
  oceanVertexShader,
  orbitMarkerFragmentShader,
  orbitMarkerVertexShader,
  orbitRadialFragmentShader,
  orbitRadialVertexShader,
  orbitRingFragmentShader,
  orbitRingVertexShader,
  skyboxFragmentShader,
  skyboxVertexShader,
  starfieldFragmentShader,
  starfieldVertexShader,
  sunCoronaFragmentShader,
  sunCoronaVertexShader,
  sunFragmentShader,
  sunVertexShader,
} from "./shaders";
import { BRIGHT_STARS, bvToRgb } from "./starCatalog";

export type CosmicFocusMode = "idle" | "year" | "month" | "day";

const TEXTURE_BASE = "/textures/cosmic";
const EARTH_ORBIT_RADIUS = 6.2;
const MEAN_LUNAR_DISTANCE_KM = 384400;
const MOON_PHYSICAL_RADIUS = 0.2725;
const HERO_MOON_ORBIT_RADIUS = 3.2;
const ORRERY_MOON_ORBIT_RADIUS = 1.48;
const ORRERY_EARTH_SCALE = 0.74;
const ORRERY_ELEVATION_RAD = THREE.MathUtils.degToRad(21);
const ORRERY_DISTANCE = 17.8;
const ORRERY_TARGET_Y = -0.26;
const J2000_OBLIQUITY_RAD = THREE.MathUtils.degToRad(23.43929111);
const TWO_PI = Math.PI * 2;
const SEASONAL_MONTHS = new Set([3, 6, 9, 12]);

// Hero (idle) framing: Earth fills the left corner (~1/3 of the card) with static Sun framed upper-right
// and the Moon orbiting honestly across its true 360° geocentric ecliptic path.
const HERO_RIG = {
  radial: 1.12,
  tangent: 2.29,
  height: 0.8,
  targetWeight: 0.67,
  targetY: 0.02,
};

function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let diff = ((target - current + Math.PI) % TWO_PI) - Math.PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

function unwrapAngleNear(angle: number, reference: number): number {
  let diff = ((angle - reference + Math.PI) % TWO_PI) - Math.PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return reference + diff;
}

function shortestAngleDelta(from: number, to: number): number {
  let diff = ((to - from + Math.PI) % TWO_PI) - Math.PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return diff;
}

function positiveAngleDelta(from: number, to: number): number {
  const diff = (((to - from) % TWO_PI) + TWO_PI) % TWO_PI;
  return diff === 0 ? TWO_PI : diff;
}

function negativeAngleDelta(from: number, to: number): number {
  const diff = (((to - from) % TWO_PI) + TWO_PI) % TWO_PI;
  return diff === 0 ? -TWO_PI : diff - TWO_PI;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export class CosmicSceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;

  private readonly skyGroup: THREE.Group;
  private readonly skyUniforms: {
    uSkyMap: { value: THREE.Texture };
    uBrightness: { value: number };
    uGamma: { value: number };
    uGalacticReveal: { value: number };
  };
  private readonly starUniforms: {
    uPixelRatio: { value: number };
    uTime: { value: number };
    uSizeScale: { value: number };
    uOpacity: { value: number };
  };

  private readonly galacticDustGroup: THREE.Group;
  private readonly galacticDustUniforms: {
    uPixelRatio: { value: number };
    uTime: { value: number };
    uSizeScale: { value: number };
    uOpacity: { value: number };
    uDrift: { value: number };
  };

  private readonly sunGroup: THREE.Group;
  private readonly sunUniforms: {
    uSunMap: { value: THREE.Texture };
    uTime: { value: number };
    uOpacity: { value: number };
  };
  private readonly sunCoronaUniforms: {
    uOpacity: { value: number };
    uTime: { value: number };
  };
  private readonly sunCoronaMesh: THREE.Mesh;

  private readonly orreryGroup: THREE.Group;
  private readonly orbitRibbonUniforms: {
    uEarthAngle: { value: number };
    uOpacity: { value: number };
  };
  private readonly orbitMarkerUniforms: {
    uPixelRatio: { value: number };
    uActiveMonth: { value: number };
    uOpacity: { value: number };
  };
  private readonly orbitMarkerPositions: Float32Array;
  private readonly orbitMarkerGeo: THREE.BufferGeometry;
  private readonly orbitTickPositions: Float32Array;
  private readonly orbitTickGeo: THREE.BufferGeometry;
  private readonly orbitTickMaterial: THREE.LineBasicMaterial;
  private readonly orbitRadialPositions: Float32Array;
  private readonly orbitRadialGeo: THREE.BufferGeometry;
  private readonly orbitRadialUniforms: {
    uOpacity: { value: number };
  };
  private orreryMarkerKey = "";

  private readonly earthOrbitRoot: THREE.Group;
  private readonly earthAxisGroup: THREE.Group;
  private readonly earthSpinGroup: THREE.Group;
  private readonly earthUniforms: {
    uDayMap: { value: THREE.Texture };
    uNightMap: { value: THREE.Texture };
    uCloudMap: { value: THREE.Texture };
    uSpecularMap: { value: THREE.Texture };
    uNormalMap: { value: THREE.Texture };
    uSunDir: { value: THREE.Vector3 };
    uCloudOffset: { value: number };
    uOpacity: { value: number };
  };
  private readonly cloudsUniforms: {
    uCloudMap: { value: THREE.Texture };
    uSunDir: { value: THREE.Vector3 };
    uCloudOffset: { value: number };
    uOpacity: { value: number };
  };
  private readonly atmosphereUniforms: {
    uSunDir: { value: THREE.Vector3 };
    uOpacity: { value: number };
  };

  private readonly orbitalMoonGroup: THREE.Group;
  private readonly orbitalMoonMesh: THREE.Mesh;
  private readonly orbitalMoonUniforms: {
    uMoonMap: { value: THREE.Texture };
    uSunDir: { value: THREE.Vector3 };
    uEarthshine: { value: number };
    uOpacity: { value: number };
  };

  private readonly dayStageGroup: THREE.Group;
  private readonly moonMesh: THREE.Mesh;
  private readonly moonUniforms: {
    uMoonMap: { value: THREE.Texture };
    uSunDir: { value: THREE.Vector3 };
    uEarthshine: { value: number };
    uOpacity: { value: number };
  };
  private readonly oceanMesh: THREE.Mesh;
  private readonly oceanUniforms: {
    uTime: { value: number };
    uWaterLevel: { value: number };
    uSwellEnergy: { value: number };
    uMoonDir: { value: THREE.Vector3 };
    uMoonIllumination: { value: number };
    uOpacity: { value: number };
  };

  private readonly textures: THREE.Texture[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private cosmicState: CosmicState;
  private mode: CosmicFocusMode = "idle";
  private active = true;
  private reducedMotion = false;
  private disposed = false;
  private rafId: number | null = null;
  private lastTime = 0;
  private elapsed = 0;

  private readonly camPos = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly heroCamPos = new THREE.Vector3();
  private readonly heroCamTarget = new THREE.Vector3();
  private readonly worldCamPos = new THREE.Vector3();
  private readonly worldCamTarget = new THREE.Vector3();
  private readonly desiredWorldPos = new THREE.Vector3();
  private readonly desiredWorldTarget = new THREE.Vector3();
  private readonly tmpSunDir = new THREE.Vector3();

  private targetOrbitAngle: number;
  private smoothOrbitAngle: number;
  private smoothOrbitVel = 0;
  private camOrbitLag = 0;
  private monthDragging = false;
  private dragMonthFraction = 0;
  private nextMonthIso = "";
  private prevMonthIso = "";
  private nextOrbitDelta = TWO_PI / 12;
  private prevOrbitDelta = -TWO_PI / 12;
  private nextSpinDelta = TWO_PI + TWO_PI / 12;
  private prevSpinDelta = -(TWO_PI + TWO_PI / 12);
  private nextOrbitRadius = EARTH_ORBIT_RADIUS;
  private prevOrbitRadius = EARTH_ORBIT_RADIUS;
  private nextMoonLonDelta = TWO_PI;
  private prevMoonLonDelta = -TWO_PI;
  private nextMoonLat = 0;
  private prevMoonLat = 0;
  private smoothOrbitRadius: number;
  private targetSpinAngle: number;
  private smoothSpinAngle: number;
  private targetMoonLon: number;
  private smoothMoonLon: number;
  private smoothMoonLat: number;
  private smoothMoonOrbitRadius: number;
  private smoothEarthScale = 1;
  private smoothMoonElong: number;
  private smoothMoonIllum: number;
  private smoothMoonScale: number;
  private smoothWaterLevel: number;
  private smoothSwellEnergy: number;
  private smoothEpochYears: number;
  private smoothPrecession: number;

  private heroRigBlend = 1;

  private wEarth = 1;
  private wOrbitalMoon = 1;
  private wSun = 1;
  private wOrrery = 0;
  private wMoon = 0;
  private wOcean = 0;
  private wGalactic = 0;
  private smoothSkyBright = 0.48;
  private smoothSkyGamma = 0.84;
  private smoothSkyReveal = 0.16;

  private constructor(canvas: HTMLCanvasElement, initialState: CosmicState) {
    this.cosmicState = initialState;
    this.targetOrbitAngle = initialState.solar.earthHeliocentricLongitudeRad;
    this.smoothOrbitAngle = initialState.solar.earthHeliocentricLongitudeRad;
    this.smoothOrbitRadius = EARTH_ORBIT_RADIUS * initialState.solar.earthSunDistanceAU;
    this.targetSpinAngle = initialState.solar.gmstRad;
    this.smoothSpinAngle = initialState.solar.gmstRad;
    this.targetMoonLon = initialState.lunar.longitudeRad;
    this.smoothMoonLon = initialState.lunar.longitudeRad;
    this.smoothMoonLat = initialState.lunar.latitudeRad;
    this.smoothMoonOrbitRadius =
      HERO_MOON_ORBIT_RADIUS * (initialState.lunar.distanceKm / MEAN_LUNAR_DISTANCE_KM);
    this.smoothMoonElong = initialState.lunar.elongationRad;
    this.smoothMoonIllum = initialState.lunar.illumination;
    this.smoothMoonScale = initialState.lunar.apparentScale;
    this.smoothWaterLevel = initialState.tidal.waterLevel;
    this.smoothSwellEnergy = initialState.tidal.swellEnergy;
    this.smoothEpochYears = initialState.galactic.epochYearsSinceJ2000;
    this.smoothPrecession = initialState.galactic.axialPrecessionRad;
    this.updateMonthNeighbors();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x02040a, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 460 / 290, 0.05, 400);

    const loader = new THREE.TextureLoader();
    const loadTex = (file: string, srgb = true) => {
      const tex = loader.load(`${TEXTURE_BASE}/${file}`, () => {
        if (!this.disposed) this.renderSingleFrame();
      });
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.textures.push(tex);
      return tex;
    };

    const earthDayMap = loadTex("earth_day.jpg", true);
    const earthNightMap = loadTex("earth_night.jpg", true);
    const earthCloudsMap = loadTex("earth_clouds.jpg", false);
    const earthSpecMap = loadTex("earth_specular.jpg", false);
    const earthNormalMap = loadTex("earth_normal.jpg", false);
    const moonAlbedoMap = loadTex("moon_albedo.jpg", true);
    const milkyWayMap = loadTex("milky_way.jpg", true);
    const sunSurfaceMap = loadTex("sun_surface.jpg", true);

    this.skyGroup = new THREE.Group();
    const skyGeo = new THREE.SphereGeometry(180, 48, 32);
    this.geometries.push(skyGeo);
    this.skyUniforms = {
      uSkyMap: { value: milkyWayMap },
      uBrightness: { value: this.smoothSkyBright },
      uGamma: { value: this.smoothSkyGamma },
      uGalacticReveal: { value: this.smoothSkyReveal },
    };
    const skyMaterial = new THREE.ShaderMaterial({
      vertexShader: skyboxVertexShader,
      fragmentShader: skyboxFragmentShader,
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.materials.push(skyMaterial);
    const skyMesh = new THREE.Mesh(skyGeo, skyMaterial);
    // Place ESO galactic bulge directly across the diagonal Orion Spur plane in Year view
    skyMesh.rotation.order = "ZYX";
    skyMesh.rotation.set(0.04, Math.PI * 0.5, 0.33);
    this.skyGroup.add(skyMesh);

    const {
      geometry: starGeo,
      material: starMat,
      uniforms: starUniforms,
    } = this.createHipparcosStarfield();
    this.starUniforms = starUniforms;
    this.skyGroup.add(new THREE.Points(starGeo, starMat));
    this.scene.add(this.skyGroup);

    const { group: galGroup, uniforms: galUniforms } = this.createGalacticRibbon();
    this.galacticDustGroup = galGroup;
    this.galacticDustUniforms = galUniforms;
    this.scene.add(this.galacticDustGroup);

    this.sunGroup = new THREE.Group();
    const sunGeo = new THREE.SphereGeometry(0.72, 48, 48);
    this.geometries.push(sunGeo);
    this.sunUniforms = {
      uSunMap: { value: sunSurfaceMap },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    };
    const sunMaterial = new THREE.ShaderMaterial({
      vertexShader: sunVertexShader,
      fragmentShader: sunFragmentShader,
      uniforms: this.sunUniforms,
      transparent: true,
    });
    this.materials.push(sunMaterial);
    this.sunGroup.add(new THREE.Mesh(sunGeo, sunMaterial));

    const coronaGeo = new THREE.PlaneGeometry(7.8, 7.8);
    this.geometries.push(coronaGeo);
    this.sunCoronaUniforms = {
      uOpacity: { value: 1 },
      uTime: { value: 0 },
    };
    const sunCoronaMaterial = new THREE.ShaderMaterial({
      vertexShader: sunCoronaVertexShader,
      fragmentShader: sunCoronaFragmentShader,
      uniforms: this.sunCoronaUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(sunCoronaMaterial);
    this.sunCoronaMesh = new THREE.Mesh(coronaGeo, sunCoronaMaterial);
    this.sunGroup.add(this.sunCoronaMesh);
    this.sunGroup.scale.setScalar(0.56);
    this.scene.add(this.sunGroup);

    const orrery = this.createOrreryGroup();
    this.orreryGroup = orrery.group;
    this.orbitRibbonUniforms = orrery.ribbonUniforms;
    this.orbitMarkerUniforms = orrery.markerUniforms;
    this.orbitMarkerPositions = orrery.markerPositions;
    this.orbitMarkerGeo = orrery.markerGeo;
    this.orbitTickPositions = orrery.tickPositions;
    this.orbitTickGeo = orrery.tickGeo;
    this.orbitTickMaterial = orrery.tickMaterial;
    this.orbitRadialPositions = orrery.radialPositions;
    this.orbitRadialGeo = orrery.radialGeo;
    this.orbitRadialUniforms = orrery.radialUniforms;
    this.scene.add(this.orreryGroup);
    this.updateOrreryMonthMarkers(initialState.date.year, initialState.date.day);

    this.earthOrbitRoot = new THREE.Group();
    this.earthAxisGroup = new THREE.Group();
    this.earthSpinGroup = new THREE.Group();
    // Tilt Earth's North Pole toward -Z (Summer Solstice Sun direction at λ_sun = 90°)
    this.earthAxisGroup.rotation.set(-initialState.solar.obliquityRad, 0, 0);

    const earthGeo = new THREE.SphereGeometry(1, 72, 72);
    this.geometries.push(earthGeo);
    this.earthUniforms = {
      uDayMap: { value: earthDayMap },
      uNightMap: { value: earthNightMap },
      uCloudMap: { value: earthCloudsMap },
      uSpecularMap: { value: earthSpecMap },
      uNormalMap: { value: earthNormalMap },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uCloudOffset: { value: 0 },
      uOpacity: { value: 1 },
    };
    const earthMaterial = new THREE.ShaderMaterial({
      vertexShader: earthVertexShader,
      fragmentShader: earthFragmentShader,
      uniforms: this.earthUniforms,
      transparent: true,
    });
    this.materials.push(earthMaterial);
    this.earthSpinGroup.add(new THREE.Mesh(earthGeo, earthMaterial));

    const cloudsGeo = new THREE.SphereGeometry(1.01, 64, 64);
    this.geometries.push(cloudsGeo);
    this.cloudsUniforms = {
      uCloudMap: { value: earthCloudsMap },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uCloudOffset: { value: 0 },
      uOpacity: { value: 1 },
    };
    const cloudsMaterial = new THREE.ShaderMaterial({
      vertexShader: cloudsVertexShader,
      fragmentShader: cloudsFragmentShader,
      uniforms: this.cloudsUniforms,
      transparent: true,
      depthWrite: false,
    });
    this.materials.push(cloudsMaterial);
    this.earthSpinGroup.add(new THREE.Mesh(cloudsGeo, cloudsMaterial));

    const atmoGeo = new THREE.SphereGeometry(1.062, 64, 64);
    this.geometries.push(atmoGeo);
    this.atmosphereUniforms = {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uOpacity: { value: 1 },
    };
    const atmosphereMaterial = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      uniforms: this.atmosphereUniforms,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(atmosphereMaterial);
    this.earthAxisGroup.add(new THREE.Mesh(atmoGeo, atmosphereMaterial));

    this.earthAxisGroup.add(this.earthSpinGroup);
    this.earthOrbitRoot.add(this.earthAxisGroup);

    // Honest 360° geocentric Moon orbiting Earth in ecliptic coordinates
    this.orbitalMoonGroup = new THREE.Group();
    const orbitalMoonGeo = new THREE.SphereGeometry(MOON_PHYSICAL_RADIUS, 48, 48);
    this.geometries.push(orbitalMoonGeo);
    this.orbitalMoonUniforms = {
      uMoonMap: { value: moonAlbedoMap },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uEarthshine: { value: initialState.lunar.earthshine },
      uOpacity: { value: 1 },
    };
    const orbitalMoonMaterial = new THREE.ShaderMaterial({
      vertexShader: moonVertexShader,
      fragmentShader: moonFragmentShader,
      uniforms: this.orbitalMoonUniforms,
      transparent: true,
    });
    this.materials.push(orbitalMoonMaterial);
    this.orbitalMoonMesh = new THREE.Mesh(orbitalMoonGeo, orbitalMoonMaterial);
    this.orbitalMoonMesh.rotation.order = "YXZ";
    this.orbitalMoonGroup.add(this.orbitalMoonMesh);
    this.earthOrbitRoot.add(this.orbitalMoonGroup);

    this.scene.add(this.earthOrbitRoot);

    this.dayStageGroup = new THREE.Group();
    this.dayStageGroup.position.set(0, -18, 0);

    const moonGeo = new THREE.SphereGeometry(0.5, 72, 72);
    this.geometries.push(moonGeo);
    this.moonUniforms = {
      uMoonMap: { value: moonAlbedoMap },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uEarthshine: { value: initialState.lunar.earthshine },
      uOpacity: { value: 0 },
    };
    const moonMaterial = new THREE.ShaderMaterial({
      vertexShader: moonVertexShader,
      fragmentShader: moonFragmentShader,
      uniforms: this.moonUniforms,
      transparent: true,
    });
    this.materials.push(moonMaterial);
    this.moonMesh = new THREE.Mesh(moonGeo, moonMaterial);
    this.moonMesh.position.set(-0.24, 0.66, 0);
    // Orient lunar near-side facing the observer
    this.moonMesh.rotation.y = -Math.PI * 0.5;
    this.dayStageGroup.add(this.moonMesh);

    const oceanGeo = new THREE.PlaneGeometry(24, 24, 112, 112);
    oceanGeo.rotateX(-Math.PI * 0.5);
    this.geometries.push(oceanGeo);
    this.oceanUniforms = {
      uTime: { value: 0 },
      uWaterLevel: { value: initialState.tidal.waterLevel },
      uSwellEnergy: { value: initialState.tidal.swellEnergy },
      uMoonDir: { value: new THREE.Vector3(-0.08, 0.34, -0.94).normalize() },
      uMoonIllumination: { value: initialState.lunar.illumination },
      uOpacity: { value: 0 },
    };
    const oceanMaterial = new THREE.ShaderMaterial({
      vertexShader: oceanVertexShader,
      fragmentShader: oceanFragmentShader,
      uniforms: this.oceanUniforms,
      transparent: true,
      depthWrite: false,
    });
    this.materials.push(oceanMaterial);
    this.oceanMesh = new THREE.Mesh(oceanGeo, oceanMaterial);
    this.oceanMesh.position.set(0, -0.82, -6.2);
    this.dayStageGroup.add(this.oceanMesh);

    this.scene.add(this.dayStageGroup);

    this.updateOrbitTransform(0);
    this.computeHeroRigCamera(this.heroCamPos, this.heroCamTarget);
    this.computeWorldCameraGoal("month", this.worldCamPos, this.worldCamTarget);
    this.camPos.copy(this.heroCamPos);
    this.camTarget.copy(this.heroCamTarget);
    this.applyUniforms();
  }

  static create(canvas: HTMLCanvasElement, initialState: CosmicState): CosmicSceneRenderer | null {
    try {
      return new CosmicSceneRenderer(canvas, initialState);
    } catch {
      return null;
    }
  }

  private createOrreryGroup() {
    const group = new THREE.Group();

    // 1. Anti-aliased elliptical orbital ribbon sampled along Earth's real eccentric orbit
    const segs = 160;
    const halfWidth = 0.11;
    const positions = new Float32Array((segs + 1) * 2 * 3);
    const angles = new Float32Array((segs + 1) * 2);
    const radials = new Float32Array((segs + 1) * 2);
    const indices: number[] = [];

    const jdBase = toJulianDay(2026, 1, 1, 12);
    for (let i = 0; i <= segs; i += 1) {
      const solar = computeSolarState(jdBase + (i / segs) * 365.25636);
      const angle = solar.earthHeliocentricLongitudeRad;
      const radius = EARTH_ORBIT_RADIUS * solar.earthSunDistanceAU;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const innerR = radius - halfWidth;
      const outerR = radius + halfWidth;

      const vInner = i * 2;
      const vOuter = vInner + 1;

      positions[vInner * 3] = cosA * innerR;
      positions[vInner * 3 + 1] = 0;
      positions[vInner * 3 + 2] = -sinA * innerR;
      angles[vInner] = angle;
      radials[vInner] = -1;

      positions[vOuter * 3] = cosA * outerR;
      positions[vOuter * 3 + 1] = 0;
      positions[vOuter * 3 + 2] = -sinA * outerR;
      angles[vOuter] = angle;
      radials[vOuter] = 1;

      if (i < segs) {
        const nextInner = (i + 1) * 2;
        const nextOuter = nextInner + 1;
        indices.push(vInner, vOuter, nextInner, vOuter, nextOuter, nextInner);
      }
    }

    const ribbonGeo = new THREE.BufferGeometry();
    ribbonGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    ribbonGeo.setAttribute("aAngle", new THREE.BufferAttribute(angles, 1));
    ribbonGeo.setAttribute("aRadial", new THREE.BufferAttribute(radials, 1));
    ribbonGeo.setIndex(indices);
    this.geometries.push(ribbonGeo);

    const ribbonUniforms = {
      uEarthAngle: { value: this.smoothOrbitAngle },
      uOpacity: { value: 0 },
    };
    const ribbonMaterial = new THREE.ShaderMaterial({
      vertexShader: orbitRingVertexShader,
      fragmentShader: orbitRingFragmentShader,
      uniforms: ribbonUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(ribbonMaterial);

    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMaterial);
    ribbonMesh.renderOrder = -1;
    group.add(ribbonMesh);

    // 2. 12 radial graduation ticks (equinox/solstice months subtly longer)
    const tickPositions = new Float32Array(12 * 2 * 3);
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute("position", new THREE.BufferAttribute(tickPositions, 3));
    this.geometries.push(tickGeo);

    const tickMaterial = new THREE.LineBasicMaterial({
      color: 0x8eb8f0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(tickMaterial);
    group.add(new THREE.LineSegments(tickGeo, tickMaterial));

    // 3. 12 luminous month markers positioned at each month's exact heliocentric longitude
    const markerPositions = new Float32Array(12 * 3);
    const monthIndices = new Float32Array(12);
    const seasonFlags = new Float32Array(12);
    for (let m = 1; m <= 12; m += 1) {
      monthIndices[m - 1] = m;
      seasonFlags[m - 1] = SEASONAL_MONTHS.has(m) ? 1 : 0;
    }

    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute("position", new THREE.BufferAttribute(markerPositions, 3));
    markerGeo.setAttribute("aMonthIndex", new THREE.BufferAttribute(monthIndices, 1));
    markerGeo.setAttribute("aSeasonal", new THREE.BufferAttribute(seasonFlags, 1));
    this.geometries.push(markerGeo);

    const markerUniforms = {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uActiveMonth: { value: this.cosmicState.date.month },
      uOpacity: { value: 0 },
    };
    const markerMaterial = new THREE.ShaderMaterial({
      vertexShader: orbitMarkerVertexShader,
      fragmentShader: orbitMarkerFragmentShader,
      uniforms: markerUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(markerMaterial);
    group.add(new THREE.Points(markerGeo, markerMaterial));

    // 4. Subtle Sun-to-Earth heliocentric radius guide
    const radialPositions = new Float32Array(2 * 3);
    const radialAlong = new Float32Array([0, 1]);
    const radialGeo = new THREE.BufferGeometry();
    radialGeo.setAttribute("position", new THREE.BufferAttribute(radialPositions, 3));
    radialGeo.setAttribute("aAlong", new THREE.BufferAttribute(radialAlong, 1));
    this.geometries.push(radialGeo);

    const radialUniforms = {
      uOpacity: { value: 0 },
    };
    const radialMaterial = new THREE.ShaderMaterial({
      vertexShader: orbitRadialVertexShader,
      fragmentShader: orbitRadialFragmentShader,
      uniforms: radialUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(radialMaterial);
    group.add(new THREE.Line(radialGeo, radialMaterial));

    return {
      group,
      ribbonUniforms,
      markerUniforms,
      markerPositions,
      markerGeo,
      tickPositions,
      tickGeo,
      tickMaterial,
      radialPositions,
      radialGeo,
      radialUniforms,
    };
  }

  private updateOrreryMonthMarkers(year: number, day: number) {
    const key = `${year}-${day}`;
    if (this.orreryMarkerKey === key) return;
    this.orreryMarkerKey = key;

    for (let m = 1; m <= 12; m += 1) {
      const clampedDay = Math.min(day, daysInMonth(year, m));
      const solar = computeSolarState(toJulianDay(year, m, clampedDay, 12));
      const angle = solar.earthHeliocentricLongitudeRad;
      const radius = EARTH_ORBIT_RADIUS * solar.earthSunDistanceAU;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const idx = m - 1;
      this.orbitMarkerPositions[idx * 3] = cosA * radius;
      this.orbitMarkerPositions[idx * 3 + 1] = 0.01;
      this.orbitMarkerPositions[idx * 3 + 2] = -sinA * radius;

      const tickHalf = SEASONAL_MONTHS.has(m) ? 0.25 : 0.13;
      const rIn = radius - tickHalf;
      const rOut = radius + tickHalf;
      const base = idx * 6;
      this.orbitTickPositions[base] = cosA * rIn;
      this.orbitTickPositions[base + 1] = 0;
      this.orbitTickPositions[base + 2] = -sinA * rIn;
      this.orbitTickPositions[base + 3] = cosA * rOut;
      this.orbitTickPositions[base + 4] = 0;
      this.orbitTickPositions[base + 5] = -sinA * rOut;
    }

    (this.orbitMarkerGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.orbitTickGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  private createHipparcosStarfield() {
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
    const galTilt = THREE.MathUtils.degToRad(60.2);
    const cosGal = Math.cos(galTilt);
    const sinGal = Math.sin(galTilt);
    for (let i = 0; i < bgCount; i += 1) {
      const u = rand() * 2 - 1;
      const inBand = rand() < 0.45;
      const lat = inBand ? (rand() - 0.5 + (rand() - 0.5)) * 0.34 : Math.asin(u);
      const lon = rand() * TWO_PI;
      const cosLat = Math.cos(lat);

      const gx = radius * cosLat * Math.cos(lon);
      const gy = radius * Math.sin(lat);
      const gz = radius * cosLat * Math.sin(lon);

      positions[idx * 3] = gx;
      positions[idx * 3 + 1] = gy * cosGal - gz * sinGal;
      positions[idx * 3 + 2] = gy * sinGal + gz * cosGal;

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
    this.geometries.push(geometry);

    const uniforms = {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uTime: { value: 0 },
      uSizeScale: { value: 1 },
      uOpacity: { value: 0.96 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: starfieldVertexShader,
      fragmentShader: starfieldFragmentShader,
      uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(material);

    return { geometry, material, uniforms };
  }

  private createGalacticRibbon() {
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
    this.geometries.push(geometry);

    const uniforms = {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
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
    this.materials.push(material);

    group.add(new THREE.Points(geometry, material));
    return { group, uniforms };
  }

  resize(width: number, height: number) {
    if (this.disposed || width <= 0 || height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.starUniforms.uPixelRatio.value = dpr;
    this.galacticDustUniforms.uPixelRatio.value = dpr;
    this.orbitMarkerUniforms.uPixelRatio.value = dpr;
    this.renderSingleFrame();
  }

  private updateMonthNeighbors() {
    const cur = this.cosmicState;
    this.nextMonthIso = addDateSegment(cur.isoDate, "month", 1);
    this.prevMonthIso = addDateSegment(cur.isoDate, "month", -1);

    const nextState = computeCosmicState(this.nextMonthIso);
    const prevState = computeCosmicState(this.prevMonthIso);

    this.nextOrbitDelta = positiveAngleDelta(
      cur.solar.earthHeliocentricLongitudeRad,
      nextState.solar.earthHeliocentricLongitudeRad,
    );
    this.prevOrbitDelta = negativeAngleDelta(
      cur.solar.earthHeliocentricLongitudeRad,
      prevState.solar.earthHeliocentricLongitudeRad,
    );

    this.nextSpinDelta = shortestAngleDelta(cur.solar.gmstRad, nextState.solar.gmstRad) + TWO_PI;
    this.prevSpinDelta = shortestAngleDelta(cur.solar.gmstRad, prevState.solar.gmstRad) - TWO_PI;

    this.nextOrbitRadius = EARTH_ORBIT_RADIUS * nextState.solar.earthSunDistanceAU;
    this.prevOrbitRadius = EARTH_ORBIT_RADIUS * prevState.solar.earthSunDistanceAU;

    // A calendar month (28-31d) is always slightly longer than one sidereal lunar orbit (27.32d)
    this.nextMoonLonDelta =
      positiveAngleDelta(cur.lunar.longitudeRad, nextState.lunar.longitudeRad) + TWO_PI;
    this.prevMoonLonDelta =
      negativeAngleDelta(cur.lunar.longitudeRad, prevState.lunar.longitudeRad) - TWO_PI;
    this.nextMoonLat = nextState.lunar.latitudeRad;
    this.prevMoonLat = prevState.lunar.latitudeRad;
  }

  setMonthDragState(dragging: boolean, fraction: number) {
    this.monthDragging = dragging;
    this.dragMonthFraction = dragging ? THREE.MathUtils.clamp(fraction, -1, 1) : 0;
  }

  setState(next: CosmicState) {
    if (next.isoDate === this.cosmicState.isoDate) return;

    const prevState = this.cosmicState;
    const rawDeltaDays = next.solar.julianDay - prevState.solar.julianDay;
    this.cosmicState = next;

    if (next.isoDate === this.nextMonthIso) {
      // Exact step forward +1 month: matches dragMonthFraction = +1.0 with zero discontinuity
      this.targetOrbitAngle += this.nextOrbitDelta;
      this.targetSpinAngle += this.nextSpinDelta;
      this.targetMoonLon += this.nextMoonLonDelta;
    } else if (next.isoDate === this.prevMonthIso) {
      // Exact step backward -1 month: matches dragMonthFraction = -1.0 with zero discontinuity
      this.targetOrbitAngle += this.prevOrbitDelta;
      this.targetSpinAngle += this.prevSpinDelta;
      this.targetMoonLon += this.prevMoonLonDelta;
    } else {
      // Handle same-year circular month wraps (Dec -> Jan or Jan -> Dec) or multi-month jumps
      let effectiveDeltaDays = rawDeltaDays;
      if (next.date.year === prevState.date.year && Math.abs(rawDeltaDays) > 180) {
        effectiveDeltaDays = rawDeltaDays > 0 ? rawDeltaDays - 365.25 : rawDeltaDays + 365.25;
      }

      if (effectiveDeltaDays !== 0) {
        if (Math.abs(effectiveDeltaDays) < 180) {
          const approxOrbitDelta = (effectiveDeltaDays / 365.25636) * TWO_PI;
          this.targetOrbitAngle = unwrapAngleNear(
            next.solar.earthHeliocentricLongitudeRad,
            this.targetOrbitAngle + approxOrbitDelta,
          );
          const alignedGmst = unwrapAngleNear(next.solar.gmstRad, this.targetSpinAngle);
          const dir = Math.sign(effectiveDeltaDays);
          const extraTurns = Math.round(Math.abs(effectiveDeltaDays) / 30.4375);
          this.targetSpinAngle = alignedGmst + dir * extraTurns * TWO_PI;

          const approxMoonDelta = (effectiveDeltaDays / 27.32166) * TWO_PI;
          this.targetMoonLon = unwrapAngleNear(
            next.lunar.longitudeRad,
            this.targetMoonLon + approxMoonDelta,
          );
        } else {
          this.targetOrbitAngle = unwrapAngleNear(
            next.solar.earthHeliocentricLongitudeRad,
            this.smoothOrbitAngle,
          );
          this.targetSpinAngle = unwrapAngleNear(next.solar.gmstRad, this.smoothSpinAngle);
          this.targetMoonLon = unwrapAngleNear(next.lunar.longitudeRad, this.smoothMoonLon);
        }
      }
    }

    this.updateMonthNeighbors();
    this.updateOrreryMonthMarkers(next.date.year, next.date.day);

    if (!this.active || this.reducedMotion) {
      this.snapToTargets();
      this.renderSingleFrame();
    }
  }

  setMode(mode: CosmicFocusMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode !== "month") {
      this.monthDragging = false;
      this.dragMonthFraction = 0;
    }

    if (mode !== "idle" && this.heroRigBlend > 0.95) {
      this.computeWorldCameraGoal(mode, this.worldCamPos, this.worldCamTarget);
    }

    if (!this.active || this.reducedMotion) {
      this.snapToTargets();
      this.renderSingleFrame();
    }
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    if (reduced) {
      this.snapToTargets();
      this.renderSingleFrame();
    }
  }

  setActive(active: boolean) {
    this.active = active;
    if (active && !this.disposed && this.rafId === null) {
      this.lastTime = performance.now();
      this.rafId = requestAnimationFrame(this.loop);
    } else if (!active && this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  start() {
    if (this.disposed || this.rafId !== null) return;
    this.lastTime = performance.now();
    this.renderSingleFrame();
    if (this.active) {
      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  dispose() {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const tex of this.textures) tex.dispose();
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    this.renderer.dispose();
  }

  private snapToTargets() {
    this.monthDragging = false;
    this.dragMonthFraction = 0;
    this.targetOrbitAngle = this.cosmicState.solar.earthHeliocentricLongitudeRad;
    this.smoothOrbitAngle = this.targetOrbitAngle;
    this.smoothOrbitVel = 0;
    this.camOrbitLag = 0;
    this.smoothOrbitRadius = EARTH_ORBIT_RADIUS * this.cosmicState.solar.earthSunDistanceAU;
    this.targetSpinAngle = this.cosmicState.solar.gmstRad;
    this.smoothSpinAngle = this.targetSpinAngle;
    this.targetMoonLon = this.cosmicState.lunar.longitudeRad;
    this.smoothMoonLon = this.targetMoonLon;
    this.smoothMoonLat = this.cosmicState.lunar.latitudeRad;
    this.smoothEarthScale = this.mode === "month" ? ORRERY_EARTH_SCALE : 1;
    const moonDistFactor = this.cosmicState.lunar.distanceKm / MEAN_LUNAR_DISTANCE_KM;
    this.smoothMoonOrbitRadius =
      (this.mode === "month" ? ORRERY_MOON_ORBIT_RADIUS : HERO_MOON_ORBIT_RADIUS) * moonDistFactor;
    this.smoothMoonElong = this.cosmicState.lunar.elongationRad;
    this.smoothMoonIllum = this.cosmicState.lunar.illumination;
    this.smoothMoonScale = this.cosmicState.lunar.apparentScale;
    this.smoothWaterLevel = this.cosmicState.tidal.waterLevel;
    this.smoothSwellEnergy = this.cosmicState.tidal.swellEnergy;
    this.smoothEpochYears = this.cosmicState.galactic.epochYearsSinceJ2000;
    this.smoothPrecession = this.cosmicState.galactic.axialPrecessionRad;

    this.heroRigBlend = this.mode === "idle" ? 1 : 0;

    this.wEarth = this.mode === "idle" || this.mode === "month" ? 1 : 0;
    this.wOrbitalMoon = this.mode === "idle" || this.mode === "month" ? 1 : 0;
    this.wSun = this.mode === "idle" || this.mode === "month" || this.mode === "year" ? 1 : 0;
    this.wOrrery = this.mode === "month" ? 1 : 0;
    this.wMoon = this.mode === "day" ? 1 : 0;
    this.wOcean = this.mode === "day" ? 1 : 0;
    this.wGalactic = this.mode === "year" ? 1 : 0;
    this.smoothSkyBright =
      this.mode === "year" ? 1.02 : this.mode === "month" ? 0.52 : this.mode === "day" ? 0.3 : 0.48;
    this.smoothSkyGamma =
      this.mode === "year"
        ? 0.74
        : this.mode === "month"
          ? 0.83
          : this.mode === "day"
            ? 0.86
            : 0.84;
    this.smoothSkyReveal =
      this.mode === "year" ? 1 : this.mode === "month" ? 0.18 : this.mode === "day" ? 0.05 : 0.16;

    if (this.mode !== "year") {
      this.sunGroup.position.set(0, 0, 0);
    }
    this.sunGroup.scale.setScalar(
      this.mode === "year" ? 0.34 : this.mode === "month" ? 0.82 : 0.56,
    );

    this.updateOrbitTransform(0);
    this.computeHeroRigCamera(this.heroCamPos, this.heroCamTarget);
    if (this.mode !== "idle") {
      this.computeWorldCameraGoal(this.mode, this.worldCamPos, this.worldCamTarget);
    }
    this.camPos.lerpVectors(this.worldCamPos, this.heroCamPos, this.heroRigBlend);
    this.camTarget.lerpVectors(this.worldCamTarget, this.heroCamTarget, this.heroRigBlend);
    this.applyUniforms();
  }

  private updateOrbitTransform(dt: number) {
    // True heliocentric position in right-handed ecliptic coordinates (+X = Vernal Equinox, -Z = Summer Solstice Sun)
    const ex = Math.cos(this.smoothOrbitAngle) * this.smoothOrbitRadius;
    const ez = -Math.sin(this.smoothOrbitAngle) * this.smoothOrbitRadius;
    this.earthOrbitRoot.position.set(ex, 0, ez);

    // Fixed inertial axial obliquity around +X (North Pole tilts toward -Z = Summer Solstice Sun)
    this.earthAxisGroup.rotation.set(-this.cosmicState.solar.obliquityRad, 0, 0);
    this.earthAxisGroup.scale.setScalar(this.smoothEarthScale);
    // Diurnal sidereal spin matching GMST at rest and rotating smoothly while scrubbing
    this.earthSpinGroup.rotation.y = this.smoothSpinAngle;

    // Exact heliocentric Sun direction from Earth's position toward static Sun at origin
    this.tmpSunDir.set(-ex, 0, -ez).normalize();

    // Honest 360° geocentric Moon position in right-handed ecliptic coordinates
    const cosMoonLat = Math.cos(this.smoothMoonLat);
    const mx = cosMoonLat * Math.cos(this.smoothMoonLon) * this.smoothMoonOrbitRadius;
    const my = Math.sin(this.smoothMoonLat) * this.smoothMoonOrbitRadius;
    const mz = -cosMoonLat * Math.sin(this.smoothMoonLon) * this.smoothMoonOrbitRadius;
    this.orbitalMoonGroup.position.set(mx, my, mz);
    this.orbitalMoonMesh.scale.setScalar(this.smoothEarthScale);
    // Tidally lock lunar near-side (+X on Three.js SphereGeometry at u=0.5) toward Earth with real libration
    this.orbitalMoonMesh.rotation.set(
      0,
      this.smoothMoonLon + Math.PI + this.cosmicState.lunar.librationLonRad,
      -this.smoothMoonLat + this.cosmicState.lunar.librationLatRad,
    );
    // Physically lit by the static Sun at world origin (0, 0, 0)
    this.orbitalMoonUniforms.uSunDir.value.set(-(ex + mx), -my, -(ez + mz)).normalize();

    // Update heliocentric Sun-to-Earth guide segment in Orrery view
    this.orbitRadialPositions[0] = 0;
    this.orbitRadialPositions[1] = 0;
    this.orbitRadialPositions[2] = 0;
    this.orbitRadialPositions[3] = ex;
    this.orbitRadialPositions[4] = 0;
    this.orbitRadialPositions[5] = ez;
    (this.orbitRadialGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

    const ambientTime = this.reducedMotion ? 0 : this.elapsed;
    const galPhase = this.smoothEpochYears * 0.042;
    const sunArcX = Math.sin(galPhase * 0.45) * 1.45 + Math.sin(ambientTime * 0.14) * 0.06;
    const sunArcY = Math.sin(galPhase * 0.45) * 0.48 + Math.cos(ambientTime * 0.11) * 0.035;
    const sunArcZ = Math.cos(galPhase * 0.45) * 0.35 - 0.35;

    if (this.mode === "year") {
      this.sunGroup.position.set(
        damp(this.sunGroup.position.x, sunArcX, 6, dt || 0.016),
        damp(this.sunGroup.position.y, sunArcY, 6, dt || 0.016),
        damp(this.sunGroup.position.z, sunArcZ, 6, dt || 0.016),
      );
      this.galacticDustUniforms.uDrift.value = this.smoothEpochYears * 0.36 + ambientTime * 0.085;
    } else if (this.sunGroup.position.lengthSq() > 1e-8) {
      this.sunGroup.position.set(
        damp(this.sunGroup.position.x, 0, 8, dt || 0.016),
        damp(this.sunGroup.position.y, 0, 8, dt || 0.016),
        damp(this.sunGroup.position.z, 0, 8, dt || 0.016),
      );
      if (this.sunGroup.position.lengthSq() < 1e-6) {
        this.sunGroup.position.set(0, 0, 0);
      }
    }

    const sunScale = this.mode === "year" ? 0.34 : this.mode === "month" ? 0.82 : 0.56;
    const nextSunScale = damp(this.sunGroup.scale.x, sunScale, 5.5, dt || 0.016);
    this.sunGroup.scale.setScalar(nextSunScale);

    const elong = this.smoothMoonElong;
    const moonSunX = Math.sin(elong);
    const moonSunY = Math.sin(this.cosmicState.lunar.latitudeRad) * 0.65;
    const moonSunZ = -Math.cos(elong);
    this.moonUniforms.uSunDir.value.set(moonSunX, moonSunY, moonSunZ).normalize();
    this.moonMesh.scale.setScalar(this.smoothMoonScale);
    this.moonMesh.rotation.y = -Math.PI * 0.5 + this.cosmicState.lunar.librationLonRad;
    this.moonMesh.rotation.x = this.cosmicState.lunar.librationLatRad;

    const galLonShift =
      this.mode === "year" ? this.smoothEpochYears * 0.0085 + ambientTime * 0.0022 : 0;
    this.skyGroup.rotation.y = this.smoothPrecession + galLonShift;
  }

  private computeHeroRigCamera(outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    // Polar co-orbiting Hero camera: frames Earth in the left corner and the static Sun upper-right.
    const camAngle = this.smoothOrbitAngle - this.camOrbitLag;
    const radialOutX = Math.cos(camAngle);
    const radialOutZ = -Math.sin(camAngle);
    const tangentX = -Math.sin(camAngle);
    const tangentZ = -Math.cos(camAngle);

    const anchorX = radialOutX * this.smoothOrbitRadius;
    const anchorZ = radialOutZ * this.smoothOrbitRadius;

    const t = this.reducedMotion ? 0 : this.elapsed;
    const swayTangent = Math.sin(t * 0.16) * 0.045;
    const swayY = Math.cos(t * 0.13) * 0.03;

    outPos.set(
      anchorX + radialOutX * HERO_RIG.radial + tangentX * (HERO_RIG.tangent + swayTangent),
      HERO_RIG.height + swayY,
      anchorZ + radialOutZ * HERO_RIG.radial + tangentZ * (HERO_RIG.tangent + swayTangent),
    );

    const ex = this.earthOrbitRoot.position.x;
    const ez = this.earthOrbitRoot.position.z;
    const focusX = THREE.MathUtils.lerp(anchorX, ex, 0.35);
    const focusZ = THREE.MathUtils.lerp(anchorZ, ez, 0.35);

    outTarget.set(focusX * HERO_RIG.targetWeight, HERO_RIG.targetY, focusZ * HERO_RIG.targetWeight);
  }

  private computeWorldCameraGoal(
    mode: "month" | "year" | "day",
    outPos: THREE.Vector3,
    outTarget: THREE.Vector3,
  ) {
    const t = this.reducedMotion ? 0 : this.elapsed;
    const swayX = Math.sin(t * 0.16) * 0.065;
    const swayY = Math.cos(t * 0.13) * 0.04;

    if (mode === "month") {
      // Elevated perspective Orrery overlooking Earth's full horizontal orbit around the static Sun:
      // +Z camera looks toward origin so prograde motion (CCW from North) sweeps left -> right in front.
      const camY = Math.sin(ORRERY_ELEVATION_RAD) * ORRERY_DISTANCE;
      const camZ = Math.cos(ORRERY_ELEVATION_RAD) * ORRERY_DISTANCE;
      outPos.set(swayX * 1.15, camY + swayY * 0.85, camZ);
      outTarget.set(0, ORRERY_TARGET_Y, 0);
      return;
    }

    if (mode === "year") {
      const epochDrift = Math.sin(this.smoothEpochYears * 0.019) * 0.45;
      outPos.set(epochDrift * 0.6 + swayX * 1.4, 0.25 + epochDrift * 0.12 + swayY * 1.2, 8.6);
      outTarget.set(this.sunGroup.position.x * 0.42, this.sunGroup.position.y * 0.3, -1.2);
      return;
    }

    const stageY = this.dayStageGroup.position.y;
    outPos.set(swayX * 0.55, stageY + 0.16 + swayY * 0.45, 3.85);
    outTarget.set(0.05, stageY + 0.08, -0.8);
  }

  private applyUniforms() {
    this.earthUniforms.uSunDir.value.copy(this.tmpSunDir);
    this.earthUniforms.uCloudOffset.value = this.elapsed * (this.reducedMotion ? 0 : 0.0022);
    this.earthUniforms.uOpacity.value = this.wEarth;

    this.cloudsUniforms.uSunDir.value.copy(this.tmpSunDir);
    this.cloudsUniforms.uCloudOffset.value = this.elapsed * (this.reducedMotion ? 0 : 0.0022);
    this.cloudsUniforms.uOpacity.value = this.wEarth;

    this.atmosphereUniforms.uSunDir.value.copy(this.tmpSunDir);
    this.atmosphereUniforms.uOpacity.value = this.wEarth;
    this.earthOrbitRoot.visible = this.wEarth > 0.005 || this.wOrbitalMoon > 0.005;

    this.orbitalMoonUniforms.uEarthshine.value = this.cosmicState.lunar.earthshine;
    this.orbitalMoonUniforms.uOpacity.value = this.wOrbitalMoon;
    this.orbitalMoonGroup.visible = this.wOrbitalMoon > 0.005;

    this.sunUniforms.uTime.value = this.elapsed;
    this.sunUniforms.uOpacity.value = this.wSun;
    this.sunCoronaUniforms.uTime.value = this.elapsed;
    this.sunCoronaUniforms.uOpacity.value = this.wSun;
    this.sunGroup.visible = this.wSun > 0.005;

    this.orbitRibbonUniforms.uEarthAngle.value = this.smoothOrbitAngle;
    this.orbitRibbonUniforms.uOpacity.value = this.wOrrery;
    this.orbitMarkerUniforms.uActiveMonth.value = this.cosmicState.date.month;
    this.orbitMarkerUniforms.uOpacity.value = this.wOrrery;
    this.orbitTickMaterial.opacity = this.wOrrery * 0.34;
    this.orbitRadialUniforms.uOpacity.value = this.wOrrery;
    this.orreryGroup.visible = this.wOrrery > 0.005;

    this.moonUniforms.uEarthshine.value = this.cosmicState.lunar.earthshine;
    this.moonUniforms.uOpacity.value = this.wMoon;
    this.oceanUniforms.uTime.value = this.reducedMotion ? 0 : this.elapsed;
    this.oceanUniforms.uWaterLevel.value = this.smoothWaterLevel;
    this.oceanUniforms.uSwellEnergy.value = this.smoothSwellEnergy;
    this.oceanUniforms.uMoonIllumination.value = this.smoothMoonIllum;
    this.oceanUniforms.uOpacity.value = this.wOcean;
    this.dayStageGroup.visible = this.wMoon > 0.005 || this.wOcean > 0.005;

    this.galacticDustUniforms.uTime.value = this.elapsed;
    this.galacticDustUniforms.uOpacity.value = this.wGalactic * 0.92;
    this.galacticDustGroup.visible = this.wGalactic > 0.005;

    this.skyUniforms.uBrightness.value = this.smoothSkyBright;
    this.skyUniforms.uGamma.value = this.smoothSkyGamma;
    this.skyUniforms.uGalacticReveal.value = this.smoothSkyReveal;
    this.starUniforms.uTime.value = this.reducedMotion ? 0 : this.elapsed;

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.skyGroup.position.copy(this.camera.position);
    this.sunCoronaMesh.quaternion.copy(this.camera.quaternion);
  }

  private renderSingleFrame() {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  private readonly loop = (now: number) => {
    if (this.disposed || !this.active) {
      this.rafId = null;
      return;
    }

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    if (!this.reducedMotion) {
      this.elapsed += dt;
    }

    const orbitLambda = this.reducedMotion ? 60 : this.monthDragging ? 18 : 7.0;
    const astroLambda = this.reducedMotion ? 60 : 7.5;
    const camLambda = this.reducedMotion ? 60 : 5.6;
    const fadeLambda = this.reducedMotion ? 60 : 6.4;

    const dragFraction = this.reducedMotion ? 0 : this.dragMonthFraction;
    const orbitOffset =
      dragFraction >= 0 ? dragFraction * this.nextOrbitDelta : -dragFraction * this.prevOrbitDelta;
    const spinOffset =
      dragFraction >= 0 ? dragFraction * this.nextSpinDelta : -dragFraction * this.prevSpinDelta;
    const moonLonOffset =
      dragFraction >= 0
        ? dragFraction * this.nextMoonLonDelta
        : -dragFraction * this.prevMoonLonDelta;
    const effectiveOrbitTarget = this.targetOrbitAngle + orbitOffset;
    const effectiveSpinTarget = this.targetSpinAngle + spinOffset;
    const effectiveMoonLonTarget = this.targetMoonLon + moonLonOffset;

    const prevOrbitAngle = this.smoothOrbitAngle;
    this.smoothOrbitAngle = damp(this.smoothOrbitAngle, effectiveOrbitTarget, orbitLambda, dt);
    const rawOrbitVel = dt > 0.0001 ? (this.smoothOrbitAngle - prevOrbitAngle) / dt : 0;
    this.smoothOrbitVel = damp(this.smoothOrbitVel, rawOrbitVel, 7.5, dt);

    const targetLag =
      this.reducedMotion || this.mode !== "idle"
        ? 0
        : THREE.MathUtils.clamp(this.smoothOrbitVel * 0.022, -0.025, 0.025);
    this.camOrbitLag = damp(this.camOrbitLag, targetLag, 9.0, dt);

    // Keep Earth's axial spin and Moon's geocentric orbit locked to the same damper as Earth's orbit
    this.smoothSpinAngle = damp(this.smoothSpinAngle, effectiveSpinTarget, orbitLambda, dt);
    this.smoothMoonLon = damp(this.smoothMoonLon, effectiveMoonLonTarget, orbitLambda, dt);

    const targetMoonLat =
      dragFraction >= 0
        ? THREE.MathUtils.lerp(this.cosmicState.lunar.latitudeRad, this.nextMoonLat, dragFraction)
        : THREE.MathUtils.lerp(this.cosmicState.lunar.latitudeRad, this.prevMoonLat, -dragFraction);
    this.smoothMoonLat = damp(this.smoothMoonLat, targetMoonLat, orbitLambda, dt);

    // Keep continuous unwrapped angles bounded once settled to preserve float precision
    if (!this.monthDragging && this.dragMonthFraction === 0) {
      if (
        Math.abs(this.targetOrbitAngle - this.smoothOrbitAngle) < 0.0005 &&
        Math.abs(this.smoothOrbitAngle) > Math.PI * 8
      ) {
        const shift = Math.round(this.smoothOrbitAngle / TWO_PI) * TWO_PI;
        this.targetOrbitAngle -= shift;
        this.smoothOrbitAngle -= shift;
      }
      if (
        Math.abs(this.targetSpinAngle - this.smoothSpinAngle) < 0.0005 &&
        Math.abs(this.smoothSpinAngle) > Math.PI * 8
      ) {
        const shift = Math.round(this.smoothSpinAngle / TWO_PI) * TWO_PI;
        this.targetSpinAngle -= shift;
        this.smoothSpinAngle -= shift;
      }
      if (
        Math.abs(this.targetMoonLon - this.smoothMoonLon) < 0.0005 &&
        Math.abs(this.smoothMoonLon) > Math.PI * 8
      ) {
        const shift = Math.round(this.smoothMoonLon / TWO_PI) * TWO_PI;
        this.targetMoonLon -= shift;
        this.smoothMoonLon -= shift;
      }
    }

    const baseRadius = EARTH_ORBIT_RADIUS * this.cosmicState.solar.earthSunDistanceAU;
    const targetRadius =
      dragFraction >= 0
        ? THREE.MathUtils.lerp(baseRadius, this.nextOrbitRadius, dragFraction)
        : THREE.MathUtils.lerp(baseRadius, this.prevOrbitRadius, -dragFraction);
    this.smoothOrbitRadius = damp(this.smoothOrbitRadius, targetRadius, orbitLambda, dt);

    const targetEarthScale = this.mode === "month" ? ORRERY_EARTH_SCALE : 1;
    this.smoothEarthScale = damp(this.smoothEarthScale, targetEarthScale, camLambda, dt);

    const moonDistFactor = this.cosmicState.lunar.distanceKm / MEAN_LUNAR_DISTANCE_KM;
    const targetMoonOrbitRadius =
      (this.mode === "month" ? ORRERY_MOON_ORBIT_RADIUS : HERO_MOON_ORBIT_RADIUS) * moonDistFactor;
    this.smoothMoonOrbitRadius = damp(
      this.smoothMoonOrbitRadius,
      targetMoonOrbitRadius,
      camLambda,
      dt,
    );

    this.smoothMoonElong = dampAngle(
      this.smoothMoonElong,
      this.cosmicState.lunar.elongationRad,
      astroLambda,
      dt,
    );
    this.smoothMoonIllum = damp(
      this.smoothMoonIllum,
      this.cosmicState.lunar.illumination,
      astroLambda,
      dt,
    );
    this.smoothMoonScale = damp(
      this.smoothMoonScale,
      this.cosmicState.lunar.apparentScale,
      astroLambda,
      dt,
    );
    this.smoothWaterLevel = damp(
      this.smoothWaterLevel,
      this.cosmicState.tidal.waterLevel,
      astroLambda,
      dt,
    );
    this.smoothSwellEnergy = damp(
      this.smoothSwellEnergy,
      this.cosmicState.tidal.swellEnergy,
      astroLambda,
      dt,
    );
    this.smoothEpochYears = damp(
      this.smoothEpochYears,
      this.cosmicState.galactic.epochYearsSinceJ2000,
      astroLambda,
      dt,
    );
    this.smoothPrecession = damp(
      this.smoothPrecession,
      this.cosmicState.galactic.axialPrecessionRad,
      astroLambda,
      dt,
    );

    const targetEarth = this.mode === "idle" || this.mode === "month" ? 1 : 0;
    const targetOrbitalMoon = this.mode === "idle" || this.mode === "month" ? 1 : 0;
    const targetSun = this.mode === "idle" || this.mode === "month" || this.mode === "year" ? 1 : 0;
    const targetOrrery = this.mode === "month" ? 1 : 0;
    const targetMoon = this.mode === "day" ? 1 : 0;
    const targetOcean = this.mode === "day" ? 1 : 0;
    const targetGalactic = this.mode === "year" ? 1 : 0;
    const targetSkyBright =
      this.mode === "year" ? 1.02 : this.mode === "month" ? 0.52 : this.mode === "day" ? 0.3 : 0.48;
    const targetSkyGamma =
      this.mode === "year"
        ? 0.74
        : this.mode === "month"
          ? 0.83
          : this.mode === "day"
            ? 0.86
            : 0.84;
    const targetSkyReveal =
      this.mode === "year" ? 1 : this.mode === "month" ? 0.18 : this.mode === "day" ? 0.05 : 0.16;

    this.wEarth = damp(this.wEarth, targetEarth, fadeLambda, dt);
    this.wOrbitalMoon = damp(this.wOrbitalMoon, targetOrbitalMoon, fadeLambda, dt);
    this.wSun = damp(this.wSun, targetSun, fadeLambda, dt);
    this.wOrrery = damp(this.wOrrery, targetOrrery, fadeLambda, dt);
    this.wMoon = damp(this.wMoon, targetMoon, fadeLambda, dt);
    this.wOcean = damp(this.wOcean, targetOcean, fadeLambda, dt);
    this.wGalactic = damp(this.wGalactic, targetGalactic, fadeLambda, dt);
    this.smoothSkyBright = damp(this.smoothSkyBright, targetSkyBright, fadeLambda, dt);
    this.smoothSkyGamma = damp(this.smoothSkyGamma, targetSkyGamma, fadeLambda, dt);
    this.smoothSkyReveal = damp(this.smoothSkyReveal, targetSkyReveal, fadeLambda, dt);

    const targetHeroRig = this.mode === "idle" ? 1 : 0;
    this.heroRigBlend = damp(this.heroRigBlend, targetHeroRig, camLambda, dt);

    this.updateOrbitTransform(dt);
    this.computeHeroRigCamera(this.heroCamPos, this.heroCamTarget);

    if (this.mode !== "idle") {
      this.computeWorldCameraGoal(this.mode, this.desiredWorldPos, this.desiredWorldTarget);
      this.worldCamPos.x = damp(this.worldCamPos.x, this.desiredWorldPos.x, camLambda, dt);
      this.worldCamPos.y = damp(this.worldCamPos.y, this.desiredWorldPos.y, camLambda, dt);
      this.worldCamPos.z = damp(this.worldCamPos.z, this.desiredWorldPos.z, camLambda, dt);
      this.worldCamTarget.x = damp(this.worldCamTarget.x, this.desiredWorldTarget.x, camLambda, dt);
      this.worldCamTarget.y = damp(this.worldCamTarget.y, this.desiredWorldTarget.y, camLambda, dt);
      this.worldCamTarget.z = damp(this.worldCamTarget.z, this.desiredWorldTarget.z, camLambda, dt);
    }

    const b = THREE.MathUtils.clamp(this.heroRigBlend, 0, 1);
    const smoothBlend = b * b * (3 - 2 * b);
    this.camPos.lerpVectors(this.worldCamPos, this.heroCamPos, smoothBlend);
    this.camTarget.lerpVectors(this.worldCamTarget, this.heroCamTarget, smoothBlend);

    this.applyUniforms();
    this.renderSingleFrame();
    this.rafId = requestAnimationFrame(this.loop);
  };
}
