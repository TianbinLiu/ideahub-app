// 工作流模式的状态：把"整片一次合成"拆成一节点一段、逐段确认的流水线。
//
// 节点与工坊的节点卡是同一种东西：一个节点持有若干"走向方案"（Proposal）与当前
// 选定的那个，横向切节点、纵向切走向。工坊铸好的三方案原样搬进来，工作流模式自建
// 的节点也可以让 AI 现场推演三种走向——两边共用 NodeSlot 的语义，只是没有 3D 桌面。
//
// 与 studioStore 的关系是单向的：studioStore 把活动路径喂进来（seed），FlowPage
// 跑完再回头调 studioStore.finalizeFromFlow 组稿。**本文件绝不 import studioStore**
// ——否则两个 store 互相 import，Vite 下会拿到半初始化的模块。
//
// 为什么逐段而不是一把梭：一段视频 1 分钟起、几万 token 起，整片炼完才发现第 1 段
// 人物就不对，等于全片重来。逐段确认让用户在最便宜的时候止损。
//
// ★ 一段的推进是**三拍**，不是一拍（见 FlowNode.plan）：
//     写要求 →「生成本段」先推演三套方案（各带首尾帧预览）→ 挑一套（可改帧改剧情）
//           →「生成本段」才真去炼视频
//   三套方案以前藏在「本段设置」抽屉里的一枚小按钮后面，绝大多数用户根本没见过它，
//   于是工作流退化成"写一句话直接出片"——最贵的那一步（出片）反而没有选择余地。
//   现在它是主路径：便宜的一步（推演 ~80k token）摆在前面挑，贵的一步（出片）挑完再走。
import { create } from "zustand";
import { AI_REAL, generateCover, generateProposals, prepareMaterialRefs } from "../ai";
import { canAfford, myCards, spendTokens, tierBlockReason, walletOf } from "../data/account";
import {
  DEFAULT_TIER,
  VIDEO_TIERS,
  annRedrawCost,
  fmtTokens,
  proposalRedrawCost,
  proposalsCost,
  realFaceIssue,
  segmentCost,
  tierOf,
  deriveIssue,
} from "../data/economy";
import { Card, DEFAULT_ASPECT, Proposal, TemplateRecipe, VideoAspect, VideoTemplate, uid } from "../types";
// ★ 角色位上限（服务端那个数的镜像）与"哪几个能挂卡"只有一处实现，在 data 层 ——
//   store 不该 import 组件（依赖方向 data → store → 组件）
import {
  BLOCKOUT_MAX_ROLES,
  markDescOfLabel,
  markNoun,
  markSpecOf,
  refVideoIssue,
  splitCastRoles,
} from "../data/templates";
import { type BlockoutCastSlot, blockoutApplySkeleton, castNameIssue, composeBlockoutPrompt } from "./blockoutPrompt";
import { GenStep, createGenLog, splitStatus } from "./genLog";
import { blockoutIssue, generateSegment, refVideoOn } from "./segmentGen";

/** 画面圈选标注：某一帧上圈出的物体 + 修改要求（重生成时并入提示词并改设定帧） */
export interface FlowAnn {
  id: string;
  /** 圈选发生在本段的第几秒（决定改首帧还是尾帧） */
  atSec: number;
  /** 带红圈的标注图（Seedream 图生图的参考图） */
  frame: string;
  req: string;
}

export interface FlowNode {
  id: string;
  /**
   * 这一段自己的模板快照（**分段模板组**才有，2026-08-20）：长视频切成 N 段登记后，
   * 每段是一条独立模板，一次套用铺 N 个节点、各带各的快照。缺省 = 单模板流，
   * 读 store 级 template。**读模板一律走 `tplOfNode`**，别直接摸这两处任何一处 ——
   * 报价（nodeCost）与出片（genNode）读错一份，就是「按第 1 段的时长给第 2 段报价」
   * 这类静默错账。store 级 template 由 setCursor 跟着当前节点同步（旧读点的兜底）。
   */
  tpl?: FlowTemplate;
  /** 这一段已挂的卡（label → cardId）。分段组切段时 setCursor 拿它恢复编辑缓冲；
   *  真正生效的映射在合成进 plot 的点名句里（applyCast），这份只是面板回显 */
  cast?: Record<string, string>;
  /** 走向方案：工坊铸的三选一，或工作流现场推演/手写的若干个 */
  proposals: Proposal[];
  chosenId: string;
  /**
   * 方案台状态。**这是「生成本段」按钮到底干什么的唯一依据**：
   *   undefined —— 还没推演过（或简约模式/模板这种单方案节点）→ 点「生成本段」先推演三套
   *   "picking" —— 三套方案摊在屏幕上等用户挑 → 按钮变「重新生成方案」，不许出片
   *   "picked"  —— 用户挑定了一套 → 按钮变回「生成本段」，这才真去炼视频
   *
   * ★ 用 undefined 兼容老草稿：那些节点当年就是选好的，缺省成 "picking" 会让用户
   *   打开旧草稿发现每段都要重挑一遍（见 planOf 的兜底）。
   */
  plan?: "picking" | "picked";
  /**
   * 用户对这一段的原始输入（"这一段要拍什么"）。
   * ★ 与 proposal.plot 刻意分开：plot 是 AI 写出来的那一套的剧情（用户还能在方案卡上
   *   逐字改），requirement 是**用户自己的话**——「重新生成方案」要原样再喂给 AI 一次。
   *   合成一个字段的话，用户改了某一套的剧情再重新推演，就等于拿 AI 的文字当自己的要求，
   *   越推越偏。
   */
  requirement?: string;
  /** 本段素材卡快照（工坊带过来的） */
  materials?: Card[];
  videoTier: string;
  /** 本段画幅（竖/横）。整片理应同一个画幅，所以新节点继承上一段的取值 */
  aspect: VideoAspect;
  /** 首帧承接上一段的真实结尾（用户换过图就置 false，尊重用户） */
  chain: boolean;
  /** 各走向各自的成片：换走向不丢已经炼好的那条 */
  videoByProposal: Record<string, string>;
  /** 用户在工作流里亲手改过这一段的文案（updateProposal 置位）。
   *  重铺前的脏检查靠它区分"工坊铺过来的原文"与"用户自己敲的字"——前者重铺即可复现，
   *  后者补不回来。setSubject 走模板配方覆盖，不算用户逐字敲的，故不置位。 */
  edited?: boolean;
  /** 只描述"当前正在发生什么"，出片与否看 videoByProposal（见 nodeDone） */
  status: "idle" | "generating" | "failed";
  error?: string;
  /** 生成期实时阶段（"标准档 · 排队中…"）——按钮上那一行，取 steps 的当前步 */
  progress?: string;
  /** 正在按修改重画本方案的画面（方案台上那一枚按钮转圈用）。
   *  ★ 不靠 progress 文案 includes("重画") 反推状态——那种判断改一次文案就静默失效。 */
  regenning?: boolean;
  /** 出片过程的分步日志（见 genLog.ts）。跑完保留，用户能回看这一段是怎么出来的 */
  steps?: GenStep[];
  anns: FlowAnn[];
}

export type FlowMode = "workflow" | "simple";

/** 套用中的模板快照（草稿要整份存下来，所以单独成型）。
 *  refVideo 是白模模板的参考视频登记值镜像，跟着快照进草稿：报价（nodeCost）与出片
 *  （genNode）都只从这里读——存在性判定（`!refVideo` 走经典路，types.ts 同一条 ★），
 *  经典模板与老草稿天然缺它，零迁移。 */
export type FlowTemplate = {
  id: string;
  title: string;
  recipe: TemplateRecipe;
  cards: Card[];
  refVideo?: VideoTemplate["refVideo"];
  /** 分段组归属（`VideoTemplate.group` 的镜像，存在性语义同 roles）。剪辑页拿
   *  `sourceUrl` 预置原片音轨（用户点名要的：成片保留原视频音频） */
  group?: VideoTemplate["group"];
  /**
   * 白模人偶的角色位（`VideoTemplate.roles` 的镜像）。**有 = V2 白模模板**（可以逐个
   * 角色位挂人物卡，走点名路）；缺省 = V1 老白模模板/经典模板，照旧走泛指的 BLOCKOUT_SWAP。
   *
   * ★ 判定一律写**存在性**（`roles?.length`，types.ts 同一条 ★）：后加字段，老快照与
   *   老草稿天然缺它、天然走老路，零迁移。
   * ★ 必须跟着快照走、不许出片时再去模板库现查：模板可能已被作者改/删，而这一段的
   *   报价、挂卡映射与合成好的点名句都是**套用那一刻**那份 roles 的产物 —— 现查等于
   *   让标记在半路换一份定义，那正是"换错人且零报错"的入口。
   */
  roles?: VideoTemplate["roles"];
  /**
   * 这个模板的标记方案位（`VideoTemplate.markSlots` 的镜像）——
   * **存在 = 序数方案，缺省 = 编号方案**（判据的唯一实现是 data/templates.isOrdinalMark）。
   *
   * ★★ 它必须与 `roles` **同一批**进快照：套用提示词的措辞与**升序排序**、挂卡面板的徽章、
   *   核对面板的输入方式全按它分支。漏在这里没有任何症状 —— 模板照样能挂卡，只是
   *   输入框里那段话变成 `编号最左边=凛`（好在这句话一眼就是坏的，而且摆在花钱之前；
   *   这正是当初选择"label 直接装措辞 token"而不是"label 留序位数字 + 另加一个方案枚举"
   *   的理由：后者漏字段时会写出一句**看起来完全正常**的 `编号3=凛`，用户不会起疑）。
   * ★ 与 roles 同理：跟着快照走，不许出片时现查。
   */
  markSlots?: VideoTemplate["markSlots"];
  /** 画面位置框与它们量自第几秒（挂卡面板的拖拽层用）。与 markSlots 下标对齐，同批进快照 */
  markBoxes?: VideoTemplate["markBoxes"];
  markBoxAtSec?: VideoTemplate["markBoxAtSec"];
  /**
   * 人偶描述（`VideoTemplate.markDescs` 的镜像）——「**这段白模视频里**第 i 个位置上
   * 那个人偶什么样」，与 markSlots 下标对齐，写进套用提示词给 r2v 当第二个指认锚点。
   * ⚠ 它**不是** `roles[].desc`（那一位说的是"原来是谁"，白模化那条路来自原片）。
   * ★ 与 roles/markSlots 同一批进快照、同一条存在性语义：漏在这里没有任何症状，
   *   只是括号永远不出现，而"没有括号"与"这段素材本来就没什么可描述的"长得一模一样。
   */
  markDescs?: VideoTemplate["markDescs"];
} | null;

/**
 * 「套用态」的复位值 —— 模板快照、那句话、挂卡映射、合成失败的残留是**同一件事的四半**，
 * 只能一起清。
 *
 * ★ 为什么收成一处：留着上一轮的 `cast`（编号 → 卡 id）换个模板再套用，编号对不上号
 *   却照样能合成出一段"编号 4 换成张三"的话 —— 而新模板的 4 号根本是另一个人。
 *   换错人是画面照出、钱照收、**一个错都不报**的故障（types.VideoTemplate.roles 的 ★★），
 *   所以宁可每处都清干净。分散在四个 set 里写，迟早漏掉其中一格。
 */
function clearTemplate(): Pick<
  FlowState,
  "template" | "subject" | "cast" | "castErr" | "castFallback" | "castBusy" | "castNodeId"
> {
  return { template: null, subject: "", cast: {}, castErr: "", castFallback: "", castBusy: false, castNodeId: null };
}

/**
 * VideoTemplate → 流水线里的模板快照。applyTemplate（单模板）与 applyTemplateGroup
 * （分段组，逐段各一份）共用 —— 抄两份的话哪天 markDescs 这类"真有才带键"的位漏在
 * 一边，表现是分段组的括号描述静默消失（存在性语义见 data/templates 的 rolesOf）。
 * ★ 方案位与 roles 同一批、同一条存在性语义（老模板天然缺它 → 编号方案 →
 *   套用走老提示词，一个字不变）。少带 markSlots 不报错，只会让序数模板被当成
 *   编号模板（连升序排序一起丢）—— 见 FlowTemplate.markSlots 的 ★★。
 * ★ 人偶描述与框**各自独立**（框没量出来 ≠ 描述没验过），各自单独判存在性。
 */
function snapTpl(t: VideoTemplate): FlowTemplate {
  return {
    id: t.id,
    title: t.title,
    recipe: t.recipe,
    cards: t.cards,
    refVideo: t.refVideo,
    ...(t.roles?.length ? { roles: t.roles } : {}),
    ...(t.markSlots?.length ? { markSlots: t.markSlots } : {}),
    ...(t.markBoxes?.length ? { markBoxes: t.markBoxes } : {}),
    ...(t.markBoxAtSec !== undefined ? { markBoxAtSec: t.markBoxAtSec } : {}),
    ...(t.markDescs?.length ? { markDescs: t.markDescs } : {}),
    ...(t.group ? { group: t.group } : {}),
  };
}

