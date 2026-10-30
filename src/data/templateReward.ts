// 模板作者奖励（2026-10-30，设计正本 docs/template-author-reward-design.md）：规则的读取与缓存。HTTP 在 api/recipes.getTemplateReward。
//
// 别人套用你的模板出了片、公开发布满 24 小时还公开着 → **平台**印一笔 token 给你（不是套用的人付的：
// token 不许在用户之间流转）。发不发、发给谁、发多少全在服务端判（server 的 services/templateReward.service），
// App 只做两件事：发布时把套用过的模板 id 带上（data/projects.pendingTemplateIdsFor → videos.pushPublish），
// 以及说这一句话（components/recipe/TemplateRewardNote）；到账那一刻服务端发一条 BRANCH_TEMPLATE_REWARD 通知（data/notifications）。
//
// ★ 句子里的每一个数都来自这里的 `rule` —— 服务端没给（老服务端 / 离线 / 开关关着 / 没问到 / 数不成形）就**整句不说**：
//   宁可不提，也不拿一个抄来的数去许诺一笔钱（与 data/remixReward 同一条理由、同一副骨架）。
// ★ 没有 `mine`（同款奖励有「你已经拿到过几次」）：契约里规则端点只下发规则；小结等服务端那一半有了再加。
// ★ 依赖方向：data 层，不引任何 store。
import * as api from "../api/recipes";
import { API_ON } from "../api/client";

/** 规则。五个数都 > 0 才成立（见 usable） */
export interface TemplateRewardRule {
  /** 每次奖励多少 token */
  tokens: number;
  /** 每位模板作者 24 小时内最多几次（超出的不顺延） */
  perAuthorPerDay: number;
  /** 每个模板一共最多几次 */
  perTemplate: number;
  /** 每个使用者 24 小时内最多给别人带来几次（防互刷） */
  perUserPerDay: number;
  /** 作品要公开挂满几小时才判（服务端给的是 holdMs，这里换成小时，句子里按小时说） */
  holdHours: number;
}

export interface TemplateRewardState {
  /** null = 不说那句话（没问到 / 不支持 / 关着）。三种不分开说：对用户都是"这里没有奖励可提" */
  rule: TemplateRewardRule | null;
}

const EMPTY: TemplateRewardState = { rule: null };
/** 规则几乎不变：五分钟内不重问 */
const TTL_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;

let state: TemplateRewardState = EMPTY;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();

function set(next: TemplateRewardState): void {
  state = next;
  for (const fn of subs) fn();
}

export function subscribeTemplateReward(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** 同步读当前快照（hooks/useTemplateReward 用 useSyncExternalStore 订阅） */
export function templateRewardState(): TemplateRewardState {
  return state;
}

/** 0 token 的奖励 / 0 次的上限 / 0 小时说出来是一句假话：有一个数不成形，就当这台服务器没有奖励 */
function usable(r: api.ApiTemplateReward["rule"]): boolean {
  return r.enabled && r.tokens > 0 && r.perAuthorPerDay > 0 && r.perTemplate > 0 && r.perUserPerDay > 0 && r.holdMs > 0;
}

/**
 * 问一次规则。失败**不报错**：这句话说不说不影响任何操作，没问到就维持上一次的（多半是不说）。
 * 离线模式（没配服务器）不发请求。
 */
export function refreshTemplateReward(opts?: { fresh?: boolean }): Promise<void> {
  if (!API_ON) return Promise.resolve();
  if (!opts?.fresh && fetchedAt && Date.now() - fetchedAt < TTL_MS) return Promise.resolve();
  if (inflight) return inflight;
  inflight = api
    .getTemplateReward()
    .then((res) => {
      fetchedAt = Date.now();
      if (!res || !usable(res.rule)) {
        set(EMPTY);
        return;
      }
      const { tokens, perAuthorPerDay, perTemplate, perUserPerDay, holdMs } = res.rule;
      // 小时数只在这里换算一次；服务端给的是整数小时的毫秒数（24h），不是整数的照实留小数、别四舍五入成 0
      set({ rule: { tokens, perAuthorPerDay, perTemplate, perUserPerDay, holdHours: holdMs / HOUR_MS } });
    })
    .catch(() => {
      /* 没问到：见函数头 */
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
