// 铸卡师的声音：把 npcSay 的台词读出来，并把口型交给**真实的语速**而不是字数估算。
//
// 为什么用浏览器自带的 SpeechSynthesis 而不是云端 TTS：
// 火山方舟（ARK_API_KEY 那套）**没有** TTS——实测拉 /api/ark/models 回来 129 个模型里
// 一个语音合成都没有。火山的语音合成是另一条产品线（openspeech，AppID + Access Token，
// 与方舟不同的鉴权），得用户另行开通并提供密钥。在那之前，浏览器内置的合成器是唯一
// 不需要任何配置就能出声的路子：Windows 11 自带中文女声，桌面 Chrome/Edge 都有。
//
// 接云端 TTS 时该改哪里：只有 start() 这一处。云端拿到的是音频，可以走
// AudioContext + AnalyserNode 得到**真实的响度包络**，SPEECH.level 直接用 RMS——
// 那才是真口型。下面这套是在"只有文本、没有音频流"的前提下能做到的最好近似。
import type { Viseme } from "./scene/faceExpr";

/** 每帧被 TripoNpc 直读的口型状态。走模块单例而不是 React 状态：
 *  说话时每秒要更新几十次，进 store 就是每秒几十次全场景重渲。 */
export const SPEECH = { active: false, level: 0, viseme: "sil" as Viseme };

const KEY = "ideahub-app.voice";

export function voiceEnabled(): boolean {
  return localStorage.getItem(KEY) !== "off";
}

export function setVoiceEnabled(on: boolean) {
  localStorage.setItem(KEY, on ? "on" : "off");
  if (!on) stopSpeaking();
}

export function voiceSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// ── 选嗓子 ────────────────────────────────────────────────────
// **只收中文嗓子，没有就不出声。** 台词全是中文，拿 en-US 的嗓子去念只会得到
// 一串念不出来的静音或者把汉字拼读成英文——比不出声更糟。实测这台机器上的
// Chromium 只带 David/Mark/Zira 三个英文声，中文语音包要系统里另装。
// voices 在部分浏览器上是**异步填充**的（首次返回空数组，之后才触发
// voiceschanged），所以不能只在模块加载时取一次。
let cachedVoice: SpeechSynthesisVoice | null = null;
let voiceResolved = false;

function pickVoice(): SpeechSynthesisVoice | null {
  if (voiceResolved) return cachedVoice;
  const all = window.speechSynthesis.getVoices();
  if (all.length === 0) return null; // 还没填充，下次再问
  voiceResolved = true;
  const zh = all.filter((v) => v.lang.toLowerCase().startsWith("zh"));
  if (zh.length === 0) {
    cachedVoice = null;
    return null;
  }
  // 这些是 Windows/macOS 上常见的中文女声名；命不中就退回中文里的第一个
  const preferred = ["xiaoxiao", "xiaoyi", "huihui", "yaoyao", "tingting", "meijia", "female"];
  cachedVoice = preferred.map((n) => zh.find((v) => v.name.toLowerCase().includes(n))).find(Boolean) ?? zh[0];
  return cachedVoice;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    voiceResolved = false;
    pickVoice();
  };
}

/** 语音能力现状。UI 要能把"我关的"和"这台机器没中文语音包"分开讲清楚，
 *  否则用户开着开关却听不见声音，只会以为功能坏了。 */
export function voiceStatus(): "ok" | "no-voice" | "unsupported" {
  if (TTS_REAL) return "ok"; // 云端嗓子不依赖系统语音包
  if (!voiceSupported()) return "unsupported";
  return pickVoice() ? "ok" : "no-voice";
}

// ── 文本 → 音节表 ──────────────────────────────────────────────
// 一个汉字 = 一个音节；西文按元音簇粗切；标点 = 一次闭嘴停顿。
// 停顿单独成项很重要——没有它，长句会变成一条不间断的机械开合，
// 而人说话的断句恰恰是"像在说话"最强的线索。
interface Syl {
  /** 该音节对应的元音口型 */
  v: Viseme;
  /** 相对时长（1 = 一个普通音节） */
  w: number;
  /** 闭嘴停顿 */
  pause: boolean;
}

