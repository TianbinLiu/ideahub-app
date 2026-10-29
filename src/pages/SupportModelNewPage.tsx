/**
 * Live2D 上传向导（/support/models/new）—— 设计正本 docs/digital-human-creator-center.md §3.5 的六步：
 * ① 选 zip（本地解包核对）→ ② 本地预览（画出来才算过）→ ③ 服务端识别（上传 + inspect）
 * → ④ 对映射（动作 / 表情 / 触摸区三张表）→ ⑤ 验收试跑 → ⑥ 发布信息。
 *
 * ★ 状态全在 `studio/live2dUploadStore`（退出这一页再回来原样还在，上传 / 识别不中断 —— CLAUDE.md「长活登记」）。
 *   本页只做三件事：把 store 画出来、把用户的手势翻成 store 的 action、驱动预览舞台演一演。
 * ★ 预览舞台就是客服页那块 `SupportStage`（全站唯一的 Live2D 画布，别再新建一个 WebGL 上下文 ——
 *   companionModel.ts 文件头写了新上下文会让 Cubism 着色器失效）。地址是 `zip://blob:…`，为什么长这样见
 *   `live2d/bundlePreview.ts` 的 ★★★。
 * ★ **画不出来就不算过**：第 ② 步的「继续」只在 `previewState === "ok"` 时能点，而 ok 的判据是
 *   「舞台上现在挂着的模型就是我们这个地址」（`companionBus.model.modelUrl`）—— 不能只看"没报错"：
 *   SupportStage 加载失败会**退回官方看板娘**，屏幕上照样有个人在动，用户会以为自己的包过了。
 * ★ 反馈按本仓的形状：页内三色横幅（emerald / amber / rose）+ 就地红字，不弹 toast（那是「已复制」那类回执用的）。
 * ★ 界面文案走 Lingui：槽位中文名表（ACTION_LABEL 等）是 msg 描述符，渲染时再翻；包里读出来的名字、服务端回的原话原样显示。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import ConfirmDialog from "../components/ConfirmDialog";
import EmptyState from "../components/EmptyState";
import Icon from "../components/Icon";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import StepDots from "../components/StepDots";
import TagInput from "../components/TagInput";
import Warn from "../components/Warn";
import SupportStage, { type StageFallback } from "../components/support/SupportStage";
import { useBackOr } from "../hooks/useBackOr";
import { companionBus } from "../companion/bus";
import {
  ACTIONS,
  FACES,
  TIMING,
  TOUCH_AREAS,
  type CompanionAction,
  type CompanionFace,
  type TouchArea,
} from "../companion/protocol";
import { STANDARD_PARAMS, type ParamSlot } from "../live2d/mapping";
import type { ParamProbe } from "../live2d/companionModel";
import { judgeMotion, judgeOwn, mergeProbes } from "../data/live2dMotionCheck";
import { MAX_LIVE2D_BUNDLE_BYTES } from "../api/uploads";
import {
  companionErrorText,
  listPersonas,
  listVoiceTemplates,
  live2dBadgeLabel,
  type CompanionMappingWire,
  type Live2dCompletenessItem,
  type MarketPersona,
  type VoiceTemplate,
} from "../api/companion";
import { VIDEO_TAG_LEN, parseTags } from "../types";
import {
  LIVE2D_STEPS,
  LIVE2D_STEP_LABEL,
  buildPreview,
  cancelBundleInspect,
  finishVerifyRun,
  live2dDraftBusy,
  live2dDraftDirty,
  markPinFail,
  markPreviewLoaded,
  markVerified,
  patchMapping,
  previewMotionGroup,
  previewOnStage,
  reloadPreview,
  resetLive2dDraft,
  resetMapping,
  pickBundle,
  startBundleInspect,
  startVerifyRun,
  submitLive2dModel,
  uploadCover,
  useLive2dUpload,
  useUploadField,
  type VerifyResult,
} from "../studio/live2dUploadStore";

// ── 槽位的中文名（界面文案，不是规则：枚举本身一律从 protocol.ts / mapping.ts 取，别在这儿抄第二份） ──
const ACTION_LABEL: Record<CompanionAction, MessageDescriptor> = {
  none: msg({ message: "不演", context: "Live2D 动作槽：这个语义动作不播任何动作" }),
  acknowledge: msg`点头 · 赞同`,
  disagree: msg`摇头 · 否定`,
  think: msg`思考`,
  explain: msg`讲解`,
  excited: msg`兴奋`,
  wave: msg`挥手`,
  shy: msg({ message: "害羞", context: "Live2D 动作槽名" }),
  surprised: msg`吃惊`,
  comfort: msg`安慰`,
  playful: msg`调皮`,
};
const FACE_LABEL: Record<CompanionFace, MessageDescriptor> = {
  normal: msg`平静`,
  happy: msg`开心`,
  laughing: msg`大笑`,
  angry: msg`生气`,
  sad: msg`难过`,
  crying: msg`哭`,
  shy: msg({ message: "害羞", context: "Live2D 表情槽名" }),
  tease: msg`坏笑`,
  cuddle: msg`撒娇`,
};
const TOUCH_LABEL: Record<TouchArea, MessageDescriptor> = {
  Head: msg`头`,
  Hair: msg`头发`,
  HandL: msg`左手`,
  HandR: msg`右手`,
  ArmL: msg`左臂`,
  ArmR: msg`右臂`,
  Body: msg`身体`,
  Skirt: msg`裙子`,
  Legs: msg`腿`,
};
const PARAM_LABEL: Record<ParamSlot, MessageDescriptor> = {
  mouthOpen: msg`张嘴`,
  mouthForm: msg`嘴形`,
  eyeL: msg`左眼`,
  eyeR: msg`右眼`,
  eyeBallX: msg`眼球左右`,
  eyeBallY: msg`眼球上下`,
  angleX: msg`头左右`,
  angleY: msg`头上下`,
  angleZ: msg`头倾斜`,
  bodyX: msg`身体左右`,
  breath: msg`呼吸`,
  cheek: msg`脸红`,
};

/**
 * `/inspect` 的完成度清单里那些**英文槽名**翻成中文。
 * 服务端给的取值只有四种形状（`live2dCapabilities.service.completenessOf`，已登记进 api-contract）：
 * 参数槽名（`eyeL`…）、`idle`、`action:<槽>` / `face:<槽>` / `touch:<区>`。
 * ★ 认不出来的原样显示：服务端将来加了新槽，界面上出现一小段英文远好过显示成空白或者"未知"。
 */
function slotLabel(slot: string): string {
  // 模块级函数拿不到 useLingui：用 i18n._ 在调用那一刻按当前语言翻；表里查不到的槽名原样显示
  const named = (d: MessageDescriptor | undefined, raw: string) => (d ? i18n._(d) : raw);
  if (slot === "idle") return i18n._(msg`待机动作`);
  const colon = slot.indexOf(":");
  if (colon < 0) return named(PARAM_LABEL[slot as ParamSlot], slot);
  const kind = slot.slice(0, colon);
  const key = slot.slice(colon + 1);
  if (kind === "action") {
    const name = named(ACTION_LABEL[key as CompanionAction], key);
    return i18n._(msg`动作 · ${name}`);
  }
  if (kind === "face") {
    const name = named(FACE_LABEL[key as CompanionFace], key);
    return i18n._(msg`表情 · ${name}`);
  }
  if (kind === "touch") {
    const name = named(TOUCH_LABEL[key as TouchArea], key);
    return i18n._(msg`触摸 · ${name}`);
  }
  return slot;
}

/**
 * 必须项里"确实缺了"的那几条。
 * ★★ `ok === null` **不算缺**（api/companion.Live2dCompletenessItem 的三态）：那是"包里没有 cdi3.json、
 *   服务端读不到参数表"，与"读到了、确实没有这个参数"是两回事。把 null 当缺的话，一个只是导出时
 *   没勾 cdi3 的正常模型会被判成"不能眨眼/不能转头"，并且**永远点不动下一步**（坑表「把 N 种结局压成两档」）。
 */
function missingRequired(items: Live2dCompletenessItem[]): Live2dCompletenessItem[] {
  return items.filter((r) => r.ok === false);
}

/** 标签上限：产品口径，**有意小于服务端的安全上界**（CLAUDE.md「把客户端上限与服务端对齐」那条坑） */
const TAG_MAX = 8;
/** 「作者推荐」两个下拉各列多少条。40 = 服务端 limit 的上限；再多也不适合塞进一个 select */
const PICKER_LIMIT = 40;
/** 预览多久还没画出来就当它失败（模型在手机上解包 + 传贴图，实测几秒；45 秒是给最慢的那台留的余量） */
const PREVIEW_TIMEOUT_MS = 45_000;
/**
 * 试跑每一项之前「归位」：嘴闭上、表情当场回平静（连同被叠到量程边上的表情参数一起写回默认值，companionModel.resetFaceForProbe）、
 * 视线回正、**停掉动作**（stopMotions）—— 框架下一帧从头起待机动作，而试跑期间待机钉在同一段（companionModel.pinIdleForProbe）。
 * 等待机淡入完了才演这一项、开始量。
 * ★★ 每一项都这样归位，包括说话 / 眨眼 / 表情（2026-10-26 审核指出，原来只有动作项之后才停动作）：
 *   judgeMotion 比的是「这一窗的起伏」与「基线的起伏」，两份必须落在**同一段待机、同一个相位**上才可比。框架的待机是随机挑段的，
 *   包里待机组有好几段、幅度不同（Cubism 官方样例 Hiyori 9 段）时，基线落在安静的那段、哑动作的窗口落在活跃的那段，就被量成「动了」；
 *   表情项不停动作的话，窗口落在待机循环的任意相位上。钉住同一段 + 每一项都从「停掉动作」那一刻起算之后，每个窗口都是
 *   「这一段待机的第 settle 秒起、往后 waitMs 秒」，而基线量的是这一段从头起的一整截（见页面里的 baselineMsFor），窗口落在它里面。
 * ★ 等多久：至少 VERIFY_SETTLE_MS，并且不短于钉住那段待机的淡入（probeIdleFadeInMs，Hiyori 0.5 秒、没写的按框架缺省 2 秒）——
 *   淡入没完时参数还是「停下那一刻的姿势」与待机曲线的混合，那一截与上一项演了什么有关，不确定。
 *   2.2 秒是 2026-10-26 拿官方看板娘量的（先试 0.8 秒，淡入那一截落进下一项的窗口，哑动作 6 次里 3 次被量成「动了」）；
 *   exp3 表情缺省淡出 1 秒（运行时解析 exp3 时 FadeOutTime 缺省 1）也在这里面。
 */
