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
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CARD_WIDTH,
  type HeadPose,
  type LeafPose,
  type Point2D,
  type RGB,
  type StemNode,
  type SunflowerPalette,
  type SunflowerSimState,
} from "./types";

const GOLDEN_ANGLE = 2.399963229728653;
const SEED_COUNT = 264;

const PETAL_SPRITE_W = 68;
const PETAL_SPRITE_H = 152;
const PETAL_BASE_X = 34;
const PETAL_BASE_Y = 12;
const PETAL_SPAN_Y = 128;
const PETAL_HALF_W = 24;

const DISK_SPRITE_SIZE = 196;
const DISK_CENTER = 98;
const DISK_RADIUS = 80;

interface PetalSpec {
  index: number;
  ring: 0 | 1;
  variant: number;
  angle: number;
  lengthMul: number;
  widthMul: number;
  curlBias: number;
  bendBias: number;
  flipX: 1 | -1;
}

const PETAL_SPECS: readonly PetalSpec[] = (() => {
  const rng = mulberry32(28417);
  const specs: PetalSpec[] = [];
  const ringCounts: readonly [number, number] = [18, 18];
  let index = 0;

  for (let ring = 0; ring < 2; ring++) {
    const count = ringCounts[ring] ?? 18;
    const angleStep = (Math.PI * 2) / count;
    const ringOffset = ring === 0 ? angleStep * 0.5 : 0;
    for (let i = 0; i < count; i++) {
      specs.push({
        index: index++,
        ring: ring as 0 | 1,
        variant: i % 4,
        angle: i * angleStep + ringOffset + (rng() - 0.5) * 0.055,
        lengthMul: (ring === 0 ? 0.96 : 1.0) * (0.92 + rng() * 0.16),
        widthMul: (ring === 0 ? 1.08 : 0.98) * (0.93 + rng() * 0.16),
        curlBias: (rng() - 0.5) * 0.28,
        bendBias: (rng() - 0.5) * 0.22,
        flipX: rng() > 0.5 ? 1 : -1,
      });
    }
  }
  return specs;
})();

function compareRadialDepth(aAngle: number, bAngle: number, aTie: number, bTie: number): number {
  const sinDiff = Math.sin(bAngle) - Math.sin(aAngle);
  if (Math.abs(sinDiff) > 1e-6) return sinDiff;
  const angleDiff = aAngle - bAngle;
  if (Math.abs(angleDiff) > 1e-6) return angleDiff;
  return aTie - bTie;
}

const BACK_PETAL_SPECS: readonly PetalSpec[] = PETAL_SPECS.filter((s) => s.ring === 0).sort(
  (a, b) => compareRadialDepth(a.angle, b.angle, a.index, b.index),
);

const FRONT_PETAL_SPECS: readonly PetalSpec[] = PETAL_SPECS.filter((s) => s.ring === 1).sort(
  (a, b) => compareRadialDepth(a.angle, b.angle, a.index, b.index),
);

interface SepalSpec {
  angle: number;
  cosA: number;
  sinA: number;
  lengthMul: number;
  widthMul: number;
  seed: number;
}

const SEPAL_SPECS: readonly SepalSpec[] = (() => {
  const rng = mulberry32(61903);
  const specs: SepalSpec[] = [];
  const count = 14;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.12;
    specs.push({
      angle,
      cosA: Math.cos(angle),
      sinA: Math.sin(angle),
      lengthMul: 0.86 + rng() * 0.34,
      widthMul: 0.86 + rng() * 0.24,
      seed: Math.floor(rng() * 100000),
    });
  }
  return specs.sort((a, b) => compareRadialDepth(a.angle, b.angle, a.seed, b.seed));
})();

interface BotanicalSpriteBank {
  /** Single 8x3 atlas: col = (ring === 0 ? 0 : 4) + variant, row = 0(wilted) | 1(mid) | 2(bloom) */
  petalAtlas: HTMLCanvasElement;
  diskWilted: HTMLCanvasElement;
  diskMid: HTMLCanvasElement;
  diskBloom: HTMLCanvasElement;
}

let cachedSpriteBank: BotanicalSpriteBank | null = null;
let cachedOutsideCardPath: Path2D | null = null;
let cachedOutsideCardSource: Path2D | null = null;

const hatchOverlayPatternCache = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>();

function getHatchOverlayPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (hatchOverlayPatternCache.has(ctx)) {
    return hatchOverlayPatternCache.get(ctx) ?? null;
  }
  const { pencilHatchOverlay } = getPaperTextures();
  const pat = pencilHatchOverlay.width ? ctx.createPattern(pencilHatchOverlay, "repeat") : null;
  hatchOverlayPatternCache.set(ctx, pat);
  return pat;
}

function getOutsideCardPath(cardPath: Path2D): Path2D {
  if (cachedOutsideCardPath && cachedOutsideCardSource === cardPath) {
    return cachedOutsideCardPath;
  }
  const outer = new Path2D();
  outer.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  outer.addPath(cardPath);
  cachedOutsideCardPath = outer;
  cachedOutsideCardSource = cardPath;
  return outer;
}

function paintPetalSpriteInto(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  palette: SunflowerPalette,
  variant: number,
  isBackRing: boolean,
  bloomLevel: number,
): void {
  const rng = mulberry32(4100 + variant * 977 + (isBackRing ? 313 : 0));
  const tipBend = (variant - 1.5) * 3.2;
  const bellyShift = (variant % 2 === 0 ? 1 : -1) * 1.4;
  const widthBias = 0.94 + (variant % 3) * 0.05;

  const cx = PETAL_BASE_X;
  const y0 = PETAL_BASE_Y;
  const yTip = PETAL_BASE_Y + PETAL_SPAN_Y;
  const hw = PETAL_HALF_W * widthBias;

  ctx.save();
  ctx.translate(offsetX, offsetY);

  const petalPath = new Path2D();
  petalPath.moveTo(cx - hw * 0.42, y0);
  petalPath.bezierCurveTo(
    cx - hw * 1.04 + bellyShift,
    y0 + PETAL_SPAN_Y * 0.26,
    cx - hw * 0.88 + tipBend * 0.35,
    y0 + PETAL_SPAN_Y * 0.68,
    cx + tipBend,
    yTip,
  );
  petalPath.bezierCurveTo(
    cx + hw * 0.88 + tipBend * 0.35,
    y0 + PETAL_SPAN_Y * 0.68,
    cx + hw * 1.04 + bellyShift,
    y0 + PETAL_SPAN_Y * 0.26,
    cx + hw * 0.42,
    y0,
  );
  petalPath.closePath();

  const shadowTone = isBackRing
    ? lerpRgb(palette.petalShadow, palette.outlineInk, 0.16)
    : palette.petalShadow;
  const innerTone = isBackRing
    ? lerpRgb(palette.petalShadow, palette.petalInner, 0.58)
    : palette.petalInner;
  const midTone = isBackRing
    ? lerpRgb(palette.petalInner, palette.petalOuter, 0.56)
    : palette.petalOuter;
  const tipTone = isBackRing
    ? lerpRgb(palette.petalOuter, palette.petalTip, 0.48)
    : palette.petalTip;
  const highlightCream = lerpRgb(tipTone, palette.paperBg, 0.36);

  const baseGrad = ctx.createLinearGradient(cx, y0, cx + tipBend * 0.5, yTip);
  baseGrad.addColorStop(0, rgbToCss(lerpRgb(shadowTone, innerTone, 0.35)));
  baseGrad.addColorStop(0.22, rgbToCss(innerTone));
  baseGrad.addColorStop(0.62, rgbToCss(midTone));
  baseGrad.addColorStop(1, rgbToCss(tipTone));

  ctx.save();
  ctx.fillStyle = baseGrad;
  ctx.fill(petalPath);

  ctx.clip(petalPath);

  const baseShade = ctx.createRadialGradient(cx, y0 - 2, 2, cx, y0 + 18, 44);
  baseShade.addColorStop(0, rgbToCss(shadowTone, 0.55));
  baseShade.addColorStop(0.55, rgbToCss(innerTone, 0.24));
  baseShade.addColorStop(1, rgbToCss(innerTone, 0));
  ctx.fillStyle = baseShade;
  ctx.fillRect(0, 0, PETAL_SPRITE_W, PETAL_SPRITE_H);

  const sideGrad = ctx.createLinearGradient(cx - hw, y0, cx + hw, y0);
  sideGrad.addColorStop(0, rgbToCss(highlightCream, 0.28));
  sideGrad.addColorStop(0.45, rgbToCss(midTone, 0));
  sideGrad.addColorStop(1, rgbToCss(shadowTone, 0.22));
  ctx.fillStyle = sideGrad;
  ctx.fillRect(0, 0, PETAL_SPRITE_W, PETAL_SPRITE_H);

  ctx.lineCap = "round";
  const strokeCount = 42;
  for (let s = 0; s < strokeCount; s++) {
    const u = (s / (strokeCount - 1)) * 2 - 1;
    const jitterU = (rng() - 0.5) * 0.08;
    const lane = u + jitterU;
    const startFrac = rng() * 0.22;
    const endFrac = 0.52 + rng() * 0.46;

    const sx = cx + lane * hw * (0.42 + startFrac * 0.55);
    const sy = y0 + startFrac * PETAL_SPAN_Y;
    const mx = cx + lane * hw * 0.82 + bellyShift * 0.6;
    const my = y0 + lerp(startFrac, endFrac, 0.5) * PETAL_SPAN_Y;
    const ex = cx + lane * hw * (1 - endFrac) * 0.9 + tipBend * endFrac;
    const ey = y0 + endFrac * PETAL_SPAN_Y;

    let col: RGB;
    let alpha: number;
    if (startFrac < 0.08 && rng() > 0.35) {
      col = shadowTone;
      alpha = 0.14 + rng() * 0.18;
    } else if (lane < -0.15 && rng() > 0.42) {
      col = highlightCream;
      alpha = 0.16 + rng() * 0.2;
    } else if (lane > 0.25 && rng() > 0.38) {
      col = lerpRgb(innerTone, shadowTone, 0.45);
      alpha = 0.12 + rng() * 0.16;
    } else {
      col = rng() > 0.5 ? innerTone : tipTone;
      alpha = 0.1 + rng() * 0.15;
    }

    ctx.strokeStyle = rgbToCss(col, alpha);
    ctx.lineWidth = 0.6 + rng() * 1.1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, ex, ey);
    ctx.stroke();
  }

  ctx.strokeStyle = rgbToCss(shadowTone, lerp(0.36, 0.26, bloomLevel));
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(cx + 0.6, y0 + 2);
  ctx.quadraticCurveTo(
    cx + bellyShift * 0.4 + 1.0,
    y0 + PETAL_SPAN_Y * 0.52,
    cx + tipBend * 0.85,
    yTip - 10,
  );
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(highlightCream, lerp(0.24, 0.36, bloomLevel));
  ctx.lineWidth = 0.95;
  ctx.beginPath();
  ctx.moveTo(cx - 1.2, y0 + 8);
  ctx.quadraticCurveTo(
    cx + bellyShift * 0.4 - 1.4,
    y0 + PETAL_SPAN_Y * 0.5,
    cx + tipBend * 0.82 - 0.8,
    yTip - 14,
  );
  ctx.stroke();

  for (const side of [-1, 1] as const) {
    ctx.strokeStyle = rgbToCss(shadowTone, 0.15);
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(cx + side * hw * 0.24, y0 + 6);
    ctx.quadraticCurveTo(
      cx + side * hw * 0.46 + bellyShift * 0.5,
      y0 + PETAL_SPAN_Y * 0.45,
      cx + side * hw * 0.18 + tipBend * 0.65,
      y0 + PETAL_SPAN_Y * 0.82,
    );
    ctx.stroke();
  }

  const { pastelGrainTile } = getPaperTextures();
  if (pastelGrainTile.width) {
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.26;
    ctx.drawImage(pastelGrainTile, 0, 0, PETAL_SPRITE_W, PETAL_SPRITE_H);
  }
  ctx.restore();

  const edgeCol = lerpRgb(shadowTone, palette.outlineInk, lerp(0.45, 0.22, bloomLevel));
  const edgeGrad = ctx.createLinearGradient(cx, y0, cx, yTip);
  edgeGrad.addColorStop(0, rgbToCss(edgeCol, isBackRing ? 0.34 : 0.42));
  edgeGrad.addColorStop(0.65, rgbToCss(edgeCol, isBackRing ? 0.28 : 0.36));
  edgeGrad.addColorStop(1, rgbToCss(edgeCol, isBackRing ? 0.16 : 0.22));
  ctx.strokeStyle = edgeGrad;
  ctx.lineWidth = 1.1;
  ctx.lineJoin = "round";
  ctx.stroke(petalPath);

  ctx.restore();
}

