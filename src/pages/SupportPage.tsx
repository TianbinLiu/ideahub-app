/**
 * AI 客服页（/support）：看板娘数字人 + 流式问答 + 转人工工单。
 *
 * 布局是「数字人占屏」：舞台铺满整页、看板娘占约 8 成高度；顶栏、字幕、输入区都是压在舞台上的半透明浮层，
 * 对话区只留最近的一问一答（用户小气泡 + 数字人字幕气泡），完整记录收进底部抽屉「记录」——
 * 这是豆包语音通话 / Character.AI 语音模式 / 各家数字人客服的通用构图：人是主体，文字是字幕。
 *
 * 一句话的旅程：
 *   POST /api/support/chat（SSE）每来一条 sentence → 立刻发起该句的 /api/tts（不等上一句播完）
 *   → 按顺序排进演出队列：切表情 + 触发动作 + 舞台字幕 + 播放（口型跟包络）
 *   → 没音频（语音关 / TTS 失败 / 未配置）就按字数合成口型撑时长。
 *   服务端判定该转人工时发 `handoff` 事件 → 输入区上方出现「转人工」卡；用户也随时可以自己点「转人工」。
 *   回答完整后字幕下方出 👍👎，连问题与回答原文交给服务端（差评是改知识库的线索）；👎 顺手给转人工入口。
 *   输入条左侧「按住说话」→ /api/asr 识别 → 识别出的文字直接当作一句提问发出（语音助手的惯例）。
 *
 * ★ 演出是串行 Promise 链而不是 state：句子异步乱序到达，用 state 排队会丢句/乱序（与官网首页同一套做法）。
 * ★ runId 递增 = 「停止」：队列里的旧任务看到 run 变了就放弃，不用逐个取消。
 * ★ 语音开关与「铸卡师的声音」共用 data 层那一个键（studio/speech.voiceEnabled）：一个规则一处实现。
 * ★ 舞台常驻不卸载：「记录」「我的工单」都是盖在舞台上的浮层，切来切去不会重建 WebGL 上下文。
 * ★ 登录墙由路由的 RequireAuth 管；这里拿到的 user 一定存在。
 * ★ 所有失败就地整句说明（api:error 没人听），绝不静默。
 * ★ 换装（2026-09-04）：人格 / 形象 / 声音三项选择存在服务端（/api/companion/settings，官网与 App 同一份）。
 *   形象与人格各是一页市场（/support/models、/support/personas），声音是页内的底部面板（VoiceSheet：单音色 / 混音 / 声音市场三页）；
 *   顶栏右下挂一列「形象 / 人格 / 声音」小键 —— 顶栏本身已经放不下三颗带字的键（360 宽的机器上会把名字挤没）。
 *   念台词的 /api/tts 参数来自 config.voiceSettings（服务端算好的合并结果），老服务端没有它就按旧写法只传 voice。
 *   舞台的模型地址来自 settings.model.modelJsonUrl；设置还没回来之前舞台先等（最多 1.5s），免得先起官方再销毁重建。
 *   从市场页回来这一页会重新挂载（不同路由），config 与 settings 都在挂载时重拉，所以换完立即生效。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import Icon from "../components/Icon";
import SupportStage from "../components/support/SupportStage";
import HoldToTalk from "../components/support/HoldToTalk";
import VoiceSheet from "../components/support/VoiceSheet";
import { companionBus } from "../companion/bus";
import { SpeechPlayer } from "../companion/speech";
import { estimateSpeechMs, normalizeAction, normalizeFace, type CompanionSentence, pickTouchReaction } from "../companion/protocol";
import { setVoiceEnabled, voiceEnabled } from "../studio/speech";
import { ApiError } from "../api/client";
import { getCompanionSettings, resolveModelJsonUrl, type CompanionSettings } from "../api/companion";
import {
  CATEGORY_LABEL,
  TICKET_STATUS_LABEL,
  appendTicketMessage,
  createSupportTicket,
  getSupportConfig,
  listMySupportTickets,
  rateSupportAnswer,
  streamSupportChat,
  synthesizeSpeech,
  type SupportCategory,
  type SupportConfig,
  type SupportTicket,
  type TtsRequest,
} from "../api/support";
import { relativeTime } from "../types";

type Role = "user" | "assistant";
type Rating = "up" | "down";
type ChatMessage = { id: string; role: Role; text: string; streaming?: boolean; system?: boolean; rating?: Rating };
type Phase = "idle" | "thinking" | "speaking";

const MAX_HISTORY = 12;
const MAX_INPUT_CHARS = 1000;
const TRANSCRIPT_MAX = 30;
/** 顶栏高度：模型的头顶从它下面开始 */
const TOP_BAR_PX = 58; // = safe-top 的 10px 呼吸 + 48px 一行（与 PageHeader 同高）
/** 看板娘身高占整页高度的比例 */
const MODEL_HEIGHT_FRACTION = 0.8;

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

