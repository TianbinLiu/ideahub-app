// 打开站外网页（官网的文档页 / 启梦老师）的**唯一实现**（2026-09-29 收口）：
//   原生走 Browser.open（Chrome 自定义标签页 —— WebView 里 window.open 表现是"点了没反应"，与 utils/oauth 同一个理由）；
//   网页里 window.open，被拦截时它回 null 而**不抛错**，这才是网页下真正的失败形状，所以在这里统一成 throw，
//   调用点只管 catch 之后把地址原样写给用户看（设置页 ExtDocRow、创作中心第四扇门都走这里，别再各抄一遍那个 if）。
import { Browser } from "@capacitor/browser";
import { isNative } from "../data/appUpdate";

export async function openExternal(url: string): Promise<void> {
  if (isNative()) {
    await Browser.open({ url });
    return;
  }
  if (!window.open(url, "_blank", "noopener")) throw new Error("popup blocked");
}

/**
 * 系统浏览器那一页被关掉时叫一声（原生 Browser 的 browserFinished）；回「拆掉监听」的函数。网页里没有这回事，回空操作，
 * 调用方照旧靠可见性与轮询。
 * ★ 住在这里而不是各页自己 import("@capacitor/browser")（import 方向规则④，2026-10-15）：页面 / 组件不直接碰原生插件，
 *   原生能力都从 utils / data 借 —— 插件换版本、web 垫片行为不同（见上面 window.open 那段）只改一处。
 */
export async function onBrowserFinished(cb: () => void): Promise<() => void> {
  if (!isNative()) return () => {};
  const h = await Browser.addListener("browserFinished", cb);
  return () => void h.remove();
}
