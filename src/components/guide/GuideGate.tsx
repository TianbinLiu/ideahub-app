// 引导的**全局挂载点** —— 挂在 App 的 <Routes> 外面，与 OrientationGuard / UpdateGate 并列。
//
// ★ 为什么必须在 Routes 外面：遮罩要能盖住任何一页，而每一页自己的根容器多半是
//   `fixed inset-0`（首页/创作页/剪辑页/工作流页），挂在里面就被那个层叠上下文关住了。
//   （真正把它抬出去的是 GuideOverlay 里的 createPortal，这里只是别让它跟着路由卸载。）
// ★ 它**不决定弹哪一份**：那由每一屏自己 useAutoGuide 声明（页面与浮层同一条路）。
//   这里只做两件事：渲染遮罩，以及换路由时把没走完的引导关掉。
import { useEffect } from "react";
import { useLocation } from "react-router";
import { activeGuide, closeGuide, currentPath } from "../../data/guide";
import GuideOverlay from "./GuideOverlay";

export default function GuideGate() {
  const { pathname } = useLocation();

  // ★★ 换路由就关掉没走完的引导。两个理由，第二个是硬的：
  //   ① 引导讲的是**这一屏**，跟着飘到下一页就是在指着不存在的东西说话；
  //   ② 安卓物理返回键这一批有意没接管（见 GuideOverlay 文件头 ③），所以引导开着时
  //      按返回会**直接换页**。没有这一条的话，用户会落在新页面上、顶着一层锁死整屏
  //      且与新页面无关的遮罩 —— 那就是真的卡死了。
  useEffect(() => {
    // ★★ 判据是「这份引导是在**别的路由**上开的」，不是「这个 effect 跑了」。
    //   第一版写成"effect 一跑就关"，于是任何一次重挂（React 重新挂载这棵子树、
    //   或路由对象换了个引用）都会把刚弹出来的引导当场关掉 —— 2026-08-17 真机上
    //   首页就是这个症状：引导弹出来，点一下「下一步」它整个消失，而不是推进。
    const act = activeGuide();
    if (act && act.path !== currentPath()) closeGuide();
  }, [pathname]);

  return <GuideOverlay />;
}
