// 界面语言的切换与订阅 —— 设置页那一行、LangChip 共用这一处（多语言方案 §5.3 / §5.4）。
//
// ★ 切换只做这几件事：写偏好 → activateLang（换目录、html lang、页面标题）→ 通知订阅者。
//   **不重挂整棵树、不 reload、不 navigate**：在途的出片 / 合并 / 签名直传 Promise 都还活着，
//   钱已经扣了的那一发不能被切一次语言打断。界面重渲靠 App 根组件的 useLingui()。
// ★ 目录加载失败时把偏好退回原值再抛：否则会存下「选了英文、界面还是中文」的状态，下次开机才突然变。
import { i18n } from "@lingui/core";
import { activateLang } from "./activate";
import { explicitLang, systemLang, writeExplicitLang, type Lang } from "./locale";

const subs = new Set<() => void>();

export function subscribeLang(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** 当前**生效**的界面语言（以已经激活的目录为准，不是偏好） */
export function activeLang(): Lang {
  return i18n.locale === "en" ? "en" : "zh";
}

/** 选一种界面语言；null = 跟随系统 */
export async function setLangPref(pref: Lang | null): Promise<void> {
  const prev = explicitLang();
  writeExplicitLang(pref);
  try {
    await activateLang(pref ?? systemLang());
  } catch (e) {
    writeExplicitLang(prev);
    throw e;
  } finally {
    for (const fn of subs) fn();
  }
}
