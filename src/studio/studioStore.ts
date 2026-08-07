// 卡片工坊全局状态：卡组 / NPC 对话 / 市场 / 节点树 / 相机 / 合成 / 已发布作品回炉编辑
import { create } from "zustand";
import { BranchNodeData, BranchTree, CARD_TYPES, CARD_TYPE_LABELS, Card, DraftVideo, NodeSlot, Proposal, VideoSegment, uid } from "../types";
import { AI_REAL, MaterialFile, composeSegments, composeVideo, deriveCharacterModels, deriveDeckCards, generateCards, generateProposals, searchMarket } from "../ai";
import { DECK_CAM, NPC_CAM } from "./scene/layout";
import type { PlayerAvatar } from "./quality";
import { addCards as saveCardsToAccount, canAfford, myCards, myDecks, spendTokens, walletOf } from "../data/account";
import { DEFAULT_TIER, composeCost, fmtTokens, segTokens } from "../data/economy";
import { getVideo, loadProject, partsOf } from "../data/videos";

export interface DialogMsg {
  id: string;
  from: "npc" | "me";
  text: string;
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

/** 虚线空白卡位是否可见：无节点，或路径末端已选定 */
export function placeholderVisible(root: NodeSlot | null): boolean {
  if (!root) return true;
  const path = activePath(root);
  return path[path.length - 1].chosenId != null;
}

export function composable(root: NodeSlot | null): boolean {
  if (!root) return false;
  const path = activePath(root);
  return path[path.length - 1].chosenId != null;
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
  };
}

/** 线性成片 → 单链节点树（每节点一个已选方案） */
function slotFromSegments(segments: VideoSegment[]): NodeSlot | null {
  let next: NodeSlot | null = null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const p = segToProposal(i, segments[i]);
    const node: NodeSlot = { id: uid("node"), proposals: [p], chosenId: p.id, children: {} };
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
    return { id: uid("node"), proposals, chosenId: proposals[0].id, children };
  };
  return build(tree.startChoices?.map((c) => c.nextId) ?? [tree.rootId], depthIndex, new Set());
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
  market: { open: boolean; items: Card[]; query: string; loading: boolean };
  marketDetail: Card | null;
  dialog: { messages: DialogMsg[]; busy: boolean };
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
  recommendCard: Card | null;
  flights: Flight[];
  composing: boolean;
  /** 合成的实时阶段（真实 AI：第 n/N 段 · 排队/生成 Xs），空串=未在合成或 mock 构建 */
  composeStatus: string;
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

  npcSay: (text: string) => void;
  meSay: (text: string) => void;
  initGreet: () => void;
  setCamera: (c: CamView) => void;
  setDialogView: (v: boolean) => void;
  /** 计算推荐卡：优先补齐卡组缺失类型中市场最热的一张 */
  refreshRecommend: () => Promise<void>;
  /** 查看卡片详情（不移动相机；复用市场详情单） */
  viewCardDetail: (card: Card) => void;

  openMarket: () => Promise<void>;
  marketSearch: (q: string) => Promise<void>;
  closeMarket: () => void;
  viewMarketCard: (card: Card, camPos: [number, number, number], look: [number, number, number]) => void;
  closeMarketDetail: () => void;
  addMarketToDeck: (from: [number, number, number]) => void;

  addFiles: (files: MaterialFile[]) => void;
  removeFile: (name: string) => void;
  sendToNpc: (text: string) => Promise<void>;

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
  setVideoTier: (id: string) => void;
  /** 上传/清除本段开头帧（null=恢复默认承接上一节点尾帧） */
  setStartFrame: (dataUrl: string | null) => void;
  setRequirement: (v: string) => void;
  setDurationMode: (m: "ai" | "manual") => void;
  setDurationSec: (v: number) => void;
  closeEditor: () => void;
  generateNode: () => Promise<void>;

  chooseProposal: (nodeId: string, proposalId: string) => void;

  composeNow: () => Promise<void>;
  clearDraft: () => void;

  /** 非 null = 回炉编辑模式（工坊顶部亮横幅，发布页变"保存修改"） */
  editTarget: EditTarget | null;
  /** 重制已发布作品的某一 P：载入源工程（无则从成片重建）并进入编辑模式 */
  startEditPart: (videoId: string, partIndex: number) => Promise<boolean>;
  /** 为已发布作品新增一 P：空桌面开工，合成后追加到该作品 */
  startNewPart: (videoId: string) => boolean;
  /** 退出编辑模式（不动作品本身；桌面清空回到全新创作） */
  exitEdit: () => void;
}

