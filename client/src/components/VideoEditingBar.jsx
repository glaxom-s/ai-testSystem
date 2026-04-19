import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Ruler labels like Clipchamp: 0, 0:01, 0:02 */
function formatRulerLabel(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m === 0) return `${s}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Center timecode: 00:01.11 */
function formatClipTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function waitVideoSeek(video, time, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) {
      resolve();
      return;
    }
    const target = Math.min(Math.max(0, time), Math.max(0, d - 0.02));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", onSeeked);
      clearTimeout(tid);
      resolve();
    };
    const onSeeked = () => finish();
    const tid = setTimeout(finish, timeoutMs);
    video.addEventListener("seeked", onSeeked, { once: true });
    try {
      video.currentTime = target;
    } catch {
      finish();
      return;
    }
    queueMicrotask(() => {
      if (Math.abs(video.currentTime - target) < 0.04) finish();
    });
  });
}

/** Wait n animation frames so GPU-backed video frames paint before canvas read. */
function nextFrames(n = 2) {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      i += 1;
      if (i >= n) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * Grab one JPEG data URL from a video element (must have decoded frame).
 * @param {HTMLVideoElement} video
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 */
async function grabFrameJpeg(video, canvas, ctx) {
  const tw = canvas.width;
  const th = canvas.height;
  if (typeof video.requestVideoFrameCallback === "function") {
    try {
      await Promise.race([
        new Promise((res) => {
          video.requestVideoFrameCallback(() => res());
        }),
        nextFrames(5),
        new Promise((res) => setTimeout(res, 400)),
      ]);
    } catch {
      await nextFrames(3);
    }
  } else {
    await nextFrames(4);
  }

  let iw = video.videoWidth;
  let ih = video.videoHeight;
  if (!iw || !ih) {
    await nextFrames(2);
    iw = video.videoWidth;
    ih = video.videoHeight;
  }
  if (!iw || !ih) {
    try {
      const bmp = await createImageBitmap(video);
      iw = bmp.width;
      ih = bmp.height;
      ctx.fillStyle = "#050a08";
      ctx.fillRect(0, 0, tw, th);
      const scale = Math.max(tw / iw, th / ih);
      const sw = tw / scale;
      const sh = th / scale;
      const sx = Math.max(0, (iw - sw) / 2);
      const sy = Math.max(0, (ih - sh) / 2);
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, tw, th);
      bmp.close();
      return canvas.toDataURL("image/jpeg", 0.78);
    } catch {
      return "";
    }
  }

  ctx.fillStyle = "#050a08";
  ctx.fillRect(0, 0, tw, th);
  const scale = Math.max(tw / iw, th / ih);
  const sw = tw / scale;
  const sh = th / scale;
  const sx = Math.max(0, (iw - sw) / 2);
  const sy = Math.max(0, (ih - sh) / 2);
  try {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, tw, th);
    return canvas.toDataURL("image/jpeg", 0.78);
  } catch {
    return "";
  }
}

async function waitVideoReady(video, timeoutMs = 25000) {
  if (video.readyState >= 2 && video.videoWidth > 0) return;
  await new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(to);
      video.removeEventListener("loadeddata", onData);
      video.removeEventListener("canplay", onData);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onErr);
    };
    const tryResolve = () => {
      if (video.videoWidth > 0 && video.readyState >= 2) {
        cleanup();
        resolve();
      }
    };
    const onData = () => tryResolve();
    const onMeta = () => tryResolve();
    const onErr = () => {
      cleanup();
      resolve();
    };
    const to = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    video.addEventListener("loadeddata", onData);
    video.addEventListener("canplay", onData);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onErr);
    tryResolve();
  });
}

/** Thumbnail count: dense filmstrip (~6–8 per second), capped for seek time */
function thumbCountForDuration(durationSec) {
  if (!durationSec || durationSec <= 0) return 0;
  return Math.min(90, Math.max(28, Math.ceil(durationSec * 7)));
}

const MIN_TRIM_GAP = 0.05;

/**
 * @param {{
 *   videoRef: React.RefObject<HTMLVideoElement | null>;
 *   previewUrl: string | null;
 *   fileName: string;
 *   duration: number;
 *   playbackSec: number;
 *   trimStartSec: number;
 *   trimEndSec: number;
 *   onTrimStartSec: (v: number) => void;
 *   onTrimEndSec: (v: number) => void;
 *   busy: boolean;
 *   progressPercent: number;
 *   progressPhase: string;
 * }} props
 */
export default function VideoEditingBar({
  videoRef,
  previewUrl,
  fileName,
  duration,
  playbackSec,
  trimStartSec,
  trimEndSec,
  onTrimStartSec,
  onTrimEndSec,
  busy,
  progressPercent,
  progressPhase,
}) {
  const scrollRef = useRef(null);
  const innerRef = useRef(null);
  const [thumbs, setThumbs] = useState([]);
  const [filmstripStatus, setFilmstripStatus] = useState("idle");
  const [waveHeights, setWaveHeights] = useState([]);
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef(null);
  const rangeDragRef = useRef(null);
  const [rangePreview, setRangePreview] = useState(null);
  const trimStartRef = useRef(trimStartSec);
  const trimEndRef = useRef(trimEndSec);

  useEffect(() => {
    trimStartRef.current = trimStartSec;
    trimEndRef.current = trimEndSec;
  }, [trimStartSec, trimEndSec]);

  const baseTitle = useMemo(() => {
    const n = fileName || "Video";
    return n.replace(/\.[^.]+$/, "") || "Clip";
  }, [fileName]);

  useEffect(() => {
    if (!previewUrl || !duration || duration <= 0) {
      setThumbs([]);
      setFilmstripStatus("idle");
      return;
    }

    let cancelled = false;
    setFilmstripStatus("loading");
    setThumbs([]);

    const cap = document.createElement("video");
    cap.muted = true;
    cap.defaultMuted = true;
    cap.playsInline = true;
    cap.setAttribute("playsinline", "");
    cap.setAttribute("webkit-playsinline", "");
    cap.preload = "auto";
    cap.src = previewUrl;

    (async () => {
      await waitVideoReady(cap);
      if (cancelled) return;
      if (!cap.videoWidth || !Number.isFinite(cap.duration) || cap.duration <= 0) {
        if (!cancelled) {
          setThumbs([]);
          setFilmstripStatus("empty");
        }
        return;
      }

      cap.pause();
      const count = thumbCountForDuration(duration);
      const canvas = document.createElement("canvas");
      const tw = 88;
      const th = 50;
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        if (!cancelled) setFilmstripStatus("empty");
        return;
      }

      const urls = [];
      for (let i = 0; i < count; i++) {
        if (cancelled) return;
        const t = count <= 1 ? 0 : (i / (count - 1)) * duration * 0.995;
        await waitVideoSeek(cap, t);
        if (cancelled) return;
        const jpeg = await grabFrameJpeg(cap, canvas, ctx);
        urls.push(jpeg || "");
      }

      if (!cancelled) {
        const ok = urls.filter(Boolean).length;
        setThumbs(urls);
        setFilmstripStatus(ok > 0 ? "ready" : "empty");
      }

      cap.pause();
      cap.removeAttribute("src");
      cap.load();
    })().catch(() => {
      if (!cancelled) {
        setThumbs([]);
        setFilmstripStatus("empty");
      }
    });

    return () => {
      cancelled = true;
      cap.pause();
      try {
        cap.removeAttribute("src");
        cap.load();
      } catch {
        /* ignore */
      }
    };
  }, [previewUrl, duration]);

  useEffect(() => {
    const n = 96;
    const arr = [];
    let seed = Math.floor(duration * 1000) % 10000 || 7;
    for (let i = 0; i < n; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      arr.push(0.2 + (seed / 233280) * 0.8);
    }
    setWaveHeights(arr);
  }, [duration]);

  const pct = useCallback(
    (sec) => {
      if (!duration || duration <= 0) return 0;
      return Math.min(100, Math.max(0, (sec / duration) * 100));
    },
    [duration]
  );

  const clientXToSec = useCallback(
    (clientX) => {
      const inner = innerRef.current;
      const scroll = scrollRef.current;
      if (!inner || !duration) return 0;
      const r = inner.getBoundingClientRect();
      const scrollLeft = scroll?.scrollLeft ?? 0;
      const x = clientX - r.left + scrollLeft;
      const w = inner.offsetWidth || 1;
      return Math.min(Math.max(0, (x / w) * duration), duration);
    },
    [duration]
  );

  const seekFromClientX = useCallback(
    (clientX) => {
      const v = videoRef.current;
      if (!v || !duration) return;
      v.currentTime = clientXToSec(clientX);
    },
    [clientXToSec, duration, videoRef]
  );

  const trimFromClientX = useCallback(
    (clientX, which) => {
      if (!duration) return;
      const sec = clientXToSec(clientX);
      const end = trimEndRef.current;
      const start = trimStartRef.current;
      if (which === "start") {
        onTrimStartSec(Math.min(sec, end - MIN_TRIM_GAP));
      } else {
        onTrimEndSec(Math.max(sec, start + MIN_TRIM_GAP));
      }
    },
    [clientXToSec, duration, onTrimStartSec, onTrimEndSec]
  );

  const trimMoveFromClientX = useCallback(
    (clientX) => {
      const d = dragRef.current;
      if (!d || d.type !== "trim-move" || !duration) return;
      const sec = clientXToSec(clientX);
      const delta = sec - d.originSec;
      let newStart = d.initialStart + delta;
      let newEnd = d.initialEnd + delta;
      if (newStart < 0) {
        newEnd -= newStart;
        newStart = 0;
      }
      if (newEnd > duration) {
        newStart -= newEnd - duration;
        newEnd = duration;
      }
      if (newEnd - newStart < MIN_TRIM_GAP) return;
      newStart = Math.max(0, Math.min(newStart, duration - MIN_TRIM_GAP));
      newEnd = Math.max(newStart + MIN_TRIM_GAP, Math.min(duration, newEnd));
      onTrimStartSec(newStart);
      onTrimEndSec(newEnd);
    },
    [clientXToSec, duration, onTrimStartSec, onTrimEndSec]
  );

  const releasePointerDrag = useCallback(() => {
    const d = dragRef.current;
    if (d?.captureEl && d.pointerId != null) {
      try {
        if (typeof d.captureEl.releasePointerCapture === "function") {
          d.captureEl.releasePointerCapture(d.pointerId);
        }
      } catch {
        /* ignore */
      }
    }
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.type === "playhead") seekFromClientX(e.clientX);
      else if (d.type === "trim-start") trimFromClientX(e.clientX, "start");
      else if (d.type === "trim-end") trimFromClientX(e.clientX, "end");
      else if (d.type === "trim-move") trimMoveFromClientX(e.clientX);
    };
    const onUp = () => {
      releasePointerDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [releasePointerDrag, seekFromClientX, trimFromClientX, trimMoveFromClientX]);

  const rulerTicks = useMemo(() => {
    if (!duration) return [];
    const step = duration <= 15 ? 1 : duration <= 90 ? 5 : 10;
    const ticks = [];
    for (let t = 0; t <= duration + 0.01; t += step) {
      ticks.push(t);
    }
    if (ticks[ticks.length - 1] < duration - 0.05) ticks.push(duration);
    return ticks;
  }, [duration]);

  const splitAtPlayhead = () => {
    const t = videoRef.current?.currentTime ?? playbackSec;
    if (!Number.isFinite(t) || !duration) return;
    if (t > trimStartSec + 0.08 && t < trimEndSec - 0.08) {
      onTrimEndSec(t);
    }
  };

  const onTimelinePointerDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".cc-playhead, .cc-sel-handle, .cc-sel-move-strip")) return;
      if (dragRef.current) return;

      const startSec = clientXToSec(e.clientX);
      const startX = e.clientX;
      const pointerId = e.pointerId;
      rangeDragRef.current = { pointerId, startX, startSec, crossed: false };
      setRangePreview(null);

      const onMove = (ev) => {
        const d = rangeDragRef.current;
        if (!d || ev.pointerId !== d.pointerId) return;
        if (Math.abs(ev.clientX - d.startX) > 6) {
          d.crossed = true;
          const cur = clientXToSec(ev.clientX);
          setRangePreview({
            a: Math.min(d.startSec, cur),
            b: Math.max(d.startSec, cur),
          });
        }
      };

      const onUp = (ev) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        const d = rangeDragRef.current;
        rangeDragRef.current = null;
        setRangePreview(null);
        if (!d || ev.pointerId !== d.pointerId) return;
        if (d.crossed) {
          const endSec = clientXToSec(ev.clientX);
          const a = Math.min(d.startSec, endSec);
          const b = Math.max(d.startSec, endSec);
          if (b - a >= MIN_TRIM_GAP) {
            onTrimStartSec(a);
            onTrimEndSec(b);
            const v = videoRef.current;
            if (v) v.currentTime = a;
          }
        } else {
          seekFromClientX(ev.clientX);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [clientXToSec, onTrimEndSec, onTrimStartSec, seekFromClientX, videoRef]
  );

  const beginPointerDrag = (e, payload) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget;
    dragRef.current = { ...payload, pointerId: e.pointerId, captureEl: el };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const zoomIn = () => setZoom((z) => Math.min(2.25, Math.round((z + 0.25) * 100) / 100));
  const zoomOut = () => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
  const zoomFit = () => setZoom(1);

  const innerMinWidthPct = `${Math.max(100, 55 + duration * 18 * zoom)}%`;

  return (
    <div className="cc-bar">
      <div className="cc-toolbar cc-toolbar-glass">
        <div className="cc-tools-left">
          <button type="button" className="cc-tool cc-tool-ghost" disabled title="Undo">
            ↶
          </button>
          <button type="button" className="cc-tool cc-tool-ghost" disabled title="Redo">
            ↷
          </button>
          <button
            type="button"
            className="cc-tool cc-tool-cut cc-tool-active"
            title="Split at playhead (set out point), or drag on the timeline to select a keep range"
            onClick={splitAtPlayhead}
          >
            ✂
          </button>
          <button
            type="button"
            className="cc-tool"
            title="Reset selection to full clip (in & out)"
            onClick={() => {
              onTrimStartSec(0);
              onTrimEndSec(duration);
            }}
          >
            ⧉
          </button>
          <button type="button" className="cc-tool cc-tool-ghost" disabled title="Delete selection">
            🗑
          </button>
        </div>
        <div className="cc-timecode-block">
          <div className="cc-timecode" aria-live="polite">
            <span className="cc-time-now">{formatClipTime(playbackSec)}</span>
            <span className="cc-time-sep"> / </span>
            <span className="cc-time-total">{formatClipTime(duration)}</span>
          </div>
          <div
            className="cc-trim-readout"
            title="Use the bar under the ruler: drag In / Out, drag across strip for a range, top strip to slide selection. Click timeline to scrub."
          >
            <span className="cc-trim-label">Selection</span>
            <span className="cc-trim-inout">
              {formatClipTime(trimStartSec)} → {formatClipTime(trimEndSec)}
            </span>
            <span className="cc-trim-dur">({(trimEndSec - trimStartSec).toFixed(2)}s)</span>
          </div>
        </div>
        <div className="cc-zoom">
          <button type="button" className="cc-tool" title="Zoom out" onClick={zoomOut}>
            −
          </button>
          <button type="button" className="cc-tool" title="Zoom in" onClick={zoomIn}>
            +
          </button>
          <button type="button" className="cc-tool" title="Fit timeline" onClick={zoomFit}>
            ⊡
          </button>
        </div>
      </div>

      <div className="cc-scroll" ref={scrollRef}>
        <div className="cc-inner" ref={innerRef} style={{ minWidth: innerMinWidthPct }}>
          <div className="cc-stack">
            <div className="cc-ruler" onPointerDown={onTimelinePointerDown}>
              {rulerTicks.map((t) => (
                <span key={t} className="cc-tick" style={{ left: `${pct(t)}%` }}>
                  <span className="cc-tick-mark" />
                  <span className="cc-tick-label">{formatRulerLabel(t)}</span>
                </span>
              ))}
            </div>

            <div className="cc-selection-strip" onPointerDown={onTimelinePointerDown}>
              <div className="cc-selection-strip-inner">
                <div className="cc-sel-dim cc-sel-dim-l" style={{ width: `${pct(trimStartSec)}%` }} />
                <div className="cc-sel-dim cc-sel-dim-r" style={{ width: `${100 - pct(trimEndSec)}%` }} />
                <div
                  className="cc-sel-keep"
                  style={{ left: `${pct(trimStartSec)}%`, width: `${pct(trimEndSec - trimStartSec)}%` }}
                >
                  <div
                    className="cc-sel-move-strip"
                    title="Drag to slide the whole keep range along the timeline"
                    onPointerDown={(e) =>
                      beginPointerDrag(e, {
                        type: "trim-move",
                        originSec: clientXToSec(e.clientX),
                        initialStart: trimStartSec,
                        initialEnd: trimEndSec,
                      })
                    }
                  />
                  <span className="cc-sel-keep-text">Keep on export</span>
                </div>
              </div>
              <button
                type="button"
                className="cc-sel-handle cc-sel-handle-l"
                style={{ left: `${pct(trimStartSec)}%` }}
                aria-label="Left edge — drag to set where the kept clip starts"
                onPointerDown={(e) => beginPointerDrag(e, { type: "trim-start" })}
              >
                <span className="cc-sel-handle-grip" aria-hidden />
                <span className="cc-sel-handle-tag">In</span>
              </button>
              <button
                type="button"
                className="cc-sel-handle cc-sel-handle-r"
                style={{ left: `${pct(trimEndSec)}%` }}
                aria-label="Right edge — drag to set where the kept clip ends"
                onPointerDown={(e) => beginPointerDrag(e, { type: "trim-end" })}
              >
                <span className="cc-sel-handle-grip" aria-hidden />
                <span className="cc-sel-handle-tag">Out</span>
              </button>
            </div>

            <div className="cc-text-track" onPointerDown={onTimelinePointerDown}>
              <div
                className="cc-text-clip"
                style={{ left: `${pct(trimStartSec)}%`, width: `${pct(trimEndSec - trimStartSec)}%` }}
              >
                <span className="cc-text-clip-ico" aria-hidden>
                  T
                </span>
                <span className="cc-text-clip-label">{baseTitle}</span>
              </div>
            </div>

            <div className="cc-video-lane" onPointerDown={onTimelinePointerDown}>
              <div className="cc-trim-dim cc-trim-left" style={{ width: `${pct(trimStartSec)}%` }} />
              <div className="cc-trim-dim cc-trim-right" style={{ width: `${100 - pct(trimEndSec)}%` }} />

              <div
                className="cc-clip-shell"
                style={{ left: `${pct(trimStartSec)}%`, width: `${pct(trimEndSec - trimStartSec)}%` }}
              >
                <span className="cc-speaker" title="Audio on clip" aria-hidden>
                  🔊
                </span>
                {filmstripStatus === "loading" && (
                  <div className="cc-filmstrip-loading" aria-live="polite">
                    Extracting frames…
                  </div>
                )}
                {filmstripStatus === "empty" && (
                  <div className="cc-filmstrip-empty" role="status">
                    Could not read frames into the timeline (browser / codec). Scrubbing and export still work.
                  </div>
                )}
                <div className="cc-filmstrip">
                  {filmstripStatus === "ready"
                    ? thumbs.map((src, i) => (
                        <div key={i} className="cc-frame">
                          {src ? <img src={src} alt="" draggable={false} loading="lazy" /> : null}
                        </div>
                      ))
                    : filmstripStatus === "loading"
                      ? Array.from({ length: 40 }).map((_, i) => <div key={i} className="cc-frame cc-frame-skel" />)
                      : null}
                </div>
                <div className="cc-wave" aria-hidden>
                  {waveHeights.map((h, i) => (
                    <span key={i} className="cc-wave-bar" style={{ height: `${h * 100}%` }} />
                  ))}
                </div>
              </div>
            </div>

            <div className="cc-selection-bracket" aria-hidden>
              <div
                className="cc-selection-bracket-inner"
                style={{ left: `${pct(trimStartSec)}%`, width: `${pct(trimEndSec - trimStartSec)}%` }}
              />
            </div>

            {rangePreview && (
              <div className="cc-range-preview" aria-hidden>
                <div
                  className="cc-range-preview-inner"
                  style={{ left: `${pct(rangePreview.a)}%`, width: `${pct(rangePreview.b - rangePreview.a)}%` }}
                />
              </div>
            )}

            <div
              className="cc-playhead"
              style={{ left: `${pct(playbackSec)}%` }}
              onPointerDown={(e) => beginPointerDrag(e, { type: "playhead" })}
            >
              <span className="cc-playhead-nub" />
              <span className="cc-playhead-line" />
            </div>
          </div>
        </div>
      </div>

      {busy && (
        <div className="cc-busy">
          <span>
            {progressPhase === "upload" ? "Uploading" : "Encoding"} · {progressPercent}%
          </span>
        </div>
      )}

      <div className="cc-file-foot">
        <span className="cc-file-name">{fileName || "Video.mp4"}</span>
      </div>

      <style>{`
        .cc-bar {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          padding: 10px 10px 12px;
          background: linear-gradient(
            165deg,
            rgba(32, 34, 42, 0.45) 0%,
            rgba(16, 18, 24, 0.82) 40%,
            rgba(10, 12, 18, 0.92) 100%
          );
          border-radius: 14px 14px 0 0;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-bottom: none;
          backdrop-filter: blur(22px) saturate(165%);
          box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
          color: #e8eaef;
          font-size: 0.76rem;
          user-select: none;
        }
        .cc-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }
        .cc-toolbar-glass {
          padding: 8px 10px;
          border-radius: 12px;
          background: rgba(22, 24, 32, 0.52);
          border: 1px solid rgba(255, 255, 255, 0.14);
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.07);
          backdrop-filter: blur(18px) saturate(150%);
        }
        .cc-tool-active {
          background: rgba(99, 102, 241, 0.38) !important;
          border-color: rgba(165, 180, 252, 0.55) !important;
          color: #fff;
          box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.25);
        }
        .cc-tool-cut.cc-tool-active:hover {
          background: rgba(99, 102, 241, 0.48) !important;
        }
        .cc-tools-left,
        .cc-zoom {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 1;
        }
        .cc-zoom {
          justify-content: flex-end;
        }
        .cc-tool {
          min-width: 30px;
          height: 30px;
          padding: 0 6px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.06);
          color: #e8eaed;
          cursor: pointer;
          font-size: 0.82rem;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cc-tool:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.2);
        }
        .cc-tool:disabled,
        .cc-tool-ghost:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }
        .cc-timecode-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          flex: 0 1 auto;
          min-width: 0;
        }
        .cc-timecode {
          font-variant-numeric: tabular-nums;
          font-size: 0.8rem;
          font-weight: 600;
          color: #fff;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }
        .cc-time-sep {
          font-weight: 500;
          opacity: 0.45;
        }
        .cc-time-total {
          opacity: 0.75;
        }
        .cc-trim-readout {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 0.64rem;
          font-variant-numeric: tabular-nums;
          color: rgba(165, 243, 252, 0.98);
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
          max-width: 220px;
        }
        .cc-trim-label {
          font-weight: 800;
          letter-spacing: 0.08em;
          opacity: 0.75;
        }
        .cc-trim-inout {
          font-weight: 600;
        }
        .cc-trim-dur {
          opacity: 0.85;
          color: rgba(226, 232, 240, 0.9);
        }
        .cc-scroll {
          overflow-x: auto;
          overflow-y: hidden;
          max-width: 100%;
          border-radius: 10px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.35) rgba(0, 0, 0, 0.2);
        }
        .cc-scroll::-webkit-scrollbar {
          height: 7px;
        }
        .cc-scroll::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.25);
          border-radius: 4px;
        }
        .cc-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.28);
          border-radius: 4px;
        }
        .cc-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
        }
        .cc-inner {
          position: relative;
        }
        .cc-stack {
          position: relative;
        }
        .cc-ruler {
          position: relative;
          height: 24px;
          margin-bottom: 2px;
          background: rgba(0, 0, 0, 0.35);
          border-radius: 6px 6px 0 0;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-bottom: none;
          cursor: pointer;
        }
        .cc-tick {
          position: absolute;
          bottom: 0;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .cc-tick-mark {
          width: 1px;
          height: 6px;
          background: rgba(255, 255, 255, 0.25);
          margin-bottom: 2px;
        }
        .cc-tick-label {
          font-size: 0.62rem;
          color: rgba(255, 255, 255, 0.5);
          font-variant-numeric: tabular-nums;
        }
        .cc-selection-strip {
          position: relative;
          height: 42px;
          margin-bottom: 3px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.4);
          cursor: pointer;
          overflow: visible;
        }
        .cc-selection-strip-inner {
          position: absolute;
          left: 4px;
          right: 4px;
          top: 7px;
          bottom: 7px;
          border-radius: 6px;
          overflow: hidden;
          background: rgba(15, 23, 42, 0.85);
        }
        .cc-sel-dim {
          position: absolute;
          top: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.58);
          pointer-events: none;
        }
        .cc-sel-dim-l {
          left: 0;
        }
        .cc-sel-dim-r {
          right: 0;
        }
        .cc-sel-keep {
          position: absolute;
          top: 0;
          bottom: 0;
          box-sizing: border-box;
          border-radius: 4px;
          background: linear-gradient(180deg, rgba(16, 185, 129, 0.42), rgba(4, 120, 87, 0.72));
          border: 1px solid rgba(52, 211, 153, 0.55);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cc-sel-move-strip {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          height: 13px;
          z-index: 2;
          cursor: grab;
          touch-action: none;
          border-radius: 4px 4px 0 0;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(0, 0, 0, 0.12));
        }
        .cc-sel-move-strip:active {
          cursor: grabbing;
        }
        .cc-sel-keep-text {
          font-size: 0.6rem;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(236, 253, 245, 0.88);
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.65);
          pointer-events: none;
          margin-top: 8px;
        }
        .cc-sel-handle {
          position: absolute;
          top: 1px;
          bottom: 1px;
          width: 32px;
          z-index: 14;
          transform: translateX(-50%);
          border: none;
          padding: 0;
          background: transparent;
          cursor: ew-resize;
          touch-action: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
        }
        .cc-sel-handle:focus-visible {
          outline: 2px solid #38bdf8;
          outline-offset: 2px;
        }
        .cc-sel-handle-grip {
          width: 8px;
          flex: 1;
          max-height: 26px;
          border-radius: 4px;
          background: linear-gradient(180deg, #fef3c7, #f59e0b 45%, #d97706);
          box-shadow:
            0 0 14px rgba(245, 158, 11, 0.85),
            0 0 0 1px rgba(0, 0, 0, 0.45);
        }
        .cc-sel-handle-l .cc-sel-handle-grip {
          border-top-left-radius: 6px;
          border-bottom-left-radius: 6px;
        }
        .cc-sel-handle-r .cc-sel-handle-grip {
          border-top-right-radius: 6px;
          border-bottom-right-radius: 6px;
        }
        .cc-sel-handle-tag {
          font-size: 0.55rem;
          font-weight: 800;
          color: #fff;
          letter-spacing: 0.06em;
          text-shadow: 0 1px 2px #000;
        }
        .cc-text-track {
          position: relative;
          height: 28px;
          background: rgba(0, 0, 0, 0.28);
          border-left: 1px solid rgba(255, 255, 255, 0.06);
          border-right: 1px solid rgba(255, 255, 255, 0.06);
          cursor: pointer;
        }
        .cc-text-clip {
          position: absolute;
          top: 4px;
          bottom: 4px;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 10px 0 8px;
          border-radius: 6px;
          background: linear-gradient(90deg, #6d28d9, #7c3aed);
          border: 1px solid rgba(255, 255, 255, 0.25);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
          min-width: 48px;
        }
        .cc-text-clip-ico {
          font-weight: 800;
          font-size: 0.7rem;
          opacity: 0.95;
          width: 18px;
          height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          background: rgba(0, 0, 0, 0.2);
        }
        .cc-text-clip-label {
          font-size: 0.72rem;
          font-weight: 600;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cc-video-lane {
          position: relative;
          min-height: 56px;
          background: rgba(0, 0, 0, 0.45);
          border-radius: 0 0 8px 8px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-top: none;
          cursor: pointer;
          overflow: hidden;
        }
        .cc-trim-dim {
          position: absolute;
          top: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.62);
          z-index: 2;
          pointer-events: none;
        }
        .cc-trim-left {
          left: 0;
        }
        .cc-trim-right {
          right: 0;
        }
        .cc-clip-shell {
          position: absolute;
          top: 4px;
          bottom: 4px;
          z-index: 3;
          min-height: 46px;
          border-radius: 8px;
          border: 2px solid rgba(255, 255, 255, 0.94);
          box-shadow:
            0 0 0 1px rgba(0, 0, 0, 0.45),
            inset 0 0 0 1px rgba(74, 222, 128, 0.25),
            inset 0 -20px 28px rgba(0, 0, 0, 0.15);
          background: linear-gradient(180deg, rgba(22, 101, 52, 0.65) 0%, rgba(6, 78, 59, 0.88) 100%);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .cc-filmstrip-loading {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          bottom: 18px;
          z-index: 6;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.74rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.92);
          text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85);
          pointer-events: none;
          background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.25), transparent);
        }
        .cc-filmstrip-empty {
          position: absolute;
          left: 6px;
          right: 6px;
          top: 22px;
          z-index: 6;
          font-size: 0.65rem;
          line-height: 1.35;
          color: rgba(254, 240, 138, 0.95);
          text-align: center;
          text-shadow: 0 1px 3px #000;
          pointer-events: none;
        }
        .cc-speaker {
          position: absolute;
          left: 6px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 5;
          font-size: 0.72rem;
          opacity: 0.95;
          filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.8));
          pointer-events: none;
        }
        .cc-filmstrip {
          flex: 1;
          display: flex;
          flex-direction: row;
          flex-wrap: nowrap;
          gap: 0;
          min-height: 28px;
          padding-left: 30px;
          align-items: stretch;
        }
        .cc-frame {
          flex: 1 1 0;
          min-width: 0;
          min-height: 28px;
          align-self: stretch;
          border-right: 1px solid rgba(0, 0, 0, 0.5);
          overflow: hidden;
          background: #070d0a;
        }
        .cc-frame:last-child {
          border-right: none;
        }
        .cc-frame img {
          width: 100%;
          height: 100%;
          min-height: 28px;
          object-fit: cover;
          object-position: center;
          display: block;
        }
        .cc-frame-skel {
          background: linear-gradient(90deg, #14532d, #166534, #14532d);
          background-size: 200% 100%;
          animation: cc-sh 1s ease infinite;
        }
        @keyframes cc-sh {
          0% {
            background-position: 0% 0%;
          }
          100% {
            background-position: 200% 0%;
          }
        }
        .cc-wave {
          flex-shrink: 0;
          height: 14px;
          display: flex;
          align-items: flex-end;
          gap: 0;
          padding: 0 4px 3px;
          background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.25));
        }
        .cc-wave-bar {
          flex: 1;
          min-width: 1px;
          background: linear-gradient(180deg, #86efac, #22c55e);
          border-radius: 1px;
          opacity: 0.92;
        }
        .cc-selection-bracket {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          bottom: 0;
          z-index: 6;
          pointer-events: none;
        }
        .cc-selection-bracket-inner {
          position: absolute;
          top: 0;
          bottom: 0;
          box-sizing: border-box;
          border-left: 3px solid rgba(34, 211, 238, 0.92);
          border-right: 3px solid rgba(34, 211, 238, 0.92);
          box-shadow: inset 0 0 40px rgba(34, 211, 238, 0.07);
        }
        .cc-range-preview {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          bottom: 0;
          z-index: 7;
          pointer-events: none;
        }
        .cc-range-preview-inner {
          position: absolute;
          top: 0;
          bottom: 0;
          box-sizing: border-box;
          border-left: 3px dashed rgba(251, 191, 36, 0.95);
          border-right: 3px dashed rgba(251, 191, 36, 0.95);
          background: rgba(251, 191, 36, 0.08);
        }
        .cc-playhead {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 0;
          z-index: 8;
          transform: translateX(-50%);
          pointer-events: auto;
          cursor: ew-resize;
          touch-action: none;
        }
        .cc-playhead-nub {
          position: absolute;
          top: 6px;
          left: 50%;
          transform: translateX(-50%);
          width: 12px;
          height: 10px;
          background: #fff;
          border-radius: 3px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
        }
        .cc-playhead-line {
          position: absolute;
          top: 18px;
          left: 50%;
          width: 2px;
          bottom: 0;
          transform: translateX(-50%);
          background: #fff;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
        }
        .cc-busy {
          margin-top: 6px;
          padding: 6px 8px;
          text-align: center;
          font-size: 0.72rem;
          border-radius: 6px;
          border: 1px dashed rgba(250, 204, 21, 0.6);
          background: rgba(30, 30, 20, 0.6);
          color: #fef08a;
        }
        .cc-file-foot {
          margin-top: 6px;
          padding: 0 4px;
          font-size: 0.68rem;
          color: rgba(255, 255, 255, 0.45);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cc-file-name {
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}
