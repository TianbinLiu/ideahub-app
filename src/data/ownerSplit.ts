// 「整张本机表 → 现在这个人的 / 别人的」—— 本机库按主人分区的**唯一**写法（2026-09-18，见 data/deviceOwner 文件头）。
//
// ★ 零依赖（叶子）：data/promptSchemes 必须保持叶子（它经 account → mock/ai 被绕回来，见那边的 ★★），
//   所以这里不 import deviceOwner —— 「现在是谁」由调用方传进来。
// ★ 各库的形状都一样：内存里 `mine`（现在这个人的，全文件读写的都是它）+ `others`（别人的，从不显示，
//   落盘时并回去）。换人时拿两份合起来重分一次。

/**
 * 按主人分区。`me` 为空（没人登录）时一条都不归 mine。
 * 无主的存量（升级前写的）归 `me` —— 由升级后第一个登录的人认领；`claimed` 为真时调用方要落一次盘。
 * `claim` 为假（deviceOwner.mayClaimLegacy 说这个人不该认领）时无主的原样留在 others 里，等下一个该认领的人。
 * ★ `claim` 必填：漏传是零症状的（老数据被一个临时身份认走，见 mayClaimLegacy 的 ★）。
 * ★ 认领是就地改 `owner`（与各库原来就地改条目的写法一致），调用方不必再拷一份。
 */
export function splitByOwner<T extends { owner?: string }>(
  all: T[],
  me: string,
  claim: boolean,
): { mine: T[]; others: T[]; claimed: boolean } {
  const mine: T[] = [];
  const others: T[] = [];
  let claimed = false;
  for (const item of all) {
    if (!item.owner && me && claim) {
      item.owner = me;
      claimed = true;
    }
    if (me && item.owner === me) mine.push(item);
    else others.push(item);
  }
  return { mine, others, claimed };
}
