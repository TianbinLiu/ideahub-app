// 互动分支播放器（mock 渲染同 SegmentPlayer：首帧→尾帧渐变+轻推镜头）：
// 段尾多选项 → 暂停出分支选择；单选项 → 无缝续播；无选项 → 结局（重看/回上一分支点）。
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { BranchTree, aspectCss, formatDuration } from "../types";

export default function BranchPlayer({ tree, cover }: { tree: BranchTree; cover: string }) {
  const [nodeId, setNodeId] = useState(tree.rootId);
  const [path, setPath] = useState<string[]>([tree.rootId]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [ctrl, setCtrl] = useState(true);

  // 播放中 3 秒自动收起控制条；暂停时常显
  useEffect(() => {
    if (!ctrl || !playing) return;
    const t = setTimeout(() => setCtrl(false), 3000);
    return () => clearTimeout(t);
  }, [ctrl, playing, time]);

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
      const dt = (now - last) / 1000;
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
  }, [playing, dur, nodeId]);

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
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !seg.videoUrl) return;
    if (playing) void v.play().catch(() => {});
    else v.pause();
  }, [playing, seg.videoUrl]);
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

  function seek(clientX: number) {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setTime(r * dur);
    setStarted(true);
  }

  return (
    <div
      ref={wrapRef}
      /* 与 SegmentPlayer 同理：播放框跟着当前段的画幅，竖屏作品才不会被裁掉上下 */
      style={{ aspectRatio: aspectCss(seg.aspect), maxHeight: "72vh" }}
      className="relative mx-auto w-full max-w-full select-none overflow-hidden rounded-xl bg-black"
      onClick={() => setCtrl((v) => !v)}
    >
      {!started ? (
        <>
          <img src={cover} alt="封面" className="h-full w-full object-cover" />
          {tree.startChoices && tree.startChoices.length > 1 ? (
            // 开场分支：创作者在第一段就给了多种走向，观众进来先选
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 px-6">
              <div className="text-sm font-medium text-slate-200">选择故事的开场</div>
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
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 pl-1 text-3xl text-ink shadow-xl">
                ▶
              </span>
              <span className="rounded-full bg-brand/90 px-3 py-1 text-xs font-medium text-white">
                互动视频
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
          )}
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-xs text-slate-200">{seg.title}</span>
            {forkCount > 0 && (
              <span className="rounded-full bg-brand/80 px-2 py-1 text-[10px] text-white">已过 {forkCount} 个分支点</span>
            )}
          </div>

          {/* 分支选择层 */}
          {needChoice && (
            <div className="absolute inset-0 flex flex-col items-center justify-end gap-3 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-6 pb-8">
              <div className="mb-1 text-sm font-medium text-slate-100">剧情走向，由你决定——</div>
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
              <span className="text-sm tracking-widest text-slate-300">—— 结局 ——</span>
              <div className="flex gap-3">
                <button onClick={restart} className="rounded-full bg-white/15 px-4 py-2 text-sm backdrop-blur hover:bg-white/25">
                  <Icon name="replay" size={16} className="mr-1.5 inline-block align-[-3px]" />从头再看
                </button>
                <button onClick={backToFork} className="rounded-full bg-brand/80 px-4 py-2 text-sm hover:bg-brand">
                  <Icon name="branch" size={16} className="mr-1.5 inline-block align-[-3px]" />换条路
                </button>
              </div>
            </div>
          )}

          {/* 控制条：点画面唤起/收起，播放中 3 秒自动淡出。
              原来是 group-hover —— 触屏没有 hover，真机上进度条和播放键完全够不着。 */}
          <div
            className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200 ${
              ctrl ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="-my-2 py-2" onClick={(e) => seek(e.clientX)}>
              <div ref={barRef} className="relative h-1.5 w-full cursor-pointer rounded-full bg-white/25">
                <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${frac * 100}%` }} />
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-100">
              <button
                onClick={() => {
                  // 原来是 setPlaying((p) => !p && time < dur)：time >= dur 时恒 false，按了没反应
                  if (time >= dur) {
                    setTime(0);
                    setPlaying(true);
                  } else {
                    setPlaying((p) => !p);
                  }
                }}
                className="-m-2 p-2"
                aria-label={playing ? "暂停" : "播放"}
              >
                <Icon name={time >= dur ? "replay" : playing ? "pause" : "play"} size={20} filled={time < dur} />
              </button>
              <span className="text-xs tabular-nums text-slate-300">
                {formatDuration(time)} / {formatDuration(dur)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
