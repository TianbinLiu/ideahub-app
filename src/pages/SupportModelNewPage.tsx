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
 * ★ 没有 i18n，全中文内联。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import ConfirmDialog from "../components/ConfirmDialog";
import EmptyState from "../components/EmptyState";
import Icon from "../components/Icon";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import TagInput from "../components/TagInput";
import SupportStage from "../components/support/SupportStage";
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
import { MAX_LIVE2D_BUNDLE_BYTES } from "../api/uploads";
import { LIVE2D_BADGE_LABEL, type CompanionMappingWire } from "../api/companion";
import { VIDEO_TAG_LEN, parseTags } from "../types";
import {
  LIVE2D_STEPS,
  LIVE2D_STEP_LABEL,
  buildPreview,
  cancelBundleInspect,
  live2dDraftBusy,
  live2dDraftDirty,
  markPreviewLoaded,
  markVerified,
  patchMapping,
  previewMotionGroup,
  reloadPreview,
  resetLive2dDraft,
  resetMapping,
  pickBundle,
  startBundleInspect,
  submitLive2dModel,
  uploadCover,
  useLive2dUpload,
  useUploadField,
} from "../studio/live2dUploadStore";

// ── 槽位的中文名（界面文案，不是规则：枚举本身一律从 protocol.ts / mapping.ts 取，别在这儿抄第二份） ──
const ACTION_LABEL: Record<CompanionAction, string> = {
  none: "不演",
  acknowledge: "点头 · 赞同",
  disagree: "摇头 · 否定",
  think: "思考",
  explain: "讲解",
  excited: "兴奋",
  wave: "挥手",
  shy: "害羞",
  surprised: "吃惊",
  comfort: "安慰",
  playful: "调皮",
};
const FACE_LABEL: Record<CompanionFace, string> = {
  normal: "平静",
  happy: "开心",
  laughing: "大笑",
  angry: "生气",
  sad: "难过",
  crying: "哭",
  shy: "害羞",
  tease: "坏笑",
  cuddle: "撒娇",
};
const TOUCH_LABEL: Record<TouchArea, string> = {
  Head: "头",
  Hair: "头发",
  HandL: "左手",
  HandR: "右手",
  ArmL: "左臂",
  ArmR: "右臂",
  Body: "身体",
  Skirt: "裙子",
  Legs: "腿",
};
const PARAM_LABEL: Record<ParamSlot, string> = {
  mouthOpen: "张嘴",
  mouthForm: "嘴形",
  eyeL: "左眼",
  eyeR: "右眼",
  eyeBallX: "眼球左右",
  eyeBallY: "眼球上下",
  angleX: "头左右",
  angleY: "头上下",
  angleZ: "头倾斜",
  bodyX: "身体左右",
  breath: "呼吸",
  cheek: "脸红",
};

/** 标签上限：产品口径，**有意小于服务端的安全上界**（CLAUDE.md「把客户端上限与服务端对齐」那条坑） */
const TAG_MAX = 8;
/** 预览多久还没画出来就当它失败（模型在手机上解包 + 传贴图，实测几秒；45 秒是给最慢的那台留的余量） */
const PREVIEW_TIMEOUT_MS = 45_000;

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand";
const primaryCls = "w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40";
const secondaryCls = "rounded-full border border-slate-600 px-4 py-1.5 text-xs text-slate-300 disabled:opacity-40";
const selectCls =
  "h-9 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 outline-none focus:border-brand disabled:opacity-40";

function Banner({ tone, children }: { tone: "ok" | "warn" | "bad" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
        : tone === "bad"
          ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
          : "border-sky-500/40 bg-sky-500/10 text-sky-200";
  return <p className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${cls}`}>{children}</p>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-sm font-semibold text-slate-300">{children}</div>;
}

/**
 * 映射表里的一行：左边一颗 ▶（在预览里当场演一下），右边一到两个下拉。
 * ★ ▶ 按下之后 2.3 秒内运行时会压制下一个语义动作（`TIMING.actionSuppressMs`），这期间再点是**静默无效**的 ——
 *   所以按钮自己数着这 2.3 秒并写「播放中…」，否则用户只会以为这个组是坏的。
 */
function MapRow({
  label,
  hint,
  disabled,
  onPlay,
  children,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  onPlay?: () => void;
  children: React.ReactNode;
}) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setPlaying(false), TIMING.actionSuppressMs);
    return () => clearTimeout(t);
  }, [playing]);
  return (
    <div className="rounded-xl border border-slate-700/70 bg-panel px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setPlaying(true);
            onPlay?.();
          }}
          disabled={disabled || playing || !onPlay}
          aria-label={`试演 ${label}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-brand disabled:opacity-40"
        >
          <Icon name="play" size={13} filled />
        </button>
        <div className="w-16 shrink-0 truncate text-xs font-semibold text-slate-300">{label}</div>
        {children}
      </div>
      {(hint || playing) && (
        <p className="mt-1 pl-10 text-[10px] leading-relaxed text-slate-500">{playing ? "播放中…（2.3 秒内点也不会再演）" : hint}</p>
      )}
    </div>
  );
}