function createPetalAtlas(
  pal0: SunflowerPalette,
  palMid: SunflowerPalette,
  pal1: SunflowerPalette,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PETAL_SPRITE_W * 8;
  canvas.height = PETAL_SPRITE_H * 3;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const stages: readonly { palette: SunflowerPalette; bloom: number }[] = [
    { palette: pal0, bloom: 0 },
    { palette: palMid, bloom: 0.5 },
    { palette: pal1, bloom: 1 },
  ];

  for (let row = 0; row < stages.length; row++) {
    const stage = stages[row];
    if (!stage) continue;
    const oy = row * PETAL_SPRITE_H;
    for (let v = 0; v < 4; v++) {
      // Cols 0..3: back ring; cols 4..7: front ring
      paintPetalSpriteInto(ctx, v * PETAL_SPRITE_W, oy, stage.palette, v, true, stage.bloom);
      paintPetalSpriteInto(ctx, (4 + v) * PETAL_SPRITE_W, oy, stage.palette, v, false, stage.bloom);
    }
  }
  return canvas;
}

function createDiskSprite(palette: SunflowerPalette, bloomLevel: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = DISK_SPRITE_SIZE;
  canvas.height = DISK_SPRITE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const cx = DISK_CENTER;
  const cy = DISK_CENTER;
  const r = DISK_RADIUS;
  const rng = mulberry32(90210 + Math.round(bloomLevel * 100));

  const diskCircle = new Path2D();
  diskCircle.arc(cx, cy, r, 0, Math.PI * 2);

  const baseGrad = ctx.createRadialGradient(
    cx - r * 0.12,
    cy - r * 0.12,
    r * 0.05,
    cx,
    cy,
    r * 1.02,
  );
  baseGrad.addColorStop(0, rgbToCss(lerpRgb(palette.diskCenter, palette.outlineInk, 0.26)));
  baseGrad.addColorStop(0.36, rgbToCss(palette.diskCenter));
  baseGrad.addColorStop(0.64, rgbToCss(lerpRgb(palette.diskEdge, palette.diskMid, 0.56)));
  baseGrad.addColorStop(0.86, rgbToCss(palette.diskEdge));
  baseGrad.addColorStop(1, rgbToCss(lerpRgb(palette.diskEdge, palette.outlineInk, 0.34)));

  ctx.save();
  ctx.fillStyle = baseGrad;
  ctx.fill(diskCircle);

  ctx.clip(diskCircle);

  const lightGrad = ctx.createRadialGradient(
    cx - r * 0.28,
    cy - r * 0.28,
    r * 0.08,
    cx,
    cy,
    r * 1.1,
  );
  lightGrad.addColorStop(0, rgbToCss(palette.petalTip, lerp(0.06, 0.16, bloomLevel)));
  lightGrad.addColorStop(0.55, "rgba(0, 0, 0, 0)");
  lightGrad.addColorStop(1, rgbToCss(palette.outlineInk, 0.24));
  ctx.fillStyle = lightGrad;
  ctx.fillRect(0, 0, DISK_SPRITE_SIZE, DISK_SPRITE_SIZE);

  for (let i = 0; i < SEED_COUNT; i++) {
    const frac = (i + 0.5) / SEED_COUNT;
    const rn = Math.sqrt(frac);
    const theta = i * GOLDEN_ANGLE;
    const jitterR = (rng() - 0.5) * 1.8;
    const sx = cx + Math.cos(theta) * (rn * r * 0.94 + jitterR);
    const sy = cy + Math.sin(theta) * (rn * r * 0.94 + jitterR);
    const seedR = (2.1 + rn * 2.15) * lerp(0.84, 1.0, bloomLevel);

    const lightDir = -(Math.cos(theta) * 0.7 + Math.sin(theta) * 0.7) * rn;

    let seedCol: RGB;
    let hiCol: RGB;
    let shadowCol: RGB;

    if (rn < 0.42) {
      const k = rn / 0.42;
      seedCol = lerpRgb(
        lerpRgb(palette.diskCenter, palette.outlineInk, 0.28),
        palette.diskCenter,
        k,
      );
      hiCol = lerpRgb(palette.diskCenter, palette.leafHighlight, 0.42 * bloomLevel + 0.1);
      shadowCol = lerpRgb(palette.diskCenter, palette.outlineInk, 0.48);
    } else if (rn < 0.79) {
      const k = (rn - 0.42) / 0.37;
      const ringPeak = Math.sin(k * Math.PI);
      seedCol = lerpRgb(palette.diskEdge, palette.diskMid, 0.28 + ringPeak * 0.62);
      hiCol = lerpRgb(palette.diskMid, palette.petalTip, 0.52 * bloomLevel + 0.14);
      shadowCol = lerpRgb(palette.diskEdge, palette.outlineInk, 0.38);
    } else {
      seedCol = lerpRgb(palette.diskEdge, palette.outlineInk, 0.18);
      hiCol = lerpRgb(palette.diskMid, palette.petalInner, 0.36 * bloomLevel + 0.12);
      shadowCol = lerpRgb(palette.diskEdge, palette.outlineInk, 0.48);
    }

    ctx.fillStyle = rgbToCss(shadowCol, 0.52);
    ctx.beginPath();
    ctx.ellipse(sx + 0.85, sy + 0.95, seedR * 1.05, seedR * 0.9, theta, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgbToCss(seedCol, 0.92);
    ctx.beginPath();
    ctx.ellipse(
      sx,
      sy,
      seedR * (0.9 + rng() * 0.2),
      seedR * (0.76 + rng() * 0.2),
      theta + 0.4,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    const hiAlpha = clamp01(lerp(0.24, 0.78, bloomLevel) + lightDir * 0.24);
    if (rn > 0.24 && (i % 2 === 0 || rn > 0.44)) {
      ctx.fillStyle = rgbToCss(hiCol, hiAlpha);
      ctx.beginPath();
      ctx.arc(sx - seedR * 0.26, sy - seedR * 0.24, seedR * (0.34 + rng() * 0.14), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const { pastelGrainTile } = getPaperTextures();
  if (pastelGrainTile.width) {
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.28;
    ctx.drawImage(pastelGrainTile, 0, 0, DISK_SPRITE_SIZE, DISK_SPRITE_SIZE);
  }
  ctx.restore();

  ctx.save();
  ctx.lineCap = "round";
  const stamenCount = 68;
  for (let t = 0; t < stamenCount; t++) {
    const a = (t / stamenCount) * Math.PI * 2 + (rng() - 0.5) * 0.05;
    const innerR = r * (0.85 + rng() * 0.06);
    const outerR = r * (1.01 + rng() * 0.08);
    const col =
      t % 3 === 0
        ? lerpRgb(palette.diskMid, palette.petalInner, 0.45 * bloomLevel)
        : lerpRgb(palette.diskEdge, palette.outlineInk, 0.25);

    ctx.strokeStyle = rgbToCss(col, t % 3 === 0 ? 0.56 : 0.46);
    ctx.lineWidth = 0.95 + rng() * 0.7;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * innerR, cy + Math.sin(a) * innerR);
    ctx.lineTo(cx + Math.cos(a) * outerR, cy + Math.sin(a) * outerR);
    ctx.stroke();
  }
  ctx.restore();

  return canvas;
}

function getBotanicalSpriteBank(): BotanicalSpriteBank | null {
  if (cachedSpriteBank) return cachedSpriteBank;
  if (typeof document === "undefined") return null;

  const pal0 = getPalette(computePhasedProgress(0));
  const palMid = getPalette(computePhasedProgress(0.55));
  const pal1 = getPalette(computePhasedProgress(1));

  cachedSpriteBank = {
    petalAtlas: createPetalAtlas(pal0, palMid, pal1),
    diskWilted: createDiskSprite(pal0, 0),
    diskMid: createDiskSprite(palMid, 0.5),
    diskBloom: createDiskSprite(pal1, 1),
  };

  return cachedSpriteBank;
}

function traceSmoothSpline(
  target: Path2D | CanvasRenderingContext2D,
  pts: readonly Point2D[],
  count: number,
  startWithMove: boolean,
  yOffset = 0,
): void {
  const first = pts[0];
  if (count === 0 || !first) return;
  if (startWithMove) {
    target.moveTo(first.x, first.y + yOffset);
  } else {
    target.lineTo(first.x, first.y + yOffset);
  }
  if (count === 1) return;
  if (count === 2) {
    const second = pts[1];
    if (second) target.lineTo(second.x, second.y + yOffset);
    return;
  }
  for (let i = 1; i < count - 1; i++) {
    const curr = pts[i];
    const next = pts[i + 1];
    if (!curr || !next) continue;
    target.quadraticCurveTo(
      curr.x,
      curr.y + yOffset,
      (curr.x + next.x) * 0.5,
      (curr.y + next.y) * 0.5 + yOffset,
    );
  }
  const last = pts[count - 1];
  if (last) target.lineTo(last.x, last.y + yOffset);
}

function traceSmoothSplineReverse(
  target: Path2D | CanvasRenderingContext2D,
  pts: readonly Point2D[],
  count: number,
): void {
  const last = pts[count - 1];
  if (count === 0 || !last) return;
  target.lineTo(last.x, last.y);
  if (count === 1) return;
  if (count === 2) {
    const first = pts[0];
    if (first) target.lineTo(first.x, first.y);
    return;
  }
  for (let i = count - 2; i >= 1; i--) {
    const curr = pts[i];
    const next = pts[i - 1];
    if (!curr || !next) continue;
    target.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) * 0.5, (curr.y + next.y) * 0.5);
  }
  const first = pts[0];
  if (first) target.lineTo(first.x, first.y);
}

// Reusable scratch buffers for stem geometry (0 per-frame Point2D allocations)
const stemLeftPts: Point2D[] = [];
const stemRightPts: Point2D[] = [];
const stemHiPts: Point2D[] = [];
const stemShadowPts: Point2D[] = [];
const stemFiberPts: Point2D[] = [];

function ensurePointPool(pool: Point2D[], size: number): void {
  while (pool.length < size) {
    pool.push({ x: 0, y: 0 });
  }
}

function drawStem(
  ctx: CanvasRenderingContext2D,
  stem: readonly StemNode[],
  palette: SunflowerPalette,
): void {
  const n = stem.length;
  if (n < 2) return;

  ensurePointPool(stemLeftPts, n);
  ensurePointPool(stemRightPts, n);
  ensurePointPool(stemHiPts, n);
  ensurePointPool(stemShadowPts, n);
  ensurePointPool(stemFiberPts, n);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < n; i++) {
    const node = stem[i];
    if (!node) continue;
    const nx = -node.ty;
    const ny = node.tx;
    const rx = nx * node.radius;
    const ry = ny * node.radius;

    const lx = node.x - rx;
    const ly = node.y - ry;
    const rrx = node.x + rx;
    const rry = node.y + ry;

    const lp = stemLeftPts[i] as Point2D;
    lp.x = lx;
    lp.y = ly;
    const rp = stemRightPts[i] as Point2D;
    rp.x = rrx;
    rp.y = rry;
    const hp = stemHiPts[i] as Point2D;
    hp.x = node.x - rx * 0.44;
    hp.y = node.y - ry * 0.44;
    const sp = stemShadowPts[i] as Point2D;
    sp.x = node.x + rx * 0.54;
    sp.y = node.y + ry * 0.54;

    if (lx < minX) minX = lx;
    if (rrx < minX) minX = rrx;
    if (lx > maxX) maxX = lx;
    if (rrx > maxX) maxX = rrx;
    if (ly < minY) minY = ly;
    if (rry < minY) minY = rry;
    if (ly > maxY) maxY = ly;
    if (rry > maxY) maxY = rry;
  }

  const stemPath = new Path2D();
  traceSmoothSpline(stemPath, stemLeftPts, n, true);
  traceSmoothSplineReverse(stemPath, stemRightPts, n);
  stemPath.closePath();

  const firstNode = stem[0];
  const lastNode = stem[n - 1];
  const grad = ctx.createLinearGradient(
    firstNode ? firstNode.x : BLEED_X + CARD_WIDTH * 0.5,
    firstNode ? firstNode.y : BLEED_Y + 536,
    lastNode ? lastNode.x : BLEED_X + CARD_WIDTH * 0.5,
    lastNode ? lastNode.y : BLEED_Y + 120,
  );
  const darkBase = lerpRgb(palette.stemBase, palette.stemOutline, 0.24);
  grad.addColorStop(0, rgbToCss(darkBase));
  grad.addColorStop(0.55, rgbToCss(palette.stemBase));
  grad.addColorStop(1, rgbToCss(lerpRgb(palette.stemBase, palette.stemHighlight, 0.22)));

  ctx.save();
  ctx.fillStyle = grad;
  ctx.fill(stemPath);

  ctx.clip(stemPath);

  // Subtle colored-pencil grain inside stem (source-over overlay + tight bounding box, ZERO multiply!)
  const hatchPat = getHatchOverlayPattern(ctx);
  if (hatchPat) {
    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = hatchPat;
    ctx.fillRect(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
    ctx.restore();
  }

  ctx.strokeStyle = rgbToCss(lerpRgb(palette.stemHighlight, palette.paperBg, 0.22), 0.62);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  traceSmoothSpline(ctx, stemHiPts, n, true);
  ctx.lineWidth = 2.4;
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(lerpRgb(palette.stemBase, palette.stemOutline, 0.44), 0.5);
  ctx.beginPath();
  traceSmoothSpline(ctx, stemShadowPts, n, true);
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(palette.stemOutline, 0.2);
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  for (const f of [-0.36, 0.16, 0.52] as const) {
    for (let i = 0; i < n; i++) {
      const node = stem[i];
      if (!node) continue;
      const nx = -node.ty;
      const ny = node.tx;
      const fp = stemFiberPts[i] as Point2D;
      fp.x = node.x + nx * node.radius * f;
      fp.y = node.y + ny * node.radius * f;
    }
    traceSmoothSpline(ctx, stemFiberPts, n, true);
  }
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(palette.stemOutline, 0.22);
  ctx.lineWidth = 0.52;
  const hatchStep = Math.max(2, Math.floor(n / 20));
  ctx.beginPath();
  for (let i = 2; i < n - 1; i += hatchStep) {
    const node = stem[i];
    if (!node) continue;
    const nx = -node.ty;
    const ny = node.tx;
    const px = node.x + nx * node.radius * 0.08;
    const py = node.y + ny * node.radius * 0.08;
    ctx.moveTo(px, py);
    ctx.lineTo(
      px + nx * node.radius * 0.94 - node.tx * 2.5,
      py + ny * node.radius * 0.94 - node.ty * 2.5,
    );
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = rgbToCss(palette.stemOutline, 0.28);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  traceSmoothSpline(ctx, stemLeftPts, n, true);
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(palette.stemOutline, 0.42);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  traceSmoothSpline(ctx, stemRightPts, n, true);
  ctx.stroke();
  ctx.restore();
}

function buildLeafSilhouettePoints(leaf: LeafPose): {
  outline: Point2D[];
  midrib: Point2D[];
  upperSide: number;
  topScale: number;
  botScale: number;
} {
  const L = leaf.length;
  const W = leaf.width;
  const curl = leaf.curl;
  const turgor = leaf.turgor;
  const sideSign = leaf.side;
  const upperSide = sideSign === 1 ? -1 : 1;

  const absTwist = Math.abs(leaf.twist);
  const profileSquash = smoothstep(0.18, 0.42, absTwist) * 0.36;
  const topScale = lerp(1 - profileSquash, 0.56, curl * 0.65);
  const botScale = lerp(1 + profileSquash * 0.22, 0.62, curl * 0.55);
  const archBow = (absTwist * 0.14 + leaf.droop * 0.1) * L * -upperSide;
  const cordate = 1 - curl;

  const samples = 18;
  const upperPts: Point2D[] = [];
  const lowerPts: Point2D[] = [];
  const midrib: Point2D[] = [];

  for (let i = 0; i <= samples; i++) {
    const s = i / samples;
    const tipEnv = Math.sin(s * Math.PI);
    const curlWave = curl * tipEnv * Math.sin(s * 9.5 + leaf.id * 1.4) * 2.0;
    const midY = Math.sin(s * Math.PI) * archBow * (0.45 + 0.55 * s) + curlWave;
    midrib.push({ x: s * L, y: midY });
  }

  for (let i = 0; i <= samples; i++) {
    const s = i / samples;
    const midY = midrib[i]?.y ?? 0;

    if (i === 0) {
      upperPts.push({ x: 0, y: midY });
      lowerPts.push({ x: 0, y: midY });
      continue;
    }
    if (i === samples) {
      upperPts.push({ x: L, y: midY });
      lowerPts.push({ x: L, y: midY });
      continue;
    }

    const lobePhase = clamp01(s / 0.32);
    const lobeBack = Math.sin(lobePhase * Math.PI) * (1 - lobePhase) ** 0.72 * 0.25 * L * cordate;
    const xBase = s * L - lobeBack;

    const heartLobe = Math.sin(Math.min(1, s / 0.34) * Math.PI * 0.5) ** 0.7;
    const tipTaper = (1 - smoothstep(0.3, 1.0, s)) ** 0.86;
    const broadEnv = heartLobe * (0.28 + 0.76 * tipTaper) * Math.sin(s ** 0.52 * Math.PI);
    const wiltedEnv =
      Math.sin(s ** 0.82 * Math.PI) * (0.58 + 0.22 * Math.sin(s * 9 + leaf.id * 1.9));
    const baseHalf = lerp(broadEnv * 1.08, wiltedEnv, curl) * W * 0.58;

    const tipMask = Math.sin(s * Math.PI) ** 1.15;
    const lushTooth =
      (0.048 * Math.sin(s * Math.PI * 11 + leaf.id * 0.7) + 0.018 * Math.sin(s * Math.PI * 21)) *
      cordate;
    const wiltedPinch = 0.1 * curl * Math.sin(s * 13 + leaf.id * 2.1);
    const serration = (lushTooth + wiltedPinch) * W * tipMask;

    const crinkleU = curl * tipMask * (0.65 + 0.35 * Math.sin(s * 11 + leaf.id)) * 1.1;
    const crinkleD = curl * tipMask * (0.65 + 0.35 * Math.cos(s * 10 + leaf.id * 1.7)) * 1.1;

    const minHalf = 0.55 * tipMask + 0.25;
    const halfU = Math.max(minHalf, (baseHalf + serration) * topScale + crinkleU);
    const halfD = Math.max(minHalf, (baseHalf + serration) * botScale + crinkleD);

    upperPts.push({
      x: xBase,
      y: midY + upperSide * halfU,
    });
    lowerPts.push({
      x: xBase,
      y: midY - upperSide * halfD,
    });
  }

  const lastUpper = upperPts[samples];
  const lastMid = midrib[samples];
  if (lastUpper && lastMid) {
    const tipCurlY = curl * sideSign * lerp(4.8, 0.8, turgor);
    lastUpper.y += tipCurlY;
    lastMid.y += tipCurlY;
    const lastLower = lowerPts[samples];
    if (lastLower) lastLower.y += tipCurlY;
  }

  const outline: Point2D[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = upperPts[i];
    if (p) outline.push(p);
  }
  for (let i = samples - 1; i >= 1; i--) {
    const p = lowerPts[i];
    if (p) outline.push(p);
  }

  return { outline, midrib, upperSide, topScale, botScale };
}

function buildLeafPath(points: readonly Point2D[]): Path2D {
  const path = new Path2D();
  const first = points[0];
  if (!first) return path;
  path.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    const mx = (prev.x + curr.x) * 0.5;
    const my = (prev.y + curr.y) * 0.5;
    path.quadraticCurveTo(prev.x, prev.y, mx, my);
  }
  const last = points[points.length - 1];
  if (last) path.quadraticCurveTo(last.x, last.y, first.x, first.y);
  path.closePath();
  return path;
}

interface LeafSpriteEntry {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bladePath: Path2D | null;
  originX: number;
  originY: number;
  cssW: number;
  cssH: number;
  pixW: number;
  pixH: number;
  dpr: number;
  length: number;
  width: number;
  curl: number;
  turgor: number;
  twist: number;
  vitality: number;
  colorMix: number;
  baked: boolean;
}

const leafCacheByState = new WeakMap<SunflowerSimState, Map<number, LeafSpriteEntry>>();

export function releaseLeafSpriteCache(state: SunflowerSimState): void {
  const map = leafCacheByState.get(state);
  if (!map) return;
  for (const entry of map.values()) {
    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.baked = false;
  }
  map.clear();
  leafCacheByState.delete(state);
}

function getLeafSpriteEntry(state: SunflowerSimState, leafId: number): LeafSpriteEntry | null {
  if (typeof document === "undefined") return null;
  let map = leafCacheByState.get(state);
  if (!map) {
    map = new Map<number, LeafSpriteEntry>();
    leafCacheByState.set(state, map);
  }
  let entry = map.get(leafId);
  if (!entry) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    entry = {
      canvas,
      ctx,
      bladePath: null,
      originX: 0,
      originY: 0,
      cssW: 0,
      cssH: 0,
      pixW: 0,
      pixH: 0,
      dpr: 0,
      length: 0,
      width: 0,
      curl: 0,
      turgor: 0,
      twist: 0,
      vitality: 0,
      colorMix: 0,
      baked: false,
    };
    map.set(leafId, entry);
  }
  return entry;
}

function paintLeafBladeLocal(
  ctx: CanvasRenderingContext2D,
  leaf: LeafPose,
  bladePath: Path2D,
  midrib: readonly Point2D[],
  upperSide: number,
  topScale: number,
  botScale: number,
  palette: SunflowerPalette,
  vitality: number,
): void {
  const leafVitality = clamp01(vitality * 0.32 + leaf.turgor * 0.68);
  const wiltedOliveBias = leaf.id % 3 === 1 ? (1 - leafVitality) * 0.46 : 0;
  const oliveWilted: RGB = { r: 82, g: 88, b: 56 };
  const chestnutWilted: RGB = { r: 134, g: 102, b: 68 };
  const deepForestMoss: RGB = { r: 38, g: 76, b: 32 };
  const sunlitChartreuse: RGB = { r: 186, g: 208, b: 96 };

  let baseCol = lerpRgb(palette.leafBase, palette.leafHighlight, (leaf.colorMix - 0.5) * 0.34);
  let shadowCol = lerpRgb(palette.leafShadow, deepForestMoss, leafVitality * 0.55);
  const hiCol = lerpRgb(palette.leafHighlight, sunlitChartreuse, leafVitality * 0.48);

  if (leafVitality < 0.62) {
    const dryWeight = 1 - leafVitality / 0.62;
    if (wiltedOliveBias > 0.05) {
      baseCol = lerpRgb(baseCol, oliveWilted, wiltedOliveBias * 1.05);
      shadowCol = lerpRgb(shadowCol, { r: 50, g: 56, b: 34 }, wiltedOliveBias);
    } else if (leaf.id % 2 === 0) {
      baseCol = lerpRgb(baseCol, chestnutWilted, dryWeight * 0.42);
    } else {
      baseCol = lerpRgb(baseCol, lerpRgb(oliveWilted, chestnutWilted, 0.55), dryWeight * 0.32);
    }
  }

  const leafGrad = ctx.createLinearGradient(
    -leaf.length * 0.08,
    -upperSide * leaf.width * 0.46,
    leaf.length * 0.96,
    upperSide * leaf.width * 0.42,
  );
  leafGrad.addColorStop(0, rgbToCss(lerpRgb(baseCol, shadowCol, 0.52)));
  leafGrad.addColorStop(0.38, rgbToCss(baseCol));
  leafGrad.addColorStop(0.76, rgbToCss(lerpRgb(baseCol, hiCol, 0.52)));
  leafGrad.addColorStop(1, rgbToCss(lerpRgb(hiCol, palette.paperBg, 0.08)));

  ctx.fillStyle = leafGrad;
  ctx.fill(bladePath);

  ctx.save();
  ctx.clip(bladePath);

  // Local-space colored-pencil hatch grain (source-over overlay, ZERO multiply!)
  const hatchPat = getHatchOverlayPattern(ctx);
  if (hatchPat) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = hatchPat;
    ctx.fillRect(-leaf.length * 0.35, -leaf.width * 0.85, leaf.length * 1.45, leaf.width * 1.7);
    ctx.restore();
  }

  const lowerShadowGrad = ctx.createLinearGradient(0, 0, 0, -upperSide * leaf.width * 0.58);
  lowerShadowGrad.addColorStop(0, rgbToCss(shadowCol, lerp(0.46, 0.44, vitality)));
  lowerShadowGrad.addColorStop(0.65, rgbToCss(shadowCol, lerp(0.34, 0.28, vitality)));
  lowerShadowGrad.addColorStop(1, rgbToCss(shadowCol, lerp(0.18, 0.14, vitality)));
  ctx.fillStyle = lowerShadowGrad;
  ctx.beginPath();
  const m0 = midrib[0];
  if (m0) ctx.moveTo(m0.x - 12, m0.y);
  for (let i = 1; i < midrib.length; i++) {
    const m = midrib[i];
    if (m) ctx.lineTo(m.x, m.y);
  }
  ctx.lineTo(leaf.length + 14, -upperSide * leaf.width);
  ctx.lineTo(-18, -upperSide * leaf.width);
  ctx.closePath();
  ctx.fill();

  const cleftGrad = ctx.createRadialGradient(
    leaf.length * 0.04,
    0,
    1,
    leaf.length * 0.06,
    0,
    leaf.length * 0.34,
  );
  cleftGrad.addColorStop(
    0,
    rgbToCss(lerpRgb(shadowCol, palette.outlineInk, 0.25), lerp(0.44, 0.48, vitality)),
  );
  cleftGrad.addColorStop(0.55, rgbToCss(shadowCol, 0.18));
  cleftGrad.addColorStop(1, rgbToCss(shadowCol, 0));
  ctx.fillStyle = cleftGrad;
  ctx.fillRect(-leaf.length * 0.3, -leaf.width, leaf.length * 0.8, leaf.width * 2);

  const blushGrad = ctx.createRadialGradient(
    leaf.length * 0.4,
    upperSide * leaf.width * 0.24,
    2,
    leaf.length * 0.4,
    upperSide * leaf.width * 0.22,
    leaf.length * 0.48,
  );
  blushGrad.addColorStop(
    0,
    rgbToCss(lerpRgb(hiCol, palette.paperBg, 0.22), lerp(0.24, 0.46, vitality)),
  );
  blushGrad.addColorStop(0.6, rgbToCss(hiCol, lerp(0.12, 0.22, vitality)));
  blushGrad.addColorStop(1, rgbToCss(hiCol, 0));
  ctx.fillStyle = blushGrad;
  ctx.fillRect(-leaf.length * 0.3, -leaf.width, leaf.length * 1.4, leaf.width * 2);

  const hatchCount = 30;
  ctx.lineCap = "round";

  for (const strongPass of [false, true] as const) {
    ctx.strokeStyle = rgbToCss(
      shadowCol,
      strongPass ? lerp(0.32, 0.38, vitality) : lerp(0.2, 0.24, vitality),
    );
    ctx.lineWidth = strongPass ? 0.8 : 0.58;
    ctx.beginPath();
    for (let h = 1; h < hatchCount; h++) {
      if ((h % 3 === 0) !== strongPass) continue;
      const t = h / hatchCount;
      const idx = Math.min(midrib.length - 1, Math.floor(t * (midrib.length - 1)));
      const mp = midrib[idx];
      if (!mp) continue;

      const span = leaf.width * (0.52 * Math.sin(t ** 0.76 * Math.PI) + 0.12);
      const sweepFwd = span * 0.44;
      ctx.moveTo(mp.x - 0.5, mp.y);
      ctx.quadraticCurveTo(
        mp.x + sweepFwd * 0.48,
        mp.y - upperSide * span * 0.56,
        mp.x + sweepFwd,
        mp.y - upperSide * span * 0.96,
      );
    }
    ctx.stroke();
  }

  for (const evenPass of [true, false] as const) {
    ctx.strokeStyle = evenPass
      ? rgbToCss(lerpRgb(hiCol, palette.paperBg, 0.18), lerp(0.24, 0.34, vitality))
      : rgbToCss(lerpRgb(baseCol, shadowCol, 0.42), 0.16);
    ctx.lineWidth = evenPass ? 0.68 : 0.52;
    ctx.beginPath();
    for (let h = 1; h < hatchCount; h++) {
      if ((h % 2 === 0) !== evenPass) continue;
      const t = h / hatchCount;
      const idx = Math.min(midrib.length - 1, Math.floor(t * (midrib.length - 1)));
      const mp = midrib[idx];
      if (!mp) continue;

      const span = leaf.width * (0.52 * Math.sin(t ** 0.76 * Math.PI) + 0.12);
      const sweepFwd = span * 0.44;
      ctx.moveTo(mp.x + 0.8, mp.y);
      ctx.quadraticCurveTo(
        mp.x + sweepFwd * 0.45,
        mp.y + upperSide * span * 0.52,
        mp.x + sweepFwd * 0.92,
        mp.y + upperSide * span * 0.92,
      );
    }
    ctx.stroke();
  }

  ctx.strokeStyle = rgbToCss(shadowCol, 0.24);
  ctx.lineWidth = 0.52;
  ctx.beginPath();
  for (let c = 0; c < 6; c++) {
    const cx0 = -leaf.length * 0.06 + c * (leaf.length * 0.055);
    ctx.moveTo(cx0, upperSide * leaf.width * 0.14);
    ctx.lineTo(cx0 + leaf.length * 0.08, -upperSide * leaf.width * 0.34);
  }
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(shadowCol, 0.42);
  ctx.lineWidth = lerp(1.1, 2.0, leaf.turgor);
  ctx.lineCap = "round";
  ctx.beginPath();
  traceSmoothSpline(ctx, midrib, midrib.length, true, -upperSide * 0.8);
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(
    lerpRgb(palette.leafVein, palette.paperBg, 0.24 * vitality),
    lerp(0.68, 0.88, vitality),
  );
  ctx.lineWidth = lerp(0.75, 1.35, leaf.turgor);
  ctx.beginPath();
  traceSmoothSpline(ctx, midrib, midrib.length, true);
  ctx.stroke();

  const cordate = 1 - leaf.curl;
  if (cordate > 0.2 && m0) {
    ctx.strokeStyle = rgbToCss(shadowCol, 0.24);
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (const dir of [-1, 1] as const) {
      const lobeScale = dir === upperSide ? topScale : botScale;
      ctx.moveTo(m0.x + 2, m0.y + 0.6);
      ctx.quadraticCurveTo(
        -leaf.length * 0.04 * cordate,
        dir * leaf.width * 0.26 * lobeScale + 0.6,
        leaf.length * 0.15,
        dir * leaf.width * 0.4 * lobeScale + 0.6,
      );
    }
    ctx.stroke();

    ctx.strokeStyle = rgbToCss(lerpRgb(palette.leafVein, hiCol, 0.35), 0.56);
    ctx.lineWidth = 0.58;
    ctx.beginPath();
    for (const dir of [-1, 1] as const) {
      const lobeScale = dir === upperSide ? topScale : botScale;
      ctx.moveTo(m0.x + 2, m0.y);
      ctx.quadraticCurveTo(
        -leaf.length * 0.04 * cordate,
        dir * leaf.width * 0.26 * lobeScale,
        leaf.length * 0.15,
        dir * leaf.width * 0.4 * lobeScale,
      );
    }
    ctx.stroke();
  }

  const veinCount = 5;
  for (const shadowPass of [true, false] as const) {
    ctx.strokeStyle = shadowPass
      ? rgbToCss(shadowCol, 0.22)
      : rgbToCss(lerpRgb(palette.leafVein, hiCol, 0.25), 0.54);
    ctx.lineWidth = shadowPass ? 0.7 : 0.56;
    const dy = shadowPass ? 0.55 : 0;
    ctx.beginPath();
    for (let v = 1; v <= veinCount; v++) {
      const frac = v / (veinCount + 1);
      const idx = Math.min(midrib.length - 1, Math.floor(frac * (midrib.length - 1)));
      const mp = midrib[idx];
      if (!mp) continue;
      const reach = leaf.width * 0.44 * Math.sin(frac ** 0.72 * Math.PI);
      const fwd = leaf.length * (0.14 + 0.05 * (1 - frac));

      for (const dir of [-1, 1] as const) {
        const scaleDir = dir === upperSide ? topScale : botScale;
        const ex = mp.x + fwd;
        const ey = mp.y + dir * reach * scaleDir;
        const qx = mp.x + fwd * 0.44;
        const qy = mp.y + dir * reach * scaleDir * 0.72;
        ctx.moveTo(mp.x, mp.y + dy);
        ctx.quadraticCurveTo(qx, qy + dy, ex, ey + dy);
      }
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = rgbToCss(lerpRgb(palette.outlineInk, shadowCol, 0.48), 0.42);
  ctx.lineWidth = 0.68;
  ctx.lineJoin = "round";
  ctx.stroke(bladePath);
}

function getLeafDirtyScore(
  entry: LeafSpriteEntry,
  leaf: LeafPose,
  vitality: number,
  dpr: number,
  fastScrub: boolean,
): number {
  if (!entry.baked || entry.dpr !== dpr) return 1000;
  const lenTol = fastScrub ? 1.8 : 0.6;
  const widTol = fastScrub ? 1.8 : 0.6;
  const valTol = fastScrub ? 0.045 : 0.016;
  const score = Math.max(
    Math.abs(leaf.length - entry.length) / lenTol,
    Math.abs(leaf.width - entry.width) / widTol,
    Math.abs(leaf.curl - entry.curl) / valTol,
    Math.abs(leaf.turgor - entry.turgor) / valTol,
    Math.abs(vitality - entry.vitality) / valTol,
    Math.abs(leaf.twist - entry.twist) / (valTol * 1.4),
  );
  return score >= 1 ? score : 0;
}

function bakeLeafSprite(
  entry: LeafSpriteEntry,
  leaf: LeafPose,
  palette: SunflowerPalette,
  vitality: number,
  dpr: number,
): void {
  const { outline, midrib, upperSide, topScale, botScale } = buildLeafSilhouettePoints(leaf);
  const bladePath = buildLeafPath(outline);

  const originX = Math.ceil(leaf.length * 0.28 + 10);
  const originY = Math.ceil(leaf.width * 0.72 + leaf.length * 0.18 + 14);
  const cssW = originX + Math.ceil(leaf.length + 12);
  const cssH = originY * 2;
  const pixW = Math.ceil(cssW * dpr);
  const pixH = Math.ceil(cssH * dpr);

  // Grow-only bucketed backing store avoids GPU texture reallocation while scrubbing
  if (entry.canvas.width < pixW || entry.canvas.height < pixH) {
    entry.canvas.width = Math.max(entry.canvas.width, Math.ceil(pixW / 64) * 64);
    entry.canvas.height = Math.max(entry.canvas.height, Math.ceil(pixH / 64) * 64);
  } else {
    entry.ctx.setTransform(1, 0, 0, 1, 0, 0);
    entry.ctx.clearRect(0, 0, Math.max(pixW, entry.pixW), Math.max(pixH, entry.pixH));
  }

  const lctx = entry.ctx;
  lctx.save();
  lctx.setTransform(dpr, 0, 0, dpr, originX * dpr, originY * dpr);
  paintLeafBladeLocal(
    lctx,
    leaf,
    bladePath,
    midrib,
    upperSide,
    topScale,
    botScale,
    palette,
    vitality,
  );
  lctx.restore();

  entry.bladePath = bladePath;
  entry.originX = originX;
  entry.originY = originY;
  entry.cssW = cssW;
  entry.cssH = cssH;
  entry.pixW = pixW;
  entry.pixH = pixH;
  entry.dpr = dpr;
  entry.length = leaf.length;
  entry.width = leaf.width;
  entry.curl = leaf.curl;
  entry.turgor = leaf.turgor;
  entry.twist = leaf.twist;
  entry.vitality = vitality;
  entry.colorMix = leaf.colorMix;
  entry.baked = true;
}

function refreshLeafSprites(
  state: SunflowerSimState,
  palette: SunflowerPalette,
  vitality: number,
  dpr: number,
): void {
  const { leaves } = state;
  const fastScrub = state.dragging || Math.abs(state.valueVelocity) > 2;
  const maxBakes = fastScrub ? 4 : leaves.length;

  // Always bake any unbaked leaves immediately; budget incremental updates during rapid scrubbing
  const dirty: { leaf: LeafPose; entry: LeafSpriteEntry; score: number }[] = [];
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    if (!leaf) continue;
    const entry = getLeafSpriteEntry(state, leaf.id);
    if (!entry) continue;
    const score = getLeafDirtyScore(entry, leaf, vitality, dpr, fastScrub);
    if (score > 0) {
      dirty.push({ leaf, entry, score });
    }
  }

  if (dirty.length === 0) return;
  if (dirty.length > maxBakes) {
    dirty.sort((a, b) => b.score - a.score);
  }

  let bakesDone = 0;
  for (let i = 0; i < dirty.length; i++) {
    const item = dirty[i];
    if (!item) continue;
    if (bakesDone >= maxBakes && item.entry.baked) break;
    bakeLeafSprite(item.entry, item.leaf, palette, vitality, dpr);
    bakesDone++;
  }
}

function drawOutsideLeafShadows(
  ctx: CanvasRenderingContext2D,
  state: SunflowerSimState,
  cardPath: Path2D,
): void {
  const { leaves } = state;
  let anyNearOutside = false;
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    if (!leaf) continue;
    if (
      Math.min(leaf.tip.x, leaf.petioleEnd.x) < BLEED_X + 14 ||
      Math.max(leaf.tip.x, leaf.petioleEnd.x) > BLEED_X + CARD_WIDTH - 14 ||
      Math.min(leaf.tip.y, leaf.petioleEnd.y) < BLEED_Y + 14
    ) {
      anyNearOutside = true;
      break;
    }
  }
  if (!anyNearOutside) return;

  // Single evenodd clip + 2 soft layered fills (ZERO shadowBlur passes!)
  ctx.save();
  ctx.clip(getOutsideCardPath(cardPath), "evenodd");

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    if (!leaf) continue;
    const nearOutside =
      Math.min(leaf.tip.x, leaf.petioleEnd.x) < BLEED_X + 14 ||
      Math.max(leaf.tip.x, leaf.petioleEnd.x) > BLEED_X + CARD_WIDTH - 14 ||
      Math.min(leaf.tip.y, leaf.petioleEnd.y) < BLEED_Y + 14;
    if (!nearOutside) continue;

    const entry = getLeafSpriteEntry(state, leaf.id);
    const bladePath = entry?.bladePath;
    if (!bladePath || !entry) continue;

    const sx = entry.length > 0.1 ? leaf.length / entry.length : 1;
    const sy = entry.width > 0.1 ? leaf.width / entry.width : 1;

    ctx.save();
    ctx.translate(leaf.petioleEnd.x + 2, leaf.petioleEnd.y + 3.5);
    ctx.rotate(leaf.angle);
    ctx.scale(sx * 1.04, sy * 1.06);
    ctx.fillStyle = "rgba(72, 62, 48, 0.042)";
    ctx.fill(bladePath);
    ctx.scale(0.96, 0.94);
    ctx.fillStyle = "rgba(72, 62, 48, 0.055)";
    ctx.fill(bladePath);
    ctx.restore();
  }

  ctx.restore();
}

