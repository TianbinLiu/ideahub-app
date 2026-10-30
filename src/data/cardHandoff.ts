// 卡片详情页「先登录、再添加」那一趟的寄存处：没登录的人点「＋ 添加到我的卡片」要先去登录页，
// 而这张卡是靠路由 state 带进详情页的 —— 登录页只 `navigate(next)`，state 过不去。
//
// ★ 为什么要寄存（2026-10-20 复核抓到）：广场上的卡丢了 state 也不要紧，详情页会按 id 去广场再取一次；
//   但作品页「本片卡组」、模板详情页卡组里的卡是**快照**（没分享到广场），按 id 取回来是 404 ——
//   登完回来，页面画的是「这张卡不在你的收藏里，创意工坊的广场上也没有」，卡明明就在上一页上。
// ★ 只寄存一张、半小时作废：这一趟就是「点添加 → 登录 → 回来」，不是收藏夹。
// ★ 内存一份 + sessionStorage 一份：第三方登录在网页上会整页跳走再跳回来，内存那份活不过去；
//   sessionStorage 写不进去（卡面是 dataURL 时可能顶配额、隐私模式会抛）就只留内存那份。
import type { Card } from "../types";

const KEY = "ideahub-app.cardHandoff.v1";
const TTL_MS = 30 * 60_000;

type Slot = { card: Card; at: number };
let mem: Slot | null = null;

/** 去登录之前寄存这张卡 */
export function stashCardForLogin(card: Card): void {
  mem = { card, at: Date.now() };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(mem));
  } catch {
    /* 顶配额 / 隐私模式：只留内存那份 */
  }
}

/** 这个 id 有没有寄存着、还没过期的那张卡（只看不取：详情页每一拍都会问，取走要等它真进了库，见 clearStashedCard） */
export function peekStashedCard(id: string | undefined): Card | null {
  if (!id) return null;
  let slot = mem;
  if (!slot) {
    try {
      const raw = sessionStorage.getItem(KEY);
      slot = raw ? (JSON.parse(raw) as Slot) : null;
    } catch {
      slot = null;
    }
  }
  if (!slot || slot.card?.id !== id || Date.now() - slot.at > TTL_MS) return null;
  return slot.card;
}

/** 卡已经进了库（或换了别的卡）：撤掉寄存 */
export function clearStashedCard(id: string | undefined): void {
  if (!id || peekStashedCard(id) === null) return;
  mem = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* 同上 */
  }
}
