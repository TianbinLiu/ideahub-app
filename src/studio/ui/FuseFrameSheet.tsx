// 「融图」浮层：挑 2~3 张参考图 + 写一句话 → 融成一张**边界帧**（首帧或尾帧）。
//
// ★★ 它存在的理由是**段间无缝**：让同一张图既当上一段的尾帧、又当下一段的首帧，
//   接缝处就没有跳变。而这张图往往要"这个人（卡片形象）+ 那个姿势/场景（另一张图）"
//   合起来 —— 单张 i2i 做不到，得靠多图参考（方舟 Seedream 的 image 收数组）。
//
// ★ 出图落地走**调用方给的那一个回调**，而那个回调在三条路上都是同一个缝
//   （`PlanBoard.onFrame` → flowStore.setFrame）—— 所以工坊/工作流/简约一处实现三处都有。
// ★ 只收 props、不认识任何 store（与 PlanBoard 同一条约束）：候选图由宿主给。
// ★ 整屏浮层一律 portal 到 body：方案台祖先上有 backdrop-blur / transform，
//   它们会给 position:fixed 后代造包含块，inset-0 会缩到那个盒子里（CLAUDE.md 那条坑）。
import { useState } from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "../../components/IconTapButton";
import { AI_REAL, fuseFrame } from "../../ai";
import { canAfford, spendTokens } from "../../data/account";
import { ONE_IMAGE, fmtTokens } from "../../data/economy";
import type { VideoAspect } from "../../types";

/** 一张可选的参考图 */
export interface FuseSource {
  url: string;
  label: string;
}

/** 一次最多融几张。★ 3 是方舟指南那条「素材过多模型难判特征优先级」的同一个数 */
export const FUSE_MAX = 3;

/**
 * 「这一段有哪些图可以融」——**唯一实现**，三条路（工坊/工作流/简约）共用。
 *
 * ★ 各写一份的下场是三个面给出的候选图不一样，而用户完全看不出为什么这一面少一张。
 * ★ 顺序即优先级：承接帧 → 本段现有首尾帧 → 素材卡形象图。前两者是"接缝在哪"的
 *   直接依据，卡的形象图是"这个人长什么样"的依据 —— 融图最常见的用法正是把两者合起来。
 * ★ 只收 http(s)/dataURL 的**真图**：`mock:` 这类占位串混进去会让模型收到一个 404
 *   （或整发 400），而那一步是花钱的。
 */
export function fuseSourcesOf(o: {
  materials?: { name: string; views?: { url: string; tag?: string }[]; cover?: string }[];
  carryFrame?: string | null;
  firstFrame?: string;
  lastFrame?: string;
}): FuseSource[] {
  const out: FuseSource[] = [];
  const push = (url: string | null | undefined, label: string) => {
    const u = (url || "").trim();
    if (!u || u.startsWith("mock:") || out.some((x) => x.url === u)) return;
    out.push({ url: u, label });
  };
  push(o.carryFrame, "上段结尾");
  push(o.firstFrame, "本段开头");
  push(o.lastFrame, "本段结尾");
  for (const c of o.materials ?? []) {
    const views = Array.isArray(c.views) ? c.views : [];
    if (views.length > 0) for (const v of views) push(v.url, `${c.name}·${v.tag || "形象"}`);
    else push(c.cover, c.name);
  }
  return out;
}

