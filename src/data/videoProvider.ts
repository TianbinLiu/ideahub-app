// 同一颗档位芯片上两家都给得出时（境内：Seedance 与 MiniMax H3），这个人选的是哪一家 —— 出片地区 P2b 的选择器（2026-10-26 主人第 1 件）。
//
// ★ 只是**偏好**，不是门禁：能不能用一律照旧问 account.tierOffered / tierBlockReason；这里只回答「两家都摆得出来时，芯片代表哪一家」。
//   读它的只有 account.tierListed（档位那一排、选法屏、铸段窗、货架筛选摆哪几颗）与 account.defaultTierId（新段落在哪一家）。
// ★ 默认 Seedance（主人 10-26：境内默认 Seedance）；选过就记住 —— **按账号、只在本机**（localStorage，按 deviceOwner 分开；
//   换账号不串、没登录时不记）。不上服务端：这是界面上的一个默认值，不是账号设置（服务端结算认的是请求里的模型，不看它）。
// ★ 境内第一次选 MiniMax 要先点头（MiniMax 的服务器在境外，照片和提示词会交给它处理）：同意记在同一条记录上（minimaxOk），不同意就留在 Seedance。
//   海外（地区只给 MiniMax）没有两家可选，这一问根本不出现（选择器不摆）。
// ★ 零运行时依赖之外只认 deviceOwner（判「这是谁的偏好」），account 认它、它不认 account（避免循环 import）。
import type { VideoProvider } from "./videoZoneRules";
import { deviceOwner } from "./deviceOwner";

const KEY = "ideahub-app.videoProvider.v1";

interface Pref {
  provider: VideoProvider;
  /** 境内第一次选 MiniMax 时点过「同意」（照片和提示词交给境外服务器处理） */
  minimaxOk?: boolean;
}

let version = 0;
const listeners = new Set<() => void>();

function readAll(): Record<string, Pref> {
  try {
    const raw = localStorage.getItem(KEY);
    const j = raw ? (JSON.parse(raw) as unknown) : null;
    return j && typeof j === "object" ? (j as Record<string, Pref>) : {};
  } catch {
    return {};
  }
}

function mine(): Pref | null {
  const owner = deviceOwner();
  if (!owner) return null;
  const p = readAll()[owner];
  // tier-semantics-ok: 这个文件存的就是「选哪一家」的偏好，问的正是供应商本身
  return p && (p.provider === "ark" || p.provider === "minimax") ? p : null;
}

function write(patch: Partial<Pref>): boolean {
  const owner = deviceOwner();
  // 没登录不记：记在空主人名下的偏好会被下一个登录的人继承
  if (!owner) return false;
  const all = readAll();
  all[owner] = { ...(all[owner] ?? { provider: "ark" }), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // 存不下（隐私模式 / 配额）：这一次会话里照样按内存里的版本走不了 —— 偏好本来就是可有可无的默认值，不值得为它报错
    return false;
  }
  version += 1;
  for (const fn of listeners) fn();
  return true;
}

/** 两家都摆得出来时芯片代表哪一家（没选过 = Seedance） */
export function providerPref(): VideoProvider {
  return mine()?.provider ?? "ark";
}

/** 境内选 MiniMax 之前点过同意没有 */
export function minimaxConsented(): boolean {
  return !!mine()?.minimaxOk;
}

/**
 * 记下这个人选的那一家。选 MiniMax 时 consent 必须为真（境内的确认卡点了同意 / 海外不用问 —— 调用方判）；
 * 返回 false = 没记下（没登录 / 存不下），调用方照样换档，只是下次不记得。
 */
export function setProviderPref(provider: VideoProvider, o: { consent: boolean }): boolean {
  // tier-semantics-ok: 这个文件存的就是「选哪一家」的偏好，问的正是供应商本身
  if (provider === "minimax" && !o.consent && !minimaxConsented()) return false;
  // tier-semantics-ok: 这个文件存的就是「选哪一家」的偏好，问的正是供应商本身
  return write(provider === "minimax" ? { provider, minimaxOk: true } : { provider });
}

export function subscribeProviderPref(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function providerPrefVersion(): number {
  return version;
}
