import { describe, expect, it } from "vitest";
import { PRESET_DIM, SHORT_SIDE, dimensionsForTier } from "./outputDimensions.js";

describe("outputDimensions", () => {
  it("has all platform keys used in the UI", () => {
    const keys = Object.keys(PRESET_DIM);
    expect(keys).toContain("instagram-reels");
    expect(keys).toContain("facebook-feed");
    expect(keys).toHaveLength(7);
  });

  it("SHORT_SIDE matches server tiers", () => {
    expect(SHORT_SIDE.hd).toBe(720);
    expect(SHORT_SIDE.fullhd).toBe(1080);
    expect(SHORT_SIDE["2k"]).toBe(1440);
    expect(SHORT_SIDE["4k"]).toBe(2160);
  });

  it("dimensionsForTier matches server for reels 4K", () => {
    const { w, h } = PRESET_DIM["instagram-reels"];
    const d = dimensionsForTier(w, h, "4k");
    expect(d).toEqual({ w: 2160, h: 3840 });
  });

  it("defaults unknown tier short side to 1080", () => {
    const d = dimensionsForTier(1920, 1080, "unknown-tier");
    expect(d).toEqual({ w: 1920, h: 1080 });
  });
});
