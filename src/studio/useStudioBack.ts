// 工坊的返回入口：顶栏返回按钮走这里，将来接安卓物理返回键也走这里——
// **一个入口**，行为不可能不一致。
//
// 层级：组件本地浮层（backGuards）→ 工坊模式栈（store.goBack）→ 退到底回首页。
//
// 关于安卓物理返回键：**这一层还没接**，但它并不是"没反应"——
// ⚠ 2026-08-14 更正：@capacitor/app **已经装了**（package.json 8.1.1，为第三方登录的
//   appUrlOpen 深链装的）。它的 AppPlugin 在 OnBackPressedDispatcher 上挂了回调：
//   全 app 只要**没有人**监听 "backButton"（现在确实没有，grep src/ 零命中），
//   默认行为就是 `bridge.getWebView().goBack()` —— 也就是 WebView 的历史后退。
//   HashRouter 下每个 navigate(push) 都是一格历史，所以真机上按返回 = 退回上一个路由。
//   （这条老注释原来写着"插件没装、按返回直接 finish Activity"，两句都不对。它不是
//    小事：发布之后落回哪一格，全看这个默认行为——正是 studioStore.publishedWorkId
//    那段 ★★ 记的那个 bug。）
// 要把返回键接进本文件这套栈，加一个 useAndroidBack(onBack) 调用 CapApp
// .addListener("backButton", ...) 即可 —— 逻辑已经收口在 useStudioBack 里，接不接
// 只差那一个监听。⚠ 但那一下会**同时接管全 app 的返回键**（监听一挂，上面那条默认
// goBack 就不再执行），每一页的返回语义都得自己补上，是独立一批的事。
// targetSdk=36 下别去 MainActivity 手写 onBackPressed()，那个回调在 36 上根本不会
// 被调用，只能走 AndroidX 的 OnBackPressedDispatcher（插件走的就是它）。
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { popBackGuard } from "./backGuards";
import { useStudio } from "./studioStore";

export function useStudioBack(): () => boolean {
  const navigate = useNavigate();
  return useCallback(() => {
    if (popBackGuard()) return true; // ⓪ 组件本地浮层
    if (useStudio.getState().goBack()) return true; // ①-⑧ 工坊模式栈
    navigate("/"); // ⑨ 退到底 → 回首页
    return false;
  }, [navigate]);
}
