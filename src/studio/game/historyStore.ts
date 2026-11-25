/**
 * 战绩 / 回放宽屏的界面状态（2026-11-24；服务端 `GET /api/game/rooms/:code/rounds/history`）。
 *
 * ★★ 这一层只做三件事：**判该不该发**（`historyPlanOf`）/ **发一次**（`readHistory`）/ **把失败原因
 *   原样留着**（`HistoryFailure`）。名次、点赞、票数、summary 一个都不在这里算 —— 那是
 *   `studio/game/history.ts` 的纯函数从回包里读出来的（界面只渲染）。
 * ★ 为什么不塞进 roundsStore：那一层是"这一局还在打"的轮询状态（session / room / snapshot 跟着
 *   房间活）；战绩屏是**一局打完之后**的只读快照，生命周期与它无关（大厅里也能开，那时没有任何
 *   回合会话）。混在一起会让 roundsStore 多出一份"结束时要记得清"的数据。
 * ★ 定时器一个都没有：只在打开 / 手动重试时拉一发；失败可重试一次（`historyRetryAllowed`）。
 *   页面自己拉，断线/切后台回来不会自己刷（也不该 —— 局已经打完了，这份历史不会变）。
 * ★ 能力位为假 / 本机单机局：**一个请求都不发**（`plan.request === false`），直接进退路；
 *   503 `GAME_HISTORY_OFF` 走同一种退路（分类在 historyFailureOf）。
 *
 * ★★ 两种来源、一套渲染（2026-11-24 晚，任务第二件）：本机单机局没有房号，但它的每回合战绩
 *   由 `studio/game/localHistory` 落盘了 —— 形状就是联机那一份 `RemoteGameHistory`，
 *   所以这里只多一位 `source`（"remote" | "local"），界面（`ui/MatchHistory`）一套组件画到底。
 *   · 本机局（没有房号）→ 读本机记录，不发请求；
 *   · 联机历史读不到（过期 / 没连上 / 这台服务器没这功能）→ 本机有记录就先摆本机那一局
 *     （`fallback`，界面顶部会写明"这是本机最近一局"），绝不给一屏空白；
 *   · 本机记录该有却没有（写失败 / 存储坏了）→ `block:"local-missing"`，如实说"没存下来"。
 * ★★ 2026-11-24 Bug B：联机那一局的历史**也落在本机**（`historyCache`，同一间房只留一条）。
 *   · 读到就存：`load` 成功那一拍顺手 `cacheHistoryLocally`（开着战绩屏看的时候，服务端那份就在手里）；
 *   · 403 `NOT_IN_ROOM`（退出 / 打完回大厅之后再点回放）→ **先按房号查本机那一份**（`showCached`），
 *     它才是玩家点的那一局；找不到才如实说"你不在这一局里了"（别拿最近一局顶替，见 historyCacheFirstOf 的 ★）；
 *   · 大厅那边同样优先开本机那一份（房号来自 `historyLastRoom`，`savedAt` 比开局时刻新）。
 * ★ 为什么这一层要知道 `useGame` 的 `localHistory`：只有它知道"这一局刚刚打完、而且没存下来"。
 *   光看存储的话，写失败之后躺在那儿的还是**上一局**，会把它当成这一局摆出来（零报错、玩家不知道）。
 *   依赖是单向的（store 不认识 historyStore），与 MatchHistory 同时认识两边是同一层次。
 */
import { create } from "zustand";
import { readHistory, type RemoteGameHistory } from "../../api/game/rounds";
import { serverGameHistory } from "../../data/serverCaps";
import { historyCacheFirstOf, historyFailureOf, historyIsLocalGame, historyPlanOf, historyRetryAllowed, type HistoryFailure } from "./history";
import { cacheHistoryLocally } from "./historyCache";
import { saveLastHistoryRoom } from "./historyLastRoom";
import { localPickOf, readLatestLocalGame, readLocalGameOfRoom } from "./localHistory";
import { localGameOwner } from "./localHistoryOwner";
import { useGame } from "./store";

