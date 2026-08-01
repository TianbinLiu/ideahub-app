// 卡片工坊全局状态：卡组 / NPC 对话 / 市场 / 节点树 / 相机 / 合成
import { create } from "zustand";
import { BranchNodeData, BranchTree, CARD_TYPES, CARD_TYPE_LABELS, Card, CardType, DraftVideo, NodeSlot, Proposal, uid } from "../types";
import { MaterialFile, composeVideo, generateCards, generateProposals, searchMarket } from "../mock/ai";

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
  slots: Partial<Record<CardType, string>>;
  requirement: string;
  durationMode: "ai" | "manual";
  durationSec: number;
  generating: boolean;
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
 *  只有一条有效路线时观众无感自动续播；开头固定为根节点的选定提案。 */
function buildBranchTree(root: NodeSlot | null): BranchTree | undefined {
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
      },
      choices,
    };
    return id;
  };
  const rootId = build(root, rootChosen);
  // 只有一条直线且无任何分岔时没必要带树
  const hasFork = Object.values(nodes).some((n) => n.choices.length > 1);
  return hasFork ? { rootId, nodes } : undefined;
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
  /** 投影窗内容：editor=四区编辑表单；proposals=三方案选择；卡片悬浮当且仅当投影打开 */
  projection: "editor" | "proposals" | null;
  editor: EditorState | null;
  dragCardId: string | null;
  /** 对话视角（底部抽屉展开）：NPC 抬手面向用户 */
  dialogView: boolean;
  /** NPC 手中展示的 AI 推荐卡（按用户卡组缺口 + 市场热度） */
  recommendCard: Card | null;
  flights: Flight[];
  composing: boolean;
  draft: DraftVideo | null;
  camera: CamView;
  /** NPC 正在说话的截止时间戳（npcSay 设置，驱动 3D 口型） */
  speakingUntil: number;
  /** 情绪脉冲：-1（不悦收敛）~ 1（笑意拉满），moodUntil 过期后回归常态浅笑 */
  mood: number;
  moodUntil: number;
  setMood: (mood: number, ms: number) => void;
  /** 玩家形象（第一人称手臂/选择界面），localStorage 持久化 */
  playerAvatar: "m" | "f";
  setPlayerAvatar: (a: "m" | "f") => void;
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
  /** 点击卡片之外的桌面区域：落卡 + 拉远回默认机位（投影打开时无效） */
  unfocus: () => void;
  /** 关闭投影窗（保持聚焦机位，卡片落下；再点空白桌面拉远） */
  closeProjection: () => void;
  toggleSpread: () => void;
  shiftSpread: (dir: 1 | -1) => void;
  pickDeckCard: (cardId: string) => void;
  setDrag: (cardId: string | null) => void;
  dropOnPlaceholder: (cardId: string, pos: [number, number, number], look: [number, number, number]) => void;

  clearSlot: (type: CardType) => void;
  setRequirement: (v: string) => void;
  setDurationMode: (m: "ai" | "manual") => void;
  setDurationSec: (v: number) => void;
  closeEditor: () => void;
  generateNode: () => Promise<void>;

  chooseProposal: (nodeId: string, proposalId: string) => void;

  composeNow: () => Promise<void>;
  clearDraft: () => void;
}

const DEFAULT_EDITOR: EditorState = {
  slots: {},
  requirement: "",
  durationMode: "ai",
  durationSec: 6,
  generating: false,
};

// 市场检索的请求序号：过期响应直接丢弃，防止慢请求乱序覆盖新结果
let marketSeq = 0;
// 节点生成的全局并发闸：取消编辑器再重开也不允许并发两炉
let nodeGenInFlight = false;

