import {
  clamp01,
  computePhasedProgress,
  getPalette,
  lerp,
  lerpRgb,
  mulberry32,
  rgbToCss,
  smoothstep,
} from "./colorAndCurves";
import { getPaperTextures } from "./paperTextures";
import {
  BLEED_X,
  BLEED_Y,
  CARD_HEIGHT,
  CARD_WIDTH,
  type CloudState,
  type GrassBlade,
  type InsectState,
  type RGB,
  type SunflowerPalette,
  type SunflowerSimState,
} from "./types";

interface SkyPatch {
  yFrac: number;
  xFrac: number;
  rxFrac: number;
  ryFrac: number;
  tilt: number;
  shade: number;
  alpha: number;
  dryBias: number;
}

const SKY_PATCHES: readonly SkyPatch[] = (() => {
  const rng = mulberry32(41729);
  const patches: SkyPatch[] = [];
  for (let i = 0; i < 46; i++) {
    const yFrac = rng() * 0.86;
    patches.push({
      yFrac,
      xFrac: rng(),
      rxFrac: 0.2 + rng() * 0.32,
      ryFrac: 0.032 + rng() * 0.068,
      tilt: (rng() - 0.5) * 0.26,
      shade: rng() > 0.48 ? 1 : -1,
      alpha: 0.032 + rng() * 0.044,
      dryBias: yFrac < 0.58 ? 0.65 + rng() * 0.35 : 0.2 + rng() * 0.3,
    });
  }
  return patches;
})();

interface GroundTuft {
  xFrac: number;
  height: number;
  lean: number;
  thickness: number;
  bucket: 0 | 1 | 2;
  layer: "mid" | "front";
  phase: number;
}

const GROUND_TUFTS: readonly GroundTuft[] = (() => {
  const rng = mulberry32(63109);
  const tufts: GroundTuft[] = [];
  for (let i = 0; i < 72; i++) {
    const xFrac = (i + rng() * 0.9) / 72;
    const edgeLift = 1 + Math.abs(xFrac - 0.5) * 0.48;
    const isFront = i % 2 === 0;
    const shade = rng();
    tufts.push({
      xFrac,
      height: (isFront ? 28 + rng() * 54 : 44 + rng() * 74) * edgeLift,
      lean: (xFrac - 0.5) * 0.3 + (rng() - 0.5) * 0.52,
      thickness: 0.65 + rng() * 0.85,
      bucket: shade < 0.45 ? 0 : shade < 0.8 ? 1 : 2,
      layer: isFront ? "front" : "mid",
      phase: rng() * Math.PI * 2,
    });
  }
  return tufts;
})();

const DRY_WHEAT: RGB = { r: 196, g: 172, b: 126 };
const DRY_UMBER: RGB = { r: 118, g: 96, b: 68 };
const WARM_OCHRE: RGB = { r: 176, g: 146, b: 86 };
const SOFT_SAGE: RGB = { r: 136, g: 162, b: 92 };
const DEEP_FLOOR_0: RGB = { r: 76, g: 58, b: 38 };
const DEEP_FLOOR_1: RGB = { r: 38, g: 76, b: 30 };
const DEEP_GROUND_0: RGB = { r: 74, g: 56, b: 36 };
const DEEP_GROUND_1: RGB = { r: 36, g: 72, b: 28 };
const SHADOW_GROUND_0: RGB = { r: 72, g: 55, b: 36 };
const DEEP_EMERALD: RGB = { r: 34, g: 72, b: 28 };
const LUSH_OLIVE: RGB = { r: 78, g: 122, b: 46 };
const DRY_UMBER_FLOOR: RGB = { r: 80, g: 62, b: 40 };
const DRY_STRAW: RGB = { r: 162, g: 136, b: 94 };
const WEED_DRY_POD: RGB = { r: 158, g: 132, b: 86 };
const APRICOT: RGB = { r: 238, g: 162, b: 92 };
const CREAM: RGB = { r: 250, g: 242, b: 210 };

const pastelOverlayPatternCache = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>();

interface CloudPuffSpec {
  frac: number;
  dxJitter: number;
  dyJitter: number;
  rxMul: number;
  ryMul: number;
  rot: number;
  useWarmUnder: boolean;
}

const cloudPuffCache = new Map<number, readonly CloudPuffSpec[]>();

function getCloudPuffs(seed: number): readonly CloudPuffSpec[] {
  const existing = cloudPuffCache.get(seed);
  if (existing) return existing;

  const rng = mulberry32(seed);
  const puffCount = 8;
  const puffs: CloudPuffSpec[] = [];
  for (let p = 0; p < puffCount; p++) {
    const frac = p / (puffCount - 1) - 0.5;
    puffs.push({
      frac,
      dxJitter: (rng() - 0.5) * 16,
      dyJitter: (rng() - 0.5) * 0.46,
      rxMul: 0.24 + rng() * 0.24,
      ryMul: 0.3 + rng() * 0.26,
      rot: (rng() - 0.5) * 0.16,
      useWarmUnder: p % 3 === 0,
    });
  }
  cloudPuffCache.set(seed, puffs);
  return puffs;
}

interface CloudSpritePair {
  wilted: HTMLCanvasElement;
  sunny: HTMLCanvasElement;
  halfW: number;
  halfH: number;
}

const cloudSpriteCache = new Map<number, CloudSpritePair>();

interface SkyKeyframes {
  sky0: HTMLCanvasElement;
  skyMid: HTMLCanvasElement;
  sky1: HTMLCanvasElement;
  sunGlow: HTMLCanvasElement;
}

let cachedSkyKeyframes: SkyKeyframes | null = null;

function sampleSkyColor(palette: SunflowerPalette, yFrac: number): RGB {
  if (yFrac <= 0.45) {
    return lerpRgb(palette.skyTop, palette.skyMid, yFrac / 0.45);
  }
  if (yFrac <= 0.82) {
    return lerpRgb(palette.skyMid, palette.skyHorizon, (yFrac - 0.45) / 0.37);
  }
  return lerpRgb(palette.skyHorizon, palette.paperBg, ((yFrac - 0.82) / 0.18) * 0.24);
}

function paintSkyBackdropInto(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  warmth: number,
  palette: SunflowerPalette,
): void {
  const skyGrad = ctx.createLinearGradient(0, offsetY, 0, offsetY + CARD_HEIGHT);
  skyGrad.addColorStop(0, rgbToCss(palette.skyTop));
  skyGrad.addColorStop(0.42, rgbToCss(palette.skyMid));
  skyGrad.addColorStop(0.76, rgbToCss(palette.skyHorizon));
  skyGrad.addColorStop(1, rgbToCss(lerpRgb(palette.skyHorizon, palette.paperBg, 0.26)));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(offsetX, offsetY, CARD_WIDTH, CARD_HEIGHT);

  const overcastWeight = 1 - warmth;
  for (let i = 0; i < SKY_PATCHES.length; i++) {
    const p = SKY_PATCHES[i];
    if (!p) continue;
    const base = sampleSkyColor(palette, p.yFrac);
    const target =
      p.shade > 0
        ? lerpRgb(base, palette.paperBg, 0.44)
        : lerpRgb(base, palette.outlineInk, 0.1 + overcastWeight * 0.08);
    const patchAlpha = p.alpha * (0.7 + overcastWeight * p.dryBias * 0.65);

    const cx = offsetX + p.xFrac * CARD_WIDTH;
    const cy = offsetY + p.yFrac * CARD_HEIGHT;
    const rx = p.rxFrac * CARD_WIDTH;
    const ry = p.ryFrac * CARD_HEIGHT;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.tilt);
    ctx.scale(1, ry / Math.max(rx, 1));
    const grad = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
    grad.addColorStop(0, rgbToCss(target, patchAlpha));
    grad.addColorStop(0.58, rgbToCss(target, patchAlpha * 0.42));
    grad.addColorStop(1, rgbToCss(target, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const { skyPencilTexture } = getPaperTextures();
  if (skyPencilTexture.width) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = lerp(0.88, 0.48, warmth);
    ctx.drawImage(skyPencilTexture, offsetX, offsetY, CARD_WIDTH, CARD_HEIGHT);
    ctx.restore();
  }
}

function bakeSkyKeyframe(rawProgress: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const phases = computePhasedProgress(rawProgress);
  const palette = getPalette(phases);
  paintSkyBackdropInto(ctx, 0, 0, phases.warmth, palette);
  return canvas;
}

function bakeSunGlowCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const palette = getPalette(computePhasedProgress(1));
  const sunX = CARD_WIDTH * 0.5;
  const sunY = CARD_HEIGHT * 0.2;

  const glowGrad = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, CARD_WIDTH * 0.96);
  glowGrad.addColorStop(0, rgbToCss(palette.sunGlow, 0.28));
  glowGrad.addColorStop(0.48, rgbToCss(palette.sunGlow, 0.11));
  glowGrad.addColorStop(1, rgbToCss(palette.sunGlow, 0));
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const rayAlpha = 0.042;
  for (let r = 0; r < 3; r++) {
    const originX = CARD_WIDTH * (0.14 + r * 0.28);
    const spread = 28 + r * 8;
    const endX = originX + 52 + r * 14;
    const rayGrad = ctx.createLinearGradient(originX, 0, endX, CARD_HEIGHT * 0.68);
    rayGrad.addColorStop(0, rgbToCss(palette.sunGlow, rayAlpha));
    rayGrad.addColorStop(0.55, rgbToCss(palette.sunGlow, rayAlpha * 0.4));
    rayGrad.addColorStop(1, rgbToCss(palette.sunGlow, 0));
    ctx.fillStyle = rayGrad;
    ctx.beginPath();
    ctx.moveTo(originX - spread * 0.35, 0);
    ctx.lineTo(originX + spread * 0.35, 0);
    ctx.lineTo(endX + spread * 0.9, CARD_HEIGHT * 0.68);
    ctx.lineTo(endX - spread * 0.45, CARD_HEIGHT * 0.68);
    ctx.closePath();
    ctx.fill();
  }

  return canvas;
}