function drawBatchedPetioles(
  ctx: CanvasRenderingContext2D,
  leaves: readonly LeafPose[],
  palette: SunflowerPalette,
  vitality: number,
): void {
  if (leaves.length === 0) return;

  const petW = lerp(1.3, 2.4, vitality);
  ctx.lineCap = "round";

  const shadowPath = new Path2D();
  const bodyPath = new Path2D();
  const hiPath = new Path2D();

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    if (!leaf) continue;
    const midPetX = (leaf.attach.x + leaf.petioleEnd.x) * 0.5;
    const midPetY = (leaf.attach.y + leaf.petioleEnd.y) * 0.5 + lerp(-6.2, -4.0, leaf.turgor);

    shadowPath.moveTo(leaf.attach.x, leaf.attach.y + 0.5);
    shadowPath.quadraticCurveTo(midPetX, midPetY + 0.6, leaf.petioleEnd.x, leaf.petioleEnd.y + 0.4);

    bodyPath.moveTo(leaf.attach.x, leaf.attach.y);
    bodyPath.quadraticCurveTo(midPetX, midPetY, leaf.petioleEnd.x, leaf.petioleEnd.y);

    hiPath.moveTo(leaf.attach.x, leaf.attach.y - 0.4);
    hiPath.quadraticCurveTo(midPetX, midPetY - 0.5, leaf.petioleEnd.x, leaf.petioleEnd.y - 0.3);
  }

  ctx.strokeStyle = rgbToCss(palette.stemOutline, 0.38);
  ctx.lineWidth = petW + 0.7;
  ctx.stroke(shadowPath);

  ctx.strokeStyle = rgbToCss(lerpRgb(palette.stemBase, palette.leafBase, 0.38), 0.94);
  ctx.lineWidth = petW;
  ctx.stroke(bodyPath);

  ctx.strokeStyle = rgbToCss(palette.stemHighlight, 0.55);
  ctx.lineWidth = Math.max(0.55, petW * 0.38);
  ctx.stroke(hiPath);
}

