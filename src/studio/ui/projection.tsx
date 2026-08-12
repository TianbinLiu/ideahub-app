// 全息投影窗：悬浮卡上方的主交互面板（占据视觉大部分空间，背景灰化模糊）
// editor = 左侧空白首尾帧栏位 + 右侧四区（预览图/素材/视频要求/视频时长）
// proposals = 方案台：三套走向一行一套（左首尾帧卡 / 右剧情），挑定一套后就地改图改剧情、
//             炼出本段视频——**炼出来才能开下一张卡**（见 studioStore.placeholderVisible）
// decks = 卡组选择（两段式第一步；选中后回第一人称把该组卡摊上桌）
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { deckCoverOf, myCards, myDecks, tierBlockReason } from "../../data/account";
import { DEFAULT_TIER, VIDEO_TIERS, fmtTokens, modelLabel, segTokens, segmentCost, tierOf } from "../../data/economy";
import TarotCard from "../../components/TarotCard";
import DeckCard from "../../components/DeckCard";
import GenTrace from "../../components/GenTrace";
import FrameCard from "./FrameCard";
import PlanBoard from "./PlanBoard";
import Icon from "../../components/Icon";
import { CARD_TYPES, CARD_TYPE_COLORS, CARD_TYPE_LABELS, Card, CardType, NodeSlot, Proposal, VIDEO_ASPECTS, aspectCss, aspectOf } from "../../types";
import {
  activePath,
  chosenProposal,
  proposalDone,
  proposalRedrawCostOf,
  rederiveKey,
  useStudio,
} from "../studioStore";
import TokenCost from "../../components/TokenCost";
import { proposalsCost } from "../../data/economy";
import { fileToFrameDataUrl } from "../../utils/image";
import { computeChain } from "../scene/TableScene";
import { CHAIN, focusCam } from "../scene/layout";

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
  /** 当前套餐点不动的档位各是为什么（空 = 都能选）。判断在 data/account 一处 */
  const tierBlocks = VIDEO_TIERS.map((t) => tierBlockReason(t)).filter((r): r is string => !!r);

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
        {/* 左：首尾帧卡（原来是开头帧图 / 上传按钮 / 尾帧占位三块，合成一张——
            它和桌面上的节点卡是同一个东西的两种形态，点开看大图、换开头帧都在卡里做） */}
        <div className="flex w-[124px] flex-none flex-col gap-2">
          <FrameCard
            firstFrame={editor.startFrame ?? prev?.lastFrame ?? null}
            /* 铸段阶段尾帧还不存在——它由所选方案决定，所以这里恒为 null，卡是虚框。
               推演完成后节点卡上两帧齐了，卡自然变实框并开始轮播 */
            lastFrame={null}
            originNote={
              editor.startFrame ? "已用你上传的图" : prev?.lastFrame ? "承接上一段尾帧" : "AI 将自拟开头帧"
            }
            canEdit={!editor.generating}
            uploaded={!!editor.startFrame}
            onPickFile={(f) => void fileToFrameDataUrl(f).then((d) => useStudio.getState().setStartFrame(d))}
            onResetStart={() => useStudio.getState().setStartFrame(null)}
          />
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

          {/* ⑤ 画幅：竖屏/横屏。放在档位【之前】——它决定设定帧画在什么画布上，
              是这一炉最先落地的东西，推演完再想换就等于整段重画。
              小方块是等比示意图，不写数字：用户要判断的是"手机全屏还是电影感"，
              9:16/16:9 这种写法在这一步反而要多想一步 */}
          <div className="flex-none">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs font-semibold text-slate-300">画幅</span>
              <span className="text-[10px] text-slate-500">{aspectOf(editor.aspect).desc}</span>
            </div>
            <div className="flex gap-1.5">
              {VIDEO_ASPECTS.map((a) => {
                const on = editor.aspect === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => useStudio.getState().setAspect(a.id)}
                    disabled={editor.generating}
                    title={a.desc}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-1 py-1.5 transition ${
                      on
                        ? "border-cyan-400 bg-cyan-400/10 text-cyan-100"
                        : "border-slate-600 text-slate-400 hover:border-slate-400"
                    }`}
                  >
                    <span
                      className={`block rounded-[2px] border-2 ${on ? "border-cyan-300" : "border-slate-500"}`}
                      style={{ width: a.id === "portrait" ? 9 : 16, height: a.id === "portrait" ? 16 : 9 }}
                    />
                    <span className="text-[11px] font-semibold">{a.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ⑥ 生成档位：Seedance 模型分级，按档位×时长预估本段合成 token 消耗 */}
          <div className="flex-none">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs font-semibold text-slate-300">视频档位</span>
              <span className="text-[10px] text-slate-500">合成本段预计消耗</span>
            </div>
            <div className="flex gap-1.5">
              {VIDEO_TIERS.map((t) => {
                const est = segTokens(editor.durationMode === "manual" ? editor.durationSec : 6, t.id);
                const on = editor.videoTier === t.id;
                // 付费档位门禁：判断只有一处（data/account.tierBlockReason），
                // 这里只负责把它画出来 —— 灰着但不说为什么等于告诉用户"功能坏了"
                const block = tierBlockReason(t);
                return (
                  <button
                    key={t.id}
                    onClick={() => useStudio.getState().setVideoTier(t.id)}
                    disabled={editor.generating || !!block}
                    title={block ?? `${t.desc}（${t.model}）`}
                    className={`flex-1 rounded-lg border px-1 py-1 text-center transition disabled:opacity-40 ${
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
            {/* 原因印在页面上，不能只挂 title：工坊这块投影在手机上同样没有 hover */}
            {tierBlocks.length > 0 && <p className="mt-1 text-[9px] leading-[13px] text-amber-300/80">{tierBlocks.join("；")}</p>}
            {/* ★ 写出**真正会被调用的那个模型**。「极速/标准/高清」只说了画质档次，
                没说这一段交给谁生成 —— 而 1.0 与 2.0 的观感差别很大，用户对不上账时
                无从判断。名字由 tierOf(...).model 推导，与发给方舟的 id 同源，
                不会出现"界面写着一个、实际跑另一个"。完整 id 放在 title 里。 */}
            <div
              className="mt-1 text-center text-[9px] text-slate-500"
              title={tierOf(editor.videoTier).model}
            >
              模型：{modelLabel(tierOf(editor.videoTier).model)}
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

// ── 方案台投影：三套走向，一行一套 ────────────────────────────
function ProposalsPanel() {
  const focus = useStudio((s) => s.focus);
  const root = useStudio((s) => s.root);
  const frameRefining = useStudio((s) => s.frameRefining);
  const proposalRegen = useStudio((s) => s.proposalRegen);
  const nodeGen = useStudio((s) => s.nodeGen);
  const path = activePath(root);
  const node = focus?.nodeId ? path.find((n) => n.id === focus.nodeId) : null;
  if (!node) return null;
  const idx = path.findIndex((n) => n.id === node.id);
  const prev = idx > 0 ? chosenProposal(path[idx - 1]) : null;
  const chosen = chosenProposal(node);
  const done = proposalDone(chosen);
  // 承接判定：本段的设定首帧就是上一段的设定尾帧（AI 顺接铸出来的）→ 这张开头帧不是本段
  // 自己画的，AI 重画方案时不该动它
  const carried = !!(prev?.lastFrame && chosen?.firstFrame === prev.lastFrame);
  const busy = !!nodeGen || !!frameRefining || !!proposalRegen;

  // ‹› 切换聚焦节点：桌面窗口随焦点实时平移（computeChain 焦点跟随），镜头跟到新卡位
  function go(dir: 1 | -1) {
    const st = useStudio.getState();
    const target = path[idx + dir];
    if (!target) return;
    const nx = computeChain(st.root, target.id).items.find((it) => it.node.id === target.id)?.x;
    if (nx == null) return;
    const cam = focusCam(nx, CHAIN.rowZ);
    st.switchFocusNode(target.id, cam.pos, cam.look);
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
          第 {idx + 1}/{path.length} 段 · {node.chosenId ? (done ? "已出片" : "已选定走向") : "选择走向"}
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
      {/* 重推三套的进度：真实 AI 下一分钟出头（1 次豆包 + 最多 6 张 Seedream）。
          它占的是 nodeGen，但没有对应的方案 id，所以进度条挂在整个方案台上方而不是某一行 */}
      {nodeGen?.proposalId === rederiveKey(node.id) && (
        <GenTrace steps={nodeGen.steps} running className="mx-3 mt-2 rounded-lg bg-black/25 px-2 py-1.5" />
      )}

      {/* 方案台：与工作流页共用同一个组件（铁律六）。工坊这边的"未选定"天然就是
          chosenId === null——不需要另一套标记 */}
      <div className="min-h-0 flex-1">
        <PlanBoard
          dense
          proposals={node.proposals}
          pickedId={node.chosenId}
          isDone={proposalDone}
          busy={busy}
          regenId={proposalRegen}
          onPick={(id) => useStudio.getState().chooseProposal(node.id, id)}
          onPatch={(id, patch) => useStudio.getState().patchProposal(node.id, id, patch)}
          onFrame={(id, which, dataUrl) => useStudio.getState().setProposalFrame(node.id, id, which, dataUrl)}
          onRegen={(id) => void useStudio.getState().regenProposal(node.id, id)}
          regenCost={(p) => proposalRedrawCostOf(p, prev)}
          onRederive={() => void useStudio.getState().regenNodeProposals(node.id)}
          rederiveCost={proposalsCost(!!prev?.lastFrame)}
          carriedFrom={carried}
          // 预览卡的框跟本段画幅走：写死一个比例，另一种画幅的帧会被裁掉一大半
          frameAspect={aspectCss(node.aspect)}
          switchWarn={(p) =>
            node.chosenId != null && node.chosenId !== p.id && node.children[node.chosenId] != null
              ? "⚠ 换成这一套，原方案已延展的后续节点会被收起（切回可恢复）"
              : null
          }
          actions={(p) => <PickedActions node={node} proposal={p} />}
        />
      </div>
      <div className="flex-none border-t border-cyan-400/15 px-3 py-1.5 text-center text-[10px] leading-4 text-slate-500">
        {!node.chosenId
          ? "挑一套 → 可换首尾帧/改剧情 → 炼出本段视频，桌面上才会亮出下一段的卡位"
          : done
            ? "本段已出片 · 桌面上下一段的虚线卡位已亮起"
            : "炼出本段视频才能开下一段（段与段靠上一段的真实尾帧承接起拍）"}
      </div>
    </>
  );
}

/**
 * 方案台上「选定的那一套」底下那排活儿：AI 改图 / 炼本段 / 进编辑页。
 *
 * 为什么塞在这里而不是做进 PlanBoard：AI 改图（按文字要求图生图）与「编辑本段」（去剪辑页
 * 圈画面）都要认工坊的节点树，工作流页没有对应的东西。PlanBoard 收一个 actions 插槽，
 * 组件本身保持只认 proposals（两边共用的前提）。
 *
 * 「编辑本段」去的就是剪辑页（与工作流跑完后进的是同一页），只带这一段——在那里可以拖到
 * 任意一帧圈出物体写修改要求，重新生成后新的尾帧会顶替设定尾帧，下一段就从这一帧接着拍。
 */
function PickedActions({ node, proposal }: { node: NodeSlot; proposal: Proposal }) {
  const navigate = useNavigate();
  const nodeGen = useStudio((s) => s.nodeGen);
  const frameRefining = useStudio((s) => s.frameRefining);
  const proposalRegen = useStudio((s) => s.proposalRegen);
  const [refine, setRefine] = useState<"first" | "last" | null>(null);
  const [refineReq, setRefineReq] = useState("");
  const mine = nodeGen?.proposalId === proposal.id;
  const busy = !!nodeGen || !!frameRefining || !!proposalRegen;
  const done = proposalDone(proposal);
  // ★ 与 studioStore.genNodeVideo 真扣的钱同一个函数：出片 + 还得补画的设定帧。
  //   按钮上的数字和实际扣款分两处算必然分叉（铁律六）
  const cost = segmentCost({
    durationSec: proposal.durationSec,
    tierId: node.videoTier ?? DEFAULT_TIER,
    hasFirstFrame: !!proposal.firstFrame,
    hasLastFrame: !!proposal.lastFrame,
    refMode: false, // 工坊不走参考生视频：它的整条链路建立在首尾帧上
  });

  return (
    <div className="space-y-1.5 border-t border-slate-700/60 pt-1.5">
      {/* AI 改图：图生图按一句要求重画某一帧（保画风）。与"上传本地图"是两条不同的路——
          一条是"让 AI 改成这样"，一条是"就用我这张" */}
      <div className="flex gap-1.5">
        {(["first", "last"] as const).map((w) => (
          <button
            key={w}
            onClick={() => {
              setRefine(refine === w ? null : w);
              setRefineReq("");
            }}
            disabled={busy}
            className={`flex-1 rounded border py-1 text-[10px] disabled:opacity-40 ${
              refine === w ? "border-cyan-400 bg-cyan-400/10 text-cyan-100" : "border-cyan-400/40 text-cyan-200"
            }`}
          >
            {frameRefining === `${proposal.id}:${w}` ? "重画中…" : `✨ AI 改${w === "first" ? "首" : "尾"}帧`}
          </button>
        ))}
      </div>
      {refine && (
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
                .refineProposalFrame(node.id, proposal.id, refine, refineReq)
                .then((ok) => {
                  if (ok) setRefine(null);
                })
            }
            disabled={!refineReq.trim() || busy}
            className="mt-1.5 w-full rounded-lg bg-cyan-500/80 py-1.5 text-xs font-bold text-ink disabled:opacity-40"
          >
            {frameRefining ? "重画中…" : `按要求重画${refine === "first" ? "首" : "尾"}帧`}
          </button>
        </div>
      )}
      {mine && <GenTrace steps={nodeGen!.steps} running className="rounded-lg bg-black/25 px-2 py-1.5" />}
      <div className="flex gap-1.5">
        <button
          onClick={() => void useStudio.getState().genNodeVideo(node.id, proposal.id)}
          disabled={busy || !proposal.plot.trim()}
          className="flex-1 rounded-lg bg-brand/90 py-2 text-xs font-bold text-ink disabled:opacity-40"
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
            className="flex-none rounded-lg border border-slate-500/60 bg-slate-700/50 px-2.5 py-2 text-xs font-semibold text-slate-100 disabled:opacity-40"
          >
            ✂ 编辑
          </button>
        )}
      </div>
    </div>
  );
}