function getSkyKeyframes(): SkyKeyframes | null {
  if (cachedSkyKeyframes) return cachedSkyKeyframes;
  if (typeof document === "undefined") return null;

  // Match the skyT = 0 / 0.5 / 1.0 stops of colorAndCurves.getPalette()
  cachedSkyKeyframes = {
    sky0: bakeSkyKeyframe(0),
    skyMid: bakeSkyKeyframe(0.43),
    sky1: bakeSkyKeyframe(1),
    sunGlow: bakeSunGlowCanvas(),
  };
  return cachedSkyKeyframes;
}

function bakeSingleCloudSprite(
  cloud: CloudState,
  palette: SunflowerPalette,
  baseAlpha: number,
  halfW: number,
  halfH: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(halfW * 2);
  canvas.height = Math.ceil(halfH * 2);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const puffs = getCloudPuffs(cloud.seed);
  const warmUnder = lerpRgb(palette.cloudFill, palette.skyHorizon, 0.35);

  for (let p = 0; p < puffs.length; p++) {
    const puff = puffs[p];
    if (!puff) continue;
    const px = halfW + puff.frac * cloud.width * 0.84 + puff.dxJitter;
    const py = halfH + puff.dyJitter * cloud.height - Math.abs(puff.frac) * 2.5;
    const rx = cloud.width * puff.rxMul;
    const ry = cloud.height * puff.ryMul;
    const puffAlpha = baseAlpha * (0.58 + (1 - Math.abs(puff.frac) * 1.35) * 0.45);
    const col = puff.useWarmUnder ? warmUnder : palette.cloudFill;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(puff.rot);
    ctx.scale(1, ry / Math.max(rx, 1));
    const cGrad = ctx.createRadialGradient(0, 0, rx * 0.05, 0, 0, rx);
    cGrad.addColorStop(0, rgbToCss(col, puffAlpha));
    cGrad.addColorStop(0.52, rgbToCss(col, puffAlpha * 0.46));
    cGrad.addColorStop(1, rgbToCss(col, 0));
    ctx.fillStyle = cGrad;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.lineCap = "round";
  for (let s = 0; s < 4; s++) {
    const sy = halfH + (s - 1.5) * cloud.height * 0.22;
    const strokeHalfW = cloud.width * (0.4 - Math.abs(s - 1.5) * 0.06);
    const wGrad = ctx.createLinearGradient(halfW - strokeHalfW, sy, halfW + strokeHalfW, sy);
    wGrad.addColorStop(0, rgbToCss(palette.cloudFill, 0));
    wGrad.addColorStop(0.5, rgbToCss(palette.cloudFill, baseAlpha * 0.34));
    wGrad.addColorStop(1, rgbToCss(palette.cloudFill, 0));
    ctx.strokeStyle = wGrad;
    ctx.lineWidth = 2.4 - Math.abs(s - 1.5) * 0.4;
    ctx.beginPath();
    ctx.moveTo(halfW - strokeHalfW, sy);
    ctx.quadraticCurveTo(halfW, sy - 1.6, halfW + strokeHalfW, sy + 0.6);
    ctx.stroke();
  }

  return canvas;
}

let cachedCloudPal0: SunflowerPalette | null = null;
let cachedCloudPal1: SunflowerPalette | null = null;

function getCloudSprites(cloud: CloudState): CloudSpritePair | null {
  if (typeof document === "undefined") return null;
  const existing = cloudSpriteCache.get(cloud.seed);
  if (existing) return existing;

  if (!cachedCloudPal0) cachedCloudPal0 = getPalette(computePhasedProgress(0));
  if (!cachedCloudPal1) cachedCloudPal1 = getPalette(computePhasedProgress(1));

  const halfW = Math.ceil(cloud.width * 0.96 + 14);
  const halfH = Math.ceil(cloud.height * 0.96 + 10);
  const pair: CloudSpritePair = {
    wilted: bakeSingleCloudSprite(cloud, cachedCloudPal0, 0.2, halfW, halfH),
    sunny: bakeSingleCloudSprite(cloud, cachedCloudPal1, 0.44, halfW, halfH),
    halfW,
    halfH,
  };
  cloudSpriteCache.set(cloud.seed, pair);
  return pair;
}

function getPastelOverlayPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (pastelOverlayPatternCache.has(ctx)) {
    return pastelOverlayPatternCache.get(ctx) ?? null;
  }
  const { pastelGrainOverlay } = getPaperTextures();
  const pat = pastelGrainOverlay.width ? ctx.createPattern(pastelGrainOverlay, "repeat") : null;
  pastelOverlayPatternCache.set(ctx, pat);
  return pat;
}

export function paintSkyAndAtmosphere(
  ctx: CanvasRenderingContext2D,
  state: SunflowerSimState,
  palette: SunflowerPalette,
): void {
  const { phases, clouds } = state;

  const skyKeys = getSkyKeyframes();
  const skyT = clamp01(phases.warmth * 0.65 + phases.stemGrow * 0.35);

  if (skyKeys) {
    if (skyT <= 0.5) {
      const blend = skyT * 2;
      ctx.drawImage(skyKeys.sky0, BLEED_X, BLEED_Y, CARD_WIDTH, CARD_HEIGHT);
      if (blend > 0.01) {
        ctx.save();
        ctx.globalAlpha = blend;
        ctx.drawImage(skyKeys.skyMid, BLEED_X, BLEED_Y, CARD_WIDTH, CARD_HEIGHT);
        ctx.restore();
      }
    } else {
      const blend = (skyT - 0.5) * 2;
      ctx.drawImage(skyKeys.skyMid, BLEED_X, BLEED_Y, CARD_WIDTH, CARD_HEIGHT);
      if (blend > 0.01) {
        ctx.save();
        ctx.globalAlpha = blend;
        ctx.drawImage(skyKeys.sky1, BLEED_X, BLEED_Y, CARD_WIDTH, CARD_HEIGHT);
        ctx.restore();
      }
    }
  } else {
    paintSkyBackdropInto(ctx, BLEED_X, BLEED_Y, phases.warmth, palette);
  }

  // Pre-baked hand-rubbed pastel clouds (0 per-frame gradients)
  const cloudWarm = phases.warmth;
  ctx.save();
  for (let i = 0; i < clouds.length; i++) {
    const cloud = clouds[i];
    if (!cloud || cloud.opacity <= 0.02) continue;
    const sprites = getCloudSprites(cloud);
    if (!sprites) continue;

    const dx = cloud.x - sprites.halfW;
    const dy = cloud.y - sprites.halfH;
    const wiltedAlpha = cloud.opacity * (1 - cloudWarm);
    const sunnyAlpha = cloud.opacity * cloudWarm;

    if (wiltedAlpha > 0.015) {
      ctx.globalAlpha = wiltedAlpha;
      ctx.drawImage(sprites.wilted, dx, dy);
    }
    if (sunnyAlpha > 0.015) {
      ctx.globalAlpha = sunnyAlpha;
      ctx.drawImage(sprites.sunny, dx, dy);
    }
  }
  ctx.restore();

  // Pre-baked pastoral sunlight warmth & soft rays behind the blooming flower
  if (phases.bloom > 0.22 && skyKeys) {
    const sunStrength = smoothstep(0.22, 1.0, phases.bloom);
    ctx.save();
    ctx.globalAlpha = sunStrength;
    ctx.drawImage(skyKeys.sunGlow, BLEED_X, BLEED_Y, CARD_WIDTH, CARD_HEIGHT);
    ctx.restore();
  }
}

interface PrecomputedGrassItem {
  blade: GrassBlade;
  toneBucket: 0 | 1 | 2 | 3;
  halfW: number;
  companionOffset: number;
  companionHeightRatio: number;
  companionAngleOffset: number;
  compUseShadow: boolean;
  hasHighlight: boolean;
  baseOff: number;
  baseHRatio: number;
  baseAngOff: number;
}

interface PrecomputedTwigFork {
  side: -1 | 1;
  angleOff: number;
  lenMul: number;
  hasTiny: boolean;
  tinyAngleOff: number;
  tipR: number;
}

interface PrecomputedTwigSeg {
  angleDelta: number;
  forks: readonly PrecomputedTwigFork[];
}

interface PrecomputedTwigItem {
  blade: GrassBlade;
  segs: readonly PrecomputedTwigSeg[];
}

interface PrecomputedWeedPod {
  t: number;
  side: -1 | 1;
  lenBase: number;
  angleJitter: number;
  tipColorMix: number;
}

interface PrecomputedWeedItem {
  blade: GrassBlade;
  pods: readonly PrecomputedWeedPod[];
}

interface PrecomputedWildflowerPetal {
  angle: number;
  distMul: number;
  rxMul: number;
  ryMul: number;
  useCreamMix: boolean;
}

interface PrecomputedWildflowerItem {
  blade: GrassBlade;
  colorBucket: 0 | 1 | 2;
  flowerRBase: number;
  petals: readonly PrecomputedWildflowerPetal[];
  hasCompanion: boolean;
  subX: number;
  subY: number;
}

interface PrecomputedLayerData {
  grass: readonly PrecomputedGrassItem[];
  twigs: readonly PrecomputedTwigItem[];
  weeds: readonly PrecomputedWeedItem[];
  wildflowers: readonly PrecomputedWildflowerItem[];
  avgGrassHeight: number;
}

