/**
 * 老师说话（M4，tutor 仓 docs/06 §6.1「老师会说话：/api/tts + Live2D 舞台」）—— 一句话的旅程与客服页同一套：
 *   SSE 每来一条 sentence → 立刻发起该句的 /api/tts（不等上一句播完）→ 按顺序排进演出队列 → 播放（口型跟包络）；
 *   没音频（语音关 / TTS 失败 / 未配置）就按字数合成口型撑时长，字幕照出。
 * ★ 演出是串行 Promise 链而不是 state：句子异步乱序到达，用 state 排队会丢句 / 乱序（客服页同一个理由）。
 * ★ runId 递增 = 「停止」：队列里的旧任务看到 run 变了就放弃，不用逐个取消。
 * ★ 语音开关与客服页 / 铸卡师共用 studio/speech 那一个键（一个规则一处实现）；🔇 用单独的中止器只停声音，字照样出完。
 * ★ **只在这位老师勾了「同时发布为启梦人格」时启用**（enabled）：没勾的是纯文字 —— speak 是空操作、不拉 TTS 配置、舞台不挂
 *   （docs/06 §6.4「装进去的只是说话风格」，这条边界靠这一格守；判据来自 server run bundle 的 companion.enabled）。
 * ★ /api/tts 的请求体与客服页同一份 ttsBodyFor（api/support）：用户在客服页选的声音，老师上课也用它。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { companionBus } from "../../companion/bus";
import { SpeechPlayer } from "../../companion/speech";
import { estimateSpeechMs, normalizeAction, normalizeFace, type CompanionSentence } from "../../companion/protocol";
import { setVoiceEnabled, voiceEnabled } from "../../studio/speech";
import { getSupportConfig, synthesizeSpeech, ttsBodyFor, type SupportConfig } from "../../api/support";

export type SpeechTurn = { run: number; signal: AbortSignal };

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

/** 两个中止器并联：谁先响都停（整轮的 controller + 🔇 那个只管声音的） */
function eitherSignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const fire = () => ctrl.abort();
  if (a.aborted || b.aborted) ctrl.abort();
  else {
    a.addEventListener("abort", fire, { once: true });
    b.addEventListener("abort", fire, { once: true });
  }
  return ctrl.signal;
}

export function useTeacherSpeech(enabled: boolean) {
  const [voiceOn, setVoiceOnState] = useState(voiceEnabled);
  const [config, setConfig] = useState<SupportConfig | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;
  const configRef = useRef<SupportConfig | null>(null);
  configRef.current = config;
  const muteRef = useRef(new AbortController());
  const playerRef = useRef<SpeechPlayer | null>(null);
  const runRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const abortRef = useRef<AbortController | null>(null);

  // 只在启用时才去问 TTS 配置（voiceSettings 是服务端算好的合并结果）；读不到 = 没有 TTS，退合成口型，字幕照出
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getSupportConfig().then((c) => alive && setConfig(c)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled]);

  const stop = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    playerRef.current?.stop();
    companionBus.stopSpeaking();
    setSpeaking(false);
  }, []);
  // 离开页面：掐掉声音与排队中的演出
  useEffect(() => () => stop(), [stop]);

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
    setSpeaking(true);
    companionBus.face(sentence.face);
    companionBus.action(sentence.action);
    const blob = await audio;
    if (runRef.current !== run || signal.aborted) return;
    const mute = muteRef.current.signal;
    // 每一句播之前**现问**还开没开声音（客服页 2026-09-18 那条 ★：文字流比念快得多，后面几句的声音早合成好了）
    if (blob && voiceOnRef.current && !mute.aborted) {
      try {
        if (!playerRef.current) playerRef.current = new SpeechPlayer();
        await playerRef.current.play(blob, (level) => companionBus.mouth(level), { signal: eitherSignal(signal, mute) });
        return;
      } catch {
        if (signal.aborted) return;
      }
    }
    const ms = estimateSpeechMs(sentence.text);
    companionBus.speakSynthetic(ms);
    await sleep(ms, signal);
  }

  /** 开一轮（一次提问 / 一次讲解）：之前排队的都作废 */
  const begin = useCallback((): SpeechTurn => {
    stop();
    const controller = new AbortController();
    abortRef.current = controller;
    return { run: runRef.current, signal: controller.signal };
  }, [stop]);

  /** 一句到了：文字先上屏由调用方做，这里只管声音与舞台。没启用 = 空操作 */
  const speak = useCallback(
    (turn: SpeechTurn, text: string, index: number) => {
      if (!enabled || !text.trim()) return;
      const sentence: CompanionSentence = { index, text, emotion: "", face: normalizeFace(undefined), action: normalizeAction(undefined), tts: { emotion: "", instruct: "" } };
      const audio: Promise<Blob | null> =
        voiceOnRef.current && Boolean(configRef.current?.tts) ? synthesizeSpeech(ttsBodyFor(configRef.current, sentence), turn.signal).catch(() => null) : Promise.resolve(null);
      void enqueue(turn.run, () => perform(turn.run, sentence, audio, turn.signal));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enqueue / perform 是组件内的函数声明，随渲染同步（与客服页同一个理由）
    [enabled],
  );

  /** 这一轮排队的句子都念完了才 resolve（调用方 await 它再把「说话中」翻回去） */
  const drain = useCallback((turn: SpeechTurn) => {
    return enqueue(turn.run, async () => undefined).then(() => {
      if (runRef.current === turn.run) setSpeaking(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 同上
  }, []);

  const toggleVoice = useCallback(() => {
    const next = !voiceOnRef.current;
    setVoiceOnState(next);
    setVoiceEnabled(next);
    voiceOnRef.current = next;
    if (!next) {
      // 正在放的这一句当场停，换一个新的中止器给之后的句子用
      muteRef.current.abort();
      muteRef.current = new AbortController();
    }
  }, []);

  return { enabled, voiceOn, toggleVoice, speaking, subtitle, tts: Boolean(config?.tts), begin, speak, drain, stop };
}
