// 卡片工坊全局状态：卡组 / NPC 对话 / 市场 / 节点树 / 相机 / 合成 / 已发布作品回炉编辑
import { create } from "zustand";
import { BranchNodeData, BranchTree, Card, CardType, DEFAULT_ASPECT, DraftVideo, NodeSlot, Proposal, VideoAspect, VideoSegment, uid } from "../types";
import { AI_REAL, MaterialFile, deriveCharacterModels, deriveDeckCards, generateCards, generateCover, generateProposals, npcChat, npcChatOffline, refineFrame, searchMarket } from "../ai";
import { DECK_CAM, MARKET, NPC_CAM } from "./scene/layout";
import type { PlayerAvatar } from "./quality";
import { addCards as saveCardsToAccount, canAfford, myCards, myDecks, spendTokens, walletOf } from "../data/account";
import { CHAT_TURN_TOKENS, DEFAULT_TIER, MODEL3D_TOKENS, ONE_IMAGE, composeCost, deckCardsCost, fmtTokens, proposalRedrawCost, proposalsCost, segTokens } from "../data/economy";
// 单向依赖：工坊把活动路径喂给工作流。flowStore 不认识 studioStore（见其文件头）
import { FlowNode, FlowTemplate, chosenOf, flowDirty, nodeVideo, useFlow } from "./flowStore";
import { DraftMode, WorkDraft, WorkDraftMeta, deleteDraft, saveDraft } from "../data/drafts";
import { GenStep, createGenLog, splitStatus } from "./genLog";
import { generateSegment } from "./segmentGen";
import { SPEAK_MOOD, speak, stopSpeaking } from "./speech";
import { CRISIS_LINE, HELP_LINE, NPC_SYSTEM, chatFailLine, chatWindow, deskBlock } from "./npcPersona";
import { getVideo, loadProject, partsOf } from "../data/videos";

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
  generating: boolean;
  /** 生成期间的实时阶段播报（真实 AI 全程约 1-1.5 分钟，没进度=卡死体感） */
  progress: string;
}

/** 活动路径：从根沿 chosenId 一路向右（未选方案的子树自然被收起） */
export function activePath(root: NodeSlot | null): NodeSlot[] {
  const out: NodeSlot[] = [];
  let n: NodeSlot | null = root;
  while (n) {
    out.push(n);
    if (!n.chosenId) break;
    n = n.children[n.chosenId] ?? null;
  }
  return out;
}

