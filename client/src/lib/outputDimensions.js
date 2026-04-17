/** Matches server PRESETS — preview output pixel size for the selected tier. */
export const PRESET_DIM = {
  "instagram-reels": { w: 1080, h: 1920 },
  "instagram-story": { w: 1080, h: 1920 },
  "instagram-square": { w: 1080, h: 1080 },
  "instagram-portrait": { w: 1080, h: 1350 },
  "facebook-feed": { w: 1920, h: 1080 },
  "facebook-story": { w: 1080, h: 1920 },
  "facebook-square": { w: 1080, h: 1080 },
};

export const SHORT_SIDE = { hd: 720, fullhd: 1080, "2k": 1440, "4k": 2160 };

export function dimensionsForTier(pw, ph, tier) {
  const shortTarget = SHORT_SIDE[tier] ?? 1080;
  const m = Math.min(pw, ph);
  const f = shortTarget / m;
  let w = Math.round(pw * f);
  let h = Math.round(ph * f);
  if (w % 2) w -= 1;
  if (h % 2) h -= 1;
  return { w: Math.max(2, w), h: Math.max(2, h) };
}
