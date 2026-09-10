// 界面语言的激活：加载这一种语言的目录 → 激活 → 改 html lang 与页面标题。
//
// ★ 开机（main.tsx 的 boot）与切换语言共用这一处。切换只做「写偏好 → activateLang → 通知」，
//   **不重挂整棵树、不 reload、不 navigate**：那样会杀掉在途的出片 / 合并 / 直传 Promise，而钱已经扣了
//   （多语言方案 §5.4）。重渲靠 App 根组件调 useLingui()。
// ★ 目录是本地 chunk（Vite 按模板字面量拆出 zh / en 两块），不经 Capacitor 桥 —— render 之前绝不 await
//   原生调用，桥一挂住就是白屏（§5.1）。
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Lang } from "./locale";

/** 页面标题。★ 模块顶层只准放 msg 描述符（激活之前不许翻译），渲染 / 激活时再 i18n._ */
const TITLE = msg`启梦 · 有想法，就是梦想启程的第一步`;

export async function activateLang(l: Lang): Promise<void> {
  // ★ 模板字面量动态 import：不需要 *.po 的类型声明（messages 是 any，方案 §3.3 在 scratchpad 里用 tsc 实测过）
  const { messages } = await import(`../locales/${l}.po`);
  i18n.loadAndActivate({ locale: l, messages });
  document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
  document.title = i18n._(TITLE);
}