interface PrecomputedMeadow {
  back: PrecomputedLayerData;
  mid: PrecomputedLayerData;
  front: PrecomputedLayerData;
}

const meadowPrecomputeCache = new WeakMap<readonly GrassBlade[], PrecomputedMeadow>();

function precomputeMeadow(blades: readonly GrassBlade[]): PrecomputedMeadow {
  const cached = meadowPrecomputeCache.get(blades);
  if (cached) return cached;

  const buildLayer = (layer: "back" | "mid" | "front"): PrecomputedLayerData => {
    const grass: PrecomputedGrassItem[] = [];
    const twigs: PrecomputedTwigItem[] = [];
    const weeds: PrecomputedWeedItem[] = [];
    const wildflowers: PrecomputedWildflowerItem[] = [];
    let grassHeightSum = 0;

    for (let i = 0; i < blades.length; i++) {
      const blade = blades[i];
      if (!blade || blade.layer !== layer) continue;

      const rng = mulberry32(blade.seed);
      if (blade.kind === "grass") {
        const tonePick = rng();
        const toneBucket: 0 | 1 | 2 | 3 =
          tonePick < 0.24 ? 0 : tonePick < 0.46 ? 1 : tonePick < 0.68 ? 2 : 3;
        const companionOffset = (rng() - 0.5) * 4.4;
        const companionHeightRatio = 0.62 + rng() * 0.46;
        const companionAngleOffset = (rng() - 0.5) * 0.34;
        const compUseShadow = rng() > 0.5;
        // Consume lineWidth RNG to keep deterministic sequence aligned with original
        rng();
        const hasHighlight = layer !== "back" && rng() > 0.44;
        let baseOff = 0;
        let baseHRatio = 0.5;
        let baseAngOff = 0;
        if (layer !== "back") {
          baseOff = (rng() - 0.5) * 5.2;
          baseHRatio = 0.38 + rng() * 0.34;
          baseAngOff = (rng() - 0.5) * 0.44;
          rng();
        }
        grassHeightSum += blade.height;
        grass.push({
          blade,
          toneBucket,
          halfW: Math.min(1.15, blade.thickness * 0.36),
          companionOffset,
          companionHeightRatio,
          companionAngleOffset,
          compUseShadow,
          hasHighlight,
          baseOff,
          baseHRatio,
          baseAngOff,
        });
      } else if (blade.kind === "twig") {
        const segs: PrecomputedTwigSeg[] = [];
        for (let s = 0; s < 5; s++) {
          const angleDelta = (rng() - 0.5) * 0.24;
          const forks: PrecomputedTwigFork[] = [];
          if (s >= 1) {
            const forkCount = s === 4 ? 2 : 1;
            for (let f = 0; f < forkCount; f++) {
              const side: -1 | 1 = (s + f) % 2 === 0 ? 1 : -1;
              const angleOff = side * (0.42 + rng() * 0.46);
              const lenMul = (0.64 + rng() * 0.6) * (1 - (s / 5) * 0.25);
              const hasTiny = rng() > 0.36;
              const tinyAngleOff = hasTiny ? -side * (0.34 + rng() * 0.34) : 0;
              const tipR = 0.85 + rng() * 0.45;
              forks.push({ side, angleOff, lenMul, hasTiny, tinyAngleOff, tipR });
            }
          }
          segs.push({ angleDelta, forks });
        }
        twigs.push({ blade, segs });
      } else if (blade.kind === "weed") {
        const pods: PrecomputedWeedPod[] = [];
        const count = 7;
        for (let k = 0; k < count; k++) {
          const t = 0.32 + (k / (count - 1)) * 0.64;
          const side: -1 | 1 = k % 2 === 0 ? -1 : 1;
          pods.push({
            t,
            side,
            lenBase: (3.8 + rng() * 3.4) * (1 - t * 0.3),
            angleJitter: (rng() - 0.5) * 0.24,
            tipColorMix: rng() * 0.38,
          });
        }
        weeds.push({ blade, pods });
      } else {
        const warmMix = clamp01((blade.flowerHue - 34) / 22);
        const colorBucket: 0 | 1 | 2 = warmMix < 0.35 ? 0 : warmMix < 0.78 ? 1 : 2;
        const flowerRBase = 3.4 + rng() * 2.4;
        const petalCount = 4 + (blade.id % 2);
        const petals: PrecomputedWildflowerPetal[] = [];
        for (let p = 0; p < petalCount; p++) {
          petals.push({
            angle: (p / petalCount) * Math.PI * 2 + (rng() - 0.5) * 0.45,
            distMul: 0.48 + rng() * 0.18,
            rxMul: 0.5 + rng() * 0.16,
            ryMul: 0.28 + rng() * 0.12,
            useCreamMix: p % 2 !== 0,
          });
        }
        const hasCompanion = blade.id % 2 === 0;
        const subX = hasCompanion ? (rng() > 0.5 ? 1 : -1) * (3.6 + rng() * 2.5) : 0;
        const subY = hasCompanion ? 4.2 + rng() * 3.5 : 0;
        wildflowers.push({
          blade,
          colorBucket,
          flowerRBase,
          petals,
          hasCompanion,
          subX,
          subY,
        });
      }
    }

    return {
      grass,
      twigs,
      weeds,
      wildflowers,
      avgGrassHeight: grass.length > 0 ? grassHeightSum / grass.length : 84,
    };
  };

  const result: PrecomputedMeadow = {
    back: buildLayer("back"),
    mid: buildLayer("mid"),
    front: buildLayer("front"),
  };
  meadowPrecomputeCache.set(blades, result);
  return result;
}

function palettePaperHint(vitality: number): RGB {
  return lerpRgb({ r: 232, g: 220, b: 192 }, { r: 224, g: 236, b: 162 }, vitality);
}

function paintBatchedGrass(
  ctx: CanvasRenderingContext2D,
  items: readonly PrecomputedGrassItem[],
  avgHeight: number,
  layer: "back" | "mid" | "front",
  baseColor: RGB,
  tipTint: RGB,
  shadowTint: RGB,
  vitality: number,
): void {
  if (items.length === 0) return;

  const mainAlpha = layer === "back" ? 0.72 : layer === "mid" ? 0.84 : 0.9;
  const hScale = lerp(0.86, 1.04, vitality);
  const gradBottomY = BLEED_Y + CARD_HEIGHT + 4;
  const gradTopY = gradBottomY - avgHeight * hScale;

  // 4 shared vertical gradients (1 per tone bucket) instead of 106 per-blade gradients
  const bucketBases: readonly RGB[] = [
    lerpRgb(lerpRgb(baseColor, lerpRgb(DRY_WHEAT, SOFT_SAGE, vitality), 0.42), shadowTint, 0.25),
    lerpRgb(lerpRgb(baseColor, lerpRgb(DRY_UMBER, shadowTint, vitality), 0.38), shadowTint, 0.25),
    lerpRgb(lerpRgb(baseColor, WARM_OCHRE, 0.28 * (1 - vitality * 0.5)), shadowTint, 0.25),
    lerpRgb(baseColor, shadowTint, 0.25),
  ];
  const bucketTips: readonly RGB[] = [
    lerpRgb(tipTint, DRY_WHEAT, 0.36 * (1 - vitality * 0.55)),
    lerpRgb(tipTint, WARM_OCHRE, 0.32 * (1 - vitality * 0.4)),
    tipTint,
    tipTint,
  ];

  for (let b = 0; b < 4; b++) {
    const bBase = bucketBases[b] ?? baseColor;
    const bTip = bucketTips[b] ?? tipTint;
    const grad = ctx.createLinearGradient(0, gradBottomY, 0, gradTopY);
    grad.addColorStop(0, rgbToCss(bBase, mainAlpha));
    grad.addColorStop(0.58, rgbToCss(lerpRgb(bBase, bTip, 0.45), mainAlpha * 0.94));
    grad.addColorStop(1, rgbToCss(bTip, mainAlpha * 0.78));

    ctx.fillStyle = grad;
    ctx.beginPath();
    let count = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || item.toneBucket !== b) continue;
      count++;
      const { blade, halfW } = item;
      const bx = blade.baseX;
      const by = blade.baseY;
      const h = blade.height * hScale;
      const angle = blade.lean + blade.bend;
      const dx = Math.sin(angle) * h;
      const dy = -Math.cos(angle * 0.74) * h;
      const midX = bx + dx * 0.44 + blade.bend * h * 0.14;
      const midY = by + dy * 0.54;
      const tipX = bx + dx + blade.bend * h * 0.34;
      const tipY = by + dy;

      ctx.moveTo(bx - halfW, by);
      ctx.quadraticCurveTo(midX - halfW * 0.42, midY, tipX, tipY);
      ctx.quadraticCurveTo(midX + halfW * 0.36, midY + 0.8, bx + halfW, by);
      ctx.closePath();
    }
    if (count > 0) ctx.fill();
  }

  ctx.lineCap = "round";

  // Batched companion colored-pencil whisper strokes (2 strokes instead of 106)
  ctx.lineWidth = 0.78;
  for (const useShadow of [true, false] as const) {
    ctx.strokeStyle = rgbToCss(
      useShadow ? lerpRgb(baseColor, shadowTint, 0.36) : lerpRgb(tipTint, DRY_WHEAT, 0.25),
      mainAlpha * 0.68,
    );
    ctx.beginPath();
    let count = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || item.compUseShadow !== useShadow) continue;
      count++;
      const { blade } = item;
      const h = blade.height * hScale;
      const ch = h * item.companionHeightRatio;
      const cAng = blade.lean + blade.bend + item.companionAngleOffset;
      const cdx = Math.sin(cAng) * ch;
      const cdy = -Math.cos(cAng * 0.76) * ch;
      const cbx = blade.baseX + item.companionOffset;
      const by = blade.baseY;
      ctx.moveTo(cbx, by);
      ctx.quadraticCurveTo(
        cbx + cdx * 0.46 + blade.bend * ch * 0.12,
        by + cdy * 0.55,
        cbx + cdx + blade.bend * ch * 0.28,
        by + cdy,
      );
    }
    if (count > 0) ctx.stroke();
  }

  if (layer !== "back") {
    // Batched sunlit highlight hair-strokes (1 stroke instead of ~36)
    ctx.strokeStyle = rgbToCss(lerpRgb(tipTint, palettePaperHint(vitality), 0.3), 0.34);
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    let hiCount = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item?.hasHighlight) continue;
      hiCount++;
      const { blade } = item;
      const bx = blade.baseX;
      const by = blade.baseY;
      const h = blade.height * hScale;
      const angle = blade.lean + blade.bend;
      const dx = Math.sin(angle) * h;
      const dy = -Math.cos(angle * 0.74) * h;
      const midX = bx + dx * 0.44 + blade.bend * h * 0.14;
      const midY = by + dy * 0.54;
      const tipX = bx + dx + blade.bend * h * 0.34;
      const tipY = by + dy;
      ctx.moveTo(lerp(bx, midX, 0.35), lerp(by, midY, 0.35));
      ctx.quadraticCurveTo(midX - 0.4, midY, tipX, tipY);
    }
    if (hiCount > 0) ctx.stroke();

    // Batched grounding dark-moss / burnt-umber base accent strokes (1 stroke instead of 64)
    const deepGround = lerpRgb(DEEP_GROUND_0, DEEP_GROUND_1, vitality);
    ctx.strokeStyle = rgbToCss(lerpRgb(baseColor, deepGround, 0.62), mainAlpha * 0.76);
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      const { blade } = item;
      const h = blade.height * hScale;
      const baseH = h * item.baseHRatio;
      const baseAng = blade.lean + blade.bend + item.baseAngOff;
      const bdx = Math.sin(baseAng) * baseH;
      const bdy = -Math.cos(baseAng * 0.78) * baseH;
      const sx = blade.baseX + item.baseOff;
      const by = blade.baseY;
      ctx.moveTo(sx, by);
      ctx.quadraticCurveTo(sx + bdx * 0.45, by + bdy * 0.52, sx + bdx, by + bdy);
    }
    ctx.stroke();
  }
}

