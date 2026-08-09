// 工坊的返回入口：顶栏返回按钮走这里，将来接安卓物理返回键也走这里——
// **一个入口**，行为不可能不一致。
//
// 层级：组件本地浮层（backGuards）→ 工坊模式栈（store.goBack）→ 退到底回首页。
//
// 关于安卓物理返回键：现在**没接**。实测 @capacitor/app 没装（package.json 里只有
// android/cli/core），而 Capacitor 8 的原生桥自己也不处理返回键（BridgeActivity 里
// grep onBackPressed / OnBackInvoked / KEYCODE_BACK 全部零命中），所以真机上按返回
// 是直接 finish Activity。要接的话在这里加一个 useAndroidBack(onBack) 调用 CapApp
// .addListener("backButton", ...) 即可——逻辑已经收口在 useStudioBack 里，接不接
// 只差那一个监听。之所以先不接：装插件会连带改 package-lock 与 android/ 下的生成
// 物，是独立一批的事。targetSdk=36 下别去 MainActivity 手写 onBackPressed()，
// 那个回调在 36 上根本不会被调用，只能走 AndroidX 的 OnBackPressedDispatcher。
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