const VOWELS: Viseme[] = ["aa", "ih", "ou", "e", "oh"];

/** 汉字 → 元音口型。**这不是真音素**：没有拼音表，靠码点做确定性散列。
 *  取确定性（同一个字永远同一个口型）而不是每帧随机，是为了让同一句话看起来
 *  是"在念同一段词"，而不是嘴在乱抖。真音素要等云端 TTS 给出音频/时间戳。 */
function vowelOf(ch: string): Viseme {
  const c = ch.codePointAt(0) ?? 0;
  return VOWELS[(c * 2654435761) % VOWELS.length];
}

function syllables(text: string): Syl[] {
  const out: Syl[] = [];
  const t = text.replace(/\s+/g, " ").trim();
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (/[，,、;；:：]/.test(ch)) out.push({ v: "sil", w: 0.7, pause: true });
    else if (/[。.!！?？…—\n]/.test(ch)) out.push({ v: "sil", w: 1.3, pause: true });
    else if (/[㐀-鿿぀-ヿ]/.test(ch)) out.push({ v: vowelOf(ch), w: 1, pause: false });
    else if (/[a-zA-Z0-9]/.test(ch)) {
      // 西文：连续字母算一个词，按元音个数折成音节（"studio"→2）
      let j = i;
      while (j < t.length && /[a-zA-Z0-9]/.test(t[j])) j++;
      const word = t.slice(i, j);
      const n = Math.max(1, (word.match(/[aeiouAEIOU]/g) ?? []).length);
      for (let k = 0; k < n; k++) out.push({ v: vowelOf(word[k] ?? word[0]), w: 1, pause: false });
      i = j - 1;
    } else if (ch === " " || /[（）()「」《》""'']/.test(ch)) {
      out.push({ v: "sil", w: 0.35, pause: true });
    }
  }
  return out;
}

// ── 播放 ──────────────────────────────────────────────────────
let raf = 0;
let session = 0;

/** 一个普通音节的默认时长（秒）。中文朗读约 5~6 字/秒，onboundary 能来就按实测校正。 */
const BASE_SYL = 0.17;

export function stopSpeaking() {
  session++;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (curSrc) {
    // onended 里有 session 判断，这里 stop 触发的那次会因为 session 已经 ++ 而跳过
    try {
      curSrc.stop();
    } catch {
      /* 还没 start 或已经停了 */
    }
    curSrc = null;
  }
  SPEECH.active = false;
  SPEECH.level = 0;
  SPEECH.viseme = "sil";
  if (voiceSupported()) window.speechSynthesis.cancel();
}

// 延迟掐音：React StrictMode 下 effect 会 mount → cleanup → mount 跑两遍。
// 直接在 cleanup 里 stopSpeaking()，第二次挂载前的那次 cleanup 就把开场白掐了——
// dev 下永远听不到开场白，而线上（不双跑）却听得到，是最难查的那种差异。
// 改成"延迟一拍再掐、重新挂载就取消"：真正离开页面时那一拍照样掐得掉。
let stopTimer = 0;

export function stopSpeakingSoon(ms = 80) {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = window.setTimeout(() => {
    stopTimer = 0;
    stopSpeaking();
  }, ms);
}

export function cancelPendingStop() {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = 0;
}

// ── 云端 TTS（豆包 openspeech）────────────────────────────────
// 有凭据时优先走它：拿到的是**真实音频**，于是
//   ① 口型幅度用 AnalyserNode 量出来的 RMS，不再是估的包络
//   ② 音节时长用 buffer.duration 精确均分，不再靠 onboundary 猜语速
//   ③ 手机 WebView 里也有声（安卓自带 TTS 引擎常常 getVoices() 返回空数组，
//      那是浏览器合成器在真机上最大的坑）
// 凭据没配就 404 → 静默退回浏览器合成器。
declare const __TTS_REAL__: boolean;
const TTS_REAL = typeof __TTS_REAL__ !== "undefined" && __TTS_REAL__;
const TTS_VOICE = import.meta.env.VITE_TTS_VOICE as string | undefined;

