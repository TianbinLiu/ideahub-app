// 卡片工坊全局状态：卡组 / NPC 对话 / 市场 / 节点树 / 相机 / 合成 / 已发布作品回炉编辑
import { create } from "zustand";
import { BranchNodeData, BranchTree, Card, CardType, DEFAULT_ASPECT, DraftVideo, NodeSlot, Proposal, VideoAspect, VideoSegment, VideoTemplate, uid } from "../types";
import { AI_REAL, MaterialFile, deriveCharacterModels, deriveDeckCards, generateCards, generateCover, generateProposals, npcChat, npcChatOffline, prepareMaterialRefs, refineFrame } from "../ai";
import { DECK_CAM, MARKET, NPC_CAM } from "./scene/layout";
import type { PlayerAvatar } from "./quality";
import { acquireCard, addCards as saveCardsToAccount, canAfford, myCards, myDecks, plazaCards, spendTokens, walletOf, type AddCardsResult } from "../data/account";
import { CHAT_TURN_TOKENS, DECK_MAX_3D, deriveIssue, DECK_MAX_CARDS, DEFAULT_TIER, MODEL3D_TOKENS, ONE_IMAGE, deckCardsCost, deckCardsSettle, deckModel3dCost, fmtTokens, proposalsCost, realFaceIssue, styleWants3d } from "../data/economy";
// 单向依赖：工坊把活动路径喂给工作流。flowStore 不认识 studioStore（见其文件头）
import { CUSTOM_MID_MAX, FlowMode, FlowNode, FlowTemplate, appendBlocked, chosenOf, nodeVideo, tplOfNode, useFlow, keepFirstFrame, redrawCost } from "./flowStore";
// ★ 依赖方向没破：canvasAgent 只认识 flowStore，不认识本模块（不会成环）
import { forgetCanvasAgent } from "./canvasAgent";
import { DraftMode, WorkDraft, WorkDraftMeta, deleteDraft, saveDraft } from "../data/drafts";
import { dropCutSession, saveCutSession } from "../data/cutSession";
import { GenStep } from "./genLog";
import { SPEAK_MOOD, speak, stopSpeaking } from "./speech";
import { CRISIS_LINE, HELP_LINE, NPC_SYSTEM, chatFailLine, chatWindow, deskBlock } from "./npcPersona";

export interface DialogMsg {
  id: string;
  from: "npc" | "me";
  text: string;
  /**
   * 消息分档。**这是安全边界，不是样式开关。**
   *   chat = 闲聊往返（**只有它进模型上下文**，见 npcPersona.chatWindow）
   *   act  = 她做事时的播报（出炉了 / 摊开市场了）
   *   sys  = 系统服务条（余额、危机资源）——不是她在说话
   * 缺省 undefined = 今天的普通气泡，所以既有 28 处 npcSay 零改动、零视觉回归。
   * 过滤器写成**严格白名单** kind === "chat"，永远别改成 kind !== "sys"：
   * 一个字符的改动，播报（含别人发布的卡名）就从"隔离"变成"注入开放"。
   */
  kind?: "chat" | "act" | "sys";
  /** 降级/离线应答（余额不足或请求失败）。不进上下文，也不出声。 */
  offline?: boolean;
  /** 被内容安全拦下的那一次。用于 UI 提示，不进上下文。 */
  blocked?: boolean;
}

export type CamView =
  | { kind: "default" }
  | { kind: "pos"; pos: [number, number, number]; look: [number, number, number] };

export interface Flight {
  id: string;
  card: Card;
  from: [number, number, number];
  delay: number;
}

export interface EditorState {
  /** 已选素材卡 id，同类型可放多张（两位主角就放两张人物卡），先选先排 */
  slots: string[];
  requirement: string;
  durationMode: "ai" | "manual";
  durationSec: number;
  /** 本段 Seedance 档位（极速/标准/高清）——决定合成 token 消耗，见 data/economy */
  videoTier: string;
  /** 本段画幅（竖屏/横屏）。开面板时继承路径上一段，整片才不会横竖混着来 */
  aspect: VideoAspect;
  /** 用户上传的本段开头帧（dataURL）；null=沿用上一节点尾帧（无上节点则 AI 自拟） */
  startFrame: string | null;
  /** 用户上传的本段**结束帧**（dataURL）——只有「直接生成（自定义直出）」那条路读它：
   *  推演三套时尾帧由各方案自拟，这一位不参与（null=没给）。 */
  endFrame: string | null;
  /** 自定义车道第①页挂的示例视频（2026-08-30 翻页版）。落地时随 layCustomNode 一起
   *  写进节点（setNodeCustom + setCustomRefVideo + mids）；localUrl 只给截帧用不落库 */
  refVideo: { url: string; publicId: string; durationSec: number; localUrl?: string; mids: string[] } | null;
  generating: boolean;
  /** 生成期间的实时阶段播报（真实 AI 全程约 1-1.5 分钟，没进度=卡死体感） */
  progress: string;
}

/**
 * 活动路径 = **流水线本身**（2026-08-30「两个模式的节点数据是同一份」，主人点名）。
 *
 * ★★ 单一真相：工坊桌面不再自持一棵 NodeSlot 树，节点数据只有 flowStore.nodes 一份，
 *   桌面/投影窗全都读它、写它（写一律走 flowStore 的 action，别绕开去摸数组）。
 *   原来树的 children（分支探索）由 flowStore.alts 归档接管；NodeSlot 类型仅存于
 *   老草稿正文里（openWorkDraft 用 flowFromRoot 一次性换算进来）。
 */
export function activePath(): FlowNode[] {
  return useFlow.getState().nodes;
}

/** 这一段选定的方案。★ 工作流的"待挑"是 plan==="picking"（chosenId 恒有值），
 *  工坊沿用"null = 还没挑"的读法 —— 翻译收在这一处，别在调用点各判一遍 */
export function chosenProposal(node: FlowNode): Proposal | null {
  if (node.plan === "picking") return null;
  return node.proposals.find((p) => p.id === node.chosenId) ?? null;
}

/**
 * 铸段窗这一段的**开头帧** —— 报价、真发、UI 三处的**唯一实现**（铁律六）。
 *
 * ★★ 为什么要收口：优先级是"用户上传的图 > 上一段已选方案的尾帧 > 无（AI 自拟）"，
 *   而 2026-08-31 之前报价那一处只看了第一项。真实尾帧是 canvas `toDataURL` 出来的
 *   data: URI，`ai/real.ts` 认 data: 就只排 3 个出图任务（三个方案共用开头帧、各画一张
 *   尾帧）—— 于是从第 2 段起，界面按 6 张图报价、方舟只画 3 张，每段多扣
 *   3×IMAGE_TOKENS，同一屏上「承接上一段尾帧」那句提示还明明白白写着。
 *   两个方向都不报错，只是钱多收了。
 * ★ 与 `chain` 差一位：承接与否只问"帧是不是上一段给的"，用户自己传图时不算承接。
 */
export function nextStartFrame(uploaded: string | null | undefined): string | null {
  if (uploaded) return uploaded;
  const path = activePath();
  const tail = path.length > 0 ? path[path.length - 1] : null;
  return (tail ? chosenProposal(tail)?.lastFrame : null) ?? null;
}

/**
 * 这一套方案出片了吗。
 * ★ mock 构建（没配 ARK_API_KEY）下 Seedance 不返回地址，用 "mock:" 占位——与 flowStore 的
 *   videoByProposal 同一套约定。所以"出片了吗"问这个函数，"能不能播"问 realVideoOf()：
 *   把 "mock:" 交给播放器会得到一个报错的 <video>，而把它当成"没出片"会让演示模式下整条
 *   流水线永远推进不下去。
 */
export function proposalDone(p: Proposal | null | undefined): boolean {
  return !!p?.videoUrl;
}

/** 能真正播/截帧的地址（滤掉 mock 占位串） */
export function realVideoOf(p: Proposal | null | undefined): string | undefined {
  return p?.videoUrl && !p.videoUrl.startsWith("mock:") ? p.videoUrl : undefined;
}

// ★★ 「这张开头帧要不要重画」这条规则**只在 flowStore.keepFirstFrame 一处**（2026-09-03 收口）。
//   这里原来有第二份，而且已经实际漂开：那边判 `node.chain && prev?.lastFrame && ...`，
//   这里漏了 `node.chain` —— 于是"在 ⚙ 里关掉承接、但开头帧还停在上一段尾帧那张"的段，
//   同一颗「✨ 重新生成这一套的画面」在画布标 2 张图的价并真重画首帧、在工坊标 1 张图的价
//   且首帧原样不动：两面两个价、两种结果，全程零报错。报价改调 flowStore.redrawCost。

/**
 * 「同时只跑一炉」—— **两面共用的那道闸**（2026-09-03 收口）。
 *
 * ★★ 为什么必须问 `flowStore.busy` 而不是只看工坊自己那几个旗标：两面跑的是**同一条**
 *   流水线（flowStore.nodes 是唯一真相），而工坊那几个旗标画布根本不认。收口之前：
 *   在画布点「⚡ 炼这一段」（几分钟的异步、没有 AbortController），退回 3D 桌面点
 *   「♻ 重新推演三套」/「✨ 重画这一套」——工坊这边一路放行：钱先扣、proposals 整表换掉，
 *   几分钟后出片回包的 setProposalVideo 打在一个已经不存在的 proposal id 上**静默落空**。
 *   两笔钱都花了，成片一个都拿不到，全程零报错。反方向同样不设防（flowStore.busy 恒 false）。
 * ★ 回**整句人话**而不是布尔：调用方直接摆进 notice（铁律八；静默 return false = 上层只能瞎猜）。
 * ★ 用 notice 不用 npcSay：投影窗开着时 NpcDialog 整个 return null，那些话等于没说。
 */
function otherFaceBusy(nodeId?: string): string | null {
  const f = useFlow.getState();
  if (f.busy) return "有一段正在生成（画布那一面也算同一条流水线）——等它跑完再动这一段。";
  if (nodeId && f.nodes.find((n) => n.id === nodeId)?.status === "generating") {
    return "这一段正在生成，等它跑完再改。";
  }
  return null;
}

/** 「重新推演三套」跑起来时占用 nodeGen 的那个 key。
 *  nodeGen 本来是按方案 id 记的，而重推时新方案还不存在——拿节点 id 顶上，UI 据此把进度
 *  日志显示在整个方案台上方（重推真实 AI 下要一分钟出头，没有进度就是"卡死"体感）。
 *  ★ 拼串的规则只放这一处：store 写、UI 读，两边各拼一次必然有一天对不上。 */
export const rederiveKey = (nodeId: string) => `rederive:${nodeId}`;

/**
 * 虚线空白卡位是否可见 = **能不能开下一段**。
 *
 * ★ 门槛从"末段选定了方案"提到"末段选定了方案**并且炼出了视频**"。
 *   老规则允许一路只挑方案、把出片全攒到最后一起炼，代价有两条：
 *     ① 段与段要靠前一段的**真实尾帧**承接起拍，攒着炼时后面每段接的都是设定帧
 *        （AI 画的示意图），衔接会断；
 *     ② 第 1 段的人物/画风不对，用户往往铺完五段才发现，前面挑的方案全作废。
 *   现在必须一段一段落地：选方案（便宜）→ 出片（贵）→ 才开下一张卡。
 */
export function placeholderVisible(nodes: FlowNode[]): boolean {
  if (nodes.length === 0) return true;
  // ★★ 末段是白模段就不亮（判据在 flowStore.appendBlocked 一处，与 addNode/appendNode 同门）：
  //   亮着的话用户点进去写素材、付**推演费**，方案炼好落桌时才被 appendNode 拒——
  //   钱已经花了、三套方案没处放（generateNode 的扣费在 appendNode 之前，铁律五的钱坑）。
  if (appendBlocked(nodes, null)) return false;
  return proposalDone(chosenProposal(nodes[nodes.length - 1]));
}

/** 法阵能不能点：流水线上每一段都已出片（同上——逐段落地之后，整片其实已经炼完，
 *  法阵剩下的活是把人送去工作流那面交给剪辑页） */
export function composable(nodes: FlowNode[]): boolean {
  if (nodes.length === 0) return false;
  return nodes.every((n) => proposalDone(chosenProposal(n)));
}

// ── 组稿那一下会派生的卡组：报价与结算共用 ─────────────────────
//
// ★★ 这一块存在的理由是**报价必须等于实收**。按下「完成视频」时 finalizeFromFlow 会
//   提炼本片卡组（最多 8 张，约 110k），撞上 3D 关键词还会顺带铸最多 2 个建模
//   （每个 160k）—— 而在 2026-08-12 之前，工作流顶栏那个"剩余约 xx"里**一分钱都没算
//   这些**。用户比着那个数攒余额，点完「完成视频」发现少了一大截。
//   所以「会不会派生」「派生多贵」只由下面这两个函数回答：FlowPage 拿它报价，
//   finalizeFromFlow 拿它判余额、拿它决定要不要铸 3D（铁律六）。

/**
 * 拿来判 3D 关键词的那一坨文字。**报价与真正触发必须读同一份**。
 *
 * ★ 从 `nodes` 取（而不是从工坊的节点树 `root` 取）：FlowPage 手上只有 nodes，
 *   而 nodes 里的 requirement / plot 是用户在工作流里**改过之后**的那一份，
 *   比节点树上的原值更接近真正会送去派生的内容。两边各取各的话，就会出现
 *   "界面说不铸建模、组稿时按另一份文字判定要铸"。
 *
 * ★★ 每一步都当外部状态**形状可能不对**（CLAUDE.md「渲染循环里别信任外部状态的形状」）：
 *   这个函数现在会在 FlowPage 的 **render 里**被调到（顶栏报价），而全 app 没有
 *   ErrorBoundary —— 一个节点碰巧没有 proposals，`chosenOf(n).plot` 就是整页白屏，
 *   而用户手上那条正在做的片子还没存过草稿。报价算歪一点点没关系，页面挂了才是灾难。
 */
function deckStyleBlob(nodes: FlowNode[]): string {
  const parts: string[] = [];
  for (const n of nodes) {
    for (const c of n.materials ?? []) if (c.type === "style") parts.push(c.name);
    if (n.requirement) parts.push(n.requirement);
    parts.push(chosenOf(n)?.plot ?? "");
  }
  return parts.join(" ");
}

/** 组稿会派生什么、最多花多少。全 0 = 这条路根本不派生卡组（简约模式）。 */
export interface DeckQuote {
  /** 会不会派生（= 不是简约模式）。为假时下面全是 0 */
  on: boolean;
  /** 最多提炼几张卡 / 这些卡的 token 上限 */
  maxCards: number;
  cards: number;
  /** 这条片的文字**当下**撞上 3D 关键词了吗 —— 撞上组稿就一定会去铸建模 */
  wants3d: boolean;
  /** 最多铸几个建模 / 这些建模的 token 上限。wants3d 为假时都是 0 */
  max3d: number;
  model3d: number;
  /** 两项之和，就是顶栏那个总价要加进去的数 */
  total: number;
}

/**
 * 组稿派生卡组的报价 —— **唯一实现**（铁律六）。
 *
 * ★★ 简约模式返回全 0：那条路**既不派生也不收费**（见 finalizeFromFlow 的短路）。
 *   报价与实收必须一致，所以"不收"这件事也只能有一处判断，就是这里的 `mode`。
 * ★ deckOff（用户勾了「只出片不出卡组」，flowStore.deckOff）同样全 0——与 mode 是
 *   同一道闸的两个入口，实收侧（finalizeInner 的 withDeck）读的是同一对布尔。
 * ★ 卡张数是**上限**不是确数（2026-08-28 起按**卡种级**补缺：用户挂过的卡种一张不出，
 *   缺的卡种才补，按实际出卡结算），所以 UI 必须写"最多"。
 * ★ 3D 那一项是**条件项**：撞不上关键词就是实打实的 0（不是"暂时不算"），
 *   撞上了才按上限 2 个报。它随用户改剧情实时变 —— 这正是它诚实的地方：
 *   报的永远是"照现在这些字，组稿会花多少"。
 */
export function deckQuoteOf(nodes: FlowNode[], mode: FlowMode, deckOff = false): DeckQuote {
  const off: DeckQuote = { on: false, maxCards: 0, cards: 0, wants3d: false, max3d: 0, model3d: 0, total: 0 };
  if (mode === "simple" || deckOff || nodes.length === 0) return off;
  const cards = deckCardsCost(DECK_MAX_CARDS);
  const wants3d = styleWants3d(deckStyleBlob(nodes));
  const model3d = wants3d ? deckModel3dCost(DECK_MAX_3D) : 0;
  return {
    on: true,
    maxCards: DECK_MAX_CARDS,
    cards,
    wants3d,
    max3d: wants3d ? DECK_MAX_3D : 0,
    model3d,
    total: cards + model3d,
  };
}

