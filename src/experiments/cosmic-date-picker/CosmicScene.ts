import * as THREE from "three";
import type { CosmicState } from "./astronomy";
import {
  atmosphereFragmentShader,
  atmosphereVertexShader,
  cloudsFragmentShader,
  cloudsVertexShader,
  earthFragmentShader,
  earthVertexShader,
  moonFragmentShader,
  moonVertexShader,
  oceanFragmentShader,
  oceanVertexShader,
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

function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-lambda * dt));
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
  private readonly desiredCamPos = new THREE.Vector3();
  private readonly desiredCamTarget = new THREE.Vector3();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpSunDir = new THREE.Vector3();

  private smoothOrbitAngle: number;
  private smoothOrbitRadius: number;
  private smoothSubsolarDecl: number;
  private smoothMoonElong: number;
  private smoothMoonIllum: number;
  private smoothMoonScale: number;
  private smoothWaterLevel: number;
  private smoothSwellEnergy: number;
  private smoothEpochYears: number;
  private smoothPrecession: number;

  private wEarth = 1;
  private wSun = 0;
  private wMoon = 0;
  private wOcean = 0;
  private wGalactic = 0;
  private smoothSkyBright = 0.28;
  private smoothSkyGamma = 0.85;

  private constructor(canvas: HTMLCanvasElement, initialState: CosmicState) {
    this.cosmicState = initialState;
    this.smoothOrbitAngle = initialState.solar.earthHeliocentricLongitudeRad;
    this.smoothOrbitRadius = EARTH_ORBIT_RADIUS * initialState.solar.earthSunDistanceAU;
    this.smoothSubsolarDecl = initialState.solar.sunDeclinationRad;
    this.smoothMoonElong = initialState.lunar.elongationRad;
    this.smoothMoonIllum = initialState.lunar.illumination;
    this.smoothMoonScale = initialState.lunar.apparentScale;
    this.smoothWaterLevel = initialState.tidal.waterLevel;
    this.smoothSwellEnergy = initialState.tidal.swellEnergy;
    this.smoothEpochYears = initialState.galactic.epochYearsSinceJ2000;
    this.smoothPrecession = initialState.galactic.axialPrecessionRad;

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
      uGalacticReveal: { value: 0 },
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
      uOpacity: { value: 0 },
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
      uOpacity: { value: 0 },
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
    this.scene.add(this.sunGroup);

    this.earthOrbitRoot = new THREE.Group();
    this.earthAxisGroup = new THREE.Group();
    this.earthSpinGroup = new THREE.Group();
    this.earthAxisGroup.rotation.z = -initialState.solar.obliquityRad;

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
    this.computeCameraGoal("idle", this.camPos, this.camTarget);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.skyGroup.position.copy(this.camera.position);
  }

  static create(canvas: HTMLCanvasElement, initialState: CosmicState): CosmicSceneRenderer | null {
    try {
      return new CosmicSceneRenderer(canvas, initialState);
    } catch {
      return null;
    }
  }

  private createHipparcosStarfield() {
    const bgCount = 900;
    const total = BRIGHT_STARS.length + bgCount;
    const positions = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const sizes = new Float32Array(total);
    const phases = new Float32Array(total);

    const radius = 165;
    let idx = 0;

    for (const star of BRIGHT_STARS) {
      const ra = (star.raHours / 24) * Math.PI * 2;
      const dec = THREE.MathUtils.degToRad(star.decDeg);
      const cosDec = Math.cos(dec);

      positions[idx * 3] = radius * cosDec * Math.cos(ra);
      positions[idx * 3 + 1] = radius * Math.sin(dec);
      positions[idx * 3 + 2] = -radius * cosDec * Math.sin(ra);

      const [r, g, b] = bvToRgb(star.bv);
      const brightness = THREE.MathUtils.clamp(1.25 - (star.mag + 1.5) * 0.14, 0.42, 1.35);
      colors[idx * 3] = r * brightness;
      colors[idx * 3 + 1] = g * brightness;
      colors[idx * 3 + 2] = b * brightness;
      sizes[idx] = THREE.MathUtils.clamp(4.4 - star.mag * 0.62, 1.5, 5.4);
      phases[idx] = idx * 0.73;
      idx += 1;
    }

    const rand = seededRandom(20261124);
    for (let i = 0; i < bgCount; i += 1) {
      const u = rand() * 2 - 1;
      const lat = rand() < 0.55 ? (rand() - 0.5) * 0.48 : Math.asin(u);
      const lon = rand() * Math.PI * 2;
      const cosLat = Math.cos(lat);

      const gx = radius * cosLat * Math.cos(lon);
      const gy = radius * Math.sin(lat);
      const gz = radius * cosLat * Math.sin(lon);

      const tilt = 0.58;
      positions[idx * 3] = gx;
      positions[idx * 3 + 1] = gy * Math.cos(tilt) - gz * Math.sin(tilt);
      positions[idx * 3 + 2] = gy * Math.sin(tilt) + gz * Math.cos(tilt);

      const bv = -0.15 + rand() * 1.4;
      const [r, g, b] = bvToRgb(bv);
      const dim = 0.28 + rand() * 0.48;
      colors[idx * 3] = r * dim;
      colors[idx * 3 + 1] = g * dim;
      colors[idx * 3 + 2] = b * dim;
      sizes[idx] = 0.8 + rand() * 1.55;
      phases[idx] = rand() * Math.PI * 2;
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
      uOpacity: { value: 0.92 },
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

      const x = along;
      const y = along * 0.34 + thickness;
      const z = -6.5 + spread + Math.sin(along * 0.14) * 2.2;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

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
    this.renderSingleFrame();
  }

  setState(next: CosmicState) {
    this.cosmicState = next;
    if (!this.active || this.reducedMotion) {
      this.snapToTargets();
      this.renderSingleFrame();
    }
  }

  setMode(mode: CosmicFocusMode) {
    if (this.mode === mode) return;
    this.mode = mode;
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
    this.smoothOrbitAngle = this.cosmicState.solar.earthHeliocentricLongitudeRad;
    this.smoothOrbitRadius = EARTH_ORBIT_RADIUS * this.cosmicState.solar.earthSunDistanceAU;
    this.smoothSubsolarDecl = this.cosmicState.solar.sunDeclinationRad;
    this.smoothMoonElong = this.cosmicState.lunar.elongationRad;
    this.smoothMoonIllum = this.cosmicState.lunar.illumination;
    this.smoothMoonScale = this.cosmicState.lunar.apparentScale;
    this.smoothWaterLevel = this.cosmicState.tidal.waterLevel;
    this.smoothSwellEnergy = this.cosmicState.tidal.swellEnergy;
    this.smoothEpochYears = this.cosmicState.galactic.epochYearsSinceJ2000;
    this.smoothPrecession = this.cosmicState.galactic.axialPrecessionRad;

    this.wEarth = this.mode === "idle" || this.mode === "month" ? 1 : 0;
    this.wSun = this.mode === "year" || this.mode === "month" ? 1 : 0;
    this.wMoon = this.mode === "day" ? 1 : 0;
    this.wOcean = this.mode === "day" ? 1 : 0;
    this.wGalactic = this.mode === "year" ? 1 : 0;
    this.smoothSkyBright = this.mode === "year" ? 1.02 : this.mode === "day" ? 0.24 : 0.28;
    this.smoothSkyGamma = this.mode === "year" ? 0.74 : 0.88;

    this.updateOrbitTransform(0);
    this.computeCameraGoal(this.mode, this.camPos, this.camTarget);
    this.applyUniforms();
  }

  private updateOrbitTransform(dt: number) {
    const ex = Math.cos(this.smoothOrbitAngle) * this.smoothOrbitRadius;
    const ez = -Math.sin(this.smoothOrbitAngle) * this.smoothOrbitRadius;
    this.earthOrbitRoot.position.set(ex, 0, ez);

    this.earthAxisGroup.rotation.z = -this.cosmicState.solar.obliquityRad;
    const baseSpin =
      this.smoothOrbitAngle + Math.PI * 0.62 + this.elapsed * (this.reducedMotion ? 0 : 0.022);
    this.earthSpinGroup.rotation.y = baseSpin;

    this.tmpSunDir.set(-ex, 0, -ez).normalize();
    if (this.mode === "idle") {
      const decl = this.smoothSubsolarDecl;
      const idleSunX = Math.cos(this.smoothOrbitAngle + 0.55) * Math.cos(decl);
      const idleSunY = Math.sin(decl);
      const idleSunZ = -Math.sin(this.smoothOrbitAngle + 0.55) * Math.cos(decl);
      this.tmpVec.set(idleSunX, idleSunY, idleSunZ).normalize();
      this.tmpSunDir.lerp(this.tmpVec, 0.35).normalize();
    }

    const galPhase = this.smoothEpochYears * 0.042;
    const sunArcX = Math.sin(galPhase * 0.45) * 1.45;
    const sunArcY = Math.sin(galPhase * 0.45) * 0.48;
    const sunArcZ = Math.cos(galPhase * 0.45) * 0.35 - 0.35;

    if (this.mode === "year") {
      this.sunGroup.position.set(
        damp(this.sunGroup.position.x, sunArcX, 6, dt || 0.016),
        damp(this.sunGroup.position.y, sunArcY, 6, dt || 0.016),
        damp(this.sunGroup.position.z, sunArcZ, 6, dt || 0.016),
      );
      const driftX = -((this.smoothEpochYears * 0.24) % 14);
      const driftY = driftX * 0.34;
      this.galacticDustGroup.position.set(driftX, driftY, 0);
    } else {
      this.sunGroup.position.set(
        damp(this.sunGroup.position.x, 0, 6, dt || 0.016),
        damp(this.sunGroup.position.y, 0, 6, dt || 0.016),
        damp(this.sunGroup.position.z, 0, 6, dt || 0.016),
      );
    }

    const sunScale = this.mode === "year" ? 0.34 : 0.68;
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

    const galLonShift = this.mode === "year" ? this.smoothEpochYears * 0.0085 : 0;
    this.skyGroup.rotation.y = this.smoothPrecession + galLonShift;
  }

  private computeCameraGoal(
    mode: CosmicFocusMode,
    outPos: THREE.Vector3,
    outTarget: THREE.Vector3,
  ) {
    const ex = this.earthOrbitRoot.position.x;
    const ez = this.earthOrbitRoot.position.z;
    const radialOutX = Math.cos(this.smoothOrbitAngle);
    const radialOutZ = -Math.sin(this.smoothOrbitAngle);
    const tangentX = -Math.sin(this.smoothOrbitAngle);
    const tangentZ = -Math.cos(this.smoothOrbitAngle);

    if (mode === "idle") {
      const dist = 3.45;
      outPos.set(
        ex - radialOutX * dist * 0.22 + tangentX * dist * 0.96,
        0.62,
        ez - radialOutZ * dist * 0.22 + tangentZ * dist * 0.96,
      );
      outTarget.set(ex + radialOutX * 0.08, -0.04, ez + radialOutZ * 0.08);
      return;
    }

    if (mode === "month") {
      const dist = 4.95;
      outPos.set(
        ex + radialOutX * dist * 0.44 + tangentX * dist * 0.9,
        1.55,
        ez + radialOutZ * dist * 0.44 + tangentZ * dist * 0.9,
      );
      outTarget.set(ex * 0.54, 0.02, ez * 0.54);
      return;
    }

    if (mode === "year") {
      const epochDrift = Math.sin(this.smoothEpochYears * 0.019) * 0.45;
      outPos.set(epochDrift * 0.6, 0.25 + epochDrift * 0.12, 8.6);
      outTarget.set(this.sunGroup.position.x * 0.42, this.sunGroup.position.y * 0.3, -1.2);
      return;
    }

    const stageY = this.dayStageGroup.position.y;
    outPos.set(0, stageY + 0.16, 3.85);
    outTarget.set(0.05, stageY + 0.08, -0.8);
  }

  private applyUniforms() {
    this.earthUniforms.uSunDir.value.copy(this.tmpSunDir);
    this.earthUniforms.uCloudOffset.value = this.elapsed * (this.reducedMotion ? 0 : 0.0025);
    this.earthUniforms.uOpacity.value = this.wEarth;

    this.cloudsUniforms.uSunDir.value.copy(this.tmpSunDir);
    this.cloudsUniforms.uCloudOffset.value = this.elapsed * (this.reducedMotion ? 0 : 0.0025);
    this.cloudsUniforms.uOpacity.value = this.wEarth;

    this.atmosphereUniforms.uSunDir.value.copy(this.tmpSunDir);
    this.atmosphereUniforms.uOpacity.value = this.wEarth;
    this.earthOrbitRoot.visible = this.wEarth > 0.005;

    this.sunUniforms.uTime.value = this.elapsed;
    this.sunUniforms.uOpacity.value = this.wSun;
    this.sunCoronaUniforms.uTime.value = this.elapsed;
    this.sunCoronaUniforms.uOpacity.value = this.wSun;
    this.sunGroup.visible = this.wSun > 0.005;

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
    this.skyUniforms.uGalacticReveal.value = this.wGalactic;
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

    const astroLambda = this.reducedMotion ? 60 : 7.5;
    const camLambda = this.reducedMotion ? 60 : 5.2;
    const fadeLambda = this.reducedMotion ? 60 : 6.4;

    this.smoothOrbitAngle = dampAngle(
      this.smoothOrbitAngle,
      this.cosmicState.solar.earthHeliocentricLongitudeRad,
      astroLambda,
      dt,
    );
    this.smoothOrbitRadius = damp(
      this.smoothOrbitRadius,
      EARTH_ORBIT_RADIUS * this.cosmicState.solar.earthSunDistanceAU,
      astroLambda,
      dt,
    );
    this.smoothSubsolarDecl = damp(
      this.smoothSubsolarDecl,
      this.cosmicState.solar.sunDeclinationRad,
      astroLambda,
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
    const targetSun = this.mode === "year" || this.mode === "month" ? 1 : 0;
    const targetMoon = this.mode === "day" ? 1 : 0;
    const targetOcean = this.mode === "day" ? 1 : 0;
    const targetGalactic = this.mode === "year" ? 1 : 0;
    const targetSkyBright = this.mode === "year" ? 1.02 : this.mode === "day" ? 0.24 : 0.28;
    const targetSkyGamma = this.mode === "year" ? 0.74 : 0.88;

    this.wEarth = damp(this.wEarth, targetEarth, fadeLambda, dt);
    this.wSun = damp(this.wSun, targetSun, fadeLambda, dt);
    this.wMoon = damp(this.wMoon, targetMoon, fadeLambda, dt);
    this.wOcean = damp(this.wOcean, targetOcean, fadeLambda, dt);
    this.wGalactic = damp(this.wGalactic, targetGalactic, fadeLambda, dt);
    this.smoothSkyBright = damp(this.smoothSkyBright, targetSkyBright, fadeLambda, dt);
    this.smoothSkyGamma = damp(this.smoothSkyGamma, targetSkyGamma, fadeLambda, dt);

    this.updateOrbitTransform(dt);
    this.computeCameraGoal(this.mode, this.desiredCamPos, this.desiredCamTarget);

    this.camPos.x = damp(this.camPos.x, this.desiredCamPos.x, camLambda, dt);
    this.camPos.y = damp(this.camPos.y, this.desiredCamPos.y, camLambda, dt);
    this.camPos.z = damp(this.camPos.z, this.desiredCamPos.z, camLambda, dt);

    this.camTarget.x = damp(this.camTarget.x, this.desiredCamTarget.x, camLambda, dt);
    this.camTarget.y = damp(this.camTarget.y, this.desiredCamTarget.y, camLambda, dt);
    this.camTarget.z = damp(this.camTarget.z, this.desiredCamTarget.z, camLambda, dt);

    this.applyUniforms();
    this.renderSingleFrame();
    this.rafId = requestAnimationFrame(this.loop);
  };
}
