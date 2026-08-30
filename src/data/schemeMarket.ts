// 「提示词方案」的广场（远端共享）—— **单独成模块**，不与 data/promptSchemes 合并。
//
// ★★ 为什么要拆：本模块要问 `videos.remoteOn()`，而 videos → account → mock/ai →
//   promptSchemes。promptSchemes 再去 import videos 就成了环，Vite 下会拿到**半初始化的
//   模块**（实测报 "Cannot access 'listeners' before initialization"）——CLAUDE.md 那条
//   「两个 store 互相 import」是同一件事。所以 promptSchemes 保持叶子，联网这半边放这里。
// ★ 「这次会话在不在远端上」**只问 videos.remoteOn() 一处**（弹幕那条铁律同款开关）：
//   在这里另探一次的话，弱网冷启动会出现"卡片退了本地库、方案还在打远端"的半边天。
// ★ 失败**不静默**：写进 marketErr 并 emit，界面照实说（铁律八）。全 app 没人监听
//   emitApiError，所以指望它报错等于没报。
// ★ 订阅源仍然只有 promptSchemes 那一个（这里改完调 emitSchemes）——界面不必订阅两处。
import { remoteOn } from "./videos";
import { fetchSharedSchemes, installScheme, publishScheme, pushScheme } from "../api/schemes";
import { emitSchemes, mineSchemes, patchMine, upsertMine, type PromptScheme } from "./promptSchemes";

// ── 广场（远端共享）────────────────────────────────────────────────
//
// ★ 形状照 data/templates.ts 的 mine/shared：`mine`（在 promptSchemes 里）是本机那份、
//   离线也能用；`shared` 是广场缓存（只读，装了之后才进 mine）。

let shared: PromptScheme[] = [];
let marketErr = "";
let marketBusy = false;

/** 广场缓存（只读）。空 = 还没拉过、或拉失败（看 schemeMarketErr） */
export function sharedSchemes(): PromptScheme[] {
  return shared;
}

export function schemeMarketErr(): string {
  return marketErr;
}

export function schemeMarketBusy(): boolean {
  return marketBusy;
}

/** 现在能不能用市场（没连服务端就整个不显示，而不是摆一排点不动的按钮） */
export function schemeMarketOn(): boolean {
  return remoteOn();
}

/** 拉一次广场。返回是否成功；失败原因在 schemeMarketErr() */
export async function refreshSharedSchemes(): Promise<boolean> {
  if (!remoteOn()) {
    marketErr = "还没连上服务器，方案市场用不了（本机自建的方案照常能用）";
    emitSchemes();
    return false;
  }
  marketBusy = true;
  marketErr = "";
  emitSchemes();
  try {
    shared = await fetchSharedSchemes();
    return true;
  } catch (e) {
    marketErr = `方案市场没打开：${e instanceof Error ? e.message : String(e)}`;
    return false;
  } finally {
    marketBusy = false;
    emitSchemes();
  }
}

/**
 * 把自己的一套方案推到服务端并发布/下架。
 * ★ 先 push 再 publish：服务端的 publish 只翻一个开关，方案本体得先在那边存在。
 * ★ 内置的不许发（它不是用户的东西）——判据与 exampleIssue 同一个理由。
 */
export async function shareScheme(id: string, on: boolean): Promise<boolean> {
  const s = mineSchemes().find((x) => x.id === id);
  if (!s) {
    marketErr = "只能发布自己自建的方案（内置那几套本来就人人都有）";
    emitSchemes();
    return false;
  }
  if (!remoteOn()) {
    marketErr = "还没连上服务器，发布不了";
    emitSchemes();
    return false;
  }
  marketBusy = true;
  marketErr = "";
  emitSchemes();
  try {
    if (on) await pushScheme(s);
    const back = await publishScheme(id, on);
    // 回写 published：界面那颗按钮认它（别拿"点过了"当状态，刷新就丢）
    patchMine(id, { published: back.published });
    return true;
  } catch (e) {
    marketErr = `${on ? "发布" : "下架"}没成：${e instanceof Error ? e.message : String(e)}`;
    return false;
  } finally {
    marketBusy = false;
    emitSchemes();
  }
}

/**
 * 装一套广场上的方案到本机库。
 * ★ 服务端那头是幂等的（装过就把你自己那份回来、**不覆盖**你改过的内容），
 *   这里照它的回包落地，不自己再判一次"装过没有"。
 */
export async function installSharedScheme(id: string): Promise<PromptScheme | null> {
  if (!remoteOn()) {
    marketErr = "还没连上服务器，装不了";
    emitSchemes();
    return null;
  }
  marketBusy = true;
  marketErr = "";
  emitSchemes();
  try {
    const { scheme } = await installScheme(id);
    upsertMine(scheme);
    return scheme;
  } catch (e) {
    marketErr = `装这套方案没成：${e instanceof Error ? e.message : String(e)}`;
    return null;
  } finally {
    marketBusy = false;
    emitSchemes();
  }
}
