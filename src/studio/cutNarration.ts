// 剪辑页的配音：把片段上那一句字幕合成成声音（服务端 /api/tts）、**量**出它有多长、存进本地库，回一条 CutVoice。
//
// ★ 这里只管"一句话 → 一条声音"。排在成片的第几秒、念不完怎么办、要不要压配乐，都在 data/cutProject.timelinePlan
//   （纯函数，预览与导出照同一份）；哪一句要配、配完写回哪个片段，由剪辑页管。
// ★ 钱（主人 2026-09-30 定「免费 + 限量」）：配音**不向用户收 token**，但它按字符计费，是平台的真成本 —— 所以限量：
//   一段一句（数据形状就是这样：CutClip.line 只有一条）、字数按这一段的时长封顶（cutProject.lineCap，
//   合成之前在这里把关）、服务端每个账号每分钟 30 次、**每个账号每天几个字**（服务端定，`/api/tts/voices` 的 narrationFree）。
// ★★ 免费是**服务端**说了算，靠请求里的 `purpose: "cut-narration"`（NARRATION_PURPOSE）：/api/tts 从 2026-09-25 起按字扣钱，
//   2.58 ~ 2.62 的剪辑页没带这个标记、却写着「现在免费」—— 界面说不要钱、实际扣了（2026-10-08 才补上）。
//   所以界面上那个「免费」只在服务端的音色目录里**看见能力位**时才说（loadNarration 的 freeDaily），老服务端上一个字都不提。
// ★ 念不完本段：先按字数估，估着念不完就直接提一档语速合成；量出来还超、而语速还有余量，就按量到的比例再提一次
//   （最多重合成这一次）。还超就原样交回去 —— 不悄悄截断，超出多少由计划算出来、剪辑页标出来让人改短。
// ★ 合成回来的声音先**切掉首尾的静音**再量、再存（tidy，判据在 cutProject.voiceBounds）：2026-10-01 拿真的语音合成量过，
//   每句开头有 0.18~0.46 秒、结尾有 0~0.54 秒是静的 —— 不切，声音比字幕晚半秒才出来，每句还白占约 0.7 秒。
import { t } from "@lingui/core/macro";
import { ApiError } from "../api/client";
import { getTtsVoices } from "../api/companion";
import { synthesizeSpeech } from "../api/support";
import { LINE_LEAD_SEC, TTS_SPEECH_CPS, lineCap, lineUnits, voiceBounds, wavBytes, type CutProject, type CutVoice } from "../data/cutProject";
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

/** 请求体里的用途标记：服务端认它走旁白的免费额度（不带就按字扣钱）。值与服务端 tts.routes 的 NARRATION 逐字相同 */
export const NARRATION_PURPOSE = "cut-narration" as const;

export interface NarrationCatalog {
  narrators: Narrator[];
  /**
   * 旁白免费、每个账号每天几个字 —— 服务端音色目录里的能力位（`narrationFree.dailyChars`）。
   * null = 服务端没说（老服务端：那里旁白是按字扣钱的）⇒ 界面**不许**说「免费」。
   */
  freeDaily: number | null;
}

let catalogCache: NarrationCatalog | null = null;

/**
 * 可选的旁白音色：服务端的音色目录（/api/tts/voices）—— 2.0 单音色 + 那批逐个验证过能出声的 1.0 音色
 * （1.0 的原本是混音原料，单独念也行；男声只有这一批里有）；顺带读旁白免不免费（同一份目录里的能力位）。
 * 目录取不到时抛，调用方把话说出来。
 */
export async function loadNarration(): Promise<NarrationCatalog> {
  if (catalogCache) return catalogCache;
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
  // 判否定：认不出的形状一律当「没说」（不说免费），而不是当成免费
  const daily = Number(cat.narrationFree?.dailyChars);
  catalogCache = { narrators: out, freeDaily: Number.isInteger(daily) && daily > 0 ? daily : null };
  return catalogCache;
}

/**
 * 语速最多提到几（TTS 的 speech_rate）。1.3 倍再往上旁白就成了赶场。
 * ★ 量过（2026-10-01）：有声的那一截确实按 1 + r/100 缩（r=10 → 1.09 倍、20 → 1.20、30 → 1.28），首尾的静音不跟着缩 ——
 *   所以"按比例再提一档"要拿切掉静音之后的时长去算（tidy 之后量的就是它）。
 */
const MAX_RATE = 30;
/** 解码配音用的采样率：语音合成给的就是 24kHz 单声道，照这个数解，存出来的 WAV 不白白放大 */
const VOICE_RATE = 24000;

/**
 * 一句配音没合成出来的原因 —— 剪辑页据此决定说什么、给什么出路。
 * `quota` = 今天的免费额度 / 用量上限用完了，`money` = 钱包不让扣（只在老服务端上会有：那里旁白按字扣钱）——
 * 这两种与 auth / rate / unsupported / network 一样，后面的句子也一样会失败，一批里撞上就停。
 */
export class NarrationError extends Error {
  readonly kind: "empty" | "too-long" | "auth" | "rate" | "quota" | "money" | "unsupported" | "network" | "upstream" | "store";
  constructor(kind: NarrationError["kind"], message: string) {
    super(message);
    this.name = "NarrationError";
    this.kind = kind;
  }
}

