// 上传参考视频 → 提取「视频模板」。
//
// 与「视频提卡」（VideoCardExtractor）的区别：提卡只认素材，提模板还要把"这类视频
// 为什么长这样"总结成可复用的配方——画风质感、运镜、分镜骨架、起拍提示词。所以它
// 比提卡多一次模型调用，也贵一点。
//
// 计费口径：看帧两次（总结配方 + 认素材卡）+ 铸卡面。预估按上限给，实际按认出并
// 成功出图的张数结算。
import { useRef, useState } from "react";
import { AI_REAL, extractTemplateFromVideo } from "../ai";
import { canAfford, spendTokens, walletOf } from "../data/account";
import { IMAGE_TOKENS, VISION_FRAME_TOKENS, fmtTokens } from "../data/economy";
import { saveTemplate } from "../data/templates";
import { VideoTemplate } from "../types";
import Icon from "./Icon";
import { sampleFrames } from "./videoFrames";

/** 模板素材卡上限：与 real.ts 的提示词（0~6 张）保持一致 */
const MAX_CARDS = 6;
const FRAME_CHOICES = [4, 6, 8];

/** 看帧要两遍（配方 + 素材），所以视觉部分按 2× 计 */
function templateCost(frameCount: number): number {
  return frameCount * VISION_FRAME_TOKENS * 2 + MAX_CARDS * IMAGE_TOKENS;
}

export default function VideoTemplateExtractor({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone?: (t: VideoTemplate) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [frameN, setFrameN] = useState(6);
  const [frames, setFrames] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [got, setGot] = useState<VideoTemplate | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const estimate = templateCost(frameN);
  const wallet = walletOf();

  async function pick(f: File) {
    setErr("");
    setGot(null);
    setFile(f);
    setFrames([]);
    try {
      setBusy("抽帧中…");
      const fr = await sampleFrames(f, frameN, (i) => setBusy(`抽帧 ${i}/${frameN}…`));
      setFrames(fr);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function run() {
    if (frames.length === 0) return;
    if (AI_REAL && !canAfford(estimate)) {
      setErr(`预估需 ${fmtTokens(estimate)} token，余额不足——去「我的」页充值`);
      return;
    }
    setErr("");
    try {
      setBusy("分析中…");
      const r = await extractTemplateFromVideo(frames, note, (st) => setBusy(st));
      // 实际结算：看帧固定，卡面按真出的张数收
      if (AI_REAL) spendTokens(frames.length * VISION_FRAME_TOKENS * 2 + r.cards.length * IMAGE_TOKENS);
      const tpl = saveTemplate({
        title: r.title,
        intro: r.intro,
        // 封面用第一帧：它是参考视频自己的画面，最能代表模板长什么样
        cover: frames[0] ?? "",
        cards: r.cards,
        recipe: { ...r.recipe, videoTier: "hd" },
        source: r.source,
      });
      setGot(tpl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-panel p-4"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">🎬 从视频提取模板</h3>
          <button onClick={onClose} className="-m-2 p-2 text-slate-400">
            <Icon name="close" size={20} />
          </button>
        </div>

        {got ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
              <div className="text-sm font-bold text-emerald-300">已提取模板「{got.title}」</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">{got.intro}</p>
              <p className="mt-2 text-[11px] text-slate-400">
                {got.recipe.beats.length} 段分镜 · {got.cards.length} 张素材卡 · 已存进「我的模板」（尚未发布）
              </p>
            </div>
            <div className="rounded-xl bg-black/25 p-3">
              <div className="mb-1 text-[11px] text-slate-500">总结出的画面要求</div>
              <p className="text-xs leading-relaxed text-slate-400">{got.recipe.styleHint}</p>
            </div>
            <button
              onClick={() => {
                onDone?.(got);
                onClose();
              }}
              className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink"
            >
              用这个模板出片
            </button>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pick(f);
              }}
            />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={!!busy}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 py-6 text-sm text-slate-300 disabled:opacity-50"
            >
              <Icon name="plus" size={18} />
              {file ? file.name : "选一段参考视频"}
            </button>

            <div className="mb-3">
              <div className="mb-1.5 text-xs text-slate-400">分析帧数（越多认得越准，也越贵）</div>
              <div className="flex gap-2">
                {FRAME_CHOICES.map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setFrameN(n);
                      if (file) void pick(file);
                    }}
                    disabled={!!busy}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${frameN === n ? "bg-brand text-ink" : "bg-slate-700/70 text-slate-300"}`}
                  >
                    {n} 帧
                  </button>
                ))}
              </div>
            </div>

            {frames.length > 0 && (
              <div className="mb-3 flex gap-1.5 overflow-x-auto">
                {frames.map((f, i) => (
                  <img key={i} src={f} alt="" className="h-16 flex-none rounded-lg object-cover" />
                ))}
              </div>
            )}

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="补充说明（可选）：比如「重点学它的运镜和胶片质感，别管剧情」"
              className="mb-3 w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />

            <div className="mb-3 flex items-center justify-between rounded-lg bg-black/25 px-3 py-2 text-xs">
              <span className="text-slate-400">预估消耗</span>
              <span className="text-slate-200">
                {fmtTokens(estimate)} token
                {wallet && <span className="ml-2 text-slate-500">余额 {fmtTokens(wallet.plan + wallet.addon)}</span>}
              </span>
            </div>

            {err && <p className="mb-2 text-xs leading-relaxed text-rose-400">{err}</p>}

            <button
              onClick={() => void run()}
              disabled={frames.length === 0 || !!busy}
              className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {busy || "开始分析并生成模板"}
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              AI 会看这几帧，总结出画风、运镜与分镜骨架，并提炼可复用的场景/道具卡（不提取主角——主角由你之后那句话指定）。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