function paintBatchedTwigs(
  ctx: CanvasRenderingContext2D,
  items: readonly PrecomputedTwigItem[],
  layer: "back" | "mid" | "front",
  palette: SunflowerPalette,
  vitality: number,
): void {
  if (items.length === 0) return;

  const alpha = layer === "front" ? lerp(0.76, 0.56, vitality) : lerp(0.68, 0.46, vitality);
  const twigInk = lerpRgb(palette.twigColor, palette.outlineInk, 0.22);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = rgbToCss(twigInk, alpha);

  // Batch main stalks, secondary forks, tiny sub-twigs, and tip seed-buds
  const mainThickPath = new Path2D();
  const forkPath = new Path2D();
  const tinyPath = new Path2D();
  const budPath = new Path2D();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const { blade, segs } = item;
    const stepLen = blade.height / 5;
    let cx = blade.baseX;
    let cy = blade.baseY;
    let curAngle = blade.lean + blade.bend * 0.45;

    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s];
      if (!seg) continue;
      curAngle += seg.angleDelta + blade.bend * 0.12;
      const nx = cx + Math.sin(curAngle) * stepLen;
      const ny = cy - Math.cos(curAngle) * stepLen;

      if (s < 3) {
        mainThickPath.moveTo(cx, cy);
        mainThickPath.lineTo(nx, ny);
      } else {
        forkPath.moveTo(cx, cy);
        forkPath.lineTo(nx, ny);
      }

      for (let f = 0; f < seg.forks.length; f++) {
        const fork = seg.forks[f];
        if (!fork) continue;
        const branchAngle = curAngle + fork.angleOff;
        const branchLen = stepLen * fork.lenMul;
        const midBx = cx + Math.sin(branchAngle) * branchLen * 0.52;
        const midBy = cy - Math.cos(branchAngle) * branchLen * 0.52;
        const endBx = cx + Math.sin(branchAngle + fork.side * 0.15) * branchLen;
        const endBy = cy - Math.cos(branchAngle + fork.side * 0.15) * branchLen;

        forkPath.moveTo(cx, cy);
        forkPath.quadraticCurveTo(midBx, midBy, endBx, endBy);

        if (fork.hasTiny) {
          const tinyAngle = branchAngle + fork.tinyAngleOff;
          const tinyLen = branchLen * 0.44;
          tinyPath.moveTo(midBx, midBy);
          tinyPath.lineTo(
            midBx + Math.sin(tinyAngle) * tinyLen,
            midBy - Math.cos(tinyAngle) * tinyLen,
          );
        }

        budPath.moveTo(endBx + fork.tipR, endBy);
        budPath.arc(endBx, endBy, fork.tipR, 0, Math.PI * 2);
      }

      cx = nx;
      cy = ny;
    }
  }

  ctx.lineWidth = layer === "front" ? 1.15 : 0.88;
  ctx.stroke(mainThickPath);
  ctx.lineWidth = layer === "front" ? 0.68 : 0.55;
  ctx.stroke(forkPath);
  ctx.lineWidth = 0.42;
  ctx.stroke(tinyPath);

  ctx.fillStyle = rgbToCss(lerpRgb(twigInk, palette.petalInner, vitality * 0.28), alpha * 0.72);
  ctx.fill(budPath);
  ctx.restore();
}

function paintBatchedWeeds(
  ctx: CanvasRenderingContext2D,
  items: readonly PrecomputedWeedItem[],
  palette: SunflowerPalette,
  vitality: number,
  wildflower: number,
): void {
  if (items.length === 0) return;

  const stalkCol = lerpRgb(palette.twigColor, palette.grassMid, vitality * 0.76);
  const podBaseCol = lerpRgb(
    WEED_DRY_POD,
    lerpRgb(palette.leafBase, palette.petalOuter, wildflower * 0.38),
    vitality,
  );
  const podHiCol = lerpRgb(podBaseCol, palette.petalTip, 0.28 * wildflower);

  const stalkPath = new Path2D();
  const podPathA = new Path2D();
  const podPathB = new Path2D();
  const tuckPath = new Path2D();

  const hScale = lerp(0.9, 1.04, vitality);
  const podLenScale = lerp(0.86, 1.15, vitality);
  const podSideAngle = lerp(1.02, 0.7, vitality);
  const podDrop = lerp(1.5, -0.4, vitality);
  const podWidthMul = lerp(0.28, 0.38, vitality);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const { blade, pods } = item;
    const bx = blade.baseX;
    const by = blade.baseY;
    const h = blade.height * hScale;
    const angle = blade.lean + blade.bend;
    const tipX = bx + Math.sin(angle) * h;
    const tipY = by - Math.cos(angle) * h;
    const ctrlX = bx + Math.sin(angle * 0.58) * h * 0.48;
    const ctrlY = by - Math.cos(angle * 0.48) * h * 0.56;

    stalkPath.moveTo(bx, by);
    stalkPath.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);

    for (let k = 0; k < pods.length; k++) {
      const pod = pods[k];
      if (!pod) continue;
      const t = pod.t;
      const mt = 1 - t;
      const px = mt * mt * bx + 2 * mt * t * ctrlX + t * t * tipX;
      const py = mt * mt * by + 2 * mt * t * ctrlY + t * t * tipY;
      const podLen = pod.lenBase * podLenScale;
      const podAngle = angle + pod.side * podSideAngle + pod.angleJitter;
      const ex = px + Math.sin(podAngle) * podLen;
      const ey = py - Math.cos(podAngle) * podLen + podDrop;
      const cx = (px + ex) * 0.5;
      const cy = (py + ey) * 0.5;
      const rot = Math.atan2(ey - py, ex - px);
      const rx = podLen * 0.54;
      const ry = podLen * podWidthMul;

      const targetPath = pod.tipColorMix > 0.19 ? podPathB : podPathA;
      targetPath.moveTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * rx);
      targetPath.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);

      tuckPath.moveTo(px, py);
      tuckPath.lineTo(ex, ey);
    }
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = rgbToCss(stalkCol, 0.74);
  ctx.lineWidth = 0.85;
  ctx.stroke(stalkPath);

  ctx.fillStyle = rgbToCss(podBaseCol, 0.8);
  ctx.fill(podPathA);
  ctx.fillStyle = rgbToCss(podHiCol, 0.8);
  ctx.fill(podPathB);

  ctx.strokeStyle = rgbToCss(lerpRgb(palette.outlineInk, podBaseCol, 0.45), 0.3);
  ctx.lineWidth = 0.45;
  ctx.stroke(tuckPath);
  ctx.restore();
}

