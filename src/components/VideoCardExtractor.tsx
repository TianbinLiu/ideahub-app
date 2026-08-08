// 上传本地视频 → 提炼卡片/卡组。
//
// 抽帧在浏览器做（canvas 定点截图），只把几张缩小后的帧交给视觉模型认人认景——
// 传整段视频既慢又贵，而且还得有后端转码。帧数由用户选，越多认得越全也越贵。
//
// 计费口径：看帧（视觉输入）+ 铸卡面（每张一次 Seedream）。预估按"最多 8 张"给上限，
// 实际按模型认出并成功出图的张数结算——认出 3 个实体就只收 3 张的钱。
import { useRef, useState } from "react";
import { AI_REAL, extractCardsFromVideo } from "../ai";
import { addCards, canAfford, myCards, spendTokens, walletOf } from "../data/account";
import { IMAGE_TOKENS, VISION_FRAME_TOKENS, extractCost, fmtTokens } from "../data/economy";
import { Card, CARD_TYPE_LABELS } from "../types";
import Icon from "./Icon";
import { sampleFrames } from "./videoFrames";
import TarotCard from "./TarotCard";

/** 提炼上限：与 real.ts 的 defs.slice(0, 8) 保持一致 */
const MAX_CARDS = 8;
const FRAME_CHOICES = [4, 6, 8];
export default function VideoCardExtractor({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [frameN, setFrameN] = useState(6);
  const [frames, setFrames] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [got, setGot] = useState<Card[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const estimate = extractCost(frameN, MAX_CARDS);
  const wallet = walletOf();

  async function pick(f: File) {
    setErr("");
    setGot(null);
    setFile(f);
    setFrames([]);
    setBusy("抽帧中…");
    try {
      const fr = await sampleFrames(f, frameN, (i) => setBusy(`抽帧 ${i}/${frameN}…`));
      setFrames(fr);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setFile(null);
    } finally {
      setBusy("");
    }
  }

  async function run() {
    if (!frames.length || busy) return;
    if (AI_REAL && !canAfford(estimate)) {
      setErr(
        `最多需要 ${fmtTokens(estimate)} token，余额 ${fmtTokens((wallet?.plan ?? 0) + (wallet?.addon ?? 0))} 不够——去「我的」页充值`,
      );
      return;
    }
    setErr("");
    setBusy("看片识别中…");
    try {
      const cards = await extractCardsFromVideo(
        frames,
        note,
        myCards().map((c) => ({ type: c.type, name: c.name, summary: c.summary })),
        (s) => setBusy(s),
      );
      if (cards.length === 0) {
        setErr("这段视频里的实体你都已经有卡了——没有新卡可提（本次只收看帧的钱）");
        if (AI_REAL) spendTokens(frames.length * VISION_FRAME_TOKENS);
        return;
      }
      // 按实际出卡张数结算：预估给的是上限，认出几个就收几个
      if (AI_REAL) spendTokens(frames.length * VISION_FRAME_TOKENS + cards.length * IMAGE_TOKENS);
      addCards(cards);
      setGot(cards);
    } catch (e) {
      setErr(`提炼失败：${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/70" onClick={busy ? undefined : onClose}>
      <div
        className="safe-bottom max-h-[88%] w-full overflow-y-auto rounded-t-2xl bg-ink p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-100">🎬 从视频提取卡片</span>
          <button onClick={onClose} disabled={!!busy} className="text-slate-400 disabled:opacity-30">
            <Icon name="close" size={18} />
          </button>
        </div>

        {got ? (
          <>
            <p className="mb-2.5 text-xs text-emerald-300">
              提炼出 {got.length} 张卡，已经收进你的卡片库
              {AI_REAL && ` · 实扣 ${fmtTokens(frames.length * VISION_FRAME_TOKENS + got.length * IMAGE_TOKENS)}`}
            </p>
            <div className="mb-3 grid grid-cols-3 gap-2.5">
              {got.map((c) => (
                <div key={c.id}>
                  <TarotCard cover={c.cover || null} title={c.name} sub={CARD_TYPE_LABELS[c.type]} type={c.type} />
                  <p className="mt-1 line-clamp-2 text-[10px] leading-tight text-slate-500">{c.summary}</p>
                </div>
              ))}
            </div>
            <button onClick={onClose} className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">
              完成
            </button>
          </>
        ) : (
          <>
            {err && (
              <div className="mb-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {err}
              </div>
            )}

            {/* 抽帧张数 */}
            <div className="mb-2.5 flex items-center gap-1.5">
              <span className="flex-none text-[11px] text-slate-400">抽帧</span>
              {FRAME_CHOICES.map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setFrameN(n);
                    if (file) void pick(file);
                  }}
                  disabled={!!busy}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${
                    frameN === n ? "bg-brand text-ink" : "bg-panel text-slate-300"
                  }`}
                >
                  {n} 帧
                </button>
              ))}
              <span className="ml-auto text-[10px] text-slate-500">帧越多认得越全</span>
            </div>

            {frames.length === 0 ? (
              <label className="mb-2.5 flex h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-600 text-xs text-slate-400 hover:border-brand">
                {busy || "＋ 选一段本地视频（mp4 / webm）"}
                <input
                  ref={inputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void pick(f);
                  }}
                />
              </label>
            ) : (
              <>
                <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
                  {frames.map((f, i) => (
                    <img key={i} src={f} alt="" className="h-16 flex-none rounded-lg" />
                  ))}
                </div>
                <p className="mb-2 truncate text-[10px] text-slate-500">{file?.name}</p>
              </>
            )}

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={120}
              placeholder="补充说明（可选）：例「只提角色，画风按国风水墨」"
              className="mb-2.5 w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />

            <div className="mb-2 rounded-xl bg-panel px-3 py-2 text-[11px] leading-relaxed text-slate-400">
              预计最多消耗 <b className="text-slate-200">{fmtTokens(estimate)}</b> token
              （看 {frameN} 帧 {fmtTokens(frameN * VISION_FRAME_TOKENS)} + 最多 {MAX_CARDS} 张卡面{" "}
              {fmtTokens(MAX_CARDS * IMAGE_TOKENS)}）。
              <br />
              实际按认出的张数结算；与你已有的卡重复的实体不会重复出卡。
              {AI_REAL && wallet && ` 当前余额 ${fmtTokens(wallet.plan + wallet.addon)}。`}
              {!AI_REAL && " 当前是演示模式，不产生真实消耗。"}
            </div>

            <button
              onClick={() => void run()}
              disabled={!frames.length || !!busy}
              className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {busy || "✨ 开始提炼"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
