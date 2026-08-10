// 全息投影窗：悬浮卡上方的主交互面板（占据视觉大部分空间，背景灰化模糊）
// editor = 左侧空白首尾帧栏位 + 右侧四区（预览图/素材/视频要求/视频时长）
// proposals = 三个投影节点卡（点开看首尾帧与小说式剧情，选定后落卡）
// decks = 卡组选择（两段式第一步；选中后回第一人称把该组卡摊上桌）
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { deckCoverOf, myCards, myDecks } from "../../data/account";
import { DEFAULT_TIER, VIDEO_TIERS, fmtTokens, segTokens } from "../../data/economy";
import TarotCard from "../../components/TarotCard";
import DeckCard from "../../components/DeckCard";
import GenTrace from "../../components/GenTrace";
import Icon from "../../components/Icon";
import { CARD_TYPES, CARD_TYPE_COLORS, CARD_TYPE_LABELS, Card, CardType, NodeSlot, Proposal } from "../../types";
import { activePath, chosenProposal, useStudio } from "../studioStore";
import TokenCost from "../../components/TokenCost";
import { proposalsCost } from "../../data/economy";
import { computeChain } from "../scene/TableScene";
import { CHAIN, focusCam } from "../scene/layout";

/** 本地图 → 开头帧 dataURL：超宽的压到 1600px（Seedream 参考图/Seedance 首帧都收 dataURL，
 *  原图 base64 动辄 5MB+，白白撑大草稿） */
async function fileToFrameDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = raw;
  });
  const maxW = 1600;
  if (img.width <= maxW) return raw;
  const c = document.createElement("canvas");
  c.width = maxW;
  c.height = Math.round((img.height * maxW) / img.width);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.87);
}

