// 「这台设备上的这份本地数据是**谁的**」—— 唯一实现（铁律六）。
//
// ★★ 为什么要有这个文件（2026-09-18 主人真机）：同一台手机上退出 A、登录一个**全新的** B，
//   个人页还挂着 A 的「有一条剪到一半的成片」。那不只是一句提示说错了：
//     · B 点「接着剪」能把 A 付过钱的片子以 **B 的名义**发出去；点「丢掉」是替 A 删掉那条稿子；
//     · B 自己组稿会被它挡住（「你还有一条剪到一半的成片……先去剪完」）；
//     · 草稿箱、待取回的成片（取回凭据）同理 —— 全都存在设备级的单个键里，不记主人；
//     · 退出登录时内存里那条流水线原样留着，B 进工坊看到的是 A 的段。
//   待发队列（videos.PendingPublish.owner）与点赞（videos.LikedStore）早就按主人记了，
//   那两处是正确样板；这里把「主人是谁」收成一处，别的本机库都问它，不再各写一份 `currentUser()?.id`。
//
// ★ 两种「主人」，别混用：
//   · `deviceOwner()` —— **现在给谁看**。列表、横幅、取回卡只显示这个人的；没登录 / 会话还没认领上 = ""，
//     "" 看不到任何人的东西。
//   · `workOwner()` —— **内存里这摊活是谁的**（写盘时记的主人）。登录着时就是当前账号；登录失效（401）
//     之后是上一个登录的人 —— 那时流水线还在内存里、出片还在跑，自动存盘要记在**他**名下，而不是
//     写成无主（没人看得见 = 静默丢）或者被拒。成立的前提是下面那条：换成**另一个人**的那一拍，
//     内存里的活一律清掉（`onOwnerSwitch`：各 store / 模块在自己文件里订阅，模块级、不经组件），所以内存里的活
//     永远属于「最近一个登录过的人」。
//
// ★ 升级前的存量没有主人（owner 缺省）：由升级后**第一个在这台设备上登录的账号**认领（各库的 claim）。
//   这是能做到的最好了 —— 老数据里没有任何字段记着是谁写的；而单账号的设备（绝大多数）这样恰好都对。
//   多账号共用的设备（主人自己测试的那台）升级后先用原来的账号登录一次，东西就归他。
//   ⚠ 别改成「无主的对谁都可见」：那等于把这次的串号原样留给所有老数据。
//   ⚠ 也别改成「无主的一律藏起来」：藏起来的是用户花过钱的半成品，零提示消失比串号更坏。
import { API_ON } from "../api/client";
import { currentUser, isRemoteMode, subscribeAccount } from "./account";
import { bindSchemesOwner } from "./promptSchemes";
import { bindAssetOwner } from "./cardAsset";
import { bindVoiceOwner } from "./cardVoice";

/**
 * 账号变化的广播：account 的 emit 之外，DEV 下还有 __deviceOwner 那个测试口子（见文件末尾）也要能触发
 * 同一批回调 —— 所以本文件的订阅都经这一处，不直接挂 subscribeAccount。
 */