export const useStudio = create<StudioState>()((set, get) => ({
  deck: [],
  spreadOpen: false,
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
  draft: null,
  camera: { kind: "default" },
  speakingUntil: 0,
  mood: 0,
  moodUntil: 0,
  setMood: (mood, ms) => set({ mood, moodUntil: Date.now() + ms }),
  playerAvatar: ((): "m" | "f" => {
    const v = localStorage.getItem("ideahub-app.avatar");
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
  closeMarketDetail: () =>
    set((s) => ({ marketDetail: null, camera: s.focus || s.dialogView ? s.camera : { kind: "default" } })),
  addMarketToDeck: (from) => {
    const card = get().marketDetail;
    if (!card) return;
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
      editor: { ...DEFAULT_EDITOR, slots: {} },
      spreadOpen: false,
      camera: { kind: "pos", pos, look },
    });
  },
  focusNode: (nodeId, pos, look) => {
    if (get().projection) return;
    set({ focus: { nodeId }, projection: "proposals", camera: { kind: "pos", pos, look } });
  },
  unfocus: () => {
    if (get().projection) return;
    set({ focus: null, editor: null, spreadOpen: false, camera: { kind: "default" } });
  },
  // 点 ✕ 关闭投影窗：与点击空白桌面一致——卡片落下并拉远回默认机位
  closeProjection: () =>
    set({ projection: null, editor: null, focus: null, spreadOpen: false, camera: { kind: "default" } }),
  toggleSpread: () =>
    set((s) => ({ spreadOpen: s.deck.length > 0 && !s.spreadOpen })),
  shiftSpread: (dir) =>
    set((s) => ({ spreadCenter: Math.min(Math.max(0, s.spreadCenter + dir), Math.max(0, s.deck.length - 1)) })),
  pickDeckCard: (cardId) => {
    const { deck, editor } = get();
    const card = deck.find((c) => c.id === cardId);
    if (!card || !editor || editor.generating) return;
    set({ editor: { ...editor, slots: { ...editor.slots, [card.type]: card.id } } });
  },
  setDrag: (cardId) => set({ dragCardId: cardId }),
  dropOnPlaceholder: (cardId, pos, look) => {
    const { deck, editor } = get();
    const card = deck.find((c) => c.id === cardId);
    set({ dragCardId: null });
    if (!card) return;
    if (editor && !editor.generating) {
      set({ editor: { ...editor, slots: { ...editor.slots, [card.type]: card.id } } });
      return;
    }
    if (get().projection) return;
    // 拖卡进占位 → 直接进入聚焦编辑（等效点击占位卡并预填素材）
    set({
      focus: { nodeId: null },
      projection: "editor",
      editor: { ...DEFAULT_EDITOR, slots: { [card.type]: card.id } },
      spreadOpen: false,
      camera: { kind: "pos", pos, look },
    });
  },

  clearSlot: (type) =>
    set((s) => {
      if (!s.editor) return {};
      const slots = { ...s.editor.slots };
      delete slots[type];
      return { editor: { ...s.editor, slots } };
    }),
  setRequirement: (v) => set((s) => (s.editor ? { editor: { ...s.editor, requirement: v } } : {})),
  setDurationMode: (m) => set((s) => (s.editor ? { editor: { ...s.editor, durationMode: m } } : {})),
  setDurationSec: (v) => set((s) => (s.editor ? { editor: { ...s.editor, durationSec: v } } : {})),
  closeEditor: () => set({ editor: null }),

  generateNode: async () => {
    const { editor, deck, root } = get();
    if (!editor || editor.generating) return;
    if (nodeGenInFlight) {
      get().npcSay("上一炉还在推演，等它出炉再开新的。");
      return;
    }
    const materials = Object.values(editor.slots)
      .map((id) => deck.find((c) => c.id === id))
      .filter((c): c is Card => !!c);
    if (materials.length === 0 && !editor.requirement.trim()) {
      get().npcSay("至少放一张素材卡，或写一句视频要求，我才好推演。");
      return;
    }
    nodeGenInFlight = true;
    const initiatingEditor = { ...editor, generating: true };
    set({ editor: initiatingEditor });
    // 锚点快照：生成期间用户可能改选路径，完成时必须校验挂载点仍一致
    const path = activePath(root);
    const tail0 = path.length > 0 ? path[path.length - 1] : null;
    const anchor = tail0 ? { id: tail0.id, chosenId: tail0.chosenId } : null;
    const prev = tail0 ? chosenProposal(tail0) : null;
    try {
      const proposals = await generateProposals({
        index: root ? path.length : 0,
        materials,
        requirement: editor.requirement,
        durationMode: editor.durationMode,
        durationSec: editor.durationSec,
        prevFrameSeed: prev ? `${prev.id}#last` : null,
        pathPlots: path.map((n) => chosenProposal(n)?.plot ?? "").filter(Boolean),
      });
      const node: NodeSlot = { id: uid("node"), proposals, chosenId: null, children: {} };
      // 只有发起时的编辑器仍然打开才由本次生成负责关闭（取消后重开的新表单不受影响）
      const editorPatch = get().editor === initiatingEditor ? { editor: null as EditorState | null } : {};
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
      get().npcSay("三种走向推演完毕，已经投影在你面前——点开看看各自的首尾帧和剧情，选定一个。");
    } finally {
      nodeGenInFlight = false;
      // 若发起时的编辑器仍开着且未被上面清掉（作废路径），把 generating 复位以便重试
      const cur = get().editor;
      if (cur === initiatingEditor) set({ editor: { ...cur, generating: false } });
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
    set({ composing: true });
    await composeVideo();
    const path = activePath(root);
    const segments = path
      .map((n) => chosenProposal(n))
      .filter((p): p is Proposal => !!p)
      .map((p) => ({
        title: p.title,
        plot: p.plot,
        firstFrame: p.firstFrame,
        lastFrame: p.lastFrame,
        durationSec: p.durationSec,
      }));
    set({
      composing: false,
      draft: {
        title: "",
        category: "剧情",
        description: segments.map((sg) => sg.plot).join("\n"),
        cover: segments[0]?.firstFrame ?? "",
        segments,
        branchTree: buildBranchTree(root),
      },
    });
  },
  clearDraft: () => set({ draft: null }),
}));

// DEV 调试/E2E 挂钩：让自动化脚本能拿到与组件同实例的 store
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__studio = useStudio;
}