const VERIFY_SETTLE_MS = 2200;
/** 淡入之外再多等的余量（帧与 setTimeout 对不齐） */
const VERIFY_SETTLE_PAD_MS = 200;
/** 这一次归位要等多久（见 VERIFY_SETTLE_MS）—— 试跑真等的（runVerify）与顶上那句「整轮大约几秒」（verifyEtaSecs）都问它 */
function verifySettleMs(): number {
  const fade = companionBus.model?.probeIdleFadeInMs() ?? 0;
  return Math.max(VERIFY_SETTLE_MS, fade + VERIFY_SETTLE_PAD_MS);
}
/**
 * 基线比最长那一项的窗口再多量多久。基线从「停掉动作」那一刻起量，一直量到「归位时间 + 最长那一项的窗口 + 这一截」，
 * 于是任何一项的窗口（归位之后的 waitMs）都落在基线量过的那一段待机里。
 * ★ 从停下那一刻量起、不是从归位之后量起：一个比窗口短的哑动作（1.2 秒那种）播完，框架会在窗口中间把钉住的那段待机**从头**再起一遍，
 *   那一截（这一段待机的开头）也得在基线里量到过，不然它比基线多出来的那点起伏就会被当成「动了」。
 */
const VERIFY_BASELINE_PAD_MS = 400;
/**
 * 基线量几遍（合起来用，data/live2dMotionCheck.mergeProbes）。待机钉住之后每一遍走的是同一条轨迹，多量一遍等于把采样加密一倍。
 * ★ 为什么要加密（2026-10-26 在 Hiyori 上量的）：起伏是逐帧取的 max − min，帧率低的那一份会漏掉快速的峰（眉毛一挑只有一两帧）。
 *   基线那几秒帧率掉到 20 帧上下、某一项的窗口里是 60 多帧时，同一条待机轨迹量出来的起伏能差出 30%（哑触摸动作 ParamBrowLX 1.30 倍），
 *   离 MOVE_K 的 1.5 只剩一点；量两遍之后同一项是 1.19~1.20 倍（两轮）。按 66 帧密采时基线与它都是 0.226 —— 差的全是漏采的峰。
 */
const VERIFY_BASELINE_ROUNDS = 2;
/**
 * 每次归位给待机钉多久（pinIdleForProbe 的到期时间）：盖住一次归位 + 最长的基线还有余量。页面意外没松开时，过了这么久框架自己恢复随机挑段。
 */
const VERIFY_IDLE_PIN_MS = 20_000;

/**
 * 第 ⑤ 步一项试跑：怎么演、演多久、量什么（motion = 比待机基线；mouth / eye = 只看嘴 / 眼那一个参数；null = 没东西可量）
 */
type VerifyItem = { key: string; label: string; run: () => void; waitMs: number; measure: "motion" | "mouth" | "eye" | null };

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand";
const primaryCls = "w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40";
const secondaryCls = "rounded-full border border-slate-600 px-4 py-1.5 text-xs text-slate-300 disabled:opacity-40";
const selectCls =
  "h-9 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 outline-none focus:border-brand disabled:opacity-40";

function Banner({ tone, children }: { tone: "ok" | "warn" | "bad" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-ok-500/40 bg-ok-500/10 text-ok-200"
      : tone === "warn"
        ? "border-warn-500/40 bg-warn-500/10 text-warn-300"
        : tone === "bad"
          ? "border-danger-500/40 bg-danger-500/10 text-danger-300"
          : "border-sky-500/40 bg-sky-500/10 text-sky-200";
  return <p className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${cls}`}>{children}</p>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-sm font-semibold text-slate-300">{children}</div>;
}

/**
 * 映射表里的一行：左边一颗 ▶（在预览里当场演一下），右边一到两个下拉。
 *
 * ★ 试演走运行时的**试演入口**（`companionBus.motionGroup` / `expression`），直接播下拉框里选中的那个组 / 表情，
 *   不经语义槽、也不吃演出路径那 2.3 秒的语义动作压制（`TIMING.actionSuppressMs`，防的是一句话里连着三个标签
 *   变成三次半途打断）—— 试演是人一下一下点的，等 2.3 秒的表现就是"点了没反应"。
 *   ⚠ 「整条路通不通」不归这颗 ▶ 管，归第 ⑤ 步的试跑（那里走的是 `companionBus.action(a)` 这条真演出路）。
 * ★ `onPlay` 返回 `false` = 这个组 / 表情**不在包里**，就地红字说出来。演不出来时静默是最坏的一种：
 *   用户会以为"预览就这样"，然后把一份对不上的映射发布出去（铁律八）。
 */
const PLAY_FLASH_MS = 700;

function MapRow({
  label,
  hint,
  disabled,
  onPlay,
  anchor,
  highlight,
  children,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  /** 返回 false = 这一项在包里找不到 */
  onPlay?: () => boolean | void;
  /** 第 ⑤ 步「去对」跳回来时认的锚点（`a-wave` / `t-Head`）；元素 id = `map-<anchor>` */
  anchor?: string;
  /** 刚从第 ⑤ 步「去对」跳过来：边框亮一下，告诉人是哪一行 */
  highlight?: boolean;
  children: React.ReactNode;
}) {
  // ★ 演不出来有**两个**原因，说法不一样（别压成一档）：包里真没有这个组 / 表情，
  //   或者台上现在根本不是我们的包（预览退回官方看板娘了）。后者说成"包里没有它"就是诬告。
  const [flash, setFlash] = useState<"" | "playing" | "missing" | "offstage">("");
  const { t } = useLingui();
  useEffect(() => {
    if (flash !== "playing") return;
    const timer = setTimeout(() => setFlash(""), PLAY_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);
  return (
    <div
      id={anchor ? `map-${anchor}` : undefined}
      className={`rounded-xl border bg-panel px-3 py-2 ${highlight ? "border-warn-500/60" : "border-slate-700/70"}`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFlash(onPlay?.() === false ? (previewOnStage() ? "missing" : "offstage") : "playing")}
          disabled={disabled || !onPlay}
          aria-label={t`试演 ${label}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-brand disabled:opacity-40"
        >
          <Icon name="play" size={13} filled />
        </button>
        <div className="w-16 shrink-0 truncate text-xs font-semibold text-slate-300">{label}</div>
        {children}
      </div>
      {(hint || flash) && (
        <p
          className={`mt-1 pl-10 text-[10px] leading-relaxed ${
            flash === "missing" ? "text-danger-300" : flash === "offstage" ? "text-warn-300" : "text-slate-500"
          }`}
        >
          {flash === "missing"
            ? t`这个包里没有它 —— 换一个，或者回 Cubism 重新导出。`
            : flash === "offstage"
              ? t`上面那块现在不是你的包（预览没画出来），演不了 —— 先点「重新加载预览」。`
              : flash === "playing"
                ? t`演出中…`
                : hint}
        </p>
      )}
    </div>
  );
}

/**
 * 从舞台画布截一张当封面。
 *
 * ★★ 真正难的那一半在运行时里（`CompanionModel.snapshot()`）：舞台那台 pixi Application 故意没开
 *   `preserveDrawingBuffer`（它是客服页那位看板娘的常驻舞台，开了就是让所有用户天天为这个几乎没人用的
 *   截图功能付渲染代价），WebGL 的绘制缓冲一被合成就清空 —— 随便挑个时刻 `drawImage(canvas)` 拿回来的
 *   是全透明，导出成 JPEG 就是一整块纯色。`snapshot()` 的办法是"手动画一帧、同一个同步块里立刻读"，
 *   那条"中间一个 await 都不能有"的纪律整个关在它里面 —— 它交回来的已经是一块普通 2D 画布，
 *   本函数后面爱怎么慢怎么慢。
 *   （2026-09-07 之前这里是"连抓 10 帧碰运气"，每帧还得带 80ms 上限防 rAF 一次都不来；
 *    运行时开了公开入口之后那一整套没有存在的理由了。）
 * ★ 垫一层底色再导出：JPEG 没有透明通道，不垫的话透明处会变成纯黑。底色用 `ink` 的色值。
 * ★ 还是要验一遍"到底有没有画上东西"：模型没加载完 / 上下文丢了都会得到一张空图，
 *   而一张纯色封面发出去之后没有任何地方会告诉作者（铁律八）。
 */
const COVER_MAX_WIDTH = 720;
/** 不透明像素占比低于它就当"什么都没画上"。2% —— 模型在舞台上占的面积远大于此，再低会把抗锯齿边缘当成画面 */
const COVER_MIN_OPAQUE = 0.02;

