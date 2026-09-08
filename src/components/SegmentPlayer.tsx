// 分段视频播放器（mock）：每段用首帧→尾帧渐变 + 轻推镜头模拟画面，段落分界处有刻度。
// 接入真实视频生成后，本组件替换为 <video> 播放合成片即可，外层接口不变。
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { VideoSegment, aspectCss, formatDuration, segLen, segsTotal } from "../types";
import { useMediaUrl } from "../utils/mediaUrl";

export default function SegmentPlayer({ segments, cover }: { segments: VideoSegment[]; cover: string }) {
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [ctrl, setCtrl] = useState(true);
  /**
   * 出声还是静音。**缺省出声**（2026-09-07 主人真机：合出来的片子"没声音"）。
   *
   * ★★ 这一格原来是写死的 `muted`，旁边注释写的理由是「静音自动播放才不被浏览器拦」——
   *   而这个播放器**根本不自动播放**：它要用户先点那颗播放键（`setStarted(true)`）。
   *   手势已经有了，自动播放策略早就满足，静音只剩下副作用：发布页的成片预览与作品详情页
   *   **永远是哑的，且没有任何解除入口** —— 用户刚合完一条片子，第一件事就是在这儿播一下，
   *   听不见声音只会得出"合并把声音弄丢了"的结论（而片子里可能好好地有音轨）。
   * ★ 首页 FeedPage 不一样：那一屏是**划到就自动播**，静音是解锁自动播放用的，别一起改。
   */
  const [muted, setMuted] = useState(false);

  // 播放中 3 秒自动收起控制条；暂停时常显（用户正在找按钮）
  useEffect(() => {
    if (!ctrl || !playing) return;
    const t = setTimeout(() => setCtrl(false), 3000);
    return () => clearTimeout(t);
  }, [ctrl, playing, time]);
  // ★★ 走 segsTotal（实测优先）：这个数就是"播到哪儿算完"（下面 tick 里 nt >= total 就 setPlaying(false)）。
  //   按申报值算的话，比申报值长的成片会被**当场掐掉尾巴** —— 主人真机上 33 秒的合并成片播到 21 秒就停，
  //   而屏幕上一个字都不说（见 types.segLen 的 ★★）
  const total = Math.max(0.001, segsTotal(segments));
  /** 封面兜底链（见下面渲染处的 ★）：用户选的封面 → 成片第一帧 → 设定首帧 */
  const coverSrc = cover || segments[0]?.poster || segments[0]?.firstFrame || "";

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
    if (time < acc + segLen(segments[i]) || i === segments.length - 1) {
      segIdx = i;
      local = time - acc;
      break;
    }
    acc += segLen(segments[i]);
  }
  const seg = segments[segIdx];
  const frac = seg ? Math.min(1, Math.max(0, local / segLen(seg))) : 0;
  const ease = frac * frac * (3 - 2 * frac);
  const ended = time >= total && !playing;

  // 真实视频段：把播放器的播/停与进度同步到 <video>（否则暂停后视频仍在播、拖动进度不跟随）
  // 地址经统一解析：idb: 合并成片 / TOS 远端代理
  const segSrc = useMediaUrl(seg?.videoUrl);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !seg?.videoUrl) return;
    if (playing) {
      // ★ 带声音的播放被浏览器拒了（网页版偶发，原生壳里走不到）：退成静音再试一次。
      //   别把"能不能播"赌在"能不能出声"上 —— 那样用户连画面都看不到。
      void v.play().catch(() => {
        v.muted = true;
        setMuted(true);
        void v.play().catch(() => {});
      });
    } else v.pause();
  }, [playing, seg?.videoUrl]);
  // ★ 静音开关直接落到 DOM：`muted` 是 property 不是普通 attribute，
  //   换段（换 key 重建 <video>）之后也要再钉一次，否则新元素会退回默认值
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  });

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

  // 段落分界刻度位置
  const marks: number[] = [];
  let m = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    m += segLen(segments[i]);
    marks.push(m / total);
  }

  return (
    <div
      ref={wrapRef}
      /* 播放框跟着作品画幅：写死 aspect-video 的话，竖屏作品在详情页会被
         object-cover 裁掉上下大半。竖屏框很高，限一下高度免得把整页顶开 */
      style={{ aspectRatio: aspectCss(segments[0]?.aspect), maxHeight: "72vh" }}
      className="relative mx-auto w-full max-w-full select-none overflow-hidden rounded-xl bg-black"
      onClick={() => setCtrl((v) => !v)}
    >
      {!started ? (
        <>
          {/* ★ 封面还没选时退到**成片第一帧**（poster || firstFrame，全 app 同一条兜底）：
              `<img src="">` 在浏览器里画出来是一张**碎图**，而这一格正好压在发布页最显眼的位置 ——
              用户读到的是「成片坏了」，其实只是还没挑封面（2026-09-06 主人真机那张截图里就有一张）。
              白模复刻段没有设定帧，全靠合并时留下的 poster（见 CutPage.posterFromCanvas）。 */}
          {coverSrc ? (
            <img src={coverSrc} alt="封面" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-slate-900" />
          )}
          <button
            onClick={() => {
              setStarted(true);
              setPlaying(true);
            }}
            className="absolute inset-0 flex items-center justify-center bg-black/30"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 pl-1 text-ink shadow-xl">
              <Icon name="play" size={30} filled />
            </span>
          </button>
        </>
      ) : (
        <>
          {seg &&
            (seg.videoUrl && segSrc ? (
              // 真实生成的片段：直接播（静音自动播放才不被浏览器拦），加载失败自动回退渐变
              <video
                key={segSrc}
                ref={videoRef}
                src={segSrc}
                className="absolute inset-0 h-full w-full object-cover"
                muted={muted}
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
              <Icon name="replay" size={34} />
              <span className="text-sm">重新播放</span>
            </button>
          )}
          {/* 控制条：点画面唤起/收起，播放中 3 秒自动淡出。
              原来是 group-hover —— 触屏设备没有 hover 事件，进度条和播放键在真机上完全够不着。 */}
          <div
            className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200 ${
              ctrl ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="-my-2 py-2" onClick={(e) => seek(e.clientX)}>
            <div ref={barRef} className="relative h-1.5 w-full cursor-pointer rounded-full bg-white/25">
              <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${(time / total) * 100}%` }} />
              {marks.map((mk, i) => (
                <div key={i} className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 bg-white/70" style={{ left: `${mk * 100}%` }} />
              ))}
            </div>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-100">
              <button
                onClick={() => {
                  // 播完之后再按应该重播。原来是 setPlaying((p) => !p && time < total)，
                  // time >= total 时整个表达式恒为 false —— 按下去毫无反应。
                  if (time >= total) {
                    setTime(0);
                    setPlaying(true);
                  } else {
                    setPlaying((p) => !p);
                  }
                }}
                className="-m-2 p-2"
                aria-label={playing ? "暂停" : "播放"}
              >
                <Icon name={time >= total ? "replay" : playing ? "pause" : "play"} size={20} filled={time < total} />
              </button>
              <span className="text-xs tabular-nums text-slate-300">
                {formatDuration(time)} / {formatDuration(total)}
              </span>
              <button
                onClick={() => setMuted((m) => !m)}
                className="ml-auto flex-none rounded-full bg-white/15 px-2.5 py-1 text-[11px] text-slate-100"
                aria-label={muted ? "取消静音" : "静音"}
              >
                {muted ? "🔇 已静音" : "🔊 有声"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