/**
 * 从舞台画布截一张当封面。
 *
 * ★★ 为什么要连着抓好几帧：舞台那台 pixi 的 `Application` **没开** `preserveDrawingBuffer`
 *   （companionModel.ts 建的，本页改不了它），WebGL 的绘制缓冲在合成之后就被清掉 ——
 *   随便挑个时刻 `drawImage(canvas)` 拿到的是**全透明**（导出成 JPEG 就是一整块纯色）。
 *   只有在「pixi 这一帧已经画完、浏览器还没合成」的窗口里读才有像素，而 pixi 的 ticker 是在
 *   rAF 里重新排队的、跟我们的 rAF 谁先谁后不固定。所以：连抓 10 帧，每帧扫一遍不透明像素，
 *   抓到有东西的那一帧就用它；10 帧都空就**如实说截不到**，请用户自己选一张图。
 *   （对照：工坊导演台那块画布是自己建的、开了 `preserveDrawingBuffer`，所以那边一次就截到。）
 * ★ 垫一层底色再导出：JPEG 没有透明通道，不垫的话透明处会变成纯黑。底色用 `ink` 的色值。
 * ★★ **每一帧都带上限**（CLAUDE.md 坑表「等媒体事件不带上限」）：2026-09-07 实测，在一个看不见 / 不合成的
 *   窗口里 `requestAnimationFrame` 可以**一次都不来**（`document.visibilityState` 还写着 "visible"）。
 *   裸 `await rAF` 会让这颗按钮永远停在「正在截图…」，而用户唯一能做的是把整页关掉。
 */
const FRAME_WAIT_MS = 80;

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const fin = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(fin);
    setTimeout(fin, FRAME_WAIT_MS);
  });
}

async function captureStage(): Promise<Blob | null> {
  const canvas = companionBus.model?.canvas;
  if (!canvas || !canvas.width || !canvas.height) return null;
  const w = Math.min(720, canvas.width);
  const h = Math.max(1, Math.round((canvas.height / canvas.width) * w));
  const probe = document.createElement("canvas");
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  for (let i = 0; i < 10; i++) {
    await nextFrame();
    ctx.clearRect(0, 0, w, h);
    try {
      ctx.drawImage(canvas, 0, 0, w, h);
    } catch {
      return null; // 画布被污染（不该发生：贴图都是同源 blob）
    }
    const data = ctx.getImageData(0, 0, w, h).data;
    let opaque = 0;
    let sampled = 0;
    for (let p = 3; p < data.length; p += 4 * 7) {
      sampled++;
      if (data[p] > 16) opaque++;
    }
    // 2%：模型在舞台上占的面积远大于此；再低会把"几个抗锯齿边缘像素"当成画出来了
    if (sampled > 0 && opaque / sampled > 0.02) {
      const shot = document.createElement("canvas");
      shot.width = w;
      shot.height = h;
      const out = shot.getContext("2d");
      if (!out) return null;
      out.fillStyle = "#0b1020"; // = tailwind 的 ink
      out.fillRect(0, 0, w, h);
      out.drawImage(canvas, 0, 0, w, h);
      return await new Promise<Blob | null>((res) => shot.toBlob(res, "image/jpeg", 0.86));
    }
  }
  return null;
}