export default function ProjectionWindow() {
  const projection = useStudio((s) => s.projection);
  if (!projection) return null;
  // 卡组选择：小窗置于屏幕中间偏下（上部留给玩家上半身）
  if (projection === "decks") {
    return (
      // pointer-events-none 是功能而非样式：这层 inset-0 原来把整屏的指针事件全吃了，
      // 于是"在小窗外面拖拽"什么也不会发生。放行后事件落到 canvas，TableCatcher 的
      // 轨道手势接管，绕玩家上半身转（openDeckView 已设 orbit:{target:"player"}）。
      // 小窗自身必须 pointer-events-auto 把事件收回来，否则卡片就点不动了。
      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="pointer-events-auto absolute inset-x-2 top-[54%] bottom-[7%] flex flex-col overflow-hidden rounded-2xl border border-cyan-400/40 bg-[#0c142b]/40 shadow-[0_0_60px_rgba(103,232,249,0.28)] backdrop-blur-lg">
          <DeckPickPanel />
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

// ── 卡组小窗：右上角在「卡组 / 卡片」两个视图间切换 ────────────
// 卡组视图 = 全部卡片 + 我的卡组（封面拼贴）；点选一套 → 自动切到卡片视图。
// 卡片视图 = 当前卡组横滑浏览，单击开卡片详情。卡片不再摊上 3D 桌面。
function DeckPickPanel() {
  const activeDeck = useStudio((s) => s.activeDeck);
  const deck = useStudio((s) => s.deck);
  const [view, setView] = useState<"decks" | "cards">("decks");
  const [q, setQ] = useState("");
  const { decks, cardById, allCount } = useMemo(() => {
    const cards = myCards();
    return {
      decks: myDecks(),
      cardById: new Map<string, Card>(cards.map((c) => [c.id, c])),
      allCount: cards.length,
    };
  }, []);

  // 一个搜索框同时管两个视图：卡组视图搜卡组名，卡片视图搜卡名/类型。
  // 切视图时不清空——用户输"雨夜"翻遍卡组没找到、切到卡片继续找是自然动作
  const kw = q.trim().toLowerCase();
  const shownDecks = kw ? decks.filter((d) => d.name.toLowerCase().includes(kw)) : decks;
  const shownCards = kw
    ? deck.filter((c) => (c.name + CARD_TYPE_LABELS[c.type]).toLowerCase().includes(kw))
    : deck;
  // 「全部卡片」是固定入口不是数据，但搜索时也得能被过滤掉，否则搜不到的关键词
  // 下面还孤零零挂着它，看着像"搜到了一个结果"
  const showAllTile = !kw || "全部卡片".includes(kw);

  const showCards = () => {
    // 还没选过卡组时点「卡片」= 看全部卡片
    if (useStudio.getState().activeDeck || useStudio.getState().pickDeck(null, "全部卡片")) setView("cards");
  };

  // 卡组渲染成一张塔罗式实体卡牌（Seedream 生成的魔法边框，见 TarotCard）：
  // 高度吃满面板、宽度由 2:3 比例导出——**整张卡永远完整可见**，不需要上下滚动
  // （旧的三列纵向网格在矮窗口里会把卡截成半张）。身后垫两层错位卡边暗示"一摞卡"。
  return (
    <>
      <div className="flex items-center gap-2 border-b border-cyan-400/20 px-4 py-2.5">
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-cyan-100">
          {view === "decks" ? "选择卡组" : activeDeck?.name ?? "卡片"}
        </h3>
        {/* 右上角：卡组/卡片视图切换 + 关闭 */}
        <div className="flex flex-none overflow-hidden rounded-full border border-cyan-400/30 text-[11px]">
          <button
            onClick={() => setView("decks")}
            className={`px-2.5 py-1 ${view === "decks" ? "bg-cyan-400/25 font-semibold text-cyan-100" : "text-slate-400 hover:text-slate-200"}`}
          >
            卡组
          </button>
          <button
            onClick={showCards}
            className={`px-2.5 py-1 ${view === "cards" ? "bg-cyan-400/25 font-semibold text-cyan-100" : "text-slate-400 hover:text-slate-200"}`}
          >
            卡片
          </button>
        </div>
        <button onClick={() => useStudio.getState().closeProjection()} className="flex-none text-slate-400 hover:text-white">
          ✕
        </button>
      </div>

      <div className="flex flex-none items-center gap-2 border-b border-cyan-400/10 px-4 py-1.5">
        <Icon name="search" size={13} className="flex-none text-cyan-300/60" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={view === "decks" ? "搜卡组名…" : "搜卡名 / 类型…"}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-cyan-50 outline-none placeholder:text-slate-500"
        />
        {q && (
          <button onClick={() => setQ("")} className="flex-none text-[11px] text-slate-400 hover:text-slate-200">
            ✕
          </button>
        )}
      </div>

      {view === "decks" ? (
        <>
          {/* 横滑整卡：卡高吃满面板，宽度按 2:3 导出——不需要上下滚动就能看到整张卡 */}
          <div className="flex min-h-0 flex-1 snap-x snap-mandatory items-center gap-3.5 overflow-x-auto overflow-y-hidden px-4 py-2">
            {showAllTile && (
              <button
                onClick={() => {
                  if (useStudio.getState().pickDeck(null, "全部卡片")) setView("cards");
                }}
                className="h-[94%] flex-none snap-center text-left"
                style={{ aspectRatio: "2/3" }}
              >
                <DeckCard
                  name="全部卡片"
                  count={allCount}
                  cover={[...cardById.values()][0]?.cover ?? null}
                  active={activeDeck?.id === null}
                />
              </button>
            )}
            {shownDecks.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  if (useStudio.getState().pickDeck(d.id, d.name)) setView("cards");
                }}
                className="h-[94%] flex-none snap-center text-left"
                style={{ aspectRatio: "2/3" }}
              >
                <DeckCard
                  name={d.name}
                  count={d.cardIds.length}
                  cover={deckCoverOf(d)?.cover ?? null}
                  active={activeDeck?.id === d.id}
                />
              </button>
            ))}
            {decks.length === 0 && !kw && (
              <div className="flex-none py-3 pl-2 text-[11px] leading-5 text-slate-500">
                还没有建过卡组——发布作品会自动生成《作品》卡组，
                <br />
                也可以在「创意工坊」页手动组一套（编辑时可指定封面卡）。
              </div>
            )}
            {kw && shownDecks.length === 0 && !showAllTile && (
              <div className="flex w-full items-center justify-center text-[11px] text-slate-500">
                没有叫「{q}」的卡组
              </div>
            )}
          </div>
          <div className="pb-2 text-center text-[10px] text-slate-500">← 左右滑动选一套 → 它同时会成为铸段的素材池 · 窗外拖拽可转视角</div>
        </>
      ) : (
        <>
          {/* 与卡组视图同款：卡高吃满面板、宽按 2:3 导出，整卡永远完整可见 */}
          <div className="flex min-h-0 flex-1 snap-x snap-mandatory items-center gap-3 overflow-x-auto overflow-y-hidden px-4 py-2">
            {shownCards.map((c) => (
              <button
                key={c.id}
                onClick={() => useStudio.getState().viewCardDetail(c)}
                className="h-[94%] flex-none snap-center text-left"
                style={{ aspectRatio: "2/3" }}
              >
                <TarotCard cover={c.cover || null} title={c.name} sub={CARD_TYPE_LABELS[c.type]} type={c.type} size="md" />
              </button>
            ))}
            {shownCards.length === 0 && (
              <div className="flex w-full items-center justify-center text-xs text-slate-500">
                {kw ? `这套卡组里没有匹配「${q}」的卡` : "这套卡组还没有卡"}
              </div>
            )}
          </div>
          <div className="pb-2 text-center text-[10px] text-slate-500">← 左右滑动浏览 · 单击查看详情 · 窗外拖拽可转视角</div>
        </>
      )}
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

  const slotCards = editor.slots
    .map((id) => deck.find((c) => c.id === id))
    .filter((c): c is (typeof deck)[number] => !!c);
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
        {/* 左：开头帧（默认承接上一段尾帧，可上传本地图替换）+ 尾帧占位，撑满整列 */}
        <div className="flex w-[124px] flex-none flex-col gap-2">
          {(() => {
            const effStart = editor.startFrame ?? prev?.lastFrame ?? null;
            return (
              <>
                <div className="relative">
                  {effStart ? (
                    <img src={effStart} alt="开头帧" className="aspect-video w-full rounded-lg object-cover" />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center rounded-lg border-2 border-dashed border-cyan-400/30 bg-slate-800/40 text-[10px] text-slate-500">
                      AI 自拟
                    </div>
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-cyan-200">开头帧</span>
                  {effStart && (
                    <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/60 px-1 py-0.5 text-center text-[9px] text-cyan-200">
                      {editor.startFrame ? "已用你上传的图" : "承接上一段尾帧"}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <label className="flex-1 cursor-pointer rounded-lg border border-slate-600 py-1 text-center text-[10px] text-slate-300 hover:border-cyan-400">
                    上传本地图
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={editor.generating}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        void fileToFrameDataUrl(f).then((d) => useStudio.getState().setStartFrame(d));
                      }}
                    />
                  </label>
                  {editor.startFrame && (
                    <button
                      onClick={() => useStudio.getState().setStartFrame(null)}
                      className="rounded-lg border border-slate-600 px-1.5 text-[10px] text-slate-400"
                      title={prev ? "恢复为承接上一段尾帧" : "清除上传的开头帧"}
                    >
                      恢复
                    </button>
                  )}
                </div>
              </>
            );
          })()}
          <div className="relative">
            <div className="flex aspect-video w-full items-center justify-center rounded-lg border-2 border-dashed border-cyan-400/30 bg-slate-800/40 text-[10px] text-slate-500">
              空白
            </div>
            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-cyan-200">尾帧</span>
          </div>
          <div className="text-center text-[10px] leading-4 text-slate-500">
            尾帧由所选方案决定；视频将从开头帧无缝续拍
          </div>
        </div>

        {/* 右：素材 / 视频要求（撑满剩余空间）/ 时长一行 */}
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">

          {/* ② 素材：已选卡在前（同类型可多张——双主角就放两张人物卡），
              五个类型追加按钮常驻在后 */}
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs font-semibold text-slate-300">素材</span>
              {slotCards.length > 0 && (
                <span className="text-[10px] tabular-nums text-slate-500">{slotCards.length}/20 张 · 同类型可多张</span>
              )}
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {slotCards.map((card) => {
                const color = CARD_TYPE_COLORS[card.type];
                return (
                  <div key={card.id} className="relative overflow-hidden rounded border" style={{ borderColor: color }}>
                    <img src={card.cover} alt={card.name} className="aspect-[2/3] w-full object-cover" />
                    <button
                      onClick={() => useStudio.getState().clearSlot(card.id)}
                      className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-[9px] text-slate-300"
                    >
                      ✕
                    </button>
                    <div className="truncate bg-black/60 px-0.5 text-center text-[9px]" style={{ color }}>
                      {card.name}
                    </div>
                  </div>
                );
              })}
              {CARD_TYPES.map((type) => {
                const color = CARD_TYPE_COLORS[type];
                return (
                  <button
                    key={type}
                    onClick={() => setPickerType(pickerType === type ? null : type)}
                    className={`flex aspect-[2/3] flex-col items-center justify-center rounded border border-dashed text-[10px] ${
                      pickerType === type ? "bg-white/10" : ""
                    }`}
                    style={{ borderColor: color + "77", color }}
                  >
                    ＋{CARD_TYPE_LABELS[type].slice(0, 2)}
                  </button>
                );
              })}
            </div>
            {pickerType && (
              <div className="mt-1.5 rounded-lg bg-black/30 p-1.5">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[10px] text-slate-400">
                    点选加入{CARD_TYPE_LABELS[pickerType]}，再点撤下——可连选多张
                  </span>
                  <button onClick={() => setPickerType(null)} className="text-[10px] text-cyan-300">
                    完成
                  </button>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {deck.filter((c) => c.type === pickerType).length === 0 && (
                    <div className="py-2 text-[10px] text-slate-500">卡组暂无此类型——找铸卡师炼一张或去市场收</div>
                  )}
                  {deck
                    .filter((c) => c.type === pickerType)
                    .map((c) => {
                      const on = editor.slots.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() =>
                            on ? useStudio.getState().clearSlot(c.id) : useStudio.getState().pickDeckCard(c.id)
                          }
                          className={`relative w-14 flex-none overflow-hidden rounded border ${
                            on ? "border-gold" : "border-slate-600"
                          }`}
                        >
                          <img
                            src={c.cover}
                            alt={c.name}
                            className={`aspect-[2/3] w-full object-cover ${on ? "opacity-55" : ""}`}
                          />
                          {on && (
                            <span className="absolute inset-0 flex items-center justify-center text-base text-gold">
                              ✓
                            </span>
                          )}
                          <div className="truncate bg-black/70 px-0.5 text-center text-[9px] text-slate-300">
                            {c.name}
                          </div>
                        </button>
                      );
                    })}
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

          {/* ⑤ 生成档位：Seedance 模型分级，按档位×时长预估本段合成 token 消耗 */}
          <div className="flex-none">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs font-semibold text-slate-300">视频档位</span>
              <span className="text-[10px] text-slate-500">合成本段预计消耗</span>
            </div>
            <div className="flex gap-1.5">
              {VIDEO_TIERS.map((t) => {
                const est = segTokens(editor.durationMode === "manual" ? editor.durationSec : 6, t.id);
                const on = editor.videoTier === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => useStudio.getState().setVideoTier(t.id)}
                    disabled={editor.generating}
                    title={t.desc}
                    className={`flex-1 rounded-lg border px-1 py-1 text-center transition ${
                      on
                        ? "border-cyan-400 bg-cyan-400/10 text-cyan-100"
                        : "border-slate-600 text-slate-400 hover:border-slate-400"
                    }`}
                  >
                    <div className="text-[11px] font-semibold">{t.label}</div>
                    <div className="tabular-nums text-[9px] opacity-80">
                      {editor.durationMode === "manual" ? "" : "约 "}
                      {fmtTokens(est)} token
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-cyan-400/20 px-3 pb-3 pt-2">
        {/* 推演一次 = 1 次豆包写剧情 + 最多 6 张 Seedream 首尾帧。
            这一步是工坊里用得最频繁的付费操作，以前一个字的提示都没有 */}
        <TokenCost
          tokens={proposalsCost(!!editor.startFrame)}
          note={editor.startFrame ? "承接上段尾帧，三个方案共用开头帧，只画尾帧" : undefined}
          className="mb-2"
        />
        <div className="flex gap-2">
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
      </div>
    </>
  );
}

// ── 三方案投影：上中下三张节点卡 ──────────────────────────────
function ProposalsPanel() {
  const focus = useStudio((s) => s.focus);
  const root = useStudio((s) => s.root);
  const frameRefining = useStudio((s) => s.frameRefining);
  const [openId, setOpenId] = useState<string | null>(null);
  // 选帧改图小窗：哪个方案的哪一帧 + 修改要求
  const [refine, setRefine] = useState<{ pid: string; which: "first" | "last" } | null>(null);
  const [refineReq, setRefineReq] = useState("");
  const path = activePath(root);
  const node = focus?.nodeId ? path.find((n) => n.id === focus.nodeId) : null;
  if (!node) return null;
  const idx = path.findIndex((n) => n.id === node.id);

  // ‹› 切换聚焦节点：桌面窗口随焦点实时平移（computeChain 焦点跟随），镜头跟到新卡位
  function go(dir: 1 | -1) {
    const st = useStudio.getState();
    const target = path[idx + dir];
    if (!target) return;
    const nx = computeChain(st.root, target.id).items.find((it) => it.node.id === target.id)?.x;
    if (nx == null) return;
    const cam = focusCam(nx, CHAIN.rowZ);
    st.switchFocusNode(target.id, cam.pos, cam.look);
    setOpenId(null);
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-cyan-400/20 px-3 py-2.5">
        <button
          onClick={() => go(-1)}
          disabled={idx <= 0}
          aria-label="上一段"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-slate-700/60 text-slate-200 disabled:opacity-25"
        >
          ‹
        </button>
        <h3 className="min-w-0 flex-1 truncate text-center text-sm font-bold text-cyan-100">
          第 {idx + 1}/{path.length} 段 · 选择走向
        </h3>
        <button
          onClick={() => go(1)}
          disabled={idx >= path.length - 1}
          aria-label="下一段"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-slate-700/60 text-slate-200 disabled:opacity-25"
        >
          ›
        </button>
        <button onClick={() => useStudio.getState().closeProjection()} className="flex-none text-slate-400 hover:text-white">
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
                  {/* 选帧改图：对设定图不满意时点开小窗，让 AI 按要求重画（图生图保持画风） */}
                  <div className="flex gap-2">
                    {(["first", "last"] as const).map((w) => {
                      const busyKey = `${p.id}:${w}`;
                      const on = refine?.pid === p.id && refine.which === w;
                      return (
                        <div key={w} className="min-w-0 flex-1">
                          <div className="relative">
                            <img
                              src={w === "first" ? p.firstFrame : p.lastFrame}
                              alt={w === "first" ? "首帧" : "尾帧"}
                              className={`aspect-video w-full rounded object-cover ${frameRefining === busyKey ? "opacity-50" : ""}`}
                            />
                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] text-cyan-200">
                              {w === "first" ? "首帧" : "尾帧"}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              setRefine(on ? null : { pid: p.id, which: w });
                              setRefineReq("");
                            }}
                            disabled={!!frameRefining}
                            className={`mt-1 w-full rounded border py-1 text-[11px] disabled:opacity-40 ${
                              on ? "border-cyan-400 bg-cyan-400/10 text-cyan-100" : "border-cyan-400/40 text-cyan-200"
                            }`}
                          >
                            {frameRefining === busyKey ? "AI 重画中…" : "✨ AI 改图"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {refine?.pid === p.id && (
                    <div className="rounded-lg bg-black/30 p-2">
                      <textarea
                        value={refineReq}
                        onChange={(e) => setRefineReq(e.target.value)}
                        rows={2}
                        maxLength={160}
                        placeholder="例：把伞换成红色 / 去掉背景里的路人 / 光线改成黄昏"
                        className="w-full resize-none rounded border border-slate-600 bg-black/30 px-2 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400"
                      />
                      <button
                        onClick={() =>
                          void useStudio
                            .getState()
                            .refineProposalFrame(node.id, p.id, refine.which, refineReq)
                            .then((ok) => {
                              if (ok) setRefine(null);
                            })
                        }
                        disabled={!refineReq.trim() || !!frameRefining}
                        className="mt-1.5 w-full rounded-lg bg-cyan-500/80 py-1.5 text-xs font-bold text-ink disabled:opacity-40"
                      >
                        {frameRefining ? "重画中…" : `按要求重画${refine.which === "first" ? "首" : "尾"}帧`}
                      </button>
                    </div>
                  )}
                  {switching && (
                    <div className="rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
                      ⚠ 更换方案后，原方案已延展的后续节点将被收起（切回可恢复）
                    </div>
                  )}
                  {/* ── 单独炼这一段 ──
                      用户可以只挑几段先炼出来看效果（人物对不对、画风稳不稳），
                      剩下的留到最后一起炼。出片写在方案的 videoUrl 上，工作流那边直接认，
                      不会重复收费。炼完可以进编辑页圈画面改细节——改好的尾帧就是下一段的起拍帧 */}
                  {isChosen && (
                    <SegmentActions node={node} proposal={p} />
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

/**
 * 节点卡上的单段出片区：炼本段 / 重炼 / 进编辑页。
 * 「编辑本段」去的就是剪辑页（与工作流跑完后进的是同一页），只带这一段——
 * 在那里可以拖到任意一帧圈出物体写修改要求，重新生成后新的尾帧会顶替设定尾帧，
 * 下一段就从这一帧接着拍。
 */
function SegmentActions({ node, proposal }: { node: NodeSlot; proposal: Proposal }) {
  const navigate = useNavigate();
  const nodeGen = useStudio((s) => s.nodeGen);
  const mine = nodeGen?.proposalId === proposal.id;
  const busy = !!nodeGen;
  const done = !!proposal.videoUrl;
  const cost = segTokens(proposal.durationSec, node.videoTier ?? DEFAULT_TIER);

  return (
    <div className="space-y-1.5">
      {mine && <GenTrace steps={nodeGen!.steps} running className="rounded-lg bg-black/25 px-2 py-1.5" />}
      <div className="flex gap-1.5">
        <button
          onClick={() => void useStudio.getState().genNodeVideo(node.id, proposal.id)}
          disabled={busy || !proposal.plot.trim()}
          className="flex-1 rounded-lg border border-cyan-400/50 bg-cyan-500/15 py-2 text-xs font-bold text-cyan-100 disabled:opacity-40"
        >
          {mine ? "炼制中…" : done ? `♻ 重炼本段（${fmtTokens(cost)}）` : `⚡ 生成本段视频（${fmtTokens(cost)}）`}
        </button>
        {done && (
          <button
            onClick={() => {
              useStudio.getState().openSegmentEdit(node.id, proposal.id);
              navigate("/cut");
            }}
            disabled={busy}
            className="flex-none rounded-lg border border-slate-500/60 bg-slate-700/50 px-3 py-2 text-xs font-semibold text-slate-100 disabled:opacity-40"
          >
            ✂ 编辑本段
          </button>
        )}
      </div>
      {done && (
        <div className="text-center text-[10px] text-emerald-300/80">
          ✓ 本段已出片——最后点法阵时只会炼还没出片的段
        </div>
      )}
    </div>
  );
}