const DEFAULT_EDITOR: EditorState = {
  slots: [],
  requirement: "",
  durationMode: "ai",
  durationSec: 6,
  videoTier: DEFAULT_TIER,
  startFrame: null,
  generating: false,
  progress: "",
};

// 市场检索的请求序号：过期响应直接丢弃，防止慢请求乱序覆盖新结果
let marketSeq = 0;
// 节点生成的全局并发闸：取消编辑器再重开也不允许并发两炉
let nodeGenInFlight = false;

export const useStudio = create<StudioState>()((set, get) => ({
  deck: [],
  spreadOpen: false,
  deckView: false,
  orbit: null,
  spreadCenter: 0,
  market: { open: false, items: [], query: "", loading: false },
  marketDetail: null,
  dialog: { messages: [], busy: false },
  pendingFiles: [],
  root: null,
  focus: null,
  projection: null,
  editor: null,
  dragCardId: null,
  dialogView: false,
  recommendCard: null,
  flights: [],
  composing: false,
  composeStatus: "",
  draft: null,
  camera: { kind: "default" },
  speakingUntil: 0,
  mood: 0,
  moodUntil: 0,
  setMood: (mood, ms) => set({ mood, moodUntil: Date.now() + ms }),
  playerAvatar: ((): PlayerAvatar => {
    const v = localStorage.getItem("ideahub-app.avatar");
    // 开发试穿档只在 DEV 构建下生效：生产构建里存量 localStorage 值安全回退到默认
    if (import.meta.env.DEV && (v === "rin" || v === "gratia")) return v;
    return v === "m" ? "m" : "f";
  })(),
  setPlayerAvatar: (a) => {
    localStorage.setItem("ideahub-app.avatar", a);
    set({ playerAvatar: a });
  },
  avatarPickerOpen: false,
  setAvatarPickerOpen: (open) => set({ avatarPickerOpen: open }),

  npcSay: (text) =>
    set((s) => ({
      dialog: { ...s.dialog, messages: [...s.dialog.messages, { id: uid("m"), from: "npc", text }] },
      // NPC 开口：按文本长度估算说话时长，驱动 3D 口型
      speakingUntil: Date.now() + Math.min(6000, Math.max(1500, text.length * 110)),
    })),
  meSay: (text) =>
    set((s) => ({ dialog: { ...s.dialog, messages: [...s.dialog.messages, { id: uid("m"), from: "me", text }] } })),
  initGreet: () => {
    if (get().dialog.messages.length > 0) return;
    get().npcSay("欢迎来到卡片工坊。把你的素材（图片、文本）交给我，我为你炼成卡片；也可以逛逛市场，看看大家都在用什么。");
  },
  setCamera: (camera) => set({ camera }),
  setDialogView: (dialogView) => set({ dialogView }),
  refreshRecommend: async () => {
    const items = await searchMarket("");
    const { deck, recommendCard } = get();
    const inDeck = new Set(deck.map((c) => c.id));
    const missingType = CARD_TYPES.find((t) => !deck.some((c) => c.type === t));
    const rec =
      items.find((c) => c.type === missingType && !inDeck.has(c.id)) ??
      items.find((c) => !inDeck.has(c.id)) ??
      null;
    set({ recommendCard: rec });
    if (rec && rec.id !== recommendCard?.id) {
      get().npcSay(
        `我手里这张「${rec.name}」最近在市场很热${missingType ? `，看你卡组正缺${CARD_TYPE_LABELS[missingType]}` : ""}——点它看看？`
      );
    }
  },
  viewCardDetail: (card) => set({ marketDetail: card }),

  openMarket: async () => {
    if (get().market.open) return;
    const seq = ++marketSeq;
    // 摊开的卡平放在桌面：对话平视角下不可读，统一切回俯视机位
    set((s) => ({
      market: { ...s.market, open: true, loading: true, query: "" },
      camera: { kind: "default" },
    }));
    get().npcSay("稍等——（从口袋里抽出一叠卡，在桌上哗地摊开）这些是最近社区里最抢手的。想找特定的，直接在下面输入关键词。");
    const items = await searchMarket("");
    if (seq !== marketSeq) return; // 期间发起过新检索，丢弃本次结果
    set((s) => ({ market: { ...s.market, items, loading: false } }));
  },
  marketSearch: async (q) => {
    const seq = ++marketSeq;
    set((s) => ({ market: { ...s.market, loading: true, query: q } }));
    const items = await searchMarket(q);
    if (seq !== marketSeq) return; // 过期响应
    set((s) => ({ market: { ...s.market, items, loading: false } }));
    get().npcSay(q ? `按「${q}」翻出了 ${items.length} 张，都给你摊开了。` : `这是当下最热的 ${items.length} 张。`);
  },
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
    const { market, dialog, pendingFiles } = get();
    if (dialog.busy) return;
    const trimmed = text.trim();
    if (market.open) {
      if (!trimmed) return;
      get().meSay(trimmed);
      await get().marketSearch(trimmed);
      return;
    }
    if (!trimmed && pendingFiles.length === 0) return;
    get().meSay(trimmed || `（递上 ${pendingFiles.length} 份素材）`);
    set((s) => ({ dialog: { ...s.dialog, busy: true } }));
    get().npcSay("收到，让我看看成色……（炉火升起）");
    const cards = await generateCards(pendingFiles, trimmed);
    saveCardsToAccount(cards); // 炼出的卡归入账号资产（创意工坊/Profile 可见）
    set((s) => ({ dialog: { ...s.dialog, busy: false }, pendingFiles: [] }));
    if (cards.length === 0) {
      get().npcSay("这些素材还差点意思，再补充点描述？");
      get().setMood(-0.6, 2600);
      return;
    }
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
    get().npcSay(`铛——${cards.length} 张新卡出炉，已经飞进你的卡组了。`);
    get().setMood(1, 4000);
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
      editor: { ...DEFAULT_EDITOR, slots: [] },
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
    void st.refreshRecommend();
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
      editor: { ...DEFAULT_EDITOR, slots: [card.id] },
      spreadOpen: false,
      camera: { kind: "pos", pos, look },
    });
  },

  clearSlot: (cardId) =>
    set((s) =>
      s.editor ? { editor: { ...s.editor, slots: s.editor.slots.filter((id) => id !== cardId) } } : {},
    ),
  setRequirement: (v) => set((s) => (s.editor ? { editor: { ...s.editor, requirement: v } } : {})),
  setDurationMode: (m) => set((s) => (s.editor ? { editor: { ...s.editor, durationMode: m } } : {})),
  setDurationSec: (v) => set((s) => (s.editor ? { editor: { ...s.editor, durationSec: v } } : {})),
  setVideoTier: (id) => set((s) => (s.editor ? { editor: { ...s.editor, videoTier: id } } : {})),
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
    // 投影关闭 → 卡片带着选定信息落回桌面；机位保持拉近，点空白桌面再拉远
    set({ root: root ? { ...root } : root, projection: null, editor: null });
  },

  composeNow: async () => {
    const { root, composing } = get();
    if (composing || !composable(root)) return;
    const path = activePath(root);
    const chosen = path.map((n) => chosenProposal(n)).filter((p): p is Proposal => !!p);
    const segments = chosen.map((p, i) => ({
      title: p.title,
      plot: p.plot,
      firstFrame: p.firstFrame,
      lastFrame: p.lastFrame,
      durationSec: p.durationSec,
      degraded: p.degraded,
      videoTier: path[i]?.videoTier,
    }));
    // 余额门槛：合成前把整片 token 报给用户，不够先拦下（免得炼到一半没钱尴尬）。
    // 只对真实 AI 构建收费——mock 构建不产生真实资源消耗。
    const cost = composeCost(segments);
    if (AI_REAL && cost > 0 && !canAfford(cost)) {
      const w = walletOf();
      get().npcSay(
        `合成这部片约需 ${fmtTokens(cost)} token，你的余额只剩 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))}` +
          `——去「我的」页充值或订阅套餐，回来再点合成。`,
      );
      get().setMood(-0.3, 2400);
      return;
    }
    set({ composing: true, composeStatus: "" });
    await composeVideo();
    // 真实 AI 构建：逐段 Seedance 首尾帧生成视频（每段约 1 分钟，真实进度打到合成遮罩）；
    // mock 构建下 composeSegments 返回空结果，播放器回退首尾帧渐变
    const results = await composeSegments(segments, (done, total, status) => {
      if (done >= total) return;
      set({ composeStatus: `第 ${done + 1}/${total} 段 · ${status}` });
      if (status === "任务创建中…") get().npcSay(`正在炼制第 ${done + 1}/${total} 段影像…`);
    });
    // 计费：按成功炼成的段扣 token（先套餐后 add-on）——与方舟"成功才计费"同一口径
    if (AI_REAL) {
      for (let i = 0; i < results.length; i++) {
        if (results[i]?.url) spendTokens(segTokens(segments[i].durationSec, segments[i].videoTier));
      }
    }
    const videoByProposal: Record<string, string> = {};
    const withVideo = segments.map((sg, i) => {
      const r = results[i] ?? {};
      // "真实帧"同步回节点方案：占位帧的重画、尾帧续作的真实结尾/起拍帧——
      // 草稿、分支树、后续续作都以真帧为准（节点卡显示的就是视频里实际的画面）
      if (r.firstFrame) chosen[i].firstFrame = r.firstFrame;
      if (r.lastFrame) chosen[i].lastFrame = r.lastFrame;
      if (r.firstFrame && r.lastFrame) delete chosen[i].degraded;
      if (r.url) videoByProposal[chosen[i].id] = r.url;
      return {
        title: sg.title,
        plot: sg.plot,
        firstFrame: chosen[i].firstFrame,
        lastFrame: chosen[i].lastFrame,
        durationSec: sg.durationSec,
        videoTier: sg.videoTier,
        ...(r.url ? { videoUrl: r.url } : {}),
      };
    });
    // 成片里有几段是真影像、几段回退，必须明说——此前静默回退渐变，
    // 用户拿到一片"会动的幻灯片"还以为是 Seedance 的产物
    const failed = results
      .map((r, i) => (r?.url ? null : { i, reason: r?.error }))
      .filter((x): x is { i: number; reason: string | undefined } => !!x);
    if (failed.length === 0) {
      get().npcSay(`${segments.length} 段影像全部真实炼成，去发布页看看成片吧。`);
    } else {
      const why = failed[0].reason ? `（第 ${failed[0].i + 1} 段：${failed[0].reason.slice(0, 100)}）` : "";
      get().npcSay(
        `成片出炉，但 ${failed.length}/${segments.length} 段影像没炼成，先用首尾帧渐变顶着${why}。回工坊重新合成可再试。`,
      );
      get().setMood(-0.4, 2600);
    }
    // 本片卡组：素材卡并集 + AI 从剧情提炼的派生卡（角色/场景/背景/画风，
    // 卡面跟随视频画风）。派生失败时兜底按段出场景卡——每部作品都必须有
    // 可分享的卡组，观众才能"用同款素材复刻"
    const seenCard = new Set<string>();
    const deckCards = path
      .flatMap((n) => n.materials ?? [])
      .filter((c) => (seenCard.has(c.id) ? false : (seenCard.add(c.id), true)));
    try {
      const styleHint = deckCards.find((c) => c.type === "style")?.name ?? "";
      // 把节点里已用的素材卡报给 AI：已覆盖的实体不重复提炼，只补剧情里缺卡的角色/场景
      const derived = await deriveDeckCards(
        withVideo.map((sg) => ({ title: sg.title, plot: sg.plot, firstFrame: sg.firstFrame })),
        styleHint,
        deckCards.map((c) => ({ type: c.type, name: c.name, summary: c.summary })),
        (s) => set({ composeStatus: s }),
      );
      const names = new Set(deckCards.map((c) => c.name));
      const fresh = derived.filter((c) => !names.has(c.name));
      deckCards.push(...fresh);
      // 3D 画风的作品：给派生的角色卡自动铸 3D 建模（Seed3D，上限 2 张）。
      // 依据 = 风格卡名 + 各节点的视频要求快照 + 分段剧情里的 3D 语汇
      const styleBlob = [styleHint, ...path.map((n) => n.requirement ?? ""), ...withVideo.map((s) => s.plot)].join(" ");
      if (/3d|三维|立体感|cg|建模|皮克斯|pixar|渲染/i.test(styleBlob)) {
        await deriveCharacterModels(fresh, 2, (s) => set({ composeStatus: s }));
      }
    } catch (e) {
      console.warn("[studio] 卡组提炼回退按段场景卡:", e);
      if (deckCards.length === 0) {
        deckCards.push(
          ...withVideo.map((sg, i) => ({
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
      composing: false,
      composeStatus: "",
      root: root ? { ...root } : root,
      draft: {
        title: "",
        category: "剧情",
        description: withVideo.map((sg) => sg.plot).join("\n"),
        cover: withVideo[0]?.firstFrame ?? "",
        segments: withVideo,
        branchTree: buildBranchTree(root, videoByProposal),
        deck: { name: "", cards: deckCards },
      },
    });
  },
  clearDraft: () => set({ draft: null }),

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
}));

// DEV 调试/E2E 挂钩：让自动化脚本能拿到与组件同实例的 store
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__studio = useStudio;
}
