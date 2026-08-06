// 全息投影窗：悬浮卡上方的主交互面板（占据视觉大部分空间，背景灰化模糊）
// editor = 左侧空白首尾帧栏位 + 右侧四区（预览图/素材/视频要求/视频时长）
// proposals = 三个投影节点卡（点开看首尾帧与小说式剧情，选定后落卡）
import { useState } from "react";
import { CARD_TYPES, CARD_TYPE_COLORS, CARD_TYPE_LABELS, CardType } from "../../types";
import { activePath, chosenProposal, useStudio } from "../studioStore";

export default function ProjectionWindow() {
  const projection = useStudio((s) => s.projection);
  if (!projection) return null;
  // 卡组浏览：小窗横滑，置于屏幕中间偏下（上部留给玩家上半身）
  if (projection === "deck") {
    return (
      <div className="absolute inset-0 z-20">
        <div className="absolute inset-x-2 top-[54%] bottom-[7%] flex flex-col overflow-hidden rounded-2xl border border-cyan-400/40 bg-[#0c142b]/40 shadow-[0_0_60px_rgba(103,232,249,0.28)] backdrop-blur-lg">
          <DeckPanel />
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 z-20">
      {/* 背景灰化+模糊；底部留出浮卡区域保持清晰 */}
      <div className="absolute inset-x-0 top-0 bottom-[36%] bg-slate-900/55 backdrop-blur-md" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[36%] bg-gradient-to-t from-transparent via-transparent to-slate-900/55" />
      {/* 投影光束：从悬浮卡射向窗口 */}
      <div
        className="pointer-events-none absolute bottom-[31%] left-1/2 h-[8%] w-32 -translate-x-1/2 opacity-70"
        style={{
          clipPath: "polygon(50% 100%, 2% 0, 98% 0)",
          background: "linear-gradient(to bottom, rgba(103,232,249,0.4), rgba(103,232,249,0.04))",
        }}
      />
      {/* 半透明全息面板：透出后方 3D 桌景，靠模糊保证可读性 */}
      <div className="absolute inset-x-2 top-[3%] bottom-[35%] flex flex-col overflow-hidden rounded-2xl border border-cyan-400/40 bg-[#0c142b]/40 shadow-[0_0_60px_rgba(103,232,249,0.28)] backdrop-blur-lg">
        {projection === "editor" ? <EditorPanel /> : <ProposalsPanel />}
      </div>
    </div>
  );
}

// ── 卡组投影：横向滑动浏览（scroll-snap，一屏约 2.2 张） ────────
function DeckPanel() {
  const deck = useStudio((s) => s.deck);
  return (
    <>
      <div className="flex items-center justify-between border-b border-cyan-400/20 px-4 py-2.5">
        <h3 className="text-sm font-bold text-cyan-100">我的卡组 · {deck.length} 张</h3>
        <button onClick={() => useStudio.getState().closeProjection()} className="text-slate-400 hover:text-white">
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden px-4 py-3">
        {deck.map((c) => {
          const color = CARD_TYPE_COLORS[c.type];
          return (
            <div
              key={c.id}
              className="relative flex w-[42%] flex-none snap-center flex-col overflow-hidden rounded-xl border bg-black/40"
              style={{ borderColor: color + "88" }}
            >
              <img src={c.cover} alt={c.name} className="min-h-0 w-full flex-1 object-cover" />
              <div className="p-2">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-slate-100">{c.name}</span>
                  <span className="flex-none rounded-full border px-1.5 text-[9px]" style={{ color, borderColor: color }}>
                    {CARD_TYPE_LABELS[c.type]}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">{c.summary}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="pb-2 text-center text-[10px] text-slate-500">← 左右滑动浏览 →</div>
    </>
  );
}

// ── 编辑投影：铸造节点卡 ─────────────────────────────────────
function EditorPanel() {
  const editor = useStudio((s) => s.editor);
  const deck = useStudio((s) => s.deck);
  const root = useStudio((s) => s.root);
  const [pickerType, setPickerType] = useState<CardType | null>(null);
  if (!editor) return null;

  const path = activePath(root);
  const prev = path.length > 0 ? chosenProposal(path[path.length - 1]) : null;
  const segIndex = root ? path.length : 0;

  return (
    <>
      <div className="flex items-center justify-between border-b border-cyan-400/20 px-4 py-2.5">
        <h3 className="text-sm font-bold text-cyan-100">铸造节点卡 · 第 {segIndex + 1} 段</h3>
        <button
          onClick={() => useStudio.getState().closeProjection()}
          disabled={editor.generating}
          className="text-slate-400 hover:text-white disabled:opacity-30"
        >
          ✕
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
        {/* 左：本段空白首尾帧栏位（生成后由所选方案填充）+ 承接预览，撑满整列 */}
        <div className="flex w-[124px] flex-none flex-col gap-2">
          {["首帧", "尾帧"].map((label) => (
            <div key={label} className="relative">
              <div className="flex aspect-video w-full items-center justify-center rounded-lg border-2 border-dashed border-cyan-400/30 bg-slate-800/40 text-[10px] text-slate-500">
                空白
              </div>
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-cyan-200">{label}</span>
            </div>
          ))}
          <div className="text-center text-[10px] leading-4 text-slate-500">生成后由所选方案决定</div>
          {/* 承接预览挪到左列底部：与首尾帧同宽，吃掉左列空白 */}
          <div className="mt-auto">
            <div className="mb-1 text-[10px] font-semibold text-slate-400">承接画面</div>
            {prev ? (
              <div className="relative">
                <img src={prev.lastFrame} alt="上一段尾帧" className="aspect-video w-full rounded-lg object-cover" />
                <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/60 px-1 py-0.5 text-center text-[9px] text-cyan-200">
                  上一段尾帧 → 本段首帧
                </span>
              </div>
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-slate-800/30 text-[10px] text-slate-500">
                首段 · 无承接
              </div>
            )}
          </div>
        </div>

        {/* 右：素材 / 视频要求（撑满剩余空间）/ 时长一行 */}
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">

          {/* ② 素材 */}
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-300">素材</div>
            <div className="grid grid-cols-5 gap-1.5">
              {CARD_TYPES.map((type) => {
                const cardId = editor.slots[type];
                const card = deck.find((c) => c.id === cardId);
                const color = CARD_TYPE_COLORS[type];
                return card ? (
                  <div key={type} className="relative overflow-hidden rounded border" style={{ borderColor: color }}>
                    <img src={card.cover} alt={card.name} className="aspect-[2/3] w-full object-cover" />
                    <button
                      onClick={() => useStudio.getState().clearSlot(type)}
                      className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-[9px] text-slate-300"
                    >
                      ✕
                    </button>
                    <div className="truncate bg-black/60 px-0.5 text-center text-[9px]" style={{ color }}>
                      {card.name}
                    </div>
                  </div>
                ) : (
                  <button
                    key={type}
                    onClick={() => setPickerType(pickerType === type ? null : type)}
                    className="flex aspect-[2/3] flex-col items-center justify-center rounded border border-dashed text-[10px]"
                    style={{ borderColor: color + "77", color }}
                  >
                    ＋{CARD_TYPE_LABELS[type].slice(0, 2)}
                  </button>
                );
              })}
            </div>
            {pickerType && (
              <div className="mt-1.5 rounded-lg bg-black/30 p-1.5">
                <div className="mb-1 text-[10px] text-slate-400">
                  从卡组选择{CARD_TYPE_LABELS[pickerType]}（也可直接点下方桌面展开的卡）
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {deck.filter((c) => c.type === pickerType).length === 0 && (
                    <div className="py-2 text-[10px] text-slate-500">卡组暂无此类型——找铸卡师炼一张或去市场收</div>
                  )}
                  {deck
                    .filter((c) => c.type === pickerType)
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          useStudio.getState().pickDeckCard(c.id);
                          setPickerType(null);
                        }}
                        className="w-14 flex-none overflow-hidden rounded border border-slate-600"
                      >
                        <img src={c.cover} alt={c.name} className="aspect-[2/3] w-full object-cover" />
                        <div className="truncate bg-black/70 px-0.5 text-center text-[9px] text-slate-300">{c.name}</div>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* ③ 视频要求：flex-1 吃掉全部剩余空白 */}
          <div className="flex min-h-[72px] flex-1 flex-col">
            <div className="mb-1 text-xs font-semibold text-slate-300">视频要求（剧情补充）</div>
            <textarea
              value={editor.requirement}
              onChange={(e) => useStudio.getState().setRequirement(e.target.value)}
              maxLength={300}
              placeholder="例：主角在雨里发现了那封信的真正收件人……"
              className="min-h-0 w-full flex-1 resize-none rounded-lg border border-slate-600 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400"
            />
          </div>

          {/* ④ 视频时长：单输入框——留空 = AI 决定，填数字 = 按用户输入（2-15 秒，失焦时收拢） */}
          <div className="flex flex-none items-center gap-2.5">
            <span className="flex-none text-xs font-semibold text-slate-300">视频时长</span>
            <input
              type="number"
              min={2}
              max={15}
              value={editor.durationMode === "manual" ? editor.durationSec : ""}
              placeholder="AI 决定"
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  useStudio.getState().setDurationMode("ai");
                } else {
                  useStudio.getState().setDurationMode("manual");
                  useStudio.getState().setDurationSec(Number(v));
                }
              }}
              onBlur={() => {
                if (editor.durationMode === "manual")
                  useStudio.getState().setDurationSec(Math.min(15, Math.max(2, editor.durationSec || 2)));
              }}
              className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-black/30 px-2.5 py-1.5 text-xs text-cyan-100 outline-none placeholder:text-slate-500 focus:border-cyan-400"
            />
            <span className="flex-none text-xs text-slate-400" title="留空由 AI 决定；可填 2-15">
              秒
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-t border-cyan-400/20 p-3">
        <button
          onClick={() => useStudio.getState().closeProjection()}
          disabled={editor.generating}
          className="rounded-xl bg-slate-700/70 px-4 py-2 text-sm text-slate-200 disabled:opacity-40"
        >
          取消
        </button>
        <button
          onClick={() => void useStudio.getState().generateNode()}
          disabled={editor.generating}
          className="flex-1 rounded-xl bg-brand/90 py-2 text-sm font-bold text-ink disabled:opacity-60"
        >
          {editor.generating ? editor.progress || "AI 正在推演三种走向…" : "生成"}
        </button>
      </div>
    </>
  );
}

// ── 三方案投影：上中下三张节点卡 ──────────────────────────────
function ProposalsPanel() {
  const focus = useStudio((s) => s.focus);
  const root = useStudio((s) => s.root);
  const [openId, setOpenId] = useState<string | null>(null);
  const node = focus?.nodeId ? activePath(root).find((n) => n.id === focus.nodeId) : null;
  if (!node) return null;

  return (
    <>
      <div className="flex items-center justify-between border-b border-cyan-400/20 px-4 py-2.5">
        <h3 className="text-sm font-bold text-cyan-100">选择本段走向 · 三选一</h3>
        <button onClick={() => useStudio.getState().closeProjection()} className="text-slate-400 hover:text-white">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {node.proposals.map((p) => {
          const isChosen = node.chosenId === p.id;
          const expanded = openId === p.id;
          const switching = node.chosenId != null && !isChosen && node.children[node.chosenId] != null;
          return (
            <div
              key={p.id}
              className={`rounded-xl border p-2.5 transition-colors ${
                isChosen ? "border-gold/80 bg-gold/5" : expanded ? "border-cyan-400/60 bg-cyan-400/5" : "border-slate-600/60"
              }`}
            >
              <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpenId(expanded ? null : p.id)}>
                <div className="flex w-[88px] flex-none flex-col gap-1">
                  <img src={p.firstFrame} alt="首帧" className="aspect-video w-full rounded object-cover" />
                  <img src={p.lastFrame} alt="尾帧" className="aspect-video w-full rounded object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-slate-100">{p.title}</span>
                    <span className="flex-none rounded-full bg-slate-700/70 px-1.5 text-[10px] text-slate-300">{p.durationSec}s</span>
                    {isChosen && <span className="flex-none rounded-full bg-gold/20 px-1.5 text-[10px] text-gold">✓ 当前选定</span>}
                    {p.degraded && (
                      <span className="flex-none rounded-full bg-amber-500/15 px-1.5 text-[10px] text-amber-300" title="Seedream 当时没出图，先用占位图；合成前会自动重画真帧">
                        ⚠ 占位帧
                      </span>
                    )}
                  </div>
                  <p className={`novel-text mt-1 text-xs text-slate-300 ${expanded ? "" : "line-clamp-2"}`}>{p.plot}</p>
                </div>
              </button>
              {expanded && (
                <div className="mt-2 space-y-2">
                  {switching && (
                    <div className="rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
                      ⚠ 更换方案后，原方案已延展的后续节点将被收起（切回可恢复）
                    </div>
                  )}
                  {isChosen ? (
                    <button
                      onClick={() => useStudio.getState().closeProjection()}
                      className="w-full rounded-lg bg-emerald-500/80 py-2 text-sm font-bold text-ink"
                    >
                      保持当前选择
                    </button>
                  ) : (
                    <button
                      onClick={() => useStudio.getState().chooseProposal(node.id, p.id)}
                      className="w-full rounded-lg bg-gold/90 py-2 text-sm font-bold text-ink"
                    >
                      选定此方案
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div className="pb-1 text-center text-[10px] text-slate-500">选定后其余方案收起，卡片将落回桌面</div>
      </div>
    </>
  );
}
