# Social Video Studio

React + Node.js video workflow for **Instagram** and **Facebook** presets: pick **effects**, **framing** (fill vs fit), and optional **Ultra HD** upscale (FFmpeg Lanczos + sharpen). UI is inspired by quick-export flows like.

## Prerequisites

- Node.js 18+


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

**`http proxy error` / `ECONNREFUSED`:** the API is not running or is on another port. Start `cd server && npm run dev` first. If the server uses a non-default `PORT`, copy `client/.env.example` to `client/.env` and set `VITE_API_PROXY` to the same host/port (for example `http://127.0.0.1:3000`).

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/presets` | Platform size map |
| POST | `/api/upload` | Multipart `video` → `{ uploadId }` (stable filename for the next step) |
| POST | `/api/render` | JSON: `uploadId`, `platform`, `framing`, `effect`, `outputFormat`, `quality`, `resolutionTier` (optional `ultraHd`). **Edit (optional):** `trimStartSec`, `trimEndSec` (omit for full length), `cropPreset` (`none` \| `center_tight` \| `widescreen` \| `portrait_trim`), `maskPreset` (`none` \| `vignette`), `reverse` (boolean), `playbackSpeed` (`0.5`–`2`) → `{ jobId }` |
| GET | `/api/jobs/:jobId` | `{ status: processing\|done\|error, percent, downloadUrl?, error? }` — poll for progress |
| POST | `/api/process` | **Legacy** single-shot: multipart `video` + same fields as `/api/render` (no live progress) |
| GET | `/api/download/:file` | Download rendered file |

Optional env: see `.env.example`.

## Tests

```bash
cd server && npm install && npm test
cd client && npm install && npm test
```

From repo root: `npm run test` runs both. For HTML + terminal coverage reports: `npm run test:coverage` (outputs `server/coverage` and `client/coverage`). Server tests cover `videoProcessor` helpers and HTTP routes (no FFmpeg required for those cases). Client tests cover output-dimension helpers and a smoke render of `App`.

## Note on “Ultra HD”

Export uses **scaling and sharpening**, not AI super-resolution. For AI-style enhancement you would integrate a separate inference service; the current stack matches a typical Node + FFmpeg deployment.