/** 把流水线 + 分支归档转成观众侧互动分支树：
 *  某一段的"走向 p 有后续"= p 是选中走向（后续 = 流水线上它后面那些段）或 alts 里
 *  归档着 p 的续链（用户探索过又换走了的那条）。只有一条有效路线时观众无感自动续播。
 *  videoByProposal：合成出的真实视频按提案挂载（没有的分支渐变回退）。
 *  ★ 形状与老的 NodeSlot 树版逐义对应（children[pid] ≡ 选中走向的主链尾巴 / alts 归档），
 *    观众侧 BranchTree 的结构一个字段没变。 */
function buildBranchTree(
  chain: FlowNode[],
  alts: Record<string, Record<string, FlowNode[]>>,
  videoByProposal?: Record<string, string>,
): BranchTree | undefined {
  if (chain.length === 0) return undefined;
  /** 走向 p 在"节点 node 位于 rest 链首"这个语境下的后续链（无后续 = 空数组） */
  const tailOf = (node: FlowNode, p: Proposal, rest: FlowNode[]): FlowNode[] =>
    node.plan !== "picking" && p.id === node.chosenId ? rest : (alts[node.id]?.[p.id] ?? []);
  const validProposals = (node: FlowNode, rest: FlowNode[]): Proposal[] => {
    const opened = node.proposals.filter(
      (p) => (node.plan !== "picking" && p.id === node.chosenId) || tailOf(node, p, rest).length > 0,
    );
    return opened.length ? opened : node.proposals.filter((p) => node.plan !== "picking" && p.id === node.chosenId);
  };
  const head = chain[0];
  const headChosen = chosenProposal(head);
  if (!headChosen) return undefined;
  const nodes: BranchTree["nodes"] = {};
  let counter = 0;
  const build = (node: FlowNode, proposal: Proposal, rest: FlowNode[]): string => {
    const id = `b${counter++}`;
    const tail = tailOf(node, proposal, rest);
    const choices: BranchNodeData["choices"] = [];
    const child = tail[0];
    if (child) {
      for (const p of validProposals(child, tail.slice(1))) {
        choices.push({ label: p.title.replace(/^第\d+段 · /, ""), nextId: build(child, p, tail.slice(1)) });
      }
    }
    nodes[id] = {
      id,
      segment: {
        title: proposal.title,
        plot: proposal.plot,
        firstFrame: proposal.firstFrame,
        lastFrame: proposal.lastFrame,
        durationSec: proposal.durationSec,
        videoUrl: videoByProposal?.[proposal.id],
      },
      choices,
    };
    return id;
  };
  // 第一段展开过多个走向 → 开场就让观众选（此前只从 chosen 那条建树，
  //  用户在第一段辛苦造的另一条走向永远不会被观众看到）
  const restAfterHead = chain.slice(1);
  const headOpened = validProposals(head, restAfterHead);
  const startChoices =
    headOpened.length > 1
      ? headOpened.map((p) => ({
          label: p.title.replace(/^第\d+段 · /, ""),
          nextId: build(head, p, restAfterHead),
        }))
      : undefined;
  const rootId = startChoices ? startChoices[0].nextId : build(head, headChosen, restAfterHead);
  // 只有一条直线且无任何分岔时没必要带树
  const hasFork = !!startChoices || Object.values(nodes).some((n) => n.choices.length > 1);
  return hasFork ? { rootId, nodes, startChoices } : undefined;
}

// ★ 这里原来有 segToProposal / slotFromSegments / slotFromBranchTree 三个助手：
//   把【已发布作品的成片】反推回工坊的节点树，供回炉重制用。
//   回炉功能已删（见下面那段注释），这三个也跟着一起拿掉。
//   往工坊里铺内容只剩两条路：新开一摊，或者 openWorkDraft 打开一条草稿。
//
//   ⚠ 删掉的那一版里有两处别人后补的修正（成片 videoUrl 要带回来、画幅要从段里读），
//     都只在回炉路径上生效。万一以后回炉重新做起来，别从头写——去 git 历史里捞
//     （合并 origin/main 到本分支的那一次冲突解决，2026-08-11）。

/**
 * 老草稿的 NodeSlot 树 → 流水线 + 分支归档（**单一真相后的一次性换算**，只有
 * openWorkDraft 打开带 `root` 的存量草稿时走）。活动链沿 chosenId 铺成 nodes；
 * 未选走向的子树各自铺成链、按「节点 id → 走向 id → 续链」收进 alts —— 语义与当年的
 * children 一一对应，分支互动的原料一张不丢。
 * ★ 方案按引用带走；videoUrl 镜像进 videoByProposal（流水线的"出片了吗"读它）。
 */
function flowFromRoot(root: NodeSlot): { nodes: FlowNode[]; alts: Record<string, Record<string, FlowNode[]>> } {
  const alts: Record<string, Record<string, FlowNode[]>> = {};
  const convert = (slot: NodeSlot, chainIndex: number): FlowNode => {
    const fn: FlowNode = {
      id: uid("fn"),
      proposals: slot.proposals,
      chosenId: slot.chosenId ?? slot.proposals[0]?.id ?? "",
      plan: slot.chosenId == null ? "picking" : "picked",
      requirement: slot.requirement ?? "",
      videoTier: slot.videoTier ?? DEFAULT_TIER,
      aspect: slot.aspect ?? "landscape",
      materials: slot.materials,
      chain: chainIndex > 0,
      videoByProposal: Object.fromEntries(
        slot.proposals.filter((p) => p.videoUrl).map((p) => [p.id, p.videoUrl as string]),
      ),
      status: "idle",
      anns: [],
      tpl: null,
    };
    // 未选走向的子树 → 归档链（递归：孙辈分支挂在各自的节点 id 下）
    for (const p of slot.proposals) {
      if (p.id === slot.chosenId) continue;
      const child = slot.children[p.id];
      if (child) (alts[fn.id] ??= {})[p.id] = chainFrom(child);
    }
    return fn;
  };
  const chainFrom = (slot: NodeSlot): FlowNode[] => {
    const out: FlowNode[] = [];
    let cur: NodeSlot | null = slot;
    while (cur) {
      out.push(convert(cur, out.length));
      cur = cur.chosenId ? (cur.children[cur.chosenId] ?? null) : null;
    }
    // 承接判定按 startFlow 的老口径：本段设定首帧就是上一段设定尾帧才算承接
    //（用户传过自定义开头帧的段保持独立起拍，别让 genNode 的 carry 把它顶掉）
    for (let i = 1; i < out.length; i++) {
      const p = out[i].proposals.find((q) => q.id === out[i].chosenId);
      const prevP = out[i - 1].proposals.find((q) => q.id === out[i - 1].chosenId);
      out[i] = { ...out[i], chain: !!(p && prevP && p.firstFrame === prevP.lastFrame) };
    }
    return out;
  };
  return { nodes: chainFrom(root), alts };
}

// ★ 这里原来有 EditTarget / startEditPart / startNewPart —— 「回炉编辑已发布作品」的一整套。
//   2026-08 产品定案删掉：**作品一经发布就不能回炉**。
//   删掉的理由不是嫌它复杂，是它在"已经有人看过/收藏过这条作品"之后仍然允许换掉成片，
//   于是同一个链接下的内容会变，而观众那边没有任何提示。要改内容 = 重新发一条。
//   服务端同步收窄：PATCH /api/branch/videos/:id 只收 title/category/description/visibility，
//   片段与卡组一律 strip（docs/api-contract.md）。草稿不受影响 —— 那是**还没发布**的半成品，
//   继续编辑天经地义，走的是 openWorkDraft 那条路。

interface StudioState {
  deck: Card[];
  spreadOpen: boolean;
  spreadCenter: number;
  market: { open: boolean; items: Card[]; query: string; loading: boolean; page: number };
  marketDetail: Card | null;
  /** busy = 正在炼卡（只有 forgeCards 设它）；thinking = 正在等聊天回复。
   *  两者分开：TableScene 读 busy 决定她"慵懒对坐"的姿态，聊天不该打断它。
   *  messages **有意不持久化**——退出工坊即散，不是没来得及做。 */
  dialog: { messages: DialogMsg[]; busy: boolean; thinking: boolean };
  /** 最近一次开口是"做事播报"还是"闲聊"。见 TripoNpc：播报可带笑意，闲聊不行。 */
  speakTone: "act" | "chat";
  pendingFiles: MaterialFile[];
  /** 聚焦的桌面卡：nodeId=null 表示聚焦虚线占位卡；null=未聚焦（默认俯视机位）。
   *  ★ 节点数据本身在 flowStore.nodes（单一真相，见 activePath 的 ★★）——本 store
   *  只留桌面自己的视图状态（聚焦/投影/镜头/编辑表单） */
  focus: { nodeId: string | null } | null;
  /** 投影窗内容：editor=四区编辑表单；proposals=三方案选择；decks=卡组选择；
   *  卡片悬浮当且仅当投影打开 */
  projection: "editor" | "proposals" | "decks" | null;
  /** 卡组选择视角：镜头拍玩家上半身（思考姿势），投影里选一套卡组 */
  /**
   * 工作流画布这一面开着没有（2026-08-30 合并后新增）。
   * ★★ 必须放 store 而不是 StudioPage 的 useState：这一页会在**去挂卡编辑页再回来**时
   *   整个重挂（路由离开 /studio），局部 state 归零 —— 用户本来在画布里给白模段挂卡，
   *   回来却落回 3D 桌面，画布上的工作现场没了。store 是模块级单例，跨路由活着；
   *   projection / deckView / spreadOpen 这些「哪一面开着」本来就都在这里。
   * ★ 顺带它也就进了返回栈（backStepOf）：按返回先收画布，而不是越过它退工坊。
   */
  canvasOpen: boolean;
  setCanvasOpen: (v: boolean) => void;
  deckView: boolean;
  /** 点卡组堆：打开卡组小窗（窗内右上角在"卡组/卡片"两个视图间切换） */
  openDeckView: () => void;
  /** 当前选用的卡组：id=null 表示"全部卡片"；null=尚未选过（默认全部） */
  activeDeck: { id: string | null; name: string } | null;
  /** 选定卡组：把它设为桌面工作卡组（编辑器素材池），小窗随即切到卡片视图。
   *  返回 false = 该卡组是空的（不切换） */
  pickDeck: (deckId: string | null, name: string) => boolean;
  /** 相机轨道中心：非 null 时，在投影窗之外的画布上拖拽 = 绕该中心做球面运动
   *  （相机始终看向圆心）。node=节点卡坐标；player/npc=对应角色头部（每帧动态解析）。
   *  取代了旧的"自由视角平移"——球面运动更可控且天然不会飞出场景 */
  orbit: { target: "node" | "player" | "npc"; point?: [number, number, number] } | null;
  /** 点击 3D 场景里的 NPC：切对话机位 + 弹出对话框（对话框默认隐藏） */
  openNpcDialog: () => void;
  editor: EditorState | null;
  dragCardId: string | null;
  /** 对话视角（底部抽屉展开）：NPC 抬手面向用户 */
  dialogView: boolean;
  /** NPC 手中展示的 AI 推荐卡（按用户卡组缺口 + 市场热度） */
  flights: Flight[];
  draft: DraftVideo | null;
  /**
   * 合并页的音轨预置线索（2026-08-20，分段模板组）：原片地址，剪辑页拿它默认混入
   * 「原视频音轨」。**不进 DraftVideo**（那是发布体的形状，服务端 schema 会 strip，
   * 也没理由把它发出去）；draft 为 null 时它读不到，所以清 draft 的几处不用跟着清。
   * 只有 finalizeFromFlow 会写真值（读 FlowNode.tpl.group.sourceUrl），其余产稿路写 null。
   */
  draftAudioHint: string | null;
  camera: CamView;
  /** NPC 正在说话的截止时间戳（npcSay 设置，驱动 3D 口型） */
  speakingUntil: number;
  /** 情绪脉冲：-1（不悦收敛）~ 1（笑意拉满），moodUntil 过期后回归常态浅笑 */
  mood: number;
  moodUntil: number;
  setMood: (mood: number, ms: number) => void;
  /** 玩家形象（第一人称手臂/选择界面），localStorage 持久化；rin/gratia 仅 DEV 构建可选 */
  playerAvatar: PlayerAvatar;
  setPlayerAvatar: (a: PlayerAvatar) => void;
  avatarPickerOpen: boolean;
  setAvatarPickerOpen: (open: boolean) => void;

  npcSay: (text: string, kind?: DialogMsg["kind"]) => void;
  meSay: (text: string, kind?: DialogMsg["kind"]) => void;
  initGreet: () => void;
  setCamera: (c: CamView) => void;
  setDialogView: (v: boolean) => void;
  /** 计算推荐卡：优先补齐卡组缺失类型中市场最热的一张 */
  /** 查看卡片详情（不移动相机；复用市场详情单） */
  viewCardDetail: (card: Card) => void;

  openMarket: () => Promise<void>;
  marketSearch: (q: string) => Promise<void>;
  /** 市场翻页（照卡组展开排的 shiftSpread 那套；d=±1）。夹在合法页内，不循环 */
  shiftMarket: (d: number) => void;
  closeMarket: () => void;
  viewMarketCard: (card: Card, camPos: [number, number, number], look: [number, number, number]) => void;
  closeMarketDetail: () => void;
  addMarketToDeck: (from: [number, number, number]) => void;

  addFiles: (files: MaterialFile[]) => void;
  removeFile: (name: string) => void;
  sendToNpc: (text: string) => Promise<void>;
  /** 闲聊往返。路由在 UI 层（npcIntent），这里只管"聊"这一档。 */
  chatToNpc: (text: string) => Promise<void>;
  /** 聊天专用出口：kind:"chat"、清 mood 脉冲、过 chatSeq 闸再出声 */
  npcReply: (text: string, opts?: { offline?: boolean; blocked?: boolean; seq?: number }) => void;
  /** 心理危机：本地常量、不调模型、不出声、不扣费、不进上下文 */
  crisisReply: () => void;
  /** 帮助档：本地文案，0 token */
  helpReply: () => void;
  /**
   * 只炼不收：生成的卡进预览槽，落账/入组要等 acceptForge。
   * 失败抛出——素材窗要把原因显示在窗里，吞掉就成了"点了没反应"。
   *
   * ★ 返回的 `minted[i]` = 第 i 张卡**真画成了几张图**（卡面算一张），结算按它走。
   *   旧版返回的是 Card[]，调用方拿 `cards.filter(c => c.genPrompt).length` 当"成了几张"——
   *   一张卡一个布尔，一卡多图之后它物理上表达不了"该画 3 张、成了 2 张"：
   *   用户被全额收费，界面一个字都不会说（铁律八）。
   * ★ tierId 缺省 = 默认档（economy.imageTierOf 兜底），不在这里写第二处默认值。
   */
  forgeCards: (
    files: MaterialFile[],
    note: string,
    type: CardType | null,
    tierId?: string,
  ) => Promise<{ cards: Card[]; minted: number[]; notes: string[] }>;
  /**
   * 铸卡进行中的实时阶段播报（generateCards 的 onProgress 写进来）。
   * ★ 为什么不逐条 npcSay：顶档一炉两张图、每张实测 70 秒以上（economy.IMAGE_TIERS），
   *   逐条进消息流会把对话历史冲成日志，而且 npcSay 每条都要合成语音念一遍 ——
   *   声音会落后画面好几分钟。所以它是**一行会被覆盖的状态**，由素材窗按钮与对话气泡
   *   直接显示；她"开炉/出炉"那两句仍然走 npcSay。
   */
  forgeProgress: string;
  /**
   * 收下这批卡：归入账号资产 + 入组 + 从铸卡师手边飞过来。
   *
   * ★ 之所以是 async：入账那一步（data/account.addCards）要把新画的形象参考图逐张
   *   转存成永久地址，而**转存失败必须由她当场说出来**——那几张图是真金白银画的，
   *   悄悄丢掉才是最糟的结果（铁律八）。
   * ★ 但它**永不 reject**：调用方（NpcDialog 的 accept）是同步的、收完就关窗，
   *   抛出去只会变成没人接手的 unhandledrejection。
   */
  acceptForge: (cards: Card[]) => Promise<void>;

  landFlight: (id: string) => void;

  focusPlaceholder: (pos: [number, number, number], look: [number, number, number]) => void;
  focusNode: (nodeId: string, pos: [number, number, number], look: [number, number, number]) => void;
  /** 方案窗内 ‹› 切换聚焦节点：focusNode 有"投影打开即拒绝"的闸门，
   *  窗内切换必须绕过它——保持 proposals 投影开着，只换焦点与机位 */
  switchFocusNode: (nodeId: string, pos: [number, number, number], look: [number, number, number]) => void;
  /** 点击卡片之外的桌面区域：落卡 + 拉远回默认机位（投影打开时无效） */
  unfocus: () => void;
  /** 关闭投影窗（保持聚焦机位，卡片落下；再点空白桌面拉远） */
  closeProjection: () => void;
  toggleSpread: () => void;
  shiftSpread: (dir: 1 | -1) => void;
  pickDeckCard: (cardId: string) => void;
  setDrag: (cardId: string | null) => void;
  dropOnPlaceholder: (cardId: string, pos: [number, number, number], look: [number, number, number]) => void;

