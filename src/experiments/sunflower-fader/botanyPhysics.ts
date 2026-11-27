import {
  clamp,
  clamp01,
  computePhasedProgress,
  lerp,
  mulberry32,
  smoothstep,
  valueNoise1D,
} from "./colorAndCurves";
import {
  BLEED_X,
  BLEED_Y,
  CARD_HEIGHT,
  CARD_WIDTH,
  type CloudState,
  type GrassBlade,
  HEAD_CARD_Y_MAX,
  HEAD_CARD_Y_MIN,
  type HeadPose,
  type InsectState,
  type Particle,
  type SimStepInput,
  type StemNode,
  type SunflowerSimState,
} from "./types";

const STEM_SEGMENTS = 48;
const BEZIER_ARC_SAMPLES = 96;
const LEAF_COUNT = 10;

interface LeafBlueprint {
  id: number;
  stemT: number;
  side: -1 | 1;
  petioleWilted: number;
  petioleLush: number;
  petioleLushLift: number;
  lengthWilted: number;
  lengthLush: number;
  widthWilted: number;
  widthLush: number;
  lushPitchOffset: number;
  twistBase: number;
  zOrder: number;
  colorBias: number;
  phase: number;
  gamma: number;
  winStart: number;
  winEnd: number;
  sWeight: number;
  lenGamma: number;
  widthGamma: number;
  postureGamma: number;
}

const LEAF_BLUEPRINTS: readonly LeafBlueprint[] = [
  {
    id: 0,
    stemT: 0.16,
    side: -1,
    petioleWilted: 20,
    petioleLush: 22,
    petioleLushLift: -0.26,
    lengthWilted: 30,
    lengthLush: 66,
    widthWilted: 12,
    widthLush: 54,
    lushPitchOffset: 0.34,
    twistBase: -0.18,
    zOrder: 1,
    colorBias: -0.08,
    phase: 0.4,
    gamma: 0.56,
    winStart: 0.0,
    winEnd: 0.72,
    sWeight: 0.52,
    lenGamma: 0.82,
    widthGamma: 1.18,
    postureGamma: 0.88,
  },
  {
    id: 1,
    stemT: 0.22,
    side: 1,
    petioleWilted: 22,
    petioleLush: 20,
    petioleLushLift: -0.22,
    lengthWilted: 32,
    lengthLush: 66,
    widthWilted: 13,
    widthLush: 60,
    lushPitchOffset: 0.38,
    twistBase: 0.14,
    zOrder: 1,
    colorBias: 0.05,
    phase: 1.3,
    gamma: 0.78,
    winStart: 0.04,
    winEnd: 0.82,
    sWeight: 0.48,
    lenGamma: 0.9,
    widthGamma: 1.24,
    postureGamma: 0.94,
  },
  {
    id: 2,
    stemT: 0.31,
    side: -1,
    petioleWilted: 24,
    petioleLush: 20,
    petioleLushLift: -0.24,
    lengthWilted: 36,
    lengthLush: 68,
    widthWilted: 14,
    widthLush: 64,
    lushPitchOffset: 0.4,
    twistBase: -0.08,
    zOrder: 1,
    colorBias: 0.12,
    phase: 2.1,
    gamma: 0.64,
    winStart: 0.02,
    winEnd: 0.76,
    sWeight: 0.55,
    lenGamma: 0.85,
    widthGamma: 1.22,
    postureGamma: 0.82,
  },
  {
    id: 3,
    stemT: 0.38,
    side: 1,
    petioleWilted: 26,
    petioleLush: 38,
    petioleLushLift: -0.44,
    lengthWilted: 38,
    lengthLush: 94,
    widthWilted: 14,
    widthLush: 56,
    lushPitchOffset: 0.16,
    twistBase: 0.28,
    zOrder: 0,
    colorBias: -0.04,
    phase: 3.0,
    gamma: 1.26,
    winStart: 0.12,
    winEnd: 0.92,
    sWeight: 0.5,
    lenGamma: 0.94,
    widthGamma: 1.32,
    postureGamma: 1.06,
  },
  {
    id: 4,
    stemT: 0.47,
    side: -1,
    petioleWilted: 28,
    petioleLush: 38,
    petioleLushLift: -0.48,
    lengthWilted: 40,
    lengthLush: 94,
    widthWilted: 15,
    widthLush: 58,
    lushPitchOffset: 0.12,
    twistBase: -0.26,
    zOrder: 0,
    colorBias: 0.08,
    phase: 3.9,
    gamma: 1.48,
    winStart: 0.16,
    winEnd: 0.95,
    sWeight: 0.54,
    lenGamma: 0.96,
    widthGamma: 1.36,
    postureGamma: 1.12,
  },
  {
    id: 5,
    stemT: 0.53,
    side: 1,
    petioleWilted: 23,
    petioleLush: 16,
    petioleLushLift: -0.18,
    lengthWilted: 34,
    lengthLush: 64,
    widthWilted: 14,
    widthLush: 66,
    lushPitchOffset: 0.42,
    twistBase: 0.06,
    zOrder: 1,
    colorBias: 0.15,
    phase: 4.7,
    gamma: 0.88,
    winStart: 0.06,
    winEnd: 0.85,
    sWeight: 0.46,
    lenGamma: 0.86,
    widthGamma: 1.16,
    postureGamma: 0.9,
  },
  {
    id: 6,
    stemT: 0.63,
    side: -1,
    petioleWilted: 24,
    petioleLush: 36,
    petioleLushLift: -0.56,
    lengthWilted: 34,
    lengthLush: 90,
    widthWilted: 13,
    widthLush: 50,
    lushPitchOffset: -0.06,
    twistBase: -0.22,
    zOrder: 0,
    colorBias: -0.1,
    phase: 5.4,
    gamma: 1.15,
    winStart: 0.1,
    winEnd: 0.9,
    sWeight: 0.52,
    lenGamma: 0.92,
    widthGamma: 1.28,
    postureGamma: 1.02,
  },
  {
    id: 7,
    stemT: 0.7,
    side: 1,
    petioleWilted: 22,
    petioleLush: 36,
    petioleLushLift: -0.58,
    lengthWilted: 32,
    lengthLush: 88,
    widthWilted: 12,
    widthLush: 48,
    lushPitchOffset: -0.08,
    twistBase: 0.24,
    zOrder: 0,
    colorBias: 0.04,
    phase: 0.9,
    gamma: 1.62,
    winStart: 0.2,
    winEnd: 0.97,
    sWeight: 0.54,
    lenGamma: 1.0,
    widthGamma: 1.4,
    postureGamma: 1.16,
  },
  {
    id: 8,
    stemT: 0.79,
    side: -1,
    petioleWilted: 19,
    petioleLush: 20,
    petioleLushLift: -0.64,
    lengthWilted: 26,
    lengthLush: 54,
    widthWilted: 10,
    widthLush: 38,
    lushPitchOffset: -0.18,
    twistBase: -0.18,
    zOrder: -1,
    colorBias: 0.1,
    phase: 2.6,
    gamma: 1.38,
    winStart: 0.15,
    winEnd: 0.94,
    sWeight: 0.5,
    lenGamma: 0.94,
    widthGamma: 1.34,
    postureGamma: 1.08,
  },
  {
    id: 9,
    stemT: 0.87,
    side: 1,
    petioleWilted: 18,
    petioleLush: 20,
    petioleLushLift: -0.68,
    lengthWilted: 24,
    lengthLush: 56,
    widthWilted: 9,
    widthLush: 34,
    lushPitchOffset: -0.26,
    twistBase: 0.2,
    zOrder: -1,
    colorBias: 0.02,
    phase: 4.1,
    gamma: 1.92,
    winStart: 0.24,
    winEnd: 1.0,
    sWeight: 0.56,
    lenGamma: 1.04,
    widthGamma: 1.44,
    postureGamma: 1.2,
  },
];

function evalLeafCurve(
  x: number,
  gamma: number,
  winStart: number,
  winEnd: number,
  sWeight: number,
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const powCurve = x ** gamma;
  const sCurve = smoothstep(winStart, winEnd, x);
  return clamp01(lerp(powCurve, sCurve, sWeight));
}

const INSECT_EDGE_MARGIN = 34;

