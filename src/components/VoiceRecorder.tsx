// 跟读录音：长按按钮、照着示例词念，松手即停 —— 给真人卡录一段本人音色样本。
//
// ★ 与「从视频抓音」（VideoCardAnnotator.grabVoice）是同一种产物（24k 单声道 WAV，
//   2~15s，cardVoice 侧库），只是声源换成麦克风。编码走 utils/wav 那份唯一实现。
// ★ 抓音同样走 ScriptProcessor 直取 PCM 不走 MediaRecorder（后者出 webm/opus，
//   方舟参考音频只收 mp3/wav —— 理由钉在 utils/wav 顶注）。
// ★★ 麦克风权限是**原生权限**（RECORD_AUDIO）：
//   · Web/dev 下 getUserMedia 直接问浏览器；
//   · APK 里要 AndroidManifest 声明 + Capacitor 的 WebChromeClient 转发 —— 声明这次
//     已加，但**老包（≤2.29）里没有**：老包上 getUserMedia 会直接被拒。
//   所以失败必须整句说清（铁律八），并且给"从文件传一段音频"的退路？——不给：
//   传文件绕过了"这是本人声音"这层含义，跟读的意义就是声源可信。录不了就先不录。
// ★ 长按语义：pointerdown 起录、pointerup/leave 停。短于 2s 整句拒（不是静默丢弃），
//   到 15s 自动停（Seedance 参考音频硬窗口，常量在 cardVoice）。
import { useEffect, useRef, useState } from "react";
import { VOICE_MAX_SEC, VOICE_MIN_SEC } from "../data/cardVoice";
import { pcmToVoiceWav } from "../utils/wav";

/**
 * 示例词：让人一口气念 3~10 秒的中性句子。
 * ★ 内容刻意**与产品无关**：样本是拿去当音色参考的，句子里带品牌词/台词会被 AI 当成
 *   "这个人说过这句话"，串进成片台词里。
 */
const SAMPLE_LINES = [
  "今天天气不错，我在院子里晒了会儿太阳，顺手把花也浇了。",
  "周末打算去一趟菜市场，买点新鲜的菜，晚上做一顿好吃的。",
  "这条路我走了很多年，闭着眼睛都知道哪里有个台阶。",
];

export default function VoiceRecorder({
  onDone,
}: {
  /** 录成（2~15s、已编成 WAV dataURL）时回调。宿主自己决定何时落 cardVoice 侧库 */
  onDone: (v: { dataUrl: string; durationSec: number; note: string }) => void;
}) {
  const [lineIdx, setLineIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const stream = useRef<MediaStream | null>(null);
  const graph = useRef<{ ctx: AudioContext; proc: ScriptProcessorNode; src: MediaStreamAudioSourceNode } | null>(null);
  const pcm = useRef<Float32Array[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // stop 会被 pointerup/leave/自动到点三条路调用，用 ref 防重入
  const stopping = useRef(false);

  // 卸载时把麦克风关干净：留着的话状态栏的录音红点会一直亮，用户只会认为在偷录
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      graph.current?.proc.disconnect();
      void graph.current?.ctx.close();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function start() {
    if (recording || busy) return;
    setErr("");
    try {
      // 每次按下都重新要流：授权对话框只会出现在第一次，之后是瞬时的
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = ms;
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(ms);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      // proc 不接下游就不触发；接一个 0 增益去喇叭（不能让麦克风直通喇叭——会啸叫）
      const mute = ctx.createGain();
      mute.gain.value = 0;
      src.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);
      pcm.current = [];
      proc.onaudioprocess = (e) => {
        pcm.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      graph.current = { ctx, proc, src };
      stopping.current = false;
      startedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timer.current = setInterval(() => {
        const secs = (Date.now() - startedAt.current) / 1000;
        setElapsed(secs);
        // 到 15s 硬停：松手是主路径，这条只是 Seedance 窗口的兜底
        if (secs >= VOICE_MAX_SEC) void stop();
      }, 100);
    } catch (e) {
      // 老包（≤2.29）没有 RECORD_AUDIO 声明，这里必然进来 —— 不能静默
      const raw = e instanceof Error ? e.message : String(e);
      setErr(
        /denied|permission|NotAllowed/i.test(raw)
          ? "拿不到麦克风权限。App 版本 ≤2.29 的安装包没带录音权限，升级到新版后在系统弹窗里点允许；拒绝过的话去系统设置 → 应用 → 启梦 → 权限里打开麦克风。"
          : `麦克风打不开：${raw}`,
      );
    }
  }

  async function stop() {
    if (!recording || stopping.current) return;
    stopping.current = true;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRecording(false);
    setBusy(true);
    try {
      const g = graph.current;
      const ms = stream.current;
      graph.current = null;
      stream.current = null;
      const rate = g?.ctx.sampleRate ?? 48000;
      g?.proc.disconnect();
      ms?.getTracks().forEach((t) => t.stop());
      await g?.ctx.close();

      const secs = (Date.now() - startedAt.current) / 1000;
      if (secs < VOICE_MIN_SEC) {
        // 整句拒（不是静默丢）：短样本方舟那头也会拒，在这里说比出片时说便宜得多
        setErr(`太短了（${secs.toFixed(1)}s）——按住别松，照着示例词念够 ${VOICE_MIN_SEC} 秒再放手。`);
        return;
      }
      const total = pcm.current.reduce((n, a) => n + a.length, 0);
      if (total < rate * VOICE_MIN_SEC * 0.5) {
        setErr("没抓到足够的声音——检查麦克风是不是被别的 App 占着。");
        return;
      }
      const flat = new Float32Array(total);
      let off = 0;
      for (const a of pcm.current) {
        flat.set(a, off);
        off += a.length;
      }
      pcm.current = [];
      const dataUrl = await pcmToVoiceWav(flat, rate);
      onDone({
        dataUrl,
        durationSec: Math.min(VOICE_MAX_SEC, Math.round(secs * 10) / 10),
        note: "本人跟读录制",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-black/25 p-2.5">
      <p className="text-[10px] leading-relaxed text-slate-400">
        照着下面这句念（{VOICE_MIN_SEC}~{VOICE_MAX_SEC} 秒）——出片走「高清/电影级」档、台词写在引号里时，AI 会参考这段音色。
      </p>
      <div className="mt-1.5 flex items-start gap-2">
        <p className="flex-1 rounded-lg bg-ink/60 px-2.5 py-2 text-xs leading-relaxed text-slate-200">
          “{SAMPLE_LINES[lineIdx]}”
        </p>
        <button
          onClick={() => setLineIdx((i) => (i + 1) % SAMPLE_LINES.length)}
          className="mt-1 flex-none text-[10px] text-slate-500"
        >
          换一句
        </button>
      </div>
      <button
        onPointerDown={() => void start()}
        onPointerUp={() => void stop()}
        onPointerLeave={() => void stop()}
        onContextMenu={(e) => e.preventDefault()}
        disabled={busy}
        className={`mt-2 w-full select-none rounded-lg py-2.5 text-[12px] font-bold ${
          recording ? "bg-rose-500 text-white" : "bg-brand text-ink"
        } disabled:opacity-40`}
        style={{ touchAction: "none" }}
      >
        {busy ? "处理中…" : recording ? `松手结束 · ${elapsed.toFixed(1)}s` : "🎙 按住跟读（长按录音）"}
      </button>
      {err && <p className="mt-1.5 text-[10px] leading-relaxed text-rose-400">{err}</p>}
    </div>
  );
}
