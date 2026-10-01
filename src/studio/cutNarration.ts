// 剪辑页的配音：把片段上那一句字幕合成成声音（服务端 /api/tts）、**量**出它有多长、存进本地库，回一条 CutVoice。
//
// ★ 这里只管"一句话 → 一条声音"。排在成片的第几秒、念不完怎么办、要不要压配乐，都在 data/cutProject.timelinePlan
//   （纯函数，预览与导出照同一份）；哪一句要配、配完写回哪个片段，由剪辑页管。
// ★ 钱（主人 2026-09-30 定）：配音现在**不向用户收 token**，但它按字符计费，是平台的真成本 —— 所以限量：
//   一段一句（数据形状就是这样：CutClip.line 只有一条）、字数按这一段的时长封顶（cutProject.lineCap，
//   合成之前在这里把关）、服务端每个账号每分钟 30 次（原来就有）。看成本再定价。
// ★ 念不完本段：先按字数估，估着念不完就直接提一档语速合成；量出来还超、而语速还有余量，就按量到的比例再提一次
//   （最多重合成这一次）。还超就原样交回去 —— 不悄悄截断，超出多少由计划算出来、剪辑页标出来让人改短。
import { t } from "@lingui/core/macro";
import { ApiError } from "../api/client";
import { getTtsVoices } from "../api/companion";
import { synthesizeSpeech } from "../api/support";
import { LINE_LEAD_SEC, TTS_CPS, lineCap, lineUnits, type CutProject, type CutVoice } from "../data/cutProject";
import { idbSet } from "../data/db";
import { uid } from "../types";
import { probeDuration } from "../utils/videoFrames";

/**
 * 缺省的旁白音色：知性女声 2.0（服务端目录里对它的说明是「沉稳讲道理，长台词稳得住」）。
 * ★ 不用铸卡师那把嗓子（studio/voices 的默认是「清冷高雅」）：那是按她的人设挑的，念旁白太冷。
 */
export const DEFAULT_NARRATOR = "zh_female_zhixingnv_uranus_bigtts";

/** 这份工程用哪个音色配音（没挑过就是缺省那个）。★ 判"配音过期没有"（cutProject.voiceStale）拿的也是它 */
export function narratorOf(p: CutProject | null | undefined): string {
  return p?.voiceId || DEFAULT_NARRATOR;
}

export interface Narrator {
  id: string;
  name: string;
  group: "female" | "male";
}

let narratorsCache: Narrator[] | null = null;

/**
 * 可选的旁白音色：服务端的音色目录（/api/tts/voices）—— 2.0 单音色 + 那批逐个验证过能出声的 1.0 音色
 * （1.0 的原本是混音原料，单独念也行；男声只有这一批里有）。目录取不到时抛，调用方把话说出来。
 */
export async function listNarrators(): Promise<Narrator[]> {
  if (narratorsCache) return narratorsCache;
  const cat = await getTtsVoices();
  const out: Narrator[] = [];
  const seen = new Set<string>();
  const add = (id: string, name: string, group: Narrator["group"]) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, name, group });
  };
  // 2.0 目录里目前全是女声（id 里带 female）；将来加了男声按 id 分
  for (const v of cat.voices ?? []) add(v.id, v.name, /_male_/.test(v.id) ? "male" : "female");
  for (const v of cat.mixable ?? []) add(v.id, v.name, v.gender === "male" ? "male" : "female");
  narratorsCache = out;
  return out;
}

/** 语速最多提到几（TTS 的 speech_rate：倍速 = 1 + r/100）。1.3 倍再往上旁白就成了赶场 */
const MAX_RATE = 30;

/** 一句配音没合成出来的原因 —— 剪辑页据此决定说什么、给什么出路 */
export class NarrationError extends Error {
  readonly kind: "empty" | "too-long" | "auth" | "rate" | "unsupported" | "network" | "upstream" | "store";
  constructor(kind: NarrationError["kind"], message: string) {
    super(message);
    this.name = "NarrationError";
    this.kind = kind;
  }
}

