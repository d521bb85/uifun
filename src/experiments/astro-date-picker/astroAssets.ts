export const ASTRO_TEXTURE_SPECS = {
  earthDay: { file: "earth_day.webp", srgb: true },
  earthNight: { file: "earth_night.webp", srgb: true },
  earthClouds: { file: "earth_clouds.webp", srgb: false },
  earthSpecular: { file: "earth_specular.webp", srgb: false },
  earthNormal: { file: "earth_normal.webp", srgb: false },
  moonAlbedo: { file: "moon_albedo.webp", srgb: true },
  milkyWay: { file: "milky_way.webp", srgb: true },
  sunSurface: { file: "sun_surface.webp", srgb: true },
} as const;

export type AstroTextureKey = keyof typeof ASTRO_TEXTURE_SPECS;

export type AstroLoadedTextures = Record<AstroTextureKey, HTMLImageElement | null>;

export interface AstroAssetsSnapshot {
  total: number;
  loaded: number;
  failed: number;
  settled: number;
  ready: boolean;
  progress: number;
}

export const ASTRO_TEXTURE_KEYS = Object.keys(ASTRO_TEXTURE_SPECS) as readonly AstroTextureKey[];

type AssetStatus = "loading" | "loaded" | "error";

interface CachedAssetEntry {
  status: AssetStatus;
  image: HTMLImageElement | null;
  promise: Promise<HTMLImageElement | null>;
}

const cache = new Map<AstroTextureKey, CachedAssetEntry>();
const listeners = new Set<(snapshot: AstroAssetsSnapshot) => void>();
let allAssetsPromise: Promise<AstroLoadedTextures> | null = null;
type AstroSceneModule = typeof import("./AstroScene");
let sceneModulePromise: Promise<AstroSceneModule> | null = null;

export function resolveAstroTextureBase(): string {
  const base =
    typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/";
  const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalized}/textures/astro`;
}

export function getAstroTextureUrls(): Record<AstroTextureKey, string> {
  const base = resolveAstroTextureBase();
  const urls = {} as Record<AstroTextureKey, string>;
  for (const key of ASTRO_TEXTURE_KEYS) {
    urls[key] = `${base}/${ASTRO_TEXTURE_SPECS[key].file}`;
  }
  return urls;
}

export function getAstroAssetsSnapshot(): AstroAssetsSnapshot {
  const total = ASTRO_TEXTURE_KEYS.length;
  let loaded = 0;
  let failed = 0;

  for (const key of ASTRO_TEXTURE_KEYS) {
    const entry = cache.get(key);
    if (entry?.status === "loaded") {
      loaded += 1;
    } else if (entry?.status === "error") {
      failed += 1;
    }
  }

  const settled = loaded + failed;
  return {
    total,
    loaded,
    failed,
    settled,
    ready: settled === total,
    progress: total > 0 ? settled / total : 1,
  };
}

function notifyListeners() {
  if (listeners.size === 0) return;
  const snapshot = getAstroAssetsSnapshot();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

export function subscribeAstroAssets(
  listener: (snapshot: AstroAssetsSnapshot) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCachedAstroTextureImage(key: AstroTextureKey): HTMLImageElement | null {
  const entry = cache.get(key);
  return entry?.status === "loaded" ? entry.image : null;
}

export function preloadAstroTexture(key: AstroTextureKey): Promise<HTMLImageElement | null> {
  const existing = cache.get(key);
  if (existing) {
    return existing.promise;
  }

  if (typeof Image === "undefined") {
    return Promise.resolve(null);
  }

  const url = `${resolveAstroTextureBase()}/${ASTRO_TEXTURE_SPECS[key].file}`;
  let resolvePromise!: (value: HTMLImageElement | null) => void;
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    resolvePromise = resolve;
  });

  const entry: CachedAssetEntry = {
    status: "loading",
    image: null,
    promise,
  };
  cache.set(key, entry);

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  // Hint high priority so textures download in parallel with the lazy WebGL chunk.
  if ("fetchPriority" in img) {
    (img as HTMLImageElement & { fetchPriority: string }).fetchPriority = "high";
  }

  const settle = (status: "loaded" | "error", result: HTMLImageElement | null) => {
    if (entry.status !== "loading") return;
    entry.status = status;
    entry.image = result;
    notifyListeners();
    resolvePromise(result);
  };

  img.onload = () => {
    // Decode off the main thread before GPU upload so the first WebGL frame does not stall.
    if (typeof img.decode === "function") {
      img
        .decode()
        .catch(() => undefined)
        .then(() => settle("loaded", img));
    } else {
      settle("loaded", img);
    }
  };

  img.onerror = () => {
    settle("error", null);
  };

  img.src = url;

  if (img.complete && img.naturalWidth > 0) {
    if (typeof img.decode === "function") {
      img
        .decode()
        .catch(() => undefined)
        .then(() => settle("loaded", img));
    } else {
      settle("loaded", img);
    }
  }

  return promise;
}

export function preloadAstroAssets(): Promise<AstroLoadedTextures> {
  if (typeof Image === "undefined") {
    const empty = {} as AstroLoadedTextures;
    for (const key of ASTRO_TEXTURE_KEYS) {
      empty[key] = null;
    }
    return Promise.resolve(empty);
  }

  if (allAssetsPromise) {
    return allAssetsPromise;
  }

  const promises = ASTRO_TEXTURE_KEYS.map(
    async (key) => [key, await preloadAstroTexture(key)] as const,
  );

  allAssetsPromise = Promise.all(promises).then((entries) => {
    const result = {} as AstroLoadedTextures;
    for (const [key, image] of entries) {
      result[key] = image;
    }
    return result;
  });

  return allAssetsPromise;
}

export function preloadAstroScene(): Promise<AstroSceneModule> {
  if (!sceneModulePromise) {
    sceneModulePromise = import("./AstroScene").catch((err: unknown) => {
      sceneModulePromise = null;
      throw err;
    });
  }
  return sceneModulePromise;
}

export function resetAstroAssetsCacheForTests() {
  cache.clear();
  listeners.clear();
  allAssetsPromise = null;
  sceneModulePromise = null;
}
