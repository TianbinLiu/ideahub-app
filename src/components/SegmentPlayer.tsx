// 分段视频播放器（mock）：每段用首帧→尾帧渐变 + 轻推镜头模拟画面，段落分界处有刻度。
// 接入真实视频生成后，本组件替换为 <video> 播放合成片即可，外层接口不变。
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import PlayerControls from "./PlayerControls";
import { frameLook, type PlayerFrame, type PlayerOverlay } from "./playerFrame";
import { VideoSegment, segLen, segsTotal } from "../types";
import { useMediaUrl } from "../utils/mediaUrl";

/**
 * ★ frame / rate / overlay / onFull 四个都是**必填**（2026-10-26 视频详情页 P0-2）：漏传零症状 —— 详情页悄悄退成卡片样子、
 *   倍速只改了画面没改进度条、弹幕没挂上、全屏键不出来。真不要就显式传 "card" / 1 / null / null（发布页）。
 */
export default function SegmentPlayer({
  segments,
  cover,
  frame,
  rate,
  overlay,
  onFull,
}: {
  segments: VideoSegment[];
  cover: string;
  frame: PlayerFrame;
  /** 倍速：rAF 墙钟的 dt 与 <video>.playbackRate 一起乘 —— 只改一边的话进度条和弹幕会跟画面越跑越远 */
  rate: number;
  overlay: PlayerOverlay;
  onFull: (() => void) | null;
}) {
  const { t } = useLingui();
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);
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
    const id = setTimeout(() => setCtrl(false), 3000);
    return () => clearTimeout(id);
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
      // 倍速：墙钟走 1 秒，片子走 rate 秒（<video>.playbackRate 下面那个 effect 设同一个数）
      const dt = ((now - last) / 1000) * rate;
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
  }, [playing, total, rate]);

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
      void v.play().catch((e: unknown) => {
        // ★ 只有「带声音被自动播放策略拒了」（NotAllowedError）才退静音重试（2026-09-18 发版复核抓到）：
        //   缓冲时点了暂停 / 换了段，旧那次 play() 会以 AbortError 收尾 —— 原来一律静音重播，于是视频在播、界面显示暂停
        if ((e as { name?: string } | null)?.name !== "NotAllowedError") return;
        v.muted = true;
        setMuted(true);
        void v.play().catch(() => {});
      });
    } else v.pause();
  }, [playing, seg?.videoUrl]);
  // ★ 静音开关直接落到 DOM：`muted` 是 property 不是普通 attribute，
  //   换段（换 key 重建 <video>）之后也要再钉一次，否则新元素会退回默认值
  //   倍速同理：换段重建的 <video> 会退回 1 倍，每次渲染钉一遍
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    v.playbackRate = rate;
  });

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !seg?.videoUrl || !v.duration) return;
    // 段内进度对齐（拖动/切段时纠偏；容差内不打断正常播放，避免每帧 seek 卡顿）
    const want = Math.min(v.duration, Math.max(0, local));
    if (Math.abs(v.currentTime - want) > 0.4) v.currentTime = want;
  }, [local, seg?.videoUrl]);

  /** 跳到第几秒：点条与键盘都走它（夹进 [0, total]，「还没开始」也算开始） */
  function seekTo(sec: number) {
    setTime(Math.min(total, Math.max(0, sec)));
    setStarted(true);
  }

  // 段落分界刻度位置
  const marks: number[] = [];
  let m = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    m += segLen(segments[i]);
    marks.push(m / total);
  }

  // 外框（卡片 / 满宽 / 全屏）一处定：components/playerFrame.frameLook
  const look = frameLook(frame, segments[0]?.aspect);
  return (
    <div style={look.style} className={look.className} onClick={() => setCtrl((v) => !v)}>
      {!started ? (
        <>
          {/* ★ 封面还没选时退到**成片第一帧**（poster || firstFrame，全 app 同一条兜底）：
              `<img src="">` 在浏览器里画出来是一张**碎图**，而这一格正好压在发布页最显眼的位置 ——
              用户读到的是「成片坏了」，其实只是还没挑封面（2026-09-06 主人真机那张截图里就有一张）。
              白模复刻段没有设定帧，全靠合并时留下的 poster（见 CutPage.posterFromCanvas）。 */}
          {coverSrc ? (
            <img src={coverSrc} alt={t`封面`} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-slate-900" />
          )}
          <button
            onClick={() => {
              setStarted(true);
              setPlaying(true);
            }}
            className="absolute inset-0 flex items-center justify-center bg-black/30"
            // 里面只有一个 aria-hidden 的图标（Icon.tsx），没名字的话读屏念出来是一颗空按钮（2026-10-15 教材人格评审，WCAG 2.2 · 4.1.2）
            aria-label={t`播放`}
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
          {/* 挂点（详情页的弹幕）：画面之上、重播层与控制条之下。全片秒数；分段播放器没有分支，恒在「开场」那条时间轴上 */}
          {overlay?.({ time, paused: !playing, onRoot: true })}
          {ended && (
            <button
              onClick={() => {
                setTime(0);
                setPlaying(true);
              }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-slate-100"
            >
              <Icon name="replay" size={34} />
              <span className="text-sm"><Trans>重新播放</Trans></span>
            </button>
          )}
          {/* 控制条：点画面唤起/收起，播放中 3 秒自动淡出（原来是 group-hover —— 触屏没有 hover，真机上完全够不着）。只有 PlayerControls 一份 */}
          <PlayerControls
            time={time}
            total={total}
            playing={playing}
            visible={ctrl}
            marks={marks}
            muted={muted}
            rate={rate}
            onToggle={() => {
              // 播完之后再按应该重播（原来 setPlaying((p) => !p && time < total) 在 time >= total 时恒 false，按下去毫无反应）
              if (time >= total) {
                setTime(0);
                setPlaying(true);
              } else setPlaying((p) => !p);
            }}
            onSeek={seekTo}
            onMute={() => setMuted((m) => !m)}
            onShow={() => setCtrl(true)}
            onFull={onFull}
          />
        </>
      )}
    </div>
  );
}
