import type { PhasedProgress, RGB, SunflowerPalette } from "./types";

export function clamp(x: number, min: number, max: number): number {
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Blended linear + smoothstep curve so endpoints retain non-zero slope
 * (eliminating dead visual plateaus near 0% and 100%).
 */
function softEase(edge0: number, edge1: number, x: number, linearWeight = 0.48): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  const smooth = t * t * (3 - 2 * t);
  return lerp(smooth, t, linearWeight);
}

export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMin === inMax) return outMin;
  const t = clamp01((value - inMin) / (inMax - inMin));
  return lerp(outMin, outMax, t);
}

export function computePhasedProgress(v: number): PhasedProgress {
  const raw = clamp01(v);
  // Every channel stays visibly responsive across its active range (including 0-15% and 80-100%)
  const warmth = clamp01(
    softEase(0.0, 0.45, raw, 0.5) * 0.35 + softEase(0.0, 1.0, raw, 0.5) * 0.65,
  );
  const stemUncurl = softEase(0.0, 1.0, raw, 0.55);
  const stemGrow = softEase(0.0, 1.0, raw, 0.7);
  const headLift = softEase(0.0, 1.0, raw, 0.65);
  const leafUnfurl = clamp01(
    softEase(0.0, 1.0, raw, 0.48) * 0.8 + softEase(0.12, 1.0, raw, 0.42) * 0.2,
  );
  const bloom = clamp01(raw * 0.12 + softEase(0.18, 1.0, raw, 0.45) * 0.88);
  const wildflower = softEase(0.45, 1.0, raw, 0.45);
  const ecosystem = softEase(0.58, 1.0, raw, 0.45);

  return {
    raw,
    warmth,
    stemUncurl,
    stemGrow,
    headLift,
    leafUnfurl,
    bloom,
    wildflower,
    ecosystem,
  };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashInt(n: number): number {
  let x = (n | 0) ^ 0x27d4eb2d;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x = x ^ (x >>> 16);
  return ((x >>> 0) / 4294967295) * 2 - 1;
}

export function valueNoise1D(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return lerp(hashInt(i), hashInt(i + 1), u);
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

function lerpRgb3(a: RGB, b: RGB, c: RGB, t: number, midAt = 0.5): RGB {
  const k = clamp01(t);
  if (k <= midAt) {
    return lerpRgb(a, b, midAt > 0 ? k / midAt : 1);
  }
  return lerpRgb(b, c, midAt < 1 ? (k - midAt) / (1 - midAt) : 1);
}

export function rgbToCss(c: RGB, alpha?: number): string {
  const r = Math.round(clamp(c.r, 0, 255));
  const g = Math.round(clamp(c.g, 0, 255));
  const b = Math.round(clamp(c.b, 0, 255));
  if (alpha === undefined || alpha >= 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  const a = clamp01(alpha);
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(4))})`;
}

// Soft pastel children's-book colored-pencil palette (warm chalky tones, zero pure black or neon)
const PAPER_BG: RGB = { r: 245, g: 242, b: 234 };

// Sky: 0% dusty taupe-grey -> 50% misty sage-blue -> 100% powder pastel cerulean
const SKY_TOP_0: RGB = { r: 163, g: 161, b: 152 }; // #a3a198
const SKY_TOP_MID: RGB = { r: 184, g: 209, b: 212 }; // #b8d1d4
const SKY_TOP_1: RGB = { r: 160, g: 209, b: 226 }; // #a0d1e2

const SKY_MID_0: RGB = { r: 204, g: 199, b: 186 }; // #ccc7ba
const SKY_MID_MID: RGB = { r: 220, g: 230, b: 223 }; // #dce6df
const SKY_MID_1: RGB = { r: 201, g: 230, b: 236 }; // #c9e6ec

const SKY_HORIZON_0: RGB = { r: 229, g: 217, b: 191 }; // #e5d9bf
const SKY_HORIZON_MID: RGB = { r: 241, g: 230, b: 204 }; // #f1e6cc
const SKY_HORIZON_1: RGB = { r: 244, g: 235, b: 209 }; // #f4ebd1

const CLOUD_0: RGB = { r: 222, g: 217, b: 205 };
const CLOUD_1: RGB = { r: 246, g: 248, b: 247 };

const SUN_GLOW_0: RGB = { r: 236, g: 225, b: 200 };
const SUN_GLOW_1: RGB = { r: 248, g: 234, b: 186 };

// Meadow grass & dry twigs: muted straw-ochre -> soft botanical moss-sage
const GRASS_BACK_0: RGB = { r: 179, g: 159, b: 125 };
const GRASS_BACK_MID: RGB = { r: 158, g: 169, b: 113 };
const GRASS_BACK_1: RGB = { r: 151, g: 179, b: 104 };

const GRASS_MID_0: RGB = { r: 142, g: 120, b: 85 };
const GRASS_MID_MID: RGB = { r: 119, g: 139, b: 78 };
const GRASS_MID_1: RGB = { r: 108, g: 146, b: 68 };

const GRASS_FRONT_0: RGB = { r: 105, g: 86, b: 60 };
const GRASS_FRONT_MID: RGB = { r: 85, g: 104, b: 56 };
const GRASS_FRONT_1: RGB = { r: 69, g: 106, b: 44 };

const TWIG_0: RGB = { r: 93, g: 75, b: 55 };
const TWIG_1: RGB = { r: 115, g: 92, b: 64 };

// Stem: dry warm straw-bark -> soft colored-pencil sage-moss green
const STEM_BASE_0: RGB = { r: 150, g: 129, b: 98 };
const STEM_BASE_MID: RGB = { r: 126, g: 142, b: 82 };
const STEM_BASE_1: RGB = { r: 115, g: 154, b: 68 };

const STEM_HI_0: RGB = { r: 195, g: 178, b: 147 };
const STEM_HI_MID: RGB = { r: 172, g: 186, b: 116 };
const STEM_HI_1: RGB = { r: 166, g: 194, b: 108 };

const STEM_OUTLINE_0: RGB = { r: 97, g: 81, b: 62 };
const STEM_OUTLINE_1: RGB = { r: 72, g: 99, b: 45 };

// Leaves: dried warm chestnut/dusty olive -> botanical sage/olive/moss colored-pencil greens
const LEAF_BASE_0: RGB = { r: 125, g: 104, b: 73 };
const LEAF_BASE_MID: RGB = { r: 116, g: 138, b: 72 };
const LEAF_BASE_1: RGB = { r: 107, g: 150, b: 63 }; // #6b963f

const LEAF_SHADOW_0: RGB = { r: 87, g: 73, b: 52 };
const LEAF_SHADOW_MID: RGB = { r: 78, g: 98, b: 49 };
const LEAF_SHADOW_1: RGB = { r: 68, g: 104, b: 43 }; // #44682b

const LEAF_HI_0: RGB = { r: 164, g: 141, b: 103 };
const LEAF_HI_MID: RGB = { r: 154, g: 172, b: 96 };
const LEAF_HI_1: RGB = { r: 149, g: 184, b: 85 }; // #95b855

const LEAF_VEIN_0: RGB = { r: 150, g: 128, b: 92 };
const LEAF_VEIN_1: RGB = { r: 183, g: 204, b: 118 }; // #b7cc76

const SEPAL_0: RGB = { r: 108, g: 92, b: 62 };
const SEPAL_1: RGB = { r: 95, g: 133, b: 57 };

// Petals: dry dusty sepia-ochre -> warm pastel ochre-gold & buttercup yellow
const PETAL_INNER_0: RGB = { r: 124, g: 95, b: 56 };
const PETAL_INNER_MID: RGB = { r: 184, g: 123, b: 47 };
const PETAL_INNER_1: RGB = { r: 212, g: 130, b: 36 }; // #d48224

const PETAL_OUTER_0: RGB = { r: 153, g: 121, b: 76 };
const PETAL_OUTER_MID: RGB = { r: 215, g: 166, b: 69 };
const PETAL_OUTER_1: RGB = { r: 240, g: 190, b: 56 }; // #f0be38

const PETAL_TIP_0: RGB = { r: 181, g: 149, b: 100 };
const PETAL_TIP_MID: RGB = { r: 232, g: 199, b: 107 };
const PETAL_TIP_1: RGB = { r: 248, g: 221, b: 114 }; // #f8dd72

const PETAL_SHADOW_0: RGB = { r: 92, g: 68, b: 40 };
const PETAL_SHADOW_MID: RGB = { r: 152, g: 95, b: 36 };
const PETAL_SHADOW_1: RGB = { r: 186, g: 107, b: 29 }; // #ba6b1d

// Seed disk: warm charcoal-sepia -> olive-moss center, honey-ochre mid, soft umber rim
const DISK_CENTER_0: RGB = { r: 62, g: 50, b: 36 };
const DISK_CENTER_1: RGB = { r: 74, g: 93, b: 41 };

const DISK_MID_0: RGB = { r: 95, g: 75, b: 52 };
const DISK_MID_1: RGB = { r: 194, g: 138, b: 48 };

const DISK_EDGE_0: RGB = { r: 56, g: 42, b: 28 };
const DISK_EDGE_1: RGB = { r: 92, g: 59, b: 30 };

// Delicate warm sepia-graphite pencil contour (never pure black)
const OUTLINE_INK_0: RGB = { r: 94, g: 80, b: 65 }; // #5e5041
const OUTLINE_INK_MID: RGB = { r: 87, g: 75, b: 57 }; // #574b39
const OUTLINE_INK_1: RGB = { r: 77, g: 71, b: 50 }; // #4d4732

export function getPalette(phases: PhasedProgress): SunflowerPalette {
  const skyT = clamp01(phases.warmth * 0.65 + phases.stemGrow * 0.35);
  const meadowT = clamp01(phases.warmth * 0.5 + phases.leafUnfurl * 0.5);
  const foliageT = clamp01(phases.warmth * 0.4 + phases.leafUnfurl * 0.6);
  const petalT = clamp01(phases.warmth * 0.22 + phases.bloom * 0.78);
  const diskT = clamp01(phases.headLift * 0.35 + phases.bloom * 0.65);

  return {
    skyTop: lerpRgb3(SKY_TOP_0, SKY_TOP_MID, SKY_TOP_1, skyT, 0.5),
    skyMid: lerpRgb3(SKY_MID_0, SKY_MID_MID, SKY_MID_1, skyT, 0.5),
    skyHorizon: lerpRgb3(SKY_HORIZON_0, SKY_HORIZON_MID, SKY_HORIZON_1, skyT, 0.5),
    cloudFill: lerpRgb(CLOUD_0, CLOUD_1, skyT),
    sunGlow: lerpRgb(SUN_GLOW_0, SUN_GLOW_1, clamp01(phases.warmth * 0.4 + phases.ecosystem * 0.6)),
    grassBack: lerpRgb3(GRASS_BACK_0, GRASS_BACK_MID, GRASS_BACK_1, meadowT, 0.5),
    grassMid: lerpRgb3(GRASS_MID_0, GRASS_MID_MID, GRASS_MID_1, meadowT, 0.5),
    grassFront: lerpRgb3(GRASS_FRONT_0, GRASS_FRONT_MID, GRASS_FRONT_1, meadowT, 0.5),
    twigColor: lerpRgb(TWIG_0, TWIG_1, meadowT),
    stemBase: lerpRgb3(STEM_BASE_0, STEM_BASE_MID, STEM_BASE_1, foliageT, 0.5),
    stemHighlight: lerpRgb3(STEM_HI_0, STEM_HI_MID, STEM_HI_1, foliageT, 0.5),
    stemOutline: lerpRgb(STEM_OUTLINE_0, STEM_OUTLINE_1, foliageT),
    leafBase: lerpRgb3(LEAF_BASE_0, LEAF_BASE_MID, LEAF_BASE_1, foliageT, 0.48),
    leafShadow: lerpRgb3(LEAF_SHADOW_0, LEAF_SHADOW_MID, LEAF_SHADOW_1, foliageT, 0.48),
    leafHighlight: lerpRgb3(LEAF_HI_0, LEAF_HI_MID, LEAF_HI_1, foliageT, 0.48),
    leafVein: lerpRgb(LEAF_VEIN_0, LEAF_VEIN_1, foliageT),
    sepalFill: lerpRgb(SEPAL_0, SEPAL_1, foliageT),
    petalInner: lerpRgb3(PETAL_INNER_0, PETAL_INNER_MID, PETAL_INNER_1, petalT, 0.5),
    petalOuter: lerpRgb3(PETAL_OUTER_0, PETAL_OUTER_MID, PETAL_OUTER_1, petalT, 0.5),
    petalTip: lerpRgb3(PETAL_TIP_0, PETAL_TIP_MID, PETAL_TIP_1, petalT, 0.5),
    petalShadow: lerpRgb3(PETAL_SHADOW_0, PETAL_SHADOW_MID, PETAL_SHADOW_1, petalT, 0.5),
    diskCenter: lerpRgb(DISK_CENTER_0, DISK_CENTER_1, diskT),
    diskMid: lerpRgb(DISK_MID_0, DISK_MID_1, diskT),
    diskEdge: lerpRgb(DISK_EDGE_0, DISK_EDGE_1, diskT),
    outlineInk: lerpRgb3(OUTLINE_INK_0, OUTLINE_INK_MID, OUTLINE_INK_1, phases.raw, 0.5),
    paperBg: PAPER_BG,
  };
}
