// 互动分支播放器（mock 渲染同 SegmentPlayer：首帧→尾帧渐变+轻推镜头）：
// 段尾多选项 → 暂停出分支选择；单选项 → 无缝续播；无选项 → 结局（重看/回上一分支点）。
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import PlayerControls from "./PlayerControls";
import { frameLook, type PlayerFrame, type PlayerOverlay } from "./playerFrame";
import { BranchTree } from "../types";

/**
 * ★ `onPathChange` 是**必填**、不是可选（铁律 5b 名单第一条：可选回调漏传零症状）。
 *   它把"观众刚看的这条走向"报给详情页，「保存到本地」的「只存刚看的走向」按它取段。
 *   漏传的话那一档会静默退成"只存第一段"，而作品可能有 9 段 —— 用户点完不会收到
 *   任何一个字的提示。唯一调用点在 VideoPage。
 */
export default function BranchPlayer({
  tree,
  cover,
  onPathChange,
  frame,
  rate,
  overlay,
  onFull,
}: {
  tree: BranchTree;
  cover: string;
  onPathChange: (path: string[]) => void;
  /** 外框 / 倍速 / 挂点 / 全屏 —— 四个都必填，理由同 SegmentPlayer（漏传零症状） */
  frame: PlayerFrame;
  rate: number;
  /** 挂点：time = 当前这一段的秒数，onRoot = 正在放开场那一段（弹幕只挂在开场段上） */
  overlay: PlayerOverlay;
  onFull: (() => void) | null;
}) {
  const { t } = useLingui();
  const [nodeId, setNodeId] = useState(tree.rootId);
  const [path, setPath] = useState<string[]>([tree.rootId]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ctrl, setCtrl] = useState(true);

  // 播放中 3 秒自动收起控制条；暂停时常显
  useEffect(() => {
    if (!ctrl || !playing) return;
    const id = setTimeout(() => setCtrl(false), 3000);
    return () => clearTimeout(id);
  }, [ctrl, playing, time]);

  // 走过的这条走向报给外面（详情页的「保存到本地」按它取段）。播放逻辑一个字不动。
  useEffect(() => {
    onPathChange(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const node = tree.nodes[nodeId] ?? tree.nodes[tree.rootId];
  const seg = node.segment;
  const dur = Math.max(0.001, seg.durationSec);
  const atEnd = time >= dur;
  const isEnding = node.choices.length === 0;
  const needChoice = atEnd && node.choices.length > 1;

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
        if (nt >= dur) {
          setPlaying(false);
          return dur;
        }
        return nt;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, dur, nodeId, rate]);

  // 单选项：段尾自动续播（无感串联）
  useEffect(() => {
    if (atEnd && node.choices.length === 1) {
      const nid = node.choices[0].nextId;
      const timer = setTimeout(() => goTo(nid), 350);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atEnd, nodeId]);

  // 真实视频段：播/停与段内进度同步到 <video>
  const videoRef = useRef<HTMLVideoElement>(null);
  /**
   * 出声还是静音。**缺省出声** —— 与 SegmentPlayer 同一条（那边的 ★★ 写了全部理由）：
   * 这个播放器不自动播放，写死 `muted` 只会让作品详情页的分支互动片永远是哑的、
   * 且没有任何解除入口。
   */
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !seg.videoUrl) return;
    if (playing) {
      // ★ 带声音的播放被拒就退成静音再试一次（同 SegmentPlayer）：别让"出不了声"连累"看不看得见"
      void v.play().catch((e: unknown) => {
        // ★ 只有「带声音被自动播放策略拒了」（NotAllowedError）才退静音重试（2026-09-18 发版复核抓到）：
        //   缓冲时点了暂停 / 换了段，旧那次 play() 会以 AbortError 收尾 —— 原来一律静音重播，于是视频在播、界面显示暂停
        if ((e as { name?: string } | null)?.name !== "NotAllowedError") return;
        v.muted = true;
        setMuted(true);
        void v.play().catch(() => {});
      });
    } else v.pause();
  }, [playing, seg.videoUrl]);
  // ★ muted 是 property：换段重建 <video> 之后要再钉一次（倍速同理，新元素会退回 1 倍）
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    v.playbackRate = rate;
  });
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !seg.videoUrl || !v.duration) return;
    const want = Math.min(v.duration, Math.max(0, time));
    if (Math.abs(v.currentTime - want) > 0.4) v.currentTime = want;
  }, [time, seg.videoUrl]);

  function goTo(nid: string) {
    setPath((p) => [...p, nid]);
    setNodeId(nid);
    setTime(0);
    setPlaying(true);
  }

  /** 回到上一个真分支点（choices>1 的祖先），重新出选择 */
  function backToFork() {
    for (let i = path.length - 2; i >= 0; i--) {
      const n = tree.nodes[path[i]];
      if (n && n.choices.length > 1) {
        setPath(path.slice(0, i + 1));
        setNodeId(n.id);
        setTime(n.segment.durationSec);
        setPlaying(false);
        return;
      }
    }
    restart();
  }

  function restart() {
    // 有开场分支时回到开场选择界面，让观众能换一条开场重看
    if (tree.startChoices && tree.startChoices.length > 1) {
      setStarted(false);
      setPlaying(false);
      setTime(0);
      setPath([tree.rootId]);
      setNodeId(tree.rootId);
      return;
    }
    setPath([tree.rootId]);
    setNodeId(tree.rootId);
    setTime(0);
    setPlaying(true);
  }

  const frac = Math.min(1, Math.max(0, time / dur));
  const ease = frac * frac * (3 - 2 * frac);
  // 走过的分支点数（用于路径徽标）
  const forkCount = useMemo(() => path.filter((id) => (tree.nodes[id]?.choices.length ?? 0) > 1).length, [path, tree]);

  /** 跳到这一段的第几秒（PlayerControls 已经夹进 [0, dur]） */
  function seekTo(sec: number) {
    setTime(sec);
    setStarted(true);
  }

  // 外框（卡片 / 满宽 / 全屏）一处定：components/playerFrame.frameLook；跟着当前段的画幅，竖屏作品才不会被裁掉上下
  const look = frameLook(frame, seg.aspect);
  return (
    <div style={look.style} className={look.className} onClick={() => setCtrl((v) => !v)}>
      {!started ? (
        <>
          <img src={cover} alt={t`封面`} className="h-full w-full object-cover" />
          {tree.startChoices && tree.startChoices.length > 1 ? (
            // 开场分支：创作者在第一段就给了多种走向，观众进来先选
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 px-6">
              <div className="text-sm font-medium text-slate-200"><Trans>选择故事的开场</Trans></div>
              <div className="flex w-full max-w-md flex-col gap-2">
                {tree.startChoices.map((c) => (
                  <button
                    key={c.nextId}
                    onClick={() => {
                      setPath([c.nextId]);
                      setNodeId(c.nextId);
                      setTime(0);
                      setStarted(true);
                      setPlaying(true);
                    }}
                    className="rounded-xl bg-white/90 px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-white"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setStarted(true);
                setPlaying(true);
              }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/35"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 pl-1 text-ink shadow-xl">
                <Icon name="play" size={30} filled />
              </span>
              <span className="rounded-full bg-brand/90 px-3 py-1 text-xs font-medium text-white">
                <Trans>互动视频</Trans>
              </span>
            </button>
          )}
        </>
      ) : (
        <>
          {seg.videoUrl ? (
            // 真实生成的片段（Seedance）；无 videoUrl 或加载失败回退首尾帧渐变
            <video
              key={seg.videoUrl}
              ref={videoRef}
              src={seg.videoUrl}
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
          )}
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-xs text-slate-200">{seg.title}</span>
            {forkCount > 0 && (
              <span className="rounded-full px-2 py-0.5 bg-brand/80 text-[10px] text-white"><Trans>已过 {forkCount} 个分支点</Trans></span>
            )}
          </div>

          {/* 挂点（详情页的弹幕）：画面之上、分支选择层与控制条之下。弹幕只挂在开场那一段上（onRoot） */}
          {overlay?.({ time, paused: !playing, onRoot: nodeId === tree.rootId })}

          {/* 分支选择层 */}
          {needChoice && (
            <div className="absolute inset-0 flex flex-col items-center justify-end gap-3 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-6 pb-8">
              <div className="mb-1 text-sm font-medium text-slate-100"><Trans>剧情走向，由你决定——</Trans></div>
              <div className="flex w-full max-w-md flex-col gap-2.5">
                {node.choices.map((c) => (
                  <button
                    key={c.nextId}
                    onClick={() => goTo(c.nextId)}
                    className="rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-left text-sm text-slate-100 backdrop-blur transition hover:border-brand hover:bg-brand/25"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 结局层 */}
          {atEnd && isEnding && !playing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 text-slate-100">
              <span className="text-sm tracking-widest text-slate-300"><Trans>—— 结局 ——</Trans></span>
              <div className="flex gap-3">
                <button onClick={restart} className="rounded-full bg-white/15 px-4 py-2 text-sm backdrop-blur hover:bg-white/25">
                  <Icon name="replay" size={16} className="mr-1.5 inline-block align-[-3px]" /><Trans>从头再看</Trans>
                </button>
                <button onClick={backToFork} className="rounded-full bg-brand/80 px-4 py-2 text-sm hover:bg-brand">
                  <Icon name="branch" size={16} className="mr-1.5 inline-block align-[-3px]" /><Trans>换条路</Trans>
                </button>
              </div>
            </div>
          )}

          {/* 控制条（只有 PlayerControls 一份，与 SegmentPlayer 共用）：点画面唤起/收起，播放中 3 秒自动淡出 */}
          <PlayerControls
            time={time}
            total={dur}
            playing={playing}
            visible={ctrl}
            marks={[]}
            muted={muted}
            rate={rate}
            onToggle={() => {
              // 原来是 setPlaying((p) => !p && time < dur)：time >= dur 时恒 false，按了没反应
              if (time >= dur) {
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
