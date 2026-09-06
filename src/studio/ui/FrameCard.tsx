// 铸段编辑器里的「首尾帧卡」：把原来分开的三块（开头帧图 / 上传本地图 / 尾帧占位）
// 合成一张卡。
//
// 为什么合成一张：那三块讲的本来就是同一件事——这一段视频长什么样。分开摆时，
// 左栏被切成三个小格子，每格都小到看不清画面，"上传的图会变成哪一帧"也要靠文字解释。
// 合成一张卡之后，它和桌面上的节点卡是同一个东西的两种形态，点开就能看大图。
//
// 状态：
//   虚框 = 首尾帧还没齐（还没推演，或只承接到开头帧）
//   实框 = 首尾帧都有了 —— 此时封面在两帧之间渐变轮播，一眼看出这段"从哪到哪"
//
// 两处在用（同一张卡的两种场合，所以是同一个组件而不是抄一份）：
//   铸段编辑器 —— 尾帧还不存在（由所选方案决定），只能换开头帧
//   方案台选定的那一行 —— 首尾帧都在，两帧都能换成本地图（传 onPickLastFile 才出现那一排）
// 换进来的帧会上锁（Proposal.pinned），AI「按修改重画」时不动它；卡里另给一个"清掉 · 交回
// AI 画"的出口，否则用户上传错一张就再也回不到 AI 自拟。
import { CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TAROT_FRAME_URL } from "../../components/TarotCard";

/** 一轮 = 停留 + 渐变。停留 2.6s 是量出来的：再短像闪烁，再长会让人以为是张静态图 */
const HOLD_MS = 2600;
const FADE_MS = 900;

/** 首尾帧交替：返回当前该显示哪一帧（渐变本身交给 CSS opacity 过渡）。
 *  导出给 PlanBoard 复用——方案台上未选中的行只是"一张会轮播的小卡"，不需要整个 FrameCard
 *  的放大层与上传按钮，但轮播节奏必须与选中行、与桌面节点卡完全一致。 */
export function useFrameCycle(enabled: boolean): boolean {
  const [showLast, setShowLast] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setShowLast(false);
      return;
    }
    const t = setInterval(() => setShowLast((v) => !v), HOLD_MS + FADE_MS);
    return () => clearInterval(t);
  }, [enabled]);
  return showLast;
}

