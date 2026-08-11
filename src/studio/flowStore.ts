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
import { AI_REAL, generateCover, generateProposals } from "../ai";
import { canAfford, spendTokens, walletOf } from "../data/account";
import { DEFAULT_TIER, fmtTokens, proposalRedrawCost, proposalsCost, segTokens } from "../data/economy";
import { Card, Proposal, TemplateRecipe, VideoTemplate, uid } from "../types";
import { GenStep, createGenLog, splitStatus } from "./genLog";
import { generateSegment } from "./segmentGen";

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

/** 套用中的模板快照（草稿要整份存下来，所以单独成型） */
export type FlowTemplate = { id: string; title: string; recipe: TemplateRecipe; cards: Card[] } | null;

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

/** 整条流水线还需要多少 token（当前走向已出片的段不再计费） */
export function flowCost(nodes: FlowNode[]): number {
  return nodes.filter((n) => !nodeDone(n)).reduce((s, n) => s + segTokens(chosenOf(n).durationSec, n.videoTier), 0);
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

  seed: (nodes: FlowNode[], opts: { mode: FlowMode; origin: "studio" | "solo" }) => void;
  /** 工作流/简约模式的空白起手：一个待填的节点 */
  seedSolo: (mode: FlowMode) => void;
  /** 套模板：按配方的分镜骨架铺节点、挂上模板卡组，之后只等用户写那句话 */
  applyTemplate: (t: VideoTemplate) => void;
  /** 写那句话：立刻把配方里的 {{主题}} 填成它，各段剧情随之成形 */
  setSubject: (subject: string) => void;
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

  // ★ template/subject 必须一起清：工坊铺过来的是 workflow 模式的节点，而模板栏只在
  //   simple 模式渲染。留着上一轮简约模式的模板，NodeScreen 会把剧情编辑框换成模板的
  //   「一句话」输入框，且没有「不用」可点；在那里打字会走 setSubject，把工坊 AI 推演
  //   出来的剧情/标题/时长按模板配方整个覆盖掉。（seedSolo 与 reset 本来就清了）
  seed: (nodes, opts) =>
    set({ nodes, cursor: 0, mode: opts.mode, origin: opts.origin, busy: false, err: "", template: null, subject: "" }),
  seedSolo: (mode) =>
    set({
      nodes: [newFlowNode(0, { chain: false })],
      cursor: 0,
      mode,
      origin: "solo",
      busy: false,
      err: "",
      template: null,
      subject: "",
    }),

  applyTemplate: (t) =>
    set({
      // 一个 beat 一段。段与段之间沿用尾帧续作（chain），模板才有连贯性
      nodes: t.recipe.beats.map((_, i) =>
        newFlowNode(i, {
          chain: i > 0,
          materials: t.cards.length ? t.cards : undefined,
          videoTier: t.recipe.videoTier,
        }),
      ),
      cursor: 0,
      mode: "simple",
      origin: "solo",
      busy: false,
      err: "",
      template: { id: t.id, title: t.title, recipe: t.recipe, cards: t.cards },
      subject: "",
    }),

  setSubject: (subject) =>
    set((s) => {
      const rec = s.template?.recipe;
      if (!rec) return { subject };
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
              p.id === n.chosenId ? { ...p, plot, title: `${s.template!.title} · 第 ${i + 1} 段`, durationSec: rec.durationSec } : p,
            ),
          };
        }),
      };
    }),

  reset: () => set({ nodes: [], cursor: 0, busy: false, err: "", template: null, subject: "" }),

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
      let first = prop.firstFrame;
      if (!keepFirst) first = await generateCover(prop.plot.slice(0, 200));
      let last = prop.lastFrame;
      if (!keepLast) {
        get().updateNode(nodeId, { progress: "重画结束画面…" });
        // 以开头帧当参考图：同一段戏的两帧必须是同一套人物/画风，各画各的会串味
        last = await generateCover(`${prop.plot.slice(0, 180)} 的结束瞬间`, first || undefined);
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
      const prev = s.nodes[s.nodes.length - 1];
      // 顺序门禁：只能在末尾追加，且上一段必须已出片
      if (prev && !nodeDone(prev)) return { err: "先把这一段炼出来，再加下一段" };
      const i = s.nodes.length;
      const node = newFlowNode(i, { chain: !!prev, videoTier: prev?.videoTier ?? DEFAULT_TIER });
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
    const cost = segTokens(prop.durationSec, node.videoTier);
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
      const res = await generateSegment(
        {
          plot: prop.plot,
          firstFrame: prop.firstFrame,
          lastFrame: prop.lastFrame,
          durationSec: prop.durationSec,
          videoTier: node.videoTier,
          anns: node.anns,
          carryFrame: carry,
          framePrompt: tplFrame ? fillSubject(tplFrame, get().subject) : undefined,
          // 本段素材卡要真的进提示词。此前它只喂给「推演三种走向」，
          // 用户在这一段挂了人物卡再点生成，出片其实完全不认识那张卡
          materials: node.materials,
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
