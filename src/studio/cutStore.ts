// 剪辑工程在运行时的那一份：当前工程 + 撤销 / 重做栈。数据形状与改法都在 data/cutProject（纯函数），这里只管"现在是哪一份"。
//
// ★ 为什么单开一个 store、不塞进 CutPage 的 useState：放在页面里，离开剪辑页那一拍就没了（返回键、点通知跳走），
//   回来又是一条没动过的时间轴 —— 与「自己传图做卡片」那页表单搬进 customCardStore 是同一个理由。
// ★ 为什么也不塞进 studioStore.draft：剪辑页那两件长活（按圈选重做、合成）靠「store 里的 draft 还是不是我开工时那一份」
//   认稿子（CutPage 的 own），时间轴每动一下就换一个 draft 对象的话，人只是回来裁了一刀，那两件活就会被判成"稿子换了"。
// ★ 依赖方向：studioStore → 这里（它在换稿子 / 落盘 / 「回去改」时读写这一份）；这里**绝不** import studioStore。
// ★ 生命周期跟着稿子走，照 draftAudioHint 的规矩：**产出新稿子的每一处**都要来这里 load 一次（组稿、单段编辑、
//   个人页「接着剪」），清稿子的那几处不用管（没有稿子时没人读它）。漏了哪一处由 ensure 兜底 ——
//   工程带着源段的指纹，进剪辑页时对不上就按眼前的稿子重开一份。
import { create } from "zustand";
import { onOwnerSwitch } from "../data/deviceOwner";
import { uid } from "../types";
import { freshProject, projectFits, type CutProject } from "../data/cutProject";

/** 撤销栈留多少步。一步一份片段表（几百字节，圈选的标注图是共享引用），60 步够把一条片子从头剪到尾 */
const HISTORY_MAX = 60;

interface CutState {
  project: CutProject | null;
  past: CutProject[];
  future: CutProject[];
  /** 换成另一份工程（「接着剪」还原出来的那份 / 新稿子传 null），撤销栈清空 */
  load: (p: CutProject | null) => void;
  /**
   * 进剪辑页时对一下稿子：现有工程配得上就原样留着，配不上就按稿子重开一份
   * （已经合好的稿子配不上时是 null —— 那是没有留底的老稿，剪辑页只给「去发布」）。
   */
  ensure: (segs: ReadonlyArray<{ title: string; durationSec: number }>, merged: boolean, hasPreset: boolean) => void;
  /**
   * 写回一份改过的工程。
   * · 缺省记一步撤销；`undo: false` 不记（合并留底、重拍落地这类"不是人手改的"）；
   * · `coalesce` 相同的连续几次只记第一步（音量滑杆一拖几十次、拖拽换序一路 dragover）。
   */
  apply: (next: CutProject, opts?: { undo?: boolean; coalesce?: string }) => void;
  undo: () => void;
  redo: () => void;
  /** 一串可合并的改动到此为止（拖拽松手 / 滑杆松手）：下一次同名改动另记一步 */
  seal: () => void;
  /**
   * 撤销栈作废：跨过了一个不该撤回去的点 —— 圈选重拍落地（栈里的快照还带着已经兑现的圈选，撤回去能再收一遍钱）、
   * 量到的长度变了（快照是按旧长度裁的）。合并 / 「回去改」**不用**清：留底不归快照管（见 carryOver）。
   */
  clearHistory: () => void;
}

let lastCoalesce: string | null = null;

/**
 * 撤销 / 重做换回来的那份快照里，**不归撤销管**的两格要保持现状：导出档位（改它不记步）与合并留底。
 * 不这样的话，撤销一步裁剪会顺手把分辨率改回去 —— 而屏幕上没有任何地方说过这一步还管分辨率。
 */
function carryOver(snap: CutProject, cur: CutProject): CutProject {
  const next: CutProject = { ...snap, resId: cur.resId };
  if (cur.merged) next.merged = cur.merged;
  else delete next.merged;
  return next;
}

export const useCut = create<CutState>((set, get) => ({
  project: null,
  past: [],
  future: [],

  load: (p) => {
    lastCoalesce = null;
    set({ project: p, past: [], future: [] });
  },

  ensure: (segs, merged, hasPreset) => {
    const cur = get().project;
    if (cur && projectFits(cur, segs, merged)) return;
    lastCoalesce = null;
    set({ project: merged ? null : freshProject(segs, hasPreset, () => uid("clip")), past: [], future: [] });
  },

  apply: (next, opts) => {
    const cur = get().project;
    if (!cur || next === cur) return;
    if (opts?.undo === false) {
      set({ project: next });
      return;
    }
    const merge = !!opts?.coalesce && opts.coalesce === lastCoalesce;
    lastCoalesce = opts?.coalesce ?? null;
    if (merge) {
      set({ project: next });
      return;
    }
    set((s) => ({ project: next, past: [...s.past, cur].slice(-HISTORY_MAX), future: [] }));
  },

  undo: () => {
    const { project, past, future } = get();
    if (!project || past.length === 0) return;
    lastCoalesce = null;
    const prev = past[past.length - 1];
    set({ project: carryOver(prev, project), past: past.slice(0, -1), future: [...future, project] });
  },

  redo: () => {
    const { project, past, future } = get();
    if (!project || future.length === 0) return;
    lastCoalesce = null;
    const next = future[future.length - 1];
    set({ project: carryOver(next, project), past: [...past, project], future: future.slice(0, -1) });
  },

  seal: () => {
    lastCoalesce = null;
  },

  clearHistory: () => {
    lastCoalesce = null;
    set({ past: [], future: [] });
  },
}));

// 换成另一个账号的那一拍：内存里这份工程是上一个人的（圈选的标注图是他成片里的画面、配乐是他挑的文件），
// 与 studioStore 那边清合成稿是同一条规矩（见 data/deviceOwner 文件头）——各 store 在自己文件里订阅
onOwnerSwitch(() => useCut.getState().load(null));

// DEV 调试/E2E 挂钩（与 __studio / __flow 同款）：自动化脚本要读写与剪辑页同实例的工程
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__cut = useCut;
}
