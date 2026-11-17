// 快速模式（快速出片流水线）的**全部**状态 —— 活在 store 里，不活在组件里（2026-11-16）。
//
// ★★ 为什么不在组件 state 里（与 songDraftStore / effectDraftStore 同一个理由）：第①步
//   「想法 → 剧本 + 分镜」是一次**花钱的**对话（一次 chat 定额）；页面一卸载（返回、切路由、
//   切账号）结果就没了，而钱已经花过。放在这里：退回来原样还在。
// ★ 角色**不在这里另存一份**：复用 studio/leadDraftStore 的 castIds（与 B / C / L 同一批人，
//   用户的心智是「先把人定死，下一段还是这几个」）。这一份只装快速模式自己多出来的东西。
// ★ 依赖方向：data → store → 组件。这里只认 data / structuredSkills，不认组件。
import { t } from "@lingui/core/macro";
import { create } from "zustand";
import { runScriptToShots, type ShotPlan } from "./structuredSkills";

/** 五步：想法 → 角色 → 场景 → 预览出片 → 成片（第 4/5 步的样片与定稿在预览那一屏里分两拍）。 */
export type QuickStep = "idea" | "cast" | "scene" | "preview" | "cut";
export const QUICK_STEPS: readonly QuickStep[] = ["idea", "cast", "scene", "preview", "cut"];

export interface QuickDraft {
  step: QuickStep;
  /** 第①步用户写的那段想法（剧本的原料） */
  idea: string;
  /** 拆出来的分镜（null = 还没拆过） */
  plan: ShotPlan | null;
  /** 第③步挑的场景卡（只能一张；null = 不挂场景） */
  placeId: string | null;
  /** 剧本那一发在跑 */
  writing: boolean;
  /** 向导自己的整句拒绝（写剧本 / 铺节点）。flowStore 的 err 另算 */
  err: string;
  /** 向导此刻挂着没有（后台任务的通知按它决定弹不弹） */
  mounted: boolean;
}

export function initialQuickDraft(): QuickDraft {
  return { step: "idea", idea: "", plan: null, placeId: null, writing: false, err: "", mounted: false };
}

export const useQuickDraft = create<QuickDraft>()(() => initialQuickDraft());

export function setQuick(patch: Partial<QuickDraft>): void {
  useQuickDraft.setState(patch);
}

/**
 * 第①步：想法 → 剧本 + 分镜（一次 chat，钱在 runScriptToShots 里扣，失败的话也在那里说）。
 * 写回 store 之前先把 writing 打上 —— 拆一次十几秒，人可能已经退到别的页。
 */
export async function runIdea(tierId: string): Promise<void> {
  const s = useQuickDraft.getState();
  if (s.writing) return;
  const idea = s.idea.trim();
  if (!idea) {
    setQuick({ err: t`先写一段想法：讲谁、讲什么、什么调子` });
    return;
  }
  setQuick({ writing: true, err: "" });
  try {
    const plan = await runScriptToShots(idea, tierId, () => {});
    setQuick({ plan, writing: false });
  } catch (e) {
    setQuick({ writing: false, err: e instanceof Error ? e.message : String(e) });
  }
}

/** 向导走完 / 用户重来：清回第一步（场景卡与想法之外的全清掉） */
export function resetQuick(): void {
  const s = useQuickDraft.getState();
  setQuick({ ...initialQuickDraft(), mounted: s.mounted });
}