interface InsectFlightPlan {
  kind: "bee" | "butterfly";
  entryDir: -1 | 1;
  elapsed: number;
  totalDuration: number;
  approachDuration: number;
  hoverDuration: number;
  departDuration: number;
  startX: number;
  startY: number;
  approachArcY: number;
  hoverOffX: number;
  hoverOffY: number;
  departLiftY: number;
  departArcY: number;
  endX: number;
  endY: number;
  hoverSeed: number;
  ctrl1X: number;
  ctrl1Y: number;
  ctrl2X: number;
  ctrl2Y: number;
  meanderAmp: number;
  meanderPhase: number;
  wingOmega: number;
  glideStart1: number;
  glideEnd1: number;
  glideStart2: number;
  glideEnd2: number;
  smoothVx: number;
  smoothVy: number;
  bobOffsetY: number;
  fleeing: boolean;
  fleeElapsed: number;
  fleeDuration: number;
  fleeP0X: number;
  fleeP0Y: number;
  fleeP1X: number;
  fleeP1Y: number;
  fleeP2X: number;
  fleeP2Y: number;
  fleeEndX: number;
  fleeEndY: number;
}

interface InternalState {
  rng: () => number;
  arcLengths: Float64Array;
  nextInsectKind: "bee" | "butterfly";
  insectPlan: InsectFlightPlan | null;
  leafWavePhase: number;
  grassWavePhase: number;
  wasDragging: boolean;
  dragGrabOffsetX: number;
  dragGrabOffsetY: number;
  overdragY: number;
  dragSwayX: number;
}

const internalMap = new WeakMap<SunflowerSimState, InternalState>();

function createInternalState(): InternalState {
  return {
    rng: mulberry32(847293),
    arcLengths: new Float64Array(BEZIER_ARC_SAMPLES + 1),
    nextInsectKind: "bee",
    insectPlan: null,
    leafWavePhase: 0,
    grassWavePhase: 0,
    wasDragging: false,
    dragGrabOffsetX: 0,
    dragGrabOffsetY: 0,
    overdragY: 0,
    dragSwayX: 0,
  };
}

function getInternalState(state: SunflowerSimState): InternalState {
  let internal = internalMap.get(state);
  if (!internal) {
    internal = createInternalState();
    internalMap.set(state, internal);
  }
  return internal;
}

function createInitialClouds(): CloudState[] {
  const rng = mulberry32(10321);
  const presets = [
    { x: BLEED_X + 36, y: BLEED_Y + 96, width: 112, height: 34, speed: 2.4 },
    { x: BLEED_X + 168, y: BLEED_Y + 74, width: 96, height: 28, speed: 1.8 },
    { x: BLEED_X + 124, y: BLEED_Y + 168, width: 138, height: 38, speed: 3.0 },
    { x: BLEED_X + 20, y: BLEED_Y + 216, width: 108, height: 30, speed: 2.1 },
    { x: BLEED_X + 186, y: BLEED_Y + 242, width: 116, height: 32, speed: 2.6 },
  ];
  return presets.map((p, id) => ({
    id,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
    speed: p.speed,
    opacity: 0.4,
    seed: Math.floor(rng() * 100000),
  }));
}

function createInitialGrass(): GrassBlade[] {
  const rng = mulberry32(55193);
  const blades: GrassBlade[] = [];
  let id = 0;

  // Back meadow layer (tall sunlit blades)
  for (let i = 0; i < 42; i++) {
    const nx = (i + rng() * 0.85) / 42;
    const edgeBoost = 1 + Math.abs(nx - 0.5) * 0.65;
    blades.push({
      id: id++,
      baseX: BLEED_X + nx * CARD_WIDTH,
      baseY: BLEED_Y + CARD_HEIGHT + 3,
      height: (78 + rng() * 78) * edgeBoost,
      lean: (nx - 0.5) * 0.24 + (rng() - 0.5) * 0.34,
      bend: 0,
      thickness: 1.5 + rng() * 1.4,
      layer: "back",
      kind: "grass",
      seed: Math.floor(rng() * 100000),
      phase: rng() * Math.PI * 2,
      bloomThreshold: 0,
      flowerHue: 45,
    });
  }

  // Mid meadow layer (dense body + weeds + wildflowers)
  for (let i = 0; i < 40; i++) {
    const nx = (i + rng() * 0.85) / 40;
    const edgeBoost = 1 + Math.abs(nx - 0.5) * 0.5;
    blades.push({
      id: id++,
      baseX: BLEED_X + nx * CARD_WIDTH,
      baseY: BLEED_Y + CARD_HEIGHT + 4,
      height: (56 + rng() * 72) * edgeBoost,
      lean: (nx - 0.5) * 0.22 + (rng() - 0.5) * 0.36,
      bend: 0,
      thickness: 1.8 + rng() * 1.5,
      layer: "mid",
      kind: "grass",
      seed: Math.floor(rng() * 100000),
      phase: rng() * Math.PI * 2,
      bloomThreshold: 0,
      flowerHue: 45,
    });
  }

  // Dried/meadow weeds & wildflowers matching reference side clusters
  const wildflowerPositions = [
    0.07, 0.11, 0.16, 0.22, 0.28, 0.36, 0.44, 0.58, 0.67, 0.74, 0.81, 0.87, 0.92,
  ];
  for (let i = 0; i < wildflowerPositions.length; i++) {
    const nx = wildflowerPositions[i] ?? 0.5;
    const isLeftCluster = nx < 0.24;
    const isRightCluster = nx > 0.76;
    blades.push({
      id: id++,
      baseX: BLEED_X + nx * CARD_WIDTH,
      baseY: BLEED_Y + CARD_HEIGHT + 2,
      height: isLeftCluster || isRightCluster ? 95 + rng() * 68 : 68 + rng() * 52,
      lean: (nx - 0.5) * 0.35 + (rng() - 0.5) * 0.18,
      bend: 0,
      thickness: 1.5 + rng() * 0.7,
      layer: i % 3 === 0 ? "front" : "mid",
      kind: "wildflower",
      seed: Math.floor(rng() * 100000),
      phase: rng() * Math.PI * 2,
      bloomThreshold: 0.48 + (i / wildflowerPositions.length) * 0.48,
      flowerHue: 36 + rng() * 20,
    });
  }

  // Subtle botanical weeds on left & center-low matching both reference artworks
  const weedPresets = [
    { nx: 0.09, height: 122, lean: -0.22 },
    { nx: 0.15, height: 102, lean: -0.1 },
    { nx: 0.48, height: 74, lean: 0.25 },
    { nx: 0.73, height: 84, lean: 0.08 },
    { nx: 0.86, height: 132, lean: 0.14 },
  ];
  for (const w of weedPresets) {
    blades.push({
      id: id++,
      baseX: BLEED_X + w.nx * CARD_WIDTH,
      baseY: BLEED_Y + CARD_HEIGHT + 2,
      height: w.height,
      lean: w.lean,
      bend: 0,
      thickness: 1.6,
      layer: "mid",
      kind: "weed",
      seed: Math.floor(rng() * 100000),
      phase: rng() * Math.PI * 2,
      bloomThreshold: 0.55,
      flowerHue: 42,
    });
  }

  // Distinct dry twigs on right and left edges matching both reference artworks
  const twigPresets: Array<{
    nx: number;
    height: number;
    lean: number;
    layer: "back" | "mid" | "front";
  }> = [
    { nx: 0.04, height: 158, lean: 0.18, layer: "back" },
    { nx: 0.11, height: 138, lean: 0.26, layer: "back" },
    { nx: 0.96, height: 214, lean: -0.22, layer: "back" },
    { nx: 0.88, height: 186, lean: -0.14, layer: "back" },
    { nx: 0.66, height: 128, lean: 0.54, layer: "front" },
    { nx: 0.78, height: 146, lean: 0.42, layer: "front" },
  ];
  for (const tw of twigPresets) {
    blades.push({
      id: id++,
      baseX: BLEED_X + tw.nx * CARD_WIDTH,
      baseY: BLEED_Y + CARD_HEIGHT + 2,
      height: tw.height,
      lean: tw.lean,
      bend: 0,
      thickness: tw.layer === "front" ? 2.1 : 1.5,
      layer: tw.layer,
      kind: "twig",
      seed: Math.floor(rng() * 100000),
      phase: rng() * Math.PI * 2,
      bloomThreshold: 0,
      flowerHue: 30,
    });
  }

  // Front foreground grass layer (rich blades grounding the stem)
  for (let i = 0; i < 24; i++) {
    const nx = (i + rng() * 0.85) / 24;
    const edgeBoost = 1 + Math.abs(nx - 0.5) * 0.45;
    blades.push({
      id: id++,
      baseX: BLEED_X + nx * CARD_WIDTH,
      baseY: BLEED_Y + CARD_HEIGHT + 5,
      height: (38 + rng() * 58) * edgeBoost,
      lean: (nx - 0.5) * 0.26 + (rng() - 0.5) * 0.42,
      bend: 0,
      thickness: 2.0 + rng() * 1.4,
      layer: "front",
      kind: "grass",
      seed: Math.floor(rng() * 100000),
      phase: rng() * Math.PI * 2,
      bloomThreshold: 0,
      flowerHue: 45,
    });
  }

  return blades;
}