/** 卡面：两张图叠着，只切 opacity（合成层，不触发重排——与本仓动画约定一致） */
export function CardFace({
  first,
  last,
  showLast,
  className = "",
  style,
}: {
  first: string | null;
  last: string | null;
  showLast: boolean;
  className?: string;
  /** 给调用方定框形用（画幅不同，卡的比例也不同——见 PlanBoard.frameAspect） */
  style?: CSSProperties;
}) {
  const both = !!first && !!last;
  return (
    <div className={`relative overflow-hidden ${className}`} style={style}>
      {first && (
        <img
          src={first}
          alt="开头帧"
          className="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
          style={{ opacity: both && showLast ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
        />
      )}
      {last && (
        <img
          src={last}
          alt="尾帧"
          className="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
          style={{ opacity: both ? (showLast ? 1 : 0) : 1, transitionDuration: `${FADE_MS}ms` }}
        />
      )}
    </div>
  );
}

export default function FrameCard({
  firstFrame,
  lastFrame,
  /** 开头帧的来历说明（"承接上一段尾帧" / "已用你上传的图"） */
  originNote,
  /** 能否换开头帧；生成中要禁掉 */
  canEdit,
  onPickFile,
  onResetStart,
  /** 有没有"可恢复"的上传图 */
  uploaded,
  /** 给了才有"换结束帧"那一排（铸段阶段尾帧还不存在，所以那边不传）。
   *  clear=true 表示"清掉这一帧交回 AI"——方案台上换过的帧会上锁，不清掉 AI 不会重画它 */
  onPickLastFile,
  onClearFrame,
  pinned,
  /** 卡下面那行说明；null = 不要（方案台的行里位置很紧） */
  caption,
  aspectRatio = "2 / 3",
  framed,
  framedTitle,
}: {
  firstFrame: string | null;
  lastFrame: string | null;
  originNote: string;
  canEdit: boolean;
  onPickFile: (f: File) => void;
  onResetStart: () => void;
  uploaded: boolean;
  onPickLastFile?: (f: File) => void;
  onClearFrame?: (which: "first" | "last") => void;
  pinned?: { first?: boolean; last?: boolean };
  caption?: string | null;
  /** 卡的框形（CSS aspect-ratio）。缺省 2/3 = 塔罗卡的形；方案台按本段**画幅**传，
   *  否则竖屏帧会被裁成一条、横屏帧只剩中间一块（见 PlanBoard.frameAspect） */
  aspectRatio?: string;
  /** 装裱成一张**卡**（塔罗细边框 + 底部题名条，与全仓卡片同一个形）。
   *  ★ 铸段窗那一格用它：主人实测点名"左侧的虚框并不是卡片形式" —— 它的比例本来
   *    就是 2:3，缺的是"看上去像张牌"这件事（卡框与题名条）。方案台那边不装裱：
   *    那里一行三张、按画幅撑形状，加卡框会把预览挤没。 */
  framed?: boolean;
  /** 装裱态底部题名条上的字（缺省用状态角标那套词） */
  framedTitle?: string;
}) {
  const [zoom, setZoom] = useState(false);
  const complete = !!firstFrame && !!lastFrame;
  const showLast = useFrameCycle(complete);
  // 放大态里独立跑一轮，别和小卡共用——放大是为了看清，节奏该一样但互不打断
  const showLastBig = useFrameCycle(complete && zoom);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<HTMLInputElement>(null);

  // 放大时锁掉背景滚动，并支持 Esc 退出（点卡外区域也能退，见遮罩的 onClick）
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const border = complete ? "border-solid border-cyan-400/70" : "border-dashed border-cyan-400/35";

  return (
    <>
      {/* ── 小卡（左栏原位）── */}
      <button
        onClick={() => setZoom(true)}
        className={`group relative w-full overflow-hidden border-2 ${framed ? "rounded-[6%]" : "rounded-xl"} ${border} bg-slate-800/40 transition active:scale-[.98]`}
        style={{ aspectRatio }}
        title={onPickLastFile ? "点开看大图 / 换首尾帧" : "点开看大图 / 换开头帧"}
      >
        {firstFrame || lastFrame ? (
          <CardFace first={firstFrame} last={lastFrame} showLast={showLast} className="absolute inset-0" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
            AI 自拟首尾帧
          </div>
        )}
        {/* 装裱：塔罗细边框（框图内部纯黑，screen 混合下黑=透明，只有金线发光）——
            与 TarotCard 同一张框图、同一种叠法，卡片在全仓长一个样 */}
        {framed && (
          <img
            src={TAROT_FRAME_URL}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ mixBlendMode: "screen" }}
          />
        )}
        {/* 角标：这张卡现在是什么状态 */}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[9px] text-cyan-200">
          {complete ? "首尾帧" : firstFrame ? "开头帧" : "待推演"}
        </span>
        <span
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 leading-tight text-slate-300 ${
            framed ? "pt-4 text-center text-[10px] font-semibold text-slate-100" : "pt-3 text-[9px]"
          }`}
        >
          {framed ? (framedTitle ?? (complete ? "首尾帧" : "本段画面")) : complete ? "首尾帧轮播 · 点开换图" : originNote}
        </span>
      </button>
      {caption !== null && (
        <div className="text-center text-[10px] leading-relaxed text-slate-500">
          {/* ★ 默认句必须在**两种档位下都成立**：承接的硬度随档位变（segmentGen.carryIsHard），
              而本组件是纯 props 件、不认 store —— 所以这里不说"无缝"，把带档位的说法留给
              宿主用 caption 传（backlog §2.11.3⑤）。 */}
          {caption ?? (complete ? "视频将在这两帧之间生成" : "尾帧由所选方案决定；视频从开头帧往下拍")}
        </div>
      )}

      {/* ── 放大态：在**窗口**里居中铺开，点卡外区域收回 ──
          ★ 必须 portal 到 body：投影面板带 backdrop-blur，而 backdrop-filter 会给
            position:fixed 的后代造一个包含块——留在原地的话 inset-0 只铺满那块面板，
            卡片会被面板边缘裁掉，也谈不上"在窗口中居中"。 */}
      {zoom &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-5 backdrop-blur-sm"
            onClick={() => setZoom(false)}
          >
            <div
              className="flex max-h-full flex-col items-center gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 按高度定尺寸：卡是 2:3 的竖版，按宽度撑会在矮窗口里顶出屏幕 */}
              <div
                className={`relative overflow-hidden rounded-2xl border-2 ${border} bg-slate-900 shadow-[0_0_60px_rgba(103,232,249,0.25)]`}
                style={{ aspectRatio, height: "58vh", maxWidth: "86vw" }}
              >
              {firstFrame || lastFrame ? (
                <CardFace
                  first={firstFrame}
                  last={lastFrame}
                  showLast={showLastBig}
                  className="absolute inset-0"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                  还没有画面——AI 会在推演时自拟首尾帧
                </div>
              )}
              <span className="absolute left-2 top-2 rounded bg-black/65 px-2 py-0.5 text-[11px] text-cyan-200">
                {complete ? "首尾帧轮播" : firstFrame ? "开头帧" : "待推演"}
              </span>
            </div>

              <div className="w-full space-y-2" style={{ maxWidth: "86vw" }}>
                <div className="text-center text-[11px] text-slate-400">
                  {complete ? "视频将在这两帧之间生成" : originNote}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={!canEdit}
                    className="flex-1 rounded-xl border border-slate-600 py-2.5 text-xs text-slate-200 hover:border-cyan-400 disabled:opacity-40"
                  >
                    上传本地图作开头帧
                  </button>
                  {uploaded && (
                    <button
                      onClick={onResetStart}
                      disabled={!canEdit}
                      className="rounded-xl border border-slate-600 px-3 py-2.5 text-xs text-slate-400 disabled:opacity-40"
                    >
                      恢复
                    </button>
                  )}
                </div>
                {onPickLastFile && (
                  <button
                    onClick={() => lastFileRef.current?.click()}
                    disabled={!canEdit}
                    className="w-full rounded-xl border border-slate-600 py-2.5 text-xs text-slate-200 hover:border-cyan-400 disabled:opacity-40"
                  >
                    上传本地图作结束帧
                  </button>
                )}
                {/* 换过的帧被锁住（AI 重画方案时不动它）。要让 AI 重新画就得先把它清掉——
                    没有这个出口，用户上传错一张图就永远没办法回到"AI 自拟" */}
                {onClearFrame && (pinned?.first || pinned?.last) && (
                  <div className="flex gap-2">
                    {(["first", "last"] as const)
                      .filter((w) => pinned?.[w])
                      .map((w) => (
                        <button
                          key={w}
                          onClick={() => onClearFrame(w)}
                          disabled={!canEdit}
                          className="flex-1 rounded-xl border border-slate-700 py-2 text-[11px] text-slate-400 hover:border-slate-500 disabled:opacity-40"
                        >
                          清掉{w === "first" ? "开头" : "结束"}帧 · 交回 AI 画
                        </button>
                      ))}
                  </div>
                )}
                <button
                  onClick={() => setZoom(false)}
                  className="w-full rounded-xl bg-slate-700/70 py-2.5 text-xs text-slate-200"
                >
                  收起
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onPickFile(f);
                }}
              />
              <input
                ref={lastFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onPickLastFile?.(f);
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