  clearSlot: (cardId: string) => void;
  /** 正在 AI 改图的帧（`${proposalId}:first|last`）；null=空闲 */
  frameRefining: string | null;
  /** 方案设定图选帧改图：Seedream 图生图按要求重画首/尾帧并回写方案 */
  refineProposalFrame: (nodeId: string, proposalId: string, which: "first" | "last", req: string) => Promise<boolean>;

  // ── 方案台（与工作流共用 PlanBoard 组件，见 ui/PlanBoard.tsx）────────
  /** 改某一套方案的标题/剧情/时长（只有选定的那一套可改，见 PlanBoard） */
  patchProposal: (nodeId: string, proposalId: string, patch: Partial<Proposal>) => void;
  /** 在方案卡上换首/尾帧：dataUrl 为本地图（上锁，AI 重画时不动它）；空串 = 清掉交回 AI */
  setProposalFrame: (nodeId: string, proposalId: string, which: "first" | "last", dataUrl: string) => void;
  /** 按用户改过的剧情/换过的帧，让 AI 重画**这一套**的画面（不重写剧情——那是用户刚敲的字） */
  regenProposal: (nodeId: string, proposalId: string) => Promise<boolean>;
  /** 重新推演这一节点的三套方案（要求不变，换一批走向）。已出片或已延展子树的旧方案保留 */
  regenNodeProposals: (nodeId: string) => Promise<boolean>;
  /** 正在按修改重画的方案 id；null=空闲 */
  proposalRegen: string | null;
  setVideoTier: (id: string) => void;
  setAspect: (a: VideoAspect) => void;
  /** 上传/清除本段开头帧（null=恢复默认承接上一节点尾帧） */
  setStartFrame: (dataUrl: string | null) => void;
  setEndFrame: (dataUrl: string | null) => void;
  /** 向导第①页：挂/摘示例视频（editor 期暂存，layCustomNode 落地进节点） */
  setEditorRefVideo: (ref: { url: string; publicId: string; durationSec: number; localUrl?: string } | null) => void;
  addEditorMid: (dataUrl: string) => void;
  removeEditorMid: (idx: number) => void;
  /** 自定义直出：不推演，把编辑器里的帧+要求铺成一张**已选定单方案**的节点卡。
   *  出片仍走方案台那颗「炼这一段视频」（generateSegment/报价一行没改） */
  layCustomNode: () => void;
  /** 铸段向导第①步选「套模板」：就地落一张白模节点卡（不再把人赶去画布那一面）。
   *  规则全在 flowStore（appendNode 门禁 + setNodeTemplate 快照/闸），这里只是编排 */
  layTemplateNode: (t: VideoTemplate) => void;
  setRequirement: (v: string) => void;
  setDurationMode: (m: "ai" | "manual") => void;
  setDurationSec: (v: number) => void;
  closeEditor: () => void;
  generateNode: () => Promise<void>;

  chooseProposal: (nodeId: string, proposalId: string) => void;

  /** 点法阵：去工作流那一面（同一条流水线，见 activePath 的 ★★单一真相）。
   *  流水线是空的就说一句该先铸段——不导航到一个会被弹回创作入口的页。
   *  ★ 导航本身在 StudioPage（store 里没有 router）：这里只把意图记在 goFlowAt 上。 */
  requestFlow: () => void;
  /** requestFlow 的意图时间戳（0 = 没有待处理的跳转）。StudioPage 监听它执行 navigate */
  goFlowAt: number;

  /** 单独炼工坊节点卡上的这一段（不铺整条工作流）。用户可以只挑几段先看效果，
   *  剩下的留到最后一起炼——出片结果写在方案的 videoUrl 上，两个模式都认。 */
  genNodeVideo: (nodeId: string, proposalId: string) => Promise<boolean>;
  /** 正在单独炼的那个方案 id（节点卡上转圈用）；null = 没在炼 */
  nodeGen: { proposalId: string; steps: GenStep[] } | null;

  /** 非 null = 剪辑页正在「只编辑某一段」模式（从节点卡的「编辑本段」进来的）。
   *  这时剪辑页的下一步不是合并发片，而是把改完的这一段写回方案再回工坊。 */
  segEdit: { nodeId: string; proposalId: string } | null;
  /** 把某一段包成单段草稿丢给剪辑页 */
  openSegmentEdit: (nodeId: string, proposalId: string) => void;
  /** 退出单段编辑。save=true 时把剪辑页改过的帧与视频写回方案（含下一段的起拍衔接） */
  closeSegmentEdit: (save: boolean) => void;
  /**
   * 工作流全部跑完 → 组稿：真帧回写节点树 + 提炼本片卡组 + 生成草稿（进剪辑页）。
   *
   * ★★ `mode` 是**显式参数**，不在函数体里 `useFlow.getState().mode` 偷读。
   *   这个函数三种创作模式共用，而"简约模式不出卡组"这条规则完全取决于它 ——
   *   偷读的话，调用点上看不出"模式会改变这次组稿花多少钱"，而 FlowPage 那侧
   *   还得自己再读一次同样的东西去报价，两次读的中间隔着一个 await（用户可能
   *   已经退出去换了模式）。调用方只有 FlowPage 一处，显式传的成本是一个参数。
   */
  finalizeFromFlow: (nodes: FlowNode[], mode: FlowMode, onProgress?: (status: string) => void, deckOff?: boolean) => Promise<boolean>;
  /**
   * 「这次组稿在跑吗」—— **store 级**，不许只活在组件的 useState 里。
   * ★★ 2026-08-21 第八轮扫描的 high：组稿要几十秒（提炼卡组最多 8 张 + 撞上 3D 关键词
   *   还要铸建模，都是真钱）。原来那个 `finalizing` 是 FlowPage 自己的 state ——
   *   用户中途退出这一页再进来，组件重挂载、标记归零，「完成视频」又可以点了：
   *   第二发照旧派生卡组、照旧铸 3D，**同一份内容收两遍钱**。
   */
  finalizing: boolean;
  /** finalizeFromFlow 的正文（外层只负责那道"同一时刻只跑一发"的闸），别直接调 */
  finalizeInner: (nodes: FlowNode[], mode: FlowMode, onProgress?: (status: string) => void, deckOff?: boolean) => Promise<boolean>;
  clearDraft: () => void;

  /**
   * 刚发布出去的那条作品 id；null = 这摊活还没发布（新的合成稿一出现就翻篇，见下）。
   *
   * ★★ 它存在的唯一理由是**创作流水线上那三页各有一个"内容没了就把人送走"的守卫**
   *   （/flow 看 nodes 空不空，/cut 与 /publish 看 draft 在不在），而"内容没了"其实有
   *   两种截然不同的原因：
   *     ① 直接输地址闯进来 / 热更新丢了状态 —— 送回创作入口是对的；
   *     ② **刚刚发布成功**，draft 是发布页自己清掉的 —— 这几格历史已经是死页。
   *   两种原因不分家的后果就是 2026-08-14 用户报的那个 bug：工作流/简约模式发完片，
   *   落在作品页上，一按返回（安卓物理返回键在没注册 backButton 监听时就是
   *   `webView.goBack()`，见 @capacitor/app 的 AppPlugin）就退回 `#/cut` 那一格 ——
   *   CutPage 重新挂载、draft 已经是空的、它自己的 leftRef 又是新的 false，于是
   *   `navigate("/studio")` 把人扔进了他从来没去过的 3D 工坊。
   *   （工坊模式的人不会报这个 bug：他本来就是从工坊出发的，落回工坊看着像"正常返回"。）
   * ★ 一处实现（铁律六）：三页都问 `publishedExit()`，别各自判各自的。
   */
  publishedWorkId: string | null;
  /**
   * 发布成功收工：记下作品 + 清掉合成稿 + 退休对应的在途草稿。
   *
   * ★ 三件事**必须一次做完**，尤其是前两件必须在同一个 set 里：清稿会立刻把发布页
   *   打回"没内容"的守卫分支（HashRouter 的路由切换是 startTransition，属于低优先级，
   *   而 zustand 经 useSyncExternalStore 进来的是同步更新——React 会先把发布页用空
   *   draft 重画并跑一遍它的 effect，路由那一拍还没落地）。中间只要隔一拍没有这块牌子，
   *   守卫就会抢在跳转前把人送去工坊。
   */
  finishPublish: (videoId: string) => void;
  /**
   * 把当前合成稿落盘。**唯一一处**（`draft` 的写路有五处，各写一遍 idbSet 必然分叉）。
   * @returns `null` = 存住了；字符串 = **整句人话**的失败原因，调用方必须说出来（铁律八）——
   *   它的每一个调用点都恰好是"钱刚花出去"的那一拍。
   *   ⚠ 回执从 boolean 换成了句子（2026-08-30）：`segEdit` 那条路**根本不落盘**，
   *   而它原来 `return true` —— 调用方被告知"存住了"，实际一个字节都没写。
   *   两种结局用同一个 `false` 也不行：存储写失败与"这条路不该落盘"要说的话完全不同。
   */
  persistCutDraft: () => Promise<string | null>;

  // ── 在途工程草稿（data/drafts.ts）─────────────────────────
  // ⚠ 与上面的 `draft` 不是一回事：`draft` 是组稿产物（待发布的成片稿），
  //   这里的「工程草稿」是**还没做完**的半成品，工坊侧的节点树与工作流侧的流水线一起存。
  /** 当前正编辑的工程草稿 id；null = 这摊活还没存过 */
  workDraftId: string | null;
  /**
   * **确实落进草稿的"已出片段数"**——唯一实现，供「丢弃这条工作流」那道确认卡判断
   * "丢了到底烧不烧钱"（见 components/flow/DiscardFlowDialog）。
   * ★ 只有 saveWorkDraft 真的写成功才会动。存盘失败时**故意不动**：那一刻的真相就是
   *   "这一段还没存住"，把它当成存住了正是最危险的谎（用户会踏实地丢掉刚花钱炼的段）。
   * ★ 别拿 workDraftId 是否非空来替代：草稿 id 是上一次成功保存留下的，
   *   之后再炼一段而自动存盘失败，id 照样在——那会把"没存上"读成"存上了"。
   */
  savedDoneCount: number;
  /** 存盘。两个 store 的状态一起收进一条草稿。返回 null = 写失败（配额/隐私模式）。
   *  from = 从哪个模式点的保存，决定个人页上这条草稿默认推荐哪个入口 */
  saveWorkDraft: (opts?: { title?: string; from?: DraftMode }) => Promise<WorkDraftMeta | null>;
  /** 打开草稿：还原两侧状态。mode 决定进哪个模式；缺哪侧就地补出来 */
  /**
   * 「工坊现在有没有一炉在跑」—— 有就返回一句人话，没有返回 null。
   * ★★ 2026-08-21 第十一轮抓到的 high（我上一轮亲手引入）：工坊「同一时刻只炼一段」的
   *   **唯一**锁就是 `nodeGen`（`genNodeVideo` 开头那句 `if (nodeGen) return false`，
   *   UI 的 disabled 也只由这三格算出）。上一版为了"新打开的草稿方案台别整块禁着"
   *   把它们无条件清成 null —— 等于把锁拿掉：出片跑着的时候去打开一条草稿，回来就能
   *   再点一次，两炉并发、各扣各的钱，还抢方舟并发额度。
   *   正解不是清锁，是**在途就别换**（与 flowStore.canReplaceNodes 对称）。
   */
  studioBusyReason: () => string | null;
  /** 返回 false = 被 studioBusyReason 拒了（原因由调用方念出来） */
  openWorkDraft: (d: WorkDraft, mode: DraftMode) => boolean;
  /** 开始一摊全新的活：断开与上一条草稿的关联，之后保存会新建而不是覆盖 */
  newWorkDraft: () => void;
  /** 这摊活已经发布成作品了：删掉对应草稿并断开关联 */
  retireWorkDraft: () => Promise<void>;

  // ── 返回栈 ────────────────────────────────────────────────
  /** 返回被拒绝之类的瞬时提示。★ 不用 npcSay：投影窗打开时 NpcDialog 整个
   *  `if (projection) return null`，铸卡师说了用户根本看不见。
   *  带 at 时间戳是为了让"同一句话连按两次"也能重新触发定时器（对象引用变了）。 */
  notice: { text: string; at: number } | null;
  /** 退出对话模式：掐语音 + 回第一人称眼位 + 解轨道。原来散在 NpcDialog.closeAll() 里 */
  exitDialog: () => void;
  /** 返回按钮/安卓返回键的唯一决策点。true = 这次返回已被工坊消费，调用方别再退路由 */
  goBack: () => boolean;
}

/**
 * 入账时没能转存成永久地址的形象参考图 —— **由铸卡师说出来**（铁律八）。
 *
 * ★ 一处实现：收下新铸的卡与收藏市场卡两条路共用。这句话必须说清三件事——
 *   丢的是哪几张、为什么、以及用户能做什么；只说"同步失败"等于没说。
 * ★ 走 npcSay 而不是 notice：notice 是几秒就消失的瞬时提示，而这条是"你花钱画的图
 *   有可能没了"，得留在对话历史里能翻回去看。
 */
function sayLostViews(r: AddCardsResult, s: Pick<StudioState, "npcSay" | "setMood">): void {
  if (r.lostViews.length === 0) return;
  const head = r.lostViews.slice(0, 3).join("、");
  s.npcSay(
    `${head}${r.lostViews.length > 3 ? ` 等 ${r.lostViews.length} 张` : ""}没能存到服务器（${r.reason ?? "上传失败"}）` +
      `——这几张只留在这台设备上，换设备或者重新登录就没了。想留住的话，回卡片详情页把它重新挂一次。`,
  );
  s.setMood(-0.6, 3000);
}

const DEFAULT_EDITOR: EditorState = {
  slots: [],
  requirement: "",
  durationMode: "ai",
  durationSec: 6,
  videoTier: DEFAULT_TIER,
  aspect: DEFAULT_ASPECT,
  startFrame: null,
  endFrame: null,
  refVideo: null,
  generating: false,
  progress: "",
};

/** 新开一次铸段面板。画幅继承路径上最后一段：一部片里横竖混着来，剪辑页合并时
 *  只能挑一个画布，另一种画幅的段必然被裁或补边——默认延续是唯一不出事的选择。 */
function freshEditor(slots: string[]): EditorState {
  const path = activePath();
  const prev = path[path.length - 1];
  return { ...DEFAULT_EDITOR, slots, aspect: prev?.aspect ?? DEFAULT_ASPECT };
}

// 市场检索的请求序号：过期响应直接丢弃，防止慢请求乱序覆盖新结果
let marketSeq = 0;
/** 聊天世代号。照 marketSeq 那套：过期回调可以照记消息，但**一定不出声**
 *  ——否则用户发完就切页面，她会在首页开口。 */
let chatSeq = 0;
// 节点生成的全局并发闸：取消编辑器再重开也不允许并发两炉
let nodeGenInFlight = false;

/**
 * 返回栈的层级。**这是返回优先级的唯一定义**——goBack() 与顶栏按钮文案都读它，
 * 两边不会慢慢走偏。
 *
 * 排序依据不是"最近打开的先关"（store 里没有打开时序，也不该为此新增），而是两条
 * 可判定的客观依据：
 *   A 视觉遮挡——谁盖在谁上面就先关谁。工坊 z 层是既定的：
 *     canvas 0 < NPC 气泡 10 < 投影窗 20 < 记录窗/素材窗/换形象 30 < 形象选择 40
 *   B 打开路径的包含关系——市场只能从对话里开、卡片详情只能从市场里开，那就先关里层
 *
 * 推翻过两级，写下来免得有人再加回去：
 *   · eyeRise（双指升空俯瞰）不进栈：它是 scene/cameraOrbit 的模块级单例、非响应式，
 *     顶栏拿不到它做文案；而且同一个捏合手势就能降回来。塞进来会出现"屏幕上什么
 *     浮层都没有、按返回却像没反应"。它已随 camera.kind==="default" 自动复位。
 */
export type BackStep =
  | "avatar"
  | "cardDetail"
  | "canvas"
  | "projectionBusy"
  | "projection"
  | "market"
  | "dialog"
  | "deck"
  | "focus"
  | "spread"
  | "home";