function createInitialParticles(): Particle[] {
  const rng = mulberry32(99104);
  const particles: Particle[] = [];
  for (let i = 0; i < 26; i++) {
    const kind = i < 10 ? "dust" : "pollen";
    particles.push({
      id: i,
      x: BLEED_X + rng() * CARD_WIDTH,
      y:
        kind === "dust"
          ? BLEED_Y + CARD_HEIGHT * (0.45 + rng() * 0.52)
          : BLEED_Y + CARD_HEIGHT * (0.06 + rng() * 0.72),
      vx: (rng() - 0.35) * (kind === "dust" ? 5.5 : 4.5),
      vy: kind === "dust" ? 1.2 + rng() * 3.2 : -(2.4 + rng() * 5.0),
      size: kind === "dust" ? 1.1 + rng() * 1.3 : 1.4 + rng() * 2.0,
      alpha: 0,
      phase: rng() * Math.PI * 2,
      kind,
    });
  }
  return particles;
}

function createInitialInsect(): InsectState {
  return {
    active: false,
    kind: "bee",
    x: BLEED_X - 24,
    y: BLEED_Y + 120,
    vx: 0,
    vy: 0,
    wingPhase: 0,
    facing: 1,
    opacity: 0,
    scale: 1,
    cooldown: 1.8,
    progress: 0,
    startX: BLEED_X - 24,
    endX: BLEED_X + CARD_WIDTH + 24,
    baseY: BLEED_Y + 120,
    arcHeight: 24,
    hovering: 0,
    tilt: 0,
    glide: 0,
  };
}

function evalCubic(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const m = 1 - u;
  return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3;
}

function evalCubicDeriv(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const m = 1 - u;
  return 3 * m * m * (p1 - p0) + 6 * m * u * (p2 - p1) + 3 * u * u * (p3 - p2);
}

