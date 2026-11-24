import * as THREE from "three";
import {
  type CalendarDate,
  type CosmicMode,
  clamp,
  dateToContinuousYear,
  dateToEarthOrbitAngle,
  dateToMoonAngle,
  daysInMonth,
  stepDay,
  stepMonth,
  stepYear,
} from "./date-math";
import {
  atmosphereFragmentShader,
  atmosphereVertexShader,
  beachOceanFragmentShader,
  beachOceanVertexShader,
  earthFragmentShader,
  earthVertexShader,
  helixFragmentShader,
  helixVertexShader,
  moonFragmentShader,
  moonHaloFragmentShader,
  moonHaloVertexShader,
  moonVertexShader,
  sunCoronaFragmentShader,
  sunCoronaVertexShader,
} from "./shaders";
import earthCloudsUrl from "./textures/earth_clouds.png";
import earthDayUrl from "./textures/earth_day.jpg";
import earthLightsUrl from "./textures/earth_lights.png";
import earthSpecularUrl from "./textures/earth_specular.jpg";
import moonUrl from "./textures/moon.jpg";

export interface CosmicSceneOptions {
  canvas: HTMLCanvasElement;
  initialDate: CalendarDate;
  minYear: number;
  maxYear: number;
  onDateChange: (date: CalendarDate) => void;
}

const EARTH_AXIAL_TILT = THREE.MathUtils.degToRad(23.44);
const MONTH_ORBIT_RADIUS = 1.96;
const HELIX_RADIUS = 1.05;
const HELIX_PITCH = 0.56;
const HELIX_HALF_SPAN_YEARS = 22;

const MONTH_ORBIT_EULER = new THREE.Euler(
  THREE.MathUtils.degToRad(15),
  0,
  THREE.MathUtils.degToRad(-9),
);
const MONTH_SUN_CENTER = new THREE.Vector3(-0.55, 0.14, -0.35);

function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

function createStarTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.24, "rgba(220,235,255,0.65)");
    grad.addColorStop(1, "rgba(180,210,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export class CosmicScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly resizeObserver: ResizeObserver;
  private readonly onDateChange: (date: CalendarDate) => void;
  private readonly loadedTextures: THREE.Texture[] = [];

  private minYear: number;
  private maxYear: number;
  private date: CalendarDate;
  private mode: CosmicMode = "idle";
  private active = true;
  private reducedMotion = false;
  private disposed = false;

  private rafId: number | null = null;
  private lastTime = 0;
  private elapsed = 0;

  private readonly earthUniforms: {
    uDayMap: { value: THREE.Texture };
    uNightMap: { value: THREE.Texture };
    uSpecularMap: { value: THREE.Texture };
    uCloudMap: { value: THREE.Texture };
    uSunDir: { value: THREE.Vector3 };
    uTime: { value: number };
  };
  private readonly atmosphereUniforms: {
    uSunDir: { value: THREE.Vector3 };
  };
  private readonly moonUniforms: {
    uMoonMap: { value: THREE.Texture };
    uSunDir: { value: THREE.Vector3 };
  };
  private readonly moonHaloUniforms: {
    uOpacity: { value: number };
    uIllumination: { value: number };
  };
  private readonly beachUniforms: {
    uTime: { value: number };
    uOpacity: { value: number };
    uIllumination: { value: number };
    uTideLevel: { value: number };
    uAspect: { value: number };
    uMoonUv: { value: THREE.Vector2 };
  };
  private readonly sunCoronaUniforms: {
    uOpacity: { value: number };
    uTime: { value: number };
  };
  private readonly helixUniforms: {
    uOpacity: { value: number };
    uFocusYear: { value: number };
  };

  private readonly earthTiltGroup: THREE.Group;
  private readonly earthMesh: THREE.Mesh;
  private readonly earthMaterial: THREE.ShaderMaterial;
  private readonly atmosphereMaterial: THREE.ShaderMaterial;
  private readonly moonMesh: THREE.Mesh;
  private readonly moonMaterial: THREE.ShaderMaterial;
  private readonly moonHaloMesh: THREE.Mesh;
  private readonly beachMesh: THREE.Mesh;
  private readonly sunGroup: THREE.Group;
  private readonly sunCoronaMaterial: THREE.ShaderMaterial;
  private readonly starPoints: THREE.Points;
  private readonly starPositions: Float32Array;
  private readonly starBasePositions: Float32Array;

  private readonly monthRingGroup: THREE.Group;
  private readonly monthRingMaterial: THREE.LineBasicMaterial;
  private readonly monthTickMeshes: THREE.Mesh[] = [];

  private readonly helixGroup: THREE.Group;
  private readonly helixLineMaterial: THREE.ShaderMaterial;
  private readonly helixSpineMaterial: THREE.LineBasicMaterial;
  private readonly helixGeometry: THREE.BufferGeometry;

  private readonly cameraPos = new THREE.Vector3(0.36, 0.14, 4.45);
  private readonly cameraTarget = new THREE.Vector3(0.24, -0.04, 0);
  private readonly earthPos = new THREE.Vector3(-0.34, 0.02, 0);
  private readonly moonPos = new THREE.Vector3(1.02, 0.48, 0.28);
  private readonly sunDir = new THREE.Vector3(0.84, 0.24, 0.48).normalize();
  private readonly moonLightDir = new THREE.Vector3(0.84, 0.24, 0.48).normalize();

  private earthScale = 1.16;
  private moonScale = 0.25;
  private sunOpacity = 0;
  private beachOpacity = 0;
  private monthRingOpacity = 0;
  private helixOpacity = 0;

  private visualMoonAngle = 0;
  private visualEarthOrbitAngle = 0;
  private visualYear: number;
  private yearVelocity = 0;
  private starTravelOffset = 0;

  private dragging = false;
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastDragAngle = 0;
  private angleAccumulator = 0;
  private lastMoveTimestamp = 0;

  private readonly tempVec = new THREE.Vector3();
  private readonly tempVec2 = new THREE.Vector3();

  constructor(options: CosmicSceneOptions) {
    this.canvas = options.canvas;
    this.date = options.initialDate;
    this.minYear = options.minYear;
    this.maxYear = options.maxYear;
    this.onDateChange = options.onDateChange;
    this.reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.visualMoonAngle = dateToMoonAngle(this.date);
    this.visualEarthOrbitAngle = dateToEarthOrbitAngle(this.date);
    this.visualYear = dateToContinuousYear(this.date);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    const maxAnisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
    const loader = new THREE.TextureLoader();

    const loadTex = (url: string, srgb: boolean): THREE.Texture => {
      const tex = loader.load(url);
      tex.anisotropy = maxAnisotropy;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      if (srgb) {
        tex.colorSpace = THREE.SRGBColorSpace;
      }
      this.loadedTextures.push(tex);
      return tex;
    };

    const earthDayTex = loadTex(earthDayUrl, true);
    const earthNightTex = loadTex(earthLightsUrl, true);
    const earthSpecularTex = loadTex(earthSpecularUrl, false);
    const earthCloudsTex = loadTex(earthCloudsUrl, false);
    const moonTex = loadTex(moonUrl, true);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 16 / 10, 0.1, 120);
    this.camera.position.copy(this.cameraPos);

    const starCount = 520;
    this.starPositions = new Float32Array(starCount * 3);
    this.starBasePositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    const starColor = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      const spreadX = (Math.random() - 0.5) * 34;
      const spreadY = (Math.random() - 0.5) * 20;
      const spreadZ = -6 - Math.random() * 28;
      this.starPositions[i3] = spreadX;
      this.starPositions[i3 + 1] = spreadY;
      this.starPositions[i3 + 2] = spreadZ;
      this.starBasePositions[i3] = spreadX;
      this.starBasePositions[i3 + 1] = spreadY;
      this.starBasePositions[i3 + 2] = spreadZ;

      const tint = Math.random();
      if (tint < 0.25) starColor.setRGB(0.76, 0.86, 1.0);
      else if (tint < 0.4) starColor.setRGB(1.0, 0.91, 0.78);
      else starColor.setRGB(0.92, 0.95, 1.0);
      const brightness = 0.25 + Math.random() * 0.55;
      starColors[i3] = starColor.r * brightness;
      starColors[i3 + 1] = starColor.g * brightness;
      starColors[i3 + 2] = starColor.b * brightness;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(this.starPositions, 3));
    starGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
    const starTexture = createStarTexture();
    this.loadedTextures.push(starTexture);
    const starMaterial = new THREE.PointsMaterial({
      size: 0.13,
      map: starTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.starPoints = new THREE.Points(starGeometry, starMaterial);
    this.starPoints.renderOrder = 0;
    this.scene.add(this.starPoints);

    // Night beach + ocean + tides backdrop (Day mode)
    this.beachUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uIllumination: { value: 0.5 },
      uTideLevel: { value: 0.5 },
      uAspect: { value: 16 / 10 },
      uMoonUv: { value: new THREE.Vector2(0.46, 0.69) },
    };
    const beachMaterial = new THREE.ShaderMaterial({
      vertexShader: beachOceanVertexShader,
      fragmentShader: beachOceanFragmentShader,
      uniforms: this.beachUniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.beachMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), beachMaterial);
    this.beachMesh.frustumCulled = false;
    this.beachMesh.renderOrder = 1;
    this.beachMesh.visible = false;
    this.scene.add(this.beachMesh);

    this.sunGroup = new THREE.Group();
    this.sunCoronaUniforms = {
      uOpacity: { value: 0 },
      uTime: { value: 0 },
    };
    this.sunCoronaMaterial = new THREE.ShaderMaterial({
      vertexShader: sunCoronaVertexShader,
      fragmentShader: sunCoronaFragmentShader,
      uniforms: this.sunCoronaUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sunPlane = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8), this.sunCoronaMaterial);
    this.sunGroup.add(sunPlane);
    this.scene.add(this.sunGroup);

    this.earthTiltGroup = new THREE.Group();
    this.earthTiltGroup.rotation.z = EARTH_AXIAL_TILT;

    this.earthUniforms = {
      uDayMap: { value: earthDayTex },
      uNightMap: { value: earthNightTex },
      uSpecularMap: { value: earthSpecularTex },
      uCloudMap: { value: earthCloudsTex },
      uSunDir: { value: this.sunDir.clone() },
      uTime: { value: 0 },
    };
    this.earthMaterial = new THREE.ShaderMaterial({
      vertexShader: earthVertexShader,
      fragmentShader: earthFragmentShader,
      uniforms: this.earthUniforms,
    });
    this.earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 72), this.earthMaterial);
    // Orient Europe, Africa, and the Atlantic toward the viewer initially
    this.earthMesh.rotation.y = -1.75;
    this.earthTiltGroup.add(this.earthMesh);

    this.atmosphereUniforms = {
      uSunDir: { value: this.sunDir.clone() },
    };
    this.atmosphereMaterial = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      uniforms: this.atmosphereUniforms,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const atmosphereMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.045, 48, 48),
      this.atmosphereMaterial,
    );
    this.earthTiltGroup.add(atmosphereMesh);
    this.scene.add(this.earthTiltGroup);

    // Moon atmospheric halo (visible over the night beach in Day mode)
    this.moonHaloUniforms = {
      uOpacity: { value: 0 },
      uIllumination: { value: 0.5 },
    };
    const moonHaloMaterial = new THREE.ShaderMaterial({
      vertexShader: moonHaloVertexShader,
      fragmentShader: moonHaloFragmentShader,
      uniforms: this.moonHaloUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.moonHaloMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), moonHaloMaterial);
    this.moonHaloMesh.renderOrder = 2;
    this.moonHaloMesh.visible = false;
    this.scene.add(this.moonHaloMesh);

    this.moonUniforms = {
      uMoonMap: { value: moonTex },
      uSunDir: { value: this.moonLightDir.clone() },
    };
    this.moonMaterial = new THREE.ShaderMaterial({
      vertexShader: moonVertexShader,
      fragmentShader: moonFragmentShader,
      uniforms: this.moonUniforms,
    });
    this.moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 56), this.moonMaterial);
    this.moonMesh.scale.setScalar(this.moonScale);
    this.moonMesh.renderOrder = 3;
    this.scene.add(this.moonMesh);

    this.monthRingGroup = new THREE.Group();
    this.monthRingGroup.position.copy(MONTH_SUN_CENTER);
    this.monthRingGroup.rotation.copy(MONTH_ORBIT_EULER);
    this.monthRingMaterial = new THREE.LineBasicMaterial({
      color: 0x9ec0f5,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const monthRingPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      monthRingPoints.push(
        new THREE.Vector3(Math.cos(a) * MONTH_ORBIT_RADIUS, 0, Math.sin(a) * MONTH_ORBIT_RADIUS),
      );
    }
    const monthRingGeo = new THREE.BufferGeometry().setFromPoints(monthRingPoints);
    this.monthRingGroup.add(new THREE.Line(monthRingGeo, this.monthRingMaterial));

    const monthTickGeo = new THREE.SphereGeometry(0.022, 10, 10);
    for (let m = 0; m < 12; m++) {
      const a = (m / 12) * Math.PI * 2;
      const isQuarter = m % 3 === 0;
      const mat = new THREE.MeshBasicMaterial({
        color: isQuarter ? 0xfef3c7 : 0x93b4e8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(monthTickGeo, mat);
      mesh.position.set(Math.cos(a) * MONTH_ORBIT_RADIUS, 0, Math.sin(a) * MONTH_ORBIT_RADIUS);
      mesh.scale.setScalar(isQuarter ? 1.2 : 0.75);
      this.monthTickMeshes.push(mesh);
      this.monthRingGroup.add(mesh);
    }
    this.scene.add(this.monthRingGroup);

    this.helixGroup = new THREE.Group();
    this.helixGroup.rotation.set(0.12, -0.34, 0.28);

    const samplesPerYear = 44;
    const totalYearsSpan = HELIX_HALF_SPAN_YEARS * 2;
    const totalPoints = totalYearsSpan * samplesPerYear + 1;
    const helixPos = new Float32Array(totalPoints * 3);
    const helixYearAttr = new Float32Array(totalPoints);
    this.helixGeometry = new THREE.BufferGeometry();
    this.helixGeometry.setAttribute("position", new THREE.BufferAttribute(helixPos, 3));
    this.helixGeometry.setAttribute("aYearOffset", new THREE.BufferAttribute(helixYearAttr, 1));

    this.helixUniforms = {
      uOpacity: { value: 0 },
      uFocusYear: { value: this.visualYear },
    };
    this.helixLineMaterial = new THREE.ShaderMaterial({
      vertexShader: helixVertexShader,
      fragmentShader: helixFragmentShader,
      uniforms: this.helixUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.helixGroup.add(new THREE.Line(this.helixGeometry, this.helixLineMaterial));

    this.helixSpineMaterial = new THREE.LineBasicMaterial({
      color: 0xffd79a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const spineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-HELIX_HALF_SPAN_YEARS * HELIX_PITCH, 0, 0),
      new THREE.Vector3(HELIX_HALF_SPAN_YEARS * HELIX_PITCH, 0, 0),
    ]);
    this.helixGroup.add(new THREE.Line(spineGeo, this.helixSpineMaterial));
    this.scene.add(this.helixGroup);
    this.updateHelixGeometry(this.visualYear);

    this.handleResize();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.canvas);

    this.bindPointerEvents();
    this.startLoop();
  }

  private updateHelixGeometry(centerYear: number): void {
    const posAttr = this.helixGeometry.getAttribute("position") as THREE.BufferAttribute;
    const yearAttr = this.helixGeometry.getAttribute("aYearOffset") as THREE.BufferAttribute;
    const count = posAttr.count;
    const startYear = Math.max(this.minYear, Math.floor(centerYear) - HELIX_HALF_SPAN_YEARS);
    const endYear = Math.min(this.maxYear + 0.999, Math.floor(centerYear) + HELIX_HALF_SPAN_YEARS);
    const span = Math.max(1, endYear - startYear);

    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const yVal = startYear + t * span;
      const relX = (yVal - centerYear) * HELIX_PITCH;
      const theta = yVal * Math.PI * 2;
      const y = Math.sin(theta) * HELIX_RADIUS;
      const z = Math.cos(theta) * HELIX_RADIUS;
      posAttr.setXYZ(i, relX, y, z);
      yearAttr.setX(i, yVal);
    }
    posAttr.needsUpdate = true;
    yearAttr.needsUpdate = true;
  }

  private bindPointerEvents(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private projectToCanvas(worldPos: THREE.Vector3): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    this.tempVec.copy(worldPos).project(this.camera);
    return {
      x: (this.tempVec.x * 0.5 + 0.5) * rect.width,
      y: (-this.tempVec.y * 0.5 + 0.5) * rect.height,
    };
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.mode === "idle") return;
    // Keep focus on the active DateInputSegment while dragging the 3D scene
    event.preventDefault();
    this.dragging = true;
    this.activePointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.lastMoveTimestamp = performance.now();
    this.angleAccumulator = 0;
    this.yearVelocity = 0;

    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in tests may not have an active pointer id
    }

    if (this.mode === "month") {
      const rect = this.canvas.getBoundingClientRect();
      const center = this.projectToCanvas(this.tempVec2.copy(MONTH_SUN_CENTER));
      this.lastDragAngle = Math.atan2(
        event.clientY - rect.top - center.y,
        event.clientX - rect.left - center.x,
      );
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.activePointerId) return;

    const now = performance.now();
    const dt = Math.max(0.004, (now - this.lastMoveTimestamp) / 1000);
    this.lastMoveTimestamp = now;

    if (this.mode === "day") {
      const dx = event.clientX - this.lastPointerX;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;

      const width = Math.max(240, this.canvas.getBoundingClientRect().width);
      const deltaAngle = (dx / width) * Math.PI * 2 * 1.15;
      this.visualMoonAngle += deltaAngle;
      this.angleAccumulator += deltaAngle;

      const totalDays = daysInMonth(this.date.year, this.date.month);
      const radiansPerDay = (Math.PI * 2) / totalDays;
      const steps = Math.trunc(this.angleAccumulator / radiansPerDay);
      if (steps !== 0) {
        this.angleAccumulator -= steps * radiansPerDay;
        this.applyLocalDate(stepDay(this.date, steps));
      }
    } else if (this.mode === "month") {
      const rect = this.canvas.getBoundingClientRect();
      const center = this.projectToCanvas(this.tempVec2.copy(MONTH_SUN_CENTER));
      const angle = Math.atan2(
        event.clientY - rect.top - center.y,
        event.clientX - rect.left - center.x,
      );
      let delta = angle - this.lastDragAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      this.lastDragAngle = angle;

      this.visualEarthOrbitAngle += delta;
      this.angleAccumulator += delta;

      const radiansPerMonth = (Math.PI * 2) / 12;
      const steps = Math.trunc(this.angleAccumulator / radiansPerMonth);
      if (steps !== 0) {
        this.angleAccumulator -= steps * radiansPerMonth;
        this.applyLocalDate(stepMonth(this.date, steps));
      }
    } else if (this.mode === "year") {
      const dx = event.clientX - this.lastPointerX;
      const dy = event.clientY - this.lastPointerY;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;

      const projectedDelta = -(dx * 0.94 - dy * 0.28);
      const deltaYears = projectedDelta * 0.055;

      const nextVisual = clamp(this.visualYear + deltaYears, this.minYear, this.maxYear + 0.99);
      this.yearVelocity = THREE.MathUtils.lerp(this.yearVelocity, deltaYears / dt, 0.45);
      this.visualYear = nextVisual;
      this.starTravelOffset += deltaYears * 0.42;

      const targetYear = clamp(Math.floor(this.visualYear), this.minYear, this.maxYear);
      if (targetYear !== this.date.year) {
        this.applyLocalDate(
          stepYear(this.date, targetYear - this.date.year, this.minYear, this.maxYear),
        );
      }
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.activePointerId) return;
    this.dragging = false;
    this.activePointerId = null;
    try {
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore release errors
    }
  };

  private onWheel = (event: WheelEvent): void => {
    if (this.mode === "idle") return;
    event.preventDefault();
    const dominant = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(dominant) < 2) return;
    const dir = dominant > 0 ? 1 : -1;

    if (this.mode === "day") {
      this.applyLocalDate(stepDay(this.date, dir));
    } else if (this.mode === "month") {
      this.applyLocalDate(stepMonth(this.date, dir));
    } else if (this.mode === "year") {
      this.yearVelocity = dir * 1.4;
      this.applyLocalDate(stepYear(this.date, dir, this.minYear, this.maxYear));
    }
  };

  private applyLocalDate(next: CalendarDate): void {
    if (
      next.year === this.date.year &&
      next.month === this.date.month &&
      next.day === this.date.day
    ) {
      return;
    }
    this.date = next;
    this.onDateChange(next);
  }

  public setDate(date: CalendarDate): void {
    const changed =
      date.year !== this.date.year || date.month !== this.date.month || date.day !== this.date.day;
    this.date = date;
    if (changed && !this.dragging && this.mode !== "year") {
      this.visualYear = dateToContinuousYear(date);
    }
  }

  public setMode(mode: CosmicMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.dragging = false;
    this.yearVelocity = 0;
    if (mode === "year") {
      this.visualYear = dateToContinuousYear(this.date);
    }
  }

  public setBounds(minYear: number, maxYear: number): void {
    this.minYear = minYear;
    this.maxYear = maxYear;
  }

  public setActive(active: boolean): void {
    this.active = active;
    if (active && this.rafId === null && !this.disposed) {
      this.lastTime = performance.now();
      this.startLoop();
    } else if (!active && this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private handleResize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.beachUniforms.uAspect.value = width / height;
  }

  private startLoop(): void {
    if (this.disposed || !this.active) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      if (this.disposed || !this.active) {
        this.rafId = null;
        return;
      }
      const rawDt = (now - this.lastTime) / 1000;
      const dt = Math.min(rawDt, 0.05);
      this.lastTime = now;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private update(dt: number): void {
    const motionScale = this.reducedMotion ? 0 : 1;
    const k = this.reducedMotion ? 16 : 5.6;
    this.elapsed += dt * motionScale;

    const targetMoonAngle = dateToMoonAngle(this.date);
    const targetEarthOrbitAngle = dateToEarthOrbitAngle(this.date);
    const targetContinuousYear = dateToContinuousYear(this.date);

    if (this.mode === "year" && !this.dragging) {
      if (Math.abs(this.yearVelocity) > 0.12) {
        const step = this.yearVelocity * dt;
        const nextVisual = clamp(this.visualYear + step, this.minYear, this.maxYear + 0.99);
        this.starTravelOffset += (nextVisual - this.visualYear) * 0.42;
        this.visualYear = nextVisual;
        this.yearVelocity *= Math.exp(-3.4 * dt);

        const snappedYear = clamp(Math.floor(this.visualYear), this.minYear, this.maxYear);
        if (snappedYear !== this.date.year) {
          this.applyLocalDate(
            stepYear(this.date, snappedYear - this.date.year, this.minYear, this.maxYear),
          );
        }
      } else {
        this.yearVelocity = 0;
        const prevVisual = this.visualYear;
        this.visualYear = damp(this.visualYear, targetContinuousYear, k * 1.15, dt);
        this.starTravelOffset += (this.visualYear - prevVisual) * 0.35;
      }
    } else if (!this.dragging) {
      this.visualYear = damp(this.visualYear, targetContinuousYear, k, dt);
    }

    if (!(this.dragging && this.mode === "day")) {
      this.visualMoonAngle = dampAngle(this.visualMoonAngle, targetMoonAngle, k * 1.35, dt);
    }
    if (!(this.dragging && this.mode === "month")) {
      this.visualEarthOrbitAngle = dampAngle(
        this.visualEarthOrbitAngle,
        targetEarthOrbitAngle,
        k * 1.25,
        dt,
      );
    }

    const targetCamPos = new THREE.Vector3();
    const targetCamLook = new THREE.Vector3();
    const targetEarthPos = new THREE.Vector3();
    const targetMoonPos = new THREE.Vector3();
    const targetSunPos = new THREE.Vector3().copy(MONTH_SUN_CENTER);
    let targetEarthScale = 1.16;
    let targetMoonScale = 0.25;
    let targetSunOpacity = 0;
    let targetBeachOpacity = 0;
    let targetMonthRingOpacity = 0;
    let targetHelixOpacity = 0;

    if (this.mode === "idle") {
      const driftY = Math.sin(this.elapsed * 0.55) * 0.032;
      targetCamPos.set(0.36, 0.14, 4.45);
      targetCamLook.set(0.24, -0.04, 0);
      targetEarthPos.set(-0.34, 0.02 + driftY, 0);
      targetEarthScale = 1.16;
      const idleMoonAngle = targetMoonAngle * 0.25 - 0.35;
      targetMoonPos.set(
        targetEarthPos.x + 1.38 + Math.cos(idleMoonAngle) * 0.1,
        targetEarthPos.y + 0.48 + Math.sin(idleMoonAngle) * 0.1,
        0.26,
      );
      targetMoonScale = 0.24;
    } else if (this.mode === "day") {
      // Camera settles over a moonlit ocean horizon; Earth recedes beneath the horizon
      targetCamPos.set(0, 0.14, 4.4);
      targetCamLook.set(0, 0.14, 0);
      targetEarthPos.set(-0.34, -3.4, -1.2);
      targetEarthScale = 0.55;
      targetMoonPos.set(-0.12, 0.58, 0);
      targetMoonScale = 0.42;
      targetBeachOpacity = 1;
    } else if (this.mode === "month") {
      targetCamPos.set(0.58, 1.72, 5.95);
      targetCamLook.set(-0.22, -0.06, -0.25);

      const localEarth = new THREE.Vector3(
        Math.cos(this.visualEarthOrbitAngle) * MONTH_ORBIT_RADIUS,
        0,
        Math.sin(this.visualEarthOrbitAngle) * MONTH_ORBIT_RADIUS,
      ).applyEuler(MONTH_ORBIT_EULER);
      targetEarthPos.copy(MONTH_SUN_CENTER).add(localEarth);
      targetEarthScale = 0.46;
      targetMoonPos.set(
        targetEarthPos.x + Math.cos(this.visualMoonAngle) * 0.68,
        targetEarthPos.y + 0.08,
        targetEarthPos.z + Math.sin(this.visualMoonAngle) * 0.68,
      );
      targetMoonScale = 0.11;
      targetSunPos.copy(MONTH_SUN_CENTER);
      targetSunOpacity = 1;
      targetMonthRingOpacity = 1;
    } else {
      targetCamPos.set(-1.35, 0.92, 5.45);
      targetCamLook.set(0.32, 0.06, -0.15);

      const theta = this.visualYear * Math.PI * 2;
      const localEarth = new THREE.Vector3(
        0,
        Math.sin(theta) * HELIX_RADIUS,
        Math.cos(theta) * HELIX_RADIUS,
      ).applyEuler(this.helixGroup.rotation);
      targetEarthPos.copy(localEarth);
      targetEarthScale = 0.42;
      targetMoonPos.set(
        targetEarthPos.x + Math.cos(this.visualMoonAngle) * 0.56,
        targetEarthPos.y + Math.sin(this.visualMoonAngle) * 0.18,
        targetEarthPos.z + Math.sin(this.visualMoonAngle) * 0.56,
      );
      targetMoonScale = 0.1;

      const localSun = new THREE.Vector3(6.6, 0, 0).applyEuler(this.helixGroup.rotation);
      targetSunPos.copy(localSun);
      targetSunOpacity = 0.95;
      targetHelixOpacity = 1;
    }

    this.cameraPos.lerp(targetCamPos, 1 - Math.exp(-k * dt));
    this.cameraTarget.lerp(targetCamLook, 1 - Math.exp(-k * dt));
    this.camera.position.copy(this.cameraPos);
    this.camera.lookAt(this.cameraTarget);

    this.earthPos.lerp(targetEarthPos, 1 - Math.exp(-k * 1.15 * dt));
    this.moonPos.lerp(targetMoonPos, 1 - Math.exp(-k * 1.35 * dt));
    this.earthScale = damp(this.earthScale, targetEarthScale, k, dt);
    this.moonScale = damp(this.moonScale, targetMoonScale, k, dt);
    this.sunOpacity = damp(this.sunOpacity, targetSunOpacity, k, dt);
    this.beachOpacity = damp(this.beachOpacity, targetBeachOpacity, k * 1.15, dt);
    this.monthRingOpacity = damp(this.monthRingOpacity, targetMonthRingOpacity, k * 1.2, dt);
    this.helixOpacity = damp(this.helixOpacity, targetHelixOpacity, k * 1.2, dt);

    this.earthTiltGroup.visible = this.beachOpacity < 0.94;
    this.earthTiltGroup.position.copy(this.earthPos);
    this.earthTiltGroup.scale.setScalar(this.earthScale);
    this.earthMesh.rotation.y += dt * 0.055 * motionScale;

    this.moonMesh.position.copy(this.moonPos);
    this.moonMesh.scale.setScalar(this.moonScale);
    // Keep the familiar lunar near-side facing the viewer in Day mode
    this.moonMesh.rotation.y = this.mode === "day" ? -1.45 : -this.visualMoonAngle;

    this.sunGroup.position.lerp(targetSunPos, 1 - Math.exp(-k * dt));
    this.sunGroup.lookAt(this.camera.position);
    this.sunGroup.visible = this.sunOpacity > 0.01;
    this.sunCoronaUniforms.uOpacity.value = this.sunOpacity;
    this.sunCoronaUniforms.uTime.value = this.elapsed;

    // Lunar phase illumination (0 = New Moon, 1 = Full Moon) and spring/neap tide level
    const illumination = 0.5 - 0.5 * Math.cos(this.visualMoonAngle);
    const tideLevel = 0.5 + 0.5 * Math.cos(this.visualMoonAngle * 2);

    const targetSunDir = new THREE.Vector3();
    if (this.mode === "month") {
      targetSunDir.copy(MONTH_SUN_CENTER).sub(this.earthPos).normalize();
    } else if (this.mode === "year") {
      targetSunDir.copy(this.sunGroup.position).sub(this.earthPos).normalize();
    } else {
      const seasonAngle = targetEarthOrbitAngle;
      targetSunDir
        .set(Math.cos(seasonAngle * 0.35 + 0.55), 0.22 + Math.sin(seasonAngle) * 0.26, 0.58)
        .normalize();
    }
    this.sunDir.lerp(targetSunDir, 1 - Math.exp(-k * dt)).normalize();

    const targetMoonLightDir = new THREE.Vector3();
    if (this.mode === "day") {
      targetMoonLightDir
        .set(Math.sin(this.visualMoonAngle), 0.08, -Math.cos(this.visualMoonAngle))
        .normalize();
    } else {
      targetMoonLightDir.copy(this.sunDir);
    }
    this.moonLightDir.lerp(targetMoonLightDir, 1 - Math.exp(-k * 1.6 * dt)).normalize();

    this.earthUniforms.uSunDir.value.copy(this.sunDir);
    this.earthUniforms.uTime.value = this.elapsed;
    this.atmosphereUniforms.uSunDir.value.copy(this.sunDir);
    this.moonUniforms.uSunDir.value.copy(this.moonLightDir);

    // Night beach ocean shader + aligned lunar halo
    this.beachMesh.visible = this.beachOpacity > 0.006;
    if (this.beachMesh.visible) {
      this.tempVec.copy(this.moonPos).project(this.camera);
      this.beachUniforms.uMoonUv.value.set(this.tempVec.x * 0.5 + 0.5, this.tempVec.y * 0.5 + 0.5);
      this.beachUniforms.uTime.value = this.elapsed;
      this.beachUniforms.uOpacity.value = this.beachOpacity;
      this.beachUniforms.uIllumination.value = illumination;
      this.beachUniforms.uTideLevel.value = tideLevel;
    }

    this.moonHaloMesh.visible = this.beachOpacity > 0.01;
    if (this.moonHaloMesh.visible) {
      this.moonHaloMesh.position.copy(this.moonPos).add(new THREE.Vector3(0, 0, -0.45));
      this.moonHaloMesh.lookAt(this.camera.position);
      this.moonHaloUniforms.uOpacity.value = this.beachOpacity;
      this.moonHaloUniforms.uIllumination.value = illumination;
    }

    this.monthRingGroup.visible = this.monthRingOpacity > 0.01;
    this.monthRingMaterial.opacity = this.monthRingOpacity * 0.16;
    const activeMonthIdx = this.date.month - 1;
    for (let i = 0; i < this.monthTickMeshes.length; i++) {
      const mesh = this.monthTickMeshes[i];
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const isSelected = i === activeMonthIdx;
      const isQuarter = i % 3 === 0;
      mat.opacity = this.monthRingOpacity * (isSelected ? 0.95 : isQuarter ? 0.42 : 0.2);
      mat.color.setHex(isSelected ? 0xffffff : isQuarter ? 0xfde68a : 0x8bb2e8);
      mesh.scale.setScalar(isSelected ? 1.55 : isQuarter ? 1.05 : 0.75);
    }

    this.helixGroup.visible = this.helixOpacity > 0.01;
    if (this.helixGroup.visible) {
      this.updateHelixGeometry(this.visualYear);
      this.helixUniforms.uOpacity.value = this.helixOpacity;
      this.helixUniforms.uFocusYear.value = this.visualYear;
      this.helixSpineMaterial.opacity = this.helixOpacity * 0.14;
    }

    const starPosAttr = this.starPoints.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < starPosAttr.count; i++) {
      const i3 = i * 3;
      const baseX = this.starBasePositions[i3] ?? 0;
      const wrappedX = ((((baseX - this.starTravelOffset + 17) % 34) + 34) % 34) - 17;
      this.starPositions[i3] = wrappedX;
    }
    starPosAttr.needsUpdate = true;
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);

    for (const tex of this.loadedTextures) {
      tex.dispose();
    }
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          for (const mat of obj.material) mat.dispose();
        } else {
          obj.material.dispose();
        }
      }
    });
    this.renderer.dispose();
  }
}