function paintBatchedWildflowers(
  ctx: CanvasRenderingContext2D,
  items: readonly PrecomputedWildflowerItem[],
  palette: SunflowerPalette,
  vitality: number,
  wildflower: number,
): void {
  if (items.length === 0) return;

  const stemColor = lerpRgb(palette.grassMid, palette.stemBase, vitality * 0.65);
  const budColor = lerpRgb(palette.twigColor, palette.grassBack, 0.35);
  const buttercup = lerpRgb(palette.petalOuter, palette.petalTip, 0.45);
  const bucketColors: readonly RGB[] = [
    lerpRgb(APRICOT, buttercup, 0.38),
    buttercup,
    lerpRgb(buttercup, CREAM, 0.52),
  ];
  const bucketCreamColors: readonly RGB[] = [
    lerpRgb(bucketColors[0] ?? APRICOT, CREAM, 0.35),
    lerpRgb(buttercup, CREAM, 0.35),
    lerpRgb(bucketColors[2] ?? CREAM, CREAM, 0.35),
  ];
  const centerCol = lerpRgb(palette.petalShadow, palette.diskEdge, 0.45);

  const stemPath = new Path2D();
  const budPath = new Path2D();
  const haloPaths: readonly [Path2D, Path2D, Path2D] = [new Path2D(), new Path2D(), new Path2D()];
  const petalPaths: readonly [Path2D, Path2D, Path2D] = [new Path2D(), new Path2D(), new Path2D()];
  const creamPaths: readonly [Path2D, Path2D, Path2D] = [new Path2D(), new Path2D(), new Path2D()];
  const centerPath = new Path2D();

  let hasBuds = false;
  let hasBlooms = false;
  const hScale = lerp(0.84, 1.04, vitality);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const { blade } = item;
    const bx = blade.baseX;
    const by = blade.baseY;
    const h = blade.height * hScale;
    const angle = blade.lean + blade.bend * 0.88;
    const ctrlX = bx + Math.sin(angle * 0.54) * h * 0.46;
    const ctrlY = by - Math.cos(angle * 0.46) * h * 0.54;
    const tipX = bx + Math.sin(angle) * h;
    const tipY = by - Math.cos(angle) * h;

    stemPath.moveTo(bx, by);
    stemPath.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);

    const localBloom = smoothstep(
      blade.bloomThreshold - 0.16,
      blade.bloomThreshold + 0.08,
      wildflower,
    );

    if (localBloom <= 0.04) {
      hasBuds = true;
      budPath.moveTo(tipX + Math.cos(angle) * 1.4, tipY + 1.2 + Math.sin(angle) * 1.4);
      budPath.ellipse(tipX, tipY + 1.2, 1.4, 2.4, angle, 0, Math.PI * 2);
      continue;
    }

    hasBlooms = true;
    const flowerR = item.flowerRBase * localBloom;
    const b = item.colorBucket;
    const haloPath = haloPaths[b];
    const mainPath = petalPaths[b];
    const creamPath = creamPaths[b];
    const rotBase = angle * 0.3;

    // Soft halo circle (batched, 0 per-flower radial gradients)
    const haloR = flowerR * 1.3;
    haloPath.moveTo(tipX + haloR, tipY);
    haloPath.arc(tipX, tipY, haloR, 0, Math.PI * 2);

    for (let p = 0; p < item.petals.length; p++) {
      const pet = item.petals[p];
      if (!pet) continue;
      const a = pet.angle + rotBase;
      const dist = flowerR * pet.distMul;
      const px = tipX + Math.cos(a) * dist;
      const py = tipY + Math.sin(a) * dist;
      const rx = flowerR * pet.rxMul;
      const ry = flowerR * pet.ryMul;
      const dst = pet.useCreamMix ? creamPath : mainPath;
      dst.moveTo(px + Math.cos(a) * rx, py + Math.sin(a) * rx);
      dst.ellipse(px, py, rx, ry, a, 0, Math.PI * 2);
    }

    const cr = flowerR * 0.28;
    centerPath.moveTo(tipX + cr, tipY);
    centerPath.arc(tipX, tipY, cr, 0, Math.PI * 2);

    if (item.hasCompanion && localBloom > 0.45) {
      const cosR = Math.cos(rotBase);
      const sinR = Math.sin(rotBase);
      const sx = tipX + item.subX * cosR - item.subY * sinR;
      const sy = tipY + item.subX * sinR + item.subY * cosR;
      const sr = flowerR * 0.45;
      creamPath.moveTo(sx + sr, sy);
      creamPath.arc(sx, sy, sr, 0, Math.PI * 2);
    }
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = rgbToCss(stemColor, 0.72);
  ctx.lineWidth = 0.8;
  ctx.stroke(stemPath);

  if (hasBuds) {
    ctx.fillStyle = rgbToCss(budColor, 0.56);
    ctx.fill(budPath);
  }

  if (hasBlooms) {
    for (let b = 0; b < 3; b++) {
      const col = bucketColors[b] ?? buttercup;
      const cCol = bucketCreamColors[b] ?? CREAM;
      ctx.fillStyle = rgbToCss(col, 0.16);
      ctx.fill(haloPaths[b] as Path2D);
      ctx.fillStyle = rgbToCss(col, 0.86);
      ctx.fill(petalPaths[b] as Path2D);
      ctx.fillStyle = rgbToCss(cCol, 0.84);
      ctx.fill(creamPaths[b] as Path2D);
    }
    ctx.fillStyle = rgbToCss(centerCol, 0.78);
    ctx.fill(centerPath);
  }
  ctx.restore();
}

