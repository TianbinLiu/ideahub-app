// 对局大厅 B 案「自带字体」的**唯一字符清单**（2026-11-28，feat/ui-fonts-hud-fixes）。
//
// ★★ 为什么是显式清单而不是扫源码：这两份字体只服务 B 案那几处（衬线标题 / 厚卡标题 /
//   黄铜主键 / 票根 / 发牌顺序卡 + 烫金手写副标题 / 载入百分比），扫源码会把注释与
//   非衬线文案里的几千个字也收进来 —— 子集一下子从 30KB 涨到几百 KB，正好违背"只收 UI 实际用字"。
//   代价是**改了 B 案的标题 / 按钮文案要回来补这里、再重跑 scripts/gen-lobby-fonts.mjs**
//   （scripts/check-lobby-fonts.mjs 会核对字体清单与这份清单一致，但不核对 JSX 文案 ——
//   漏一个字的表现是那一个字回落到系统衬线/手写栈，不崩、也不空白）。
//
// ★ 中文按「实际会被 .lobby-serif / .lobby-hand 画出来的字」收：
//   · 衬线：对局大厅 / 正在铺桌 / 4 人匹配 / 8 人匹配 / 自定义房间 / 公开房 /
//     AI 补位 / 房主开局 / 选风格 / 锁定 / 凭码加入 / 加入房间 / 取消开局 /
//     落座 · 匹配 N 人 / 开一间房 · 落座 / 正在连接房间服务…
//   · 手写：开一桌？ + 载入页的大号百分比（数字 + %）
// ★ 英数收可打印 ASCII 全集（0x20–0x7E）：英文界面下上面这些元素会整句换成英文，
//   少一个字母就是一处系统字体，不值得为几十个拉丁字形省那几 KB。
// ★ 标点单列：·（间隔号）、…  … ？✓ 都在文案里出现过；# 与 % 已在 ASCII 里。

/** 衬线里出现的中文字（去重后由 gen 脚本再收一次） */
export const SERIF_CJK =
  "对局大厅正在铺桌人匹配自定义房间公开落座一服务凭码加入取消选风格锁定连接主补位";

/** 手写体里出现的中文字：只有烫金副标题「开一桌？」 */
export const HAND_CJK = "开一桌";

/** 文案里出现过、又不在可打印 ASCII 里的标点 */
export const EXTRA_PUNCT = "·…？✓";

/** 可打印 ASCII（空格到 ~）：英数界面下这些元素整句是英文 */
export const ASCII_PRINTABLE = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join("");

export const SERIF_TEXT = SERIF_CJK + EXTRA_PUNCT + ASCII_PRINTABLE;
export const HAND_TEXT = HAND_CJK + "？%" + ASCII_PRINTABLE;

/** 体积上限（验收口径：每份 woff2 ≤120KB，两份合计 ≤300KB） */
export const FONT_LIMITS = { perFile: 120 * 1024, total: 300 * 1024 };

/** 两份字体的元信息（生成脚本与检查脚本共用；改文件名只改这一处） */
export const FONT_SPECS = {
  serif: {
    family: "Noto Serif SC",
    /** index.css 里 @font-face 用的家族名（与系统回退栈区分开） */
    cssFamily: "Lobby Serif SC",
    /** Google Fonts 的 family 查询串（可变字重，一份文件覆盖 400~700） */
    query: "Noto+Serif+SC:wght@400..700",
    file: "lobby-serif-sc.woff2",
    label: "Noto Serif SC（SIL OFL 1.1，可变字重 400~700 子集）",
    text: SERIF_TEXT,
  },
  hand: {
    family: "Ma Shan Zheng",
    cssFamily: "Lobby Hand SC",
    query: "Ma+Shan+Zheng",
    file: "lobby-hand-sc.woff2",
    label: "Ma Shan Zheng 马善政毛笔楷书（SIL OFL 1.1，子集）",
    text: HAND_TEXT,
  },
};

/** 去重后的字符数组（顺序稳定：先中文、再标点、再 ASCII） */
export function uniqueChars(text) {
  return [...new Set([...text])];
}