let audioCtx: AudioContext | null = null;
let curSrc: AudioBufferSourceNode | null = null;

function ctx(): AudioContext {
  audioCtx ??= new AudioContext();
  // 自动播放策略：没有用户手势时 AudioContext 会挂在 suspended。进工坊本身是
  // 点进来的，通常已经解锁；resume 是幂等的，挂了也不影响后面的退回逻辑
  void audioCtx.resume();
  return audioCtx;
}

/** 云端合成 + 播放 + 用真实响度驱动口型。返回 false 表示没走成，调用方退回浏览器合成器 */
async function speakCloud(text: string, sy: Syl[], me: number): Promise<boolean> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: TTS_VOICE }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return false; // 404=没配凭据，502=上游报错，都退回本地合成
    const buf = await ctx().decodeAudioData(await res.arrayBuffer());
    if (session !== me) return true; // 期间被打断：别再播了，但也别退回去重播一遍

    const src = ctx().createBufferSource();
    src.buffer = buf;
    const analyser = ctx().createAnalyser();
    // 1024 点 ≈ 43ms@24kHz，够跟上音节又不会抖
    analyser.fftSize = 1024;
    src.connect(analyser);
    analyser.connect(ctx().destination);
    curSrc = src;

    // ★ 有真实音频，音节表就不用猜语速了：总时长精确均分
    const total = sy.reduce((a, x) => a + x.w, 0) || 1;
    const secPerSyl = buf.duration / total;
    const data = new Uint8Array(analyser.fftSize);
    const t0 = performance.now();

    SPEECH.active = true;
    const tick = () => {
      if (session !== me) return;
      analyser.getByteTimeDomainData(data);
      // RMS：128 是静音中线，除以 128 归一化到 0~1；×3.2 是把说话的
      // 典型 RMS（0.08~0.25）拉到可见幅度，再夹住
      let acc = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        acc += v * v;
      }
      SPEECH.level = Math.min(1, Math.sqrt(acc / data.length) * 3.2);
      // 元音口型仍来自文本（音频里没有音素信息），但**时间轴是真的**
      const el = (performance.now() - t0) / 1000;
      let a = 0;
      let cur: Syl | null = null;
      for (const x of sy) {
        const d = x.w * secPerSyl;
        if (el < a + d) {
          cur = x;
          break;
        }
        a += d;
      }
      SPEECH.viseme = cur && !cur.pause ? cur.v : "sil";
      if (cur?.pause) SPEECH.level = 0;
      raf = requestAnimationFrame(tick);
    };
    src.onended = () => {
      if (session === me) stopSpeaking();
    };
    src.start();
    raf = requestAnimationFrame(tick);
    return true;
  } catch (e) {
    console.warn("[tts] 云端合成失败，退回浏览器合成器:", e);
    return false;
  }
}

/**
 * 念一句话并驱动口型。没有语音能力/用户关掉了声音 → 直接返回 false，
 * 调用方退回原来的"按字数估时长"路径（见 studioStore.npcSay）。
 */
export function speak(text: string): boolean {
  cancelPendingStop(); // 新台词到了，之前排队的"延迟掐音"作废
  if (!voiceEnabled()) return false;
  const clean = text.replace(/[（(][^）)]*[）)]/g, " ").trim(); // 括号里的旁白不念
  if (!clean) return false;
  const sy = syllables(clean);
  if (!sy.length) return false;

  stopSpeaking();
  const me = ++session;

  // 云端优先：有真实音频，口型才是量出来的而不是估的
  if (TTS_REAL) {
    void speakCloud(clean, sy, me).then((ok) => {
      if (!ok && session === me) speakLocal(clean, sy, me);
    });
    return true;
  }
  return speakLocal(clean, sy, me);
}

