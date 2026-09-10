// 道具卡「只留主体」：框选 → 手指沿边描轮廓 → 铺浅灰纯色底 → 预览确认。
//
// ★★ 为什么有这一层（主人 2026-09-10 拍板）：道具卡的封面就是出片时喂给模型的参考图，
//   卡片文字还会以「必须严格遵守，不得改动其外形与身份」硬拼进视频提示词（studio/segmentGen 的
//   materialText）。封面里的桌面、手、别的物件，模型分不清哪一个才是道具。所以道具卡两格都要先抠出
//   主体（拍板 2-1 a / 2-2 b）。两格口径不同，别混：
//   · 第 1 格（净底主视图）描不出来时**可以**保留框内背景（拍板 4 b），代价在四处当面说 —— 框选阶段、预览阶段、
//     卡面 note、铸卡键下（后两处靠 SubjectResult.keptBg 带回页面）；
//   · 第 2 格（局部细节）**强制**抠，没有保留背景的出口（拍板 2-2 b）。
// ★ 全程在本机 canvas 里做：不调模型、不花钱、离线可用。合成规则只有一份：utils/image 的
//   composeSubjectImage（过小判据 subjectShortSide 也在那儿），这里只管交互。
// ★ 交互状态活在 customCardStore.subjectPick（切走再回来原样恢复，理由见那个文件头）；
//   这里只握着解码出来的位图 —— 它要 close()，不能进 store，重挂载时由同一个 Blob 确定性地重解一遍，
//   所以 store 里存的源像素坐标始终对得上。
// ★ 为什么不复用 VideoCardAnnotator 的 cropNow：它按 videoWidth/clientWidth 换算，没扣 object-contain
//   留下的黑边，竖屏素材已实测裁偏。这里的舞台是按 contain 自己算出来的盒子，坐标一律源像素。
// ★ 为什么框分两级：CropOverlay 的最小框是 40 个**屏幕**像素，4000 宽的照片显示在手机上时
//   折算成源像素近 460，小物件根本框不紧 ——「放大再框」让舞台只显示框附近那一块，最小框随之缩小。
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import CropOverlay from "./blockout/CropOverlay";
import { clampCropToFrame, type CropRect } from "./blockout/arkVideoRules";
import { BackButton, CloseButton } from "./IconTapButton";
import Spinner from "./Spinner";
import { prepareCardImage } from "../data/cardViews";
import type { SubjectPick } from "../studio/customCardStore";
import { joinViewNote } from "../types";
import {
  REF_SHORT_MIN,
  REF_SHORT_REJECT,
  blobToDataUrl,
  closeSubjectSource,
  composeSubjectImage,
  lassoBounds,
  loadSubjectSource,
  subjectShortSide,
  type SubjectSource,
} from "../utils/image";

// 图位说明的 200 字上限只在 types.joinViewNote 一处截（服务端 cardView.note `.max(200)`，超了补图 PATCH 整发 400）
/** 描轮廓至少要这么多个点才算「描了一圈」：点太少的多边形抠出来是一个三角形 */
const LASSO_MIN_POINTS = 8;
/** 两个轮廓点之间至少隔几个屏幕像素才记（手指停着不动时不往数组里灌重复点） */
const LASSO_STEP_PX = 2;

export interface SubjectResult {
  /** 进卡的那一张（已过 prepareCardImage） */
  dataUrl: string;
  note: string;
  /** 第 1 格选了「保留框内背景」：宿主据此挂「带背景」角标、在铸卡键下摆风险句（拍板 4 b 的后两处） */
  keptBg: boolean;
}

/** 第一次打开时的默认框：居中 70%（v1 不让 AI 预填框，乙方案 §4） */
function defaultRect(w: number, h: number): CropRect {
  const bw = Math.max(1, Math.round(w * 0.7));
  const bh = Math.max(1, Math.round(h * 0.7));
  return { x: Math.round((w - bw) / 2), y: Math.round((h - bh) / 2), w: bw, h: bh };
}

/** 「放大再框」的舞台区域：当前框四周各外扩 15%，夹在图内 */
function zoomRegion(r: CropRect, w: number, h: number): CropRect {
  const mx = Math.round(r.w * 0.15);
  const my = Math.round(r.h * 0.15);
  const x = Math.max(0, r.x - mx);
  const y = Math.max(0, r.y - my);
  return { x, y, w: Math.max(1, Math.min(w, r.x + r.w + mx) - x), h: Math.max(1, Math.min(h, r.y + r.h + my) - y) };
}

