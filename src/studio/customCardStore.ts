// 「自己传图做卡片」那一页的**全部**表单状态 —— 活在 store 里，不活在组件里。
//
// ★★ 为什么（2026-09-05 主人点名"生成卡片时也能退出当前页面并不会打断生成任务"）：
//   这一页的 AI 出图（portraitViews，分钟级、真花钱）与铸卡上传（几张图串行传，弱网几十秒）
//   此前全是组件内 useState + 闭包里的 async。Promise 本身不会因为页面卸载而停，
//   但它跑完之后 `setState` 打在一个已经不存在的组件上 —— 花了钱画出来的图**静默丢掉**，
//   用户回来看到的是一张空白表单。把状态挪进 store 之后：任务照旧在 Promise 里跑，
//   结果写进 store；人不在页上时由全局胶囊（GenerationPill ← data/jobs）通知，
//   人回来时页面从 store 原样画出来（连"第几步"都在）。
// ★ `useDraftField(key)` 长得和 useState 一样（值 + setter，支持函数式更新），页面里
//   只是把 `useState(...)` 换成它，逻辑一行不动 —— 三十几个字段逐个写 setter 只会
//   把 store 变成一面复读机。
// ★ `mounted` 给结局分叉用：页在 → 直接画在页上（跳转/就地显示）；页不在 → 走胶囊通知。
//   `resetCardDraft` 不动它（铸成跳走前要 reset，而那一刻页还在）。
// ★ 依赖方向：data → store → 组件。这里只认 types 与 data/promptSchemes。
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { create } from "zustand";
import { defaultScheme } from "../data/promptSchemes";
import type { CardType, CardView } from "../types";

/** 一个图位上已经准备好的那张图 */
export interface Shot {
  /** 已按 prepareCardImage 处理过（比例裁 + 尺寸压制）的 dataURL */
  dataUrl: string;
  /** 我们动过这张图就有值，必须显示出来 */
  note?: string;
  /** 原文件名，只为让用户认得出自己传的是哪张 */
  fileName: string;
}

export type CardStep = "type" | "real" | "source" | "form" | "info" | "final";

export interface CustomCardDraft {
  type: CardType;
  /** 非人物卡的图位（按 kind 键） */
  shots: Partial<Record<CardView["kind"], Shot>>;
  name: string;
  summary: string;
  info: string;
  tagText: string;
  schemeId: string;
  schemeOpen: boolean;
  /** 人物卡各图位（按方案的 tag 键） */
  schemeShots: Record<string, Shot>;
  step: CardStep;
  lane: "upload" | "ai" | null;
  aiBody: Shot | null;
  aiFace: Shot | null;
  aiSubject: string;
  /** AI 车道正在跑的那一步（空 = 没在跑） */
  aiBusy: string;
  /** AI 车道素材口正在读哪张图（解码 + 裁切要一两秒，得让人看见） */
  aiPick: "body" | "face" | null;
  annot: { tag: string; frame: string } | null;
  schemePick: boolean;
  importMsg: string;
  realPerson: boolean;
  consentOk: boolean;
  pendingAsset: { assetId: string; note: string } | null;
  authShot: Shot | null;
  unbindNote: string;
  pendingVoice: { dataUrl: string; durationSec: number; note: string } | null;
  busySlot: string | null;
  slotErr: { key: string; msg: string } | null;
  err: string;
  dropped: string;
  minting: boolean;
  partial: { id: string; kind: "unsynced" | "views" | "asset"; lost: string[]; reason?: string } | null;
  /** 页面此刻挂着没有（见文件头 ★） */
  mounted: boolean;
}

export function initialDraft(): CustomCardDraft {
  return {
    type: "character",
    shots: {},
    name: "",
    summary: "",
    info: "",
    tagText: "",
    schemeId: defaultScheme().id,
    schemeOpen: false,
    schemeShots: {},
    step: "type",
    lane: null,
    aiBody: null,
    aiFace: null,
    aiSubject: "",
    aiBusy: "",
    aiPick: null,
    annot: null,
    schemePick: false,
    importMsg: "",
    realPerson: false,
    consentOk: false,
    pendingAsset: null,
    authShot: null,
    unbindNote: "",
    pendingVoice: null,
    busySlot: null,
    slotErr: null,
    err: "",
    dropped: "",
    minting: false,
    partial: null,
    mounted: false,
  };
}

export const useCardDraft = create<CustomCardDraft>()(() => initialDraft());

/** 清空重来（铸成跳走、或用户点「重新开始」）。`mounted` 原样保留 */
export function resetCardDraft(): void {
  useCardDraft.setState({ ...initialDraft(), mounted: useCardDraft.getState().mounted }, true);
}

/** 这一页有没有做到一半的东西（顶栏「重新开始」只在这时候摆） */
export function draftDirty(s: CustomCardDraft): boolean {
  return (
    s.step !== "type" ||
    !!s.name ||
    !!s.summary ||
    Object.keys(s.shots).length > 0 ||
    Object.keys(s.schemeShots).length > 0 ||
    !!s.aiBody
  );
}

/** 有活在跑（AI 出图 / 铸卡 / 选图处理）—— 这时不许清空 */
export function draftBusy(s: CustomCardDraft): boolean {
  return !!s.aiBusy || s.minting || s.busySlot !== null || s.aiPick !== null;
}

/**
 * 像 useState 一样用的 store 字段：`const [step, setStep] = useDraftField("step")`。
 * setter 支持函数式更新；身份随 key 稳定，可以放进依赖数组。
 */
export function useDraftField<K extends keyof CustomCardDraft>(
  key: K,
): [CustomCardDraft[K], Dispatch<SetStateAction<CustomCardDraft[K]>>] {
  const value = useCardDraft((s) => s[key]);
  const set = useCallback<Dispatch<SetStateAction<CustomCardDraft[K]>>>(
    (v) => {
      useCardDraft.setState(
        (s) =>
          ({
            [key]: typeof v === "function" ? (v as (prev: CustomCardDraft[K]) => CustomCardDraft[K])(s[key]) : v,
          }) as Partial<CustomCardDraft>,
      );
    },
    [key],
  );
  return [value, set];
}
