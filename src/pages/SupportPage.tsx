/**
 * AI 客服页（/support）：看板娘数字人 + 流式问答 + 转人工工单。
 *
 * 一句话的旅程：
 *   POST /api/support/chat（SSE）每来一条 sentence → 立刻发起该句的 /api/tts（不等上一句播完）
 *   → 按顺序排进演出队列：切表情 + 触发动作 + 舞台字幕 + 播放（口型跟包络）
 *   → 没音频（语音关 / TTS 失败 / 未配置）就按字数合成口型撑时长。
 *   服务端判定该转人工时发 `handoff` 事件 → 对话下方出现「转人工」卡；用户也随时可以自己点「转人工」。
 *
 * ★ 演出是串行 Promise 链而不是 state：句子异步乱序到达，用 state 排队会丢句/乱序（与官网首页同一套做法）。
 * ★ runId 递增 = 「停止」：队列里的旧任务看到 run 变了就放弃，不用逐个取消。
 * ★ 语音开关与「铸卡师的声音」共用 data 层那一个键（studio/speech.voiceEnabled）：一个规则一处实现。
 * ★ 登录墙由路由的 RequireAuth 管；这里拿到的 user 一定存在。
 * ★ 所有失败就地整句说明（api:error 没人听），绝不静默。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import Icon from "../components/Icon";
import SupportStage from "../components/support/SupportStage";
import { companionBus } from "../companion/bus";
import { SpeechPlayer } from "../companion/speech";
import { estimateSpeechMs, normalizeAction, normalizeFace, type CompanionSentence } from "../companion/protocol";
import { setVoiceEnabled, voiceEnabled } from "../studio/speech";
import { ApiError } from "../api/client";
import {
  CATEGORY_LABEL,
  TICKET_STATUS_LABEL,
  appendTicketMessage,
  createSupportTicket,
  getSupportConfig,
  listMySupportTickets,
  streamSupportChat,
  synthesizeSpeech,
  type SupportCategory,
  type SupportConfig,
  type SupportTicket,
} from "../api/support";
import { relativeTime } from "../types";

type Role = "user" | "assistant";
type ChatMessage = { id: string; role: Role; text: string; streaming?: boolean; system?: boolean };
type Phase = "idle" | "thinking" | "speaking";

const MAX_HISTORY = 12;
const MAX_INPUT_CHARS = 1000;
const TRANSCRIPT_MAX = 30;

let seq = 0;
const nextId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = window.setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      window.clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "问得太快了，稍等几秒再发。";
    if (e.status === 501) return "服务端还没开通 AI 客服，可以直接转人工。";
    if (e.status === 0) return "当前是离线模式，客服需要联网。";
    return e.message || fallback;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export default function SupportPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [config, setConfig] = useState<SupportConfig | null>(null);
  const [configErr, setConfigErr] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [subtitle, setSubtitle] = useState("");
  const [voiceOn, setVoiceOn] = useState(voiceEnabled);
  const [chatErr, setChatErr] = useState("");
  const [handoffHint, setHandoffHint] = useState<{ category: SupportCategory } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [note, setNote] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sheetErr, setSheetErr] = useState("");
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [ticketsErr, setTicketsErr] = useState("");
  const ticketsOpen = params.get("tab") === "tickets";
  const highlightTicket = params.get("ticket") || "";

  const playerRef = useRef<SpeechPlayer | null>(null);
  const runRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const name = config?.name || "小梦";
  const enabled = config ? config.enabled : true;

  useEffect(() => {
    let alive = true;
    getSupportConfig()
      .then((c) => alive && setConfig(c))
      .catch((e) => {
        if (!alive) return;
        // 老服务端 / 离线：对话不可用，但转人工入口（邮箱）还在
        setConfig({ ok: true, name: "小梦", enabled: false, tts: false, voice: "", loginRequired: true, quickQuestions: [], categories: [] });
        setConfigErr(errorText(e, "读不到客服配置"));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ticketsOpen) return;
    let alive = true;
    setTicketsErr("");
    listMySupportTickets()
      .then((r) => alive && setTickets(r.items))
      .catch((e) => alive && setTicketsErr(errorText(e, "读不到工单")));
    return () => {
      alive = false;
    };
  }, [ticketsOpen]);

  // 离开页面：掐掉声音与排队中的演出
  useEffect(
    () => () => {
      runRef.current += 1;
      abortRef.current?.abort();
      playerRef.current?.stop();
      companionBus.stopSpeaking();
    },
    [],
  );

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, handoffHint]);

  const transcript = useMemo(
    () => messages.filter((m) => !m.system && m.text.trim()).slice(-TRANSCRIPT_MAX).map((m) => ({ role: m.role, content: m.text.slice(0, 2000) })),
    [messages],
  );

  function getPlayer() {
    if (!playerRef.current) playerRef.current = new SpeechPlayer();
    return playerRef.current;
  }

  function stopAll() {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    playerRef.current?.stop();
    companionBus.stopSpeaking();
    setPhase("idle");
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  }

  function enqueue(run: number, job: () => Promise<void>) {
    queueRef.current = queueRef.current
      .then(async () => {
        if (runRef.current !== run) return;
        await job();
      })
      .catch(() => undefined);
    return queueRef.current;
  }

  async function perform(run: number, sentence: CompanionSentence, audio: Promise<Blob | null>, signal: AbortSignal) {
    if (runRef.current !== run) return;
    setSubtitle(sentence.text);
    setPhase("speaking");
    companionBus.face(normalizeFace(sentence.face));
    companionBus.action(normalizeAction(sentence.action));
    const blob = await audio;
    if (runRef.current !== run || signal.aborted) return;
    if (blob) {
      try {
        await getPlayer().play(blob, (level) => companionBus.mouth(level), { signal });
        return;
      } catch {
        if (signal.aborted) return;
      }
    }
    const ms = estimateSpeechMs(sentence.text);
    companionBus.speakSynthetic(ms);
    await sleep(ms, signal);
  }

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceEnabled(next);
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim().slice(0, MAX_INPUT_CHARS);
    if (!text) return;
    if (!enabled) {
      setChatErr(`服务端还没开通 AI 对话，${name}暂时不能回答；可以直接点下面的「转人工」。`);
      return;
    }
    stopAll();
    setChatErr("");
    setHandoffHint(null);
    const run = runRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: ChatMessage = { id: nextId(), role: "user", text };
    const assistantId = nextId();
    const history = [...transcript.slice(-(MAX_HISTORY - 1)), { role: "user" as Role, content: text }];
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", text: "", streaming: true }]);
    setInput("");
    setPhase("thinking");
    setSubtitle("");

    const wantVoice = voiceOn && Boolean(config?.tts);
    let handoff: SupportCategory | null = null;
    try {
      await streamSupportChat(
        { messages: history, lang: "zh" },
        {
          onSentence: (sentence) => {
            // 文字先上屏（市面客服都是文字即时、语音随后），语音按句排队
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text ? `${m.text} ${sentence.text}` : sentence.text } : m)));
            const audio: Promise<Blob | null> = wantVoice
              ? synthesizeSpeech(
                  { text: sentence.text, voice: config?.voice || undefined, emotion: sentence.tts?.emotion, instruct: sentence.tts?.instruct, expressive: true },
                  controller.signal,
                ).catch(() => null)
              : Promise.resolve(null);
            void enqueue(run, () => perform(run, sentence, audio, controller.signal));
          },
          onHandoff: (info) => {
            handoff = info.category;
          },
          onDone: (result) => {
            if (result.handoff && !handoff) handoff = result.category || "other";
          },
        },
        controller.signal,
      );
      await enqueue(run, async () => undefined);
      if (runRef.current !== run) return;
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
      if (handoff) setHandoffHint({ category: handoff });
      setPhase("idle");
    } catch (e) {
      if (controller.signal.aborted) return;
      setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.text));
      setChatErr(errorText(e, `${name}走神了，再发一次试试。`));
      setPhase("idle");
    }
  }

  function openSheet() {
    setSheetErr("");
    setSheetOpen(true);
  }

  async function submitTicket() {
    if (submitting) return;
    if (!transcript.length && !note.trim()) {
      setSheetErr("先说一句你遇到了什么，客服才知道从哪儿开始。");
      return;
    }
    setSubmitting(true);
    setSheetErr("");
    try {
      const r = await createSupportTicket({
        transcript,
        note: note.trim(),
        contactEmail: contactEmail.trim(),
        category: handoffHint?.category,
      });
      const short = r.ticket.id.slice(-6).toUpperCase();
      setSheetOpen(false);
      setNote("");
      setHandoffHint(null);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          system: true,
          text: r.reused
            ? `你 10 分钟内已经提交过工单 #${short}，这次的内容已并入同一张，客服会一起看。`
            : `工单 #${short} 已提交。人工客服看到后会在「通知」里回复你${contactEmail.trim() ? "，也会发到你留的邮箱" : ""}。`,
        },
      ]);
      setTickets(null);
    } catch (e) {
      setSheetErr(errorText(e, "提交失败，稍后再试"));
    } finally {
      setSubmitting(false);
    }
  }

  function showTickets(open: boolean) {
    const next = new URLSearchParams(params);
    if (open) next.set("tab", "tickets");
    else {
      next.delete("tab");
      next.delete("ticket");
    }
    setParams(next, { replace: true });
  }

  const quick = config?.quickQuestions ?? [];

  return (
    <div className="safe-top flex h-dvh flex-col bg-ink text-slate-100">
      {/* 顶栏 */}
      <div className="flex h-12 shrink-0 items-center gap-2 px-2">
        <button onClick={() => (ticketsOpen ? showTickets(false) : navigate(-1))} aria-label="返回" className="flex h-11 w-11 items-center justify-center text-slate-300">
          <Icon name="back" size={20} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{ticketsOpen ? "我的工单" : `AI 客服 · ${name}`}</h1>
        {!ticketsOpen && (
          <button onClick={() => showTickets(true)} className="rounded-full border border-slate-700 px-3 py-1.5 text-[12px] text-slate-200 active:bg-slate-800/60">
            我的工单
          </button>
        )}
      </div>

      {ticketsOpen ? (
        <TicketsPanel tickets={tickets} err={ticketsErr} highlight={highlightTicket} onChanged={setTickets} />
      ) : (
        <>
          {/* 舞台 */}
          <div className="relative h-[36vh] shrink-0">
            <SupportStage className="absolute inset-0" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink to-transparent" />
            {subtitle && (
              <div className="absolute inset-x-4 bottom-2 rounded-2xl bg-slate-900/85 px-3 py-2 text-[13px] leading-5 text-slate-100 shadow-lg backdrop-blur">
                <span className="mr-1.5 text-[11px] font-semibold text-brand">{name}</span>
                {subtitle}
              </div>
            )}
          </div>

          {/* 对话 */}
          <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
            {messages.length === 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-[13px] leading-6 text-slate-300">
                你好，我是{name}，启梦的 AI 客服。账号、扣费、出片取回、安装更新这些都可以问我；我解决不了的会帮你转给人工。
                {configErr && <p className="mt-1 text-[12px] text-amber-300">{configErr}</p>}
                {!enabled && !configErr && <p className="mt-1 text-[12px] text-amber-300">服务端还没开通 AI 对话，你可以直接转人工。</p>}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[14px] leading-6 ${
                    m.role === "user"
                      ? "rounded-br-sm bg-brand text-ink"
                      : m.system
                        ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                        : "rounded-bl-sm bg-slate-800 text-slate-100"
                  }`}
                >
                  {m.text || (m.streaming ? `${name}在想…` : "")}
                </div>
              </div>
            ))}
            {handoffHint && phase === "idle" && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] leading-6 text-amber-100">
                这个问题需要人工处理（{CATEGORY_LABEL[handoffHint.category]}）。转人工会把这段对话一起交给客服，你不用再讲一遍。
                <div className="mt-2 flex gap-2">
                  <button onClick={openSheet} className="rounded-full bg-amber-400 px-3.5 py-1.5 text-[13px] font-semibold text-ink active:opacity-80">
                    转人工
                  </button>
                  <button onClick={() => setHandoffHint(null)} className="rounded-full border border-slate-600 px-3.5 py-1.5 text-[13px] text-slate-300 active:bg-slate-800/60">
                    先不用
                  </button>
                </div>
              </div>
            )}
            {chatErr && <p className="px-1 text-[12px] leading-5 text-rose-300">{chatErr}</p>}
          </div>

          {/* 输入区 */}
          <div className="shrink-0 border-t border-slate-800 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
            {messages.length === 0 && quick.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {quick.map((q) => (
                  <button key={q} onClick={() => void send(q)} className="shrink-0 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-[12px] text-slate-200 active:bg-slate-800">
                    {q}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="flex items-center gap-1.5"
            >
              <button
                type="button"
                onClick={toggleVoice}
                aria-pressed={voiceOn}
                aria-label={voiceOn ? "语音：开" : "语音：关"}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${voiceOn ? "text-brand" : "text-slate-500"}`}
              >
                <span className="text-lg">{voiceOn ? "🔊" : "🔇"}</span>
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={MAX_INPUT_CHARS}
                enterKeyHint="send"
                placeholder={enabled ? `问${name}：哪里不对？` : "AI 对话未开通，可直接转人工"}
                disabled={!enabled}
                className="h-10 min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-900 px-4 text-[14px] text-slate-100 outline-none placeholder:text-slate-500 disabled:opacity-60"
              />
              {phase !== "idle" ? (
                <button type="button" onClick={stopAll} aria-label="停止" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-200">
                  <span className="block h-3.5 w-3.5 rounded-sm bg-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() || !enabled}
                  aria-label="发送"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-ink disabled:opacity-40"
                >
                  <Icon name="send" size={18} />
                </button>
              )}
            </form>
            <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-slate-500">
              <span>{phase === "thinking" ? `${name}在想…` : phase === "speaking" ? `${name}在说…` : "AI 回答仅供参考，涉及退款与账号的事会转人工"}</span>
              <button onClick={openSheet} className="text-slate-300 underline decoration-slate-600 active:text-white">
                转人工
              </button>
            </div>
          </div>
        </>
      )}

      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => !submitting && setSheetOpen(false)}>
          <div className="w-full rounded-t-3xl bg-slate-900 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-semibold">转人工客服</h2>
            <p className="mt-1 text-[12px] leading-5 text-slate-400">
              会把{transcript.length ? `最近 ${transcript.length} 条对话` : "你的描述"}一起交给人工客服，回复会出现在「通知」和「我的工单」里。
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="还想补充什么？任务号、大概时间、屏幕上的提示…"
              className="mt-3 w-full resize-none rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-[14px] text-slate-100 outline-none placeholder:text-slate-500"
            />
            <input
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              type="email"
              inputMode="email"
              maxLength={120}
              placeholder="联系邮箱（选填，用手机号/QQ 登录的建议留一个）"
              className="mt-2 h-10 w-full rounded-full border border-slate-700 bg-slate-950 px-4 text-[13px] text-slate-100 outline-none placeholder:text-slate-500"
            />
            {sheetErr && <p className="mt-2 text-[12px] leading-5 text-rose-300">{sheetErr}</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => void submitTicket()} disabled={submitting} className="flex-1 rounded-full bg-brand py-2.5 text-[14px] font-semibold text-ink disabled:opacity-60">
                {submitting ? "提交中…" : "提交给人工客服"}
              </button>
              <button onClick={() => setSheetOpen(false)} disabled={submitting} className="rounded-full border border-slate-600 px-4 py-2.5 text-[14px] text-slate-300">
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 「我的工单」：列表 + 每张单可继续补充。四种状态都画出来：加载中 / 出错 / 空 / 有内容 */
function TicketsPanel({
  tickets,
  err,
  highlight,
  onChanged,
}: {
  tickets: SupportTicket[] | null;
  err: string;
  highlight: string;
  onChanged: (next: SupportTicket[]) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>("");
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  async function sendMore(t: SupportTicket) {
    const content = (drafts[t.id] || "").trim();
    if (!content || busy) return;
    setBusy(t.id);
    setRowErr((p) => ({ ...p, [t.id]: "" }));
    try {
      const r = await appendTicketMessage(t.id, content);
      onChanged((tickets || []).map((x) => (x.id === t.id ? r.ticket : x)));
      setDrafts((p) => ({ ...p, [t.id]: "" }));
    } catch (e) {
      setRowErr((p) => ({ ...p, [t.id]: errorText(e, "发送失败") }));
    } finally {
      setBusy("");
    }
  }

  if (err) return <p className="m-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-[12px] leading-relaxed text-rose-300">{err}</p>;
  if (!tickets) return <p className="m-3 text-[12px] text-slate-500">读取中…</p>;
  if (!tickets.length) return <p className="m-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-[13px] leading-6 text-slate-400">还没有工单。和 AI 客服聊不明白的问题，点「转人工」就会出现在这里。</p>;

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
      {tickets.map((t) => (
        <section key={t.id} className={`rounded-2xl border p-3 ${t.id === highlight ? "border-brand/60 bg-brand/5" : "border-slate-800 bg-slate-900/60"}`}>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-200">{TICKET_STATUS_LABEL[t.status]}</span>
            <span>{CATEGORY_LABEL[t.category]}</span>
            <span className="ml-auto">#{t.id.slice(-6).toUpperCase()} · {relativeTime(Date.parse(t.createdAt))}</span>
          </div>
          <h3 className="mt-1.5 text-[14px] font-semibold text-slate-100">{t.subject || "客服工单"}</h3>
          {t.summary && <p className="mt-1 text-[12px] leading-5 text-slate-400">{t.summary}</p>}
          {t.replies.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {t.replies.map((r) => (
                <div key={r.id} className={`rounded-xl px-3 py-2 text-[13px] leading-5 ${r.by === "admin" ? "bg-emerald-500/10 text-emerald-100" : "bg-slate-800 text-slate-200"}`}>
                  <span className="mr-1.5 text-[11px] text-slate-400">{r.by === "admin" ? "客服" : "我"} · {relativeTime(Date.parse(r.at))}</span>
                  {r.content}
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <input
              value={drafts[t.id] || ""}
              onChange={(e) => setDrafts((p) => ({ ...p, [t.id]: e.target.value }))}
              maxLength={2000}
              placeholder={t.status === "resolved" || t.status === "closed" ? "问题又出现了？补一句会重新打开" : "补充给客服…"}
              className="h-9 min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-950 px-3 text-[13px] text-slate-100 outline-none placeholder:text-slate-500"
            />
            <button
              onClick={() => void sendMore(t)}
              disabled={!(drafts[t.id] || "").trim() || busy === t.id}
              className="rounded-full bg-slate-700 px-3 py-1.5 text-[12px] text-slate-100 disabled:opacity-40"
            >
              {busy === t.id ? "…" : "发送"}
            </button>
          </div>
          {rowErr[t.id] && <p className="mt-1 text-[12px] text-rose-300">{rowErr[t.id]}</p>}
        </section>
      ))}
    </div>
  );
}
