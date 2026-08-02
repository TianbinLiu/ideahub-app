// 分段视频播放器（mock）：每段用首帧→尾帧渐变 + 轻推镜头模拟画面，段落分界处有刻度。
// 接入真实视频生成后，本组件替换为 <video> 播放合成片即可，外层接口不变。
import { useEffect, useRef, useState } from "react";
import { VideoSegment, formatDuration } from "../types";

export default function SegmentPlayer({ segments, cover }: { segments: VideoSegment[]; cover: string }) {
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const total = Math.max(0.001, segments.reduce((s, x) => s + x.durationSec, 0));

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => {
        const nt = t + dt;
        if (nt >= total) {
          setPlaying(false);
          return total;
        }
        return nt;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  // 定位当前段
  let acc = 0;
  let segIdx = 0;
  let local = 0;
  for (let i = 0; i < segments.length; i++) {
    if (time < acc + segments[i].durationSec || i === segments.length - 1) {
      segIdx = i;
      local = time - acc;
      break;
    }
    acc += segments[i].durationSec;
  }
  const seg = segments[segIdx];
  const frac = seg ? Math.min(1, Math.max(0, local / seg.durationSec)) : 0;
  const ease = frac * frac * (3 - 2 * frac);
  const ended = time >= total && !playing;

  // 真实视频段：把播放器的播/停与进度同步到 <video>（否则暂停后视频仍在播、拖动进度不跟随）
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !seg?.videoUrl) return;
    if (playing) void v.play().catch(() => {});
    else v.pause();
  }, [playing, seg?.videoUrl]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !seg?.videoUrl || !v.duration) return;
    // 段内进度对齐（拖动/切段时纠偏；容差内不打断正常播放，避免每帧 seek 卡顿）
    const want = Math.min(v.duration, Math.max(0, local));
    if (Math.abs(v.currentTime - want) > 0.4) v.currentTime = want;
  }, [local, seg?.videoUrl]);

  function seek(clientX: number) {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setTime(r * total);
    setStarted(true);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen();
  }

  // 段落分界刻度位置
  const marks: number[] = [];
  let m = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    m += segments[i].durationSec;
    marks.push(m / total);
  }

  return (
    <div ref={wrapRef} className="group relative aspect-video w-full select-none overflow-hidden rounded-xl bg-black">
      {!started ? (
        <>
          <img src={cover} alt="封面" className="h-full w-full object-cover" />
          <button
            onClick={() => {
              setStarted(true);
              setPlaying(true);
            }}
            className="absolute inset-0 flex items-center justify-center bg-black/30"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 pl-1 text-3xl text-ink shadow-xl">
              ▶
            </span>
          </button>
        </>
      ) : (
        <>
          {seg &&
            (seg.videoUrl ? (
              // 真实生成的片段：直接播（静音自动播放才不被浏览器拦），加载失败自动回退渐变
              <video
                key={seg.videoUrl}
                ref={videoRef}
                src={seg.videoUrl}
                className="absolute inset-0 h-full w-full object-cover"
                muted
                playsInline
                onError={(e) => {
                  (e.currentTarget as HTMLVideoElement).style.display = "none";
                }}
              />
            ) : (
              <div className="absolute inset-0" style={{ transform: `scale(${1 + 0.06 * frac})` }}>
                <img src={seg.firstFrame} alt="" className="absolute inset-0 h-full w-full object-cover" />
                <img
                  src={seg.lastFrame}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ opacity: ease }}
                />
              </div>
            ))}
          {seg && (
            <div className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs text-slate-200">
              {seg.title}
            </div>
          )}
          {ended && (
            <button
              onClick={() => {
                setTime(0);
                setPlaying(true);
              }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-slate-100"
            >
              <span className="text-4xl">↻</span>
              <span className="text-sm">重新播放</span>
            </button>
          )}
          {/* 控制条 */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 opacity-0 transition-opacity group-hover:opacity-100">
            <div
              ref={barRef}
              className="relative h-1.5 w-full cursor-pointer rounded-full bg-white/25"
              onClick={(e) => seek(e.clientX)}
            >
              <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${(time / total) * 100}%` }} />
              {marks.map((mk, i) => (
                <div key={i} className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 bg-white/70" style={{ left: `${mk * 100}%` }} />
              ))}
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-100">
              <button onClick={() => setPlaying((p) => !p && time < total)} className="text-lg">
                {playing ? "⏸" : "▶"}
              </button>
              <span className="text-xs tabular-nums text-slate-300">
                {formatDuration(time)} / {formatDuration(total)}
              </span>
              <span className="ml-auto text-xs text-slate-400">{segments.length} 个节点段</span>
              <button onClick={toggleFullscreen} className="text-base" title="全屏">
                ⛶
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