function drawLeafFromCache(
  ctx: CanvasRenderingContext2D,
  state: SunflowerSimState,
  leaf: LeafPose,
  palette: SunflowerPalette,
  vitality: number,
): void {
  const entry = getLeafSpriteEntry(state, leaf.id);
  if (entry?.baked) {
    const sx = entry.length > 0.1 ? leaf.length / entry.length : 1;
    const sy = entry.width > 0.1 ? leaf.width / entry.width : 1;

    ctx.save();
    ctx.translate(leaf.petioleEnd.x, leaf.petioleEnd.y);
    ctx.rotate(leaf.angle);
    if (Math.abs(sx - 1) > 0.004 || Math.abs(sy - 1) > 0.004) {
      ctx.scale(sx, sy);
    }
    ctx.drawImage(
      entry.canvas,
      0,
      0,
      entry.pixW,
      entry.pixH,
      -entry.originX,
      -entry.originY,
      entry.cssW,
      entry.cssH,
    );
    ctx.restore();
    return;
  }

  // Fallback for non-DOM environments
  const { outline, midrib, upperSide, topScale, botScale } = buildLeafSilhouettePoints(leaf);
  const bladePath = buildLeafPath(outline);
  ctx.save();
  ctx.translate(leaf.petioleEnd.x, leaf.petioleEnd.y);
  ctx.rotate(leaf.angle);
  paintLeafBladeLocal(
    ctx,
    leaf,
    bladePath,
    midrib,
    upperSide,
    topScale,
    botScale,
    palette,
    vitality,
  );
  ctx.restore();
}

