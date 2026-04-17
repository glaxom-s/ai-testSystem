import { useCallback, useMemo, useState } from "react";

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

export default function App() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [platform, setPlatform] = useState("instagram-reels");
  const [effect, setEffect] = useState("none");
  const [framing, setFraming] = useState("cover");
  const [ultraHd, setUltraHd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [downloadPath, setDownloadPath] = useState(null);

  const groupedPlatforms = useMemo(() => {
    const g = {};
    for (const p of PLATFORMS) {
      if (!g[p.group]) g[p.group] = [];
      g[p.group].push(p);
    }
    return g;
  }, []);

  const onFile = useCallback((f) => {
    if (!f) return;
    setFile(f);
    setError(null);
    setDownloadPath(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  }, [previewUrl]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f?.type?.startsWith("video/")) onFile(f);
  }, [onFile]);

  const processVideo = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDownloadPath(null);
    const fd = new FormData();
    fd.append("video", file);
    fd.append("platform", platform);
    fd.append("effect", effect);
    fd.append("framing", framing);
    fd.append("ultraHd", String(ultraHd));
    try {
      const res = await fetch("/api/process", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setDownloadPath(data.downloadUrl);
    } catch (e) {
      setError(e.message || "Something went wrong");
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
          Pick a format, add a look, choose framing, and export — including optional Ultra HD upscale
          with sharpening. Built for creators who want CapCut-style speed in the browser.
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
            <video className="preview" src={previewUrl} controls playsInline />
          </div>
        )}
      </section>

      <section className="panel">
        <h2>2 · Platform &amp; framing</h2>
        <p className="hint">Optimized sizes for feeds, stories, and reels — similar to tools like{" "}
          <a href="https://www.capcut.com/" target="_blank" rel="noreferrer">CapCut</a>{" "}
          export presets.</p>
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
        <h2>3 · Style &amp; effects</h2>
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
        <h2>4 · Quality</h2>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={ultraHd}
            onChange={(e) => setUltraHd(e.target.checked)}
          />
          <div>
            <span className="toggle-title">Ultra HD export</span>
            <span className="toggle-desc">
              Lanczos upscale to ~4K (long edge 3840px) plus light sharpening. Slower export, larger
              files — great for archival or re-editing. Not a substitute for true AI restoration.
            </span>
          </div>
        </label>
      </section>

      <section className="panel actions">
        <button
          type="button"
          className="btn primary"
          disabled={!file || busy}
          onClick={processVideo}
        >
          {busy ? "Rendering…" : "Export video"}
        </button>
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
          border-radius: var(--radius);
          overflow: hidden;
          border: 1px solid var(--border);
          background: #000;
        }
        .preview {
          width: 100%;
          max-height: 360px;
          display: block;
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
          flex-wrap: wrap;
          align-items: center;
          gap: 0.75rem;
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
          font-size: 0.88rem;
        }
      `}</style>
    </div>
  );
}
