// 拉黑（把某个人从我眼前拿掉）—— 对接服务端的 `/api/blocks`。
//
// ★★ 为什么是 `/api/blocks` 而不是 `/api/messages/blacklist`（2026-09-03 复核抓到，两条原因）：
//   ① 那条端点前面串着三道**私信申请域**的防滥用闸（「对方回复过你才能拉黑」等），
//      任一不满足就是 403 —— 而「我回过他一句、他开始骚扰我」恰恰是最该能拉黑的场景，
//      也正是 Play 的 UGC 政策要这个功能的理由。一个可能 403 的拉黑等于没有拉黑。
//   ② 它回的是拉黑**记录**（populate 过的 blockedUserId），调用方得反向猜哪个字段是人 ——
//      第一版就猜错了：取到记录 `_id` 当用户 id，于是「解除」发出去删不掉任何东西，
//      而界面还乐观地把那一行移走了（零报错的空操作）。
//   ⇒ 服务端另开了一套**回客户端真正需要的形状**的端点，两套写同一张表（一份名单）。
//
// ★ 端点表只写一处（铁律六）。
// ★ 「这台服务器有没有这个功能」判**响应形状**不判状态码：真机上 Capacitor 的本地静态
//   服务器对未命中路径做 SPA 回退，返回 **200 + index.html**，`res.ok` 恒真。
//   与 api/admin.ts、api/notifications.ts 同一招（CLAUDE.md 里有整段说明）。
import { apiDelete, apiGet, apiPost } from "./client";

const PATHS = {
  list: "/api/blocks",
  block: (userId: string) => `/api/blocks/${encodeURIComponent(userId)}`,
  unblock: (userId: string) => `/api/blocks/${encodeURIComponent(userId)}`,
};

/** 黑名单里的一个人。服务端已经回好了这个形状，这里不再做字段猜测 */
export interface BlockedUser {
  id: string;
  name: string;
  avatar?: string;
  blockedAt?: string;
}

/** 回包长得像不像那件事本身 —— 不像就当"这台服务器没有这个功能"，而不是"名单是空的" */
function looksLikeList(v: unknown): v is { items?: unknown[] } {
  return !!v && typeof v === "object" && Array.isArray((v as { items?: unknown[] }).items);
}

function toBlocked(raw: unknown): BlockedUser | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  // ★ 拿不到用户 id 就整条丢掉，**不做任何回落**：上一版回落到"记录本身"，
  //   于是名单里每个人都叫「这个用户」，解除还删不掉 —— 宁可少一行，不要一行假的。
  if (!id) return null;
  return {
    id,
    name: typeof o.name === "string" && o.name ? o.name : "这个用户",
    avatar: typeof o.avatar === "string" && o.avatar ? o.avatar : undefined,
    blockedAt: typeof o.blockedAt === "string" ? o.blockedAt : undefined,
  };
}

/**
 * 我拉黑了哪些人。
 * @returns `null` = **没问到**（老服务端没这个端点 / 网络不通），与「问过了，一个都没有」
 *   是两件事 —— 界面上必须分开说（铁律八；本仓为「把 N 种结局压成两档」栽过好几次）。
 */
export async function listBlocked(): Promise<BlockedUser[] | null> {
  try {
    const r = await apiGet<unknown>(PATHS.list);
    if (!looksLikeList(r)) return null;
    return (r.items ?? []).map(toBlocked).filter((x): x is BlockedUser => !!x);
  } catch {
    return null;
  }
}

/**
 * 把服务端的失败翻成**给用户看的整句人话**。
 *
 * ★★ 上一版是 `没能拉黑（${原文.slice(0,60)}）——稍后再试`，三处都错（复核抓到）：
 *   原文是**英文**、被从句子中间**截断**、而且「稍后再试」是**假的** ——
 *   这几种失败是永久性的（自己拉黑自己、id 非法、人不存在），再点一百次也一样。
 *   「往让人放心的方向说错」不比往吓人的方向说错高尚：它会让用户一直点一颗永远不会成的键。
 */
function blockErrorText(e: unknown, verb: "拉黑" | "解除"): string {
  const raw = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (raw.includes("yourself")) return "不能拉黑自己。";
  if (raw.includes("not found") || raw.includes("invalid user")) return "找不到这个人（账号可能已经注销了）。";
  if (raw.includes("401") || raw.includes("unauthor")) return "登录状态过期了，重新登录之后再试。";
  // 剩下的才是"可能是一时的"：网络、5xx。只有这一支才配说「再试一次」
  return `暂时没能${verb}（网络或服务器忙）——过一会儿再试一次。`;
}

/**
 * 拉黑 / 解除。
 * @returns `null` = 成功；非空 = 给用户看的整句原因（铁律八：别只把按钮变灰）。
 */
export async function blockUser(userId: string): Promise<string | null> {
  try {
    await apiPost(PATHS.block(userId), {});
    return null;
  } catch (e) {
    return blockErrorText(e, "拉黑");
  }
}

/**
 * @returns `null` = 真的解除了；非空 = 整句原因。
 * ★ 服务端回 `removed`：**它是 false 就说明什么都没删掉**（比如名单里本来就没有这个人）。
 *   不判它的话，把一个不存在的 id 发过去也会被当成"解除成功" —— 那正是上一版那个
 *   零报错空操作的形状（界面把那一行移走了，而服务器上原封不动）。
 */
export async function unblockUser(userId: string): Promise<string | null> {
  try {
    const r = await apiDelete<unknown>(PATHS.unblock(userId));
    const removed = !!r && typeof r === "object" ? (r as { removed?: unknown }).removed : undefined;
    if (removed === false) return "没找到这条拉黑记录（可能已经解除过了）——刷新一下看看。";
    return null;
  } catch (e) {
    return blockErrorText(e, "解除");
  }
}
