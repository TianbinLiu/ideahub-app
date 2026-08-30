// 「出片技能」的广场（远端共享）—— **单独成模块**，不与 data/agentSkills 合并。
//
// ★★ 为什么要拆（与 data/schemeMarket.ts 逐字同因）：本模块要问 `videos.remoteOn()`，
//   而 videos 的依赖链最终会摸到 data 层叶子。agentSkills 再去 import videos 就成了环，
//   Vite 下会拿到**半初始化的模块**。所以 agentSkills 保持叶子，联网这半边放这里。
// ★ 「这次会话在不在远端上」**只问 videos.remoteOn() 一处**（弹幕那条铁律同款开关）。
// ★ 失败**不静默**：写进 marketErr 并 emit，界面照实说（铁律八）。全 app 没人监听
//   emitApiError，所以指望它报错等于没报。
// ★ 订阅源仍然只有 agentSkills 那一个（这里改完调 emitSkills）——界面不必订阅两处。
import { remoteOn } from "./videos";
import { fetchSharedSkills, installSkill, publishSkill, pushSkill } from "../api/skills";
import { emitSkills, mineSkills, patchMine, upsertMine, type AgentSkill } from "./agentSkills";

let shared: AgentSkill[] = [];
let marketErr = "";
let marketBusy = false;

/** 广场缓存（只读）。空 = 还没拉过、或拉失败（看 skillMarketErr） */
export function sharedSkills(): AgentSkill[] {
  return shared;
}

export function skillMarketErr(): string {
  return marketErr;
}

export function skillMarketBusy(): boolean {
  return marketBusy;
}

/** 现在能不能用市场（没连服务端就整个不显示，而不是摆一排点不动的按钮） */
export function skillMarketOn(): boolean {
  return remoteOn();
}

/** 拉一次广场。返回是否成功；失败原因在 skillMarketErr() */
export async function refreshSharedSkills(): Promise<boolean> {
  if (!remoteOn()) {
    marketErr = "还没连上服务器，技能市场用不了（本机自建的技能照常能用）";
    emitSkills();
    return false;
  }
  marketBusy = true;
  marketErr = "";
  emitSkills();
  try {
    shared = await fetchSharedSkills();
    return true;
  } catch (e) {
    marketErr = `技能市场没打开：${e instanceof Error ? e.message : String(e)}`;
    return false;
  } finally {
    marketBusy = false;
    emitSkills();
  }
}

/**
 * 把自己的一条技能推到服务端并发布/下架。
 * ★ 先 push 再 publish：服务端的 publish 只翻一个开关，技能本体得先在那边存在。
 */
export async function shareSkill(id: string, on: boolean): Promise<boolean> {
  const s = mineSkills().find((x) => x.id === id);
  if (!s) {
    marketErr = "只能发布自己库里的技能";
    emitSkills();
    return false;
  }
  if (!remoteOn()) {
    marketErr = "还没连上服务器，发布不了";
    emitSkills();
    return false;
  }
  marketBusy = true;
  marketErr = "";
  emitSkills();
  try {
    if (on) await pushSkill(s);
    const back = await publishSkill(id, on);
    // 回写 published：界面那颗按钮认它（别拿"点过了"当状态，刷新就丢）
    patchMine(id, { published: back.published });
    return true;
  } catch (e) {
    marketErr = `${on ? "发布" : "下架"}没成：${e instanceof Error ? e.message : String(e)}`;
    return false;
  } finally {
    marketBusy = false;
    emitSkills();
  }
}

/**
 * 装一条广场上的技能到本机库。
 * ★ 服务端那头是幂等的（装过就把你自己那份回来、**不覆盖**你改过的内容），
 *   这里照它的回包落地，不自己再判一次"装过没有"。
 */
export async function installSharedSkill(id: string): Promise<AgentSkill | null> {
  if (!remoteOn()) {
    marketErr = "还没连上服务器，装不了";
    emitSkills();
    return null;
  }
  marketBusy = true;
  marketErr = "";
  emitSkills();
  try {
    const { skill } = await installSkill(id);
    upsertMine(skill);
    return skill;
  } catch (e) {
    marketErr = `装这条技能没成：${e instanceof Error ? e.message : String(e)}`;
    return null;
  } finally {
    marketBusy = false;
    emitSkills();
  }
}