interface HeadProjection {
  cx: number;
  cy: number;
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

function createHeadProjection(head: HeadPose): HeadProjection {
  const alpha = -head.pitch;
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);
  const cosY = Math.cos(head.yaw);
  const sinY = Math.sin(head.yaw);
  const cosR = Math.cos(head.roll);
  const sinR = Math.sin(head.roll);

  // Composition of pitch (X), yaw (Y), roll (Z) matching original projectHeadPoint identically:
  // y1 = py*cosA + pz*sinA; z1 = -py*sinA + pz*cosA
  // x2 = px*cosY + z1*sinY
  // x = cx + x2*cosR - y1*sinR
  // y = cy + x2*sinR + y1*cosR
  const x2x = cosY;
  const x2y = -sinA * sinY;
  const x2z = cosA * sinY;

  return {
    cx: head.center.x,
    cy: head.center.y,
    m00: x2x * cosR,
    m01: x2y * cosR - cosA * sinR,
    m02: x2z * cosR - sinA * sinR,
    m10: x2x * sinR,
    m11: x2y * sinR + cosA * cosR,
    m12: x2z * sinR + sinA * cosR,
  };
}

function projX(p: HeadProjection, x: number, y: number, z: number): number {
  return p.cx + p.m00 * x + p.m01 * y + p.m02 * z;
}

