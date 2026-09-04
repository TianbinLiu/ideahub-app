/**
 * 声音面板三页（单音色 / 混音 / 声音市场）共用的「试听」：合成一句 → 播放 → 响度包络喂给舞台上的看板娘（嘴会动）。
 *
 * ★ 一个面板同一时刻只许有一段在响：新的一次试听先掐掉上一段（合成的 fetch 与播放共用一个 AbortController 一起掐），
 *   否则连点两把嗓子会叠着响、口型也叠着动。三页各自 new 一个的话谁也管不住谁，所以由 VoiceSheet 建一个传下去。
 * ★ 被更新的一次试听打断时抛的是 AbortError：调用方按「没出错」处理（isAbortError），别把它画成红字。
 * ★ 试听台词统一「你好，我是{数字人名}，这是我的新声音。」（与官网同一句）——三页都念同一句，换嗓子时才有可比性。
 * ★ 试听的参数与保存后真正念台词的一致（SupportPage.ttsBodyFor 那套字段）：试听听到的必须就是之后听到的，
 *   否则「保存」这个动作在用户眼里就是坏的。
 */
import { ApiError } from "../../api/client";
import { companionErrorText } from "../../api/companion";
import { synthesizeSpeech, type TtsRequest } from "../../api/support";
import { companionBus } from "../../companion/bus";
import { SpeechPlayer } from "../../companion/speech";

export const previewLine = (name: string) => `你好，我是${name}，这是我的新声音。`;

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** 试听失败的整句说明（501/404 = 这台服务器没配云端语音，保存设置仍然有效） */
export function previewErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 501 || e.status === 404) return "这台服务器没配云端语音，试听不了；保存设置仍然有效。";
    if (e.status === 429) return "试听太频繁了，稍等几秒再点。";
  }
  return companionErrorText(e, "试听没出声，稍后再试。");
}

export class VoicePreviewer {
  private player: SpeechPlayer | null = null;
  private controller: AbortController | null = null;

  /** 合成并播完才 resolve；被新的一次试听 / stop() 打断 → reject(AbortError)；其它失败原样抛 */
  async play(body: TtsRequest): Promise<void> {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    try {
      const blob = await synthesizeSpeech(body, controller.signal);
      if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
      if (!this.player) this.player = new SpeechPlayer();
      await this.player.play(blob, (level) => companionBus.mouth(level), { signal: controller.signal });
    } finally {
      // 只有"还是我这一段"才有资格闭嘴：被新的一段顶掉时，新的那段正在张嘴
      if (this.controller === controller) {
        this.controller = null;
        companionBus.stopSpeaking();
      }
    }
  }

  /** 掐掉正在合成 / 播放的那一段并闭嘴（关面板、切页、点「停止」时调） */
  stop(): void {
    const current = this.controller;
    this.controller = null;
    current?.abort();
    this.player?.stop();
    companionBus.stopSpeaking();
  }
}
