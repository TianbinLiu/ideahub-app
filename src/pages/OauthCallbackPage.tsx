// 第三方登录的 web 回程落点：服务端把 token 拼在 URL 上跳回来（见 oauth.routes 的
// redirectSuccess）。原生端走的是自定义 scheme，由 utils/oauth 的 appUrlOpen 接住，
// 不经过这一页。
//
// ★ 拿到 token 后立刻把它从地址栏抹掉（replace 掉这条历史）：
//   token 是完整的会话凭证，留在 URL 里会进历史记录、进分享链接、进 Referer。
import { useEffect, useRef, useState } from "react";
import EmptyState from "../components/EmptyState";
import { useNavigate, useSearchParams } from "react-router";
import { signInWithOauthToken } from "../data/account";

export default function OauthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [err, setErr] = useState("");
  // StrictMode 下 effect 会跑两遍，token 只能换一次（第二次必然失败并清掉登录态）
  const used = useRef(false);

  useEffect(() => {
    if (used.current) return;
    used.current = true;
    const token = params.get("token");
    const next = params.get("next") || "/";
    const error = params.get("message") || params.get("error");
    if (!token) {
      setErr(error || "第三方登录未完成");
      return;
    }
    void signInWithOauthToken(token)
      .then(() => navigate(next.startsWith("/") ? next : "/", { replace: true }))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [params, navigate]);

  return err ? (
    <EmptyState full emoji="🚫" error text={err} cta={{ label: "回登录页", onClick: () => navigate("/login", { replace: true }) }} />
  ) : (
    <EmptyState full loading text="正在完成登录…" />
  );
}
