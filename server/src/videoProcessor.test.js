import path from "path";
import os from "os";
import { describe, expect, it } from "vitest";
import {
  dimensionsForTier,
  normalizeResolutionTier,
  outputExtensionForFormat,
  getOutputSizeMeta,
  listPresets,
  listExportOptions,
  safeJoin,
} from "./videoProcessor.js";

describe("dimensionsForTier", () => {
  it("scales 9:16 preset to Full HD (1080 short side)", () => {
    const preset = { width: 1080, height: 1920 };
    const d = dimensionsForTier(preset, "fullhd");
    expect(d.width).toBe(1080);
    expect(d.height).toBe(1920);
  });

  it("scales 9:16 to 4K tier (2160 short side)", () => {
    const preset = { width: 1080, height: 1920 };
    const d = dimensionsForTier(preset, "4k");
    expect(d.width).toBe(2160);
    expect(d.height).toBe(3840);
  });

  it("scales 16:9 feed to Full HD", () => {
    const preset = { width: 1920, height: 1080 };
    const d = dimensionsForTier(preset, "fullhd");
    expect(d.width).toBe(1920);
    expect(d.height).toBe(1080);
  });

  it("scales 16:9 to HD (720 short)", () => {
    const preset = { width: 1920, height: 1080 };
    const d = dimensionsForTier(preset, "hd");
    expect(d.width).toBe(1280);
    expect(d.height).toBe(720);
  });

  it("keeps dimensions even", () => {
    const preset = { width: 1080, height: 1350 };
    const d = dimensionsForTier(preset, "2k");
    expect(d.width % 2).toBe(0);
    expect(d.height % 2).toBe(0);
  });
});

describe("normalizeResolutionTier", () => {
  it("maps common aliases", () => {
    expect(normalizeResolutionTier("1080p")).toBe("fullhd");
    expect(normalizeResolutionTier("4k")).toBe("4k");
    expect(normalizeResolutionTier("uhd")).toBe("4k");
    expect(normalizeResolutionTier("qhd")).toBe("2k");
    expect(normalizeResolutionTier("720p")).toBe("hd");
  });

  it("defaults invalid values to fullhd", () => {
    expect(normalizeResolutionTier("")).toBe("fullhd");
    expect(normalizeResolutionTier("unknown")).toBe("fullhd");
  });
});

describe("outputExtensionForFormat", () => {
  it("returns correct extensions", () => {
    expect(outputExtensionForFormat("mp4")).toBe(".mp4");
    expect(outputExtensionForFormat("mov")).toBe(".mov");
    expect(outputExtensionForFormat("webm")).toBe(".webm");
    expect(outputExtensionForFormat("bogus")).toBe(".mp4");
  });
});

describe("getOutputSizeMeta", () => {
  it("returns tier and pixel size for platform", () => {
    const m = getOutputSizeMeta("instagram-reels", "fullhd", false);
    expect(m?.resolutionTier).toBe("fullhd");
    expect(m?.width).toBe(1080);
    expect(m?.height).toBe(1920);
  });

  it("maps ultraHd legacy when tier omitted", () => {
    const m = getOutputSizeMeta("facebook-feed", undefined, true);
    expect(m?.resolutionTier).toBe("4k");
    expect(m?.width).toBe(3840);
    expect(m?.height).toBe(2160);
  });

  it("returns null for unknown platform", () => {
    expect(getOutputSizeMeta("not-a-platform", "hd", false)).toBeNull();
  });
});

describe("listPresets", () => {
  it("includes expected platform keys", () => {
    const p = listPresets();
    expect(p["instagram-reels"]).toMatchObject({ width: 1080, height: 1920 });
    expect(p["facebook-feed"]).toMatchObject({ width: 1920, height: 1080 });
  });
});

describe("listExportOptions", () => {
  it("exposes formats, qualities, resolution tiers, and edit tools", () => {
    const ex = listExportOptions();
    expect(ex.formats.map((f) => f.id)).toEqual(["mp4", "mov", "webm"]);
    expect(ex.qualities).toHaveLength(4);
    expect(ex.resolutionTiers.map((t) => t.id)).toEqual(["hd", "fullhd", "2k", "4k"]);
    expect(ex.editTools?.crops?.length).toBeGreaterThan(0);
    expect(ex.editTools?.masks?.length).toBeGreaterThan(0);
    expect(ex.editTools?.speeds?.length).toBeGreaterThan(0);
  });
});

describe("safeJoin", () => {
  const base = path.join(os.tmpdir(), "video-studio-safejoin");

  it("allows files inside base", () => {
    const j = safeJoin(base, "abc.mp4");
    expect(j).toContain("abc.mp4");
    expect(path.normalize(j).startsWith(path.normalize(base))).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(() => safeJoin(base, path.join("..", "outside-secret.txt"))).toThrow("Invalid path");
  });
});
