import { spawn } from "child_process";
import fs from "fs";
import path from "path";

/**
 * @param {string} inputPath
 * @returns {Promise<number>} Duration in seconds, or 0 if unknown.
 */
export function probeDurationSeconds(inputPath) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ]);
    let out = "";
    p.stdout?.on("data", (d) => {
      out += d.toString();
    });
    p.on("error", () => done(0));
    p.on("close", (code) => {
      if (code !== 0) {
        done(0);
        return;
      }
      const sec = parseFloat(out.trim());
      done(Number.isFinite(sec) && sec > 0 ? sec : 0);
    });
  });
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function lastTimeSecondsInFfmpegLog(text) {
  let best = null;
  const re = /time=(\d+):(\d+):(\d+\.\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const s =
      parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
    if (Number.isFinite(s)) best = s;
  }
  return best;
}

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

/** @typedef {'hd' | 'fullhd' | '2k' | '4k'} ResolutionTierId */

/** Target shortest side in pixels — keeps platform aspect ratio (e.g. 9:16 Reels scale together). */
const SHORT_SIDE_BY_TIER = {
  hd: 720,
  fullhd: 1080,
  "2k": 1440,
  "4k": 2160,
};

/**
 * @param {{ width: number, height: number }} preset
 * @param {ResolutionTierId} tier
 */
export function dimensionsForTier(preset, tier) {
  const shortTarget = SHORT_SIDE_BY_TIER[tier];
  if (!shortTarget) return { width: preset.width, height: preset.height };
  const m = Math.min(preset.width, preset.height);
  const f = shortTarget / m;
  let w = Math.round(preset.width * f);
  let h = Math.round(preset.height * f);
  if (w % 2) w -= 1;
  if (h % 2) h -= 1;
  return { width: Math.max(2, w), height: Math.max(2, h) };
}

/**
 * @param {string | undefined} raw
 * @returns {ResolutionTierId}
 */
export function normalizeResolutionTier(raw) {
  const x = String(raw || "fullhd").toLowerCase();
  if (x === "hd" || x === "720" || x === "720p") return "hd";
  if (x === "fullhd" || x === "full_hd" || x === "1080" || x === "1080p" || x === "fhd") return "fullhd";
  if (x === "2k" || x === "1440" || x === "1440p" || x === "qhd") return "2k";
  if (x === "4k" || x === "2160" || x === "2160p" || x === "uhd" || x === "ultra") return "4k";
  return "fullhd";
}

/**
 * Build video filter: scale/crop to target, optional color effect, optional sharpen on 4K tier.
 * @param {{ width: number, height: number }} target
 * @param {FramingMode} framing
 * @param {EffectId} effectId
 * @param {ResolutionTierId} resolutionTier
 */
function buildVideoFilter(target, framing, effectId, resolutionTier) {
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

  if (resolutionTier === "4k") {
    chain = `${chain},unsharp=5:5:0.55:3:3:0.0`;
  }

  return chain;
}

/** @typedef {'mp4' | 'mov' | 'webm'} OutputFormat */
/** @typedef {'light' | 'balanced' | 'high' | 'max'} QualityId */

const H264_QUALITY = {
  light: { crf: 26, preset: "fast", audio: "128k" },
  balanced: { crf: 23, preset: "medium", audio: "160k" },
  high: { crf: 20, preset: "slow", audio: "192k" },
  max: { crf: 18, preset: "slower", audio: "256k" },
};

const VP9_QUALITY = {
  light: { crf: "40", audio: "96k" },
  balanced: { crf: "35", audio: "128k" },
  high: { crf: "30", audio: "160k" },
  max: { crf: "26", audio: "192k" },
};

const OUTPUT_EXT = {
  mp4: ".mp4",
  mov: ".mov",
  webm: ".webm",
};

export function listPresets() {
  return PRESETS;
}

export function listExportOptions() {
  return {
    formats: [
      { id: "mp4", label: "MP4", desc: "H.264 + AAC — works everywhere, best for Instagram & Facebook" },
      { id: "mov", label: "MOV", desc: "H.264 + AAC — QuickTime and Apple-friendly container" },
      { id: "webm", label: "WebM", desc: "VP9 + Opus — great for web playback and smaller files" },
    ],
    qualities: [
      { id: "light", label: "Light", desc: "Smaller file, quicker encode — fine for drafts or slow networks" },
      { id: "balanced", label: "Balanced", desc: "Default: good quality and reasonable size" },
      { id: "high", label: "High", desc: "Sharper detail, larger file" },
      { id: "max", label: "Maximum", desc: "Best quality, slowest encode, largest file" },
    ],
    resolutionTiers: [
      {
        id: "hd",
        label: "HD",
        badge: "720p class",
        desc: "Short side 720 px — lighter files, quick sharing (e.g. 1280×720 for 16:9).",
      },
      {
        id: "fullhd",
        label: "Full HD",
        badge: "1080p class",
        desc: "Short side 1080 px — standard for most social exports (e.g. 1920×1080 or 1080×1920).",
      },
      {
        id: "2k",
        label: "2K",
        badge: "1440p class",
        desc: "Short side 1440 px — extra headroom between Full HD and 4K (e.g. 2560×1440 for 16:9).",
      },
      {
        id: "4k",
        label: "4K / UHD",
        badge: "2160p class",
        desc: "Short side 2160 px — Ultra HD frame size for your aspect (e.g. 3840×2160 landscape). Light sharpen applied.",
      },
    ],
  };
}

