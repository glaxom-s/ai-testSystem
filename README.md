# Social Video Studio

React + Node.js video workflow for **Instagram** and **Facebook** presets: pick **effects**, **framing** (fill vs fit), and optional **Ultra HD** upscale (FFmpeg Lanczos + sharpen). UI is inspired by quick-export flows like [CapCut](https://www.capcut.com/).

## Prerequisites

- Node.js 18+
- [FFmpeg](https://ffmpeg.org/download.html) on your `PATH` (required for encoding and filters)

## Setup

```bash
npm run install:all
```

## Run (two terminals)

**Terminal 1 — API (port 5050)**

```bash
cd server
npm run dev
```

**Terminal 2 — UI (port 5173)**

```bash
cd client
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` to the backend.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/presets` | Platform size map |
| POST | `/api/process` | Multipart form: `video`, `platform`, `framing`, `effect`, `ultraHd` |
| GET | `/api/download/:file` | Download rendered file |

Optional env: see `.env.example`.

## Note on “Ultra HD”

Export uses **scaling and sharpening**, not AI super-resolution. For AI-style enhancement you would integrate a separate inference service; the current stack matches a typical Node + FFmpeg deployment.
