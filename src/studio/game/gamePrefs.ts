// 对局的**本机偏好**：音量（音乐 / 音效）。对局设置页那两条滑杆读写这里。
//
// ★★ 现状（2026-11-24，动手前把全仓 audio 消费者列了一遍）：**游戏里今天没有任何 BGM 与音效**。
//   全仓会出声的只有三处 —— 铸卡师语音（studio/speech，SpeechSynthesis）、剪辑页预览与配音、
//   数字人客服（companion/speech）。对局里一次 `new Audio` / AudioContext 都不建。
//   所以这两条滑杆**只存偏好**：接上音源那一天，播放侧读 `getGameAudio()` 就行，
//   今天它们不改任何行为。设置页上也照实写着这句话（不写的话就是一颗骗人的滑杆）。
// ★ 存在的理由（而不是等有声音再加）：这一页是与语言 / 画质 / 退出并列的一格，
//   先把字段与落盘位置定下来；真接音源时不必再动界面与存储格式。
// ★ 用 **localStorage 同步读**而不是本机库 / 账号库：设置页首帧就要画出滑杆位置，
//   账号库是异步的（会先画默认值再跳一下）。与 studio/quality、data/guide 同一套做法。
// ★ 不按账号分键：这是**这台设备**的扬声器偏好（与画质同理），不属于用户数据。

const KEY = "ideahub-app.game.audio.v1";

/** 0~1 的两档音量。缺省是"有声音但不吵"的一档，不是 1.0 —— 真接上音源时开箱不炸耳朵。 */
export interface GameAudioPrefs {
  music: number;
  sfx: number;
}

export const GAME_AUDIO_DEFAULT: GameAudioPrefs = { music: 0.7, sfx: 0.8 };

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/**
 * 读两档音量。
 * ★ 认不出的一律落回**那一档的缺省**（不是 0）：存坏了不该变成"永远静音"，
 *   那是用户自己改不回来的静默故障（铁律八）。
 */
export function getGameAudio(): GameAudioPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...GAME_AUDIO_DEFAULT };
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ...GAME_AUDIO_DEFAULT };
    const v = obj as Partial<Record<keyof GameAudioPrefs, unknown>>;
    return {
      music: typeof v.music === "number" && Number.isFinite(v.music) ? clamp01(v.music) : GAME_AUDIO_DEFAULT.music,
      sfx: typeof v.sfx === "number" && Number.isFinite(v.sfx) ? clamp01(v.sfx) : GAME_AUDIO_DEFAULT.sfx,
    };
  } catch {
    // 隐私模式 / 配额满：这一次会话按缺省放音（接上音源之后），不报错 —— 音量不是故障
    return { ...GAME_AUDIO_DEFAULT };
  }
}

/** 写一档或两档（只给变了的那几档）。返回写完之后的完整值，调用方直接拿去当最新状态。 */
export function setGameAudio(patch: Partial<GameAudioPrefs>): GameAudioPrefs {
  const next: GameAudioPrefs = {
    music: clamp01(patch.music ?? getGameAudio().music),
    sfx: clamp01(patch.sfx ?? getGameAudio().sfx),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式 / 配额满：这一局照新值放音，重启回到上一次存下的那一档 */
  }
  return next;
}
