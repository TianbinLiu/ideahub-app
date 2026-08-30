// 账号订阅 hook：账号库是模块级单例（非 zustand），用 useSyncExternalStore 订阅变更。
// 快照用版本号而非用户对象——updateProfile 原地改对象，引用不变 React 不会重渲染。
import { useSyncExternalStore } from "react";
import { accountVersion, authState, currentUser, subscribeAccount, type AuthState, type User } from "../data/account";

export function useCurrentUser(): User | null {
  useSyncExternalStore(subscribeAccount, accountVersion, () => 0);
  return currentUser();
}

/**
 * 登录态三态（"in" / "out" / "pending"）。**任何登录门禁都读它，不要读 `!user`**。
 *
 * ★★ `useCurrentUser()` 只能回答"现在手里有没有人"，回答不了"是没登录，还是还没水合完"。
 *   拿 `!user` 当"没登录"，冷启动那一小段窗口里登录着的用户会被弹去登录页 ——
 *   在用户看来就是"我被登出了"（2026-08-20 真机报的那个 ➕ 抢跑）。
 *   判据只有一处：data/account 的 authState()（铁律六）。
 */
export function useAuthState(): AuthState {
  useSyncExternalStore(subscribeAccount, accountVersion, () => 0);
  return authState();
}

/** 账号库变更计数：需要在账号数据变化时重算列表的页面订阅它 */
export function useAccountVersion(): number {
  return useSyncExternalStore(subscribeAccount, accountVersion, () => 0);
}
