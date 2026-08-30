// 全息投影窗：悬浮卡上方的主交互面板（占据视觉大部分空间，背景灰化模糊）
// editor = 左侧空白首尾帧栏位 + 右侧四区（预览图/素材/视频要求/视频时长）
// proposals = 方案台：三套走向一行一套（左首尾帧卡 / 右剧情），挑定一套后就地改图改剧情、
//             炼出本段视频——**炼出来才能开下一张卡**（见 studioStore.placeholderVisible）
// decks = 卡组选择（两段式第一步；选中后回第一人称把该组卡摊上桌）
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { deckCoverOf, myCards, myDecks, tierBlockReason } from "../../data/account";
import { VIDEO_TIERS, deriveIssue, fmtTokens, modelLabel, r2vPriceIssue, realFaceIssue, segTokens, tierOf } from "../../data/economy";
import TarotCard from "../../components/TarotCard";
import DeckCard from "../../components/DeckCard";
import GenTrace from "../../components/GenTrace";
import FrameCard from "./FrameCard";
import PlanBoard from "./PlanBoard";
import AnnStrip from "../../components/flow/AnnStrip";
import RefFrameSheet from "../../components/flow/RefFrameSheet";
import { registerMaterialVideo, uploadTemplateVideo } from "../../api/uploads";
import { captureFirstLast } from "../../utils/videoFrames";
import SegPlayer from "../../components/flow/SegPlayer";
import FuseFrameSheet, { fuseSourcesOf } from "./FuseFrameSheet";
import CustomFrameSlots from "../../components/flow/CustomFrameSlots";
import Icon from "../../components/Icon";
import { CARD_TYPES, CARD_TYPE_COLORS, CARD_TYPE_LABELS, Card, CardType, Proposal, VIDEO_ASPECTS, aspectCss, aspectOf } from "../../types";
import {
  activePath,
  chosenProposal,
  nextStartFrame,
  proposalDone,
  proposalRedrawCostOf,
  rederiveKey,
  useStudio,
} from "../studioStore";
import { CUSTOM_MID_MAX, nodeCost, tplOfNode, useFlow, type FlowNode } from "../flowStore";
import TierRow from "../../components/flow/TierRow";
// 选模板弹层借画布那一份（铁律六：市场懒加载/分段组折叠/预览确认全在那一个实现里）。
// FlowCanvas 不 import 本文件，方向安全（它俩只在 StudioPage/FlowPage 各自的树里出现）
import { TemplatePicker } from "../../components/flow/FlowCanvas";
// 「进挂卡编辑页要带什么」只有 FlowPage 一处实现（模板详情页也从那儿取）；
// 回程收口在 hooks/useCastReturn，/studio 与 /flow 都挂了它
import { castEditorState } from "../../pages/FlowPage";
// ★ 提示词硬顶与画布同一处（ai 层是唯一出处）——三个数各写各的那段历史见 CLAUDE.md
import { VIDEO_PROMPT_MAX } from "../../ai";
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
      <div className="absolute inset-x-0 top-0 bottom-[12%] bg-slate-900/55 backdrop-blur-md" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[12%] bg-gradient-to-t from-transparent via-transparent to-slate-900/55" />
      {/* 投影光束：从悬浮卡射向窗口 */}
      <div
        className="pointer-events-none absolute bottom-[9%] left-1/2 h-[4%] w-32 -translate-x-1/2 opacity-70"
        style={{
          clipPath: "polygon(50% 100%, 2% 0, 98% 0)",
          background: "linear-gradient(to bottom, rgba(103,232,249,0.4), rgba(103,232,249,0.04))",
        }}
      />
      {/* 半透明全息面板：透出后方 3D 桌景，靠模糊保证可读性。
          ★ 2026-08-30 主人点名放到**近乎全屏**：底部原来留 35% 给悬浮卡，而铸段窗那三步
            （尤其三张模式卡与首尾帧格）在剩下的 62% 里被压得很小。现在只留 11% ——
            够看见悬浮卡的上沿与那道投影光束（"这块面板是从卡上投出来的"这个隐喻还在），
            但不再为它牺牲主内容。 */}
      <div className="absolute inset-x-2 top-[2%] bottom-[11%] flex flex-col overflow-hidden rounded-2xl border border-cyan-400/40 bg-[#0c142b]/40 shadow-[0_0_60px_rgba(103,232,249,0.28)] backdrop-blur-lg">
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
  const [pickerType, setPickerType] = useState<CardType | null>(null);
  /**
   * 铸段窗 = **三步向导**（2026-08-30 主人点名，对齐工作流编辑窗的三模式格局）：
   *   ① 选模式（套模板 / 自选卡片 / 自定义——与画布那三个页签同名同义）
   *   ② 写内容（素材 + 要求；自定义模式外加首尾帧上传）
   *   ③ 定规格 · 生成（时长/画幅/档位 + 报价 + 那颗真花钱的键）
   * ★★ 前身是 2026-08-23 的两屏拆分（内容/规格），这次把"选哪条路"提为第一步：
   *   原来自定义直出是沉在内容屏底部的一个区块，实测被认定"没有这个选项"；
   *   套模板则整个不存在——它的挂卡机器全在 flowStore（依赖方向单向，绝不反向搬），
   *   所以第一步选它 = **换到画布那一面去做**（同一条流水线，见 syncFlowBack）。
   * ★ 规格屏不摆别的活（2026-08-23 那次拆分的理由原样成立）；生成键跟规格同屏，
   *   价钱就贴在最后要按的那颗键上（docs/ui-copy-grammar 文法②）。
   * ★ 拖素材卡进占位开的窗跳过第一步直接落在②：拖卡这个动作本身就是在选「自选卡片」。
   */
  const [step, setStep] = useState<"mode" | "ref" | "content" | "spec">(() =>
    (useStudio.getState().editor?.slots.length ?? 0) > 0 ? "content" : "mode",
  );
  const [lane, setLane] = useState<"cards" | "custom">("cards");
  /** 示例视频上传中的进度句 / 调帧小窗 / 选文件口（自定义·第①页） */
  const [refUploading, setRefUploading] = useState("");
  const [refSheet, setRefSheet] = useState(false);
  const refFileRef = useRef<HTMLInputElement>(null);
  /** 第一步选「套模板」：**就地**弹选模板层（2026-08-30 主人点名"别把人赶出工坊"；
   *  此前这里是 closeProjection + navigate 去画布/模板市场）。选定即落节点
   *  （studioStore.layTemplateNode——appendNode + setNodeTemplate 两拍，规则全在 flowStore） */
  const [tplPick, setTplPick] = useState(false);
  /** 自定义车道的素材折叠行（默认收着）：卡在这条车道只在"缺帧要 AI 补画"时当参考，
   *  摊开一整面卡格会让它与「自选卡片」长得一模一样（主人实测点名"两个小窗口是一样的"） */
  const [matsOpen, setMatsOpen] = useState(false);
  /** 自定义车道的融图开在哪一帧上（候选与画布同一处 fuseSourcesOf） */
  const [fuse, setFuse] = useState<"first" | "last" | null>(null);
  // ★★ hook 一律排在早退**之前**（本文件两处栽过，2026-08-30 同日各修一次）：
  // editor 从 null 变非 null 的那一拍 hook 数就对不上，React 抛
  // 「Rendered more hooks than during the previous render」——整个投影窗当场崩掉，
  // 表现是"铸段窗里三个选项不见了"，而不是一条报错（工坊页没有 ErrorBoundary）
  if (!editor) return null;

  const slotCards = editor.slots
    .map((id) => deck.find((c) => c.id === id))
    .filter((c): c is (typeof deck)[number] => !!c);
  const path = activePath();
  const prev = path.length > 0 ? chosenProposal(path[path.length - 1]) : null;
  const segIndex = path.length;
  /** 当前套餐点不动的档位各是为什么（空 = 都能选）。判断在 data/account 一处 */
  const tierBlocks = VIDEO_TIERS.map((t) => tierBlockReason(t) ?? deriveIssue(t.id)).filter(
    (r): r is string => !!r,
  );

  const crumbSteps = lane === "custom" ? (["mode", "ref", "content", "spec"] as const) : (["mode", "content", "spec"] as const);
  // ★ 标签压到两字：自定义车道是四步，375px 顶栏上「示例视频/写内容」会把整行折成两行（实测）
  const crumbLabel = { mode: "选式", ref: "示例", content: "内容", spec: "规格" } as const;
  const stepCrumb = (
    <span className="flex items-center gap-1 text-[9px] text-slate-500">
      {crumbSteps.map((s, i) => (
        <span key={s} className={s === step ? "font-bold text-cyan-200" : ""}>
          {i > 0 && <span className="pr-1 text-slate-600">›</span>}
          {i + 1} {crumbLabel[s]}
        </span>
      ))}
    </span>
  );

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-cyan-400/20 px-4 py-2.5">
        {/* ★ 每一步都要能退（2026-08-30 主人点名"选择了选项后无法回到上一步"）：
            脚上那排「‹ 上一步」只长在②③两步，示例视频那一页压根没有脚 —— 顶栏这枚
            是所有步骤共用的退路，第①步时不渲染（那一步的退出是右边的 ✕） */}
        {step !== "mode" && (
          <button
            onClick={() => setStep(step === "spec" ? "content" : step === "content" ? (lane === "custom" ? "ref" : "mode") : "mode")}
            disabled={editor.generating}
            aria-label="上一步"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-slate-700/60 text-slate-200 disabled:opacity-30"
          >
            ‹
          </button>
        )}
        <h3 className="flex-none text-sm font-bold text-cyan-100">铸造节点卡 · 第 {segIndex + 1} 段</h3>
        {stepCrumb}
        <button
          onClick={() => useStudio.getState().closeProjection()}
          disabled={editor.generating}
          className="text-slate-400 hover:text-white disabled:opacity-30"
        >
          ✕
        </button>
      </div>

      {/* ══ 第①步：选模式。与画布编辑窗的三个页签同名同义（工作流↔工坊一套心智） ══ */}
      {step === "mode" ? (
        /* ══ 第①步：三张**卡片**（主人点名"要有看板娘封面的卡片形式"）══
           封面是同一位看板娘的三张场景图（design/gen-segmode-covers.mjs 出，与创作入口
           那三张同一张定妆照——角色一致靠同一张参考图，不靠文案描述）。
           卡框借 TarotCard：全仓卡片是同一个形，这一屏也就长得像"在选一张牌"。 */
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <p className="flex-none text-center text-[11px] text-slate-400">这一段怎么拍？挑一张</p>
          {/* ★ 竖排三行、**卡按高度定尺寸**（2026-08-30 主人点名"占八成空间"）：
              三张并排时卡是**宽度**受限的 —— 336px 宽的面板分三列，每列 104px、卡只有
              156px 高（面板的 23%），说明文字还会被 flex-1 撑到最底下与卡脱开（实测）。
              竖排之后每行吃掉三分之一屏高，卡自己按 aspect-[2/3] 由高度反推宽度，
              三行合计约八成，说明文字就在卡旁边。 */}
          <div className="flex min-h-0 flex-1 flex-col gap-2.5">
            {(
              [
                ["/create/mode-tpl.jpg", "套模板", "白模复刻", "套一个模板，给人偶挂卡换人", () => setTplPick(true)],
                ["/create/mode-cards.jpg", "自选卡片", "AI 推演三套", "挑素材卡＋写要求，三套方案挑一套", () => { setLane("cards"); setStep("content"); }],
                ["/create/mode-custom.jpg", "自定义", "全按你的来", "示例视频 / 自己给帧，免费铺方案直出", () => { setLane("custom"); setStep("ref"); }],
              ] as const
            ).map(([cover, label, tag, desc, go]) => (
              <button
                key={label}
                onClick={go}
                className="flex min-h-0 flex-1 items-center gap-3 rounded-2xl border border-slate-600/70 bg-black/25 p-2.5 text-left transition active:scale-[0.98] hover:border-cyan-400/60"
              >
                {/* 卡按行高定尺寸：外框 h-full + 2:3，TarotCard 自己 w-full + 同比例正好贴合 */}
                <span className="flex h-full flex-none" style={{ aspectRatio: "2 / 3" }}>
                  <TarotCard cover={cover} title={label} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-base font-bold text-cyan-100">{label}</span>
                    <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[10px] text-cyan-200">{tag}</span>
                  </span>
                  <span className="mt-1.5 block text-[11px] leading-relaxed text-slate-400">{desc}</span>
                </span>
                <span className="flex-none text-slate-500">›</span>
              </button>
            ))}
          </div>
        </div>
      ) : step === "ref" ? (
        /* ══ 自定义·第②步：示例视频（可跳过，跳过是小字附庸——主人点名的主从关系） ══ */
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-2.5 overflow-y-auto p-4">
          {editor.refVideo ? (
            <div className="rounded-xl border border-sky-500/40 bg-sky-500/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-sky-200">🎬 参考视频已挂上（{editor.refVideo.durationSec.toFixed(1)}s）</span>
                <button onClick={() => useStudio.getState().setEditorRefVideo(null)} className="flex-none text-[10px] text-slate-500">移除</button>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">已自动取它的首尾帧当本段首尾帧；可细调、加中间帧（最多 {CUSTOM_MID_MAX} 张）</p>
              <button onClick={() => setRefSheet(true)} className="mt-2 w-full rounded-lg border border-sky-500/40 py-1.5 text-[11px] text-sky-200">🎞 调节首尾帧 / 加中间帧</button>
              <button onClick={() => setStep("content")} className="mt-2 w-full rounded-xl bg-brand/90 py-2 text-sm font-bold text-ink">下一步：写内容 ›</button>
            </div>
          ) : (
            <>
              {/* ★ 档位带不动参考视频就**不给传**（2026-08-30）：此前照样能传，等到出片
                  那一刻才被 segmentGen 整句拒 —— 用户白传一次几十 MB。原因写在按钮下面，
                  并指出去哪儿换档（本步的 ⚙ 在第③步，所以直接说档名） */}
              <button
                onClick={() => refFileRef.current?.click()}
                disabled={editor.generating || !!refUploading || !tierOf(editor.videoTier).refVid}
                title={!tierOf(editor.videoTier).refVid ? `「${tierOf(editor.videoTier).label}」档带不了参考视频` : undefined}
                className="w-full rounded-xl border border-dashed border-sky-500/60 py-8 text-sm font-semibold text-sky-200 disabled:opacity-40"
              >
                {refUploading || "🎬 上传一段示例视频当整段参考"}
              </button>
              {!tierOf(editor.videoTier).refVid && (
                <p className="text-center text-[10px] leading-relaxed text-amber-300/90">
                  「{tierOf(editor.videoTier).label}」档带不了参考视频——到「定规格」那一步换成「电影级」
                  {tierBlockReason(tierOf("ultra")) ? "（付费档，套餐不够会点不动）" : ""}，或直接跳过这一步自己给首尾帧
                </p>
              )}
              <p className="text-center text-[10px] text-slate-500">上传后自动用它的首尾帧当本段首尾帧，之后还能细调、加中间帧</p>
              <button onClick={() => setStep("content")} className="mx-auto text-[11px] text-slate-500 underline underline-offset-2">
                不上传，直接给首尾帧 ›
              </button>
            </>
          )}
          <input
            ref={refFileRef}
            type="file"
            accept="video/mp4,video/quicktime"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              void (async () => {
                try {
                  setRefUploading("上传参考视频 0%…");
                  const receipt = await uploadTemplateVideo(f, (frac) => setRefUploading(`上传参考视频 ${Math.round(frac * 100)}%…`));
                  setRefUploading("登记素材…");
                  const reg = await registerMaterialVideo(receipt.publicId);
                  const local = URL.createObjectURL(f);
                  useStudio.getState().setEditorRefVideo({ url: reg.url, publicId: receipt.publicId, durationSec: reg.durationSec, localUrl: local });
                  try {
                    setRefUploading("取首尾帧…");
                    const fr = await captureFirstLast(local, reg.durationSec);
                    useStudio.getState().setStartFrame(fr.first);
                    useStudio.getState().setEndFrame(fr.last);
                  } catch {
                    useStudio.getState().npcSay("自动取首尾帧没成——点「🎞 调节首尾帧」手动截。");
                  }
                } catch (err) {
                  useStudio.getState().npcSay(`参考视频没挂上：${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  setRefUploading("");
                }
              })();
            }}
          />
        </div>
      ) : /* ══ 第③步：定规格（时长 / 画幅 / 档位）。整块投影归它一个，不与"拍什么"混在一屏 ══ */
      step === "spec" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
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
                // 工坊铸段整个建立在推演上，按发直出档（真人档）走不了——判定与话术
                // 都在 economy.deriveIssue 一处（flowStore/studioStore 的闸用的同一句）
                const block = tierBlockReason(t) ?? deriveIssue(t.id);
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
      ) : (
      /* ══ 第②步：写内容（素材 + 要求；自定义模式外加尾帧上传）══ */
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
        {/* 左：首尾帧卡（**只在自选卡片车道**）。它和桌面上的节点卡是同一个东西的两种形态。
            自定义车道不摆它 —— 那条路要的是与画布 ✍ 自定义**逐格相同**的两格首尾帧
            （见右栏的 CustomFrameSlots，2026-08-30 主人点名"就像工作流模式中的自定义一样"）。
            ★ 宽度按 2:3 给（96px → 144px 高），别再让它在窄栏里被压成一条 */}
        {lane === "cards" && (
        <div className="flex w-[96px] flex-none flex-col gap-2">
          <FrameCard
            framed
            framedTitle={`第 ${segIndex + 1} 段`}
            firstFrame={nextStartFrame(editor.startFrame)}
            lastFrame={null}
            originNote={
              editor.startFrame ? "已用你上传的图" : prev?.lastFrame ? "承接上一段尾帧" : "AI 将自拟开头帧"
            }
            canEdit={!editor.generating}
            uploaded={!!editor.startFrame}
            onPickFile={(f) => void fileToFrameDataUrl(f).then((d) => useStudio.getState().setStartFrame(d))}
            onResetStart={() => useStudio.getState().setStartFrame(null)}
            onClearFrame={() => useStudio.getState().setStartFrame(null)}
            pinned={{ first: !!editor.startFrame }}
          />
        </div>
        )}

        {/* 右：素材 / 视频要求（撑满剩余空间）/ 时长一行 */}
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">

          {/* 自定义车道：与画布 ✍ 自定义**同一份 markup**（CustomFrameSlots）——
              首/尾帧两格 + 融图 + 清帧，规则全在那一份里，工坊不抄第二份。
              上面还挂一条示例视频状态行：第①页挂过就在这儿显示并能回去调帧 */}
          {lane === "custom" && (
            <>
              {editor.refVideo && (
                <div className="flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/5 px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-sky-200">
                    🎬 示例视频 {editor.refVideo.durationSec.toFixed(1)}s
                    {editor.refVideo.mids.length > 0 ? ` · 中间帧 ${editor.refVideo.mids.length}/${CUSTOM_MID_MAX}` : ""}
                  </span>
                  <button onClick={() => setRefSheet(true)} className="flex-none text-[10px] text-sky-300">
                    调帧
                  </button>
                  <button
                    onClick={() => useStudio.getState().setEditorRefVideo(null)}
                    className="flex-none text-[10px] text-slate-500"
                  >
                    摘掉
                  </button>
                </div>
              )}
              {/* ★ 收窄居中：帧格是按**画幅**撑高的（9:16 下 flex-1 会让两格各占半屏宽 →
                  近 200px 高，把下面的要求框整个挤出可视区，实测）。限宽 176px 之后
                  两格约 84×150，够看清又留得下要求框 */}
              <div className="mx-auto w-full max-w-[176px]">
              <CustomFrameSlots
                first={editor.startFrame ?? ""}
                last={editor.endFrame ?? ""}
                aspectCssValue={aspectCss(editor.aspect)}
                canEdit={!editor.generating}
                firstEmptyNote={prev?.lastFrame ? "空 = 承接上一段真实尾帧" : "空 = AI 按提示词补画（计费）"}
                onFrame={(which, url) =>
                  which === "first"
                    ? useStudio.getState().setStartFrame(url || null)
                    : useStudio.getState().setEndFrame(url || null)
                }
                onFuse={setFuse}
                onError={(msg) => useStudio.getState().npcSay(msg)}
              />
              </div>
            </>
          )}

          {/* ★ 车道身份行 + 素材的形态按车道分（2026-08-30 主人实测点名"自定义和卡片进的
              小窗口是一样的"）：自选卡片 = 素材大格是主体；自定义 = 帧与要求是主体，
              素材折成一行（这条车道里卡只在"缺帧要 AI 补画"时当参考——layCustomNode
              照样把它们存进节点，不是摆设） */}
          {lane === "custom" && (
            <button
              onClick={() => setMatsOpen((v) => !v)}
              disabled={editor.generating}
              className="flex w-full items-center gap-2 rounded-lg border border-slate-700/70 bg-black/25 px-2.5 py-2 text-left"
            >
              <span className="flex-none text-xs">🃏</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">
                素材卡（选）{slotCards.length > 0 ? ` · 已选 ${slotCards.length} 张` : ""} —— 缺帧补画时当参考
              </span>
              <span className="flex-none text-[10px] text-slate-500">{matsOpen ? "收起" : "展开"}</span>
            </button>
          )}
          {(lane !== "custom" || matsOpen) && (
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
          )}

          {/* ③ 视频要求：flex-1 吃掉全部剩余空白 */}
          <div className="flex min-h-[72px] flex-1 flex-col">
            <div className="mb-1 text-xs font-semibold text-slate-300">
              {lane === "custom" ? "视频要求（缺的帧按这句补画，也是出片提示词）" : "视频要求（剧情补充）"}
            </div>
            <textarea
              value={editor.requirement}
              onChange={(e) => useStudio.getState().setRequirement(e.target.value)}
              maxLength={300}
              placeholder="例：主角在雨里发现了那封信的真正收件人……"
              className="min-h-0 w-full flex-1 resize-none rounded-lg border border-slate-600 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400"
            />
          </div>

        </div>
      </div>
      )}

      <div className="border-t border-cyan-400/20 px-3 pb-3 pt-2">
        {/* 三步各自的脚：①没有脚（✕ 随时整块关掉）；②只有「上一步/下一步」——真花钱的键
            不在这一屏；③报价 + 那颗键（价钱贴在最后要按的键旁，ui-copy-grammar 文法②）。
            推演一次 = 1 次豆包写剧情 + 最多 6 张 Seedream 首尾帧；自定义铺方案免费，
            出片仍在方案台按原价（layCustomNode 与 generateSegment 的报价一行没改） */}
        {step === "content" ? (
          <div className="flex gap-2">
            <button
              onClick={() => setStep(lane === "custom" ? "ref" : "mode")}
              disabled={editor.generating}
              className="rounded-xl bg-slate-700/70 px-4 py-2 text-sm text-slate-200 disabled:opacity-40"
            >
              {lane === "custom" ? "‹ 示例视频" : "‹ 模式"}
            </button>
            <button
              onClick={() => setStep("spec")}
              disabled={editor.generating}
              className="flex-1 rounded-xl bg-brand/90 py-2 text-sm font-bold text-ink disabled:opacity-60"
            >
              下一步：定规格 ›
            </button>
          </div>
        ) : step === "spec" ? (
          <>
            {lane === "custom" && editor.refVideo && !tierOf(editor.videoTier).refVid && (
              <p className="mb-1.5 text-center text-[10px] leading-relaxed text-amber-300">
                ⚠「{tierOf(editor.videoTier).label}」档带不了参考视频——选「电影级」，否则出片会被整句拒
              </p>
            )}
            {lane === "cards" ? (
              (() => {
                // ★ 与真扣共用同一份开头帧判定（studioStore.nextStartFrame）——这里自己
                //   `!!editor.startFrame` 算一遍的话，从第 2 段起会按 6 张图报价而实际只画 3 张，
                //   而减半的说明也因为同一个错条件不显示（2026-08-31 修）
                const sf = nextStartFrame(editor.startFrame);
                return (
                  <TokenCost
                    tokens={proposalsCost(!!sf)}
                    note={sf ? "承接上段尾帧，三个方案共用开头帧，只画尾帧" : undefined}
                    className="mb-2"
                  />
                );
              })()
            ) : (
              <p className="mb-2 text-center text-[10px] text-slate-500">铺方案免费 · 出片时在方案台按原价结算</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setStep("content")}
                disabled={editor.generating}
                className="rounded-xl bg-slate-700/70 px-4 py-2 text-sm text-slate-200 disabled:opacity-40"
              >
                ‹ 上一步
              </button>
              {lane === "cards" ? (
                <button
                  onClick={() => void useStudio.getState().generateNode()}
                  disabled={editor.generating}
                  className="flex-1 rounded-xl bg-brand/90 py-2 text-sm font-bold text-ink disabled:opacity-60"
                >
                  {editor.generating ? editor.progress || "AI 正在推演三种走向…" : "🎲 推演三套方案"}
                </button>
              ) : (
                <button
                  onClick={() => useStudio.getState().layCustomNode()}
                  disabled={editor.generating || !editor.requirement.trim()}
                  title={!editor.requirement.trim() ? "先写一句视频要求（缺的帧按它补画）" : undefined}
                  className="flex-1 rounded-xl bg-slate-200/90 py-2 text-sm font-bold text-ink disabled:opacity-40"
                >
                  ✍ 铺成方案（免费）
                </button>
              )}
            </div>
            {lane === "custom" && !editor.requirement.trim() && (
              <p className="mt-1 text-center text-[9px] text-slate-600">回上一步写一句视频要求，这颗键才亮</p>
            )}
          </>
        ) : null}
      </div>
      {refSheet && editor.refVideo && (
        <RefFrameSheet
          videoUrl={editor.refVideo.localUrl ?? editor.refVideo.url}
          remote={!editor.refVideo.localUrl}
          midCount={editor.refVideo.mids.length}
          midMax={CUSTOM_MID_MAX}
          onFirst={(d) => useStudio.getState().setStartFrame(d)}
          onLast={(d) => useStudio.getState().setEndFrame(d)}
          onAddMid={(d) => useStudio.getState().addEditorMid(d)}
          onClose={() => setRefSheet(false)}
        />
      )}
      {/* 就地选模板（与画布同一份弹层，portal 到 body）。选定 → layTemplateNode 落节点并
          切去方案台投影（本面板整个换掉，tplPick 随之卸载）；落不上时弹层不关——
          它自带 flow.err 那一行，拒绝原因就写在脸上（铁律八）。
          「不用模板」那行在"还没有节点"这个语境下就是取消。 */}
      {fuse && (
        <FuseFrameSheet
          which={fuse}
          sources={fuseSourcesOf({
            materials: slotCards,
            carryFrame: prev?.lastFrame ?? null,
            firstFrame: editor.startFrame ?? undefined,
            lastFrame: editor.endFrame ?? undefined,
          })}
          aspect={editor.aspect}
          onDone={(url) => {
            if (fuse === "first") useStudio.getState().setStartFrame(url);
            else useStudio.getState().setEndFrame(url);
            setFuse(null);
          }}
          onClose={() => setFuse(null)}
        />
      )}
      {tplPick && (
        <TemplatePicker
          onPick={(t) => {
            if (!t) {
              setTplPick(false);
              return;
            }
            useStudio.getState().layTemplateNode(t);
          }}
          onClose={() => setTplPick(false)}
        />
      )}
    </>
  );
}

// ── 方案台投影：三套走向，一行一套 ────────────────────────────
function ProposalsPanel() {
  const focus = useStudio((s) => s.focus);
  // 单一真相：方案台直接订阅流水线（studio → flow 是允许的方向）
  const path = useFlow((s) => s.nodes);
  const frameRefining = useStudio((s) => s.frameRefining);
  const proposalRegen = useStudio((s) => s.proposalRegen);
  const nodeGen = useStudio((s) => s.nodeGen);
  const node = focus?.nodeId ? path.find((n) => n.id === focus.nodeId) : null;
  /** 成片回看层（与画布共用 SegPlayer：回看 + ⭕圈选改画面走同一条 addAnn → genNode 路）。
   *  ★ hook 必须在下面那个早退**之前**：聚焦的节点可以在面板挂着时消失（删段/整表换掉），
   *    那一拍早退会让 React 数出"更少的 hook"直接整页崩（实测踩到才补的） */
  const [playing, setPlaying] = useState(false);
  /** 档位那一排开着没有（顶栏那枚芯片） */
  const [tierOpen, setTierOpen] = useState(false);
  if (!node) return null;
  const idx = path.findIndex((n) => n.id === node.id);
  const prev = idx > 0 ? chosenProposal(path[idx - 1]) : null;
  const chosen = chosenProposal(node);
  const pickedId = chosen?.id ?? null;
  const done = proposalDone(chosen);
  // 承接判定：本段的设定首帧就是上一段的设定尾帧（AI 顺接铸出来的）→ 这张开头帧不是本段
  // 自己画的，AI 重画方案时不该动它
  const carried = !!(prev?.lastFrame && chosen?.firstFrame === prev.lastFrame);
  const busy = !!nodeGen || !!frameRefining || !!proposalRegen;
  /** 白模段（r2v 复刻）**没有方案台这一拍**（FlowPage 那句 ★：推演三套走向无从谈起）——
   *  它要的是画布模板车道那套：换/摘模板、挂卡点名、开炼。此前工坊对模板段也摆 PlanBoard
   *  （重推/换帧对 r2v 全是死路），2026-08-30 就地选模板落进来后换成专属面板 */
  const tpl = tplOfNode(node);
  const blockout = !!tpl?.refVideo;
  /**
   * 自选卡片车道**还没推演过三套**（2026-08-30 主人点名）：这一格摆的是一套占位方案，
   * 此时该给的是「🎲 生成三套方案」，不是「⚡ 生成本段视频」——直接出片等于拿一张
   * 没推演过的空方案去烧钱；而「♻ 重新推演三套」在这一刻也不该出现（还没有
   * “三套”可重）。自定义/白模车道天生就是一套，不适用。
   */
  const notDerived =
    !node.custom &&
    !blockout &&
    node.proposals.length < 2 &&
    // ★★ 「只有一套方案」**不等于**「还没推演过」（2026-08-30 复核抓到）：做同款铺进来的段、
    //   已经出过片的段、老草稿里的段都可能只有一套，而且里面是真内容。按张数判会把它们的
    //   **出片入口整个换掉** —— 用户只剩一颗"再花 40~80k 推演"的按钮，那是唯一出路。
    //   判据收紧成"这一套是空白占位"：没剧情、没帧、没出片，那才是真的什么都还没有。
    !proposalDone(chosen) &&
    !chosen?.plot.trim() &&
    !chosen?.firstFrame &&
    !chosen?.lastFrame &&
    // ★ 真人档没有方案台这一拍（deriveIssue 一处判定）——给它摆「生成三套方案」等于
    //   把唯一的主按钮换成一条必被拒的路（store 那边现在会整句拒，但更不该摆出来）
    !deriveIssue(node.videoTier);

  // ‹› 切换聚焦节点：桌面窗口随焦点实时平移（computeChain 焦点跟随），镜头跟到新卡位
  function go(dir: 1 | -1) {
    const st = useStudio.getState();
    const target = path[idx + dir];
    if (!target) return;
    const nx = computeChain(useFlow.getState().nodes, target.id).items.find((it) => it.node.id === target.id)?.x;
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
          第 {idx + 1}/{path.length} 段 · {pickedId ? (done ? "已出片" : "已选定走向") : "选择走向"}
        </h3>
        <button
          onClick={() => go(1)}
          disabled={idx >= path.length - 1}
          aria-label="下一段"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-slate-700/60 text-slate-200 disabled:opacity-25"
        >
          ›
        </button>
        {/* 档位芯片（2026-08-30 主人点名"把切换档位放入节点卡的角落"）：
            换档不只是换价 —— 1.0 两档收不了参考图，出片方式与这一段能做的事都会变，
            所以点开的是**共用的那一排**（TierRow），代价由它在换之前说清楚 */}
        <button
          onClick={() => setTierOpen((v) => !v)}
          title="这一段的画质档"
          className={`flex-none rounded-full px-2 py-1 text-[10px] ${
            tierOpen ? "bg-cyan-400/20 text-cyan-100" : "bg-slate-700/60 text-slate-300"
          }`}
        >
          {tierOf(node.videoTier).label}
        </button>
        <button onClick={() => useStudio.getState().closeProjection()} className="flex-none text-slate-400 hover:text-white">
          ✕
        </button>
      </div>
      {tierOpen && (
        <div className="flex-none border-b border-cyan-400/15 px-3 py-2">
          {/* key 认 node.id：换段时整块重挂，档位卡上的待确认状态不会跨段残留 */}
          {/* needsDerive：工坊这一面的主路是「推演三套」，走不了推演的档一并禁掉 */}
          <TierRow key={node.id} nodeId={node.id} needsDerive onDone={() => setTierOpen(false)} />
          {/* ★ 宿主要印自己那两类「为什么点不动」（套餐门槛那类归 TierRow）：
              白模段上不支持 r2v 的档、真人卡与本段不搭 —— 工坊这面此前一个字都没印，
              用户只看到一排灰按钮（CLAUDE.md「永远点不动的选项」） */}
          <TierBlockNote node={node} />
        </div>
      )}
      {/* 重推三套的进度：真实 AI 下一分钟出头（1 次豆包 + 最多 6 张 Seedream）。
          它占的是 nodeGen，但没有对应的方案 id，所以进度条挂在整个方案台上方而不是某一行 */}
      {nodeGen?.proposalId === rederiveKey(node.id) && (
        <GenTrace steps={nodeGen.steps} running className="mx-3 mt-2 rounded-lg bg-black/25 px-2 py-1.5" />
      )}

      {/* 方案台：与工作流页共用同一个组件（铁律六）。工坊这边的"未选定"天然就是
          chosenId === null——不需要另一套标记。白模段没有方案台（上面那段 ★）——走专属面板 */}
      {blockout && chosen ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TplSegBody node={node} proposal={chosen} onPlay={() => setPlaying(true)} />
        </div>
      ) : (
      <div className="min-h-0 flex-1">
        <PlanBoard
          dense
          proposals={node.proposals}
          pickedId={pickedId}
          isDone={proposalDone}
          busy={busy}
          regenId={proposalRegen}
          onPick={(id) => useStudio.getState().chooseProposal(node.id, id)}
          onPatch={(id, patch) => useStudio.getState().patchProposal(node.id, id, patch)}
          onFrame={(id, which, dataUrl) => useStudio.getState().setProposalFrame(node.id, id, which, dataUrl)}
          onRegen={(id) => void useStudio.getState().regenProposal(node.id, id)}
          regenCost={(p) => proposalRedrawCostOf(p, prev)}
          onRederive={notDerived ? undefined : () => void useStudio.getState().regenNodeProposals(node.id)}
          rederiveCost={proposalsCost(!!prev?.lastFrame)}
          carriedFrom={carried}
          // 预览卡的框跟本段画幅走：写死一个比例，另一种画幅的帧会被裁掉一大半
          frameAspect={aspectCss(node.aspect)}
          // 融图候选（唯一实现在 FuseFrameSheet.fuseSourcesOf，三条路共用）
          fuseSources={fuseSourcesOf({
            materials: node.materials,
            carryFrame: carried ? prev?.lastFrame : null,
            firstFrame: chosen?.firstFrame,
            lastFrame: chosen?.lastFrame,
          })}
          fuseAspect={node.aspect}
          switchWarn={(p) =>
            pickedId != null && pickedId !== p.id && idx < path.length - 1
              ? "⚠ 换成这一套，现在这套走向后面的段会整段收起（切回可恢复）"
              : null
          }
          actions={(p) => (
            <PickedActions
              node={node}
              proposal={p}
              onPlay={() => setPlaying(true)}
              notDerived={notDerived}
              /* ★ 与真扣同一个输入：regenNodeProposals 按**上一段的尾帧**算（三套共用开头帧
                 时只画尾帧、图量减半）。此前这里传的是本段方案的首帧，第 1 段少报一半 */
              deriveCost={proposalsCost(!!prev?.lastFrame)}
            />
          )}
        />
      </div>
      )}
      {/* 圈选标注条（与画布同一份 AnnStrip）：重炼时逐处改画面，改图费已并进重炼报价（nodeCost） */}
      {node.anns.length > 0 && (
        <div className="flex-none px-3 pb-1">
          <AnnStrip anns={node.anns} onRemove={(annId) => useFlow.getState().removeAnn(node.id, annId)} />
        </div>
      )}
      {playing && <SegPlayer nodeId={node.id} onClose={() => setPlaying(false)} onOpenPanel={() => setPlaying(false)} />}
      <div className="flex-none border-t border-cyan-400/15 px-3 py-1.5 text-center text-[10px] leading-4 text-slate-500">
        {blockout
          ? done
            ? "本段已出片 · 白模复刻段只有一段——点亮法阵去组稿成片"
            : "画面与运镜整个来自模板视频——写好那句话（或挂完卡）就能开炼"
          : !pickedId
            ? "挑一套 → 可换首尾帧/改剧情 → 炼出本段视频，桌面上才会亮出下一段的卡位"
            : done
              ? "本段已出片 · 桌面上下一段的虚线卡位已亮起"
              : "炼出本段视频才能开下一段（段与段靠上一段的真实尾帧承接起拍）"}
      </div>
    </>
  );
}



/**
 * 「这一段为什么有几档点不动」的宿主侧提示（工坊面）。
 *
 * ★ 分工与本段设置抽屉一致：**套餐门槛那一类归 TierRow**（它拥有那排按钮，还带「去升级」），
 *   这里只印宿主才知道的两条 —— 白模段上不支持 r2v 的档、真人卡与本段不搭。
 *   工坊此前一条都没印，用户只看到一排灰按钮（CLAUDE.md「界面上摆一个永远点不动的选项」）。
 */
function TierBlockNote({ node }: { node: FlowNode }) {
  const blockout = !!tplOfNode(node)?.refVideo;
  const r2vBlocks = blockout
    ? VIDEO_TIERS.map((t) => r2vPriceIssue(t.id)).filter((r): r is string => !!r)
    : [];
  const realFaceBlock = realFaceIssue(node.materials, node.videoTier, { blockout });
  const all = [...r2vBlocks, ...(realFaceBlock ? [realFaceBlock] : [])];
  if (all.length === 0) return null;
  return <p className="mt-1 text-[10px] leading-4 text-amber-300/80">{all.join("；")}</p>;
}

/**
 * 白模段（r2v）的工坊面板：换/摘模板 + 挂卡点名 + 点名句 + 开炼 —— 画布模板车道的
 * 工坊面（2026-08-30 就地选模板落进来后补上；此前模板段在工坊被摆成 PlanBoard，
 * 重推/换帧对 r2v 全是死路）。
 *
 * ★ 规则一条不自己判：换/摘 = flowStore.setNodeTemplate；挂卡入参 = FlowPage.castEditorState
 *   （returnTo:"/studio"，回程收口两页共用 hooks/useCastReturn）；点名句 = updateProposal；
 *   开炼报价 = PickedActions 里的 nodeCost。本组件只是把画布那一面的话搬到投影里。
 * ★ castErr/castFallback/castBusy 这仨认 castNodeId 不认 cursor（CLAUDE.md 那条：
 *   全局状态记「属于哪一段」）；工坊此前一处都没画它们——模板段进了工坊，就得有人画。
 * ★ 自带一份 flow.err：工坊页没有画布壳那条错误条，setNodeTemplate/挂卡回程的整句拒
 *   不在这儿画就是"点了没反应"（铁律八，PlanSheet/TemplatePicker 同款）。
 */
function TplSegBody({ node, proposal, onPlay }: { node: FlowNode; proposal: Proposal; onPlay: () => void }) {
  const navigate = useNavigate();
  const tpl = tplOfNode(node)!;
  const named = !!tpl.roles?.length;
  const done = proposalDone(proposal);
  const generating = node.status === "generating";
  const err = useFlow((s) => s.err);
  const castErr = useFlow((s) => s.castErr);
  const castFallback = useFlow((s) => s.castFallback);
  const castBusy = useFlow((s) => s.castBusy);
  const castOfThisNode = useFlow((s) => s.castNodeId === node.id);
  // ★ 本段就是光标段时读**实时缓冲**（刚挂完还没回写 node.cast）；不是时读本段落盘那份
  //   —— 否则「已挂 N/M」印的是别段的数（画布那条 ★ 的同款）
  const cast = useFlow((s) => (s.nodes[s.cursor]?.id === node.id ? s.cast : (node.cast ?? {})));
  const mounted = named ? (tpl.roles ?? []).filter((r) => cast[r.label]).length : 0;
  const [picker, setPicker] = useState(false);
  const [castAsk, setCastAsk] = useState(false);

  /** 去挂卡：先把光标真挪到本段（cast 缓冲跟光标走），挪不过去就整句拒（画布 goCast 同款） */
  function goCast() {
    const flow = useFlow.getState();
    const i = flow.nodes.findIndex((n) => n.id === node.id);
    flow.setCursor(i);
    if (useFlow.getState().cursor !== i) {
      useFlow.setState({ err: `第 ${i + 1} 段还没轮到（前面的段先炼完才解锁），挂不了卡` });
      return;
    }
    const st = castEditorState(tplOfNode(useFlow.getState().nodes[i])!, useFlow.getState().cast, "/studio");
    if (st) navigate("/video-editor", { state: st });
  }

  return (
    <div className="space-y-2">
      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-rose-200">{err}</p>
          <button onClick={() => useFlow.setState({ err: "" })} className="flex-none text-rose-300">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {/* 模板行：换/摘的规则都在 store 的 setNodeTemplate（已出片会被整句拒，err 在上面那行） */}
      <div className="flex items-center gap-2 rounded-lg border border-slate-700/70 bg-black/25 px-2.5 py-2">
        <span className="flex-none text-xs">🧪</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-slate-100">{tpl.title}</span>
          <span className="block text-[10px] text-slate-500">
            {tpl.refVideo!.durationSec}s 白模复刻{named ? ` · ${tpl.roles!.length} 个角色位` : ""}
          </span>
        </span>
        <button
          onClick={() => setPicker(true)}
          disabled={generating || done}
          className="flex-none rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
        >
          换模板
        </button>
      </div>
      {done && <p className="text-[10px] leading-relaxed text-slate-500">已出片：换模板会作废本段（想换先删段重加）</p>}

      {/* 挂卡（白模点名路）。覆盖确认与画布/线性视图同一句话、同一个理由 */}
      {named && !done && (
        <>
          <button
            onClick={() => (proposal.plot.trim() ? setCastAsk(true) : goCast())}
            disabled={generating}
            className="flex w-full items-center gap-2 rounded-lg border border-brand/50 bg-black/25 px-2.5 py-2 text-left text-xs text-slate-100 disabled:opacity-40"
          >
            <span className="flex-none">🎭</span>
            <span className="min-w-0 flex-1 truncate">
              {mounted > 0 ? `已挂 ${mounted}/${tpl.roles!.length} 个角色位 · 点这里改` : `给 ${tpl.roles!.length} 个人偶挂上你的角色卡`}
            </span>
            <Icon name="chevron" size={12} className="flex-none text-slate-400" />
          </button>
          {castAsk && (
            <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
              <p className="text-[11px] leading-relaxed text-amber-200">
                改完挂卡会按新的映射<b>重新合成</b>下面那段要求，你改过的字会被替换掉。
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setCastAsk(false);
                    goCast();
                  }}
                  className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-ink"
                >
                  知道了，去改挂卡
                </button>
                <button onClick={() => setCastAsk(false)} className="rounded-full border border-slate-600 px-2.5 py-1 text-[11px] text-slate-300">
                  先不改
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 挂卡合成失败的出口（画布那条 ★★ 的工坊版）：castErr 写的不是 err，这儿不画就没人画 */}
      {castErr && castOfThisNode && (
        <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
          <p className="text-[11px] leading-relaxed text-amber-200">{castErr}</p>
          {castFallback && (
            <button
              onClick={() => useFlow.getState().fillCastFallback()}
              className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-ink"
            >
              填入默认写法（填完还能改）
            </button>
          )}
        </div>
      )}

      {/* 点名句 / 一句话：named 直接编辑 plot（挂卡合成写的就是它）；V1 写一句换谁。
          castBusy 期间禁编辑：合成结果几秒后会整段覆盖，这几秒打的字会凭空消失 */}
      <textarea
        value={proposal.plot}
        onChange={(e) => useFlow.getState().updateProposal(node.id, { plot: e.target.value })}
        maxLength={VIDEO_PROMPT_MAX}
        disabled={generating || (castBusy && castOfThisNode)}
        placeholder={
          named
            ? castBusy && castOfThisNode
              ? "正在把「人偶 → 角色」合成一段话…"
              : "先去挂卡，点名句会填进这里（可改）"
            : "写一句换成谁，例：换成一只戴墨镜的柴犬"
        }
        className="h-24 w-full resize-none rounded-lg border border-slate-600 bg-black/30 px-2.5 py-2 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400 disabled:opacity-50"
      />

      <PickedActions node={node} proposal={proposal} onPlay={onPlay} />

      {picker && (
        <TemplatePicker
          current={tpl.id}
          onPick={(t) => {
            if (useFlow.getState().setNodeTemplate(node.id, t)) setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
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
function PickedActions({
  node,
  proposal,
  onPlay,
  notDerived,
  deriveCost,
}: {
  node: FlowNode;
  proposal: Proposal;
  onPlay: () => void;
  /** 自选卡片车道还没推演过三套：主按钮改成「生成三套方案」（见 ProposalsPanel 的 ★） */
  notDerived?: boolean;
  /** 推演三套的报价 —— 由 ProposalsPanel 用**与真扣同一个输入**算好传进来（铁律六） */
  deriveCost?: number;
}) {
  const navigate = useNavigate();
  const nodeGen = useStudio((s) => s.nodeGen);
  const frameRefining = useStudio((s) => s.frameRefining);
  const proposalRegen = useStudio((s) => s.proposalRegen);
  const [refine, setRefine] = useState<"first" | "last" | null>(null);
  const [refineReq, setRefineReq] = useState("");
  const mine = nodeGen?.proposalId === proposal.id;
  const busy = !!nodeGen || !!frameRefining || !!proposalRegen;
  const done = proposalDone(proposal);
  // ★ 报价与真扣同一把尺：genNodeVideo 已委托 flowStore.genNode（扣 nodeCost），按钮上的数
  //   必须也是 nodeCost —— 圈选改图费、承接省一张帧、素材参考模式它都算得对，另拼一份必分叉
  const flowNow = useFlow.getState();
  const nodeIdx = flowNow.nodes.findIndex((n) => n.id === node.id);
  const cost = nodeCost(flowNow.nodes, nodeIdx, flowNow.mode);
  /** 白模段（r2v）：改帧/圈选整条不通（画面来自模板视频，segmentGen 的 blockoutIssue
   *  整句拒）——按钮摆出来就是死路（铁律五）。回看照常给（SegPlayer 自己会藏圈选键） */
  const blockout = !!tplOfNode(node)?.refVideo;

  return (
    <div className="space-y-1.5 border-t border-slate-700/60 pt-1.5">
      {/* AI 改图：图生图按一句要求重画某一帧（保画风）。与"上传本地图"是两条不同的路——
          一条是"让 AI 改成这样"，一条是"就用我这张" */}
      {!blockout && (
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
      )}
      {!blockout && refine && (
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
      {/* 进度画在节点自己身上（单一真相：flowStore.genNode 写 node.steps） */}
      {(mine || node.status === "generating") && (
        <GenTrace steps={node.steps ?? []} running className="rounded-lg bg-black/25 px-2 py-1.5" />
      )}
      <div className="flex gap-1.5">
        {notDerived ? (
          /* 还没推演三套：这一格的主按钮是「生成三套方案」（报价与真扣同一处 proposalsCost） */
          <button
            onClick={() => void useStudio.getState().regenNodeProposals(node.id)}
            disabled={busy}
            className="flex-1 rounded-lg bg-brand/90 py-2 text-xs font-bold text-ink disabled:opacity-40"
          >
            {busy ? "推演中…" : `🎲 生成三套方案（${fmtTokens(deriveCost ?? 0)}）`}
          </button>
        ) : (
        <button
          onClick={() => void useStudio.getState().genNodeVideo(node.id, proposal.id)}
          disabled={busy || !proposal.plot.trim()}
          className="flex-1 rounded-lg bg-brand/90 py-2 text-xs font-bold text-ink disabled:opacity-40"
        >
          {mine
            ? "炼制中…"
            : done
              ? `♻ 重炼本段（${node.anns.length ? `含 ${node.anns.length} 处圈选改图 · ` : ""}${fmtTokens(cost)}）`
              : `⚡ 生成本段视频（${fmtTokens(cost)}）`}
        </button>
        )}
        {done && (
          <button
            onClick={onPlay}
            disabled={busy}
            title={blockout ? "回看成片" : "回看成片 · 在画面上圈出要改的地方"}
            className="flex-none rounded-lg border border-slate-500/60 bg-slate-700/50 px-2.5 py-2 text-xs font-semibold text-slate-100 disabled:opacity-40"
          >
            {blockout ? "▶ 回看" : "▶ 圈选"}
          </button>
        )}
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