export function backStepOf(s: StudioState): BackStep {
  if (s.avatarPickerOpen) return "avatar";
  if (s.marketDetail) return "cardDetail";
  // 画布是 z-40 全屏浮层，盖住投影窗与整个桌面 —— 用户眼里的「上一步」就是收起它
  if (s.canvasOpen) return "canvas";
  if (s.projection) return s.projection === "editor" && s.editor?.generating ? "projectionBusy" : "projection";
  if (s.market.open) return "market";
  if (s.dialogView) return "dialog";
  if (s.deckView) return "deck";
  if (s.focus || s.camera.kind !== "default") return "focus";
  if (s.spreadOpen) return "spread";
  return "home";
}

/** 返回按钮上的文案：**按钮自己说出它会做什么**。去掉对话气泡的 ✕ 之后，
 *  这是"按返回可以退出对话"最主要的可发现性来源。 */
export function backLabelOf(s: StudioState): string {
  const step = backStepOf(s);
  if (step === "canvas") return "收起画布";
  if (step === "projectionBusy") return "推演中";
  if (step === "projection")
    return s.projection === "decks" ? "退出卡组" : s.projection === "editor" ? "取消铸段" : "收起方案";
  const map: Record<Exclude<BackStep, "projection" | "projectionBusy" | "canvas">, string> = {
    avatar: "返回",
    cardDetail: "返回",
    market: "收起市场",
    dialog: "退出对话",
    deck: "退出卡组",
    focus: "拉远视角",
    spread: "收起卡组",
    home: "首页",
  };
  return map[step as Exclude<BackStep, "projection" | "projectionBusy" | "canvas">] ?? "返回";
}

