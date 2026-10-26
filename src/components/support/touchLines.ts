/**
 * 客服页「摸一下看板娘」那一句的 App 侧规矩（2026-10-25）：
 *   ① 挑哪一句：companion/protocol 的 pickTouchReaction 挑完，舞台不是官方看板娘时，把讲官方形象外貌的那几句换成别的；
 *   ② 念出来的声音：同一句、同一套声音只合成一次（只在内存里，活到这一次离开客服页为止）。
 *   语言由调用方传当前生效的界面语言（i18n/switch.activeLang），英文界面念英文。
 *
 * ★ 为什么不改 companion/protocol.ts：那份与官网 client 同源拷贝（CLAUDE.md 目录那一节），给台词加一个「只给官方形象」的标记
 *   就得两仓一起改、官网合进 main 就是发布。这里按台词的**英文**认是哪几句：每条台词中英两种写法在同一个对象上，
 *   认英文不必在 App 里再抄一份中文字面量（抄了会撞 i18n 棘轮，也是第二份真相）。
 *   ⚠ protocol.ts 里 TOUCH_REACTIONS 头上那句注释「客服页只用中文」从这一版起不成立了（客服页按界面语言取）——
 *   下一次与官网同步那份文件时一起改掉。
 */
import { pickTouchReaction, TOUCH_REACTIONS, type TouchReaction } from "../../companion/protocol";
import { synthesizeSpeech, type SupportConfig, type TtsRequest } from "../../api/support";
import type { Lang } from "../../i18n/locale";

/**
 * 讲的是官方看板娘自己长什么样的台词：今天是 Hair「喜欢我的头发吗？薄荷色是我自己挑的。」与 Body「披风好看吧？这是启梦的制服。」。
 * 市场形象的命中区也映射成同一套区名（live2d/mapping.mapHitAreas），不滤的话换了一套黑发、没有披风的形象照样念这两句。
 * ★ 判错的方向：protocol.ts 改了措辞、这里没跟上 = 漏滤（市场形象上念回那一句，表面问题）；多滤一句只是少一句台词。
 *   protocol.ts 再加讲官方外貌的台词时，把它英文里的那个词补进这里。
 */
const OFFICIAL_LOOK_EN = /\b(mint|uniform|cape)\b/i;

export function isOfficialLookLine(line: Pick<TouchReaction, "en">): boolean {
  return OFFICIAL_LOOK_EN.test(line.en);
}

/**
 * 命中区 → 一句反应。officialStage = 舞台上**确定**是官方看板娘（调用方按安全方向判：拿不准就传 false）。
 * ★ 先让 protocol 照常挑（哪个区优先、随机挑一句都在那一处），挑中讲官方外貌的那一句时再从这一区剩下的里均匀重挑一次 ——
 *   合起来仍是在「剩下的那几句」里均匀挑。剩下的一句都没有就不演（宁可不说，也不在别人的形象上念官方外貌）；今天每个区都还剩至少一句。
 */
export function pickStageTouch(areas: string[], lang: Lang, officialStage: boolean): ReturnType<typeof pickTouchReaction> {
  const pick = pickTouchReaction(areas, lang);
  if (!pick || officialStage || !isOfficialLookLine(pick)) return pick;
  const pool = TOUCH_REACTIONS[pick.area].filter((l) => !isOfficialLookLine(l));
  if (!pool.length) return null;
  const line = pool[Math.floor(Math.random() * pool.length)];
  return { area: pick.area, ...line, text: lang === "en" ? line.en : line.zh };
}

/** 最多记几句：15 条台词 × 中英两种 = 30，一次打开客服页常点的远少于这个数（Map 按插入顺序，满了丢最久没用过的） */
export const TOUCH_VOICE_MAX = 24;

/** 「这一套声音」的指纹：服务端算好的合并结果（voiceSettings）+ 老服务端那一个 voice。它一变，记下的声音就都作废 */
export function touchVoiceSig(config: SupportConfig | null): string {
  return JSON.stringify([config?.voiceSettings ?? null, config?.voice ?? ""]);
}

/**
 * 触摸台词的声音缓存：台词是固定的那 15 句，而 /api/tts 每一次都按字扣钱（每个字符 33 token，英文字母也算）——
 * 碰十下同一句就是扣十次同样的钱、听到的是同一段声音。
 * ★ 只给触摸台词用：客服的回答每一句都不一样，记了也碰不上，还白占内存；回答那条路照旧直接 synthesizeSpeech。
 * ★ 键 = 整个 /api/tts 请求体的序列化（ttsBodyFor 拼的：文字 + 声音设置 + 这一句的情绪 / 语调）：请求体一样，服务端回的就是同一段声音。
 *   声音设置变了（声音面板存过之后 config 重拉）整份清空 —— 旧声音的那几份再也用不上。
 * ★ 只记**合成成功**的：失败 / 被中止（stopAll、点了发送）的不记，下一次照常再合成。合成期间换了声音的那一份也不记。
 * ★ 只在内存里、跟着页面实例走（SupportPage 挂载时建一个）：离开客服页再进来重新合成。不落盘 —— 存一堆音频进 IndexedDB 换来的
 *   只是省下下一次进页那几句的钱，而缓存要认账号、认声音、认过期，不值。
 */
export class TouchVoiceCache {
  private sig = "";
  private blobs = new Map<string, Blob>();

  speak(config: SupportConfig | null, body: TtsRequest, signal?: AbortSignal): Promise<Blob> {
    const sig = touchVoiceSig(config);
    if (sig !== this.sig) {
      this.blobs.clear();
      this.sig = sig;
    }
    const key = JSON.stringify(body);
    const hit = this.blobs.get(key);
    if (hit) {
      // 挪到最后 = 最近用过（满了先丢最久没用的）
      this.blobs.delete(key);
      this.blobs.set(key, hit);
      return Promise.resolve(hit);
    }
    return synthesizeSpeech(body, signal).then((blob) => {
      if (this.sig === sig) {
        this.blobs.set(key, blob);
        while (this.blobs.size > TOUCH_VOICE_MAX) {
          const oldest = this.blobs.keys().next().value;
          if (oldest === undefined) break;
          this.blobs.delete(oldest);
        }
      }
      return blob;
    });
  }

  get size(): number {
    return this.blobs.size;
  }
}
