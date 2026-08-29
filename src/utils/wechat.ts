// 微信登录 + 微信好友分享的 Web 侧入口。原生实现在 WeChatPlugin.java。
//
// 与 QQ（utils/qqLogin.ts）同构：只在原生壳里可用；登录只拿一次性 code，
// 身份由服务端换（POST /api/auth/oauth/wechat/native）。
//
// ★ 微信的回执不走 onActivityResult，走固定路径的 wxapi/WXEntryActivity ——
//   但对 JS 侧无感：登录照样是"await 这一下就拿到 code 或被 reject"。
// ★ 分享是**发出即成功**：新版微信取消分享不回执（原生注释里有完整理由），
//   所以 resolve 只代表"微信已拉起"，不代表用户真的发了。
import { registerPlugin, Capacitor } from "@capacitor/core";
import { wechatNativeLogin } from "../api/auth";

interface WeChatPluginApi {
  isAvailable(): Promise<{ available: boolean; wechatInstalled: boolean }>;
  login(): Promise<{ code: string }>;
  share(opts: { title: string; targetUrl: string; summary?: string; imageUrl?: string }): Promise<void>;
}

const WeChat = registerPlugin<WeChatPluginApi>("WeChat");

/** 这台设备能不能用微信登录/分享。只认原生壳（与 qqLoginSupported 同一条理由） */
export function wechatSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/** 走完整条微信登录，成功返回本站 token；取消/失败/没装微信都抛（铁律八） */
export async function signInWithWeChat(): Promise<string> {
  const { code } = await WeChat.login();
  const { token } = await wechatNativeLogin(code);
  return token;
}

/** 把作品预览链接分享到微信好友（网页卡片）。resolve = 微信已拉起 */
export async function shareVideoToWeChat(opts: { title: string; targetUrl: string; summary?: string; imageUrl?: string }): Promise<void> {
  await WeChat.share(opts);
}
