// 工作流页：一屏一个节点卡，横向切节点。
//
// 这就是工坊的节点卡，只是脱掉了 3D 桌面：一个节点持有若干走向方案，横向切节点。
//
// ★ 一段的推进是**三拍**（见 flowStore 的 FlowNode.plan）：
//     写要求 →「生成本段」先推演三套方案（方案台，各带首尾帧预览卡）→ 挑一套（可换帧、
//     改剧情、让 AI 按修改重画）→「生成本段」才真去炼视频。
//   所以中间那块大屏幕在不同时刻是三种东西：方案台 / 起拍画面 / 成片播放器。
//   出片浮层（ForgeOverlay）只在第三拍开——推演也会把 status 置成 generating，跟着它走
//   会让"挑方案"这一步莫名其妙弹出炼卡动画。
//
// 三种入口共用本页：
//   工坊模式 → startFlow() 把活动路径整卡搬进来（含全部走向、素材卡、档位，且每段都已出片）
//   工作流模式 → seedSolo("workflow")，方案台是主路径
//   简约模式 → seedSolo("simple")，单节点单走向、不推演方案、**不存草稿**，UI 收到最简
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import FlowCanvas from "../components/flow/FlowCanvas";
import ForgeOverlay, { type ForgePhase } from "../components/ForgeOverlay";
import FrameAnnotator, { drawCover } from "../components/FrameAnnotator";
import GenTrace from "../components/GenTrace";
import Icon from "../components/Icon";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import { MaterialButtonArt } from "../components/MascotStage";
import MaterialSheet, { MaterialStrip } from "../components/MaterialSheet";
import VideoTemplateExtractor from "../components/VideoTemplateExtractor";
// ★ VIDEO_PROMPT_MAX 取自 ai 层（提示词硬顶的唯一出处）：白模 V2 的输入框里装的是
//   真正发出去的那段话，在这里另抄一个 400 出来，改上限时这里就开始说假话
import { AI_REAL, VIDEO_PROMPT_MAX } from "../ai";
import { tierBlockReason, walletOf } from "../data/account";
import { markNoun, markSpecOf, myTemplates, splitCastRoles } from "../data/templates";
import { VIDEO_TIERS, clampDuration, fmtTokens, modelLabel, proposalsCost, r2vPriceIssue, tierOf } from "../data/economy";
import {
  FlowNode,
  chosenOf,
  flowCost,
  frontierOf,
  nodeCost,
  nodeDone,
  nodeRefOn,
  nodeVideo,
  planOf,
  redrawCost,
  requirementOf,
  useFlow,
} from "../studio/flowStore";
import PlanBoard from "../studio/ui/PlanBoard";
import { deckQuoteOf, publishedExit, useStudio } from "../studio/studioStore";
import { VIDEO_ASPECTS, VideoTemplate, aspectCss, aspectOf, formatDuration } from "../types";
import { useMediaUrl } from "../utils/mediaUrl";
import { VIDEO_EDITOR_RESULT_KEY, type CastEditorState, type VideoEditorResult } from "./VideoEditorPage";

const DURATIONS = [3, 5, 6, 8, 10];
/** 触发换节点/换走向的滑动阈值（px）；低于它按点击处理 */
const SWIPE = 48;

/**
 * 进「挂卡」编辑页要带的入参 —— **全 app 唯一一处**（模板详情页与本页都从这里取）。
 * null = 这个模板没有角色位（V1 老白模 / 经典模板），本来就没有挂卡这一步。
 *
 * ★ 收口在这里而不是各页各拼一份：入参形状与 `returnTo` 是**跨页约定**
 *   （形状见 VideoEditorPage 顶部注释），写错一个字母的表现是"进去了、回来了、
 *   什么都没发生"——不报错、也不白屏，最难查的那种。
 * ★ 返回值标成 `CastEditorState`，让编译器替我们盯住这份约定：那一页改了字段名，
 *   这里当场编译不过，而不是等到真机上"挂完卡回来输入框还是空的"。
 * ★ `returnTo` 恒为 `/flow`：收结果、把点名句填进输入框、之后出片，全在这一页
 *   （store 侧是 flowStore.applyCast）。
 */
export function castEditorState(
  t: Pick<VideoTemplate, "id" | "title" | "refVideo" | "roles" | "markSlots" | "markBoxes" | "markBoxAtSec">,
  value: Record<string, string> = {},
): CastEditorState | null {
  // 判定一律写存在性（types.ts 的 ★）：老模板天然缺这两样，天然不走挂卡
  if (!t.refVideo?.url || !t.roles?.length) return null;
  return {
    mode: "cast",
    videoUrl: t.refVideo.url,
    roles: t.roles,
    // ★★ 方案位必须跟着一起过去：挂卡面板的徽章、引导句、"没挂的会怎样"那几句全按它分支。
    //   漏在这里没有任何报错 —— 只表现为序数模板的挂卡页按编号说话（用户对着一群一模一样
    //   的白人偶找数字，找不到只会以为坏了）。判据只有 data 层一处（markSpecOf）。
    spec: markSpecOf(t),
    // 画面位置框：有才带（拖拽层的存在性开关）
    ...(t.markBoxes?.length ? { boxes: t.markBoxes } : {}),
    ...(t.markBoxes?.length && t.markBoxAtSec !== undefined ? { boxAtSec: t.markBoxAtSec } : {}),
    value,
    templateId: t.id,
    title: t.title,
    returnTo: "/flow",
  };
}

/** 套模板后的"一句话"输入：配方负责像不像，用户只负责换谁来演。
 *  下面把填好的分镜实时显示出来——让用户看得见这句话到底变成了什么，
 *  而不是把提示词藏起来当黑箱（黑箱一旦出片不对，用户无从下手）。 */
function TemplateSubjectBox() {
  const { template, subject, setSubject, nodes, cursor } = useFlow();
  const [open, setOpen] = useState(false);
  if (!template) return null;
  const plot = nodes[Math.min(cursor, nodes.length - 1)]?.proposals.find((p) => p.id === nodes[cursor]?.chosenId)?.plot ?? "";
  return (
    <div className="space-y-1.5">
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={60}
        placeholder="一句话：换成谁来演？例：一只戴墨镜的柴犬"
        className="w-full rounded-lg border border-brand/50 bg-panel px-2.5 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
      />
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 text-[10px] text-slate-500">
        <Icon name="chevron" size={10} className={open ? "rotate-90" : ""} />
        {open ? "收起" : "看看这句话变成了什么"}
      </button>
      {open && (
        <p className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/30 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-400">
          {plot || "先写那句话"}
        </p>
      )}
    </div>
  );
}

/**
 * 白模 **V2**（模板带角色位）套用时的本段内容区 —— 取代经典模板那个「一句话」输入框。
 *
 * ★★ 为什么这条路不能用 TemplateSubjectBox：那个框每敲一个字都走 `setSubject`，
 *   而 setSubject 会拿配方骨架**整段重写 plot**。V2 的 plot 里装的是挂卡合成出来的
 *   点名映射（「编号 4 的白色人偶替换为角色「张三」」）—— 被重写掉就退回泛指，
 *   而泛指实测会漏人（F4：只换配角、主角不动），表现是画面照出、钱照收、零报错。
 *   （store 侧 setSubject 对 V2 也已经不回填 plot，那是第二道闸；这里是第一道。）
 * ★★ 输入框里摆的就是**真正发给 AI 的那段话**（方案 B2「以输入框为准」）：这段话决定
 *   哪个编号换成谁，换错人只有作者肉眼能发现 —— 藏在代码里的话，他连"模型被告知了
 *   什么"都不知道。所以合成完直接填进来，随便改。
 */