function buildStemAndPose(
  state: SunflowerSimState,
  internal: InternalState,
  reducedMotion: boolean,
): void {
  const { phases, wind } = state;
  const v = phases.raw;
  const uncurl = phases.stemUncurl;
  const grow = phases.stemGrow;
  const headLift = phases.headLift;
  const vitality = clamp01(phases.warmth * 0.38 + grow * 0.62);

  // 1. Exact 1:1 vertical tracking of head center from HEAD_CARD_Y_MIN (0%) to HEAD_CARD_Y_MAX (100%)
  // plus subtle rubber-band stretch when overdragging past 0% or 100%
  const breathY = reducedMotion ? 0 : Math.sin(state.time * 0.72) * 1.2;
  const headCardY = lerp(HEAD_CARD_Y_MIN, HEAD_CARD_Y_MAX, v) + breathY + internal.overdragY;

  // Smooth horizontal glide from 0.64 (drooping right of stem base) -> 0.50 (centered upright)
  // plus gentle horizontal sway following the pointer during drag
  const swayX = reducedMotion ? 0 : wind * lerp(1.8, 2.8, v);
  const headCardX = lerp(0.64, 0.5, uncurl) * CARD_WIDTH + swayX + internal.dragSwayX;

  const headCenterX = BLEED_X + headCardX;
  const headCenterY = BLEED_Y + headCardY;

  // 2. Head faces straight down into the ground at low values (-1.56 rad), lifting smoothly to face the user (0 rad)
  let gazeYaw = 0;
  let gazePitch = 0;
  if (!reducedMotion && state.pointerCanvas && state.hoverHead && !state.dragging) {
    const dx = clamp((state.pointerCanvas.x - headCenterX) / 120, -1, 1);
    const dy = clamp((state.pointerCanvas.y - headCenterY) / 120, -1, 1);
    const gazeWeight = 0.08 * lerp(0.15, 1.0, headLift);
    gazeYaw = dx * gazeWeight;
    gazePitch = -dy * gazeWeight * 0.55;
  }

  const gentleNod = reducedMotion ? 0 : Math.sin(state.time * 0.82 + 0.5) * 0.014;
  const pitchLift = smoothstep(0.1, 0.98, headLift) * 0.72 + headLift * 0.28;
  const pitch = clamp(
    lerp(-1.56, 0, pitchLift) + gentleNod * lerp(0.25, 1, headLift) + gazePitch,
    -1.56,
    0.16,
  );
  const dragYaw = clamp(internal.dragSwayX * 0.011, -0.16, 0.16) * headLift;
  const yaw = clamp(gazeYaw + dragYaw + (reducedMotion ? 0 : wind * 0.025 * headLift), -0.35, 0.35);

  const bloomFactor = clamp01(phases.bloom * 0.78 + headLift * 0.22);
  const headRadius = lerp(35, 74, bloomFactor);
  const diskRadius = lerp(20, 35, clamp01(phases.bloom * 0.68 + headLift * 0.32));

  // 3. Exact neck attachment point so the stem connects seamlessly straight into the top of the hanging bell at 0%
  const cupBackY = -diskRadius * 0.92 * Math.sin(Math.max(0, -pitch));
  const uprightNeckBlend = smoothstep(0.55, 0.98, headLift);
  const neckOffX = -Math.sin(smoothstep(0.12, 0.96, headLift) * Math.PI) * 4.0;
  const neckOffY = lerp(cupBackY, 14, uprightNeckBlend);

  const neckX = headCenterX + neckOffX;
  const neckY = headCenterY + neckOffY;

  // 4. 48-segment Cubic Bezier stem spine anchored directly from stem base (P0) to head.neck (P3)
  const baseCardX = lerp(0.36, 0.5, grow);
  const p0x = BLEED_X + baseCardX * CARD_WIDTH;
  const p0y = BLEED_Y + CARD_HEIGHT + 4;
  const p3x = neckX;
  const p3y = neckY;

  // Lower control point P1: rises straight up on the left for the crook, eases into a poised stalk
  const uprightP1Y = p0y - (p0y - p3y) * 0.34;
  const p1x = p0x + lerp(3.0, -2.2, uncurl) + swayX * 0.35;
  const p1y = lerp(BLEED_Y + 180, uprightP1Y, uncurl);

  // Upper control point P2: smoothly rotates around P3 from directly above (shepherd's crook at 0%)
  // through upper-left (graceful nod at 50%) to directly below (upright stalk at 100%)
  const entryAngle = uncurl ** 1.15 * Math.PI;
  const rx2 = 38;
  const ry2 = lerp(206, 138, uncurl);
  const p2x = p3x - Math.sin(entryAngle) * rx2 + lerp(0, 1.8, uncurl) + swayX * 0.25;
  const p2y = p3y - Math.cos(entryAngle) * ry2;

  // Build cumulative arc-length table so stem nodes & leaf placements space evenly along the curve
  const arcLengths = internal.arcLengths;
  arcLengths[0] = 0;
  let prevX = p0x;
  let prevY = p0y;
  let accum = 0;
  for (let s = 1; s <= BEZIER_ARC_SAMPLES; s++) {
    const u = s / BEZIER_ARC_SAMPLES;
    const bx = evalCubic(p0x, p1x, p2x, p3x, u);
    const by = evalCubic(p0y, p1y, p2y, p3y, u);
    accum += Math.hypot(bx - prevX, by - prevY);
    arcLengths[s] = accum;
    prevX = bx;
    prevY = by;
  }
  const totalArcLen = accum > 0.001 ? accum : 1;

  const stem: StemNode[] = state.stem;
  const baseRad = lerp(3.9, 5.4, vitality);
  const tipRad = lerp(1.8, 3.1, vitality);

  let sampleIdx = 0;
  for (let i = 0; i <= STEM_SEGMENTS; i++) {
    const t = i / STEM_SEGMENTS;
    let u: number;
    if (i === 0) {
      u = 0;
    } else if (i === STEM_SEGMENTS) {
      u = 1;
    } else {
      const targetLen = t * totalArcLen;
      while (sampleIdx < BEZIER_ARC_SAMPLES - 1 && (arcLengths[sampleIdx + 1] ?? 0) < targetLen) {
        sampleIdx++;
      }
      const len0 = arcLengths[sampleIdx] ?? 0;
      const len1 = arcLengths[sampleIdx + 1] ?? totalArcLen;
      const segSpan = len1 - len0;
      const frac = segSpan > 1e-6 ? (targetLen - len0) / segSpan : 0;
      u = (sampleIdx + clamp01(frac)) / BEZIER_ARC_SAMPLES;
    }

    const x = i === STEM_SEGMENTS ? p3x : evalCubic(p0x, p1x, p2x, p3x, u);
    const y = i === STEM_SEGMENTS ? p3y : evalCubic(p0y, p1y, p2y, p3y, u);

    const dx = evalCubicDeriv(p0x, p1x, p2x, p3x, u);
    const dy = evalCubicDeriv(p0y, p1y, p2y, p3y, u);
    const dLen = Math.hypot(dx, dy) || 1;
    const tx = dx / dLen;
    const ty = dy / dLen;
    const radius = lerp(baseRad, tipRad, t ** 0.82);

    const node = stem[i];
    if (node) {
      node.x = x;
      node.y = y;
      node.tx = tx;
      node.ty = ty;
      node.radius = radius;
      node.t = t;
    } else {
      stem.push({ x, y, tx, ty, radius, t });
    }
  }

  // Gentle roll following calm stem poise & slow breeze
  const neckNode = stem[STEM_SEGMENTS];
  const neckTx = neckNode ? neckNode.tx : 0;
  const neckTy = neckNode ? neckNode.ty : -1;
  const uprightLean = Math.atan2(neckTx, Math.max(0.25, -neckTy));
  const dragRoll = clamp(internal.dragSwayX * 0.008, -0.11, 0.11);
  const roll =
    clamp(uprightLean * 0.25 * headLift + dragRoll, -0.18, 0.18) +
    (reducedMotion ? 0 : wind * lerp(0.032, 0.022, vitality));

  const bloomOpen = clamp01(phases.bloom);
  const petalCurl = clamp01(lerp(0.95, 0.05, clamp01(phases.bloom * 0.8 + phases.warmth * 0.2)));
  const petalDroop = clamp01(lerp(0.96, 0.05, clamp01(headLift * 0.45 + phases.bloom * 0.55)));
  const petalLength = lerp(19, 41, clamp01(phases.bloom * 0.82 + phases.warmth * 0.18));
  const headVitality = clamp01(phases.warmth * 0.28 + phases.bloom * 0.72);

  state.head.center.x = headCenterX;
  state.head.center.y = headCenterY;
  state.head.neck.x = neckX;
  state.head.neck.y = neckY;
  state.head.radius = headRadius;
  state.head.diskRadius = diskRadius;
  state.head.pitch = pitch;
  state.head.yaw = yaw;
  state.head.roll = roll;
  state.head.bloomOpen = bloomOpen;
  state.head.petalCurl = petalCurl;
  state.head.petalDroop = petalDroop;
  state.head.petalLength = petalLength;
  state.head.vitality = headVitality;

  // 5. Build the 10 permanent alternating leaves along the stem with calm slow breeze sway
  const leaves = state.leaves;
  const leafUnfurl = phases.leafUnfurl;
  const earlyTurgor = clamp01(phases.warmth * 0.4 + leafUnfurl * 0.6);

  for (let i = 0; i < LEAF_COUNT; i++) {
    const bp = LEAF_BLUEPRINTS[i];
    if (!bp) continue;

    // Sample stem node smoothly at bp.stemT
    const exactIdx = bp.stemT * STEM_SEGMENTS;
    const idx0 = Math.min(STEM_SEGMENTS - 1, Math.floor(exactIdx));
    const frac = exactIdx - idx0;
    const n0 = stem[idx0];
    const n1 = stem[idx0 + 1];
    const sx = n0 && n1 ? lerp(n0.x, n1.x, frac) : p0x;
    const sy = n0 && n1 ? lerp(n0.y, n1.y, frac) : p0y;
    const stx = n0 && n1 ? lerp(n0.tx, n1.tx, frac) : 0;
    const sty = n0 && n1 ? lerp(n0.ty, n1.ty, frac) : -1;
    const sRad = n0 && n1 ? lerp(n0.radius, n1.radius, frac) : 3;

    // Right-hand perpendicular to stem tangent
    const nx = -sty;
    const ny = stx;
    const attachX = sx + nx * bp.side * sRad * 0.65;
    const attachY = sy + ny * bp.side * sRad * 0.65;

    // Per-leaf individualized organic response curves: some wilt earlier/revive later, others hold turgor longer,
    // while all 10 leaves converge strictly to 0 at 0% and 1 at 100%.
    const localUnfurl = evalLeafCurve(leafUnfurl, bp.gamma, bp.winStart, bp.winEnd, bp.sWeight);
    const localTurgor = evalLeafCurve(
      earlyTurgor,
      bp.gamma * 0.92,
      bp.winStart * 0.8,
      bp.winEnd,
      bp.sWeight * 0.75,
    );
    const lenT = localUnfurl <= 0 ? 0 : localUnfurl >= 1 ? 1 : localUnfurl ** bp.lenGamma;
    const widthT = localUnfurl <= 0 ? 0 : localUnfurl >= 1 ? 1 : localUnfurl ** bp.widthGamma;
    const postureT = localUnfurl <= 0 ? 0 : localUnfurl >= 1 ? 1 : localUnfurl ** bp.postureGamma;

    // Calm, slow botanical sway using integrated phase so changing slider value never jumps wave phase
    const leafSway = reducedMotion
      ? 0
      : Math.sin(internal.leafWavePhase + bp.phase) * lerp(0.032, 0.048, v) +
        wind * lerp(0.022, 0.032, v) * (bp.side === 1 ? 1 : 0.85);

    // Petiole vector: arches outward then droops downward at 0%, ascends gracefully outward at 100%
    const petioleLen = lerp(bp.petioleWilted, bp.petioleLush, lenT);
    const petioleOutX = bp.side * lerp(0.68, 0.84, postureT);
    const petioleOutY = lerp(0.73, bp.petioleLushLift, postureT);
    const pNorm = Math.hypot(petioleOutX, petioleOutY) || 1;

    const petioleAngle = Math.atan2(petioleOutY / pNorm, petioleOutX / pNorm) + leafSway * 0.4;
    const petioleEndX = attachX + Math.cos(petioleAngle) * petioleLen;
    const petioleEndY = attachY + Math.sin(petioleAngle) * petioleLen;

    // Leaf blade angle: hangs downward at 0%, fans wide outward at 100%
    const wiltedBladeAngle = Math.PI * 0.5 + bp.side * 0.12;
    const lushBladeAngle = bp.side === 1 ? bp.lushPitchOffset : Math.PI - bp.lushPitchOffset;

    let angleDiff = lushBladeAngle - wiltedBladeAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const bladeAngle = wiltedBladeAngle + angleDiff * postureT + leafSway;

    const length = lerp(bp.lengthWilted, bp.lengthLush, lenT);
    const width = lerp(bp.widthWilted, bp.widthLush, widthT);
    const tipX = petioleEndX + Math.cos(bladeAngle) * length;
    const tipY = petioleEndY + Math.sin(bladeAngle) * length;

    const droop = clamp01(lerp(0.94, 0.18 + Math.max(0, bp.lushPitchOffset) * 0.3, postureT));
    const curl = clamp01(lerp(0.92, 0.06, widthT));
    const twist = lerp(bp.twistBase * 1.4, bp.twistBase, localUnfurl);
    const colorMix = clamp01(localTurgor + bp.colorBias * (1 - localUnfurl * 0.5));

    const existing = leaves[i];
    if (existing) {
      existing.stemT = bp.stemT;
      existing.side = bp.side;
      existing.attach.x = attachX;
      existing.attach.y = attachY;
      existing.petioleEnd.x = petioleEndX;
      existing.petioleEnd.y = petioleEndY;
      existing.tip.x = tipX;
      existing.tip.y = tipY;
      existing.angle = bladeAngle;
      existing.length = length;
      existing.width = width;
      existing.droop = droop;
      existing.curl = curl;
      existing.turgor = localTurgor;
      existing.twist = twist;
      existing.zOrder = bp.zOrder;
      existing.colorMix = colorMix;
    } else {
      leaves.push({
        id: bp.id,
        stemT: bp.stemT,
        side: bp.side,
        attach: { x: attachX, y: attachY },
        petioleEnd: { x: petioleEndX, y: petioleEndY },
        tip: { x: tipX, y: tipY },
        angle: bladeAngle,
        length,
        width,
        droop,
        curl,
        turgor: localTurgor,
        twist,
        zOrder: bp.zOrder,
        colorMix,
      });
    }
  }
}

