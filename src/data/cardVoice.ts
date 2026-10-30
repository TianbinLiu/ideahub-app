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
// ★★ 按**「主人 + 卡 id」**存（2026-09-18，理由同 data/cardAsset 文件头那段）：原来只按卡 id 存，
//   B 打开 A 那张卡的详情页能直接播 A 的声音样本，B 出片会把 A 的样本当参考音频发出去，
//   B 删掉一张同 id 的卡（广场装来的副本）会把 A 这份**唯一的**样本删掉（样本从不上传）。
//   老样本（裸卡 id）只在登录时认领给「这张卡是他原创的」那个人（claimLegacyVoices）。
// ★ 本文件是叶子（account → 本文件），「现在是谁」由 data/deviceOwner 注入（bindVoiceOwner）。
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
// ★ 与内存里已有的合并（内存优先）：hydrate 回来之前就存下的那一条不该被盘上那份盖掉（同 cardAsset）
const hydrated: Promise<void> = idbGet<Record<string, CardVoice>>(KEY).then((m) => {
  if (m && typeof m === "object") {
    map = { ...m, ...map };
    emit();
  }
});

/** 这张卡**现在这个人**的声音样本（别人的查不到） */
export function voiceOf(cardId: string): CardVoice | null {
  const me = ownerSrc.viewer();
  if (!me) return null;
  return map[slotKey(me, cardId)] ?? null;
}

export async function saveVoice(cardId: string, v: CardVoice): Promise<void> {
  const owner = ownerSrc.work();
  if (!owner) return; // 这一进程里没人登录过：说不出是谁的，不存（存成无主的谁都用不了）
  map = { ...map, [slotKey(owner, cardId)]: v };
  emit();
  await idbSet(KEY, map);
}

/** 删卡时一并清（account.removeCard 挂了这一钩）。只清**自己**那一份；没有就静默 —— 清理路径不该吵 */
export function removeVoice(cardId: string): void {
  const key = slotKey(ownerSrc.work(), cardId);
  if (!map[key]) return;
  const { [key]: _gone, ...rest } = map;
  map = rest;
  emit();
  void idbSet(KEY, map);
}

/** 升级前那些只按卡 id 存的老样本，归给现在登录的这个人 —— 只限他原创的卡（见文件头 ★★） */
export async function claimLegacyVoices(originalIds: Iterable<string>): Promise<void> {
  await hydrated;
  const me = ownerSrc.viewer();
  if (!me) return;
  let next = map;
  let changed = false;
  for (const id of originalIds) {
    if (!next[id] || next[slotKey(me, id)]) continue;
    const { [id]: legacy, ...rest } = next;
    next = { ...rest, [slotKey(me, id)]: legacy };
    changed = true;
  }
  if (!changed) return;
  map = next;
  emit();
  await idbSet(KEY, map);
}

// ── 主人（见文件头 ★★）──
interface VoiceOwnerSource {
  viewer: () => string;
  work: () => string;
}
let ownerSrc: VoiceOwnerSource = { viewer: () => "", work: () => "" };

/** data/deviceOwner 装载时调一次（本文件是叶子，不能反过来 import 它） */
export function bindVoiceOwner(src: VoiceOwnerSource, onViewerChange: (fn: () => void) => void): void {
  ownerSrc = src;
  onViewerChange(() => emit());
  emit();
}

/** 落盘键：新样本是「主人｜卡 id」，升级前的老样本是裸卡 id（还没被认领） */
function slotKey(owner: string, cardId: string): string {
  return owner + "|" + cardId;
}
