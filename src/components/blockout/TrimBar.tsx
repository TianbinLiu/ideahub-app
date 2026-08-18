// 时间轴：两个把手框出一段，**实时**显示这一段有多长。
//
// ★★ 全部按【整数秒】走，不是浮点。服务端 `blockoutize` 的 zod 收的就是
//   `startSec: int` / `durSec: int`，浮点会被那边整句 400 —— 与其让用户看一句校验错，
//   不如从一开始就只让他选得出整数。副作用是好的：报价（blockoutizeCost 吃 durSec）
//   与服务端拼变换 URL 用的 `du_` 是同一个整数，两端算的是同一笔钱。
//
// ★★ 把手**不夹**允许的时长窗口（只夹"物理上不可能"：出片尾、长度 < 1 秒）。
//   夹进去的话，用户拖到 30 秒就再也拖不动，界面上一个字都没有 —— 那是「灰按钮不说话」
//   的手势版，本仓明令禁止。超出窗口时框照样能拖，由 selectionIssue 当场把原因说成一句话。
//
// ★ 光靠拖是不够的：600 秒的片子在 340px 的轨道上，1 像素 ≈ 1.8 秒，靠手指根本对不准
//   "第 12 秒起 8 秒"。所以下面那排 ±1 秒的微调键不是装饰，是这条轨道唯一精确的入口。
import { useRef, type PointerEvent as RPointerEvent } from "react";
import { formatDuration } from "../../types";

type Mode = "start" | "end" | "move";

export interface TrimBarProps {
  /** 整条视频可选的秒数上界（整数秒，取 floor —— 见 arkVideoRules.selectableSeconds） */
  totalSec: number;
  startSec: number;
  durSec: number;
  /** 允许的时长窗口（白模输入是 [5,30]，由调用方传进来）。
   *  ★ 只用于**说话**（"允许 5~30 秒"）与徽章配色，不用来夹把手，见文件头 */
  minSec: number;
  maxSec: number;
  onChange: (startSec: number, durSec: number) => void;
  /** 播放头（秒），画一条线 */
  playheadSec?: number;
  /** 点空白轨道 = 把播放头挪过去（不改选段）。不给就不响应点击 */
  onSeek?: (sec: number) => void;
  disabled?: boolean;
}

export default function TrimBar({
  totalSec,
  startSec,
  durSec,
  minSec,
  maxSec,
  onChange,
  playheadSec,
  onSeek,
  disabled,
}: TrimBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Mode; sec: number; start: number; dur: number } | null>(null);

  const total = Math.max(1, Math.round(totalSec));
  const pct = (sec: number) => `${Math.max(0, Math.min(1, sec / total)) * 100}%`;

  /** 屏幕 x → 整数秒。★ 每次都现量轨道宽：拖到一半键盘弹出/父面板展开都会改宽度，
   *  按下时量一次的话，之后每一步都按旧宽度换算，手指与把手会越走越远 */
  function secAt(clientX: number): number {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return 0;
    return Math.round(((clientX - r.left) / r.width) * total);
  }

  function down(mode: Mode) {
    return (e: RPointerEvent) => {
      if (disabled) return;
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* 合成事件没有有效 pointerId：捕获失败只影响"拖出元素外"，不影响正常拖动 */
      }
      drag.current = { mode, sec: secAt(e.clientX), start: startSec, dur: durSec };
    };
  }

  function move(e: RPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const delta = secAt(e.clientX) - d.sec;
    if (d.mode === "move") {
      onChange(Math.max(0, Math.min(total - d.dur, d.start + delta)), d.dur);
      return;
    }
    if (d.mode === "start") {
      // 入点最多顶到出点前 1 秒（0 秒的选段没有意义，也过不了 zod 的 durSec ≥ 1）
      const s = Math.max(0, Math.min(d.start + d.dur - 1, d.start + delta));
      onChange(s, d.start + d.dur - s);
      return;
    }
    const end = Math.max(d.start + 1, Math.min(total, d.start + d.dur + delta));
    onChange(d.start, end - d.start);
  }

  const end = () => {
    drag.current = null;
  };

  /** 微调：起点/时长各 ±1 秒。夹法与拖拽一致（只夹物理边界，不夹 [minSec,maxSec]） */
  function nudge(what: "start" | "dur", by: number) {
    if (what === "start") {
      const s = Math.max(0, Math.min(total - durSec, startSec + by));
      onChange(s, durSec);
    } else {
      const d = Math.max(1, Math.min(total - startSec, durSec + by));
      onChange(startSec, d);
    }
  }

  const btn = "rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 disabled:opacity-40";

  return (
    <div className="space-y-1.5">
      <div
        ref={trackRef}
        className="relative h-11 w-full touch-none select-none rounded-lg bg-slate-800"
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerDown={(e) => {
          // 空白处按下 = 挪播放头。把手/选区自己 stopPropagation，不会走到这儿
          if (disabled || !onSeek) return;
          onSeek(secAt(e.clientX));
        }}
      >
        {/* 选中的这一段 */}
        <div
          onPointerDown={down("move")}
          className="absolute top-0 h-full touch-none rounded-md border-y-2 border-sky-400 bg-sky-400/25"
          style={{ left: pct(startSec), width: pct(durSec) }}
        />
        {/* 两个把手：热区 28px 宽（手指抓得住），视觉是中间那条 4px 的亮条 */}
        {(["start", "end"] as const).map((which) => (
          <div
            key={which}
            onPointerDown={down(which)}
            className="absolute top-0 flex h-full w-7 touch-none items-center justify-center"
            style={{ left: pct(which === "start" ? startSec : startSec + durSec), transform: "translateX(-50%)" }}
          >
            <span className="block h-8 w-1 rounded-full bg-sky-200 shadow" />
          </div>
        ))}
        {/* 播放头 */}
        {playheadSec != null && (
          <div
            className="pointer-events-none absolute top-0 h-full w-px bg-white/80"
            style={{ left: pct(playheadSec) }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] tabular-nums text-slate-300">
          {formatDuration(startSec)} → {formatDuration(startSec + durSec)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
            durSec >= minSec && durSec <= maxSec ? "bg-sky-500/20 text-sky-200" : "bg-rose-500/20 text-rose-200"
          }`}
        >
          {durSec} 秒
        </span>
        <span className="text-[10px] text-slate-500">
          允许 {minSec}~{maxSec} 秒 · 全片 {formatDuration(total)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-slate-500">起点</span>
        <button className={btn} disabled={disabled || startSec <= 0} onClick={() => nudge("start", -1)}>
          −1s
        </button>
        <button
          className={btn}
          disabled={disabled || startSec + durSec >= total}
          onClick={() => nudge("start", 1)}
        >
          +1s
        </button>
        <span className="ml-2 text-[10px] text-slate-500">时长</span>
        <button className={btn} disabled={disabled || durSec <= 1} onClick={() => nudge("dur", -1)}>
          −1s
        </button>
        <button
          className={btn}
          disabled={disabled || startSec + durSec >= total}
          onClick={() => nudge("dur", 1)}
        >
          +1s
        </button>
      </div>
    </div>
  );
}