function updateEnvironment(
  state: SunflowerSimState,
  internal: InternalState,
  dt: number,
  reducedMotion: boolean,
): void {
  const { phases, clouds, grass, particles } = state;

  // Clouds drift lazily across the pastel sky
  const cloudOpacityBase = lerp(0.18, 0.84, clamp01(phases.warmth * 0.55 + phases.stemGrow * 0.45));
  for (let i = 0; i < clouds.length; i++) {
    const cloud = clouds[i];
    if (!cloud) continue;
    if (!reducedMotion) {
      cloud.x += (cloud.speed + state.wind * 0.8) * dt;
      const wrapRight = BLEED_X + CARD_WIDTH + cloud.width * 0.65;
      const wrapLeft = BLEED_X - cloud.width * 0.65;
      if (cloud.x > wrapRight) {
        cloud.x = wrapLeft;
      } else if (cloud.x < wrapLeft) {
        cloud.x = wrapRight;
      }
    }
    cloud.opacity = cloudOpacityBase * (0.75 + (i % 3) * 0.12);
  }

  // Slow, serene grass sway in gentle rolling breeze (6-9s period)
  const meadowVitality = clamp01(phases.warmth * 0.5 + phases.leafUnfurl * 0.5);
  for (let i = 0; i < grass.length; i++) {
    const blade = grass[i];
    if (!blade) continue;
    if (reducedMotion) {
      blade.bend = 0;
      continue;
    }
    const stiffness = blade.kind === "twig" ? 0.14 : blade.kind === "wildflower" ? 0.65 : 1.0;
    const wave = Math.sin(internal.grassWavePhase + blade.baseX * 0.018 + blade.phase * 0.6);
    const breeze = state.wind * 0.075 + wave * lerp(0.038, 0.068, meadowVitality);
    blade.bend = breeze * stiffness;
  }

  // Dust (low v) & Golden Pollen (high v) floating lazily
  const dustAlphaMax = smoothstep(0.45, 0.0, phases.raw) * 0.48;
  const pollenAlphaMax = phases.ecosystem * 0.82;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (!p) continue;
    if (!reducedMotion) {
      if (p.kind === "dust") {
        p.x += (p.vx + state.wind * 6) * dt;
        p.y += (p.vy + Math.sin(state.time * 0.75 + p.phase) * 2.2) * dt;
      } else {
        p.x += (p.vx + state.wind * 5 + Math.sin(state.time * 0.68 + p.phase) * 3.8) * dt;
        p.y += (p.vy + Math.cos(state.time * 0.62 + p.phase) * 1.8) * dt;
      }

      if (p.x > BLEED_X + CARD_WIDTH + 18) p.x = BLEED_X - 12;
      if (p.x < BLEED_X - 18) p.x = BLEED_X + CARD_WIDTH + 12;
      if (p.y < BLEED_Y + 8) p.y = BLEED_Y + CARD_HEIGHT * 0.72;
      if (p.y > BLEED_Y + CARD_HEIGHT - 8) p.y = BLEED_Y + CARD_HEIGHT * 0.36;
    }

    const shimmer = 0.6 + 0.4 * Math.sin(state.time * 1.05 + p.phase);
    p.alpha = p.kind === "dust" ? dustAlphaMax * shimmer : pollenAlphaMax * shimmer;
  }

  updateInsect(state, internal, dt, reducedMotion);
}

function spawnInsectFlight(state: SunflowerSimState, internal: InternalState): void {
  const { insect, head } = state;
  const rng = internal.rng;
  const kind = internal.nextInsectKind;
  internal.nextInsectKind = kind === "bee" ? "butterfly" : "bee";

  const fromLeft = rng() > 0.5;
  const entryDir: -1 | 1 = fromLeft ? 1 : -1;

  if (kind === "bee") {
    const startX = fromLeft
      ? BLEED_X - INSECT_EDGE_MARGIN
      : BLEED_X + CARD_WIDTH + INSECT_EDGE_MARGIN;
    const startY = BLEED_Y + 48 + rng() * 140;

    const hoverDist = head.diskRadius * (0.94 + rng() * 0.36);
    const hoverAngle = (rng() - 0.36) * 1.1;
    const hoverOffX = -entryDir * Math.cos(hoverAngle) * hoverDist;
    const hoverOffY = Math.sin(hoverAngle) * hoverDist;

    const approachDuration = 2.0 + rng() * 0.5;
    const hoverDuration = 1.9 + rng() * 0.85;
    const departDuration = 2.1 + rng() * 0.55;
    const totalDuration = approachDuration + hoverDuration + departDuration;

    const exitTop = rng() < 0.35;
    const endX = exitTop
      ? BLEED_X + CARD_WIDTH * (entryDir === 1 ? 0.64 + rng() * 0.3 : 0.06 + rng() * 0.3)
      : entryDir === 1
        ? BLEED_X + CARD_WIDTH + INSECT_EDGE_MARGIN
        : BLEED_X - INSECT_EDGE_MARGIN;
    const endY = exitTop ? BLEED_Y - INSECT_EDGE_MARGIN : BLEED_Y + 28 + rng() * 110;
    const approachArcY = (rng() > 0.35 ? -1 : 1) * (16 + rng() * 22);

    internal.insectPlan = {
      kind,
      entryDir,
      elapsed: 0,
      totalDuration,
      approachDuration,
      hoverDuration,
      departDuration,
      startX,
      startY,
      approachArcY,
      hoverOffX,
      hoverOffY,
      departLiftY: 24 + rng() * 18,
      departArcY: 12 + rng() * 18,
      endX,
      endY,
      hoverSeed: rng() * Math.PI * 2,
      ctrl1X: 0,
      ctrl1Y: 0,
      ctrl2X: 0,
      ctrl2Y: 0,
      meanderAmp: 0,
      meanderPhase: 0,
      wingOmega: 185,
      glideStart1: 0,
      glideEnd1: 0,
      glideStart2: 0,
      glideEnd2: 0,
      smoothVx: entryDir * 44,
      smoothVy: 0,
      bobOffsetY: 0,
      fleeing: false,
      fleeElapsed: 0,
      fleeDuration: 1,
      fleeP0X: 0,
      fleeP0Y: 0,
      fleeP1X: 0,
      fleeP1Y: 0,
      fleeP2X: 0,
      fleeP2Y: 0,
      fleeEndX: endX,
      fleeEndY: endY,
    };

    insect.active = true;
    insect.kind = kind;
    insect.facing = entryDir;
    insect.startX = startX;
    insect.endX = endX;
    insect.baseY = startY;
    insect.arcHeight = Math.abs(approachArcY);
    insect.progress = 0;
    insect.scale = 0.96 + rng() * 0.18;
    insect.x = startX;
    insect.y = startY;
    insect.vx = entryDir * 44;
    insect.vy = 0;
    insect.opacity = 1;
    insect.hovering = 0;
    insect.tilt = 0.05;
    insect.glide = 0;
    return;
  }

  const startX = fromLeft
    ? BLEED_X - INSECT_EDGE_MARGIN
    : BLEED_X + CARD_WIDTH + INSECT_EDGE_MARGIN;
  const endX = fromLeft ? BLEED_X + CARD_WIDTH + INSECT_EDGE_MARGIN : BLEED_X - INSECT_EDGE_MARGIN;
  const startY = BLEED_Y + 64 + rng() * 170;
  const endY = BLEED_Y + 56 + rng() * 180;
  const sDir = rng() > 0.5 ? 1 : -1;
  const sAmp = 34 + rng() * 26;
  const ctrl1X = lerp(startX, endX, 0.33);
  const ctrl1Y = clamp(lerp(startY, endY, 0.33) + sDir * sAmp, BLEED_Y + 34, BLEED_Y + 310);
  const ctrl2X = lerp(startX, endX, 0.67);
  const ctrl2Y = clamp(lerp(startY, endY, 0.67) - sDir * sAmp * 0.9, BLEED_Y + 34, BLEED_Y + 310);

  const glideStart1 = 0.24 + rng() * 0.08;
  const glideEnd1 = glideStart1 + 0.075 + rng() * 0.035;
  const glideStart2 = 0.62 + rng() * 0.08;
  const glideEnd2 = glideStart2 + 0.075 + rng() * 0.035;

  internal.insectPlan = {
    kind,
    entryDir,
    elapsed: 0,
    totalDuration: 8.4 + rng() * 2.1,
    approachDuration: 0,
    hoverDuration: 0,
    departDuration: 0,
    startX,
    startY,
    approachArcY: 0,
    hoverOffX: 0,
    hoverOffY: 0,
    departLiftY: 0,
    departArcY: 0,
    endX,
    endY,
    hoverSeed: 0,
    ctrl1X,
    ctrl1Y,
    ctrl2X,
    ctrl2Y,
    meanderAmp: 10 + rng() * 8,
    meanderPhase: rng() * Math.PI * 2,
    wingOmega: 22.8 + rng() * 4.4,
    glideStart1,
    glideEnd1,
    glideStart2,
    glideEnd2,
    smoothVx: entryDir * 28,
    smoothVy: 0,
    bobOffsetY: 0,
    fleeing: false,
    fleeElapsed: 0,
    fleeDuration: 1,
    fleeP0X: 0,
    fleeP0Y: 0,
    fleeP1X: 0,
    fleeP1Y: 0,
    fleeP2X: 0,
    fleeP2Y: 0,
    fleeEndX: endX,
    fleeEndY: endY,
  };

  insect.active = true;
  insect.kind = kind;
  insect.facing = entryDir;
  insect.startX = startX;
  insect.endX = endX;
  insect.baseY = startY;
  insect.arcHeight = sAmp;
  insect.progress = 0;
  insect.scale = 0.96 + rng() * 0.18;
  insect.wingPhase = rng() * Math.PI * 2;
  insect.x = startX;
  insect.y = startY;
  insect.vx = entryDir * 28;
  insect.vy = 0;
  insect.opacity = 1;
  insect.hovering = 0;
  insect.tilt = 0;
  insect.glide = 0;
}