export function chosenProposal(node: NodeSlot): Proposal | null {
  return node.proposals.find((p) => p.id === node.chosenId) ?? null;
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

/** 这张开头帧不是本方案自己画的（用户上传的，或承接上一段的真实结尾）→ 重画时不许动它 */
function keepFirstFrame(p: Proposal, prev: Proposal | null): boolean {
  return !!p.pinned?.first || !!(prev?.lastFrame && p.firstFrame === prev.lastFrame);
}

/** 「按修改重画这一套」的报价。★ regenProposal 扣钱走的是同一个函数（铁律六） */
export function proposalRedrawCostOf(p: Proposal, prev: Proposal | null): number {
  return proposalRedrawCost(keepFirstFrame(p, prev), !!p.pinned?.last);
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
export function placeholderVisible(root: NodeSlot | null): boolean {
  if (!root) return true;
  const path = activePath(root);
  return proposalDone(chosenProposal(path[path.length - 1]));
}

/** 法阵能不能点：活动路径上每一段都已出片（同上——逐段落地之后，整片其实已经炼完，
 *  法阵剩下的活是把它铺成工作流交给剪辑页） */
export function composable(root: NodeSlot | null): boolean {
  if (!root) return false;
  return activePath(root).every((n) => proposalDone(chosenProposal(n)));
}

/** 把工坊的 NodeSlot 树转成观众侧互动分支树：
 *  分支点 = 子层展开过的多个提案（chosen 或有子树的提案才算有效路线）；
 *  只有一条有效路线时观众无感自动续播；开头固定为根节点的选定提案。
 *  videoByProposal：合成出的真实视频按提案挂载（只有活动路径有，其余分支渐变回退） */
function buildBranchTree(root: NodeSlot | null, videoByProposal?: Record<string, string>): BranchTree | undefined {
  if (!root) return undefined;
  const validProposals = (slot: NodeSlot): Proposal[] => {
    const opened = slot.proposals.filter((p) => p.id === slot.chosenId || slot.children[p.id]);
    return opened.length ? opened : slot.proposals.filter((p) => p.id === slot.chosenId);
  };
  const rootChosen = chosenProposal(root);
  if (!rootChosen) return undefined;
  const nodes: BranchTree["nodes"] = {};
  let counter = 0;
  const build = (slot: NodeSlot, proposal: Proposal): string => {
    const id = `b${counter++}`;
    const child = slot.children[proposal.id];
    const choices: BranchNodeData["choices"] = [];
    if (child) {
      for (const p of validProposals(child)) {
        choices.push({ label: p.title.replace(/^第\d+段 · /, ""), nextId: build(child, p) });
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
  const rootOpened = validProposals(root);
  const startChoices =
    rootOpened.length > 1
      ? rootOpened.map((p) => ({
          label: p.title.replace(/^第\d+段 · /, ""),
          nextId: build(root, p),
        }))
      : undefined;
  const rootId = startChoices ? startChoices[0].nextId : build(root, rootChosen);
  // 只有一条直线且无任何分岔时没必要带树
  const hasFork = !!startChoices || Object.values(nodes).some((n) => n.choices.length > 1);
  return hasFork ? { rootId, nodes, startChoices } : undefined;
}

// ── 已发布作品 → 工坊节点树重建 ─────────────────────────────
// 首选 IndexedDB 里的源工程（发布时随手保存，含三方案与未选走向）；
// 没有源工程（老作品/换设备）时从成片反推：能还原结构，还原不了未选的方案。

function segToProposal(index: number, seg: VideoSegment): Proposal {
  return {
    id: uid("prop"),
    title: seg.title || `第${index + 1}段`,
    plot: seg.plot,
    firstFrame: seg.firstFrame,
    lastFrame: seg.lastFrame,
    durationSec: seg.durationSec,
    // ★ 成片地址必须带回来：这一段**已经花钱炼过了**（作品都发布了）。丢掉它的后果是
    //   回炉编辑时每段都显示"没出片"——法阵点不亮、下一段的卡位也不亮，而且再走一遍
    //   工作流会把整片重炼一次，用户为同样的画面付第二次钱。
    ...(seg.videoUrl ? { videoUrl: seg.videoUrl } : {}),
  };
}

/** 线性成片 → 单链节点树（每节点一个已选方案） */
function slotFromSegments(segments: VideoSegment[]): NodeSlot | null {
  let next: NodeSlot | null = null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const p = segToProposal(i, segments[i]);
    // 画幅从成片段读回：回炉重制时接着拍的段才不会横竖打架
    const node: NodeSlot = {
      id: uid("node"),
      proposals: [p],
      chosenId: p.id,
      children: {},
      videoTier: segments[i].videoTier,
      aspect: segments[i].aspect,
    };
    if (next) node.children[p.id] = next;
    next = node;
  }
  return next;
}

/** 互动分支树 → 节点树。BranchTree 是允许殊途同归的 DAG，而工坊模型是树——
 *  汇合节点会按路径展开成多份可独立编辑的拷贝（编辑后自然不再共享，符合直觉）。 */
function slotFromBranchTree(tree: BranchTree, depthIndex = 0): NodeSlot | null {
  const build = (ids: string[], depth: number, seen: Set<string>): NodeSlot | null => {
    const proposals: Proposal[] = [];
    const children: NodeSlot["children"] = {};
    for (const bid of ids) {
      const bn = tree.nodes[bid];
      if (!bn || seen.has(bid)) continue; // 环兜底（正常数据不该有）
      const p = segToProposal(depth, bn.segment);
      proposals.push(p);
      if (bn.choices.length > 0) {
        const child = build(bn.choices.map((c) => c.nextId), depth + 1, new Set(seen).add(bid));
        if (child) children[p.id] = child;
      }
    }
    if (proposals.length === 0) return null;
    // 同一层的各走向本来就是同一段的不同拍法，画幅取第一个能读到的即可
    const aspect = ids.map((bid) => tree.nodes[bid]?.segment.aspect).find(Boolean);
    return { id: uid("node"), proposals, chosenId: proposals[0].id, children, aspect };
  };
  return build(tree.startChoices?.map((c) => c.nextId) ?? [tree.rootId], depthIndex, new Set());
}

/**
 * 工作流的逐段流水线 → 工坊的节点树。
 * 打开一条"只在工作流/简约模式里做过"的草稿时要用：那种草稿没有节点树，
 * 直接进工坊会是一张空桌子，用户会以为草稿丢了。
 * 结构上就是把流水线串成一条链——每段的选定走向挂着下一段，与工坊自己长出来的
 * 树同形（未选走向留在 proposals 里，只是没有子树，本来也没人往下铺过）。
 */
function rootFromFlowNodes(nodes: FlowNode[]): NodeSlot | null {
  if (nodes.length === 0) return null;
  const slots: NodeSlot[] = nodes.map((n) => ({
    id: uid("node"),
    proposals: n.proposals,
    chosenId: n.chosenId,
    children: {},
    materials: n.materials,
    videoTier: n.videoTier,
    aspect: n.aspect,
  }));
  for (let i = 0; i < slots.length - 1; i++) {
    const cid = slots[i].chosenId;
    if (cid) slots[i].children[cid] = slots[i + 1];
  }
  return slots[0];
}

/** 回炉编辑的目标：composeNow 出的草稿将保存进该作品的该 P，而不是新建作品 */
export interface EditTarget {
  videoId: string;
  partIndex: number;
  videoTitle: string;
  partName: string;
}

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
  root: NodeSlot | null;
  /** 聚焦的桌面卡：nodeId=null 表示聚焦虚线占位卡；null=未聚焦（默认俯视机位） */
  focus: { nodeId: string | null } | null;
  /** 投影窗内容：editor=四区编辑表单；proposals=三方案选择；decks=卡组选择；
   *  卡片悬浮当且仅当投影打开 */
  projection: "editor" | "proposals" | "decks" | null;
  /** 卡组选择视角：镜头拍玩家上半身（思考姿势），投影里选一套卡组 */
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
  /** 只炼不收：生成的卡进预览槽，落账/入组要等 acceptForge。
   *  失败抛出——素材窗要把原因显示在窗里，吞掉就成了"点了没反应"。 */
  forgeCards: (files: MaterialFile[], note: string, type: CardType | null) => Promise<Card[]>;
  /** 收下这批卡：归入账号资产 + 入组 + 从铸卡师手边飞过来 */
  acceptForge: (cards: Card[]) => void;

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
  setRequirement: (v: string) => void;
  setDurationMode: (m: "ai" | "manual") => void;
  setDurationSec: (v: number) => void;
  closeEditor: () => void;
  generateNode: () => Promise<void>;

  chooseProposal: (nodeId: string, proposalId: string) => void;

  /** 点金色圆台：把活动路径铺成工作流（不立即出片），由 /flow 逐段生成逐段确认。
   *  返回 false = 没开工（路径没选完，或在途工作流需要用户先确认，见 flowConfirm）。
   *  force=true 由确认弹层调用，跳过脏检查。 */
  startFlow: (opts?: { force?: boolean }) => boolean;
  /** 非 null = 桌面上有在途工作流，法阵被按下但还没决定是「回去接着炼」还是「重铺」。
   *  StudioPage 据此弹确认层——重铺会抹掉已出片的段（真金白银）、圈选标注与手敲的剧情。 */
  flowConfirm: boolean;
  setFlowConfirm: (v: boolean) => void;

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
  /** 工作流全部跑完 → 组稿：真帧回写节点树 + 提炼本片卡组 + 生成草稿（进剪辑页） */
  finalizeFromFlow: (nodes: FlowNode[], onProgress?: (status: string) => void) => Promise<boolean>;
  clearDraft: () => void;

  // ── 在途工程草稿（data/drafts.ts）─────────────────────────
  // ⚠ 与上面的 `draft` 不是一回事：`draft` 是组稿产物（待发布的成片稿），
  //   这里的「工程草稿」是**还没做完**的半成品，工坊侧的节点树与工作流侧的流水线一起存。
  /** 当前正编辑的工程草稿 id；null = 这摊活还没存过 */
  workDraftId: string | null;
  /** 存盘。两个 store 的状态一起收进一条草稿。返回 null = 写失败（配额/隐私模式）。
   *  from = 从哪个模式点的保存，决定个人页上这条草稿默认推荐哪个入口 */
  saveWorkDraft: (opts?: { title?: string; from?: DraftMode }) => Promise<WorkDraftMeta | null>;
  /** 打开草稿：还原两侧状态。mode 决定进哪个模式；缺哪侧就地补出来 */
  openWorkDraft: (d: WorkDraft, mode: DraftMode) => void;
  /** 开始一摊全新的活：断开与上一条草稿的关联，之后保存会新建而不是覆盖 */
  newWorkDraft: () => void;
  /** 这摊活已经发布成作品了：删掉对应草稿并断开关联 */
  retireWorkDraft: () => Promise<void>;

  /** 非 null = 回炉编辑模式（工坊顶部亮横幅，发布页变"保存修改"） */
  editTarget: EditTarget | null;
  /** 重制已发布作品的某一 P：载入源工程（无则从成片重建）并进入编辑模式 */
  startEditPart: (videoId: string, partIndex: number) => Promise<boolean>;
  /** 为已发布作品新增一 P：空桌面开工，合成后追加到该作品 */
  startNewPart: (videoId: string) => boolean;
  /** 退出编辑模式（不动作品本身；桌面清空回到全新创作） */
  exitEdit: () => void;

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

const DEFAULT_EDITOR: EditorState = {
  slots: [],
  requirement: "",
  durationMode: "ai",
  durationSec: 6,
  videoTier: DEFAULT_TIER,
  aspect: DEFAULT_ASPECT,
  startFrame: null,
  generating: false,
  progress: "",
};

/** 新开一次铸段面板。画幅继承路径上最后一段：一部片里横竖混着来，剪辑页合并时
 *  只能挑一个画布，另一种画幅的段必然被裁或补边——默认延续是唯一不出事的选择。 */
function freshEditor(root: NodeSlot | null, slots: string[]): EditorState {
  const path = activePath(root);
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
 *   · editTarget（回炉编辑横幅）不进栈：那是**任务上下文**不是**视觉层**，横幅上
 *     自带「退出」。用户按返回是想离开工坊，不是想放弃编辑目标。
 */
export type BackStep =
  | "avatar"
  | "cardDetail"
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
  if (step === "projectionBusy") return "推演中";
  if (step === "projection")
    return s.projection === "decks" ? "退出卡组" : s.projection === "editor" ? "取消铸段" : "收起方案";
  const map: Record<Exclude<BackStep, "projection" | "projectionBusy">, string> = {
    avatar: "返回",
    cardDetail: "返回",
    market: "收起市场",
    dialog: "退出对话",
    deck: "退出卡组",
    focus: "拉远视角",
    spread: "收起卡组",
    home: "首页",
  };
  return map[step as Exclude<BackStep, "projection" | "projectionBusy">] ?? "返回";
}

export const useStudio = create<StudioState>()((set, get) => ({
  deck: [],
  spreadOpen: false,
  deckView: false,
  orbit: null,
  spreadCenter: 0,
  market: { open: false, items: [], query: "", loading: false, page: 0 },
  marketDetail: null,
  dialog: { messages: [], busy: false, thinking: false },
  speakTone: "act",
  pendingFiles: [],
  root: null,
  focus: null,
  projection: null,
  editor: null,
  dragCardId: null,
  dialogView: false,
  flights: [],
  draft: null,
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
    get().npcSay("（抽出一叠卡摊在桌上）社区里最近热的。要找特定的，上面那条写词。", "act");
    const items = await searchMarket("");
    if (seq !== marketSeq) return; // 期间发起过新检索，丢弃本次结果
    set((s) => ({ market: { ...s.market, items, loading: false } }));
  },
  marketSearch: async (q) => {
    const seq = ++marketSeq;
    set((s) => ({ market: { ...s.market, loading: true, query: q, page: 0 } })); // 换了词就回第一页
    const items = await searchMarket(q);
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
    saveCardsToAccount([card]); // 市场收藏同样归入账号资产
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

  forgeCards: async (files, note, type) => {
    get().meSay(note || `（递上 ${files.length} 份素材）`);
    set((s) => ({ dialog: { ...s.dialog, busy: true } }));
    get().npcSay("收到，让我看看成色……（炉火升起）");
    try {
      const cards = await generateCards(files, note, type);
      if (cards.length === 0) {
        get().npcSay("这些素材还差点意思，再补充点描述？");
        get().setMood(-0.6, 2600);
      } else {
        get().npcSay(`铛——${cards.length} 张卡的形已经出来了，你先过目。`);
      }
      return cards;
    } catch (e) {
      // 真实 AI 会因为余额/审核/网络失败。以前这里直接 throw 到无人接手的
      // Promise 上，界面只剩一个转不停的"炼卡中…"；现在由铸卡师说出来
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 80);
      get().npcSay(`炉子炸了……${msg}`);
      get().setMood(-0.8, 3000);
      throw e;
    } finally {
      set((s) => ({ dialog: { ...s.dialog, busy: false } }));
    }
  },

  acceptForge: (cards) => {
    if (cards.length === 0) return;
    saveCardsToAccount(cards); // 收下才归入账号资产（创意工坊/Profile 可见）
    // 立即入组；从 NPC 手边错峰起飞的只是视觉动画
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
      editing: !!s0.editTarget,
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
    const { deck, projection, root } = get();
    if (projection) return;
    if (deck.length === 0) {
      get().npcSay("你的卡组还是空的。先把素材交给我炼卡，或者说「逛市场」看看现成的。");
    }
    // 聚焦期间收起展开排（素材在投影窗内选择），画面只留浮卡
    set({
      focus: { nodeId: null },
      projection: "editor",
      editor: freshEditor(root, []),
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
      editor: freshEditor(get().root, [card.id]),
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
    const { root, frameRefining } = get();
    if (frameRefining || !req.trim()) return false;
    const node = activePath(root).find((n) => n.id === nodeId);
    const prop = node?.proposals.find((p) => p.id === proposalId);
    if (!node || !prop) return false;
    // 改一次图 = 一张 Seedream。以前这里既不看余额也不扣费，用户改十版是白送十张
    if (AI_REAL && !canAfford(ONE_IMAGE)) {
      get().npcSay(`改图要 ${fmtTokens(ONE_IMAGE)} token，余额不够了——去「我的」页充值。`);
      return false;
    }
    set({ frameRefining: `${proposalId}:${which}` });
    try {
      // 画幅跟节点走：改一次图就把竖屏方案的帧重画成横版，出片时又要被裁一刀
      const next = await refineFrame(req.trim(), which === "first" ? prop.firstFrame : prop.lastFrame, node.aspect);
      if (AI_REAL) spendTokens(ONE_IMAGE); // 出图成功才扣
      if (which === "first") prop.firstFrame = next;
      else prop.lastFrame = next;
      set({ root: root ? { ...root } : root });
      get().npcSay(`${which === "first" ? "首" : "尾"}帧已按你的要求重画好了。`);
      return true;
    } catch (e) {
      get().npcSay(`改图没成：${(e instanceof Error ? e.message : String(e)).slice(0, 90)}`);
      get().setMood(-0.4, 2200);
      return false;
    } finally {
      set({ frameRefining: null });
    }
  },
  patchProposal: (nodeId, proposalId, patch) => {
    const { root } = get();
    const node = activePath(root).find((n) => n.id === nodeId);
    const p = node?.proposals.find((q) => q.id === proposalId);
    if (!p) return;
    Object.assign(p, patch);
    set({ root: root ? { ...root } : root });
  },

  setProposalFrame: (nodeId, proposalId, which, dataUrl) => {
    const { root } = get();
    const node = activePath(root).find((n) => n.id === nodeId);
    const p = node?.proposals.find((q) => q.id === proposalId);
    if (!p) return;
    if (which === "first") p.firstFrame = dataUrl;
    else p.lastFrame = dataUrl;
    // 上锁：AI「按修改重画」时不动用户自己上传的帧（见 Proposal.pinned）
    p.pinned = { ...p.pinned, [which]: dataUrl ? true : undefined };
    delete p.degraded; // 换过的帧不再是"Seedream 没出图的占位帧"
    set({ root: root ? { ...root } : root });
  },

  proposalRegen: null,
  regenProposal: async (nodeId, proposalId) => {
    const { root, proposalRegen, frameRefining, nodeGen } = get();
    if (proposalRegen || frameRefining || nodeGen) return false;
    const path = activePath(root);
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
    const keepFirst = keepFirstFrame(p, prev);
    const keepLast = !!p.pinned?.last;
    const cost = proposalRedrawCostOf(p, prev);
    if (cost === 0) {
      get().npcSay("首尾帧都是你自己换的图，没有可让我重画的地方——想重画就先在卡里清掉那一帧。");
      return false;
    }
    if (AI_REAL && !canAfford(cost)) {
      get().npcSay(`重画这一套要 ${fmtTokens(cost)} token，余额不够了——去「我的」页充值。`);
      return false;
    }
    set({ proposalRegen: proposalId });
    try {
      // ★ 必须把本段画幅递下去：Seedream 的画布比例得与视频画幅一致，缺了它重画出来的帧
      //   是横的，喂给竖屏 Seedance 任务会被静默裁一刀（人物常被裁掉半个头）。
      //   见 CLAUDE.md「改了画幅却发现出片还是横的」那一条
      let first = p.firstFrame;
      if (!keepFirst) first = await generateCover(p.plot.slice(0, 200), undefined, node.aspect);
      // 以开头帧当参考图：同一段戏的两帧必须是同一套人物/画风，各画各的会串味
      const last = keepLast
        ? p.lastFrame
        : await generateCover(`${p.plot.slice(0, 180)} 的结束瞬间`, first || undefined, node.aspect);
      if (AI_REAL) spendTokens(cost); // 出图成功才扣，与 refineProposalFrame 同口径
      p.firstFrame = first;
      p.lastFrame = last;
      delete p.degraded;
      const cur = get().root;
      set({ root: cur ? { ...cur } : cur });
      get().npcSay("按你的改动重画好了。不满意就再改剧情、或者直接换成你自己的图。");
      return true;
    } catch (e) {
      get().npcSay(`重画没成：${(e instanceof Error ? e.message : String(e)).slice(0, 90)}`);
      get().setMood(-0.4, 2200);
      return false;
    } finally {
      set({ proposalRegen: null });
    }
  },

  regenNodeProposals: async (nodeId) => {
    const { root, nodeGen, proposalRegen } = get();
    if (nodeGenInFlight || nodeGen || proposalRegen) {
      get().npcSay("上一炉还在跑，等它出炉再说。");
      return false;
    }
    const path = activePath(root);
    const idx = path.findIndex((n) => n.id === nodeId);
    const node = path[idx];
    if (!node) return false;
    const prev = idx > 0 ? chosenProposal(path[idx - 1]) : null;
    // 起拍帧沿用原来那一套的（承接上一段的真实结尾）——重推的是"走向"，不是"从哪起拍"
    const startFrame = prev?.lastFrame ?? null;
    const propCost = proposalsCost(!!startFrame);
    if (AI_REAL && !canAfford(propCost)) {
      const w = walletOf();
      get().npcSay(
        `重推一次约 ${fmtTokens(propCost)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不够——去「我的」页充值。`,
      );
      return false;
    }
    nodeGenInFlight = true;
    const key = rederiveKey(nodeId);
    set({ nodeGen: { proposalId: key, steps: [] } });
    const log = createGenLog((steps) => set({ nodeGen: { proposalId: key, steps } }));
    log.begin("重新推演三套走向");
    try {
      if (AI_REAL) spendTokens(propCost);
      const fresh = await generateProposals(
        {
          index: idx,
          materials: node.materials ?? [],
          requirement: node.requirement ?? chosenProposal(node)?.plot ?? "",
          durationMode: "manual",
          durationSec: chosenProposal(node)?.durationSec ?? 6,
          prevFrameSeed: prev ? `${prev.id}#last` : null,
          startFrame,
          // 重推的是"走向"，画幅照原节点——换一批剧情不该顺手把片子从竖的变成横的
          aspect: node.aspect,
          pathPlots: path
            .slice(0, idx)
            .map((n) => chosenProposal(n)?.plot ?? "")
            .filter(Boolean),
        },
        (status) => log.detail(status),
      );
      log.end();
      // ★ 只留"丢了就补不回来"的旧方案：已出片的（真金白银）和已经往下铺过节点的
      //   （children 挂在方案 id 上，方案没了那棵子树就成了孤儿）
      const cur = get().root;
      const live = activePath(cur).find((n) => n.id === nodeId) ?? node;
      const keep = live.proposals.filter((q) => proposalDone(q) || live.children[q.id]);
      const keepIds = new Set(keep.map((q) => q.id));
      for (const id of Object.keys(live.children)) if (!keepIds.has(id)) delete live.children[id];
      live.proposals = [...fresh, ...keep];
      // 重推完是"摊开等挑"：chosenId 归零，虚线卡位随之收起（末段没选定就开不了下一段）
      live.chosenId = null;
      set({ root: cur ? { ...cur } : cur, nodeGen: null });
      get().npcSay("换了一批走向，投影在你面前了——点开挑一套。");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.fail(`失败：${msg.slice(0, 80)}`);
      set({ nodeGen: null, notice: { text: `重推没成：${msg.slice(0, 60)}`, at: Date.now() } });
      return false;
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
  closeEditor: () => set({ editor: null }),

  generateNode: async () => {
    const { editor, deck, root } = get();
    if (!editor || editor.generating) return;
    if (nodeGenInFlight) {
      get().npcSay("上一炉还在推演，等它出炉再开新的。");
      return;
    }
    const materials = editor.slots
      .map((id) => deck.find((c) => c.id === id))
      .filter((c): c is Card => !!c);
    if (materials.length === 0 && !editor.requirement.trim()) {
      get().npcSay("至少放一张素材卡，或写一句视频要求，我才好推演。");
      return;
    }
    // 三方案推演 = 1 次豆包 + 最多 6 张 Seedream。以前这一步一分钱不收，
    // 而它是工坊里用得最频繁的操作。有确定开头帧时三个方案共用它、只画尾帧，
    // 图量减半，报价也跟着减半
    const propCost = proposalsCost(!!editor.startFrame);
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
    // 锚点快照：生成期间用户可能改选路径，完成时必须校验挂载点仍一致
    const path = activePath(root);
    const tail0 = path.length > 0 ? path[path.length - 1] : null;
    const anchor = tail0 ? { id: tail0.id, chosenId: tail0.chosenId } : null;
    const prev = tail0 ? chosenProposal(tail0) : null;
    try {
      if (AI_REAL) spendTokens(propCost); // 推演真跑起来才扣
      const proposals = await generateProposals(
        {
          index: root ? path.length : 0,
          materials,
          requirement: editor.requirement,
          durationMode: editor.durationMode,
          durationSec: editor.durationSec,
          prevFrameSeed: prev ? `${prev.id}#last` : null,
          // 段间无缝衔接：开头帧 = 用户上传的本地图 > 上一节点已选方案的尾帧 > 无（AI 自拟）
          startFrame: editor.startFrame ?? prev?.lastFrame ?? null,
          aspect: editor.aspect,
          pathPlots: path.map((n) => chosenProposal(n)?.plot ?? "").filter(Boolean),
        },
        (status) => patchLive({ progress: status }),
      );
      // 素材快照存进节点：发布时聚合成"本片卡组"，观众可收入同款素材复刻；
      // 档位随节点走，合成该段时按它选 Seedance 模型与计费
      const node: NodeSlot = {
        id: uid("node"),
        proposals,
        chosenId: null,
        children: {},
        materials,
        videoTier: editor.videoTier,
        aspect: editor.aspect,
        requirement: editor.requirement,
      };
      // 只有发起时的编辑器仍然打开才由本次生成负责关闭（取消后重开的新表单不受影响）
      const editorPatch = get().editor === live ? { editor: null as EditorState | null } : {};
      const curRoot = get().root;
      if (!anchor) {
        if (curRoot) {
          // 作废：保留表单（finally 会把 generating 复位），用户可直接重试
          get().npcSay("推演期间桌面已经变样，这一炉先作废——按现在的走向重新生成吧。");
          get().setMood(-0.5, 2200);
          return;
        }
        set({ root: node, spreadOpen: false, focus: { nodeId: node.id }, projection: "proposals", ...editorPatch });
      } else {
        const path2 = activePath(curRoot);
        const tail2 = path2[path2.length - 1];
        if (!tail2 || tail2.id !== anchor.id || tail2.chosenId !== anchor.chosenId || !tail2.chosenId) {
          get().npcSay("推演期间你改选了路径，这一炉与新走向对不上，先作废——重新生成即可。");
          return;
        }
        tail2.children[tail2.chosenId] = node;
        set({
          root: curRoot ? { ...curRoot } : curRoot,
          spreadOpen: false,
          focus: { nodeId: node.id },
          projection: "proposals",
          ...editorPatch,
        });
      }
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
    const { root } = get();
    const node = activePath(root).find((n) => n.id === nodeId);
    if (!node) return;
    node.chosenId = proposalId;
    // ★ 选定后**不再关投影**。挑方案不是这一段的终点：挑完还要在方案台上换首尾帧、改剧情，
    //   然后炼出本段视频——不炼出来就开不了下一张卡（见 placeholderVisible）。
    //   以前一选定就把窗关掉、卡片落回桌面，用户下一步该干什么全靠猜（而"该干的事"正好
    //   在那扇被关掉的窗里）。想收起来点 ✕ 就是了。
    set({ root: root ? { ...root } : root, editor: null });
  },

  flowConfirm: false,
  setFlowConfirm: (v) => set({ flowConfirm: v }),

  segEdit: null,

  openSegmentEdit: (nodeId, proposalId) => {
    const { root } = get();
    const slot = activePath(root).find((n) => n.id === nodeId) ?? (root?.id === nodeId ? root : null);
    const p = slot?.proposals.find((q) => q.id === proposalId);
    if (!slot || !p) return;
    set({
      segEdit: { nodeId, proposalId },
      projection: null,
      editor: null,
      // 单段草稿：剪辑页只认 draft.segments，给它一段就是"只编辑这一段"
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
    const { segEdit, draft, root } = get();
    if (!segEdit) return;
    if (save && draft?.segments.length) {
      const path = activePath(root);
      const slot = path.find((n) => n.id === segEdit.nodeId) ?? (root?.id === segEdit.nodeId ? root : null);
      const p = slot?.proposals.find((q) => q.id === segEdit.proposalId);
      if (p) {
        // 剪辑页可能把这一段切成了几个片段：写回时只取首段起、末段止——
        // 节点树里一个方案就是一段，不承载"段内再分片"的结构
        const segs = draft.segments;
        const head = segs[0];
        const tail = segs[segs.length - 1];
        p.firstFrame = head.firstFrame;
        p.lastFrame = tail.lastFrame;
        p.plot = head.plot;
        p.durationSec = segs.reduce((s, x) => s + x.durationSec, 0);
        if (head.videoUrl) p.videoUrl = head.videoUrl;
        delete p.degraded;
        // ★ 下一段的起拍帧跟着改过的尾帧走——这正是"改完这一段，下一段从改好的画面接着拍"。
        //   只在下一段还没出片时改：已经炼出来的段改了起拍帧只会让它和成片对不上
        const i = path.findIndex((n) => n.id === slot!.id);
        const next = path[i + 1];
        const nextProp = next ? chosenProposal(next) : null;
        if (nextProp && !nextProp.videoUrl) nextProp.firstFrame = p.lastFrame;
      }
    }
    set({ segEdit: null, draft: null, root: root ? { ...root } : root });
  },

  nodeGen: null,
  genNodeVideo: async (nodeId, proposalId) => {
    const { root, nodeGen } = get();
    if (nodeGen) return false; // 同一时刻只炼一段：并发跑几段既烧钱又抢方舟并发额度
    const path = activePath(root);
    const slot = path.find((n) => n.id === nodeId) ?? (root?.id === nodeId ? root : null);
    const prop = slot?.proposals.find((p) => p.id === proposalId);
    if (!slot || !prop) return false;
    if (!prop.plot.trim()) {
      set({ notice: { text: "这个方案还没有剧情，先选定或改一下再炼", at: Date.now() } });
      return false;
    }
    const cost = segTokens(prop.durationSec, slot.videoTier ?? DEFAULT_TIER);
    if (AI_REAL && !canAfford(cost)) {
      const w = walletOf();
      set({
        notice: {
          text: `本段约需 ${fmtTokens(cost)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不足`,
          at: Date.now(),
        },
      });
      return false;
    }
    const log = createGenLog((steps) => set({ nodeGen: { proposalId, steps } }));
    const prog = (t: string) => {
      const { title, detail, terminal } = splitStatus(t);
      if (terminal) return log.end();
      const cur = log.steps[log.steps.length - 1];
      if (!cur || cur.status !== "running" || cur.title !== title) log.begin(title);
      if (detail) log.detail(detail);
    };
    set({ nodeGen: { proposalId, steps: [] } });
    try {
      // 承接上一段的真实结尾：只有前一段真炼出片了才接（设定尾帧只是示意图）
      const i = path.findIndex((n) => n.id === slot.id);
      const prev = i > 0 ? path[i - 1] : null;
      const prevProp = prev ? chosenProposal(prev) : null;
      const carry = proposalDone(prevProp) && prop.firstFrame === prevProp!.lastFrame ? prevProp!.lastFrame : null;
      const res = await generateSegment(
        {
          plot: prop.plot,
          firstFrame: prop.firstFrame,
          lastFrame: prop.lastFrame,
          durationSec: prop.durationSec,
          videoTier: slot.videoTier ?? DEFAULT_TIER,
          aspect: slot.aspect,
          anns: [],
          carryFrame: carry,
        },
        prog,
      );
      log.end();
      if (res.url && AI_REAL) spendTokens(cost);
      // 就地改方案：真帧顶替设定帧，videoUrl 落在方案上供两个模式共用。
      // mock 构建没有真视频：占位串让 proposalDone 成立（否则演示模式下永远开不了下一张卡），
      // 需要"能播的地址"的地方一律走 realVideoOf 把它滤掉
      prop.firstFrame = res.firstFrame;
      prop.lastFrame = res.lastFrame;
      prop.videoUrl = res.url || "mock:";
      delete prop.degraded;
      const cur = get().root;
      set({ root: cur ? { ...cur } : cur, nodeGen: null });
      get().npcSay(
        "这一段炼好了——下一段的虚线卡位已经亮起来了。想改细节就点「编辑本段」圈画面，改完的尾帧就是下一段的起拍画面。",
      );
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.fail(`失败：${msg.slice(0, 80)}`);
      set({ nodeGen: null, notice: { text: `这一段没炼成：${msg.slice(0, 60)}`, at: Date.now() } });
      return false;
    }
  },

  startFlow: (opts) => {
    const { root } = get();
    // ★ 这里的门槛是"末段选定了方案"，而不是 composable（那条要求整片都已出片）。
    //   两者刻意分开：法阵亮不亮看 composable（逐段落地的规则，见 placeholderVisible），
    //   但「把节点树铺成工作流」本身只需要一条选完的路径——openWorkDraft 用工作流模式打开
    //   一条还没出片的老草稿走的就是这里，用 composable 把关会让那条路径直接铺不出来，
    //   用户落在一个 0 节点的工作流页上（然后被弹回 /create，看着像草稿丢了）。
    const path0 = activePath(root);
    if (path0.length === 0 || path0[path0.length - 1].chosenId == null) return false;
    // ★ 在途工作流保护：seed() 是整表覆盖，直接铺会抹掉已出片的段（每段真金白银 +
    //   几分钟）、圈选标注与手敲的剧情，而且 StudioPage 只在 0→N 时才跳转，所以第二次
    //   按法阵在界面上等于"点了没反应"——钱和进度却已经没了。交给用户决定。
    if (!opts?.force && flowDirty()) {
      set({ flowConfirm: true });
      return false;
    }
    const path = activePath(root);
    const chosen = path.map((n) => chosenProposal(n)).filter((p): p is Proposal => !!p);
    // 整个节点卡（三种走向都带上）搬进工作流：工作流里的节点就是工坊的节点卡，
    // 只是换成横向切节点、纵向切走向的手机形态——用户在那边还能改选走向
    const nodes: FlowNode[] = chosen.map((p, i) => ({
      id: uid("fn"),
      proposals: path[i].proposals,
      chosenId: p.id,
      // 工坊里已经挑定过了：工作流那边直接是"已选定"态，按钮写「生成本段」而不是
      // 「重新生成方案」（见 flowStore.FlowNode.plan）
      plan: "picked" as const,
      // 用户当初在铸段编辑器里写的那句要求：工作流里「重新生成方案」要拿它再推一次，
      // 缺了它用户就只能拿 AI 写的剧情当自己的要求，越推越偏
      requirement: path[i]?.requirement ?? "",
      videoTier: path[i]?.videoTier ?? DEFAULT_TIER,
      // 老节点树没有 aspect：那时写死 16:9，当横屏读（见 types.aspectOf）
      aspect: path[i]?.aspect ?? "landscape",
      materials: path[i]?.materials,
      // 承接判定：本段设定首帧就是上一段的设定尾帧（AI 顺接铸出来的），才让上一段的
      // 真实结尾顶替起拍帧；用户上传过自定义开头帧的段保持独立起拍
      chain: i > 0 && p.firstFrame === chosen[i - 1].lastFrame,
      // 工坊节点卡上已经单独炼过的段带进来：工作流那边直接显示"已出片"，不用重炼、不重复收费。
      // 方案自带的 videoUrl 是两个模式共用的那份出片（见 types.Proposal.videoUrl）
      videoByProposal: Object.fromEntries(
        path[i].proposals.filter((q) => q.videoUrl).map((q) => [q.id, q.videoUrl as string]),
      ),
      status: "idle",
      anns: [],
    }));
    useFlow.getState().seed(nodes, { mode: "workflow", origin: "studio" });
    set({ flowConfirm: false });
    // 整片预算只做知会不做拦截：工作流是一段一结账，钱不够也能先炼前几段
    const cost = composeCost(chosen.map((p, i) => ({ durationSec: p.durationSec, videoTier: nodes[i].videoTier })));
    const w = walletOf();
    get().npcSay(
      AI_REAL && cost > 0
        ? `${nodes.length} 段已铺成工作流，整片约需 ${fmtTokens(cost)} token（余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))}）。一段一段炼，满意了再往下走。`
        : `${nodes.length} 段已铺成工作流——从第一段开始炼，满意了再往下走。`,
    );
    return true;
  },

  finalizeFromFlow: async (nodes, onProgress) => {
    if (nodes.length === 0) return false;
    const { root } = get();
    const say = (s: string) => onProgress?.(s);
    // 真实帧回写节点树：占位帧的重画、尾帧续作的真实结尾——节点卡、分支树、
    // 日后回炉编辑都以真帧为准（节点卡显示的就是视频里实际的画面）
    const path = root ? activePath(root) : [];
    const videoByProposal: Record<string, string> = {};
    const segments: VideoSegment[] = nodes.map((n) => {
      const p = chosenOf(n);
      const video = nodeVideo(n);
      const real = video && !video.startsWith("mock:") ? video : undefined;
      // 按方案 id 认领它所属的节点槽：用户可能在工作流里改选了走向，
      // 那就把工坊的选定一并改过去（未选走向的子树照旧收在 children 里）
      const slot = path.find((s) => s.proposals.some((q) => q.id === p.id));
      if (slot) {
        const orig = slot.proposals.find((q) => q.id === p.id);
        if (orig) {
          orig.firstFrame = p.firstFrame;
          orig.lastFrame = p.lastFrame;
          // ★ 文案与时长也必须回写，不能只回写帧：下面的 branchTree 是从**节点树**建的
          //   （buildBranchTree 读 proposal.title/plot/durationSec），而 segments 用的是
          //   工作流里改过的值。只回帧的话，同一支视频线性播放显示新文案、走分支显示旧
          //   文案，观众看到两套说法。（orig 与 p 常常是同一个对象——startFlow 是按引用
          //   把 proposals 递过去的——那时这几行是无害的自赋值；用户在工作流里改过之后
          //   flowStore 的 updateProposal 会换新对象，这才真正需要搬回来）
          orig.title = p.title;
          orig.plot = p.plot;
          orig.durationSec = p.durationSec;
          // 工作流里炼出来的段回写到方案上：回工坊后节点卡上还是"已出片"状态，
          // 再点法阵也不会要求重炼一遍（两个模式共用同一份出片）
          if (real) orig.videoUrl = real;
          delete orig.degraded;
        }
        slot.chosenId = p.id;
        slot.videoTier = n.videoTier;
        slot.aspect = n.aspect;
        if (real) videoByProposal[p.id] = real;
      }
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
    const seenCard = new Set<string>();
    const deckCards = nodes
      .flatMap((n) => n.materials ?? [])
      .filter((c) => (seenCard.has(c.id) ? false : (seenCard.add(c.id), true)));
    try {
      const styleHint = deckCards.find((c) => c.type === "style")?.name ?? "";
      // 把已用的素材卡报给 AI：已覆盖的实体不重复提炼，只补剧情里缺卡的角色/场景
      // 派生卡组与 3D 建模以前**完全免费**，而 3D 建模是全 app 最贵的单次操作
      // （seed3d 约 2.4 元/次 ≈ 160k token）。这里在真实 AI 下按上限预扣门槛、
      // 按实际产出结算——余额不够就跳过派生，成片本身照出，不该被卡住
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
      if (AI_REAL && fresh.length > 0) spendTokens(deckCardsCost(fresh.length)); // 按实际出卡结算
      // 3D 画风的作品：给派生的角色卡自动铸 3D 建模（Seed3D，上限 2 张）。
      // ★ 这条正则是**静默触发**的——剧情里出现"渲染"两个字就会去铸模。以前还不收钱，
      //   现在至少要看得起：余额不够就跳过，并明确说出来
      const styleBlob = [styleHint, ...path.map((n) => n.requirement ?? ""), ...segments.map((s) => s.plot)].join(" ");
      if (/3d|三维|立体感|cg|建模|皮克斯|pixar|渲染/i.test(styleBlob)) {
        const want = Math.min(2, fresh.filter((c) => c.type === "character").length);
        if (want > 0) {
          if (AI_REAL && !canAfford(want * MODEL3D_TOKENS)) {
            say(`3D 建模需 ${fmtTokens(want * MODEL3D_TOKENS)} token，余额不足，跳过`);
          } else {
            say(`这是 3D 画风，顺便铸 ${want} 个建模（${fmtTokens(want * MODEL3D_TOKENS)} token）…`);
            const before = fresh.filter((c) => c.modelUrl).length;
            await deriveCharacterModels(fresh, 2, say);
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
    set({
      root: root ? { ...root } : root,
      draft: {
        title: "",
        category: "剧情",
        description: segments.map((sg) => sg.plot).join("\n"),
        cover: segments[0]?.firstFrame ?? "",
        segments,
        branchTree: root ? buildBranchTree(root, videoByProposal) : undefined,
        deck: { name: "", cards: deckCards },
      },
    });
    return true;
  },
  clearDraft: () => set({ draft: null }),

  workDraftId: null,
  newWorkDraft: () => set({ workDraftId: null }),
  retireWorkDraft: async () => {
    const id = get().workDraftId;
    set({ workDraftId: null });
    if (id) await deleteDraft(id);
  },

  saveWorkDraft: async (opts) => {
    const { root, deck, editTarget, workDraftId } = get();
    const f = useFlow.getState();
    // ★ 简约模式不进草稿库：它只有一段、写一句话就出片，一路直通剪辑与发布，中间没有
    //   "回来接着做"的状态。给它存草稿只会在个人页堆一串一次性半成品，而每条都带 1MB 级
    //   的帧，把真正需要草稿的工坊/工作流那 20 条上限挤掉（data/drafts.MAX_DRAFTS）。
    //   写在这里而不是只在 FlowPage 上藏掉按钮：存盘是"规则"，规则只该有一处实现（铁律六）。
    const nodes = f.mode === "simple" ? [] : f.nodes;
    if (!root && nodes.length === 0) return null; // 空白桌面 / 简约模式：没什么可存的
    // 首段：工作流侧优先——那边的帧被真实成片的截帧顶替过，更接近成品
    const head = nodes.length > 0 ? chosenOf(nodes[0]) : root ? chosenProposal(root) : null;
    const coverFrame = head?.firstFrame;
    // 标题默认取第一段的标题（去掉"第N段 · "前缀），比"未命名草稿"好认；
    // 已经存过的草稿不动标题——用户可能在个人页改过名，自动保存不该把它冲掉。
    // 新建节点的标题就是占位的"第 N 段"（见 flowStore.blankProposal），拿它当草稿名
    // 一屏全是"第 1 段"根本分不出谁是谁——这种情况改用剧情开头
    const rawTitle = (head?.title ?? "").replace(/^第\s*\d+\s*段\s*·\s*/, "").trim();
    const autoTitle = /^第\s*\d+\s*段$/.test(rawTitle) || !rawTitle ? (head?.plot ?? "").trim().slice(0, 16) : rawTitle;
    const meta = await saveDraft({
      id: workDraftId,
      title: opts?.title ?? (workDraftId ? undefined : autoTitle),
      lastMode: opts?.from ?? (nodes.length > 0 ? "flow" : "studio"),
      root,
      deck,
      editTarget,
      flow:
        nodes.length > 0
          ? { nodes, cursor: f.cursor, mode: f.mode, origin: f.origin, template: f.template, subject: f.subject }
          : null,
      coverFrame: coverFrame || undefined,
      segCount: nodes.length || activePath(root).length,
      doneCount: nodes.filter((n) => Object.keys(n.videoByProposal).length > 0).length,
    });
    if (meta) set({ workDraftId: meta.id });
    return meta;
  },

  openWorkDraft: (d, mode) => {
    // 工坊侧：草稿里没有节点树（纯工作流/简约模式起手的）就按流水线现搭一棵，
    // 否则「用工坊模式打开」会落到一张空桌子上——用户点的那条草稿像是丢了
    //
    // ★ 老草稿补字段（一处补齐，别靠读取处到处 ?? 兜底——老设备读到 undefined 会静默降级，
    //   见 AGENTS.md 数据层那一节）：
    //     · aspect ——「画幅可选」之前的草稿没有它，而 FlowNode.aspect 是必填；不补会一路
    //       传到方舟的 ratio 参数上。缺省按**横屏**（那时所有出片都写死 16:9，见 aspectOf）
    //     · plan ——「方案台」这一版才有。按"多方案即已选定"补：那时的节点确实是选好的，
    //       缺省成 picking 会让用户打开旧草稿发现每段都要重挑一遍
    //     · requirement —— 退回当前方案的剧情，正是旧版推演时当作 requirement 用的东西
    const flowNodes = ((d.flow?.nodes ?? []) as FlowNode[]).map(
      (n): FlowNode => ({
        ...n,
        aspect: n.aspect ?? "landscape",
        plan: n.plan ?? (n.proposals.length > 1 ? ("picked" as const) : undefined),
        requirement: n.requirement ?? chosenOf(n).plot,
      }),
    );
    const root = d.root ?? (flowNodes.length > 0 ? rootFromFlowNodes(flowNodes) : null);
    set({
      root,
      deck: d.deck ?? [],
      editTarget: (d.editTarget as EditTarget | null) ?? null,
      workDraftId: d.id,
      // 视图层一律回到干净状态：草稿存的是内容，不是"上次停在哪个浮层"
      draft: null,
      focus: null,
      projection: null,
      editor: null,
      spreadOpen: false,
      deckView: false,
      flowConfirm: false,
      flights: [],
      camera: { kind: "default" },
    });
    // 工作流侧
    if (d.flow && flowNodes.length > 0) {
      useFlow.setState({
        nodes: flowNodes,
        cursor: Math.min(d.flow.cursor ?? 0, flowNodes.length - 1),
        mode: d.flow.mode ?? "workflow",
        origin: d.flow.origin ?? "studio",
        template: (d.flow.template as FlowTemplate) ?? null,
        subject: d.flow.subject ?? "",
        busy: false,
        err: "",
      });
    } else if (mode === "flow") {
      // 只有节点树的草稿要进工作流：按活动路径现铺一条（与点法阵同一条路）
      get().startFlow({ force: true });
    } else {
      useFlow.getState().reset();
    }
  },

  editTarget: null,
  startEditPart: async (videoId, partIndex) => {
    const video = getVideo(videoId);
    if (!video) return false;
    const part = partsOf(video)[partIndex];
    if (!part) return false;
    const saved = await loadProject(videoId, partIndex);
    const root =
      saved ?? (part.branchTree ? slotFromBranchTree(part.branchTree) : slotFromSegments(part.segments));
    set({
      root,
      editTarget: { videoId: video.id, partIndex, videoTitle: video.title, partName: part.name },
      draft: null,
      focus: null,
      projection: null,
      editor: null,
      spreadOpen: false,
      camera: { kind: "default" },
      orbit: null,
    });
    get().npcSay(
      saved
        ? `《${video.title}》${part.name} 的工程已经铺回桌面——原来的三方案和没选的走向都在。改完点合成，就会更新到作品里。`
        : `没找到这部作品的源工程（可能是老作品或换了设备），我按成片把节点树还原出来了——每段只有当时选定的方案。改完点合成即可更新作品。`,
    );
    return true;
  },
  startNewPart: (videoId) => {
    const video = getVideo(videoId);
    if (!video) return false;
    const n = partsOf(video).length;
    set({
      root: null,
      editTarget: { videoId: video.id, partIndex: n, videoTitle: video.title, partName: `P${n + 1}` },
      draft: null,
      focus: null,
      projection: null,
      editor: null,
      spreadOpen: false,
      camera: { kind: "default" },
      orbit: null,
    });
    get().npcSay(`来给《${video.title}》添第 ${n + 1} P。桌面已清空，从占位卡开始铸第一段吧。`);
    return true;
  },
  exitEdit: () =>
    set({ editTarget: null, root: null, draft: null, focus: null, projection: null, editor: null }),

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

// DEV 调试/E2E 挂钩：让自动化脚本能拿到与组件同实例的 store
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__studio = useStudio;
}
