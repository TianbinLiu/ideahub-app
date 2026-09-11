// 草稿库订阅：与 useAccount 同一套路——库是模块级单例（非 zustand），
// 用 useSyncExternalStore 订阅版本号（列表原地重排，引用不变 React 不会重渲染）。
import { useSyncExternalStore } from "react";
import { draftsLoadIssue, draftsVersion, listDrafts, readyDrafts, subscribeDrafts, type WorkDraftMeta } from "../data/drafts";
import { useLocalRetry } from "./useLocalRetry";

export function useDrafts(): WorkDraftMeta[] {
  useSyncExternalStore(subscribeDrafts, draftsVersion, () => 0);
  return listDrafts();
}

/**
 * 草稿索引读没读出来 + 重试（草稿箱整页与个人页草稿页签共用）。
 * ★ issue 非空时列表恒为空 —— 调用方必须**先判它**再判 `drafts.length === 0`，
 *   否则会对着一次读失败说「还没有草稿」（data/drafts 的 loadIssue ★★）。
 */
export function useDraftsLoad(): { issue: string; retrying: boolean; retry: () => void } {
  useSyncExternalStore(subscribeDrafts, draftsVersion, () => 0);
  const issue = draftsLoadIssue();
  const { retrying, retry } = useLocalRetry(issue, readyDrafts);
  return { issue, retrying, retry };
}
