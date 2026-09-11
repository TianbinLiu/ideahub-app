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
// ★ 这份 store **只活在内存里**（普通 create，没挂 persist）：退出页面还在，App 重启就没了。
//   哪天要把草稿落盘，人物卡图位一律按**图位 id** 存（不是名字，见 data/schemeSlotIds 文件头），
//   并且放在带版本号的存储键下 —— 老方案的派生 id 会随内置提示词改措辞而变，版本号让那一天能整份作废而不是悄悄对错格。
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
  /** 这张是「只留主体」层抠出来的（道具卡专用）。换卡种时据此取下：抠好的道具主体当不了场景的全景 */
  via?: "subject";
  /**
   * 第 1 格描不出轮廓时选了「保留框内背景」（拍板 4 b）。有它就在格子上挂「带背景」、铸卡键下摆风险句。
   * ★ 挂在 Shot 上而不是页面 state：图被取下（换卡种、重选）时这一位自然跟着走，不会留下一句说错了的提示。
   */
  keptBg?: true;
}

/** 源像素里的一块矩形（与 blockout/arkVideoRules 的 CropRect、utils/image 的 PixelBox 同形；
 *  store 不认组件层，就地写形状） */
type SrcBox = { x: number; y: number; w: number; h: number };

/**
 * 道具卡「只留主体」层（components/PhotoSubjectPicker）正在处理的那张图。
 * ★ 放在 store 里的理由同文件头：描到一半切走再回来，框、轮廓、预览原样还在。
 * ★ 坐标一律是**源像素**（utils/image.loadSubjectSource 把长边压到 4096 之后那张图的坐标）：
 *   同一个 Blob 每次解出同样尺寸，重挂载后照样对得上。
 */
export interface SubjectPick {
  /** 给哪一格选的 */
  kind: CardView["kind"];
  /** 选到的文件，立刻读实成内存里的 Blob（content:// 懒读在切到后台之后可能失效） */
  src: Blob;
  fileName: string;
  /** 允许「保留框内背景」：只有第 1 格（主人拍板 4 b）；第 2 格强制抠（拍板 2-2 b） */
  allowKeepBg: boolean;
  stage: "box" | "cut" | "preview";
  /** 框。null = 图还没解出来（解出来那一拍给居中 70%） */
  rect: SrcBox | null;
  /** 「放大再框」时舞台显示的区域；null = 整图 */
  zoom: SrcBox | null;
  /** 描出来的轮廓 */
  lasso: [number, number][] | null;
  /** 进卡的那一张（已过 prepareCardImage）与要写进 note 的话 */
  preview: { dataUrl: string; note: string; keptBg: boolean } | null;
}

/**
 * 刚拿到一张图、要开「只留主体」层时的起手态 —— 唯一实现（自建卡、卡详情页、模板详情页三处开层都走它）。
 * ★ 起手态是「框选阶段、没框、没放大、没轮廓、没预览」；三处各拼一份的话，哪天多一个字段总有一处漏写。
 */
export function freshSubjectPick(o: { kind: CardView["kind"]; src: Blob; fileName: string; allowKeepBg: boolean }): SubjectPick {
  return { ...o, stage: "box", rect: null, zoom: null, lasso: null, preview: null };
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
  /**
   * 人物卡各图位，按**方案图位 id** 键（不是名字，见 data/schemeSlotIds 文件头）。
   * ★ 刻意不按方案分开存：换方案只是把对不上的先收起来（CustomCardPage.changeScheme），而内置方案之间
   *   同一格共用同一个 id（fullBody / faceCloseup），换过去照片还在原来那格上。
   */
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
  /** 圈选改图开在人物卡哪一格上（图位 id）与那一格当时的图 */
  annot: { slotId: string; frame: string } | null;
  /** 道具卡「只留主体」层开着时那张图（见 SubjectPick） */
  subjectPick: SubjectPick | null;
  /** 出片句（Card.idLine）：出片时整句拼进视频提示词，≤ types.ID_LINE_MAX */
  idLine: string;
  /** 一键识别（场景卡 / 道具卡）正在跑的那一步（空 = 没在跑） */
  recogBusy: string;
  /** 识别的结局那句话：钱扣没扣分三档说（见 CustomCardPage.recognize） */
  recogMsg: { tone: "warn" | "error"; text: string } | null;
  schemePick: boolean;
  /** 场景 / 道具卡「📷 拍摄识别 / 🖼 上传本地图片」两选一弹窗开着没有（拍板 1 a） */
  sourcePick: boolean;
  /** 相机在前台时那一句（空 = 没在拍） */
  captureBusy: string;
  /** 两选一弹窗里要说的话：余额不够 / 相机没起来 / 没接到照片 */
  captureMsg: string;
  /** 拍摄路落格之后要自动识别一次：记着拍之前第 1 格那张图（换成新图才识别；抠图层被取消就作废） */
  recogAfterShot: { before: string } | null;
  importMsg: string;
  realPerson: boolean;
  consentOk: boolean;
  pendingAsset: { assetId: string; note: string } | null;
  authShot: Shot | null;
  unbindNote: string;
  pendingVoice: { dataUrl: string; durationSec: number; note: string } | null;
  /**
   * 正在处理哪一格 / 哪一格出了错。★ 键是两种东西共用一个空间：非人物卡是 CardView 的 kind，人物卡是方案图位 id。
   *   两者永远撞不上，靠的是 schemeSlotIds.isValidSlotId 不许 id 等于 kind 词（changeType 不清 slotErr，撞上就画错格）。
   */
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
    subjectPick: null,
    idLine: "",
    recogBusy: "",
    recogMsg: null,
    schemePick: false,
    sourcePick: false,
    captureBusy: "",
    captureMsg: "",
    recogAfterShot: null,
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
    !!s.aiBody ||
    !!s.subjectPick ||
    !!s.idLine
  );
}

/** 有活在跑（AI 出图 / 铸卡 / 选图处理）—— 这时不许清空 */
export function draftBusy(s: CustomCardDraft): boolean {
  return !!s.aiBusy || s.minting || s.busySlot !== null || s.aiPick !== null || !!s.recogBusy || !!s.captureBusy;
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
