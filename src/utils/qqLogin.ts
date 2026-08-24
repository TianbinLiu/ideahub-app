// QQ 登录的 Web 侧入口。原生实现在 android/app/src/main/java/.../QQLoginPlugin.java。
//
// ★ 和 utils/oauth.ts 是**两条不同的链路**，别把它们并在一起想：
//     Google / GitHub —— 系统浏览器打开服务端地址 → 服务端 302 深链回 App（异步、可能冷启动）
//     QQ             —— 原生 SDK 拉起 QQ 客户端 → 结果**同步回到这次调用**
//   所以 QQ 这条不需要 onOauthResult 那套"结果先存着等订阅"的机制：await 就拿到了。
//   共用的只有最后一步（拿到本站 token 之后交给 signInWithOauthToken）。
//
// ★ 为什么是 SDK 而不是网页授权：QQ 互联注册的是移动应用，后台没有"回调地址"这一栏。
//   完整推理见 QQLoginPlugin.java 的类注释。
import { registerPlugin, Capacitor } from "@capacitor/core";
import { qqNativeLogin } from "../api/auth";

interface QQLoginPluginApi {
  isAvailable(): Promise<{ available: boolean; qqInstalled: boolean }>;
  /** 授权成功只吐一次性 code —— access_token 与 openid 都在服务端换，端上拿不到也不该拿到 */
  login(): Promise<{ code: string }>;
}

const QQLogin = registerPlugin<QQLoginPluginApi>("QQLogin");

/**
 * 这台设备能不能用 QQ 登录。
 *
 * ★ 只认原生壳：浏览器里没有这个插件，registerPlugin 给的代理调用时会抛
 *   "not implemented"。所以 web 端一律返回 false，UI 上说明"请在 App 内使用"，
 *   而不是给一个点了必然报错的亮按钮。
 */
export function qqLoginSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * 走完整条 QQ 登录，成功时返回本站 token（失败一律抛，调用方负责显示原因）。
 *
 * ★ 用户取消授权也会抛。这是有意的：调用方要能把"取消"和"失败"用同一个出口显示出来，
 *   静默吞掉的话，用户点了按钮却什么都没发生，只会以为是坏了（铁律八）。
 */
export async function signInWithQQ(): Promise<string> {
  const { code } = await QQLogin.login();
  const { token } = await qqNativeLogin(code);
  return token;
}