export function outputExtensionForFormat(format) {
  const f = format === "mov" || format === "webm" ? format : "mp4";
  return OUTPUT_EXT[f];
}

/**
 * @param {QualityId} qualityId
 * @param {ResolutionTierId} resolutionTier
 */
function h264Crf(qualityId, resolutionTier) {
  const q = H264_QUALITY[qualityId] || H264_QUALITY.balanced;
  let crf = q.crf;
  if (resolutionTier === "4k") crf = Math.max(16, crf - 1);
  return String(crf);
}

/**
 * @param {OutputFormat} outputFormat
 * @param {QualityId} qualityId
 * @param {ResolutionTierId} resolutionTier
 */
function buildEncodeArgs(outputFormat, qualityId, resolutionTier) {
  const qid = H264_QUALITY[qualityId] ? qualityId : "balanced";

  if (outputFormat === "webm") {
    const v = VP9_QUALITY[qid] || VP9_QUALITY.balanced;
    return [
      "-c:v",
      "libvpx-vp9",
      "-crf",
      resolutionTier === "4k" ? String(Math.max(24, parseInt(v.crf, 10) - 2)) : v.crf,
      "-b:v",
      "0",
      "-row-mt",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "libopus",
      "-b:a",
      v.audio,
    ];
  }

  const q = H264_QUALITY[qid];
  const args = [
    "-c:v",
    "libx264",
    "-preset",
    q.preset,
    "-crf",
    h264Crf(qid, resolutionTier),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    q.audio,
  ];
  if (outputFormat === "mp4") {
    args.push("-movflags", "+faststart");
  }
  return args;
}

/**
 * @param {{ inputPath: string, outputPath: string, platform: string, framing: string, effect: string, resolutionTier?: string, ultraHd?: boolean, outputFormat?: string, quality?: string }} opts
 * @param {{ onProgress?: (percent0to99: number) => void } | ((percent0to99: number) => void) | undefined} progress */
export function processVideo(opts, progress) {
  const onProgress =
    typeof progress === "function" ? progress : progress && typeof progress.onProgress === "function"
      ? progress.onProgress
      : undefined;

  const preset = PRESETS[opts.platform];
  if (!preset) {
    return Promise.reject(new Error(`Unknown platform: ${opts.platform}`));
  }

  const framing = opts.framing === "contain" ? "contain" : "cover";
  const effect = EFFECT_FILTERS[opts.effect] !== undefined ? opts.effect : "none";
  let resolutionTier = normalizeResolutionTier(opts.resolutionTier);
  const tierFromClient = opts.resolutionTier != null && String(opts.resolutionTier).trim() !== "";
  if (!tierFromClient && (opts.ultraHd === true || opts.ultraHd === "true")) {
    resolutionTier = "4k";
  }
  const outputFormat = opts.outputFormat === "mov" || opts.outputFormat === "webm" ? opts.outputFormat : "mp4";
  const qid = opts.quality;
  const quality =
    qid === "light" || qid === "balanced" || qid === "high" || qid === "max" ? qid : "balanced";

  const target = dimensionsForTier(preset, resolutionTier);
  const vf = buildVideoFilter(target, framing, effect, resolutionTier);
  const encodeArgs = buildEncodeArgs(
    outputFormat,
    /** @type {QualityId} */ (quality),
    resolutionTier
  );

  const args = ["-y", "-i", opts.inputPath, "-vf", vf, ...encodeArgs, opts.outputPath];

  return probeDurationSeconds(opts.inputPath).then((durationSec) =>
    new Promise((resolve, reject) => {
      let lastReport = 0;
      const report = (pct) => {
        if (!onProgress) return;
        const p = Math.max(0, Math.min(99, Math.round(pct)));
        const now = Date.now();
        if (p < 99 && now - lastReport < 180) return;
        lastReport = now;
        onProgress(p);
      };

      const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      let unknownProgressTick = 15;

      ff.stderr?.on("data", (d) => {
        stderr += d.toString();
        if (!onProgress) return;
        if (durationSec > 0) {
          const tail = stderr.slice(-8000);
          const t = lastTimeSecondsInFfmpegLog(tail);
          if (t != null) {
            report((t / durationSec) * 100);
          }
        } else {
          const tail = stderr.slice(-2000);
          if (/frame=\s*\d+/.test(tail)) {
            unknownProgressTick = Math.min(92, unknownProgressTick + 1.2);
            report(unknownProgressTick);
          }
        }
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
        if (code === 0) {
          onProgress?.(99);
          resolve({ stderr: stderr.slice(-2000) });
        } else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1500)}`));
      });
    })
  );
}

/**
 * @param {string} platformKey
 * @param {string | undefined} resolutionTierRaw
 * @param {boolean | string | undefined} ultraHdLegacy
 */
export function getOutputSizeMeta(platformKey, resolutionTierRaw, ultraHdLegacy) {
  const preset = PRESETS[platformKey];
  if (!preset) return null;
  let tier = normalizeResolutionTier(resolutionTierRaw);
  const tierFromClient =
    resolutionTierRaw != null && String(resolutionTierRaw).trim() !== "";
  if (!tierFromClient && (ultraHdLegacy === true || ultraHdLegacy === "true")) {
    tier = "4k";
  }
  const { width, height } = dimensionsForTier(preset, tier);
  return { width, height, resolutionTier: tier };
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