/**
 * 把合成回来的一条声音收拾好：切掉首尾的静音（切过的另存成 WAV），量出它有多长（秒）。
 * 解不了码时（没有 OfflineAudioContext / 文件坏了）原样交回去、只读 metadata 的时长 —— 少一次修剪，不算失败。
 */
async function tidy(blob: Blob): Promise<{ blob: Blob; dur: number }> {
  try {
    const Ctx: typeof OfflineAudioContext | undefined =
      window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (Ctx) {
      // 只借它解码（不渲染）：解出来的采样率就是这里给的 VOICE_RATE
      const buf = await new Ctx(1, VOICE_RATE, VOICE_RATE).decodeAudioData(await blob.arrayBuffer());
      if (Number.isFinite(buf.duration) && buf.duration > 0) {
        const pcm = monoOf(buf);
        const cut = voiceBounds(pcm, buf.sampleRate);
        // 两头都没什么可切的（不到 50 毫秒）就留着原文件：白转一次 WAV 只会让它变大
        if (cut && pcm.length - (cut.end - cut.start) > 0.05 * buf.sampleRate) {
          const kept = pcm.subarray(cut.start, cut.end);
          return { blob: new Blob([wavBytes(kept, buf.sampleRate)], { type: "audio/wav" }), dur: kept.length / buf.sampleRate };
        }
        return { blob, dur: buf.duration };
      }
    }
  } catch {
    /* 解不了：退到读 metadata */
  }
  const url = URL.createObjectURL(blob);
  try {
    return { blob, dur: await probeDuration(url, "audio") };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 多声道混成单声道（语音合成给的本来就是单声道，这里只是不信任输入） */
function monoOf(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels <= 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / buf.numberOfChannels;
  }
  return out;
}

function explain(e: unknown): NarrationError {
  if (e instanceof NarrationError) return e;
  if (e instanceof ApiError) {
    // ★ 认 code 不认 message（CLAUDE.md 坑表「按错误 message 里的中文关键词判」）。403 与 429 各有两种意思：
    //   钱包被冻结 / 套餐不够也是 403、每日上限也是 429 —— 原来一律说成「登录失效」「每分钟 30 句」，人照着做也解决不了
    if (e.code === "NARRATION_DAILY_LIMIT") return new NarrationError("quota", t`今天的免费配音用完了（每个账号每天限量），明天再接着配——字幕照样能烧进画面`);
    if (e.code === "DAILY_LIMIT") return new NarrationError("quota", t`今天的 token 用量到上限了，明天再接着配`);
    if (e.status === 402 || e.code === "INSUFFICIENT_TOKENS") return new NarrationError("money", t`token 余额不够，配音没合成`);
    if (e.code === "WALLET_FROZEN" || e.code === "PLAN_REQUIRED") return new NarrationError("money", t`这个账号的钱包现在不能扣费（有欠额或套餐不够），配音没合成`);
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
  // 这一句念出来有多长（一个汉字算 1、一个字母算 0.4，见 cutProject.lineUnits）。超过这一段念得完的量就不合成 ——
  // 这是免费配音的那道限量（每天的总量另由服务端把关），把关的位置就在花钱的这一发之前
  const units = Math.ceil(lineUnits(line));
  const cap = lineCap(availSec);
  if (units > cap) {
    throw new NarrationError("too-long", t`这一句太长了（${units}/${cap}），这一段念不完——改短一点，或者把这一段留长 / 放慢`);
  }
  // 念得完的时间：片段长度减去开头那一小段留白
  const room = Math.max(0.5, availSec - LINE_LEAD_SEC - 0.1);
  // 第一发要不要先提语速：按实测的平均语速估（不含首尾静音，tidy 会把它切掉）
  const est = lineUnits(line) / TTS_SPEECH_CPS;
  let rate = est > room ? Math.min(MAX_RATE, Math.ceil((est / room - 1) * 100)) : 0;
  try {
    let { blob, dur } = await tidy(await synthesizeSpeech({ text: line, voice: voiceId, purpose: NARRATION_PURPOSE, ...(rate ? { rate } : {}) }, signal));
    if (dur > room + 0.05 && rate < MAX_RATE) {
      // 量出来还是念不完：按量到的比例再提一档，重合成一次（只这一次）
      const need = Math.ceil(((1 + rate / 100) * (dur / room) - 1) * 100) + 2;
      const faster = Math.min(MAX_RATE, need);
      if (faster > rate) {
        // ★ 提速重配这一发是锦上添花：它没成（今天的免费额度刚好用完、网断了一下）就留着第一发 ——
        //   第一发已经合成好了、也已经占过额度，扔掉它让整句失败，只会让人对着一句"没配上"再配一次。念不完多少由计划标出来
        let again: { blob: Blob; dur: number } | null = null;
        try {
          again = await tidy(await synthesizeSpeech({ text: line, voice: voiceId, purpose: NARRATION_PURPOSE, rate: faster }, signal));
        } catch (e) {
          if ((e as { name?: string } | null)?.name === "AbortError") throw e;
        }
        if (again && again.dur < dur) {
          blob = again.blob;
          dur = again.dur;
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