export function chosenOf(node: FlowNode): Proposal {
  return node.proposals.find((p) => p.id === node.chosenId) ?? node.proposals[0];
}

export function nodeVideo(node: FlowNode): string | undefined {
  return node.videoByProposal[node.chosenId];
}

/**
 * 把**还没表过态**的段（`tpl === undefined`）钉成此刻的 store 级真相 —— 唯一实现。
 *
 * ★★ 为什么必须钉（2026-08-21 第六轮对抗评审确认的 high）：`tplOfNode` 对 undefined 是
 *   "退回 store 级"，而 store 级那份会随 `setCursor` 换成**当前段**的快照。于是一个
 *   tpl 还没定的段，会在用户点回前面某个白模段的那一刻，被兜底认成**那个白模模板的段**：
 *   卡片上冒出 🧪 徽章、报价改按 r2v、加段被拒「白模复刻段只有一段」，最狠的是出片时
 *   genNode 真把那个模板的参考视频发给方舟——按 r2v 扣钱，炼出来的却是前面那段的复刻。
 *   全程零报错。
 * ★ 所以**凡是让某个段有了明确 tpl 的动作**（套模板、摘模板、加一段）都要在同一拍里
 *   把其余 undefined 的段钉住。三处各写一遍的话，漏掉哪一处都没有任何症状——
 *   addNode 那一处此前就是漏的。
 * ⚠ 钉的是"这些段**本来就会兜底读到**的那份"，所以是语义等价的固化。
 *   **新造的段不适用**（它没有"本来会读到什么"这回事）——见 addNode 里的 ★★★。
 */
export function pinUnstatedTpl(nodes: FlowNode[], template: FlowTemplate): FlowNode[] {
  return nodes.map((n) => (n.tpl === undefined ? { ...n, tpl: template ?? null } : n));
}

/** 这一段是否已经交付：当前走向有成片，或 mock 构建下标记过完成 */
export function nodeDone(node: FlowNode): boolean {
  return !!node.videoByProposal[node.chosenId];
}

/**
 * 这一段**能不能播**（≠ 出没出片）。
 * ★★ 与 nodeDone 是两个问题：mock 构建（没配 ARK_API_KEY）下 Seedance 不返回地址，
 *   两边一致写 `"mock:"` 占位串 —— 那种段 `nodeDone` 为真、地址却是假的，
 *   直接塞给 <video> 就是一块黑（CLAUDE.md「一段视频只有一份」那条）。
 * ★ **唯一实现**（2026-08-21 收口）：画布与线性视图都调它。收之前两个面各写了一份
 *   `!startsWith("mock:")`，而画布那份的注释还写着"判据只有这一处" —— 正是本仓
 *   反复记的那种"抄一份必然分叉、而分叉了不报错"的形状。
 *   （studioStore 的 `realVideoOf` 收的是 `Proposal`，形状不同，是另一条路。）
 */
export function realVideoOfNode(node: FlowNode): string | undefined {
  const v = nodeVideo(node);
  return v && !v.startsWith("mock:") ? v : undefined;
}

/** 方案台状态（带老草稿兜底）：多方案却没有 plan 字段的节点是旧版数据，那时的方案都是
 *  选定过的，按 "picked" 算——否则打开旧草稿会要求每段重挑一遍。 */
export function planOf(node: FlowNode): "picking" | "picked" | null {
  return node.plan ?? (node.proposals.length > 1 ? "picked" : null);
}

/** 三套方案摊着等挑？这期间不许出片（出片按钮变「重新生成方案」） */
export function nodePicking(node: FlowNode): boolean {
  return planOf(node) === "picking";
}

/** 用户对这一段的原话（老草稿没有这个字段，退回当前方案的剧情——
 *  那正是旧版 deriveProposals 当作 requirement 用的东西，行为不变） */
export function requirementOf(node: FlowNode): string {
  return node.requirement ?? chosenOf(node).plot;
}

/** 这张开头帧不是本方案自己画的（用户上传的，或承接上一段的真实结尾）→ 重画时不许动它 */
function keepFirstFrame(node: FlowNode, p: Proposal, prev: Proposal | null): boolean {
  return !!p.pinned?.first || !!(node.chain && prev?.lastFrame && p.firstFrame === prev.lastFrame);
}

/** 「按修改重画这一套」的报价。★ regenProposal 扣钱走的是同一个函数——
 *  按钮上的数字与实际扣款分两处算必然分叉（铁律六） */
export function redrawCost(node: FlowNode, p: Proposal, prev: Proposal | null): number {
  return proposalRedrawCost(keepFirstFrame(node, p, prev), !!p.pinned?.last);
}

/** 把配方里的 {{主题}} 换成用户那句话（与 data/templates 的 fillBeat 同义，
 *  这里再写一份是为了不让 flowStore 依赖模板库——它只认配方里的字符串） */
function fillSubject(text: string, subject: string): string {
  return text.replace(/\{\{\s*主题\s*\}\}/g, subject.trim() || "主角");
}

export function blankProposal(i: number): Proposal {
  return { id: uid("prop"), title: `第 ${i + 1} 段`, plot: "", firstFrame: "", lastFrame: "", durationSec: 5 };
}

export function newFlowNode(i: number, patch: Partial<FlowNode> = {}): FlowNode {
  const p = blankProposal(i);
  return {
    id: uid("fn"),
    proposals: [p],
    chosenId: p.id,
    requirement: "",
    videoTier: DEFAULT_TIER,
    aspect: DEFAULT_ASPECT,
    chain: i > 0,
    videoByProposal: {},
    status: "idle",
    anns: [],
    ...patch,
  };
}

/**
 * 「还没出片的第一段」的下标；全部出片时为 -1。
 * 这是顺序门禁的唯一依据：光标只能停在它或它之前。
 */
export function frontierOf(nodes: FlowNode[]): number {
  return nodes.findIndex((n) => !nodeDone(n));
}

/**
 * 顺序门禁：把目标下标夹到「已出片的段」或「第一段还没出片的段」上。
 *
 * ★ 规则只在这一处实现（铁律六）：左右箭头、横划手势、底部节点条三条路都走
 *   setCursor/shiftCursor，写在 UI 里必然漏掉其中一条——手势那条尤其容易忘。
 * ★ 为什么要门禁：段与段是靠**上一段的真实尾帧**承接起拍的，跳着填的话后面几段
 *   接的是设定帧，衔接直接断掉；而且用户会在还没看到第一段效果之前，
 *   就把钱花在第三段上。
 */
/** 顺序门禁的唯一实现之一（另一处是 addNode，CLAUDE.md 钉过）。
 *  2026-08-21 导出：画布视图要给"还没解锁的段"画锁并解释为什么点不动 ——
 *  它必须问同一道闸，别在画布里另写 `nodeDone(prev)` 之类的第二份判断。 */
export function clampCursor(nodes: FlowNode[], to: number): number {
  const target = Math.max(0, Math.min(to, nodes.length - 1));
  const frontier = frontierOf(nodes);
  return frontier < 0 ? target : Math.min(target, frontier);
}

/**
 * 「炼这一段」要多少 token —— **唯一实现**，按钮上的报价与 genNode 真扣的钱都问它。
 * 出片本身之外还要算上"这一段还得补画几张设定帧"（简约模式两张都得画），
 * 走参考生视频则一张都不画（见 economy.segmentCost 与 segmentGen.refVideoOn）。
 *
 * ★ tierOverride 是给**档位选择器**用的："换成这一档要多少"。选档那一排原来直接问
 *   segTokens，于是同一屏上出现两个数：抽屉里写「标准 · 108k」、按钮上写「134.6k」。
 *   而简约模式正是两张设定帧都要补画的那条路，少报的 13.3k–26.6k 恰恰落在用户
 *   **正在比价**的这一步（CLAUDE.md：报价与结算不一致，用户会觉得被偷钱）。
 */
/**
 * 这一段的模板快照 —— **唯一读法**（2026-08-20）。分段组每节点各带一份（node.tpl），
 * 单模板流退回 store 级 template（读 getState 是 nodeCost 里的同款先例）。
 */
export function tplOfNode(node: FlowNode | undefined | null): FlowTemplate | null {
  // ★★ 三态，不是两态（2026-08-21 对抗评审确认的 high）：
  //   `undefined` = 这个节点还没表过态 -> 退回 store 级（老草稿与单模板流靠它，不能删）；
  //   `null`      = **明确地没有模板**；   对象 = 这一段自己的快照。
  //   之前写成 `?? store.template`，于是 null 也被当成"没表态" —— 混合流水线里
  //   给某一段套上白模模板之后，其余段全部读到**别人的**模板：卡片上多出一行 🧪、
  //   报价落进"没 r2v 价还硬报"的最贵兜底、出片被整句拒成白模段、连加段都被拒
  //   （「白模模板只有一段」）。全程零报错。
  return node?.tpl !== undefined ? node.tpl : useFlow.getState().template;
}

export function nodeCost(nodes: FlowNode[], idx: number, mode: FlowMode, tierOverride?: string): number {
  const node = nodes[idx];
  if (!node) return 0;
  const prop = chosenOf(node);
  const carry = nodeCarry(nodes, idx);
  // 白模位从模板快照读。★ 走 tplOfNode：分段组各段时长不同，读 store 级那份会把
  //   第 1 段的时长套在每一段头上 —— 报价对不上实扣（本仓头号事故形状）。
  // ★ 按「模板带 refVideo」透传，而不是问 blockoutOn：还没挂角色卡的白模节点也必须按
  //   r2v 报价——那才是它唯一可能花出去的钱（不挂卡根本出不了片，genNode 门口的
  //   blockoutIssue 拦着，而扣款只在出片成功后）；按经典路报是另一件商品的价。
  //   inputSec 只从登记值镜像读（economy.segmentCost 的同一句 ★），不拿 <video> 现探。
  const refVideo = tplOfNode(node)?.refVideo;
  // ★★ 圈选改帧那几张图**必须进报价**（2026-08-21 第九轮扫描的 high）：出片管线对每一处
  //   圈选都会跑一次 refineFrame（segmentGen 里那个 for 循环，一次真的 Seedream 图生图），
  //   而这里原来只算视频那一半 —— 圈 5 处就少报 5 张图的钱，按钮上的数比实扣少一大截。
  //   ★ 白模段没有这一笔：那条路整个不接受圈选（segmentGen 的 blockoutIssue 会整句拒）。
  const annsCost = refVideo ? 0 : annRedrawCost(node.anns.length);
  return annsCost + segmentCost({
    durationSec: prop.durationSec,
    tierId: tierOverride ?? node.videoTier,
    hasFirstFrame: !!(prop.firstFrame || carry),
    hasLastFrame: !!prop.lastFrame,
    refMode: nodeRefOn(nodes, idx, mode, tierOverride),
    refVideo: refVideo ? { inputSec: refVideo.durationSec } : undefined,
  });
}

/** 本段承接的上一段**真实**尾帧（没有就是 null）。
 *  承接只有在上一段真出片时才成立 —— 与 genNode 里的 carry 判定同一条件。 */
function nodeCarry(nodes: FlowNode[], idx: number): string | null {
  const node = nodes[idx];
  const prev = idx > 0 ? nodes[idx - 1] : undefined;
  if (!node || !node.chain || !prev || !nodeDone(prev)) return null;
  return chosenOf(prev).lastFrame || null;
}

/**
 * 这一段会不会走**参考生视频** —— 报价（nodeCost）、界面上那句说明（FlowPage）、
 * 真正出片（genNode → segmentGen）问的必须是同一处。
 *
 * ★ 关键是**承接帧也要算进去**：套模板的简约模式是多段 chain 的，第 2 段自己没有
 *   设定首帧、但会承接上一段的真实尾帧，于是实际走的是首尾帧模式。少传 carry 的话，
 *   界面会写着"直接把卡的形象交给 Seedance 出片、不画设定帧"，实际却按文字重画了一张
 *   设定帧 —— 用户只会觉得卡片没生效，而这正是这个功能要消灭的那种误会。
 */
export function nodeRefOn(nodes: FlowNode[], idx: number, mode: FlowMode, tierOverride?: string): boolean {
  const node = nodes[idx];
  if (!node) return false;
  const prop = chosenOf(node);
  return refVideoOn({
    // tierOverride：档位选择器问的是"换成这一档会怎样"，而参考生视频能不能走本身就看档位
    videoTier: tierOverride ?? node.videoTier,
    materials: node.materials,
    firstFrame: prop.firstFrame,
    carryFrame: nodeCarry(nodes, idx),
    anns: node.anns,
    refAllowed: mode === "simple",
    // 白模段让位：refVideoUrl 非空时 refVideoOn 恒 false——它的形象图是白模路自己
    // 混发的，不是「参考生视频」这条产品路（界面那句「省掉设定帧」不该亮）
    refVideoUrl: tplOfNode(node)?.refVideo?.url,
  });
}

