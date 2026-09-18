// 「本机 blob 仓里这个大文件（AI 建模的 GLB）是**谁的**」—— 只给清理缓存用（2026-09-18）。
//
// ★★ 为什么要有它：清理缓存判「没人引用」时，卡片这一路只数得到**现在登录的这个人**的卡（myCards —— 远端模式下
//   别的账号的卡根本不在本机）。而工坊现炼的建模是 `idb:model3d:<卡 id>`，只存在这台设备上：B 登录时点一次清理，
//   A 那几张卡的 3D 建模（每个花过十几万 token）就被当成孤儿删掉，A 再登录时卡上的指针指向空气。
//   ⇒ 建模落库那一拍记下主人（noteBlobOwner），清理时 `model3d:` 只动**登记在现在这个人名下**的。
// ★ 登记之前（升级前）落库的那些没有主人：一律不删 —— 说不出是谁的，删错就是删掉别人付过钱的东西；
//   省下这点空间不值得（与 cacheSweep「解不出时间的一律不删」同一条纪律）。
// ★ 落 localStorage：一条几十字节，清理那一刻要同步问。
import { deviceOwner, workOwner } from "./deviceOwner";

const KEY = "ideahub-app.blobOwners.v1";

function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    const obj: unknown = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? (obj as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function write(m: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* 存不下：这一条就当没登记 —— 清理时按"说不出是谁的"不删，只是少清一点 */
  }
}

/** 这个 blob 刚落库：记在「内存里这摊活的主人」名下 */
export function noteBlobOwner(blobKey: string): void {
  const owner = workOwner();
  if (!owner) return;
  const m = read();
  m[blobKey] = owner;
  write(m);
}

/** 这个 blob 登记在**现在登录的这个人**名下吗（没登记 / 别人的都答否 = 清理时不动它） */
export function blobOwnedByViewer(blobKey: string): boolean {
  const me = deviceOwner();
  return !!me && read()[blobKey] === me;
}

/** 这几个 blob 已经删掉了：登记一并清掉 */
export function forgetBlobOwners(blobKeys: string[]): void {
  if (blobKeys.length === 0) return;
  const m = read();
  let changed = false;
  for (const k of blobKeys) {
    if (k in m) {
      delete m[k];
      changed = true;
    }
  }
  if (changed) write(m);
}
