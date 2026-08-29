// 人物卡的声音样本 —— **本机侧库**，不进 Card 对象（卡片系统 V2 阶段 2，2026-08-24）。
//
// ★★ 为什么是侧库而不是 Card.voice 字段：卡在远端模式下的真相是服务端那份 ——
//   loadRemoteAssets 每次冷启动**整体覆盖** db.cards，而服务端 schema 会 strip 未声明
//   字段（`deck` 就这么丢过，CLAUDE.md 有专条）。把 voice 写在卡上意味着四处一起改
//   （branch payload / ApiCard / toLocalCard / server zod）加一次服务端部署，且样本是
//   MB 级 dataURL，走卡同步还会撑爆请求体。侧库按 cardId 存本机 IndexedDB，
//   卡怎么覆盖都影响不到它 —— 代价是**声音不跨设备、不随分享**，这正是 V1 设计里
//   「分享不带声音样本」那条（他人声音的授权问题，先不开口子）。
// ★ 读是同步的（渲染层每拍都问），远端那份不存在 —— 全部数据靠模块加载时 hydrate 一次。
//   与 danmaku 的 cache 同款套路，但更简单：没有远端要补。
import { idbGet, idbSet } from "./db";

export interface CardVoice {
  /** WAV dataURL（24kHz 单声道 16-bit，2~15 秒 —— Seedance 参考音频的窗口） */
  dataUrl: string;
  durationSec: number;
  /** 来源说明（「取自原视频 12.0–19.5s」），卡详情/选卡器展示 */
  note?: string;
}

const KEY = "ideahub.cardVoices";
/** Seedance 2.x 参考音频的硬窗口（阶段 0 文档口径：2–15s） */
export const VOICE_MIN_SEC = 2;
export const VOICE_MAX_SEC = 15;

let map: Record<string, CardVoice> = {};
let version = 0;
const subs = new Set<() => void>();

function emit(): void {
  version++;
  for (const fn of subs) fn();
}

export function subscribeVoices(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function voicesVersion(): number {
  return version;
}

// 模块加载即 hydrate：第一批读方（卡片列表的 🔊 徽标）到得比 idb 回包早，
// 先按"没有"画、到货后 emit 重画 —— 与 videos.loadDetail 同一招
void idbGet<Record<string, CardVoice>>(KEY).then((m) => {
  if (m && typeof m === "object") {
    map = m;
    emit();
  }
});

export function voiceOf(cardId: string): CardVoice | null {
  return map[cardId] ?? null;
}

export async function saveVoice(cardId: string, v: CardVoice): Promise<void> {
  map = { ...map, [cardId]: v };
  emit();
  await idbSet(KEY, map);
}

/** 删卡时一并清（account.removeCard 挂了这一钩）。没有就静默 —— 清理路径不该吵 */
export function removeVoice(cardId: string): void {
  if (!map[cardId]) return;
  const { [cardId]: _gone, ...rest } = map;
  map = rest;
  emit();
  void idbSet(KEY, map);
}