/**
 * 退路的三类来由：
 * - `local`：本机局、但本机存储里一局都没有（升级前打的老局 / 存储被清）；
 * - `local-missing`：这一局该有记录却没有（写失败 / 读到坏数据）—— 如实说"没存下来"；
 * - `off`：这台服务器没有回放（能力位为假 / 503），联机那份也读不到。
 */
export type HistoryBlock = "local" | "local-missing" | "off";

/** 这一屏现在画的是谁的战绩（顶部那块标由它决定；null = 还没读到） */
export type HistorySource = "remote" | "local";

export type HistoryStatus = "idle" | "loading" | "ready" | "blocked" | "failed";

export interface HistoryStore {
  /** 这一屏开着没有（StudioPage 那一层据此挂不挂浮层） */
  open: boolean;
  /** 正在读 / 刚读过的那间房（本机局 = null） */
  code: string | null;
  /** 我是谁（summary 高亮 / "你第 x 名"要用；本机记录用它自己那份 `meId`） */
  myUserId: string | null;
  status: HistoryStatus;
  history: RemoteGameHistory | null;
  /** 画的是联机那间房的，还是本机最近一局 */
  source: HistorySource | null;
  /**
   * 打开时想读的是**联机**那一局，但读不到 —— 现在摆的是本机存下来的。
   * 界面据此在顶部写明（不写的话，玩家会以为这就是点的那一局）。
   */
  fallback: boolean;
  /**
   * 本机这份是**哪来的**（`fallback` 为真时才有意义；一句话的区别，别混成一句）：
   * · `cached` = 就是点的那间房的缓存（403 时按房号找到的）——「这是本机留的那一份」；
   * · `latest` = 本机最近一局（可能是别的局）——「这是本机最近一局回放」。
   * ★ 2026-11-24 Bug B：403 说的是"你不在房里了"，不是"这局不存在"；两者给玩家的话不一样。
   */
  fallbackKind: "cached" | "latest" | null;
  block: HistoryBlock | null;
  failure: HistoryFailure | null;
  /** **已经发出去的次数**（首次 = 1；失败后只有 1 次时还允许重试一次） */
  attempts: number;

  /**
   * 打开这一屏并读一次（唯一入口）。
   * `code` 为 null = 本机单机局（不发请求，读本机记录）。
   * ★ 能力位在这里判，而不是在界面里：能力位为假时连 `readHistory` 都不许被调用
   *   （构建门禁 `check-game-history.mjs` 钉住这一条）。
   */
  openFor: (opts: {
    code: string | null;
    myUserId?: string | null;
    /**
     * 这一次要的是"**最近一局**"（大厅的入口）而不是"刚打完的这一局"（结束屏的本机局）。
     * ★ Bug B：最新一条可能是**联机局的缓存**（有房号）—— 大厅该拿它，但结束屏问的是
     *   "我刚打完的这一局本机局存没存下来"，那种时候拿一份联机缓存顶替就是"看的是别的局"。
     */
    latest?: boolean;
  }) => void;
  /** 失败后重试**一次**（`attempts` 已经是 2 时什么都不做） */
  retry: () => void;
  close: () => void;
}