export function paintMeadowLayer(
  ctx: CanvasRenderingContext2D,
  state: SunflowerSimState,
  palette: SunflowerPalette,
  layer: "back" | "mid" | "front",
): void {
  const { grass, phases } = state;
  const vitality = clamp01(phases.warmth * 0.46 + phases.leafUnfurl * 0.54);

  // Rich powdery meadow ground underwash at the bottom (source-over grain, ZERO multiply!)
  if (layer === "back") {
    const washTop = BLEED_Y + CARD_HEIGHT - 156;
    const deepFloor = lerpRgb(DEEP_FLOOR_0, DEEP_FLOOR_1, vitality);
    const washGrad = ctx.createLinearGradient(0, washTop, 0, BLEED_Y + CARD_HEIGHT);
    washGrad.addColorStop(0, rgbToCss(palette.grassBack, 0));
    washGrad.addColorStop(0.36, rgbToCss(palette.grassBack, 0.24));
    washGrad.addColorStop(0.68, rgbToCss(palette.grassMid, 0.58));
    washGrad.addColorStop(0.88, rgbToCss(palette.grassFront, 0.86));
    washGrad.addColorStop(1, rgbToCss(deepFloor, 0.96));
    ctx.fillStyle = washGrad;
    ctx.fillRect(BLEED_X, washTop, CARD_WIDTH, 158);

    const pastelPat = getPastelOverlayPattern(ctx);
    if (pastelPat) {
      ctx.save();
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = pastelPat;
      ctx.fillRect(BLEED_X, washTop + 22, CARD_WIDTH, 136);
      ctx.restore();
    }
  }

  const precomputed = precomputeMeadow(grass);
  const layerData = precomputed[layer];

  const grassBase =
    layer === "back" ? palette.grassBack : layer === "mid" ? palette.grassMid : palette.grassFront;
  const tipTint =
    layer === "front"
      ? lerpRgb(palette.grassMid, palette.leafHighlight, 0.52)
      : lerpRgb(palette.grassBack, palette.petalTip, 0.24 + phases.warmth * 0.14);
  const shadowTint = lerpRgb(
    palette.outlineInk,
    lerpRgb(SHADOW_GROUND_0, DEEP_GROUND_1, vitality),
    0.58,
  );

  paintBatchedGrass(
    ctx,
    layerData.grass,
    layerData.avgGrassHeight,
    layer,
    grassBase,
    tipTint,
    shadowTint,
    vitality,
  );
  paintBatchedTwigs(ctx, layerData.twigs, layer, palette, vitality);
  paintBatchedWeeds(ctx, layerData.weeds, palette, vitality, phases.wildflower);
  paintBatchedWildflowers(ctx, layerData.wildflowers, palette, vitality, phases.wildflower);

  // Dense grounding sketchbook grass tufts across the bottom 25% of the card (batched into 3 strokes!)
  if (layer === "mid" || layer === "front") {
    const darkStroke = lerpRgb(DRY_UMBER_FLOOR, DEEP_EMERALD, vitality);
    const midStroke = lerpRgb(palette.grassMid, LUSH_OLIVE, vitality * 0.5);
    const lightStroke = lerpRgb(
      midStroke,
      lerpRgb(DRY_STRAW, palette.leafHighlight, vitality),
      0.62,
    );
    const tuftColors: readonly RGB[] = [darkStroke, midStroke, lightStroke];
    const tuftAlpha = layer === "front" ? 0.84 : 0.72;
    const hScale = lerp(0.84, 1.06, vitality);
    const swayAmp = lerp(0.025, 0.042, vitality);
    const windOff = state.wind * 0.06;
    const timePhase = state.time * 0.8;
    const by = BLEED_Y + CARD_HEIGHT + 4;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 1.0;

    for (let b = 0; b < 3; b++) {
      const col = tuftColors[b] ?? midStroke;
      ctx.strokeStyle = rgbToCss(col, tuftAlpha);
      ctx.beginPath();
      for (let i = 0; i < GROUND_TUFTS.length; i++) {
        const tuft = GROUND_TUFTS[i];
        if (!tuft || tuft.layer !== layer || tuft.bucket !== b) continue;

        const bx = BLEED_X + tuft.xFrac * CARD_WIDTH;
        const h = tuft.height * hScale;
        const ang = tuft.lean + windOff + Math.sin(timePhase + tuft.phase) * swayAmp;
        const dx = Math.sin(ang) * h;
        const dy = -Math.cos(ang * 0.78) * h;

        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + dx * 0.45, by + dy * 0.56, bx + dx, by + dy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

let cachedBeeAbdPath: Path2D | null = null;
let cachedButterflyHindPath: Path2D | null = null;
let cachedButterflyForePath: Path2D | null = null;

function getBeeAbdPath(): Path2D {
  if (!cachedBeeAbdPath) {
    const p = new Path2D();
    p.moveTo(-0.3, -2.5);
    p.bezierCurveTo(-3.6, -4.1, -8.3, -2.4, -10.1, 1.15);
    p.bezierCurveTo(-8.4, 3.9, -3.5, 4.2, -0.3, 2.2);
    p.closePath();
    cachedBeeAbdPath = p;
  }
  return cachedBeeAbdPath;
}

function getButterflyHindPath(): Path2D {
  if (!cachedButterflyHindPath) {
    const p = new Path2D();
    p.moveTo(-0.6, -0.2);
    p.bezierCurveTo(-4.8, -1.6, -10.8, -4.6, -10.4, -8.8);
    p.bezierCurveTo(-9.8, -11.6, -6.2, -12.8, -3.2, -11.4);
    p.bezierCurveTo(-1.2, -10.4, 0.8, -7.8, 0.8, -3.2);
    p.closePath();
    cachedButterflyHindPath = p;
  }
  return cachedButterflyHindPath;
}

function getButterflyForePath(): Path2D {
  if (!cachedButterflyForePath) {
    const p = new Path2D();
    p.moveTo(0.4, -0.3);
    p.bezierCurveTo(3.8, -5.6, 8.2, -12.6, 8.6, -15.9);
    p.bezierCurveTo(8.8, -17.3, 6.4, -17.6, 4.4, -16.4);
    p.bezierCurveTo(1.8, -14.8, -0.4, -12.4, -2.4, -9.6);
    p.bezierCurveTo(-3.4, -8.2, -3.6, -5.6, -2.4, -2.6);
    p.bezierCurveTo(-1.7, -1.0, -0.6, -0.4, 0.4, -0.3);
    p.closePath();
    cachedButterflyForePath = p;
  }
  return cachedButterflyForePath;
}

function drawBeeWing(
  ctx: CanvasRenderingContext2D,
  length: number,
  width: number,
  angle: number,
  alpha: number,
  veinColor: RGB,
  isFar: boolean,
  withVeins: boolean,
): void {
  ctx.save();
  ctx.rotate(angle);

  const wingPath = new Path2D();
  wingPath.moveTo(0, 0);
  wingPath.bezierCurveTo(
    -length * 0.24,
    -width * 0.92,
    -length * 0.84,
    -width * 0.98,
    -length,
    -width * 0.14,
  );
  wingPath.bezierCurveTo(-length * 0.96, width * 0.62, -length * 0.36, width * 0.52, 0, 0);
  wingPath.closePath();

  const baseTone: RGB = isFar ? { r: 238, g: 243, b: 240 } : { r: 253, g: 251, b: 245 };
  const tipTone: RGB = isFar ? { r: 222, g: 235, b: 238 } : { r: 238, g: 246, b: 247 };
  const grad = ctx.createLinearGradient(0, 0, -length, -width * 0.2);
  grad.addColorStop(0, rgbToCss(baseTone, alpha * 0.95));
  grad.addColorStop(0.55, rgbToCss(baseTone, alpha * 0.82));
  grad.addColorStop(1, rgbToCss(tipTone, alpha * 0.64));

  ctx.fillStyle = grad;
  ctx.fill(wingPath);

  if (withVeins) {
    ctx.save();
    ctx.clip(wingPath);

    ctx.lineCap = "round";
    ctx.strokeStyle = rgbToCss(veinColor, alpha * 0.62);
    ctx.lineWidth = 0.52;
    ctx.beginPath();
    ctx.moveTo(-0.3, -0.1);
    ctx.quadraticCurveTo(-length * 0.48, -width * 0.72, -length * 0.92, -width * 0.22);
    ctx.stroke();

    ctx.strokeStyle = rgbToCss(veinColor, alpha * 0.42);
    ctx.lineWidth = 0.36;
    ctx.beginPath();
    ctx.moveTo(-length * 0.12, 0.05);
    ctx.quadraticCurveTo(-length * 0.46, -width * 0.2, -length * 0.88, -width * 0.04);
    ctx.moveTo(-length * 0.42, -width * 0.42);
    ctx.lineTo(-length * 0.64, width * 0.12);
    ctx.moveTo(-length * 0.64, -width * 0.48);
    ctx.lineTo(-length * 0.78, width * 0.18);
    ctx.moveTo(-length * 0.28, -width * 0.05);
    ctx.quadraticCurveTo(-length * 0.52, width * 0.24, -length * 0.78, width * 0.28);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = rgbToCss(veinColor, alpha * 0.56);
    ctx.lineWidth = 0.42;
    ctx.stroke(wingPath);
  }

  ctx.restore();
}

function drawBee(
  ctx: CanvasRenderingContext2D,
  insect: InsectState,
  palette: SunflowerPalette,
): void {
  const flutter = Math.sin(insect.wingPhase);
  const echoFlutter = Math.sin(insect.wingPhase + 1.55);
  const hover = clamp01(insect.hovering);

  const deepUmber = lerpRgb(palette.outlineInk, { r: 58, g: 40, b: 26 }, 0.54);
  const softSepia = lerpRgb(palette.outlineInk, palette.diskEdge, 0.36);
  const wingVein = lerpRgb(softSepia, { r: 118, g: 112, b: 102 }, 0.45);
  const honeyGold = lerpRgb(palette.petalOuter, palette.petalTip, 0.24);
  const buttercream = lerpRgb(palette.petalTip, palette.paperBg, 0.46);
  const amberOchre = lerpRgb(palette.petalInner, palette.petalShadow, 0.34);
  const fuzzOchre = lerpRgb(palette.petalOuter, { r: 230, g: 184, b: 92 }, 0.48);

  const baseWingAngle = lerp(0.56, 0.74, hover);
  const foreAngle = baseWingAngle + flutter * lerp(0.32, 0.42, hover);
  const hindAngle = baseWingAngle - 0.24 + flutter * lerp(0.24, 0.32, hover);
  const echoAngle = baseWingAngle + echoFlutter * lerp(0.38, 0.48, hover);

  ctx.save();

  // 1. Far gossamer wing pair + faint motion-blur echo behind body
  ctx.save();
  ctx.translate(0.9, -2.5);
  drawBeeWing(ctx, 9.6, 3.1, echoAngle + 0.14, 0.16, wingVein, true, false);
  drawBeeWing(ctx, 6.4, 2.2, hindAngle + 0.1, 0.38, wingVein, true, true);
  drawBeeWing(ctx, 9.8, 3.2, foreAngle + 0.12, 0.44, wingVein, true, true);
  ctx.restore();

  // 2. Delicate tucked warm-umber legs + tiny golden pollen drop on hind leg
  const legDrop = hover * 1.15;
  ctx.save();
  ctx.strokeStyle = rgbToCss(deepUmber, 0.74);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 0.62;
  ctx.beginPath();
  ctx.moveTo(4.2, 2.2);
  ctx.lineTo(5.2, 4.1 + legDrop * 0.6);
  ctx.lineTo(6.3, 5.1 + legDrop * 0.9);
  ctx.moveTo(1.8, 2.5);
  ctx.lineTo(1.2, 4.6 + legDrop * 0.8);
  ctx.lineTo(2.1, 5.9 + legDrop);
  ctx.moveTo(-0.8, 2.2);
  ctx.lineTo(-2.7, 4.7 + legDrop * 0.7);
  ctx.lineTo(-4.1, 6.2 + legDrop);
  ctx.stroke();

  ctx.fillStyle = rgbToCss(lerpRgb(palette.petalOuter, palette.petalTip, 0.4), 0.92);
  ctx.beginPath();
  ctx.ellipse(-2.8, 4.8 + legDrop * 0.75, 1.35, 1.05, -0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgbToCss(amberOchre, 0.42);
  ctx.lineWidth = 0.35;
  ctx.stroke();
  ctx.restore();

  // 3. Tapered painterly colored-pencil abdomen with soft curved umber bands
  const abdPath = getBeeAbdPath();
  const abdGrad = ctx.createLinearGradient(-4.5, -3.6, -5.2, 3.8);
  abdGrad.addColorStop(0, rgbToCss(buttercream, 0.96));
  abdGrad.addColorStop(0.32, rgbToCss(honeyGold, 0.96));
  abdGrad.addColorStop(0.78, rgbToCss(amberOchre, 0.95));
  abdGrad.addColorStop(1, rgbToCss(lerpRgb(amberOchre, deepUmber, 0.38), 0.94));

  ctx.save();
  ctx.fillStyle = abdGrad;
  ctx.fill(abdPath);
  ctx.clip(abdPath);

  const stripes: readonly { x: number; w: number; bend: number; alpha: number }[] = [
    { x: -2.6, w: 1.55, bend: 1.15, alpha: 0.76 },
    { x: -5.4, w: 1.5, bend: 1.0, alpha: 0.8 },
    { x: -7.9, w: 1.35, bend: 0.75, alpha: 0.82 },
  ];
  ctx.lineCap = "round";
  for (let i = 0; i < stripes.length; i++) {
    const st = stripes[i];
    if (!st) continue;
    ctx.strokeStyle = rgbToCss(deepUmber, st.alpha * 0.38);
    ctx.lineWidth = st.w + 0.95;
    ctx.beginPath();
    ctx.moveTo(st.x - 0.3, -4.2);
    ctx.quadraticCurveTo(st.x + st.bend, 0.1, st.x - 0.5, 4.4);
    ctx.stroke();

    ctx.strokeStyle = rgbToCss(deepUmber, st.alpha);
    ctx.lineWidth = st.w;
    ctx.stroke();
  }

  ctx.fillStyle = rgbToCss(deepUmber, 0.84);
  ctx.beginPath();
  ctx.ellipse(-9.7, 1.15, 1.5, 1.7, 0.25, 0, Math.PI * 2);
  ctx.fill();

  const sheenGrad = ctx.createLinearGradient(-5, -3.5, -5, 3.6);
  sheenGrad.addColorStop(0, rgbToCss(buttercream, 0.34));
  sheenGrad.addColorStop(0.38, rgbToCss(buttercream, 0));
  sheenGrad.addColorStop(0.72, rgbToCss(deepUmber, 0));
  sheenGrad.addColorStop(1, rgbToCss(deepUmber, 0.26));
  ctx.fillStyle = sheenGrad;
  ctx.fillRect(-11, -5, 12, 10);
  ctx.restore();

  ctx.strokeStyle = rgbToCss(softSepia, 0.38);
  ctx.lineWidth = 0.55;
  ctx.stroke(abdPath);

  // 4. Plump fuzzy honey-ochre thorax with batched radiating pencil-drawn fluff strokes
  const tx = 1.9;
  const ty = -0.35;
  const trx = 3.7;
  const tryR = 3.35;

  const thoraxGrad = ctx.createRadialGradient(tx - 0.6, ty - 1.4, 0.4, tx, ty, 4.2);
  thoraxGrad.addColorStop(0, rgbToCss(buttercream, 0.96));
  thoraxGrad.addColorStop(0.42, rgbToCss(fuzzOchre, 0.96));
  thoraxGrad.addColorStop(0.84, rgbToCss(amberOchre, 0.95));
  thoraxGrad.addColorStop(1, rgbToCss(lerpRgb(amberOchre, deepUmber, 0.35), 0.94));

  ctx.fillStyle = thoraxGrad;
  ctx.beginPath();
  ctx.ellipse(tx, ty, trx, tryR, -0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 0.56;
  const fuzzColors: readonly RGB[] = [
    lerpRgb(fuzzOchre, buttercream, 0.48),
    fuzzOchre,
    lerpRgb(amberOchre, deepUmber, 0.42),
  ];
  const fuzzPaths: readonly [Path2D, Path2D, Path2D] = [new Path2D(), new Path2D(), new Path2D()];
  const fuzzCount = 24;
  for (let i = 0; i < fuzzCount; i++) {
    const a = (i / fuzzCount) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const hairLen = 0.72 + (i % 3) * 0.26;
    const p = sa < -0.1 ? fuzzPaths[0] : sa > 0.35 ? fuzzPaths[2] : fuzzPaths[1];
    p.moveTo(tx + ca * trx * 0.86, ty + sa * tryR * 0.86);
    p.lineTo(tx + ca * (trx + hairLen) - 0.22, ty + sa * (tryR + hairLen));
  }
  for (let b = 0; b < 3; b++) {
    ctx.strokeStyle = rgbToCss(fuzzColors[b] ?? fuzzOchre, 0.72);
    ctx.stroke(fuzzPaths[b] as Path2D);
  }

  ctx.strokeStyle = rgbToCss(deepUmber, 0.26);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(tx + 0.1, ty + 0.1, 2.2, -2.2, -0.8);
  ctx.stroke();
  ctx.restore();

  // 5. Rounded warm dark-umber head, compound eye highlight & elbowed antennae
  const hx = 6.35;
  const hy = 0.15;
  const headGrad = ctx.createRadialGradient(hx - 0.5, hy - 1.0, 0.3, hx, hy, 2.8);
  headGrad.addColorStop(0, rgbToCss(lerpRgb(deepUmber, amberOchre, 0.35), 0.95));
  headGrad.addColorStop(0.6, rgbToCss(deepUmber, 0.96));
  headGrad.addColorStop(1, rgbToCss(lerpRgb(deepUmber, { r: 38, g: 28, b: 20 }, 0.32), 0.96));

  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.ellipse(hx, hy, 2.25, 2.45, 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgbToCss(buttercream, 0.76);
  ctx.beginPath();
  ctx.ellipse(hx + 0.75, hy - 0.75, 0.58, 0.42, -0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = rgbToCss(deepUmber, 0.56);
  ctx.lineWidth = 0.52;
  ctx.beginPath();
  ctx.moveTo(hx + 1.2, hy - 1.5);
  ctx.lineTo(hx + 2.8, hy - 3.3);
  ctx.quadraticCurveTo(hx + 4.1, hy - 3.6, hx + 4.9, hy - 2.6);
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(deepUmber, 0.8);
  ctx.lineWidth = 0.58;
  ctx.beginPath();
  ctx.moveTo(hx + 1.5, hy - 1.0);
  ctx.lineTo(hx + 3.4, hy - 2.2);
  ctx.quadraticCurveTo(hx + 4.8, hy - 2.2, hx + 5.6, hy - 1.0);
  ctx.stroke();

  // 6. Near translucent gossamer double-wing
  ctx.save();
  ctx.translate(1.6, -2.0);
  drawBeeWing(ctx, 10.6, 3.45, echoAngle, 0.2, wingVein, false, false);
  drawBeeWing(ctx, 7.1, 2.45, hindAngle, 0.48, wingVein, false, true);
  drawBeeWing(ctx, 10.8, 3.55, foreAngle, 0.58, wingVein, false, true);
  ctx.restore();

  ctx.restore();
}

function drawButterflyWingPair(
  ctx: CanvasRenderingContext2D,
  palette: SunflowerPalette,
  isFar: boolean,
  isUnderside: boolean,
): void {
  const buttercream = lerpRgb(palette.petalTip, palette.paperBg, isUnderside ? 0.54 : 0.36);
  const saffronApricot = lerpRgb(palette.petalOuter, { r: 238, g: 158, b: 84 }, 0.46);
  const warmCinnamon = lerpRgb(palette.petalShadow, { r: 146, g: 84, b: 44 }, 0.52);
  const deepSepia = lerpRgb(palette.outlineInk, { r: 74, g: 52, b: 36 }, 0.44);

  const shadeMix = isFar ? 0.14 : 0;
  const innerCol = lerpRgb(buttercream, deepSepia, shadeMix * 0.7);
  const midCol = isUnderside
    ? lerpRgb(buttercream, saffronApricot, 0.36)
    : lerpRgb(saffronApricot, deepSepia, shadeMix);
  const marginCol = isUnderside
    ? lerpRgb(warmCinnamon, buttercream, 0.48)
    : lerpRgb(warmCinnamon, deepSepia, 0.2 + shadeMix);
  const contourCol = lerpRgb(deepSepia, warmCinnamon, 0.28);

  const hindPath = getButterflyHindPath();
  const hindGrad = ctx.createLinearGradient(-1.0, -1.0, -9.8, -10.4);
  hindGrad.addColorStop(0, rgbToCss(innerCol, 0.94));
  hindGrad.addColorStop(0.58, rgbToCss(midCol, 0.92));
  hindGrad.addColorStop(0.84, rgbToCss(lerpRgb(midCol, marginCol, 0.55), 0.9));
  hindGrad.addColorStop(1, rgbToCss(marginCol, 0.88));

  ctx.save();
  ctx.fillStyle = hindGrad;
  ctx.fill(hindPath);
  ctx.clip(hindPath);

  ctx.strokeStyle = rgbToCss(contourCol, isUnderside ? 0.28 : 0.34);
  ctx.lineWidth = 0.42;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-1.0, -1.4);
  ctx.quadraticCurveTo(-5.2, -4.2, -9.2, -7.8);
  ctx.moveTo(-0.8, -2.0);
  ctx.quadraticCurveTo(-4.4, -6.6, -6.8, -11.2);
  ctx.moveTo(-0.5, -2.4);
  ctx.quadraticCurveTo(-2.4, -7.0, -3.2, -11.0);
  ctx.stroke();

  if (!isUnderside) {
    ctx.fillStyle = rgbToCss(buttercream, 0.72);
    ctx.beginPath();
    ctx.arc(-8.2, -9.2, 0.65, 0, Math.PI * 2);
    ctx.arc(-6.0, -10.8, 0.58, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = rgbToCss(contourCol, isFar ? 0.28 : 0.36);
  ctx.lineWidth = 0.52;
  ctx.lineJoin = "round";
  ctx.stroke(hindPath);

  const forePath = getButterflyForePath();
  const foreGrad = ctx.createLinearGradient(0.4, -1.0, 7.2, -16.2);
  foreGrad.addColorStop(0, rgbToCss(innerCol, 0.96));
  foreGrad.addColorStop(0.52, rgbToCss(midCol, 0.94));
  foreGrad.addColorStop(0.84, rgbToCss(lerpRgb(midCol, marginCol, 0.5), 0.92));
  foreGrad.addColorStop(1, rgbToCss(marginCol, 0.9));

  ctx.save();
  ctx.fillStyle = foreGrad;
  ctx.fill(forePath);
  ctx.clip(forePath);

  const tipWash = ctx.createRadialGradient(7.2, -15.4, 1.2, 4.6, -13.4, 9.2);
  tipWash.addColorStop(0, rgbToCss(marginCol, isUnderside ? 0.34 : 0.72));
  tipWash.addColorStop(0.54, rgbToCss(marginCol, isUnderside ? 0.14 : 0.34));
  tipWash.addColorStop(1, rgbToCss(marginCol, 0));
  ctx.fillStyle = tipWash;
  ctx.fillRect(-5, -19, 15, 20);

  const innerGlow = ctx.createRadialGradient(2.2, -6.4, 0.6, 2.0, -6.6, 6.2);
  innerGlow.addColorStop(0, rgbToCss(buttercream, isUnderside ? 0.36 : 0.42));
  innerGlow.addColorStop(1, rgbToCss(buttercream, 0));
  ctx.fillStyle = innerGlow;
  ctx.fillRect(-4, -15, 13, 15);

  ctx.strokeStyle = rgbToCss(contourCol, isUnderside ? 0.3 : 0.36);
  ctx.lineWidth = 0.45;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0.6, -0.8);
  ctx.quadraticCurveTo(4.2, -7.2, 7.6, -15.2);
  ctx.moveTo(0.1, -1.2);
  ctx.quadraticCurveTo(2.4, -7.4, 5.2, -15.4);
  ctx.moveTo(-0.3, -1.5);
  ctx.quadraticCurveTo(0.8, -7.2, 2.0, -13.6);
  ctx.moveTo(-0.7, -1.4);
  ctx.quadraticCurveTo(-1.0, -6.2, -1.0, -10.8);
  ctx.stroke();

  if (!isUnderside) {
    ctx.fillStyle = rgbToCss(buttercream, 0.86);
    ctx.beginPath();
    ctx.ellipse(6.5, -15.2, 0.92, 0.6, -0.45, 0, Math.PI * 2);
    ctx.moveTo(4.8 + 0.68, -14.8);
    ctx.arc(4.8, -14.8, 0.68, 0, Math.PI * 2);
    ctx.moveTo(2.9 + 0.56, -13.3);
    ctx.arc(2.9, -13.3, 0.56, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = rgbToCss(contourCol, isFar ? 0.32 : 0.4);
  ctx.lineWidth = 0.54;
  ctx.lineJoin = "round";
  ctx.stroke(forePath);
}

function drawButterfly(
  ctx: CanvasRenderingContext2D,
  insect: InsectState,
  palette: SunflowerPalette,
): void {
  const rawFlap = Math.sin(insect.wingPhase);
  const openT = (rawFlap + 1) * 0.5;
  const easedOpen = openT * openT * (3 - 2 * openT);
  const glide = clamp01(insect.glide);

  const phi = lerp(lerp(1.32, -0.22, easedOpen), 0.14, glide);
  const viewElevation = 0.66;

  const farProjY = Math.sin(viewElevation + phi);
  const rawNearProjY = -Math.sin(viewElevation - phi);
  const nearProjY =
    Math.abs(rawNearProjY) < 0.08 ? (rawNearProjY < 0 ? -0.08 : 0.08) : rawNearProjY;
  const nearShowsUnderside = nearProjY > 0;
  const wingSkew = Math.sin(phi) * 0.14;
  const wingSpanX = lerp(0.92, 1.04, easedOpen);

  const deepUmber = lerpRgb(palette.outlineInk, { r: 66, g: 48, b: 34 }, 0.48);
  const softOchre = lerpRgb(palette.petalInner, palette.petalTip, 0.36);

  ctx.save();

  ctx.save();
  ctx.translate(-0.85, -0.75);
  ctx.transform(wingSpanX * 0.94, 0, wingSkew * 0.9, Math.max(0.24, farProjY), 0, 0);
  drawButterflyWingPair(ctx, palette, true, false);
  ctx.restore();

  ctx.save();
  const abdGrad = ctx.createLinearGradient(-7.8, 0.2, 0.2, -0.2);
  abdGrad.addColorStop(0, rgbToCss(deepUmber, 0.84));
  abdGrad.addColorStop(1, rgbToCss(lerpRgb(deepUmber, softOchre, 0.22), 0.9));
  ctx.fillStyle = abdGrad;
  ctx.beginPath();
  ctx.moveTo(-0.2, -1.05);
  ctx.quadraticCurveTo(-4.2, -0.9, -7.8, 0.45);
  ctx.quadraticCurveTo(-4.2, 1.35, -0.2, 1.05);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = rgbToCss(softOchre, 0.34);
  ctx.lineWidth = 0.48;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.8, -0.45);
  ctx.quadraticCurveTo(-3.8, -0.3, -6.8, 0.35);
  ctx.stroke();

  ctx.fillStyle = rgbToCss(deepUmber, 0.92);
  ctx.beginPath();
  ctx.ellipse(1.15, -0.25, 2.45, 1.48, -0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgbToCss(softOchre, 0.36);
  ctx.beginPath();
  ctx.ellipse(1.0, -0.7, 1.5, 0.62, -0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgbToCss(deepUmber, 0.94);
  ctx.beginPath();
  ctx.arc(3.95, -0.45, 1.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgbToCss(lerpRgb(palette.petalTip, palette.paperBg, 0.5), 0.65);
  ctx.beginPath();
  ctx.arc(4.35, -0.85, 0.34, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = "round";
  ctx.strokeStyle = rgbToCss(deepUmber, 0.56);
  ctx.lineWidth = 0.46;
  ctx.beginPath();
  ctx.moveTo(4.5, -1.2);
  ctx.bezierCurveTo(6.1, -3.5, 7.4, -4.6, 8.7, -4.4);
  ctx.stroke();
  ctx.fillStyle = rgbToCss(deepUmber, 0.64);
  ctx.beginPath();
  ctx.ellipse(8.9, -4.38, 0.62, 0.36, 0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = rgbToCss(deepUmber, 0.78);
  ctx.lineWidth = 0.52;
  ctx.beginPath();
  ctx.moveTo(4.75, -0.85);
  ctx.bezierCurveTo(6.5, -2.3, 7.8, -3.0, 9.0, -2.55);
  ctx.stroke();
  ctx.fillStyle = rgbToCss(deepUmber, 0.84);
  ctx.beginPath();
  ctx.ellipse(9.2, -2.48, 0.66, 0.38, 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(0.45, -0.15);
  ctx.transform(wingSpanX, 0, wingSkew * (nearShowsUnderside ? 0.95 : 0.55), nearProjY, 0, 0);
  drawButterflyWingPair(ctx, palette, false, nearShowsUnderside);
  ctx.restore();

  ctx.restore();
}

export function paintAirborneLife(
  ctx: CanvasRenderingContext2D,
  state: SunflowerSimState,
  palette: SunflowerPalette,
): void {
  const { particles, insect } = state;

  // Soft dry dust motes (0%) and gentle golden pollen motes (100%), batched by alpha tier
  ctx.save();
  const warmGold = lerpRgb(palette.petalOuter, palette.petalTip, 0.58);
  const dustLow = new Path2D();
  const dustHigh = new Path2D();
  const pollenHaloLow = new Path2D();
  const pollenHaloHigh = new Path2D();
  const pollenCoreLow = new Path2D();
  const pollenCoreHigh = new Path2D();
  let dustLowAlpha = 0;
  let dustHighAlpha = 0;
  let pollenLowAlpha = 0;
  let pollenHighAlpha = 0;
  let dustLowCount = 0;
  let dustHighCount = 0;
  let pollenLowCount = 0;
  let pollenHighCount = 0;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (!p || p.alpha <= 0.01) continue;

    if (p.kind === "dust") {
      const rx = p.size * 1.1;
      const ry = p.size * 0.5;
      const rot = p.phase + state.time * 0.25;
      const hi = Math.sin(state.time * 1.05 + p.phase) >= 0;
      const target = hi ? dustHigh : dustLow;
      target.moveTo(p.x + Math.cos(rot) * rx, p.y + Math.sin(rot) * rx);
      target.ellipse(p.x, p.y, rx, ry, rot, 0, Math.PI * 2);
      if (hi) {
        dustHighAlpha += p.alpha;
        dustHighCount++;
      } else {
        dustLowAlpha += p.alpha;
        dustLowCount++;
      }
    } else {
      const speckR = clamp01(p.size / 3.4) * 0.85 + 0.65;
      const haloR = speckR * 1.35;
      const coreR = speckR * 0.72;
      const hi = Math.sin(state.time * 1.05 + p.phase) >= 0;
      const haloTarget = hi ? pollenHaloHigh : pollenHaloLow;
      const coreTarget = hi ? pollenCoreHigh : pollenCoreLow;
      haloTarget.moveTo(p.x + haloR, p.y);
      haloTarget.arc(p.x, p.y, haloR, 0, Math.PI * 2);
      coreTarget.moveTo(p.x + coreR, p.y);
      coreTarget.arc(p.x, p.y, coreR, 0, Math.PI * 2);
      if (hi) {
        pollenHighAlpha += p.alpha;
        pollenHighCount++;
      } else {
        pollenLowAlpha += p.alpha;
        pollenLowCount++;
      }
    }
  }

  if (dustLowCount > 0) {
    ctx.fillStyle = rgbToCss(palette.twigColor, (dustLowAlpha / dustLowCount) * 0.5);
    ctx.fill(dustLow);
  }
  if (dustHighCount > 0) {
    ctx.fillStyle = rgbToCss(palette.twigColor, (dustHighAlpha / dustHighCount) * 0.5);
    ctx.fill(dustHigh);
  }
  if (pollenLowCount > 0) {
    const avg = pollenLowAlpha / pollenLowCount;
    ctx.fillStyle = rgbToCss(warmGold, avg * 0.48);
    ctx.fill(pollenHaloLow);
    ctx.fillStyle = rgbToCss(palette.petalTip, avg * 0.68);
    ctx.fill(pollenCoreLow);
  }
  if (pollenHighCount > 0) {
    const avg = pollenHighAlpha / pollenHighCount;
    ctx.fillStyle = rgbToCss(warmGold, avg * 0.48);
    ctx.fill(pollenHaloHigh);
    ctx.fillStyle = rgbToCss(palette.petalTip, avg * 0.68);
    ctx.fill(pollenCoreHigh);
  }
  ctx.restore();

  // Gentle storybook colored-pencil bee or butterfly above 80%
  if (insect.active && insect.opacity > 0.01) {
    ctx.save();
    ctx.globalAlpha = clamp01(insect.opacity);
    ctx.translate(insect.x, insect.y);
    ctx.scale(insect.facing * insect.scale, insect.scale);
    ctx.rotate(insect.tilt);

    if (insect.kind === "bee") {
      drawBee(ctx, insect, palette);
    } else {
      drawButterfly(ctx, insect, palette);
    }
    ctx.restore();
  }
}
