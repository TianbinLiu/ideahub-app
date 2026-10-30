// 分区页的搜索历史（2026-10-21，docs/ui-benchmark-2026-10.md 第三节：B 站 / 抖音 / 快手点进搜索框、还没开始搜时
// 统一是「搜索历史 + 猜你想搜 / 热榜」）。
//
// ★ 按「现在给谁看」分开存（data/deviceOwner，2026-09-18 串号那次定的规矩）：同一台手机上 A 搜过什么，B 登录之后不该看见。
//   没登录时记在 "guest" 名下 —— 逛分区不用登录，没登录的人也有历史；登录之后看的是自己那一份，guest 那份不并过去
//   （并过去等于把「刚才在这台手机上没登录的那个人」搜过的词塞给登进来的账号）。
// ★ 只存在这台设备上（localStorage），不上传：搜索词是隐私，服务端也不需要它。
// ★ 读写一律 try：隐私模式 / 配额满时 localStorage 会抛，搜索历史不值得让分区页崩掉。
// ★ 「会话还在确认中」（authState 的 pending：手里有 token、人还没认领上）时**谁的都不读、谁的都不写**：
//   deviceOwner() 那时也回 ""，原来一律当 guest —— 登录着的人会看到 guest 那份（别人没登录时搜的词），
//   搜的词还写进 guest 那份、自己那份反而没有（2026-10-21 评审抓到）。guest 只给确定没登录（"out"）的人。
import { authState } from "./account";
import { deviceOwner } from "./deviceOwner";

const KEY = "ideahub-app.searchHistory.v1";
/** 最多记几条（抖音默认两行、可展开；我们只摆一排芯片，十条够了） */
export const SEARCH_HISTORY_MAX = 10;
/** 单条最长：再长的不是「搜索词」，是贴进来的一段话，记下来只会把那一排撑坏 */
const TERM_MAX = 30;

type Store = Record<string, string[]>;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Store) : {};
  } catch {
    return {};
  }
}

function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 配额满 / 隐私模式：历史记不上就记不上 */
  }
}

/** 这一刻在看的是谁的那一份；"" = 还说不准（会话确认中），读写都跳过 */
function who(): string {
  const id = deviceOwner();
  if (id) return id;
  return authState() === "out" ? "guest" : "";
}

/** 现在这个人的搜索历史，新的在前 */
export function searchHistory(): string[] {
  const me = who();
  if (!me) return [];
  const list = load()[me];
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

/** 记一条（去重、挪到最前、截到上限） */
export function rememberSearch(term: string): void {
  const q = term.trim().slice(0, TERM_MAX);
  const me = who();
  if (!q || !me) return;
  const s = load();
  const prev = Array.isArray(s[me]) ? s[me] : [];
  s[me] = [q, ...prev.filter((x) => x !== q)].slice(0, SEARCH_HISTORY_MAX);
  save(s);
}

/** 清空现在这个人的历史（只动自己那一份） */
export function clearSearchHistory(): void {
  const me = who();
  if (!me) return;
  const s = load();
  delete s[me];
  save(s);
}