function projY(p: HeadProjection, x: number, y: number, z: number): number {
  return p.cy + p.m10 * x + p.m11 * y + p.m12 * z;
}

function drawCalyxCup(
  ctx: CanvasRenderingContext2D,
  head: HeadPose,
  stem: readonly StemNode[],
  proj: HeadProjection,
  palette: SunflowerPalette,
): void {
  const alpha = -head.pitch;
  const cupVisibility = smoothstep(0.06, 0.28, alpha);
  if (cupVisibility <= 0.01) return;

  const r = head.diskRadius * 1.06;
  const rimZ = 0.6;
  const backApexX = projX(proj, 0, 0, -head.diskRadius * 0.94);
  const backApexY = projY(proj, 0, 0, -head.diskRadius * 0.94);
  const neckPt = head.neck;

  const leftRimX = projX(proj, -r, 0, rimZ);
  const leftRimY = projY(proj, -r, 0, rimZ);
  const rightRimX = projX(proj, r, 0, rimZ);
  const rightRimY = projY(proj, r, 0, rimZ);
  const frontRimX = projX(proj, 0, -r * 0.94, rimZ + 0.5);
  const frontRimY = projY(proj, 0, -r * 0.94, rimZ + 0.5);

  // Overlap the calyx collar 1.5px back along the stem tip so the stalk flares seamlessly with zero gap or protrusion
  const n = stem.length;
  const tipNode = n >= 1 ? stem[n - 1] : undefined;

  const rawTx = tipNode ? tipNode.tx : 0;
  const rawTy = tipNode ? tipNode.ty : 1;
  const tLen = Math.hypot(rawTx, rawTy) || 1;
  const tx = rawTx / tLen;
  const ty = rawTy / tLen;
  const nx = -ty;
  const ny = tx;
  const collarR = tipNode ? tipNode.radius : 2.2;
  const collarX = (tipNode ? tipNode.x : neckPt.x) - tx * 1.5;
  const collarY = (tipNode ? tipNode.y : neckPt.y) - ty * 1.5;

  // Exact left/right edges of the stem at the collar (matching drawStem's leftPts / rightPts)
  const edgeAx = collarX - nx * collarR;
  const edgeAy = collarY - ny * collarR;
  const edgeBx = collarX + nx * collarR;
  const edgeBy = collarY + ny * collarR;

  // Minimum-distance pairing guarantees non-crossing connection across all 360deg stem angles
  const pairAB =
    Math.hypot(edgeAx - leftRimX, edgeAy - leftRimY) +
    Math.hypot(edgeBx - rightRimX, edgeBy - rightRimY);
  const pairBA =
    Math.hypot(edgeBx - leftRimX, edgeBy - leftRimY) +
    Math.hypot(edgeAx - rightRimX, edgeAy - rightRimY);

  const aIsLeft = pairAB <= pairBA;
  const collarLx = aIsLeft ? edgeAx : edgeBx;
  const collarLy = aIsLeft ? edgeAy : edgeBy;
  const collarRx = aIsLeft ? edgeBx : edgeAx;
  const collarRy = aIsLeft ? edgeBy : edgeAy;

  const distL = Math.hypot(leftRimX - collarLx, leftRimY - collarLy) || 1;
  const distR = Math.hypot(rightRimX - collarRx, rightRimY - collarRy) || 1;
  const alignL = clamp01(((leftRimX - collarLx) * tx + (leftRimY - collarLy) * ty) / distL);
  const alignR = clamp01(((rightRimX - collarRx) * tx + (rightRimY - collarRy) * ty) / distR);
  const handleL = Math.min(10, Math.max(3, distL * lerp(0.15, 0.26, alignL)));
  const handleR = Math.min(10, Math.max(3, distR * lerp(0.15, 0.26, alignR)));

  // C1-continuous cubic Bézier curves leaving the stem edges strictly along the stem tangent (tx, ty)
  const cp1Lx = collarLx + tx * handleL;
  const cp1Ly = collarLy + ty * handleL;
  const cp2Lx = lerp(leftRimX, backApexX, 0.48);
  const cp2Ly = lerp(leftRimY, backApexY, 0.72);

  const cp1Rx = collarRx + tx * handleR;
  const cp1Ry = collarRy + ty * handleR;
  const cp2Rx = lerp(rightRimX, backApexX, 0.48);
  const cp2Ry = lerp(rightRimY, backApexY, 0.72);

  const cupPath = new Path2D();
  cupPath.moveTo(collarLx, collarLy);
  cupPath.bezierCurveTo(cp1Lx, cp1Ly, cp2Lx, cp2Ly, leftRimX, leftRimY);
  cupPath.quadraticCurveTo(frontRimX, frontRimY + 1.5, rightRimX, rightRimY);
  cupPath.bezierCurveTo(cp2Rx, cp2Ry, cp1Rx, cp1Ry, collarRx, collarRy);
  cupPath.closePath();

  // Gradient starts at the exact stem-tip fill tone so the stem merges seamlessly into the calyx
  const cupGrad = ctx.createLinearGradient(collarX, collarY, frontRimX, frontRimY + 6);
  cupGrad.addColorStop(0, rgbToCss(lerpRgb(palette.stemBase, palette.stemHighlight, 0.2)));
  cupGrad.addColorStop(0.28, rgbToCss(lerpRgb(palette.stemBase, palette.sepalFill, 0.48)));
  cupGrad.addColorStop(0.64, rgbToCss(palette.sepalFill));
  cupGrad.addColorStop(1, rgbToCss(lerpRgb(palette.sepalFill, palette.outlineInk, 0.3)));

  ctx.save();
  ctx.globalAlpha = cupVisibility;
  ctx.fillStyle = cupGrad;
  ctx.fill(cupPath);

  ctx.save();
  ctx.clip(cupPath);

  // Continue the same colored-pencil grain texture unbroken from stem into calyx
  const hatchPat = getHatchOverlayPattern(ctx);
  if (hatchPat) {
    const minX = Math.min(leftRimX, rightRimX, collarLx, collarRx) - 2;
    const maxX = Math.max(leftRimX, rightRimX, collarLx, collarRx) + 2;
    const minY = Math.min(leftRimY, rightRimY, collarLy, collarRy, backApexY) - 2;
    const maxY = Math.max(leftRimY, rightRimY, frontRimY + 4) + 2;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = hatchPat;
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    ctx.restore();
  }

  // Soft sunlit ridge continuing unbroken from stem's highlight flank onto the calyx shoulder
  const hiStartX = collarX - nx * collarR * 0.44;
  const hiStartY = collarY - ny * collarR * 0.44;
  const hiRimX = aIsLeft ? leftRimX + 4 : rightRimX - 4;
  const hiRimY = aIsLeft ? leftRimY : rightRimY;
  const hiCp1X = hiStartX + tx * (aIsLeft ? handleL : handleR) * 0.9;
  const hiCp1Y = hiStartY + ty * (aIsLeft ? handleL : handleR) * 0.9;
  const hiCp2X = lerp(hiRimX, backApexX, 0.54);
  const hiCp2Y = lerp(hiRimY, backApexY, 0.72);

  ctx.lineCap = "round";
  ctx.strokeStyle = rgbToCss(lerpRgb(palette.stemHighlight, palette.paperBg, 0.2), 0.46);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(hiStartX, hiStartY);
  ctx.bezierCurveTo(hiCp1X, hiCp1Y, hiCp2X, hiCp2Y, hiRimX, hiRimY);
  ctx.stroke();

  // Matching shaded flank continuing unbroken from stem's shadow side onto the opposite shoulder
  const shStartX = collarX + nx * collarR * 0.54;
  const shStartY = collarY + ny * collarR * 0.54;
  const shRimX = aIsLeft ? rightRimX - 3 : leftRimX + 3;
  const shRimY = aIsLeft ? rightRimY : leftRimY;
  const shCp1X = shStartX + tx * (aIsLeft ? handleR : handleL) * 0.9;
  const shCp1Y = shStartY + ty * (aIsLeft ? handleR : handleL) * 0.9;
  const shCp2X = lerp(shRimX, backApexX, 0.54);
  const shCp2Y = lerp(shRimY, backApexY, 0.72);

  ctx.strokeStyle = rgbToCss(lerpRgb(palette.stemBase, palette.stemOutline, 0.44), 0.36);
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(shStartX, shStartY);
  ctx.bezierCurveTo(shCp1X, shCp1Y, shCp2X, shCp2Y, shRimX, shRimY);
  ctx.stroke();

  // Delicate radiating calyx ribs fading softly in below the neck flare
  const ribStartX = lerp(collarX, backApexX, 0.55);
  const ribStartY = lerp(collarY, backApexY, 0.55);
  ctx.strokeStyle = rgbToCss(palette.outlineInk, 0.2);
  ctx.lineWidth = 0.56;
  ctx.beginPath();
  for (let i = -4; i <= 4; i++) {
    const ox = i * 4.4;
    ctx.moveTo(ribStartX + ox * 0.34, ribStartY + 1);
    ctx.quadraticCurveTo(
      backApexX + ox * 0.72,
      (ribStartY + frontRimY) * 0.52,
      frontRimX + ox * 1.1,
      frontRimY + 4,
    );
  }
  ctx.stroke();
  ctx.restore();

  // Stroke ONLY the two continuous flared outer edges (never across the stem collar!)
  ctx.lineCap = "round";
  ctx.strokeStyle = rgbToCss(palette.stemOutline, aIsLeft ? 0.3 : 0.42);
  ctx.lineWidth = aIsLeft ? 0.62 : 0.7;
  ctx.beginPath();
  ctx.moveTo(collarLx, collarLy);
  ctx.bezierCurveTo(cp1Lx, cp1Ly, cp2Lx, cp2Ly, leftRimX, leftRimY);
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(palette.stemOutline, aIsLeft ? 0.42 : 0.3);
  ctx.lineWidth = aIsLeft ? 0.7 : 0.62;
  ctx.beginPath();
  ctx.moveTo(collarRx, collarRy);
  ctx.bezierCurveTo(cp1Rx, cp1Ry, cp2Rx, cp2Ry, rightRimX, rightRimY);
  ctx.stroke();
  ctx.restore();
}