function BlockoutCastBox({ node, onCast }: { node: FlowNode; onCast: () => void }) {
  const { template, cast, castErr, castFallback, castBusy, busy, updateProposal, setRequirement, fillCastFallback } =
    useFlow();
  // ★ 分母只数**能挂卡的**那些（上限 BLOCKOUT_MAX_ROLES，判定唯一实现在 data/templates）：
  //   数全部的话，一个 12 个角色位的模板会显示"已挂 9/12"，而第 10~12 个在挂卡面板上
  //   根本没有挂卡按钮 —— 用户会一直找那三个位子在哪
  const roles = splitCastRoles(template?.roles ?? []).castable;
  const prop = chosenOf(node);
  const mounted = roles.filter((r) => cast[r.label]).length;
  const [openReq, setOpenReq] = useState(false);
  // 这个模板的标记方案（判据只有 data 层一处）。★ 名词也只有一处：markNoun
  const spec = markSpecOf(template);
  const noun = markNoun(spec);
  return (
    <div className="space-y-1.5">
      <button
        onClick={onCast}
        disabled={busy}
        className="flex w-full items-center gap-2 rounded-lg border border-brand/50 bg-panel px-2.5 py-2 text-left text-xs text-slate-100 disabled:opacity-40"
      >
        <span className="flex-none">🎭</span>
        <span className="min-w-0 flex-1 truncate">
          {mounted > 0
            ? `已挂 ${mounted}/${roles.length} 个角色位 · 点这里改`
            : `给 ${roles.length} 个${spec.scheme === "ordinal" ? "白色" : "编号的"}人偶挂上你的角色卡`}
        </span>
        <Icon name="chevron" size={12} className="flex-none text-slate-400" />
      </button>

      {/* 作者补充的那句话：合成时揉进点名句里。★ 存在 node.requirement 上（"用户自己的话"，
          见 flowStore.FlowNode.requirement），与下面那段合成产物**分开**——合成一次就
          覆盖一次 plot，两者合成一格的话，用户补的那句话每挂一次卡就被自己的产物吃掉 */}
      <button onClick={() => setOpenReq(!openReq)} className="flex w-full items-center gap-1 text-[10px] text-slate-500">
        <Icon name="chevron" size={10} className={`flex-none ${openReq ? "rotate-90" : ""}`} />
        <span className="min-w-0 flex-1 truncate text-left">
          {openReq
            ? "收起补充要求"
            : node.requirement?.trim()
              ? `补充要求：${node.requirement.trim()}`
              : "加一句你自己的要求（可选，下次挂完卡合成时并进去）"}
        </span>
      </button>
      {openReq && (
        <input
          value={node.requirement ?? ""}
          onChange={(e) => setRequirement(node.id, e.target.value)}
          maxLength={60}
          placeholder="例：整体调成黄昏的暖色调"
          className="w-full rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
        />
      )}

      {/* 合成失败：整句原因 + 一颗「填入默认写法」。**绝不自动填空串**——空输入框与
          "还没写"长得一模一样，用户会以为随手写一句就够，出片时点名映射整个没发出去
          （blockoutPrompt 的 ★，铁律八）。骨架是确定性的那一份（第五章模板逐字实现），
          填进去照样可以改 */}
      {castErr && (
        <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
          <p className="text-[11px] leading-relaxed text-amber-200">{castErr}</p>
          {castFallback && (
            <button
              onClick={fillCastFallback}
              className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-ink"
            >
              填入默认写法（填完还能改）
            </button>
          )}
        </div>
      )}

      <textarea
        value={prop.plot}
        onChange={(e) => updateProposal(node.id, { plot: e.target.value })}
        rows={4}
        maxLength={VIDEO_PROMPT_MAX}
        disabled={castBusy}
        placeholder={
          castBusy ? `正在把「${noun} → 角色」合成一段话…` : "先去挂卡：合成好的点名要求会填在这里，你可以逐字改"
        }
        className="w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-60"
      />
      <p className="text-[10px] leading-4 text-slate-500">
        {castBusy
          ? "合成中…（一次对话，几秒）"
          : prop.plot.trim()
            ? `这就是真正发给 AI 的那段话：${noun}与角色名是机器生成的（改错就会换错人），其余随便改；改挂卡会按新映射重新合成、覆盖这里。`
            : `这一段的要求由挂卡合成：AI 会把「${noun} → 你挂的角色」写成一段话填在这里，出片前你能逐字过目和修改。`}
      </p>
    </div>
  );
}