async function captureStage(): Promise<Blob | null> {
  // ★ 台上不是我们这个包就整句拒（判据一处实现在 store 的 `previewOnStage`）：SupportStage 加载失败会
  //   退回官方看板娘，而 COVER_MIN_OPAQUE 那道 2% 的闸对她是照过的 —— 不判的话，发布出去的封面是小梦
  if (!previewOnStage()) return null;
  const shot = companionBus.model?.snapshot();
  if (!shot || !shot.width || !shot.height) return null;
  const w = Math.min(COVER_MAX_WIDTH, shot.width);
  const h = Math.max(1, Math.round((shot.height / shot.width) * w));

  const probe = document.createElement("canvas");
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(shot, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let opaque = 0;
  let sampled = 0;
  // 每 7 个像素抽一个：720×1280 全扫要几百万次，抽样后误差远小于 2% 这道闸的余量
  for (let p = 3; p < data.length; p += 4 * 7) {
    sampled++;
    if (data[p] > 16) opaque++;
  }
  if (!sampled || opaque / sampled <= COVER_MIN_OPAQUE) return null;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.fillStyle = "#0b1020"; // = tailwind 的 ink
  octx.fillRect(0, 0, w, h);
  octx.drawImage(shot, 0, 0, w, h);
  return await new Promise<Blob | null>((res) => out.toBlob(res, "image/jpeg", 0.86));
}

/**
 * 第 ⑥ 步的「作者推荐」两格（设计正本 §3.5 第 6 步「推荐人格/声音（可空）」）。
 *
 * ★★ 推荐 ≠ 强制：合并顺序是 **用户自选 > 人格推荐 > 模型推荐 > 服务端默认**（官网仓 COMPANION.md，
 *   服务端 `/api/companion/settings` 一处实现）。装了这个形象的人只要自己选过人格 / 声音，这两项就用不上 ——
 *   文案照这个说，写成"装上就会变成这样"是骗人。
 * ★ 只列**公开**的（`scope: "all"`）：私有人格在服务端 `resolvePersonaBinding` 那里直接 403，
 *   而私有的声音模板别人也读不到 —— 让人选一个注定用不上的东西，比不给选更糟。
 * ★★ 还要把**没买的付费人格**滤掉（`bindablePersona`）：服务端对它回的是 403「Buy the persona before binding it」，
 *   一句英文 —— 而那时用户已经填完整整一屏、点的是最后那颗「发布」。列表里本来就有 `price` / `purchased` / `isOwner`
 *   三个字段可以当场判，没有任何理由让人走到那一步才知道。
 * ★ 列表取失败**不挡发布**：这两项本来就可以空。所以失败只在这一格里说一句，不写进 publishErr。
 */
/** 这个人格现在绑得上吗：自己的 / 免费的 / 已经买过的 —— 其余的服务端一律 403（见上面的 ★★） */
function bindablePersona(p: MarketPersona): boolean {
  return p.isOwner || p.price <= 0 || p.purchased;
}

function RecommendPickers() {
  const personaId = useLive2dUpload((st) => st.recPersonaId);
  const voice = useLive2dUpload((st) => st.recVoice);
  const [personas, setPersonas] = useState<MarketPersona[]>([]);
  const [voices, setVoices] = useState<VoiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const { t } = useLingui();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // 两条各自成败：人格取到了、声音没取到时仍然让人选人格（`allSettled` 而不是 `all`）
    void Promise.allSettled([
      listPersonas({ scope: "all", page: 1, limit: PICKER_LIMIT, sort: "hot" }),
      listVoiceTemplates({ scope: "all", page: 1, limit: PICKER_LIMIT, sort: "hot" }),
    ]).then(([p, v]) => {
      if (!alive) return;
      if (p.status === "fulfilled") setPersonas(p.value.personas.filter(bindablePersona));
      if (v.status === "fulfilled") setVoices(v.value.templates);
      const bad = [p, v].find((r) => r.status === "rejected");
      setErr(bad && bad.status === "rejected" ? companionErrorText(bad.reason, t`推荐列表没取到，跳过这两项也能发布。`) : "");
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const voiceId = voice?.templateId ?? "";
  return (
    <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
      <FieldLabel><Trans>作者推荐（可以都不选）</Trans></FieldLabel>
      <p className="mb-2 text-xs leading-relaxed text-slate-500">
        <Trans>装了这个形象、自己又还没挑过人格 / 声音的人，会拿到你推荐的这两样；已经自己挑过的人不受影响。</Trans>
      </p>
      {loading ? (
        <EmptyState loading text={t`正在取人格与声音…`} compact />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs font-semibold text-slate-300"><Trans>人格</Trans></span>
            <select
              value={personaId}
              aria-label={t`推荐哪个人格`}
              onChange={(e) => useLive2dUpload.setState({ recPersonaId: e.target.value })}
              className={selectCls}
            >
              <option value="">{t`不推荐`}</option>
              {personas.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.coverEmoji} {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs font-semibold text-slate-300"><Trans>声音</Trans></span>
            <select
              value={voiceId}
              aria-label={t`推荐哪个声音`}
              onChange={(e) => {
                // ★ 存的是模板那份**拼好的快照**（VoiceTemplate.voice，templateId 就在里面）：
                //   声音按快照走、不按 id 引用（COMPANION.md），模板将来被删了这个嗓子也还在
                const picked = voices.find((vo) => vo._id === e.target.value);
                useLive2dUpload.setState({ recVoice: picked ? picked.voice : null });
              }}
              className={selectCls}
            >
              <option value="">{t`不推荐`}</option>
              {voices.map((vo) => (
                <option key={vo._id} value={vo._id}>
                  {vo.name}
                </option>
              ))}
            </select>
          </div>
          {personas.length === 0 && voices.length === 0 && !err && (
            <p className="text-[11px] leading-relaxed text-slate-500"><Trans>市场里还没有公开的人格和声音可选，跳过就行。</Trans></p>
          )}
        </div>
      )}
      {!!err && <p className="mt-1.5 text-xs leading-relaxed text-danger-300">{err}</p>}
    </div>
  );
}

export default function SupportModelNewPage() {
  const navigate = useNavigate();
  const { t } = useLingui();
  const back = useBackOr("/support/models");
  const s = useLive2dUpload();
  const [, setStep] = useUploadField("step");
  const [, setName] = useUploadField("name");
  const [, setDesc] = useUploadField("desc");
  const [, setTags] = useUploadField("tags");
  const [, setShared] = useUploadField("shared");
  const [, setSelfMade] = useUploadField("selfMade");
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const verifyRunning = useRef(false);
  /**
   * 第几轮试跑。★ 「■ 停下」之后紧接着点「▶ 再跑一遍」：上一轮还睡在某个 await 里，醒来只看 verifyRunning 的话
   *   会以为是自己还在跑，两轮交错着往同一张清单上打勾。每一轮只认自己的号，停下 / 卸载都把号往前拧一格。
   */
  const verifySeq = useRef(0);
  const [restartAsk, setRestartAsk] = useState(false);
  /** 刚从第 ⑤ 步「去对」跳过来、要亮一下的那一行锚点（第 ④ 步） */
  const [hlRow, setHlRow] = useState("");
  /**
   * 舞台报回来的失败原因，按向导的口径说（对作者说怎么修）。
   * ★ 加载前的 moc3 检查拦下的两类按类型认（live2d/mocCheck）：版本太新不是"文件坏了"，单独一句；别的照旧用加载那一步的原话。
   *   第 ① 步本地核对已经跑过同一道检查（bundlePreview），这里是那一步没跑成（运行时没加载出来）时的兜底。
   */
  const previewFailText = (f: StageFallback) =>
    f.kind === "inconsistent"
      ? t`模型文件没通过 Cubism 的一致性检查（结构不完整或被改过）。用 Cubism Editor 重新导出 moc3 再试。`
      : f.kind === "tooNew"
        ? t`这个模型是用较新版本的 Cubism 导出的，App 里的运行时还读不了。导出时选一个旧一些的 moc3 版本再试。`
        : f.reason;
  /** 刚才在预览里点到了我们的哪个触摸区（第 ④ 步验证命中区映射用；空 = 还没点过） */
  const [lastHit, setLastHit] = useState<string[]>([]);

  const detail = s.check && s.entry ? s.check.detail.get(s.entry) : undefined;
  const mapping = s.mapping;
  const busy = live2dDraftBusy(s);
  const dirty = live2dDraftDirty(s);

  // 页面挂没挂着 —— 长活的结局据此分叉（在 → 页面自己画；不在 → 走全局胶囊）
  useEffect(() => {
    useLive2dUpload.setState({ mounted: true });
    return () => {
      useLive2dUpload.setState({ mounted: false, verifyNow: "" });
      // 试跑跑到一半离开这一页：待机放开（到期也会自己放开，见 VERIFY_IDLE_PIN_MS）
      if (verifyRunning.current) companionBus.model?.pinIdleForProbe(0);
      verifyRunning.current = false;
      verifySeq.current++;
    };
  }, []);

  // 预览到底画出来没有：认「舞台上挂着的就是我们这个地址」，不认"没报错"（见文件头 ★）
  useEffect(() => {
    const url = s.previewUrl;
    if (!url) return;
    const check = (m: { modelUrl: string } | null) => {
      if (m && m.modelUrl === url) markPreviewLoaded(true);
    };
    check(companionBus.model);
    const off = companionBus.onModel(check);
    // 等媒体/加载一律带上限（CLAUDE.md 坑表）：不带的话窗口被切到后台时它会永远停在"加载中"
    const timer = setTimeout(() => {
      if (useLive2dUpload.getState().previewState === "loading") {
        const secs = PREVIEW_TIMEOUT_MS / 1000;
        markPreviewLoaded(false, t`等了 ${secs} 秒还没画出来。包可能太大，或者贴图 / moc3 有问题。`);
      }
    }, PREVIEW_TIMEOUT_MS);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [s.previewUrl]);

  // 在预览里摸一下模型 → 屏幕上说清"识别成了我们的哪个区"（第 ④ 步触摸表就是在配这件事）
  useEffect(() => companionBus.onHit((areas) => setLastHit(areas)), []);

  const patch = useCallback(
    (next: Partial<CompanionMappingWire>) => {
      if (!mapping) return;
      patchMapping({ ...mapping, ...next });
    },
    [mapping],
  );

  const groups = s.inspect?.capabilities.motionGroups ?? detail?.motionGroups.map((g) => g.name) ?? [];
  const expressions = s.inspect?.capabilities.expressions ?? detail?.expressions ?? [];
  const hitAreas = s.inspect?.capabilities.hitAreas ?? detail?.hitAreas ?? [];
  /** 列举文件名 / 表情名 / 命中区时的分隔符 */
  const listSep = t({ message: "、", comment: "列举几个文件名 / 动作组 / 表情名时的分隔符" });
  /** 「刚点到：…」那一行：认得出的区翻成人话，认不出的原样 */
  const hitText = lastHit
    .map((a) => {
      const d = TOUCH_LABEL[a as TouchArea];
      return d ? t(d) : a;
    })
    .join(" / ");
  const texList =
    detail?.textures.map((tex) => (tex.width ? `${tex.width}×${tex.height}` : t`尺寸没量出来`)).join(listSep) ?? "";

  /**
   * 验收脚本：一项一项演，每一项边演边量（data/live2dMotionCheck 判 ✓ / ⚠ / 没量到）。人点了停就停在当前这一项（不清已经打过的勾）。
   * ★ 表情槽为 null **也要试**（2026-10-26）：null 不是「不演」，是退到我们那套通用参数（companionModel.setFace）——
   *   原来这里把它们跳过，于是这批表情一次都没被试过；包里没有 ParamBrowLY 这一套时，正好由「看不出变化」抓出来。
   * ★ 触摸那几项只试播它对上的动作，命中区对没对上量不到（要人在预览里摸一下，列表下面那句照实说）。
   */
  const verifyItems = useMemo(() => {
    const items: VerifyItem[] = [
      { key: "speak", label: t`说一句话，看嘴动没动`, run: () => companionBus.speakSynthetic(2200), waitMs: 2600, measure: "mouth" },
      // 不等她自己眨（随机隔 2.4~6 秒，3 秒的窗口一半时候等不到）：叫她现在就眨一次
      { key: "blink", label: t`眨一下眼，看眼睛闭没闭上`, run: () => companionBus.model?.blinkNow(), waitMs: 1500, measure: "eye" },
    ];
    for (const a of ACTIONS) {
      if (a === "none") continue;
      const g = mapping?.actions?.[a];
      if (!g) continue;
      const actName = t(ACTION_LABEL[a]);
      items.push({
        key: `a:${a}`,
        label: t`动作「${actName}」→ ${g}`,
        run: () => companionBus.action(a),
        waitMs: TIMING.actionSuppressMs + 300,
        measure: "motion",
      });
    }
    for (const f of FACES) {
      if (f === "normal") continue;
      const m = mapping?.faces?.[f] ?? null;
      const faceName = t(FACE_LABEL[f]);
      const expr = m ? m.expression || t`参数版` : t`通用参数`;
      items.push({
        key: `f:${f}`,
        label: t`表情「${faceName}」→ ${expr}`,
        run: () => companionBus.face(f),
        waitMs: 1800,
        measure: "motion",
      });
    }
    for (const area of TOUCH_AREAS) {
      const m = mapping?.touch?.[area];
      if (!m) continue;
      const areaName = t(TOUCH_LABEL[area]);
      const target = m.motion || t`只说话、不播动作`;
      items.push({
        key: `t:${area}`,
        label: t`摸「${areaName}」→ ${target}`,
        run: () => (m.motion ? previewMotionGroup(m.motion) : undefined),
        waitMs: m.motion ? TIMING.actionSuppressMs + 300 : 600,
        // 只说话的那种没有动作可量：跑过就算（它本来就不该动）
        measure: m.motion ? "motion" : null,
      });
    }
    return items;
  }, [mapping, t]);

  /** 这份清单里还没跑过的项数（第 ⑤ 步按钮上方那句话） */
  const unrun = verifyItems.filter((it) => !s.verifyDone.includes(it.key)).length;
  /**
   * 标了 ⚠ 的项按「量的是什么」分两类，原因各说各的：说话 / 眨眼只看嘴 / 眼那一个参数（judgeOwn），⚠ 是参数没对上或被动作盖住；
   * 其余比待机基线（judgeMotion），⚠ 是那段动作 / 表情本身没让模型动起来。分类认 verifyItems 的 measure，不另抄一份键名
   */
  const warnSplit = (() => {
    const own = new Set(verifyItems.filter((it) => it.measure === "mouth" || it.measure === "eye").map((it) => it.key));
    const ownCount = s.verifyWarn.filter((k) => own.has(k)).length;
    return { own: ownCount, motion: s.verifyWarn.length - ownCount };
  })();
  /** 清单里最长那一项要量多久（基线要把它盖住，见 VERIFY_BASELINE_PAD_MS） */
  const longestWaitMs = verifyItems.reduce((m, it) => Math.max(m, it.waitMs), 0);
  /** 基线从「停掉动作」那一刻量到哪儿（runVerify 真量的与下面那句「先量 N 秒」都问它） */
  const baselineMsFor = (settleMs: number) => settleMs + longestWaitMs + VERIFY_BASELINE_PAD_MS;
  const baselineSecs = Math.round((VERIFY_BASELINE_ROUNDS * baselineMsFor(VERIFY_SETTLE_MS)) / 1000);
  /** 整轮大约多少秒（第 ⑤ 步顶上那句话；比原来「等够就打勾」慢一倍上下，先说出来，别让人以为卡住了）。顺序与 runVerify 一致：先归位、量基线，再逐项归位 + 演 */
  const verifyEtaSecs = (() => {
    let ms = VERIFY_SETTLE_MS + VERIFY_BASELINE_ROUNDS * baselineMsFor(VERIFY_SETTLE_MS);
    for (const it of verifyItems) ms += VERIFY_SETTLE_MS + it.waitMs;
    return Math.ceil(ms / 10_000) * 10;
  })();
  /** 量基线那几秒列表上方那一行（verifyNow 等于它时画） */
  const baselineLabel = t`先量 ${baselineSecs} 秒她待着不动的样子，拿来对比…`;

  async function runVerify() {
    if (verifyRunning.current) return;
    // ★ 与第 ② 步同一条判据（store 的 `previewOnStage`）：台上不是我们这个包时整句拒 —— 对着官方看板娘打出来的
    //   那一列 ✓ 是彻头彻尾的假话，比一列空的更坏
    if (!previewOnStage()) {
      useLive2dUpload.setState({ verifyNow: "", previewErr: t`上面那块现在不是你的包（预览没画出来）。先点「重新加载预览」，画出来了再试跑。`, previewState: "failed" });
      return;
    }
    verifyRunning.current = true;
    const my = ++verifySeq.current;
    const alive = () => verifySeq.current === my;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    // 归位（每一项都一样，理由与等多久见 VERIFY_SETTLE_MS 那条）：嘴闭上、表情当场回平静、视线回正、
    // 待机钉住同一段、停掉动作 —— 框架下一帧从头起钉住的那一段。先钉再停：停下那一拍框架就要挑下一段待机了
    const reset = () => {
      const model = companionBus.model;
      model?.stopSpeaking();
      model?.resetFaceForProbe();
      model?.lookForward();
      // 钉不住（这份运行时没有那两个方法）要记下来：待机组不止一段时每一窗都量不了，界面要说「再跑也一样」（verifyPinFail）
      if (model && !model.pinIdleForProbe(VERIFY_IDLE_PIN_MS)) markPinFail();
      model?.stopMotions();
    };
    const settle = async () => {
      reset();
      await sleep(verifySettleMs());
    };
    startVerifyRun();
    let lost = false;
    let reached = 0;

    // 待机基线。先归位一次：把台上原来在播的（第 ④ 步 ▶ 试过的动作、随机挑的那段待机）停掉，等钉住的那段淡入完；
    // 再停一次、从这一刻起量 —— 量的就是钉住那段待机从头起的一整截，每一项的窗口都落在里面（见 VERIFY_BASELINE_PAD_MS 的 ★）。
    // 同样的一截量 VERIFY_BASELINE_ROUNDS 遍、合起来（采样加密，见那条的 ★）；哪一遍没量成，整份基线就算没量成
    useLive2dUpload.setState({ verifyNow: baselineLabel });
    await settle();
    let base: ParamProbe | null = null;
    for (let round = 0; round < VERIFY_BASELINE_ROUNDS && alive() && previewOnStage(); round++) {
      reset();
      const p = (await companionBus.model?.probeParams(baselineMsFor(verifySettleMs()))) ?? null;
      base = round === 0 ? p : mergeProbes(base, p);
    }
    if (alive() && !previewOnStage()) lost = true;

    for (const it of verifyItems) {
      if (lost || !alive()) break;
      useLive2dUpload.setState({ verifyNow: it.label });
      await settle();
      if (!alive()) break;
      // ★ 中途每一项都要问：跑到一半预览可能掉了（运行时会在模型 destroy 时撤掉我们的 blob 地址，
      //   见 live2dUploadStore 文件头 ⚠⚠）。一份**没跑完**的 ✓ 列表比没有更坏，整列作废。
      if (!previewOnStage()) {
        lost = true;
        break;
      }
      // ★ 先挂上采样、再演：动作 / 表情的头几帧（淡入）也要量进去。开演同一拍忘掉归位那两秒里的点击：
      //   不然这一项的动作会改播那个触摸区的动作，量的就是另一段了（companionModel.stopMotions 的 ★）
      const model = companionBus.model;
      const probe = it.measure ? (model?.probeParams(it.waitMs) ?? null) : null;
      model?.forgetTouch();
      it.run();
      let sample: ParamProbe | null = null;
      if (probe) sample = await probe;
      else await sleep(it.waitMs);
      if (!alive()) break;
      if (!previewOnStage()) {
        lost = true;
        break;
      }
      const verdict = it.measure === "motion" ? judgeMotion(base, sample) : it.measure ? judgeOwn(sample, it.measure) : "moved";
      const result: VerifyResult = verdict === "moved" ? "ok" : verdict;
      markVerified(it.key, result);
      reached++;
    }
    // 被「■ 停下」或卸载打断的那一轮：停下那一刻已经收过尾，这里什么都别动（下一轮可能已经开始了）
    if (!alive()) return;
    companionBus.stopSpeaking();
    // 收尾也写回表情参数：最后一项是通用参数表情的话，不写回眉毛 / 嘴形会一直停在量程边上（见 resetFaceForProbe 的 ★★）
    companionBus.model?.resetFaceForProbe();
    // 待机放开、照常随机挑段（钉着的那段播完这一遍就换）
    companionBus.model?.pinIdleForProbe(0);
    verifyRunning.current = false;
    if (lost) {
      startVerifyRun();
      useLive2dUpload.setState({
        verifyNow: "",
        previewState: "failed",
        previewErr: t`试跑跑到一半，上面那块换成了别的模型 —— 这一轮不作数。点「重新加载预览」再跑一遍。`,
      });
      return;
    }
    useLive2dUpload.setState({ verifyNow: "" });
    if (reached === verifyItems.length) finishVerifyRun();
  }

  /** 「■ 停下」：作废这一轮的号（见 verifySeq），收尾 —— 已经打过的勾留着 */
  function stopVerify() {
    verifySeq.current++;
    verifyRunning.current = false;
    companionBus.stopSpeaking();
    companionBus.model?.resetFaceForProbe();
    companionBus.model?.pinIdleForProbe(0);
    useLive2dUpload.setState({ verifyNow: "" });
  }

  /**
   * 「这几样装上之后不会演」清单（第 ⑤ 步顶上；按**当前这份**映射现算，改了就跟着变）。
   * ★ 只把「能改的」一行一行列、每行一颗「去对」：包里有动作组、可这个动作槽空着；包里有没被任何槽用上的命中区、可这个触摸区空着。
   *   包里本来就没有的（一个动作组都没有 / 没有多余的命中区）只汇总成一句 —— 9 个触摸区全按空列出来，真正能改的那几行反而被淹掉。
   * ★ 不算进来的：表情槽为 null（= 用通用参数演，照样会演，见 verifyItems 的 ★）；有命中区、没挂动作的触摸区（= 只说话，是有意的）。
   * ★ 参数槽 App 里改不了，只说一句、不给「去对」；待机动作也没有对应的一行可改（包里的组叫 Idle 就会自动用上）。
   * ★ 参数槽单独计数（params），不算进 count：count 是「这几个槽装上之后整个不演」，参数没对上是「用到它的那部分演出不动」，
   *   两句话分开说。整块提示条按「有没有要说的」（show）画，别按 count —— 只有参数没对上时 count 是 0，那句话原来就整块被吞掉了。
   */
  const gapView = (() => {
    const rows: { slot: string; anchor: string; what: string }[] = [];
    const notes: string[] = [];
    let count = 0;
    if (!mapping) return { rows, notes, count, params: 0, show: false };
    const actionsNull = ACTIONS.filter((a) => a !== "none" && !mapping.actions?.[a]);
    // 运行时待机组 = mapping.idle || "Idle"（companionModel.acquire），所以包里有叫 Idle 的组时 null 也有待机动作
    const idleNull = !mapping.idle && !groups.includes("Idle");
    if (groups.length === 0) {
      if (actionsNull.length || idleNull) {
        notes.push(t`这个包里没有动作组：待机和各个动作都不会演。`);
        count += actionsNull.length + (idleNull ? 1 : 0);
      }
    } else {
      if (idleNull) {
        rows.push({ slot: "idle", anchor: "", what: t`不说话的时候她不做待机动作（App 里还改不了：把包里的待机动作组命名成 Idle 再导出就会用上）` });
        count++;
      }
      for (const a of actionsNull) {
        rows.push({ slot: `action:${a}`, anchor: `a-${a}`, what: t`该做这个动作的时候她不动` });
        count++;
      }
    }
    const used = new Set(TOUCH_AREAS.flatMap((a) => mapping.touch?.[a]?.hitAreas ?? []));
    const spare = hitAreas.some((h) => !used.has(h));
    const touchNull = TOUCH_AREAS.filter((a) => !mapping.touch?.[a]);
    if (spare) {
      for (const a of touchNull) {
        rows.push({ slot: `touch:${a}`, anchor: `t-${a}`, what: t`摸这里没有反应` });
        count++;
      }
    } else if (touchNull.length) {
      const n = touchNull.length;
      notes.push(hitAreas.length ? t`另有 ${n} 个触摸区在这个模型上没有对应的命中区，摸那些地方没有反应。` : t`这个模型没有命中区，摸哪里都没有反应。`);
      count += n;
    }
    // 参数槽：只有服务端明写了 null 的才是「没对上」（没写这一格 = 按标准参数名读，见 mapping.resolveParamIds）
    const paramsNull = (Object.keys(STANDARD_PARAMS) as ParamSlot[]).filter(
      (slot) => !!mapping.params && Object.prototype.hasOwnProperty.call(mapping.params, slot) && !mapping.params[slot],
    );
    if (paramsNull.length) {
      const names = paramsNull.map((slot) => t(PARAM_LABEL[slot])).join(listSep);
      notes.push(t`这几个参数没对上：${names}。用到它们的那部分演出不会动；参数这一栏 App 里还改不了，要改得回 Cubism 把参数 id 改成标准名再导出。`);
    }
    return { rows, notes, count, params: paramsNull.length, show: rows.length > 0 || notes.length > 0 };
  })();

  // 第 ⑤ 步点了「去对」→ 到了第 ④ 步：滚到那一行、聚焦它的下拉框、边框亮一下（亮多久见下一个 effect）
  useEffect(() => {
    if (s.step !== "mapping" || !s.mapFocus) return;
    const anchor = s.mapFocus;
    useLive2dUpload.setState({ mapFocus: "" });
    const el = document.getElementById(`map-${anchor}`);
    if (!el) return;
    // 不用 smooth：页面不可见时平滑滚动一下都不动（CLAUDE.md「在看不见的窗口里测」）
    el.scrollIntoView({ block: "center" });
    el.querySelector("select")?.focus({ preventScroll: true });
    setHlRow(anchor);
  }, [s.step, s.mapFocus]);
  useEffect(() => {
    if (!hlRow) return;
    const timer = setTimeout(() => setHlRow(""), 1600);
    return () => clearTimeout(timer);
  }, [hlRow]);

  async function grabCover() {
    useLive2dUpload.setState({ coverBusy: t`正在截图…`, coverErr: "" });
    if (!previewOnStage()) {
      useLive2dUpload.setState({
        coverBusy: "",
        coverErr: t`台上现在不是你的模型（预览没画出来），截下来的会是官方看板娘。先点「重新加载预览」，画出来了再截。`,
      });
      return;
    }
    const blob = await captureStage();
    if (!blob) {
      useLive2dUpload.setState({
        coverBusy: "",
        coverErr: t`没截到画面（模型可能还没画出来）。等预览里的人动起来再点一次，或者用下面的「自己选一张」。`,
      });
      return;
    }
    await uploadCover(blob, "live2d-cover.jpg");
  }

  // 舞台从第 ② 步一直挂到第 ⑥ 步。★ 别在中间摘下来：一是换步骤重挂 = 把模型销毁重建一次（几秒 + 一次贴图上传），
  //   二是第 ⑥ 步「从预览截一张」要有一个**已经加载好的模型**在台上（`snapshot()` 自己补画一帧，
  //   所以 ticker 停着也截得到，但模型被销毁了就什么都没有了）。
  const stageOn = !!s.previewUrl && s.step !== "pick" && s.step !== "done";
  const stepIndex = LIVE2D_STEPS.indexOf(s.step as (typeof LIVE2D_STEPS)[number]);

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader
        sticky
        inset
        onBack={back}
        title={t`上传 Live2D 模型`}
        subtitle={s.file ? s.file.name : t`zip 包 · 最大 25MB`}
        right={
          dirty && s.step !== "done" ? (
            <button type="button" onClick={() => setRestartAsk(true)} disabled={busy} className={`flex-none ${secondaryCls}`}>
              <Trans>重新开始</Trans>
            </button>
          ) : null
        }
      />

      {/* ★ 进度只画这一份（components/StepDots，CLAUDE.md 铁律六）：2026-10-22 替掉原来那行横向滚动的编号芯片。
          发布成功（done）不在 LIVE2D_STEPS 里，画成「全部做完」（全实心、线满），不再把最后一颗当「当前」—— 那一屏正说着发布成功；
          步骤不能点着跳（上传 / 识别是按顺序的），所以不给 onPick */}
      <StepDots
        className="mb-4"
        complete={s.step === "done"}
        current={s.step === "done" ? LIVE2D_STEPS.length - 1 : stepIndex}
        steps={LIVE2D_STEPS.map((k) => ({ label: t(LIVE2D_STEP_LABEL[k]) }))}
      />

      {/* 舞台：② ③ ④ ⑤ 共用同一块（换步骤不重挂，重挂一次就是把模型销毁重建一次） */}
      {stageOn && (
        <section className="mb-3">
          <div className="relative h-[280px] overflow-hidden rounded-xl border border-slate-700/70 bg-slate-950">
            {/* failNote={null}：两套都没出来时舞台不另画一块，下面的失败横幅 + 「重新加载预览」就是这一页的说法 */}
            <SupportStage
              className="absolute inset-0"
              modelUrl={s.previewUrl}
              topPx={0}
              heightFraction={0.9}
              name={t`你的模型`}
              failNote={null}
              onFallback={(f) => markPreviewLoaded(false, previewFailText(f), f.kind !== null)}
            />
            {s.previewState === "loading" && (
              <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
                <span className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-slate-200"><Trans>正在加载这个包…</Trans></span>
              </div>
            )}
          </div>
          <div className="mt-2 space-y-2">
            {s.previewState === "ok" && <Banner tone="ok"><Trans>画出来了。可以摸一摸她、拖一拖看看视线跟不跟手。</Trans></Banner>}
            {s.previewState === "failed" && (
              <Banner tone="bad">
                {s.previewErr ? (
                  <Trans>这个包在手机上画不出来：{s.previewErr} 画不出来的包发布出去别人也用不了，请先修好再传。</Trans>
                ) : (
                  <Trans>这个包在手机上画不出来。画不出来的包发布出去别人也用不了，请先修好再传。</Trans>
                )}
              </Banner>
            )}
            <div className="flex items-center gap-2">
              <button type="button" onClick={reloadPreview} disabled={busy || !s.preview} className={secondaryCls}>
                <Trans>重新加载预览</Trans>
              </button>
              {lastHit.length > 0 && (
                <span className="min-w-0 truncate text-[11px] text-slate-500"><Trans>刚点到：{hitText}</Trans></span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ① 选文件 */}
      {s.step === "pick" && (
        <section className="space-y-3">
          <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
            <FieldLabel><Trans>要带上什么</Trans></FieldLabel>
            <ul className="space-y-1 text-xs leading-relaxed text-slate-400">
              <li><Trans>· 一份 <b className="text-slate-300">*.model3.json</b>（Cubism 4 导出的，Version 3）与它引用的 <b className="text-slate-300">*.moc3</b></Trans></li>
              <li><Trans>· 贴图 png / webp，每张不超过 4096²、最多 4 张</Trans></li>
              <li><Trans>· 想要会转头 / 眨眼 / 说话，模型里得有 ParamAngleX、ParamAngleY、ParamEyeLOpen、ParamEyeROpen、ParamMouthOpenY 这几个标准参数</Trans></li>
              <li><Trans>· 有 physics3 / pose3 / cdi3 / exp3 表情 / motion3 动作也一起压进去，我们会自动接上</Trans></li>
              {/* ★ 量的是 zip 文件本身，不是解压后的总大小（与服务端、与直传票上的 maxSizeBytes 同一把尺） */}
              <li><Trans>· zip 文件本身不超过 {Math.round(MAX_LIVE2D_BUNDLE_BYTES / 1024 / 1024)}MB</Trans></li>
            </ul>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // ★ 立刻清空 value：不清的话选同一个文件第二次不触发 change（改完包想重传的人会以为按钮坏了）
              e.target.value = "";
              if (f) void pickBundle(f);
            }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={primaryCls}>
            {s.file ? t`换一个 zip` : t`选一个 zip`}
          </button>

          {busy && <EmptyState loading text={s.progress || t`正在处理…`} compact />}
          {!!s.readErr && <Banner tone="bad">{s.readErr}</Banner>}

          {s.check && (
            <div className="space-y-2">
              {s.check.issues.map((issue) => (
                <Banner key={issue} tone="bad">
                  {issue}
                </Banner>
              ))}
              {s.check.warnings.map((warning) => (
                <Banner key={warning} tone="warn">
                  {warning}
                </Banner>
              ))}
              {s.check.skipped.length > 0 && (
                <Banner tone="info">
                  {s.check.skipped.length > 3 ? (
                    <Trans>有 {s.check.skipped.length} 个文件不在我们收的类型里，不会被带上（{s.check.skipped.slice(0, 3).join(listSep)} 等）。</Trans>
                  ) : (
                    <Trans>有 {s.check.skipped.length} 个文件不在我们收的类型里，不会被带上（{s.check.skipped.slice(0, 3).join(listSep)}）。</Trans>
                  )}
                </Banner>
              )}
              {s.check.entries.length > 1 && (
                <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
                  <FieldLabel><Trans>包里有 {s.check.entries.length} 个 model3.json，用哪一个？</Trans></FieldLabel>
                  <div className="space-y-1.5">
                    {s.check.entries.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => void buildPreview(p)}
                        disabled={busy}
                        className={`flex w-full items-center gap-2 rounded-xl border p-2.5 text-left disabled:opacity-40 ${
                          p === s.entry ? "border-brand bg-brand/5" : "border-slate-700 bg-panel"
                        }`}
                      >
                        <Icon name="file" size={14} className="shrink-0 text-slate-500" />
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{p}</span>
                        {(s.check?.detail.get(p)?.issues.length ?? 0) > 0 && <span className="shrink-0 text-[10px] text-danger-300"><Trans>有问题</Trans></span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {detail?.issues.map((issue) => (
                <Banner key={issue} tone="bad">
                  {issue}
                </Banner>
              ))}
              {s.check.issues.length === 0 && !!s.entry && (detail?.issues.length ?? 0) === 0 && (
                <button type="button" onClick={() => void buildPreview(s.entry)} disabled={busy} className={primaryCls}>
                  <Trans>下一步：本地预览</Trans>
                </button>
              )}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            <Trans>只传你自己做的、或者已经拿到授权的模型。别人的作品、真人肖像、Live2D 官方示例模型（Hiyori / Haru / Mao 这些）都不收。</Trans>
          </p>
        </section>
      )}

      {/* ② 本地预览 */}
      {s.step === "preview" && (
        <section className="space-y-3">
          <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
            <FieldLabel><Trans>这个包里有什么</Trans></FieldLabel>
            {detail ? (
              <div className="space-y-2 text-xs leading-relaxed text-slate-400">
                <div>
                  <Trans>动作组 {detail.motionGroups.length} 组</Trans>
                  {detail.motionGroups.length > 0 && (
                    <span className="text-slate-500"><Trans>（{detail.motionGroups.map((g) => `${g.name}×${g.count}`).join(listSep)}）</Trans></span>
                  )}
                </div>
                <div>
                  <Trans>表情 {detail.expressions.length} 个</Trans>
                  {detail.expressions.length > 0 && <span className="text-slate-500"><Trans>（{detail.expressions.join(listSep)}）</Trans></span>}
                </div>
                <div>
                  <Trans>命中区 {detail.hitAreas.length} 个</Trans>
                  {detail.hitAreas.length > 0 && <span className="text-slate-500"><Trans>（{detail.hitAreas.join(listSep)}）</Trans></span>}
                </div>
                <div>
                  <Trans>贴图 {detail.textures.length} 张</Trans>
                  <span className="text-slate-500">
                    <Trans>（{texList}）</Trans>
                  </span>
                </div>
                <div>
                  {detail.hasPhysics ? t`物理 有` : t`物理 没有`} · {detail.hasPose ? t`透明度组 有` : t`透明度组 没有`}
                </div>
                <div>
                  {detail.params === null ? (
                    <span className="text-warn-300"><Trans>包里没有 cdi3.json，读不到参数表 —— 下一步交给服务器再看一次。</Trans></span>
                  ) : (
                    <>
                      <Trans>参数 {detail.params.length} 个</Trans>
                      <div className="no-scrollbar mt-1 flex gap-1.5 overflow-x-auto">
                        {detail.params.slice(0, 40).map((p) => (
                          <span key={p.id} className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400">
                            {p.name || p.id}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500"><Trans>没有解析结果。</Trans></p>
            )}
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("pick")} className="flex-1 rounded-xl border border-slate-600 py-2.5 text-sm text-slate-300">
              <Trans>上一步</Trans>
            </button>
            <button
              type="button"
              onClick={() => setStep("inspect")}
              disabled={s.previewState !== "ok"}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：自动识别</Trans>
            </button>
          </div>
          {s.previewState !== "ok" && (
            <p className="text-center text-[11px] text-slate-500">
              {s.previewState === "failed" ? t`画不出来的包发不了。` : t`等她画出来才能继续。`}
            </p>
          )}
        </section>
      )}

      {/* ③ 自动识别 */}
      {s.step === "inspect" && (
        <section className="space-y-3">
          {!s.inspect && !busy && (
            <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
              <FieldLabel><Trans>把包交给服务器看一眼</Trans></FieldLabel>
              <p className="text-xs leading-relaxed text-slate-400">
                <Trans>服务器会解开包、数出它会哪些动作和表情，并给一份自动映射（下一步你可以改）。这一步会把包传上去（约 {(s.file ? s.file.size / 1024 / 1024 : 0).toFixed(1)}MB），传完之后不会立刻公开。</Trans>
              </p>
            </div>
          )}
          {busy && (
            <div className="space-y-2">
              <EmptyState loading text={s.progress || t`正在处理…`} compact />
              {/* ★ `inspect` 也要摆：multipart 那条退路（>15MB 会撞 Cloudflare 125 秒墙的正是它）
                  整个上传期间 busy 都是 "inspect" —— 只在 "upload" 时摆的话，最需要这颗键的那条路上够不着它 */}
              {(s.busy === "upload" || s.busy === "inspect") && (
                <button type="button" onClick={cancelBundleInspect} className={`mx-auto block ${secondaryCls}`}>
                  {s.busy === "upload" ? t`取消上传` : t`取消`}
                </button>
              )}
              <p className="text-center text-[11px] leading-relaxed text-slate-500"><Trans>可以退出这一页去做别的，传完了会有提示。</Trans></p>
            </div>
          )}
          {!!s.inspectErr && <Banner tone="bad">{s.inspectErr}</Banner>}

          {s.inspect && (
            <>
              {!s.directOn && (
                <Banner tone="warn">
                  <Trans>这台服务器还没开直传，刚才走的是慢的那条 —— 包要经过我们的服务器，大包在手机网络上有可能超时。这条路上识别不会把包留下，所以最后<b>发布时还要再传一次</b>。</Trans>
                </Banner>
              )}
              <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
                <FieldLabel><Trans>它会什么</Trans></FieldLabel>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {s.inspect.capabilities.badges.length === 0 ? (
                    <span className="text-xs text-slate-500"><Trans>一个能力角标都没有 —— 装上之后基本上是个不会动的立绘。</Trans></span>
                  ) : (
                    s.inspect.capabilities.badges.map((b) => (
                      <span key={b} className="rounded-full bg-gold/90 px-2 py-0.5 text-[10px] font-semibold text-ink">
                        {live2dBadgeLabel(b)}
                      </span>
                    ))
                  )}
                </div>
                <p className="text-xs leading-relaxed text-slate-400">
                  <Trans>动作 {s.inspect.capabilities.motionCount} 段 / {s.inspect.capabilities.motionGroups.length} 组 · 表情 {s.inspect.capabilities.expressions.length} 个 · 命中区 {s.inspect.capabilities.hitAreas.length} 个 · 贴图 {s.inspect.capabilities.textures.count} 张（最大边 {s.inspect.capabilities.textures.maxSide}px）</Trans>
                </p>
                {!s.inspect.capabilities.paramsKnown && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    <Trans>包里没有 cdi3.json，服务器读不到参数表 —— 这不代表模型没有参数，只是这一屏说不出它们叫什么。</Trans>
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
                <FieldLabel><Trans>完成度</Trans></FieldLabel>
                <div className="space-y-1">
                  {s.inspect.completeness.required.map((r) => (
                    <div key={`req-${r.slot}`} className="flex items-center gap-2 text-xs">
                      {/* 三态：对上了 ✓ / 确实缺 ✗ / 说不出来（没有 cdi3）—— 第三种画成灰问号，不是红叉 */}
                      <Icon
                        name={r.ok === true ? "check" : r.ok === false ? "close" : "info"}
                        size={13}
                        className={r.ok === true ? "text-ok-300" : r.ok === false ? "text-danger-300" : "text-slate-500"}
                      />
                      <span className={r.ok === true ? "text-slate-300" : r.ok === false ? "text-danger-300" : "text-slate-500"}>
                        <Trans>必须 · {slotLabel(r.slot)}</Trans>
                        {r.ok === null && t`（包里没有参数表，看不出来）`}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  <Trans>推荐项 {s.inspect.completeness.recommendedDone}/{s.inspect.completeness.recommendedTotal} 项已具备</Trans>
                </p>
                <div className="no-scrollbar mt-1 flex gap-1.5 overflow-x-auto">
                  {s.inspect.completeness.recommended.map((r) => (
                    <span
                      key={`rec-${r.slot}`}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${r.ok ? "bg-slate-900 text-slate-300" : "bg-slate-900 text-slate-400"}`}
                    >
                      {r.ok ? "✓" : "—"} {slotLabel(r.slot)}
                    </span>
                  ))}
                </div>
              </div>

              {s.inspect.warnings.map((w) => (
                <Banner key={w} tone="warn">
                  {w}
                </Banner>
              ))}
            </>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("preview")} disabled={busy} className="flex-1 rounded-xl border border-slate-600 py-2.5 text-sm text-slate-300 disabled:opacity-40">
              <Trans>上一步</Trans>
            </button>
            {s.inspect ? (
              <button
                type="button"
                onClick={() => setStep("mapping")}
                disabled={missingRequired(s.inspect.completeness.required).length > 0}
                className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                <Trans>下一步：对映射</Trans>
              </button>
            ) : (
              <button type="button" onClick={() => void startBundleInspect()} disabled={busy} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">
                <Trans>开始识别</Trans>
              </button>
            )}
          </div>
          {!!s.inspect && missingRequired(s.inspect.completeness.required).length > 0 && (
            <p className="text-center text-[11px] text-danger-300"><Trans>上面标红的必须项缺了，补齐再重新导出一次包。</Trans></p>
          )}
          {!!s.inspect && !s.inspect.capabilities.paramsKnown && missingRequired(s.inspect.completeness.required).length === 0 && (
            <p className="text-center text-[11px] leading-relaxed text-slate-500">
              <Trans>这个包里没有 cdi3.json，必须项一条都核不了 —— 我们按「标准参数名」放行。装上之后要是不会眨眼 / 不会转头，多半就是参数名不标准，回 Cubism 改成 ParamEyeLOpen 这一套再导一次。</Trans>
            </p>
          )}
        </section>
      )}

      {/* ④ 手动映射 */}
      {s.step === "mapping" && (
        <section className="space-y-3">
          <Banner tone="info">
            <Trans>这一步是把「我们的演出协议」对到「你这个模型自己的名字」上。不改也行 —— 服务器已经按常见命名猜了一份，下面每一行左边的 ▶ 可以当场在上面的预览里试一下。</Trans>
          </Banner>
          {!mapping ? (
            <EmptyState emoji="🤔" text={t`还没有映射可以改`} hint={t`回上一步让服务器先识别一次。`} compact />
          ) : (
            <>
              <div>
                <FieldLabel><Trans>动作</Trans></FieldLabel>
                <div className="space-y-1.5">
                  {ACTIONS.filter((a) => a !== "none").map((a) => {
                    const value = mapping.actions?.[a] ?? "";
                    const actName = t(ACTION_LABEL[a]);
                    return (
                      <MapRow
                        key={a}
                        label={actName}
                        anchor={`a-${a}`}
                        highlight={hlRow === `a-${a}`}
                        disabled={!value}
                        // ★ 与触摸那一行同一个入口（`previewMotionGroup`，判据含"台上是不是我们的包"）——
                        //   此前这里直接调 `companionBus.motionGroup`，预览退回官方看板娘时会对着小梦说
                        //   「这个包里没有它 —— 换一个，或者回 Cubism 重新导出」，而那是一句假话
                        onPlay={() => previewMotionGroup(value)}
                        hint={!value ? t`没对上动作组，这个动作不演` : undefined}
                      >
                        <select
                          value={value}
                          aria-label={t`${actName} 用哪个动作组`}
                          onChange={(e) => patch({ actions: { ...mapping.actions, [a]: e.target.value || null } })}
                          className={selectCls}
                        >
                          <option value="">{t({ message: "不演", context: "Live2D 动作槽：这个语义动作不播任何动作" })}</option>
                          {value && !groups.includes(value) && <option value={value}>{t`${value}（包里没有）`}</option>}
                          {groups.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </MapRow>
                    );
                  })}
                </div>
              </div>

              <div>
                <FieldLabel><Trans>表情</Trans></FieldLabel>
                <p className="mb-1.5 text-xs leading-relaxed text-slate-500">
                  <Trans>选「用通用参数演」= 不挂你的 exp3，改用我们那套参数（眉毛、嘴角、脸红）去凑 —— 模型没有对应表情文件时这条更稳。</Trans>
                </p>
                <div className="space-y-1.5">
                  {FACES.filter((f) => f !== "normal").map((f) => {
                    const cur = mapping.faces?.[f] ?? null;
                    const value = cur?.expression ?? "";
                    const faceName = t(FACE_LABEL[f]);
                    return (
                      <MapRow
                        key={f}
                        label={faceName}
                        // ★ 同上：台上不是我们的包就整句拒，别对着官方看板娘说"这个表情包里没有"
                        onPlay={() => (previewOnStage() ? (value ? companionBus.expression(value) : companionBus.face(f)) : false)}
                      >
                        <select
                          value={value}
                          aria-label={t`${faceName} 用哪个表情`}
                          onChange={(e) =>
                            patch({
                              // ★ null = 退到我们的参数版通用表情（mapping.ts 的 setFace 就是这么读的），
                              //   不是"这个表情不演" —— 两者差一个字，后果相反
                              faces: { ...mapping.faces, [f]: e.target.value ? { expression: e.target.value } : null },
                            })
                          }
                          className={selectCls}
                        >
                          <option value="">{t`用通用参数演`}</option>
                          {value && !expressions.includes(value) && <option value={value}>{t`${value}（包里没有）`}</option>}
                          {expressions.map((x) => (
                            <option key={x} value={x}>
                              {x}
                            </option>
                          ))}
                        </select>
                      </MapRow>
                    );
                  })}
                </div>
              </div>

              <div>
                <FieldLabel><Trans>触摸区</Trans></FieldLabel>
                <p className="mb-1.5 text-xs leading-relaxed text-slate-500">
                  <Trans>左边是模型自己的命中区（HitAreas），右边是摸到这里播哪个动作。想验证对没对上，直接在上面的预览里摸一下 —— 屏幕上会写「刚点到：…」。</Trans>
                </p>
                <div className="space-y-1.5">
                  {TOUCH_AREAS.map((slot) => {
                    const cur = mapping.touch?.[slot] ?? null;
                    // ★★ `hitAreas` 是**数组**：服务端的自动映射可以给一个槽位对上好几个命中区，
                    //   运行时也是按数组判的（`mapping.ts` 的 `t.hitAreas.some(...)`）。此前这一行
                    //   把它截成一条 —— 用户只要动一下这行任一个下拉，其余的就被静默丢掉，
                    //   症状是"装上之后摸头有时没反应"，而向导里既不显示也不报错，
                    //   `mappingTouched` 还因此置真、这份被截过的映射会原样发布出去。
                    const areas = cur?.hitAreas ?? [];
                    const area = areas[0] ?? "";
                    const rest = areas.slice(1);
                    const motion = cur?.motion ?? "";
                    const areaName = t(TOUCH_LABEL[slot]);
                    return (
                      <MapRow
                        key={slot}
                        label={areaName}
                        anchor={`t-${slot}`}
                        highlight={hlRow === `t-${slot}`}
                        disabled={!motion}
                        onPlay={() => (motion ? previewMotionGroup(motion) : false)}
                        hint={
                          !area
                            ? t`没对上命中区，摸这里不会有反应`
                            : rest.length > 0
                              ? t`这个槽位还对着另外 ${rest.length} 个命中区：${rest.join(" / ")}`
                              : undefined
                        }
                      >
                        <select
                          value={area}
                          aria-label={t`${areaName} 对应哪个命中区`}
                          onChange={(e) =>
                            patch({
                              // 只换**第一条**，后面那几条原样留着（见上面 ★★）
                              touch: { ...mapping.touch, [slot]: e.target.value ? { hitAreas: [e.target.value, ...rest], motion: motion || null } : null },
                            })
                          }
                          className={selectCls}
                        >
                          <option value="">{t`没有`}</option>
                          {area && !hitAreas.includes(area) && <option value={area}>{t`${area}（包里没有）`}</option>}
                          {hitAreas.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                        <select
                          value={motion}
                          disabled={!area}
                          aria-label={t`摸${areaName}播哪个动作`}
                          onChange={(e) =>
                            // 改动作不动命中区那一列（`areas` 原样带过去，见上面 ★★）
                            patch({ touch: { ...mapping.touch, [slot]: { hitAreas: areas.length ? areas : [area], motion: e.target.value || null } } })
                          }
                          className={selectCls}
                        >
                          <option value="">{t`只说话`}</option>
                          {motion && !groups.includes(motion) && <option value={motion}>{t`${motion}（包里没有）`}</option>}
                          {groups.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </MapRow>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
                <FieldLabel><Trans>参数（服务器自动对的）</Trans></FieldLabel>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {(Object.keys(STANDARD_PARAMS) as ParamSlot[]).map((slot) => {
                    const id = mapping.params?.[slot];
                    return (
                      <div key={slot} className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
                        <span className="shrink-0 text-slate-400">{t(PARAM_LABEL[slot])}</span>
                        <span className={`min-w-0 truncate ${id ? "text-slate-300" : "text-slate-400"}`}>{id || t`没有`}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  <Trans>参数这一栏这版还不能在 App 里改。对不上的话去 Cubism 里把参数 id 改成标准名（ParamAngleX 这一套）再导出一次。</Trans>
                </p>
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={resetMapping} disabled={!s.mappingTouched} className={`flex-1 rounded-xl border border-slate-600 py-2.5 text-sm text-slate-300 disabled:opacity-40`}>
                  <Trans>恢复自动映射</Trans>
                </button>
                <button type="button" onClick={() => setStep("verify")} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">
                  <Trans>下一步：试跑</Trans>
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ⑤ 验收试跑 */}
      {s.step === "verify" && (
        <section className="space-y-3">
          <Banner tone="info"><Trans>按顺序演一遍：说话对口型、眨眼、每个对上的动作 / 表情 / 触摸区各来一次，边演边自动量她动没动（整轮大约 {verifyEtaSecs} 秒）。也盯着上面那块看。</Trans></Banner>

          {/* 这几样装上之后不会演（按当前映射现算，见 gapView 的 ★）。整块提示条：带「去对」的多行清单不是 <Warn> 那种一两句 */}
          {gapView.show && (
            <div className="rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs leading-relaxed text-warn-300">
              <div className="font-semibold text-warn-200"><Trans>这几样装上之后不会演，别人用的时候也一样：</Trans></div>
              {gapView.rows.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {gapView.rows.map((g) => (
                    <li key={g.slot} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <b className="font-semibold text-slate-100">{slotLabel(g.slot)}</b> · {g.what}
                      </span>
                      {!!g.anchor && (
                        <button
                          type="button"
                          onClick={() => useLive2dUpload.setState({ mapFocus: g.anchor, step: "mapping" })}
                          disabled={!!s.verifyNow}
                          className="shrink-0 rounded-full border border-warn-500/40 px-2.5 py-1 text-[11px] font-semibold text-warn-200 disabled:opacity-40"
                        >
                          <Trans>去对</Trans>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {gapView.notes.map((note) => (
                <div key={note} className="mt-1.5">
                  {note}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
            <div className="space-y-1">
              {s.verifyNow === baselineLabel && (
                <div className="flex items-center gap-2 text-xs">
                  <Spinner size="xs" />
                  <span className="text-brand">{baselineLabel}</span>
                </div>
              )}
              {verifyItems.map((it) => {
                const done = s.verifyDone.includes(it.key);
                const still = s.verifyWarn.includes(it.key);
                const unknown = s.verifyUnknown.includes(it.key);
                const now = s.verifyNow === it.label;
                return (
                  <div key={it.key} className="flex items-center gap-2 text-xs">
                    {now ? (
                      <Spinner size="xs" />
                    ) : still ? (
                      <Icon name="alert" size={13} className="shrink-0 text-warn-300" />
                    ) : unknown ? (
                      <Icon name="info" size={13} className="shrink-0 text-slate-400" />
                    ) : (
                      <Icon name="check" size={13} className={`shrink-0 ${done ? "text-ok-300" : "text-slate-700"}`} />
                    )}
                    <span className={`min-w-0 flex-1 ${now ? "text-brand" : done ? "text-slate-300" : "text-slate-500"}`}>{it.label}</span>
                    {still && !now && <span className="shrink-0 text-[11px] text-warn-300"><Trans>看不出变化</Trans></span>}
                    {unknown && !now && <span className="shrink-0 text-[11px] text-slate-400"><Trans>没量到</Trans></span>}
                  </div>
                );
              })}
            </div>
            {/* ★ 试跑进行中不摆这句：照着它去摸，那一下会让接下来两秒里开演的动作项改播触摸区的动作（companionModel.stopMotions 的 ★） */}
            {!s.verifyNow && verifyItems.some((it) => it.key.startsWith("t:") && it.measure) && (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                <Trans>触摸那几项只试播了它对上的动作；命中区对没对上量不到 —— 试跑跑完之后，自己在上面的预览里摸一下（会写「刚点到：…」）。</Trans>
              </p>
            )}
            {/* ⚠ 的原因按是哪一类分开说：动作 / 表情是包里那段动作 / 表情的事，说话 / 眨眼是嘴 / 眼参数的事（见 warnSplit） */}
            {warnSplit.motion > 0 && (
              <Warn className="mt-2">
                <Trans>动作 / 表情标「看不出变化」是自动量出来的（可能误判）：演的时候模型几乎没动。多半是这个动作组 / 表情写给了模型里没有的参数；标着「通用参数」的表情，也可能是被模型自己的待机动作每一帧盖住了；也可能它本来就动得很轻 —— 回去换一个，或者盯着上面再看一眼。不拦发布。</Trans>
              </Warn>
            )}
            {warnSplit.own > 0 && (
              <Warn className="mt-2">
                <Trans>「说一句话」「眨一下眼」标「看不出变化」，是这个模型的嘴 / 眼睛参数没对上，或者被它自己的动作每一帧盖住了 —— 跟动作组无关，App 里也改不了，得回 Cubism 改参数名、或者把动作里的嘴 / 眼曲线去掉。不拦发布。</Trans>
              </Warn>
            )}
            {s.verifyUnknown.length > 0 && (
              <Warn tone="info" className="mt-2">
                {s.verifyPinFail ? (
                  <Trans>这个模型的待机动作固定不住（试跑要拿同一段待机来比），动作 / 表情标了「没量到」—— 再跑一遍也一样，盯着上面那块看她动没动就行。</Trans>
                ) : s.verifyNoBase ? (
                  <Trans>演之前那段对比没采到足够的画面，动作 / 表情那几项没法比，标了「没量到」：页面当时多半在后台。回到前台再跑一遍。</Trans>
                ) : (
                  <Trans>标「没量到」的那几项没采到足够的画面：页面当时多半在后台。回到前台再跑一遍。</Trans>
                )}
              </Warn>
            )}
          </div>

          {/* 继续之前把还没解决的照实说一句（不拦，由人决定）—— 一条一行，三种情况各自成句 */}
          {(gapView.count > 0 || gapView.params > 0 || s.verifyWarn.length > 0 || (!s.verifyOk && (unrun > 0 || !s.verifyDone.length))) && (
            <Warn>
              {gapView.count > 0 && (
                <span className="block">
                  <Trans>{gapView.count} 项装上之后不会演。</Trans>
                </span>
              )}
              {gapView.params > 0 && (
                <span className="block">
                  <Trans>{gapView.params} 个参数没对上，用到它们的那部分演出不会动。</Trans>
                </span>
              )}
              {s.verifyWarn.length > 0 && (
                <span className="block">
                  <Trans>{s.verifyWarn.length} 项看不出变化。</Trans>
                </span>
              )}
              {!s.verifyOk && (unrun > 0 || !s.verifyDone.length) && (
                <span className="block">{s.verifyDone.length > 0 ? t`还有 ${unrun} 项没试。` : t`还没试跑。`}</span>
              )}
            </Warn>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (s.verifyNow) stopVerify();
                else void runVerify();
              }}
              // ★ 与第 ② 步同一道闸：预览没画出来时试跑只会在官方看板娘身上演一遍并打满 ✓
              disabled={!s.verifyNow && s.previewState !== "ok"}
              className="flex-1 rounded-xl border border-brand/60 py-2.5 text-sm font-semibold text-brand disabled:opacity-40"
            >
              {s.verifyNow ? t`■ 停下` : s.verifyDone.length ? t`▶ 再跑一遍` : t`▶ 开始试跑`}
            </button>
            {/* ★ 只换步骤，不再写 verifyOk（2026-10-26）：原来这里一点就置真，一项没跑第 ⑥ 步也写「试跑过了（0 项）」。
                verifyOk 只由 runVerify 完整跑完一遍置真；键上的字照实说现在是哪种情况 */}
            <button
              type="button"
              onClick={() => setStep("publish")}
              disabled={!!s.verifyNow}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {s.verifyOk
                ? s.verifyWarn.length || s.verifyUnknown.length
                  ? t`知道了，继续`
                  : t`没问题，继续`
                : s.verifyDone.length
                  ? t`没跑完，先继续`
                  : t`跳过试跑，继续`}
            </button>
          </div>
          {s.previewState !== "ok" && !s.verifyNow && (
            <p className="text-center text-[11px] leading-relaxed text-slate-500">
              <Trans>预览没画出来，试跑跑不了 —— 跑了也只是在官方看板娘身上演一遍。先点上面的「重新加载预览」。</Trans>
            </p>
          )}
          <button type="button" onClick={() => setStep("mapping")} disabled={!!s.verifyNow} className={`mx-auto block ${secondaryCls}`}>
            <Trans>回去改映射</Trans>
          </button>
        </section>
      )}

      {/* ⑥ 发布信息 */}
      {s.step === "publish" && (
        <section className="space-y-3">
          {/* 四档照实说（2026-10-26）：完整跑完没问题 / 跑完了但有看不出变化或没量到的 / 只跑了一部分 / 一项没跑 */}
          {s.verifyOk && !s.verifyWarn.length && !s.verifyUnknown.length ? (
            <Banner tone="ok"><Trans>试跑过了（{s.verifyDone.length} 项）。</Trans></Banner>
          ) : s.verifyOk && s.verifyWarn.length ? (
            <Banner tone="warn"><Trans>试跑过了，但有 {s.verifyWarn.length} 项看不出变化，装上之后可能不会演。</Trans></Banner>
          ) : s.verifyOk && s.verifyPinFail ? (
            <Banner tone="warn"><Trans>试跑过了，但有 {s.verifyUnknown.length} 项没量到（待机动作固定不住，没法自动量，要靠眼睛看）。</Trans></Banner>
          ) : s.verifyOk ? (
            <Banner tone="warn"><Trans>试跑过了，但有 {s.verifyUnknown.length} 项没量到（页面当时多半在后台）。</Trans></Banner>
          ) : s.verifyDone.length ? (
            <Banner tone="warn"><Trans>只试了 {s.verifyDone.length}/{verifyItems.length} 项。发之前建议回上一步跑完，看看动作和表情是不是真的都能演。</Trans></Banner>
          ) : (
            <Banner tone="warn"><Trans>还没试跑过。发之前建议回上一步跑一遍，看看动作和表情是不是真的都能演。</Trans></Banner>
          )}
          <div>
            <FieldLabel><Trans>名字</Trans></FieldLabel>
            <input value={s.name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t`别人在市场里看到的名字`} className={inputCls} />
          </div>

          <div>
            <FieldLabel><Trans>封面</Trans></FieldLabel>
            {s.coverUrl ? (
              <img src={s.coverUrl} alt={t`封面`} className="mb-2 h-40 w-full rounded-xl border border-slate-700/70 object-cover" />
            ) : (
              <p className="mb-2 text-xs text-slate-500"><Trans>不给封面也能发，市场里会是一块空的卡面。</Trans></p>
            )}
            <input
              ref={coverRef}
              type="file"
              // ★ 不写 image/*：部分安卓会放进 HEIC，而服务端只收 jpeg/png/gif/webp（uploads.ts 那条注释）。
              //   大小那道闸在 `uploadCover` 里（一处实现），这里只挡类型
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadCover(f, f.name || "cover.jpg");
              }}
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => void grabCover()} disabled={!!s.coverBusy} className={secondaryCls}>
                <Trans>从预览截一张</Trans>
              </button>
              <button type="button" onClick={() => coverRef.current?.click()} disabled={!!s.coverBusy} className={secondaryCls}>
                <Trans>自己选一张</Trans>
              </button>
            </div>
            {!!s.coverBusy && <p className="mt-1 text-xs text-slate-500">{s.coverBusy}</p>}
            {!!s.coverErr && <p className="mt-1 text-xs leading-relaxed text-danger-300">{s.coverErr}</p>}
          </div>

          <div>
            <FieldLabel><Trans>简介</Trans></FieldLabel>
            <textarea
              value={s.desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder={t`画风、适合配什么人格、有哪些动作可以摸出来…`}
              className={`${inputCls} resize-none leading-relaxed`}
            />
          </div>

          <div>
            <FieldLabel><Trans>标签</Trans></FieldLabel>
            <TagInput tags={s.tags} onChange={setTags} max={TAG_MAX} maxLen={VIDEO_TAG_LEN} split={parseTags} />
          </div>

          <RecommendPickers />

          <div>
            <FieldLabel><Trans>谁能用</Trans></FieldLabel>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-panel p-1">
              {[
                { on: true, label: t`公开到市场`, hint: t`别人能搜到、能下载来用` },
                { on: false, label: t`只有我自己`, hint: t`只出现在你的「我的」里` },
              ].map((o) => (
                <button
                  key={String(o.on)}
                  type="button"
                  aria-pressed={s.shared === o.on}
                  onClick={() => setShared(o.on)}
                  className={`rounded-lg py-2 text-sm ${s.shared === o.on ? "bg-brand font-semibold text-ink" : "text-slate-300"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{s.shared ? t`别人能搜到、能下载来用；随时可以改回私有。` : t`只出现在你的「我的」里，别人看不到。`}</p>
          </div>

          <label className="flex items-start gap-2.5 rounded-xl border border-slate-700/70 bg-panel p-3">
            <input type="checkbox" checked={s.selfMade} onChange={(e) => setSelfMade(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand" />
            <span className="min-w-0 text-xs leading-relaxed text-slate-300">
              <Trans><b className="text-slate-100">我确认：</b><br />· 这个模型是我做的，或者我已经拿到作者授权；<br />· 我没有上传他人作品、真人肖像，也没有上传 Live2D 官方示例模型；<br />· 违规的内容会被下架，情节严重的可能会封号。</Trans>
            </span>
          </label>

          {!!s.publishErr && <Banner tone="bad">{s.publishErr}</Banner>}
          {busy && <EmptyState loading text={s.progress || t`正在发布…`} compact />}

          {/* ★ 封面还在截 / 在传的时候不许发（2026-09-18 发版复核抓到）：发布读的是那一拍的 coverUrl，
              封面还没回来就发出去，这个模型在市场里就没有封面 —— 而屏幕上刚刚还显示着「正在上传封面…」 */}
          <button type="button" onClick={() => void submitLive2dModel()} disabled={busy || !!s.coverBusy || !s.name.trim() || !s.selfMade} className={primaryCls}>
            <Trans>发布</Trans>
          </button>
          {!s.selfMade && <p className="text-center text-[11px] text-slate-500"><Trans>勾上上面那三条才能发布。</Trans></p>}
          {s.selfMade && !!s.coverBusy && <p className="text-center text-[11px] text-slate-500"><Trans>封面还在处理，等它好了再发布。</Trans></p>}
          <button type="button" onClick={() => setStep("verify")} disabled={busy} className={`mx-auto block ${secondaryCls}`}>
            <Trans>上一步</Trans>
          </button>
        </section>
      )}

      {/* 成功页 */}
      {s.step === "done" && s.created && (
        <section className="space-y-3">
          <EmptyState emoji="🎉" title={t`「${s.created.name}」发布好了`} text={s.shared ? t`已经公开到形象市场，别人能搜到它了。` : t`已经存进「我的」，只有你能看到。`} />
          {s.inspect?.warnings.map((w) => (
            <Banner key={w} tone="warn">
              {w}
            </Banner>
          ))}
          <button
            type="button"
            onClick={() => {
              resetLive2dDraft();
              // 终点页用 replace：别把这一屏留在历史栈里，否则从市场按返回会回到一个已经发完的向导
              navigate("/support/models?tab=mine", { replace: true });
            }}
            className={primaryCls}
          >
            <Trans>去看看</Trans>
          </button>
          <button type="button" onClick={() => resetLive2dDraft()} className={`mx-auto block ${secondaryCls}`}>
            <Trans>再传一个</Trans>
          </button>
        </section>
      )}

      {restartAsk && (
        <ConfirmDialog
          title={t`重新开始？`}
          confirmLabel={t`重新开始`}
          danger
          onClose={() => setRestartAsk(false)}
          onConfirm={() => {
            setRestartAsk(false);
            resetLive2dDraft();
          }}
        >
          {s.bundleRef ? (
            <Trans>这一页填的东西会清空，已经选的包也要重新选一次。刚才传上去的那一份也不会变成模型，要重新走一遍上传和识别。</Trans>
          ) : (
            <Trans>这一页填的东西会清空，已经选的包也要重新选一次。</Trans>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