export const useStudio = create<StudioState>()((set, get) => ({
  deck: [],
  spreadOpen: false,
  canvasOpen: false,
  setCanvasOpen: (v) => set({ canvasOpen: v }),
  deckView: false,
  orbit: null,
  spreadCenter: 0,
  market: { open: false, items: [], query: "", loading: false, page: 0 },
  marketDetail: null,
  dialog: { messages: [], busy: false, thinking: false },
  speakTone: "act",
  pendingFiles: [],
  forgeProgress: "",
  focus: null,
  projection: null,
  editor: null,
  dragCardId: null,
  dialogView: false,
  flights: [],
  draft: null,
  draftAudioHint: null,
  camera: { kind: "default" },
  speakingUntil: 0,
  mood: 0,
  moodUntil: 0,
  setMood: (mood, ms) => set({ mood, moodUntil: Date.now() + ms }),
  playerAvatar: ((): PlayerAvatar => {
    const v = localStorage.getItem("ideahub-app.avatar");
    // 开发试穿档只在 DEV 构建下生效：生产构建里存量 localStorage 值安全回退到默认
    if (import.meta.env.DEV && (v === "rin" || v === "gratia" || v === "tsumire")) return v;
    return v === "m" ? "m" : "f";
  })(),
  setPlayerAvatar: (a) => {
    localStorage.setItem("ideahub-app.avatar", a);
    set({ playerAvatar: a });
  },
  avatarPickerOpen: false,
  setAvatarPickerOpen: (open) => set({ avatarPickerOpen: open }),

  npcSay: (text, kind) => {
    // 先真出声。speak() 成功时口型由音频包络驱动（见 speech.ts / SPEECH），
    // speakingUntil 只作兜底：浏览器没有合成器、用户关了声音、或者念到一半被打断时，
    // 嘴仍然按字数估的时长动一动——总比一句话弹出来而人一动不动强。
    // 多情感音色要按心情换语气：把当前 mood 递过去（不能让 speech.ts 反向 import
    // store——依赖方向是 data → store → 组件）
    SPEAK_MOOD.v = get().mood;
    SPEAK_MOOD.until = get().moodUntil;
    speak(text);
    set((s) => ({
      speakTone: "act",
      dialog: { ...s.dialog, messages: [...s.dialog.messages, { id: uid("m"), from: "npc", text, kind }] },
      speakingUntil: Date.now() + Math.min(6000, Math.max(1500, text.length * 110)),
    }));
  },
  meSay: (text, kind) =>
    set((s) => ({ dialog: { ...s.dialog, messages: [...s.dialog.messages, { id: uid("m"), from: "me", text, kind }] } })),
  initGreet: () => {
    if (get().dialog.messages.length > 0) return;
    get().npcSay("欢迎来到卡片工坊。把你的素材（图片、文本）交给我，我为你炼成卡片；也可以逛逛市场，看看大家都在用什么。");
  },
  setCamera: (camera) => set({ camera }),
  setDialogView: (dialogView) => set({ dialogView }),
  viewCardDetail: (card) => set({ marketDetail: card }),

  openMarket: async () => {
    if (get().market.open) return;
    const seq = ++marketSeq;
    // 摊开的卡平放在桌面：对话平视角下不可读，统一切回俯视机位
    set((s) => ({
      market: { ...s.market, open: true, loading: true, query: "", page: 0 },
      camera: { kind: "default" },
    }));
    // ★「下面」是假的：MarketTopBar 钉在 top-12，搜索框在**上面**
    // ★★ 这句话曾经是**假的**（2026-08-30 修）：这张桌子读的是 `ai.searchMarket`，
    //   而它 2026-08-24 起硬写成 `async () => []` —— 铸卡师照常演"抽出一叠卡摊在桌上"，
    //   桌上永远一张都没有。现在真接到服务端广场（data/account.plazaCards，与创意工坊
    //   那一格同一个来源、同一份映射），演出与事实对上了。
    get().npcSay("（抽出一叠卡摊在桌上）社区里最近热的。要找特定的，上面那条写词。", "act");
    const items = await plazaCards("");
    if (seq !== marketSeq) return; // 期间发起过新检索，丢弃本次结果
    set((s) => ({ market: { ...s.market, items, loading: false } }));
  },
  marketSearch: async (q) => {
    const seq = ++marketSeq;
    set((s) => ({ market: { ...s.market, loading: true, query: q, page: 0 } })); // 换了词就回第一页
    const items = await plazaCards(q);
    if (seq !== marketSeq) return; // 过期响应
    set((s) => ({ market: { ...s.market, items, loading: false } }));
    // 0 张时不能说"翻出了 0 张，都给你摊开了"——自相矛盾
    get().npcSay(
      q ? (items.length ? `按「${q}」翻出 ${items.length} 张。` : `「${q}」没有。换个词。`) : `当下最热的 ${items.length} 张。`,
      "act",
    );
  },
  shiftMarket: (d) =>
    set((s) => {
      const last = Math.max(0, Math.ceil(s.market.items.length / MARKET.perPage) - 1);
      return { market: { ...s.market, page: Math.min(last, Math.max(0, s.market.page + d)) } };
    }),

  closeMarket: () =>
    set((s) => ({
      market: { ...s.market, open: false },
      marketDetail: null,
      camera: s.focus || s.dialogView ? s.camera : { kind: "default" },
    })),
  viewMarketCard: (card, pos, look) => set({ marketDetail: card, camera: { kind: "pos", pos, look } }),
  // 投影窗（卡组小窗等）开着时关详情不动镜头——否则从小窗看完一张卡，
  // 相机就被拽回第一人称，小窗却还开着
  closeMarketDetail: () =>
    set((s) => ({ marketDetail: null, camera: s.focus || s.dialogView || s.projection ? s.camera : { kind: "default" } })),
  addMarketToDeck: (from) => {
    const card = get().marketDetail;
    if (!card) return;
    // ★★ 装卡走 `account.acquireCard` 这一处（2026-08-31 修）。原来这里直接 `addCards`，
    //   那正是 acquireCard 注释里点名要防的"第三颗按钮"（铁律六），后果有两层：
    //   ① 广场卡由 `sharedToCard` 打了 `published: true`，`addCards` 原样 `{...c}` 入库，
    //      于是**我库里那份**带着 published:true，而服务端那行是 false —— 卡片详情页据此
    //      显示「已在工坊 · 取消分享」、删卡确认卡说「删卡会同时下架」，全是假的
    //      （我从没分享过这一份）；点「取消分享」是打在一行本来就 false 的文档上的空操作，
    //      点完按钮翻成亮着的「分享到创意工坊」，按下去必被服务端 400。
    //   ② 绕过 `installSharedCard` = 拿不到**权威版本**（剥过 idb: 指针的建模、参考图）、
    //      没有 sourceOwner 标记、装机计数也不涨。
    //   ⚠ 别再改回 addCards：import 在这里叫 `saveCardsToAccount`，acquireCard 注释里
    //     写的自查命令 `rg "installSharedCard|addCards\(\["` 搜不到这个别名 ——
    //     这个洞就是这么藏了一路的。
    void acquireCard(card).then((r) => {
      if (!r.ok) {
        // 装不进库就别让它留在桌上：桌上的卡组下次进工坊是从 myCards() 重铺的，
        // 留着只会变成"上次明明加了、今天不见了"（铁律八：失败要当场说，别留到下次）
        set((st) => ({ deck: st.deck.filter((c) => c.id !== card.id) }));
        get().npcSay(`「${card.name}」没能装进你的卡片库：${r.why}`);
        get().setMood(-0.6, 3000);
        return;
      }
      // 装成了就用**库里那份**顶掉桌上的广场快照：install 拿回来的是权威版本，
      // 且 published 是本人视角的真值（我没分享过它）—— 详情页那排按钮读的正是它
      const mine = myCards().find((c) => c.id === card.id);
      if (mine) set((st) => ({ deck: st.deck.map((c) => (c.id === card.id ? mine : c)) }));
    });
    if (get().deck.some((c) => c.id === card.id)) {
      get().npcSay(`「${card.name}」已经在你的卡组里了。`);
      set({ marketDetail: null, camera: { kind: "default" } });
      return;
    }
    // 立即入组（业务状态不依赖渲染循环），飞行仅作视觉动画
    set((s) => ({
      marketDetail: null,
      camera: s.focus || s.dialogView ? s.camera : { kind: "default" },
      deck: [...s.deck, card],
      flights: [...s.flights, { id: uid("fl"), card, from, delay: 0 }],
    }));
    get().npcSay(`「${card.name}」归你了，好眼光。`);
    get().setMood(1, 3200);
  },

  addFiles: (files) =>
    set((s) => ({
      pendingFiles: [...s.pendingFiles, ...files.filter((f) => !s.pendingFiles.some((p) => p.name === f.name))],
    })),
  removeFile: (name) => set((s) => ({ pendingFiles: s.pendingFiles.filter((f) => f.name !== name) })),

  sendToNpc: async (text) => {
    // ★ 这里曾经做两件不该它做的事，都删了：
    //   ① 市场开着就把这句话当搜索词——市场早就有自己的搜索条（NpcDialog 的
    //      MarketTopBar），这是历史遗留，删掉不丢功能；
    //   ② 否则就把这句话当素材描述**直接炼一张卡**——全 app 唯一一个免确认花钱的
    //      入口，而且恰好挂在那个 placeholder 写着"和铸卡师聊聊…"的输入框上。
    // 现在它只做一件事：聊天。要搜要炼，由 UI 层的 npcIntent 路由到各自的确认口。
    await get().chatToNpc(text);
  },

  forgeCards: async (files, note, type, tierId) => {
    get().meSay(note || `（递上 ${files.length} 份素材）`);
    set((s) => ({ dialog: { ...s.dialog, busy: true }, forgeProgress: "" }));
    get().npcSay("收到，让我看看成色……（炉火升起）");
    try {
      // ★ onProgress 必须透传：顶档一张图实测 73.6 秒，一炉两张就是两分半。
      //   中间不报进度，用户看到的就是一个不动的"炼卡中…"——与卡死无从区分。
      const { cards, minted, notes } = await generateCards(files, note, type, {
        tierId,
        onProgress: (msg) => set({ forgeProgress: msg }),
      });
      if (cards.length === 0) {
        get().npcSay("这些素材还差点意思，再补充点描述？");
        get().setMood(-0.6, 2600);
      } else {
        // 一卡多图之后"几张卡"不再等于"几张图"，两个数都说出来——只报卡数的话，
        // 用户对着一张 12 万 token 的账单只看得到"3 张卡"
        const shots = minted.reduce((n, k) => n + k, 0);
        get().npcSay(
          `铛——${cards.length} 张卡的形已经出来了${shots > cards.length ? `，一共 ${shots} 张图` : ""}，你先过目。`,
        );
      }
      // ★★ notes 必须一路带出去，**不能只留在 forgeProgress 上**：那是一行会被下一条
      //   覆盖、并且被下面 finally 清空的状态文字。最常见的那种失败（只交一份素材、
      //   第 2 张出图 400）从写进 forgeProgress 到 finally 清掉全在同一条微任务链里，
      //   React 一帧都没画过 —— 用户只会拿到一句"该出 2 张、成了 1 张"，
      //   永远不知道缺的是哪张、为什么缺、要不要重炼（铁律八）。
      return { cards, minted, notes };
    } catch (e) {
      // 真实 AI 会因为余额/审核/网络失败。以前这里直接 throw 到无人接手的
      // Promise 上，界面只剩一个转不停的"炼卡中…"；现在由铸卡师说出来
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 80);
      get().npcSay(`炉子炸了……${msg}`);
      get().setMood(-0.8, 3000);
      throw e;
    } finally {
      set((s) => ({ dialog: { ...s.dialog, busy: false }, forgeProgress: "" }));
    }
  },

  acceptForge: async (cards) => {
    if (cards.length === 0) return;
    // ★ 先入组、先起飞，再等入账。入账里的转存要把 1~2 张 1MB 级的图传上去，手机上
    //   好几秒起步；把动画压在 await 后面，用户按下「收下」会看到卡凭空停在半空。
    //   业务状态不依赖渲染循环，从 NPC 手边错峰起飞的只是视觉动画。
    set((s) => {
      const fresh = cards.filter((c) => !s.deck.some((d) => d.id === c.id));
      return {
        deck: [...s.deck, ...fresh],
        flights: [
          ...s.flights,
          ...fresh.map((card, i) => ({ id: uid("fl"), card, from: [0.9, 1.25, -3.1] as [number, number, number], delay: i * 0.28 })),
        ],
      };
    });
    get().npcSay(`${cards.length} 张新卡飞进你的卡组了。`);
    get().setMood(1, 4000);
    // 收下才归入账号资产（创意工坊/Profile 可见）。★ 必须 await：这一步顺带把新画的
    //   形象参考图转存成永久地址，失败了要当场说出来 —— 不说的话，用户花 12 万 token
    //   画出来的那两张会在下次重登时无声消失（见 data/account.addCards 的 ★★）
    sayLostViews(await saveCardsToAccount(cards), get());
  },

  npcReply: (text, opts) => {
    // ★ 清掉 acceptForge 留下的 4 秒 joy 脉冲——"收完卡就打字"是最常见的下一个动作，
    //   不清的话她会笑意拉满地说"这个话头我接不住"
    set({ speakTone: "chat", mood: 0, moodUntil: 0 });
    // 降级应答与被拦下的那次都不出声：前者不是她说的话，后者不该被念出来
    if (!opts?.offline && !opts?.blocked && (opts?.seq === undefined || opts.seq === chatSeq)) {
      SPEAK_MOOD.v = 0;
      SPEAK_MOOD.until = 0;
      speak(text);
    }
    set((s) => ({
      dialog: {
        ...s.dialog,
        messages: [
          ...s.dialog.messages,
          { id: uid("m"), from: "npc", text, kind: "chat", offline: opts?.offline, blocked: opts?.blocked },
        ],
      },
    }));
  },

  crisisReply: () => {
    stopSpeaking(); // 这句不出声：清冷慵懒的合成嗓念自杀干预热线，可能被读成戏谑
    set((s) => ({
      speakTone: "chat",
      mood: 0,
      moodUntil: 0,
      dialog: {
        ...s.dialog,
        messages: [...s.dialog.messages, { id: uid("m"), from: "npc", text: CRISIS_LINE, kind: "sys" }],
      },
    }));
  },

  helpReply: () => get().npcSay(HELP_LINE, "chat"),

  chatToNpc: async (text) => {
    const t = text.trim().slice(0, 500);
    if (!t) return;
    const s0 = get();
    if (s0.dialog.thinking) return set({ notice: { text: "让我把上一句说完", at: Date.now() } });
    if (s0.dialog.busy) return set({ notice: { text: "上一炉还在炼，等它出炉再说", at: Date.now() } });
    // ★ 闸门通过之后才掐上一句。放在闸门前，被拒绝的那一次也会把她正念着的话掐掉
    stopSpeaking();
    const seq = ++chatSeq;
    get().meSay(t, "chat");
    set((st) => ({ dialog: { ...st.dialog, thinking: true } }));

    // ★ 余额不足 → **降级不封口**。聊天是这个角色存在感的唯一来源；余额为 0 就变哑巴，
    //   用户只会以为 app 坏了——而他刚花完钱，正是最需要被解释的时刻
    const paid = AI_REAL && canAfford(CHAT_TURN_TOKENS);
    const w = walletOf();
    const desk = {
      deckCount: s0.deck.length,
      segCount: s0.draft?.segments.length ?? 0,
      recentCards: s0.deck.slice(-3).map((c) => c.name),
      marketOpen: s0.market.open,
      lowBalance: (w?.plan ?? 0) + (w?.addon ?? 0) < CHAT_TURN_TOKENS * 10,
    };
    try {
      const { text: reply } = await (paid ? npcChat : npcChatOffline)({
        text: t,
        history: chatWindow(s0.dialog.messages),
        system: NPC_SYSTEM,
        deskBlock: deskBlock(desk),
      });
      if (paid) spendTokens(CHAT_TURN_TOKENS); // 成功才扣，与 refineProposalFrame 同口径
      get().npcReply(reply, { offline: !paid, seq });
    } catch (e) {
      console.warn("[studio] 对话失败:", e); // ★ 技术细节只进 console，不进台词
      const f = chatFailLine(e);
      get().npcReply(f.text, { blocked: f.blocked, offline: !f.blocked, seq });
    } finally {
      set((st) => ({ dialog: { ...st.dialog, thinking: false } }));
    }
  },

  landFlight: (id) =>
    set((s) => ({ flights: s.flights.filter((f) => f.id !== id) })),

  focusPlaceholder: (pos, look) => {
    const { deck, projection } = get();
    if (projection) return;
    if (deck.length === 0) {
      get().npcSay("你的卡组还是空的。先把素材交给我炼卡，或者说「逛市场」看看现成的。");
    }
    // 聚焦期间收起展开排（素材在投影窗内选择），画面只留浮卡
    set({
      focus: { nodeId: null },
      projection: "editor",
      editor: freshEditor([]),
      spreadOpen: false,
      camera: { kind: "pos", pos, look },
      // 绕节点卡本身做球面运动（look 是卡片处，即圆心）
      orbit: { target: "node", point: look },
    });
  },
  focusNode: (nodeId, pos, look) => {
    if (get().projection) return;
    set({
      focus: { nodeId },
      projection: "proposals",
      camera: { kind: "pos", pos, look },
      orbit: { target: "node", point: look },
    });
  },
  switchFocusNode: (nodeId, pos, look) =>
    set({
      focus: { nodeId },
      projection: "proposals",
      camera: { kind: "pos", pos, look },
      orbit: { target: "node", point: look },
    }),
  unfocus: () => {
    if (get().projection) return;
    set({ focus: null, editor: null, spreadOpen: false, deckView: false, camera: { kind: "default" }, orbit: null });
  },
  // 点 ✕ 关闭投影窗：一律回第一人称眼位（卡组选择关掉=没选，没理由留在角色特写）
  closeProjection: () =>
    set({
      projection: null,
      editor: null,
      focus: null,
      spreadOpen: false,
      deckView: false,
      camera: { kind: "default" },
      orbit: null,
    }),
  toggleSpread: () =>
    set((s) => ({ spreadOpen: s.deck.length > 0 && !s.spreadOpen })),
  // 点卡组堆：镜头移到玩家左侧拍上半身（思考姿势），投影里选一套卡组。
  // 两段式第一步——选中后 pickDeckToTable 回第一人称把卡摊上桌
  openDeckView: () => {
    const { projection } = get();
    if (projection) return;
    if (myCards().length === 0 && get().deck.length === 0) {
      get().npcSay("你还没有卡。先把素材交给我炼卡，或者说「逛市场」看看现成的。");
      return;
    }
    set({
      deckView: true,
      projection: "decks",
      spreadOpen: false,
      focus: null,
      camera: { kind: "pos", pos: DECK_CAM.pos, look: DECK_CAM.look },
      // 滑梯运镜落位后绕玩家头部球面运动
      orbit: { target: "player" },
    });
  },
  activeDeck: null,
  pickDeck: (deckId, name) => {
    let cards: Card[];
    if (deckId === null) {
      cards = myCards();
      // 会话里刚炼/刚收但还没进账号库的卡（未登录兜底）也别弄丢
      const have = new Set(cards.map((c) => c.id));
      cards = [...cards, ...get().deck.filter((c) => !have.has(c.id))];
    } else {
      const d = myDecks().find((x) => x.id === deckId);
      const byId = new Map(myCards().map((c) => [c.id, c]));
      cards = (d?.cardIds ?? []).map((id) => byId.get(id)).filter((c): c is Card => !!c);
    }
    if (cards.length === 0) {
      get().npcSay(`「${name}」还是空的——去创意工坊给它添几张卡吧。`);
      return false;
    }
    // 只换工作卡组（编辑器素材池同源），不动镜头不摊桌——卡片在小窗里看
    set({ activeDeck: { id: deckId, name }, deck: cards, spreadOpen: false, spreadCenter: 0 });
    return true;
  },
  // 点 3D 里的 NPC：切对话机位 + 弹出对话框（对话框默认隐藏，只由此处唤起）
  openNpcDialog: () => {
    const st = get();
    if (st.projection) return;
    set({
      focus: null,
      editor: null,
      spreadOpen: false,
      deckView: false,
      dialogView: true,
      camera: { kind: "pos", pos: NPC_CAM.pos, look: NPC_CAM.look },
      orbit: { target: "npc" },
    });
  },
  shiftSpread: (dir) =>
    set((s) => ({ spreadCenter: Math.min(Math.max(0, s.spreadCenter + dir), Math.max(0, s.deck.length - 1)) })),
  pickDeckCard: (cardId) => {
    const { deck, editor } = get();
    const card = deck.find((c) => c.id === cardId);
    if (!card || !editor || editor.generating) return;
    if (editor.slots.includes(card.id)) return;
    if (editor.slots.length >= 20) {
      get().npcSay("一炉最多放 20 张素材卡，先撤下几张再加。");
      return;
    }
    set({ editor: { ...editor, slots: [...editor.slots, card.id] } });
  },
  setDrag: (cardId) => set({ dragCardId: cardId }),
  dropOnPlaceholder: (cardId, pos, look) => {
    const { deck, editor } = get();
    const card = deck.find((c) => c.id === cardId);
    set({ dragCardId: null });
    if (!card) return;
    if (editor && !editor.generating) {
      if (!editor.slots.includes(card.id) && editor.slots.length < 20)
        set({ editor: { ...editor, slots: [...editor.slots, card.id] } });
      return;
    }
    if (get().projection) return;
    // 拖卡进占位 → 直接进入聚焦编辑（等效点击占位卡并预填素材）
    set({
      focus: { nodeId: null },
      projection: "editor",
      editor: freshEditor([card.id]),
      spreadOpen: false,
      camera: { kind: "pos", pos, look },
    });
  },

  clearSlot: (cardId) =>
    set((s) =>
      s.editor ? { editor: { ...s.editor, slots: s.editor.slots.filter((id) => id !== cardId) } } : {},
    ),

  frameRefining: null,
  refineProposalFrame: async (nodeId, proposalId, which, req) => {
    // ★ 这条路上的话一律走 notice 不走 npcSay：投影窗开着时 NpcDialog 整个 return null，
    //   而用户按下「按要求重画首/尾帧」的那一刻投影窗必然开着 —— npcSay 等于没说
    //   （2026-09-03 两面对照抓到，与 genNodeVideo 的写法同源）。
    const { frameRefining } = get();
    if (frameRefining || !req.trim()) return false;
    {
      const blocked = otherFaceBusy(nodeId); // 两面共用的那道闸，见它的 ★★
      if (blocked) {
        set({ notice: { text: blocked, at: Date.now() } });
        return false;
      }
    }
    const node = activePath().find((n) => n.id === nodeId);
    const prop = node?.proposals.find((p) => p.id === proposalId);
    if (!node || !prop) return false;
    // 改一次图 = 一张 Seedream。以前这里既不看余额也不扣费，用户改十版是白送十张
    if (AI_REAL && !canAfford(ONE_IMAGE)) {
      set({ notice: { at: Date.now(), text: `改图要 ${fmtTokens(ONE_IMAGE)} token，余额不够了——去「我的」页充值。` } });
      return false;
    }
    set({ frameRefining: `${proposalId}:${which}` });
    try {
      // ★ 带上素材卡的形象参考图：改一帧最常见的写法就是"让她换个表情/转个身"，
      //   而这类改动最容易把脸改跑。被改的那张帧恒为 <图片1>，所以绑定句 offset = 1。
      //   （没采用哪张、为什么只锁一个角色，由 npcSay 说出来 —— 这一条路没有步骤日志）
      // ★ 逐张参考图的提示**攒起来**接在终局那句后面：一条条 npcSay 在投影窗开着时看不见，
      //   一条条 notice 又会互相顶掉（Toast 只有一条）—— 攒起来才是真的被看见（铁律八）。
      const refNotes: string[] = [];
      const refTail = () => (refNotes.length ? `（${refNotes.join("；")}）` : "");
      const mat = await prepareMaterialRefs(node.materials, "image", (n) => refNotes.push(n));
      // 画幅跟节点走：改一次图就把竖屏方案的帧重画成横版，出片时又要被裁一刀
      const next = await refineFrame(
        `${req.trim()}${mat.bind(1)}`,
        which === "first" ? prop.firstFrame : prop.lastFrame,
        node.aspect,
        mat.refs.length > 0 ? mat.refs : undefined,
      );
      if (AI_REAL) spendTokens(ONE_IMAGE); // 出图成功才扣
      // ★★ 回包前确认**这一段还在流水线上**（单一真相版的"树还是当初那棵"）：改图要
      //   几十秒，这期间用户完全可以打开另一条草稿/换整条流水线 —— 认 id 不认下标，
      //   找不到就如实说，别把改动写进另一摊活里。
      const still = useFlow.getState().nodes.find((n) => n.id === nodeId)?.proposals.some((q) => q.id === proposalId);
      if (!still) {
        set({ notice: { at: Date.now(), text: "这张图改好了，但那一段已经不在流水线上了——改动没处写回（钱已经花了，抱歉）。" } });
        return false;
      }
      // 写路只有 flowStore 一条（单一真相）：指定方案改帧
      useFlow.getState().updateProposal(nodeId, which === "first" ? { firstFrame: next } : { lastFrame: next }, proposalId);
      set({ notice: { at: Date.now(), text: `${which === "first" ? "首" : "尾"}帧已按你的要求重画好了。${refTail()}` } });
      return true;
    } catch (e) {
      set({ notice: { at: Date.now(), text: `改图没成：${(e instanceof Error ? e.message : String(e)).slice(0, 90)}` } });
      get().setMood(-0.4, 2200);
      return false;
    } finally {
      set({ frameRefining: null });
    }
  },
  patchProposal: (nodeId, proposalId, patch) => {
    // 写路只有 flowStore 一条（单一真相）：指定方案打补丁
    useFlow.getState().updateProposal(nodeId, patch, proposalId);
  },

  setProposalFrame: (nodeId, proposalId, which, dataUrl) => {
    const node = activePath().find((n) => n.id === nodeId);
    const p = node?.proposals.find((q) => q.id === proposalId);
    if (!p) return;
    // 上锁：AI「按修改重画」时不动用户自己上传的帧（见 Proposal.pinned）
    useFlow.getState().updateProposal(
      nodeId,
      {
        ...(which === "first" ? { firstFrame: dataUrl } : { lastFrame: dataUrl }),
        pinned: { ...p.pinned, [which]: dataUrl ? true : undefined },
        degraded: undefined, // 换过的帧不再是"Seedream 没出图的占位帧"
      },
      proposalId,
    );
  },

  proposalRegen: null,
  regenProposal: async (nodeId, proposalId) => {
    const { proposalRegen, frameRefining, nodeGen } = get();
    // ★ 早退也要说话（铁律八）：原来这里是静默 return false，用户读到的是"点了没反应"
    if (proposalRegen || frameRefining || nodeGen) {
      set({ notice: { text: "上一炉还在跑，等它出炉再说。", at: Date.now() } });
      return false;
    }
    {
      const blocked = otherFaceBusy(nodeId); // 两面共用的那道闸，见它的 ★★
      if (blocked) {
        set({ notice: { text: blocked, at: Date.now() } });
        return false;
      }
    }
    const path = activePath();
    const idx = path.findIndex((n) => n.id === nodeId);
    const node = path[idx];
    const p = node?.proposals.find((q) => q.id === proposalId);
    if (!node || !p) return false;
    if (!p.plot.trim()) {
      set({ notice: { text: "这一套还没有剧情——先写点什么，我才知道要画成什么样", at: Date.now() } });
      return false;
    }
    // 承接上一段真实结尾的开头帧、以及用户自己上传的帧，一律不动
    const prev = idx > 0 ? chosenProposal(path[idx - 1]) : null;
    // ★ 两条都走 flowStore 的同一处判据/同一把尺（工坊那份第二实现 2026-09-03 退役）：
    //   keepFirstFrame 认 node.chain，redrawCost 就是画布报价用的那个函数。
    const keepFirst = keepFirstFrame(node, p, prev);
    const keepLast = !!p.pinned?.last;
    const cost = redrawCost(node, p, prev);
    if (cost === 0) {
      set({ notice: { at: Date.now(), text: "首尾帧都是你自己换的图，没有可让我重画的地方——想重画就先在卡里清掉那一帧。" } });
      return false;
    }
    if (AI_REAL && !canAfford(cost)) {
      set({ notice: { at: Date.now(), text: `重画这一套要 ${fmtTokens(cost)} token，余额不够了——去「我的」页充值。` } });
      return false;
    }
    set({ proposalRegen: proposalId });
    try {
      // ★ 必须把本段画幅递下去：Seedream 的画布比例得与视频画幅一致，缺了它重画出来的帧
      //   是横的，喂给竖屏 Seedance 任务会被静默裁一刀（人物常被裁掉半个头）。
      //   见 CLAUDE.md「改了画幅却发现出片还是横的」那一条
      // 素材卡的形象参考图一并带上：重画的是这一段的设定帧，人物当然还得是同一个人
      // ★ 逐张参考图的提示**攒起来**接在终局那句后面：一条条 npcSay 在投影窗开着时看不见，
      //   一条条 notice 又会互相顶掉（Toast 只有一条）—— 攒起来才是真的被看见（铁律八）。
      const refNotes: string[] = [];
      const refTail = () => (refNotes.length ? `（${refNotes.join("；")}）` : "");
      const mat = await prepareMaterialRefs(node.materials, "image", (n) => refNotes.push(n));
      const refUrls = mat.refs.length > 0 ? mat.refs : undefined;
      let first = p.firstFrame;
      // 首帧没有底图 → 素材卡的图就是 <图片1>，offset = 0
      if (!keepFirst) first = await generateCover(`${p.plot.slice(0, 200)}${mat.bind(0)}`, undefined, node.aspect, refUrls);
      // 以开头帧当参考图：同一段戏的两帧必须是同一套人物/画风，各画各的会串味。
      // 有底图时它占 <图片1>，素材卡从 <图片2> 起 → offset = 1
      const last = keepLast
        ? p.lastFrame
        : await generateCover(
            `${p.plot.slice(0, 180)} 的结束瞬间${mat.bind(first ? 1 : 0)}`,
            first || undefined,
            node.aspect,
            refUrls,
          );
      if (AI_REAL) spendTokens(cost); // 出图成功才扣，与 refineProposalFrame 同口径
      // 段还在才写回（同 refineProposalFrame 那道闸）；写路只有 flowStore 一条
      const still = useFlow.getState().nodes.find((n) => n.id === nodeId)?.proposals.some((q) => q.id === proposalId);
      if (!still) {
        set({ notice: { at: Date.now(), text: "重画好了，但那一段已经不在流水线上了——没处写回（钱已经花了，抱歉）。" } });
        return false;
      }
      useFlow.getState().updateProposal(nodeId, { firstFrame: first, lastFrame: last, degraded: undefined }, proposalId);
      set({ notice: { at: Date.now(), text: `按你的改动重画好了。不满意就再改剧情、或者直接换成你自己的图。${refTail()}` } });
      return true;
    } catch (e) {
      set({ notice: { at: Date.now(), text: `重画没成：${(e instanceof Error ? e.message : String(e)).slice(0, 90)}` } });
      get().setMood(-0.4, 2200);
      return false;
    } finally {
      set({ proposalRegen: null });
    }
  },

  regenNodeProposals: async (nodeId) => {
    // ★★ **委托 flowStore.deriveProposals（单一真相 + 单一实现）** —— 2026-09-03 收口，
    //   与 genNodeVideo 委托 genNode 是同一条纪律。收口之前这里自持了第二份推演实现，
    //   三处已经实际漂开、而且都零报错：
    //     ① 起拍帧：那边是 `node.chain && prev ? prev.lastFrame : null`，这里是
    //        `prev?.lastFrame ?? null` —— 用户在 ⚙ 里**明确关掉**的承接，在工坊被悄悄接回来；
    //     ② 报价：那边 `proposalsCost(!!(node.chain && prev.lastFrame))`，这里按 `!!startFrame`
    //        —— 同一段同一颗键，两面标价不同（承接时图量减半、价也减半）；
    //     ③ 「同时只跑一炉」的闸：这里只看工坊自己那三个旗标，**不问 flowStore.busy**
    //        —— 画布正在出片（几分钟、无 AbortController）时在工坊点重推照样放行：
    //        推演费先扣、整表换掉 proposals，几分钟后出片回包打在一个已经不存在的
    //        proposal id 上静默落空。两笔钱都花了，成片一个都拿不到。
    //   委托之后这三条连同 deriveIssue / realFaceIssue / 余额门槛 / spendTokens / genRun
    //   全部继承那一处；"保留哪些旧方案"那条更对的规则已经搬进 flowStore（见它的 ★★）。
    // ★ 失败一律走 `notice` 不走 `npcSay`：投影窗开着时 NpcDialog 整个 return null
    //   （NpcDialog.tsx 的那句 `if (projection) return null`），而这些话恰恰都发生在
    //   投影窗开着的时候 —— 用 npcSay 等于没说（与 genNodeVideo 同一条纪律）。
    const { nodeGen, proposalRegen } = get();
    if (nodeGenInFlight || nodeGen || proposalRegen) {
      set({ notice: { text: "上一炉还在跑，等它出炉再说。", at: Date.now() } });
      return false;
    }
    const flow0 = useFlow.getState();
    if (!flow0.nodes.some((n) => n.id === nodeId)) return false;
    nodeGenInFlight = true;
    // 进度画在**节点自己身上**（node.status/progress，deriveProposals 一路写），
    // 方案台直接读它；这里的 nodeGen 只是工坊侧"有一炉在跑"的旗标（键与旧实现一致）
    const key = rederiveKey(nodeId);
    set({ nodeGen: { proposalId: key, steps: [] } });
    try {
      const ok = await useFlow.getState().deriveProposals(nodeId);
      if (!ok) {
        set({ notice: { text: useFlow.getState().err || "这一次没推成", at: Date.now() } });
        return false;
      }
      get().npcSay("换了一批走向，投影在你面前了——点开挑一套。");
      return true;
    } finally {
      nodeGenInFlight = false;
      set({ nodeGen: null });
    }
  },

  setRequirement: (v) => set((s) => (s.editor ? { editor: { ...s.editor, requirement: v } } : {})),
  setDurationMode: (m) => set((s) => (s.editor ? { editor: { ...s.editor, durationMode: m } } : {})),
  setDurationSec: (v) => set((s) => (s.editor ? { editor: { ...s.editor, durationSec: v } } : {})),
  setVideoTier: (id) => set((s) => (s.editor ? { editor: { ...s.editor, videoTier: id } } : {})),
  setAspect: (a) => set((s) => (s.editor ? { editor: { ...s.editor, aspect: a } } : {})),
  setStartFrame: (dataUrl) => set((s) => (s.editor ? { editor: { ...s.editor, startFrame: dataUrl } } : {})),
  setEndFrame: (dataUrl) => set((s) => (s.editor ? { editor: { ...s.editor, endFrame: dataUrl } } : {})),
  setEditorRefVideo: (ref) =>
    set((s) => (s.editor ? { editor: { ...s.editor, refVideo: ref ? { ...ref, mids: s.editor.refVideo?.mids ?? [] } : null } } : {})),
  addEditorMid: (dataUrl) =>
    set((s) =>
      s.editor?.refVideo && s.editor.refVideo.mids.length < CUSTOM_MID_MAX
        ? { editor: { ...s.editor, refVideo: { ...s.editor.refVideo, mids: [...s.editor.refVideo.mids, dataUrl] } } }
        : {},
    ),
  removeEditorMid: (idx) =>
    set((s) =>
      s.editor?.refVideo
        ? { editor: { ...s.editor, refVideo: { ...s.editor.refVideo, mids: s.editor.refVideo.mids.filter((_, i) => i !== idx) } } }
        : {},
    ),
  closeEditor: () => set({ editor: null }),

  /**
   * 自定义直出（主人点名的第三车道·工坊面）：跳过推演，把编辑器里的
   * 帧（可缺，缺的由 AI 按提示词补画、照价）+ 要求铺成**一张已选定单方案**的节点卡。
   *
   * ★ 它**不出片也不扣钱**：出片仍是方案台那颗「炼这一段视频」（generateSegment 与
   *   segmentCost 一行没改）——这一步只是把"方案"从 AI 推演换成用户亲笔。
   * ★ 落地走 flowStore.appendNode（单一真相）：门禁（末段已出片/生成中拒/白模段后拒/
   *   pinUnstatedTpl）全在那一处，这里不再抄一遍挂载规则。
   */
  layCustomNode: () => {
    const { editor, deck } = get();
    if (!editor || editor.generating) return;
    if (!editor.requirement.trim()) {
      get().npcSay("自定义直出也得写一句这段要拍什么——缺的帧我按这句话补画，一个字都没有我就只能瞎画了。");
      return;
    }
    const materials = editor.slots.map((id) => deck.find((c) => c.id === id)).filter((c): c is Card => !!c);
    const path = activePath();
    const tail = path.length > 0 ? path[path.length - 1] : null;
    const prev = tail ? chosenProposal(tail) : null;
    const first = editor.startFrame ?? prev?.lastFrame ?? "";
    const p: Proposal = {
      id: uid("prop"),
      title: "自定义",
      plot: editor.requirement.trim(),
      firstFrame: first,
      lastFrame: editor.endFrame ?? "",
      durationSec: editor.durationMode === "manual" ? editor.durationSec : 5,
      // 用户给的帧（含承接来的接缝帧）上锁：重画不许动它们（Proposal.pinned 的既有语义）
      pinned: {
        ...(first ? { first: true } : {}),
        ...(editor.endFrame ? { last: true } : {}),
      },
    };
    const newId = useFlow.getState().appendNode({
      proposals: [p],
      chosenId: p.id, // 已选定：方案台直接给「炼这一段视频」，没有三选一那一步
      materials,
      videoTier: editor.videoTier,
      aspect: editor.aspect,
      requirement: editor.requirement,
      // 首帧承接（editor 没自传首帧、且真接了上一段尾帧才算）
      chain: !editor.startFrame && !!prev?.lastFrame && first === prev.lastFrame,
    });
    if (!newId) {
      get().npcSay(useFlow.getState().err || "现在铺不了这一段，稍后再试。");
      return;
    }
    // ★★ 车道开关**无条件打**（2026-08-30 修）：`FlowNode.custom` 记的是"这一段属于自定义
    //   车道"，与有没有挂示例视频无关。此前它被包在 `if (editor.refVideo)` 里 —— 没传示例
    //   视频的自定义段在 store 里与「自选卡片」段一模一样，于是画布的模式页签把它显示成
    //   自选卡片、方案台把它当成"还没推演三套"（实测：面板上给的是「生成三套方案」）。
    useFlow.getState().setNodeCustom(newId, true);
    // 示例视频落进节点：素材参考模式三件套（车道开关已在上面打过 + 参考视频 + 中间帧）。
    // 写路全在 flowStore（单一真相）；刚 append 的段必不 done/不在生成，几道 set 不会被拒
    if (editor.refVideo) {
      const flow = useFlow.getState();
      flow.setCustomRefVideo(newId, {
        url: editor.refVideo.url,
        publicId: editor.refVideo.publicId,
        durationSec: editor.refVideo.durationSec,
      });
      for (const m of editor.refVideo.mids) flow.addCustomMid(newId, m);
    }
    set({ spreadOpen: false, focus: { nodeId: newId }, projection: "proposals", editor: null });
    get().npcSay("自定义方案摆上桌了——帧和提示词确认没问题，就点「炼这一段视频」。");
  },

  /**
   * 套模板落节点（2026-08-30 主人点名"选模板别把人赶出工坊"）。
   * ★ 先 appendNode 一张已选定的空方案卡，再 setNodeTemplate 套快照 —— 与画布
   *   「＋ 加一段 → 🧪 套模板」两拍等价，门禁与快照规则全在 flowStore 那两处。
   * ★ 套不上就把刚落的空卡收回（铁律八的另一半：失败不能留一张自称模板段的裸卡在桌上）。
   */
  layTemplateNode: (t) => {
    const editor = get().editor;
    if (editor?.generating) return;
    const flow = useFlow.getState();
    const p: Proposal = {
      id: uid("prop"),
      title: t.title,
      plot: "",
      firstFrame: "",
      lastFrame: "",
      durationSec: t.refVideo?.durationSec ?? 5,
    };
    const newId = flow.appendNode({ proposals: [p], chosenId: p.id });
    if (!newId) {
      get().npcSay(useFlow.getState().err || "现在铺不了这一段，稍后再试。");
      return;
    }
    if (!useFlow.getState().setNodeTemplate(newId, t)) {
      useFlow.getState().removeNode(newId);
      get().npcSay(useFlow.getState().err || "这个模板套不上，换一个试试。");
      return;
    }
    set({ spreadOpen: false, focus: { nodeId: newId }, projection: "proposals", editor: null });
    get().npcSay(
      t.roles?.length
        ? "模板卡摆上桌了——先给人偶挂上你的角色卡，点名句合成好就能开炼。"
        : "模板卡摆上桌了——写一句换成谁来演，就能开炼。",
    );
  },

  generateNode: async () => {
    const { editor, deck } = get();
    if (!editor || editor.generating) return;
    if (nodeGenInFlight) {
      set({ notice: { text: "上一炉还在推演，等它出炉再开新的。", at: Date.now() } });
      return;
    }
    {
      // 新段没有 nodeId，只问全局那把闸（两面共用，见 otherFaceBusy 的 ★★）
      const blocked = otherFaceBusy();
      if (blocked) {
        set({ notice: { text: blocked, at: Date.now() } });
        return;
      }
    }
    const materials = editor.slots
      .map((id) => deck.find((c) => c.id === id))
      .filter((c): c is Card => !!c);
    if (materials.length === 0 && !editor.requirement.trim()) {
      get().npcSay("至少放一张素材卡，或写一句视频要求，我才好推演。");
      return;
    }
    // 按发计价档（真人档）没有方案台（判定在 economy.deriveIssue 一处）——工坊的
    // 铸段流程整个建立在推演上，走不通就当场说清出路，别让人到扣费那一步才撞墙
    {
      const flatIssue = deriveIssue(editor.videoTier);
      if (flatIssue) {
        get().npcSay(`${flatIssue}。真人档去「工作流」或「简约模式」直出。`);
        return;
      }
    }
    // ★★ 真人卡门禁（同上，与 flowStore.deriveProposals 逐字同源）。
    //   blockout 传 false 是**事实**不是省事：这条路建出来的是自定义段（下面 appendNode
    //   不传 tpl），白模段在工坊根本不摆方案台，走不到这儿。
    {
      const realBlocked = realFaceIssue(materials, editor.videoTier, { blockout: false });
      if (realBlocked) {
        get().npcSay(realBlocked);
        return;
      }
    }
    // 锚点快照：生成期间用户可能改选路径/换整条流水线，完成时必须校验挂载点仍一致。
    // ★★ 这三行**必须排在报价之前**（2026-08-31 复核抓到）：开头帧是"用户上传的 > 上一段
    //   已选方案的尾帧 > 无"，而计价当初只看了第一项 —— 于是从第 2 段起，报价按"没有开头帧"
    //   收 6 张图的钱，真发出去的 startFrame 却是 prev.lastFrame（真实尾帧是 toDataURL，
    //   `real.ts` 认 data: 就只排 3 个出图任务）。用户为 6 张付钱、只拿到 3 张，
    //   每段多扣 3×IMAGE_TOKENS，而且同一函数下面那行 `chain:` 自己就知道它承接了。
    //   零报错：面板上那句"承接上段尾帧、只画尾帧"的减半说明因为同一个错条件也不显示。
    const path = activePath();
    const tail0 = path.length > 0 ? path[path.length - 1] : null;
    const anchor = tail0 ? { id: tail0.id, chosenId: tail0.chosenId } : null;
    const prev = tail0 ? chosenProposal(tail0) : null;
    // 段间无缝衔接：开头帧 = 用户上传的本地图 > 上一节点已选方案的尾帧 > 无（AI 自拟）。
    // ★ 报价、真发、UI 三处共用 `nextStartFrame` 一份实现（铁律六，理由见那里的 ★★）
    const startFrame = nextStartFrame(editor.startFrame);
    // 三方案推演 = 1 次豆包 + 最多 6 张 Seedream。以前这一步一分钱不收，
    // 而它是工坊里用得最频繁的操作。有确定开头帧时三个方案共用它、只画尾帧，
    // 图量减半，报价也跟着减半
    const propCost = proposalsCost(!!startFrame);
    if (AI_REAL && !canAfford(propCost)) {
      const w = walletOf();
      get().npcSay(
        `推演一次约 ${fmtTokens(propCost)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不够——去「我的」页充值。`,
      );
      return;
    }
    nodeGenInFlight = true;
    // live 始终指向本次生成挂在 store 上的最新编辑器对象——进度更新会换对象，
    // 不能再拿发起时的引用做"表单还开着吗"的同一性判断
    let live: EditorState = { ...editor, generating: true, progress: "" };
    set({ editor: live });
    const patchLive = (patch: Partial<EditorState>) => {
      if (get().editor !== live) return false; // 表单已被用户关闭/换新，别去打扰
      live = { ...live, ...patch };
      set({ editor: live });
      return true;
    };
    try {
      if (AI_REAL) spendTokens(propCost); // 推演真跑起来才扣
      const proposals = await generateProposals(
        {
          index: path.length,
          materials,
          requirement: editor.requirement,
          durationMode: editor.durationMode,
          durationSec: editor.durationSec,
          prevFrameSeed: prev ? `${prev.id}#last` : null,
          // 与上面报价用的是**同一个变量**，别在这里重算（见 startFrame 的 ★）
          startFrame,
          aspect: editor.aspect,
          pathPlots: path.map((n) => chosenProposal(n)?.plot ?? "").filter(Boolean),
        },
        (status) => patchLive({ progress: status }),
      );
      // 只有发起时的编辑器仍然打开才由本次生成负责关闭（取消后重开的新表单不受影响）
      const editorPatch = get().editor === live ? { editor: null as EditorState | null } : {};
      // ★ 锚点校验（推演是分钟级异步）：挂载点还是当初那一段、走向没改、流水线没换，
      //   这一炉才有处落。对不上就作废并如实说——appendNode 自己的门禁（末段已出片/
      //   生成中拒）在此之上再拦一层，两层的拒绝都会开口（铁律八）。
      const path2 = activePath();
      const tail2 = path2.length > 0 ? path2[path2.length - 1] : null;
      const anchorOk = anchor
        ? !!tail2 && tail2.id === anchor.id && tail2.chosenId === anchor.chosenId
        : path2.length === 0;
      if (!anchorOk) {
        get().npcSay("推演期间桌面已经变样，这一炉先作废——按现在的走向重新生成吧。");
        get().setMood(-0.5, 2200);
        return;
      }
      // 素材快照存进节点：发布时聚合成"本片卡组"，观众可收入同款素材复刻；
      // 档位随节点走，合成该段时按它选 Seedance 模型与计费。落地走 appendNode（单一真相）
      const newId = useFlow.getState().appendNode({
        proposals,
        chosenId: null, // 三套摊开等挑（plan:"picking"）
        materials,
        videoTier: editor.videoTier,
        aspect: editor.aspect,
        requirement: editor.requirement,
        chain: !editor.startFrame && !!prev?.lastFrame, // 承接与否只看"帧是不是上一段给的"，与报价那个 startFrame 差一位（用户自己传图时不算承接）
      });
      if (!newId) {
        get().npcSay(useFlow.getState().err || "推演好了，但现在铺不上桌——稍后再试。");
        get().setMood(-0.5, 2200);
        return;
      }
      set({ spreadOpen: false, focus: { nodeId: newId }, projection: "proposals", ...editorPatch });
      const degraded = proposals.filter((p) => p.degraded).length;
      get().npcSay(
        degraded > 0
          ? `三种走向推演完毕，但有 ${degraded} 个方案的首尾帧没画出来（先用占位图顶着，合成前我会重画）。点开看看剧情，选定一个。`
          : "三种走向推演完毕，已经投影在你面前——点开看看各自的首尾帧和剧情，选定一个。",
      );
    } catch (e) {
      // 此前任何异常都会静默炸掉整个 Promise——按钮复位却没有任何解释，像"点了没反应"
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[studio] 推演失败:", e);
      get().npcSay(`这一炉推演失败了：${msg.slice(0, 120)}——歇口气再点一次「生成」。`);
      get().setMood(-0.6, 2600);
    } finally {
      nodeGenInFlight = false;
      // 若发起时的编辑器仍开着且未被上面清掉（作废/失败路径），复位以便重试
      patchLive({ generating: false, progress: "" });
    }
  },

  chooseProposal: (nodeId, proposalId) => {
    // 挑选走 flowStore（单一真相）：换走向连分支归档一起管（repickInner 的 ★★）。
    // 生成中会被那边整句拒（err）——把原因摆到桌面提示条上，别静默
    useFlow.getState().chooseProposal(nodeId, proposalId);
    const flowErr = useFlow.getState().err;
    if (flowErr) set({ notice: { text: flowErr, at: Date.now() } });
    // ★ 选定后**不再关投影**。挑方案不是这一段的终点：挑完还要在方案台上换首尾帧、改剧情，
    //   然后炼出本段视频——不炼出来就开不了下一张卡（见 placeholderVisible）。
    //   以前一选定就把窗关掉、卡片落回桌面，用户下一步该干什么全靠猜（而"该干的事"正好
    //   在那扇被关掉的窗里）。想收起来点 ✕ 就是了。
    set({ editor: null });
  },

  segEdit: null,

  openSegmentEdit: (nodeId, proposalId) => {
    const slot = activePath().find((n) => n.id === nodeId);
    const p = slot?.proposals.find((q) => q.id === proposalId);
    if (!slot || !p) return;
    set({
      segEdit: { nodeId, proposalId },
      projection: null,
      editor: null,
      // 同 finalizeFromFlow：有了新的合成稿，上一次发布就翻篇
      publishedWorkId: null,
      // 单段草稿：剪辑页只认 draft.segments，给它一段就是"只编辑这一段"
      draftAudioHint: null,
      draft: {
        title: "",
        category: "剧情",
        description: p.plot,
        cover: p.firstFrame,
        segments: [
          {
            title: p.title,
            plot: p.plot,
            firstFrame: p.firstFrame,
            lastFrame: p.lastFrame,
            durationSec: p.durationSec,
            videoTier: slot.videoTier ?? DEFAULT_TIER,
            aspect: slot.aspect,
            // 必须过 realVideoOf：mock 构建下 videoUrl 是 "mock:" 占位串，交给剪辑页的
            // <video> 只会得到一个报错的播放器（resolveMediaUrl 会把未知 scheme 原样透出）
            ...(realVideoOf(p) ? { videoUrl: realVideoOf(p) } : {}),
          },
        ],
        deck: { name: "", cards: slot.materials ?? [] },
      },
    });
  },

  closeSegmentEdit: (save) => {
    const { segEdit, draft } = get();
    if (!segEdit) return;
    if (save && draft?.segments.length) {
      const flow = useFlow.getState();
      const path = flow.nodes;
      const slot = path.find((n) => n.id === segEdit.nodeId);
      const p = slot?.proposals.find((q) => q.id === segEdit.proposalId);
      // ★★ 找不到落点就**说出来**（2026-08-31 补）：原来这里是静默跳过、
      //   下面照样 `draft: null` —— 用户按的是「保存本段」，屏幕上一个字都不给，
      //   而这一段的改动（包括剪辑页里花钱重生成的那一版）当场蒸发（铁律八）。
      //   走到这里只有一种可能：这一段挂着的节点已经不在流水线上了（被删、或整条被换掉）。
      if (!p) {
        get().npcSay("这一段改动写不回去了——它挂着的那个节点已经不在流水线上（被删掉，或者整条流水线被换过了）。");
        get().setMood(-0.6, 3200);
      }
      if (p) {
        // 剪辑页可能把这一段切成了几个片段：写回时只取首段起、末段止——
        // 流水线里一个方案就是一段，不承载"段内再分片"的结构。写路只有 flowStore 一条
        const segs = draft.segments;
        const head = segs[0];
        const tail = segs[segs.length - 1];
        flow.updateProposal(
          slot!.id,
          {
            firstFrame: head.firstFrame,
            lastFrame: tail.lastFrame,
            plot: head.plot,
            durationSec: segs.reduce((s, x) => s + x.durationSec, 0),
            degraded: undefined,
          },
          p.id,
        );
        // 成片两处一起写（videoByProposal + proposal.videoUrl，见 setProposalVideo）
        if (head.videoUrl) flow.setProposalVideo(slot!.id, p.id, head.videoUrl);
        // ★ 下一段的起拍帧跟着改过的尾帧走——这正是"改完这一段，下一段从改好的画面接着拍"。
        //   只在下一段还没出片时改：已经炼出来的段改了起拍帧只会让它和成片对不上
        const i = path.findIndex((n) => n.id === slot!.id);
        const next = path[i + 1];
        const nextProp = next ? chosenProposal(next) : null;
        if (next && nextProp && !proposalDone(nextProp)) {
          flow.updateProposal(next.id, { firstFrame: tail.lastFrame }, nextProp.id);
        }
      }
    }
    set({ segEdit: null, draft: null });
  },

  nodeGen: null,
  genNodeVideo: async (nodeId, proposalId) => {
    const { nodeGen } = get();
    if (nodeGen) return false; // 同一时刻只炼一段：并发跑几段既烧钱又抢方舟并发额度
    const flow = useFlow.getState();
    const slot = flow.nodes.find((n) => n.id === nodeId);
    if (!slot || !slot.proposals.some((p) => p.id === proposalId)) return false;
    // 先把这套挑定（幂等；生成中会被 repick 整句拒）——genNode 只炼选中那套
    flow.chooseProposal(nodeId, proposalId);
    const live = useFlow.getState().nodes.find((n) => n.id === nodeId);
    if (!live || live.chosenId !== proposalId || live.plan === "picking") {
      set({ notice: { text: useFlow.getState().err || "现在换不了这套走向，稍后再试", at: Date.now() } });
      return false;
    }
    // ★★ 出片走 flowStore.genNode（单一真相 + 单一实现）：报价=实扣（nodeCost）、
    //   busy/档位/真人卡/余额门禁、承接判定、圈选、genRun 令牌、进度步骤全在那一处 ——
    //   工坊此前自持的那份出片实现（同一条规则的第二份）随本次收口退役。
    //   进度画在节点自己身上（node.steps/progress），方案台直接读它。
    set({ nodeGen: { proposalId, steps: [] } });
    try {
      const ok = await useFlow.getState().genNode(nodeId);
      if (!ok) {
        set({ notice: { text: useFlow.getState().err || "这一段没炼成", at: Date.now() } });
        return false;
      }
      get().npcSay(
        "这一段炼好了——下一段的虚线卡位已经亮起来了。想改细节就点「编辑本段」圈画面，改完的尾帧就是下一段的起拍画面。",
      );
      return true;
    } finally {
      set({ nodeGen: null });
    }
  },

  goFlowAt: 0,
  requestFlow: () => {
    // 单一真相后"法阵"不再铺表（没有第二份数据要同步），它只是去另一面的门。
    // 空流水线不导航：/flow 对 0 段会弹回创作入口，看着像法阵坏了——如实指路
    if (useFlow.getState().nodes.length === 0) {
      get().npcSay("桌上还没有段——先点虚线卡位铸第一段，或去模板市场挑一个「用它出片」。");
      return;
    }
    set({ goFlowAt: Date.now() });
  },


  finalizeFromFlow: async (nodes, mode, onProgress, deckOff) => {
    if (nodes.length === 0) return false;
    // ★★ 同一时刻只准跑一发（见 finalizing 字段的 ★★）。原因写进 flowStore.err：
    //   两个面都画它，静默 return 的话上层只能瞎猜（铁律八）
    if (get().finalizing) {
      useFlow.setState({ err: "这一片正在组稿中（提炼卡组要花几十秒），等它跑完再点" });
      return false;
    }
    set({ finalizing: true });
    try {
      return await get().finalizeInner(nodes, mode, onProgress, deckOff);
    } finally {
      set({ finalizing: false });
    }
  },
  finalizeInner: async (nodes, mode, onProgress, deckOff) => {
    const say = (s: string) => onProgress?.(s);
    /**
     * ★★ 这次组稿要不要派生卡组 —— **本条规则的唯一实现**（铁律六），
     *   与 saveWorkDraft 里那条「简约模式不进草稿库」并列，理由是同一个：
     *   简约模式只有一段、写一句话就出片、直通发布，是一次性的东西。
     *   而这个函数**三种模式共用后半段**，于是简约模式那一个节点也会去派生最多 8 张卡
     *   （≈110k token，真扣钱），剧情里再撞上"渲染/3D"之类的词还会顺带铸建模
     *   （每个 160k）—— 用户写了一句话、等了几十秒出一条短片，账单上却多出一叠
     *   他从没要过、也没在任何界面上见过报价的卡。
     *   ⚠ 短路的是**整段**：派生、3D 建模、以及派生失败时那个"按段兜底出场景卡"，
     *     三件都在下面同一个 try 里，一件都不做。素材卡的并集也不做 ——
     *     那些卡本来就在用户自己的卡库里，简约模式没必要再随片打包一份。
     *   ★ 报价那侧读 deckQuoteOf(nodes, mode, deckOff)，判的是**同一个 mode + 同一个
     *     deckOff**（都来自 flowStore，FlowPage 一处读了显式传过来）：
     *     不报也不收，报了就一定收（报价必须等于实收）。
     * ★ deckOff（2026-08-28 主人点名的用户选择）：用户勾了「只出片不出卡组」就整段
     *   跳过——语义与简约模式的短路完全相同，走同一个布尔。
     */
    const withDeck = mode !== "simple" && !deckOff;
    // ★ 单一真相后**没有"回写节点树"这一步**（此前那段逐字段搬运器随树一起退役）：
    //   `nodes` 就是唯一那份数据。分支互动的真实成片按方案 id 收进 videoByProposal
    //   （含归档链上的——用户探索过又换走的分支也可能炼过片，观众走那条时要能播）
    const videoByProposal: Record<string, string> = {};
    const alts = useFlow.getState().alts;
    for (const chain of Object.values(alts).flatMap((byPid) => Object.values(byPid))) {
      for (const an of chain) {
        for (const [pid, v] of Object.entries(an.videoByProposal ?? {})) {
          if (v && !v.startsWith("mock:")) videoByProposal[pid] = v;
        }
      }
    }
    const segments: VideoSegment[] = nodes.map((n) => {
      const p = chosenOf(n);
      const video = nodeVideo(n);
      const real = video && !video.startsWith("mock:") ? video : undefined;
      if (real) videoByProposal[p.id] = real;
      return {
        title: p.title,
        plot: p.plot,
        firstFrame: p.firstFrame,
        lastFrame: p.lastFrame,
        durationSec: p.durationSec,
        videoTier: n.videoTier,
        aspect: n.aspect,
        ...(real ? { videoUrl: real } : {}),
      };
    });
    // 本片卡组：素材卡并集 + AI 从剧情提炼的派生卡（角色/场景/背景/画风，
    // 卡面跟随视频画风）。派生失败时兜底按段出场景卡——每部作品都必须有
    // 可分享的卡组，观众才能"用同款素材复刻"
    // （★ 简约模式整段跳过，见上面的 withDeck）
    const seenCard = new Set<string>();
    // ★ 显式标 Card[]：三元的空数组分支会被推成 never[]，那样下面的 push 就编不过
    const deckCards: Card[] = withDeck
      ? nodes.flatMap((n) => n.materials ?? []).filter((c) => (seenCard.has(c.id) ? false : (seenCard.add(c.id), true)))
      : [];
    if (withDeck) {
      try {
        const styleHint = deckCards.find((c) => c.type === "style")?.name ?? "";
        // 把已挂的素材卡报给 AI：2026-08-28 起按**卡种级**关门——挂过的卡种一张不出
        // （那些卡直接随片入组），缺的卡种才补，风格卡必补（规则在 deriveDeckCards 一处）
        // 派生卡组与 3D 建模以前**完全免费**，而 3D 建模是全 app 最贵的单次操作
        // （seed3d 约 2.4 元/次 ≈ 160k token）。这里在真实 AI 下按上限预扣门槛、
        // 按实际产出结算——余额不够就跳过派生，成片本身照出，不该被卡住
        // ★ 门槛用的 deckCardsCost() 与 FlowPage 顶栏报的那个数是同一个函数（铁律六）
        const canDerive = !AI_REAL || canAfford(deckCardsCost());
        if (!canDerive) say("余额不足，跳过卡组提炼（成片不受影响）");
        if (!canDerive) throw new Error("skip-derive");
        say("提炼本片卡组…");
        const derived = await deriveDeckCards(
          segments.map((sg) => ({ title: sg.title, plot: sg.plot, firstFrame: sg.firstFrame })),
          styleHint,
          deckCards.map((c) => ({ type: c.type, name: c.name, summary: c.summary })),
          say,
        );
        const names = new Set(deckCards.map((c) => c.name));
        const fresh = derived.filter((c) => !names.has(c.name));
        deckCards.push(...fresh);
        if (AI_REAL && fresh.length > 0) spendTokens(deckCardsSettle(fresh.length)); // 按实际出卡结算
        // 3D 画风的作品：给派生的角色卡自动铸 3D 建模（Seed3D，上限 DECK_MAX_3D 个）。
        // ★★ 触发判定走 economy.styleWants3d —— **报价（FlowPage 顶栏 / 「完成视频」
        //   旁那句话）读的是同一个函数、同一坨文字**（deckStyleBlob）。这条正则原来
        //   写死在这儿，于是界面上永远不可能说出"这条片会不会铸建模"；两边各写一份
        //   正则则更糟：多写少写一个词就是"说不铸、结果铸了"，用户只在账单上看得到。
        if (styleWants3d(deckStyleBlob(nodes))) {
          const want = Math.min(DECK_MAX_3D, fresh.filter((c) => c.type === "character").length);
          if (want > 0) {
            if (AI_REAL && !canAfford(deckModel3dCost(want))) {
              say(`3D 建模需 ${fmtTokens(deckModel3dCost(want))} token，余额不足，跳过`);
            } else {
              say(`这是 3D 画风，顺便铸 ${want} 个建模（${fmtTokens(deckModel3dCost(want))} token）…`);
              const before = fresh.filter((c) => c.modelUrl).length;
              await deriveCharacterModels(fresh, DECK_MAX_3D, say);
              const minted = fresh.filter((c) => c.modelUrl).length - before;
              if (AI_REAL && minted > 0) spendTokens(minted * MODEL3D_TOKENS);
            }
          }
        }
      } catch (e) {
        if (!(e instanceof Error && e.message === "skip-derive")) console.warn("[studio] 卡组提炼回退按段场景卡:", e);
        if (deckCards.length === 0) {
          deckCards.push(
            ...segments.map((sg, i) => ({
              id: uid("card"),
              type: "scene" as const,
              name: sg.title.replace(/^第\d+段 · /, "").slice(0, 8) || `场景${i + 1}`,
              summary: sg.plot.slice(0, 60),
              cover: sg.firstFrame,
            })),
          );
        }
      }
    }
    set({
      // ★ 新的合成稿一出现，上一次发布就翻篇（publishedWorkId 的清零规则只有这一条：
      //   "draft 被赋新值"。openSegmentEdit 是另一个赋新值的地方，同样清）
      publishedWorkId: null,
      // ★★ 单段编辑也一并翻篇（2026-08-31 补）。segEdit 原来**只**由剪辑页顶栏那两颗
      //   按钮清，而安卓物理返回键是 `webView.goBack()`（全 app 没有人监听 backButton），
      //   那两颗一次都不跑 —— 于是从单段编辑用返回键退出后 segEdit 一直留着，接下来：
      //   `persistCutDraft` 因它整条稿子一个字节都不落盘（还回一句与处境完全不搭的话），
      //   落到 /cut 时顶栏渲染的是「保存本段」而不是「下一步」= **根本没有发布入口**，
      //   而按下「保存本段」时流水线已被 cut() reset 成空 ⇒ 找不到落点 ⇒ 刚花钱铸出来的
      //   卡组/3D/分支树被一并清掉。零报错。
      //   ⇒ 规则收在"有新草稿就翻篇"这一处（与上面 publishedWorkId 同一条理由），
      //   不靠"用户会不会点那两颗按钮"。
      segEdit: null,
      // 分段模板组：原片地址给剪辑页当音轨预置（用户点名要的"成片保留原视频音频"）。
      // ★ 必须在这里搭草稿的车 —— 「完成视频」会把 flow store 清掉，剪辑页挂载时
      //   nodes 已经空了（2026-08-20 dev 实测：读 flow 那版预置永远落空）
      // ★ 走 tplOfNode，别直接摸 `.tpl`（2026-08-21 第三轮验证）：三态里 `undefined` 要退回
      //   store 级那份，而从模板详情页套用**分段组里的某一段**走的正是那条（applyTemplate
      //   铺单节点、tpl 不写）。漏读的后果是剪辑页静默丢掉原片音轨预置 —— 用户点名要的
      //   "成片保留原视频音频"没了，而全程零报错。
      draftAudioHint: nodes.map((n) => tplOfNode(n)?.group?.sourceUrl).find(Boolean) ?? null,
      draft: {
        title: "",
        category: "剧情",
        description: segments.map((sg) => sg.plot).join("\n"),
        cover: segments[0]?.firstFrame ?? "",
        segments,
        branchTree: buildBranchTree(nodes, alts, videoByProposal),
        // ★ 简约模式**连键都不写**（DraftVideo.deck 本来就是可选，全部读取方都用了
        //   `?.`）。写一个 `{ name: "", cards: [] }` 空壳的话，发布页那一路要多一处
        //   "长度为 0 也算没有"的判断，而个人页「卡组」页签靠 `v.deck && cards.length`
        //   过滤 —— 多一个空对象只会多一个每个人都要绕过去的坑。
        ...(withDeck ? { deck: { name: "", cards: deckCards } } : {}),
      },
    });
    return true;
  },
  clearDraft: () => {
    set({ draft: null });
    // ★★ 落盘那份也要清（2026-08-30 补）：剪辑稿持久化上线之后，只清内存会留下一条
    //   **用户刚刚明确丢掉**的稿子挂在个人页横幅上 —— 点进去是他已经放弃的那摊活。
    //   `clearDraft` 的唯一调用点就是发布页那颗「放弃本次合成」，语义正是"不要了"。
    //   ⚠ blob 不在这里删：交给 cacheSweep 24h 后收（那边才有"还有没有别人引用"的全局视野）。
    void dropCutSession();
  },

  publishedWorkId: null,
  persistCutDraft: async () => {
    const { draft, segEdit } = get();
    if (!draft) return null; // 没稿子就没什么要存的，不算失败
    // ★★ segEdit 那条路**不落这个键**：那份 draft 是 flowStore 的派生物，真相在 nodes 上，
    //   存它只会在恢复时得到一份没有活节点可写回的孤稿（closeSegmentEdit 按 nodeId 找节点，
    //   找不到就静默什么都不写）。
    //   ⚠ 但**不能因此谎报成功**（原来这里 return true）：这条路上同样会扣钱
    //   （剪辑页的「按圈选重新生成」），而钱扣完之后结果只在内存里 —— 调用方被告知
    //   "存住了"，于是一个字都不提醒。如实说清楚：这一档要靠**回到工作流保存**来兜住。
    if (segEdit) {
      return "这一段是从工作流里单独打开的，改动还只在内存里——回工作流把它保存进草稿，再切后台。";
    }
    const ok = await saveCutSession(draft);
    return ok ? null : "没能存进本地库（存储空间不足或浏览器隐私模式）";
  },

  finishPublish: (videoId) => {
    // ★ 记作品与清合成稿在**同一个 set** 里（理由见接口那段 ★）
    set({ publishedWorkId: videoId, draft: null });
    // 这摊活已经变成作品了，落盘的那份剪辑稿也该收工 —— 不清的话个人页会一直挂着
    // 一条"剪到一半"，点进去是已经发出去的那条，用户会再发一遍
    void dropCutSession();
    // 这摊活已经变成作品了：退休对应的在途草稿，别在个人页留一条重复的半成品。
    // 即发即忘 —— 删本地库慢一点/失败了都不该挡住跳转
    void get().retireWorkDraft();
  },

  workDraftId: null,
  savedDoneCount: 0,
  finalizing: false,
  // 另起一摊活 / 这摊活已发布：与草稿的关联断了，"存住了几段"也跟着归零
  newWorkDraft: () => {
    // 换一摊活：把「对画布说话」的多轮记忆也清掉（模块级变量，不跟着 store 走，
    // 不清的话上一条片的对话会跟进下一条片的提示词，见 canvasAgent.forgetCanvasAgent）
    forgetCanvasAgent();
    set({ workDraftId: null, savedDoneCount: 0 });
  },
  retireWorkDraft: async () => {
    const id = get().workDraftId;
    set({ workDraftId: null, savedDoneCount: 0 });
    if (id) await deleteDraft(id);
  },

  saveWorkDraft: async (opts) => {
    const { deck, workDraftId } = get();
    const f = useFlow.getState();
    // ★ 简约模式不进草稿库：它只有一段、写一句话就出片，一路直通剪辑与发布，中间没有
    //   "回来接着做"的状态。给它存草稿只会在个人页堆一串一次性半成品，而每条都带 1MB 级
    //   的帧，把真正需要草稿的工坊/工作流那 20 条上限挤掉（data/drafts.MAX_DRAFTS）。
    //   写在这里而不是只在 FlowPage 上藏掉按钮：存盘是"规则"，规则只该有一处实现（铁律六）。
    const nodes = f.mode === "simple" ? [] : f.nodes;
    if (nodes.length === 0) return null; // 空流水线 / 简约模式：没什么可存的
    const head = chosenOf(nodes[0]);
    const coverFrame = head?.firstFrame;
    // 标题默认取第一段的标题（去掉"第N段 · "前缀），比"未命名草稿"好认；
    // 已经存过的草稿不动标题——用户可能在个人页改过名，自动保存不该把它冲掉。
    // 新建节点的标题就是占位的"第 N 段"（见 flowStore.blankProposal），拿它当草稿名
    // 一屏全是"第 1 段"根本分不出谁是谁——这种情况改用剧情开头
    const doneCount = nodes.filter((n) => Object.keys(n.videoByProposal).length > 0).length;
    const rawTitle = (head?.title ?? "").replace(/^第\s*\d+\s*段\s*·\s*/, "").trim();
    const autoTitle = /^第\s*\d+\s*段$/.test(rawTitle) || !rawTitle ? (head?.plot ?? "").trim().slice(0, 16) : rawTitle;
    const meta = await saveDraft({
      id: workDraftId,
      title: opts?.title ?? (workDraftId ? undefined : autoTitle),
      lastMode: opts?.from ?? "flow",
      // ★ 单一真相后草稿不再存节点树（root 字段留在形状里给老草稿正文用，写 null）；
      //   分支归档（alts）随 flow 快照一起走
      root: null,
      deck,
      flow: {
        nodes,
        alts: f.alts,
        cursor: f.cursor,
        mode: f.mode,
        origin: f.origin,
        template: f.template,
        subject: f.subject,
        deckOff: f.deckOff,
      },
      coverFrame: coverFrame || undefined,
      segCount: nodes.length,
      doneCount,
    });
    // ★ 记账放在**写成功之后**（见 savedDoneCount 的 ★）：失败时保持上一次的已知真相不变
    if (meta) set({ workDraftId: meta.id, savedDoneCount: doneCount });
    return meta;
  },

  studioBusyReason: () => {
    const s = get();
    if (s.nodeGen) return "工坊里有一段正在炼视频（钱已经在花了）——换掉桌面不会把它停下，等它跑完再来";
    if (s.proposalRegen) return "工坊里正在重推方案，等它跑完再换桌面";
    if (s.frameRefining) return "工坊里正在改一张图，等它跑完再换桌面";
    return null;
  },
  openWorkDraft: (d) => {
    // ★★ 在途就别换（见 studioBusyReason 的 ★★）：桌面/流水线一旦被整表换掉，
    //   那一炉的回包会写进一棵已经不存在的树 —— 钱花了、东西没了、还零报错。
    const busyWhy = get().studioBusyReason();
    if (busyWhy) {
      get().npcSay(busyWhy);
      set({ notice: { text: busyWhy, at: Date.now() } });
      return false;
    }
    forgetCanvasAgent(); // 打开的是另一摊活，理由同 newWorkDraft
    // ★ 单一真相：草稿只还原**流水线**（nodes+alts），桌面与画布读的是同一份。
    //   带 `root` 的存量草稿（工坊树时代存的）经 flowFromRoot 一次性换算成流水线+归档。
    //
    // ★ 老草稿补字段（一处补齐，别靠读取处到处 ?? 兜底——老设备读到 undefined 会静默降级，
    //   见 AGENTS.md 数据层那一节）：
    //     · aspect ——「画幅可选」之前的草稿没有它，而 FlowNode.aspect 是必填；不补会一路
    //       传到方舟的 ratio 参数上。缺省按**横屏**（那时所有出片都写死 16:9，见 aspectOf）
    //     · plan ——「方案台」这一版才有。按"多方案即已选定"补：那时的节点确实是选好的，
    //       缺省成 picking 会让用户打开旧草稿发现每段都要重挑一遍
    //     · requirement —— 退回当前方案的剧情，正是旧版推演时当作 requirement 用的东西
    //     · tpl —— 钉成**这条草稿自己存下的**那份 store 级模板（`d.flow.template`）。
    //       ★★ 2026-08-21 补：三态里的 undefined 是"退回 store 级"，而 store 级会随光标
    //       换成当前段的快照 —— 老草稿里（尤其是 addNode 造出的段）留着的 undefined，
    //       重开之后会在用户点回某个白模段的那一刻被兜底认成那个模板：错显示、错报价、
    //       出片按 r2v 真扣钱。落库时的语义就是"读到 d.flow.template 那份"，
    //       所以在这里固化下来是等价的，只是从此不再漂（见 flowStore.pinUnstatedTpl）。
    const draftTpl = (d.flow?.template as FlowTemplate) ?? null;
    // 带 root 的老草稿：树 → 流水线 + 分支归档（换算器见 flowFromRoot）。
    // flow 侧有内容时以 flow 为准（树是当年组稿前的旧快照，flow 那份更新）
    const legacy = !((d.flow?.nodes?.length ?? 0) > 0) && d.root ? flowFromRoot(d.root) : null;
    const rawNodes = legacy ? legacy.nodes : ((d.flow?.nodes ?? []) as FlowNode[]);
    /** 在途状态归一（见下面那段 ★★）—— 主链与归档链都要过一遍，别只洗一半 */
    const normalize = (n: FlowNode): FlowNode => ({
        ...n,
        aspect: n.aspect ?? "landscape",
        plan: n.plan ?? (n.proposals.length > 1 ? ("picked" as const) : undefined),
        requirement: n.requirement ?? chosenOf(n).plot,
        tpl: n.tpl !== undefined ? n.tpl : draftTpl,
        // ★★ **status 必须归一**（2026-08-21 第八轮扫描）：节点的 status 会原样落进草稿
        //   （saveWorkDraft 把 f.nodes 整份交出去，drafts 那层不做净化），而顶栏那颗
        //   「存草稿」不判 busy —— 用户在几分钟的出片过程里点一下存草稿是完全正常的动作。
        //   于是草稿里就躺着一段 `status: "generating"`，重开后 busy 是 false 而它恒"在跑"：
        //   canReplaceNodes / removeNode / 丢弃键 / 主按钮 / agent 四处全拒，措辞是
        //   「等它跑完再来」，而它**永远不会跑完** —— 一条出口都不剩，且状态已落盘，
        //   重启 App 也一样。草稿里不可能有真在跑的一炉，读出来一律当没跑。
        //   ⚠ 「在途」不止 status 一格（第九轮扫描）：`regenning` 与 steps 里那条 running
        //   的步骤同样会落盘。regenning 漏了的话，重开后那一套方案的换首帧/换尾帧/清帧
        //   四颗键**永久禁着**（PlanBoard 的 canEdit 判的就是它），按钮恒印「重画中…」而
        //   什么都没在跑，唯一解锁方式是再真跑一次重画（再花一笔 redrawCost）。
        //   所以这里把"在途"那几格**一起**归一，别只做一格。
        status: n.status === "generating" ? "idle" : n.status,
        progress: n.status === "generating" ? "" : n.progress,
        regenning: n.status === "generating" ? undefined : n.regenning,
        steps: n.steps?.map((st) => (st.status === "running" ? { ...st, status: "error" as const } : st)),
      });
    const flowNodes = rawNodes.map(normalize);
    const rawAlts = legacy
      ? legacy.alts
      : ((d.flow as { alts?: Record<string, Record<string, FlowNode[]>> } | null)?.alts ?? {});
    const flowAlts = Object.fromEntries(
      Object.entries(rawAlts).map(([nid, byPid]) => [
        nid,
        Object.fromEntries(Object.entries(byPid).map(([pid, chain]) => [pid, chain.map(normalize)])),
      ]),
    );
    set({
      deck: d.deck ?? [],
      workDraftId: d.id,
      // ★ 刚从草稿读出来的这些段，按定义就是"已经存住的"——不置位的话，
      //   打开老草稿后那道确认卡会把它们全报成"没存上，丢了要重花钱"
      savedDoneCount: flowNodes.filter((n) => Object.keys(n.videoByProposal ?? {}).length > 0).length,
      // 视图层一律回到干净状态：草稿存的是内容，不是"上次停在哪个浮层"
      draft: null,
      // 同 finalizeInner：换了一整条流水线，上一次单段编辑的落点（nodeId）必然已经不在了
      segEdit: null,
      focus: null,
      projection: null,
      editor: null,
      spreadOpen: false,
      deckView: false,
      flights: [],
      camera: { kind: "default" },
    });
    if (flowNodes.length > 0) {
      const cur = Math.min(d.flow?.cursor ?? 0, flowNodes.length - 1);
      useFlow.setState({
        nodes: flowNodes,
        alts: flowAlts,
        cursor: cur,
        // ★ 挂卡缓冲也要换成**这条草稿光标段自己**那份（第八轮扫描）：不换的话它还停在
        //   上一条流水线的映射上，而「改挂卡」拿它当编辑页初值、applyCast 又整表落盘 ——
        //   那正是这条线上反复出现的"挂法串段"。与 setCursor 里那一行同一个理由。
        cast: flowNodes[cur]?.cast ?? {},
        mode: d.flow?.mode ?? "workflow",
        origin: d.flow?.origin ?? "studio",
        template: (d.flow?.template as FlowTemplate) ?? null,
        subject: d.flow?.subject ?? "",
        // ★ 判否定（drafts.FlowSnapshot.deckOff 的 ★）：老草稿缺省 = 随片出卡组
        deckOff: d.flow?.deckOff === true,
        busy: false,
        err: "",
      });
    } else {
      useFlow.getState().reset();
    }
    return true;
  },

  notice: null,

  exitDialog: () => {
    chatSeq++; // 在途回复回来时只记消息不出声（不清 messages：跨"退出再进"存活是对的）
    // 关掉对话就把话掐了——不然离开工坊后台还在念上一句（原在 NpcDialog.closeAll）
    stopSpeaking();
    set({ dialogView: false, camera: { kind: "default" }, orbit: null });
  },

  goBack: () => {
    switch (backStepOf(get())) {
      case "avatar":
        set({ avatarPickerOpen: false });
        return true;
      case "cardDetail":
        get().closeMarketDetail();
        return true;
      case "projectionBusy":
        // 消费掉但不关：这一炉真烧 token，退出等于把用户丢给一个看不见进度的后台任务。
        // 与投影窗里 ✕/取消 的 disabled={editor.generating} 是同一条规则
        set({ notice: { text: "这一炉还在推演，等它出炉再退出", at: Date.now() } });
        return true;
      case "canvas":
        set({ canvasOpen: false });
        return true;
      case "projection":
      case "deck":
        // ★ 一律走 closeProjection：离开卡组要同时做三件事——deckView=false（否则
        //   TableScene 的 deckAnim/deckCamArrived 悬着、换形象按钮不撤）、camera 换成
        //   **新的** {kind:"default"} 对象（CameraRig 用引用相等判断是否交还运镜控制权
        //   并 resetEyeRise，复用同一个常量对象会让它永远不触发）、orbit=null（否则
        //   TableCatcher 的 mode() 仍返回 "orbit"，第一人称下拖拽会绕一个已经不存在的
        //   圆心转）。这三件已经在 closeProjection 里配好了，别在这里重写。
        get().closeProjection();
        return true;
      case "market":
        get().closeMarket();
        return true;
      case "dialog":
        get().exitDialog();
        return true;
      case "focus":
        get().unfocus();
        return true;
      case "spread":
        set({ spreadOpen: false });
        return true;
      case "home":
        return false;
    }
  },
}));

/**
 * 创作流水线（/create → /flow → /cut → /publish）上**已经没有内容的那一格**该把人送去哪儿。
 * 返回 null = 不是"发布收工"留下的死页，各页按自己原来的兜底走（工坊/创作入口）。
 *
 * ★★ 这是那三个守卫的**唯一**判据（铁律六）。它们此前各判各的，于是同一件事
 *   （草稿被发布页清掉了）在 /cut 上被当成"你不该在这儿"送进工坊 —— 见
 *   `publishedWorkId` 那段 ★★ 记的事故。
 * ★ 为什么是首页而不是那条作品本身：这些死页就压在作品页**下面**一格，用 `/video/<id>`
 *   替换等于"按了返回还停在同一页"，看着就是返回键坏了；而首页按 createdAt 倒序排，
 *   刚发布的那条正好在最前面 —— 用户嘴里的"首页那条刚发布的视频"就是它。
 */
export function publishedExit(): string | null {
  return useStudio.getState().publishedWorkId ? "/" : null;
}

// DEV 调试/E2E 挂钩：让自动化脚本能拿到与组件同实例的 store
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__studio = useStudio;
}
