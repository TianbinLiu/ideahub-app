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
import { DEFAULT_TIER, VIDEO_TIERS, fmtTokens, proposalRedrawCost, proposalsCost, segmentCost, tierOf } from "../data/economy";
import { Card, DEFAULT_ASPECT, Proposal, TemplateRecipe, VideoAspect, VideoTemplate, uid } from "../types";
import { type BlockoutCastSlot, blockoutApplySkeleton, composeBlockoutPrompt } from "./blockoutPrompt";
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
  /**
   * 白模人偶的角色位（`VideoTemplate.roles` 的镜像）。**有 = V2 白模模板**（可以逐个
   * 编号挂人物卡，走点名路）；缺省 = V1 老白模模板/经典模板，照旧走泛指的 BLOCKOUT_SWAP。
   *
   * ★ 判定一律写**存在性**（`roles?.length`，types.ts 同一条 ★）：后加字段，老快照与
   *   老草稿天然缺它、天然走老路，零迁移。
   * ★ 必须跟着快照走、不许出片时再去模板库现查：模板可能已被作者改/删，而这一段的
   *   报价、挂卡映射与合成好的点名句都是**套用那一刻**那份 roles 的产物 —— 现查等于
   *   让编号在半路换一份定义，那正是"换错人且零报错"的入口。
   */
  roles?: VideoTemplate["roles"];
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
function clearTemplate(): Pick<FlowState, "template" | "subject" | "cast" | "castErr" | "castFallback" | "castBusy"> {
  return { template: null, subject: "", cast: {}, castErr: "", castFallback: "", castBusy: false };
}

export function chosenOf(node: FlowNode): Proposal {
  return node.proposals.find((p) => p.id === node.chosenId) ?? node.proposals[0];
}

export function nodeVideo(node: FlowNode): string | undefined {
  return node.videoByProposal[node.chosenId];
}

