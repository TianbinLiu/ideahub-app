// 「对剪辑台说话」的输入面板（docs/cut-autoedit-research.md 的 P2b）：一句话 → 时间轴上的操作。
// 听懂、落地都不在这里（studio/cutGrammar / studio/cutAgent）；这里只画输入框、句式芯片和回执。
//
// ★ 回执说的是**落地的真相**：✓ / ✗ 两排芯片是 cutProject.applyCutOps 的结果，不是模型嘴上说的"已经办好了"。
// ★ 钱要说在前头：直白的句式本地就听得懂、不花钱；听不懂才问模型（一句一次对话的价）。花了就在回执里写明。
// ★ 面板只盖住底部一截、不遮预览：说完一句，上面的画面和时间轴当场就变，人能接着说下一句。
import { useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import { AI_REAL } from "../../ai";
import { CHAT_TURN_TOKENS, fmtTokens } from "../../data/economy";
import { CUT_SAY_MAX, type CutAgentOutcome } from "../../studio/cutAgent";
import { CUT_PHRASES } from "../../studio/cutGrammar";
import { CloseButton } from "../IconTapButton";
import Spinner from "../Spinner";

interface Props {
  /** 跑一句话：听懂、落地、写回都由剪辑页做，回来的是回执 */
  onRun: (text: string) => Promise<CutAgentOutcome>;
  onClose: () => void;
}

export default function CutAgentSheet({ onRun, onClose }: Props) {
  const { t, i18n } = useLingui();
  // 句式跟着界面语言摆（两套句式本地档都听得懂，摆哪套只是给人看的例子）
  const lang = i18n.locale === "en" ? "en" : "zh";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ said: string; out: CutAgentOutcome } | null>(null);
  /** 这一句连回执都没拿到（落地那一步自己出了错）：原因摆出来，别让"点了没反应"（铁律八） */
  const [fail, setFail] = useState("");
  const phrases = CUT_PHRASES[lang];
  const price = fmtTokens(CHAT_TURN_TOKENS);
  // 回执里的两个数（先取成有名字的变量：目录里的占位符是 {undone} / {redone}，不是 {0}）
  const undone = last?.out.undo ?? 0;
  const redone = last?.out.redo ?? 0;

  async function send() {
    const said = text.trim();
    if (!said || busy) return;
    setBusy(true);
    setFail("");
    try {
      const out = await onRun(said);
      setLast({ said, out });
      setText("");
    } catch (e) {
      // runCutAgent 自己不抛（模型没连上之类都折进回执里）；走到这里是意料之外的错 —— 输入框里的话留着，方便再试
      setFail(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex items-end">
      <div
        className="pointer-events-auto max-h-[56vh] w-full overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mb-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-100"><Trans>💬 对剪辑台说</Trans></div>
            {/* ★ 这段说明只在还没说过话的时候摆：有了回执就让位给回执 —— 面板每高一截，上面的时间轴就被多盖一截，
                而人说话要看着缩略图上的编号（模拟器上量过：说明 + 回执一起摆，缩略图整排被盖住） */}
            {!last && (
              <div className="text-[10px] leading-relaxed text-slate-500">
                {AI_REAL ? (
                  <Trans>直白的句式当场就办、不花钱；听不懂的才问一次模型（{price} token）。</Trans>
                ) : (
                  <Trans>演示模式：只听得懂下面这类直白的句式。</Trans>
                )}{" "}
                {/* 编号说的是哪个数要讲明白：缩略图上还有一个「段 N」（出自第几段），换过序之后两个数不一样 */}
                <Trans>「片段 2」是时间轴上从左数第 2 个（左上角亮底的数字）。重拍画面在这里办不了，去「圈选」。</Trans>
              </div>
            )}
          </div>
          <CloseButton chip="sm" size={13} align="end" label={t`关闭`} onClick={onClose} />
        </div>

        {/* 上一句的回执：说了什么 → 办成了哪些 / 哪些没办、为什么 */}
        {last && (
          <div className="mb-2 rounded-xl border border-slate-700/70 bg-panel p-2.5">
            <div className="truncate text-[10px] text-slate-500">“{last.said}”</div>
            {last.out.say && (
              <div className={`mt-1 text-[11px] leading-relaxed ${last.out.quote ? "text-slate-400" : "text-slate-200"}`}>
                {/* 模型的原话要标出来、压一档颜色：办没办成只看下面的 ✓ / ✗（它嘴上常说"已经办好了"） */}
                {last.out.quote && <Trans>模型说：</Trans>}
                {last.out.say}
              </div>
            )}
            {(last.out.applied.length > 0 || last.out.refused.length > 0) && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {last.out.applied.map((s, i) => (
                  <span key={`a${i}`} className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                    ✓ {s}
                  </span>
                ))}
                {last.out.refused.map((s, i) => (
                  <span key={`r${i}`} className="rounded-lg bg-rose-500/15 px-2 py-0.5 text-[10px] leading-relaxed text-rose-300">
                    ✗ {s}
                  </span>
                ))}
              </div>
            )}
            {undone > 0 && <div className="mt-1 text-[10px] text-slate-400"><Trans>↶ 撤销了 {undone} 步</Trans></div>}
            {redone > 0 && <div className="mt-1 text-[10px] text-slate-400"><Trans>↷ 重做了 {redone} 步</Trans></div>}
            {last.out.paid && (
              <div className="mt-1 text-[10px] text-slate-500"><Trans>这一句问了模型（{price} token）</Trans></div>
            )}
          </div>
        )}

        {fail && (
          <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-300">
            <Trans>这一句没办成：{fail}</Trans>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={text}
            maxLength={CUT_SAY_MAX}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t`比如：把片段2放慢，片段3静音`}
            className="min-w-0 flex-1 resize-none rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !text.trim()}
            className="flex flex-none items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            {busy && <Spinner size="xs" />}
            <Trans>办</Trans>
          </button>
        </div>

        {/* 句式：点一下填进输入框，人接着改编号 / 改内容（每一句都是本地档真听得懂的，check-cut-grammar 钉着） */}
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {phrases.map((ph) => (
            <button
              key={ph}
              onClick={() => setText((cur) => (cur.trim() ? `${cur.trim()}${lang === "zh" ? "，" : ", "}${ph}` : ph))}
              disabled={busy}
              className="flex-none rounded-full bg-panel px-2.5 py-1 text-[11px] text-slate-300 disabled:opacity-40"
            >
              {ph}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
