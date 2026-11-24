/**
 * 开屏 / 刷新后的**一次**联机局恢复尝试（2026-11-24 轻量重连）。
 *
 * ★★ 为什么挂在 App 根（`<Routes>` 外面）：重连要跑在"还没有任何页面"的时候 ——
 *   页面自己恢复的话，首页那个壳已经画出来了，再突然跳进工坊对局会闪一屏；
 *   而且 App 被杀之后 Capacitor 重新加载的是**首页**（hash 不保留），没有这一层就不会自己回去。
 * ★ 只做三件事，规则一条不在这里：
 *   ① 有记录 + 是当前账号的 → 先把界面带到 /studio（对局层挂在那儿），再调 resumeOnlineGame；
 *   ② 恢复成功 → 什么都不用做（game store 已经有 state，对局层自己挂上来）；
 *   ③ 房间没了 / 连不上 → 打开大厅并说一句（房间没了 =「这一局的房间已经结束」，连不上 = 等下次再试）。
 * ★ 只跑一次（渲染期外的 `done` 闸 + resumeOnlineGame 的模块级 inflight）：不能每帧重渲都试一遍。
 * ★ 记录超过 6 小时不惊动（见 onlineResume.ONLINE_RESUME_MAX_AGE_MS）：房间早过期了，别把人拽回工坊。
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { currentUser } from "../../../data/account";
import { useGame } from "../store";
import { useLobby } from "../lobbyStore";
import { clearOnlineResume, ONLINE_RESUME_MAX_AGE_MS, readOnlineResume } from "../onlineResume";
import { resumeOnlineGame } from "./resumeOnlineGame";

export default function OnlineResumeGate() {
  const navigate = useNavigate();
  const loc = useLocation();
  const [done, setDone] = useState(false);
  const path = loc.pathname;

  useEffect(() => {
    if (done) return;
    setDone(true);
    // 已经在局里（这一次会话里刚开 / 恢复过一次）：不做任何事
    if (useGame.getState().state) return;
    const record = readOnlineResume();
    if (!record) return;
    const me = currentUser();
    if (!me || me.id !== record.myUserId) return; // 没登录 / 另一个账号：记录留着，别动
    if (Date.now() - record.at > ONLINE_RESUME_MAX_AGE_MS) {
      // 太老了：服务端的 playing 房寿命是 2 小时，这一局肯定没了；安静收掉，不把人拽进工坊
      clearOnlineResume();
      return;
    }
    // 先把界面带到有对局层的那一页（/studio 在登录墙后面；没登录会去登录页，登录回来再恢复）
    if (path !== "/studio") navigate("/studio", { replace: true });
    void resumeOnlineGame().then((outcome) => {
      if (outcome === "resumed" || outcome === "none") return;
      // 恢复不了：落回大厅，把原因留在底栏（不是一张空桌面）
      useLobby.getState().openLobby();
      if (outcome === "gone") useLobby.getState().noteResumeGone();
      else useLobby.getState().noteResumeOffline();
    });
  }, [done, path, navigate]);

  return null;
}