/** 整条流水线还需要多少 token（当前走向已出片的段不再计费）。
 *  逐段问 nodeCost —— 顶栏那个总数与每一段按钮上的数字必须是同一把尺子。 */
export function flowCost(nodes: FlowNode[], mode: FlowMode): number {
  return nodes.reduce((s, n, i) => (nodeDone(n) ? s : s + nodeCost(nodes, i, mode)), 0);
}

/** 这条流水线里有没有「重铺一次就白费」的东西。seed/seedSolo 都是整表覆盖，调用方
 *  先问这个，为真就必须让用户确认——此前法阵按第二次会静默抹掉这些，且连页面都不跳。
 *
 *  ★ 判定刻意区分"这段内容是谁写的"：工坊铺过来的 plot 本来就出自节点树，重铺会原样
 *    再来一遍，什么都没丢——按 plot 非空一刀切的话，「回工坊改个走向再点法阵」这条最
 *    正常的路每次都要弹窗。所以只认真正补不回来的东西：已出片的段（真金白银 + 几分钟）、
 *    圈选标注、正在炼的段，以及用户在工作流里**亲手改过**的节点（edited）。
 *    solo 起手的节点没有节点树兜底，写了字就算数。 */
export function flowDirty(nodes: FlowNode[] = useFlow.getState().nodes): boolean {
  const solo = useFlow.getState().origin === "solo";
  return nodes.some(
    (n) =>
      Object.keys(n.videoByProposal).length > 0 ||
      n.anns.length > 0 ||
      n.status === "generating" ||
      n.edited ||
      (solo && chosenOf(n).plot.trim().length > 0),
  );
}

interface FlowState {
  nodes: FlowNode[];
  /** 横向游标：当前展示第几个节点 */
  cursor: number;
  mode: FlowMode;
  /** 来源：工坊派生（组稿要回写节点树）/ 直接新建 */
  origin: "studio" | "solo";
  /** 全局生成闸：同一时刻只炼一段 */
  busy: boolean;
  err: string;

  /** 套用中的模板：简约模式"一句话出片"的依据。null = 没套模板 */
  template: FlowTemplate;
  /** 用户那句话，替换配方里的 {{主题}} */
  subject: string;
  /**
   * 白模 V2 的挂卡映射：**人偶身上的标记（`roles[].label`）→ 卡 id**。
   * 键是序数措辞（新模板，「从左数第3个」）或阿拉伯数字（存量老模板），哪一种由
   * `template.markSlots` 的存在性决定 —— 但这一格**不需要知道**：它只是把服务端给的
   * 那个字符串当键用，两种形态零差别（这正是"label 直接装标记本身"换来的好处：
   * 连接键全仓只有一个，重号闸、整份替换、materials 落盘顺序全部零改动）。
   * ⚠ 这一格是 `Record`，它**本来就没有顺序** —— 而序数方案下"先后顺序就是语义"。
   *   顺序不是在这里保持的，是拼提示词时被 `blockoutPrompt.orderSlots` **制造**出来的。
   *   别在这里加一个"有序的 cast"，那会变成同一条规则的第二处实现。
   * 空表 = 还没挂（V1 老模板与经典模板恒为空表，它们没有角色位）。
   *
   * ★ 存 id 而不是整张卡：卡有 1MB 级的图，而这一格每次开编辑页都要原样塞进
   *   history state（structured clone，见 VideoEditorPage 顶部注释）。真正要用卡的时候
   *   由 `applyCast` 现查素材库 —— 顺带把"卡被删了/换了账号"这件事当场查出来。
   * ★ **不进草稿**：白模模板恒被 applyTemplate 铺成 simple 模式，而简约模式整个不进
   *   草稿库（studioStore.saveWorkDraft 里挡掉），所以这一格不需要跟着草稿走。
   */
  cast: Record<string, string>;
  /**
   * 挂卡之后合成点名提示词**失败**的整句原因（空 = 没失败）。
   *
   * ★ 单开一格而不是并进 `err`：这一条要在输入框旁边配一颗「填入默认写法」
   *   （骨架在 castFallback 里），而 `err` 是一条随手叉掉的通条。
   * ★ 绝不许失败了就往输入框里塞空串：空输入框在界面上与"用户还没写"一模一样，
   *   用户会以为自己写一句就够，出片时那段点名映射整个没发出去（blockoutPrompt 的 ★）。
   */
  castErr: string;
  /** 合成失败时那份**确定性**骨架（`blockoutApplySkeleton` 的产物），供用户一键填进输入框再改 */
  castFallback: string;
  /** 正在合成点名提示词（一次 chat，几秒）——按钮要转圈，别让用户以为点了没反应 */
  castBusy: boolean;

  /**
   * 「现在能不能整表换掉 nodes」—— **唯一实现**，六条整表覆盖入口都先问它。
   * ★★ 在途生成时一律拒：那一炉的钱**已经在花**，而换掉流水线并不会把它停下
   *   （没有 AbortController，也停不下）。回包时 `spendTokens` 照扣、写回打在一个
   *   已经不存在的节点上（静默落空），而确认卡那会儿还写着「没有花掉的钱」——
   *   三处与事实相反。等它跑完再换是唯一诚实的做法（胶囊本来就会通知）。
   * 返回 false 时原因已写进 `err`（铁律八）。
   */
  canReplaceNodes: () => boolean;
  /** 返回 false = 被 canReplaceNodes 拒了（原因在 err） */
  seed: (nodes: FlowNode[], opts: { mode: FlowMode; origin: "studio" | "solo" }) => boolean;
  /** 工作流/简约模式的空白起手：一个待填的节点 */
  seedSolo: (mode: FlowMode) => boolean;
  /** 套模板：按配方的分镜骨架铺节点、挂上模板卡组，之后只等用户写那句话。
   *  白模模板（t.refVideo 存在）只铺 1 个节点。返回 false = 被闸门整句拒绝
   *  （err 已写明原因，什么都没铺）——调用方据此决定还跳不跳工作流页 */
  applyTemplate: (t: VideoTemplate) => boolean;
  /** 分段模板组整组套用（2026-08-20）：N 段 = N 个白模节点，各带各的快照、各挂各的卡，
   *  顺序门禁照走 clampCursor（炼完本段才能去下一段）。1 段退化为 applyTemplate。 */
  applyTemplateGroup: (parts: VideoTemplate[]) => boolean;
  /** 给**单个节点**换/摘白模模板（2026-08-21，画布编辑窗用）：t=null 摘掉退回普通段。
   *  已出片的段整句拒（换模板会作废那段成片，钱不能静默作废）；换上即清这一段的
   *  挂卡与合成句（旧映射对新模板全是错的）。失败原因写进 err，返回 false。 */
  setNodeTemplate: (nodeId: string, t: VideoTemplate | null) => boolean;
  /** 写那句话：立刻把配方里的 {{主题}} 填成它，各段剧情随之成形 */
  setSubject: (subject: string) => void;
  /**
   * 收下编辑页（VideoEditorPage 的 cast 模式）交回来的挂卡映射：
   * 落 materials（按角色位原序）→ 合成点名提示词 → **填进本段的要求输入框**（plot）。
   *
   * 返回 false = 没合成成功（原因已写进 `err` 或 `castErr`，调用方不必再编一句）。
   */
  applyCast: (next: Record<string, string>) => Promise<boolean>;
  /** 把合成失败时那份骨架填进输入框（用户点了才填——不许替他默认填上，见 castErr 的 ★） */
  fillCastFallback: () => void;
  /**
   * 上面三个挂卡状态**属于哪一段**（applyCast 起手写、收工不清 —— 失败提示要一直挂在
   * 那一段上直到用户处理掉）。
   * ★★ 2026-08-21 验证轮加：原来它们只是"全局的"，界面靠 `s.cursor` 反推是谁 ——
   *   而合成是一次十几秒的对话，这期间用户点一下别的段光标就走了（tapNode 与底部节点条
   *   都不判 busy）。于是：真正在被写的那一段解除了禁用（用户这几秒打的字会被回包整段覆盖，
   *   而那把锁存在的全部理由就是防这个），失败提示与「填入默认写法」却落在**另一段**上，
   *   点下去把这一段的骨架写进别人的 plot。两个面同病。
   */
  castNodeId: string | null;
  reset: () => void;

  /** 改当前走向的内容（标题/剧情/时长/帧） */
  updateProposal: (nodeId: string, patch: Partial<Proposal>) => void;
  updateNode: (nodeId: string, patch: Partial<FlowNode>) => void;
  /** 改用户对这一段的原话（「重新生成方案」的依据） */
  setRequirement: (nodeId: string, v: string) => void;
  chooseProposal: (nodeId: string, proposalId: string) => void;
  /** 纵向切走向：dir=1 下一个 */
  shiftProposal: (nodeId: string, dir: 1 | -1) => void;
  /** 让 AI 就地推演三种走向（与工坊节点卡同一套逻辑），整台替换本节点的方案 */
  deriveProposals: (nodeId: string) => Promise<boolean>;
  /** 在方案卡上换掉首/尾帧：dataUrl 为本地图（上锁，AI 重画时不动它）；
   *  空串 = 清掉这一帧交回 AI（解锁） */
  setFrame: (nodeId: string, which: "first" | "last", dataUrl: string) => void;
  /** 按用户改过的剧情/换过的帧，让 AI 重画**这一套**方案的画面（不重写剧情——
   *  那是用户刚敲的字，重写等于把它抹了） */
  regenProposal: (nodeId: string) => Promise<boolean>;

  /** 在末尾追加一段。★ 上一段没出片时拒绝（见 canAdvance 那段注释） */
  addNode: () => void;
  removeNode: (id: string) => void;
  setCursor: (i: number) => void;
  shiftCursor: (dir: 1 | -1) => void;

  addAnn: (nodeId: string, ann: Omit<FlowAnn, "id">) => void;
  removeAnn: (nodeId: string, annId: string) => void;

  /** 给这一段挂素材卡（拖一整个卡组进来就是整组）。按 id 去重，返回**真正新增**的张数——
   *  调用方靠它决定要不要抖那一下：一张没加还抖，等于骗用户说加上了 */
  addMaterials: (nodeId: string, cards: Card[]) => number;
  removeMaterial: (nodeId: string, cardId: string) => void;

  /** 生成/重生成某节点：先按圈选改设定帧，再承接上一段真尾帧起拍，最后出片 */
  genNode: (id: string) => Promise<boolean>;

  /**
   * 出片结束（成/败）留下的"待读通知"。给全局悬浮胶囊（GenerationPill）读的：
   * 生成期间用户可以离开工作流页去逛（genNode 全程活在这个 store 里，站内切页
   * **不会**中断——2026-08-20 之前浮层上那句"中途离开会中断"是架构早期的陈旧恐吓），
   * 结束时人不在页上，就靠它把人叫回来。回到 /flow 即清（FlowPage 挂载时清）。
   */
  genNotice: { ok: boolean; msg: string } | null;
  /**
   * 「现在跑着的是哪一炉」的令牌 —— 每次开跑 +1。
   * ★★ 为什么需要（2026-08-21 第七轮扫描的 high）：出片是几分钟的异步，而这期间用户
   *   完全可以把整条流水线换掉或删掉那一段。老那一炉回来时会照旧 `set({ busy: false })`
   *   —— 而那时新的一炉可能已经在跑，于是「同一时刻只炼一段」这道闸被一个**已经作废的
   *   回包**打开，可以并发出第三炉。回包只有在"还是我这一炉"时才有资格动 busy。
   */
  genRun: number;
  clearGenNotice: () => void;
}

