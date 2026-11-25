import * as THREE from "three";
import {
  type AstroState,
  addDateSegment,
  computeAstroState,
  computeLunarSunDirectionObserver,
  formatIsoDate,
  GALACTIC_ECLIPTIC_BASIS,
  SYNODIC_MONTH_DAYS,
} from "./astronomy";
import {
  CAROUSEL_EARTH_SCALE,
  CAROUSEL_MOON_ORBIT_RADIUS,
  CAROUSEL_RIG,
  createCoastalGeometry,
  createGalacticGuide,
  createGalacticRibbon,
  createHipparcosStarfield,
  createLunarGuide,
  createOrbitGuide,
  DAY_CAM_LOCAL_POS,
  DAY_CAM_LOCAL_TARGET,
  DAY_MOON_BASE_RADIUS,
  DAY_MOON_DIR,
  DAY_MOON_POS,
  EARTH_ORBIT_RADIUS,
  type EarthCameraRig,
  getCappedPixelRatio,
  HERO_MOON_ORBIT_RADIUS,
  HERO_RIG,
  MEAN_LUNAR_DISTANCE_KM,
  MOON_ORBIT_ARRIVAL_BAND,
  MOON_ORBIT_DRIFT_ACCEL,
  MOON_ORBIT_DRIFT_SPEED,
  MOON_PHYSICAL_RADIUS,
  TIDE_ARRIVAL_BAND,
  TIDE_DRIFT_ACCEL,
  TIDE_DRIFT_SPEED,
  UP_AXIS,
} from "./sceneGeometry";
import {
  type AstroFocusMode,
  advanceSmoothAngleLinear,
  advanceSmoothLinear,
  clampDeltaTime,
  computeMoonRelAngle,
  damp,
  dirToYawPitch,
  type FlightSpace,
  flightEase,
  getModeVisualTargets,
  getTransitionDuration,
  isSceneModeInteractive,
  isSceneValueAnimating,
  negativeAngleDelta,
  phaseWeight,
  pointToSegmentDistanceXZ,
  positiveAngleDelta,
  quinticHermite,
  type SceneValueAnimationState,
  type SetModeOptions,
  shortestAngleDelta,
  shortestCycleDelta,
  TWO_PI,
  unwrapAngleNear,
  yawPitchToDir,
} from "./sceneMath";
import {
  atmosphereFragmentShader,
  atmosphereVertexShader,
  cloudsFragmentShader,
  cloudsVertexShader,
  earthFragmentShader,
  earthVertexShader,
  moonFragmentShader,
  moonHaloFragmentShader,
  moonHaloVertexShader,
  moonVertexShader,
  oceanFragmentShader,
  oceanVertexShader,
  skyboxFragmentShader,
  skyboxVertexShader,
  sunCoronaFragmentShader,
  sunCoronaVertexShader,
  sunFragmentShader,
  sunVertexShader,
} from "./shaders";

export {
  type AstroFocusMode,
  isSceneModeInteractive,
  isSceneValueAnimating,
  type SceneValueAnimationState,
  type SetModeOptions,
};

