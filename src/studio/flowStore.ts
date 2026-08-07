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
import { create } from "zustand";
import { AI_REAL, composeSegments, generateCover, generateProposals, refineFrame } from "../ai";
import { canAfford, spendTokens, walletOf } from "../data/account";
import { DEFAULT_TIER, fmtTokens, segTokens, tierOf } from "../data/economy";
import { Card, Proposal, uid } from "../types";

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
  /** 本段素材卡快照（工坊带过来的） */
  materials?: Card[];
  videoTier: string;
  /** 首帧承接上一段的真实结尾（用户换过图就置 false，尊重用户） */
  chain: boolean;
  /** 各走向各自的成片：换走向不丢已经炼好的那条 */
  videoByProposal: Record<string, string>;
  /** 只描述"当前正在发生什么"，出片与否看 videoByProposal（见 nodeDone） */
  status: "idle" | "generating" | "failed";
  error?: string;
  /** 生成期实时阶段（"标准档 · 排队中…"） */
  progress?: string;
  anns: FlowAnn[];
}

export type FlowMode = "workflow" | "simple";

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

export function blankProposal(i: number): Proposal {
  return { id: uid("prop"), title: `第 ${i + 1} 段`, plot: "", firstFrame: "", lastFrame: "", durationSec: 5 };
}

export function newFlowNode(i: number, patch: Partial<FlowNode> = {}): FlowNode {
  const p = blankProposal(i);
  return {
    id: uid("fn"),
    proposals: [p],
    chosenId: p.id,
    videoTier: DEFAULT_TIER,
    chain: i > 0,
    videoByProposal: {},
    status: "idle",
    anns: [],
    ...patch,
  };
}

