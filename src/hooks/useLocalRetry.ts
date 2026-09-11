// 本机某一块数据没读出来时的「重试」状态（草稿箱 / 我的模板 / 剪到一半的成片共用，2026-09-11）。
//
// ★ 进这一屏**自动再试一次**：开机那一下多半是瞬时故障（库文件被占着、刚腾出空间、连接被回收），
//   别让人先看一眼错误再去点；自动那一次也没读出来，才把错误和「重试」摆出来。
// ★ reload 必须是"读好了就直接返回、读失败才真的重读"的那种装载（readyDrafts / readyTemplates /
//   readyCutSession 都是）：读好之后再读一遍会拿磁盘上的旧值盖掉内存里还没落盘的写。
import { useCallback, useEffect, useState } from "react";

export function useLocalRetry(issue: string, reload: () => Promise<void>): { retrying: boolean; retry: () => void } {
  const [retrying, setRetrying] = useState(false);
  const retry = useCallback(() => {
    setRetrying(true);
    void reload().finally(() => setRetrying(false));
  }, [reload]);
  // ★ 只在挂载时自动试一次：依赖里放 issue 的话，每失败一次就立刻再触发一次，变成原地打转
  useEffect(() => {
    if (issue) retry();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { retrying, retry };
}