const GLASS = "border border-white/10 bg-slate-950/55 backdrop-blur-md";
/** 设置这么久还没回来就先按官方形象起舞台（之后设置到了再换）：别让一个卡住的请求把人也拖没了 */
const STAGE_WAIT_MS = 1500;

/**
 * 一句台词的 /api/tts 请求体（一处实现）。voiceSettings 是服务端算好的三层合并结果
 * （用户覆盖 > 人格自带 > 模型推荐 > 默认）；情绪与语调指令来自这一句 —— 服务端已把「人设语调；情绪语调」
 * 合并进 sentence.tts.instruct。老服务端没有 voiceSettings → 退回旧写法（只有 voice + expressive:true）。
 * ★ 混音（voiceSettings.mix，1.0 音色）只发 mix + rate + pitch：voice 不传（服务端 speaker 固定 custom_mix_bigtts）、
 *   instruct / expressive 不传（context_texts 与表现力增强都是 2.0 专属，服务端对混音也直接丢弃）、emotion 也不传 ——
 *   混音 speaker 吃不吃 emotion 上游没写明，而 TTS 失败在这一页是**静默**退成合成口型（整段对话哑掉、没有一句报错），
 *   为一点情绪起伏赌整条声音不值。面板里的试听（VoiceMixer / VoiceMarket）发的也是这三个字段：听到的就是之后念台词的。
 */
function ttsBodyFor(config: SupportConfig | null, sentence: CompanionSentence): TtsRequest {
  const vs = config?.voiceSettings;
  if (!vs) return { text: sentence.text, voice: config?.voice || undefined, emotion: sentence.tts?.emotion, instruct: sentence.tts?.instruct, expressive: true };
  if (vs.mix?.length) return { text: sentence.text, mix: vs.mix, rate: vs.rate ?? undefined, pitch: vs.pitch ?? undefined };
  return {
    text: sentence.text,
    voice: vs.voiceId || undefined,
    rate: vs.rate ?? undefined,
    pitch: vs.pitch ?? undefined,
    expressive: vs.expressive,
    emotion: sentence.tts?.emotion,
    instruct: sentence.tts?.instruct,
  };
}