function beginInsectFlee(insect: InsectState, plan: InsectFlightPlan, rng: () => number): void {
  const exitDir = plan.entryDir;
  const fleeEndX =
    exitDir === 1 ? BLEED_X + CARD_WIDTH + INSECT_EDGE_MARGIN : BLEED_X - INSECT_EDGE_MARGIN;
  const fleeEndY = clamp(insect.y - (32 + rng() * 48), BLEED_Y - INSECT_EDGE_MARGIN, BLEED_Y + 135);
  const dist = Math.hypot(fleeEndX - insect.x, fleeEndY - insect.y);
  const fleeDuration =
    plan.kind === "bee" ? clamp(dist / 165, 0.55, 1.45) : clamp(dist / 118, 0.75, 1.9);

  const v0x = clamp(plan.smoothVx, -95, 95);
  const v0y = clamp(plan.smoothVy, -70, 50);

  plan.fleeing = true;
  plan.fleeElapsed = 0;
  plan.fleeDuration = fleeDuration;
  plan.fleeP0X = insect.x;
  plan.fleeP0Y = insect.y;
  plan.fleeP1X = insect.x + (v0x * fleeDuration) / 3;
  plan.fleeP1Y = insect.y + (v0y * fleeDuration) / 3;
  plan.fleeP2X = lerp(insect.x, fleeEndX, 0.68);
  plan.fleeP2Y = lerp(insect.y, fleeEndY, 0.55) - (plan.kind === "bee" ? 18 : 22);
  plan.fleeEndX = fleeEndX;
  plan.fleeEndY = fleeEndY;
}

