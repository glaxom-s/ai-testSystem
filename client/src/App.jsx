import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import VideoEditingBar from "./components/VideoEditingBar.jsx";
import { PRESET_DIM, dimensionsForTier } from "./lib/outputDimensions.js";

function wrapNetworkError(err) {
  const msg = err?.message ?? String(err);
  if (
    err instanceof TypeError ||
    /Failed to fetch|NetworkError|ECONNREFUSED|Load failed|network error/i.test(msg)
  ) {
    return new Error(
      "Cannot reach the API server (connection refused). In another terminal run: cd server && npm run dev — default port is 5050. If you use a different port, add client/.env with VITE_API_PROXY=http://127.0.0.1:YOUR_PORT"
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

const PLATFORMS = [
  { id: 'instagram-reels', group: 'Instagram', icon: '🎬', desc: '9:16 · Reels & short video' },
  { id: 'instagram-story', group: 'Instagram', icon: '📱', desc: '9:16 · Full-screen story' },
  { id: 'instagram-square', group: 'Instagram', icon: '◼', desc: '1:1 · Feed square' },
  { id: 'instagram-portrait', group: 'Instagram', icon: '◻', desc: '4:5 · Feed portrait' },
  { id: 'facebook-feed', group: 'Facebook', icon: '📺', desc: '16:9 · Feed landscape' },
  { id: 'facebook-story', group: 'Facebook', icon: '📱', desc: '9:16 · Stories' },
  { id: 'facebook-square', group: 'Facebook', icon: '◼', desc: '1:1 · Square posts' },
];

const EFFECTS = [
  { id: "none", label: "Original", hint: "No color grade" },
  { id: "cinematic", label: "Cinematic", hint: "Muted, contrast" },
  { id: "vibrant", label: "Vibrant", hint: "Punchy saturation" },
  { id: "warm", label: "Warm", hint: "Golden tones" },
  { id: "cool", label: "Cool", hint: "Crisp blues" },
  { id: "noir", label: "Noir", hint: "Black & white" },
  { id: "soft-glow", label: "Soft glow", hint: "Gentle, dreamy" },
];

const FRAMING = [
  { id: "cover", label: "Fill frame", hint: "Crops edges to remove letterbox — best for vertical." },
  { id: "contain", label: "Fit inside", hint: "Shows full video with bars if needed." },
];

const OUTPUT_FORMATS = [
  { id: "mp4", label: "MP4", hint: "H.264 + AAC — universal; best for Instagram & Facebook" },
  { id: "mov", label: "MOV", hint: "Same codecs in a QuickTime-friendly container" },
  { id: "webm", label: "WebM", hint: "VP9 + Opus — web-friendly, often smaller files" },
];

const ENCODING_QUALITY = [
  { id: "light", label: "Light", hint: "Smaller file, faster encode" },
  { id: "balanced", label: "Balanced", hint: "Recommended default" },
  { id: "high", label: "High", hint: "Sharper, larger file" },
  { id: "max", label: "Maximum", hint: "Best quality, slowest" },
];

const RESOLUTION_TIERS = [
  { id: "hd", label: "HD", badge: "720p class", hint: "Short side 720 px — smaller, faster uploads." },
  { id: "fullhd", label: "Full HD", badge: "1080p class", hint: "Short side 1080 px — typical social quality." },
  { id: "2k", label: "2K", badge: "1440p class", hint: "Short side 1440 px — between Full HD and 4K." },
  { id: "4k", label: "4K / UHD", badge: "2160p class", hint: "Short side 2160 px — full UHD frame + light sharpen." },
];

const CROP_PRESETS = [
  { id: "none", label: "Full frame", hint: "No extra crop before social sizing." },
  { id: "center_tight", label: "Center tight", hint: "Crop ~8% from each side (focus subject)." },
  { id: "widescreen", label: "Trim sides", hint: "Narrower frame — less width (landscape clips)." },
  { id: "portrait_trim", label: "Trim top/bottom", hint: "Shorter frame — less height (vertical clips)." },
];

const MASK_PRESETS = [
  { id: "none", label: "No mask", hint: "Clean edges." },
  { id: "vignette", label: "Soft vignette", hint: "Edge darkening (simple mask look)." },
];

const PLAYBACK_SPEEDS = [
  { value: 0.5, label: "0.5× slow" },
  { value: 1, label: "1× normal" },
  { value: 1.5, label: "1.5×" },
  { value: 2, label: "2× fast" },
];

export default function App() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [platform, setPlatform] = useState("instagram-reels");
  const [effect, setEffect] = useState("none");
  const [framing, setFraming] = useState("cover");
  const [outputFormat, setOutputFormat] = useState("mp4");
  const [quality, setQuality] = useState("balanced");
  const [resolutionTier, setResolutionTier] = useState("fullhd");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [downloadPath, setDownloadPath] = useState(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressPhase, setProgressPhase] = useState("");
  const pollRef = useRef(null);
  const videoRef = useRef(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [trimStartSec, setTrimStartSec] = useState(0);
  const [trimEndSec, setTrimEndSec] = useState(null);
  const [cropPreset, setCropPreset] = useState("none");
  const [maskPreset, setMaskPreset] = useState("none");
  const [reverseVideo, setReverseVideo] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [playbackSec, setPlaybackSec] = useState(0);

  const groupedPlatforms = useMemo(() => {
    const g = {};
    for (const p of PLATFORMS) {
      if (!g[p.group]) g[p.group] = [];
      g[p.group].push(p);
    }
    return g;
  }, []);

  const estimatedOutputPx = useMemo(() => {
    const d = PRESET_DIM[platform];
    if (!d) return null;
    return dimensionsForTier(d.w, d.h, resolutionTier);
  }, [platform, resolutionTier]);

  const resolutionTierMeta = useMemo(
    () => RESOLUTION_TIERS.find((t) => t.id === resolutionTier),
    [resolutionTier]
  );

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const onFile = useCallback((f) => {
    if (!f) return;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setFile(f);
    setError(null);
    setDownloadPath(null);
    setProgressPercent(0);
    setProgressPhase("");
    setVideoDuration(0);
    setTrimStartSec(0);
    setTrimEndSec(null);
    setCropPreset("none");
    setMaskPreset("none");
    setReverseVideo(false);
    setPlaybackSpeed(1);
    setPlaybackSec(0);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  }, [previewUrl]);

  const onVideoLoadedMetadata = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) {
      setVideoDuration(d);
      setTrimEndSec((prev) => (prev == null || prev > d ? d : prev));
      setTrimStartSec((s) => Math.min(Math.max(0, s), Math.max(0, d - 0.05)));
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f?.type?.startsWith("video/")) onFile(f);
  }, [onFile]);

  const runExport = async () => {
    if (!file) return;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setBusy(true);
    setError(null);
    setDownloadPath(null);
    setProgressPercent(0);
    setProgressPhase("upload");
    try {
      const uploadId = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload");
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const r = e.loaded / e.total;
            setProgressPercent(Math.round(r * 22));
          }
        });
        xhr.onload = () => {
          let data = {};
          try {
            data = JSON.parse(xhr.responseText || "{}");
          } catch {
            /* ignore */
          }
          if (xhr.status >= 200 && xhr.status < 300 && data.uploadId) {
            resolve(data.uploadId);
          } else {
            reject(new Error(data.error || xhr.statusText || "Upload failed"));
          }
        };
        xhr.onerror = () => reject(wrapNetworkError(new TypeError("Failed to fetch")));
        const fd = new FormData();
        fd.append("video", file);
        xhr.send(fd);
      });

      setProgressPercent(22);
      setProgressPhase("encode");

      let startRes;
      try {
        startRes = await fetch("/api/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uploadId,
            platform,
            framing,
            effect,
            outputFormat,
            quality,
            resolutionTier,
            trimStartSec,
            trimEndSec: trimEndSec != null ? trimEndSec : undefined,
            cropPreset,
            maskPreset,
            reverse: reverseVideo,
            playbackSpeed,
          }),
        });
      } catch (err) {
        throw wrapNetworkError(err);
      }
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok) throw new Error(startData.error || startRes.statusText);
      const { jobId } = startData;
      if (!jobId) throw new Error("Server did not start a render job");

      await new Promise((resolve, reject) => {
        let inFlight = false;
        pollRef.current = setInterval(() => {
          if (inFlight) return;
          inFlight = true;
          fetch(`/api/jobs/${jobId}`)
            .then((jr) => jr.json().then((job) => ({ jr, job })))
            .then(({ jr, job }) => {
              inFlight = false;
              if (!jr.ok) {
                if (pollRef.current) clearInterval(pollRef.current);
                pollRef.current = null;
                reject(new Error(job.error || "Could not read job status"));
                return;
              }
              if (job.status === "processing") {
                const enc = typeof job.percent === "number" ? job.percent : 0;
                setProgressPercent(22 + Math.round((enc / 100) * 77));
              }
              if (job.status === "done") {
                if (pollRef.current) clearInterval(pollRef.current);
                pollRef.current = null;
                setProgressPercent(100);
                setProgressPhase("");
                setDownloadPath(job.downloadUrl);
                setTimeout(() => resolve(undefined), 400);
              }
              if (job.status === "error") {
                if (pollRef.current) clearInterval(pollRef.current);
                pollRef.current = null;
                reject(new Error(job.error || "Rendering failed"));
              }
            })
            .catch((err) => {
              inFlight = false;
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              reject(wrapNetworkError(err instanceof Error ? err : new Error(String(err))));
            });
        }, 280);
      });
    } catch (e) {
      setError(e.message || "Something went wrong");
      setProgressPhase("");
      setProgressPercent(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="hero">
        <p className="eyebrow">Social-first video studio</p>
        <h1>
          Edit for <span className="grad">Instagram</span> &amp;{" "}
          <span className="grad2">Facebook</span>
        </h1>
        <p className="lede">
          Pick a format, framing, and a clear resolution tier (HD through 4K), then export. Compression
          quality is separate from pixel size so you always know what you are downloading.
        </p>
      </header>

      <section className="panel upload-panel">
        <h2>1 · Upload</h2>
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <input
            type="file"
            accept="video/*"
            onChange={(e) => onFile(e.target.files?.[0])}
            id="file"
            className="sr-only"
          />
          <label htmlFor="file" className="drop-label">
            <span className="drop-icon" aria-hidden>
              &#8682;
            </span>
            <span>
              <strong>Drop a video</strong> or click to browse
            </span>
            <span className="fine">MP4, MOV, WebM · up to 500 MB</span>
          </label>
        </div>
        {previewUrl && (
          <div className="preview-wrap">
            <video
              ref={videoRef}
              className="preview"
              src={previewUrl}
              controls
              playsInline
              onLoadedMetadata={onVideoLoadedMetadata}
              onTimeUpdate={(e) => setPlaybackSec(e.currentTarget.currentTime)}
            />
            {videoDuration > 0 && (
              <VideoEditingBar
                videoRef={videoRef}
                previewUrl={previewUrl}
                fileName={file?.name ?? "Video"}
                duration={videoDuration}
                playbackSec={playbackSec}
                trimStartSec={trimStartSec}
                trimEndSec={trimEndSec ?? videoDuration}
                onTrimStartSec={setTrimStartSec}
                onTrimEndSec={setTrimEndSec}
                busy={busy}
                progressPercent={progressPercent}
                progressPhase={progressPhase}
              />
            )}
          </div>
        )}
      </section>

      {previewUrl && (
        <section className="panel edit-panel">
          <h2>2 · Cut, crop &amp; transforms</h2>
          <p className="hint">
            Trim the clip on the <strong>timeline over the preview</strong> (drag edges, drag across the strip to
            select a range, or slide the whole block). Then set crop, mask, speed, or reverse here. Export still uses
            your platform and resolution settings below.
          </p>

          <h3 className="subhead">Crop (before social frame)</h3>
          <div className="effect-grid edit-tool-grid">
            {CROP_PRESETS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`card effect-card ${cropPreset === c.id ? "active" : ""}`}
                onClick={() => setCropPreset(c.id)}
              >
                <span className="effect-label">{c.label}</span>
                <span className="effect-hint">{c.hint}</span>
              </button>
            ))}
          </div>

          <h3 className="subhead">Mask</h3>
          <div className="row-options mask-row">
            {MASK_PRESETS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`pill ${maskPreset === m.id ? "active" : ""}`}
                onClick={() => setMaskPreset(m.id)}
              >
                <span className="pill-label">{m.label}</span>
                <span className="pill-hint">{m.hint}</span>
              </button>
            ))}
          </div>

          <h3 className="subhead">Speed &amp; reverse</h3>
          <div className="speed-row">
            {PLAYBACK_SPEEDS.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`chip ${playbackSpeed === s.value ? "active" : ""}`}
                onClick={() => setPlaybackSpeed(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <label className="toggle-row reverse-toggle">
            <input
              type="checkbox"
              checked={reverseVideo}
              onChange={(e) => setReverseVideo(e.target.checked)}
            />
            <div>
              <span className="toggle-title">Reverse clip</span>
              <span className="toggle-desc">
                Plays video and audio backwards (slower encode on long clips).
              </span>
            </div>
          </label>
        </section>
      )}

      <section className="panel">
        <h2>3 · Platform &amp; framing</h2>
        {Object.entries(groupedPlatforms).map(([group, items]) => (
          <div key={group} className="platform-group">
            <h3>{group}</h3>
            <div className="card-grid">
              {items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`card preset-card ${platform === p.id ? "active" : ""}`}
                  onClick={() => setPlatform(p.id)}
                >
                  <span className="preset-icon">{p.icon}</span>
                  <span className="preset-title">{p.id.replace(/-/g, " ")}</span>
                  <span className="preset-desc">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <h3 className="subhead">Framing</h3>
        <div className="row-options">
          {FRAMING.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`pill ${framing === f.id ? "active" : ""}`}
              onClick={() => setFraming(f.id)}
              title={f.hint}
            >
              <span className="pill-label">{f.label}</span>
              <span className="pill-hint">{f.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>4 · Style &amp; effects</h2>
        <div className="effect-grid">
          {EFFECTS.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`card effect-card ${effect === e.id ? "active" : ""}`}
              onClick={() => setEffect(e.id)}
            >
              <span className="effect-label">{e.label}</span>
              <span className="effect-hint">{e.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>5 · Output format</h2>
        <p className="hint">
          Choose the file type for download — convert container and codecs (MP4 and MOV use H.264 +
          AAC; WebM uses VP9 + Opus).
        </p>
        <div className="effect-grid format-grid">
          {OUTPUT_FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`card effect-card ${outputFormat === f.id ? "active" : ""}`}
              onClick={() => setOutputFormat(f.id)}
            >
              <span className="effect-label">{f.label}</span>
              <span className="effect-hint">{f.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>6 · Download size &amp; quality</h2>
        <h3 className="subhead">Output resolution (scale)</h3>
        <p className="hint">
          This sets how many pixels you get, keeping your platform aspect ratio. Categories match common
          labels: <strong>HD</strong> (720p class), <strong>Full HD</strong> (1080p), <strong>2K</strong> (1440p),
          <strong>4K / UHD</strong> (2160p short side — e.g. 3840×2160 for 16:9).
        </p>
        <div className="effect-grid tier-grid">
          {RESOLUTION_TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`card effect-card tier-card ${resolutionTier === t.id ? "active" : ""}`}
              onClick={() => setResolutionTier(t.id)}
            >
              <span className="effect-label">
                {t.label}
                <span className="tier-badge">{t.badge}</span>
              </span>
              <span className="effect-hint">{t.hint}</span>
            </button>
          ))}
        </div>
        {estimatedOutputPx && resolutionTierMeta && (
          <p className="output-estimate" role="status">
            <strong>Download frame size:</strong>{" "}
            <span className="mono">
              {estimatedOutputPx.w} × {estimatedOutputPx.h}
            </span>{" "}
            px — <strong>{resolutionTierMeta.label}</strong> ({resolutionTierMeta.badge}) for the
            platform you selected.
          </p>
        )}
        <h3 className="subhead">Compression (file quality)</h3>
        <p className="hint">
          Same pixel size as above — this only changes how heavily the video is compressed (CRF, encoder
          preset, audio bitrate). Use <strong>Balanced</strong> unless you need smaller files or maximum
          fidelity.
        </p>
        <div className="effect-grid quality-grid">
          {ENCODING_QUALITY.map((q) => (
            <button
              key={q.id}
              type="button"
              className={`card effect-card ${quality === q.id ? "active" : ""}`}
              onClick={() => setQuality(q.id)}
            >
              <span className="effect-label">{q.label}</span>
              <span className="effect-hint">{q.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel actions">
        <button
          type="button"
          className="btn primary"
          disabled={!file || busy}
          onClick={runExport}
        >
          {busy ? "Working…" : "Export video"}
        </button>
        {busy && (
          <div
            className="progress-wrap"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
            aria-label={progressPhase === "upload" ? "Upload progress" : "Encoding progress"}
          >
            <div className="progress-head">
              <span className="progress-label">
                {progressPhase === "upload" ? "Uploading your video…" : "Encoding & rendering…"}
              </span>
              <span className="progress-pct">{progressPercent}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}
        {error && <p className="err">{error}</p>}
        {downloadPath && (
          <a className="btn ghost" href={downloadPath} download>
            Download result
          </a>
        )}
      </section>

      <footer className="foot">
        <p>
          Backend uses FFmpeg — install it and run <code>npm run dev</code> in <code>server</code>{" "}
          and <code>client</code>.
        </p>
      </footer>

      <style>{`
        .app {
          max-width: 920px;
          margin: 0 auto;
          padding: 2.5rem 1.25rem 4rem;
        }
        .hero {
          margin-bottom: 2rem;
        }
        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.72rem;
          color: var(--muted);
          margin: 0 0 0.5rem;
        }
        .hero h1 {
          font-family: var(--font-display);
          font-size: clamp(1.75rem, 4vw, 2.35rem);
          line-height: 1.15;
          margin: 0 0 0.75rem;
          font-weight: 700;
        }
        .grad {
          background: linear-gradient(120deg, var(--accent), var(--accent-2));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .grad2 {
          background: linear-gradient(120deg, var(--accent-2), #f472b6);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .lede {
          color: var(--muted);
          max-width: 52ch;
          line-height: 1.55;
          margin: 0;
          font-size: 0.98rem;
        }
        .panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 1.35rem 1.25rem;
          margin-bottom: 1rem;
        }
        .panel h2 {
          font-family: var(--font-display);
          font-size: 1.05rem;
          margin: 0 0 0.75rem;
          font-weight: 600;
        }
        .hint {
          color: var(--muted);
          font-size: 0.88rem;
          margin: 0 0 1rem;
          line-height: 1.45;
        }
        .hint a {
          color: var(--accent);
        }
        .subhead {
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted);
          margin: 1.25rem 0 0.6rem;
        }
        .dropzone {
          border: 1px dashed rgba(110, 231, 255, 0.35);
          border-radius: var(--radius);
          background: var(--surface-2);
          overflow: hidden;
        }
        .drop-label {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
          padding: 2rem 1rem;
          cursor: pointer;
          color: var(--muted);
          font-size: 0.92rem;
        }
        .drop-label strong {
          color: var(--text);
        }
        .drop-icon {
          font-size: 1.5rem;
          opacity: 0.85;
        }
        .fine {
          font-size: 0.78rem;
          opacity: 0.8;
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          border: 0;
        }
        .preview-wrap {
          margin-top: 1rem;
          position: relative;
          border-radius: var(--radius);
          overflow: hidden;
          border: 1px solid var(--border);
          background: #000;
        }
        .preview {
          width: 100%;
          max-height: 360px;
          display: block;
          vertical-align: top;
        }
        .platform-group h3 {
          font-size: 0.8rem;
          color: var(--muted);
          margin: 0 0 0.5rem;
          font-weight: 600;
        }
        .platform-group + .platform-group {
          margin-top: 1rem;
        }
        .card-grid,
        .effect-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 0.6rem;
        }
        .effect-grid {
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        }
        .card {
          border: 1px solid var(--border);
          background: var(--surface-2);
          color: inherit;
          border-radius: 12px;
          padding: 0.75rem 0.65rem;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
        }
        .card:hover {
          border-color: rgba(110, 231, 255, 0.35);
        }
        .card.active {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px rgba(110, 231, 255, 0.25);
        }
        .preset-icon {
          font-size: 1.1rem;
          display: block;
          margin-bottom: 0.25rem;
        }
        .preset-title {
          display: block;
          font-weight: 600;
          font-size: 0.82rem;
          text-transform: capitalize;
          margin-bottom: 0.2rem;
        }
        .preset-desc {
          font-size: 0.72rem;
          color: var(--muted);
          line-height: 1.3;
        }
        .effect-label {
          font-weight: 600;
          font-size: 0.85rem;
        }
        .effect-hint {
          display: block;
          font-size: 0.72rem;
          color: var(--muted);
          margin-top: 0.2rem;
          line-height: 1.3;
        }
        .tier-card .effect-label {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.35rem;
        }
        .tier-badge {
          font-size: 0.62rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--accent);
          background: rgba(110, 231, 255, 0.12);
          padding: 0.1rem 0.4rem;
          border-radius: 999px;
        }
        .output-estimate {
          margin: 0.85rem 0 0;
          padding: 0.75rem 0.85rem;
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: 10px;
          font-size: 0.86rem;
          line-height: 1.45;
          color: var(--muted);
        }
        .output-estimate strong {
          color: var(--text);
        }
        .mono {
          font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
          color: var(--accent);
          font-weight: 600;
        }
        .edit-tool-grid {
          grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
        }
        .mask-row {
          margin-bottom: 0.25rem;
        }
        .speed-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.45rem;
          margin-bottom: 0.75rem;
        }
        .chip {
          border: 1px solid var(--border);
          background: var(--surface-2);
          color: var(--text);
          border-radius: 999px;
          padding: 0.4rem 0.85rem;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .chip.active {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px rgba(110, 231, 255, 0.25);
        }
        .reverse-toggle {
          margin-top: 0.25rem;
        }
        .row-options {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 0.6rem;
        }
        .pill {
          border: 1px solid var(--border);
          background: var(--surface-2);
          color: inherit;
          border-radius: 12px;
          padding: 0.75rem 0.85rem;
          cursor: pointer;
          text-align: left;
          transition: border-color 0.15s;
        }
        .pill.active {
          border-color: var(--accent-2);
          box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.25);
        }
        .pill-label {
          display: block;
          font-weight: 600;
          font-size: 0.88rem;
        }
        .pill-hint {
          display: block;
          font-size: 0.75rem;
          color: var(--muted);
          margin-top: 0.25rem;
          line-height: 1.35;
        }
        .toggle-row {
          display: flex;
          gap: 0.85rem;
          align-items: flex-start;
          cursor: pointer;
        }
        .toggle-row input {
          width: 1.15rem;
          height: 1.15rem;
          margin-top: 0.2rem;
          accent-color: var(--accent);
        }
        .toggle-title {
          display: block;
          font-weight: 600;
          margin-bottom: 0.25rem;
        }
        .toggle-desc {
          color: var(--muted);
          font-size: 0.85rem;
          line-height: 1.45;
        }
        .actions {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.85rem;
        }
        .actions > .btn.primary {
          align-self: flex-start;
        }
        .actions .progress-wrap {
          width: 100%;
          max-width: 420px;
        }
        .progress-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 0.4rem;
          gap: 0.75rem;
        }
        .progress-label {
          font-size: 0.84rem;
          color: var(--muted);
        }
        .progress-pct {
          font-size: 0.84rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--accent);
        }
        .progress-track {
          height: 8px;
          border-radius: 999px;
          background: var(--surface-2);
          border: 1px solid var(--border);
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(115deg, var(--accent), var(--accent-2));
          transition: width 0.22s ease-out;
        }
        .btn {
          border: none;
          border-radius: 999px;
          padding: 0.75rem 1.35rem;
          font-weight: 600;
          font-size: 0.92rem;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .btn.primary {
          background: linear-gradient(115deg, var(--accent), var(--accent-2));
          color: #0a0b0f;
        }
        .btn.primary:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .btn.ghost {
          background: transparent;
          color: var(--accent);
          border: 1px solid rgba(110, 231, 255, 0.45);
        }
        .err {
          color: var(--danger);
          margin: 0;
          font-size: 0.88rem;
        }
        .foot {
          margin-top: 2rem;
          color: var(--muted);
          font-size: 0.82rem;
        }
        .foot code {
          background: var(--surface-2);
          padding: 0.1rem 0.35rem;
          border-radius: 6px;
          font-size: 0.78rem;
        }
      `}</style>
    </div>
  );
}