export const useHistory = create<HistoryStore>((set, get) => {
  /**
   * 请求序号：关掉 / 换一局 / 重试之后，晚到的回包一律作废。
   * ★ 与 roundsStore 的 pushSeq 同一个理由：HTTP 响应可能比"用户已经走开"更晚到，
   *   写回去的是一屏已经不属于它的历史（并且会把新打开那一屏的状态盖掉）。
   */
  let seq = 0;

  /** 本机记录读一次（owner / 存储形状 / 校验都在 localHistory 那一处） */
  const readLocal = () => readLatestLocalGame(localGameOwner());

  /**
   * 摆本机那一局（"这一局"与"最近一局"是同一份读法，靠 `fallback` / `fallbackKind` 区分怎么说）。
   * 返回：
   *   · `shown`   —— 已经摆好了；
   *   · `missing` —— 这一局该有记录却读不出来 / 其实没存下来（判据在 `localHistory.localPickOf`：
   *                  写失败时**绝不**拿存储里上一局顶替），调用方说"没存下来"；
   *   · `none`    —— 这一场会话没打过本机局，存储里也没有（没打过 / 老版本留下的空）。
   * ★ 2026-11-24 Bug B：最新那条可能是**联机局的缓存**（有房号）。`acceptCachedOnline` 为真时
   *   （大厅的「最近一局」/ 联机那一发失败后的退路）就摆它；为假时（结束屏问"我刚打完的这一局"）
   *   仍然走 localPickOf 的严格判据 —— 本机局写失败时不许拿一份联机缓存顶替（那是"看的是别的局"）。
   *   `useGame.localHistory`（"刚打完的那一局本机局存没存下来"）只约束本机单机局。
   */
  const showLocal = (opts: {
    failure?: HistoryFailure;
    fallback?: boolean;
    acceptCachedOnline?: boolean;
  } = {}): "shown" | "missing" | "none" => {
    const outcome = useGame.getState().localHistory;
    const read = readLocal();
    const cachedOnline = opts.acceptCachedOnline === true && read.kind === "ok" && !historyIsLocalGame(read.record.history);
    const pick = cachedOnline ? "show" : localPickOf(outcome, read);
    if (pick === "missing") return "missing";
    if (pick === "none") return "none";
    if (read.kind !== "ok") return "missing"; // localPickOf 已经保证是 ok；留一句给 TS 收窄
    seq += 1;
    set({
      open: true,
      // 本机单机局的房号是空串 → 顶栏不摆码；联机缓存有房号 → 顶栏照样摆出来
      code: read.record.history.room.code.trim() || null,
      // 本机记录的"我"是座位 id（me / ai-1 那套）或服务端账号 id（联机缓存），都问记录里的 meId
      myUserId: read.record.meId,
      status: "ready",
      history: read.record.history,
      source: "local",
      fallback: Boolean(opts.fallback),
      fallbackKind: opts.fallback ? "latest" : null,
      block: null,
      failure: opts.failure ?? null,
      attempts: 0,
    });
    return "shown";
  };

  /**
   * 摆**同房号**的本机缓存（2026-11-24 Bug B）：403 说"你不在这一局里了"时它才是玩家点的那一局。
   * ★ 找不到就 `none`，调用方照实说"看不到"（绝不拿最近一局顶替 —— 见 historyCacheFirstOf 的 ★）。
   */
  const showCached = (code: string, failure: HistoryFailure | null = null): "shown" | "none" => {
    const record = readLocalGameOfRoom(localGameOwner(), code);
    if (!record) return "none";
    seq += 1;
    set({
      open: true,
      code,
      myUserId: record.meId,
      status: "ready",
      history: record.history,
      source: "local",
      // 顶部要写明"这是本机留的那一份"：屋里那间房的服务端回放已经读不到了
      fallback: true,
      fallbackKind: "cached",
      block: null,
      failure,
      attempts: 0,
    });
    return "shown";
  };

  const load = async (code: string, myUserId: string | null, attempts: number, token: number): Promise<void> => {
    set({
      open: true,
      code,
      myUserId,
      status: "loading",
      history: null,
      source: null,
      fallback: false,
      fallbackKind: null,
      block: null,
      failure: null,
      attempts,
    });
    const res = await readHistory(code);
    if (seq !== token) return;
    if (!res.ok) {
      const failure = historyFailureOf(res);
      // ① 403 NOT_IN_ROOM：读接口要成员身份 —— 退出 / 打完回大厅之后必然撞上它。
      //    "你不在这一局里了"不等于这局不存在：先按房号找本机在离开前留的那一份。
      if (historyCacheFirstOf(failure) && showCached(code, failure) === "shown") return;
      // ② 联机那一局读不到：本机有（别的）记录就先摆本机最近一局（顶部标「本机对局」+ 一句说明）
      if (showLocal({ failure, fallback: true, acceptCachedOnline: true }) === "shown") return;
      set({ status: "failed", failure });
      return;
    }
    set({ status: "ready", history: res.value, failure: null, source: "remote", fallback: false, fallbackKind: null });
    // 读到就落一份本机（2026-11-24 Bug B）：这是"还能读"的那一拍里最便宜的一个点 ——
    // 退出房间之后再点回放，服务端只会回 403，本机这份就是那时唯一能看的东西。
    if (myUserId) cacheHistoryLocally(res.value, myUserId);
    // 刷新"最近一局"：能读到历史说明这间房还没过期，下一轮大厅入口正好用它
    if (myUserId) saveLastHistoryRoom({ code, userId: myUserId });
  };

  /** 能力位为假 / 本机局：不发请求，摆退路（`block` 决定说哪一句） */
  const blockWith = (block: HistoryBlock, code: string | null, myUserId: string | null): void => {
    seq += 1;
    set({
      open: true,
      code,
      myUserId,
      status: "blocked",
      block,
      history: null,
      source: null,
      fallback: false,
      fallbackKind: null,
      failure: null,
      attempts: 0,
    });
  };

  return {
    open: false,
    code: null,
    myUserId: null,
    status: "idle",
    history: null,
    source: null,
    fallback: false,
    fallbackKind: null,
    block: null,
    failure: null,
    attempts: 0,

    openFor: ({ code, myUserId = null, latest = false }) => {
      const plan = historyPlanOf(code, serverGameHistory());
      if (plan.kind === "local") {
        // 本机单机局：**一个请求都不发**，读本机记录（这一局刚存下来的那一份 / 最近一局）
        // ★ `latest`（大厅入口）才接受"联机局的缓存"当最近一局；结束屏问的是"我刚打完的这一局"。
        const shown = showLocal({ acceptCachedOnline: latest });
        if (shown === "shown") return;
        blockWith(shown === "missing" ? "local-missing" : "local", null, myUserId);
        return;
      }
      if (!plan.request) {
        // 这台服务器没有回放：本机**同房号**的缓存优先（Bug B：那才是玩家点的那一局），
        // 其次本机最近一局（比一屏"没有回放"有用）
        const wanted = code?.trim() || "";
        if (wanted && showCached(wanted) === "shown") return;
        if (showLocal({ fallback: true, acceptCachedOnline: true }) === "shown") return;
        blockWith("off", wanted || null, myUserId);
        return;
      }
      const token = ++seq;
      void load(plan.code, myUserId, 1, token);
    },

    retry: () => {
      const { code, myUserId, status, attempts } = get();
      if (!code || status !== "failed" || !historyRetryAllowed(attempts)) return;
      // 重试前再问一次能力位：探测可能在这几秒里回来了（之前不知道 → 现在明确没有）
      const plan = historyPlanOf(code, serverGameHistory());
      if (!plan.request) {
        if (showCached(code) === "shown") return;
        if (showLocal({ fallback: true, acceptCachedOnline: true }) === "shown") return;
        blockWith("off", code, myUserId);
        return;
      }
      const token = ++seq;
      void load(plan.code, myUserId, attempts + 1, token);
    },

    close: () => {
      seq += 1;
      set({
        open: false,
        code: null,
        myUserId: null,
        status: "idle",
        history: null,
        source: null,
        fallback: false,
        fallbackKind: null,
        block: null,
        failure: null,
        attempts: 0,
      });
    },
  };
});

// DEV 调试挂钩（与 __game / __lobby / __rounds 同款）：自动化脚本可以 setState 摆一份假历史
// 验 800×363 的回放条 / summary / 播放器，不必真连服务端造一局。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__history = useHistory;
}
