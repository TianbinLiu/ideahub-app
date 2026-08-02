// 账号订阅 hook：账号库是模块级单例（非 zustand），用 useSyncExternalStore 订阅变更。
// 快照用版本号而非用户对象——updateProfile 原地改对象，引用不变 React 不会重渲染。
import { useSyncExternalStore } from "react";
import { accountVersion, currentUser, subscribeAccount, type User } from "../data/account";

export function useCurrentUser(): User | null {
  useSyncExternalStore(subscribeAccount, accountVersion, () => 0);
  return currentUser();
}

/** 账号库变更计数：需要在账号数据变化时重算列表的页面订阅它 */
export function useAccountVersion(): number {
  return useSyncExternalStore(subscribeAccount, accountVersion, () => 0);
}