export default function SupportModelNewPage() {
  const navigate = useNavigate();
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
  const [restartAsk, setRestartAsk] = useState(false);
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
      verifyRunning.current = false;
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
        markPreviewLoaded(false, `等了 ${PREVIEW_TIMEOUT_MS / 1000} 秒还没画出来。包可能太大，或者贴图 / moc3 有问题。`);
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

  /** 验收脚本：一项一项演，演完自动打勾。人点了停就停在当前这一项（不清已经打过的勾） */
  const verifyItems = useMemo(() => {
    const items: { key: string; label: string; run: () => void; waitMs: number }[] = [
      { key: "speak", label: "说一句话，看嘴动没动", run: () => companionBus.speakSynthetic(2200), waitMs: 2600 },
      { key: "blink", label: "眨眼（她自己会眨，盯 3 秒）", run: () => undefined, waitMs: 3000 },
    ];
    for (const a of ACTIONS) {
      if (a === "none") continue;
      const g = mapping?.actions?.[a];
      if (!g) continue;
      items.push({
        key: `a:${a}`,
        label: `动作「${ACTION_LABEL[a]}」→ ${g}`,
        run: () => companionBus.action(a),
        waitMs: TIMING.actionSuppressMs + 300,
      });
    }
    for (const f of FACES) {
      if (f === "normal") continue;
      const m = mapping?.faces?.[f];
      if (!m) continue;
      items.push({
        key: `f:${f}`,
        label: `表情「${FACE_LABEL[f]}」→ ${m.expression || "参数版"}`,
        run: () => companionBus.face(f),
        waitMs: 1800,
      });
    }
    for (const t of TOUCH_AREAS) {
      const m = mapping?.touch?.[t];
      if (!m) continue;
      items.push({
        key: `t:${t}`,
        label: `摸「${TOUCH_LABEL[t]}」→ ${m.motion || "只说话、不播动作"}`,
        run: () => (m.motion ? previewMotionGroup(m.motion) : undefined),
        waitMs: m.motion ? TIMING.actionSuppressMs + 300 : 600,
      });
    }
    return items;
  }, [mapping]);

  async function runVerify() {
    if (verifyRunning.current) return;
    verifyRunning.current = true;
    useLive2dUpload.setState({ verifyDone: [], verifyOk: false });
    for (const it of verifyItems) {
      if (!verifyRunning.current) break;
      useLive2dUpload.setState({ verifyNow: it.label });
      it.run();
      await new Promise((r) => setTimeout(r, it.waitMs));
      if (!verifyRunning.current) break;
      markVerified(it.key);
    }
    companionBus.stopSpeaking();
    companionBus.face("normal");
    verifyRunning.current = false;
    useLive2dUpload.setState({ verifyNow: "" });
  }

  async function grabCover() {
    useLive2dUpload.setState({ coverBusy: "正在截图…", coverErr: "" });
    const blob = await captureStage();
    if (!blob) {
      useLive2dUpload.setState({
        coverBusy: "",
        coverErr: "这台设备上截不到舞台画面（画布不保留帧缓冲）。用下面的「自己选一张」传一张图当封面吧。",
      });
      return;
    }
    await uploadCover(blob, "live2d-cover.jpg");
  }

  // 舞台从第 ② 步一直挂到第 ⑥ 步。★ 别在中间摘下来：一是换步骤重挂 = 把模型销毁重建一次（几秒 + 一次贴图上传），
  //   二是第 ⑥ 步「从预览截一张」需要它**正在渲染** —— detach() 之后 ticker 是停的，截出来必然是空的。
  const stageOn = !!s.previewUrl && s.step !== "pick" && s.step !== "done";
  const stepIndex = LIVE2D_STEPS.indexOf(s.step as (typeof LIVE2D_STEPS)[number]);

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader
        sticky
        inset
        onBack={back}
        title="上传 Live2D 模型"
        subtitle={s.file ? s.file.name : "zip 包 · 最大 25MB"}
        right={
          dirty && s.step !== "done" ? (
            <button type="button" onClick={() => setRestartAsk(true)} disabled={busy} className={`flex-none ${secondaryCls}`}>
              重新开始
            </button>
          ) : null
        }
      />

      {/* 步骤条：横向滚动一行（安卓 WebView 上不加 no-scrollbar 会在行下方闪一条滚动条） */}
      {s.step !== "done" && (
        <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto">
          {LIVE2D_STEPS.map((k, i) => (
            <span
              key={k}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] ${
                k === s.step ? "bg-brand font-semibold text-ink" : i < stepIndex ? "bg-panel text-slate-300" : "bg-panel text-slate-500"
              }`}
            >
              {i + 1}. {LIVE2D_STEP_LABEL[k]}
            </span>
          ))}
        </div>
      )}

      {/* 舞台：② ③ ④ ⑤ 共用同一块（换步骤不重挂，重挂一次就是把模型销毁重建一次） */}
      {stageOn && (
        <section className="mb-3">
          <div className="relative h-[280px] overflow-hidden rounded-xl border border-slate-700/70 bg-slate-950">
            <SupportStage className="absolute inset-0" modelUrl={s.previewUrl} topPx={0} heightFraction={0.9} onFallback={(r) => markPreviewLoaded(false, r)} />
            {s.previewState === "loading" && (
              <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
                <span className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-slate-200">正在加载这个包…</span>
              </div>
            )}
          </div>
          <div className="mt-2 space-y-2">
            {s.previewState === "ok" && <Banner tone="ok">画出来了。可以摸一摸她、拖一拖看看视线跟不跟手。</Banner>}
            {s.previewState === "failed" && (
              <Banner tone="bad">
                这个包在手机上画不出来{s.previewErr ? `：${s.previewErr}` : "。"}
                {" "}
                画不出来的包发布出去别人也用不了，请先修好再传。
              </Banner>
            )}
            <div className="flex items-center gap-2">
              <button type="button" onClick={reloadPreview} disabled={busy || !s.preview} className={secondaryCls}>
                重新加载预览
              </button>
              {lastHit.length > 0 && (
                <span className="min-w-0 truncate text-[11px] text-slate-500">刚点到：{lastHit.map((a) => TOUCH_LABEL[a as TouchArea] || a).join(" / ")}</span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ① 选文件 */}
      {s.step === "pick" && (
        <section className="space-y-3">
          <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
            <FieldLabel>要带上什么</FieldLabel>
            <ul className="space-y-1 text-xs leading-relaxed text-slate-400">
              <li>· 一份 <b className="text-slate-300">*.model3.json</b>（Cubism 4 导出的，Version 3）与它引用的 <b className="text-slate-300">*.moc3</b></li>
              <li>· 贴图 png / webp，每张不超过 4096²、最多 4 张</li>
              <li>· 想要会转头 / 眨眼 / 说话，模型里得有 ParamAngleX、ParamAngleY、ParamEyeLOpen、ParamEyeROpen、ParamMouthOpenY 这几个标准参数</li>
              <li>· 有 physics3 / pose3 / cdi3 / exp3 表情 / motion3 动作也一起压进去，我们会自动接上</li>
              <li>· 整包解压后不超过 {Math.round(MAX_LIVE2D_BUNDLE_BYTES / 1024 / 1024)}MB</li>
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
            {s.file ? "换一个 zip" : "选一个 zip"}
          </button>

          {busy && <EmptyState loading text={s.progress || "正在处理…"} compact />}
          {!!s.readErr && <Banner tone="bad">{s.readErr}</Banner>}

          {s.check && (
            <div className="space-y-2">
              {s.check.issues.map((t) => (
                <Banner key={t} tone="bad">
                  {t}
                </Banner>
              ))}
              {s.check.warnings.map((t) => (
                <Banner key={t} tone="warn">
                  {t}
                </Banner>
              ))}
              {s.check.skipped.length > 0 && (
                <Banner tone="info">
                  有 {s.check.skipped.length} 个文件不在我们收的类型里，不会被带上（{s.check.skipped.slice(0, 3).join("、")}
                  {s.check.skipped.length > 3 ? " 等" : ""}）。
                </Banner>
              )}
              {s.check.entries.length > 1 && (
                <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
                  <FieldLabel>包里有 {s.check.entries.length} 个 model3.json，用哪一个？</FieldLabel>
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
                        {(s.check?.detail.get(p)?.issues.length ?? 0) > 0 && <span className="shrink-0 text-[10px] text-rose-300">有问题</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {detail?.issues.map((t) => (
                <Banner key={t} tone="bad">
                  {t}
                </Banner>
              ))}
              {s.check.issues.length === 0 && !!s.entry && (detail?.issues.length ?? 0) === 0 && (
                <button type="button" onClick={() => void buildPreview(s.entry)} disabled={busy} className={primaryCls}>
                  下一步：本地预览
                </button>
              )}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            只传你自己做的、或者已经拿到授权的模型。别人的作品、真人肖像、Live2D 官方示例模型（Hiyori / Haru / Mao 这些）都不收。
          </p>
        </section>
      )}

      {/* ② 本地预览 */}
      {s.step === "preview" && (
        <section className="space-y-3">
          <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
            <FieldLabel>这个包里有什么</FieldLabel>
            {detail ? (
              <div className="space-y-2 text-xs leading-relaxed text-slate-400">
                <div>
                  动作组 {detail.motionGroups.length} 组
                  {detail.motionGroups.length > 0 && (
                    <span className="text-slate-500">（{detail.motionGroups.map((g) => `${g.name}×${g.count}`).join("、")}）</span>
                  )}
                </div>
                <div>
                  表情 {detail.expressions.length} 个{detail.expressions.length > 0 && <span className="text-slate-500">（{detail.expressions.join("、")}）</span>}
                </div>
                <div>
                  命中区 {detail.hitAreas.length} 个{detail.hitAreas.length > 0 && <span className="text-slate-500">（{detail.hitAreas.join("、")}）</span>}
                </div>
                <div>
                  贴图 {detail.textures.length} 张
                  <span className="text-slate-500">
                    （{detail.textures.map((t) => (t.width ? `${t.width}×${t.height}` : "尺寸没量出来")).join("、")}）
                  </span>
                </div>
                <div>
                  物理 {detail.hasPhysics ? "有" : "没有"} · 透明度组 {detail.hasPose ? "有" : "没有"}
                </div>
                <div>
                  {detail.params === null ? (
                    <span className="text-amber-300">包里没有 cdi3.json，读不到参数表 —— 下一步交给服务器再看一次。</span>
                  ) : (
                    <>
                      参数 {detail.params.length} 个
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
              <p className="text-xs text-slate-500">没有解析结果。</p>
            )}
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("pick")} className="flex-1 rounded-xl border border-slate-600 py-2.5 text-sm text-slate-300">
              上一步
            </button>
            <button
              type="button"
              onClick={() => setStep("inspect")}
              disabled={s.previewState !== "ok"}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              下一步：自动识别
            </button>
          </div>
          {s.previewState !== "ok" && (
            <p className="text-center text-[11px] text-slate-500">
              {s.previewState === "failed" ? "画不出来的包发不了。" : "等她画出来才能继续。"}
            </p>
          )}
        </section>
      )}

      {/* ③ 自动识别 */}
      {s.step === "inspect" && (
        <section className="space-y-3">
          {!s.inspect && !busy && (
            <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
              <FieldLabel>把包交给服务器看一眼</FieldLabel>
              <p className="text-xs leading-relaxed text-slate-400">
                服务器会解开包、数出它会哪些动作和表情，并给一份自动映射（下一步你可以改）。这一步会把包传上去
                （约 {(s.file ? s.file.size / 1024 / 1024 : 0).toFixed(1)}MB），传完之后不会立刻公开。
              </p>
            </div>
          )}
          {busy && (
            <div className="space-y-2">
              <EmptyState loading text={s.progress || "正在处理…"} compact />
              {s.busy === "upload" && (
                <button type="button" onClick={cancelBundleInspect} className={`mx-auto block ${secondaryCls}`}>
                  取消上传
                </button>
              )}
              <p className="text-center text-[11px] leading-relaxed text-slate-500">可以退出这一页去做别的，传完了会有提示。</p>
            </div>
          )}
          {!!s.inspectErr && <Banner tone="bad">{s.inspectErr}</Banner>}

          {s.inspect && (
            <>
              {!s.directOn && (
                <Banner tone="warn">
                  这台服务器还没开直传，刚才走的是慢的那条 —— 包要经过我们的服务器，大包在手机网络上有可能超时。
                  这条路上识别不会把包留下，所以最后<b>发布时还要再传一次</b>。
                </Banner>
              )}
              <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
                <FieldLabel>它会什么</FieldLabel>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {s.inspect.capabilities.badges.length === 0 ? (
                    <span className="text-xs text-slate-500">一个能力角标都没有 —— 装上之后基本上是个不会动的立绘。</span>
                  ) : (
                    s.inspect.capabilities.badges.map((b) => (
                      <span key={b} className="rounded-full bg-gold/90 px-2 py-0.5 text-[10px] font-semibold text-ink">
                        {LIVE2D_BADGE_LABEL[b]}
                      </span>
                    ))
                  )}
                </div>
                <p className="text-xs leading-relaxed text-slate-400">
                  动作 {s.inspect.capabilities.motionCount} 段 / {s.inspect.capabilities.motionGroups.length} 组 · 表情{" "}
                  {s.inspect.capabilities.expressions.length} 个 · 命中区 {s.inspect.capabilities.hitAreas.length} 个 · 贴图{" "}
                  {s.inspect.capabilities.textures.count} 张（最大边 {s.inspect.capabilities.textures.maxSide}px）
                </p>
                {!s.inspect.capabilities.paramsKnown && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    包里没有 cdi3.json，服务器读不到参数表 —— 这不代表模型没有参数，只是这一屏说不出它们叫什么。
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
                <FieldLabel>完成度</FieldLabel>
                <div className="space-y-1">
                  {s.inspect.completeness.required.map((r) => (
                    <div key={`req-${r.slot}`} className="flex items-center gap-2 text-xs">
                      <Icon name={r.ok ? "check" : "close"} size={13} className={r.ok ? "text-emerald-300" : "text-rose-300"} />
                      <span className={r.ok ? "text-slate-300" : "text-rose-300"}>必须 · {r.slot}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  推荐项 {s.inspect.completeness.recommendedDone}/{s.inspect.completeness.recommendedTotal} 项已具备
                </p>
                <div className="no-scrollbar mt-1 flex gap-1.5 overflow-x-auto">
                  {s.inspect.completeness.recommended.map((r) => (
                    <span
                      key={`rec-${r.slot}`}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${r.ok ? "bg-slate-900 text-slate-300" : "bg-slate-900 text-slate-600"}`}
                    >
                      {r.ok ? "✓" : "—"} {r.slot}
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
              上一步
            </button>
            {s.inspect ? (
              <button
                type="button"
                onClick={() => setStep("mapping")}
                disabled={s.inspect.completeness.required.some((r) => !r.ok)}
                className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                下一步：对映射
              </button>
            ) : (
              <button type="button" onClick={() => void startBundleInspect()} disabled={busy} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">
                开始识别
              </button>
            )}
          </div>
          {s.inspect?.completeness.required.some((r) => !r.ok) && (
            <p className="text-center text-[11px] text-rose-300">上面标红的必须项缺了，补齐再重新导出一次包。</p>
          )}
        </section>
      )}

      {/* ④ 手动映射 */}
      {s.step === "mapping" && (
        <section className="space-y-3">
          <Banner tone="info">
            这一步是把「我们的演出协议」对到「你这个模型自己的名字」上。不改也行 —— 服务器已经按常见命名猜了一份，
            下面每一行左边的 ▶ 可以当场在上面的预览里试一下。
          </Banner>
          {!mapping ? (
            <EmptyState emoji="🤔" text="还没有映射可以改" hint="回上一步让服务器先识别一次。" compact />
          ) : (
            <>
              <div>
                <FieldLabel>动作</FieldLabel>
                <div className="space-y-1.5">
                  {ACTIONS.filter((a) => a !== "none").map((a) => {
                    const value = mapping.actions?.[a] ?? "";
                    return (
                      <MapRow
                        key={a}
                        label={ACTION_LABEL[a]}
                        disabled={!value}
                        onPlay={() => companionBus.action(a)}
                        hint={!value ? "没对上动作组，这个动作不演" : undefined}
                      >
                        <select
                          value={value}
                          aria-label={`${ACTION_LABEL[a]} 用哪个动作组`}
                          onChange={(e) => patch({ actions: { ...mapping.actions, [a]: e.target.value || null } })}
                          className={selectCls}
                        >
                          <option value="">不演</option>
                          {value && !groups.includes(value) && <option value={value}>{value}（包里没有）</option>}
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
                <FieldLabel>表情</FieldLabel>
                <p className="mb-1.5 text-xs leading-relaxed text-slate-500">
                  选「用通用参数演」= 不挂你的 exp3，改用我们那套参数（眉毛、嘴角、脸红）去凑 —— 模型没有对应表情文件时这条更稳。
                </p>
                <div className="space-y-1.5">
                  {FACES.filter((f) => f !== "normal").map((f) => {
                    const cur = mapping.faces?.[f] ?? null;
                    const value = cur?.expression ?? "";
                    return (
                      <MapRow key={f} label={FACE_LABEL[f]} onPlay={() => companionBus.face(f)}>
                        <select
                          value={value}
                          aria-label={`${FACE_LABEL[f]} 用哪个表情`}
                          onChange={(e) =>
                            patch({
                              // ★ null = 退到我们的参数版通用表情（mapping.ts 的 setFace 就是这么读的），
                              //   不是"这个表情不演" —— 两者差一个字，后果相反
                              faces: { ...mapping.faces, [f]: e.target.value ? { expression: e.target.value } : null },
                            })
                          }
                          className={selectCls}
                        >
                          <option value="">用通用参数演</option>
                          {value && !expressions.includes(value) && <option value={value}>{value}（包里没有）</option>}
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
                <FieldLabel>触摸区</FieldLabel>
                <p className="mb-1.5 text-xs leading-relaxed text-slate-500">
                  左边是模型自己的命中区（HitAreas），右边是摸到这里播哪个动作。想验证对没对上，直接在上面的预览里摸一下 ——
                  屏幕上会写「刚点到：…」。
                </p>
                <div className="space-y-1.5">
                  {TOUCH_AREAS.map((t) => {
                    const cur = mapping.touch?.[t] ?? null;
                    const area = cur?.hitAreas?.[0] ?? "";
                    const motion = cur?.motion ?? "";
                    return (
                      <MapRow
                        key={t}
                        label={TOUCH_LABEL[t]}
                        disabled={!motion}
                        onPlay={() => motion && previewMotionGroup(motion)}
                        hint={!area ? "没对上命中区，摸这里不会有反应" : undefined}
                      >
                        <select
                          value={area}
                          aria-label={`${TOUCH_LABEL[t]} 对应哪个命中区`}
                          onChange={(e) =>
                            patch({
                              touch: { ...mapping.touch, [t]: e.target.value ? { hitAreas: [e.target.value], motion: motion || null } : null },
                            })
                          }
                          className={selectCls}
                        >
                          <option value="">没有</option>
                          {area && !hitAreas.includes(area) && <option value={area}>{area}（包里没有）</option>}
                          {hitAreas.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                        <select
                          value={motion}
                          disabled={!area}
                          aria-label={`摸${TOUCH_LABEL[t]}播哪个动作`}
                          onChange={(e) =>
                            patch({ touch: { ...mapping.touch, [t]: { hitAreas: [area], motion: e.target.value || null } } })
                          }
                          className={selectCls}
                        >
                          <option value="">只说话</option>
                          {motion && !groups.includes(motion) && <option value={motion}>{motion}（包里没有）</option>}
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
                <FieldLabel>参数（服务器自动对的）</FieldLabel>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {(Object.keys(STANDARD_PARAMS) as ParamSlot[]).map((slot) => {
                    const id = mapping.params?.[slot];
                    return (
                      <div key={slot} className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
                        <span className="shrink-0 text-slate-400">{PARAM_LABEL[slot]}</span>
                        <span className={`min-w-0 truncate ${id ? "text-slate-300" : "text-slate-600"}`}>{id || "没有"}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  参数这一栏这版还不能在 App 里改。对不上的话去 Cubism 里把参数 id 改成标准名（ParamAngleX 这一套）再导出一次。
                </p>
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={resetMapping} disabled={!s.mappingTouched} className={`flex-1 rounded-xl border border-slate-600 py-2.5 text-sm text-slate-300 disabled:opacity-40`}>
                  恢复自动映射
                </button>
                <button type="button" onClick={() => setStep("verify")} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">
                  下一步：试跑
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ⑤ 验收试跑 */}
      {s.step === "verify" && (
        <section className="space-y-3">
          <Banner tone="info">按顺序演一遍：说话对口型、眨眼、每个对上的动作 / 表情 / 触摸区各来一次。盯着上面那块看。</Banner>
          <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
            <div className="space-y-1">
              {verifyItems.map((it) => {
                const done = s.verifyDone.includes(it.key);
                const now = s.verifyNow === it.label;
                return (
                  <div key={it.key} className="flex items-center gap-2 text-xs">
                    {now ? (
                      <Spinner size="xs" />
                    ) : (
                      <Icon name="check" size={13} className={done ? "text-emerald-300" : "text-slate-700"} />
                    )}
                    <span className={now ? "text-brand" : done ? "text-slate-300" : "text-slate-500"}>{it.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (s.verifyNow) {
                  verifyRunning.current = false;
                  useLive2dUpload.setState({ verifyNow: "" });
                } else {
                  void runVerify();
                }
              }}
              className="flex-1 rounded-xl border border-brand/60 py-2.5 text-sm font-semibold text-brand"
            >
              {s.verifyNow ? "■ 停下" : s.verifyDone.length ? "▶ 再跑一遍" : "▶ 开始试跑"}
            </button>
            <button
              type="button"
              onClick={() => {
                useLive2dUpload.setState({ verifyOk: true });
                setStep("publish");
              }}
              disabled={!!s.verifyNow}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              没问题，继续
            </button>
          </div>
          <button type="button" onClick={() => setStep("mapping")} disabled={!!s.verifyNow} className={`mx-auto block ${secondaryCls}`}>
            回去改映射
          </button>
        </section>
      )}

      {/* ⑥ 发布信息 */}
      {s.step === "publish" && (
        <section className="space-y-3">
          {s.verifyOk ? (
            <Banner tone="ok">试跑过了（{s.verifyDone.length} 项）。</Banner>
          ) : (
            <Banner tone="warn">还没试跑过。发之前建议回上一步跑一遍，看看动作和表情是不是真的都能演。</Banner>
          )}
          <div>
            <FieldLabel>名字</FieldLabel>
            <input value={s.name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="别人在市场里看到的名字" className={inputCls} />
          </div>

          <div>
            <FieldLabel>封面</FieldLabel>
            {s.coverUrl ? (
              <img src={s.coverUrl} alt="封面" className="mb-2 h-40 w-full rounded-xl border border-slate-700/70 object-cover" />
            ) : (
              <p className="mb-2 text-xs text-slate-500">不给封面也能发，市场里会是一块空的卡面。</p>
            )}
            <input
              ref={coverRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadCover(f, f.name || "cover.jpg");
              }}
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => void grabCover()} disabled={!!s.coverBusy} className={secondaryCls}>
                从预览截一张
              </button>
              <button type="button" onClick={() => coverRef.current?.click()} disabled={!!s.coverBusy} className={secondaryCls}>
                自己选一张
              </button>
            </div>
            {!!s.coverBusy && <p className="mt-1 text-xs text-slate-500">{s.coverBusy}</p>}
            {!!s.coverErr && <p className="mt-1 text-xs leading-relaxed text-rose-300">{s.coverErr}</p>}
          </div>

          <div>
            <FieldLabel>简介</FieldLabel>
            <textarea
              value={s.desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="画风、适合配什么人格、有哪些动作可以摸出来…"
              className={`${inputCls} resize-none leading-relaxed`}
            />
          </div>

          <div>
            <FieldLabel>标签</FieldLabel>
            <TagInput tags={s.tags} onChange={setTags} max={TAG_MAX} maxLen={VIDEO_TAG_LEN} split={parseTags} />
          </div>

          <div>
            <FieldLabel>谁能用</FieldLabel>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-panel p-1">
              {[
                { on: true, label: "公开到市场", hint: "别人能搜到、能下载来用" },
                { on: false, label: "只有我自己", hint: "只出现在你的「我的」里" },
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
            <p className="mt-1 text-[11px] text-slate-500">{s.shared ? "别人能搜到、能下载来用；随时可以改回私有。" : "只出现在你的「我的」里，别人看不到。"}</p>
          </div>

          <label className="flex items-start gap-2.5 rounded-xl border border-slate-700/70 bg-panel p-3">
            <input type="checkbox" checked={s.selfMade} onChange={(e) => setSelfMade(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand" />
            <span className="min-w-0 text-xs leading-relaxed text-slate-300">
              <b className="text-slate-100">我确认：</b>
              <br />· 这个模型是我做的，或者我已经拿到作者授权；
              <br />· 我没有上传他人作品、真人肖像，也没有上传 Live2D 官方示例模型；
              <br />· 违规的内容会被下架，情节严重的可能会封号。
            </span>
          </label>

          {!!s.publishErr && <Banner tone="bad">{s.publishErr}</Banner>}
          {busy && <EmptyState loading text={s.progress || "正在发布…"} compact />}

          <button type="button" onClick={() => void submitLive2dModel()} disabled={busy || !s.name.trim() || !s.selfMade} className={primaryCls}>
            发布
          </button>
          {!s.selfMade && <p className="text-center text-[11px] text-slate-500">勾上上面那三条才能发布。</p>}
          <button type="button" onClick={() => setStep("verify")} disabled={busy} className={`mx-auto block ${secondaryCls}`}>
            上一步
          </button>
        </section>
      )}

      {/* 成功页 */}
      {s.step === "done" && s.created && (
        <section className="space-y-3">
          <EmptyState emoji="🎉" title={`「${s.created.name}」发布好了`} text={s.shared ? "已经公开到形象市场，别人能搜到它了。" : "已经存进「我的」，只有你能看到。"} />
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
            去看看
          </button>
          <button type="button" onClick={() => resetLive2dDraft()} className={`mx-auto block ${secondaryCls}`}>
            再传一个
          </button>
        </section>
      )}

      {restartAsk && (
        <ConfirmDialog
          title="重新开始？"
          confirmLabel="重新开始"
          danger
          onClose={() => setRestartAsk(false)}
          onConfirm={() => {
            setRestartAsk(false);
            resetLive2dDraft();
          }}
        >
          这一页填的东西会清空，已经选的包也要重新选一次。
          {s.bundleRef ? "刚才传上去的那一份也不会变成模型，要重新走一遍上传和识别。" : ""}
        </ConfirmDialog>
      )}
    </div>
  );
}
