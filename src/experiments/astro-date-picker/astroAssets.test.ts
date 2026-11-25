import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASTRO_TEXTURE_KEYS,
  getAstroAssetsSnapshot,
  getAstroTextureUrls,
  getCachedAstroTextureImage,
  preloadAstroAssets,
  preloadAstroTexture,
  resetAstroAssetsCacheForTests,
  subscribeAstroAssets,
} from "./astroAssets";

class MockImage {
  static instances: MockImage[] = [];

  crossOrigin = "";
  decoding = "";
  fetchPriority = "";
  complete = false;
  naturalWidth = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";
  decodeCalls = 0;
  shouldRejectDecode = false;

  constructor() {
    MockImage.instances.push(this);
  }

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
  }

  decode(): Promise<void> {
    this.decodeCalls += 1;
    if (this.shouldRejectDecode) {
      return Promise.reject(new Error("decode failed"));
    }
    return Promise.resolve();
  }

  triggerLoad() {
    this.complete = true;
    this.naturalWidth = 1024;
    this.onload?.();
  }

  triggerError() {
    this.onerror?.();
  }
}

describe("astroAssets", () => {
  const originalImage = globalThis.Image;

  beforeEach(() => {
    resetAstroAssetsCacheForTests();
    MockImage.instances = [];
    vi.stubGlobal("Image", MockImage);
  });

  afterEach(() => {
    resetAstroAssetsCacheForTests();
    if (originalImage === undefined) {
      vi.unstubAllGlobals();
    } else {
      vi.stubGlobal("Image", originalImage);
    }
  });

  it("resolves URLs for every astro texture", () => {
    const urls = getAstroTextureUrls();
    expect(Object.keys(urls)).toHaveLength(ASTRO_TEXTURE_KEYS.length);
    expect(urls.earthDay).toMatch(/\/textures\/astro\/earth_day\.jpg$/);
    expect(urls.moonAlbedo).toMatch(/\/textures\/astro\/moon_albedo\.jpg$/);
    expect(urls.milkyWay).toMatch(/\/textures\/astro\/milky_way\.jpg$/);
    expect(urls.sunSurface).toMatch(/\/textures\/astro\/sun_surface\.jpg$/);
  });

  it("preloads and deduplicates all textures while reporting progress", async () => {
    const snapshots: number[] = [];
    const unsubscribe = subscribeAstroAssets((snap) => {
      snapshots.push(snap.settled);
    });

    const first = preloadAstroAssets();
    const second = preloadAstroAssets();
    expect(first).toBe(second);
    expect(MockImage.instances).toHaveLength(ASTRO_TEXTURE_KEYS.length);

    for (const img of MockImage.instances) {
      expect(img.crossOrigin).toBe("anonymous");
      expect(img.decoding).toBe("async");
      expect(img.fetchPriority).toBe("high");
    }

    expect(getAstroAssetsSnapshot().ready).toBe(false);
    expect(getAstroAssetsSnapshot().settled).toBe(0);

    for (const img of MockImage.instances) {
      img.triggerLoad();
    }

    const loaded = await first;
    unsubscribe();

    expect(snapshots).toHaveLength(ASTRO_TEXTURE_KEYS.length);
    expect(snapshots[snapshots.length - 1]).toBe(ASTRO_TEXTURE_KEYS.length);

    const finalSnapshot = getAstroAssetsSnapshot();
    expect(finalSnapshot.ready).toBe(true);
    expect(finalSnapshot.loaded).toBe(ASTRO_TEXTURE_KEYS.length);
    expect(finalSnapshot.failed).toBe(0);
    expect(finalSnapshot.progress).toBe(1);

    for (const key of ASTRO_TEXTURE_KEYS) {
      expect(loaded[key]).not.toBeNull();
      expect(getCachedAstroTextureImage(key)).toBe(loaded[key]);
    }
  });

  it("settles gracefully when individual textures fail or decode rejects", async () => {
    const promise = preloadAstroAssets();
    expect(MockImage.instances).toHaveLength(ASTRO_TEXTURE_KEYS.length);

    MockImage.instances[0]?.triggerError();
    if (MockImage.instances[1]) {
      MockImage.instances[1].shouldRejectDecode = true;
      MockImage.instances[1].triggerLoad();
    }
    for (let i = 2; i < MockImage.instances.length; i += 1) {
      MockImage.instances[i]?.triggerLoad();
    }

    const loaded = await promise;
    const snap = getAstroAssetsSnapshot();

    expect(snap.ready).toBe(true);
    expect(snap.failed).toBe(1);
    expect(snap.loaded).toBe(ASTRO_TEXTURE_KEYS.length - 1);
    expect(loaded[ASTRO_TEXTURE_KEYS[0] ?? "earthDay"]).toBeNull();
    expect(loaded[ASTRO_TEXTURE_KEYS[1] ?? "earthNight"]).not.toBeNull();
  });

  it("returns null safely when Image is unavailable (SSR)", async () => {
    vi.stubGlobal("Image", undefined);
    const single = await preloadAstroTexture("earthDay");
    const all = await preloadAstroAssets();
    expect(single).toBeNull();
    expect(all.earthDay).toBeNull();
    expect(getCachedAstroTextureImage("earthDay")).toBeNull();
  });
});