/** 整条流水线还需要多少 token（当前走向已出片的段不再计费） */
export function flowCost(nodes: FlowNode[]): number {
  return nodes.filter((n) => !nodeDone(n)).reduce((s, n) => s + segTokens(chosenOf(n).durationSec, n.videoTier), 0);
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

  seed: (nodes: FlowNode[], opts: { mode: FlowMode; origin: "studio" | "solo" }) => void;
  /** 工作流/简约模式的空白起手：一个待填的节点 */
  seedSolo: (mode: FlowMode) => void;
  reset: () => void;

  /** 改当前走向的内容（标题/剧情/时长/帧） */
  updateProposal: (nodeId: string, patch: Partial<Proposal>) => void;
  updateNode: (nodeId: string, patch: Partial<FlowNode>) => void;
  chooseProposal: (nodeId: string, proposalId: string) => void;
  /** 纵向切走向：dir=1 下一个 */
  shiftProposal: (nodeId: string, dir: 1 | -1) => void;
  /** 让 AI 就地推演三种走向（与工坊节点卡同一套逻辑），追加到本节点 */
  deriveProposals: (nodeId: string) => Promise<boolean>;

  addNode: (afterId?: string) => void;
  removeNode: (id: string) => void;
  moveNode: (id: string, dir: 1 | -1) => void;
  setCursor: (i: number) => void;
  shiftCursor: (dir: 1 | -1) => void;

  addAnn: (nodeId: string, ann: Omit<FlowAnn, "id">) => void;
  removeAnn: (nodeId: string, annId: string) => void;

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

  seed: (nodes, opts) => set({ nodes, cursor: 0, mode: opts.mode, origin: opts.origin, busy: false, err: "" }),
  seedSolo: (mode) =>
    set({ nodes: [newFlowNode(0, { chain: false })], cursor: 0, mode, origin: "solo", busy: false, err: "" }),
  reset: () => set({ nodes: [], cursor: 0, busy: false, err: "" }),

  updateNode: (nodeId, patch) => set((s) => ({ nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) })),

  updateProposal: (nodeId, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, proposals: n.proposals.map((p) => (p.id === n.chosenId ? { ...p, ...patch } : p)) }
          : n,
      ),
    })),

  chooseProposal: (nodeId, proposalId) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, chosenId: proposalId, anns: [] } : n)) })),

  shiftProposal: (nodeId, dir) =>
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId || n.proposals.length < 2) return n;
        const i = n.proposals.findIndex((p) => p.id === n.chosenId);
        const j = (i + dir + n.proposals.length) % n.proposals.length;
        // 换走向 = 换了一段戏，之前对旧走向画面提的圈选要求不再适用
        return { ...n, chosenId: n.proposals[j].id, anns: [] };
      }),
    })),

  deriveProposals: async (nodeId) => {
    const s0 = get();
    if (s0.busy) return false;
    const idx = s0.nodes.findIndex((n) => n.id === nodeId);
    const node = s0.nodes[idx];
    if (!node) return false;
    const cur = chosenOf(node);
    if (!cur.plot.trim() && !node.materials?.length) {
      set({ err: "先写一句要拍什么（或从工坊带素材卡过来），我才好推演走向" });
      return false;
    }
    set({ busy: true, err: "" });
    get().updateNode(nodeId, { status: "generating", progress: "推演三种走向…" });
    try {
      const prevNode = get().nodes[idx - 1];
      const prev = prevNode ? chosenOf(prevNode) : null;
      const fresh = await generateProposals(
        {
          index: idx,
          materials: node.materials ?? [],
          requirement: cur.plot,
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
      // 已经炼出成片、或用户手写过内容的旧走向保留在后面，AI 的新走向排前面
      const keep = node.proposals.filter((p) => node.videoByProposal[p.id] || p.plot.trim());
      get().updateNode(nodeId, {
        proposals: [...fresh, ...keep],
        chosenId: fresh[0].id,
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

  addNode: (afterId) =>
    set((s) => {
      const at = afterId ? s.nodes.findIndex((n) => n.id === afterId) : s.nodes.length - 1;
      const i = at < 0 ? s.nodes.length : at + 1;
      const prev = s.nodes[i - 1];
      const node = newFlowNode(i, { chain: !!prev, videoTier: prev?.videoTier ?? DEFAULT_TIER });
      if (prev) node.proposals[0].durationSec = chosenOf(prev).durationSec;
      return { nodes: [...s.nodes.slice(0, i), node, ...s.nodes.slice(i)], cursor: i };
    }),

  removeNode: (id) =>
    set((s) => {
      if (s.nodes.length <= 1) return {};
      const i = s.nodes.findIndex((n) => n.id === id);
      const nodes = s.nodes.filter((n) => n.id !== id);
      return { nodes, cursor: Math.min(s.cursor, nodes.length - 1, Math.max(0, i)) };
    }),

  moveNode: (id, dir) =>
    set((s) => {
      const i = s.nodes.findIndex((n) => n.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.nodes.length) return {};
      const nodes = s.nodes.slice();
      [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
      return { nodes, cursor: j };
    }),

  setCursor: (i) => set((s) => ({ cursor: Math.max(0, Math.min(i, s.nodes.length - 1)) })),
  shiftCursor: (dir) => set((s) => ({ cursor: Math.max(0, Math.min(s.cursor + dir, s.nodes.length - 1)) })),

  addAnn: (nodeId, ann) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, anns: [...n.anns, { ...ann, id: uid("ann") }] } : n)),
    })),
  removeAnn: (nodeId, annId) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, anns: n.anns.filter((a) => a.id !== annId) } : n)),
    })),

  genNode: async (id) => {
    const s0 = get();
    if (s0.busy) return false;
    const idx = s0.nodes.findIndex((n) => n.id === id);
    if (idx < 0) return false;
    const node = s0.nodes[idx];
    const prop = chosenOf(node);
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
    const prog = (t: string) => patchNode({ progress: t });
    set({ busy: true, err: "" });
    patchNode({ status: "generating", progress: "准备中…", error: undefined });
    try {
      let first = prop.firstFrame;
      let last = prop.lastFrame;
      // ① 圈选标注 → 改设定帧：落在前半段的圈选改首帧、后半段改尾帧；
      //    同一帧的多条标注串行叠加（上一次的产物当下一次的底图）
      const half = prop.durationSec / 2;
      for (let k = 0; k < node.anns.length; k++) {
        const a = node.anns[k];
        prog(`按圈选改画面 ${k + 1}/${node.anns.length}…`);
        const edited = await refineFrame(
          `${a.req}。参考图中红色圈线标注了目标物体：只对该物体做上述处理，并彻底去掉红色圈线本身`,
          a.frame,
        );
        if (a.atSec < half) first = edited;
        else last = edited;
      }
      // ② 承接上一段的真实结尾起拍（上一段出片后其尾帧已被真实截帧顶替）
      const prevNode = get().nodes[idx - 1];
      const prevProp = prevNode ? chosenOf(prevNode) : null;
      if (node.chain && prevNode && nodeDone(prevNode) && prevProp?.lastFrame) first = prevProp.lastFrame;
      // ③ 没有设定帧就先画一张（简约模式/新建节点的常态）
      const tier = tierOf(node.videoTier);
      if (!first) {
        prog("绘制起拍画面…");
        first = await generateCover(prop.plot.slice(0, 200));
      }
      if (!last && tier.flf) {
        prog("绘制结束画面…");
        last = await generateCover(`${prop.plot.slice(0, 180)} 的结束瞬间`);
      }
      patchProp({ firstFrame: first, lastFrame: last });
      // ④ 出片（composeSegments 单段调用：自带档位分派、真实尾帧捕获、失败原因回传）
      const reqs = node.anns.map((a) => a.req).join("；");
      const plot = reqs ? `${prop.plot}。修改要求（必须满足）：${reqs}` : prop.plot;
      const [res] = await composeSegments(
        [{ plot, firstFrame: first, lastFrame: last, durationSec: prop.durationSec, videoTier: node.videoTier }],
        (_d, _t, status) => prog(status),
      );
      if (res?.error) throw new Error(res.error);
      if (res?.url && AI_REAL) spendTokens(cost);
      // 真实帧顶替设定帧：节点卡显示的就是视频里实际的画面，也是下一段的起拍帧
      patchProp({
        ...(res?.firstFrame ? { firstFrame: res.firstFrame } : {}),
        ...(res?.lastFrame ? { lastFrame: res.lastFrame } : {}),
        degraded: undefined,
      });
      patchNode({
        status: "idle",
        progress: "",
        // mock 构建没有真视频：占位串让 nodeDone 成立，播放器回退首尾帧渐变
        videoByProposal: { ...get().nodes[idx].videoByProposal, [node.chosenId]: res?.url || "mock:" },
        anns: [],
      });
      set({ busy: false });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
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
