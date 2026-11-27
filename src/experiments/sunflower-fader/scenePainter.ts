import { clamp01, lerp, lerpRgb, mulberry32, rgbToCss, smoothstep } from "./colorAndCurves";
import { getPaperTextures } from "./paperTextures";
import {
  BLEED_X,
  BLEED_Y,
  CARD_HEIGHT,
  CARD_WIDTH,
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
  shade: number;
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
    tufts.push({
      xFrac,
      height: (isFront ? 28 + rng() * 54 : 44 + rng() * 74) * edgeLift,
      lean: (xFrac - 0.5) * 0.3 + (rng() - 0.5) * 0.52,
      thickness: 0.65 + rng() * 0.85,
      shade: rng(),
      layer: isFront ? "front" : "mid",
      phase: rng() * Math.PI * 2,
    });
  }
  return tufts;
})();

const pastelPatternCache = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>();

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

interface SkyBackdropCache {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  value: number;
}

let skyBackdropCache: SkyBackdropCache | null = null;

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

function getCachedSkyBackdrop(
  displayValue: number,
  warmth: number,
  palette: SunflowerPalette,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  if (!skyBackdropCache) {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_WIDTH * 2;
    canvas.height = CARD_HEIGHT * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    skyBackdropCache = { canvas, ctx, value: -1 };
  }

  if (skyBackdropCache.value < 0 || Math.abs(displayValue - skyBackdropCache.value) > 0.2) {
    const { ctx } = skyBackdropCache;
    ctx.save();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    paintSkyBackdropInto(ctx, 0, 0, warmth, palette);
    ctx.restore();
    skyBackdropCache.value = displayValue;
  }

  return skyBackdropCache.canvas;
}

function getPastelPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (pastelPatternCache.has(ctx)) {
    return pastelPatternCache.get(ctx) ?? null;
  }
  const { pastelGrainTile } = getPaperTextures();
  const pat = pastelGrainTile.width ? ctx.createPattern(pastelGrainTile, "repeat") : null;
  pastelPatternCache.set(ctx, pat);
  return pat;
}

function sampleSkyColor(palette: SunflowerPalette, yFrac: number): RGB {
  if (yFrac <= 0.45) {
    return lerpRgb(palette.skyTop, palette.skyMid, yFrac / 0.45);
  }
  if (yFrac <= 0.82) {
    return lerpRgb(palette.skyMid, palette.skyHorizon, (yFrac - 0.45) / 0.37);
  }
  return lerpRgb(palette.skyHorizon, palette.paperBg, ((yFrac - 0.82) / 0.18) * 0.24);
}

