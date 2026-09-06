// 「方案台」：一段视频的三套方案，一行一套，从上往下排。
//
// 一行 = 左边一张首尾帧卡（两帧渐变轮播，与桌面节点卡的封面同一套演出）
//      + 右边这一套的具体信息（标题 / 剧情 / 时长）。
//
// 为什么要有这个东西：三套方案以前只在两个地方各露一半——工坊的投影面板里是两张小缩略
// 图 + 一段截断的文字，工作流里干脆藏在「本段设置」抽屉的一枚按钮后面。结果是最贵的一步
// （出片，几万 token）反而没有选择余地，而最便宜的一步（推演）用户根本没见过。
//
// ★ 工坊与工作流共用这一个组件（铁律六）。两边的状态形状不同（工坊是 NodeSlot.chosenId=null
//   表示未选，工作流是 FlowNode.plan="picking"），所以这里**不认任何 store**：只收
//   proposals + pickedId + 一组回调，谁调用谁去翻译自己的状态。
//
// 交互分两态，刻意不同：
//   未选定 —— 整行是一枚"选它"的按钮，三行等大。这时候用户的任务只有一件：挑一套。
//   已选定 —— 那一行放大居中、其余缩小压暗；只有选定的那一行可以改帧、改剧情、重画。
//             不给未选定的行开编辑口，是因为编辑必然要花钱重画，而用户还没决定用哪套。
import { ReactNode, useEffect, useRef, useState } from "react";
import { DURATIONS, Proposal, type VideoAspect } from "../../types";
import { fmtTokens } from "../../data/economy";
import { fileToFrameDataUrl } from "../../utils/image";
import FrameCard, { CardFace, useFrameCycle } from "./FrameCard";
import FuseFrameSheet, { type FuseSource } from "./FuseFrameSheet";


export interface PlanBoardProps {
  proposals: Proposal[];
  /** null = 三套摊开等挑（没有哪一行被放大） */
  pickedId: string | null;
  /** 这一套出片了吗（工坊读 proposal.videoUrl，工作流读 videoByProposal——形状不同，
   *  所以交给调用方判断） */
  isDone: (p: Proposal) => boolean;
  /** 推演中/出片中：所有编辑与按钮一律禁掉 */
  busy: boolean;
  /** 正在按修改重画的方案 id；null=空闲 */
  regenId?: string | null;
  onPick: (id: string) => void;
  onPatch: (id: string, patch: Partial<Proposal>) => void;
  /** 换首/尾帧：dataUrl 为本地图（上锁，AI 重画时不动它）；空串 = 清掉交回 AI */
  onFrame: (id: string, which: "first" | "last", dataUrl: string) => void;
  /** 按修改重画这一套的画面 */
  onRegen: (id: string) => void;
  /** 「重新生成」这一套要多少 token（0 = 不显示报价，例如 mock 构建） */
  regenCost: (p: Proposal) => number;
  /** 已选定时给一枚「重新推演三套」——未选定时这件事由外面那枚主按钮承担
   *  （「重新生成方案」），两处同时出现只会让人不知道该点哪个 */
  onRederive?: () => void;
  rederiveCost?: number;
  /** 上一段的真实结尾（本段承接它起拍）：卡面上要说清这张开头帧是哪来的 */
  carriedFrom?: boolean;
  /**
   * 预览卡的框形（CSS aspect-ratio 值，如 "9 / 16"）。**跟本段画幅走**——
   * 写死一个比例的话，另一种画幅的帧会被 object-cover 裁掉一大半：横屏帧塞进竖卡等于
   * 只看得到中间一条，而挑方案恰恰是靠"这一段从哪到哪"的构图来挑的。
   * 缺省 2/3 是塔罗卡的形（与桌面节点卡同款），给没有画幅概念的调用方用。
   */
  frameAspect?: string;
  /** 未选定行的额外提示（工坊：换方案会收起已延展的子树） */
  switchWarn?: (p: Proposal) => string | null;
  /** 选定行底部的自定义操作区（工坊把「AI 改图」「生成本段视频」塞在这里）*/
  actions?: (p: Proposal) => ReactNode;
  /** 工坊投影面板比手机整屏窄，卡与字都要收一号 */
  dense?: boolean;
  /**
   * 「融图」可用的参考图（素材卡的形象图、上一段真实结尾…）。**非空才显示那颗按钮**。
   *
   * ★ 融出来的帧照旧走 `onFrame` 落地 —— 换帧只有那一个缝（工坊/工作流/简约共用），
   *   在这里另开一条写回路径就会与"上锁/清掉交回 AI"那套 pinned 语义分叉。
   * ★ 判**存在性**：老调用方不传 = 不显示，零改动（后加字段判否定）。
   */
  fuseSources?: FuseSource[];
  /** 本段画幅：融出来的帧要跟它同比例，否则会被方舟静默裁掉一截 */
  fuseAspect?: VideoAspect;
}