export default function FuseFrameSheet({
  which,
  sources,
  aspect,
  onDone,
  onClose,
}: {
  which: "first" | "last";
  sources: FuseSource[];
  aspect: VideoAspect;
  /** 融好的那张（dataUrl）。宿主拿它调 onFrame 落地 */
  onDone: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const price = ONE_IMAGE;
  const label = which === "first" ? "开头帧" : "结尾帧";

  function toggle(url: string) {
    setErr("");
    setPicked((cur) =>
      cur.includes(url) ? cur.filter((u) => u !== url) : cur.length >= FUSE_MAX ? cur : [...cur, url],
    );
  }

  async function run() {
    if (busy) return;
    if (picked.length === 0) {
      setErr("先挑至少一张参考图——融图是把几张图合成一张，没有素材就没得融");
      return;
    }
    if (!instruction.trim()) {
      setErr(`写一句这张${label}要什么画面（例如"他站在门口回头，半身，暖光"）——不写的话模型只能自己编`);
      return;
    }
    if (AI_REAL && !canAfford(price)) {
      setErr(`融一张约需 ${fmtTokens(price)} token，余额不够——去「我的」页充值`);
      return;
    }
    setErr("");
    try {
      const url = await fuseFrame({
        sources: picked,
        instruction: instruction.trim(),
        aspect,
        onProgress: (s) => setBusy(s),
      });
      // ★ 先扣钱再交出去：交出去那一刻宿主就把帧换掉了，此时再失败就成了"帧换了、钱没扣"
      if (AI_REAL) spendTokens(price);
      onDone(url);
      onClose();
    } catch (e) {
      // 失败**不动**原来那张帧（onDone 没被调用），并整句说清（铁律八）
      setErr(`没融成：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}——原来的${label}没变，可以再试一次`);
    } finally {
      setBusy("");
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4 sm:rounded-2xl sm:border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">🧬 融图 · 做这一段的{label}</h3>
          <CloseButton chip="sm" size={13} align="end" onClick={onClose} />
        </div>
        {/* ★ 这句话是这个功能存在的全部理由，值得占一行：用户不知道"为什么要融" */}
        <p className="mb-2.5 text-[10px] leading-relaxed text-slate-500">
          把几张图合成一张画面。把上一段的<b className="text-slate-400">结尾帧</b>融成下一段的
          <b className="text-slate-400">开头帧</b>，两段接起来就没有跳变——这是做长片"看不出接缝"的常用手法。
        </p>

        <div className="mb-1.5 text-xs font-semibold text-slate-300">
          挑参考图（{picked.length}/{FUSE_MAX}）
        </div>
        {sources.length === 0 ? (
          <p className="mb-2.5 rounded-lg border border-dashed border-slate-700 p-3 text-center text-[10px] text-slate-500">
            这一段还没有可融的图——先挂一张素材卡，或让 AI 先推演出首尾帧
          </p>
        ) : (
          <div className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
            {sources.map((s) => {
              const on = picked.includes(s.url);
              const order = picked.indexOf(s.url) + 1;
              return (
                <button
                  key={s.url}
                  onClick={() => toggle(s.url)}
                  disabled={!!busy}
                  className={`relative w-20 flex-none overflow-hidden rounded-lg border disabled:opacity-40 ${
                    on ? "border-brand ring-1 ring-brand/50" : "border-slate-700"
                  }`}
                >
                  <img src={s.url} alt={s.label} className="h-24 w-full object-cover" loading="lazy" />
                  {/* ★ 标序号不只标选中：提示词里逐张点名「图片N」，顺序就是这里的顺序 ——
                      不显示的话用户改不了"谁是图片1"，而那正是模型分不清谁管人谁管场景的原因 */}
                  {on && (
                    <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-ink">
                      {order}
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-ink/80 px-1 py-0.5 text-[9px] text-slate-300">
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={200}
          disabled={!!busy}
          placeholder={`这张${label}要什么画面？例："他站在门口回头，半身，暖光"`}
          className="mb-2 h-16 w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 disabled:opacity-40"
        />
        {err && <p className="mb-2 text-[11px] leading-relaxed text-rose-300">{err}</p>}
        <button
          onClick={() => void run()}
          disabled={!!busy}
          className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
        >
          {busy || `🧬 融成${label}${AI_REAL ? `（约 ${fmtTokens(price)}）` : "（演示）"}`}
        </button>
      </div>
    </div>,
    document.body,
  );
}