/** 一屏一个节点：大屏幕（方案台/画面/成片）+ 本段要求 + 可调项 + 主按钮 */
function NodeScreen({
  node,
  index,
  total,
  matOpen,
  matShake,
  onToggleMat,
  focus,
  onFocus,
}: {
  node: FlowNode;
  index: number;
  total: number;
  /** 素材窗口开着（圆形按钮点亮） */
  matOpen: boolean;
  /** 每加一次素材 +1：拿它当 key 让抖动的 CSS 动画重播（同 CharacterPerch 的做法） */
  matShake: number;
  onToggleMat: () => void;
  /** 方案台专注态：本页除了左上角那枚返回箭头，其余 UI 全部收起（见 FlowPage.planFocus） */
  focus: boolean;
  /** 报告"方案台开没开"。★ boardOn 只有这里算得出（它要读 plan/done/showPlan），
   *  所以由这里报上去，FlowPage 不再算第二遍（铁律六） */
  onFocus: (on: boolean) => void;
}) {
  const {
    mode,
    nodes, // 档位选择器要问 nodeCost（整段报价），它需要整张表
    busy,
    err,
    updateNode,
    updateProposal,
    setRequirement,
    chooseProposal,
    shiftProposal,
    genNode,
    deriveProposals,
    regenProposal,
    setFrame,
    addAnn,
    removeAnn,
    shiftCursor,
    addNode,
  } = useFlow();
  const tpl = useFlow((s) => s.template);
  // 上一段的选定走向：决定本段能否承接真实结尾起拍（也决定推演报价——共用开头帧时图量减半）
  const prevProp = useFlow((s) => (index > 0 ? chosenOf(s.nodes[index - 1]) : null));
  const simple = mode === "simple";
  const prop = chosenOf(node);
  const video = nodeVideo(node);
  const done = nodeDone(node);
  const realVideo = video && !video.startsWith("mock:") ? video : undefined;
  const vsrc = useMediaUrl(realVideo, { forCapture: true });
  const vref = useRef<HTMLVideoElement>(null);
  const [annOpen, setAnnOpen] = useState<{ frame: string; atSec: number } | null>(null);
  const [sheet, setSheet] = useState(false); // 底部「本段设置」抽屉
  /** 出片浮层。只由「出片」这一拍开——推演方案也会把 status 置成 generating，
   *  跟着 status 走的话"挑方案"这一步会莫名其妙弹出炼卡动画 */
  const [forge, setForge] = useState<ForgePhase | null>(null);
  // 出片之后大屏幕默认放成片；想回去看/改方案就翻回方案台（改完可以重炼）
  const [showPlan, setShowPlan] = useState(false);
  const matCount = node.materials?.length ?? 0;

  // ── 白模 V2 的挂卡入口（结果由 FlowPage 收，见那边的 effect）──
  const nav = useNavigate();
  const cast = useFlow((s) => s.cast);
  /**
   * 「改挂卡会覆盖你在输入框里改过的字」的确认（false = 不用问）。
   *
   * ★★ 为什么是**覆盖**而不是保留：输入框里那段话写的是**旧的**挂卡映射
   *   （「编号 4 → 张三」），改完挂卡还留着它，出片就照旧映射换人 —— 比丢掉几行
   *   手写的字坏得多，而且零报错。所以不给"保留原文案"这个必然出错的选项，
   *   只在真有内容可丢时问一句（问都不问就覆盖，也是一种静默的数据丢失）。
   */
  const [castAsk, setCastAsk] = useState(false);
  function openCast() {
    setCastAsk(false);
    // 入参形状与回程约定收在 castEditorState 一处（本文件顶部）
    const st = tpl ? castEditorState(tpl, cast) : null;
    if (st) nav("/video-editor", { state: st });
  }
  const requestCast = () => (prop.plot.trim() ? setCastAsk(true) : openCast());

  // ── 方案台三态（见 flowStore.FlowNode.plan）──
  const plan = simple ? null : planOf(node);
  const picking = plan === "picking";
  const carried = !!(node.chain && prevProp?.lastFrame);
  // ★ 报价问 store 的 nodeCost，与真正扣钱的 genNode 同一处实现：它算的是"出片 +
  //   这一段还得补画几张设定帧"，而简约模式恰恰是两张帧都没有的那条路（铁律六）
  const cost = useFlow((s) => nodeCost(s.nodes, index, s.mode));
  const propCost = proposalsCost(carried);
  /**
   * 这一段会不会走「参考生视频」（卡片形象 + 一句话直出，不画设定帧）。
   * 与出片时的判定同一个函数 —— 界面说"直接用卡片形象"、实际却画了张设定帧，
   * 用户只会觉得卡片没生效。
   *
   * ★ 问 store 的 nodeRefOn 而不是自己拼一遍参数：**承接帧也算一票**（首尾帧与参考图
   *   互斥）。在这里漏传 carryFrame 的话，套模板的简约模式从第 2 段起就会写着
   *   "直接用卡片形象、不画设定帧"，实际却在承接上一段真实尾帧并按文字补画结束帧。
   */
  const refOn = useFlow((s) => nodeRefOn(s.nodes, index, s.mode));
  /** 本段走白模复刻（r2v）。判定与报价（nodeCost）同源：模板快照带 refVideo（存在性） */
  const blockout = !!tpl?.refVideo;
  /** 本段走白模**点名**路（V2：模板登记了角色位）。判据是存在性（`roles?.length`，
   *  types.ts 的 ★）——老白模模板天然缺它、天然走泛指老路，界面也照旧是「一句话」框 */
  const named = blockout && !!tpl?.roles?.length;
  /** 当前套餐点不动的档位各是为什么（空 = 都能选）。判断在 data/account 一处 */
  const tierBlocks = VIDEO_TIERS.map((t) => tierBlockReason(t)).filter((r): r is string => !!r);
  /** 白模节点下各档位点不动的 r2v 原因（判断在 economy.r2vPriceIssue 一处，铁律六）。
   *  几档的整句常常相同（"暂未开放"），Set 去重后再印，别把同一句话糊三遍 */
  const r2vBlocks = blockout
    ? [...new Set(VIDEO_TIERS.map((t) => r2vPriceIssue(t.id)).filter((r): r is string => !!r))]
    : [];
  const req = requirementOf(node);
  const generating = node.status === "generating";
  /** 主按钮这一下干什么：没方案台先推演，摊开着就重推，挑定了才真出片。
   *  **这是唯一的推进入口**——三套方案原来藏在「本段设置」抽屉的一枚小按钮后面，
   *  绝大多数用户没见过它，于是最贵的一步（出片）反而没有选择余地。 */
  // ★ 白模节点（blockout）恒直出：r2v 复刻没有方案台这一拍（画面整个来自模板视频，
  //   推演三套走向无从谈起）。2026-08-20 之前只有 `simple` 一票 —— 分段模板组走
  //   workflow 模式后，白模节点落进"先推演"档：按钮标着推演价（80.4k）、点下去
  //   真去推演三套方案，方案台对着一段 r2v 复刻完全没有意义，还多花一笔推演的钱。
  const stage: "derive" | "rederive" | "film" =
    simple || blockout || plan === "picked" ? "film" : picking ? "rederive" : "derive";
  const mainCost = stage === "film" ? cost : propCost;
  const mainDisabled =
    busy || generating || (stage === "film" ? !prop.plot.trim() : !req.trim() && !node.materials?.length);
  const mainLabel = generating
    ? node.progress || "生成中…"
    : stage === "rederive"
      ? `♻ 重新生成方案（${fmtTokens(propCost)}）`
      : stage === "derive"
        ? `⚡ 生成本段（${fmtTokens(propCost)}）`
        : done
          ? `♻ 重新生成（${fmtTokens(cost)}）`
          : `⚡ 生成本段（${fmtTokens(cost)}）`;

  async function onMain() {
    if (busy) return;
    if (stage !== "film") {
      // 推演不开炼卡浮层（见 forge 的注释）；方案台自己会显示"待挑方案"
      setShowPlan(false);
      void deriveProposals(node.id);
      return;
    }
    setForge("forging");
    const ok = await genNode(node.id);
    setForge(ok ? "done" : "failed");
  }

  // 大屏幕放什么：成片 > 方案台 > 起拍画面 > 一句"还没有画面"
  const boardOn = plan != null && (!done || showPlan);

  /**
   * 方案台摊开**且还没挑定**时进专注态。
   *
   * ★ 为什么值得单独收一屏：方案台原来夹在顶栏 / 段导航条 / 要求输入框 / 报价行 /
   *   节点条中间，375×640 的手机上只剩中间**一小条**——而挑方案要看首尾帧的构图、
   *   改剧情要读一整段字，这一步恰恰是全流程里最需要地方的一步。
   * ★★ **判据是 picking 而不是 boardOn**（2026-08-15 对抗审查抓到的回归，改前是后者）：
   *   专注态把「本段内容」整块 hidden 掉，而全流程唯一的推进入口「⚡ 生成本段」就在那一块里。
   *   挑定一套之后 plan 由 picking 变 picked、boardOn **不变**，于是专注态不退，屏幕上
   *   最显眼的可点项变成方案台里真扣钱却不出片的「重新生成这一套的画面」——用户要么
   *   被引去反复付费重画，要么得先猜到左上角那枚「收起」。这正是本页 :175 注释记过、
   *   已经修过一次的坑：**把最贵那一步的入口藏起来**。挑定的那一刻退出专注态，动作栏
   *   立刻回来，第 4 拍（出片）的入口就在手边。
   * ★ 已出片的段点「看方案」（picked + showPlan）同样不进专注态：那时用户是在对比/回看，
   *   而「看成片」这个开关自己就长在被收起的段导航条里——进得去出不来。
   * ★ 写成 effect 而不是在 boardOn 那一行里直接 set：boardOn 是渲染期的派生值，
   *   渲染期改父组件的 state 是非法的。
   * ★ 卸载/换段一定要报 false：换到下一段（可能压根没有方案台）时不还原的话，
   *   用户会对着一屏收起来的 UI 以为界面坏了。
   * ⚠ 它只在判据**变化**时跑 —— 用户按左上角箭头手动退出专注态之后
   *   （focus=false 而判据仍为真），这里不会把他再拽回去。
   */
  const focusWanted = boardOn && plan === "picking";
  useEffect(() => {
    onFocus(focusWanted);
    return () => onFocus(false);
  }, [focusWanted, onFocus]);

  /** 从预览播放器截当前帧去圈选（视频经代理取流，画布不会被跨域污染） */
  function openAnnotator() {
    const v = vref.current;
    if (v && v.videoWidth) {
      v.pause();
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      drawCover(c.getContext("2d")!, v, 1280, 720);
      setAnnOpen({ frame: c.toDataURL("image/jpeg", 0.9), atSec: v.currentTime });
    } else if (prop.firstFrame) {
      setAnnOpen({ frame: prop.firstFrame, atSec: 0 });
    }
  }

  // 手势：在预览区上横划换节点、竖划换走向（输入框区域不参与，见 data-noswipe）
  const drag = useRef<{ x: number; y: number } | null>(null);
  const swipe = {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-noswipe]")) return;
      drag.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d || busy) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) < SWIPE && Math.abs(dy) < SWIPE) return;
      if (Math.abs(dx) >= Math.abs(dy)) shiftCursor(dx < 0 ? 1 : -1);
      else if (node.proposals.length > 1) shiftProposal(node.id, dy < 0 ? 1 : -1);
    },
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── 段导航条 + 状态 ──
          ★ 换节点从"压在画面上的两枚半透明箭头"挪到这里，状态角标也一并搬过来：方案台铺满
            大屏幕之后，那两枚箭头正好落在方案卡的首尾帧上，点方案会误触换段。
            顺序门禁的表达（锁图标 + 说明"为什么点不动"）原样保留，真正的拦截仍在
            flowStore.clampCursor —— 专注态只是**不画**这一条，一个判断都没动。 */}
      <div className={`${focus ? "hidden" : "flex"} flex-none items-center gap-2 px-3 py-1.5`}>
        <button
          onClick={() => shiftCursor(-1)}
          disabled={index === 0 || busy}
          aria-label="上一段"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-panel text-slate-200 disabled:opacity-25"
        >
          <Icon name="back" size={15} />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
          <span className="flex-none text-[11px] text-slate-300">
            {total > 1 ? `第 ${index + 1}/${total} 段` : "本段"}
          </span>
          {done && <span className="flex-none rounded-full bg-emerald-500/85 px-1.5 text-[10px] text-ink">✓ 已出片</span>}
          {picking && <span className="flex-none rounded-full bg-gold/20 px-1.5 text-[10px] text-gold">待挑方案</span>}
          {generating && (
            <span className="min-w-0 flex-1 animate-pulse truncate rounded-full bg-brand px-1.5 text-[10px] font-semibold text-ink">
              {node.progress || "生成中…"}
            </span>
          )}
          {node.status === "failed" && (
            <span className="min-w-0 flex-1 truncate rounded-full bg-rose-500/85 px-1.5 text-[10px] text-white">
              ✗ {node.error}
            </span>
          )}
        </div>
        {/* 出片后大屏幕默认放成片，这枚开关把方案台翻回来（改帧改剧情再重炼） */}
        {done && plan != null && (
          <button
            onClick={() => setShowPlan((v) => !v)}
            className="flex-none rounded-full bg-panel px-2.5 py-1 text-[10px] text-slate-300"
          >
            {showPlan ? "看成片" : "看方案"}
          </button>
        )}
        <button
          onClick={() => shiftCursor(1)}
          disabled={index >= total - 1 || !done || busy}
          title={index >= total - 1 ? "没有下一段了" : done ? "下一段" : "先把这一段炼出来"}
          aria-label={done ? "下一段" : "下一段（本段还没出片）"}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-panel text-slate-200 disabled:opacity-25"
        >
          <Icon name={done || index >= total - 1 ? "chevron" : "lock"} size={done || index >= total - 1 ? 15 : 13} />
        </button>
      </div>

      {/* ── 大屏幕：方案台 / 成片 / 起拍画面（手势区）── */}
      <div
        className={`relative min-h-0 flex-1 ${boardOn ? "bg-[#0b0f18]" : "flex items-center justify-center bg-black"}`}
        data-guide="flow-stage"
        {...swipe}
      >
        {boardOn ? (
          /* 方案台自己要吃竖向滚动与点击，横划换段在这里会打架 —— data-noswipe 关掉手势 */
          <div className="absolute inset-0" data-noswipe>
            <PlanBoard
              proposals={node.proposals}
              pickedId={picking ? null : node.chosenId}
              isDone={(p) => !!node.videoByProposal[p.id]}
              busy={busy || generating}
              regenId={node.regenning ? node.chosenId : null}
              onPick={(id) => chooseProposal(node.id, id)}
              onPatch={(_id, patch) => updateProposal(node.id, patch)}
              onFrame={(_id, which, dataUrl) => setFrame(node.id, which, dataUrl)}
              onRegen={() => void regenProposal(node.id)}
              regenCost={(p) => redrawCost(node, p, prevProp)}
              onRederive={() => void deriveProposals(node.id)}
              rederiveCost={propCost}
              carriedFrom={carried}
              // 预览卡的框跟本段画幅走：写死一个比例，另一种画幅的帧会被裁掉一大半
              frameAspect={aspectCss(node.aspect)}
            />
          </div>
        ) : done && vsrc ? (
          <video ref={vref} src={vsrc} muted playsInline controls className="max-h-full max-w-full" />
        ) : prop.firstFrame ? (
          <img src={prop.firstFrame} alt="" className="max-h-full max-w-full" />
        ) : (
          <div className="px-8 text-center text-xs leading-relaxed text-slate-500">
            {generating
              ? node.progress || "生成中…"
              : simple || blockout // 白模没有方案台（直出复刻），别许诺"三套方案"
                ? blockout && named
                  ? "还没有画面——先给人偶挂上角色卡，出片就按模板逐镜头复刻"
                  : "还没有画面——在下面写清楚这一段要拍什么"
                : "还没有画面——在下面写清楚这一段要拍什么，点「生成本段」先看三套方案"}
          </div>
        )}
      </div>

      {/* ── 本段内容 ──
          专注态下整块收起（要求输入框 / 报价说明 / 档位按钮 / 主按钮 / 素材按钮）。
          ★ 用 hidden 而不是不渲染：这里面有用户正在敲的输入框（要求、剧情），
            卸载再挂回来会丢焦点、丢输入法候选，退出专注态时也就不是"原样展开"了。 */}
      <div
        className={`${focus ? "hidden" : ""} flex-none space-y-2 border-t border-slate-800 bg-ink px-4 pb-3 pt-2.5`}
        data-noswipe
      >
        {/* 出片过程日志：跑着时展开，跑完自动收起但留着可回看 */}
        <GenTrace steps={node.steps ?? []} running={generating} />
        {/* 标题不在这里改了——它是"某一套方案"的标题，跟剧情一起放在方案台那一行里改，
            两处都能改同一个字段只会让人不知道哪个说了算 */}
        {tpl ? (
          /* 套了模板：用户只需要说"换成谁/什么主题"，其余由配方补齐。
             剧情框仍然可展开查看/微调——模板是起点不是牢笼 */
          <>
            {/* ★ V2 白模（有角色位）换成挂卡区：那条路上"换成谁"由编号→卡的映射决定，
                而合成出来的点名句就摆在输入框里等用户过目（方案 B2）。
                V1 与经典模板一个字没变，还是这个「一句话」框 */}
            {named ? <BlockoutCastBox node={node} onCast={requestCast} /> : <TemplateSubjectBox />}
            {castAsk && (
              <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
                <p className="text-[11px] leading-relaxed text-amber-200">
                  改完挂卡会按新的映射<b>重新合成</b>下面那段要求，你改过的字会被替换掉 ——
                  因为旧的那段话里写的还是旧的挂卡，留着它 AI 就会照旧的换人。
                </p>
                <div className="flex gap-2">
                  <button onClick={openCast} className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-ink">
                    继续去挂卡
                  </button>
                  <button onClick={() => setCastAsk(false)} className="rounded-full px-2.5 py-1 text-[11px] text-slate-300">
                    算了
                  </button>
                </div>
              </div>
            )}
            {/* ★ 白模的报价行必须**明示输入费构成**：r2v 连模板视频的输入时长也计费
                （输出还≈输入），"42<70 所以更便宜"的直觉是反的——只报一个总数，
                用户会拿纯任务的价一比就觉得被多收了。数字与主按钮同一把尺子（nodeCost） */}
            {tpl.refVideo && (
              <p className="text-[10px] leading-4 text-slate-500">
                {/* ★ 措辞是「按 N 秒计」不是「N 秒」：这个数是**计价锚点**（整数、向上取整），
                    模板视频的真实文件更短。写成"模板视频 4s"会与详情页那句"实际约 3.7 秒"
                    看起来互相打架，而它们说的是两件事 —— 一件是账、一件是文件。 */}
                {`白模复刻出片（「${tierOf(node.videoTier).label}」档）：模板视频按 ${tpl.refVideo.durationSec} 秒计的输入也计费、输出≈模板时长，共约 ${fmtTokens(cost)} token`}
                {/* 一张卡都没挂时把"去哪儿挂"说清楚。★ 两条路的入口不是同一个：V2 挂在
                    角色位上（上面那颗按钮，右下角那枚圆钮也走同一处），V1 挂在本段素材里 */}
                {matCount === 0 &&
                  (named
                    ? `。先给${markSpecOf(tpl).scheme === "ordinal" ? "白色" : "编号的"}人偶挂上带形象图的角色卡，AI 才知道每个人偶换成谁`
                    : "。挂上带形象图的角色卡（右下角素材按钮），AI 会把红色小人换成它")}
              </p>
            )}
          </>
        ) : simple ? (
          <div className="space-y-1">
            <textarea
              value={prop.plot}
              onChange={(e) => updateProposal(node.id, { plot: e.target.value })}
              rows={3}
              maxLength={400}
              placeholder="想拍什么？例：雨夜的东京街头，霓虹灯牌下一只黑猫慢慢走过积水，倒影闪烁"
              className="w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            {/* ★ 挂了卡就必须说清"这些卡到底怎么参与出片"，因为两种做法的结果差很多：
                支持参考图的档位是把卡的形象图**直接交给 Seedance**（一句话直出，不画设定帧，
                也就更便宜）；不支持的档位只能先按文字重画一张设定帧再出片，形象是"照着描述
                画的"而不是"照着卡片用的"。悄悄换一种做法 = 用户以为卡片没生效（铁律八） */}
            {matCount > 0 && (
              <p className="text-[10px] leading-4 text-slate-500">
                {refOn
                  ? `直接把素材卡的形象参考图交给「${tierOf(node.videoTier).label}」档出片，不再画设定帧（更快也更省）`
                  : tierOf(node.videoTier).refImg
                    ? "素材卡上还没有形象参考图（去卡片详情页加几张），这次只能先按描述画一张设定帧再出片"
                    : `「${tierOf(node.videoTier).label}」档不支持参考图：会先按描述画一张设定帧再出片。想直接用卡片形象，在「⚙ 本段设置」里换成「高清」或「电影级」`}
              </p>
            )}
          </div>
        ) : (
          /* 工作流：这一栏是**用户自己的话**（推演三套方案的依据），不是某一套的剧情。
             改了它再点「重新生成方案」就按新要求重推——各套的剧情在方案台里逐字改 */
          <div className="space-y-1">
            <textarea
              value={req}
              onChange={(e) => setRequirement(node.id, e.target.value)}
              rows={2}
              maxLength={400}
              placeholder="这一段要拍什么？（AI 会按它推演三套走向）"
              data-guide="flow-req-input"
              className="w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            <p className="text-[10px] leading-4 text-slate-500">
              {picking
                ? "改完这句话可以「重新生成方案」；挑定一套之后按钮才变回「生成本段」"
                : plan === "picked"
                  ? "已挑定一套 · 在上面的方案台里换首尾帧、改剧情"
                  : "点「生成本段」先出三套方案（各带首尾帧预览），挑定后再炼视频"}
            </p>
          </div>
        )}

        {/* 圈选标注缩略 */}
        {node.anns.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {node.anns.map((a) => (
              <div key={a.id} className="relative w-24 flex-none overflow-hidden rounded-lg bg-panel">
                <img src={a.frame} alt="" className="h-12 w-full object-cover" />
                <div className="truncate px-1 py-0.5 text-[9px] text-slate-300" title={a.req}>
                  {a.req}
                </div>
                <button
                  onClick={() => removeAnn(node.id, a.id)}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-[9px] text-slate-200"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSheet(true)}
            className="flex-none rounded-lg bg-panel px-2.5 py-2 text-[11px] text-slate-300"
          >
            {/* 时长显示的是**真正会发出去**的秒数（2.5 不收 3 秒，见 clampDuration）——
                写 3 秒却出 4 秒的片，用户对不上账。
                ★ 白模例外：时长 = 模板登记时长，**不过 clampDuration**（edit 输出≈输入是
                协议行为，10s 上限是纯 t2v 档位的约束——夹了就是"显示 10s、实出 14s"） */}
            ⚙ {blockout && tpl?.refVideo ? tpl.refVideo.durationSec : clampDuration(prop.durationSec, node.videoTier)}s ·{" "}
            {tierOf(node.videoTier).label} · {aspectOf(node.aspect).label}
          </button>
          {done && (
            <button
              onClick={openAnnotator}
              disabled={busy}
              /* 收成两个字：这一行现在还要放素材按钮，"圈选改画面"会把生成按钮挤到折行 */
              title="圈选改画面"
              className="flex-none rounded-lg bg-panel px-2.5 py-2 text-[11px] text-slate-300 disabled:opacity-40"
            >
              ⭕ 圈选
            </button>
          )}
          <button
            onClick={() => void onMain()}
            disabled={mainDisabled}
            title={AI_REAL ? `预计消耗 ${fmtTokens(mainCost)} token` : undefined}
            data-guide="flow-main-btn"
            className={`min-w-0 flex-1 rounded-lg py-2 text-xs font-bold disabled:opacity-40 ${
              stage === "rederive" ? "bg-gold/90 text-ink" : "bg-brand text-ink"
            }`}
          >
            {mainLabel}
          </button>
          {/* 素材入口。就贴在「生成本段」旁边，因为它改的正是这一段要炼成什么样。
              图案是 Q 版看板娘抱着牌：收起时躲在牌后只露眼睛，展开时把牌举起来大笑，
              两态之间是同一条 8 帧序列正播/倒播（见 MaterialButtonArt）。
              角标是本段已挂的张数——加卡那一下按钮会抖一下（key 换了动画才会重播，
              同 CharacterPerch 那套做法）。 */}
          {/* ★★ V2 白模上这枚钮改开**挂卡**，不开素材窗口：那条路的 materials ≡ 挂卡结果
              （flowStore.applyCast 整表覆盖）。放着素材窗口能自由加卡的话，加进来的卡
              没有任何编号点它，却照样进参考图、照样在尾巴上多出一条绑定句（`名字=@图片N`）——
              模型收到一个"有图有名字、却没人点它"的角色，只会自己找个地方把他画进去，
              而那句绑定还白吃掉用户的正文额度（提示词硬顶 400 字，截断从正文这头切）。
              移除同理：从素材条里删掉一张，点名句里还写着它、图却没发出去 ——
              两个方向都是画面照出、钱照扣、零报错。两个入口指同一个动作，不是两条路。 */}
          <button
            key={matShake}
            onClick={named ? requestCast : onToggleMat}
            aria-label={named ? `挂卡 ${matCount} 张` : `本段素材 ${matCount} 张`}
            title={named ? "给人偶挂卡" : "本段素材"}
            /* 不裁圆角：让她连人带牌探出钮外一点，比塞进一个圆里更有"她在按钮上"的味道 */
            className={`relative flex h-11 w-11 flex-none items-center justify-center rounded-full transition ${
              matOpen ? "bg-brand/20 ring-2 ring-brand" : "bg-panel ring-1 ring-slate-700"
            } ${matShake > 0 ? "mat-shake" : ""}`}
          >
            <MaterialButtonArt open={matOpen} size={42} />
            {matCount > 0 && (
              <span className="absolute -right-1 -top-1 z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold tabular-nums text-white ring-2 ring-ink">
                {matCount}
              </span>
            )}
          </button>
        </div>

        {/* 出片之后才给"往下走"。最后一段没有下一段可去，改成就地追加一段——
            底部节点条上的 ＋ 现在也要等出片才亮，这里是同一条规则的另一个入口 */}
        {done &&
          (index < total - 1 ? (
            <button
              onClick={() => shiftCursor(1)}
              disabled={busy}
              className="w-full rounded-lg border border-emerald-400/40 bg-emerald-500/15 py-2 text-xs font-bold text-emerald-200 disabled:opacity-40"
            >
              ✓ 这段满意，去下一段
            </button>
          ) : simple ? null : (
            <button
              onClick={() => addNode()}
              disabled={busy}
              className="w-full rounded-lg border border-emerald-400/40 bg-emerald-500/15 py-2 text-xs font-bold text-emerald-200 disabled:opacity-40"
            >
              ✓ 这段满意，再加一段
            </button>
          ))}
      </div>

      {/* 炼卡浮层：压住整屏，中央看板娘 + 这一段的步骤日志 */}
      {forge && (
        <ForgeOverlay
          phase={forge}
          steps={node.steps ?? []}
          // 余额不足这类"还没进流程就被拦下"的失败没有 node.error，只有 store 的 err
          error={node.error || err}
          onClose={() => setForge(null)}
          // 「先去逛逛」：生成链条活在 flowStore，站内切页不断；全局胶囊（GenerationPill）
          // 接手进度显示，出完把人叫回来
          onLeave={() => nav("/")}
        />
      )}

      {/* ── 本段设置抽屉 ── */}
      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/70" onClick={() => setSheet(false)}>
          {/* 同上：safe-bottom 会把 p-4 的下内边距吃成 0，两个值合成一个写 */}
          <div
            className="w-full space-y-3 rounded-t-2xl bg-ink p-4"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-100">第 {index + 1} 段设置</span>
              <button onClick={() => setSheet(false)} className="text-slate-400">
                <Icon name="close" size={18} />
              </button>
            </div>

            {/* ★ 白模节点**没有时长选择器**（仓库主人拍板）：时长 = 模板的登记时长，
                edit 输出≈输入是协议行为，不吃 clampDuration 的 10s 上限（那是纯 t2v
                档位的产品约束）。摆一排点了不生效的时长按钮就是骗人 —— 换成一句明说 */}
            {blockout && tpl?.refVideo ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-10 flex-none text-[11px] text-slate-400">时长</span>
                <span className="text-[11px] text-slate-300">
                  {/* ★ 这里说的是**计价与预期时长**（锚点），不是文件真实秒数 —— 真实秒数在
                      模板详情页如实显示。两处措辞刻意不同，别把这一处改成真实值：
                      账单按锚点走，用户对账时看的是这个数 */}
                  按 {tpl.refVideo.durationSec} 秒计 · 跟随模板视频（白模复刻的输出时长≈模板时长，不可另选）
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-10 flex-none text-[11px] text-slate-400">时长</span>
                {DURATIONS.map((d) => {
                  // ★ 短于本档下限的时长直接禁掉并说明：Seedance 2.5 的合法区间是 [4,30]，
                  //   3 秒发过去是同步 400，用户只会觉得"这一档坏了"（见 VideoTier.minSec）
                  const tooShort = d < tierOf(node.videoTier).minSec;
                  return (
                    <button
                      key={d}
                      onClick={() => updateProposal(node.id, { durationSec: d })}
                      disabled={tooShort}
                      title={tooShort ? `「${tierOf(node.videoTier).label}」最短 ${tierOf(node.videoTier).minSec} 秒` : undefined}
                      className={`rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${prop.durationSec === d ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
                    >
                      {d}s
                    </button>
                  );
                })}
              </div>
            )}

            {/* 画幅：已出片的段不给改——改了这一段的成片还是老画幅，
                用户以为改完就变了，直到剪辑页合并才发现这一段被裁/补了边 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-10 flex-none text-[11px] text-slate-400">画幅</span>
              {VIDEO_ASPECTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => updateNode(node.id, { aspect: a.id })}
                  // ★ 白模禁改：真正的出片画幅是 adaptive 跟随模板视频（arkClient 的
                  //   BLOCKOUT_TASK 整体接管 ratio），这排按钮点了不会改变产出 ——
                  //   摆着能点就是"改了不生效"的骗人选项
                  disabled={done || blockout}
                  title={
                    blockout
                      ? "白模复刻的画幅自适应模板视频，不可另选"
                      : done
                        ? "这一段已出片，改画幅要重新生成才生效"
                        : a.desc
                  }
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${
                    node.aspect === a.id ? "bg-brand text-ink" : "bg-panel text-slate-300"
                  }`}
                >
                  <span
                    className={`block rounded-[2px] border-2 ${node.aspect === a.id ? "border-ink/70" : "border-slate-400"}`}
                    style={{ width: a.id === "portrait" ? 8 : 14, height: a.id === "portrait" ? 14 : 8 }}
                  />
                  {a.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-10 flex-none text-[11px] text-slate-400">画质</span>
              {VIDEO_TIERS.map((t) => {
                // ★ 白模节点上，不支持 r2v 的档位也要禁掉（判断在 economy.r2vPriceIssue
                //   一处）：切过去出片必被 segmentGen 的门禁整句拒绝，让人选一个必失败的
                //   档位不如当场说不能选。价目也不能对这些档位问 nodeCost —— 那会走进
                //   segmentCost 的"没 r2v 价还硬报"兜底（按最贵系数 + console.error 点名），
                //   而这里不是门禁被改坏，只是一排比价按钮
                const r2vBlock = blockout ? r2vPriceIssue(t.id) : null;
                const block = tierBlockReason(t) ?? r2vBlock;
                return (
                  <button
                    key={t.id}
                    onClick={() => updateNode(node.id, { videoTier: t.id })}
                    disabled={!!block}
                    title={block ?? `${t.desc}（${t.model}）`}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${node.videoTier === t.id ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
                  >
                    {/* ★ 与主按钮同一把尺子（nodeCost，只是把档位换成这一档）：光报 segTokens
                        会漏掉"这一档还得补画几张设定帧"，而简约模式正是两张都要补的那条路 ——
                        于是抽屉里写 108k、外面按钮写 134.6k，用户在**比价**的这一步被少报 */}
                    {r2vBlock ? t.label : <>{t.label} · {fmtTokens(nodeCost(nodes, index, mode, t.id))}</>}
                  </button>
                );
              })}
            </div>
            {/* ★ 点不动就必须写出为什么。只把按钮灰掉的话，用户只会觉得"这功能坏了"
                （CLAUDE.md「界面上摆一个永远点不动的选项」）。title 在手机上没有 hover，
                所以原因得**印在页面上**，不能只挂在 title 里 */}
            {(tierBlocks.length > 0 || r2vBlocks.length > 0) && (
              <p className="text-[10px] leading-4 text-amber-300/80">
                {[...tierBlocks, ...r2vBlocks].join("；")}
                {/* 「去升级」只治得了套餐门槛那类原因；r2v 闸门没开不是充钱能解决的，
                    只有套餐原因在场时才给这个链接。间隔用全角空格字面量——JSX 会把
                    行间换行整个吃掉，靠折行留空隙是留不住的 */}
                {tierBlocks.length > 0 && (
                  <>
                    {"　"}
                    <Link to="/me" className="underline">
                      去升级
                    </Link>
                  </>
                )}
              </p>
            )}
            {/* ★ 把**真正会被调用的那个模型**写出来。「极速/标准/高清」只说了画质档次，
                没说这一段到底交给谁去生成 —— 而不同世代的模型（1.0 / 2.0）观感差别很大，
                用户对不上账时无从判断。这里显示的是 tierOf(...).model 推导出来的名字，
                与发给方舟的 id 同源，不会出现"界面写着一个、实际跑另一个"。
                title 里给完整 id，要查证的人一眼能看到。 */}
            <div className="text-[10px] text-slate-500" title={tierOf(node.videoTier).model}>
              本段模型：{modelLabel(tierOf(node.videoTier).model)}
              <span className="ml-1 opacity-70">· {tierOf(node.videoTier).desc}</span>
            </div>

            {index > 0 && (
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={node.chain}
                  onChange={(e) => updateNode(node.id, { chain: e.target.checked })}
                  className="accent-brand"
                />
                从上一段的真实结尾画面接着拍
              </label>
            )}

            {!!node.materials?.length && (
              <div className="flex flex-wrap gap-1">
                <span className="w-10 flex-none text-[11px] text-slate-400">素材</span>
                {node.materials.map((c) => (
                  <span key={c.id} className="rounded-full bg-panel px-2 py-0.5 text-[10px] text-slate-300">
                    {c.name}
                  </span>
                ))}
              </div>
            )}

            {/* 推演三套方案的入口以前就藏在这里，绝大多数用户没找到它——现在它是屏幕中间
                那块方案台 + 底部主按钮的主路径，抽屉里只留真正的"设置"（时长/画质/承接） */}
          </div>
        </div>
      )}

      {annOpen && (
        <FrameAnnotator
          frame={annOpen.frame}
          hint="标注会先改这一段的设定画面，再重新生成本段视频"
          onClose={() => setAnnOpen(null)}
          onSave={(frame, req) => {
            addAnn(node.id, { frame, req, atSec: annOpen.atSec });
            setAnnOpen(null);
          }}
        />
      )}
    </div>
  );
}

export default function FlowPage() {
  const navigate = useNavigate();
  // 第一次进这一屏强制放一遍引导（看过一次不再自动弹；那颗 ? 随时能重看）
  useAutoGuide("flow");
  const loc = useLocation();
  // 人回到这一页，胶囊那条"待读通知"就算读过了（页内自有完整的进度与结果 UI）
  const clearGenNotice = useFlow((s) => s.clearGenNotice);
  useEffect(() => clearGenNotice(), [clearGenNotice]);
  const { nodes, cursor, mode, origin, busy, err, setCursor, addNode, removeNode, addMaterials, removeMaterial, reset } =
    useFlow();
  const [finalizing, setFinalizing] = useState("");
  const [tplExtract, setTplExtract] = useState(false);
  /**
   * 画布视图（全屏覆盖层，竖横皆可）：点格子就地开编辑窗，不再跳回线性视图。
   * 开关落 sessionStorage：画布里点「挂卡」要去 /video-editor 整页编辑器，
   * 回来必须还在画布上 —— 不落盘的话回程 remount 会把用户扔回线性视图，
   * 「我明明在画布里编的」这种断裂比多存一个键难受得多。
   */
  const [canvas, setCanvasRaw] = useState(() => sessionStorage.getItem("flowCanvasOpen") === "1");
  const setCanvas = (v: boolean) => {
    setCanvasRaw(v);
    try {
      sessionStorage.setItem("flowCanvasOpen", v ? "1" : "0");
    } catch {
      /* 隐私模式塞不进就算了：代价只是回程回线性视图 */
    }
  };
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  /** 素材窗口开着 = 底部那条也换成本段素材（见下面的底部区） */
  const [matOpen, setMatOpen] = useState(false);
  /**
   * 方案台专注态：方案台吃满屏，本页其余 UI（顶栏 / 组稿报价行 / 段导航条 / 要求输入框 /
   * 主按钮 / 底部节点条）全部收起，只留左上角一枚返回箭头。退出时原样展开。
   *
   * ★ 由 NodeScreen 报上来（"方案台开没开"只有它算得出，见那边的 onFocus），
   *   这里不再算第二遍（铁律六）。
   * ★ 只是**不画**那些东西：能不能换段、能不能加段、白模能不能出片，判定一条都没动
   *   （仍在 flowStore.clampCursor / addNode 与 segmentGen 的 blockoutIssue 里）。
   * ★ 实现上刻意没有新的 fixed / portal / transform 容器：收起 chrome 之后，方案台
   *   原地就长满了整屏（它本来就是那块 flex-1 里的 `absolute inset-0`）。多套一层
   *   带 transform 或 backdrop-blur 的祖先，只会把它自己的滚动与放大动画弄坏
   *   （CLAUDE.md「全屏浮层写了 fixed inset-0 却只铺满一小块」那条坑的同族）。
   */
  const [planFocus, setPlanFocus] = useState(false);
  /** 每加一次素材 +1，传给圆形按钮当 key 让抖动重播 */
  const [matShake, setMatShake] = useState(0);
  const tpl = useFlow((s) => s.template);
  const simple = mode === "simple";
  /**
   * 自由素材窗口开着吗 —— **V2 白模上恒为关**。
   *
   * ★★ 那条路的 materials ≡ 挂卡结果（唯一出处是角色位，flowStore.applyCast 整表覆盖）。
   *   素材窗口能加也能删：加进来的卡没有任何编号点它，却照样进参考图、照样多出一条
   *   `名字=@图片N` 的绑定句（规则在 ai/real.allocateRefs 与它的 bind）—— 模型收到一个
   *   "有图有名字、没人点它"的角色就会自己安排他出场，那句绑定还白吃掉用户的正文额度；
   *   删掉一张则是点名句里还写着它、图却没发出去 —— 两个方向都是"人错了、钱照扣、
   *   零报错"。所以这一格在 V2 上整个不开（那枚圆钮改成挂卡入口，见 NodeScreen）。
   * ★ 写成派生值而不是"打开时判一下"：matOpen 是本页的存量状态，用户完全可能先开着
   *   素材窗口、再从模板栏套上一个 V2 模板（提取器那条路就在这一页上），那一刻没人
   *   会去关它。
   */
  const matWindow = matOpen && !(tpl?.refVideo && tpl?.roles?.length);

  // 直接输地址进来（或热更新丢了状态）：没节点就回创作入口，别停在空白页。
  // leavingRef 是必需的：组稿成功后 reset() 清空节点，本效应会在 navigate("/cut")
  // 落地前抢跑，把用户按回 /create（实测踩到过）
  // ★ 发布收工之后这一格也是死页（判据只在 studioStore.publishedExit 一处，铁律六）：
  //   那时该去的是首页而不是创作入口 —— 用户刚发完片，不是又要开一摊新活
  const leavingRef = useRef(false);
  useEffect(() => {
    if (nodes.length > 0 || leavingRef.current) return;
    navigate(publishedExit() ?? "/create", { replace: true });
  }, [nodes.length, navigate]);

  /**
   * 从视频编辑页（cast 模式）回来 —— 白模 V2 套用链路的**收口**：
   * 拿到 `编号 → 卡 id` 的映射，交给 flowStore.applyCast 去落 materials + 合成点名句
   * （合成与对齐规则都在那里一处实现，这一页只负责"把结果接住"）。
   *
   * ★ 入参**按形状验收**、不按"应该有"假设：这一格 state 可能来自深链、老包缓存，
   *   或者是模式一（选段裁剪）的结果（那条路不归这一页收）。硬转 `as` 的话要到
   *   第一处解引用才崩，而那时页面已经白了（同 VideoEditorPage.parseState 的 ★）。
   * ★ **先抹掉 state 再干活**：留着它，用户之后从别处按返回回到这一格 /flow 就会
   *   再合成一次（一次 chat 调用 + 把输入框里他改过的字整段覆盖），而他什么都没点。
   *   ref 那道判重是为同一次渲染里的重跑兜底，两者都要。
   * ⚠ 编辑页把结果 replace 回来时，App 进程若在挂卡那几分钟里被系统回收过，store 里
   *   的流水线就是空的（内存态，不落盘）—— 那时上面那个 effect 会把人送回 /create，
   *   applyCast 也会整句说"这条流水线上没有可挂卡的白模模板"。不装作没事发生。
   */
  const castTaken = useRef<unknown>(null);
  useEffect(() => {
    const raw = (loc.state as Record<string, unknown> | null)?.[VIDEO_EDITOR_RESULT_KEY];
    if (!raw || castTaken.current === raw) return;
    castTaken.current = raw;
    navigate(loc.pathname, { replace: true, state: null });
    const r = raw as Partial<VideoEditorResult> & { cast?: unknown };
    if (r.mode !== "cast" || !r.cast || typeof r.cast !== "object") return;
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.cast as Record<string, unknown>)) if (typeof v === "string" && v) map[k] = v;
    const st = useFlow.getState();
    // 对号入座：模板对不上就整句拒绝，绝不"就近用"——编号是**这个模板**的编号，
    // 张冠李戴地套到另一个模板上，出片时就是换错人且零报错（types.roles 的 ★★）
    if (r.templateId && st.template && r.templateId !== st.template.id) {
      useFlow.setState({
        err: "刚才挂卡的是另一个模板（这条流水线上套的模板中途换过了）——回模板详情页重新套用一次再挂卡",
      });
      return;
    }
    void st.applyCast(map);
  }, [loc.state, loc.pathname, navigate]);

  // ★ 自动存盘只挂在"又炼出一段"这一个事件上，不做定时/每次改动都存：
  //   一段视频是几十秒 + 真金白银，丢了补不回来；而草稿正文带整份首尾帧 base64，
  //   一条几 MB，频繁写盘会拖慢主线程还费配额。改文字这种廉价改动交给手动按钮。
  //   写在 FlowPage 而不是 flowStore：flowStore 绝不 import studioStore（互相 import
  //   在 Vite 下会拿到半初始化的模块），而这一页两边都拿得到。
  //   ★ 简约模式不落草稿：它只有一段、几十秒就出片，一路直通剪辑与发布，中间没有"回来
  //     接着做"的状态可言。给它存草稿只会在个人页堆一串一次性的半成品，而每条都带 1MB
  //     级的帧，把真正需要草稿的工坊/工作流那 20 条上限挤掉（见 data/drafts.MAX_DRAFTS）。
  const doneCount = nodes.filter(nodeDone).length;
  const prevDone = useRef(doneCount);
  useEffect(() => {
    if (simple) return;
    if (doneCount > prevDone.current) void useStudio.getState().saveWorkDraft({ from: "flow" });
    prevDone.current = doneCount;
  }, [doneCount, simple]);

  const allDone = nodes.length > 0 && nodes.every(nodeDone);
  /** 还没出片的第一段 = 用户最远能走到的地方（-1 表示全出片了，随便看） */
  const frontier = frontierOf(nodes);
  /**
   * 按下「完成视频」那一下还要花的钱（组稿时提炼本片卡组，撞上 3D 关键词再加建模）。
   *
   * ★★ 这笔钱以前**从头到尾没在界面上出现过**：顶栏只累加各段的出片费，而组稿会再烧
   *   最多 110k（8 张卡）+ 最多 320k（2 个建模）。用户照着顶栏那个数攒余额，
   *   点完「完成视频」发现少了一大截 —— CLAUDE.md「页面报 ¥25、实际扣 ¥15」那条的放大版。
   * ★ 报价与实收同一处实现：deckQuoteOf 与 finalizeFromFlow 读的是同一个 mode、
   *   同一份文字、同一批常量（见 studioStore.deckQuoteOf）。简约模式它返回全 0 ——
   *   那条路**不报也不收**。
   */
  const deck = useMemo(() => deckQuoteOf(nodes, mode), [nodes, mode]);
  /** 顶栏那个"剩余约"。★ 把组稿那一笔一起算进去：分开显示两个数，用户没有任何理由
   *  相信它们要相加，而"我还得准备多少 token"是一个数不是两个。 */
  const remain = useMemo(() => flowCost(nodes, mode) + deck.total, [nodes, mode, deck.total]);
  const wallet = walletOf();
  const node = nodes[Math.min(cursor, nodes.length - 1)];

  if (nodes.length === 0 || !node) return null;

  /** 存盘。失败要说出来：配额满/隐私模式下 IndexedDB 写不进去，
   *  静默"保存成功"会让用户放心地关掉页面，然后什么都没了（铁律八） */
  async function saveNow() {
    setSaveState("saving");
    const meta = await useStudio.getState().saveWorkDraft({ from: "flow" });
    setSaveState(meta ? "saved" : "failed");
    if (!meta) useFlow.setState({ err: "草稿保存失败（存储空间不足或浏览器隐私模式）" });
    setTimeout(() => setSaveState("idle"), 2200);
  }

  /** 全部满意 → 组稿（回写真帧 + 提炼卡组）→ 进剪辑页 */
  async function toCut() {
    if (busy || finalizing) return;
    setFinalizing("组稿中…");
    try {
      // ★ mode 显式传过去：「简约模式不出卡组」这条规则由它决定，而 store 里偷读
      //   useFlow 的话，这个调用点上根本看不出"模式会改变这次组稿花多少钱"。
      //   与上面 deckQuoteOf 报价时读的是同一个 mode —— 报什么价就收什么钱。
      const st = useFlow.getState();
      const ok = await useStudio.getState().finalizeFromFlow(st.nodes, st.mode, (s) => setFinalizing(s));
      if (ok) {
        leavingRef.current = true;
        reset();
        // ★ replace 而不是 push：组稿成功那一下 reset() 已经把流水线清空了，历史里这一格
        //   /flow 就是个死页 —— 从剪辑页按返回退到它，它当场又把人 replace 走（今天是
        //   /create），白闪一下。少留一格死页，发布之后按返回也少一次落空
        navigate("/cut", { replace: true });
      }
    } catch (e) {
      console.warn("[flow] 组稿失败:", e);
      useFlow.setState({ err: `组稿失败：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` });
    } finally {
      setFinalizing("");
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-ink">
      {/* ── 专注态的那枚返回箭头 + 生成进度 ──
          ★ 按钮上写字（"收起"）而不是只放一个光秃秃的箭头：这个位置平时是"退出工作流"，
            不写清楚用户不敢点（怕一点就把没炼完的片子丢了）。
          ★ 进度那一枚**不能一起收**：重新推演三套要一分多钟，这期间方案台上所有按钮都是
            灰的，一个字都不说的话与卡死无从区分（铁律八）。 */}
      {planFocus && (
        <div
          className="absolute left-3 right-3 z-20 flex items-center gap-2"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 10px)" }}
        >
          <button
            onClick={() => setPlanFocus(false)}
            aria-label="收起方案台"
            className="flex flex-none items-center gap-1 rounded-full bg-black/60 px-2.5 py-1.5 text-xs text-slate-100 ring-1 ring-white/15"
          >
            <Icon name="back" size={16} />
            收起
          </button>
          {node.status === "generating" && (
            <span className="min-w-0 flex-1 animate-pulse truncate rounded-full bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-ink">
              {node.progress || "生成中…"}
            </span>
          )}
          {/* ★ 失败原因也不能一起收：node.error 平时画在段导航条的 ✗ 角标上，而那一条在
              专注态里是 hidden 的。推演失败（敏感词 400、余额不足、上游超时）本来就常发生在
              这个状态下——收起来就等于"点了没反应"，铁律八。generating 时不显示旧错误。 */}
          {node.status !== "generating" && node.error && (
            <span className="min-w-0 flex-1 truncate rounded-full bg-rose-500/90 px-2.5 py-1.5 text-[11px] font-semibold text-white">
              ✗ {node.error}
            </span>
          )}
        </div>
      )}

      {/* 专注态下给上面那条（箭头 + 进度）留出位置。★ 用一格 flex-none 的空行占位，而不是
          给方案台那块加 padding：方案台是 `absolute inset-0` 铺进去的，祖先的 padding 对它
          无效，只会被箭头压住第一行；放在这里还能顺便把报错条也挤到箭头下面 */}
      {planFocus && <div className="flex-none" style={{ height: "calc(env(safe-area-inset-top, 0px) + 46px)" }} />}

      {/* ★★ 顶栏是**两行**的：左边一格里「标题 + ?」在上、进度在下，右边才是按钮。
          为什么不能都挤在一行（2026-08-17 量出来改的，量法见下）：这一行里除进度外
          全是 flex-none，于是每加一个固定件都**只从进度身上扣**——加那颗 ? 的时候
          进度从 97px 掉到 59px，连「5 段 · 已出片 2」这半句本身（72.6px）都被切成
          「5 段 · 已出…」。旁边这条注释当年正是为这件事写的，结果新加的 ? 又踩了一次。

          量法（不是估字宽）：dev server 上按同一套 class 把这段版式挂进真实样式里，
          375px 视口（最窄的目标机）读 getBoundingClientRect：
            内容宽 375 − 32(px-4) = 343
            返回 20 ＋ 标题「工作流」42 ＋ ? 28 ＋ 存草稿 60 ＋ 完成视频 84
            （全段出片后带那个「›」；没出完是 76）＋ 5 个 gap-2.5 共 50 = 284
            ⇒ 留给进度 59px
          竖过来之后进度独占那一格：量到 **149px**，而「5 段 · 已出片 2 · 剩余约 12.3k」
          整句 146px —— 那句「剩余约」（= 还要花多少钱）**第一次能完整显示**。
          代价是顶栏 48 → 64.5px（舞台少 16.5px），这一条是有意换的：被切掉的是钱。
          ⚠ 还是会切的两种，都可接受（段数与已出片数在最前面，先保住的是它们）：
            · 两位数（「12 段 · 已出片 10 · 剩余约 123.4k」165.3px）切掉金额末几位；
            · 存盘按钮换文案时它自己会变宽（存草稿 60 → 保存中… 69.8 / 已保存 ✓ 71.8 /
              保存失败 72），那几秒里进度只剩 137px，「12.3k」的尾巴被切一点。
          试过、不行的两条，别再走：
            ① 留在一行、给进度写 `min-w-[86px]`（86 = 两位数那半句「12 段 · 已出片 10」
               的 85.5）：flex-none 不收缩，这一行溢出内容框 27px、超出屏幕右缘 11px ——
               「完成视频」右半边被切在屏外，点不全，且零报错；
            ② 只把进度挪到第二行、? 仍留在主行：顶栏只长 8.5px，但进度 111px，
               「剩余约」照样被切成「· 剩…」，等于把钱那半句丢了。 */}
      <header className={`${planFocus ? "hidden" : "flex"} safe-top flex-none items-center gap-2.5 px-4 py-2.5`}>
        <button
          onClick={() => navigate(origin === "studio" ? "/studio" : "/create")}
          className="flex-none text-slate-300"
        >
          <Icon name="back" size={20} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <span className="flex-none text-sm font-bold text-slate-100">{simple ? "简约模式" : "工作流"}</span>
            <HelpButton tour="flow" />
          </div>
          <span className="min-w-0 truncate text-[11px] text-slate-500">
            {simple ? "一个节点，一条短片" : `${nodes.length} 段 · 已出片 ${nodes.filter(nodeDone).length}`}
            {AI_REAL && remain > 0 && ` · 剩余约 ${fmtTokens(remain)}`}
          </span>
        </div>
        {/* 画布视图入口（icon-only：顶栏宽度账见上面那段量法注释，28px 的图标钮
            加 gap 正好落在剩余 59px 里）。简约模式恒单段，画布没有信息量，不出 */}
        {!simple && (
          <button
            onClick={() => setCanvas(true)}
            title="画布视图：整条流水线摊开看"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-slate-700/80 text-[13px]"
          >
            🗺
          </button>
        )}
        {/* 手动存盘。自动保存只在"炼完一段"那种昂贵节点触发（见上面的 effect），
            纯改文字不会自动存——想留住就点这里。简约模式没有这颗按钮（它不进草稿库） */}
        {!simple && (
          <button
            onClick={() => void saveNow()}
            disabled={saveState === "saving"}
            className="flex-none rounded-full bg-slate-700/80 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
          >
            {saveState === "saving"
              ? "保存中…"
              : saveState === "saved"
                ? "已保存 ✓"
                : saveState === "failed"
                  ? "保存失败"
                  : "存草稿"}
          </button>
        )}
        {/* 收口按钮：全部出片后把各段并成一条片子（去剪辑页合并）。
            这里原来是「⚡ 炼完剩余 N 段」——那条路与"逐段确认"是对着干的：
            它让用户在没看过第一段效果之前，就把后面几段的钱一次性烧掉。
            现在只留一个终点，没出片时明说还差几段，而不是给一个点了就批量扣费的入口。 */}
        <button
          onClick={() => void toCut()}
          disabled={!allDone || busy || !!finalizing}
          title={allDone ? "把各段合成一条完整视频" : "每段都出片之后才能合成"}
          data-guide="flow-finish"
          className="flex-none rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
        >
          {/* 文案要短：375px 顶栏这一行还得放返回、标题+?、存草稿三样（进度已经竖到
              标题下面那行去了，量法见 header 上那段注释）。这颗按钮量到 84px，是这一行里
              最宽的一件；带上「还差 N 段」会再宽出一截，把左边那一格连标题带进度一起压瘦。
              "还差几段"由标题下面那行的「N 段 · 已出片 M」交代，这里只留终点本身 */}
          {finalizing || "完成视频"}
          {allDone && " ›"}
        </button>
      </header>

      {/* 简约模式的模板栏：套上模板 = 配方负责画风与分镜，用户只写一句话 */}
      {simple && (
        <div className="mx-4 mb-1.5 flex flex-none items-center gap-2 rounded-xl border border-slate-700/70 bg-panel px-3 py-2">
          {tpl ? (
            <>
              <span className="flex-none text-xs">🧪</span>
              <Link to={`/template/${tpl.id}`} className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">
                {tpl.title}
              </Link>
              <span className="flex-none text-[10px] text-slate-500">{nodes.length} 段</span>
              {/* 出片了、模板是自己提取的、还没发布 → 就地引导发布（详情页的作者区管标题/简介） */}
              {allDone && myTemplates().some((x) => x.id === tpl.id && !x.published) ? (
                <Link
                  to={`/template/${tpl.id}`}
                  className="flex-none rounded-full bg-gold/90 px-2.5 py-1 text-[11px] font-bold text-ink"
                >
                  发布模板
                </Link>
              ) : (
                <button onClick={() => navigate("/templates")} className="flex-none text-[11px] text-brand">
                  换
                </button>
              )}
              <button
                onClick={() => useFlow.getState().seedSolo("simple")}
                className="flex-none text-[11px] text-slate-500"
              >
                不用
              </button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">
                套个模板？一句话就能出同类视频
              </span>
              <button
                onClick={() => navigate("/templates")}
                className="flex-none rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-100"
              >
                模板市场
              </button>
              <button
                onClick={() => setTplExtract(true)}
                className="flex-none rounded-full bg-brand/90 px-2.5 py-1 text-[11px] font-bold text-ink"
              >
                提取模板
              </button>
            </>
          )}
        </div>
      )}

      {/* ★★ 组稿前把「完成视频」那一下要花的钱明说出来。
          为什么单开一行而不是塞进按钮上：那颗按钮在 375px 顶栏那一行里与返回/标题+?/存草稿
          挤在一起（量法见 header 上那段），它已经是行里最宽的一件，多两个字就把左边那一格
          连标题带进度一起压瘦（CLAUDE.md 那条底缘几何的同类问题）。
          为什么等到 allDone 才出现：在那之前按钮是灰的，用户此刻要读的是"下一段多少钱"；
          整片的这一笔一直算在顶栏「剩余约」里，不会因为这行没出现就瞒着他。
          ⚠ 措辞三处都不许含糊：**最多**（张数是上限，按实际出卡结算）、
          **约**（单价还没与火山账单对过，见 economy 的 ⚠）、以及余额不足会自动跳过
          （那是 finalizeFromFlow 真实的行为，不写的话用户会以为钱不够就完不成片）。 */}
      {deck.on && AI_REAL && allDone && !planFocus && (
        <div className="mx-4 mb-1.5 flex-none rounded-xl border border-slate-700/70 bg-panel px-3 py-2 text-[11px] leading-relaxed text-slate-400">
          {/* ★ 整句在 JS 里拼好再交给 JSX：分成几段写的话，JSX 会把每行之间的换行折成
              一个空格，于是条件那一支不成立时就变成「…token 。都按实际…」——
              中文标点前多一个空格，看着像是文案坏了 */}
          {[
            `点「完成视频」还会提炼本片卡组：最多 ${deck.maxCards} 张卡，约 ${fmtTokens(deck.cards)} token`,
            deck.wants3d
              ? `；这条片写了 3D / 建模一类的画风，还会给派生的角色卡铸最多 ${deck.max3d} 个 3D 建模，另约 ${fmtTokens(deck.model3d)} token`
              : "",
            "。都按实际出卡结算，余额不够会自动跳过（成片不受影响）。",
          ].join("")}
        </div>
      )}

      {/* ★ 报错条**不跟着专注态收起**（其余都收）：推演/重画失败、余额不足都从这里说话，
          藏起来就是静默失败（铁律八）。它是 flex-none，出现时把方案台顶下去一点点而已 */}
      {err && (
        <div className="mx-4 mb-1.5 flex flex-none items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <span className="min-w-0 flex-1">{err}</span>
          <button onClick={() => useFlow.setState({ err: "" })} className="flex-none">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {/* 一屏一个节点（key 让切节点时播放器彻底重建，不残留上一段的画面） */}
      <div className="min-h-0 flex-1">
        <NodeScreen
          key={node.id}
          node={node}
          index={cursor}
          total={nodes.length}
          matOpen={matWindow}
          matShake={matShake}
          onToggleMat={() => setMatOpen((v) => !v)}
          focus={planFocus}
          // setState 的 setter 引用是稳定的：直接传它，NodeScreen 那个 effect 才不会
          // 每次渲染都重跑一遍（重跑会把用户手动收起的专注态又拽回来）
          onFocus={setPlanFocus}
        />
      </div>

      {/* ── 底部区：素材窗口开着时是【本段素材】，否则是【整条流水线的节点条】──
          这两样是同一块地方的两种用途：素材窗口一打开，用户关心的就是"这一段用哪些卡"，
          此时还占着位置的节点条只是噪音（而且那会儿他也不该跳段）。 */}
      {(!simple || matWindow) && !planFocus && (
        <div
          className="flex-none border-t border-slate-800 bg-[#141821] px-3 pt-2.5"
          /* ★ 不能写 `safe-bottom pb-3`：.safe-bottom 在 index.css 里排在 @tailwind utilities
             之后，两条都是 padding-bottom，后写的赢 —— 于是没有安全区的设备（桌面、
             大多数安卓）padding-bottom 直接变成 0，素材卡整排贴死在屏幕最底边。
             两个值必须合成一个。素材条比节点条高，多留一点。 */
          style={{ paddingBottom: `calc(${matWindow ? "1rem" : "0.75rem"} + env(safe-area-inset-bottom, 0px))` }}
        >
          {matWindow ? (
            <MaterialStrip materials={node.materials ?? []} onRemove={(id) => removeMaterial(node.id, id)} />
          ) : (
            <>
              {/* 节点条 = 进度轨：已出片的和当前这段可以点，再往后是锁着的。
                  真正的拦截在 flowStore.clampCursor，这里画出"为什么点不动" */}
              <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto" data-guide="flow-node-strip">
                {nodes.map((n, i) => {
                  const p = chosenOf(n);
                  const locked = frontier >= 0 && i > frontier;
                  return (
                    <button
                      key={n.id}
                      onClick={() => setCursor(i)}
                      disabled={locked}
                      aria-label={`第 ${i + 1} 段${locked ? "（还没轮到）" : ""}`}
                      /* 定高不定宽：缩略图按本段画幅撑出宽度，横竖一眼能分出来
                         （写死 16:9 的话，竖屏段在这条里被裁得只剩腰） */
                      style={{ aspectRatio: aspectCss(n.aspect) }}
                      className={`relative h-11 flex-none overflow-hidden rounded-lg border-2 ${
                        i === cursor ? "border-brand" : "border-transparent"
                      }`}
                    >
                      {p.firstFrame ? (
                        <img src={p.firstFrame} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center bg-panel text-[10px] text-slate-500">
                          {i + 1}
                        </span>
                      )}
                      {nodeDone(n) ? (
                        <span className="absolute right-0.5 top-0.5 rounded-full bg-emerald-500/90 px-1 text-[8px] text-ink">
                          ✓
                        </span>
                      ) : (
                        planOf(n) === "picking" && (
                          <span className="absolute right-0.5 top-0.5 rounded-full bg-gold/90 px-1 text-[8px] text-ink">
                            ⋯
                          </span>
                        )
                      )}
                      {locked && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/55">
                          <Icon name="lock" size={13} className="text-white/75" />
                        </span>
                      )}
                    </button>
                  );
                })}
                {/* 只能在末尾追加，且上一段必须已出片（同一条规则在 flowStore.addNode 里兜底） */}
                <button
                  onClick={() => addNode()}
                  disabled={busy || !nodeDone(nodes[nodes.length - 1])}
                  title={nodeDone(nodes[nodes.length - 1]) ? "加一段" : "先把当前这段炼出来"}
                  className="h-11 w-11 flex-none rounded-lg border border-dashed border-slate-600 text-slate-400 disabled:opacity-30"
                  aria-label="加一段"
                >
                  ＋
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                <button
                  onClick={() => removeNode(node.id)}
                  disabled={busy || nodes.length <= 1}
                  className="rounded bg-rose-500/15 px-2 py-1 text-rose-300 disabled:opacity-30"
                >
                  🗑 删除本段
                </button>
                <span className="min-w-0 flex-1 truncate text-right text-slate-500">
                  总时长 {formatDuration(nodes.reduce((s, n) => s + chosenOf(n).durationSec, 0))}
                  {AI_REAL && wallet && ` · 余额 ${fmtTokens(wallet.plan + wallet.addon)}`}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* 素材窗口：从屏幕上方落下，拖卡到屏幕中间交给看板娘 */}
      {matWindow && (
        <MaterialSheet
          materials={node.materials ?? []}
          onAdd={(cards) => {
            const n = addMaterials(node.id, cards);
            if (n > 0) setMatShake((k) => k + 1); // 一张没加就别抖——抖了等于说"加上了"
            return n;
          }}
          onClose={() => setMatOpen(false)}
        />
      )}
      {tplExtract && (
        <VideoTemplateExtractor
          onClose={() => setTplExtract(false)}
          onDone={(t) => useFlow.getState().applyTemplate(t)}
        />
      )}

      {/* 画布视图：全屏覆盖层（Portal 到 body），点格子就地开编辑窗。
          挂卡要去 /video-editor 整页编辑器 —— castEditorState 只有本文件一处实现
          （跨页约定），经 prop 借给画布，FlowCanvas 不 import 页面（依赖单向） */}
      {canvas && (
        <FlowCanvas
          onClose={() => setCanvas(false)}
          onCast={(t, value) => {
            const st = castEditorState(t, value);
            if (st) navigate("/video-editor", { state: st });
          }}
        />
      )}
    </div>
  );
}
