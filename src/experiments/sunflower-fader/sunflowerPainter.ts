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
  lengthMul: number;
  widthMul: number;
  seed: number;
}

const SEPAL_SPECS: readonly SepalSpec[] = (() => {
  const rng = mulberry32(61903);
  const specs: SepalSpec[] = [];
  const count = 14;
  for (let i = 0; i < count; i++) {
    specs.push({
      angle: (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.12,
      lengthMul: 0.86 + rng() * 0.34,
      widthMul: 0.86 + rng() * 0.24,
      seed: Math.floor(rng() * 100000),
    });
  }
  return specs.sort((a, b) => compareRadialDepth(a.angle, b.angle, a.seed, b.seed));
})();

interface PetalSpriteSet {
  front: HTMLCanvasElement[];
  back: HTMLCanvasElement[];
}

interface BotanicalSpriteBank {
  petalsWilted: PetalSpriteSet;
  petalsMid: PetalSpriteSet;
  petalsBloom: PetalSpriteSet;
  diskWilted: HTMLCanvasElement;
  diskMid: HTMLCanvasElement;
  diskBloom: HTMLCanvasElement;
}

let cachedSpriteBank: BotanicalSpriteBank | null = null;
let cachedOutsideCardPath: Path2D | null = null;
let cachedOutsideCardSource: Path2D | null = null;

const hatchPatternCache = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>();

function getHatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (hatchPatternCache.has(ctx)) {
    return hatchPatternCache.get(ctx) ?? null;
  }
  const { pencilHatchTile } = getPaperTextures();
  const pat = pencilHatchTile.width ? ctx.createPattern(pencilHatchTile, "repeat") : null;
  hatchPatternCache.set(ctx, pat);
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

function createPetalSprite(
  palette: SunflowerPalette,
  variant: number,
  isBackRing: boolean,
  bloomLevel: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PETAL_SPRITE_W;
  canvas.height = PETAL_SPRITE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const rng = mulberry32(4100 + variant * 977 + (isBackRing ? 313 : 0));
  const tipBend = (variant - 1.5) * 3.2;
  const bellyShift = (variant % 2 === 0 ? 1 : -1) * 1.4;
  const widthBias = 0.94 + (variant % 3) * 0.05;

  const cx = PETAL_BASE_X;
  const y0 = PETAL_BASE_Y;
  const yTip = PETAL_BASE_Y + PETAL_SPAN_Y;
  const hw = PETAL_HALF_W * widthBias;

  // Organic lance-shaped sunflower petal contour (base -> broad velvety belly -> pointed tip)
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

  // Soft watercolor-pastel underwash
  const baseGrad = ctx.createLinearGradient(cx, y0, cx + tipBend * 0.5, yTip);
  baseGrad.addColorStop(0, rgbToCss(lerpRgb(shadowTone, innerTone, 0.35)));
  baseGrad.addColorStop(0.22, rgbToCss(innerTone));
  baseGrad.addColorStop(0.62, rgbToCss(midTone));
  baseGrad.addColorStop(1, rgbToCss(tipTone));

  ctx.save();
  ctx.fillStyle = baseGrad;
  ctx.fill(petalPath);

  // Everything inside clipped to the petal silhouette
  ctx.clip(petalPath);

  // Soft warm sienna basal shading wash where petals nestle against the seed disk
  const baseShade = ctx.createRadialGradient(cx, y0 - 2, 2, cx, y0 + 18, 44);
  baseShade.addColorStop(0, rgbToCss(shadowTone, 0.55));
  baseShade.addColorStop(0.55, rgbToCss(innerTone, 0.24));
  baseShade.addColorStop(1, rgbToCss(innerTone, 0));
  ctx.fillStyle = baseShade;
  ctx.fillRect(0, 0, PETAL_SPRITE_W, PETAL_SPRITE_H);

  // Subtle sunlit left-side glow & gentle right-side sculptural shadow
  const sideGrad = ctx.createLinearGradient(cx - hw, y0, cx + hw, y0);
  sideGrad.addColorStop(0, rgbToCss(highlightCream, 0.28));
  sideGrad.addColorStop(0.45, rgbToCss(midTone, 0));
  sideGrad.addColorStop(1, rgbToCss(shadowTone, 0.22));
  ctx.fillStyle = sideGrad;
  ctx.fillRect(0, 0, PETAL_SPRITE_W, PETAL_SPRITE_H);

  // 42 fine longitudinal colored-pencil hatch strokes running from base toward tip
  ctx.lineCap = "round";
  const strokeCount = 42;
  for (let s = 0; s < strokeCount; s++) {
    const u = (s / (strokeCount - 1)) * 2 - 1; // -1..+1 across width
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
      // Deep raw-sienna/amber basal pencil strokes
      col = shadowTone;
      alpha = 0.14 + rng() * 0.18;
    } else if (lane < -0.15 && rng() > 0.42) {
      // Sunlit pale-buttercup dry-pencil highlight strokes
      col = highlightCream;
      alpha = 0.16 + rng() * 0.2;
    } else if (lane > 0.25 && rng() > 0.38) {
      // Warm ochre shaded flank strokes
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

  // Delicate botanical longitudinal central crease (shadow groove + adjacent sunlit cream ridge)
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

  // Secondary subtle flank groove lines
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

  // Soft dry paper-tooth texture inside petal so chalky colored-pencil grain shows clearly
  const { pastelGrainTile } = getPaperTextures();
  if (pastelGrainTile.width) {
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.26;
    ctx.drawImage(pastelGrainTile, 0, 0, PETAL_SPRITE_W, PETAL_SPRITE_H);
  }
  ctx.restore();

  // Whisper-soft warm colored-pencil contour (NO black cartoon outline!)
  const edgeCol = lerpRgb(shadowTone, palette.outlineInk, lerp(0.45, 0.22, bloomLevel));
  const edgeGrad = ctx.createLinearGradient(cx, y0, cx, yTip);
  edgeGrad.addColorStop(0, rgbToCss(edgeCol, isBackRing ? 0.34 : 0.42));
  edgeGrad.addColorStop(0.65, rgbToCss(edgeCol, isBackRing ? 0.28 : 0.36));
  edgeGrad.addColorStop(1, rgbToCss(edgeCol, isBackRing ? 0.16 : 0.22));
  ctx.strokeStyle = edgeGrad;
  ctx.lineWidth = 1.1;
  ctx.lineJoin = "round";
  ctx.stroke(petalPath);

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

  // Soft velvety botanical radial wash (moss-olive center -> honey-bronze ring -> roasted umber collar)
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

  // Subtle top-left sunlight warmth and bottom-right velvety shadow across the domed seed cushion
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

  // Soft stippled pointillist Fibonacci spiral (264 individual shaded florets & seeds!)
  for (let i = 0; i < SEED_COUNT; i++) {
    const frac = (i + 0.5) / SEED_COUNT;
    const rn = Math.sqrt(frac);
    const theta = i * GOLDEN_ANGLE;
    const jitterR = (rng() - 0.5) * 1.8;
    const sx = cx + Math.cos(theta) * (rn * r * 0.94 + jitterR);
    const sy = cy + Math.sin(theta) * (rn * r * 0.94 + jitterR);
    const seedR = (2.1 + rn * 2.15) * lerp(0.84, 1.0, bloomLevel);

    // Subtle directional lighting factor from upper-left (-0.7, -0.7)
    const lightDir = -(Math.cos(theta) * 0.7 + Math.sin(theta) * 0.7) * rn;

    let seedCol: RGB;
    let hiCol: RGB;
    let shadowCol: RGB;

    if (rn < 0.42) {
      // Sunken velvety moss-olive center rosette
      const k = rn / 0.42;
      seedCol = lerpRgb(
        lerpRgb(palette.diskCenter, palette.outlineInk, 0.28),
        palette.diskCenter,
        k,
      );
      hiCol = lerpRgb(palette.diskCenter, palette.leafHighlight, 0.42 * bloomLevel + 0.1);
      shadowCol = lerpRgb(palette.diskCenter, palette.outlineInk, 0.48);
    } else if (rn < 0.79) {
      // Luminous pebbled golden-ochre & warm bronze pollen ring
      const k = (rn - 0.42) / 0.37;
      const ringPeak = Math.sin(k * Math.PI);
      seedCol = lerpRgb(palette.diskEdge, palette.diskMid, 0.28 + ringPeak * 0.62);
      hiCol = lerpRgb(palette.diskMid, palette.petalTip, 0.52 * bloomLevel + 0.14);
      shadowCol = lerpRgb(palette.diskEdge, palette.outlineInk, 0.38);
    } else {
      // Rich roasted umber-sienna outer seed collar
      seedCol = lerpRgb(palette.diskEdge, palette.outlineInk, 0.18);
      hiCol = lerpRgb(palette.diskMid, palette.petalInner, 0.36 * bloomLevel + 0.12);
      shadowCol = lerpRgb(palette.diskEdge, palette.outlineInk, 0.48);
    }

    // Tiny crevice shadow tucked beneath each seed for tactile pebbled relief
    ctx.fillStyle = rgbToCss(shadowCol, 0.52);
    ctx.beginPath();
    ctx.ellipse(sx + 0.85, sy + 0.95, seedR * 1.05, seedR * 0.9, theta, 0, Math.PI * 2);
    ctx.fill();

    // Colored-pencil stippled seed body
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

    // Sunlit pollen dot / stipple speck on upper-left crest of floret
    const hiAlpha = clamp01(lerp(0.24, 0.78, bloomLevel) + lightDir * 0.24);
    if (rn > 0.24 && (i % 2 === 0 || rn > 0.44)) {
      ctx.fillStyle = rgbToCss(hiCol, hiAlpha);
      ctx.beginPath();
      ctx.arc(sx - seedR * 0.26, sy - seedR * 0.24, seedR * (0.34 + rng() * 0.14), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Paper-tooth texture inside disk so stippling feels softly pressed into cotton paper
  const { pastelGrainTile } = getPaperTextures();
  if (pastelGrainTile.width) {
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.28;
    ctx.drawImage(pastelGrainTile, 0, 0, DISK_SPRITE_SIZE, DISK_SPRITE_SIZE);
  }
  ctx.restore();

  // Fuzzy delicate radial colored-pencil stamen hairs softening the outer disk rim (ZERO hard outline!)
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

function createPetalSpriteSet(palette: SunflowerPalette, bloomLevel: number): PetalSpriteSet {
  const front: HTMLCanvasElement[] = [];
  const back: HTMLCanvasElement[] = [];
  for (let v = 0; v < 4; v++) {
    front.push(createPetalSprite(palette, v, false, bloomLevel));
    back.push(createPetalSprite(palette, v, true, bloomLevel));
  }
  return { front, back };
}

function getBotanicalSpriteBank(): BotanicalSpriteBank | null {
  if (cachedSpriteBank) return cachedSpriteBank;
  if (typeof document === "undefined") return null;

  const pal0 = getPalette(computePhasedProgress(0));
  const palMid = getPalette(computePhasedProgress(0.55));
  const pal1 = getPalette(computePhasedProgress(1));

  cachedSpriteBank = {
    petalsWilted: createPetalSpriteSet(pal0, 0),
    petalsMid: createPetalSpriteSet(palMid, 0.5),
    petalsBloom: createPetalSpriteSet(pal1, 1),
    diskWilted: createDiskSprite(pal0, 0),
    diskMid: createDiskSprite(palMid, 0.5),
    diskBloom: createDiskSprite(pal1, 1),
  };

  return cachedSpriteBank;
}

function traceSmoothSpline(
  target: Path2D | CanvasRenderingContext2D,
  pts: readonly Point2D[],
  startWithMove: boolean,
  yOffset = 0,
): void {
  const n = pts.length;
  const first = pts[0];
  if (n === 0 || !first) return;
  if (startWithMove) {
    target.moveTo(first.x, first.y + yOffset);
  } else {
    target.lineTo(first.x, first.y + yOffset);
  }
  if (n === 1) return;
  if (n === 2) {
    const second = pts[1];
    if (second) target.lineTo(second.x, second.y + yOffset);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
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
  const last = pts[n - 1];
  if (last) target.lineTo(last.x, last.y + yOffset);
}

function traceSmoothSplineReverse(
  target: Path2D | CanvasRenderingContext2D,
  pts: readonly Point2D[],
): void {
  const n = pts.length;
  const last = pts[n - 1];
  if (n === 0 || !last) return;
  target.lineTo(last.x, last.y);
  if (n === 1) return;
  if (n === 2) {
    const first = pts[0];
    if (first) target.lineTo(first.x, first.y);
    return;
  }
  for (let i = n - 2; i >= 1; i--) {
    const curr = pts[i];
    const next = pts[i - 1];
    if (!curr || !next) continue;
    target.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) * 0.5, (curr.y + next.y) * 0.5);
  }
  const first = pts[0];
  if (first) target.lineTo(first.x, first.y);
}

function drawStem(
  ctx: CanvasRenderingContext2D,
  stem: readonly StemNode[],
  palette: SunflowerPalette,
): void {
  if (stem.length < 2) return;

  const leftPts: Point2D[] = [];
  const rightPts: Point2D[] = [];
  const hiPts: Point2D[] = [];
  const shadowPts: Point2D[] = [];

  for (let i = 0; i < stem.length; i++) {
    const node = stem[i];
    if (!node) continue;
    const nx = -node.ty;
    const ny = node.tx;
    leftPts.push({
      x: node.x - nx * node.radius,
      y: node.y - ny * node.radius,
    });
    rightPts.push({
      x: node.x + nx * node.radius,
      y: node.y + ny * node.radius,
    });
    hiPts.push({
      x: node.x - nx * node.radius * 0.44,
      y: node.y - ny * node.radius * 0.44,
    });
    shadowPts.push({
      x: node.x + nx * node.radius * 0.54,
      y: node.y + ny * node.radius * 0.54,
    });
  }

  const firstLeft = leftPts[0];
  const lastRight = rightPts[rightPts.length - 1];
  if (!firstLeft || !lastRight) return;

  const stemPath = new Path2D();
  traceSmoothSpline(stemPath, leftPts, true);
  traceSmoothSplineReverse(stemPath, rightPts);
  stemPath.closePath();

  const firstNode = stem[0];
  const lastNode = stem[stem.length - 1];
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

  // Subtle colored-pencil grain inside stem
  const hatchPat = getHatchPattern(ctx);
  if (hatchPat) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = hatchPat;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.restore();
  }

  // Soft sunlit pale sage-cream ridge along left/upper flank
  ctx.strokeStyle = rgbToCss(lerpRgb(palette.stemHighlight, palette.paperBg, 0.22), 0.62);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  traceSmoothSpline(ctx, hiPts, true);
  ctx.lineWidth = 2.4;
  ctx.stroke();

  // Warm mossy-umber shadow flank on right/underside
  ctx.strokeStyle = rgbToCss(lerpRgb(palette.stemBase, palette.stemOutline, 0.44), 0.5);
  ctx.beginPath();
  traceSmoothSpline(ctx, shadowPts, true);
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // Fine longitudinal colored-pencil fiber lines
  ctx.strokeStyle = rgbToCss(palette.stemOutline, 0.2);
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  for (const f of [-0.36, 0.16, 0.52] as const) {
    const fiberPts: Point2D[] = [];
    for (let i = 0; i < stem.length; i++) {
      const node = stem[i];
      if (!node) continue;
      const nx = -node.ty;
      const ny = node.tx;
      fiberPts.push({
        x: node.x + nx * node.radius * f,
        y: node.y + ny * node.radius * f,
      });
    }
    traceSmoothSpline(ctx, fiberPts, true);
  }
  ctx.stroke();

  // Delicate diagonal colored-pencil shadow hatching along shaded right side
  ctx.strokeStyle = rgbToCss(palette.stemOutline, 0.22);
  ctx.lineWidth = 0.52;
  const hatchStep = Math.max(2, Math.floor(stem.length / 20));
  ctx.beginPath();
  for (let i = 2; i < stem.length - 1; i += hatchStep) {
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

  // Whisper-thin sepia-olive colored-pencil edges (NO thick black outlines!)
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = rgbToCss(palette.stemOutline, 0.28);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  traceSmoothSpline(ctx, leftPts, true);
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(palette.stemOutline, 0.42);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  traceSmoothSpline(ctx, rightPts, true);
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

    // Expressive botanical cordate serration when lush; smooth edge ripple when wilted (always strictly > 0)
    const tipMask = Math.sin(s * Math.PI) ** 1.15;
    const lushTooth =
      (0.048 * Math.sin(s * Math.PI * 11 + leaf.id * 0.7) + 0.018 * Math.sin(s * Math.PI * 21)) *
      cordate;
    const wiltedPinch = 0.1 * curl * Math.sin(s * 13 + leaf.id * 2.1);
    const serration = (lushTooth + wiltedPinch) * W * tipMask;

    // Smoothly attenuated asymmetric crinkle kept strictly non-crossing so wilted tips never pinch/knot
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

function drawLeaf(
  ctx: CanvasRenderingContext2D,
  leaf: LeafPose,
  palette: SunflowerPalette,
  cardPath: Path2D,
  vitality: number,
): void {
  const { outline, midrib, upperSide, topScale, botScale } = buildLeafSilhouettePoints(leaf);
  const bladePath = buildLeafPath(outline);

  // Whisper-soft shadow outside card edges when widest leaves gently extend onto the page
  const nearOutside =
    Math.min(leaf.tip.x, leaf.petioleEnd.x) < BLEED_X + 14 ||
    Math.max(leaf.tip.x, leaf.petioleEnd.x) > BLEED_X + CARD_WIDTH - 14 ||
    Math.min(leaf.tip.y, leaf.petioleEnd.y) < BLEED_Y + 14;

  if (nearOutside) {
    ctx.save();
    ctx.clip(getOutsideCardPath(cardPath), "evenodd");
    ctx.translate(leaf.petioleEnd.x + 2, leaf.petioleEnd.y + 3.5);
    ctx.rotate(leaf.angle);
    ctx.shadowColor = "rgba(72, 62, 48, 0.14)";
    ctx.shadowBlur = 5;
    ctx.fillStyle = "rgba(82, 72, 58, 0.06)";
    ctx.fill(bladePath);
    ctx.restore();
  }

  // Graceful shaded botanical petiole (NO heavy black border!)
  const midPetX = (leaf.attach.x + leaf.petioleEnd.x) * 0.5;
  const midPetY = (leaf.attach.y + leaf.petioleEnd.y) * 0.5 + lerp(-6.2, -4.0, leaf.turgor);
  const petW = lerp(1.3, 2.5, leaf.turgor) * (leaf.id >= 8 ? 0.8 : 1);

  ctx.save();
  ctx.lineCap = "round";
  // Soft shadow underside
  ctx.strokeStyle = rgbToCss(palette.stemOutline, 0.38);
  ctx.lineWidth = petW + 0.7;
  ctx.beginPath();
  ctx.moveTo(leaf.attach.x, leaf.attach.y + 0.5);
  ctx.quadraticCurveTo(midPetX, midPetY + 0.6, leaf.petioleEnd.x, leaf.petioleEnd.y + 0.4);
  ctx.stroke();

  // Main botanical petiole body
  ctx.strokeStyle = rgbToCss(lerpRgb(palette.stemBase, palette.leafBase, 0.38), 0.94);
  ctx.lineWidth = petW;
  ctx.beginPath();
  ctx.moveTo(leaf.attach.x, leaf.attach.y);
  ctx.quadraticCurveTo(midPetX, midPetY, leaf.petioleEnd.x, leaf.petioleEnd.y);
  ctx.stroke();

  // Delicate sunlit upper ridge on petiole
  ctx.strokeStyle = rgbToCss(palette.stemHighlight, 0.55);
  ctx.lineWidth = Math.max(0.55, petW * 0.38);
  ctx.beginPath();
  ctx.moveTo(leaf.attach.x, leaf.attach.y - 0.4);
  ctx.quadraticCurveTo(midPetX, midPetY - 0.5, leaf.petioleEnd.x, leaf.petioleEnd.y - 0.3);
  ctx.stroke();
  ctx.restore();

  // Per-leaf botanical pigment variation driven by each leaf's own turgor so faster-wilting leaves dry earlier
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

  ctx.save();
  ctx.translate(leaf.petioleEnd.x, leaf.petioleEnd.y);
  ctx.rotate(leaf.angle);

  // Rich botanical watercolor-pastel base gradient (deep shadowed base/lower half -> warm sunlit chartreuse tip/upper cheek)
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

  // Local-space colored-pencil hatch grain (moves naturally WITH the leaf!)
  const hatchPat = getHatchPattern(ctx);
  if (hatchPat) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = hatchPat;
    ctx.fillRect(-leaf.length * 0.4, -leaf.width, leaf.length * 1.6, leaf.width * 2);
    ctx.restore();
  }

  // Deep velvety cool moss-forest shadow tucked across the lower half of the midrib crease
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

  // Deep heart-cleft ambient occlusion shadow where the basal lobes tuck around the petiole
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

  // Warm chartreuse-gold sunlit highlight blush across the upper lobe cheek
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

  // Rich directional colored-pencil hatching strokes following natural lateral vein sweep
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

  // Delicate cross-hatch strokes tucked in the shaded basal cleft for book-illustration depth
  ctx.strokeStyle = rgbToCss(shadowCol, 0.24);
  ctx.lineWidth = 0.52;
  ctx.beginPath();
  for (let c = 0; c < 6; c++) {
    const cx0 = -leaf.length * 0.06 + c * (leaf.length * 0.055);
    ctx.moveTo(cx0, upperSide * leaf.width * 0.14);
    ctx.lineTo(cx0 + leaf.length * 0.08, -upperSide * leaf.width * 0.34);
  }
  ctx.stroke();

  // Soft pale-chartreuse midrib vein (with sculpted mossy shadow tuck alongside, strictly clipped inside blade!)
  ctx.strokeStyle = rgbToCss(shadowCol, 0.42);
  ctx.lineWidth = lerp(1.1, 2.0, leaf.turgor);
  ctx.lineCap = "round";
  ctx.beginPath();
  traceSmoothSpline(ctx, midrib, true, -upperSide * 0.8);
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(
    lerpRgb(palette.leafVein, palette.paperBg, 0.24 * vitality),
    lerp(0.68, 0.88, vitality),
  );
  ctx.lineWidth = lerp(0.75, 1.35, leaf.turgor);
  ctx.beginPath();
  traceSmoothSpline(ctx, midrib, true);
  ctx.stroke();

  // Delicate basal heart-lobe veins & curved pinnate lateral veins (pale vein + whisper shadow tuck)
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

  // Tactile colored-pencil forest-sepia edge (delicate alpha ~0.40, NEVER harsh black!)
  ctx.strokeStyle = rgbToCss(lerpRgb(palette.outlineInk, shadowCol, 0.48), 0.42);
  ctx.lineWidth = 0.68;
  ctx.lineJoin = "round";
  ctx.stroke(bladePath);

  ctx.restore();
}

interface Projected3D {
  x: number;
  y: number;
  z: number;
}

function projectHeadPoint(head: HeadPose, px: number, py: number, pz: number): Projected3D {
  const alpha = -head.pitch;
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);
  const y1 = py * cosA + pz * sinA;
  const z1 = -py * sinA + pz * cosA;

  const cosY = Math.cos(head.yaw);
  const sinY = Math.sin(head.yaw);
  const x2 = px * cosY + z1 * sinY;
  const z2 = -px * sinY + z1 * cosY;

  const cosR = Math.cos(head.roll);
  const sinR = Math.sin(head.roll);
  return {
    x: head.center.x + x2 * cosR - y1 * sinR,
    y: head.center.y + x2 * sinR + y1 * cosR,
    z: z2,
  };
}

function drawCalyxCup(
  ctx: CanvasRenderingContext2D,
  head: HeadPose,
  palette: SunflowerPalette,
): void {
  const alpha = -head.pitch;
  const cupVisibility = smoothstep(0.16, 0.68, alpha);
  if (cupVisibility <= 0.01) return;

  const r = head.diskRadius * 1.06;
  const rimZ = 0.6;
  const backApex = projectHeadPoint(head, 0, 0, -head.diskRadius * 0.94);
  const neckPt = head.neck;

  const leftRim = projectHeadPoint(head, -r, 0, rimZ);
  const rightRim = projectHeadPoint(head, r, 0, rimZ);
  const frontRim = projectHeadPoint(head, 0, -r * 0.94, rimZ + 0.5);

  const cupPath = new Path2D();
  cupPath.moveTo(leftRim.x, leftRim.y);
  cupPath.quadraticCurveTo(
    lerp(leftRim.x, neckPt.x, 0.54),
    lerp(leftRim.y, backApex.y, 0.78),
    neckPt.x,
    neckPt.y,
  );
  cupPath.quadraticCurveTo(
    lerp(rightRim.x, neckPt.x, 0.54),
    lerp(rightRim.y, backApex.y, 0.78),
    rightRim.x,
    rightRim.y,
  );
  cupPath.quadraticCurveTo(frontRim.x, frontRim.y + 1.5, leftRim.x, leftRim.y);
  cupPath.closePath();

  const cupGrad = ctx.createLinearGradient(neckPt.x, neckPt.y, frontRim.x, frontRim.y + 6);
  cupGrad.addColorStop(0, rgbToCss(lerpRgb(palette.stemBase, palette.sepalFill, 0.45)));
  cupGrad.addColorStop(0.55, rgbToCss(palette.sepalFill));
  cupGrad.addColorStop(1, rgbToCss(lerpRgb(palette.sepalFill, palette.outlineInk, 0.3)));

  ctx.save();
  ctx.globalAlpha = cupVisibility;
  ctx.fillStyle = cupGrad;
  ctx.fill(cupPath);

  ctx.save();
  ctx.clip(cupPath);

  // Subtle colored-pencil ribbing strokes radiating down the calyx dome
  ctx.strokeStyle = rgbToCss(palette.outlineInk, 0.22);
  ctx.lineWidth = 0.58;
  for (let i = -4; i <= 4; i++) {
    const ox = i * 4.4;
    ctx.beginPath();
    ctx.moveTo(neckPt.x + ox * 0.22, neckPt.y);
    ctx.quadraticCurveTo(
      backApex.x + ox * 0.68,
      (neckPt.y + frontRim.y) * 0.5,
      frontRim.x + ox * 1.1,
      frontRim.y + 4,
    );
    ctx.stroke();
  }

  // Soft sunlit highlight along left dome shoulder
  ctx.strokeStyle = rgbToCss(palette.stemHighlight, 0.34);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(neckPt.x - 1.5, neckPt.y + 1);
  ctx.quadraticCurveTo(
    lerp(leftRim.x, neckPt.x, 0.45),
    (neckPt.y + leftRim.y) * 0.52,
    leftRim.x + 4,
    leftRim.y,
  );
  ctx.stroke();
  ctx.restore();

  // Whisper-soft sepia-olive calyx rim
  ctx.strokeStyle = rgbToCss(palette.outlineInk, 0.36);
  ctx.lineWidth = 0.65;
  ctx.stroke(cupPath);
  ctx.restore();
}

function drawCradleBracts(
  ctx: CanvasRenderingContext2D,
  head: HeadPose,
  palette: SunflowerPalette,
): void {
  const visibility = smoothstep(0.3, 0.85, head.bloomOpen);
  if (visibility <= 0.01) return;

  const bractAngles = [Math.PI * 0.92, Math.PI * 0.08, Math.PI * 0.82, Math.PI * 0.18];
  const bractLengths = [1.24, 1.18, 0.94, 0.92];

  ctx.save();
  ctx.globalAlpha = visibility;
  for (let i = 0; i < bractAngles.length; i++) {
    const a = bractAngles[i] ?? 0;
    const lenMul = bractLengths[i] ?? 1;
    const baseR = head.diskRadius * 0.88;
    const tipR = head.diskRadius + head.petalLength * 0.94 * lenMul;
    const halfW = (i < 2 ? 7.2 : 5.4) * visibility;

    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const px = -sa;
    const py = ca;

    const pBase = projectHeadPoint(head, ca * baseR, sa * baseR, -6);
    const pMidL = projectHeadPoint(
      head,
      ca * lerp(baseR, tipR, 0.42) + px * halfW,
      sa * lerp(baseR, tipR, 0.42) + py * halfW,
      -5,
    );
    const pMidR = projectHeadPoint(
      head,
      ca * lerp(baseR, tipR, 0.42) - px * halfW,
      sa * lerp(baseR, tipR, 0.42) - py * halfW,
      -5,
    );
    const pTip = projectHeadPoint(head, ca * tipR, sa * tipR - (i < 2 ? 4 : 1), -4);

    const grad = ctx.createLinearGradient(pBase.x, pBase.y, pTip.x, pTip.y);
    grad.addColorStop(0, rgbToCss(palette.leafShadow));
    grad.addColorStop(0.55, rgbToCss(palette.sepalFill));
    grad.addColorStop(1, rgbToCss(palette.leafHighlight));

    ctx.fillStyle = grad;
    ctx.strokeStyle = rgbToCss(lerpRgb(palette.outlineInk, palette.leafShadow, 0.4), 0.36);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(pBase.x, pBase.y);
    ctx.quadraticCurveTo(pMidL.x, pMidL.y, pTip.x, pTip.y);
    ctx.quadraticCurveTo(pMidR.x, pMidR.y, pBase.x, pBase.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Soft pale central bract vein
    ctx.strokeStyle = rgbToCss(palette.leafVein, 0.48);
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(pBase.x, pBase.y);
    ctx.lineTo(pTip.x, pTip.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSepalItem(
  ctx: CanvasRenderingContext2D,
  head: HeadPose,
  spec: SepalSpec,
  palette: SunflowerPalette,
): void {
  const ca = Math.cos(spec.angle);
  const sa = Math.sin(spec.angle);
  const px = -sa;
  const py = ca;

  const baseR = head.diskRadius * 0.9;
  const sepalLen = lerp(15, 17, head.bloomOpen) * spec.lengthMul;
  const halfW = lerp(4.0, 5.0, head.bloomOpen) * spec.widthMul;
  const outDist = baseR + sepalLen * lerp(0.96, 0.72, head.bloomOpen);
  // Subtle curled dry sepal flare when wilted, hugging the unified calyx-disk rim plane
  const tipZ = lerp(sepalLen * 0.16, -2.5, head.bloomOpen);

  const pBase = projectHeadPoint(head, ca * baseR, sa * baseR, -0.8);
  const pMidL = projectHeadPoint(
    head,
    ca * lerp(baseR, outDist, 0.45) + px * halfW,
    sa * lerp(baseR, outDist, 0.45) + py * halfW,
    -0.4,
  );
  const pMidR = projectHeadPoint(
    head,
    ca * lerp(baseR, outDist, 0.45) - px * halfW,
    sa * lerp(baseR, outDist, 0.45) - py * halfW,
    -0.4,
  );
  const pTip = projectHeadPoint(head, ca * outDist, sa * outDist, tipZ);

  const grad = ctx.createLinearGradient(pBase.x, pBase.y, pTip.x, pTip.y);
  grad.addColorStop(0, rgbToCss(lerpRgb(palette.sepalFill, palette.leafShadow, 0.35)));
  grad.addColorStop(0.65, rgbToCss(palette.sepalFill));
  grad.addColorStop(1, rgbToCss(lerpRgb(palette.sepalFill, palette.leafHighlight, 0.25)));

  ctx.save();
  ctx.fillStyle = grad;
  ctx.strokeStyle = rgbToCss(lerpRgb(palette.outlineInk, palette.leafShadow, 0.35), 0.38);
  ctx.lineWidth = 0.58;
  ctx.beginPath();
  ctx.moveTo(pBase.x, pBase.y);
  ctx.quadraticCurveTo(pMidL.x, pMidL.y, pTip.x, pTip.y);
  ctx.quadraticCurveTo(pMidR.x, pMidR.y, pBase.x, pBase.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPetalItem(
  ctx: CanvasRenderingContext2D,
  head: HeadPose,
  spec: PetalSpec,
  bank: BotanicalSpriteBank,
  petalT: number,
): void {
  const angle = spec.angle + spec.bendBias * head.petalCurl * 0.42;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const px = -sa;
  const py = ca;

  const baseR = head.diskRadius * (spec.ring === 0 ? 0.84 : 0.9);
  const len = head.petalLength * spec.lengthMul;
  const halfW = lerp(4.8, 10.6, head.bloomOpen) * spec.widthMul * (1 - head.petalCurl * 0.24);

  // When wilted & hanging down, upper-front petals curve out and gently downward framing the upper rim
  // of the dark seed disk, while side and back petals flare & hang down in a weathered drooping bell.
  const frontRimMask = clamp01(-sa) * smoothstep(0.28, 1.15, -head.pitch);
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

  const pBaseMid = projectHeadPoint(head, ca * baseR, sa * baseR, baseZ);
  const pMidCenter = projectHeadPoint(head, ca * midOut, sa * midOut, midZ);
  const pMidSide = projectHeadPoint(head, ca * midOut + px * halfW, sa * midOut + py * halfW, midZ);
  const pTip = projectHeadPoint(
    head,
    ca * tipOut + px * curlSide,
    sa * tipOut + py * curlSide,
    tipZ,
  );

  const dx = pTip.x - pBaseMid.x;
  const dy = pTip.y - pBaseMid.y;
  const projLen = Math.hypot(dx, dy);
  if (projLen < 2.2) return;

  const projAngle = Math.atan2(dy, dx);
  // Project transverse width perpendicular to the projected petal axis so 2.5D foreshortening is true
  const axisX = dx / projLen;
  const axisY = dy / projLen;
  const sideDx = pMidSide.x - pMidCenter.x;
  const sideDy = pMidSide.y - pMidCenter.y;
  const projHalfW = Math.max(
    halfW * 0.42,
    Math.hypot(
      sideDx - (sideDx * axisX + sideDy * axisY) * axisX,
      sideDy - (sideDx * axisX + sideDy * axisY) * axisY,
    ),
  );

  const scaleX = (projHalfW / PETAL_HALF_W) * spec.flipX;
  const scaleY = projLen / PETAL_SPAN_Y;

  const ringKey = spec.ring === 0 ? "back" : "front";
  const v = spec.variant;

  // Seamless opaque cross-fade across the 3 pre-baked colored-pencil palette keyframes (0 -> 0.5 -> 1.0)
  let spriteA: HTMLCanvasElement | undefined;
  let spriteB: HTMLCanvasElement | undefined;
  let blend = 0;

  if (petalT <= 0.5) {
    spriteA = bank.petalsWilted[ringKey][v];
    spriteB = bank.petalsMid[ringKey][v];
    blend = clamp01(petalT / 0.5);
  } else {
    spriteA = bank.petalsMid[ringKey][v];
    spriteB = bank.petalsBloom[ringKey][v];
    blend = clamp01((petalT - 0.5) / 0.5);
  }

  if (!spriteA) return;

  ctx.save();
  ctx.translate(pBaseMid.x, pBaseMid.y);
  ctx.rotate(projAngle - Math.PI * 0.5);
  ctx.scale(scaleX, scaleY);

  ctx.drawImage(spriteA, -PETAL_BASE_X, -PETAL_BASE_Y, PETAL_SPRITE_W, PETAL_SPRITE_H);
  if (spriteB && blend > 0.01) {
    ctx.globalAlpha = blend;
    ctx.drawImage(spriteB, -PETAL_BASE_X, -PETAL_BASE_Y, PETAL_SPRITE_W, PETAL_SPRITE_H);
  }
  ctx.restore();
}

function drawSeedDisk(
  ctx: CanvasRenderingContext2D,
  head: HeadPose,
  palette: SunflowerPalette,
  bank: BotanicalSpriteBank,
  diskT: number,
): void {
  const r = head.diskRadius;
  const diskZ = 0.5;
  const p0 = projectHeadPoint(head, 0, 0, diskZ);
  const pX = projectHeadPoint(head, r, 0, diskZ);
  const pY = projectHeadPoint(head, 0, r, diskZ);

  const ux = (pX.x - p0.x) / DISK_RADIUS;
  const uy = (pX.y - p0.y) / DISK_RADIUS;
  let vx = (pY.x - p0.x) / DISK_RADIUS;
  let vy = (pY.y - p0.y) / DISK_RADIUS;

  // Keep only a razor-thin shadowed underside crescent when pitched straight down toward the ground at 0%
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
    blend = clamp01(diskT / 0.5);
  } else {
    spriteA = bank.diskMid;
    spriteB = bank.diskBloom;
    blend = clamp01((diskT - 0.5) / 0.5);
  }

  ctx.save();
  ctx.transform(ux, uy, vx, vy, p0.x, p0.y);

  ctx.drawImage(spriteA, -DISK_CENTER, -DISK_CENTER, DISK_SPRITE_SIZE, DISK_SPRITE_SIZE);
  if (blend > 0.01) {
    ctx.globalAlpha = blend;
    ctx.drawImage(spriteB, -DISK_CENTER, -DISK_CENTER, DISK_SPRITE_SIZE, DISK_SPRITE_SIZE);
  }

  // Soft warm ambient shadow cast across the upper rim when pitched downward under drooping petals
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
): void {
  const { head, phases, hoverHead, dragging } = state;
  const bank = getBotanicalSpriteBank();
  if (!bank) return;

  // Barely-there warm sunlit lift when hovering or dragging (no sharp UI halo)
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

  const petalT = clamp01(phases.warmth * 0.22 + phases.bloom * 0.78);
  const diskT = clamp01(phases.headLift * 0.36 + phases.bloom * 0.64);

  // Strict botanical layering in static, frame-invariant radial order so petals never pop in breeze.
  drawCalyxCup(ctx, head, palette);
  drawCradleBracts(ctx, head, palette);

  for (let i = 0; i < SEPAL_SPECS.length; i++) {
    const spec = SEPAL_SPECS[i];
    if (spec) drawSepalItem(ctx, head, spec, palette);
  }

  for (let i = 0; i < BACK_PETAL_SPECS.length; i++) {
    const spec = BACK_PETAL_SPECS[i];
    if (spec) drawPetalItem(ctx, head, spec, bank, petalT);
  }

  for (let i = 0; i < FRONT_PETAL_SPECS.length; i++) {
    const spec = FRONT_PETAL_SPECS[i];
    if (spec) drawPetalItem(ctx, head, spec, bank, petalT);
  }

  drawSeedDisk(ctx, head, palette, bank, diskT);
}

export function paintSunflower(
  ctx: CanvasRenderingContext2D,
  state: SunflowerSimState,
  palette: SunflowerPalette,
  cardPath: Path2D,
): void {
  const { stem, leaves, phases } = state;
  const vitality = clamp01(phases.warmth * 0.42 + phases.leafUnfurl * 0.58);

  const backLeaves: LeafPose[] = [];
  const frontLeaves: LeafPose[] = [];
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    if (!leaf) continue;
    if (leaf.zOrder <= 0) backLeaves.push(leaf);
    else frontLeaves.push(leaf);
  }
  backLeaves.sort((a, b) => a.zOrder - b.zOrder || a.stemT - b.stemT);
  frontLeaves.sort((a, b) => a.zOrder - b.zOrder || a.stemT - b.stemT);

  for (let i = 0; i < backLeaves.length; i++) {
    const leaf = backLeaves[i];
    if (leaf) drawLeaf(ctx, leaf, palette, cardPath, vitality);
  }

  drawStem(ctx, stem, palette);

  for (let i = 0; i < frontLeaves.length; i++) {
    const leaf = frontLeaves[i];
    if (leaf) drawLeaf(ctx, leaf, palette, cardPath, vitality);
  }

  drawSunflowerHead(ctx, state, palette);
}