function updateInsect(
  state: SunflowerSimState,
  internal: InternalState,
  dt: number,
  reducedMotion: boolean,
): void {
  const { phases, insect, head } = state;

  if (reducedMotion) {
    insect.active = false;
    insect.opacity = 0;
    insect.hovering = 0;
    insect.tilt = 0;
    insect.glide = 0;
    internal.insectPlan = null;
    return;
  }

  const allowPollinator = state.targetValue > 80 && phases.raw > 0.8;

  if (!insect.active) {
    insect.opacity = 0;
    insect.hovering = 0;
    insect.glide = 0;
    if (allowPollinator) {
      insect.cooldown -= dt;
      if (insect.cooldown <= 0) {
        spawnInsectFlight(state, internal);
      }
    } else {
      insect.cooldown = Math.min(insect.cooldown, 1.8);
    }
    return;
  }

  const plan = internal.insectPlan;
  if (!plan) {
    insect.active = false;
    insect.opacity = 0;
    return;
  }

  if (!plan.fleeing && !allowPollinator) {
    const outsideCard =
      insect.x < BLEED_X - 16 || insect.x > BLEED_X + CARD_WIDTH + 16 || insect.y < BLEED_Y - 16;
    if (outsideCard) {
      insect.active = false;
      insect.opacity = 0;
      insect.hovering = 0;
      insect.tilt = 0;
      insect.glide = 0;
      insect.cooldown = 1.8;
      internal.insectPlan = null;
      return;
    }
    beginInsectFlee(insect, plan, internal.rng);
  }

  const prevX = insect.x;
  const prevY = insect.y;

  if (plan.fleeing) {
    plan.fleeElapsed += dt;
    const ft = clamp01(plan.fleeElapsed / plan.fleeDuration);
    const fs = 0.25 * ft + 0.75 * (ft * ft * (3 - 2 * ft));
    insect.progress = ft;

    const baseX = evalCubic(plan.fleeP0X, plan.fleeP1X, plan.fleeP2X, plan.fleeEndX, fs);
    const baseY = evalCubic(plan.fleeP0Y, plan.fleeP1Y, plan.fleeP2Y, plan.fleeEndY, fs);

    let nextX = baseX;
    let nextY = baseY;

    if (plan.kind === "bee") {
      insect.hovering *= Math.exp(-9 * dt);
      insect.glide = 0;
      insect.wingPhase += dt * 206;
      nextY += Math.sin(plan.fleeElapsed * 8.5) * 1.2 * (1 - ft * 0.5);
    } else {
      insect.hovering = 0;
      insect.glide *= Math.exp(-10 * dt);
      insect.wingPhase += dt * plan.wingOmega * 1.32;
      const targetBobY = -Math.cos(insect.wingPhase) * 4.2 * (1 - ft * 0.35);
      plan.bobOffsetY += (targetBobY - plan.bobOffsetY) * (1 - Math.exp(-12 * dt));
      nextX += plan.entryDir * Math.sin(insect.wingPhase) * 1.5;
      nextY += plan.bobOffsetY;
    }

    const rawVx = dt > 1e-4 ? (nextX - prevX) / dt : plan.smoothVx;
    const rawVy = dt > 1e-4 ? (nextY - prevY) / dt : plan.smoothVy;
    const velAlpha = 1 - Math.exp(-10 * dt);
    plan.smoothVx += (rawVx - plan.smoothVx) * velAlpha;
    plan.smoothVy += (rawVy - plan.smoothVy) * velAlpha;

    insect.x = nextX;
    insect.y = nextY;
    insect.vx = plan.smoothVx;
    insect.vy = plan.smoothVy;
    insect.facing = plan.entryDir;
    insect.opacity = 1;

    const escapeTilt = clamp(
      Math.atan2(plan.smoothVy, Math.max(26, Math.abs(plan.smoothVx))) * 0.56,
      -0.34,
      0.26,
    );
    insect.tilt += (escapeTilt - insect.tilt) * (1 - Math.exp(-9 * dt));

    if (ft >= 1) {
      insect.active = false;
      insect.opacity = 0;
      insect.hovering = 0;
      insect.tilt = 0;
      insect.glide = 0;
      insect.cooldown = 2.4 + internal.rng() * 2.4;
      internal.insectPlan = null;
    }
    return;
  }

  plan.elapsed += dt;
  const u = clamp01(plan.elapsed / plan.totalDuration);
  insect.progress = u;

  let nextX = prevX;
  let nextY = prevY;

  if (plan.kind === "bee") {
    const hoverX = head.center.x + plan.hoverOffX;
    const hoverY = head.center.y + plan.hoverOffY;

    if (plan.elapsed < plan.approachDuration) {
      const t = clamp01(plan.elapsed / plan.approachDuration);
      const s = 1 - (1 - t) ** 2.35;
      const p1x = lerp(plan.startX, hoverX, 0.35);
      const p1y = lerp(plan.startY, hoverY, 0.28) + plan.approachArcY;
      const p2x = lerp(plan.startX, hoverX, 0.78);
      const p2y = lerp(plan.startY, hoverY, 0.72) + plan.approachArcY * 0.35;
      nextX = evalCubic(plan.startX, p1x, p2x, hoverX, s);
      nextY =
        evalCubic(plan.startY, p1y, p2y, hoverY, s) + Math.sin(plan.elapsed * 5.2) * 1.1 * (1 - t);
      insect.hovering = smoothstep(0.62, 1.0, t);
    } else if (plan.elapsed < plan.approachDuration + plan.hoverDuration) {
      const hoverTime = plan.elapsed - plan.approachDuration;
      const ht = clamp01(hoverTime / plan.hoverDuration);
      const env = smoothstep(0, 0.22, ht) * smoothstep(1, 0.78, ht);
      const driftX =
        (Math.sin(hoverTime * 2.5 + plan.hoverSeed) * 3.6 +
          Math.sin(hoverTime * 5.1 + plan.hoverSeed * 1.7) * 0.8) *
        env;
      const driftY =
        (Math.sin(hoverTime * 5.0 + plan.hoverSeed) * 2.2 + Math.cos(hoverTime * 2.2) * 1.1) * env;
      nextX = hoverX + driftX;
      nextY = hoverY + driftY;
      insect.hovering = 1;
    } else {
      const t = clamp01(
        (plan.elapsed - plan.approachDuration - plan.hoverDuration) / plan.departDuration,
      );
      const s = t ** 2.25;
      const q1x = hoverX + plan.entryDir * 24;
      const q1y = hoverY - plan.departLiftY;
      const q2x = lerp(hoverX, plan.endX, 0.64);
      const q2y = lerp(hoverY, plan.endY, 0.48) - plan.departArcY;
      nextX = evalCubic(hoverX, q1x, q2x, plan.endX, s);
      nextY = evalCubic(hoverY, q1y, q2y, plan.endY, s);
      insect.hovering = 1 - smoothstep(0, 0.34, t);
    }

    const rawVx = dt > 1e-4 ? (nextX - prevX) / dt : plan.smoothVx;
    const rawVy = dt > 1e-4 ? (nextY - prevY) / dt : plan.smoothVy;
    const velAlpha = 1 - Math.exp(-9 * dt);
    plan.smoothVx += (rawVx - plan.smoothVx) * velAlpha;
    plan.smoothVy += (rawVy - plan.smoothVy) * velAlpha;

    insect.x = nextX;
    insect.y = nextY;
    insect.vx = plan.smoothVx;
    insect.vy = plan.smoothVy;
    insect.facing = plan.entryDir;
    insect.glide = 0;
    insect.wingPhase += dt * lerp(180, 196, insect.hovering);

    const cruiseTilt = clamp(
      Math.atan2(plan.smoothVy, Math.max(26, Math.abs(plan.smoothVx))) * 0.52 + 0.06,
      -0.25,
      0.25,
    );
    const hoverTilt = -0.2 + Math.sin(plan.elapsed * 3.4 + plan.hoverSeed) * 0.025;
    const targetTilt = lerp(cruiseTilt, hoverTilt, insect.hovering);
    insect.tilt += (targetTilt - insect.tilt) * (1 - Math.exp(-8.5 * dt));
  } else {
    const inGlide1 =
      smoothstep(plan.glideStart1 - 0.02, plan.glideStart1 + 0.02, u) *
      smoothstep(plan.glideEnd1 + 0.02, plan.glideEnd1 - 0.02, u);
    const inGlide2 =
      smoothstep(plan.glideStart2 - 0.02, plan.glideStart2 + 0.02, u) *
      smoothstep(plan.glideEnd2 + 0.02, plan.glideEnd2 - 0.02, u);
    const wantGlide = Math.max(inGlide1, inGlide2);

    const sinW = Math.sin(insect.wingPhase);
    const cosW = Math.cos(insect.wingPhase);
    const canGlide = wantGlide > 0.25 && (insect.glide > 0.15 || (sinW > 0.42 && cosW > 0));
    const glideTarget = canGlide ? wantGlide : 0;
    insect.glide += (glideTarget - insect.glide) * (1 - Math.exp(-(canGlide ? 14 : 8) * dt));

    const twoPi = Math.PI * 2;
    const phaseInCycle = ((insect.wingPhase % twoPi) + twoPi) % twoPi;
    const openTarget = Math.PI * 0.46 + Math.sin(plan.elapsed * 2.4) * 0.14;
    let openErr = openTarget - phaseInCycle;
    if (openErr > Math.PI) openErr -= twoPi;
    if (openErr < -Math.PI) openErr += twoPi;
    const glideRate = clamp(openErr * 5.5, -3.5, 4.5);
    const wingRate = lerp(plan.wingOmega, glideRate, smoothstep(0.05, 0.5, insect.glide));
    insect.wingPhase += dt * wingRate;

    const baseX = evalCubic(plan.startX, plan.ctrl1X, plan.ctrl2X, plan.endX, u);
    const baseY = evalCubic(plan.startY, plan.ctrl1Y, plan.ctrl2Y, plan.endY, u);
    const meanderY =
      Math.sin(u * Math.PI) * Math.sin(u * Math.PI * 2 + plan.meanderPhase) * plan.meanderAmp;

    const targetBobY =
      -Math.cos(insect.wingPhase) * 5.2 * (1 - insect.glide * 0.68) + insect.glide * 4.5;
    plan.bobOffsetY += (targetBobY - plan.bobOffsetY) * (1 - Math.exp(-12 * dt));
    const surgeX = plan.entryDir * Math.sin(insect.wingPhase) * 1.4 * (1 - insect.glide);

    nextX = baseX + surgeX;
    nextY = clamp(baseY + meanderY + plan.bobOffsetY, BLEED_Y + 14, BLEED_Y + CARD_HEIGHT - 120);

    const rawVx = dt > 1e-4 ? (nextX - prevX) / dt : plan.smoothVx;
    const rawVy = dt > 1e-4 ? (nextY - prevY) / dt : plan.smoothVy;
    const velAlpha = 1 - Math.exp(-7 * dt);
    plan.smoothVx += (rawVx - plan.smoothVx) * velAlpha;
    plan.smoothVy += (rawVy - plan.smoothVy) * velAlpha;

    insect.x = nextX;
    insect.y = nextY;
    insect.vx = plan.smoothVx;
    insect.vy = plan.smoothVy;
    insect.facing = plan.entryDir;
    insect.hovering = 0;

    const flightTilt = clamp(
      Math.atan2(plan.smoothVy, Math.max(24, Math.abs(plan.smoothVx))) * 0.62,
      -0.32,
      0.28,
    );
    const strokeNod = -Math.cos(insect.wingPhase) * 0.055 * (1 - insect.glide);
    const targetTilt = clamp(flightTilt + strokeNod, -0.34, 0.3);
    insect.tilt += (targetTilt - insect.tilt) * (1 - Math.exp(-6.5 * dt));
  }

  insect.opacity = 1;

  if (u >= 1) {
    insect.active = false;
    insect.opacity = 0;
    insect.hovering = 0;
    insect.tilt = 0;
    insect.glide = 0;
    insect.cooldown = 3.5 + internal.rng() * 3.0;
    internal.insectPlan = null;
  }
}