export function paintSkyAndAtmosphere(
  ctx: CanvasRenderingContext2D,
  state: SunflowerSimState,
  palette: SunflowerPalette,
): void {
  const { phases, clouds } = state;

  const skyBackdrop = getCachedSkyBackdrop(state.displayValue, phases.warmth, palette);
  if (skyBackdrop) {
    ctx.drawImage(skyBackdrop, BLEED_X, BLEED_Y, CARD_WIDTH, CARD_HEIGHT);
  } else {
    paintSkyBackdropInto(ctx, BLEED_X, BLEED_Y, phases.warmth, palette);
  }

  // Dreamy hand-rubbed pastel clouds (soft irregular chalky puffs, never crisp vector ovals)
  ctx.save();
  for (let i = 0; i < clouds.length; i++) {
    const cloud = clouds[i];
    if (!cloud || cloud.opacity <= 0.02) continue;

    const puffs = getCloudPuffs(cloud.seed);
    const baseAlpha = cloud.opacity * lerp(0.2, 0.44, phases.warmth);
    const warmUnder = lerpRgb(palette.cloudFill, palette.skyHorizon, 0.35);

    for (let p = 0; p < puffs.length; p++) {
      const puff = puffs[p];
      if (!puff) continue;
      const px = cloud.x + puff.frac * cloud.width * 0.84 + puff.dxJitter;
      const py = cloud.y + puff.dyJitter * cloud.height - Math.abs(puff.frac) * 2.5;
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

    // Feathery horizontal chalky pastel highlights gently smudged across each cloud
    ctx.lineCap = "round";
    for (let s = 0; s < 4; s++) {
      const sy = cloud.y + (s - 1.5) * cloud.height * 0.22;
      const halfW = cloud.width * (0.4 - Math.abs(s - 1.5) * 0.06);
      const wGrad = ctx.createLinearGradient(cloud.x - halfW, sy, cloud.x + halfW, sy);
      wGrad.addColorStop(0, rgbToCss(palette.cloudFill, 0));
      wGrad.addColorStop(0.5, rgbToCss(palette.cloudFill, baseAlpha * 0.34));
      wGrad.addColorStop(1, rgbToCss(palette.cloudFill, 0));
      ctx.strokeStyle = wGrad;
      ctx.lineWidth = 2.4 - Math.abs(s - 1.5) * 0.4;
      ctx.beginPath();
      ctx.moveTo(cloud.x - halfW, sy);
      ctx.quadraticCurveTo(cloud.x, sy - 1.6, cloud.x + halfW, sy + 0.6);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Subtle creamy pastoral sunlight warmth radiating behind the blooming flower
  if (phases.bloom > 0.22) {
    const sunStrength = smoothstep(0.22, 1.0, phases.bloom);
    const sunX = BLEED_X + CARD_WIDTH * 0.5;
    const sunY = BLEED_Y + CARD_HEIGHT * 0.2;

    ctx.save();
    const glowGrad = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, CARD_WIDTH * 0.96);
    glowGrad.addColorStop(0, rgbToCss(palette.sunGlow, sunStrength * 0.28));
    glowGrad.addColorStop(0.48, rgbToCss(palette.sunGlow, sunStrength * 0.11));
    glowGrad.addColorStop(1, rgbToCss(palette.sunGlow, 0));
    ctx.fillStyle = glowGrad;
    ctx.fillRect(BLEED_X, BLEED_Y, CARD_WIDTH, CARD_HEIGHT);

    // Whisper-soft warm light shafts angling gently from upper-left
    const rayAlpha = sunStrength * 0.042;
    for (let r = 0; r < 3; r++) {
      const originX = BLEED_X + CARD_WIDTH * (0.14 + r * 0.28);
      const spread = 28 + r * 8;
      const endX = originX + 52 + r * 14;
      const rayGrad = ctx.createLinearGradient(
        originX,
        BLEED_Y,
        endX,
        BLEED_Y + CARD_HEIGHT * 0.68,
      );
      rayGrad.addColorStop(0, rgbToCss(palette.sunGlow, rayAlpha));
      rayGrad.addColorStop(0.55, rgbToCss(palette.sunGlow, rayAlpha * 0.4));
      rayGrad.addColorStop(1, rgbToCss(palette.sunGlow, 0));
      ctx.fillStyle = rayGrad;
      ctx.beginPath();
      ctx.moveTo(originX - spread * 0.35, BLEED_Y);
      ctx.lineTo(originX + spread * 0.35, BLEED_Y);
      ctx.lineTo(endX + spread * 0.9, BLEED_Y + CARD_HEIGHT * 0.68);
      ctx.lineTo(endX - spread * 0.45, BLEED_Y + CARD_HEIGHT * 0.68);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawTaperedPencilBlade(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  midX: number,
  midY: number,
  tipX: number,
  tipY: number,
  halfW: number,
  baseCol: RGB,
  tipCol: RGB,
  alpha: number,
): void {
  const grad = ctx.createLinearGradient(bx, by, tipX, tipY);
  grad.addColorStop(0, rgbToCss(baseCol, alpha));
  grad.addColorStop(0.58, rgbToCss(lerpRgb(baseCol, tipCol, 0.45), alpha * 0.94));
  grad.addColorStop(1, rgbToCss(tipCol, alpha * 0.78));

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(bx - halfW, by);
  ctx.quadraticCurveTo(midX - halfW * 0.42, midY, tipX, tipY);
  ctx.quadraticCurveTo(midX + halfW * 0.36, midY + 0.8, bx + halfW, by);
  ctx.closePath();
  ctx.fill();
}

function drawGrassBlade(
  ctx: CanvasRenderingContext2D,
  blade: GrassBlade,
  baseColor: RGB,
  tipTint: RGB,
  shadowTint: RGB,
  vitality: number,
): void {
  const rng = mulberry32(blade.seed);
  const dryWheat: RGB = { r: 196, g: 172, b: 126 };
  const dryUmber: RGB = { r: 118, g: 96, b: 68 };
  const warmOchre: RGB = { r: 176, g: 146, b: 86 };
  const softSage: RGB = { r: 136, g: 162, b: 92 };

  const tonePick = rng();
  let mainBase = baseColor;
  let mainTip = tipTint;

  // Varied storybook colored-pencil grass tones (wheat, umber, ochre, sage, moss)
  if (tonePick < 0.24) {
    mainBase = lerpRgb(baseColor, lerpRgb(dryWheat, softSage, vitality), 0.42);
    mainTip = lerpRgb(tipTint, dryWheat, 0.36 * (1 - vitality * 0.55));
  } else if (tonePick < 0.46) {
    mainBase = lerpRgb(baseColor, lerpRgb(dryUmber, shadowTint, vitality), 0.38);
    mainTip = lerpRgb(tipTint, warmOchre, 0.32 * (1 - vitality * 0.4));
  } else if (tonePick < 0.68) {
    mainBase = lerpRgb(baseColor, warmOchre, 0.28 * (1 - vitality * 0.5));
  }

  const bx = blade.baseX;
  const by = blade.baseY;
  const h = blade.height * lerp(0.86, 1.04, vitality);
  const angle = blade.lean + blade.bend;
  const dx = Math.sin(angle) * h;
  const dy = -Math.cos(angle * 0.74) * h;

  const midX = bx + dx * 0.44 + blade.bend * h * 0.14;
  const midY = by + dy * 0.54;
  const tipX = bx + dx + blade.bend * h * 0.34;
  const tipY = by + dy;

  // Slender botanical pencil blade (NO thick cartoon wedge, NO dark black outline!)
  const halfW = Math.min(1.15, blade.thickness * 0.36);
  const mainAlpha = blade.layer === "back" ? 0.72 : blade.layer === "mid" ? 0.84 : 0.9;

  drawTaperedPencilBlade(
    ctx,
    bx,
    by,
    midX,
    midY,
    tipX,
    tipY,
    halfW,
    lerpRgb(mainBase, shadowTint, 0.25),
    mainTip,
    mainAlpha,
  );

  // Delicate companion colored-pencil whisper stroke for dense storybook sketchbook cross-hatching
  const companionOffset = (rng() - 0.5) * 4.4;
  const companionHeight = h * (0.62 + rng() * 0.46);
  const companionAngle = angle + (rng() - 0.5) * 0.34;
  const cdx = Math.sin(companionAngle) * companionHeight;
  const cdy = -Math.cos(companionAngle * 0.76) * companionHeight;
  const cbx = bx + companionOffset;
  const cmidX = cbx + cdx * 0.46 + blade.bend * companionHeight * 0.12;
  const cmidY = by + cdy * 0.55;
  const ctipX = cbx + cdx + blade.bend * companionHeight * 0.28;
  const ctipY = by + cdy;

  const compCol =
    rng() > 0.5 ? lerpRgb(mainBase, shadowTint, 0.36) : lerpRgb(mainTip, dryWheat, 0.25);
  ctx.strokeStyle = rgbToCss(compCol, mainAlpha * 0.68);
  ctx.lineWidth = 0.55 + rng() * 0.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cbx, by);
  ctx.quadraticCurveTo(cmidX, cmidY, ctipX, ctipY);
  ctx.stroke();

  // Subtle sunlit highlight hair-stroke along upper half of foreground/mid blades
  if (blade.layer !== "back" && rng() > 0.44) {
    ctx.strokeStyle = rgbToCss(lerpRgb(mainTip, palettePaperHint(vitality), 0.3), 0.34);
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(lerp(bx, midX, 0.35), lerp(by, midY, 0.35));
    ctx.quadraticCurveTo(midX - 0.4, midY, tipX, tipY);
    ctx.stroke();
  }

  // Grounding dark-moss / burnt-umber base accent stroke for richer sketchbook undergrowth density
  if (blade.layer !== "back") {
    const baseOff = (rng() - 0.5) * 5.2;
    const baseH = h * (0.38 + rng() * 0.34);
    const baseAng = angle + (rng() - 0.5) * 0.44;
    const bdx = Math.sin(baseAng) * baseH;
    const bdy = -Math.cos(baseAng * 0.78) * baseH;
    const deepGround = lerpRgb({ r: 74, g: 56, b: 36 }, { r: 36, g: 72, b: 28 }, vitality);
    ctx.strokeStyle = rgbToCss(lerpRgb(mainBase, deepGround, 0.62), mainAlpha * 0.76);
    ctx.lineWidth = 0.75 + rng() * 0.55;
    ctx.beginPath();
    ctx.moveTo(bx + baseOff, by);
    ctx.quadraticCurveTo(bx + baseOff + bdx * 0.45, by + bdy * 0.52, bx + baseOff + bdx, by + bdy);
    ctx.stroke();
  }
}

function palettePaperHint(vitality: number): RGB {
  return lerpRgb({ r: 232, g: 220, b: 192 }, { r: 224, g: 236, b: 162 }, vitality);
}

function drawBranchingTwig(
  ctx: CanvasRenderingContext2D,
  blade: GrassBlade,
  palette: SunflowerPalette,
  vitality: number,
): void {
  const rng = mulberry32(blade.seed);
  // Delicate sepia-umber twigs prominent at 0%, softly receding into lush meadow at 100%
  const alpha = blade.layer === "front" ? lerp(0.76, 0.56, vitality) : lerp(0.68, 0.46, vitality);
  const twigInk = lerpRgb(palette.twigColor, palette.outlineInk, 0.22);

  const segs = 5;
  const stepLen = blade.height / segs;
  let cx = blade.baseX;
  let cy = blade.baseY;
  let curAngle = blade.lean + blade.bend * 0.45;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = rgbToCss(twigInk, alpha);

  for (let s = 0; s < segs; s++) {
    const frac = s / segs;
    curAngle += (rng() - 0.5) * 0.24 + blade.bend * 0.12;
    const nx = cx + Math.sin(curAngle) * stepLen;
    const ny = cy - Math.cos(curAngle) * stepLen;

    ctx.lineWidth = Math.max(0.45, blade.thickness * 0.62 * (1 - frac * 0.65));
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.stroke();

    // Delicate forked dry sub-twigs matching the storybook right/left undergrowth
    if (s >= 1) {
      const forks = s === segs - 1 ? 2 : 1;
      for (let f = 0; f < forks; f++) {
        const side = (s + f) % 2 === 0 ? 1 : -1;
        const branchAngle = curAngle + side * (0.42 + rng() * 0.46);
        const branchLen = stepLen * (0.64 + rng() * 0.6) * (1 - frac * 0.25);
        const midBx = cx + Math.sin(branchAngle) * branchLen * 0.52;
        const midBy = cy - Math.cos(branchAngle) * branchLen * 0.52;
        const endBx = cx + Math.sin(branchAngle + side * 0.15) * branchLen;
        const endBy = cy - Math.cos(branchAngle + side * 0.15) * branchLen;

        ctx.lineWidth = Math.max(0.4, blade.thickness * 0.42 * (1 - frac * 0.45));
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(midBx, midBy, endBx, endBy);
        ctx.stroke();

        if (rng() > 0.36) {
          const tinyAngle = branchAngle - side * (0.34 + rng() * 0.34);
          const tinyLen = branchLen * 0.44;
          ctx.lineWidth = 0.42;
          ctx.beginPath();
          ctx.moveTo(midBx, midBy);
          ctx.lineTo(midBx + Math.sin(tinyAngle) * tinyLen, midBy - Math.cos(tinyAngle) * tinyLen);
          ctx.stroke();
        }

        // Tiny soft dry seed-bud dab at twig tip
        ctx.fillStyle = rgbToCss(
          lerpRgb(twigInk, palette.petalInner, vitality * 0.28),
          alpha * 0.72,
        );
        ctx.beginPath();
        ctx.arc(endBx, endBy, 0.85 + rng() * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    cx = nx;
    cy = ny;
  }
  ctx.restore();
}

function drawMeadowWeed(
  ctx: CanvasRenderingContext2D,
  blade: GrassBlade,
  palette: SunflowerPalette,
  vitality: number,
  wildflower: number,
): void {
  const rng = mulberry32(blade.seed);
  const bx = blade.baseX;
  const by = blade.baseY;
  const h = blade.height * lerp(0.9, 1.04, vitality);
  const angle = blade.lean + blade.bend;
  const tipX = bx + Math.sin(angle) * h;
  const tipY = by - Math.cos(angle) * h;
  const ctrlX = bx + Math.sin(angle * 0.58) * h * 0.48;
  const ctrlY = by - Math.cos(angle * 0.48) * h * 0.56;

  const stalkCol = lerpRgb(palette.twigColor, palette.grassMid, vitality * 0.76);
  const podBaseCol = lerpRgb(
    { r: 158, g: 132, b: 86 },
    lerpRgb(palette.leafBase, palette.petalOuter, wildflower * 0.38),
    vitality,
  );

  ctx.save();
  ctx.strokeStyle = rgbToCss(stalkCol, 0.74);
  ctx.lineWidth = 0.85;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
  ctx.stroke();

  // Soft pastel-dabbed dried seed pods / herb florets along upper stalk (NO cartoon outlines!)
  const count = 7;
  for (let i = 0; i < count; i++) {
    const t = 0.32 + (i / (count - 1)) * 0.64;
    const mt = 1 - t;
    const px = mt * mt * bx + 2 * mt * t * ctrlX + t * t * tipX;
    const py = mt * mt * by + 2 * mt * t * ctrlY + t * t * tipY;
    const side = i % 2 === 0 ? -1 : 1;
    const podLen = (3.8 + rng() * 3.4) * (1 - t * 0.3) * lerp(0.86, 1.15, vitality);
    const podAngle = angle + side * lerp(1.02, 0.7, vitality) + (rng() - 0.5) * 0.24;
    const ex = px + Math.sin(podAngle) * podLen;
    const ey = py - Math.cos(podAngle) * podLen + lerp(1.5, -0.4, vitality);
    const cx = (px + ex) * 0.5;
    const cy = (py + ey) * 0.5;
    const rot = Math.atan2(ey - py, ex - px);

    const col = lerpRgb(podBaseCol, palette.petalTip, rng() * 0.38 * wildflower);
    ctx.fillStyle = rgbToCss(col, 0.8);
    ctx.beginPath();
    ctx.ellipse(cx, cy, podLen * 0.54, podLen * lerp(0.28, 0.38, vitality), rot, 0, Math.PI * 2);
    ctx.fill();

    // Whisper-soft warm pencil shadow tuck on underside of floret
    ctx.strokeStyle = rgbToCss(lerpRgb(palette.outlineInk, podBaseCol, 0.45), 0.3);
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWildflowerStem(
  ctx: CanvasRenderingContext2D,
  blade: GrassBlade,
  palette: SunflowerPalette,
  vitality: number,
  wildflower: number,
): void {
  const rng = mulberry32(blade.seed);
  const bx = blade.baseX;
  const by = blade.baseY;
  const h = blade.height * lerp(0.84, 1.04, vitality);
  const angle = blade.lean + blade.bend * 0.88;
  const ctrlX = bx + Math.sin(angle * 0.54) * h * 0.46;
  const ctrlY = by - Math.cos(angle * 0.46) * h * 0.54;
  const tipX = bx + Math.sin(angle) * h;
  const tipY = by - Math.cos(angle) * h;

  const stemColor = lerpRgb(palette.grassMid, palette.stemBase, vitality * 0.65);

  ctx.save();
  ctx.strokeStyle = rgbToCss(stemColor, 0.72);
  ctx.lineWidth = 0.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
  ctx.stroke();

  const localBloom = smoothstep(
    blade.bloomThreshold - 0.16,
    blade.bloomThreshold + 0.08,
    wildflower,
  );

  if (localBloom <= 0.04) {
    // Delicate dry unopened bud at low values
    ctx.fillStyle = rgbToCss(lerpRgb(palette.twigColor, palette.grassBack, 0.35), 0.56);
    ctx.beginPath();
    ctx.ellipse(tipX, tipY + 1.2, 1.4, 2.4, angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Storybook pastel-dabbed wildflower cluster (buttercup, apricot, pale cream — ZERO harsh outlines!)
  const warmMix = clamp01((blade.flowerHue - 34) / 22);
  const apricot: RGB = { r: 238, g: 162, b: 92 };
  const buttercup: RGB = lerpRgb(palette.petalOuter, palette.petalTip, 0.45);
  const cream: RGB = { r: 250, g: 242, b: 210 };

  const primaryCol =
    warmMix < 0.35
      ? lerpRgb(apricot, buttercup, warmMix / 0.35)
      : warmMix < 0.78
        ? buttercup
        : lerpRgb(buttercup, cream, (warmMix - 0.78) / 0.22);
  const centerCol = lerpRgb(palette.petalShadow, palette.diskEdge, 0.45);
  const flowerR = (3.4 + rng() * 2.4) * localBloom;

  ctx.translate(tipX, tipY);
  ctx.rotate(angle * 0.3);

  // Soft powdery watercolor halo behind blossom
  const halo = ctx.createRadialGradient(0, 0, 0.3, 0, 0, flowerR * 1.45);
  halo.addColorStop(0, rgbToCss(primaryCol, 0.32 * localBloom));
  halo.addColorStop(1, rgbToCss(primaryCol, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, flowerR * 1.45, 0, Math.PI * 2);
  ctx.fill();

  // Loose hand-dabbed pastel petals (slightly irregular, soft translucent overlap)
  const petalCount = 4 + (blade.id % 2);
  for (let p = 0; p < petalCount; p++) {
    const a = (p / petalCount) * Math.PI * 2 + (rng() - 0.5) * 0.45;
    const dist = flowerR * (0.48 + rng() * 0.18);
    const px = Math.cos(a) * dist;
    const py = Math.sin(a) * dist;
    const dabCol = p % 2 === 0 ? primaryCol : lerpRgb(primaryCol, cream, 0.35);

    ctx.fillStyle = rgbToCss(dabCol, 0.86);
    ctx.beginPath();
    ctx.ellipse(
      px,
      py,
      flowerR * (0.5 + rng() * 0.16),
      flowerR * (0.28 + rng() * 0.12),
      a,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Tiny warm ochre-umber pollen heart
  ctx.fillStyle = rgbToCss(centerCol, 0.78);
  ctx.beginPath();
  ctx.arc(0, 0, flowerR * 0.28, 0, Math.PI * 2);
  ctx.fill();

  // Occasional second tiny companion floret slightly lower on the stem
  if (blade.id % 2 === 0 && localBloom > 0.45) {
    const subX = (rng() > 0.5 ? 1 : -1) * (3.6 + rng() * 2.5);
    const subY = 4.2 + rng() * 3.5;
    ctx.fillStyle = rgbToCss(lerpRgb(primaryCol, cream, 0.25), 0.74 * localBloom);
    ctx.beginPath();
    ctx.arc(subX, subY, flowerR * 0.45, 0, Math.PI * 2);
    ctx.fill();
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

  // Rich powdery meadow ground underwash at the bottom (deep umber at 0%, lush dark-emerald at 100%)
  if (layer === "back") {
    const washTop = BLEED_Y + CARD_HEIGHT - 156;
    const deepFloor = lerpRgb({ r: 76, g: 58, b: 38 }, { r: 38, g: 76, b: 30 }, vitality);
    const washGrad = ctx.createLinearGradient(0, washTop, 0, BLEED_Y + CARD_HEIGHT);
    washGrad.addColorStop(0, rgbToCss(palette.grassBack, 0));
    washGrad.addColorStop(0.36, rgbToCss(palette.grassBack, 0.24));
    washGrad.addColorStop(0.68, rgbToCss(palette.grassMid, 0.58));
    washGrad.addColorStop(0.88, rgbToCss(palette.grassFront, 0.86));
    washGrad.addColorStop(1, rgbToCss(deepFloor, 0.96));
    ctx.fillStyle = washGrad;
    ctx.fillRect(BLEED_X, washTop, CARD_WIDTH, 158);

    const pastelPat = getPastelPattern(ctx);
    if (pastelPat) {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = pastelPat;
      ctx.fillRect(BLEED_X, washTop + 22, CARD_WIDTH, 136);
      ctx.restore();
    }
  }

  const grassBase =
    layer === "back" ? palette.grassBack : layer === "mid" ? palette.grassMid : palette.grassFront;
  const tipTint =
    layer === "front"
      ? lerpRgb(palette.grassMid, palette.leafHighlight, 0.52)
      : lerpRgb(palette.grassBack, palette.petalTip, 0.24 + phases.warmth * 0.14);
  const shadowTint = lerpRgb(
    palette.outlineInk,
    lerpRgb({ r: 72, g: 55, b: 36 }, { r: 36, g: 72, b: 28 }, vitality),
    0.58,
  );

  for (let i = 0; i < grass.length; i++) {
    const blade = grass[i];
    if (!blade || blade.layer !== layer) continue;

    if (blade.kind === "grass") {
      drawGrassBlade(ctx, blade, grassBase, tipTint, shadowTint, vitality);
    } else if (blade.kind === "twig") {
      drawBranchingTwig(ctx, blade, palette, vitality);
    } else if (blade.kind === "weed") {
      drawMeadowWeed(ctx, blade, palette, vitality, phases.wildflower);
    } else {
      drawWildflowerStem(ctx, blade, palette, vitality, phases.wildflower);
    }
  }

  // Dense grounding sketchbook grass tufts across the bottom 25% of the card
  if (layer === "mid" || layer === "front") {
    const deepEmerald: RGB = { r: 34, g: 72, b: 28 };
    const lushOlive: RGB = { r: 78, g: 122, b: 46 };
    const dryUmberFloor: RGB = { r: 80, g: 62, b: 40 };
    const dryStraw: RGB = { r: 162, g: 136, b: 94 };

    const darkStroke = lerpRgb(dryUmberFloor, deepEmerald, vitality);
    const midStroke = lerpRgb(palette.grassMid, lushOlive, vitality * 0.5);
    const lightStroke = lerpRgb(dryStraw, palette.leafHighlight, vitality);

    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < GROUND_TUFTS.length; i++) {
      const tuft = GROUND_TUFTS[i];
      if (!tuft || tuft.layer !== layer) continue;

      const bx = BLEED_X + tuft.xFrac * CARD_WIDTH;
      const by = BLEED_Y + CARD_HEIGHT + 4;
      const h = tuft.height * lerp(0.84, 1.06, vitality);
      const sway =
        state.wind * 0.06 + Math.sin(state.time * 0.8 + tuft.phase) * lerp(0.025, 0.042, vitality);
      const ang = tuft.lean + sway;
      const dx = Math.sin(ang) * h;
      const dy = -Math.cos(ang * 0.78) * h;

      const col =
        tuft.shade < 0.45
          ? darkStroke
          : tuft.shade < 0.8
            ? midStroke
            : lerpRgb(midStroke, lightStroke, 0.62);
      ctx.strokeStyle = rgbToCss(col, layer === "front" ? 0.84 : 0.72);
      ctx.lineWidth = tuft.thickness;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + dx * 0.45, by + dy * 0.56, bx + dx, by + dy);
      ctx.stroke();
    }
    ctx.restore();
  }
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

    // Leading costal edge & fine branching gossamer venation
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

  // Foreleg
  ctx.beginPath();
  ctx.moveTo(4.2, 2.2);
  ctx.lineTo(5.2, 4.1 + legDrop * 0.6);
  ctx.lineTo(6.3, 5.1 + legDrop * 0.9);
  ctx.stroke();

  // Midleg
  ctx.beginPath();
  ctx.moveTo(1.8, 2.5);
  ctx.lineTo(1.2, 4.6 + legDrop * 0.8);
  ctx.lineTo(2.1, 5.9 + legDrop);
  ctx.stroke();

  // Hindleg with golden pollen basket
  ctx.beginPath();
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
  const abdPath = new Path2D();
  abdPath.moveTo(-0.3, -2.5);
  abdPath.bezierCurveTo(-3.6, -4.1, -8.3, -2.4, -10.1, 1.15);
  abdPath.bezierCurveTo(-8.4, 3.9, -3.5, 4.2, -0.3, 2.2);
  abdPath.closePath();

  const abdGrad = ctx.createLinearGradient(-4.5, -3.6, -5.2, 3.8);
  abdGrad.addColorStop(0, rgbToCss(buttercream, 0.96));
  abdGrad.addColorStop(0.32, rgbToCss(honeyGold, 0.96));
  abdGrad.addColorStop(0.78, rgbToCss(amberOchre, 0.95));
  abdGrad.addColorStop(1, rgbToCss(lerpRgb(amberOchre, deepUmber, 0.38), 0.94));

  ctx.save();
  ctx.fillStyle = abdGrad;
  ctx.fill(abdPath);
  ctx.clip(abdPath);

  // Curved soft colored-pencil stripes following the rounded 3D abdomen contour
  const stripes: readonly { x: number; w: number; bend: number; alpha: number }[] = [
    { x: -2.6, w: 1.55, bend: 1.15, alpha: 0.76 },
    { x: -5.4, w: 1.5, bend: 1.0, alpha: 0.8 },
    { x: -7.9, w: 1.35, bend: 0.75, alpha: 0.82 },
  ];
  ctx.lineCap = "round";
  for (let i = 0; i < stripes.length; i++) {
    const st = stripes[i];
    if (!st) continue;
    // Soft feathered colored-pencil under-stroke
    ctx.strokeStyle = rgbToCss(deepUmber, st.alpha * 0.38);
    ctx.lineWidth = st.w + 0.95;
    ctx.beginPath();
    ctx.moveTo(st.x - 0.3, -4.2);
    ctx.quadraticCurveTo(st.x + st.bend, 0.1, st.x - 0.5, 4.4);
    ctx.stroke();

    // Core warm-espresso band
    ctx.strokeStyle = rgbToCss(deepUmber, st.alpha);
    ctx.lineWidth = st.w;
    ctx.beginPath();
    ctx.moveTo(st.x - 0.3, -4.2);
    ctx.quadraticCurveTo(st.x + st.bend, 0.1, st.x - 0.5, 4.4);
    ctx.stroke();
  }

  // Soft espresso-umber tail tip
  ctx.fillStyle = rgbToCss(deepUmber, 0.84);
  ctx.beginPath();
  ctx.ellipse(-9.7, 1.15, 1.5, 1.7, 0.25, 0, Math.PI * 2);
  ctx.fill();

  // Sunlit upper flank sheen & gentle underside shading over bands for 3D roundness
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

  // 4. Plump fuzzy honey-ochre thorax with radiating pencil-drawn fluff strokes
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

  // Delicate radiating woolly pencil fuzz hairs around thorax silhouette
  ctx.save();
  ctx.lineCap = "round";
  const fuzzCount = 24;
  for (let i = 0; i < fuzzCount; i++) {
    const a = (i / fuzzCount) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rx0 = trx * 0.86;
    const ry0 = tryR * 0.86;
    const hairLen = 0.72 + (i % 3) * 0.26;
    const sx = tx + ca * rx0;
    const sy = ty + sa * ry0;
    const ex = tx + ca * (trx + hairLen) - 0.22;
    const ey = ty + sa * (tryR + hairLen);
    const hairCol =
      sa < -0.1
        ? lerpRgb(fuzzOchre, buttercream, 0.48)
        : sa > 0.35
          ? lerpRgb(amberOchre, deepUmber, 0.42)
          : fuzzOchre;
    ctx.strokeStyle = rgbToCss(hairCol, 0.72);
    ctx.lineWidth = 0.56;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }

  // Subtle darker sepia-amber saddle tuft on mid-thorax
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

  // Tiny sunlit eye highlight speck
  ctx.fillStyle = rgbToCss(buttercream, 0.76);
  ctx.beginPath();
  ctx.ellipse(hx + 0.75, hy - 0.75, 0.58, 0.42, -0.35, 0, Math.PI * 2);
  ctx.fill();

  // Graceful elbowed dark-sepia antennae (far & near)
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

  // 6. Near translucent gossamer double-wing (motion-blur echo + hindwing + forewing)
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

  // 1. Rounded scalloped hindwing (tucked cleanly beneath forewing)
  const hindPath = new Path2D();
  hindPath.moveTo(-0.6, -0.2);
  hindPath.bezierCurveTo(-4.8, -1.6, -10.8, -4.6, -10.4, -8.8);
  hindPath.bezierCurveTo(-9.8, -11.6, -6.2, -12.8, -3.2, -11.4);
  hindPath.bezierCurveTo(-1.2, -10.4, 0.8, -7.8, 0.8, -3.2);
  hindPath.closePath();

  const hindGrad = ctx.createLinearGradient(-1.0, -1.0, -9.8, -10.4);
  hindGrad.addColorStop(0, rgbToCss(innerCol, 0.94));
  hindGrad.addColorStop(0.58, rgbToCss(midCol, 0.92));
  hindGrad.addColorStop(0.84, rgbToCss(lerpRgb(midCol, marginCol, 0.55), 0.9));
  hindGrad.addColorStop(1, rgbToCss(marginCol, 0.88));

  ctx.save();
  ctx.fillStyle = hindGrad;
  ctx.fill(hindPath);
  ctx.clip(hindPath);

  // Soft pastel hindwing veins
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

  // 2. Gracefully arched forewing with soft scalloped outer margin
  const forePath = new Path2D();
  forePath.moveTo(0.4, -0.3);
  forePath.bezierCurveTo(3.8, -5.6, 8.2, -12.6, 8.6, -15.9);
  forePath.bezierCurveTo(8.8, -17.3, 6.4, -17.6, 4.4, -16.4);
  forePath.bezierCurveTo(1.8, -14.8, -0.4, -12.4, -2.4, -9.6);
  forePath.bezierCurveTo(-3.4, -8.2, -3.6, -5.6, -2.4, -2.6);
  forePath.bezierCurveTo(-1.7, -1.0, -0.6, -0.4, 0.4, -0.3);
  forePath.closePath();

  const foreGrad = ctx.createLinearGradient(0.4, -1.0, 7.2, -16.2);
  foreGrad.addColorStop(0, rgbToCss(innerCol, 0.96));
  foreGrad.addColorStop(0.52, rgbToCss(midCol, 0.94));
  foreGrad.addColorStop(0.84, rgbToCss(lerpRgb(midCol, marginCol, 0.5), 0.92));
  foreGrad.addColorStop(1, rgbToCss(marginCol, 0.9));

  ctx.save();
  ctx.fillStyle = foreGrad;
  ctx.fill(forePath);
  ctx.clip(forePath);

  // Soft cinnamon-terracotta outer margin blush along apex & outer scallop
  const tipWash = ctx.createRadialGradient(7.2, -15.4, 1.2, 4.6, -13.4, 9.2);
  tipWash.addColorStop(0, rgbToCss(marginCol, isUnderside ? 0.34 : 0.72));
  tipWash.addColorStop(0.54, rgbToCss(marginCol, isUnderside ? 0.14 : 0.34));
  tipWash.addColorStop(1, rgbToCss(marginCol, 0));
  ctx.fillStyle = tipWash;
  ctx.fillRect(-5, -19, 15, 20);

  // Subtle sunlit warm-cream inner cheek highlight
  const innerGlow = ctx.createRadialGradient(2.2, -6.4, 0.6, 2.0, -6.6, 6.2);
  innerGlow.addColorStop(0, rgbToCss(buttercream, isUnderside ? 0.36 : 0.42));
  innerGlow.addColorStop(1, rgbToCss(buttercream, 0));
  ctx.fillStyle = innerGlow;
  ctx.fillRect(-4, -15, 13, 15);

  // Fine radiating botanical sepia wing veins
  ctx.strokeStyle = rgbToCss(contourCol, isUnderside ? 0.3 : 0.36);
  ctx.lineWidth = 0.45;
  ctx.lineCap = "round";
  ctx.beginPath();
  // Leading costal vein
  ctx.moveTo(0.6, -0.8);
  ctx.quadraticCurveTo(4.2, -7.2, 7.6, -15.2);
  // Central discal cell branching veins
  ctx.moveTo(0.1, -1.2);
  ctx.quadraticCurveTo(2.4, -7.4, 5.2, -15.4);
  ctx.moveTo(-0.3, -1.5);
  ctx.quadraticCurveTo(0.8, -7.2, 2.0, -13.6);
  ctx.moveTo(-0.7, -1.4);
  ctx.quadraticCurveTo(-1.0, -6.2, -1.0, -10.8);
  ctx.stroke();

  // Delicate buttercream speckles tucked in the cinnamon apex margin
  if (!isUnderside) {
    ctx.fillStyle = rgbToCss(buttercream, 0.86);
    ctx.beginPath();
    ctx.ellipse(6.5, -15.2, 0.92, 0.6, -0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(4.8, -14.8, 0.68, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(2.9, -13.3, 0.56, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Whisper-soft colored-pencil wing outline (zero harsh black)
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
  // Smooth 3D orthographic dihedral projection from an elevated 3/4 side view
  const rawFlap = Math.sin(insect.wingPhase);
  const openT = (rawFlap + 1) * 0.5;
  const easedOpen = openT * openT * (3 - 2 * openT);
  const glide = clamp01(insect.glide);

  // Sweeps from folded high above back (+1.32 rad) down to wide downstroke (-0.22 rad);
  // rests in a gentle sunlit open V (+0.14 rad) during glide pauses.
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

  // 1. Far wing pair (behind the slender body, shifted slightly back/up in perspective)
  ctx.save();
  ctx.translate(-0.85, -0.75);
  ctx.transform(wingSpanX * 0.94, 0, wingSkew * 0.9, Math.max(0.24, farProjY), 0, 0);
  drawButterflyWingPair(ctx, palette, true, false);
  ctx.restore();

  // 2. Slender warm-umber abdomen, fuzzy thorax, head & curved club-tipped antennae
  ctx.save();
  // Tapered abdomen
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

  // Subtle sunlit upper highlight along abdomen
  ctx.strokeStyle = rgbToCss(softOchre, 0.34);
  ctx.lineWidth = 0.48;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.8, -0.45);
  ctx.quadraticCurveTo(-3.8, -0.3, -6.8, 0.35);
  ctx.stroke();

  // Slightly plumper fuzzy thorax
  ctx.fillStyle = rgbToCss(deepUmber, 0.92);
  ctx.beginPath();
  ctx.ellipse(1.15, -0.25, 2.45, 1.48, -0.08, 0, Math.PI * 2);
  ctx.fill();

  // Soft warm ochre fuzz sheen on upper thorax
  ctx.fillStyle = rgbToCss(softOchre, 0.36);
  ctx.beginPath();
  ctx.ellipse(1.0, -0.7, 1.5, 0.62, -0.1, 0, Math.PI * 2);
  ctx.fill();

  // Small rounded head + tiny soft eye glint
  ctx.fillStyle = rgbToCss(deepUmber, 0.94);
  ctx.beginPath();
  ctx.arc(3.95, -0.45, 1.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgbToCss(lerpRgb(palette.petalTip, palette.paperBg, 0.5), 0.65);
  ctx.beginPath();
  ctx.arc(4.35, -0.85, 0.34, 0, Math.PI * 2);
  ctx.fill();

  // Two gracefully curving club-tipped antennae
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

  // 3. Near wing pair (in front of body, smoothly foreshortening as it sweeps up & down)
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

  // Soft dry dust motes (0%) and gentle golden pollen motes (100%)
  ctx.save();
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (!p || p.alpha <= 0.01) continue;

    if (p.kind === "dust") {
      ctx.fillStyle = rgbToCss(palette.twigColor, p.alpha * 0.5);
      ctx.beginPath();
      ctx.ellipse(
        p.x,
        p.y,
        p.size * 1.1,
        p.size * 0.5,
        p.phase + state.time * 0.25,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    } else {
      // Tiny, delicate storybook pastel-gold pollen specks (no large blurry lens-flare orbs)
      const speckR = clamp01(p.size / 3.4) * 0.85 + 0.65;
      const warmGold = lerpRgb(palette.petalOuter, palette.petalTip, 0.58);
      ctx.fillStyle = rgbToCss(warmGold, p.alpha * 0.48);
      ctx.beginPath();
      ctx.arc(p.x, p.y, speckR * 1.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = rgbToCss(palette.petalTip, p.alpha * 0.68);
      ctx.beginPath();
      ctx.arc(p.x, p.y, speckR * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }
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
