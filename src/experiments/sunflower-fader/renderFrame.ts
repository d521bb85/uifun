import { getPalette, rgbToCss } from "./colorAndCurves";
import { getPaperTextures } from "./paperTextures";
import { paintAirborneLife, paintMeadowLayer, paintSkyAndAtmosphere } from "./scenePainter";
import { paintSunflower } from "./sunflowerPainter";
import {
  BLEED_X,
  BLEED_Y,
  CANVAS_WIDTH,
  CARD_HEIGHT,
  CARD_RADIUS,
  CARD_WIDTH,
  type SunflowerSimState,
} from "./types";

let cachedCardPath: Path2D | null = null;
let cachedBottomGuardPath: Path2D | null = null;

function createRoundedRectPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const path = new Path2D();
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  path.closePath();
  return path;
}

function getCardPath(): Path2D {
  if (!cachedCardPath) {
    cachedCardPath = createRoundedRectPath(BLEED_X, BLEED_Y, CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS);
  }
  return cachedCardPath;
}

function getBottomGuardPath(): Path2D {
  if (!cachedBottomGuardPath) {
    const path = new Path2D();
    const bottomY = BLEED_Y + CARD_HEIGHT;
    const cornerTopY = bottomY - CARD_RADIUS;
    const cardRight = BLEED_X + CARD_WIDTH;

    path.moveTo(0, 0);
    path.lineTo(CANVAS_WIDTH, 0);
    path.lineTo(CANVAS_WIDTH, cornerTopY);
    path.lineTo(cardRight, cornerTopY);
    path.quadraticCurveTo(cardRight, bottomY, cardRight - CARD_RADIUS, bottomY);
    path.lineTo(BLEED_X + CARD_RADIUS, bottomY);
    path.quadraticCurveTo(BLEED_X, bottomY, BLEED_X, cornerTopY);
    path.lineTo(0, cornerTopY);
    path.closePath();
    cachedBottomGuardPath = path;
  }
  return cachedBottomGuardPath;
}

export function renderSunflowerFrame(
  ctx: CanvasRenderingContext2D,
  state: SunflowerSimState,
  dpr: number,
): void {
  const scale = dpr > 0 ? dpr : 1;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const palette = getPalette(state.phases);
  const cardPath = getCardPath();
  const bottomGuardPath = getBottomGuardPath();
  const { cardFinishTexture } = getPaperTextures();

  // Subtle natural paper elevation shadow beneath the card (NO border stroke!)
  ctx.save();
  ctx.shadowColor = "rgba(44, 38, 30, 0.11)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = rgbToCss(palette.paperBg);
  ctx.fill(cardPath);
  ctx.restore();

  // Clipped card background: warm cotton paper base, pastel sky, clouds, back & mid meadow
  ctx.save();
  ctx.clip(cardPath);
  ctx.fillStyle = rgbToCss(palette.paperBg);
  ctx.fillRect(BLEED_X, BLEED_Y, CARD_WIDTH, CARD_HEIGHT);
  paintSkyAndAtmosphere(ctx, state, palette);
  paintMeadowLayer(ctx, state, palette, "back");
  paintMeadowLayer(ctx, state, palette, "mid");
  ctx.restore();

  // Sunflower (allowed to softly extend past left/right/top edges, neatly framed at bottom corners)
  ctx.save();
  ctx.clip(bottomGuardPath);
  paintSunflower(ctx, state, palette, cardPath);
  ctx.restore();

  // Foreground meadow, airborne pollen/insects, and cold-press storybook paper finish ONLY inside the card
  ctx.save();
  ctx.clip(cardPath);
  paintMeadowLayer(ctx, state, palette, "front");
  paintAirborneLife(ctx, state, palette);

  if (cardFinishTexture.width) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(cardFinishTexture, BLEED_X, BLEED_Y, CARD_WIDTH, CARD_HEIGHT);
    ctx.restore();
  }
  ctx.restore();

  ctx.restore();
}