/** 浏览器内置合成器。没有中文嗓子就不出声——拿 en-US 的嗓子念汉字只会得到
 *  静音或拼读，比不出声更糟。 */
function speakLocal(clean: string, sy: Syl[], me: number): boolean {
  if (!voiceSupported()) return false;
  const voice = pickVoice();
  if (!voice) return false;

  const u = new SpeechSynthesisUtterance(clean);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 1.05;
  u.pitch = 1.12; // 稍高一点，贴角色的年轻女声
  u.volume = 0.9;

  const total = sy.reduce((s, x) => s + x.w, 0);
  let secPerSyl = BASE_SYL;
  let t0 = performance.now();

  // onboundary 给的是**已经念到原文第几个字**，据此把语速校准到这台机器上这个
  // 嗓子的真实速度——不同系统的合成器语速差得很远，写死一个常数必然对不上。
  // 不是所有嗓子都会发这个事件，所以它只是校正而非依赖。
  u.onboundary = (e) => {
    if (session !== me) return;
    const done = sy.length * (Math.min(clean.length, e.charIndex) / Math.max(1, clean.length));
    if (done < 1) return;
    const elapsed = (performance.now() - t0) / 1000;
    const perSyl = elapsed / done;
    if (perSyl > 0.05 && perSyl < 0.5) secPerSyl = perSyl;
  };
  u.onstart = () => {
    if (session !== me) return;
    t0 = performance.now();
  };
  const finish = () => {
    if (session !== me) return;
    stopSpeaking();
  };
  u.onend = finish;
  u.onerror = finish;

  SPEECH.active = true;
  const tick = () => {
    if (session !== me) return;
    const el = (performance.now() - t0) / 1000;
    // 走到第几个音节
    let acc = 0;
    let cur: Syl | null = null;
    let phase = 0;
    for (const s of sy) {
      const d = s.w * secPerSyl;
      if (el < acc + d) {
        cur = s;
        phase = (el - acc) / d;
        break;
      }
      acc += d;
    }
    if (!cur) {
      // 表已经走完但 onend 还没来（语速估慢了）——闭嘴等着，别把嘴停在张开
      SPEECH.level = 0;
      SPEECH.viseme = "sil";
    } else if (cur.pause) {
      SPEECH.level = 0;
      SPEECH.viseme = "sil";
    } else {
      // 单音节包络：开—合。^0.6 让张开来得快、收得慢，比纯 sin 更像发音
      SPEECH.level = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, phase))), 0.6);
      SPEECH.viseme = cur.v;
    }
    raf = requestAnimationFrame(tick);
  };

  try {
    window.speechSynthesis.speak(u);
  } catch {
    stopSpeaking();
    return false;
  }
  // 兜底超时：某些浏览器在页面不可见时既不 onend 也不 onerror，
  // 嘴会一直动到天荒地老。按估算总时长的 2 倍强制收口。
  const guard = window.setTimeout(() => finish(), (total * secPerSyl + 2) * 2000);
  const clearGuard = () => window.clearTimeout(guard);
  u.addEventListener("end", clearGuard);
  u.addEventListener("error", clearGuard);

  raf = requestAnimationFrame(tick);
  return true;
}

// DEV 钩子：口型是"说到一半的中间态"，靠肉眼截图既不可复现也漏得掉。
// __speech.SPEECH 可以逐帧读包络，__speech.plan() 直接看音节表切得对不对。
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__speech = {
    SPEECH,
    speak,
    stopSpeaking,
    plan: (t: string) => syllables(t),
    voice: () => pickVoice(),
    status: voiceStatus,
    cloud: TTS_REAL,
    voices: () => (voiceSupported() ? window.speechSynthesis.getVoices().map((v) => `${v.name} [${v.lang}]`) : []),
  };
}
