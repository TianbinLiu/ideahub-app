// 播放器底部那条控制条 —— 分段播放器（SegmentPlayer）与互动分支播放器（BranchPlayer）共用一份（2026-10-26 视频详情页 P0-2）。
// 原来两份各写各的：分支那份的进度条没有 role=slider、没有键盘，播放键是一个文字「▶」，静音键一份是 emoji 一份是图标。
// ★ 只画、不管时间：播到哪儿、播没播、点了跳到哪儿都由宿主（播放器）说了算；这里只把它们画出来、把操作交回去。
// ★ 进度条是自绘的 div，ARIA 与键盘手补（2026-10-15 教材人格评审，WCAG 2.2 · 4.1.2 / 2.1.1 / 2.5.8）：role=slider + 当前值、
//   valuetext 读成 mm:ss；← → ↑ ↓ 一下 1 秒、Home / End 到头。不换成 <input type=range>：段落分界刻度没处画。
//   触控盒 -my-3 py-3：条本身 6px，上下各 12px 内边距、负外边距抵回去，版面一个像素不动（有效命中 24px，到 2.5.8 的下限）。
//   焦点落上来顺手把控制条唤出来：控制条淡出后仍在 Tab 顺序里，焦点停在一个看不见的东西上就是 2.4.7 说的那种。
import { useLingui } from "@lingui/react/macro";
import { useRef } from "react";
import Icon from "./Icon";
import { formatDuration } from "../types";

export default function PlayerControls({
  time,
  total,
  playing,
  visible,
  marks,
  muted,
  rate,
  onToggle,
  onSeek,
  onMute,
  onShow,
  onFull,
}: {
  /** 现在播到第几秒 / 一共几秒（分段播放器 = 整片；分支播放器 = 当前这一段） */
  time: number;
  total: number;
  playing: boolean;
  /** 控制条现在看不看得见（播放中 3 秒自动收起，由宿主管） */
  visible: boolean;
  /** 段落分界刻度（0~1 的位置）；没有 = [] */
  marks: number[];
  muted: boolean;
  /** 倍速（≠1 时在时间后面标「1.5×」） */
  rate: number;
  /** 播 / 停（播完之后再按 = 重播，宿主判） */
  onToggle: () => void;
  /** 跳到第几秒（已经夹进 [0, total]） */
  onSeek: (sec: number) => void;
  onMute: () => void;
  /** 把控制条唤出来（焦点落到进度条上时） */
  onShow: () => void;
  /** 进全屏；null = 不摆这颗键 */
  onFull: (() => void) | null;
}) {
  const { t } = useLingui();
  const barRef = useRef<HTMLDivElement>(null);
  const span = Math.max(0.001, total);
  const ended = time >= span;
  const seekTo = (sec: number) => onSeek(Math.min(span, Math.max(0, sec)));
  const seekAt = (clientX: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    seekTo((Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))) * span);
  };
  return (
    <div
      className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label={t`播放进度`}
        aria-valuemin={0}
        aria-valuemax={Math.round(span)}
        aria-valuenow={Math.min(Math.round(span), Math.round(time))}
        aria-valuetext={formatDuration(time)}
        className="-my-3 py-3"
        onClick={(e) => seekAt(e.clientX)}
        onFocus={onShow}
        onKeyDown={(e) => {
          const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
          const to = step ? time + step : e.key === "Home" ? 0 : e.key === "End" ? span : null;
          if (to === null) return;
          e.preventDefault();
          seekTo(to);
        }}
      >
        <div ref={barRef} className="relative h-1.5 w-full cursor-pointer rounded-full bg-white/25">
          <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${Math.min(100, (time / span) * 100)}%` }} />
          {marks.map((mk, i) => (
            <div key={i} className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 bg-white/70" style={{ left: `${mk * 100}%` }} />
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-100">
        <button onClick={onToggle} className="-m-2 p-2" aria-label={ended ? t`重新播放` : playing ? t`暂停` : t`播放`}>
          <Icon name={ended ? "replay" : playing ? "pause" : "play"} size={20} filled={!ended} />
        </button>
        <span className="text-xs tabular-nums text-slate-300">
          {formatDuration(time)} / {formatDuration(span)}
        </span>
        {rate !== 1 && <span className="text-[10px] font-semibold tabular-nums text-brand">{rate}×</span>}
        <span className="flex-1" />
        <button onClick={onMute} className="-m-2 p-2" aria-label={muted ? t`取消静音` : t`静音`}>
          <Icon name={muted ? "volume-x" : "volume"} size={18} />
        </button>
        {onFull && (
          <button onClick={onFull} className="-m-2 p-2" aria-label={t`全屏`}>
            <Icon name="expand" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