/** 这一段是否已经交付：当前走向有成片，或 mock 构建下标记过完成 */
export function nodeDone(node: FlowNode): boolean {
  return !!node.videoByProposal[node.chosenId];
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
function clampCursor(nodes: FlowNode[], to: number): number {
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
export function nodeCost(nodes: FlowNode[], idx: number, mode: FlowMode, tierOverride?: string): number {
  const node = nodes[idx];
  if (!node) return 0;
  const prop = chosenOf(node);
  const carry = nodeCarry(nodes, idx);
  // 白模位从模板快照读（模板挂在 store 上不在节点上——读 getState 是 flowDirty 的同款先例）。
  // ★ 按「模板带 refVideo」透传，而不是问 blockoutOn：还没挂角色卡的白模节点也必须按
  //   r2v 报价——那才是它唯一可能花出去的钱（不挂卡根本出不了片，genNode 门口的
  //   blockoutIssue 拦着，而扣款只在出片成功后）；按经典路报是另一件商品的价。
  //   inputSec 只从登记值镜像读（economy.segmentCost 的同一句 ★），不拿 <video> 现探。
  const refVideo = useFlow.getState().template?.refVideo;
  return segmentCost({
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
    refVideoUrl: useFlow.getState().template?.refVideo?.url,
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
   * 白模 V2 的挂卡映射：**人偶胸口的编号（`roles[].label`）→ 卡 id**。
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

  seed: (nodes: FlowNode[], opts: { mode: FlowMode; origin: "studio" | "solo" }) => void;
  /** 工作流/简约模式的空白起手：一个待填的节点 */
  seedSolo: (mode: FlowMode) => void;
  /** 套模板：按配方的分镜骨架铺节点、挂上模板卡组，之后只等用户写那句话。
   *  白模模板（t.refVideo 存在）只铺 1 个节点。返回 false = 被闸门整句拒绝
   *  （err 已写明原因，什么都没铺）——调用方据此决定还跳不跳工作流页 */
  applyTemplate: (t: VideoTemplate) => boolean;
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
}

export const useFlow = create<FlowState>()((set, get) => ({
  nodes: [],
  cursor: 0,
  mode: "workflow",
  origin: "solo",
  busy: false,
  err: "",
  template: null,
  subject: "",
  cast: {},
  castErr: "",
  castFallback: "",
  castBusy: false,

  // ★ template/subject（连同挂卡那两格，见 clearTemplate）必须一起清：工坊铺过来的是
  //   workflow 模式的节点，而模板栏只在 simple 模式渲染。留着上一轮简约模式的模板，
  //   NodeScreen 会把剧情编辑框换成模板的「一句话」输入框，且没有「不用」可点；在那里
  //   打字会走 setSubject，把工坊 AI 推演出来的剧情/标题/时长按模板配方整个覆盖掉。
  //   （seedSolo 与 reset 本来就清了）
  seed: (nodes, opts) =>
    set({ nodes, cursor: 0, mode: opts.mode, origin: opts.origin, busy: false, err: "", ...clearTemplate() }),
  seedSolo: (mode) =>
    set({
      nodes: [newFlowNode(0, { chain: false })],
      cursor: 0,
      mode,
      origin: "solo",
      busy: false,
      err: "",
      ...clearTemplate(),
    }),

  applyTemplate: (t) => {
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
        template: {
          id: t.id,
          title: t.title,
          recipe: t.recipe,
          cards: t.cards,
          refVideo: t.refVideo,
          ...(t.roles?.length ? { roles: t.roles } : {}),
        },
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
    const tpl = s0.template;
    const roles = tpl?.roles;
    // 白模模板恒为**单段**（applyTemplate 只铺 1 个节点，addNode 又拒绝追加），
    // 所以"本段"就是第 0 段——不去猜 cursor
    const node = s0.nodes[0];
    if (!tpl?.refVideo || !roles?.length || !node) {
      set({
        err: "这条流水线上没有可挂卡的白模模板（角色位只有带编号的白模模板才有）——回模板市场重新套用一次",
      });
      return false;
    }

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
    const mine = new Map(myCards().map((c) => [c.id, c]));
    const slots: BlockoutCastSlot[] = [];
    const missing: string[] = [];
    for (const r of roles) {
      const id = next[r.label];
      const card = id ? (mine.get(id) ?? null) : null;
      if (id && !card) missing.push(r.label);
      slots.push({ label: r.label, desc: r.desc, card });
    }
    if (missing.length > 0) {
      set({
        err: `编号 ${missing.join("、")} 挂的卡在这台设备的素材库里找不到（可能已被删掉，或属于另一个账号）——回去重新挂一张，或先把它取下`,
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
      set({ cast: {}, castErr: "", castFallback: "", err: "一个角色位都没挂卡：白模出片全靠卡上的形象图说明「换成谁」，一张都不挂的话出不了片——回去至少挂一张" });
      get().updateNode(node.id, { materials: undefined });
      get().updateProposal(node.id, { plot: "" });
      return false;
    }
    // ★★ 重名硬拦：合成句说「编号 4 …替换为角色「张三」」，出片时的绑定句说
    //   「<图片2>…定义为角色「张三」」—— 两句是靠**角色名**接上的（编号 M 在合成那一刻
    //   还不存在，理由见 blockoutPrompt.blockoutApplySkeleton 的 ★）。两张**不同**的卡
    //   重名，这个连接键就失效了：模型只能在两张脸里挑一张，挑错了就是张三换到李四身上，
    //   而画面照出、零报错。同一张卡挂在两个位子上是合法的（用户就是要同一个人），
    //   所以判的是"名字相同但 id 不同"。
    const byName = new Map<string, string>();
    for (const s of taken) {
      const seen = byName.get(s.card.name);
      if (seen && seen !== s.card.id) {
        set({
          err: `有两张不同的卡都叫「${s.card.name}」（编号 ${s.label} 挂的是其中一张）——出片时靠角色名把形象图接到编号上，重名就分不出谁是谁，会换错人。请给其中一张改个名字，或换一张卡`,
        });
        return false;
      }
      byName.set(s.card.name, s.card.id);
    }

    // ── materials：按**角色位原序**落盘，同一张卡只落一次 ──
    // ★★ 顺序决定的**不是**"谁是谁"（那由角色名连接，见上面重名那条），而是
    //   **预算不够时谁先被挤掉**：一次出片最多带 MAX_REF_IMAGES 张参考图，多出来的卡
    //   只按文字参与（规则的唯一实现在 ai/real.allocateRefs，这里绝不复述）。
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

    set({ busy: true, castBusy: true, err: "", castErr: "", castFallback: "", cast: cleaned });
    get().updateNode(node.id, { materials: mats });

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
      const text = await composeBlockoutPrompt(slots, line);
      get().updateProposal(node.id, { plot: text });
      set({ busy: false, castBusy: false });
      // 挂完卡就把"现在还出不了片"的原因先说了（判据仍只活在 segmentGen.blockoutIssue
      // 一处，这里只是提前问它一次）：卡上没有形象参考图这类问题，等用户点了「生成本段」
      // 才说等于白让他期待一轮
      const issue = blockoutIssue({
        videoTier: node.videoTier,
        materials: mats,
        firstFrame: chosenOf(node).firstFrame,
        carryFrame: null,
        anns: node.anns,
      });
      if (issue) set({ err: `挂卡已记下，但现在还出不了片：${issue}` });
      return true;
    } catch (e) {
      // 整句失败 + 一份可用的骨架（用户点了才填）。**绝不 catch 成空串**：
      // 空输入框与"还没写"长得一样，用户会以为自己随手写一句就够，出片时点名映射
      // 整个没发出去 —— 而换错人/漏换人是零报错的（blockoutPrompt 的 ★）
      set({
        busy: false,
        castBusy: false,
        castErr: e instanceof Error ? e.message : String(e),
        castFallback: blockoutApplySkeleton(slots, line),
      });
      return false;
    }
  },

  fillCastFallback: () =>
    set((s) => {
      const node = s.nodes[0];
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
    if (s0.busy) return false;
    const idx = s0.nodes.findIndex((n) => n.id === nodeId);
    const node = s0.nodes[idx];
    if (!node) return false;
    const cur = chosenOf(node);
    // 推演的依据是**用户那句话**，不是某一套方案的剧情（见 FlowNode.requirement）
    const req = requirementOf(node);
    if (!req.trim() && !node.materials?.length) {
      set({ err: "先写一句要拍什么（或从工坊带素材卡过来），我才好推演走向" });
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
    set({ busy: true, err: "" });
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
        proposals: [...fresh, ...keep],
        chosenId: fresh[0].id,
        // 推完是"摊开等挑"，不是"帮你选好了"：这一步之后按钮写「重新生成方案」
        plan: "picking",
        status: "idle",
        progress: "",
        anns: [],
      });
      set({ busy: false });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      get().updateNode(nodeId, { status: "idle", progress: "" });
      set({ busy: false, err: `推演失败：${msg.slice(0, 120)}` });
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
    if (s0.busy) return false;
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
    set({ busy: true, err: "" });
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
      get().updateNode(nodeId, { status: "idle", progress: "", regenning: false });
      set({ busy: false });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      get().updateNode(nodeId, { status: "idle", progress: "", regenning: false });
      set({ busy: false, err: `重画失败：${msg.slice(0, 120)}` });
      return false;
    }
  },

  addNode: () =>
    set((s) => {
      // 白模模板只有一段：追加的下一段要么承接（承接帧与参考视频在方舟互斥，任务发不出去）、
      // 要么不承接（衔接断掉）——两头都不成立。拦在追加门槛这一处，与「先把这一段炼出来」
      // 是同一个门（CLAUDE.md：顺序门禁只在 clampCursor + addNode 两处，别在 UI 另写）
      if (s.template?.refVideo) return { err: "白模模板只有一段：画面与运镜整个来自模板视频，没有可续的下一段" };
      const prev = s.nodes[s.nodes.length - 1];
      // 顺序门禁：只能在末尾追加，且上一段必须已出片
      if (prev && !nodeDone(prev)) return { err: "先把这一段炼出来，再加下一段" };
      const i = s.nodes.length;
      // 画幅跟着上一段：一部片里前三段竖、第四段横，剪辑页合并只有一块画布，
      // 那一段必然被裁或补边
      const node = newFlowNode(i, {
        chain: !!prev,
        videoTier: prev?.videoTier ?? DEFAULT_TIER,
        aspect: prev?.aspect ?? DEFAULT_ASPECT,
      });
      if (prev) node.proposals[0].durationSec = chosenOf(prev).durationSec;
      return { nodes: [...s.nodes, node], cursor: i, err: "" };
    }),

  removeNode: (id) =>
    set((s) => {
      if (s.nodes.length <= 1) return {};
      const i = s.nodes.findIndex((n) => n.id === id);
      const nodes = s.nodes.filter((n) => n.id !== id);
      return { nodes, cursor: clampCursor(nodes, Math.max(0, i)) };
    }),

  setCursor: (i) => set((s) => ({ cursor: clampCursor(s.nodes, i) })),
  shiftCursor: (dir) => set((s) => ({ cursor: clampCursor(s.nodes, s.cursor + dir) })),

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
    if (s0.busy) return false;
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
    set({ busy: true, err: "" });
    patchNode({ status: "generating", progress: "准备中…", error: undefined, steps: [] });
    try {
      // 承接判定：上一段真出过片，它的尾帧才是"真实结尾"，才配顶替本段起拍帧
      const prevNode = get().nodes[idx - 1];
      const prevProp = prevNode ? chosenOf(prevNode) : null;
      const carry = node.chain && prevNode && nodeDone(prevNode) ? prevProp?.lastFrame : null;
      // 套了模板就用配方里的起拍提示词：它专门为"这个模板长什么样"写过，
      // 比从剧情正文截前 200 字更贴（剧情前半段常常是动作描述而非画面描述）
      const tplFrame = get().template?.recipe.framePrompt;
      // 白模位：与 nodeCost 读**同一份**模板快照——报了 r2v 的价就必须真发参考视频，
      // 两处各读各的迟早对不上（铁律六）。走不走成、为什么走不成由 segmentGen 门口的
      // blockoutIssue 说了算（走不成整句拒绝，钱在成功后才扣，见下面 spendTokens）
      const tplRef = get().template?.refVideo;
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
          refVideoSec: tplRef?.durationSec,
          // ★★ 角色位：白模两条互斥的路由它分叉（segmentGen 的 `named`，判据是**存在性**
          //   `roles?.length`）。有 = V2，`plot` 里已经是编辑页合成好的点名映射，出片时
          //   **不再拼**泛指的 BLOCKOUT_SWAP（泛指与点名摆在同一段话里自相矛盾，而实测
          //   泛指会盖过点名、只换配角，F4）；缺省 = V1 老模板，照旧泛指。
          // ★ 内容（label/desc）那边一个字都不读 —— 点名句只有 studio/blockoutPrompt
          //   一处实现，且用户在输入框里改过之后**以输入框为准**（方案 B2）。
          //   从模板快照读而不是现查模板库：套用那一刻的那份 roles 才与已合成的点名句、
          //   已落的 materials 对得上（见 FlowTemplate.roles 的 ★）。
          roles: get().template?.roles,
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
      patchNode({
        status: "idle",
        progress: "",
        // mock 构建没有真视频：占位串让 nodeDone 成立，播放器回退首尾帧渐变
        videoByProposal: { ...get().nodes[idx].videoByProposal, [node.chosenId]: res.url || "mock:" },
        anns: [],
      });
      set({ busy: false });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 失败也留在日志里：卡在哪一步、跑了多久，比一句"生成失败"有用得多
      log.fail(`失败：${msg.slice(0, 80)}`);
      patchNode({ status: "failed", progress: "", error: msg.slice(0, 160) });
      set({ busy: false, err: `第 ${idx + 1} 段生成失败：${msg.slice(0, 120)}` });
      return false;
    }
  },
}));

// DEV 调试/E2E 挂钩
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__flow = useFlow;
}
