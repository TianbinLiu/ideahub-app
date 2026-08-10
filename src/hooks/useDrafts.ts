// 草稿库订阅：与 useAccount 同一套路——库是模块级单例（非 zustand），
// 用 useSyncExternalStore 订阅版本号（列表原地重排，引用不变 React 不会重渲染）。
import { useSyncExternalStore } from "react";
import { draftsVersion, listDrafts, subscribeDrafts, type WorkDraftMeta } from "../data/drafts";

export function useDrafts(): WorkDraftMeta[] {
  useSyncExternalStore(subscribeDrafts, draftsVersion, () => 0);
  return listDrafts();
}
