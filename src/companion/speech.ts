/**
 * @file speech.ts - 语音播放 + 口型包络
 * @category Utility
 *
 * 播放一段 TTS 音频，同时每 ~20ms 把响度包络（0~1）回调出去驱动口型。
 * ★ 响度用"相对自身峰值"归一化而不是固定增益：豆包不同情绪的音量差很多，固定增益要么抖要么张不开。
 * ★ AudioContext 只在第一次 play 时建（此时一定在用户点击"发送"之后），否则被自动播放策略挂起。
 */

const LEVEL_INTERVAL_MS = 20;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export class SpeechPlayer {
  private context: AudioContext | null = null;
  private audio: HTMLAudioElement | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private timer = 0;
  private objectUrl = "";
  private peak = 0.08;

  get playing() {
    return Boolean(this.audio && !this.audio.paused && !this.audio.ended);
  }

  /** 播完 resolve；解码/自动播放失败 reject（调用方回退到合成口型） */
  play(blob: Blob, onLevel: (level: number) => void, opts: { signal?: AbortSignal } = {}) {
    this.stop();
    return new Promise<void>((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      const audio = new Audio();
      this.audio = audio;
      this.objectUrl = URL.createObjectURL(blob);
      audio.src = this.objectUrl;
      audio.preload = "auto";

      let analyser: AnalyserNode | null = null;
      let buffer: Uint8Array<ArrayBuffer> | null = null;
      try {
        const AudioContextCtor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
        if (AudioContextCtor) {
          this.context = this.context || new AudioContextCtor();
          void this.context.resume().catch(() => undefined);
          this.source = this.context.createMediaElementSource(audio);
          analyser = this.context.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.2;
          this.source.connect(analyser);
          analyser.connect(this.context.destination);
          buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
        }
      } catch {
        analyser = null; // 没有 WebAudio 也照样出声，只是口型退化为合成
      }

      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener("abort", onAbort);
        window.clearInterval(this.timer);
        this.timer = 0;
        onLevel(0);
        this.release(audio);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => {
        try {
          audio.pause();
        } catch {
          // ignore
        }
        finish(new DOMException("aborted", "AbortError"));
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      audio.addEventListener("ended", () => finish(), { once: true });
      audio.addEventListener("error", () => finish(new Error("audio playback failed")), { once: true });

      this.timer = window.setInterval(() => {
        if (!analyser || !buffer) {
          onLevel(0.5); // 没分析器：给个恒定值，由模型侧合成节奏
          return;
        }
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buffer.length);
        this.peak = Math.max(rms, this.peak * 0.995, 0.05);
        onLevel(Math.min(1, rms / this.peak));
      }, LEVEL_INTERVAL_MS);

      audio.play().catch((error) => finish(error));
    });
  }

  stop() {
    if (this.audio) {
      const audio = this.audio;
      try {
        audio.pause();
      } catch {
        // ignore
      }
      this.release(audio);
    }
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  private release(audio: HTMLAudioElement) {
    if (this.audio !== audio) return;
    try {
      this.source?.disconnect();
    } catch {
      // ignore
    }
    this.source = null;
    audio.removeAttribute("src");
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = "";
    this.audio = null;
  }
}
