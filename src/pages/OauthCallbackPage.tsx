// 第三方登录的 web 回程落点：服务端把 token 拼在 URL 上跳回来（见 oauth.routes 的
// redirectSuccess）。原生端走的是自定义 scheme，由 utils/oauth 的 appUrlOpen 接住，
// 不经过这一页。
//
// ★ 拿到 token 后立刻把它从地址栏抹掉（replace 掉这条历史）：
//   token 是完整的会话凭证，留在 URL 里会进历史记录、进分享链接、进 Referer。
// ★ 与深链同一道闸（utils/oauth.acceptOauthReturn，判定在 data/oauthState，2026-10-15）：这条 URL 谁都能拼出来贴给人点 ——
//   state 对不上 / 本机没发起过 / 过期的一律不收，连 `?error=` 的文字都不上屏；拒了就停在报错态，不跳转、不碰 token。
import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import EmptyState from "../components/EmptyState";
import { useNavigate, useSearchParams } from "react-router";
import { signInWithOauthToken } from "../data/account";
import { acceptOauthReturn } from "../utils/oauth";

export default function OauthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [err, setErr] = useState("");
  const { t } = useLingui();
  // StrictMode 下 effect 会跑两遍，token 只能换一次（第二次必然失败并清掉登录态）；state 也是一次性的，取第二次就成了「没记过」
  const used = useRef(false);

  useEffect(() => {
    if (used.current) return;
    used.current = true;
    const res = acceptOauthReturn({
      token: params.get("token") ?? undefined,
      error: params.get("message") || params.get("error") || undefined,
      state: params.get("state"),
    });
    if (!res.ok) {
      setErr(res.why); // 过期 / 不是本机发起，话由闸那边定（同一句，别在这里再写一份）
      return;
    }
    const r = res.value;
    const next = params.get("next") || "/";
    if (!r.token) {
      setErr(r.error || t`第三方登录未完成`);
      return;
    }
    void signInWithOauthToken(r.token)
      .then(() => navigate(next.startsWith("/") ? next : "/", { replace: true }))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [params, navigate]);

  return err ? (
    <EmptyState full emoji="🚫" error text={err} cta={{ label: t`回登录页`, onClick: () => navigate("/login", { replace: true }) }} />
  ) : (
    <EmptyState full loading text={t`正在完成登录…`} />
  );
}
