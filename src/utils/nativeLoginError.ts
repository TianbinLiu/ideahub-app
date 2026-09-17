// 原生 QQ / 微信登录的失败**按 code 分档说话**（两条链路共用）。
//
// ★★ 为什么不直接把原生抛的字显示出来（2026-09-17 改）：
//   ① 原生那两个插件抛的是**中文硬编码**，英文界面下弹出来的是中文；
//   ② 「SDK 侧回执」与「服务端换 token 失败」两种失败原来**同前缀**（都叫「微信授权失败（…）」），
//      用户截图里分不出是哪一头，没法定位；
//   ③ 最要紧的一档——**手机开了「应用分身 / 双开」**——原来一个字都没有提示：
//      这类手机上点登录会先弹系统的选择框，选了**分身**那一个，微信 / QQ 跑在另一个 Android 用户里，
//      查不到我们这个包的签名，当场回一个失败码（微信 -6 = ERR_BAN，QQ 走 onError），
//      用户看到的只是「授权失败（-6）」，而出路其实很简单：改选本体。
//
// ⚠ 只准按 **code** 分档，绝不许按 message 里的中文关键词判（CLAUDE.md 那条坑：措辞一改、
//   或多语言之后 message 变英文，分流就悄悄全落兜底句）。code 由两个原生插件给，是 ASCII 常量。
import { t } from "@lingui/core/macro";

/** 被分身 / 本体这件事绊住的那几档：微信 -6（ERR_BAN，签名核不上）、-1（通用失败）；QQ 的 onError 一族 */
function looksLikeCloneReject(code: string): boolean {
  return code === "WX_FAIL_-6" || code === "WX_FAIL_-1" || code.startsWith("QQ_ERROR_");
}

/** 「你可能选了分身」那一句。★ 用词按用户在系统里看到的叫法（分身 / 双开），并给一条一定走得通的退路 */
function cloneHint(): string {
  return t`如果刚才弹出过选择框、你选的是分身，请退回来改选本体那一个——分身给不了第三方应用授权。也可以直接用手机号或邮箱登录。`;
}

/**
 * 原生登录失败 → 摆在按钮旁边的那句话。
 * @param who   哪条链路（只用来说清是微信还是 QQ）
 * @param code  原生插件给的 code；拿不到（老包、Web 端）时传空串，退回原样显示 message
 * @param raw   原生抛的原文，只在没有 code 时兜底
 */
export function nativeLoginErrorText(who: "wechat" | "qq", code: string, raw: string): string {
  const app = who === "wechat" ? t`微信` : t`QQ`;
  if (!code) return raw;

  // 用户自己取消 / 拒绝：一句就够，别塞指引
  if (code === "WX_CANCEL" || code === "QQ_CANCEL") return t`已取消${app}登录。`;
  if (code === "WX_DENIED") return t`微信里拒绝了这次授权。想用微信登录的话再点一次，在微信里选「同意」。`;

  // 没装 / 打不开
  if (code === "WX_NOT_INSTALLED") return t`这台手机上没有安装微信。装了微信再试，或者用手机号、邮箱登录。`;
  if (code === "WX_SEND_FAILED" || code === "QQ_START_FAILED")
    return t`没能打开${app}的授权页。确认装的是正式版${app}并且版本不太旧，或者用手机号、邮箱登录。`;

  // 被新的一次顶掉：不该显示（新的那一次接着在跑），保底也说清楚
  if (code === "WX_SUPERSEDED" || code === "QQ_SUPERSEDED") return t`上一次${app}登录被这一次顶替了。`;

  // 等不到回执：分身手机上取消了选择框最容易走到这儿
  if (code === "WX_NO_RESPONSE" || code === "QQ_NO_RESPONSE")
    return t`等了很久也没等到${app}的回音。再点一次试试；${cloneHint()}`;

  if (code === "WX_STATE_MISMATCH") return t`这次微信回执与本次请求对不上，请再点一次。`;
  if (code === "QQ_SDK_INIT_FAILED") return t`QQ 登录没能初始化。请重启 App 再试，或者用手机号、邮箱登录。`;

  // 认不出我们 / 其它失败：带上原生那个码（用户截图里能看出是哪一档），再给分身指引
  const detail = code.replace(/^WX_FAIL_|^QQ_ERROR_/, "");
  if (looksLikeCloneReject(code)) return t`${app}没有接受这次授权（${detail}）。${cloneHint()}`;
  return t`${app}授权失败（${detail}）。再点一次试试，或者用手机号、邮箱登录。`;
}

/** 从 Capacitor 抛出来的错误里取 code（拿不到就是空串：老包 / Web 端 / 不是插件抛的） */
export function nativeErrorCode(e: unknown): string {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : "";
}
