import { spawn } from "child_process";
import fs from "fs";
import path from "path";

/** @typedef {'instagram-reels' | 'instagram-story' | 'instagram-square' | 'instagram-portrait' | 'facebook-feed' | 'facebook-story' | 'facebook-square'} PlatformPreset */
/** @typedef {'none' | 'cinematic' | 'warm' | 'cool' | 'vibrant' | 'noir' | 'soft-glow'} EffectId */
/** @typedef {'cover' | 'contain'} FramingMode */

const PRESETS = {
  "instagram-reels": { width: 1080, height: 1920, label: "Instagram Reels (9:16)" },
  "instagram-story": { width: 1080, height: 1920, label: "Instagram Story (9:16)" },
  "instagram-square": { width: 1080, height: 1080, label: "Instagram Square (1:1)" },
  "instagram-portrait": { width: 1080, height: 1350, label: "Instagram Feed 4:5" },
  "facebook-feed": { width: 1920, height: 1080, label: "Facebook Feed 16:9" },
  "facebook-story": { width: 1080, height: 1920, label: "Facebook Story (9:16)" },
  "facebook-square": { width: 1080, height: 1080, label: "Facebook Square (1:1)" },
};

const EFFECT_FILTERS = {
  none: "",
  cinematic: "eq=contrast=1.12:brightness=-0.05:saturation=0.9",
  warm: "colorbalance=rs=0.08:gs=0.02:bs=-0.06",
  cool: "colorbalance=rs=-0.06:gs=0.02:bs=0.1",
  vibrant: "eq=saturation=1.35:contrast=1.08",
  noir: "hue=s=0,eq=contrast=1.15:brightness=-0.02",
  "soft-glow": "eq=brightness=0.02:saturation=0.95,unsharp=7:7:0.35:5:5:0.0",
};

/**
 * Build video filter: framing + optional effect + optional Ultra HD upscale/sharpen.
 * @param {{ width: number, height: number }} target
 * @param {FramingMode} framing
 * @param {EffectId} effectId
 * @param {boolean} ultraHd
 */
function buildVideoFilter(target, framing, effectId, ultraHd) {
  const tw = target.width;
  const th = target.height;
  const baseScale =
    framing === "cover"
      ? `scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th}`
      : `scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black`;

  const effect = EFFECT_FILTERS[effectId] || "";
  const parts = [baseScale];
  if (effect) parts.push(effect);

  let chain = parts.filter(Boolean).join(",");

  if (ultraHd) {
    const scaleUp = tw >= th ? "scale=3840:-2:flags=lanczos" : "scale=-2:3840:flags=lanczos";
    const sharpen = "unsharp=5:5:0.65:3:3:0.0";
    chain = `${chain},${scaleUp},${sharpen}`;
  }

  return chain;
}

export function listPresets() {
  return PRESETS;
}

/**
 * @param {{ inputPath: string, outputPath: string, platform: string, framing: string, effect: string, ultraHd: boolean }} opts
 */
export function processVideo(opts) {
  const preset = PRESETS[opts.platform];
  if (!preset) {
    return Promise.reject(new Error(`Unknown platform: ${opts.platform}`));
  }

  const framing = opts.framing === "contain" ? "contain" : "cover";
  const effect = EFFECT_FILTERS[opts.effect] !== undefined ? opts.effect : "none";
  const ultraHd = Boolean(opts.ultraHd);

  const vf = buildVideoFilter(preset, framing, effect, ultraHd);

  const args = [
    "-y",
    "-i",
    opts.inputPath,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    ultraHd ? "20" : "22",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    opts.outputPath,
  ];

  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    ff.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    ff.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "FFmpeg not found. Install FFmpeg and ensure it is on your PATH (https://ffmpeg.org/download.html)."
          )
        );
      } else reject(err);
    });
    ff.on("close", (code) => {
      if (code === 0) resolve({ stderr: stderr.slice(-2000) });
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function safeJoin(base, name) {
  const resolved = path.resolve(base, name);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error("Invalid path");
  }
  return resolved;
}
