import * as THREE from "three";
import {
  addDateSegment,
  type CosmicState,
  computeCosmicState,
  SYNODIC_MONTH_DAYS,
} from "./astronomy";
import {
  atmosphereFragmentShader,
  atmosphereVertexShader,
  cloudsFragmentShader,
  cloudsVertexShader,
  earthFragmentShader,
  earthVertexShader,
  galacticGuideFragmentShader,
  galacticGuideVertexShader,
  galacticStreamVertexShader,
  lunarGuideFragmentShader,
  lunarGuideVertexShader,
  moonFragmentShader,
  moonHaloFragmentShader,
  moonHaloVertexShader,
  moonVertexShader,
  oceanFragmentShader,
  oceanVertexShader,
  orbitGuideFragmentShader,
  orbitGuideVertexShader,
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
const CAROUSEL_MOON_ORBIT_RADIUS = 1.75;
const CAROUSEL_EARTH_SCALE = 1.0;
const J2000_OBLIQUITY_RAD = THREE.MathUtils.degToRad(23.43929111);
const TWO_PI = Math.PI * 2;

const DAY_STAGE_Y = -18;
const DAY_MOON_BASE_RADIUS = 0.5;
const DAY_MOON_POS = new THREE.Vector3(-0.06, 2.38, -3.6);
const DAY_CAM_LOCAL_POS = new THREE.Vector3(0.0, 1.28, 4.6);
const DAY_CAM_LOCAL_TARGET = new THREE.Vector3(0.0, 1.18, -4.0);
const DAY_MOON_DIR = DAY_MOON_POS.clone().sub(DAY_CAM_LOCAL_POS).normalize();
const DAY_GUIDE_HALF_SPAN = 4.2;
const DAY_GUIDE_DAY_SPACING = 0.215;
// Constant-speed coastal tidal drift: gentle ramp-up/down with steady cruise velocity
const TIDE_DRIFT_SPEED = 0.16;
const TIDE_DRIFT_ACCEL = 0.7;
const TIDE_ARRIVAL_BAND = 0.035;
// Constant-speed lunar orbital catch-up relative to Earth (co-orbiting the Sun with Earth)
const MOON_ORBIT_DRIFT_SPEED = 0.72;
const MOON_ORBIT_DRIFT_ACCEL = 2.4;
const MOON_ORBIT_ARRIVAL_BAND = 0.24;

// Hero (idle) framing: Earth fills the left corner (~1/3 of the card) with static Sun upper-right
// and the Moon orbiting honestly across its true 360° geocentric ecliptic path.
const HERO_RIG = {
  radial: 1.12,
  tangent: 2.29,
  height: 0.8,
  targetWeight: 0.67,
  targetY: 0.02,
  focusFollow: 0.35,
};

// Orbital Carousel (month) framing: three-quarter sunlit angle on Earth (~30% lit disc) with
// static Sun anchored upper-right and gentle, damped horizontal drift during drag.
const CAROUSEL_RIG = {
  radial: 2.5,
  tangent: 4.9,
  height: 3.1,
  targetWeight: 0.65,
  targetY: -0.22,
  focusFollow: 0.0,
};

function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function advanceSmoothLinear(
  current: number,
  target: number,
  velocity: number,
  maxSpeed: number,
  accel: number,
  arrivalBand: number,
  dt: number,
): [number, number] {
  const diff = target - current;
  if (Math.abs(diff) < 1e-4 && Math.abs(velocity) < 1e-3) {
    return [target, 0];
  }

  // Cruise at a steady constant speed outside a tiny soft-landing band near target
  const speedScale = Math.min(1, Math.abs(diff) / arrivalBand);
  const desiredVelocity = Math.sign(diff) * maxSpeed * speedScale;

  // Ramp velocity smoothly so starts, stops, and direction reversals have zero jerk
  const maxVelStep = accel * dt;
  const velDiff = desiredVelocity - velocity;
  const nextVelocity =
    Math.abs(velDiff) <= maxVelStep ? desiredVelocity : velocity + Math.sign(velDiff) * maxVelStep;

  const nextPos = current + nextVelocity * dt;
  if ((diff > 0 && nextPos >= target) || (diff < 0 && nextPos <= target)) {
    return [target, 0];
  }

  return [nextPos, nextVelocity];
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

function advanceSmoothAngleLinear(
  current: number,
  target: number,
  velocity: number,
  maxSpeed: number,
  accel: number,
  arrivalBand: number,
  dt: number,
): [number, number] {
  const diff = shortestAngleDelta(current, target);
  if (Math.abs(diff) < 1e-4 && Math.abs(velocity) < 1e-3) {
    return [shortestAngleDelta(0, target), 0];
  }

  // Cruise at a steady constant angular speed outside a soft-landing band near target
  const speedScale = Math.min(1, Math.abs(diff) / arrivalBand);
  const desiredVelocity = Math.sign(diff) * maxSpeed * speedScale;

  // Ramp velocity smoothly so starts, stops, and direction reversals have zero jerk
  const maxVelStep = accel * dt;
  const velDiff = desiredVelocity - velocity;
  const nextVelocity =
    Math.abs(velDiff) <= maxVelStep ? desiredVelocity : velocity + Math.sign(velDiff) * maxVelStep;

  const step = nextVelocity * dt;
  if ((diff > 0 && step >= diff) || (diff < 0 && step <= diff)) {
    return [shortestAngleDelta(0, target), 0];
  }

  return [shortestAngleDelta(0, current + step), nextVelocity];
}

function computeMoonRelAngle(state: CosmicState): number {
  return shortestAngleDelta(state.solar.earthHeliocentricLongitudeRad, state.lunar.longitudeRad);
}

function shortestCycleDelta(from: number, to: number, period: number): number {
  const half = period * 0.5;
  let diff = ((to - from + half) % period) - half;
  if (diff < -half) diff += period;
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
    uHorizonClip: { value: number };
    uMoonDir: { value: THREE.Vector3 };
    uMoonIllum: { value: number };
  };

  private readonly galacticDustGroup: THREE.Group;
  private readonly galacticDustUniforms: {
    uPixelRatio: { value: number };
    uTime: { value: number };
    uSizeScale: { value: number };
    uOpacity: { value: number };
    uDrift: { value: number };
  };

  private readonly orbitGuideMesh: THREE.Mesh;
  private readonly orbitGuideUniforms: {
    uOpacity: { value: number };
    uEarthAngle: { value: number };
  };

  private readonly galacticGuideMesh: THREE.Mesh;
  private readonly galacticGuideUniforms: {
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
  private readonly moonHaloMesh: THREE.Mesh;
  private readonly moonHaloUniforms: {
    uOpacity: { value: number };
    uMoonIllumination: { value: number };
  };
  private readonly moonMesh: THREE.Mesh;
  private readonly moonUniforms: {
    uMoonMap: { value: THREE.Texture };
    uSunDir: { value: THREE.Vector3 };
    uEarthshine: { value: number };
    uOpacity: { value: number };
  };
  private readonly lunarGuideMesh: THREE.Mesh;
  private readonly lunarGuideUniforms: {
    uOpacity: { value: number };
    uSynodicAge: { value: number };
    uMoonClearInner: { value: number };
    uMoonClearOuter: { value: number };
    uHalfSpan: { value: number };
    uDaySpacing: { value: number };
  };
  private readonly oceanMesh: THREE.Mesh;
  private readonly oceanUniforms: {
    uTime: { value: number };
    uTideLevel: { value: number };
    uWetTideMemory: { value: number };
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
  private readonly polarCamPos = new THREE.Vector3();
  private readonly polarCamTarget = new THREE.Vector3();
  private readonly nonEarthCamPos = new THREE.Vector3();
  private readonly nonEarthCamTarget = new THREE.Vector3();
  private readonly desiredNonEarthPos = new THREE.Vector3();
  private readonly desiredNonEarthTarget = new THREE.Vector3();
  private readonly tmpSunDir = new THREE.Vector3();

  private targetOrbitAngle: number;
  private smoothOrbitAngle: number;
  private trailOrbitAngle: number;
  private camOrbitAngle: number;
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
  private nextMoonRelDelta = 0;
  private prevMoonRelDelta = 0;
  private nextMoonLat = 0;
  private prevMoonLat = 0;

  private dayDragging = false;
  private dragDayFraction = 0;
  private nextDayIso = "";
  private prevDayIso = "";
  private nextDayElongDelta = TWO_PI / SYNODIC_MONTH_DAYS;
  private prevDayElongDelta = -TWO_PI / SYNODIC_MONTH_DAYS;
  private nextDayAgeDelta = 1;
  private prevDayAgeDelta = -1;
  private nextDayLat = 0;
  private prevDayLat = 0;
  private nextDayScale = 1;
  private prevDayScale = 1;
  private nextDayIllum = 0.5;
  private prevDayIllum = 0.5;
  private nextDayEarthshine = 0.25;
  private prevDayEarthshine = 0.25;
  private nextDayLibLon = 0;
  private prevDayLibLon = 0;
  private nextDayLibLat = 0;
  private prevDayLibLat = 0;
  private nextDayTide = 0.5;
  private prevDayTide = 0.5;
  private nextDaySwell = 0.5;
  private prevDaySwell = 0.5;

  private smoothOrbitRadius: number;
  private targetSpinAngle: number;
  private smoothSpinAngle: number;
  private smoothMoonRelAngle: number;
  private moonRelVelocity = 0;
  private smoothMoonLat: number;
  private smoothMoonOrbitRadius: number;
  private smoothEarthScale = 1;

  private targetDayElong: number;
  private smoothMoonElong: number;
  private targetDayAge: number;
  private smoothDayAge: number;
  private smoothDayLat: number;
  private smoothDayLibLon: number;
  private smoothDayLibLat: number;
  private smoothMoonIllum: number;
  private smoothMoonEarthshine: number;
  private smoothMoonScale: number;

  // Constant-speed, velocity-ramped coastal tidal state (spring/neap + perigean/apogean)
  private smoothTideLevel: number;
  private tideVelocity = 0;
  private smoothWetTideMemory: number;
  private smoothSwellEnergy: number;
  private swellVelocity = 0;

  private smoothEpochYears: number;
  private smoothPrecession: number;

  private rigRadial = HERO_RIG.radial;
  private rigTangent = HERO_RIG.tangent;
  private rigHeight = HERO_RIG.height;
  private rigTargetWeight = HERO_RIG.targetWeight;
  private rigTargetY = HERO_RIG.targetY;
  private rigFocusFollow = HERO_RIG.focusFollow;
  private earthRigBlend = 1;

  private wEarth = 1;
  private wOrbitalMoon = 1;
  private wSun = 1;
  private wMoon = 0;
  private wOcean = 0;
  private wGalactic = 0;
  private wMonthGuide = 0;
  private wYearGuide = 0;
  private wDayGuide = 0;
  private smoothSkyBright = 0.48;
  private smoothSkyGamma = 0.84;
  private smoothSkyReveal = 0.16;

  private constructor(canvas: HTMLCanvasElement, initialState: CosmicState) {
    this.cosmicState = initialState;
    this.targetOrbitAngle = initialState.solar.earthHeliocentricLongitudeRad;
    this.smoothOrbitAngle = initialState.solar.earthHeliocentricLongitudeRad;
    this.trailOrbitAngle = initialState.solar.earthHeliocentricLongitudeRad;
    this.camOrbitAngle = initialState.solar.earthHeliocentricLongitudeRad;
    this.smoothOrbitRadius = EARTH_ORBIT_RADIUS * initialState.solar.earthSunDistanceAU;
    this.targetSpinAngle = initialState.solar.gmstRad;
    this.smoothSpinAngle = initialState.solar.gmstRad;
    this.smoothMoonRelAngle = computeMoonRelAngle(initialState);
    this.smoothMoonLat = initialState.lunar.latitudeRad;
    this.smoothMoonOrbitRadius =
      HERO_MOON_ORBIT_RADIUS * (initialState.lunar.distanceKm / MEAN_LUNAR_DISTANCE_KM);

    this.targetDayElong = initialState.lunar.elongationRad;
    this.smoothMoonElong = initialState.lunar.elongationRad;
    this.targetDayAge = initialState.lunar.synodicAgeDays;
    this.smoothDayAge = initialState.lunar.synodicAgeDays;
    this.smoothDayLat = initialState.lunar.latitudeRad;
    this.smoothDayLibLon = initialState.lunar.librationLonRad;
    this.smoothDayLibLat = initialState.lunar.librationLatRad;
    this.smoothMoonIllum = initialState.lunar.illumination;
    this.smoothMoonEarthshine = initialState.lunar.earthshine;
    this.smoothMoonScale = initialState.lunar.apparentScale;

    this.smoothTideLevel = initialState.tidal.springNeapIndex;
    this.smoothWetTideMemory = initialState.tidal.springNeapIndex;
    this.smoothSwellEnergy = initialState.tidal.swellEnergy;

    this.smoothEpochYears = initialState.galactic.epochYearsSinceJ2000;
    this.smoothPrecession = initialState.galactic.axialPrecessionRad;
    this.updateMonthNeighbors();
    this.updateDayNeighbors();

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

    const { mesh: orbitGuideMesh, uniforms: orbitGuideUniforms } = this.createOrbitGuide();
    this.orbitGuideMesh = orbitGuideMesh;
    this.orbitGuideUniforms = orbitGuideUniforms;
    this.scene.add(this.orbitGuideMesh);

    const { mesh: galacticGuideMesh, uniforms: galacticGuideUniforms } = this.createGalacticGuide();
    this.galacticGuideMesh = galacticGuideMesh;
    this.galacticGuideUniforms = galacticGuideUniforms;
    this.scene.add(this.galacticGuideMesh);

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
    this.dayStageGroup.position.set(0, DAY_STAGE_Y, 0);

    const moonHaloGeo = new THREE.PlaneGeometry(3.8, 3.8);
    this.geometries.push(moonHaloGeo);
    this.moonHaloUniforms = {
      uOpacity: { value: 0 },
      uMoonIllumination: { value: initialState.lunar.illumination },
    };
    const moonHaloMaterial = new THREE.ShaderMaterial({
      vertexShader: moonHaloVertexShader,
      fragmentShader: moonHaloFragmentShader,
      uniforms: this.moonHaloUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(moonHaloMaterial);
    this.moonHaloMesh = new THREE.Mesh(moonHaloGeo, moonHaloMaterial);
    this.moonHaloMesh.position.set(DAY_MOON_POS.x, DAY_MOON_POS.y, DAY_MOON_POS.z - 0.14);
    this.moonHaloMesh.renderOrder = 3;
    this.dayStageGroup.add(this.moonHaloMesh);

    const moonGeo = new THREE.SphereGeometry(DAY_MOON_BASE_RADIUS, 72, 72);
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
    this.moonMesh.position.copy(DAY_MOON_POS);
    // Orient lunar near-side facing the observer
    this.moonMesh.rotation.y = -Math.PI * 0.5;
    this.moonMesh.renderOrder = 4;
    this.dayStageGroup.add(this.moonMesh);

    const { mesh: lunarGuideMesh, uniforms: lunarGuideUniforms } = this.createLunarGuide();
    this.lunarGuideMesh = lunarGuideMesh;
    this.lunarGuideUniforms = lunarGuideUniforms;
    this.dayStageGroup.add(this.lunarGuideMesh);

    const oceanGeo = this.createCoastalGeometry();
    this.oceanUniforms = {
      uTime: { value: 0 },
      uTideLevel: { value: initialState.tidal.springNeapIndex },
      uWetTideMemory: { value: initialState.tidal.springNeapIndex },
      uSwellEnergy: { value: initialState.tidal.swellEnergy },
      uMoonDir: { value: DAY_MOON_DIR.clone() },
      uMoonIllumination: { value: initialState.lunar.illumination },
      uOpacity: { value: 0 },
    };
    const oceanMaterial = new THREE.ShaderMaterial({
      vertexShader: oceanVertexShader,
      fragmentShader: oceanFragmentShader,
      uniforms: this.oceanUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(oceanMaterial);
    this.oceanMesh = new THREE.Mesh(oceanGeo, oceanMaterial);
    this.oceanMesh.renderOrder = 2;
    this.dayStageGroup.add(this.oceanMesh);

    this.scene.add(this.dayStageGroup);

    this.updateOrbitTransform(0);
    this.computeEarthRigCamera(this.polarCamPos, this.polarCamTarget);
    this.computeNonEarthCameraGoal("year", this.nonEarthCamPos, this.nonEarthCamTarget);
    this.camPos.copy(this.polarCamPos);
    this.camTarget.copy(this.polarCamTarget);
    this.applyUniforms();
  }

  static create(canvas: HTMLCanvasElement, initialState: CosmicState): CosmicSceneRenderer | null {
    try {
      return new CosmicSceneRenderer(canvas, initialState);
    } catch {
      return null;
    }
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
      uHorizonClip: { value: 0 },
      uMoonDir: { value: DAY_MOON_DIR.clone() },
      uMoonIllum: { value: this.cosmicState.lunar.illumination },
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

  private createOrbitGuide() {
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
    this.geometries.push(geometry);

    const uniforms = {
      uOpacity: { value: 0 },
      uEarthAngle: { value: this.smoothOrbitAngle },
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
    this.materials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 6;
    mesh.visible = false;
    return { mesh, uniforms };
  }

  private createGalacticGuide() {
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
    this.geometries.push(geometry);

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
    this.materials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 6;
    mesh.visible = false;
    return { mesh, uniforms };
  }

  private createLunarGuide() {
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
    this.geometries.push(geometry);

    const uniforms = {
      uOpacity: { value: 0 },
      uSynodicAge: { value: this.smoothDayAge },
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
    this.materials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(DAY_MOON_POS);
    mesh.renderOrder = 6;
    mesh.visible = false;
    return { mesh, uniforms };
  }

  private createCoastalGeometry() {
    // Non-uniform coastal mesh concentrating vertex density in the foreground swash & surf zone
    // while extending cleanly out to the distant oceanic horizon (z = -115)
    const segX = 180;
    const segZ = 156;
    const cols = segX + 1;
    const rows = segZ + 1;
    const positions = new Float32Array(cols * rows * 3);
    const indices: number[] = [];

    for (let iz = 0; iz <= segZ; iz += 1) {
      const tz = iz / segZ;
      // Smooth non-linear depth stretch: very dense near z ∈ [+3.2, -16], wide toward horizon
      const z = 3.2 - 118.2 * tz ** 2.35;
      // Horizontal span expands proportionally with perspective depth so full FOV is always covered
      const depthFromCam = Math.max(2.0, DAY_CAM_LOCAL_POS.z - z);
      const halfWidth = Math.max(7.5, depthFromCam * 0.68);

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
    // Keep frustum culling disabled since vertex shader displaces surface height dynamically
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -50), 140);
    this.geometries.push(geometry);
    return geometry;
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

    const curMoonRel = computeMoonRelAngle(cur);
    const nextMoonRel = computeMoonRelAngle(nextState);
    const prevMoonRel = computeMoonRelAngle(prevState);
    this.nextMoonRelDelta = shortestAngleDelta(curMoonRel, nextMoonRel);
    this.prevMoonRelDelta = shortestAngleDelta(curMoonRel, prevMoonRel);
    this.nextMoonLat = nextState.lunar.latitudeRad;
    this.prevMoonLat = prevState.lunar.latitudeRad;
  }

  private updateDayNeighbors() {
    const cur = this.cosmicState;
    this.nextDayIso = addDateSegment(cur.isoDate, "day", 1);
    this.prevDayIso = addDateSegment(cur.isoDate, "day", -1);

    const nextState = computeCosmicState(this.nextDayIso);
    const prevState = computeCosmicState(this.prevDayIso);

    this.nextDayElongDelta = shortestAngleDelta(
      cur.lunar.elongationRad,
      nextState.lunar.elongationRad,
    );
    this.prevDayElongDelta = shortestAngleDelta(
      cur.lunar.elongationRad,
      prevState.lunar.elongationRad,
    );
    this.nextDayAgeDelta = shortestCycleDelta(
      cur.lunar.synodicAgeDays,
      nextState.lunar.synodicAgeDays,
      SYNODIC_MONTH_DAYS,
    );
    this.prevDayAgeDelta = shortestCycleDelta(
      cur.lunar.synodicAgeDays,
      prevState.lunar.synodicAgeDays,
      SYNODIC_MONTH_DAYS,
    );

    this.nextDayLat = nextState.lunar.latitudeRad;
    this.prevDayLat = prevState.lunar.latitudeRad;
    this.nextDayScale = nextState.lunar.apparentScale;
    this.prevDayScale = prevState.lunar.apparentScale;
    this.nextDayIllum = nextState.lunar.illumination;
    this.prevDayIllum = prevState.lunar.illumination;
    this.nextDayEarthshine = nextState.lunar.earthshine;
    this.prevDayEarthshine = prevState.lunar.earthshine;
    this.nextDayLibLon = nextState.lunar.librationLonRad;
    this.prevDayLibLon = prevState.lunar.librationLonRad;
    this.nextDayLibLat = nextState.lunar.librationLatRad;
    this.prevDayLibLat = prevState.lunar.librationLatRad;
    this.nextDayTide = nextState.tidal.springNeapIndex;
    this.prevDayTide = prevState.tidal.springNeapIndex;
    this.nextDaySwell = nextState.tidal.swellEnergy;
    this.prevDaySwell = prevState.tidal.swellEnergy;
  }

  setMonthDragState(dragging: boolean, fraction: number) {
    this.monthDragging = dragging;
    this.dragMonthFraction = THREE.MathUtils.clamp(fraction, -1, 1);
  }

  setDayDragState(dragging: boolean, fraction: number) {
    this.dayDragging = dragging;
    this.dragDayFraction = THREE.MathUtils.clamp(fraction, -1, 1);
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
    } else if (next.isoDate === this.prevMonthIso) {
      // Exact step backward -1 month: matches dragMonthFraction = -1.0 with zero discontinuity
      this.targetOrbitAngle += this.prevOrbitDelta;
      this.targetSpinAngle += this.prevSpinDelta;
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
        } else {
          this.targetOrbitAngle = unwrapAngleNear(
            next.solar.earthHeliocentricLongitudeRad,
            this.smoothOrbitAngle,
          );
          this.targetSpinAngle = unwrapAngleNear(next.solar.gmstRad, this.smoothSpinAngle);
        }
      }
    }

    // Continuous unwrapped lunar phase & synodic guide age for seamless 1:1 Day scrubbing
    if (next.isoDate === this.nextDayIso) {
      this.targetDayElong += this.nextDayElongDelta;
      this.targetDayAge += this.nextDayAgeDelta;
    } else if (next.isoDate === this.prevDayIso) {
      this.targetDayElong += this.prevDayElongDelta;
      this.targetDayAge += this.prevDayAgeDelta;
    } else {
      this.targetDayElong = unwrapAngleNear(next.lunar.elongationRad, this.smoothMoonElong);
      this.targetDayAge =
        this.smoothDayAge +
        shortestCycleDelta(this.smoothDayAge, next.lunar.synodicAgeDays, SYNODIC_MONTH_DAYS);
    }

    this.updateMonthNeighbors();
    this.updateDayNeighbors();

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
    if (mode !== "day") {
      this.dayDragging = false;
      this.dragDayFraction = 0;
    } else {
      // Entering Day mode: align ocean immediately to the current date's tidal level
      this.smoothTideLevel = this.cosmicState.tidal.springNeapIndex;
      this.smoothWetTideMemory = this.smoothTideLevel;
      this.smoothSwellEnergy = this.cosmicState.tidal.swellEnergy;
      this.tideVelocity = 0;
      this.swellVelocity = 0;
    }

    if ((mode === "day" || mode === "year") && this.earthRigBlend > 0.95) {
      this.computeNonEarthCameraGoal(mode, this.nonEarthCamPos, this.nonEarthCamTarget);
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
    this.dayDragging = false;
    this.dragDayFraction = 0;

    this.targetOrbitAngle = this.cosmicState.solar.earthHeliocentricLongitudeRad;
    this.smoothOrbitAngle = this.targetOrbitAngle;
    this.trailOrbitAngle = this.targetOrbitAngle;
    this.camOrbitAngle = this.targetOrbitAngle;
    this.smoothOrbitRadius = EARTH_ORBIT_RADIUS * this.cosmicState.solar.earthSunDistanceAU;
    this.targetSpinAngle = this.cosmicState.solar.gmstRad;
    this.smoothSpinAngle = this.targetSpinAngle;
    this.smoothMoonRelAngle = computeMoonRelAngle(this.cosmicState);
    this.moonRelVelocity = 0;
    this.smoothMoonLat = this.cosmicState.lunar.latitudeRad;
    this.smoothEarthScale = this.mode === "month" ? CAROUSEL_EARTH_SCALE : 1;
    const moonDistFactor = this.cosmicState.lunar.distanceKm / MEAN_LUNAR_DISTANCE_KM;
    this.smoothMoonOrbitRadius =
      (this.mode === "month" ? CAROUSEL_MOON_ORBIT_RADIUS : HERO_MOON_ORBIT_RADIUS) *
      moonDistFactor;

    this.targetDayElong = this.cosmicState.lunar.elongationRad;
    this.smoothMoonElong = this.targetDayElong;
    this.targetDayAge = this.cosmicState.lunar.synodicAgeDays;
    this.smoothDayAge = this.targetDayAge;
    this.smoothDayLat = this.cosmicState.lunar.latitudeRad;
    this.smoothDayLibLon = this.cosmicState.lunar.librationLonRad;
    this.smoothDayLibLat = this.cosmicState.lunar.librationLatRad;
    this.smoothMoonIllum = this.cosmicState.lunar.illumination;
    this.smoothMoonEarthshine = this.cosmicState.lunar.earthshine;
    this.smoothMoonScale = this.cosmicState.lunar.apparentScale;

    this.smoothTideLevel = this.cosmicState.tidal.springNeapIndex;
    this.smoothWetTideMemory = this.smoothTideLevel;
    this.smoothSwellEnergy = this.cosmicState.tidal.swellEnergy;
    this.tideVelocity = 0;
    this.swellVelocity = 0;

    this.smoothEpochYears = this.cosmicState.galactic.epochYearsSinceJ2000;
    this.smoothPrecession = this.cosmicState.galactic.axialPrecessionRad;

    const rig = this.mode === "month" ? CAROUSEL_RIG : HERO_RIG;
    this.rigRadial = rig.radial;
    this.rigTangent = rig.tangent;
    this.rigHeight = rig.height;
    this.rigTargetWeight = rig.targetWeight;
    this.rigTargetY = rig.targetY;
    this.rigFocusFollow = rig.focusFollow;
    this.earthRigBlend = this.mode === "idle" || this.mode === "month" ? 1 : 0;

    this.wEarth = this.mode === "idle" || this.mode === "month" ? 1 : 0;
    this.wOrbitalMoon = this.mode === "idle" || this.mode === "month" ? 1 : 0;
    this.wSun = this.mode === "idle" || this.mode === "month" || this.mode === "year" ? 1 : 0;
    this.wMoon = this.mode === "day" ? 1 : 0;
    this.wOcean = this.mode === "day" ? 1 : 0;
    this.wGalactic = this.mode === "year" ? 1 : 0;
    this.wMonthGuide = this.mode === "month" ? 1 : 0;
    this.wYearGuide = this.mode === "year" ? 1 : 0;
    this.wDayGuide = this.mode === "day" ? 1 : 0;
    this.smoothSkyBright =
      this.mode === "year"
        ? 1.02
        : this.mode === "month"
          ? 0.52
          : this.mode === "day"
            ? 0.24
            : 0.48;
    this.smoothSkyGamma =
      this.mode === "year"
        ? 0.74
        : this.mode === "month"
          ? 0.83
          : this.mode === "day"
            ? 0.88
            : 0.84;
    this.smoothSkyReveal =
      this.mode === "year" ? 1 : this.mode === "month" ? 0.22 : this.mode === "day" ? 0.03 : 0.16;

    if (this.mode !== "year") {
      this.sunGroup.position.set(0, 0, 0);
    }
    this.sunGroup.scale.setScalar(
      this.mode === "year" ? 0.34 : this.mode === "month" ? 0.78 : 0.56,
    );

    this.updateOrbitTransform(0);
    this.computeEarthRigCamera(this.polarCamPos, this.polarCamTarget);
    if (this.mode === "day" || this.mode === "year") {
      this.computeNonEarthCameraGoal(this.mode, this.nonEarthCamPos, this.nonEarthCamTarget);
    }
    this.camPos.lerpVectors(this.nonEarthCamPos, this.polarCamPos, this.earthRigBlend);
    this.camTarget.lerpVectors(this.nonEarthCamTarget, this.polarCamTarget, this.earthRigBlend);
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

    // Honest 360° geocentric Moon position in right-handed ecliptic coordinates,
    // co-orbiting the Sun with Earth while smoothly catching up to its relative orbital angle
    const moonLon = this.smoothOrbitAngle + this.smoothMoonRelAngle;
    const cosMoonLat = Math.cos(this.smoothMoonLat);
    const mx = cosMoonLat * Math.cos(moonLon) * this.smoothMoonOrbitRadius;
    const my = Math.sin(this.smoothMoonLat) * this.smoothMoonOrbitRadius;
    const mz = -cosMoonLat * Math.sin(moonLon) * this.smoothMoonOrbitRadius;
    this.orbitalMoonGroup.position.set(mx, my, mz);
    this.orbitalMoonMesh.scale.setScalar(this.smoothEarthScale);
    // Tidally lock lunar near-side (+X on Three.js SphereGeometry at u=0.5) toward Earth with real libration
    this.orbitalMoonMesh.rotation.set(
      0,
      moonLon + Math.PI + this.smoothDayLibLon,
      -this.smoothMoonLat + this.smoothDayLibLat,
    );
    // Physically lit by the static Sun at world origin (0, 0, 0)
    this.orbitalMoonUniforms.uSunDir.value.set(-(ex + mx), -my, -(ez + mz)).normalize();

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

    const sunScale = this.mode === "year" ? 0.34 : this.mode === "month" ? 0.78 : 0.56;
    const nextSunScale = damp(this.sunGroup.scale.x, sunScale, 5.5, dt || 0.016);
    this.sunGroup.scale.setScalar(nextSunScale);

    this.orbitGuideMesh.scale.set(this.smoothOrbitRadius, 1, this.smoothOrbitRadius);
    this.galacticGuideMesh.position.copy(this.sunGroup.position);

    // Northern Hemisphere lunar orientation (waxing illuminated on right +X, waning on left -X)
    const elong = this.smoothMoonElong;
    const moonSunX = Math.sin(elong);
    const moonSunY = Math.sin(this.smoothDayLat) * 0.65;
    const moonSunZ = -Math.cos(elong);
    this.moonUniforms.uSunDir.value.set(moonSunX, moonSunY, moonSunZ).normalize();
    this.moonMesh.scale.setScalar(this.smoothMoonScale);
    this.moonMesh.rotation.y = -Math.PI * 0.5 + this.smoothDayLibLon;
    this.moonMesh.rotation.x = this.smoothDayLibLat;

    const galLonShift =
      this.mode === "year" ? this.smoothEpochYears * 0.0085 + ambientTime * 0.0022 : 0;
    this.skyGroup.rotation.y = this.smoothPrecession + galLonShift;
  }

  private computeEarthRigCamera(outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    // Polar co-orbiting camera around the static Sun:
    // - In idle (Hero): tightly tracks Earth in the left corner with the Sun upper-right.
    // - In month (Orbital Carousel): trails elastically so Earth swings 1:1 left/right along
    //   the horizontal front arc while the Sun stays anchored upper-center and the stars revolve.
    const camAngle = this.camOrbitAngle;
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
      anchorX + radialOutX * this.rigRadial + tangentX * (this.rigTangent + swayTangent),
      this.rigHeight + swayY,
      anchorZ + radialOutZ * this.rigRadial + tangentZ * (this.rigTangent + swayTangent),
    );

    const ex = this.earthOrbitRoot.position.x;
    const ez = this.earthOrbitRoot.position.z;
    const focusX = THREE.MathUtils.lerp(anchorX, ex, this.rigFocusFollow);
    const focusZ = THREE.MathUtils.lerp(anchorZ, ez, this.rigFocusFollow);

    outTarget.set(focusX * this.rigTargetWeight, this.rigTargetY, focusZ * this.rigTargetWeight);
  }

  private computeNonEarthCameraGoal(
    mode: "year" | "day",
    outPos: THREE.Vector3,
    outTarget: THREE.Vector3,
  ) {
    if (mode === "year") {
      const t = this.reducedMotion ? 0 : this.elapsed;
      const swayX = Math.sin(t * 0.16) * 0.065;
      const swayY = Math.cos(t * 0.13) * 0.04;
      const epochDrift = Math.sin(this.smoothEpochYears * 0.019) * 0.45;
      outPos.set(epochDrift * 0.6 + swayX * 1.4, 0.25 + epochDrift * 0.12 + swayY * 1.2, 8.6);
      outTarget.set(this.sunGroup.position.x * 0.42, this.sunGroup.position.y * 0.3, -1.2);
      return;
    }

    // Coastal Day mode: strictly static tripod framing showing the diagonal beach, ocean waves,
    // and Moon anchored calmly in the upper sky while the engineering guide slides through it.
    const stageY = this.dayStageGroup.position.y;
    outPos.set(DAY_CAM_LOCAL_POS.x, stageY + DAY_CAM_LOCAL_POS.y, DAY_CAM_LOCAL_POS.z);
    outTarget.set(DAY_CAM_LOCAL_TARGET.x, stageY + DAY_CAM_LOCAL_TARGET.y, DAY_CAM_LOCAL_TARGET.z);
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

    const orbitalIllum = THREE.MathUtils.clamp(
      (1 + Math.cos(this.smoothMoonLat) * Math.cos(this.smoothMoonRelAngle)) * 0.5,
      0,
      1,
    );
    this.orbitalMoonUniforms.uEarthshine.value = (1 - orbitalIllum) ** 1.35;
    this.orbitalMoonUniforms.uOpacity.value = this.wOrbitalMoon;
    this.orbitalMoonGroup.visible = this.wOrbitalMoon > 0.005;

    this.sunUniforms.uTime.value = this.elapsed;
    this.sunUniforms.uOpacity.value = this.wSun;
    this.sunCoronaUniforms.uTime.value = this.elapsed;
    this.sunCoronaUniforms.uOpacity.value = this.wSun;
    this.sunGroup.visible = this.wSun > 0.005;

    this.moonUniforms.uEarthshine.value = this.smoothMoonEarthshine;
    this.moonUniforms.uOpacity.value = this.wMoon;
    this.moonHaloUniforms.uMoonIllumination.value = this.smoothMoonIllum;
    this.moonHaloUniforms.uOpacity.value = this.wMoon;
    this.moonHaloMesh.visible = this.wMoon > 0.005;

    const scaledMoonR = DAY_MOON_BASE_RADIUS * this.smoothMoonScale;
    this.lunarGuideUniforms.uOpacity.value = this.wDayGuide;
    this.lunarGuideUniforms.uSynodicAge.value = this.smoothDayAge;
    this.lunarGuideUniforms.uMoonClearInner.value = scaledMoonR * 1.15;
    this.lunarGuideUniforms.uMoonClearOuter.value = scaledMoonR * 1.54;
    this.lunarGuideMesh.visible = this.wDayGuide > 0.005;

    this.oceanUniforms.uTime.value = this.reducedMotion ? 0 : this.elapsed;
    this.oceanUniforms.uTideLevel.value = this.smoothTideLevel;
    this.oceanUniforms.uWetTideMemory.value = this.smoothWetTideMemory;
    this.oceanUniforms.uSwellEnergy.value = this.smoothSwellEnergy;
    this.oceanUniforms.uMoonIllumination.value = this.smoothMoonIllum;
    this.oceanUniforms.uOpacity.value = this.wOcean;
    this.dayStageGroup.visible = this.wMoon > 0.005 || this.wOcean > 0.005;

    this.galacticDustUniforms.uTime.value = this.elapsed;
    this.galacticDustUniforms.uOpacity.value = this.wGalactic * 0.92;
    this.galacticDustGroup.visible = this.wGalactic > 0.005;

    this.orbitGuideUniforms.uOpacity.value = this.wMonthGuide;
    this.orbitGuideUniforms.uEarthAngle.value = this.smoothOrbitAngle;
    this.orbitGuideMesh.visible = this.wMonthGuide > 0.005;

    this.galacticGuideUniforms.uOpacity.value = this.wYearGuide;
    this.galacticGuideUniforms.uDrift.value = this.galacticDustUniforms.uDrift.value;
    this.galacticGuideMesh.visible = this.wYearGuide > 0.005;

    this.skyUniforms.uBrightness.value = this.smoothSkyBright;
    this.skyUniforms.uGamma.value = this.smoothSkyGamma;
    this.skyUniforms.uGalacticReveal.value = this.smoothSkyReveal;
    this.starUniforms.uTime.value = this.reducedMotion ? 0 : this.elapsed;
    this.starUniforms.uSizeScale.value = THREE.MathUtils.lerp(1, 1.24, this.wOcean);
    this.starUniforms.uHorizonClip.value = this.wOcean;
    this.starUniforms.uMoonIllum.value = this.smoothMoonIllum;

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.skyGroup.position.copy(this.camera.position);
    this.sunCoronaMesh.quaternion.copy(this.camera.quaternion);
    this.moonHaloMesh.quaternion.copy(this.camera.quaternion);
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

    const orbitLambda = this.reducedMotion ? 60 : this.monthDragging ? 12.5 : 6.5;
    const dayLambda = this.reducedMotion ? 60 : this.dayDragging ? 18.0 : 9.5;
    const astroLambda = this.reducedMotion ? 60 : 7.5;
    const camLambda = this.reducedMotion ? 60 : 5.6;
    const fadeLambda = this.reducedMotion ? 60 : 6.4;

    const dragFraction = this.reducedMotion ? 0 : this.dragMonthFraction;
    const orbitOffset =
      dragFraction >= 0 ? dragFraction * this.nextOrbitDelta : -dragFraction * this.prevOrbitDelta;
    const spinOffset =
      dragFraction >= 0 ? dragFraction * this.nextSpinDelta : -dragFraction * this.prevSpinDelta;
    const effectiveOrbitTarget = this.targetOrbitAngle + orbitOffset;
    const effectiveSpinTarget = this.targetSpinAngle + spinOffset;

    this.smoothOrbitAngle = damp(this.smoothOrbitAngle, effectiveOrbitTarget, orbitLambda, dt);

    // Inertial camera lead: camera smoothly leads slightly ahead of Earth in the drag direction
    // so Earth shifts subtly opposite the drag (as if trailing with planetary mass/inertia)
    // and gently catches up on release without any abrupt clamp or overshoot.
    if (this.reducedMotion) {
      this.trailOrbitAngle = this.smoothOrbitAngle;
      this.camOrbitAngle = this.smoothOrbitAngle;
    } else {
      const chaseLambda = this.mode === "month" ? 7.5 : 14.0;
      const maxLag = this.mode === "month" ? 0.075 : 0.025;
      const nextTrail = damp(this.trailOrbitAngle, this.smoothOrbitAngle, chaseLambda, dt);
      const rawLag = this.smoothOrbitAngle - nextTrail;
      const softLag = maxLag * Math.tanh(rawLag / maxLag);
      this.trailOrbitAngle = this.smoothOrbitAngle - softLag;
      this.camOrbitAngle = this.smoothOrbitAngle + softLag;
    }

    // Keep Earth's axial spin locked to the same damper as Earth's orbit
    this.smoothSpinAngle = damp(this.smoothSpinAngle, effectiveSpinTarget, orbitLambda, dt);

    // Steady, velocity-ramped lunar catch-up relative to Earth while co-orbiting the Sun with Earth
    const baseMoonRel = computeMoonRelAngle(this.cosmicState);
    const moonRelOffset =
      dragFraction >= 0
        ? dragFraction * this.nextMoonRelDelta
        : -dragFraction * this.prevMoonRelDelta;
    const targetMoonRelAngle = shortestAngleDelta(0, baseMoonRel + moonRelOffset);

    if (this.reducedMotion) {
      this.smoothMoonRelAngle = targetMoonRelAngle;
      this.moonRelVelocity = 0;
    } else {
      const [nextMoonRel, nextMoonRelVel] = advanceSmoothAngleLinear(
        this.smoothMoonRelAngle,
        targetMoonRelAngle,
        this.moonRelVelocity,
        MOON_ORBIT_DRIFT_SPEED,
        MOON_ORBIT_DRIFT_ACCEL,
        MOON_ORBIT_ARRIVAL_BAND,
        dt,
      );
      this.smoothMoonRelAngle = nextMoonRel;
      this.moonRelVelocity = nextMoonRelVel;
    }

    const targetMoonLat =
      dragFraction >= 0
        ? THREE.MathUtils.lerp(this.cosmicState.lunar.latitudeRad, this.nextMoonLat, dragFraction)
        : THREE.MathUtils.lerp(this.cosmicState.lunar.latitudeRad, this.prevMoonLat, -dragFraction);
    this.smoothMoonLat = damp(this.smoothMoonLat, targetMoonLat, this.reducedMotion ? 60 : 3.2, dt);

    // Keep continuous unwrapped angles bounded once settled to preserve float precision
    if (!this.monthDragging && this.dragMonthFraction === 0) {
      if (
        Math.abs(this.targetOrbitAngle - this.smoothOrbitAngle) < 0.0005 &&
        Math.abs(this.smoothOrbitAngle - this.trailOrbitAngle) < 0.0005 &&
        Math.abs(this.smoothOrbitAngle) > Math.PI * 8
      ) {
        const shift = Math.round(this.smoothOrbitAngle / TWO_PI) * TWO_PI;
        this.targetOrbitAngle -= shift;
        this.smoothOrbitAngle -= shift;
        this.trailOrbitAngle -= shift;
        this.camOrbitAngle -= shift;
      }
      if (
        Math.abs(this.targetSpinAngle - this.smoothSpinAngle) < 0.0005 &&
        Math.abs(this.smoothSpinAngle) > Math.PI * 8
      ) {
        const shift = Math.round(this.smoothSpinAngle / TWO_PI) * TWO_PI;
        this.targetSpinAngle -= shift;
        this.smoothSpinAngle -= shift;
      }
    }

    const baseRadius = EARTH_ORBIT_RADIUS * this.cosmicState.solar.earthSunDistanceAU;
    const targetRadius =
      dragFraction >= 0
        ? THREE.MathUtils.lerp(baseRadius, this.nextOrbitRadius, dragFraction)
        : THREE.MathUtils.lerp(baseRadius, this.prevOrbitRadius, -dragFraction);
    this.smoothOrbitRadius = damp(this.smoothOrbitRadius, targetRadius, orbitLambda, dt);

    const targetEarthScale = this.mode === "month" ? CAROUSEL_EARTH_SCALE : 1;
    this.smoothEarthScale = damp(this.smoothEarthScale, targetEarthScale, camLambda, dt);

    const moonDistFactor = this.cosmicState.lunar.distanceKm / MEAN_LUNAR_DISTANCE_KM;
    const targetMoonOrbitRadius =
      (this.mode === "month" ? CAROUSEL_MOON_ORBIT_RADIUS : HERO_MOON_ORBIT_RADIUS) *
      moonDistFactor;
    this.smoothMoonOrbitRadius = damp(
      this.smoothMoonOrbitRadius,
      targetMoonOrbitRadius,
      camLambda,
      dt,
    );

    // 1:1 continuous sub-day lunar phase & guide interpolation during Day dragging
    const dayFraction = this.reducedMotion ? 0 : this.dragDayFraction;
    const dayElongOffset =
      dayFraction >= 0
        ? dayFraction * this.nextDayElongDelta
        : -dayFraction * this.prevDayElongDelta;
    const dayAgeOffset =
      dayFraction >= 0 ? dayFraction * this.nextDayAgeDelta : -dayFraction * this.prevDayAgeDelta;
    const targetDayLat =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(this.cosmicState.lunar.latitudeRad, this.nextDayLat, dayFraction)
        : THREE.MathUtils.lerp(this.cosmicState.lunar.latitudeRad, this.prevDayLat, -dayFraction);
    const targetDayScale =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(this.cosmicState.lunar.apparentScale, this.nextDayScale, dayFraction)
        : THREE.MathUtils.lerp(
            this.cosmicState.lunar.apparentScale,
            this.prevDayScale,
            -dayFraction,
          );
    const targetDayIllum =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(this.cosmicState.lunar.illumination, this.nextDayIllum, dayFraction)
        : THREE.MathUtils.lerp(
            this.cosmicState.lunar.illumination,
            this.prevDayIllum,
            -dayFraction,
          );
    const targetDayEarthshine =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(
            this.cosmicState.lunar.earthshine,
            this.nextDayEarthshine,
            dayFraction,
          )
        : THREE.MathUtils.lerp(
            this.cosmicState.lunar.earthshine,
            this.prevDayEarthshine,
            -dayFraction,
          );
    const targetDayLibLon =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(
            this.cosmicState.lunar.librationLonRad,
            this.nextDayLibLon,
            dayFraction,
          )
        : THREE.MathUtils.lerp(
            this.cosmicState.lunar.librationLonRad,
            this.prevDayLibLon,
            -dayFraction,
          );
    const targetDayLibLat =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(
            this.cosmicState.lunar.librationLatRad,
            this.nextDayLibLat,
            dayFraction,
          )
        : THREE.MathUtils.lerp(
            this.cosmicState.lunar.librationLatRad,
            this.prevDayLibLat,
            -dayFraction,
          );

    this.smoothMoonElong = damp(
      this.smoothMoonElong,
      this.targetDayElong + dayElongOffset,
      dayLambda,
      dt,
    );
    this.smoothDayAge = damp(this.smoothDayAge, this.targetDayAge + dayAgeOffset, dayLambda, dt);
    this.smoothDayLat = damp(this.smoothDayLat, targetDayLat, dayLambda, dt);
    this.smoothDayLibLon = damp(this.smoothDayLibLon, targetDayLibLon, dayLambda, dt);
    this.smoothDayLibLat = damp(this.smoothDayLibLat, targetDayLibLat, dayLambda, dt);
    this.smoothMoonIllum = damp(this.smoothMoonIllum, targetDayIllum, dayLambda, dt);
    this.smoothMoonEarthshine = damp(this.smoothMoonEarthshine, targetDayEarthshine, dayLambda, dt);
    this.smoothMoonScale = damp(this.smoothMoonScale, targetDayScale, dayLambda, dt);

    // Keep unwrapped day elongation & synodic age bounded once settled
    if (!this.dayDragging && this.dragDayFraction === 0) {
      if (
        Math.abs(this.targetDayElong - this.smoothMoonElong) < 0.0005 &&
        Math.abs(this.smoothMoonElong) > Math.PI * 8
      ) {
        const shift = Math.round(this.smoothMoonElong / TWO_PI) * TWO_PI;
        this.targetDayElong -= shift;
        this.smoothMoonElong -= shift;
      }
      if (
        Math.abs(this.targetDayAge - this.smoothDayAge) < 0.001 &&
        Math.abs(this.smoothDayAge) > SYNODIC_MONTH_DAYS * 8
      ) {
        const shift = Math.round(this.smoothDayAge / SYNODIC_MONTH_DAYS) * SYNODIC_MONTH_DAYS;
        this.targetDayAge -= shift;
        this.smoothDayAge -= shift;
      }
    }

    // Continuous sub-day tidal target with steady, constant-speed shoreline drift (zero jerk/debounce snap)
    const targetTideLevel =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(
            this.cosmicState.tidal.springNeapIndex,
            this.nextDayTide,
            dayFraction,
          )
        : THREE.MathUtils.lerp(
            this.cosmicState.tidal.springNeapIndex,
            this.prevDayTide,
            -dayFraction,
          );
    const targetSwellEnergy =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(this.cosmicState.tidal.swellEnergy, this.nextDaySwell, dayFraction)
        : THREE.MathUtils.lerp(this.cosmicState.tidal.swellEnergy, this.prevDaySwell, -dayFraction);

    if (this.reducedMotion) {
      this.smoothTideLevel = targetTideLevel;
      this.smoothSwellEnergy = targetSwellEnergy;
      this.tideVelocity = 0;
      this.swellVelocity = 0;
    } else {
      const [nextTide, nextTideVel] = advanceSmoothLinear(
        this.smoothTideLevel,
        targetTideLevel,
        this.tideVelocity,
        TIDE_DRIFT_SPEED,
        TIDE_DRIFT_ACCEL,
        TIDE_ARRIVAL_BAND,
        dt,
      );
      this.smoothTideLevel = nextTide;
      this.tideVelocity = nextTideVel;

      // Keep swell energy (range 0.25..1.0 = 0.75 * springNeapIndex) paced in exact lockstep with tide
      const [nextSwell, nextSwellVel] = advanceSmoothLinear(
        this.smoothSwellEnergy,
        targetSwellEnergy,
        this.swellVelocity,
        TIDE_DRIFT_SPEED * 0.75,
        TIDE_DRIFT_ACCEL * 0.75,
        TIDE_ARRIVAL_BAND * 0.75,
        dt,
      );
      this.smoothSwellEnergy = nextSwell;
      this.swellVelocity = nextSwellVel;
    }
    // Wet sand dries slower than water recedes, leaving a glistening reflective coastal trail
    if (this.smoothTideLevel >= this.smoothWetTideMemory || this.reducedMotion) {
      this.smoothWetTideMemory = this.smoothTideLevel;
    } else {
      this.smoothWetTideMemory = damp(this.smoothWetTideMemory, this.smoothTideLevel, 0.24, dt);
    }

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
    const targetMoon = this.mode === "day" ? 1 : 0;
    const targetOcean = this.mode === "day" ? 1 : 0;
    const targetGalactic = this.mode === "year" ? 1 : 0;
    const targetMonthGuide = this.mode === "month" ? 1 : 0;
    const targetYearGuide = this.mode === "year" ? 1 : 0;
    const targetDayGuide = this.mode === "day" ? 1 : 0;
    const targetSkyBright =
      this.mode === "year"
        ? 1.02
        : this.mode === "month"
          ? 0.52
          : this.mode === "day"
            ? 0.24
            : 0.48;
    const targetSkyGamma =
      this.mode === "year"
        ? 0.74
        : this.mode === "month"
          ? 0.83
          : this.mode === "day"
            ? 0.88
            : 0.84;
    const targetSkyReveal =
      this.mode === "year" ? 1 : this.mode === "month" ? 0.22 : this.mode === "day" ? 0.03 : 0.16;

    this.wEarth = damp(this.wEarth, targetEarth, fadeLambda, dt);
    this.wOrbitalMoon = damp(this.wOrbitalMoon, targetOrbitalMoon, fadeLambda, dt);
    this.wSun = damp(this.wSun, targetSun, fadeLambda, dt);
    this.wMoon = damp(this.wMoon, targetMoon, fadeLambda, dt);
    this.wOcean = damp(this.wOcean, targetOcean, fadeLambda, dt);
    this.wGalactic = damp(this.wGalactic, targetGalactic, fadeLambda, dt);
    this.wMonthGuide = damp(this.wMonthGuide, targetMonthGuide, fadeLambda, dt);
    this.wYearGuide = damp(this.wYearGuide, targetYearGuide, fadeLambda, dt);
    this.wDayGuide = damp(this.wDayGuide, targetDayGuide, fadeLambda, dt);
    this.smoothSkyBright = damp(this.smoothSkyBright, targetSkyBright, fadeLambda, dt);
    this.smoothSkyGamma = damp(this.smoothSkyGamma, targetSkyGamma, fadeLambda, dt);
    this.smoothSkyReveal = damp(this.smoothSkyReveal, targetSkyReveal, fadeLambda, dt);

    const rig = this.mode === "month" ? CAROUSEL_RIG : HERO_RIG;
    this.rigRadial = damp(this.rigRadial, rig.radial, camLambda, dt);
    this.rigTangent = damp(this.rigTangent, rig.tangent, camLambda, dt);
    this.rigHeight = damp(this.rigHeight, rig.height, camLambda, dt);
    this.rigTargetWeight = damp(this.rigTargetWeight, rig.targetWeight, camLambda, dt);
    this.rigTargetY = damp(this.rigTargetY, rig.targetY, camLambda, dt);
    this.rigFocusFollow = damp(this.rigFocusFollow, rig.focusFollow, camLambda, dt);
    this.earthRigBlend = damp(this.earthRigBlend, targetEarth, camLambda, dt);

    this.updateOrbitTransform(dt);
    this.computeEarthRigCamera(this.polarCamPos, this.polarCamTarget);

    if (this.mode === "day" || this.mode === "year") {
      this.computeNonEarthCameraGoal(
        this.mode,
        this.desiredNonEarthPos,
        this.desiredNonEarthTarget,
      );
      this.nonEarthCamPos.x = damp(this.nonEarthCamPos.x, this.desiredNonEarthPos.x, camLambda, dt);
      this.nonEarthCamPos.y = damp(this.nonEarthCamPos.y, this.desiredNonEarthPos.y, camLambda, dt);
      this.nonEarthCamPos.z = damp(this.nonEarthCamPos.z, this.desiredNonEarthPos.z, camLambda, dt);
      this.nonEarthCamTarget.x = damp(
        this.nonEarthCamTarget.x,
        this.desiredNonEarthTarget.x,
        camLambda,
        dt,
      );
      this.nonEarthCamTarget.y = damp(
        this.nonEarthCamTarget.y,
        this.desiredNonEarthTarget.y,
        camLambda,
        dt,
      );
      this.nonEarthCamTarget.z = damp(
        this.nonEarthCamTarget.z,
        this.desiredNonEarthTarget.z,
        camLambda,
        dt,
      );
    }

    const b = THREE.MathUtils.clamp(this.earthRigBlend, 0, 1);
    const smoothBlend = b * b * (3 - 2 * b);
    this.camPos.lerpVectors(this.nonEarthCamPos, this.polarCamPos, smoothBlend);
    this.camTarget.lerpVectors(this.nonEarthCamTarget, this.polarCamTarget, smoothBlend);

    this.applyUniforms();
    this.renderSingleFrame();
    this.rafId = requestAnimationFrame(this.loop);
  };
}
