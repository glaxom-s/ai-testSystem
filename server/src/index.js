import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import {
  processVideo,
  listPresets,
  listExportOptions,
  outputExtensionForFormat,
  getOutputSizeMeta,
  ensureDir,
  safeJoin,
} from "./videoProcessor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const UPLOADS = path.join(ROOT, "uploads");
const OUTPUTS = path.join(ROOT, "outputs");

ensureDir(UPLOADS);
ensureDir(OUTPUTS);

const app = express();
const PORT = process.env.PORT || 5050;

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());

const videoFileFilter = (_req, file, cb) => {
  const ok = /\.(mp4|mov|webm|mkv|avi)$/i.test(file.originalname) || /^video\//.test(file.mimetype);
  cb(null, ok);
};

const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: videoFileFilter,
});

const uploadNamed = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "") || ".mp4";
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: videoFileFilter,
});

/** @type {Map<string, Record<string, unknown>>} */
const jobs = new Map();

/**
 * @param {Record<string, unknown>} body
 */
function parseEditFromBody(body) {
  const ts =
    body.trimStartSec != null && body.trimStartSec !== ""
      ? parseFloat(String(body.trimStartSec))
      : 0;
  let trimEndSec = null;
  if (body.trimEndSec != null && body.trimEndSec !== "") {
    const x = parseFloat(String(body.trimEndSec));
    if (Number.isFinite(x)) trimEndSec = x;
  }
  const ps = parseFloat(String(body.playbackSpeed ?? ""));
  return {
    trimStartSec: Number.isFinite(ts) ? ts : 0,
    trimEndSec,
    cropPreset: String(body.cropPreset || "none"),
    maskPreset: String(body.maskPreset || "none"),
    reverse: body.reverse === true || body.reverse === "true",
    playbackSpeed: Number.isFinite(ps) ? ps : 1,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/presets", (_req, res) => {
  res.json({ presets: listPresets(), export: listExportOptions() });
});

app.post("/api/upload", uploadNamed.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file (field name: video)" });
  }
  res.json({ uploadId: req.file.filename });
});

app.post("/api/render", (req, res) => {
  const uploadId = req.body?.uploadId;
  if (!uploadId || typeof uploadId !== "string") {
    return res.status(400).json({ error: "uploadId required" });
  }
  const base = path.basename(uploadId);
  if (base !== uploadId) {
    return res.status(400).json({ error: "Invalid uploadId" });
  }
  const inputPath = safeJoin(UPLOADS, base);
  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: "Upload not found or expired" });
  }

  const platform = String(req.body.platform || "instagram-reels");
  const framing = String(req.body.framing || "cover");
  const effect = String(req.body.effect || "none");
  const ultraHdLegacy = req.body.ultraHd === true || req.body.ultraHd === "true";
  const resolutionTier = req.body.resolutionTier != null ? String(req.body.resolutionTier) : "";
  const outputFormat = String(req.body.outputFormat || "mp4").toLowerCase();
  const quality = String(req.body.quality || "balanced").toLowerCase();
  const editOpts = parseEditFromBody(req.body);

  const outId = uuidv4();
  const ext = outputExtensionForFormat(outputFormat);
  const outputName = `${outId}${ext}`;
  const outputPath = safeJoin(OUTPUTS, outputName);
  const jobId = uuidv4();

  const jobState = {
    status: "processing",
    percent: 0,
    phase: "encoding",
  };
  jobs.set(jobId, jobState);

  res.json({ jobId });

  (async () => {
    try {
      await processVideo(
        {
          inputPath,
          outputPath,
          platform,
          framing,
          effect,
          resolutionTier: resolutionTier || undefined,
          ultraHd: ultraHdLegacy,
          outputFormat,
          quality,
          ...editOpts,
        },
        (pct) => {
          jobState.percent = pct;
        }
      );

      fs.unlink(inputPath, () => {});
      const sizeMeta = getOutputSizeMeta(platform, resolutionTier || undefined, ultraHdLegacy);
      jobState.status = "done";
      jobState.percent = 100;
      jobState.phase = "done";
      jobState.downloadUrl = `/api/download/${outputName}`;
      jobState.outputFormat = outputFormat === "mov" || outputFormat === "webm" ? outputFormat : "mp4";
      jobState.quality = quality;
      jobState.resolutionTier = sizeMeta?.resolutionTier;
      jobState.outputWidth = sizeMeta?.width;
      jobState.outputHeight = sizeMeta?.height;
      jobState.id = outId;

      setTimeout(() => jobs.delete(jobId), 15 * 60 * 1000);
    } catch (e) {
      fs.unlink(inputPath, () => {});
      jobState.status = "error";
      jobState.error = e.message || "Processing failed";
      jobState.percent = 0;
      setTimeout(() => jobs.delete(jobId), 60 * 60 * 1000);
    }
  })();
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(job);
});

app.post("/api/process", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file (field name: video)" });
  }

  const platform = String(req.body.platform || "instagram-reels");
  const framing = String(req.body.framing || "cover");
  const effect = String(req.body.effect || "none");
  const ultraHdLegacy = req.body.ultraHd === true || req.body.ultraHd === "true";
  const resolutionTier = req.body.resolutionTier != null ? String(req.body.resolutionTier) : "";
  const outputFormat = String(req.body.outputFormat || "mp4").toLowerCase();
  const quality = String(req.body.quality || "balanced").toLowerCase();
  const editOpts = parseEditFromBody(req.body);

  const id = uuidv4();
  const ext = outputExtensionForFormat(outputFormat);
  const inputPath = req.file.path;
  const outputName = `${id}${ext}`;
  const outputPath = safeJoin(OUTPUTS, outputName);

  try {
    await processVideo({
      inputPath,
      outputPath,
      platform,
      framing,
      effect,
      resolutionTier: resolutionTier || undefined,
      ultraHd: ultraHdLegacy,
      outputFormat,
      quality,
      ...editOpts,
    });
  } catch (e) {
    fs.unlink(inputPath, () => {});
    return res.status(500).json({ error: e.message || "Processing failed" });
  }

  fs.unlink(inputPath, () => {});
  const sizeMeta = getOutputSizeMeta(platform, resolutionTier || undefined, ultraHdLegacy);
  res.json({
    id,
    downloadUrl: `/api/download/${id}${ext}`,
    platform,
    framing,
    effect,
    outputFormat: outputFormat === "mov" || outputFormat === "webm" ? outputFormat : "mp4",
    quality,
    resolutionTier: sizeMeta?.resolutionTier,
    outputWidth: sizeMeta?.width,
    outputHeight: sizeMeta?.height,
  });
});

app.get("/api/download/:file", (req, res) => {
  const base = path.basename(req.params.file);
  const filePath = safeJoin(OUTPUTS, base);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }
  res.download(filePath, `edited-${base}`, (err) => {
    if (err && !res.headersSent) res.status(500).end();
  });
});

export { app };

if (process.env.VITEST !== "true") {
  app.listen(PORT, () => {
    console.log(`Video studio API http://localhost:${PORT}`);
  });
}
