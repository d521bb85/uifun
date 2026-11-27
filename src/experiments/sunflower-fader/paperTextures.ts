import { mulberry32 } from "./colorAndCurves";
import { CARD_HEIGHT, CARD_WIDTH } from "./types";

export interface PaperTextures {
  paperTile: HTMLCanvasElement;
  pencilHatchTile: HTMLCanvasElement;
  pastelGrainTile: HTMLCanvasElement;
  skyPencilTexture: HTMLCanvasElement;
  cardFinishTexture: HTMLCanvasElement;
}

let cachedTextures: PaperTextures | null = null;

function hash2D(ix: number, iy: number, period: number, seed: number): number {
  const wx = ((ix % period) + period) % period;
  const wy = ((iy % period) + period) % period;
  let h = (wx * 374761393 + wy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function periodicNoise(x: number, y: number, freq: number, size: number, seed: number): number {
  const gx = (x / size) * freq;
  const gy = (y / size) * freq;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);

  const n00 = hash2D(x0, y0, freq, seed);
  const n10 = hash2D(x0 + 1, y0, freq, seed);
  const n01 = hash2D(x0, y0 + 1, freq, seed);
  const n11 = hash2D(x0 + 1, y0 + 1, freq, seed);

  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return nx0 + (nx1 - nx0) * v;
}

function clampByte(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v | 0;
}

function createColdPressPaperTile(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const heightField = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n1 = periodicNoise(x, y, 8, size, 11);
      const n2 = periodicNoise(x, y, 18, size, 29);
      const n3 = periodicNoise(x, y, 42, size, 53);
      const n4 = periodicNoise(x, y, 92, size, 97);
      heightField[y * size + x] = n1 * 0.28 + n2 * 0.34 + n3 * 0.24 + n4 * 0.14;
    }
  }

  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const idx = y * size + x;
      const h = heightField[idx] ?? 0.5;
      const dx = (heightField[y * size + xp] ?? h) - (heightField[y * size + xm] ?? h);
      const dy = (heightField[yp * size + x] ?? h) - (heightField[ym * size + x] ?? h);

      // Soft top-left paper-tooth relief so pastel pigment visibly breaks over cotton valleys
      const emboss = (dx * 0.9 + dy * 1.1) * 44;
      const valley = (h - 0.5) * 18;
      const micro = (hash2D(x, y, size, 211) - 0.5) * 6;
      const delta = valley - emboss + micro;

      const p = idx * 4;
      data[p] = clampByte(249 + delta * 0.88);
      data[p + 1] = clampByte(247 + delta * 0.92);
      data[p + 2] = clampByte(242 + delta * 1.0);
      data[p + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  // Subtle cotton fibers and warm organic flecks wrapped seamlessly
  const rand = mulberry32(48271);
  ctx.lineCap = "round";
  for (let i = 0; i < 210; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const angle = rand() * Math.PI * 2;
    const len = 3 + rand() * 8.5;
    const isLight = rand() > 0.52;
    ctx.strokeStyle = isLight ? "rgba(255, 254, 250, 0.28)" : "rgba(176, 165, 148, 0.11)";
    ctx.lineWidth = 0.45 + rand() * 0.55;

    const ex = x + Math.cos(angle) * len;
    const ey = y + Math.sin(angle) * len;
    for (let ox = -size; ox <= size; ox += size) {
      for (let oy = -size; oy <= size; oy += size) {
        if (x + ox < -12 || x + ox > size + 12 || y + oy < -12 || y + oy > size + 12) {
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(ex + ox, ey + oy);
        ctx.stroke();
      }
    }
  }

  for (let i = 0; i < 60; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.35 + rand() * 0.7;
    ctx.fillStyle = rand() > 0.4 ? "rgba(162, 149, 130, 0.10)" : "rgba(128, 114, 96, 0.08)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

function createPencilHatchTile(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const image = ctx.createImageData(size, size);
  const data = image.data;

  // Fine directional colored-pencil tooth with organic dry-media micro-skips
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const primary = periodicNoise(x * 0.42, y * 2.1, 32, size, 313);
      const cross = periodicNoise((x + y * 0.35) * 0.55, (y - x * 0.25) * 1.8, 44, size, 521);
      const paperSkip = periodicNoise(x, y, 88, size, 733);
      const grit = hash2D(x, y, size, 991);

      const grain = primary * 0.44 + cross * 0.26 + paperSkip * 0.22 + grit * 0.08;
      // Bias near white with organic tooth valleys so multiply keeps pastels luminous
      const shade = clampByte(240 + (grain - 0.46) * 42);
      const p = (y * size + x) * 4;
      data[p] = shade;
      data[p + 1] = clampByte(shade - 1);
      data[p + 2] = clampByte(shade - 3);
      data[p + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  // Layered dry colored-pencil hatch & delicate cross-hatch wisps
  const rand = mulberry32(91873);
  ctx.lineCap = "round";

  for (let i = 0; i < 320; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const isCross = i % 4 === 0;
    const angle = isCross ? -0.46 + (rand() - 0.5) * 0.14 : 0.22 + (rand() - 0.5) * 0.14;
    const len = 8 + rand() * 22;
    const isPaperSkip = rand() > 0.58;
    ctx.strokeStyle = isPaperSkip
      ? "rgba(255, 254, 250, 0.32)"
      : `rgba(116, 106, 92, ${(0.05 + rand() * 0.085).toFixed(3)})`;
    ctx.lineWidth = 0.45 + rand() * 0.7;

    const dx = Math.cos(angle) * len;
    const dy = Math.sin(angle) * len;
    for (let ox = -size; ox <= size; ox += size) {
      for (let oy = -size; oy <= size; oy += size) {
        if (x + ox < -26 || x + ox > size + 26 || y + oy < -26 || y + oy > size + 26) {
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + dx, y + oy + dy);
        ctx.stroke();
      }
    }
  }

  return canvas;
}

function createPastelGrainTile(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const image = ctx.createImageData(size, size);
  const data = image.data;

  // Powdery chalky pastel rubbing noise for soft sky & cloud blending
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rub = periodicNoise(x * 0.35, y * 1.45, 22, size, 1201);
      const powder = periodicNoise(x, y, 64, size, 1453);
      const fine = hash2D(x, y, size, 1789);
      const combined = rub * 0.42 + powder * 0.36 + fine * 0.22;
      const shade = clampByte(244 + (combined - 0.5) * 36);
      const p = (y * size + x) * 4;
      data[p] = shade;
      data[p + 1] = clampByte(shade - 0.5);
      data[p + 2] = clampByte(shade - 1.5);
      data[p + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  const rand = mulberry32(314159);
  for (let i = 0; i < 180; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rx = 5 + rand() * 14;
    const ry = 1.2 + rand() * 3.2;
    const light = rand() > 0.46;
    ctx.fillStyle = light ? "rgba(255, 253, 249, 0.14)" : "rgba(146, 138, 126, 0.065)";
    for (let ox = -size; ox <= size; ox += size) {
      if (x + ox < -18 || x + ox > size + 18) continue;
      ctx.beginPath();
      ctx.ellipse(x + ox, y, rx, ry, (rand() - 0.5) * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas;
}

function createSkyPencilTexture(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Neutral pure white base so multiply compositing only applies delicate pencil rubbing strokes
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const rand = mulberry32(77419);
  ctx.lineCap = "round";

  // 420+ hand-rubbed horizontal & gently slanted dry colored-pencil strokes across the sky
  // Denser and more expressive in the upper sky (like both storybook references!), fading softly at horizon
  for (let i = 0; i < 440; i++) {
    const yFrac = rand() ** 0.85 * 0.92;
    const y = yFrac * height;
    const x0 = -16 + rand() * (width + 10);
    const len = 24 + rand() * 76;
    const tilt = (rand() - 0.52) * 0.14;
    const dx = Math.cos(tilt) * len;
    const dy = Math.sin(tilt) * len;

    const topWeight = 1 - yFrac * 0.55;
    const isLightLift = rand() > 0.62;
    const alpha = (0.024 + rand() * 0.052) * topWeight;

    const grad = ctx.createLinearGradient(x0, y, x0 + dx, y + dy);
    if (isLightLift) {
      grad.addColorStop(0, "rgba(255, 255, 255, 0)");
      grad.addColorStop(0.5, `rgba(255, 254, 250, ${(alpha * 1.4).toFixed(4)})`);
      grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    } else {
      grad.addColorStop(0, "rgba(130, 122, 110, 0)");
      grad.addColorStop(0.32, `rgba(130, 122, 110, ${alpha.toFixed(4)})`);
      grad.addColorStop(0.68, `rgba(122, 114, 102, ${(alpha * 0.9).toFixed(4)})`);
      grad.addColorStop(1, "rgba(130, 122, 110, 0)");
    }

    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.2 + rand() * 3.8;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo(x0 + dx * 0.5, y + dy * 0.5 + (rand() - 0.5) * 3.2, x0 + dx, y + dy);
    ctx.stroke();
  }

  // Fine broken dry-pencil micro-fibers catching paper valleys
  for (let i = 0; i < 360; i++) {
    const yFrac = rand() * 0.9;
    const x = rand() * width;
    const y = yFrac * height;
    const len = 5 + rand() * 16;
    const tilt = (rand() - 0.5) * 0.2;
    const alpha = (0.02 + rand() * 0.04) * (1 - yFrac * 0.45);
    ctx.strokeStyle = `rgba(104, 98, 88, ${alpha.toFixed(4)})`;
    ctx.lineWidth = 0.55 + rand() * 0.75;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(tilt) * len, y + Math.sin(tilt) * len);
    ctx.stroke();
  }

  return canvas;
}

function createCardFinishTexture(
  width: number,
  height: number,
  paperTile: HTMLCanvasElement,
  pastelGrainTile: HTMLCanvasElement,
  pencilHatchTile: HTMLCanvasElement,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const layers: readonly { tile: HTMLCanvasElement; alpha: number }[] = [
    { tile: paperTile, alpha: 0.4 },
    { tile: pastelGrainTile, alpha: 0.16 },
    { tile: pencilHatchTile, alpha: 0.11 },
  ];

  ctx.globalCompositeOperation = "multiply";
  for (const layer of layers) {
    if (!layer.tile.width) continue;
    const pattern = ctx.createPattern(layer.tile, "repeat");
    if (!pattern) continue;
    ctx.globalAlpha = layer.alpha;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}

export function getPaperTextures(): PaperTextures {
  if (cachedTextures) return cachedTextures;

  if (typeof document === "undefined") {
    const stub = {} as HTMLCanvasElement;
    return {
      paperTile: stub,
      pencilHatchTile: stub,
      pastelGrainTile: stub,
      skyPencilTexture: stub,
      cardFinishTexture: stub,
    };
  }

  const paperTile = createColdPressPaperTile(256);
  const pencilHatchTile = createPencilHatchTile(256);
  const pastelGrainTile = createPastelGrainTile(256);
  const skyPencilTexture = createSkyPencilTexture(CARD_WIDTH, CARD_HEIGHT);
  const cardFinishTexture = createCardFinishTexture(
    CARD_WIDTH,
    CARD_HEIGHT,
    paperTile,
    pastelGrainTile,
    pencilHatchTile,
  );

  cachedTextures = {
    paperTile,
    pencilHatchTile,
    pastelGrainTile,
    skyPencilTexture,
    cardFinishTexture,
  };

  return cachedTextures;
}