const BRACT_ANGLES = [Math.PI * 0.92, Math.PI * 0.08, Math.PI * 0.82, Math.PI * 0.18] as const;
const BRACT_COS = BRACT_ANGLES.map((a) => Math.cos(a));
const BRACT_SIN = BRACT_ANGLES.map((a) => Math.sin(a));
const BRACT_LENGTHS = [1.24, 1.18, 0.94, 0.92] as const;

function drawCradleBracts(
  ctx: CanvasRenderingContext2D,
  head: HeadPose,
  proj: HeadProjection,
  palette: SunflowerPalette,
): void {
  const visibility = smoothstep(0.3, 0.85, head.bloomOpen);
  if (visibility <= 0.01) return;

  const baseR = head.diskRadius * 0.88;
  const maxTipR = head.diskRadius + head.petalLength * 0.94 * 1.24;
  const centerX = projX(proj, 0, 0, -5);
  const centerY = projY(proj, 0, 0, -5);

  const grad = ctx.createRadialGradient(centerX, centerY, baseR * 0.8, centerX, centerY, maxTipR);
  grad.addColorStop(0, rgbToCss(palette.leafShadow));
  grad.addColorStop(0.55, rgbToCss(palette.sepalFill));
  grad.addColorStop(1, rgbToCss(palette.leafHighlight));

  const bodyPath = new Path2D();
  const veinPath = new Path2D();

  for (let i = 0; i < 4; i++) {
    const ca = BRACT_COS[i] ?? 1;
    const sa = BRACT_SIN[i] ?? 0;
    const px = -sa;
    const py = ca;
    const lenMul = BRACT_LENGTHS[i] ?? 1;
    const tipR = head.diskRadius + head.petalLength * 0.94 * lenMul;
    const midR = lerp(baseR, tipR, 0.42);
    const halfW = (i < 2 ? 7.2 : 5.4) * visibility;

    const bx = projX(proj, ca * baseR, sa * baseR, -6);
    const by = projY(proj, ca * baseR, sa * baseR, -6);
    const lx = projX(proj, ca * midR + px * halfW, sa * midR + py * halfW, -5);
    const ly = projY(proj, ca * midR + px * halfW, sa * midR + py * halfW, -5);
    const rx = projX(proj, ca * midR - px * halfW, sa * midR - py * halfW, -5);
    const ry = projY(proj, ca * midR - px * halfW, sa * midR - py * halfW, -5);
    const tx = projX(proj, ca * tipR, sa * tipR - (i < 2 ? 4 : 1), -4);
    const ty = projY(proj, ca * tipR, sa * tipR - (i < 2 ? 4 : 1), -4);

    bodyPath.moveTo(bx, by);
    bodyPath.quadraticCurveTo(lx, ly, tx, ty);
    bodyPath.quadraticCurveTo(rx, ry, bx, by);
    bodyPath.closePath();

    veinPath.moveTo(bx, by);
    veinPath.lineTo(tx, ty);
  }

  ctx.save();
  ctx.globalAlpha = visibility;
  ctx.fillStyle = grad;
  ctx.fill(bodyPath);
  ctx.strokeStyle = rgbToCss(lerpRgb(palette.outlineInk, palette.leafShadow, 0.4), 0.36);
  ctx.lineWidth = 0.6;
  ctx.stroke(bodyPath);
  ctx.strokeStyle = rgbToCss(palette.leafVein, 0.48);
  ctx.lineWidth = 0.55;
  ctx.stroke(veinPath);
  ctx.restore();
}

