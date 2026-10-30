// 页签状态写进地址栏 query 的唯一实现（2026-09-05 主人点名：工坊从模板详情返回后页签退回
// 「我的卡片」，因为页签只活在组件 state 里，整页重挂就归零）。
//
// ★ 写地址一律 `replace`：切页签不该在历史栈里堆一层 —— 否则用户按返回是在页签之间倒着走，
//   而不是回到上一页。要的只是"回到这一页时还在这个页签上"，replace 正好。
// ★ 值等于缺省时把参数**删掉**而不是写上：`/workshop` 与 `/workshop?tab=cards` 是同一页，
//   底栏那颗「工坊」按的是不带 query 的地址，写上会让两条地址各占一份历史。
// ★ 只认白名单里的值：地址是用户能手改的，`?tab=whatever` 退回缺省，别渲染一个不存在的页签。
// ★ 写的时候从**地址栏此刻的样子**出发（liveSearchParams），不用 setParams 回调给的 prev（2026-10-20 工坊改版时撞到）：
//   react-router 的函数式写法给的是这个回调所在那一拍渲染时的参数，而导航之后的重渲染是排在 transition 里的 ——
//   两次写地址挨得近（搜索框的防抖计时器刚写完 q、人紧接着点了一个页签），后一次拿的是前一次之前的参数，
//   把前一次写的整个盖回去。表现是「清空搜索后点了卡片，落地却回到模板」或「搜索框空了、地址里还挂着那个词」，零报错。
import { useCallback } from "react";
import { useSearchParams } from "react-router";

/** 地址栏此刻的 query。App 用 HashRouter，query 在 # 后面（main.tsx）。别处要「改一个参数、其余照旧」时也从它出发 */
export function liveSearchParams(): URLSearchParams {
  const h = window.location.hash;
  const i = h.indexOf("?");
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : "");
}

export function useQueryTab<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key) ?? "";
  const value = (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback(
    (t: T) => {
      const next = liveSearchParams();
      if (t === fallback) next.delete(key);
      else next.set(key, t);
      setParams(next, { replace: true });
    },
    [setParams, key, fallback],
  );
  return [value, set];
}