/** 一条声音有多长（秒）。先整条解码去量（最准），解不了再读 metadata */
async function measure(blob: Blob): Promise<number> {
  try {
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      try {
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        if (Number.isFinite(buf.duration) && buf.duration > 0) return buf.duration;
      } finally {
        void ctx.close().catch(() => {});
      }
    }
  } catch {
    /* 解不了：退到读 metadata */
  }
  const url = URL.createObjectURL(blob);
  try {
    return await probeDuration(url, "audio");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function explain(e: unknown): NarrationError {
  if (e instanceof NarrationError) return e;
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return new NarrationError("auth", t`登录已失效，重新登录之后再配音`);
    if (e.status === 429) return new NarrationError("rate", t`配音合成得太快了（每分钟最多 30 句），等一分钟再接着配`);
    if (e.status === 501) return new NarrationError("unsupported", t`服务器还没有开通语音合成，配音暂时用不了`);
    return new NarrationError("upstream", t`语音合成这一下没成（${e.status}），稍后再试一次`);
  }
  // fetch 自己抛的（断网 / 被取消）：没有状态码
  return new NarrationError("network", t`网络不通，这一句没合成出来——连上网再试一次`);
}

/**
 * 把一句话合成成配音。
 * @param availSec 这一段在成片里有多长（秒）—— 字数封顶与"念不念得完"都按它算
 * @returns 存好的配音（指针 + 量出来的时长 + 合成时的字与音色）。失败抛 NarrationError（整句人话）
 */
export async function synthLine(text: string, voiceId: string, availSec: number, signal?: AbortSignal): Promise<CutVoice> {
  const line = text.trim();
  if (!line) throw new NarrationError("empty", t`这一段还没有写字幕，没有可配音的话`);
  // 这一句念出来有多长（一个汉字算 1、三个多字母算 1，见 cutProject.lineUnits）。超过这一段念得完的量就不合成 ——
  // 这是配音免费期的那道限量，把关的位置就在花钱的这一发之前
  const units = Math.ceil(lineUnits(line));
  const cap = lineCap(availSec);
  if (units > cap) {
    throw new NarrationError("too-long", t`这一句太长了（${units}/${cap}），这一段念不完——改短一点，或者把这一段留长 / 放慢`);
  }
  // 念得完的时间：片段长度减去开头那一小段留白
  const room = Math.max(0.5, availSec - LINE_LEAD_SEC - 0.1);
  const est = lineUnits(line) / TTS_CPS;
  let rate = est > room ? Math.min(MAX_RATE, Math.ceil((est / room - 1) * 100)) : 0;
  try {
    let blob = await synthesizeSpeech({ text: line, voice: voiceId, ...(rate ? { rate } : {}) }, signal);
    let dur = await measure(blob);
    if (dur > room + 0.05 && rate < MAX_RATE) {
      // 量出来还是念不完：按量到的比例再提一档，重合成一次（只这一次）
      const need = Math.ceil(((1 + rate / 100) * (dur / room) - 1) * 100) + 2;
      const faster = Math.min(MAX_RATE, need);
      if (faster > rate) {
        const blob2 = await synthesizeSpeech({ text: line, voice: voiceId, rate: faster }, signal);
        const dur2 = await measure(blob2);
        if (dur2 < dur) {
          blob = blob2;
          dur = dur2;
          rate = faster;
        }
      }
    }
    const key = `cutvoice:${uid("vo")}`;
    if (!(await idbSet(key, blob))) {
      throw new NarrationError("store", t`配音合成好了，但没能存进本地库（存储空间不足？）——清一清空间再配一次`);
    }
    return { ref: `idb:${key}`, durSec: dur, voiceId, text, ...(rate ? { rate } : {}) };
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "AbortError") throw e;
    throw explain(e);
  }
}