export default function PhotoSubjectPicker({
  pick,
  slotLabel,
  onChange,
  onDone,
  onError,
  onClose,
}: {
  pick: SubjectPick;
  /** 这一格叫什么（「净底主视图」/「局部细节」） */
  slotLabel: string;
  onChange: (next: SubjectPick) => void;
  onDone: (r: SubjectResult) => void;
  /** 图解不开：由宿主关掉这一层，并把话贴回那一格（slotErr） */
  onError: (msg: string) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<SubjectSource | null>(null);
  const [space, setSpace] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [, setTick] = useState(0);
  const spaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 正在描的这一笔（源像素）。放 ref 不放 state：每个 pointermove 复制一遍整条数组是白费 */
  const drawing = useRef<[number, number][] | null>(null);
  // ★ 解码是异步的，回来那一拍闭包里的 pick / 回调可能已经旧了 —— 一律读 ref
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // 解码：同一个 Blob 只解一次，卸载时释放位图
  useEffect(() => {
    let alive = true;
    let got: SubjectSource | null = null;
    setSource(null);
    loadSubjectSource(pick.src).then(
      (s) => {
        if (!alive) {
          closeSubjectSource(s);
          return;
        }
        got = s;
        setSource(s);
        if (!pickRef.current.rect) onChangeRef.current({ ...pickRef.current, rect: defaultRect(s.width, s.height) });
      },
      (e) => {
        if (alive) onErrorRef.current(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
      if (got) closeSubjectSource(got);
    };
  }, [pick.src]);

  // 舞台可用空间。★ ResizeObserver 而不是挂载时量一次：转屏、父容器变化都会改尺寸（同 blockout/VideoStage）
  useEffect(() => {
    const el = spaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSpace({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const full: CropRect | null = source ? { x: 0, y: 0, w: source.width, h: source.height } : null;
  /** 舞台上显示的是源图的哪一块：框选时是整图或放大区，描轮廓时是框本身 */
  const region: CropRect | null =
    !full || !pick.rect ? full : pick.stage === "cut" ? pick.rect : pick.stage === "box" ? (pick.zoom ?? full) : null;
  const scale = region && space.w > 0 && space.h > 0 ? Math.min(space.w / region.w, space.h / region.h) : 0;
  const fit = region && scale > 0 ? { w: region.w * scale, h: region.h * scale } : null;

  // 把舞台那一块画进 canvas（按设备像素比，最多 2 倍 —— 再高只是白耗内存）
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !source || !region || !fit) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(fit.w * dpr));
    c.height = Math.max(1, Math.round(fit.h * dpr));
    const g = c.getContext("2d");
    if (!g) return;
    g.imageSmoothingQuality = "high";
    g.drawImage(source.image, region.x, region.y, region.w, region.h, 0, 0, c.width, c.height);
  }, [source, region?.x, region?.y, region?.w, region?.h, fit?.w, fit?.h]);

  // ── 过小判据：一律问 utils/image.subjectShortSide（与合成时的拒绝是同一把尺） ──
  const cutBest = pick.rect ? subjectShortSide(pick.rect.w, pick.rect.h, "cutout") : 0;
  const keepShort = pick.rect ? subjectShortSide(pick.rect.w, pick.rect.h, "keep") : 0;
  const lb = pick.rect && pick.lasso ? lassoBounds(pick.lasso, pick.rect) : null;
  const lassoShort = lb ? subjectShortSide(lb.w, lb.h, "cutout") : 0;
  const lassoEnough = !!pick.lasso && pick.lasso.length >= LASSO_MIN_POINTS;
  const lassoOk = lassoEnough && lassoShort >= REF_SHORT_REJECT;

  function toSource(e: RPointerEvent<SVGSVGElement>): [number, number] | null {
    if (!region || !scale) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
    const y = Math.min(Math.max(e.clientY - r.top, 0), r.height);
    return [region.x + x / scale, region.y + y / scale];
  }

  function lassoDown(e: RPointerEvent<SVGSVGElement>) {
    if (busy) return;
    const p = toSource(e);
    if (!p) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件没有有效 pointerId：捕获失败不影响描（只是手指拖出舞台会断），同 CropOverlay */
    }
    drawing.current = [p];
    setErr("");
    onChange({ ...pickRef.current, lasso: null, preview: null });
  }

  function lassoMove(e: RPointerEvent<SVGSVGElement>) {
    const pts = drawing.current;
    if (!pts) return;
    const p = toSource(e);
    if (!p) return;
    const last = pts[pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) * scale < LASSO_STEP_PX) return;
    pts.push(p);
    setTick((t) => t + 1);
  }

  function lassoUp() {
    const pts = drawing.current;
    drawing.current = null;
    if (pts && pts.length >= 3) onChange({ ...pickRef.current, lasso: pts });
    else setTick((t) => t + 1);
  }

  /** 合成进卡的那一张：抠主体（或保留框内背景）→ 铺底定比例 → prepareCardImage（唯一实现）→ 预览 */
  async function makePreview(keepBg: boolean) {
    const p = pickRef.current;
    if (!source || !p.rect || busy) return;
    setBusy(true);
    setErr("");
    try {
      const composed = await composeSubjectImage(source.image, p.rect, keepBg ? null : p.lasso);
      // ★ 必须显式给 type：decodeImageFile 见非 image/* 就当场拒「请选择图片文件」
      const file = new File([composed.blob], "subject.jpg", { type: "image/jpeg" });
      const { blob, note: prepNote } = await prepareCardImage(file);
      const dataUrl = await blobToDataUrl(blob);
      const size = `${composed.subjectW}×${composed.subjectH}px`;
      const up = composed.upscaled ? `，已放大到短边 ${REF_SHORT_MIN}px` : "";
      const base = keepBg
        ? `保留了框内背景（${size}${up}）——卡面仍带背景，出片时 AI 可能把背景里的东西也画进去`
        : `按你描的轮廓抠出主体，背景换成浅灰纯色（主体 ${size}${up}）`;
      const note = joinViewNote(base, prepNote);
      onChange({ ...pickRef.current, stage: "preview", preview: { dataUrl, note, keptBg: keepBg } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const livePts = drawing.current ?? pick.lasso;
  const disp = (pts: [number, number][]) =>
    region ? pts.map(([x, y]) => `${((x - region.x) * scale).toFixed(1)},${((y - region.y) * scale).toFixed(1)}`) : [];

  const title = pick.stage === "box" ? "框出这件道具" : pick.stage === "cut" ? "沿边描出轮廓" : "确认卡面";
  const hint =
    pick.stage === "box"
      ? "把这件道具框住，框得越紧越好。东西在画面里太小、框不紧的话，先点「放大再框」。"
      : pick.stage === "cut"
        ? "用手指沿着这件东西的边描一整圈，松手自动闭合。圈外的桌面、手和别的东西，都会换成浅灰纯色底。"
        : "下面就是进卡的那一张：卡面和出片参考图都用它。";
  const primaryBtn = "flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40";
  const secondaryBtn = "flex-1 rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-200 ring-1 ring-slate-700 disabled:opacity-40";

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-ink" role="dialog" aria-label={`道具卡 · ${slotLabel} · ${title}`}>
      <div className="safe-top flex h-[58px] flex-none items-center gap-2 px-4">
        {pick.stage !== "box" && (
          <BackButton
            chip="md"
            size={16}
            label="上一步"
            disabled={busy}
            onClick={() =>
              onChange(
                pick.stage === "cut"
                  ? { ...pick, stage: "box", lasso: null, preview: null }
                  : { ...pick, stage: pick.preview?.keptBg ? "box" : "cut", preview: null },
              )
            }
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-100">{title}</p>
          <p className="truncate text-[10px] text-slate-500">道具卡 · {slotLabel}</p>
        </div>
        <CloseButton chip="md" size={16} align="end" label="取消，不用这张图" disabled={busy} onClick={onClose} />
      </div>

      <p className="flex-none px-4 pb-2 text-[11px] leading-relaxed text-slate-400">{hint}</p>

      <div ref={spaceRef} className="relative mx-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
        {!source ? (
          <span className="flex items-center gap-2 text-xs text-slate-400">
            <Spinner size="sm" />
            正在读图…
          </span>
        ) : pick.stage === "preview" && pick.preview ? (
          <img src={pick.preview.dataUrl} alt="进卡的那一张" className="h-full w-full object-contain" />
        ) : fit && region ? (
          <div className="relative" style={{ width: fit.w, height: fit.h }}>
            <canvas ref={canvasRef} className="block h-full w-full" />
            {pick.stage === "box" && pick.rect && (
              <CropOverlay
                natural={{ width: region.w, height: region.h }}
                scale={scale}
                value={clampCropToFrame(
                  { x: pick.rect.x - region.x, y: pick.rect.y - region.y, w: pick.rect.w, h: pick.rect.h },
                  { width: region.w, height: region.h },
                )}
                onChange={(next) =>
                  onChange({
                    ...pickRef.current,
                    rect: { x: next.x + region.x, y: next.y + region.y, w: next.w, h: next.h },
                    lasso: null,
                    preview: null,
                  })
                }
                disabled={busy}
              />
            )}
            {pick.stage === "cut" && (
              <svg
                className="absolute inset-0 h-full w-full touch-none"
                viewBox={`0 0 ${fit.w} ${fit.h}`}
                onPointerDown={lassoDown}
                onPointerMove={lassoMove}
                onPointerUp={lassoUp}
                onPointerCancel={lassoUp}
              >
                {!drawing.current && pick.lasso && pick.lasso.length >= 3 && (
                  <path
                    d={`M0 0H${fit.w}V${fit.h}H0Z M${disp(pick.lasso).join(" L")}Z`}
                    fill="rgba(0,0,0,0.6)"
                    fillRule="evenodd"
                  />
                )}
                {livePts && livePts.length > 1 && (
                  <polyline
                    points={disp(livePts).join(" ")}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
              </svg>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex-none space-y-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
        {err && <p className="text-[11px] leading-relaxed text-rose-300">{err}</p>}

        {pick.stage === "box" && (
          <>
            {pick.rect && cutBest < REF_SHORT_REJECT && (
              <p className="text-[11px] leading-relaxed text-rose-300">
                这块太小了：折算只有 {cutBest} px，至少 {REF_SHORT_REJECT} px——框大一点再继续
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!source || !pick.rect || busy}
                onClick={() =>
                  source &&
                  pick.rect &&
                  onChange({ ...pick, zoom: pick.zoom ? null : zoomRegion(pick.rect, source.width, source.height) })
                }
                className={secondaryBtn}
              >
                {pick.zoom ? "回到整图" : "放大再框"}
              </button>
              <button
                type="button"
                disabled={!source || !pick.rect || busy || cutBest < REF_SHORT_REJECT}
                onClick={() => onChange({ ...pick, stage: "cut", lasso: null, preview: null })}
                className={primaryBtn}
              >
                下一步：描轮廓 ›
              </button>
            </div>
          </>
        )}

        {pick.stage === "cut" && (
          <>
            {pick.lasso && !lassoEnough && (
              <p className="text-[11px] leading-relaxed text-rose-300">再描完整一点：沿着这件东西的边描一整圈</p>
            )}
            {pick.lasso && lassoEnough && lassoShort < REF_SHORT_REJECT && (
              <p className="text-[11px] leading-relaxed text-rose-300">
                描出来的范围太小了：折算只有 {lassoShort} px，至少 {REF_SHORT_REJECT} px——在框里描大一点
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!pick.lasso || busy}
                onClick={() => onChange({ ...pick, lasso: null, preview: null })}
                className={secondaryBtn}
              >
                重描
              </button>
              <button type="button" disabled={!lassoOk || busy} onClick={() => void makePreview(false)} className={primaryBtn}>
                {busy ? "合成中…" : "下一步：预览 ›"}
              </button>
            </div>
            {/* 拍板 4 b：只有第 1 格给这个出口，而且风险必须写在按之前看得到的地方 */}
            {pick.allowKeepBg && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
                <button
                  type="button"
                  disabled={busy || keepShort < REF_SHORT_REJECT}
                  onClick={() => void makePreview(true)}
                  className="text-[11px] font-semibold text-amber-200 underline underline-offset-2 disabled:opacity-40"
                >
                  描不出来？保留框内背景 ›
                </button>
                <p className="mt-0.5 text-[10px] leading-relaxed text-amber-200/90">
                  卡面会带着框里的背景，出片时 AI 可能把背景里的东西也画进去。
                </p>
              </div>
            )}
          </>
        )}

        {pick.stage === "preview" && pick.preview && (
          <>
            {pick.preview.keptBg && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200">
                卡面仍带背景：出片时 AI 可能把背景里的东西也画进去。想只留主体，就回上一步描出轮廓。
              </p>
            )}
            <p className="text-[10px] leading-relaxed text-slate-500">{pick.preview.note}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...pick, stage: pick.preview?.keptBg ? "box" : "cut", preview: null })}
                className={secondaryBtn}
              >
                {pick.preview.keptBg ? "‹ 重新框" : "‹ 重新描"}
              </button>
              <button
                type="button"
                onClick={() => pick.preview && onDone({ dataUrl: pick.preview.dataUrl, note: pick.preview.note, keptBg: pick.preview.keptBg })}
                className={primaryBtn}
              >
                用这张
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