/** 顶栏右下那一列小键（形象 / 人格 / 声音）：图标 + 两个字，和顶栏其它键同一套玻璃材质 */
function RailButton({ emoji, label, onClick }: { emoji: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} className={`${GLASS} flex h-12 w-12 flex-col items-center justify-center rounded-2xl text-slate-100 active:bg-slate-800/70`}>
      <span className="text-[16px] leading-none">{emoji}</span>
      <span className="mt-1 text-[10px] leading-none">{label}</span>
    </button>
  );
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
  /** 触摸反应正在说 / 刚说完的那句（不进 messages，所以单独记一份给字幕气泡） */
  const [reaction, setReaction] = useState("");
  const [voiceOn, setVoiceOn] = useState(voiceEnabled);
  const [chatErr, setChatErr] = useState("");
  const [micErr, setMicErr] = useState("");
  const [handoffHint, setHandoffHint] = useState<{ category: SupportCategory } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [note, setNote] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sheetErr, setSheetErr] = useState("");
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [ticketsErr, setTicketsErr] = useState("");
  /** 数字人三项选择（人格 / 形象 / 声音覆盖）；null = 还没读到 / 老服务端 */
  const [settings, setSettings] = useState<CompanionSettings | null>(null);
  /** settings 请求已有结果（成功或失败）：舞台据此决定用哪个模型 */
  const [settingsSettled, setSettingsSettled] = useState(false);
  const [stageSlow, setStageSlow] = useState(false);
  /** 形象 / 设置这条线上的一句交代（市场形象加载失败退回官方、设置读不到…） */
  const [stageNotice, setStageNotice] = useState("");
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  const ticketsOpen = params.get("tab") === "tickets";
  const highlightTicket = params.get("ticket") || "";

  const playerRef = useRef<SpeechPlayer | null>(null);
  const runRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const abortRef = useRef<AbortController | null>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  const name = config?.name || "小梦";
  const enabled = config ? config.enabled : true;
  const asrOn = Boolean(config?.asr);

  useEffect(() => {
    let alive = true;
    getSupportConfig()
      .then((c) => alive && setConfig(c))
      .catch((e) => {
        if (!alive) return;
        // 老服务端 / 离线：对话不可用，但转人工入口（邮箱）还在
        setConfig({ ok: true, name: "小梦", enabled: false, tts: false, asr: false, voice: "", loginRequired: true, quickQuestions: [], categories: [] });
        setConfigErr(errorText(e, "读不到客服配置"));
      });
    return () => {
      alive = false;
    };
  }, []);

  // 数字人设置：舞台要它决定模型地址，顶栏芯片要它显示形象名。
  // 404 = 老服务端没有这个接口、0 = 没网（config 那边已经整句说明了）：这两种静默按官方形象走；其它失败要交代一句。
  useEffect(() => {
    let alive = true;
    getCompanionSettings()
      .then((s) => alive && setSettings(s))
      .catch((e) => {
        if (!alive || (e instanceof ApiError && (e.status === 404 || e.status === 0))) return;
        setStageNotice(`读不到数字人设置（${errorText(e, "服务端出错")}），先按官方形象和默认声音走。`);
      })
      .finally(() => alive && setSettingsSettled(true));
    const timer = window.setTimeout(() => alive && setStageSlow(true), STAGE_WAIT_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
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

  const lastUser = useMemo(() => [...messages].reverse().find((m) => m.role === "user") || null, [messages]);
  const lastAssistant = useMemo(() => [...messages].reverse().find((m) => m.role === "assistant") || null, [messages]);

  // 字幕随流式文字增长时保持滚到底
  useEffect(() => {
    const el = captionRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastAssistant?.text]);

  const transcript = useMemo(
    () => messages.filter((m) => !m.system && m.text.trim()).slice(-TRANSCRIPT_MAX).map((m) => ({ role: m.role, content: m.text.slice(0, 2000) })),
    [messages],
  );

  function getPlayer() {
    if (!playerRef.current) playerRef.current = new SpeechPlayer();
    return playerRef.current;
  }

  /** 声音面板存过之后重拉：voiceSettings 是服务端算的合并结果，本地拼不出来 */
  function refreshCompanion() {
    getSupportConfig()
      .then(setConfig)
      .catch((e) => setStageNotice(`设置已保存，但重新读取配置失败（${errorText(e, "网络问题")}），下次进来会按新设置念。`));
    getCompanionSettings()
      .then(setSettings)
      .catch(() => undefined);
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

  // 触摸反应：舞台报上来的命中区 → 演一句预置台词（不进 LLM、不进聊天记录，只是"碰一下有反应"）；说话/思考中不打断，1.8s 内只理一次
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const lastTouchRef = useRef(0);
  useEffect(
    () =>
      companionBus.onHit((areas) => {
        const nowMs = Date.now();
        if (phaseRef.current !== "idle" || nowMs - lastTouchRef.current < 1800) return;
        const pick = pickTouchReaction(areas, "zh");
        if (!pick) return;
        lastTouchRef.current = nowMs;
        stopAll();
        setReaction(pick.text);
        const run = runRef.current;
        const controller = new AbortController();
        const sentence: CompanionSentence = { index: 0, text: pick.text, emotion: pick.emotion, face: pick.face, action: pick.action, tts: { emotion: pick.emotion, instruct: "" } };
        const audio: Promise<Blob | null> =
          voiceOn && Boolean(config?.tts) ? synthesizeSpeech(ttsBodyFor(config, sentence), controller.signal).catch(() => null) : Promise.resolve(null);
        void enqueue(run, () => perform(run, sentence, audio, controller.signal)).then(() => {
          if (runRef.current === run) setPhase("idle");
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stopAll/enqueue/perform 是组件内的函数声明，随渲染同步
    [config, voiceOn],
  );

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceEnabled(next);
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim().slice(0, MAX_INPUT_CHARS);
    if (!text) return;
    if (!enabled) {
      setChatErr(`服务端还没开通 AI 对话，${name}暂时不能回答；可以直接点「转人工」。`);
      return;
    }
    stopAll();
    setChatErr("");
    setMicErr("");
    setStageNotice("");
    setReaction("");
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
              ? synthesizeSpeech(ttsBodyFor(config, sentence), controller.signal).catch(() => null)
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

  /** 👍👎：先本地记下（立刻有反馈），再尽力交给服务端；失败不打扰用户 */
  function rate(msg: ChatMessage, rating: Rating) {
    if (msg.rating === rating) return;
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, rating } : m)));
    const idx = messages.findIndex((m) => m.id === msg.id);
    const question = [...messages.slice(0, Math.max(0, idx))].reverse().find((m) => m.role === "user")?.text || "";
    void rateSupportAnswer({ question: question.slice(0, 1000) || "（无）", answer: msg.text.slice(0, 4000), rating }).catch(() => undefined);
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

  // 顶栏芯片与舞台地址：settings 与 config 都带人格/形象，哪个先到用哪个（两者同拍重拉，不会打架）
  const persona = config?.persona ?? settings?.persona ?? null;
  const marketModel = settings?.model ?? config?.model ?? null;
  const marketModelUrl = marketModel ? resolveModelJsonUrl(marketModel.modelJsonUrl) : "";
  const quick = config?.quickQuestions ?? [];
  const statusLabel = phase === "thinking" ? "思考中" : phase === "speaking" ? "说话中" : enabled ? "在线" : "对话未开通";
  const greeting = `你好，我是${name}，启梦的 AI 客服。账号、扣费、出片取回、安装更新都可以问我；我解决不了的会帮你转给人工。`;
  const canRate = Boolean(lastAssistant && !lastAssistant.system && !lastAssistant.streaming && lastAssistant.text && phase === "idle");

  return (
    <div className="relative h-dvh overflow-hidden bg-ink text-slate-100">
      {/* 舞台：铺满整页，环境光打在人身上 */}
      <SupportStage
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,rgba(56,189,248,0.22),transparent_62%),linear-gradient(180deg,#0b1220_0%,#070d18_60%,#040810_100%)]"
        topPx={TOP_BAR_PX}
        heightFraction={MODEL_HEIGHT_FRACTION}
        modelUrl={marketModelUrl}
        waiting={!settingsSettled && !stageSlow}
        onFallback={(reason) => setStageNotice(`这套形象加载失败（${reason.slice(0, 80)}），先换回官方形象；可以去「形象」里重新下载或换一套。`)}
      />

      {/* 顶栏浮层 */}
      {/* 渐变只是装饰：pointer-events-none 让它下面的模型头部能被摸到（真机上头正好在这块渐变里），按钮那一行再打开 */}
      <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-ink/85 via-ink/40 to-transparent pb-8">
        <div className="pointer-events-auto flex h-12 items-center gap-1 px-2">
          <button onClick={() => navigate(-1)} aria-label="返回" className="flex h-11 w-11 items-center justify-center text-slate-200">
            <Icon name="back" size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-semibold">{name}</span>
              <span className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-200">
                <span className={`h-1.5 w-1.5 rounded-full ${phase === "idle" ? (enabled ? "bg-emerald-400" : "bg-slate-500") : "bg-brand animate-pulse"}`} />
                {statusLabel}
              </span>
            </div>
            {persona || marketModel ? (
              <div className="flex min-w-0 items-center gap-1 text-[11px]">
                {persona && <span className="max-w-[48%] truncate rounded-full bg-fuchsia-500/20 px-1.5 text-fuchsia-200">人格：{persona.name}</span>}
                {marketModel && <span className="max-w-[48%] truncate rounded-full bg-sky-500/20 px-1.5 text-sky-200">形象：{marketModel.name}</span>}
              </div>
            ) : (
              <div className="truncate text-[11px] text-slate-400">启梦 AI 客服 · 解决不了转人工</div>
            )}
          </div>
          <button
            onClick={toggleVoice}
            aria-pressed={voiceOn}
            aria-label={voiceOn ? "语音播报：开" : "语音播报：关"}
            title={voiceOn ? "语音播报：开" : "语音播报：关"}
            className={`${GLASS} flex h-9 w-9 items-center justify-center rounded-full text-[15px] ${voiceOn ? "text-brand" : "text-slate-500"}`}
          >
            {voiceOn ? "🔊" : "🔇"}
          </button>
          <button onClick={() => setHistoryOpen(true)} className={`${GLASS} rounded-full px-3 py-1.5 text-[12px] text-slate-100 active:bg-slate-800/70`}>
            记录{messages.length > 0 ? ` ${Math.ceil(messages.filter((m) => !m.system).length / 2)}` : ""}
          </button>
          <button onClick={() => showTickets(true)} className={`${GLASS} rounded-full px-3 py-1.5 text-[12px] text-slate-100 active:bg-slate-800/70`}>
            工单
          </button>
        </div>
      </div>

      {/* 形象 / 人格 / 声音：挂在顶栏右下的一列小键（见文件头 ★ 换装） */}
      <div className="absolute right-2 z-10 flex flex-col gap-2" style={{ top: `calc(env(safe-area-inset-top, 0px) + ${TOP_BAR_PX + 14}px)` }}>
        <RailButton emoji="👗" label="形象" onClick={() => navigate("/support/models")} />
        <RailButton emoji="🎭" label="人格" onClick={() => navigate("/support/personas")} />
        {/* 在用混音（自己调的或声音市场的模板）时写「混音」：让人知道这颗键后面的东西变了 */}
        <RailButton emoji="🎙️" label={config?.voiceSettings?.mix?.length ? "混音" : "声音"} onClick={() => setVoiceSheetOpen(true)} />
      </div>

      {/* 底部浮层：最近一问一答 + 转人工卡 + 快捷问题 + 输入区 */}
      {/* 同上：底部渐变的 pt-20 会盖住裙摆/腿，容器不吃事件，里面每一块（字幕、快捷问、输入框）再打开 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col justify-end bg-gradient-to-t from-ink via-ink/80 to-transparent px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-20 [&>*]:pointer-events-auto">
        {lastUser && (
          <div className="mb-2 flex justify-end">
            <div className="max-w-[78%] truncate rounded-2xl rounded-br-sm bg-brand/90 px-3 py-1.5 text-[13px] text-ink">{lastUser.text}</div>
          </div>
        )}

        {/* 字幕气泡：数字人正在说 / 刚说完的整段；点正文看完整记录；说完后出 👍👎 */}
        <div className={`${GLASS} mb-2 w-full rounded-2xl rounded-bl-sm px-3.5 py-2.5 shadow-lg`}>
          <div className="mb-0.5 flex items-center gap-2 text-[11px] text-brand">
            <span className="font-semibold">{name}</span>
            {phase === "speaking" && subtitle && <span className="text-slate-400">正在说这句 →</span>}
            {phase === "thinking" && <span className="text-slate-400">在想…</span>}
          </div>
          <div
            ref={captionRef}
            role="button"
            tabIndex={0}
            onClick={() => setHistoryOpen(true)}
            onKeyDown={(e) => e.key === "Enter" && setHistoryOpen(true)}
            aria-label="查看完整对话记录"
            className={`max-h-[26vh] overflow-y-auto text-[14px] leading-6 ${lastAssistant?.system ? "text-emerald-100" : "text-slate-100"}`}
          >
            {reaction || lastAssistant?.text || (phase === "thinking" ? "…" : greeting)}
            {configErr && !messages.length && <p className="mt-1 text-[12px] text-amber-300">{configErr}</p>}
            {!enabled && !configErr && !messages.length && <p className="mt-1 text-[12px] text-amber-300">服务端还没开通 AI 对话，你可以直接转人工。</p>}
          </div>
          {canRate && lastAssistant && (
            <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2 text-[11px] text-slate-400">
              <span className="min-w-0 flex-1 truncate">
                {lastAssistant.rating === "up" ? "谢谢反馈" : lastAssistant.rating === "down" ? "抱歉没帮上，要不要转人工？" : "这个回答有帮助吗？"}
              </span>
              {lastAssistant.rating === "down" && (
                <button onClick={openSheet} className="rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-ink active:opacity-80">
                  转人工
                </button>
              )}
              <button
                onClick={() => rate(lastAssistant, "up")}
                aria-label="有帮助"
                aria-pressed={lastAssistant.rating === "up"}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[15px] ${lastAssistant.rating === "up" ? "bg-emerald-500/25" : "active:bg-white/10"}`}
              >
                👍
              </button>
              <button
                onClick={() => rate(lastAssistant, "down")}
                aria-label="没帮上"
                aria-pressed={lastAssistant.rating === "down"}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[15px] ${lastAssistant.rating === "down" ? "bg-rose-500/25" : "active:bg-white/10"}`}
              >
                👎
              </button>
            </div>
          )}
        </div>

        {handoffHint && phase === "idle" && (
          <div className="mb-2 rounded-2xl border border-amber-400/40 bg-amber-500/15 p-3 text-[13px] leading-6 text-amber-50 backdrop-blur-md">
            这个问题需要人工处理（{CATEGORY_LABEL[handoffHint.category]}）。转人工会把这段对话一起交给客服，你不用再讲一遍。
            <div className="mt-2 flex gap-2">
              <button onClick={openSheet} className="rounded-full bg-amber-400 px-3.5 py-1.5 text-[13px] font-semibold text-ink active:opacity-80">
                转人工
              </button>
              <button onClick={() => setHandoffHint(null)} className="rounded-full border border-white/20 px-3.5 py-1.5 text-[13px] text-slate-200 active:bg-slate-800/60">
                先不用
              </button>
            </div>
          </div>
        )}
        {chatErr && <p className="mb-2 px-1 text-[12px] leading-5 text-rose-300">{chatErr}</p>}
        {micErr && <p className="mb-2 px-1 text-[12px] leading-5 text-amber-300">{micErr}</p>}
        {stageNotice && <p className="mb-2 px-1 text-[12px] leading-5 text-amber-300">{stageNotice}</p>}

        {messages.length === 0 && phase === "idle" && quick.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none]">
            {quick.map((q) => (
              <button key={q} onClick={() => void send(q)} className={`${GLASS} shrink-0 rounded-full px-3 py-1.5 text-[12px] text-slate-100 active:bg-slate-800/70`}>
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
          className={`${GLASS} flex items-center gap-1 rounded-full p-1.5 shadow-xl`}
        >
          {asrOn && enabled && (
            <HoldToTalk
              disabled={phase !== "idle"}
              onText={(text) => {
                setMicErr("");
                void send(text);
              }}
              onError={setMicErr}
            />
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={MAX_INPUT_CHARS}
            enterKeyHint="send"
            placeholder={enabled ? (asrOn ? `按住说话，或问${name}：哪里不对？` : `问${name}：哪里不对？`) : "AI 对话未开通，可直接转人工"}
            disabled={!enabled}
            className="h-10 min-w-0 flex-1 bg-transparent px-2 text-[14px] text-slate-100 outline-none placeholder:text-slate-500 disabled:opacity-60"
          />
          {phase !== "idle" ? (
            <button type="button" onClick={stopAll} aria-label="停止" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/25 text-rose-200">
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
        <div className="mt-1.5 flex items-center justify-between px-2 text-[11px] text-slate-400">
          <span>AI 回答仅供参考，涉及退款与账号的事会转人工</span>
          <button onClick={openSheet} className="text-slate-200 underline decoration-slate-500 active:text-white">
            转人工
          </button>
        </div>
      </div>

      {historyOpen && <HistorySheet name={name} messages={messages} onClose={() => setHistoryOpen(false)} />}

      {voiceSheetOpen && (
        <VoiceSheet name={name} settings={settings} merged={config?.voiceSettings} onClose={() => setVoiceSheetOpen(false)} onSaved={refreshCompanion} />
      )}

      {ticketsOpen && (
        <div className="absolute inset-0 z-20 flex flex-col bg-ink">
          <div className="safe-top flex h-12 shrink-0 items-center gap-2 px-2">
            <button onClick={() => showTickets(false)} aria-label="返回" className="flex h-11 w-11 items-center justify-center text-slate-300">
              <Icon name="back" size={20} />
            </button>
            <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">我的工单</h1>
          </div>
          <TicketsPanel tickets={tickets} err={ticketsErr} highlight={highlightTicket} onChanged={setTickets} />
        </div>
      )}

      {sheetOpen && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={() => !submitting && setSheetOpen(false)}>
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

/** 完整对话记录：底部抽屉，数字人仍在后面 */
function HistorySheet({ name, messages, onClose }: { name: string; messages: ChatMessage[]; onClose: () => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onClose}>
      <div className="flex max-h-[72vh] w-full flex-col rounded-t-3xl border-t border-white/10 bg-slate-950/95 backdrop-blur-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-12 shrink-0 items-center px-4">
          <span className="text-[14px] font-semibold text-slate-100">对话记录</span>
          <span className="ml-2 text-[11px] text-slate-500">{messages.filter((m) => !m.system).length} 条</span>
          <button onClick={onClose} aria-label="关闭" className="ml-auto flex h-10 w-10 items-center justify-center text-slate-300">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-[max(env(safe-area-inset-bottom),16px)]">
          {messages.length === 0 && <p className="py-6 text-center text-[12px] text-slate-500">还没有对话。</p>}
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
                {m.role === "assistant" && !m.system && <span className="mr-1.5 text-[11px] text-brand">{name}</span>}
                {m.text || (m.streaming ? "…" : "")}
                {m.rating && <span className="ml-1.5 text-[11px]">{m.rating === "up" ? "👍" : "👎"}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
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
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2 pb-[max(env(safe-area-inset-bottom),16px)]">
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
