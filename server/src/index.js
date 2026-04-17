import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { processVideo, listPresets, ensureDir, safeJoin } from "./videoProcessor.js";

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

const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(mp4|mov|webm|mkv|avi)$/i.test(file.originalname) || /^video\//.test(file.mimetype);
    cb(null, ok);
  },
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/presets", (_req, res) => {
  res.json({ presets: listPresets() });
});

app.post("/api/process", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file (field name: video)" });
  }

  const platform = String(req.body.platform || "instagram-reels");
  const framing = String(req.body.framing || "cover");
  const effect = String(req.body.effect || "none");
  const ultraHd = req.body.ultraHd === true || req.body.ultraHd === "true";

  const id = uuidv4();
  const ext = path.extname(req.file.originalname) || ".mp4";
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
      ultraHd,
    });
  } catch (e) {
    fs.unlink(inputPath, () => {});
    return res.status(500).json({ error: e.message || "Processing failed" });
  }

  fs.unlink(inputPath, () => {});
  res.json({
    id,
    downloadUrl: `/api/download/${id}${ext}`,
    platform,
    framing,
    effect,
    ultraHd,
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

app.listen(PORT, () => {
  console.log(`Video studio API http://localhost:${PORT}`);
});
