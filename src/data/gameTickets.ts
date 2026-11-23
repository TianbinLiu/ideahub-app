/**
 * 工坊游戏券 —— 「这一发能不能用券、还剩几张」的**唯一读取处**（G4 收尾，2026-11-23）。
 *
 * 服务端那一半是 server#155：`GET /api/game/tickets` 读余额（读一次就完成当月懒发），
 * 出片的三条路由认请求头 `X-Game-Ticket: 1`（扣一张券、token 钱包一分不动），失败退券。
 *
 * ★★ 三样输入，一处分派：健康端点的 `gameTickets` 能力位（data/serverCaps）、GET 回包、登录态。
 *   规则（回包怎么读、三态怎么判、`left >= perGeneration`）在零依赖的 data/gameTicketRules，
 *   构建里 `scripts/check-game-tickets.mjs` 拿正反例实跑；这里只管**问、记、广播**。
 * ★★ 没有能力位（老服务端 / dev 直连方舟 / 离线演示包）时：**一个请求都不发、界面一格 🎟 都不摆**，
 *   出片按 token 交付（与改版前逐字节相同）。这与 serverCaps 那几位「不知道 = 放行」的乐观口径**相反**：
 *   券是"扣钱"的币种，猜"有券"的代价是界面写着「用券」、实际扣了 token（钱上的话与事实相反），
 *   而猜"没券"的代价只是少摆一格、多花一次 token（用户看得见报价）。
 * ★ 读到之后**不落盘**：券是按账号、按 UTC 月算的，一份旧缓存在冷启动 / 换号那一刻拿来决定带不带券头，
 *   最好的结果是多一次 403、最坏的是把上个月的余额摆给这个月看。断网时沿用这一场会话上一次的结论（同 videoZone）。
 * ★ 换账号时自动作废（记着是哪个 token 读到的）：account 反过来 import 这里（canAfford 认券），
 *   所以这里**绝不能** import data/account（两个 data 模块互相 import，Vite 下会拿到半初始化的一份）。
 */
import { apiGet, getToken } from "../api/client";
import { noServerLayer, probeServerCaps, serverSupports, subscribeServerCaps } from "./serverCaps";
import {
  canPayWithTicketOf,
  gameTicketModeOf,
  parseGameTickets,
  resetDayOf,
  type GameTicketFacts,
  type GameTicketMode,
} from "./gameTicketRules";

/** 读回来的那一份 + 什么时候读到的（at 只给排查用，不进任何判定） */
export interface GameTickets extends GameTicketFacts {
  at: number;
}

/** 两次「顺手重读」之间至少隔多久（HUD 在 render 里会读到它，不节流就是每画一次发一发） */
const RETRY_MS = 20_000;
/** 一发最多等多久。它挡在「打开生成小窗」之前，等太久不如按 token 走（服务端照样会兜底） */
const TIMEOUT_MS = 8_000;

let known: GameTickets | null = null;
/** `known` 是用哪个登录态读到的：换了人就作废（见文件头最后一条 ★） */
let knownFor: string | null = null;
let inflight: Promise<void> | null = null;
let lastTry = 0;
let watching = false;
const listeners = new Set<() => void>();

export function subscribeGameTickets(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

/**
 * 能力位到位之后自己读一次（老服务端上永远不问）。
 * ★ 只在真的有能力位时才问：`serverSupports` 第一次被调时顺手发起健康探测，探到了会广播到这里。
 */
function watch(): void {
  if (watching) return;
  watching = true;
  if (noServerLayer()) return;
  subscribeServerCaps(() => {
    if (serverSupports("gameTickets") === true) void refreshGameTickets();
  });
}

/**
 * 此刻的券（null = 不知道 / 这台服务器没有）。**同步**，render 里能调；第一次问的时候顺手挂监听、发起读取。
 * ★ 换过账号（token 变了）就当场作废：不拿上一个人的券数决定这一发带不带券头。
 */
export function gameTickets(): GameTickets | null {
  watch();
  if (known && knownFor !== getToken()) {
    known = null;
    knownFor = null;
  }
  if (noServerLayer() || serverSupports("gameTickets") === false) return null;
  if (!known) void refreshGameTickets();
  return known;
}

/** 此刻三态里的哪一种（"ticket" / "empty" / "off" / "unknown"）—— 界面那三句话与出片那一发读的都是它 */
export function gameTicketMode(): GameTicketMode {
  return gameTicketModeOf(serverSupports("gameTickets"), gameTickets());
}

/** 这一发能不能用游戏券（只有"有券"能）—— canAfford 的余额门与 genNode 的请求头读这一处 */
export function canPayWithTicket(): boolean {
  return canPayWithTicketOf(gameTicketMode());
}

/** 下一次刷新的日子（几号）；读不到时回 1（服务端今天恒为 1 号） */
export function gameTicketResetDay(): number {
  return resetDayOf(gameTickets()?.nextResetAt ?? "");
}

/**
 * 读一次余额。
 * @param force true = 跳过节流（这一发刚花掉 / 退回一张券，界面上的数要立刻跟上）
 * ★ 并发的几次共用同一发；没登录不问（这个端点 requireAuth，问了也是 401）；
 *   no-store：这是余额，任何一层缓存住都会让"刚花掉一张"停在旧数上。
 */
export function refreshGameTickets(force = false): Promise<void> {
  if (noServerLayer()) return Promise.resolve();
  if (inflight) return inflight;
  if (!force && Date.now() - lastTry < RETRY_MS) return Promise.resolve();
  const token = getToken();
  if (!token) return Promise.resolve();
  lastTry = Date.now();
  inflight = (async () => {
    try {
      // 先确认这台服务端有这条路（老服务端上 GET 会拿到 SPA 回退的 200 + index.html）
      const caps = await probeServerCaps();
      if (!caps?.gameTickets) return;
      const raw = await apiGet<unknown>("/api/game/tickets", { timeoutMs: TIMEOUT_MS });
      const facts = parseGameTickets(raw);
      if (!facts) return;
      known = { ...facts, at: Date.now() };
      knownFor = getToken();
      emit();
    } catch {
      /* 断网 / 超时 / 服务端没答上来：这一次没读到，沿用这一场会话上一次的结论（文件头 ★） */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
