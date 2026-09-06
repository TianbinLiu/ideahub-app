/**
 * 按住说话（AI 客服页的语音输入）。
 *
 * pointerdown 起录、松手即停 → PCM 重采样封成 24k 单声道 WAV（utils/wav 那份唯一实现）→ POST /api/asr → 识别文本交给父组件。
 * 微信式的语义：按住的时候显示"松开 发送"和秒数，手指移出按钮再松开 = 取消；最长 30 秒硬停；短于 0.6 秒整句拒。
 *
 * ★ 为什么不用浏览器的 SpeechRecognition：Android WebView 里根本没有这个 API（只有 Chrome 浏览器有），
 *   APK 里一定拿不到；服务端识别一条路，Web/dev 与真机行为一致。
 * ★ 与 VoiceRecorder（真人卡跟读）走同一条采集管线（getUserMedia → ScriptProcessor 直取 PCM），
 *   但窗口与语义不同（那边 2~15s 且要保真，这边 0.6~30s 且识别完即弃），所以是两个组件；编码器共用。
 * ★ 麦克风权限是原生权限：拒绝过的整句告诉用户去系统设置打开（铁律八，不静默）。
 * ★ 识别失败/没识别出字都在按钮下方整句说明，不弹 toast（api:error 没人听）。
 */
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { transcribeAudio } from "../../api/support";
import { pcmToVoiceWav } from "../../utils/wav";

const MIN_SEC = 0.6;
const MAX_SEC = 30;

type Props = {
  disabled?: boolean;
  /** 识别出的文字（已 trim、非空） */
  onText: (text: string) => void;
  /** 整句错误说明；空串 = 清掉之前的错误 */
  onError: (message: string) => void;
  className?: string;
};

