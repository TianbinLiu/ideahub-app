// 页签状态写进地址栏 query 的唯一实现（2026-09-05 主人点名：工坊从模板详情返回后页签退回
// 「我的卡片」，因为页签只活在组件 state 里，整页重挂就归零）。
//
// ★ 写地址一律 `replace`：切页签不该在历史栈里堆一层 —— 否则用户按返回是在页签之间倒着走，
//   而不是回到上一页。要的只是"回到这一页时还在这个页签上"，replace 正好。
// ★ 值等于缺省时把参数**删掉**而不是写上：`/workshop` 与 `/workshop?tab=cards` 是同一页，
//   底栏那颗「工坊」按的是不带 query 的地址，写上会让两条地址各占一份历史。
// ★ 只认白名单里的值：地址是用户能手改的，`?tab=whatever` 退回缺省，别渲染一个不存在的页签。
import { useCallback } from "react";
import { useSearchParams } from "react-router";

export function useQueryTab<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key) ?? "";
  const value = (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback(
    (t: T) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (t === fallback) next.delete(key);
          else next.set(key, t);
          return next;
        },
        { replace: true },
      );
    },
    [setParams, key, fallback],
  );
  return [value, set];
}