const listeners = new Set<() => void>();
subscribeAccount(() => {
  for (const fn of [...listeners]) fn();
});
function onAccountEvent(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** DEV 专用：顶替「现在登录的是谁」（null = 不顶替）。正式包里 import.meta.env.DEV 为假，整段是死码 */
let devOwner: string | null = null;

/** 现在给谁看：当前登录账号的 id。没登录 / 会话还没认领上 = ""（看不到任何人的东西，也不认领存量） */
export function deviceOwner(): string {
  if (import.meta.env.DEV && devOwner !== null) return devOwner;
  const u = currentUser();
  return u ? String(u.id) : "";
}

/** 这一进程里最近一个登录过的人（见文件头「两种主人」） */
let lastOwner = "";

/**
 * 内存里这摊活是谁的 —— **写盘时记的主人**（草稿、剪辑稿、取回凭据）。
 * 登录着时 = 当前账号；登录失效之后 = 上一个登录的人；这一进程里从没人登录过 = ""（调用方据此拒写）。
 */
export function workOwner(): string {
  const now = deviceOwner();
  if (now) lastOwner = now;
  return lastOwner;
}

/**
 * 现在这个人能不能认领升级前的无主存量（各库的 claim 都先问它）。
 * ★★ 配了服务器、这次会话却没连上时**一律不认领**（2026-09-18 复核抓到）：那时登录页退回本机账号那一套，
 *   登进来的是一个现编 id 的本机账号 —— 它一认领，老草稿、剪辑稿、取回凭据、本机模板就全归了这个临时身份；
 *   服务器回来后用真账号登录，一样都看不到了。无主的原样留着，等连上服务器、真账号登录时再认领。
 */
export function mayClaimLegacy(): boolean {
  return !!deviceOwner() && !(API_ON && !isRemoteMode());
}

/** 这条带主人的记录，对**现在这个人**可见吗。无主的存量先由各库认领，这里一律判否 */
export function ownedByViewer(owner: string | undefined): boolean {
  const me = deviceOwner();
  return !!me && owner === me;
}

/**
 * 「现在给谁看」变了（登录 / 退出 / 换人 / 会话认领上）。各本机库拿它认领存量、通知自己的订阅者重画。
 * ★ 只在值真的变了时回调：account 的 emit 很频繁（钱包、改名、卡片都会 emit），不去重的话每一次都重画一遍。
 */
export function onViewerChange(fn: (owner: string) => void): () => void {
  let seen = deviceOwner();
  return onAccountEvent(() => {
    const now = deviceOwner();
    if (now === seen) return;
    seen = now;
    fn(now);
  });
}

/**
 * **换成了另一个人**（A → B，中间可能隔着一段没登录）。内存里属于 A 的活要在这一拍清掉。
 * ★ A → 没登录 → A **不算**：登录失效后重新登录同一个号，流水线与在跑的出片都该原样还在。
 * ★ 从没登录过 → A 也不算：那时内存里没有任何人的活。
 */
export function onOwnerSwitch(fn: (prev: string, next: string) => void): () => void {
  let prev = workOwner();
  return onAccountEvent(() => {
    const now = deviceOwner();
    if (!now) return;
    if (prev && now !== prev) {
      const was = prev;
      prev = now;
      fn(was, now);
      return;
    }
    prev = now;
  });
}

/**
 * 换过几次人（onOwnerSwitch 每触发一次 +1）。内存里的长活 await 回来时比一下：变了 = 中途换过人、内存已经被清过 ——
 * **哪怕又换回来了**：A → B → A 之后流水线 / 工坊 / 剪辑稿都已经不是发起时那一份，手里捏着的节点、稿子全是悬空的
 * （2026-09-18 复核抓到：只比 workOwner() 的话 A → B → A 看不出来，取回会把凭据销毁、剪辑页会拿空稿子盖掉剪辑稿）。
 * ★ 与「比 workOwner()」分工：要判「这一发请求会记在谁的账上」比人（A → B → A 之后发出去的仍是 A 的 token）；
 *   要判「我手里的节点 / 稿子还在不在」比这个代数。
 */
let switches = 0;
export function ownerEpoch(): number {
  return switches;
}
// ★ 在各 store 的清空之前登记（本文件最先装载），换人那一拍先 +1、再清
onOwnerSwitch(() => {
  switches++;
});

// 方案库、肖像授权、声音样本三个是叶子模块、不能 import 本文件（account 经它们绕回来会成环，见各自文件头），
// 由这里把「现在是谁」注入过去
const inject = (fn: () => void) => {
  onViewerChange(() => fn());
};
bindSchemesOwner({ viewer: deviceOwner, work: workOwner, claim: mayClaimLegacy }, inject);
bindAssetOwner({ viewer: deviceOwner, work: workOwner }, inject);
bindVoiceOwner({ viewer: deviceOwner, work: workOwner }, inject);

// 让 workOwner() 在「没人调它的那段时间里」也记住最近一个登录的人：否则登录失效之后第一次调它，
// 拿到的是模块初始化那一拍的值（多半是 ""），而那之后登录过的人一个都没记上。
onAccountEvent(() => {
  workOwner();
});

// DEV 测试口子：`__deviceOwner("A")` 假装 A 登录着、`__deviceOwner("")` 假装没人登录、`__deviceOwner(null)` 还原。
// 用来在浏览器里验「换账号」的每一条隔离，而不必真去注册账号（2026-09-18 这一批就是这么验的）。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__deviceOwner = (id: string | null) => {
    devOwner = id;
    for (const fn of [...listeners]) fn();
  };
}
