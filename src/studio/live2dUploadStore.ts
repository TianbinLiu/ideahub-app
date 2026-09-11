// Live2D 上传向导（/support/models/new）的**全部**状态 —— 活在 store 里，不活在组件里。
// 设计正本 docs/digital-human-creator-center.md §3.5（六步）。
//
// ★★ 为什么（CLAUDE.md「长活登记进 data/jobs」那条）：这一页有两件分钟级的活 —— 25MB 模型包上传、
//   服务端解包 inspect。Promise 本来就不随页面卸载而停，断的是**人**（退出去之后没有一个字说它还在跑），
//   以及**结果写进已卸载的组件**（setState 静默落空 = 传了 25MB 却什么都没发生）。
//   所以：状态全在这里，结局由 `data/jobs` 的全局胶囊通知，人回到这一页时从 store 原样画出来（连"第几步"都在）。
// ★ 形状照 `studio/customCardStore`：`useUploadField(key)` 像 useState 一样用、`mounted` 给结局分叉、
//   `resetLive2dDraft` / `live2dDraftDirty` / `live2dDraftBusy` 三件套。
// ★ 请求函数不许以 `use` 开头（scripts/check-hook-order.mjs 按这个记号抓 hook）——
//   所以这里叫 `startBundleInspect` / `submitLive2dModel`，不叫 `useInspect`。
//
// ────────────────────────────────────────────────────────────────────────
// ★★ blob 地址与「退出再进来还在」怎么共存（本文件最需要想清楚的一件事）
//
//   File 对象、解好的 JSZip、预览用的 blob 地址都挂在 store 上 —— 人从向导退出去看一眼形象市场再回来，
//   不用重选文件、不用重解包（一个 25MB 的包解一次要好几秒）。
//   但 blob 地址是**进程级**的资源，留着不撤就是几十 MB 的常驻内存。
//   两者的取舍：**按"这份草稿还在不在"撤，不按"组件挂没挂着"撤。**
//     · 组件 unmount **不** revoke（那正是"退出再进来还在"要保住的东西，而且 StrictMode 下
//       effect 会 mount→unmount→mount，unmount 撤等于一进页面就把自己的预览撤掉）；
//     · 我们**自己**撤的时机只有三个，都是"这份草稿不要了"：换文件（`pickBundle` 开头）、
//       `resetLive2dDraft()`（发布成功 / 用户点重新开始）、以及**换 entry 重建预览**时撤掉上一份。
//   代价说清楚：用户既不发布也不重开、就那样退出 App —— 那份 blob 活到进程结束。
//   这是有意的：它换来的是"钱和时间已经花在上传上的那份草稿不会因为切了个页面就没了"。
//
//   ⚠⚠ 但**撤 blob 的不只有我们**（2026-09-07 读运行时逐字核出来的，此前这段注释断言的事实与运行时相反）：
//   pixi-live2d-display 的 ZipLoader factory 里写死了
//     `s.startsWith("blob:") && t.live2dModel.once("modelLoaded", m => m.once("destroy", () => URL.revokeObjectURL(s)))`
//   —— `s` 正是我们 `zip://` 后面那半。而 `CompanionModel.acquire()` 换 url 时**就是**调 `singleton.destroy()`。
//   路径：向导停在第 ②～⑥ 步 → 去客服页看一眼（SupportStage 按用户自己的设置 acquire 另一个 url）
//   → 我们那个 objectURL 被运行时撤掉 → 回到向导，`previewUrl` 还是那个**已经死掉的地址**。
//   ⇒ 所以 `markPreviewLoaded(false)` **先自愈一次**（`reloadPreview()` 从 `check.file` 现造一个新地址，
//     不用重解包），只有再失败一次才判"这个包画不出来"。不这么做的话，屏幕上那句
//     「这个包在手机上画不出来」是对一个其实完好的包的诬告，而第 ④/⑤ 步还会对着**官方看板娘**下结论。
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { create } from "zustand";
import type { MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { currentRoute, startJob } from "../data/jobs";
import { companionBus } from "../companion/bus";
import { setPreviewMapping, type CompanionMapping } from "../live2d/mapping";
import type { BundleCheck, BundlePreview } from "../live2d/bundlePreview";
import { createBundlePreview, readLive2dBundle } from "../live2d/bundlePreview";
import { ApiError } from "../api/client";
import { MAX_IMAGE_BYTES, MAX_LIVE2D_BUNDLE_BYTES, uploadImage, uploadLive2dBundle } from "../api/uploads";
import {
  companionErrorText,
  createLive2dModel,
  inspectLive2dBundle,
  type CompanionMappingWire,
  type Live2dInspectResult,
  type Live2dModelItem,
  type VoiceSettings,
} from "../api/companion";

/** 向导六步（设计文档 §3.5）+ 成功页 */
export type Live2dStep = "pick" | "preview" | "inspect" | "mapping" | "verify" | "publish" | "done";
export const LIVE2D_STEPS: Live2dStep[] = ["pick", "preview", "inspect", "mapping", "verify", "publish"];
/** 步骤名是描述符（模块顶层不翻），页面画步骤条时再 t() */
export const LIVE2D_STEP_LABEL: Record<Live2dStep, MessageDescriptor> = {
  pick: msg({ message: "选文件", context: "Live2D 上传向导的步骤名：选一个 zip 模型包" }),
  preview: msg`本地预览`,
  inspect: msg`自动识别`,
  mapping: msg`对映射`,
  verify: msg`试跑`,
  publish: msg`发布`,
  done: msg`完成`,
};

/** 预览到底画出来没有。★ 四档分开（坑表「把 N 种结局压成两档」）：没开始 / 在加载 / 画出来了 / 画不出来 */
export type PreviewState = "idle" | "loading" | "ok" | "failed";

export interface Live2dUploadDraft {
  step: Live2dStep;
  /** 页面此刻挂着没有（结局分叉：在 → 页面自己画；不在 → 走胶囊通知） */
  mounted: boolean;

  // ── ① 选文件 ──
  file: File | null;
  check: BundleCheck | null;
  /** 选中的入口（包里可能有多个 model3.json） */
  entry: string;
  /** zip 根本打不开这一类（与 check.issues 分开：那是"包不合格"，这是"读不了"） */
  readErr: string;

  // ── ② 本地预览 ──
  preview: BundlePreview | null;
  /** 交给 SupportStage 的地址（zip://blob:…）；空 = 还没建 */
  previewUrl: string;
  previewState: PreviewState;
  /** 画不出来时的整句原因（来自 SupportStage 的 onFallback 或加载异常） */
  previewErr: string;
  /**
   * 这一份预览已经自愈重建过一次了（见文件头 ⚠⚠）。★ 必须记在状态里而不是一个模块级布尔：
   * 它要跟着"这一份预览"作废 —— 换文件 / 换 entry / 手动重载都从头再来一次机会。
   */
  previewHealed: boolean;

  // ── ③ 自动识别 ──
  /** 直传拿到的 public_id；空 = 这次走的是 multipart 退路 */
  bundleRef: string;
  /** 这一台服务器有没有直传（false = `/bundle/sign` 回了 404，走的是慢的那条） */
  directOn: boolean;
  inspect: Live2dInspectResult | null;
  inspectErr: string;

  // ── ④ 对映射 ──
  /** 渲染用的那份（不可变值）；交给运行时的是同一内容的另一个对象，见文件尾 publishPreviewMapping 的 ★★ */
  mapping: CompanionMappingWire | null;
  /** 用户动过映射没有：没动就**不发** mapping 字段，让服务端用它自己的自动映射（一处实现在服务端） */
  mappingTouched: boolean;

  // ── ⑤ 试跑 ──
  /** 已经跑过的项（键见页面里的 VERIFY_STEPS）；退出再进来还在 */
  verifyDone: string[];
  /** 正在跑第几项的整句；空 = 没在跑 */
  verifyNow: string;
  /** 用户点过「没问题，继续」 */
  verifyOk: boolean;

  // ── ⑥ 发布信息 ──
  name: string;
  desc: string;
  tags: string[];
  shared: boolean;
  /** 授权勾选（§2 的三条声明）。★ 不勾就不让点发布 —— 这是它目前唯一的闸 */
  selfMade: boolean;
  /**
   * 作者推荐的人格 / 嗓子（设计正本 §3.5 第 6 步「推荐人格/声音（可空）」），都可以空。
   * ★ 推荐≠强制：合并顺序是 **用户自选 > 人格推荐 > 模型推荐 > 服务端默认**（COMPANION.md），
   *   装了这个形象的人只要自己选过人格/声音，这两项就用不上 —— 界面上要照这个说，别说成"装上就会变成这样"。
   * ★ 只能推荐**公开**的：服务端 `resolvePersonaBinding` 对私有人格直接 403，而且就算存下了，
   *   别人装了模型也读不到那份私有人格（静默退回默认）。
   */
  recPersonaId: string;
  /** 推荐嗓子：直接存声音市场模板那份拼好的快照（`VoiceTemplate.voice`，templateId 就在里面） */
  recVoice: VoiceSettings | null;
  coverUrl: string;
  /** 封面那一格自己的忙 / 错（与整页的 busy 分开：截图失败不该把发布键也锁住） */
  coverBusy: string;
  coverErr: string;
  publishErr: string;
  created: Live2dModelItem | null;

  // ── 全局 ──
  /** 有活在跑：'read' 解包 / 'preview' 建预览 / 'upload' 传包 / 'inspect' 服务端解析 / 'publish' 发布 */
  busy: "" | "read" | "preview" | "upload" | "inspect" | "publish";
  /** 当前这一步的整句进度（与胶囊上那句同源） */
  progress: string;
}

export function initialLive2dDraft(): Live2dUploadDraft {
  return {
    step: "pick",
    mounted: false,
    file: null,
    check: null,
    entry: "",
    readErr: "",
    preview: null,
    previewUrl: "",
    previewState: "idle",
    previewErr: "",
    previewHealed: false,
    bundleRef: "",
    directOn: false,
    inspect: null,
    inspectErr: "",
    mapping: null,
    mappingTouched: false,
    verifyDone: [],
    verifyNow: "",
    verifyOk: false,
    name: "",
    desc: "",
    tags: [],
    shared: true,
    selfMade: false,
    recPersonaId: "",
    recVoice: null,
    coverUrl: "",
    coverBusy: "",
    coverErr: "",
    publishErr: "",
    created: null,
    busy: "",
    progress: "",
  };
}

export const useLive2dUpload = create<Live2dUploadDraft>()(() => initialLive2dDraft());

const get = () => useLive2dUpload.getState();
const set = (patch: Partial<Live2dUploadDraft>) => useLive2dUpload.setState(patch);

/**
 * 像 useState 一样用的 store 字段：`const [name, setName] = useUploadField("name")`。
 * setter 支持函数式更新；身份随 key 稳定，可以放进依赖数组。
 */
export function useUploadField<K extends keyof Live2dUploadDraft>(
  key: K,
): [Live2dUploadDraft[K], Dispatch<SetStateAction<Live2dUploadDraft[K]>>] {
  const value = useLive2dUpload((s) => s[key]);
  const setter = useCallback<Dispatch<SetStateAction<Live2dUploadDraft[K]>>>(
    (v) => {
      useLive2dUpload.setState(
        (s) =>
          ({
            [key]: typeof v === "function" ? (v as (prev: Live2dUploadDraft[K]) => Live2dUploadDraft[K])(s[key]) : v,
          }) as Partial<Live2dUploadDraft>,
      );
    },
    [key],
  );
  return [value, setter];
}

/** 这一页有没有做到一半的东西（顶栏「重新开始」只在这时候摆） */
export function live2dDraftDirty(s: Live2dUploadDraft): boolean {
  return !!s.file || s.step !== "pick" || !!s.name || !!s.readErr;
}

/** 有活在跑 —— 这时不许清空、不许换文件 */
export function live2dDraftBusy(s: Live2dUploadDraft): boolean {
  return s.busy !== "";
}

/** 清空重来。★ 与 customCardStore 一样：`mounted` 原样保留（重开时页还在） */
export function resetLive2dDraft(): void {
  dropPreview();
  useLive2dUpload.setState({ ...initialLive2dDraft(), mounted: get().mounted }, true);
}

// ── 预览映射：交给运行时的那一份 ──────────────────────────────────────────

/**
 * ★★ 为什么要**另留一个对象**、还要原地改它（2026-09-07 读 `live2d/companionModel.ts` 得出的结论）：
 *   `CompanionModel` 在构造时把 `loadCompanionMapping()` 的返回值存进 `this.mapping`，之后每次演出
 *   （`motionGroupFor` / `setFace` / `mapHitAreas`）都是**现读**这个对象的字段。
 *   ⇒ 只要交给 `setPreviewMapping` 的对象**身份不变**，用户在第 ④ 步改的动作 / 表情 / 触摸区就立刻生效，
 *     不必为每一次下拉框改动重新加载一遍模型（一次重载要重解 25MB 的包、重传贴图，手机上几百毫秒起）。
 *   ⇒ 但渲染要的是"变了就重画"，所以 store 里那份 `mapping` 仍是**每次都换新对象**的不可变值。
 *     两份内容始终相同，只是身份策略相反 —— 这就是这个函数存在的全部理由。
 * ⚠ 唯一不吃这一套的是 `params`：`resolveParamIds` 只在模型构造时算一次。改了参数槽要
 *   `preview.reload()` 换个地址重来（页面上那颗「重新加载预览」就是干这个的）。
 */
let liveMapping: CompanionMapping | null = null;
let liveMappingUrl = "";

/** 空映射：所有槽位都没对上。★ 见 publishPreviewMapping 的第二个 ★★ —— **必须登记一份**，不能登记 null */
function blankMapping(): CompanionMapping {
  return { version: 1, idle: null, start: null, actions: {}, faces: {}, touch: {}, params: {} };
}

/**
 * ★★ 第二件事：`next` 是 null（服务端还没识别、或用户点了「恢复自动」而当时还没有自动映射）时，
 *   登记的是**一份空映射**而不是 null。为什么不能登记 null：`CompanionModel` 只在构造时取一次映射，
 *   登记 null 的话它把 `this.mapping` 存成 null —— 之后再怎么 `Object.assign` 也没有对象可改，
 *   于是「识别完回到第 ④ 步改映射，预览一点反应都没有」，而且**零报错**（正是这条登记表要治的那个病）。
 *   代价：第 ② 步（还没识别）的预览按"所有槽位都没对上"演，动作 / 触摸暂时不响应 —— 那一步本来也只验"画不画得出来"。
 */
export function publishPreviewMapping(url: string, next: CompanionMappingWire | null): void {
  if (liveMappingUrl && liveMappingUrl !== url) setPreviewMapping(liveMappingUrl, null);
  liveMappingUrl = url;
  if (!url) {
    liveMapping = null;
    return;
  }
  const value = next ?? blankMapping();
  if (liveMapping) Object.assign(liveMapping, value);
  else liveMapping = { ...value };
  setPreviewMapping(url, liveMapping);
}

/**
 * 台上现在挂着的，**是不是我们这个包**。全页共用这一处判据（试播 ▶ / 试跑 / 截封面都问它）。
 *
 * ★★ 为什么需要（SupportModelNewPage 文件头那条纪律的执行处）：SupportStage 加载失败会**退回官方看板娘**，
 *   屏幕上照样有个人在动 —— 不判的话，试播会对着小梦说「这个包里没有它」、试跑会在小梦身上打满 ✓、
 *   截封面会把小梦发布成这个模型的封面，三句都是假话，而且全程零报错。
 * ★ 判 `modelUrl` 不判 `previewState`：previewState 是"我们以为的"，modelUrl 是运行时的事实
 *   （blob 地址被运行时撤掉那一路正是"以为是 ok、其实台上已经换人"，见文件头 ⚠⚠）。
 */
export function previewOnStage(): boolean {
  const url = get().previewUrl;
  return !!url && companionBus.model?.modelUrl === url;
}

/**
 * 在预览里试播**某一个动作组**（第 ④ 步那两行左边的 ▶）。
 *
 * ★ 2026-09-07 起直接走运行时的公开入口 `companionBus.motionGroup`。此前这里是"借 `playful` 这个语义槽
 *   临时指过去、播一下、下一个微任务还原" —— 那种写法要原地改**正在生效的**映射对象，还原一旦没跑到
 *   （异常 / 两次点击撞上），用户表里那一格就被悄悄换成了别的组，然后原样发布出去，零报错。
 * @returns false = 播不了（组不在包里，**或者台上不是我们的模型**）。调用方就地红字说出来，别静默
 */
export function previewMotionGroup(group: string): boolean {
  if (!group) return false;
  if (!previewOnStage()) return false;
  return companionBus.motionGroup(group);
}

/** 撤掉当前预览：登记表、blob 地址一起清（见文件头那段取舍） */
function dropPreview(): void {
  const s = get();
  if (liveMappingUrl) {
    setPreviewMapping(liveMappingUrl, null);
    liveMappingUrl = "";
    liveMapping = null;
  }
  s.preview?.revoke();
}

// ── ① 选文件 ─────────────────────────────────────────────────────────

/**
 * 选了一个 zip：撤掉上一份预览 → 本地解包核对 → 合格就顺手把预览地址建好（第 ② 步一进去就有画面）。
 * ★ 不抛：所有失败都写进 `readErr` / `check.issues`，页面原样红字显示（铁律八「失败要响且局部」）。
 */
export async function pickBundle(file: File): Promise<void> {
  if (live2dDraftBusy(get())) return;
  dropPreview();
  set({
    ...initialLive2dDraft(),
    mounted: get().mounted,
    file,
    busy: "read",
    progress: t`正在解开压缩包…`,
    step: "pick",
  });
  let check: BundleCheck;
  try {
    check = await readLive2dBundle(file, MAX_LIVE2D_BUNDLE_BYTES);
  } catch (e) {
    set({ busy: "", progress: "", readErr: e instanceof Error ? e.message : t`这个文件读不了。` });
    return;
  }
  const entry = check.entries[0] || "";
  set({ check, entry, busy: "", progress: "" });
  if (check.issues.length || !entry) return; // 不合格：停在第 ① 步，页面把 issues 逐条红字列出来
  await buildPreview(entry);
}

// ── ② 本地预览 ────────────────────────────────────────────────────────

/** 建（或换）预览地址。换 entry、或用户点「重新加载预览」都走它 */
export async function buildPreview(entry: string): Promise<void> {
  const s = get();
  if (!s.check) return;
  // ★ 换了入口 = 换了一个模型：上一份 inspect / 映射 / 试跑记录全部作废。
  //   不清的话「包里有两个 model3.json，用户挑了另一个」会带着**上一个入口的映射**一路走到发布 ——
  //   服务端按新入口校验，映射里那些动作组它根本没有 ⇒ 400；运气不好都对得上的话就是静默发错。
  const switched = !!s.entry && s.entry !== entry;
  const wipe = switched
    ? { inspect: null, inspectErr: "", mapping: null, mappingTouched: false, verifyDone: [], verifyNow: "", verifyOk: false }
    : {};
  const detail = s.check.detail.get(entry);
  if (detail?.issues.length) {
    // 这个入口本地就不合格：别去加载它，直接把原因摆出来（加载失败的报错远不如这几句具体）
    set({ ...wipe, entry, preview: null, previewUrl: "", previewHealed: false, previewState: "failed", previewErr: detail.issues[0], step: "preview" });
    return;
  }
  set({ ...wipe, busy: "preview", progress: t`正在准备预览…`, entry, previewState: "loading", previewErr: "", previewHealed: false, step: "preview" });
  try {
    dropPreview();
    const preview = await createBundlePreview(s.check, entry);
    // 服务端还没看过这个包时 `mapping` 是 null —— 登记的会是一份**空映射**（见 publishPreviewMapping 的第二个 ★★），
    // 也就是这一步的预览只验"画不画得出来"，动作 / 表情 / 触摸暂时都不响应。这是刻意的取舍，别改成登记 null。
    publishPreviewMapping(preview.modelUrl, get().mapping);
    set({ preview, previewUrl: preview.modelUrl, busy: "", progress: "" });
  } catch (e) {
    // ★ `preview` / `previewUrl` 一并清掉：try 的第一行已经 `dropPreview()` 撤过上一份 blob 地址了。
    //   不清的话舞台仍按 `!!s.previewUrl` 挂着、去加载一个**已经被撤销的地址**，而那颗
    //   「重新加载预览」（`disabled={!s.preview}`）也仍然亮着 —— 它调的 `preview.reload()` 闭包里
    //   锁着的是**上一个 entry**，于是"换了入口 → 建预览失败 → 点重新加载"画出来的是用户没选的那个模型，零报错。
    set({
      preview: null,
      previewUrl: "",
      previewHealed: false,
      busy: "",
      progress: "",
      previewState: "failed",
      previewErr: e instanceof Error ? e.message : t`预览准备失败。`,
    });
  }
}

/** 换个新地址重加载。`healed` = 这一次是自愈用掉的那一次机会（见 markPreviewLoaded 的 ★★） */
function rebuildPreviewUrl(healed: boolean): void {
  const s = get();
  if (!s.preview) return;
  const url = s.preview.reload();
  publishPreviewMapping(url, s.mapping);
  set({ previewUrl: url, previewState: "loading", previewErr: "", previewHealed: healed });
}

/** 换个新地址把模型重加载一遍（改了参数槽之后要，见 publishPreviewMapping 的 ⚠） */
export function reloadPreview(): void {
  // 用户手动点的：重新给一次自愈机会（`previewHealed` 跟着"这一份预览"作废，见状态字段那条 ★）
  rebuildPreviewUrl(false);
}

/**
 * 舞台报回来的结局：画出来了 / 退回官方形象了（SupportStage 的 onFallback）。
 *
 * ★★ 失败**先自愈一次**再判死（见文件头 ⚠⚠）：运行时会在模型 destroy 时把我们那个 objectURL 撤掉，
 *   于是"去客服页看一眼再回来"必然拿到一个死地址 —— 那不是包坏了。`reloadPreview()` 从 `check.file`
 *   现造一个新地址（不重解包，几十毫秒），只有**再失败一次**才把红字留下。
 */
export function markPreviewLoaded(ok: boolean, reason = ""): void {
  if (ok) {
    set({ previewState: "ok", previewErr: "" });
    return;
  }
  const s = get();
  if (!s.previewHealed && s.preview) {
    rebuildPreviewUrl(true);
    return;
  }
  set({ previewState: "failed", previewErr: reason || t`这个包在手机上画不出来。` });
}

// ── ③ 自动识别（上传 + inspect） ──────────────────────────────────────

/**
 * 把包交给服务端解析：先试签名直传（有真进度、不过 Cloudflare），拿不到票就退回 multipart。
 * 两条路的分别对用户是**要说清楚**的：multipart 那条字节要经过我们的服务器，>15MB 会撞上
 * Cloudflare 那道 125 秒读超时（CLAUDE.md 坑表「上传大视频失败」）——所以进度文案里明说，
 * 不许写成「正在上传」了事。
 *
 * ★ **离开这一页不取消**（CLAUDE.md「长活登记」那条的本意）：Promise 照跑、结果写进 store、
 *   人不在页上时由胶囊通知。取消只有一条路 —— 用户自己点那颗「取消上传」（`cancelBundleInspect`），
 *   所以 AbortController 存在模块级而不是组件的 ref 里（ref 随卸载一起没了，那颗按钮就再也够不着它）。
 */
let inspectAbort: AbortController | null = null;

/** 用户主动取消上传（只有这一条路会中断，见 startBundleInspect 的 ★） */
export function cancelBundleInspect(): void {
  inspectAbort?.abort();
}

export async function startBundleInspect(): Promise<void> {
  const s = get();
  if (!s.file || !s.entry || live2dDraftBusy(s)) return;
  const file = s.file;
  const entry = s.entry;
  const mb = (file.size / 1024 / 1024).toFixed(1);
  const uploadPct = (n: number) => t`正在上传模型包 ${n}%`;
  const controller = new AbortController();
  inspectAbort = controller;
  const job = startJob({ kind: "live2d-inspect", title: t`识别模型包`, page: currentRoute(), progress: t`准备上传…` });
  const step = (text: string) => {
    set({ progress: text });
    job.update(text);
  };
  set({ busy: "upload", inspectErr: "", step: "inspect" });
  try {
    // ★★ 已经传上去过就**别再传一遍**（2026-09-07 补）：识别这一步很容易失败一次（限流 10 次/分钟、
    //   服务端解包报错、网抖），而此前每点一次「开始识别」都从空串起步 —— 同一份 25MB 重推一遍，
    //   再烧掉一格 `/bundle/sign` 的日额度（5 次/分钟 + 20 次/天），上一次那份直传资产还成了孤儿
    //   （服务端的 inspect **刻意不回收** bundleRef，见 live2dModel.controller 的 ★）。
    //   复用是安全的：`pickBundle` 换文件时整份草稿归零（bundleRef 一起清），所以 store 里那个
    //   bundleRef 一定属于**当前这个 file**；`entry` 只是 inspect 的入参，不影响传上去的那份 zip。
    let bundleRef = s.bundleRef;
    let directOn = s.directOn;
    if (bundleRef) {
      step(t`这份包上次已经传上去了，直接让服务器再看一遍…`);
    } else {
      step(uploadPct(0));
      const direct = await uploadLive2dBundle(
        file,
        (frac) => step(uploadPct(Math.round(frac * 100))),
        controller.signal,
      );
      if (direct) {
        bundleRef = direct.bundleRef;
        directOn = true;
      } else {
        // ★ null = 这台服务器还没有 `/bundle/sign`（ideahub-server#60 未合并），或者它没配 Cloudinary（503）。
        //   退回 multipart 直传，并把"现在走的是慢的那条"说出来 —— 不说的话大包超时的人只会以为是自己网不好
        step(t`这台服务器还没开直传，改走慢的那条（约 ${mb}MB，超过 15MB 可能会超时）…`);
      }
    }
    set({ bundleRef, directOn, busy: "inspect" });
    // ★ 两条路这一步做的事完全不同，别用同一句话糊过去：直传那条只是让服务器去 Cloudinary 取包（秒级），
    //   multipart 那条是**现在才开始把 25MB 推上去**（分钟级）—— 说成"正在解包识别"的话，
    //   用户会以为卡住了，然后退出去重来（又是一次几分钟）。
    step(directOn ? t`服务器正在解包识别…` : t`正在上传并识别（约 ${mb}MB，走的是慢的那条）…`);
    // ★ signal 也要给这一步：multipart 那条路**整个 25MB 是在这里才推上去的**（上面那段只是发现没直传票），
    //   不给的话「取消上传」在最需要它的那条路上按了没反应（fetch 照跑到 180 秒超时）。
    const result = await inspectLive2dBundle(bundleRef ? { bundleRef, entry } : { file, entry }, controller.signal);
    // ★ 服务端可能按别的入口读（我们传了 entry，正常会一致）；以它回的那个为准，别两边各记一份
    const mapping = result.mapping ?? null;
    set({
      inspect: result,
      entry: result.entry || entry,
      mapping,
      mappingTouched: false,
      busy: "",
      progress: "",
      step: "inspect",
    });
    publishPreviewMapping(get().previewUrl, mapping);
    // ★★ 必须把预览重加载一遍：`resolveParamIds` 只在模型构造时算一次，而这份映射里的**参数 id**
    //   （旧式 PARAM_ANGLE_X 之类）正是这一步才知道。不重载的话预览一直按标准参数名读写 ——
    //   模型转头 / 眨眼 / 口型全部静默失效，第 ⑤ 步试跑会把一个其实没问题的包判成坏的。
    //   （动作 / 表情 / 触摸的改动不用重载，那三样是现读的，见 publishPreviewMapping 的 ★★。）
    reloadPreview();
    if (get().mounted) job.done({ silent: true });
    else job.done({ msg: t`模型包识别好了，回去接着填。`, route: "/support/models/new" });
  } catch (e) {
    // ★ 「用户自己点了取消」不是失败：说成失败会让人以为传坏了、再传一次（又是几分钟）
    const aborted = e instanceof DOMException && e.name === "AbortError";
    const text = aborted ? t`已取消上传。要发布的话重新点一次「开始识别」。` : companionErrorText(e, t`识别失败了，再试一次。`);
    set({ busy: "", progress: "", inspectErr: text });
    if (get().mounted || aborted) job.done({ silent: true });
    else job.fail(t`模型包识别失败：${text}`, "/support/models/new");
  } finally {
    if (inspectAbort === controller) inspectAbort = null;
  }
}

// ── ④ 对映射 ─────────────────────────────────────────────────────────

/** 改一条映射：store 那份换新对象（重渲染），交给运行时的那份原地改（预览立刻生效） */
export function patchMapping(next: CompanionMappingWire): void {
  set({ mapping: next, mappingTouched: true });
  publishPreviewMapping(get().previewUrl, next);
}

/** 退回服务端的自动映射（第 ④ 步那颗「恢复自动」） */
export function resetMapping(): void {
  const auto = get().inspect?.mapping ?? null;
  set({ mapping: auto, mappingTouched: false });
  publishPreviewMapping(get().previewUrl, auto);
}

// ── ⑤ 试跑 ──────────────────────────────────────────────────────────

export function markVerified(key: string): void {
  const done = get().verifyDone;
  if (done.includes(key)) return;
  set({ verifyDone: [...done, key] });
}

// ── ⑥ 发布 ──────────────────────────────────────────────────────────

/** 封面：自己选一张图传上去（自动截图那条在页面里，截不到时退到这条） */
export async function uploadCover(blob: Blob, filename: string): Promise<void> {
  // ★ 本地先判一次（同仓 cardViews / publishAssets 两处调用方早就这么写了）：一张 10MB 的手机原图
  //   白传 60 秒才被服务端拒，而这个数（`MAX_IMAGE_BYTES`）与服务端 middleware/upload.js 是镜像的。
  if (blob.size > MAX_IMAGE_BYTES) {
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    const cap = Math.round(MAX_IMAGE_BYTES / 1024 / 1024);
    set({ coverBusy: "", coverErr: t`这张图太大了（${mb}MB，上限 ${cap}MB），换一张小一点的。` });
    return;
  }
  set({ coverBusy: t`正在上传封面…`, coverErr: "" });
  try {
    const url = await uploadImage(blob, filename);
    set({ coverUrl: url, coverBusy: "" });
  } catch (e) {
    set({ coverBusy: "", coverErr: companionErrorText(e, t`封面没传上去，换一张再试。`) });
  }
}

/**
 * 发布（第 ⑥ 步）。走 `bundleRef`（直传过）或 `file`（multipart 退路），两条都由 `createLive2dModel` 统一处理。
 * ★ `selfMade` 必填且必须为真：授权勾选是本地这一道闸（服务端只记 `license`，不替我们拦）。
 * ★ 映射用户没动过就**不发** —— 让服务端用它自己的自动映射（一处实现在服务端，我们别把一份快照钉死）。
 */
export async function submitLive2dModel(): Promise<void> {
  const s = get();
  if (live2dDraftBusy(s)) return;
  if (!s.file) {
    set({ publishErr: t`文件不在了，请重新选一次模型包。` });
    return;
  }
  if (!s.name.trim()) {
    set({ publishErr: t`先给它起个名字。` });
    return;
  }
  if (!s.selfMade) {
    set({ publishErr: t`请先勾上授权声明再发布。` });
    return;
  }
  const job = startJob({ kind: "live2d-publish", title: t`发布模型`, page: currentRoute(), progress: t`正在发布…` });
  set({ busy: "publish", publishErr: "", progress: s.bundleRef ? t`正在发布…` : t`正在上传并发布（这条路要把包传过我们的服务器，大包会慢）…` });
  try {
    const result = await createLive2dModel({
      name: s.name.trim(),
      description: s.desc.trim(),
      coverImageUrl: s.coverUrl,
      tags: s.tags,
      shared: s.shared,
      personaId: s.recPersonaId || undefined,
      voice: s.recVoice ?? undefined,
      mapping: s.mappingTouched ? s.mapping : undefined,
      entry: s.entry,
      selfMade: true,
      ...(s.bundleRef ? { bundleRef: s.bundleRef, bundleName: s.file.name } : { file: s.file }),
    });
    set({ created: result.model, step: "done", busy: "", progress: "" });
    if (get().mounted) job.done({ silent: true });
    else job.done({ msg: t`「${result.model.name}」已经发布好了。`, route: "/support/models" });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 0;
    const timedOut = e instanceof ApiError && e.code === "TIMEOUT";
    // ★ 这条路上「超时」不等于「失败」：字节和落库都在服务端那边，我们只是不等了 —— 模型很可能已经建好了。
    //   沿用通用的那句「请求超时了，检查网络后再试一次」会让人再发一遍，市场里就是两条同名模型。
    let text = timedOut
      ? t`等太久没等到服务器回话。这一发可能已经建好了 —— 先去「我的」里看一眼，没有再回来重发。`
      : companionErrorText(e, t`发布失败了，再试一次。`);
    // ★★ 失败之后那份**直传资产多半已经不在了**（2026-09-07 补）：服务端 `createModel` 的 finally
    //   无论成败都 `destroyDirectBundle(bundleRef)`。留着这个 ref 会让草稿变成死局 —— 再点一次发布
    //   还是走 bundleRef 那一支，服务端 `downloadDirectBundle` 拿到 404、回一句
    //   400「没在服务器上找到这份模型包……请重新选一次文件再传」，而向导里根本没有那条路
    //   （第 ③ 步有 inspect 之后就只摆「下一步」，唯一出口是顶栏的「重新开始」= 重传 25MB、重走六步）。
    //   清掉之后重试会走 multipart 那一支（文件还在 store 里），慢一点但一定走得通。
    //   ⚠ **429 / 401 不清**：限流与鉴权都是路由中间件挡下的，控制器压根没跑 ⇒ 那份资产还在，
    //   等几秒重试就是秒过；这时候清掉等于白白逼人重传一次 25MB。
    const refGone = !!s.bundleRef && status !== 429 && status !== 401;
    if (refGone) {
      text += t` 传上去的那份包服务器已经回收了，再点一次发布会把包重新传一遍（这条路慢一些）。`;
    }
    set({ busy: "", progress: "", publishErr: text, ...(refGone ? { bundleRef: "", directOn: false } : {}) });
    if (get().mounted) job.done({ silent: true });
    else job.fail(t`模型发布失败：${text}`, "/support/models/new");
  }
}