function resolveTextureBase(): string {
  const base =
    typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/";
  const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalized}/textures/astro`;
}

interface CameraFlight {
  active: boolean;
  fromMode: AstroFocusMode;
  toMode: AstroFocusMode;
  space: FlightSpace;
  elapsed: number;
  duration: number;
  arcHeight: number;
  startPos: THREE.Vector3;
  startCyl: THREE.Vector3;
  startYaw: number;
  startPitch: number;
  lastGoalAz: number;
  lastGoalYaw: number;
  velPos: THREE.Vector3;
  velCyl: THREE.Vector3;
  velYaw: number;
  velPitch: number;
  startSunScale: number;
  startSunPos: THREE.Vector3;
  startMoonOrbitRadius: number;
  startSkyBright: number;
  startSkyGamma: number;
  startSkyReveal: number;
  startWYearSky: number;
  startYearSkyDrift: number;
  startGalLonShift: number;
  startWEarth: number;
  startWOrbitalMoon: number;
  startWSun: number;
  startWMoon: number;
  startWOcean: number;
  startWGalactic: number;
  startWMonthGuide: number;
  startWYearGuide: number;
  startWDayGuide: number;
  startStarHorizonClip: number;
}

export class AstroSceneRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;

  private readonly skyGroup: THREE.Group;
  private readonly skyMesh: THREE.Mesh;
  private readonly yearSkyMesh: THREE.Mesh;
  private readonly astroSkyQuat: THREE.Quaternion;
  private readonly yearSkyQuat: THREE.Quaternion;
  private readonly yearSkyQuatWorld = new THREE.Quaternion();
  private readonly skyUniforms: {
    uSkyMap: { value: THREE.Texture };
    uBrightness: { value: number };
    uGamma: { value: number };
    uGalacticReveal: { value: number };
    uOpacity: { value: number };
  };
  private readonly yearSkyUniforms: {
    uSkyMap: { value: THREE.Texture };
    uBrightness: { value: number };
    uGamma: { value: number };
    uGalacticReveal: { value: number };
    uOpacity: { value: number };
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

  private readonly yearStageGroup: THREE.Group;
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
  private readonly sunMaterial: THREE.ShaderMaterial;
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
  private readonly earthMaterial: THREE.ShaderMaterial;
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
  private readonly orbitalMoonMaterial: THREE.ShaderMaterial;
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
  private readonly moonMaterial: THREE.ShaderMaterial;
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
    uLocalCamPos: { value: THREE.Vector3 };
    uMoonIllumination: { value: number };
    uOpacity: { value: number };
  };

  private readonly textures: THREE.Texture[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private astroState: AstroState;
  private mode: AstroFocusMode = "idle";
  private pendingMode: AstroFocusMode | null = null;
  private sceneInteractive = false;
  private onSceneInteractiveChange: ((interactive: boolean) => void) | null = null;
  private onContextRestored: (() => void) | null = null;
  private active = true;
  private pageVisible = true;
  private reducedMotion = false;
  private contextLost = false;
  private disposed = false;
  private rafId: number | null = null;
  private lastTime = 0;
  private elapsed = 0;

  private readonly camPos = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly prevCamPos = new THREE.Vector3();
  private readonly goalCamPos = new THREE.Vector3();
  private readonly goalCamTarget = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpSunDir = new THREE.Vector3();
  private readonly sunYearLocalPos = new THREE.Vector3();
  private readonly sunYearWorldPos = new THREE.Vector3();

  private curCamYaw = 0;
  private curCamPitch = 0;
  private prevCamYaw = 0;
  private prevCamPitch = 0;
  private readonly curVelPos = new THREE.Vector3();
  private readonly curVelCyl = new THREE.Vector3();
  private curVelYaw = 0;
  private curVelPitch = 0;

  private yearYaw = 0;
  private dayYaw = 0;
  private prevSmoothEpochYears = 0;
  private smoothGalLonShift = 0;
  private smoothSunScale = 0.56;
  private wYearSky = 0;
  private yearSkyDriftOffset = 0;

  private targetOrbitAngle: number;
  private smoothOrbitAngle: number;
  private monthDragging = false;
  private dragMonthFraction = 0;
  private monthDragAnchorDay: number | null = null;
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

  private wEarth = 1;
  private wOrbitalMoon = 1;
  private wSun = 1;
  private wMoon = 0;
  private wOcean = 0;
  private wGalactic = 0;
  private wMonthGuide = 0;
  private wYearGuide = 0;
  private wDayGuide = 0;
  private starHorizonClip = 0;
  private smoothSkyBright = 0.48;
  private smoothSkyGamma = 0.84;
  private smoothSkyReveal = 0.16;

  private readonly flight: CameraFlight = {
    active: false,
    fromMode: "idle",
    toMode: "idle",
    space: "cylindrical",
    elapsed: 0,
    duration: 0.9,
    arcHeight: 0,
    startPos: new THREE.Vector3(),
    startCyl: new THREE.Vector3(),
    startYaw: 0,
    startPitch: 0,
    lastGoalAz: 0,
    lastGoalYaw: 0,
    velPos: new THREE.Vector3(),
    velCyl: new THREE.Vector3(),
    velYaw: 0,
    velPitch: 0,
    startSunScale: 0.56,
    startSunPos: new THREE.Vector3(),
    startMoonOrbitRadius: HERO_MOON_ORBIT_RADIUS,
    startSkyBright: 0.48,
    startSkyGamma: 0.84,
    startSkyReveal: 0.16,
    startWYearSky: 0,
    startYearSkyDrift: 0,
    startGalLonShift: 0,
    startWEarth: 1,
    startWOrbitalMoon: 1,
    startWSun: 1,
    startWMoon: 0,
    startWOcean: 0,
    startWGalactic: 0,
    startWMonthGuide: 0,
    startWYearGuide: 0,
    startWDayGuide: 0,
    startStarHorizonClip: 0,
  };

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.stopLoop();
  };

  private readonly handleContextRestored = () => {
    this.contextLost = false;
    if (this.disposed) return;
    if (this.onContextRestored) {
      this.onContextRestored();
    } else {
      this.syncLoopState();
      this.renderSingleFrame();
    }
  };

  private constructor(canvas: HTMLCanvasElement, initialState: AstroState) {
    this.canvas = canvas;
    this.astroState = initialState;
    this.targetOrbitAngle = initialState.solar.earthHeliocentricLongitudeRad;
    this.smoothOrbitAngle = initialState.solar.earthHeliocentricLongitudeRad;
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
    this.prevSmoothEpochYears = this.smoothEpochYears;
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

    this.canvas.addEventListener("webglcontextlost", this.handleContextLost, false);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 460 / 290, 0.05, 400);

    const textureBase = resolveTextureBase();
    const loader = new THREE.TextureLoader();
    const maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const loadTex = (file: string, srgb = true) => {
      const url = `${textureBase}/${file}`;
      const tex = loader.load(
        url,
        () => {
          if (this.disposed) {
            tex.dispose();
            return;
          }
          this.renderSingleFrame();
        },
        undefined,
        () => {
          // Degrade gracefully if a texture fails to fetch (offline / CDN error)
        },
      );
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = maxAnisotropy;
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

    const collector = { geometries: this.geometries, materials: this.materials };

    this.skyGroup = new THREE.Group();
    const skyGeo = new THREE.SphereGeometry(180, 48, 32);
    this.geometries.push(skyGeo);
    this.skyUniforms = {
      uSkyMap: { value: milkyWayMap },
      uBrightness: { value: this.smoothSkyBright },
      uGamma: { value: this.smoothSkyGamma },
      uGalacticReveal: { value: this.smoothSkyReveal },
      uOpacity: { value: 1 },
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
    skyMesh.renderOrder = -2;
    skyMesh.frustumCulled = false;
    // True J2000 Galactic plane orientation for Hero/Month/Day (aligned with Hipparcos stars)
    const galBasis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...GALACTIC_ECLIPTIC_BASIS.center),
      new THREE.Vector3(...GALACTIC_ECLIPTIC_BASIS.north),
      new THREE.Vector3(...GALACTIC_ECLIPTIC_BASIS.east).negate(),
    );
    this.astroSkyQuat = new THREE.Quaternion().setFromRotationMatrix(galBasis);
    // Artistic diagonal Orion Spur framing preserved exclusively for Year view
    this.yearSkyQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.04, Math.PI * 0.5, 0.33, "ZYX"),
    );
    this.yearSkyQuatWorld.copy(this.yearSkyQuat);
    skyMesh.quaternion.copy(this.astroSkyQuat);
    this.skyMesh = skyMesh;
    this.skyGroup.add(skyMesh);

    // Separate galactic dome for Year mode so the Milky Way emerges gently from transparency
    // with only a subtle drift instead of swinging 100°+ across the fixed Hipparcos stars
    this.yearSkyUniforms = {
      uSkyMap: { value: milkyWayMap },
      uBrightness: { value: 1.02 },
      uGamma: { value: 0.74 },
      uGalacticReveal: { value: 1.0 },
      uOpacity: { value: 0 },
    };
    const yearSkyMaterial = new THREE.ShaderMaterial({
      vertexShader: skyboxVertexShader,
      fragmentShader: skyboxFragmentShader,
      uniforms: this.yearSkyUniforms,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    this.materials.push(yearSkyMaterial);
    const yearSkyMesh = new THREE.Mesh(skyGeo, yearSkyMaterial);
    yearSkyMesh.quaternion.copy(this.yearSkyQuatWorld);
    yearSkyMesh.renderOrder = -1;
    yearSkyMesh.frustumCulled = false;
    yearSkyMesh.visible = false;
    this.yearSkyMesh = yearSkyMesh;
    this.skyGroup.add(yearSkyMesh);

    const { points: starPoints, uniforms: starUniforms } = createHipparcosStarfield(
      this.astroState.lunar.illumination,
      collector,
    );
    this.starUniforms = starUniforms;
    this.skyGroup.add(starPoints);
    this.scene.add(this.skyGroup);

    this.yearStageGroup = new THREE.Group();
    const { group: galGroup, uniforms: galUniforms } = createGalacticRibbon(collector);
    this.galacticDustGroup = galGroup;
    this.galacticDustUniforms = galUniforms;
    this.yearStageGroup.add(this.galacticDustGroup);

    const { mesh: orbitGuideMesh, uniforms: orbitGuideUniforms } = createOrbitGuide(
      this.smoothOrbitAngle,
      collector,
    );
    this.orbitGuideMesh = orbitGuideMesh;
    this.orbitGuideUniforms = orbitGuideUniforms;
    this.scene.add(this.orbitGuideMesh);

    const { mesh: galacticGuideMesh, uniforms: galacticGuideUniforms } =
      createGalacticGuide(collector);
    this.galacticGuideMesh = galacticGuideMesh;
    this.galacticGuideUniforms = galacticGuideUniforms;
    this.yearStageGroup.add(this.galacticGuideMesh);
    this.scene.add(this.yearStageGroup);

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
    this.sunMaterial = sunMaterial;
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
    this.earthMaterial = earthMaterial;
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
    this.orbitalMoonMaterial = orbitalMoonMaterial;
    this.materials.push(orbitalMoonMaterial);
    this.orbitalMoonMesh = new THREE.Mesh(orbitalMoonGeo, orbitalMoonMaterial);
    this.orbitalMoonMesh.rotation.order = "YXZ";
    this.orbitalMoonGroup.add(this.orbitalMoonMesh);
    this.earthOrbitRoot.add(this.orbitalMoonGroup);

    this.scene.add(this.earthOrbitRoot);

    this.dayStageGroup = new THREE.Group();

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
    this.moonMaterial = moonMaterial;
    this.materials.push(moonMaterial);
    this.moonMesh = new THREE.Mesh(moonGeo, moonMaterial);
    this.moonMesh.position.copy(DAY_MOON_POS);
    // Orient lunar near-side facing the observer
    this.moonMesh.rotation.y = -Math.PI * 0.5;
    this.moonMesh.renderOrder = 4;
    this.dayStageGroup.add(this.moonMesh);

    const { mesh: lunarGuideMesh, uniforms: lunarGuideUniforms } = createLunarGuide(
      this.smoothDayAge,
      collector,
    );
    this.lunarGuideMesh = lunarGuideMesh;
    this.lunarGuideUniforms = lunarGuideUniforms;
    this.dayStageGroup.add(this.lunarGuideMesh);

    const oceanGeo = createCoastalGeometry(collector);
    this.oceanUniforms = {
      uTime: { value: 0 },
      uTideLevel: { value: initialState.tidal.springNeapIndex },
      uWetTideMemory: { value: initialState.tidal.springNeapIndex },
      uSwellEnergy: { value: initialState.tidal.swellEnergy },
      uMoonDir: { value: DAY_MOON_DIR.clone() },
      uLocalCamPos: { value: DAY_CAM_LOCAL_POS.clone() },
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
    this.computeEarthRigCamera(HERO_RIG, this.camPos, this.camTarget);
    this.prevCamPos.copy(this.camPos);
    const [initYaw, initPitch] = dirToYawPitch(
      this.tmpDir.copy(this.camTarget).sub(this.camPos).normalize(),
    );
    this.curCamYaw = initYaw;
    this.curCamPitch = initPitch;
    this.prevCamYaw = initYaw;
    this.prevCamPitch = initPitch;

    this.setYearYaw(Math.atan2(this.camPos.x, this.camPos.z));
    this.repositionDayStage("idle");
    this.applyUniforms();
  }

  static create(canvas: HTMLCanvasElement, initialState: AstroState): AstroSceneRenderer | null {
    try {
      return new AstroSceneRenderer(canvas, initialState);
    } catch {
      return null;
    }
  }

  setOnContextRestored(listener: (() => void) | null) {
    this.onContextRestored = listener;
  }

  resize(width: number, height: number) {
    if (this.disposed || this.contextLost || width <= 0 || height <= 0) return;
    const dpr = getCappedPixelRatio();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.starUniforms.uPixelRatio.value = dpr;
    this.galacticDustUniforms.uPixelRatio.value = dpr;
    this.renderSingleFrame();
  }

  private getNeighborMonthIso(deltaMonths: number): string {
    const cur = this.astroState.date;
    const anchorDay = this.monthDragAnchorDay ?? cur.day;
    const nextMonth = ((((cur.month - 1 + deltaMonths) % 12) + 12) % 12) + 1;
    return formatIsoDate(cur.year, nextMonth, anchorDay);
  }

  private updateMonthNeighbors() {
    const cur = this.astroState;
    this.nextMonthIso = this.getNeighborMonthIso(1);
    this.prevMonthIso = this.getNeighborMonthIso(-1);

    const nextState = computeAstroState(this.nextMonthIso);
    const prevState = computeAstroState(this.prevMonthIso);

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
    const cur = this.astroState;
    this.nextDayIso = addDateSegment(cur.isoDate, "day", 1);
    this.prevDayIso = addDateSegment(cur.isoDate, "day", -1);

    const nextState = computeAstroState(this.nextDayIso);
    const prevState = computeAstroState(this.prevDayIso);

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

  setMonthDragState(dragging: boolean, fraction: number, anchorDay?: number | null) {
    this.monthDragging = dragging;
    this.dragMonthFraction = THREE.MathUtils.clamp(fraction, -1, 1);
    const nextAnchor = dragging ? (anchorDay ?? this.monthDragAnchorDay) : null;
    if (nextAnchor !== this.monthDragAnchorDay) {
      this.monthDragAnchorDay = nextAnchor;
      this.updateMonthNeighbors();
    }
  }

  setDayDragState(dragging: boolean, fraction: number) {
    this.dayDragging = dragging;
    this.dragDayFraction = THREE.MathUtils.clamp(fraction, -1, 1);
  }

  setState(next: AstroState) {
    if (next.isoDate === this.astroState.isoDate) return;

    const prevState = this.astroState;
    const rawDeltaDays = next.solar.julianDay - prevState.solar.julianDay;
    this.astroState = next;

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

    if (!this.shouldRunLoop()) {
      if (this.pendingMode !== null) {
        const nextMode = this.pendingMode;
        this.pendingMode = null;
        this.commitMode(nextMode);
        return;
      }
      this.snapToTargets();
      this.renderSingleFrame();
    }
  }

  private setYearYaw(yaw: number) {
    this.yearYaw = yaw;
    this.yearStageGroup.rotation.y = yaw;
    this.tmpQuat.setFromAxisAngle(UP_AXIS, yaw);
    this.yearSkyQuatWorld.multiplyQuaternions(this.tmpQuat, this.yearSkyQuat);
  }

  private repositionDayStage(fromMode: AstroFocusMode) {
    if (fromMode === "idle" || fromMode === "month") {
      // Descend directly toward Earth's dark night hemisphere so entering Day feels like
      // calmly dropping from orbit through the atmosphere down onto Earth's night coastline.
      const earthPos = this.earthOrbitRoot.position;
      const dx = earthPos.x - this.camPos.x;
      const dz = earthPos.z - this.camPos.z;
      const horizDist = Math.hypot(dx, dz) || 1;
      const dirX = dx / horizDist;
      const dirZ = dz / horizDist;

      this.dayYaw = Math.atan2(-dirX, -dirZ);

      const targetSurfaceRadius = fromMode === "month" ? 0.58 : 0.64;
      const landingPos = this.tmpVec.set(
        earthPos.x - dirX * targetSurfaceRadius,
        earthPos.y + 0.08,
        earthPos.z - dirZ * targetSurfaceRadius,
      );

      const rotatedLocalCam = this.tmpDir
        .copy(DAY_CAM_LOCAL_POS)
        .applyAxisAngle(UP_AXIS, this.dayYaw);
      this.dayStageGroup.rotation.y = this.dayYaw;
      this.dayStageGroup.position.copy(landingPos).sub(rotatedLocalCam);
      return;
    }

    // From Year (galactic scale): glide forward & downward along current sightline (0° yaw spin)
    this.dayYaw = this.curCamYaw;
    const lookX = -Math.sin(this.dayYaw);
    const lookZ = -Math.cos(this.dayYaw);

    const landingPos = this.tmpVec.set(
      this.camPos.x + lookX * 3.8,
      this.camPos.y - 1.1,
      this.camPos.z + lookZ * 3.8,
    );

    const rotatedLocalCam = this.tmpDir
      .copy(DAY_CAM_LOCAL_POS)
      .applyAxisAngle(UP_AXIS, this.dayYaw);
    this.dayStageGroup.rotation.y = this.dayYaw;
    this.dayStageGroup.position.copy(landingPos).sub(rotatedLocalCam);
  }

  private updateSunYearGoal() {
    const ambientTime = this.reducedMotion ? 0 : this.elapsed;
    const galPhase = this.smoothEpochYears * 0.042;
    this.sunYearLocalPos.set(
      Math.sin(galPhase * 0.45) * 1.45 + Math.sin(ambientTime * 0.14) * 0.06,
      Math.sin(galPhase * 0.45) * 0.48 + Math.cos(ambientTime * 0.11) * 0.035,
      Math.cos(galPhase * 0.45) * 0.35 - 0.35,
    );
    this.sunYearWorldPos.copy(this.sunYearLocalPos).applyAxisAngle(UP_AXIS, this.yearYaw);
  }

  private startFlight(fromMode: AstroFocusMode, toMode: AstroFocusMode) {
    const wasFlying = this.flight.active;
    const prevFromMode = this.flight.fromMode;
    const prevProgress = wasFlying
      ? THREE.MathUtils.clamp(this.flight.elapsed / Math.max(this.flight.duration, 1e-4), 0, 1)
      : 1;

    if (toMode === "year") {
      // Align the galactic stage to the camera's current azimuth so transitioning into Year
      // is a single serene pan/pull-out without ever spinning or crossing through the Sun.
      if (fromMode === "day" && this.wOcean > 0.25) {
        this.setYearYaw(this.dayYaw);
      } else {
        this.setYearYaw(Math.atan2(this.camPos.x, this.camPos.z));
      }
      this.updateSunYearGoal();
    } else if (toMode === "day" && this.wOcean < 0.15) {
      this.repositionDayStage(fromMode);
    }

    this.computeModeCameraGoal(toMode, this.goalCamPos, this.goalCamTarget);

    let space: FlightSpace = "cylindrical";
    let arcHeight = 0;
    if (toMode === "day" || fromMode === "day") {
      arcHeight =
        fromMode === "month" || toMode === "month"
          ? 0.32
          : fromMode === "year" || toMode === "year"
            ? 0.26
            : 0.2;
      if (toMode === "day") {
        space = "cartesian";
      } else {
        // Day -> Idle/Month/Year: lift straight back off the beach unless the path crosses near the Sun
        const startAz = Math.atan2(this.camPos.x, this.camPos.z);
        const goalAz = Math.atan2(this.goalCamPos.x, this.goalCamPos.z);
        const azDiff = Math.abs(shortestAngleDelta(startAz, goalAz));
        const sunClearance = pointToSegmentDistanceXZ(
          0,
          0,
          this.camPos.x,
          this.camPos.z,
          this.goalCamPos.x,
          this.goalCamPos.z,
        );
        space = azDiff > 0.72 || sunClearance < 2.6 ? "cylindrical" : "cartesian";
      }
    }

    const baseDuration = getTransitionDuration(fromMode, toMode);
    // If reversing a partial flight mid-way, scale duration proportionally so quick redirects feel crisp
    const duration =
      wasFlying && toMode === prevFromMode
        ? baseDuration * THREE.MathUtils.clamp(0.55 + 0.45 * prevProgress, 0.55, 1.0)
        : baseDuration;

    const f = this.flight;
    f.active = true;
    f.fromMode = fromMode;
    f.toMode = toMode;
    f.space = space;
    f.elapsed = 0;
    f.duration = duration;
    f.arcHeight = arcHeight;

    f.startPos.copy(this.camPos);
    f.startCyl.set(
      Math.atan2(this.camPos.x, this.camPos.z),
      Math.hypot(this.camPos.x, this.camPos.z),
      this.camPos.y,
    );
    f.startYaw = this.curCamYaw;
    f.startPitch = this.curCamPitch;

    const initGoalAz = Math.atan2(this.goalCamPos.x, this.goalCamPos.z);
    f.lastGoalAz = f.startCyl.x + shortestAngleDelta(f.startCyl.x, initGoalAz);
    const [initGoalYaw] = dirToYawPitch(
      this.tmpDir.copy(this.goalCamTarget).sub(this.goalCamPos).normalize(),
    );
    f.lastGoalYaw = f.startYaw + shortestAngleDelta(f.startYaw, initGoalYaw);

    if (wasFlying) {
      f.velPos.copy(this.curVelPos);
      f.velCyl.copy(this.curVelCyl);
      f.velYaw = this.curVelYaw;
      f.velPitch = this.curVelPitch;
    } else {
      f.velPos.set(0, 0, 0);
      f.velCyl.set(0, 0, 0);
      f.velYaw = 0;
      f.velPitch = 0;
    }

    f.startSunScale =
      this.wSun < 0.01 ? getModeVisualTargets(toMode).sunScale : this.smoothSunScale;
    f.startSunPos.copy(
      this.wSun < 0.01 && toMode === "year" ? this.sunYearWorldPos : this.sunGroup.position,
    );
    const moonDistFactor = this.astroState.lunar.distanceKm / MEAN_LUNAR_DISTANCE_KM;
    const destMoonOrbitRadius =
      (toMode === "month" ? CAROUSEL_MOON_ORBIT_RADIUS : HERO_MOON_ORBIT_RADIUS) * moonDistFactor;
    f.startMoonOrbitRadius =
      this.wOrbitalMoon < 0.01 ? destMoonOrbitRadius : this.smoothMoonOrbitRadius;
    const destTargets = getModeVisualTargets(toMode);
    if (this.wYearSky > 0.99 && toMode !== "year") {
      // Leaving Year while astro sky is fully covered: align astro sky directly to destination
      // so cross-fading Year out cleanly reveals the destination sky without brightness jumps
      f.startSkyBright = destTargets.skyBright;
      f.startSkyGamma = destTargets.skyGamma;
      f.startSkyReveal = destTargets.skyReveal;
    } else {
      f.startSkyBright = this.smoothSkyBright;
      f.startSkyGamma = this.smoothSkyGamma;
      f.startSkyReveal = this.smoothSkyReveal;
    }
    f.startWYearSky = this.wYearSky;
    f.startYearSkyDrift =
      toMode === "year" && this.wYearSky < 0.05 ? -0.045 : this.yearSkyDriftOffset;
    f.startGalLonShift = shortestAngleDelta(0, this.smoothGalLonShift);

    f.startWEarth = this.wEarth;
    f.startWOrbitalMoon = this.wOrbitalMoon;
    f.startWSun = this.wSun;
    f.startWMoon = this.wMoon;
    f.startWOcean = this.wOcean;
    f.startWGalactic = this.wGalactic;
    f.startWMonthGuide = this.wMonthGuide;
    f.startWYearGuide = this.wYearGuide;
    f.startWDayGuide = this.wDayGuide;
    f.startStarHorizonClip = this.starHorizonClip;
  }

  private isCurrentValueAnimating(): boolean {
    if (!this.shouldRunLoop()) return false;

    const monthFraction = this.dragMonthFraction;
    const orbitOffset =
      monthFraction >= 0
        ? monthFraction * this.nextOrbitDelta
        : -monthFraction * this.prevOrbitDelta;
    const dayFraction = this.dragDayFraction;
    const dayElongOffset =
      dayFraction >= 0
        ? dayFraction * this.nextDayElongDelta
        : -dayFraction * this.prevDayElongDelta;
    const dayAgeOffset =
      dayFraction >= 0 ? dayFraction * this.nextDayAgeDelta : -dayFraction * this.prevDayAgeDelta;

    return isSceneValueAnimating({
      mode: this.mode,
      flightActive: this.flight.active,
      orbitError: Math.abs(this.targetOrbitAngle + orbitOffset - this.smoothOrbitAngle),
      dayElongError: Math.abs(this.targetDayElong + dayElongOffset - this.smoothMoonElong),
      dayAgeError: Math.abs(this.targetDayAge + dayAgeOffset - this.smoothDayAge),
      epochYearsError: Math.abs(
        this.astroState.galactic.epochYearsSinceJ2000 - this.smoothEpochYears,
      ),
      sunYearPosError: this.sunGroup.position.distanceTo(this.sunYearWorldPos),
    });
  }

  private getFlightProgress(): number {
    if (!this.flight.active) return 1;
    return THREE.MathUtils.clamp(this.flight.elapsed / Math.max(this.flight.duration, 1e-4), 0, 1);
  }

  isModeInteractive(mode: AstroFocusMode): boolean {
    return isSceneModeInteractive(
      this.mode,
      mode,
      this.pendingMode,
      this.flight.active,
      this.getFlightProgress(),
    );
  }

  setOnSceneInteractiveChange(listener: ((interactive: boolean) => void) | null) {
    this.onSceneInteractiveChange = listener;
    listener?.(this.sceneInteractive);
  }

  private syncSceneInteractive() {
    const next =
      this.mode !== "idle" &&
      isSceneModeInteractive(
        this.mode,
        this.mode,
        this.pendingMode,
        this.flight.active,
        this.getFlightProgress(),
      );
    if (next !== this.sceneInteractive) {
      this.sceneInteractive = next;
      this.onSceneInteractiveChange?.(next);
    }
  }

  setMode(mode: AstroFocusMode, options?: SetModeOptions) {
    if (this.mode === mode) {
      this.pendingMode = null;
      this.syncSceneInteractive();
      return;
    }

    if (options?.deferUntilValueSettled && this.isCurrentValueAnimating()) {
      this.pendingMode = mode;
      this.syncSceneInteractive();
      return;
    }

    this.pendingMode = null;
    this.commitMode(mode);
  }

  private commitMode(mode: AstroFocusMode) {
    if (this.mode === mode) {
      this.syncSceneInteractive();
      return;
    }
    const prevMode = this.mode;
    this.mode = mode;

    if (mode !== "month") {
      this.monthDragging = false;
      this.dragMonthFraction = 0;
      if (this.monthDragAnchorDay !== null) {
        this.monthDragAnchorDay = null;
        this.updateMonthNeighbors();
      }
    }
    if (mode !== "day") {
      this.dayDragging = false;
      this.dragDayFraction = 0;
    } else if (this.wOcean < 0.01) {
      // Entering Day mode while ocean is hidden: align immediately to the current date's tidal level
      this.smoothTideLevel = this.astroState.tidal.springNeapIndex;
      this.smoothWetTideMemory = this.smoothTideLevel;
      this.smoothSwellEnergy = this.astroState.tidal.swellEnergy;
      this.tideVelocity = 0;
      this.swellVelocity = 0;
    }

    if (!this.shouldRunLoop()) {
      if (mode === "year") {
        this.setYearYaw(
          prevMode === "day" ? this.dayYaw : Math.atan2(this.camPos.x, this.camPos.z),
        );
      } else if (mode === "day") {
        this.repositionDayStage(prevMode);
      }
      this.snapToTargets();
      this.renderSingleFrame();
      return;
    }

    this.startFlight(prevMode, mode);
    this.syncSceneInteractive();
  }

  private shouldRunLoop(): boolean {
    return (
      !this.disposed && this.active && this.pageVisible && !this.reducedMotion && !this.contextLost
    );
  }

  private stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private syncLoopState() {
    if (this.shouldRunLoop()) {
      if (this.rafId === null) {
        this.lastTime = performance.now();
        this.rafId = requestAnimationFrame(this.loop);
      }
    } else {
      this.stopLoop();
    }
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    if (reduced) {
      this.stopLoop();
      if (this.pendingMode !== null) {
        const nextMode = this.pendingMode;
        this.pendingMode = null;
        this.commitMode(nextMode);
        return;
      }
      this.snapToTargets();
      this.renderSingleFrame();
    } else {
      this.syncLoopState();
    }
  }

  setActive(active: boolean) {
    this.active = active;
    this.syncLoopState();
  }

  setPageVisible(visible: boolean) {
    this.pageVisible = visible;
    this.syncLoopState();
  }

  start() {
    if (this.disposed) return;
    this.renderSingleFrame();
    this.syncLoopState();
  }

  dispose() {
    this.disposed = true;
    this.onSceneInteractiveChange = null;
    this.onContextRestored = null;
    this.stopLoop();
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost, false);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored, false);
    for (const tex of this.textures) tex.dispose();
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
    this.renderer.dispose();
  }

  private snapToTargets() {
    this.flight.active = false;
    this.syncSceneInteractive();
    this.monthDragging = false;
    this.dragMonthFraction = 0;
    if (this.monthDragAnchorDay !== null) {
      this.monthDragAnchorDay = null;
      this.updateMonthNeighbors();
    }
    this.dayDragging = false;
    this.dragDayFraction = 0;

    this.targetOrbitAngle = this.astroState.solar.earthHeliocentricLongitudeRad;
    this.smoothOrbitAngle = this.targetOrbitAngle;
    this.smoothOrbitRadius = EARTH_ORBIT_RADIUS * this.astroState.solar.earthSunDistanceAU;
    this.targetSpinAngle = this.astroState.solar.gmstRad;
    this.smoothSpinAngle = this.targetSpinAngle;
    this.smoothMoonRelAngle = computeMoonRelAngle(this.astroState);
    this.moonRelVelocity = 0;
    this.smoothMoonLat = this.astroState.lunar.latitudeRad;
    this.smoothEarthScale = this.mode === "month" ? CAROUSEL_EARTH_SCALE : 1;
    const moonDistFactor = this.astroState.lunar.distanceKm / MEAN_LUNAR_DISTANCE_KM;
    this.smoothMoonOrbitRadius =
      (this.mode === "month" ? CAROUSEL_MOON_ORBIT_RADIUS : HERO_MOON_ORBIT_RADIUS) *
      moonDistFactor;

    this.targetDayElong = this.astroState.lunar.elongationRad;
    this.smoothMoonElong = this.targetDayElong;
    this.targetDayAge = this.astroState.lunar.synodicAgeDays;
    this.smoothDayAge = this.targetDayAge;
    this.smoothDayLat = this.astroState.lunar.latitudeRad;
    this.smoothDayLibLon = this.astroState.lunar.librationLonRad;
    this.smoothDayLibLat = this.astroState.lunar.librationLatRad;
    this.smoothMoonIllum = this.astroState.lunar.illumination;
    this.smoothMoonEarthshine = this.astroState.lunar.earthshine;
    this.smoothMoonScale = this.astroState.lunar.apparentScale;

    this.smoothTideLevel = this.astroState.tidal.springNeapIndex;
    this.smoothWetTideMemory = this.smoothTideLevel;
    this.smoothSwellEnergy = this.astroState.tidal.swellEnergy;
    this.tideVelocity = 0;
    this.swellVelocity = 0;

    this.smoothEpochYears = this.astroState.galactic.epochYearsSinceJ2000;
    this.prevSmoothEpochYears = this.smoothEpochYears;
    this.smoothPrecession = this.astroState.galactic.axialPrecessionRad;
    if (this.mode !== "year") {
      this.smoothGalLonShift = 0;
    }

    const targets = getModeVisualTargets(this.mode);
    this.wEarth = targets.wEarth;
    this.wOrbitalMoon = targets.wOrbitalMoon;
    this.wSun = targets.wSun;
    this.wMoon = targets.wMoon;
    this.wOcean = targets.wOcean;
    this.wGalactic = targets.wGalactic;
    this.wMonthGuide = targets.wMonthGuide;
    this.wYearGuide = targets.wYearGuide;
    this.wDayGuide = targets.wDayGuide;
    this.starHorizonClip = targets.starHorizonClip;
    this.smoothSkyBright = targets.skyBright;
    this.smoothSkyGamma = targets.skyGamma;
    this.smoothSkyReveal = targets.skyReveal;
    this.wYearSky = this.mode === "year" ? 1 : 0;
    this.yearSkyDriftOffset = 0;
    this.smoothSunScale = targets.sunScale;

    this.updateSunYearGoal();
    if (this.mode === "year") {
      this.sunGroup.position.copy(this.sunYearWorldPos);
    } else {
      this.sunGroup.position.set(0, 0, 0);
    }
    this.sunGroup.scale.setScalar(this.smoothSunScale);

    this.updateOrbitTransform(0);
    this.computeModeCameraGoal(this.mode, this.camPos, this.camTarget);
    const [yaw, pitch] = dirToYawPitch(
      this.tmpDir.copy(this.camTarget).sub(this.camPos).normalize(),
    );
    this.curCamYaw = yaw;
    this.curCamPitch = pitch;
    this.prevCamPos.copy(this.camPos);
    this.prevCamYaw = yaw;
    this.prevCamPitch = pitch;
    this.curVelPos.set(0, 0, 0);
    this.curVelCyl.set(0, 0, 0);
    this.curVelYaw = 0;
    this.curVelPitch = 0;

    this.applyUniforms();
  }

  private updateOrbitTransform(dt: number) {
    // True heliocentric position in right-handed ecliptic coordinates (+X = Vernal Equinox, -Z = Summer Solstice Sun)
    const ex = Math.cos(this.smoothOrbitAngle) * this.smoothOrbitRadius;
    const ez = -Math.sin(this.smoothOrbitAngle) * this.smoothOrbitRadius;
    this.earthOrbitRoot.position.set(ex, 0, ez);

    // Fixed inertial axial obliquity around +X (North Pole tilts toward -Z = Summer Solstice Sun)
    this.earthAxisGroup.rotation.set(-this.astroState.solar.obliquityRad, 0, 0);
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
    // Tidally lock lunar near-side (+X on Three.js SphereGeometry at u=0.5) toward Earth
    // with exact IAU optical libration (longitude l' and latitude b' including Cassini obliquity)
    this.orbitalMoonMesh.rotation.set(
      0,
      moonLon + Math.PI - this.smoothDayLibLon,
      -(this.smoothMoonLat + this.smoothDayLibLat),
    );
    // Use true parallel heliocentric Sun rays (real Sun is ~390x farther than the Moon) so
    // the Orbital Moon shows exact astronomical phase & matches the Day Moon terminator 1:1
    this.orbitalMoonUniforms.uSunDir.value.copy(this.tmpSunDir);

    const ambientTime = this.reducedMotion ? 0 : this.elapsed;
    this.updateSunYearGoal();
    if (this.mode === "year" || this.wGalactic > 0.005) {
      this.galacticDustUniforms.uDrift.value = this.smoothEpochYears * 0.36 + ambientTime * 0.085;
    }

    if (!this.flight.active) {
      if (this.mode === "year") {
        const stepDt = dt > 0 ? dt : 0.016;
        this.sunGroup.position.set(
          damp(this.sunGroup.position.x, this.sunYearWorldPos.x, 6, stepDt),
          damp(this.sunGroup.position.y, this.sunYearWorldPos.y, 6, stepDt),
          damp(this.sunGroup.position.z, this.sunYearWorldPos.z, 6, stepDt),
        );
      } else {
        this.sunGroup.position.set(0, 0, 0);
      }
      this.sunGroup.scale.setScalar(this.smoothSunScale);
    }

    this.orbitGuideMesh.scale.set(this.smoothOrbitRadius, 1, this.smoothOrbitRadius);
    // Keep galactic guide locked on the Sun's center inside yearStageGroup local space
    this.galacticGuideMesh.position
      .copy(this.sunGroup.position)
      .applyAxisAngle(UP_AXIS, -this.yearYaw);

    // Northern Hemisphere lunar orientation rotated into dayStageGroup's world yaw
    const [moonSunX, moonSunY, moonSunZ] = computeLunarSunDirectionObserver(
      this.smoothMoonElong,
      this.smoothDayLat,
    );
    this.moonUniforms.uSunDir.value
      .set(moonSunX, moonSunY, moonSunZ)
      .applyAxisAngle(UP_AXIS, this.dayYaw)
      .normalize();
    this.moonMesh.scale.setScalar(this.smoothMoonScale);
    this.moonMesh.rotation.y = -Math.PI * 0.5 - this.smoothDayLibLon;
    this.moonMesh.rotation.x = this.smoothDayLibLat;
  }

  private computeEarthRigCamera(
    rig: EarthCameraRig,
    outPos: THREE.Vector3,
    outTarget: THREE.Vector3,
  ) {
    const camAngle = this.smoothOrbitAngle;
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
      anchorX + radialOutX * rig.radial + tangentX * (rig.tangent + swayTangent),
      rig.height + swayY,
      anchorZ + radialOutZ * rig.radial + tangentZ * (rig.tangent + swayTangent),
    );

    outTarget.set(anchorX * rig.targetWeight, rig.targetY, anchorZ * rig.targetWeight);
  }

  private computeYearCamera(outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    const t = this.reducedMotion ? 0 : this.elapsed;
    const swayX = Math.sin(t * 0.16) * 0.065;
    const swayY = Math.cos(t * 0.13) * 0.04;
    const epochDrift = Math.sin(this.smoothEpochYears * 0.019) * 0.45;
    outPos
      .set(epochDrift * 0.6 + swayX * 1.4, 0.25 + epochDrift * 0.12 + swayY * 1.2, 8.6)
      .applyAxisAngle(UP_AXIS, this.yearYaw);
    outTarget
      .set(this.sunYearLocalPos.x * 0.42, this.sunYearLocalPos.y * 0.3, -1.2)
      .applyAxisAngle(UP_AXIS, this.yearYaw);
  }

  private computeDayCamera(outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    // Coastal Day mode: static tripod framing in dayStageGroup's local frame (rotated by dayYaw)
    outPos
      .copy(DAY_CAM_LOCAL_POS)
      .applyAxisAngle(UP_AXIS, this.dayYaw)
      .add(this.dayStageGroup.position);
    outTarget
      .copy(DAY_CAM_LOCAL_TARGET)
      .applyAxisAngle(UP_AXIS, this.dayYaw)
      .add(this.dayStageGroup.position);
  }

  private computeModeCameraGoal(
    mode: AstroFocusMode,
    outPos: THREE.Vector3,
    outTarget: THREE.Vector3,
  ) {
    if (mode === "idle") {
      this.computeEarthRigCamera(HERO_RIG, outPos, outTarget);
    } else if (mode === "month") {
      this.computeEarthRigCamera(CAROUSEL_RIG, outPos, outTarget);
    } else if (mode === "year") {
      this.computeYearCamera(outPos, outTarget);
    } else {
      this.computeDayCamera(outPos, outTarget);
    }
  }

  private stepFlight(dt: number) {
    const f = this.flight;
    f.elapsed += dt;
    const u = THREE.MathUtils.clamp(f.elapsed / Math.max(f.duration, 1e-4), 0, 1);
    const s = flightEase(u);

    const targets = getModeVisualTargets(f.toMode);
    const moonDistFactor = this.astroState.lunar.distanceKm / MEAN_LUNAR_DISTANCE_KM;
    const targetMoonOrbitRadius =
      (f.toMode === "month" ? CAROUSEL_MOON_ORBIT_RADIUS : HERO_MOON_ORBIT_RADIUS) * moonDistFactor;

    // Smoothly phased choreography:
    // - Guides retract early [0.00..0.26] on exit and draw in softly [0.38..0.90] on arrival
    // - When descending to Day, keep Earth visible deeper into the dive so it swells beneath
    //   you right before atmospheric entry dissolves seamlessly into the night ocean
    const earthOutStart = f.toMode === "day" ? 0.22 : 0.14;
    const earthOutEnd = f.toMode === "day" ? 0.52 : 0.48;
    const dayInStart = f.fromMode === "idle" || f.fromMode === "month" ? 0.3 : 0.28;
    const dayInEnd = f.fromMode === "idle" || f.fromMode === "month" ? 0.78 : 0.76;

    this.wEarth = phaseWeight(
      f.startWEarth,
      targets.wEarth,
      u,
      0.26,
      0.7,
      earthOutStart,
      earthOutEnd,
    );
    this.wOrbitalMoon = phaseWeight(
      f.startWOrbitalMoon,
      targets.wOrbitalMoon,
      u,
      0.26,
      0.7,
      0.12,
      0.44,
    );
    this.wSun = phaseWeight(f.startWSun, targets.wSun, u, 0.24, 0.8, 0.08, 0.6);
    this.wMoon = phaseWeight(f.startWMoon, targets.wMoon, u, dayInStart, dayInEnd, 0.05, 0.42);
    this.wOcean = phaseWeight(f.startWOcean, targets.wOcean, u, dayInStart, dayInEnd, 0.05, 0.42);
    this.wGalactic = phaseWeight(f.startWGalactic, targets.wGalactic, u, 0.22, 0.82, 0.05, 0.44);
    this.wMonthGuide = phaseWeight(
      f.startWMonthGuide,
      targets.wMonthGuide,
      u,
      0.38,
      0.9,
      0.0,
      0.26,
    );
    this.wYearGuide = phaseWeight(f.startWYearGuide, targets.wYearGuide, u, 0.38, 0.9, 0.0, 0.26);
    this.wDayGuide = phaseWeight(f.startWDayGuide, targets.wDayGuide, u, 0.4, 0.9, 0.0, 0.26);
    this.starHorizonClip = phaseWeight(
      f.startStarHorizonClip,
      targets.starHorizonClip,
      u,
      0.28,
      0.78,
      0.06,
      0.44,
    );

    if (f.toMode !== "year") {
      this.smoothSkyBright = THREE.MathUtils.lerp(f.startSkyBright, targets.skyBright, s);
      this.smoothSkyGamma = THREE.MathUtils.lerp(f.startSkyGamma, targets.skyGamma, s);
      this.smoothSkyReveal = THREE.MathUtils.lerp(f.startSkyReveal, targets.skyReveal, s);
    }

    const targetWYearSky = f.toMode === "year" ? 1 : 0;
    this.wYearSky = phaseWeight(f.startWYearSky, targetWYearSky, u, 0.12, 0.88, 0.06, 0.72);
    const targetYearSkyDrift = f.toMode === "year" ? 0 : 0.045;
    this.yearSkyDriftOffset = THREE.MathUtils.lerp(f.startYearSkyDrift, targetYearSkyDrift, s);

    if (f.toMode !== "year") {
      this.smoothGalLonShift = THREE.MathUtils.lerp(f.startGalLonShift, 0, s);
    }

    this.smoothSunScale = THREE.MathUtils.lerp(f.startSunScale, targets.sunScale, s);
    this.sunGroup.scale.setScalar(this.smoothSunScale);

    const targetSunPos = f.toMode === "year" ? this.sunYearWorldPos : this.tmpVec.set(0, 0, 0);
    this.sunGroup.position.lerpVectors(f.startSunPos, targetSunPos, s);
    this.galacticGuideMesh.position
      .copy(this.sunGroup.position)
      .applyAxisAngle(UP_AXIS, -this.yearYaw);

    this.smoothMoonOrbitRadius = THREE.MathUtils.lerp(
      f.startMoonOrbitRadius,
      targetMoonOrbitRadius,
      s,
    );
    const moonLon = this.smoothOrbitAngle + this.smoothMoonRelAngle;
    const cosMoonLat = Math.cos(this.smoothMoonLat);
    this.orbitalMoonGroup.position.set(
      cosMoonLat * Math.cos(moonLon) * this.smoothMoonOrbitRadius,
      Math.sin(this.smoothMoonLat) * this.smoothMoonOrbitRadius,
      -cosMoonLat * Math.sin(moonLon) * this.smoothMoonOrbitRadius,
    );

    // Evaluate live camera goal for destination mode so orbit/drag/sway merges cleanly at arrival
    this.computeModeCameraGoal(f.toMode, this.goalCamPos, this.goalCamTarget);

    // Subtle bell-curve flare arc for smooth spacecraft-like coastal descent/liftoff
    const flare = f.arcHeight * 16 * s * s * (1 - s) * (1 - s);

    if (f.space === "cylindrical") {
      const goalAz = Math.atan2(this.goalCamPos.x, this.goalCamPos.z);
      const goalR = Math.hypot(this.goalCamPos.x, this.goalCamPos.z);
      const goalY = this.goalCamPos.y;
      f.lastGoalAz += shortestAngleDelta(f.lastGoalAz, goalAz);

      const az = quinticHermite(f.startCyl.x, f.lastGoalAz, f.velCyl.x, f.duration, u);
      const r = quinticHermite(f.startCyl.y, goalR, f.velCyl.y, f.duration, u);
      const y = quinticHermite(f.startCyl.z, goalY, f.velCyl.z, f.duration, u) + flare;
      this.camPos.set(Math.sin(az) * r, y, Math.cos(az) * r);
    } else {
      this.camPos.set(
        quinticHermite(f.startPos.x, this.goalCamPos.x, f.velPos.x, f.duration, u),
        quinticHermite(f.startPos.y, this.goalCamPos.y, f.velPos.y, f.duration, u) + flare,
        quinticHermite(f.startPos.z, this.goalCamPos.z, f.velPos.z, f.duration, u),
      );
    }

    // Interpolate camera orientation directly in spherical (yaw, pitch) for cinema-grade
    // constant-feel angular pan rate free of perspective-distance speed distortion
    const [goalYaw, goalPitch] = dirToYawPitch(
      this.tmpDir.copy(this.goalCamTarget).sub(this.goalCamPos).normalize(),
    );
    f.lastGoalYaw += shortestAngleDelta(f.lastGoalYaw, goalYaw);
    this.curCamYaw = shortestAngleDelta(
      0,
      quinticHermite(f.startYaw, f.lastGoalYaw, f.velYaw, f.duration, u),
    );
    this.curCamPitch = THREE.MathUtils.clamp(
      quinticHermite(f.startPitch, goalPitch, f.velPitch, f.duration, u),
      -Math.PI * 0.48,
      Math.PI * 0.48,
    );

    yawPitchToDir(this.curCamYaw, this.curCamPitch, this.tmpDir);
    this.camTarget.copy(this.camPos).addScaledVector(this.tmpDir, 10);

    if (u >= 1) {
      f.active = false;
    }
    this.syncSceneInteractive();
  }

  private applyUniforms() {
    this.earthUniforms.uSunDir.value.copy(this.tmpSunDir);
    this.earthUniforms.uCloudOffset.value = this.elapsed * (this.reducedMotion ? 0 : 0.0022);
    this.earthUniforms.uOpacity.value = this.wEarth;
    this.earthMaterial.depthWrite = this.wEarth > 0.98;

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
    this.orbitalMoonMaterial.depthWrite = this.wOrbitalMoon > 0.98;
    this.orbitalMoonGroup.visible = this.wOrbitalMoon > 0.005;

    this.sunUniforms.uTime.value = this.elapsed;
    this.sunUniforms.uOpacity.value = this.wSun;
    this.sunMaterial.depthWrite = this.wSun > 0.98;
    this.sunCoronaUniforms.uTime.value = this.elapsed;
    this.sunCoronaUniforms.uOpacity.value = this.wSun;
    this.sunGroup.visible = this.wSun > 0.005;

    this.moonUniforms.uEarthshine.value = this.smoothMoonEarthshine;
    this.moonUniforms.uOpacity.value = this.wMoon;
    this.moonMaterial.depthWrite = this.wMoon > 0.98;
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
    this.oceanUniforms.uLocalCamPos.value
      .copy(this.camPos)
      .sub(this.dayStageGroup.position)
      .applyAxisAngle(UP_AXIS, -this.dayYaw);
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

    this.skyMesh.visible = this.wYearSky < 0.995;
    this.skyGroup.rotation.y = this.smoothPrecession + this.smoothGalLonShift;
    this.skyUniforms.uBrightness.value = this.smoothSkyBright;
    this.skyUniforms.uGamma.value = this.smoothSkyGamma;
    this.skyUniforms.uGalacticReveal.value = this.smoothSkyReveal;

    this.tmpQuat.setFromAxisAngle(UP_AXIS, this.yearSkyDriftOffset);
    this.yearSkyMesh.quaternion.multiplyQuaternions(this.tmpQuat, this.yearSkyQuatWorld);
    this.yearSkyUniforms.uOpacity.value = this.wYearSky;
    this.yearSkyMesh.visible = this.wYearSky > 0.005;
    this.starUniforms.uTime.value = this.reducedMotion ? 0 : this.elapsed;
    this.starUniforms.uSizeScale.value = THREE.MathUtils.lerp(1, 1.24, this.starHorizonClip);
    this.starUniforms.uHorizonClip.value = this.starHorizonClip;
    this.starUniforms.uMoonDir.value
      .copy(DAY_MOON_DIR)
      .applyAxisAngle(UP_AXIS, this.dayYaw)
      .normalize();
    this.starUniforms.uMoonIllum.value = this.smoothMoonIllum;

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.skyGroup.position.copy(this.camera.position);
    this.sunCoronaMesh.quaternion.copy(this.camera.quaternion);
    // Cancel dayStageGroup's Y-yaw so moonHaloMesh stays strictly camera-facing in world space
    this.tmpQuat.setFromAxisAngle(UP_AXIS, -this.dayYaw);
    this.moonHaloMesh.quaternion.multiplyQuaternions(this.tmpQuat, this.camera.quaternion);
  }

  private renderSingleFrame() {
    if (this.disposed || this.contextLost) return;
    this.renderer.render(this.scene, this.camera);
  }

  private readonly loop = (now: number) => {
    if (!this.shouldRunLoop()) {
      this.rafId = null;
      return;
    }

    const dt = clampDeltaTime(now, this.lastTime);
    this.lastTime = now;
    this.elapsed += dt;

    const orbitLambda = this.monthDragging ? 12.5 : 6.5;
    const dayLambda = this.dayDragging ? 18.0 : 9.5;
    const astroLambda = 7.5;
    const settleLambda = 6.0;

    const dragFraction = this.dragMonthFraction;
    const orbitOffset =
      dragFraction >= 0 ? dragFraction * this.nextOrbitDelta : -dragFraction * this.prevOrbitDelta;
    const spinOffset =
      dragFraction >= 0 ? dragFraction * this.nextSpinDelta : -dragFraction * this.prevSpinDelta;
    const effectiveOrbitTarget = this.targetOrbitAngle + orbitOffset;
    const effectiveSpinTarget = this.targetSpinAngle + spinOffset;

    this.smoothOrbitAngle = damp(this.smoothOrbitAngle, effectiveOrbitTarget, orbitLambda, dt);

    // Keep Earth's axial spin locked to the same damper as Earth's orbit
    this.smoothSpinAngle = damp(this.smoothSpinAngle, effectiveSpinTarget, orbitLambda, dt);

    // Steady, velocity-ramped lunar catch-up relative to Earth while co-orbiting the Sun with Earth
    const baseMoonRel = computeMoonRelAngle(this.astroState);
    const moonRelOffset =
      dragFraction >= 0
        ? dragFraction * this.nextMoonRelDelta
        : -dragFraction * this.prevMoonRelDelta;
    const targetMoonRelAngle = shortestAngleDelta(0, baseMoonRel + moonRelOffset);

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

    const targetMoonLat =
      dragFraction >= 0
        ? THREE.MathUtils.lerp(this.astroState.lunar.latitudeRad, this.nextMoonLat, dragFraction)
        : THREE.MathUtils.lerp(this.astroState.lunar.latitudeRad, this.prevMoonLat, -dragFraction);
    this.smoothMoonLat = damp(this.smoothMoonLat, targetMoonLat, 3.2, dt);

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
    }

    const baseRadius = EARTH_ORBIT_RADIUS * this.astroState.solar.earthSunDistanceAU;
    const targetRadius =
      dragFraction >= 0
        ? THREE.MathUtils.lerp(baseRadius, this.nextOrbitRadius, dragFraction)
        : THREE.MathUtils.lerp(baseRadius, this.prevOrbitRadius, -dragFraction);
    this.smoothOrbitRadius = damp(this.smoothOrbitRadius, targetRadius, orbitLambda, dt);

    const targetEarthScale = this.mode === "month" ? CAROUSEL_EARTH_SCALE : 1;
    this.smoothEarthScale = damp(this.smoothEarthScale, targetEarthScale, settleLambda, dt);

    if (!this.flight.active && (this.mode === "idle" || this.mode === "month")) {
      const moonDistFactor = this.astroState.lunar.distanceKm / MEAN_LUNAR_DISTANCE_KM;
      const targetMoonOrbitRadius =
        (this.mode === "month" ? CAROUSEL_MOON_ORBIT_RADIUS : HERO_MOON_ORBIT_RADIUS) *
        moonDistFactor;
      this.smoothMoonOrbitRadius = damp(
        this.smoothMoonOrbitRadius,
        targetMoonOrbitRadius,
        settleLambda,
        dt,
      );
    }

    // 1:1 continuous sub-day lunar phase & guide interpolation during Day dragging
    const dayFraction = this.dragDayFraction;
    const dayElongOffset =
      dayFraction >= 0
        ? dayFraction * this.nextDayElongDelta
        : -dayFraction * this.prevDayElongDelta;
    const dayAgeOffset =
      dayFraction >= 0 ? dayFraction * this.nextDayAgeDelta : -dayFraction * this.prevDayAgeDelta;
    const targetDayLat =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(this.astroState.lunar.latitudeRad, this.nextDayLat, dayFraction)
        : THREE.MathUtils.lerp(this.astroState.lunar.latitudeRad, this.prevDayLat, -dayFraction);
    const targetDayScale =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(this.astroState.lunar.apparentScale, this.nextDayScale, dayFraction)
        : THREE.MathUtils.lerp(
            this.astroState.lunar.apparentScale,
            this.prevDayScale,
            -dayFraction,
          );
    const targetDayIllum =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(this.astroState.lunar.illumination, this.nextDayIllum, dayFraction)
        : THREE.MathUtils.lerp(this.astroState.lunar.illumination, this.prevDayIllum, -dayFraction);
    const targetDayEarthshine =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(
            this.astroState.lunar.earthshine,
            this.nextDayEarthshine,
            dayFraction,
          )
        : THREE.MathUtils.lerp(
            this.astroState.lunar.earthshine,
            this.prevDayEarthshine,
            -dayFraction,
          );
    const targetDayLibLon =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(
            this.astroState.lunar.librationLonRad,
            this.nextDayLibLon,
            dayFraction,
          )
        : THREE.MathUtils.lerp(
            this.astroState.lunar.librationLonRad,
            this.prevDayLibLon,
            -dayFraction,
          );
    const targetDayLibLat =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(
            this.astroState.lunar.librationLatRad,
            this.nextDayLibLat,
            dayFraction,
          )
        : THREE.MathUtils.lerp(
            this.astroState.lunar.librationLatRad,
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
        ? THREE.MathUtils.lerp(this.astroState.tidal.springNeapIndex, this.nextDayTide, dayFraction)
        : THREE.MathUtils.lerp(
            this.astroState.tidal.springNeapIndex,
            this.prevDayTide,
            -dayFraction,
          );
    const targetSwellEnergy =
      dayFraction >= 0
        ? THREE.MathUtils.lerp(this.astroState.tidal.swellEnergy, this.nextDaySwell, dayFraction)
        : THREE.MathUtils.lerp(this.astroState.tidal.swellEnergy, this.prevDaySwell, -dayFraction);

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

    // Wet sand dries slower than water recedes, leaving a glistening reflective coastal trail
    if (this.smoothTideLevel >= this.smoothWetTideMemory) {
      this.smoothWetTideMemory = this.smoothTideLevel;
    } else {
      this.smoothWetTideMemory = damp(this.smoothWetTideMemory, this.smoothTideLevel, 0.24, dt);
    }

    this.smoothEpochYears = damp(
      this.smoothEpochYears,
      this.astroState.galactic.epochYearsSinceJ2000,
      astroLambda,
      dt,
    );
    const dEpoch = this.smoothEpochYears - this.prevSmoothEpochYears;
    this.prevSmoothEpochYears = this.smoothEpochYears;
    if (this.mode === "year") {
      this.smoothGalLonShift += dEpoch * 0.0085 + dt * 0.0022;
    }

    this.smoothPrecession = damp(
      this.smoothPrecession,
      this.astroState.galactic.axialPrecessionRad,
      astroLambda,
      dt,
    );

    this.updateOrbitTransform(dt);

    if (this.pendingMode !== null && !this.isCurrentValueAnimating()) {
      const nextMode = this.pendingMode;
      this.pendingMode = null;
      this.commitMode(nextMode);
    }

    if (this.flight.active) {
      this.stepFlight(dt);
    } else {
      this.computeModeCameraGoal(this.mode, this.camPos, this.camTarget);
      const [yaw, pitch] = dirToYawPitch(
        this.tmpDir.copy(this.camTarget).sub(this.camPos).normalize(),
      );
      this.curCamYaw = yaw;
      this.curCamPitch = pitch;
    }

    if (dt > 1e-4) {
      this.curVelPos.copy(this.camPos).sub(this.prevCamPos).divideScalar(dt);
      const curAz = Math.atan2(this.camPos.x, this.camPos.z);
      const curR = Math.hypot(this.camPos.x, this.camPos.z);
      const prevAz = Math.atan2(this.prevCamPos.x, this.prevCamPos.z);
      const prevR = Math.hypot(this.prevCamPos.x, this.prevCamPos.z);
      this.curVelCyl.set(
        shortestAngleDelta(prevAz, curAz) / dt,
        (curR - prevR) / dt,
        (this.camPos.y - this.prevCamPos.y) / dt,
      );
      this.curVelYaw = shortestAngleDelta(this.prevCamYaw, this.curCamYaw) / dt;
      this.curVelPitch = (this.curCamPitch - this.prevCamPitch) / dt;
    }
    this.prevCamPos.copy(this.camPos);
    this.prevCamYaw = this.curCamYaw;
    this.prevCamPitch = this.curCamPitch;

    this.applyUniforms();
    this.renderSingleFrame();
    this.rafId = requestAnimationFrame(this.loop);
  };
}
