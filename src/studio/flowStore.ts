// 工作流模式的状态：把"整片一次合成"拆成一节点一段、逐段确认的流水线。
//
// 与工坊（studioStore）的关系是单向的：studioStore 把活动路径喂进来（seed），
// FlowPage 生成完再回头调 studioStore.finalizeFromFlow 组稿。**本文件绝不 import
// studioStore**——否则两个 store 互相 import，Vite 下会拿到半初始化的模块。
//
// 为什么逐段而不是一把梭：一段视频 1 分钟起、几万 token 起，整片炼完才发现第 1 段
// 人物就不对，等于全片重来。逐段确认让用户在最便宜的时候止损。
import { create } from "zustand";
import { AI_REAL, composeSegments, generateCover, refineFrame } from "../ai";
import { canAfford, spendTokens, walletOf } from "../data/account";
import { DEFAULT_TIER, fmtTokens, segTokens, tierOf } from "../data/economy";
import { Card, uid } from "../types";

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
  title: string;
  /** 剧情/画面描述——直接作为 Seedance 提示词 */
  plot: string;
  firstFrame: string;
  lastFrame: string;
  durationSec: number;
  videoTier: string;
  /** 本段素材卡快照（工坊来的节点有；工作流/简约模式可为空） */
  materials?: Card[];
  /** 来源工坊方案 id：组稿时把真实帧回写进节点树 */
  proposalId?: string;
  /** 首帧承接上一段的真实结尾（用户换过图就置 false，尊重用户） */
  chain: boolean;
  videoUrl?: string;
  status: "idle" | "generating" | "done" | "failed";
  error?: string;
  /** 生成期实时阶段（"标准档 · 排队中…"） */
  progress?: string;
  anns: FlowAnn[];
}

export type FlowMode = "workflow" | "simple";

interface FlowState {
  nodes: FlowNode[];
  /** 当前处理到第几个节点（前面的都已确认） */
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

  updateNode: (id: string, patch: Partial<FlowNode>) => void;
  addNode: (afterId?: string) => void;
  removeNode: (id: string) => void;
  moveNode: (id: string, dir: 1 | -1) => void;
  setCursor: (i: number) => void;

  addAnn: (nodeId: string, ann: Omit<FlowAnn, "id">) => void;
  removeAnn: (nodeId: string, annId: string) => void;

  /** 生成/重生成某节点：先按圈选改设定帧，再承接上一段真尾帧起拍，最后出片 */
  genNode: (id: string) => Promise<boolean>;
}

export function newFlowNode(i: number, patch: Partial<FlowNode> = {}): FlowNode {
  return {
    id: uid("fn"),
    title: `第 ${i + 1} 段`,
    plot: "",
    firstFrame: "",
    lastFrame: "",
    durationSec: 5,
    videoTier: DEFAULT_TIER,
    chain: i > 0,
    status: "idle",
    anns: [],
    ...patch,
  };
}

/** 整条流水线还需要多少 token（已出片的段不再计费） */
export function flowCost(nodes: FlowNode[]): number {
  return nodes.filter((n) => !n.videoUrl).reduce((s, n) => s + segTokens(n.durationSec, n.videoTier), 0);
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

  updateNode: (id, patch) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),

  addNode: (afterId) =>
    set((s) => {
      const at = afterId ? s.nodes.findIndex((n) => n.id === afterId) : s.nodes.length - 1;
      const i = at < 0 ? s.nodes.length : at + 1;
      const prev = s.nodes[i - 1];
      const node = newFlowNode(i, {
        chain: !!prev,
        videoTier: prev?.videoTier ?? DEFAULT_TIER,
        durationSec: prev?.durationSec ?? 5,
      });
      return { nodes: [...s.nodes.slice(0, i), node, ...s.nodes.slice(i)] };
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
      return { nodes };
    }),

  setCursor: (i) => set((s) => ({ cursor: Math.max(0, Math.min(i, s.nodes.length - 1)) })),

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
    if (!node.plot.trim()) {
      set({ err: "先写清楚这一段要拍什么" });
      return false;
    }
    const cost = segTokens(node.durationSec, node.videoTier);
    if (AI_REAL && !canAfford(cost)) {
      const w = walletOf();
      set({
        err: `本段约需 ${fmtTokens(cost)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不足——去「我的」页充值`,
      });
      return false;
    }
    const patch = (p: Partial<FlowNode>) => get().updateNode(id, p);
    const prog = (t: string) => patch({ progress: t });
    set({ busy: true, err: "" });
    patch({ status: "generating", progress: "准备中…", error: undefined });
    try {
      let first = node.firstFrame;
      let last = node.lastFrame;
      // ① 圈选标注 → 改设定帧：落在前半段的圈选改首帧、后半段改尾帧；
      //    同一帧的多条标注串行叠加（上一次的产物当下一次的底图）
      const half = node.durationSec / 2;
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
      // ② 承接上一段的真实结尾起拍（上一段生成后 lastFrame 已被真实尾帧顶替）
      const prev = get().nodes[idx - 1];
      if (node.chain && prev?.status === "done" && prev.lastFrame) first = prev.lastFrame;
      // ③ 没有设定帧就先画一张（简约模式/新建节点的常态）
      const tier = tierOf(node.videoTier);
      if (!first) {
        prog("绘制起拍画面…");
        first = await generateCover(node.plot.slice(0, 200));
      }
      if (!last && tier.flf) {
        prog("绘制结束画面…");
        last = await generateCover(`${node.plot.slice(0, 180)} 的结束瞬间`);
      }
      patch({ firstFrame: first, lastFrame: last });
      // ④ 出片（composeSegments 单段调用：自带档位分派、真实尾帧捕获、失败原因回传）
      const reqs = node.anns.map((a) => a.req).join("；");
      const plot = reqs ? `${node.plot}。修改要求（必须满足）：${reqs}` : node.plot;
      const [res] = await composeSegments(
        [{ plot, firstFrame: first, lastFrame: last, durationSec: node.durationSec, videoTier: node.videoTier }],
        (_d, _t, status) => prog(status),
      );
      if (res?.error) throw new Error(res.error);
      if (res?.url && AI_REAL) spendTokens(cost);
      patch({
        status: "done",
        progress: "",
        videoUrl: res?.url,
        // 真实尾帧顶替设定尾帧：节点卡显示的就是视频里实际的结尾，也是下一段的起拍帧
        ...(res?.firstFrame ? { firstFrame: res.firstFrame } : {}),
        ...(res?.lastFrame ? { lastFrame: res.lastFrame } : {}),
        // 圈选要求已经烧进这一版视频，清空以免下次重生成重复叠加
        anns: [],
      });
      set({ busy: false });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patch({ status: "failed", progress: "", error: msg.slice(0, 160) });
      set({ busy: false, err: `第 ${idx + 1} 段生成失败：${msg.slice(0, 120)}` });
      return false;
    }
  },
}));

// DEV 调试/E2E 挂钩
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__flow = useFlow;
}
