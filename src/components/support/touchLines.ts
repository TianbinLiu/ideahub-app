/**
 * 客服页「摸一下看板娘」那一句的 App 侧规矩（2026-10-25）：
 *   ① 挑哪一句：companion/protocol 的 pickTouchReaction 挑完，舞台不是官方看板娘时，把讲官方形象外貌的那几句换成别的；
 *   ② 念出来的声音：同一句、同一套声音只合成一次（只在内存里，活到这一次离开客服页为止）。
 *   语言由调用方传当前生效的界面语言（i18n/switch.activeLang），英文界面念英文。
 *
 * ★ 为什么不改 companion/protocol.ts：那份与官网 client 同源拷贝（CLAUDE.md 目录那一节），给台词加一个「只给官方形象」的标记
 *   就得两仓一起改、官网合进 main 就是发布。这里按台词的**英文**认是哪几句：每条台词中英两种写法在同一个对象上，
 *   认英文不必在 App 里再抄一份中文字面量（抄了会撞 i18n 棘轮，也是第二份真相）。
 *   （protocol.ts 里 TOUCH_REACTIONS 头上原来那句「客服页只用中文」已改成「调用方按界面语言取」，2026-10-26 最终审核，
 *   随 protocol.ts 的那一条官网同步一起过去。）
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
 * ★★ 合成那一发**不跟着中止**（2026-10-25 审核抓到）：服务端 /api/tts 在上游给出音频那一刻就扣钱，客户端断开不会让它取消上游、也不退钱
 *   （server tts.routes.js 的 billing.chargedCall）。原来把这一次的中止信号传给 fetch：人点了看板娘、声音还没回来就按发送 / 快捷问题 / ■，
 *   fetch 被掐、钱照扣、声音没记下 —— 下次点到同一句再合成、再扣一次，而知识库写的是「只扣一次」。
 *   所以合成那一发一律跑完：成功就记下（这一次已经没人要听了也记）；同一句、同一套声音还在路上时再点到，**接着等同一发**（pending），不另发一发。
 *   中止只作用在「这一次还等不等」上（speak 的 signal）：一中止就当场以 AbortError 拒掉 —— stopAll 之后作废的那一次 perform 不会
 *   等着合成回来，卡住下一轮 send() 的演出队列（enqueue 是串行的）。
 * ★ 只记**合成成功**的：失败（网络断了、服务端拒了）的不记，下一次照常再合成。合成期间换了声音的那一份也不记。
 *   合成那一发不受这一页控制之后，它自己总会结束（服务端对上游有超时、Cloudflare 125 秒读超时），结束时 pending 那一格一并清掉。
 * ★ 只在内存里、跟着页面实例走（SupportPage 挂载时建一个）：离开客服页再进来重新合成。不落盘 —— 存一堆音频进 IndexedDB 换来的
 *   只是省下下一次进页那几句的钱，而缓存要认账号、认声音、认过期，不值。
 */
export class TouchVoiceCache {
  private sig = "";
  private blobs = new Map<string, Blob>();
  /** 还在路上的那一发（键同 blobs）：同一句再点到就接着等它，不另发、不另扣 */
  private pending = new Map<string, Promise<Blob>>();

  speak(config: SupportConfig | null, body: TtsRequest, signal?: AbortSignal): Promise<Blob> {
    const sig = touchVoiceSig(config);
    if (sig !== this.sig) {
      // 换了声音：旧声音那几发回来也不记（下面判 this.sig === sig），新请求也不去接旧的那一发
      this.blobs.clear();
      this.pending.clear();
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
    let job = this.pending.get(key);
    if (!job) {
      // ★ 不传 signal（见上面 ★★）
      const p: Promise<Blob> = synthesizeSpeech(body).then(
        (blob) => {
          if (this.pending.get(key) === p) this.pending.delete(key);
          if (this.sig === sig) {
            this.blobs.set(key, blob);
            while (this.blobs.size > TOUCH_VOICE_MAX) {
              const oldest = this.blobs.keys().next().value;
              if (oldest === undefined) break;
              this.blobs.delete(oldest);
            }
          }
          return blob;
        },
        (e: unknown) => {
          if (this.pending.get(key) === p) this.pending.delete(key);
          throw e;
        },
      );
      this.pending.set(key, p);
      job = p;
    }
    return untilAborted(job, signal);
  }

  get size(): number {
    return this.blobs.size;
  }
}

/**
 * 等 job，但 signal 一中止就当场拒掉（AbortError）；job 本身照常跑完。
 * job 后来失败也不会变成未处理的拒绝：这里一直挂着它的处理器（对已经定下来的 Promise 再 reject 是空操作）。
 */
function untilAborted<T>(job: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return job;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      abort();
      // 照样挂上处理器：没人等的这一发后来失败了也不报未处理
      job.catch(() => undefined);
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    job.then(
      (v) => {
        signal.removeEventListener("abort", abort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(e);
      },
    );
  });
}
