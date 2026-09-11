// 界面语言：用户显式选择 + 系统检测（「跟随系统」）。零依赖、同步可调 —— 开机时在任何 await 之前就要用它。
//
// ★ 三态偏好（多语言方案 §5.2）：键 `ideahub-app.lang` 只存用户**亲手点选**的 "zh" / "en"，选「跟随系统」就删掉这个键。
//   绝不把检测结果写进去 —— 官网 client 用 i18next 的 detector 自动缓存检测结果，界面就被冻结在第一次访问时的语言。
//   读到认不出的值一律当跟随系统（判否定）。
// ★ D4 a（主人 2026-09-10 拍板）：侧载老用户升级后同样按手机语言走，**没有**「为老用户保留中文」那一层。
// ★ 不走 account.persist()：远端模式下它一个字节都不写。
export type Lang = "zh" | "en";

const KEY = "ideahub-app.lang";

function read(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null; // 隐私模式等场景下访问 localStorage 会抛（studio/quality 那条同理）
  }
}

/** 写入显式选择；null = 跟随系统（删掉这个键 —— 绝不写检测结果）。存不住（隐私模式）也不抛，只是下次开机不记得 */
export function writeExplicitLang(l: Lang | null): void {
  try {
    if (l) localStorage.setItem(KEY, l);
    else localStorage.removeItem(KEY);
  } catch {
    /* 存不住就只在这次会话里生效：activateLang 照样会切 */
  }
}

/** 用户显式选过的语言；null = 跟随系统 */
export function explicitLang(): Lang | null {
  const v = read(KEY);
  return v === "zh" || v === "en" ? v : null;
}

/**
 * 按手机系统语言选界面语言 —— **唯一实现**（方案 §2.2）。
 * ★ 遍历整张 navigator.languages，不只看 [0]：`[ja-JP, zh-CN]` 应判 zh；而且 Android 7+ 会把 APK 资源
 *   最匹配的语言挪到最前，[0] 不一定是用户的首选。
 * ★ 只按**语言**匹配、不按地区：`zh-SG` 是中文、`en-CN` 是英文。繁体（zh-TW / zh-HK / zh-Hant）归简体（D2 a）。
 * ★ 整表没命中兜底英文（D3 a）。WebView 会在列表末尾自动补一个 en-US —— 兜底本来就是 en，遍历碰到它结果相同，无害；
 *   ⚠ 哪天兜底改成 zh，这里必须改成跳过那个自动补的 en-US，否则 `[ja-JP]` 会永远判成英文、兜底走不到。
 */
export function systemLang(): Lang {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of list) {
    const primary = String(tag || "").toLowerCase().split(/[-_]/)[0];
    if (primary === "zh") return "zh";
    if (primary === "en") return "en";
  }
  return "en";
}

/** 这一次开机该用哪种语言 */
export function pickLang(): Lang {
  return explicitLang() ?? systemLang();
}
