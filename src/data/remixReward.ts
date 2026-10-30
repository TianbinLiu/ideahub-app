// 同款奖励（模板体系 P3b，2026-10-02）：规则的读取与缓存。HTTP 在 api/recipes.getRemixReward。
//
// 别人照着你的作品做了同款、公开发布满 24 小时还公开着 → **平台**印一笔 token 给你（不是同款作者付的：
// token 不许在用户之间流转）。发不发、发给谁、发多少全在服务端判（server 的 services/remixReward.service），
// App 不参与、也改不了；到账那一刻服务端发一条 BRANCH_REMIX_REWARD 通知（data/notifications）。
//
// ★ App 这一侧**只有一句话要说**（发布页 / 编辑页的 components/recipe/RemixRewardNote）。句子里的每一个数都来自这里的
//   `rule` —— 服务端没给（老服务端 / 离线 / 开关关着 / 没问到 / 数不成形）就**整句不说**：
//   宁可不提，也不拿一个抄来的数去许诺一笔钱（两仓各写各的价目表栽过两次，见 CLAUDE.md「两仓价目表」那格）。
// ★ 依赖方向：data 层，不引任何 store。
import * as api from "../api/recipes";
import { API_ON } from "../api/client";
import { onViewerChange } from "./deviceOwner";

/** 规则。四个数都 > 0 才成立（见 usable） */
export interface RemixRewardRule {
  /** 每次奖励多少 token */
  tokens: number;
  /** 每位原作者 24 小时内最多几次（超出的不顺延） */
  perDay: number;
  /** 每条原作一共最多几次 */
  perVideo: number;
  /** 同款要公开挂满几小时才判 */
  holdHours: number;
}

/** 我自己作为原作者的小结（只在登录着问的时候有） */
export interface RemixRewardMine {
  /** 累计发了几次 */
  count: number;
  /** 累计多少 token */
  tokens: number;
  /** 最近 24 小时用掉了几次上限 */
  last24h: number;
}

export interface RemixRewardState {
  /** null = 不说那句话（没问到 / 不支持 / 关着）。★ 三种不分开说：对用户都是"这里没有奖励可提"，没有一种需要他去做什么 */
  rule: RemixRewardRule | null;
  mine: RemixRewardMine | null;
}

const EMPTY: RemixRewardState = { rule: null, mine: null };
/** 规则几乎不变，小结会变（到账一次多一次）：五分钟内不重问 */
const TTL_MS = 5 * 60_000;

let state: RemixRewardState = EMPTY;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
/** 换人的代数：上一个人的那次回包不许落进这个人的界面（`mine` 是按谁在问算的） */
let viewerGen = 0;
const subs = new Set<() => void>();

function set(next: RemixRewardState): void {
  state = next;
  for (const fn of subs) fn();
}

export function subscribeRemixReward(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** 同步读当前快照（hooks/useRemixReward 用 useSyncExternalStore 订阅） */
export function remixRewardState(): RemixRewardState {
  return state;
}

/** 0 token 的奖励 / 0 次的上限说出来是一句假话：四个数有一个不成形，就当这台服务器没有奖励 */
function usable(r: api.ApiRemixReward["rule"]): boolean {
  return r.enabled && r.tokens > 0 && r.perDay > 0 && r.perVideo > 0 && r.holdHours > 0;
}

/**
 * 问一次规则（与我的小结）。失败**不报错**：这句话说不说不影响任何操作，没问到就维持上一次的（多半是不说）。
 * 离线模式（没配服务器）不发请求。
 */
export function refreshRemixReward(opts?: { fresh?: boolean }): Promise<void> {
  if (!API_ON) return Promise.resolve();
  if (!opts?.fresh && fetchedAt && Date.now() - fetchedAt < TTL_MS) return Promise.resolve();
  if (inflight) return inflight;
  const gen = viewerGen;
  inflight = api
    .getRemixReward()
    .then((res) => {
      if (gen !== viewerGen) return;
      fetchedAt = Date.now();
      if (!res || !usable(res.rule)) {
        set(EMPTY);
        return;
      }
      const { tokens, perDay, perVideo, holdHours } = res.rule;
      set({ rule: { tokens, perDay, perVideo, holdHours }, mine: res.mine });
    })
    .catch(() => {
      /* 没问到：见函数头 */
    })
    .finally(() => {
      if (gen === viewerGen) inflight = null;
    });
  return inflight;
}

// 换了看的人：小结是上一个人的，清掉等着按新的人重问；规则与人无关，留着
onViewerChange(() => {
  viewerGen++;
  inflight = null;
  fetchedAt = 0;
  if (state.mine) set({ rule: state.rule, mine: null });
});
