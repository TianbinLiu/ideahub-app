// 引流位度量（M3；M4 起 App 内有页面了）：设置页 / 创作中心带 ?from=app-* 进 /tutor，落地 POST 一行再把参数抹掉 ——
// 刷新 / 回退不重复记；同一来源一个会话只发一次（sessionStorage），服务端另按天去重、白名单外不记。**只记不奖励**，失败静默。
// ★ 与官网 client/src/pages/tutor/referral.ts 同一条规矩；App 里只有 /tutor 这一个入口页挂它。离线模式不发（没有服务器可记），参数照样抹掉。
import { useEffect } from "react";
import { useLocation, useSearchParams } from "react-router";
import { API_ON } from "../../api/client";
import { postReferral } from "../../api/tutor";

export function useTutorReferral(): void {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const from = params.get("from");
  useEffect(() => {
    if (!from) return;
    if (API_ON) {
      const key = `tutor.referral.${from}`;
      let sent = false;
      try {
        sent = !!sessionStorage.getItem(key);
        if (!sent) sessionStorage.setItem(key, "1");
      } catch {
        /* 隐私模式没有 sessionStorage：那就发一次 */
      }
      if (!sent) void postReferral(from, `${location.pathname}${location.search}`).catch(() => { /* 只记不奖励，失败不打扰 */ });
    }
    const next = new URLSearchParams(params);
    next.delete("from");
    setParams(next, { replace: true });
  }, [from, params, setParams, location.pathname, location.search]);
}