export const useFlow = create<FlowState>()((set, get) => ({
  nodes: [],
  cursor: 0,
  mode: "workflow",
  origin: "solo",
  busy: false,
  err: "",
  genNotice: null,
  genRun: 0,
  clearGenNotice: () => set({ genNotice: null }),
  template: null,
  subject: "",
  cast: {},
  castErr: "",
  castFallback: "",
  castBusy: false,
  castNodeId: null,

  // ★ template/subject（连同挂卡那两格，见 clearTemplate）必须一起清：工坊铺过来的是
  //   workflow 模式的节点，而模板栏只在 simple 模式渲染。留着上一轮简约模式的模板，
  //   NodeScreen 会把剧情编辑框换成模板的「一句话」输入框，且没有「不用」可点；在那里
  //   打字会走 setSubject，把工坊 AI 推演出来的剧情/标题/时长按模板配方整个覆盖掉。
  //   （seedSolo 与 reset 本来就清了）
  canReplaceNodes: () => {
    const s = get();
    const i = s.nodes.findIndex((n) => n.status === "generating");
    if (!s.busy && i < 0) return true;
    set({
      err: `第 ${i >= 0 ? i + 1 : s.cursor + 1} 段正在生成中（钱已经在花了）——换掉流水线不会把它停下，回包时那笔钱照扣、成片却落在一条已经不存在的流水线上。等它跑完再来`,
    });
    return false;
  },
  seed: (nodes, opts) => {
    if (!get().canReplaceNodes()) return false;
    set({ nodes, cursor: 0, mode: opts.mode, origin: opts.origin, busy: false, err: "", ...clearTemplate() });
    return true;
  },
  seedSolo: (mode) => {
    if (!get().canReplaceNodes()) return false;
    set({
      nodes: [newFlowNode(0, { chain: false })],
      cursor: 0,
      mode,
      origin: "solo",
      busy: false,
      err: "",
      ...clearTemplate(),
    });
    return true;
  },

  applyTemplate: (t) => {
    // ★ 与 seed/seedSolo 同一道闸（第八轮扫描：上一版只给那两处加了，而这两处同样是整表覆盖）
    if (!get().canReplaceNodes()) return false;
    // ── 白模模板（存在性判定，types.ts 的 ★）：只铺 1 个节点、chain=false ──
    // 多段在物理上不成立：段间承接的整个机制是「上一段**真实**尾帧顶替本段首帧」
    // （segmentGen 第②步），而首尾帧与参考媒体是方舟三大互斥场景——第 2 段要么发不出
    // r2v 任务、要么砍掉承接（那衔接就断了）。不发明新的承接规则，直接砍成单段。
    if (t.refVideo) {
      // 档位钳到 refVid=true 的档（首发只有 ultra；免费用户吃 paidOnly 的既有拦截）。
      // ★ 四档全 false 的今天，这里就是**闸门本身**：整句拒绝、什么都不铺。
      //   开闸 = 仓库主人翻 economy 里 ultra.refVid 那一个布尔的 commit，这里自动放行
      //   ——refVid 的唯一出处是 VIDEO_TIERS，别在这里另记一份"开没开"。
      const gate = VIDEO_TIERS.find((x) => x.refVid);
      if (!gate) {
        set({ err: "白模模板出片暂未开放：还没有档位支持白模（r2v）出片，等开放后再来" });
        return false;
      }
      // ★★ 模板视频本身过不了方舟窗口时**当场整句拒、什么都不铺**（判据唯一实现在
      //   data/templates.refVideoIssue，这里只是问它一次）。2026-08-16 之前这里零校验：
      //   3.7 秒的坏模板照样铺出一个节点，用户挂完卡、点了生成，才在方舟那儿撞英文 400
      //   —— 那句 400 全 app 没人接（没有全局 error toast），等于静默失败。
      //   ⚠ 拒绝要走 `err`：调用方（详情页 apply / 市场页）靠返回 false + err 把原因印出来。
      const refIssue = refVideoIssue(t.refVideo);
      if (refIssue) {
        set({ err: refIssue });
        return false;
      }
      const node = newFlowNode(0, {
        chain: false,
        // 白模模板自己不带卡（提取时认不出素材卡，cards 恒空）——「换成谁」由用户
        // 往节点上挂自己的角色卡；万一带了就原样挂上。
        // ★ V2（有角色位）上这一格只是**开场值**：挂完卡之后 materials 由 applyCast
        //   整表重写（角色位是"谁换成谁"的唯一出处，见那里的对齐规则）
        materials: t.cards.length ? t.cards : undefined,
        videoTier: gate.id,
        // 预览容器的横竖跟着模板登记的宽高走。真正的出片画幅是 adaptive 跟随源片
        // （arkClient 的 BLOCKOUT_TASK），这里只决定界面框怎么摆；方形归横屏——
        // 只有竖/横两档时，横容器上下留黑边比竖容器左右裁切诚实
        aspect: t.refVideo.height > t.refVideo.width ? "portrait" : "landscape",
      });
      // 时长 = 模板的（白模节点没有时长选择器）：显示跟登记值走，报价侧本来就不看
      // durationSec（economy.segmentCost 的 refVideo 位）。不过 clampDuration 的 10s
      // 上限——那是纯 t2v 档位的产品约束，edit 输出≈输入是协议行为（见 r2vTokens）
      node.proposals[0].durationSec = t.refVideo.durationSec;
      set({
        nodes: [node],
        cursor: 0,
        mode: "simple",
        origin: "solo",
        busy: false,
        err: "",
        ...clearTemplate(),
        // ★ roles 跟着快照走（**只在真有的时候才带这个键**，存在性语义同 data/templates
        //   的 rolesOf）：出片时 genNode 从这里读它决定走点名路还是泛指老路
        template: snapTpl(t),
      });
      return true;
    }
    set({
      // 一个 beat 一段。段与段之间沿用尾帧续作（chain），模板才有连贯性
      nodes: t.recipe.beats.map((_, i) =>
        newFlowNode(i, {
          chain: i > 0,
          materials: t.cards.length ? t.cards : undefined,
          videoTier: t.recipe.videoTier,
          // 配方没写画幅 = 画幅可选之前存的老模板，那时一律 16:9
          aspect: t.recipe.aspect ?? "landscape",
        }),
      ),
      cursor: 0,
      mode: "simple",
      origin: "solo",
      busy: false,
      err: "",
      ...clearTemplate(),
      // 经典模板没有角色位（roles 只在白模 V2 上存在），这里连键都不带
      template: { id: t.id, title: t.title, recipe: t.recipe, cards: t.cards },
    });
    return true;
  },

  applyTemplateGroup: (parts) => {
    if (parts.length === 0) return false;
    if (!get().canReplaceNodes()) return false; // 理由同 applyTemplate
    if (parts.length === 1) return get().applyTemplate(parts[0]);
    const gate = VIDEO_TIERS.find((x) => x.refVid);
    if (!gate) {
      set({ err: "白模模板出片暂未开放：还没有档位支持白模（r2v）出片，等开放后再来" });
      return false;
    }
    // 整组先验完再铺（与 applyTemplate 同一道 refVideoIssue 闸）：第 3 段是坏的却铺出
    // 前两段，用户炼到一半才发现走不下去 —— 钱已经花在前两段上了
    for (let i = 0; i < parts.length; i += 1) {
      const p = parts[i];
      if (!p.refVideo) {
        set({ err: `第 ${i + 1} 段不是白模模板，这一组没法整组套用` });
        return false;
      }
      const issue = refVideoIssue(p.refVideo);
      if (issue) {
        set({ err: `第 ${i + 1} 段：${issue}` });
        return false;
      }
    }
    const nodes = parts.map((p, i) => {
      const node = newFlowNode(i, {
        // ★ chain=false：每段各自复刻**自己的子片段**，衔接由原片本身保证 ——
        //   不走尾帧承接（首尾帧与参考媒体在方舟互斥，applyTemplate 单段那条 ★ 的同款理由）
        chain: false,
        materials: p.cards.length ? p.cards : undefined,
        videoTier: gate.id,
        aspect: p.refVideo!.height > p.refVideo!.width ? "portrait" : "landscape",
      });
      node.tpl = snapTpl(p);
      node.proposals[0].durationSec = p.refVideo!.durationSec;
      return node;
    });
    set({
      nodes,
      cursor: 0,
      // ★ workflow 而不是 simple：分段组要看得见段导航条（简约恒单段没有它），
      //   「炼完本段才能去下一段」的顺序门禁由 clampCursor 照常执行
      mode: "workflow",
      origin: "solo",
      busy: false,
      err: "",
      ...clearTemplate(),
      // store 级跟第 1 段走（旧读点的兜底；切段由 setCursor 同步，见 FlowNode.tpl 的 ★）
      template: nodes[0].tpl!,
    });
    return true;
  },

  setNodeTemplate: (nodeId, t) => {
    const s0 = get();
    if (s0.busy) {
      set({ err: "正在生成中，等它跑完再换模板" });
      return false;
    }
    const idx = s0.nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return false;
    const node = s0.nodes[idx];
    // ★ 已出片整句拒：换模板 = 这段成片作废重炼，那笔钱不能被一次点击静默作废。
    //   想换的路仍然开着：先「重新生成」（用户自己按下的重炼）或删除本段重加。
    if (nodeDone(node)) {
      set({ err: "这一段已经出片：换模板会作废这段成片。想换就删除本段重加，或先接受重炼这一段的花费" });
      return false;
    }
    if (!t) {
      // ★★ 本来就没套模板 → 整句拒（2026-08-21 第六轮对抗评审确认的 high）。
      //   这一支不是"什么都不做"，它会清掉 materials/cast 并把 plot 清空、时长退回 5s。
      //   对一个普通段来说那是**纯破坏**：推演出来的剧情（真花过钱）、挂上的素材卡、
      //   改过的段时长一起没，而 TemplatePicker 里那行「✂️ 不用模板（退回普通段）」
      //   对普通段读起来就是"取消"，用户点它是想关掉弹层。
      //   agent 那条路早就判了这一下（canvasAgent 的 untemplate 分支），弹层这条漏了。
      if (!tplOfNode(node)) {
        set({ err: `第 ${idx + 1} 段本来就没套模板，不用摘（想关掉这个弹层点右上角的 ✕）` });
        return false;
      }
      // 摘模板：退回普通段。挂卡/素材/合成句一起清（旧映射对"没有模板"毫无意义）
      set((s) => ({
        err: "",
        // ★ 摘模板写的是 **null**（明确没有），不是 undefined（还没表态）—— 见 tplOfNode 的 ★★
        nodes: pinUnstatedTpl(s.nodes, s.template).map((n) =>
          n.id === nodeId ? { ...n, tpl: null, materials: undefined, cast: undefined } : n,
        ),
        // ★ 这一段的挂卡三态跟着作废：旧的失败提示与骨架点的是已经不存在的角色位，
        //   留着的话下次回到这一段又原样弹出来（第四轮验证抓到的"永远挂着"）
        ...(s.castNodeId === nodeId ? { castErr: "", castFallback: "", castNodeId: null } : {}),
        ...(s.cursor === idx ? { template: null, cast: {} } : {}),
      }));
      get().updateProposal(nodeId, { plot: "", durationSec: 5 });
      return true;
    }
    // 换/套模板：与 applyTemplateGroup 铺节点走同一批规则（refVid 闸、窗口闸、快照、清挂卡）
    const gate = VIDEO_TIERS.find((x) => x.refVid);
    if (!gate) {
      set({ err: "白模模板出片暂未开放：还没有档位支持白模（r2v）出片" });
      return false;
    }
    if (!t.refVideo) {
      set({ err: "这不是白模模板（只有白模模板能按段套用）" });
      return false;
    }
    const issue = refVideoIssue(t.refVideo);
    if (issue) {
      set({ err: issue });
      return false;
    }
    const tplSnap = snapTpl(t);
    set((s) => ({
      err: "",
      // ★ 其余"还没表过态"的段在这一刻钉住（唯一实现见 pinUnstatedTpl 的 ★★）
      nodes: pinUnstatedTpl(s.nodes, s.template).map((n) =>
        n.id === nodeId
          ? {
              ...n,
              tpl: tplSnap,
              // 模板自带卡照 applyTemplate 的口径；挂卡结果清零（旧映射对新模板全错）
              materials: t.cards.length ? t.cards : undefined,
              cast: undefined,
              chain: false, // 白模段复刻自己的素材，不走尾帧承接（applyTemplateGroup 同款 ★）
              videoTier: gate.id,
              aspect: t.refVideo!.height > t.refVideo!.width ? "portrait" : "landscape",
            }
          : n,
      ),
      // 换的是当前段：store 级模板与挂卡缓冲同步（setCursor 同款职责）
      // ★ 换模板同样要作废那一段的挂卡三态（上一版只在摘模板那支加了，这支漏了）：
      //   旧的失败提示与骨架点的是**上一个模板**的角色位，对新模板毫无意义；
      //   留着的话下次回到这一段又原样弹出来，点「填入默认写法」还会把上个模板的骨架
      //   写进新模板段的 plot（那正是"按错的人偶点名"）
      ...(s.castNodeId === nodeId ? { castErr: "", castFallback: "", castNodeId: null } : {}),
      ...(s.cursor === idx ? { template: tplSnap, cast: {} } : {}),
    }));
    get().updateProposal(nodeId, { plot: "", durationSec: t.refVideo.durationSec, firstFrame: "", lastFrame: "" });
    return true;
  },

  setSubject: (subject) =>
    set((s) => {
      const rec = s.template?.recipe;
      if (!rec) return { subject };
      // ★★ V2 白模（有角色位）：**只记下这句话，绝不回填 plot**。那一格里装的是编辑页
      //   合成好的点名映射（「编号 4 的白色人偶替换为角色「张三」」），拿配方骨架盖掉它
      //   等于点名整段消失、退回泛指 —— 而泛指实测会漏人（F4：只换配角、主角不动），
      //   表现是画面照出、钱照收、零报错。V2 那句话的去处是 applyCast 的合成
      //   （揉进点名句里，见 node.requirement），不走 {{主题}} 填空这条路。
      //   界面上 V2 本来就不渲染那个「一句话」输入框（FlowPage），这里是第二道闸：
      //   这条规则一旦只活在 UI 里，换个入口调 setSubject 就会静默把点名句抹掉。
      if (s.template?.roles?.length) return { subject };
      // ★★ **混合/分段流水线一律只记这句话**（2026-08-21 第三轮验证）：下面那段是拿
      //   store 级配方的 beats **整表覆盖每一段**的 plot/title/时长，而 store 级那份只是
      //   "光标段的模板"。分段模板组（各段自带快照）或混合流水线里，在「一句话」框里
      //   敲一个字，就会把别段推演出来的剧情、改过的时长按**当前这一段**的配方抹平 ——
      //   而那些段可能已经花钱出过片。整表填空只对"整条流水线共用一份模板"的单模板流成立，
      //   判据就是"没有任何一段自带 tpl"（三态里的 undefined 才是单模板流的形状）。
      if (s.nodes.some((n) => n.tpl !== undefined)) return { subject };
      // 白模的段时长跟模板**登记值**走（recipe.durationSec 是留给老客户端经典降级路的数）：
      // 填空这一步别把它改回配方数——报价虽不看它（r2v 按登记时长算），但界面上显示的
      // 段时长与实际出片时长（edit 输出≈输入）对不上，也是一种骗人（铁律八）
      const dur = s.template?.refVideo?.durationSec ?? rec.durationSec;
      // 每段剧情 = 骨架填空 + 画风要求。画风每段都带一份而不是只写一次——
      // Seedance 是按段独立调用的，只在第一段写画风，后面几段会各画各的
      return {
        subject,
        nodes: s.nodes.map((n, i) => {
          const beat = fillSubject(rec.beats[i] ?? rec.beats[rec.beats.length - 1] ?? "", subject);
          const plot = subject.trim() ? `${beat}\n画面要求：${rec.styleHint}` : "";
          return {
            ...n,
            proposals: n.proposals.map((p) =>
              p.id === n.chosenId ? { ...p, plot, title: `${s.template!.title} · 第 ${i + 1} 段`, durationSec: dur } : p,
            ),
          };
        }),
      };
    }),

  applyCast: async (next) => {
    const s0 = get();
    // ★ 与别的动作一样让位给在途生成，但**要说一句**：这一步是用户刚从编辑页点了
    //   「完成挂卡」回来的，静默 return 的表现就是"挂了半天，回来什么都没变"（铁律八）
    if (s0.busy) {
      set({ err: "这一段正在生成中，等它跑完再改挂卡（改了也得重炼一次，别白花一次钱）" });
      return false;
    }
    // ★ 2026-08-20 起"本段"= 光标段：分段模板组一次铺 N 个白模节点，各挂各的卡。
    //   模板读 tplOfNode（分段组每节点自带快照；单模板流它退回 store 级，行为不变——
    //   那条"恒单段"的老注释说的就是单模板流，addNode 对白模照旧拒绝追加）。
    const node = s0.nodes[s0.cursor] ?? s0.nodes[0];
    // ★★ 走 tplOfNode，**不是** `node?.tpl ?? s0.template`（2026-08-21 验证轮抓到的 high：
    //   三态收口时漏了这一处读点，注释写着"模板读 tplOfNode"而代码写的是 `??`）。
    //   差别在 `tpl === null`（明确没有模板 —— 正是摘过模板的段与 addNode 造的新段）：
    //   `??` 对 null 会退回 store 级，而 store 级是**当前光标那一段**留下的陈旧快照，
    //   于是挂卡会落在一个根本没有模板的段上，按别段的角色位写 materials/cast、重写 plot。
    const tpl = tplOfNode(node);
    const roles = tpl?.roles;
    if (!tpl?.refVideo || !roles?.length || !node) {
      // ★★ 这句话改过一次（2026-08-21 第三轮验证）。原文是「这条流水线上没有可挂卡的
      //   白模模板——回模板市场重新套用一次」，三处都不对：
      //   ① **事实错**：多段流水线里别的段可能正套着白模模板，"这条流水线上没有"读起来就是个 bug；
      //   ② 不指名道姓说是第几段（旁边每一句拒绝语都指了）；
      //   ③ **出路是破坏性的** —— 照它去模板市场重套走的是 applyTemplate，那是整表覆盖
      //      `nodes`，会把这条流水线连同已经花钱炼出来的段一起抹掉。指一条会毁片的路，
      //      比不指路更糟。正确的出路是本段编辑窗里的「🧪 套模板」（setNodeTemplate，只动这一段）。
      const at = node ? `第 ${s0.nodes.indexOf(node) + 1} 段` : "这一段";
      set({
        err: `${at}没有套可挂卡的白模模板（角色位只有白模模板才有）——在这一段的编辑窗点「🧪 套模板」选一个，别去模板市场重套（那会整条流水线重铺）`,
      });
      return false;
    }
    // ★ 这一整段的措辞按方案分支：判据只问 data 层那一处（markSpecOf / markNoun），
    //   别在这里写 `tpl.markSlots ? "位置" : "编号"`。对着一群一模一样的白人偶说"编号 3"，
    //   用户在画面上永远找不到那个东西 —— 一句过时的指路和一个坏功能长得一模一样
    // ★★ `spec` 里还带着那份顺序表，合成提示词时的**升序排序**就靠它（orderSlots）——
    //   所以这里传下去的必须是整个 spec，不是一个光秃秃的方案枚举
    const spec = markSpecOf(tpl);
    const noun = markNoun(spec);

    // ★★ 下面几道拒绝**一律不写 cast**：`cast`（映射）/ `materials`（真发出去的形象图）/
    //   `plot`（点名句）是一个整体，只在三样都成立时一起换。半推半就地只更新映射，
    //   界面就会显示"已挂 4/4"，而出片用的还是上一轮那份点名句与那批卡 —— 用户按界面
    //   判断、按旧映射出片，正是这条链路最要防的那种错。代价是被拒时要重挂一次，
    //   而这两种拒绝（卡没了 / 重名）本来就得回编辑页去改。
    //
    // ── 编号 → 卡：只认**本账号素材库里真存在**的卡 ──
    // ★ 编辑页交回来的是 id（history state 塞不下 1MB 的卡面，见 VideoEditorPage 顶部
    //   注释），所以这一刻才现查。查不到不是小事：界面上那个位子显示"？"，映射里却还
    //   留着一个 id —— 不拦的话出片时它既没有形象图、点名句里又白白点了它的名，
    //   模型只能自己编一个人出来，钱照扣（铁律八）。
    // ── 挂不上的编号：超出上限的，以及**作者已经删掉的那个位子** ──
    // ★ 上限那一半今天走不到（挂卡面板压根不给超出的位子挂卡按钮），留着是**断言**：真收到了
    //   就说明有人绕过了那一处（老草稿、老服务端多编了几个位子），而静默丢掉的表现是
    //   "我明明挂了 10 号，出片时它还是白模"——挂了、付了钱、画面没变，零报错（铁律八）。
    // ★ "被删掉"那一半**天天走得到**：作者核对编号时删位是常规操作（整份替换），
    //   而挂卡映射是本机存着的旧那份 —— 所以下面的拒绝语必须分清是哪一种（见 ★★）。
    const { castable } = splitCastRoles(roles);
    const canCast = new Set(castable.map((r) => r.label));
    const stray = Object.keys(next).filter((label) => !canCast.has(label));
    if (stray.length > 0) {
      // ★★ 拒绝的**原因分两类**，不许都说成"超过上限"（2026-08-15 修）：删掉一个角色位
      //   已经是常规操作了（方舟画的编号会重号、会缺号，作者对着画面把找不到的那个位子
      //   删掉是**唯一不用再花一次钱**的修法），于是最常见的 stray 恰恰是"作者删了这个位子"
      //   —— 告诉用户"一个模板最多 9 个角色位"是一句我们亲手制造的谎话，他会照着去数
      //   自己挂了几张，怎么数都对不上。
      // ★ 判据仍只有一处（splitCastRoles）：这里只是把已经算出来的信息分成两类。
      //   在 `roles` 里但挂不上 = 超出上限；根本不在 `roles` 里 = 那个位子已经没了。
      const known = new Set(roles.map((r) => r.label));
      const overCap = stray.filter((l) => known.has(l));
      const removed = stray.filter((l) => !known.has(l));
      const why = [
        overCap.length > 0
          ? `${noun} ${overCap.join("、")} 超出了一次能挂卡的 ${BLOCKOUT_MAX_ROLES} 个上限（${
              spec.scheme === "ordinal" ? "人再多，从左数到第几个也数不准了" : "再多的编号在画面上也认不出来"
            }）`
          : "",
        removed.length > 0
          ? `${noun} ${removed.join("、")} 这个位子已经被模板作者在核对${noun}时删掉了（多半是因为${
              spec.scheme === "ordinal" ? "画面上那个人根本没被换成人偶" : "画面上根本找不到这个号"
            }）`
          : "",
      ]
        .filter(Boolean)
        .join("；");
      set({
        err: `${why}——这些位子挂的卡不能生效，它们会保持人偶原样。回挂卡那一屏点「取下这几张」再完成挂卡`,
      });
      return false;
    }
    const mine = new Map(myCards().map((c) => [c.id, c]));
    const slots: BlockoutCastSlot[] = [];
    const missing: string[] = [];
    for (const r of castable) {
      const id = next[r.label];
      const card = id ? (mine.get(id) ?? null) : null;
      if (id && !card) missing.push(r.label);
      // ★ `desc`（原来是谁，给 chat 读）与 `mark`（白模视频里那个人偶什么样，写进括号）
      //   是**两位**，别合并 —— 理由见 blockoutPrompt.BlockoutCastSlot 的 ★★★。
      //   取值只有 markDescOfLabel 一处（连接键 markSlots.indexOf(label)，与框同源）。
      slots.push({ label: r.label, desc: r.desc, mark: markDescOfLabel(tpl, r.label), card });
    }
    if (missing.length > 0) {
      set({
        err: `${noun} ${missing.join("、")} 挂的卡在这台设备的素材库里找不到（可能已被删掉，或属于另一个账号）——回去重新挂一张，或先把它取下`,
      });
      return false;
    }
    const taken = slots.filter((s): s is BlockoutCastSlot & { card: Card } => !!s.card);
    if (taken.length === 0) {
      // 一张都没挂（含"把之前挂的全取下"）：**如实落下去再拒**。
      // ★ 不落的话，编辑页下次打开还显示着用户已经取下的那些卡（界面在撒谎）。
      // ★ 上一轮合成的那段点名句必须一并撤掉：它点的是已经取下的卡，留着就是一份
      //   **旧映射** —— 按旧映射出片正是"换错人且零报错"。清掉不会让用户白干，
      //   因为这个状态本来就出不了片（门口的 blockoutIssue 拦着，理由同下面这句）。
      set({
        cast: {},
        castErr: "",
        castFallback: "",
        castNodeId: null,
        err: "一个角色位都没挂卡：白模出片全靠卡上的形象图说明「换成谁」，一张都不挂的话出不了片——回去至少挂一张",
      });
      // ★ node.cast 一并清（第三轮验证抓到）：不清的话按钮还印着「已挂 4/4」而 materials
      //   已经没了；而且切段一来一回，setCursor 会把这份旧映射灌回缓冲，goCast 再拿它当初值
      get().updateNode(node.id, { materials: undefined, cast: undefined });
      get().updateProposal(node.id, { plot: "" });
      return false;
    }
    // ★★ 重名硬拦：合成句说「编号4=张三」，出片时的绑定句说「张三=@图片2」——
    //   两句是靠**角色名**接上的（图片编号 M 在合成那一刻还不存在，理由见
    //   blockoutPrompt.blockoutApplySkeleton 的 ★）。两张**不同**的卡重名，这个连接键
    //   就失效了：模型只能在两张脸里挑一张，挑错了就是张三换到李四身上，
    //   而画面照出、零报错。同一张卡挂在两个位子上是合法的（用户就是要同一个人），
    //   所以判的是"名字相同但 id 不同"。
    const byName = new Map<string, string>();
    for (const s of taken) {
      const seen = byName.get(s.card.name);
      if (seen && seen !== s.card.id) {
        set({
          err: `有两张不同的卡都叫「${s.card.name}」（${noun} ${s.label} 挂的是其中一张）——出片时靠角色名把形象图接到这个位子上，重名就分不出谁是谁，会换错人。请给其中一张改个名字，或换一张卡`,
        });
        return false;
      }
      byName.set(s.card.name, s.card.id);
      // ★ 同一条连接键的**另一半**：两段话都用 `=`、`；`、`、` 分隔（2026-08-15 紧凑化），
      //   名字里混进这几个符号，模型会把一条绑定读成两条 —— 与重名是同一种故障
      //   （换错人、零报错），所以在同一处、同样在花钱之前拦下（判据唯一实现在
      //   blockoutPrompt.castNameIssue，别在界面上再判一遍）。
      const nameIssue = castNameIssue(s.card.name);
      if (nameIssue) {
        set({ err: `${noun} ${s.label} 挂的这张卡不能这么用：${nameIssue}` });
        return false;
      }
    }

    // ── materials：按**角色位原序**落盘，同一张卡只落一次 ──
    // ★★ 顺序决定的**不是**"谁是谁"（那由角色名连接，见上面重名那条），而是
    //   **预算不够时谁先被挤掉**：一次出片带的参考图有预算上限，多出来的卡只按文字参与
    //   （规则的唯一实现在 ai/real.allocateRefs，这里绝不复述；白模路的预算已经跟随
    //   方舟协议放到 30 张，9 个角色位挤不掉谁，但这个顺序仍是那条规则的输入）。
    //   用 `roles` 的原序，是因为那正是编辑页角色位列表的显示顺序，也是那一页
    //   「多出来的会被挤掉」那句提醒所指的顺序 —— 在这里另排一次（比如按编号数值排），
    //   用户看到的顺序与真正被挤掉的那张就对不上了。
    // ★ 整表**覆盖**而不是追加：V2 白模节点的素材卡 ≡ 挂卡结果（唯一出处是角色位）。
    //   追加的话，上一轮挂过、这一轮取下的卡还赖在 materials 里 —— 它没有任何编号点它，
    //   却照样占一张参考图配额，把真正要换的那张挤掉。
    const mats: Card[] = [];
    for (const s of taken) if (!mats.some((m) => m.id === s.card.id)) mats.push(s.card);
    // 映射也只留"角色位上真有的"那些键：编辑页可能带回已经删掉的位子（换了模板/老 state）
    const cleaned: Record<string, string> = {};
    for (const s of taken) cleaned[s.label] = s.card.id;

    // ★ 领令牌（第八轮扫描：applyCast 是 busy 的第四个持有者，上一版漏了它）——
    //   这次合成的 chat 没有超时包装，弱网下可以挂很久；无条件清 busy 的话，
    //   一个已经作废的回包会把「同时只炼一段」的闸打开
    const myRun = get().genRun + 1;
    set({
      busy: true,
      castBusy: true,
      err: "",
      castErr: "",
      castFallback: "",
      cast: cleaned,
      castNodeId: node.id,
      genRun: myRun,
    });
    // cast 同时落到节点上：分段组切段时编辑缓冲要换成**那一段自己的**挂法
    // （setCursor 负责换），不落节点的话切回来面板就是空的，而出片用的还是旧映射
    get().updateNode(node.id, { materials: mats, cast: cleaned });

    // 作者补充的那句话：**直接读 requirement**，不走 requirementOf ——
    // ★ 那个兜底会在 requirement 缺席时退回 `chosenOf(node).plot`，而 plot 里装的正是
    //   上一次合成出来的点名长句：拿它当"用户补充的一句话"再合成一次，两段点名句会
    //   叠在一起越滚越长，最后把 VIDEO_PROMPT_MAX 撑爆。
    const line = (node.requirement ?? "").trim();
    try {
      // ★ 这一次合成是一次 chat（豆包）。方案第六章的计价表里**没有这一笔** ——
      //   那条链路上要花的三笔真钱是「看帧列人物 / 白模化出片 / 套用出片」，这一次与
      //   npcChat 同口径：不报价、也不扣。要收就得两仓同时加（报价=实收是逐条相等的，
      //   见 CLAUDE.md「两仓价目表各写各的」），**别在这里单方面扣一笔**。
      // ★ 没配 ARK_API_KEY 的 mock 构建里它直接返回骨架（不是静默降级 —— 骨架本身
      //   就是第五章那份模板，chat 只负责把作者那句话揉顺，见 composeBlockoutPrompt 的 ★）。
      const text = await composeBlockoutPrompt(slots, line, spec);
      get().updateProposal(node.id, { plot: text });
      // ★ busy 只在"还是我这一炉"时清（见 genRun 的 ★★）；castBusy/castErr 是本次挂卡
      //   自己的状态，无论如何都要落（否则那一段的框会永远禁着）
      set(get().genRun === myRun ? { busy: false, castBusy: false } : { castBusy: false });
      // 挂完卡就把"现在还出不了片"的原因先说了（判据仍只活在 segmentGen.blockoutIssue
      // 一处，这里只是提前问它一次）：卡上没有形象参考图这类问题，等用户点了「生成本段」
      // 才说等于白让他期待一轮
      const issue = blockoutIssue({
        videoTier: node.videoTier,
        materials: mats,
        firstFrame: chosenOf(node).firstFrame,
        carryFrame: null,
        anns: node.anns,
        // ★ 与出片门口读同一份模板快照：少传这一位，这里就会说"可以出片了"、
        //   真点生成时才拒 —— 两句话自相矛盾比不说更糟
        refVideo: tpl.refVideo,
      });
      if (issue) set({ err: `挂卡已记下，但现在还出不了片：${issue}` });
      return true;
    } catch (e) {
      // 整句失败 + 一份可用的骨架（用户点了才填）。**绝不 catch 成空串**：
      // 空输入框与"还没写"长得一样，用户会以为自己随手写一句就够，出片时点名映射
      // 整个没发出去 —— 而换错人/漏换人是零报错的（blockoutPrompt 的 ★）
      // ★★★ 同时**必须把 plot 清掉**（与上面 taken.length===0 那一支同一条理由，
      //   2026-08-17 审查抓到这里漏了）：cast 与 materials 在 await 之前就已经换成
      //   这一轮的新映射了，而 plot 里还留着**上一轮**合成出来的那段点名句。
      //   两者一旦不同步，界面上是：琥珀色错误提示 + 一段读起来完整通顺的旧点名句，
      //   而主按钮只判 `!plot.trim()` —— 用户完全可以直接点「生成本段」，
      //   r2v 照常出片、照常扣钱，换上去的人却是按上一轮的映射来的。零报错。
      //   清掉之后按钮自然变灰，用户要么点「填入默认写法」（castFallback 就在手边），
      //   要么自己写 —— 两条路都不会把一份旧映射发出去。
      set({
        ...(get().genRun === myRun ? { busy: false } : {}), // 理由同上
        castBusy: false,
        castErr: e instanceof Error ? e.message : String(e),
        castFallback: blockoutApplySkeleton(slots, line, spec),
      });
      get().updateProposal(node.id, { plot: "" });
      return false;
    }
  },

  fillCastFallback: () =>
    set((s) => {
      // ★★ 认 castNodeId 不认 cursor（见那个字段的 ★★）：合成那十几秒里用户点一下别的段，
      //   光标就走了 —— 按光标写等于把这一段的骨架填进别人的 plot，而真正空着的那一段
      //   救它的按钮却不在。
      const node = s.nodes.find((n) => n.id === s.castNodeId) ?? s.nodes[s.cursor] ?? s.nodes[0];
      if (!node || !s.castFallback) return {};
      return {
        castErr: "",
        castFallback: "",
        nodes: s.nodes.map((n) =>
          n.id === node.id
            ? { ...n, edited: true, proposals: n.proposals.map((p) => (p.id === n.chosenId ? { ...p, plot: s.castFallback } : p)) }
            : n,
        ),
      };
    }),

  reset: () => set({ nodes: [], cursor: 0, busy: false, err: "", ...clearTemplate() }),

  updateNode: (nodeId, patch) => set((s) => ({ nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) })),

  updateProposal: (nodeId, patch) =>
    set((s) => {
      // 只有改到"用户写的东西"才置 edited：genNode 内部也用这个 action 回填首尾帧
      // （patchProp），那属于生成产物，不该让一个失败的生成把节点标成"用户改过"
      const authored = "title" in patch || "plot" in patch || "durationSec" in patch;
      return {
        nodes: s.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                ...(authored ? { edited: true } : {}),
                proposals: n.proposals.map((p) => (p.id === n.chosenId ? { ...p, ...patch } : p)),
              }
            : n,
        ),
      };
    }),

  setRequirement: (nodeId, v) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, requirement: v, edited: true } : n)) })),

  // 挑定一套 = 方案台落定：按钮从「重新生成方案」变回「生成本段」，这一套的帧与剧情
  // 从此可以逐字改（见 PlanBoard）。anns 清空同 shiftProposal：换了一套戏，对旧画面
  // 提的圈选要求不再适用
  chooseProposal: (nodeId, proposalId) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, chosenId: proposalId, plan: "picked", anns: [] } : n)),
    })),

  shiftProposal: (nodeId, dir) =>
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId || n.proposals.length < 2) return n;
        const i = n.proposals.findIndex((p) => p.id === n.chosenId);
        const j = (i + dir + n.proposals.length) % n.proposals.length;
        // 换走向 = 换了一段戏，之前对旧走向画面提的圈选要求不再适用
        return { ...n, chosenId: n.proposals[j].id, plan: "picked", anns: [] };
      }),
    })),

  deriveProposals: async (nodeId) => {
    const s0 = get();
    // ★ 2026-08-21：busy 早退必须说话（原来是静默 false）。画布的 agent 提案卡会拿
    //   `st().err` 判成败 —— 不写 err 的话，第二张卡会被当成"已点火"报绿勾，而那一段
    //   一个 token 都没花、什么都没排队（对抗评审确认的静默失败）。
    //   同款写法见 setNodeTemplate / applyCast 的 busy 分支。
    if (s0.busy) {
      set({ err: "有一段正在生成，等它跑完再推演下一段" });
      return false;
    }
    const idx = s0.nodes.findIndex((n) => n.id === nodeId);
    const node = s0.nodes[idx];
    if (!node) return false;
    // 按发计价档（真人档）没有方案台——判定在 economy.deriveIssue 一处。
    // UI 已把推演入口换成直出，这里是兜底（agent 确认卡那条路能绕过 UI 直呼本函数）
    {
      const flatIssue = deriveIssue(node.videoTier);
      if (flatIssue) {
        set({ err: flatIssue });
        return false;
      }
    }
    const cur = chosenOf(node);
    // 推演的依据是**用户那句话**，不是某一套方案的剧情（见 FlowNode.requirement）
    const req = requirementOf(node);
    if (!req.trim() && !node.materials?.length) {
      set({ err: "先写一句要拍什么（或从工坊带素材卡过来），我才好推演走向" });
      return false;
    }
    // ★ 真人卡门禁（判断在 economy.realFaceIssue 一处，铁律六）：推演画首尾帧同样把
    //   素材卡的形象参考喂给方舟（generateProposals → prepareMaterialRefs），真人照片
    //   一样整发被拒 —— 而这条路是**先扣费后开跑**（下面 spendTokens 在 await 之前），
    //   门禁必须立在扣费之前，不然就是"钱扣了、供应商拒了"。
    const realFaceBlocked = realFaceIssue(node.materials, node.videoTier);
    if (realFaceBlocked) {
      set({ err: realFaceBlocked });
      return false;
    }
    // 与工坊的 generateNode 同一口径：1 次豆包 + 最多 6 张 Seedream。
    // 这里以前既没有余额门槛也不扣费
    // 承接上一段尾帧时三个方案共用同一张开头帧，只画尾帧——图量减半，报价同步减半
    const prevOfCost = idx > 0 ? chosenOf(s0.nodes[idx - 1]) : null;
    const propCost = proposalsCost(!!(node.chain && prevOfCost?.lastFrame));
    if (AI_REAL && !canAfford(propCost)) {
      const w = walletOf();
      set({
        err: `推演一次约 ${fmtTokens(propCost)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不足——去「我的」页充值`,
      });
      return false;
    }
    const myRun = get().genRun + 1;
    set({ busy: true, err: "", genRun: myRun });
    if (AI_REAL) spendTokens(propCost);
    get().updateNode(nodeId, { status: "generating", progress: "推演三种走向…" });
    try {
      const prevNode = get().nodes[idx - 1];
      const prev = prevNode ? chosenOf(prevNode) : null;
      const fresh = await generateProposals(
        {
          index: idx,
          materials: node.materials ?? [],
          requirement: req,
          durationMode: "manual",
          durationSec: cur.durationSec,
          prevFrameSeed: prev ? `${prev.id}#last` : null,
          // 段间衔接：承接上一段已选走向的尾帧
          startFrame: node.chain && prev ? prev.lastFrame || null : null,
          aspect: node.aspect,
          pathPlots: get()
            .nodes.slice(0, idx)
            .map((n) => chosenOf(n).plot)
            .filter(Boolean),
        },
        (status) => get().updateNode(nodeId, { progress: status }),
      );
      // ★ 只保留**已经炼出成片**的旧走向（真金白银 + 几分钟，丢了补不回来）。
      //   以前是"有剧情就留"，那在"三套方案摊开挑一套"的流程下等于每重推一次方案台
      //   就多三行——推三次屏幕上就是九套，用户根本分不清哪三套是新的。
      const keep = node.proposals.filter((p) => node.videoByProposal[p.id]);
      get().updateNode(nodeId, {
        // ★ 顺手清掉 error（第十轮扫描）：它只在 genNode 开跑时清，
        //   于是“出片失败 → 改要求 → 重新推演成功”之后，三套崭新的方案上方
        //   永久挂着上一次那条红色失败原因，而用户最自然的下一步是
        //   再点一次付费的推演。推演成功 = 这一段翻篇了。
        error: undefined,
        proposals: [...fresh, ...keep],
        chosenId: fresh[0].id,
        // 推完是"摊开等挑"，不是"帮你选好了"：这一步之后按钮写「重新生成方案」
        plan: "picking",
        status: "idle",
        progress: "",
        anns: [],
      });
      // ★★ 也要写 genNotice（2026-08-21 第六轮对抗评审）：全局出片胶囊只认这个字段。
      //   推演是**开跑前就扣钱**的（上面 spendTokens 在 await 之前，catch 里也不退），
      //   而它一分钟级——用户正是在这段时间退出去逛（胶囊上就印着「点击返回」）。
      //   不写的话胶囊只是无声消失：钱花了、成没成没人告诉他（铁律八）。
      // ★ 只有"还是我这一炉"才有资格清 busy（见 genRun 的 ★★）
      set(get().genRun === myRun ? { busy: false, genNotice: { ok: true, msg: `第 ${idx + 1} 段推演好了三套方案` } } : {});
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      get().updateNode(nodeId, { status: "idle", progress: "" });
      set(
        get().genRun === myRun
          ? { busy: false, err: `推演失败：${msg.slice(0, 120)}`, genNotice: { ok: false, msg: `第 ${idx + 1} 段推演失败` } }
          : {},
      );
      return false;
    }
  },

  setFrame: (nodeId, which, dataUrl) =>
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const on = !!dataUrl;
        return {
          ...n,
          // 用户亲手指定开头帧 = 这一段不再从上一段的真实结尾起拍（尊重用户，与
          // FlowNode.chain 的注释同一条规则）。清掉时不自动恢复 chain——把它交还给
          // 「本段设置」里的开关，别替用户翻回去
          ...(which === "first" && on ? { chain: false } : {}),
          proposals: n.proposals.map((p) =>
            p.id === n.chosenId
              ? {
                  ...p,
                  [which === "first" ? "firstFrame" : "lastFrame"]: dataUrl,
                  pinned: { ...p.pinned, [which]: on || undefined },
                  // 换过的帧不再是"Seedream 没出图的占位帧"
                  degraded: undefined,
                }
              : p,
          ),
        };
      }),
    })),

  regenProposal: async (nodeId) => {
    const s0 = get();
    if (s0.busy) {
      set({ err: "有一段正在生成，等它跑完再重画这一套" }); // 理由同 deriveProposals 的 ★
      return false;
    }
    const idx = s0.nodes.findIndex((n) => n.id === nodeId);
    const node = s0.nodes[idx];
    if (!node) return false;
    const prop = chosenOf(node);
    if (!prop.plot.trim()) {
      set({ err: "这一套方案还没有剧情——先写点什么，我才知道要画成什么样" });
      return false;
    }
    // 承接上一段真实结尾的那张开头帧、以及用户自己上传的帧，一律不动（见 Proposal.pinned）
    const prevNode = s0.nodes[idx - 1];
    const prev = prevNode ? chosenOf(prevNode) : null;
    const keepFirst = keepFirstFrame(node, prop, prev);
    const keepLast = !!prop.pinned?.last;
    const cost = redrawCost(node, prop, prev);
    if (cost === 0) {
      set({ err: "首尾帧都是你自己换的图，没有可让 AI 重画的部分（想重画就先在卡里清掉那一帧）" });
      return false;
    }
    if (AI_REAL && !canAfford(cost)) {
      const w = walletOf();
      set({
        err: `重画这一套约 ${fmtTokens(cost)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不足——去「我的」页充值`,
      });
      return false;
    }
    const myRun = get().genRun + 1;
    set({ busy: true, err: "", genRun: myRun });
    get().updateNode(nodeId, { status: "generating", progress: "按修改重画画面…", regenning: true });
    try {
      // ★ 必须把本段画幅递下去：Seedream 的画布比例得与视频画幅一致，缺了它重画出来的
      //   帧是横的，喂给竖屏 Seedance 任务会被静默裁一刀（人物常被裁掉半个头）。
      //   见 CLAUDE.md「改了画幅却发现出片还是横的」那一条
      // 素材卡的形象参考图一并带上（与工坊 regenProposal 同一口径）：重画的是这一段的
      // 设定帧，人物当然还得是同一个人。哪张没采用要说出来 —— ★ 但**不能当场发**：
      // progress 只有一行，紧接着的"重画结束画面…"在同一个同步块里就把它盖了（保留首帧
      // 只重画尾帧时正是这条路），React 连画都没画过。挂在后面那几行的行尾才看得见（铁律八）
      const notes: string[] = [];
      const mat = await prepareMaterialRefs(node.materials, (n) => notes.push(n));
      const noteTail = notes.length ? `（${notes.join("；")}）` : "";
      const refUrls = mat.refs.length > 0 ? mat.refs : undefined;
      let first = prop.firstFrame;
      // 首帧没有底图 → 素材卡的图就是 <图片1>，offset = 0
      if (!keepFirst) {
        get().updateNode(nodeId, { progress: `重画起始画面…${noteTail}` });
        first = await generateCover(`${prop.plot.slice(0, 200)}${mat.bind(0)}`, undefined, node.aspect, refUrls);
      }
      let last = prop.lastFrame;
      if (!keepLast) {
        get().updateNode(nodeId, { progress: `重画结束画面…${noteTail}` });
        // 以开头帧当参考图：同一段戏的两帧必须是同一套人物/画风，各画各的会串味。
        // 有底图时它占 <图片1>，素材卡从 <图片2> 起 → offset = 1
        last = await generateCover(
          `${prop.plot.slice(0, 180)} 的结束瞬间${mat.bind(first ? 1 : 0)}`,
          first || undefined,
          node.aspect,
          refUrls,
        );
      }
      if (AI_REAL) spendTokens(cost); // 出图成功才扣，与 refineProposalFrame 同口径
      get().updateProposal(nodeId, { firstFrame: first, lastFrame: last, degraded: undefined });
      get().updateNode(nodeId, { status: "idle", progress: "", regenning: false, error: undefined });  // ★ 重画成功也算这一段翻篇了，别让上一次的红条挂着
      // 理由同 deriveProposals 末尾的 ★★：胶囊只认 genNotice，重画同样是先扣钱后开跑
      set(get().genRun === myRun ? { busy: false, genNotice: { ok: true, msg: `第 ${idx + 1} 段重画好了` } } : {});
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      get().updateNode(nodeId, { status: "idle", progress: "", regenning: false });
      set(
        get().genRun === myRun
          ? { busy: false, err: `重画失败：${msg.slice(0, 120)}`, genNotice: { ok: false, msg: `第 ${idx + 1} 段重画失败` } }
          : {},
      );
      return false;
    }
  },

  addNode: () =>
    set((s) => {
      // 白模模板只有一段：追加的下一段要么承接（承接帧与参考视频在方舟互斥，任务发不出去）、
      // 要么不承接（衔接断掉）——两头都不成立。拦在追加门槛这一处，与「先把这一段炼出来」
      // 是同一个门（CLAUDE.md：顺序门禁只在 clampCursor + addNode 两处，别在 UI 另写）
      // ★★ 判据是**最后那一段**（tplOfNode），不是 store 级 template（2026-08-21 对抗评审）：
      //   画布能给单独某一段套白模模板，于是流水线可以是 [白模, 普通, 普通] —— 读 store 级
      //   那份会因为"某一段是白模"就把整条流水线judge成白模流，从此再也加不了段，
      //   而用户接在后面的明明是普通段。反过来单模板流与分段组仍照旧拒（最后一段就是白模段）。
      const prev = s.nodes[s.nodes.length - 1];
      if (prev ? !!tplOfNode(prev)?.refVideo : !!s.template?.refVideo) {
        return { err: "白模复刻段只有一段：画面与运镜整个来自模板视频，没有可续的下一段" };
      }
      // 顺序门禁：只能在末尾追加，且上一段必须已出片
      if (prev && !nodeDone(prev)) return { err: "先把这一段炼出来，再加下一段" };
      // ★ 生成中也拒（2026-08-21 自查：两个面的 ＋ 本来就 `disabled={busy}`，但 **agent 的
      //   add_segment 绕过 UI 这道闸** —— 闸该在 store，UI 只是把"为什么点不动"画出来。
      //   追加本身不会让 genNode 的写回错位（末尾追加不改前面的下标，而且写回认 id），
      //   但它会把光标从正在炼的那一段拽走，用户眼睁睁看着进度条消失。
      if (s.busy || s.nodes.some((n) => n.status === "generating")) {
        return { err: "有一段正在生成中，等它跑完再加下一段（它炼完你才知道下一段从哪一帧接）" };
      }
      const i = s.nodes.length;
      // 画幅跟着上一段：一部片里前三段竖、第四段横，剪辑页合并只有一块画布，
      // 那一段必然被裁或补边
      const node = newFlowNode(i, {
        chain: !!prev,
        videoTier: prev?.videoTier ?? DEFAULT_TIER,
        aspect: prev?.aspect ?? DEFAULT_ASPECT,
      });
      if (prev) node.proposals[0].durationSec = chosenOf(prev).durationSec;
      // ★★★ 新段恒 `null`（明确没有模板），**不是** `s.template`（2026-08-21 验证轮抓到：
      //   第一版写成 `s.template ?? null`，把 high 从"可能被兜底读错"恶化成"当场写死"）。
      //   两条理由，缺一不可：
      //   ① `s.template` 不是全局真相，它是**当前光标那一段**的快照（setCursor 同步），
      //      而且切到 tpl 为 null 的段时**不回退**（那边的条件是 `tpl && tpl !== s.template`）
      //      —— 所以它常常是别段留下的陈旧值。用户点一眼第 1 段的成片再点「加一段」，
      //      新段就顶着第 1 段的白模模板出生：卡上冒 🧪、按 r2v 报价、出片把那份参考视频
      //      发给方舟（真扣钱，炼出来的是第 1 段的复刻）。
      //   ② 这个函数**两行前刚断言过**「最后那一段不是白模段」（读的是 tplOfNode(prev)，
      //      不是 store 级 —— 那句 ★★ 已经写明为什么不能信 store 级）。而工作流模式下
      //      store.template 非空时恒为白模快照（setNodeTemplate 拒非白模模板、
      //      applyTemplateGroup 整组白模、经典模板只出现在简约模式）。既然刚判过
      //      "接在后面的不是白模段"，新段的正确默认值就只能是"没有模板"。
      node.tpl = null;
      return { nodes: [...pinUnstatedTpl(s.nodes, s.template), node], cursor: i, err: "" };
    }),

  removeNode: (id) => {
    const s = get();
    // ★ 早退要说人话（铁律八）：静默 return 时，agent 那条路按"删完了没变"判失败，
    //   然后去读 store.err —— 读到的是**上一次别的操作**留下的那句，于是回执上会出现
    //   「✗ 删第 1 段：先把这一段炼出来，再加下一段」这种驴唇不对马嘴的解释。
    if (s.nodes.length <= 1) {
      set({ err: "只剩这一段了，删不掉（想重来就用「删除本段」旁边的重新生成，或退出去开一条新的）" });
      return;
    }
    // ★★ 生成中一律拒（第七轮扫描）：两个面的删段按钮都 `disabled={busy||generating}`，
    //   但 **agent 那条路绕过了 UI 这道闸**（remove_segment 只判 nodeDone，而正在炼的那一段
    //   videoByProposal 还没写，nodeDone 恰好为假）。删掉之后 genNode 回包按 idx 写回，
    //   越界抛错 —— 钱已经扣了、成片丢了，用户看到的是一句 JS 异常。
    //   ⚠ 删**别的**段同样拒：genNode 闭包里捏着 idx，删前面的段会让它整体前移，写回就打在另一段上。
    if (s.busy || s.nodes.some((n) => n.status === "generating")) {
      set({ err: "有一段正在生成中，等它跑完再删（现在删的话，那一炉的钱照扣、成片会落空）" });
      return;
    }
    const i = s.nodes.findIndex((n) => n.id === id);
    set({ nodes: s.nodes.filter((n) => n.id !== id) });
    // ★★ 走 setCursor，别自己 set 一个下标（2026-08-21 第三轮验证）：换段这件事还要把
    //   store 级模板与挂卡缓冲换成那一段自己的。自己 set 的话，删完之后这两样还停在
    //   **被删那一段**上 —— 线性视图的挂卡区按已经不存在的角色位渲染，挂法直接串段。
    //   画布那面靠"删完关窗、再点格子补齐"绕过去了，线性那面没有这个绕法。
    get().setCursor(Math.max(0, i));
  },

  setCursor: (i) =>
    set((s) => {
      const cursor = clampCursor(s.nodes, i);
      const tpl = s.nodes[cursor]?.tpl;
      // ★ 分段组：store 级模板跟着当前段走（旧读点的兜底，见 FlowNode.tpl 的 ★），
      //   挂卡编辑缓冲同步换成**这一段自己的**（node.cast；没挂过就是空）——
      //   带着上一段的挂法串段，出片映射就是错的
      // ★★ 挂卡缓冲**无条件**换成本段那份（原来跟在 `tpl !== s.template` 里）：两段套的是
      //   同一个模板对象（pinUnstatedTpl / applyTemplateGroup 发的就是同一个引用）、或本段
      //   tpl 为 null/undefined 时，那个条件不成立，缓冲就停在**别段**的挂法上 ——
      //   而 goCast 拿它当编辑页初值、canvasAgent 的 cast 分支拿它去 merge、applyCast 又
      //   整表落盘，一路串到真出片。
      // ★★ **绝不再碰 castErr / castFallback / castNodeId**：合成是一次十几秒的对话，
      //   这期间用户点一下别的段（点卡片、底部节点条都不判 busy）就会走到这里。清掉的话
      //   castBusy 还是真、归属令牌却没了：正在被写的那段解除禁用（打的字会被回包整段覆盖），
      //   失败回包落在无主状态上 —— 两个面都判 `castNodeId === node.id`，于是**哪儿都不显示**：
      //   要求框莫名空了、生成键恒灰、全 app 没有一个字说明发生了什么（铁律八）。
      //   这三态属于谁只有 castNodeId 一处说了算，谁都别替它做主。
      return { cursor, cast: s.nodes[cursor]?.cast ?? {}, ...(tpl && tpl !== s.template ? { template: tpl } : {}) };
    }),
  /**
   * ★★ 复用 setCursor，**不许**自己 set 一个 cursor：换段这件事不只是挪下标，还要把
   *   store 级的模板快照与挂卡缓冲换成那一段自己的（见 setCursor 里那段）。
   *   2026-08-21 对抗评审抓到的 high：分段模板组下，「✓ 这段满意，去下一段」/左右箭头/
   *   横划三条路都走这里，于是第 2 段起界面按**第 1 段**的模板渲染 —— 挂卡编辑页打开的是
   *   上一段的白模视频与映射，回程那道防"张冠李戴"的闸比的又是同一份陈旧快照（恒相等、
   *   拦不住），而 applyCast 按当前段落地。两段编号同形时（同源切段几乎必然同形）
   *   卡就挂到另一批人偶上：换错人、钱照扣、零报错。
   */
  shiftCursor: (dir) => get().setCursor(get().cursor + dir),

  addAnn: (nodeId, ann) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, anns: [...n.anns, { ...ann, id: uid("ann") }] } : n)),
    })),
  removeAnn: (nodeId, annId) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, anns: n.anns.filter((a) => a.id !== annId) } : n)),
    })),

  addMaterials: (nodeId, cards) => {
    // set 的更新函数是同步跑的，所以出了 set 之后 added 已经是终值
    let added = 0;
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const have = new Set((n.materials ?? []).map((c) => c.id));
        const fresh = cards.filter((c) => !have.has(c.id));
        added = fresh.length;
        return fresh.length ? { ...n, materials: [...(n.materials ?? []), ...fresh] } : n;
      }),
    }));
    return added;
  },

  removeMaterial: (nodeId, cardId) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, materials: (n.materials ?? []).filter((c) => c.id !== cardId) } : n,
      ),
    })),

  genNode: async (id) => {
    const s0 = get();
    if (s0.busy) {
      set({ err: "有一段正在生成，等它跑完再炼下一段" }); // 理由同 deriveProposals 的 ★（不许静默）
      return false;
    }
    const idx = s0.nodes.findIndex((n) => n.id === id);
    if (idx < 0) return false;
    const node = s0.nodes[idx];
    const prop = chosenOf(node);
    // ★ 方案台还摊着就不许出片：不然屏幕上三套并排、用户点一下按钮却按 fresh[0] 炼了
    //   一段几万 token 的视频——他从来没选过那一套
    if (nodePicking(node)) {
      set({ err: "先从三套方案里挑一套（点方案卡），再生成本段" });
      return false;
    }
    if (!prop.plot.trim()) {
      set({ err: "先写清楚这一段要拍什么" });
      return false;
    }
    // 付费档位的门禁。UI 上那一档本来就点不动，会走到这里的是"草稿里存着这一档、
    // 而套餐后来降了"这种存量情况 —— 与其让它飞到服务端换一句 403，不如当场说人话。
    // ★ 判断本身在 data/account.tierBlockReason，这里只是调用点（铁律六）
    const blocked = tierBlockReason(tierOf(node.videoTier));
    if (blocked) {
      set({ err: blocked });
      return false;
    }
    // ★ 真人卡门禁（判断在 economy.realFaceIssue 一处，铁律六）：现有方舟档位对真人
    //   参考图两套探测器全拦、整发拒收（见 VideoTier.realFace 的实测依据）——与其飞到
    //   方舟中途换回一句英文报错，不如当场说人话（同上面 tierBlockReason 的处置）。
    //   SegSettings 在档位区印的是同一句；r2v/白模路也从这里走，天然同一道门。
    const realFaceBlocked = realFaceIssue(node.materials, node.videoTier);
    if (realFaceBlocked) {
      set({ err: realFaceBlocked });
      return false;
    }
    const cost = nodeCost(s0.nodes, idx, s0.mode);
    if (AI_REAL && !canAfford(cost)) {
      const w = walletOf();
      set({
        err: `本段约需 ${fmtTokens(cost)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不足——去「我的」页充值`,
      });
      return false;
    }
    const patchNode = (p: Partial<FlowNode>) => get().updateNode(id, p);
    const patchProp = (p: Partial<Proposal>) => get().updateProposal(id, p);
    // 分步日志 + 按钮上那一行：两者同源，避免"日志说在渲染、按钮还写着准备中"
    const log = createGenLog((steps) => {
      const cur = steps[steps.length - 1];
      patchNode({ steps, progress: cur && cur.status === "running" ? (cur.detail ?? cur.title) : "" });
    });
    /** ai 层报上来的平铺短句 → 归一成「步骤 / 细节」，同一件事的读秒折进同一步 */
    const prog = (t: string) => {
      const { title, detail, terminal } = splitStatus(t);
      if (terminal) return log.end();
      const cur = log.steps[log.steps.length - 1];
      if (!cur || cur.status !== "running" || cur.title !== title) log.begin(title);
      if (detail) log.detail(detail);
    };
    const myRun = get().genRun + 1;
    set({ busy: true, err: "", genRun: myRun });
    patchNode({ status: "generating", progress: "准备中…", error: undefined, steps: [] });
    try {
      // 承接判定：上一段真出过片，它的尾帧才是"真实结尾"，才配顶替本段起拍帧
      const prevNode = get().nodes[idx - 1];
      const prevProp = prevNode ? chosenOf(prevNode) : null;
      const carry = node.chain && prevNode && nodeDone(prevNode) ? prevProp?.lastFrame : null;
      // 套了模板就用配方里的起拍提示词：它专门为"这个模板长什么样"写过，
      // 比从剧情正文截前 200 字更贴（剧情前半段常常是动作描述而非画面描述）
      // ★ 一律走 tplOfNode（分段组每节点自带快照）：与 nodeCost 读**同一份** ——
      //   报了 r2v 的价就必须真发参考视频，两处各读各的迟早对不上（铁律六）
      const nodeTpl = tplOfNode(node);
      const tplFrame = nodeTpl?.recipe.framePrompt;
      const tplRef = nodeTpl?.refVideo;
      const res = await generateSegment(
        {
          plot: prop.plot,
          firstFrame: prop.firstFrame,
          lastFrame: prop.lastFrame,
          durationSec: prop.durationSec,
          videoTier: node.videoTier,
          aspect: node.aspect,
          anns: node.anns,
          carryFrame: carry,
          refVideoUrl: tplRef?.url,
          // ★ 登记值**整份**透传（不只时长）：出片门口那道「模板视频自己合不合方舟窗口」
          //   的判据要读 realDurationSec ?? durationSec，在这里只挑一个数传下去，
          //   segmentGen 就得自己拼那个 `??` —— 那是同一条规则的第二份实现。
          refVideo: tplRef,
          // ★★ 角色位：白模两条互斥的路由它分叉（segmentGen 的 `named`，判据是**存在性**
          //   `roles?.length`）。有 = V2，`plot` 里已经是编辑页合成好的点名映射，出片时
          //   **不再拼**泛指的 BLOCKOUT_SWAP（泛指与点名摆在同一段话里自相矛盾，而实测
          //   泛指会盖过点名、只换配角，F4）；缺省 = V1 老模板，照旧泛指。
          // ★ 内容（label/desc）那边一个字都不读 —— 点名句只有 studio/blockoutPrompt
          //   一处实现，且用户在输入框里改过之后**以输入框为准**（方案 B2）。
          //   从模板快照读而不是现查模板库：套用那一刻的那份 roles 才与已合成的点名句、
          //   已落的 materials 对得上（见 FlowTemplate.roles 的 ★）。
          roles: nodeTpl?.roles,
          framePrompt: tplFrame ? fillSubject(tplFrame, get().subject) : undefined,
          // 本段素材卡要真的进提示词。此前它只喂给「推演三种走向」，
          // 用户在这一段挂了人物卡再点生成，出片其实完全不认识那张卡。
          // ★★ V2 白模上这一份是 applyCast **按角色位原序**写进来的，这里不许重排：
          //   顺序决定"参考图预算不够时谁先被挤掉"（唯一实现在 ai/real.allocateRefs），
          //   而"谁换成谁"靠**角色名**在点名句与绑定句之间对上（applyCast 的重名硬拦
          //   守的就是这条连接键）。重排一次，被挤掉的那张就与编辑页提醒过的那张不是同一张。
          materials: node.materials,
          // ★ 只有简约模式允许"卡片形象 + 一句话直出"：它按产品定义就没有方案推演、
          //   没有首尾帧。工作流/工坊那两条路整个建立在首尾帧上（方案台预览、段间承接），
          //   而首尾帧与参考图在方舟是互斥场景。真正的判定在 segmentGen.refVideoOn，
          //   报价（nodeCost）问的是同一个函数
          refAllowed: get().mode === "simple",
        },
        prog,
      );
      log.end();
      if (res.url && AI_REAL) spendTokens(cost);
      // 真实帧顶替设定帧：节点卡显示的就是视频里实际的画面，也是下一段的起拍帧。
      // videoUrl 同时挂在方案上——工坊侧的节点卡读的就是它（两个模式共用同一份出片）
      patchProp({
        firstFrame: res.firstFrame,
        lastFrame: res.lastFrame,
        // mock 构建下 Seedance 不返回地址：这里和 videoByProposal 用同一个 "mock:" 占位串，
        // 否则同一段在工作流里算"已出片"、回工坊却算"没出片"（工坊读的是 proposal.videoUrl），
        // 于是演示模式下桌面永远开不出下一张卡。需要"能播的地址"的地方走 realVideoOf 过滤
        videoUrl: res.url || "mock:",
        degraded: undefined,
      });
      // ★★ 写回之前先确认**这一段还在**（第七轮扫描）：出片是几分钟的异步，这期间流水线
      //   可能已经被换掉或那一段被删了。`get().nodes[idx]` 那时要么越界（读 undefined 的
      //   属性当场抛错，用户看到的是一句 JS 异常），要么指向**另一段**（下标前移）——
      //   而钱在上一行已经扣了。认 id 不认下标，找不到就如实说一句，别装作成功。
      const still = get().nodes.find((n) => n.id === id);
      if (!still) {
        set(
          get().genRun === myRun
            ? {
                busy: false,
                err: "这一段在生成过程中被删掉了（或整条流水线被换过）——这一炉的钱已经扣了，成片没处放。下次等它跑完再动流水线",
                genNotice: { ok: false, msg: "有一段生成完了，但它已经不在了" },
              }
            : {},
        );
        return false;
      }
      patchNode({
        status: "idle",
        progress: "",
        // mock 构建没有真视频：占位串让 nodeDone 成立，播放器回退首尾帧渐变
        videoByProposal: { ...still.videoByProposal, [node.chosenId]: res.url || "mock:" },
        anns: [],
      });
      // 通知无条件设：人在页上的话 FlowPage 一直挂着，胶囊不渲染（按路由判），
      // 下次进来也会清 —— 在这里判"人在不在"反而是第二处路由判断
      // ★ 只有"还是我这一炉"才有资格清 busy（见 genRun 的 ★★）：作废的回包清掉的话，
      //   新那一炉跑着而闸开着，可以并发出第三炉
      set(get().genRun === myRun ? { busy: false, genNotice: { ok: true, msg: `第 ${idx + 1} 段出片完成` } } : {});
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 失败也留在日志里：卡在哪一步、跑了多久，比一句"生成失败"有用得多
      log.fail(`失败：${msg.slice(0, 80)}`);
      patchNode({ status: "failed", progress: "", error: msg.slice(0, 160) });
      set(
        get().genRun === myRun
          ? {
              busy: false,
              err: `第 ${idx + 1} 段生成失败：${msg.slice(0, 120)}`,
              genNotice: { ok: false, msg: `第 ${idx + 1} 段生成失败` },
            }
          : {},
      );
      return false;
    }
  },
}));

// DEV 调试/E2E 挂钩
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__flow = useFlow;
}