export default function PlanBoard({
  proposals,
  pickedId,
  isDone,
  busy,
  regenId,
  onPick,
  onPatch,
  onFrame,
  onRegen,
  regenCost,
  onRederive,
  rederiveCost,
  carriedFrom,
  frameAspect = "2 / 3",
  switchWarn,
  actions,
  dense,
  fuseSources,
  fuseAspect,
}: PlanBoardProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pickedRow = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState("");
  /** 上传首尾帧读图中（解码 + 压制那一两秒要让人看见） */
  const [reading, setReading] = useState(false);
  /** 融图浮层开在哪一套的哪一端。null = 没开 */
  const [fusing, setFusing] = useState<{ id: string; which: "first" | "last" } | null>(null);

  // 选定后把那一行滚到视野中间（"放大居中"的后半句）。
  // ★ 用 behavior:"auto" 而不是 smooth：窗口不可见时（切到后台/被挡住）平滑滚动完全
  //   不动，回来还是没居中；瞬移永远生效，而放大动画本身已经提供了视觉反馈。
  useEffect(() => {
    if (!pickedId) return;
    pickedRow.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [pickedId]);

  async function pickFile(id: string, which: "first" | "last", f: File) {
    setErr("");
    setReading(true);
    try {
      onFrame(id, which, await fileToFrameDataUrl(f));
    } catch {
      // 吞掉就成了"点了没反应"（铁律八）：坏图/超大图必须说出来
      setErr("这张图读不出来——换一张试试（支持 jpg/png/webp）");
    } finally {
      setReading(false);
    }
  }

  const cardW = dense ? 76 : 96;

  return (
    <div className="flex h-full flex-col">
      {/* 头条：现在该干什么 + 已选定时的「重新推演三套」 */}
      <div className="flex flex-none items-center gap-2 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">
          {pickedId
            ? "已选定 · 可换首尾帧、改剧情，改完点这一套的「重新生成」"
            : `${proposals.length} 套方案 · 点一套选定它`}
        </span>
        {pickedId && onRederive && (
          <button
            onClick={onRederive}
            disabled={busy}
            className="flex-none rounded-full border border-slate-600 px-2.5 py-1 text-[10px] text-slate-300 disabled:opacity-40"
          >
            ♻ 重新推演三套{!!rederiveCost && `（${fmtTokens(rederiveCost)}）`}
          </button>
        )}
      </div>

      {err && <div className="flex-none px-3 pb-1 text-[10px] text-rose-300">{err}</div>}
      {reading && <div className="flex-none px-3 pb-1 text-[10px] text-slate-400">读取图片…</div>}

      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {proposals.map((p, i) => {
          const picked = p.id === pickedId;
          const done = isDone(p);
          const warn = !picked && switchWarn ? switchWarn(p) : null;
          const cost = regenCost(p);
          return (
            <div
              key={p.id}
              ref={picked ? pickedRow : null}
              // 只动 transform / opacity（合成层）——方案台常常和 3D 画布同屏，
              // 触发重排会直接掉帧（见 CLAUDE.md 动画约定）
              className={`origin-center rounded-xl border transition-[transform,opacity] duration-300 ${
                picked
                  ? "border-gold/80 bg-gold/5 p-2.5"
                  : pickedId
                    ? "scale-[0.93] border-slate-700/60 p-2 opacity-60"
                    : "border-slate-600/60 p-2"
              }`}
            >
              {picked ? (
                // ── 选定态：左卡可换图，右侧信息可逐字改 ──
                <div className="flex items-start gap-2.5">
                  <div className="flex-none space-y-1" style={{ width: cardW }}>
                    <FrameCard
                      firstFrame={p.firstFrame || null}
                      lastFrame={p.lastFrame || null}
                      originNote={
                        p.pinned?.first
                          ? "已用你上传的图"
                          : carriedFrom
                            ? "承接上一段真实结尾"
                            : "AI 自拟开头帧"
                      }
                      canEdit={!busy && regenId !== p.id}
                      uploaded={false}
                      onPickFile={(f) => void pickFile(p.id, "first", f)}
                      onResetStart={() => onFrame(p.id, "first", "")}
                      onPickLastFile={(f) => void pickFile(p.id, "last", f)}
                      onClearFrame={(w) => onFrame(p.id, w, "")}
                      pinned={p.pinned}
                      caption={null}
                      aspectRatio={frameAspect}
                    />
                    <div className="text-center text-[9px] leading-3 text-slate-500">点开卡片换图</div>
                    {/* 「融图」：把几张参考图合成一张边界帧。★ 只在宿主给了候选图时出现，
                        融出来的帧仍旧走 onFrame 落地（换帧只有那一个缝） */}
                    {!!fuseSources?.length && (
                      <div className="flex gap-1">
                        {(["first", "last"] as const).map((w) => (
                          <button
                            key={w}
                            onClick={() => setFusing({ id: p.id, which: w })}
                            disabled={busy || regenId === p.id}
                            className="flex-1 rounded-full border border-slate-700 py-1 text-[9px] text-slate-300 disabled:opacity-40"
                          >
                            🧬 融{w === "first" ? "首" : "尾"}帧
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        value={p.title}
                        onChange={(e) => onPatch(p.id, { title: e.target.value })}
                        maxLength={24}
                        disabled={busy}
                        placeholder="这一段叫什么"
                        className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-600"
                      />
                      <span className="flex-none rounded-full px-2 py-0.5 bg-gold/20 text-[10px] text-gold">✓ 已选定</span>
                      {done && (
                        <span className="flex-none rounded-full px-2 py-0.5 bg-emerald-500/20 text-[10px] text-emerald-300">
                          已出片
                        </span>
                      )}
                    </div>
                    {p.degraded && (
                      <div className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                        ⚠ 占位帧：Seedream 当时没出图，出片前会自动重画
                      </div>
                    )}
                    <textarea
                      value={p.plot}
                      onChange={(e) => onPatch(p.id, { plot: e.target.value })}
                      rows={dense ? 4 : 5}
                      maxLength={400}
                      disabled={busy}
                      placeholder="这一段的画面与剧情（会直接作为生成提示词）"
                      className="novel-text w-full resize-none rounded-lg border border-slate-700 bg-black/25 px-2 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-gold/70"
                    />
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="flex-none text-[10px] text-slate-500">时长</span>
                      {DURATIONS.map((d) => (
                        <button
                          key={d}
                          onClick={() => onPatch(p.id, { durationSec: d })}
                          disabled={busy}
                          className={`rounded px-1.5 py-0.5 text-[10px] disabled:opacity-40 ${
                            p.durationSec === d ? "bg-gold/80 text-ink" : "bg-panel text-slate-300"
                          }`}
                        >
                          {d}s
                        </button>
                      ))}
                    </div>
                    {/* 「按修改重画」只重画画面，不重写剧情——剧情是用户刚敲的字 */}
                    <button
                      onClick={() => onRegen(p.id)}
                      disabled={busy || !p.plot.trim()}
                      className="w-full rounded-full border border-cyan-400/50 bg-cyan-500/10 py-1.5 text-[11px] font-semibold text-cyan-100 disabled:opacity-40"
                    >
                      {regenId === p.id
                        ? "重画中…"
                        : `✨ 重新生成这一套的画面${cost ? `（${fmtTokens(cost)}）` : ""}`}
                    </button>
                    {actions?.(p)}
                  </div>
                </div>
              ) : (
                // ── 未选定态：整行就是"选它" ──
                <button
                  onClick={() => onPick(p.id)}
                  disabled={busy}
                  className="flex w-full items-start gap-2.5 text-left disabled:opacity-60"
                >
                  <PreviewCard first={p.firstFrame} last={p.lastFrame} width={cardW} aspect={frameAspect} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
                        {p.title || `方案 ${i + 1}`}
                      </span>
                      <span className="flex-none rounded-full px-2 py-0.5 bg-slate-700/70 text-[10px] text-slate-300">
                        {p.durationSec}s
                      </span>
                      {done && (
                        <span className="flex-none rounded-full px-2 py-0.5 bg-emerald-500/20 text-[10px] text-emerald-300">
                          已出片
                        </span>
                      )}
                    </div>
                    <p className="novel-text mt-1 line-clamp-3 text-[11px] leading-relaxed text-slate-300">{p.plot}</p>
                    {warn && <p className="mt-1 text-[10px] text-amber-300">{warn}</p>}
                  </div>
                </button>
              )}
            </div>
          );
        })}
      </div>
      {/* 融图浮层：融好的帧走 onFrame 落地（与上传/清掉同一个缝）。
          ★ 认 `fusing.id` 不认下标：方案顺序会变（重新推演就整表换掉），
            按下标记的话融出来的帧会落到另一套上，而画面照出、零报错。 */}
      {fusing && (
        <FuseFrameSheet
          which={fusing.which}
          sources={fuseSources ?? []}
          aspect={fuseAspect ?? "portrait"}
          onDone={(url) => onFrame(fusing.id, fusing.which, url)}
          onClose={() => setFusing(null)}
        />
      )}
    </div>
  );
}

/** 未选定行的小卡：只看不点（整行才是按钮），但轮播照跑——"这一段从哪到哪"是挑方案的
 *  主要依据，静态首帧根本看不出走向 */
function PreviewCard({
  first,
  last,
  width,
  aspect,
}: {
  first: string;
  last: string;
  width: number;
  aspect: string;
}) {
  const both = !!first && !!last;
  const showLast = useFrameCycle(both);
  return (
    <div className="flex-none" style={{ width }}>
      {first || last ? (
        <CardFace
          first={first || null}
          last={last || null}
          showLast={showLast}
          style={{ aspectRatio: aspect }}
          className="w-full rounded-lg border border-slate-600/70 bg-slate-800/40"
        />
      ) : (
        <div
          style={{ aspectRatio: aspect }}
          className="flex w-full items-center justify-center rounded-lg border border-dashed border-slate-600 bg-slate-800/40 text-[9px] text-slate-500"
        >
          无预览帧
        </div>
      )}
    </div>
  );
}