export default function HoldToTalk({ disabled, onText, onError, className = "" }: Props) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  const recordingRef = useRef(false);
  const pressedRef = useRef(false);
  const cancelRef = useRef(false);
  const stoppingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const graphRef = useRef<{ ctx: AudioContext; proc: ScriptProcessorNode; src: MediaStreamAudioSourceNode } | null>(null);
  const pcmRef = useRef<Float32Array[]>([]);
  const startedAt = useRef(0);
  const timerRef = useRef<number | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      // 卸载时别让麦克风亮着
      if (timerRef.current) window.clearInterval(timerRef.current);
      graphRef.current?.proc.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void graphRef.current?.ctx.close().catch(() => undefined);
    },
    [],
  );

  async function start() {
    if (recordingRef.current || busy || disabled) return;
    onError("");
    cancelRef.current = false;
    setCancelling(false);
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 授权弹窗期间手已经松了：别录一段"孤儿录音"
      if (!pressedRef.current) {
        ms.getTracks().forEach((t) => t.stop());
        onError("麦克风授权好了，再按住说一次。");
        return;
      }
      streamRef.current = ms;
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(ms);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0; // 不能让麦克风直通喇叭，会啸叫
      src.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);
      pcmRef.current = [];
      proc.onaudioprocess = (e) => {
        const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
        pcmRef.current.push(chunk);
        let sum = 0;
        for (let i = 0; i < chunk.length; i += 1) sum += chunk[i] * chunk[i];
        setLevel(Math.min(1, Math.sqrt(sum / chunk.length) * 6));
      };
      graphRef.current = { ctx, proc, src };
      stoppingRef.current = false;
      startedAt.current = Date.now();
      setElapsed(0);
      recordingRef.current = true;
      setRecording(true);
      timerRef.current = window.setInterval(() => {
        const secs = (Date.now() - startedAt.current) / 1000;
        setElapsed(secs);
        if (secs >= MAX_SEC) void stop(); // 判 ref 不判 state，闭包里的 state 是陈旧的
      }, 100);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      onError(
        /denied|permission|NotAllowed/i.test(raw)
          ? "拿不到麦克风权限。在系统弹窗里点允许；拒绝过的话去系统设置 → 应用 → 启梦 → 权限里打开麦克风。"
          : /NotFound|no.*device/i.test(raw)
            ? "这台设备没有可用的麦克风。"
            : `麦克风打不开：${raw}`,
      );
    }
  }

  async function stop() {
    if (!recordingRef.current || stoppingRef.current) return;
    stoppingRef.current = true;
    recordingRef.current = false;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    setLevel(0);

    const g = graphRef.current;
    const ms = streamRef.current;
    graphRef.current = null;
    streamRef.current = null;
    const rate = g?.ctx.sampleRate ?? 48000;
    g?.proc.disconnect();
    ms?.getTracks().forEach((t) => t.stop());
    await g?.ctx.close().catch(() => undefined);

    const secs = (Date.now() - startedAt.current) / 1000;
    const chunks = pcmRef.current;
    pcmRef.current = [];
    if (cancelRef.current) {
      cancelRef.current = false;
      setCancelling(false);
      return;
    }
    if (secs < MIN_SEC) {
      onError("太短了，按住多说一会儿再松手。");
      return;
    }
    const total = chunks.reduce((n, a) => n + a.length, 0);
    if (total < rate * 0.3) {
      onError("没抓到声音，检查麦克风是不是被别的 App 占着。");
      return;
    }
    const keep = Math.min(total, Math.round(MAX_SEC * rate));
    const flat = new Float32Array(keep);
    let off = 0;
    for (const c of chunks) {
      if (off >= keep) break;
      const slice = c.subarray(0, Math.min(c.length, keep - off));
      flat.set(slice, off);
      off += slice.length;
    }

    setBusy(true);
    try {
      const dataUrl = await pcmToVoiceWav(flat, rate);
      const blob = await (await fetch(dataUrl)).blob();
      const { text } = await transcribeAudio(blob, "wav");
      if (!text) {
        // 上游判定整段静音：多半是按住了没出声、或离麦太远（真机实测第一次就是这样）
        onError("没听到声音：按住的时候靠近一点说，说完再松手。");
        return;
      }
      onText(text);
    } catch (e) {
      if (e instanceof ApiError) {
        onError(
          e.status === 501
            ? "服务端还没开通语音识别，先打字吧。"
            : e.status === 502
              ? "语音识别暂时不可用（上游没接住），先打字吧。"
              : e.status === 429
                ? "说得太频繁了，稍等几秒。"
                : e.message || "语音识别失败",
        );
      } else {
        onError(`语音识别失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || busy) return;
    e.preventDefault();
    pressedRef.current = true;
    try {
      btnRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* 有的 WebView 不支持，靠 pointerup 兜底 */
    }
    void start();
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!recordingRef.current) return;
    // 手指滑出按钮 ≈ 微信的"上滑取消"
    const r = btnRef.current?.getBoundingClientRect();
    const outside = !r || e.clientX < r.left - 24 || e.clientX > r.right + 24 || e.clientY < r.top - 60 || e.clientY > r.bottom + 24;
    cancelRef.current = outside;
    setCancelling(outside);
  }

  function onPointerUp() {
    pressedRef.current = false;
    void stop();
  }

  return (
    <div className={`relative shrink-0 ${className}`}>
      {(recording || busy) && (
        <div className="pointer-events-none absolute bottom-[calc(100%+10px)] left-0 z-10 flex w-52 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/85 px-3 py-2 text-xs text-slate-100 shadow-xl backdrop-blur-md">
          {busy ? (
            <span>识别中…</span>
          ) : (
            <>
              <span className={`h-2.5 w-2.5 rounded-full ${cancelling ? "bg-slate-500" : "bg-rose-500 animate-pulse"}`} />
              <span className="min-w-0 flex-1 truncate">{cancelling ? "松开取消" : `松开发送 · ${elapsed.toFixed(1)}s`}</span>
              <span className="flex h-3 w-10 items-end gap-0.5" aria-hidden="true">
                {[0.3, 0.6, 1, 0.6, 0.3].map((k, i) => (
                  <span key={i} className="w-1.5 rounded-sm bg-brand" style={{ height: `${Math.max(15, Math.min(100, level * 100 * k + 15))}%` }} />
                ))}
              </span>
            </>
          )}
        </div>
      )}
      <button
        ref={btnRef}
        type="button"
        disabled={disabled || busy}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={recording ? "松开发送" : "按住说话"}
        aria-pressed={recording}
        className={`flex h-10 w-10 select-none items-center justify-center rounded-full transition [touch-action:none] ${
          recording ? (cancelling ? "bg-slate-600 text-slate-200" : "bg-rose-500 text-white scale-110") : "text-slate-300 active:bg-white/10"
        } disabled:opacity-40`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19v3" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <rect x="9" y="2" width="6" height="13" rx="3" />
        </svg>
      </button>
    </div>
  );
}