function drawBatchedSepals(
  ctx: CanvasRenderingContext2D,
  head: HeadPose,
  proj: HeadProjection,
  palette: SunflowerPalette,
): void {
  const baseR = head.diskRadius * 0.9;
  const baseSepalLen = lerp(15, 17, head.bloomOpen);
  const baseHalfW = lerp(4.0, 5.0, head.bloomOpen);
  const outRatio = lerp(0.96, 0.72, head.bloomOpen);
  const bloomOpen = head.bloomOpen;

  const centerX = projX(proj, 0, 0, -0.6);
  const centerY = projY(proj, 0, 0, -0.6);
  const grad = ctx.createRadialGradient(
    centerX,
    centerY,
    baseR * 0.85,
    centerX,
    centerY,
    baseR + baseSepalLen * 1.15,
  );
  grad.addColorStop(0, rgbToCss(lerpRgb(palette.sepalFill, palette.leafShadow, 0.35)));
  grad.addColorStop(0.65, rgbToCss(palette.sepalFill));
  grad.addColorStop(1, rgbToCss(lerpRgb(palette.sepalFill, palette.leafHighlight, 0.25)));

  ctx.save();
  ctx.fillStyle = grad;
  ctx.strokeStyle = rgbToCss(lerpRgb(palette.outlineInk, palette.leafShadow, 0.35), 0.38);
  ctx.lineWidth = 0.58;
  ctx.beginPath();

  for (let i = 0; i < SEPAL_SPECS.length; i++) {
    const spec = SEPAL_SPECS[i];
    if (!spec) continue;
    const ca = spec.cosA;
    const sa = spec.sinA;
    const px = -sa;
    const py = ca;

    const sepalLen = baseSepalLen * spec.lengthMul;
    const halfW = baseHalfW * spec.widthMul;
    const outDist = baseR + sepalLen * outRatio;
    const midDist = lerp(baseR, outDist, 0.45);
    const tipZ = lerp(sepalLen * 0.16, -2.5, bloomOpen);

    const bx = projX(proj, ca * baseR, sa * baseR, -0.8);
    const by = projY(proj, ca * baseR, sa * baseR, -0.8);
    const lx = projX(proj, ca * midDist + px * halfW, sa * midDist + py * halfW, -0.4);
    const ly = projY(proj, ca * midDist + px * halfW, sa * midDist + py * halfW, -0.4);
    const rx = projX(proj, ca * midDist - px * halfW, sa * midDist - py * halfW, -0.4);
    const ry = projY(proj, ca * midDist - px * halfW, sa * midDist - py * halfW, -0.4);
    const tx = projX(proj, ca * outDist, sa * outDist, tipZ);
    const ty = projY(proj, ca * outDist, sa * outDist, tipZ);

    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(lx, ly, tx, ty);
    ctx.quadraticCurveTo(rx, ry, bx, by);
    ctx.closePath();
  }

  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPetalRing(
  ctx: CanvasRenderingContext2D,
  head: HeadPose,
  proj: HeadProjection,
  specs: readonly PetalSpec[],
  atlas: HTMLCanvasElement,
  petalT: number,
  dpr: number,
): void {
  let rowA: number;
  let rowB: number;
  let blend: number;
  if (petalT <= 0.5) {
    rowA = 0;
    rowB = 1;
    blend = clamp01(petalT * 2);
  } else {
    rowA = 1;
    rowB = 2;
    blend = clamp01((petalT - 0.5) * 2);
  }

  const drawSingleB = blend >= 0.985;
  const drawBoth = blend > 0.015 && !drawSingleB;
  const syA = (drawSingleB ? rowB : rowA) * PETAL_SPRITE_H;
  const syB = rowB * PETAL_SPRITE_H;

  const pitchDroopMask = smoothstep(0.28, 1.15, -head.pitch);
  const baseHalfWBase = lerp(4.8, 10.6, head.bloomOpen) * (1 - head.petalCurl * 0.24);
  const invPetalHalfW = 1 / PETAL_HALF_W;
  const invPetalSpanY = 1 / PETAL_SPAN_Y;

  ctx.save();
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (!spec) continue;

    const angle = spec.angle + spec.bendBias * head.petalCurl * 0.42;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const px = -sa;
    const py = ca;

    const baseR = head.diskRadius * (spec.ring === 0 ? 0.84 : 0.9);
    const len = head.petalLength * spec.lengthMul;
    const halfW = baseHalfWBase * spec.widthMul;

    const frontRimMask = clamp01(-sa) * pitchDroopMask;
    const outFrac = lerp(1.0, lerp(0.78, 0.44, frontRimMask), head.petalDroop);
    const tipOut = baseR + len * outFrac;
    const midOut = baseR + len * 0.48 * outFrac;

    const droopLift = lerp(0.74, 0.62, frontRimMask);
    const baseZ = spec.ring === 0 ? -0.4 : 0.4;
    const midZ =
      baseZ +
      len * head.petalDroop * droopLift * 0.46 -
      (1 - head.petalDroop) * (spec.ring === 0 ? 1.4 : 0.4);
    const tipZ =
      baseZ + len * (head.petalDroop * droopLift + head.petalCurl * 0.1 * (1 + spec.curlBias));
    const curlSide = spec.curlBias * head.petalCurl * 4.8;

    const bmx = projX(proj, ca * baseR, sa * baseR, baseZ);
    const bmy = projY(proj, ca * baseR, sa * baseR, baseZ);
    const mcx = projX(proj, ca * midOut, sa * midOut, midZ);
    const mcy = projY(proj, ca * midOut, sa * midOut, midZ);
    const msx = projX(proj, ca * midOut + px * halfW, sa * midOut + py * halfW, midZ);
    const msy = projY(proj, ca * midOut + px * halfW, sa * midOut + py * halfW, midZ);
    const tpx = projX(proj, ca * tipOut + px * curlSide, sa * tipOut + py * curlSide, tipZ);
    const tpy = projY(proj, ca * tipOut + px * curlSide, sa * tipOut + py * curlSide, tipZ);

    const dx = tpx - bmx;
    const dy = tpy - bmy;
    const projLen = Math.hypot(dx, dy);
    if (projLen < 2.2) continue;

    const axisX = dx / projLen;
    const axisY = dy / projLen;
    const sideDx = msx - mcx;
    const sideDy = msy - mcy;
    const dot = sideDx * axisX + sideDy * axisY;
    const projHalfW = Math.max(
      halfW * 0.42,
      Math.hypot(sideDx - dot * axisX, sideDy - dot * axisY),
    );

    const scaleX = projHalfW * invPetalHalfW * spec.flipX;
    const scaleY = projLen * invPetalSpanY;

    // Direct 2D affine matrix for translate(bmx,bmy) * rotate(projAngle - π/2) * scale(scaleX,scaleY)
    ctx.setTransform(
      dpr * scaleX * axisY,
      dpr * scaleX * -axisX,
      dpr * scaleY * axisX,
      dpr * scaleY * axisY,
      dpr * bmx,
      dpr * bmy,
    );

    const sx = ((spec.ring === 0 ? 0 : 4) + spec.variant) * PETAL_SPRITE_W;

    ctx.globalAlpha = 1;
    ctx.drawImage(
      atlas,
      sx,
      syA,
      PETAL_SPRITE_W,
      PETAL_SPRITE_H,
      -PETAL_BASE_X,
      -PETAL_BASE_Y,
      PETAL_SPRITE_W,
      PETAL_SPRITE_H,
    );
    if (drawBoth) {
      ctx.globalAlpha = blend;
      ctx.drawImage(
        atlas,
        sx,
        syB,
        PETAL_SPRITE_W,
        PETAL_SPRITE_H,
        -PETAL_BASE_X,
        -PETAL_BASE_Y,
        PETAL_SPRITE_W,
        PETAL_SPRITE_H,
      );
    }
  }
  ctx.restore();
}

function drawSeedDisk(
  ctx: CanvasRenderingContext2D,
  head: HeadPose,
  proj: HeadProjection,
  palette: SunflowerPalette,
  bank: BotanicalSpriteBank,
  diskT: number,
): void {
  const r = head.diskRadius;
  const diskZ = 0.5;
  const p0x = projX(proj, 0, 0, diskZ);
  const p0y = projY(proj, 0, 0, diskZ);
  const pXx = projX(proj, r, 0, diskZ);
  const pXy = projY(proj, r, 0, diskZ);
  const pYx = projX(proj, 0, r, diskZ);
  const pYy = projY(proj, 0, r, diskZ);

  const ux = (pXx - p0x) / DISK_RADIUS;
  const uy = (pXy - p0y) / DISK_RADIUS;
  let vx = (pYx - p0x) / DISK_RADIUS;
  let vy = (pYy - p0y) / DISK_RADIUS;

  const vLen = Math.hypot(vx, vy);
  const minV = (r * 0.11) / DISK_RADIUS;
  if (vLen > 0.0001 && vLen < minV) {
    const boost = minV / vLen;
    vx *= boost;
    vy *= boost;
  }

  let spriteA: HTMLCanvasElement;
  let spriteB: HTMLCanvasElement;
  let blend: number;
  if (diskT <= 0.5) {
    spriteA = bank.diskWilted;
    spriteB = bank.diskMid;
    blend = clamp01(diskT * 2);
  } else {
    spriteA = bank.diskMid;
    spriteB = bank.diskBloom;
    blend = clamp01((diskT - 0.5) * 2);
  }

  ctx.save();
  ctx.transform(ux, uy, vx, vy, p0x, p0y);

  if (blend >= 0.985) {
    ctx.drawImage(spriteB, -DISK_CENTER, -DISK_CENTER, DISK_SPRITE_SIZE, DISK_SPRITE_SIZE);
  } else {
    ctx.drawImage(spriteA, -DISK_CENTER, -DISK_CENTER, DISK_SPRITE_SIZE, DISK_SPRITE_SIZE);
    if (blend > 0.015) {
      ctx.globalAlpha = blend;
      ctx.drawImage(spriteB, -DISK_CENTER, -DISK_CENTER, DISK_SPRITE_SIZE, DISK_SPRITE_SIZE);
    }
  }

  const droopShadow = smoothstep(0.28, 1.2, -head.pitch);
  if (droopShadow > 0.02) {
    ctx.globalAlpha = 1;
    const hoodGrad = ctx.createLinearGradient(0, -DISK_RADIUS, 0, DISK_RADIUS * 0.45);
    hoodGrad.addColorStop(0, rgbToCss(palette.outlineInk, 0.36 * droopShadow));
    hoodGrad.addColorStop(0.55, rgbToCss(palette.diskEdge, 0.14 * droopShadow));
    hoodGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = hoodGrad;
    ctx.beginPath();
    ctx.arc(0, 0, DISK_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawSunflowerHead(
  ctx: CanvasRenderingContext2D,
  state: SunflowerSimState,
  palette: SunflowerPalette,
  dpr: number,
): void {
  const { head, phases, hoverHead, dragging } = state;
  const bank = getBotanicalSpriteBank();
  if (!bank) return;

  if (hoverHead || dragging) {
    ctx.save();
    const liftR = head.radius * 1.18;
    const liftGrad = ctx.createRadialGradient(
      head.center.x,
      head.center.y,
      head.diskRadius * 0.35,
      head.center.x,
      head.center.y,
      liftR,
    );
    const alpha = dragging ? 0.11 : 0.075;
    liftGrad.addColorStop(0, rgbToCss(palette.sunGlow, alpha));
    liftGrad.addColorStop(0.65, rgbToCss(palette.sunGlow, alpha * 0.4));
    liftGrad.addColorStop(1, rgbToCss(palette.sunGlow, 0));
    ctx.fillStyle = liftGrad;
    ctx.beginPath();
    ctx.arc(head.center.x, head.center.y, liftR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const proj = createHeadProjection(head);
  const petalT = clamp01(phases.warmth * 0.22 + phases.bloom * 0.78);
  const diskT = clamp01(phases.headLift * 0.36 + phases.bloom * 0.64);

  drawCalyxCup(ctx, head, state.stem, proj, palette);
  drawCradleBracts(ctx, head, proj, palette);
  drawBatchedSepals(ctx, head, proj, palette);

  drawPetalRing(ctx, head, proj, BACK_PETAL_SPECS, bank.petalAtlas, petalT, dpr);
  drawPetalRing(ctx, head, proj, FRONT_PETAL_SPECS, bank.petalAtlas, petalT, dpr);

  drawSeedDisk(ctx, head, proj, palette, bank, diskT);
}

const backLeavesScratch: LeafPose[] = [];
const frontLeavesScratch: LeafPose[] = [];

function compareLeafOrder(a: LeafPose, b: LeafPose): number {
  return a.zOrder - b.zOrder || a.stemT - b.stemT;
}

export function paintSunflower(
  ctx: CanvasRenderingContext2D,
  state: SunflowerSimState,
  palette: SunflowerPalette,
  cardPath: Path2D,
  dpr = 1,
): void {
  const { stem, leaves, phases } = state;
  const vitality = clamp01(phases.warmth * 0.42 + phases.leafUnfurl * 0.58);

  refreshLeafSprites(state, palette, vitality, dpr);
  drawOutsideLeafShadows(ctx, state, cardPath);

  backLeavesScratch.length = 0;
  frontLeavesScratch.length = 0;
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    if (!leaf) continue;
    if (leaf.zOrder <= 0) backLeavesScratch.push(leaf);
    else frontLeavesScratch.push(leaf);
  }
  backLeavesScratch.sort(compareLeafOrder);
  frontLeavesScratch.sort(compareLeafOrder);

  ctx.save();
  drawBatchedPetioles(ctx, backLeavesScratch, palette, vitality);
  for (let i = 0; i < backLeavesScratch.length; i++) {
    const leaf = backLeavesScratch[i];
    if (leaf) drawLeafFromCache(ctx, state, leaf, palette, vitality);
  }
  ctx.restore();

  drawStem(ctx, stem, palette);

  ctx.save();
  drawBatchedPetioles(ctx, frontLeavesScratch, palette, vitality);
  for (let i = 0; i < frontLeavesScratch.length; i++) {
    const leaf = frontLeavesScratch[i];
    if (leaf) drawLeafFromCache(ctx, state, leaf, palette, vitality);
  }
  ctx.restore();

  drawSunflowerHead(ctx, state, palette, dpr);
}
