// 「返回」键的唯一实现：有上一页就回退，没有就去父页。
//
// ★★ 为什么不能直接 `navigate(-1)`（2026-09-05 收口，此前个人页与通知页各手写了一份）：
//   ① 分享出去的链接 / 深链冷启动时 history 里没有上一页，`navigate(-1)` 在 Capacitor 的
//      WebView 里就是退出到白屏；
//   ② 模板详情页删掉模板后 `nav("/templates")` 是**往栈上推**一页，被删的那页还压在下面 ——
//      在市场页按返回，回到的是刚删掉的模板（主人真机：「有时返回到上一访问的模板页」）。
//      那一处改成 replace 才治本，这个 hook 只管"没有上一页时别退出 App"。
// ★ react-router 把自己的历史下标存在 history.state.idx（0 = 这一页是本次会话的第一页）。
import { useNavigate } from "react-router";

export function useBackOr(fallback: string): () => void {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}