export function createInitialSimState(initialValue: number): SunflowerSimState {
  const clamped = clamp(initialValue, 0, 100);
  const phases = computePhasedProgress(clamped / 100);

  const state: SunflowerSimState = {
    targetValue: clamped,
    displayValue: clamped,
    valueVelocity: 0,
    time: 0,
    boilStep: 0,
    wind: 0,
    gust: 0,
    hoverHead: false,
    dragging: false,
    pointerCanvas: null,
    phases,
    stem: [],
    leaves: [],
    head: {
      center: {
        x: BLEED_X + CARD_WIDTH * 0.5,
        y: BLEED_Y + lerp(HEAD_CARD_Y_MIN, HEAD_CARD_Y_MAX, phases.raw),
      },
      neck: {
        x: BLEED_X + CARD_WIDTH * 0.5,
        y: BLEED_Y + lerp(HEAD_CARD_Y_MIN, HEAD_CARD_Y_MAX, phases.raw),
      },
      radius: 56,
      diskRadius: 28,
      pitch: 0,
      yaw: 0,
      roll: 0,
      bloomOpen: phases.bloom,
      petalCurl: 0.5,
      petalDroop: 0.5,
      petalLength: 30,
      vitality: phases.raw,
    },
    clouds: createInitialClouds(),
    grass: createInitialGrass(),
    particles: createInitialParticles(),
    insect: createInitialInsect(),
  };

  const internal = createInternalState();
  internalMap.set(state, internal);

  buildStemAndPose(state, internal, true);
  updateEnvironment(state, internal, 0, true);
  return state;
}

export function stepSimState(state: SunflowerSimState, dtRaw: number, input: SimStepInput): void {
  const dt = clamp(Number.isFinite(dtRaw) ? dtRaw : 0, 0, 0.05);
  const internal = getInternalState(state);

  state.targetValue = clamp(input.targetValue, 0, 100);
  state.dragging = input.dragging;
  state.hoverHead = input.hoverHead;
  state.pointerCanvas = input.pointerCanvas;
  state.boilStep = 0;

  if (input.reducedMotion) {
    state.displayValue = state.targetValue;
    state.valueVelocity = 0;
    state.wind = 0;
    state.gust = 0;
    internal.wasDragging = false;
    internal.dragGrabOffsetX = 0;
    internal.dragGrabOffsetY = 0;
    internal.overdragY = 0;
    internal.dragSwayX = 0;
    state.phases = computePhasedProgress(state.displayValue / 100);
    buildStemAndPose(state, internal, true);
    updateEnvironment(state, internal, dt, true);
    return;
  }

  state.time += dt;

  // Critically damped direct tracking while dragging; smooth overdamped glide otherwise (zero bounce)
  const prevDisplay = state.displayValue;
  const delta = state.targetValue - state.displayValue;
  if (input.dragging) {
    if (Math.abs(delta) < 0.2) {
      state.displayValue = state.targetValue;
    } else {
      const alpha = 1 - Math.exp(-32 * dt);
      state.displayValue = clamp(state.displayValue + delta * alpha, 0, 100);
    }
  } else if (Math.abs(delta) < 0.02) {
    state.displayValue = state.targetValue;
  } else {
    const alpha = 1 - Math.exp(-12 * dt);
    state.displayValue = clamp(state.displayValue + delta * alpha, 0, 100);
  }
  state.valueVelocity = dt > 0 ? (state.displayValue - prevDisplay) / dt : 0;

  state.phases = computePhasedProgress(state.displayValue / 100);

  // Integrate wave phases incrementally so changing slider value never causes grass/leaf phase jumps
  const meadowVitality = clamp01(state.phases.warmth * 0.5 + state.phases.leafUnfurl * 0.5);
  internal.leafWavePhase += dt * lerp(0.75, 0.95, state.phases.raw);
  internal.grassWavePhase += dt * lerp(0.72, 0.96, meadowVitality);

  // Capture initial grab offset when pressing on the head so off-center drags trigger overdrag right at 0%/100%
  if (input.dragging && !internal.wasDragging) {
    if (input.pointerCanvas) {
      const nearHead =
        Math.abs(input.pointerCanvas.y - state.head.center.y) < 58 &&
        Math.abs(input.pointerCanvas.x - state.head.center.x) < 64;
      if (nearHead) {
        internal.dragGrabOffsetX = clamp(input.pointerCanvas.x - state.head.center.x, -44, 44);
        internal.dragGrabOffsetY = clamp(input.pointerCanvas.y - state.head.center.y, -48, 48);
      } else {
        internal.dragGrabOffsetX = 0;
        internal.dragGrabOffsetY = 0;
      }
    } else {
      internal.dragGrabOffsetX = 0;
      internal.dragGrabOffsetY = 0;
    }
  } else if (!input.dragging) {
    internal.dragGrabOffsetX = 0;
    internal.dragGrabOffsetY = 0;
  }
  internal.wasDragging = input.dragging;

  // Subtle rubber-band stretch past 0%/100% AND gentle left-right pointer follow across the whole drag
  let targetOverY = 0;
  let targetDragX = 0;
  if (input.dragging && input.pointerCanvas) {
    const effY = input.pointerCanvas.y - internal.dragGrabOffsetY;
    const topStopY = BLEED_Y + HEAD_CARD_Y_MAX;
    const botStopY = BLEED_Y + HEAD_CARD_Y_MIN;
    if (state.targetValue >= 99.9 && effY < topStopY) {
      const pull = topStopY - effY;
      targetOverY = -13 * (pull / (pull + 64));
    } else if (state.targetValue <= 0.1 && effY > botStopY) {
      const pull = effY - botStopY;
      targetOverY = 12 * (pull / (pull + 64));
    }

    const neutralX = BLEED_X + lerp(0.64, 0.5, state.phases.stemUncurl) * CARD_WIDTH;
    const effX = input.pointerCanvas.x - internal.dragGrabOffsetX;
    const dx = effX - neutralX;
    targetDragX = Math.sign(dx) * 15 * (Math.abs(dx) / (Math.abs(dx) + 75));
  }

  const overAlphaY = 1 - Math.exp(-(input.dragging ? 20 : 12) * dt);
  const dragAlphaX = 1 - Math.exp(-(input.dragging ? 16 : 9) * dt);
  internal.overdragY += (targetOverY - internal.overdragY) * overAlphaY;
  internal.dragSwayX += (targetDragX - internal.dragSwayX) * dragAlphaX;
  if (!input.dragging && Math.abs(internal.overdragY) < 0.02) {
    internal.overdragY = 0;
  }
  if (!input.dragging && Math.abs(internal.dragSwayX) < 0.02) {
    internal.dragSwayX = 0;
  }

  // Slow, serene rolling breeze (5-9s periods, zero sudden gusts or shaking)
  const slowWave1 = Math.sin(state.time * 0.68);
  const slowWave2 = Math.sin(state.time * 1.05 + 1.4);
  const slowDrift = valueNoise1D(state.time * 0.18 + 5.7);
  state.wind = slowWave1 * 0.45 + slowWave2 * 0.25 + slowDrift * 0.3;
  state.gust = 0;

  buildStemAndPose(state, internal, false);
  updateEnvironment(state, internal, dt, false);
}

export function isPointOnHead(canvasX: number, canvasY: number, head: HeadPose, pad = 12): boolean {
  const dx = canvasX - head.center.x;
  const dy = canvasY - head.center.y;
  const hitRadius = Math.max(head.radius, 36) + pad;
  return dx * dx + dy * dy <= hitRadius * hitRadius;
}

export function getHeadNormalizedCardPos(head: HeadPose): { xPct: number; yPct: number } {
  const xPct = clamp(((head.center.x - BLEED_X) / CARD_WIDTH) * 100, 0, 100);
  const yPct = clamp(((head.center.y - BLEED_Y) / CARD_HEIGHT) * 100, 0, 100);
  return { xPct, yPct };
}
