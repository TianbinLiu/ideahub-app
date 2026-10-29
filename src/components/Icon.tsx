// 内联 SVG 图标。不装图标库、不用图标字体、不走 CDN——
// 这个 App 要打包进 Capacitor WebView 离线运行，外链一律不可用。
//
// 为什么不用 emoji：emoji 走系统彩色字体（Android=Noto Color Emoji / iOS=Apple Color Emoji /
// 鸿蒙=HMOS），三套字形完全不同，而且是彩色位图——做不到「随 currentColor 变色」和
// 「描边→实心」这两件事，而它们正是短视频操作栏最基本的两种状态反馈。
//
// 路径取自 Lucide（ISC License, https://lucide.dev）。
import type { CSSProperties } from "react";

export type IconName =
  | "home"
  | "compass"
  | "cards"
  | "card"
  | "grid"
  | "lock"
  | "user"
  | "plus"
  | "heart"
  | "comment"
  | "bookmark"
  | "share"
  | "search"
  | "close"
  | "back"
  | "chevron"
  | "settings"
  | "play"
  | "pause"
  | "replay"
  | "check"
  | "branch"
  | "expand"
  | "shrink"
  | "pen"
  | "send"
  | "bell"
  | "headset"
  // 创作中心（2026-09-07）三枚：上传向导的选文件 / 包里那份 model3.json / 「AI 生成」这一步
  | "upload"
  | "file"
  | "sparkle"
  // 「说不出来」那一档：上传向导的完成度清单里，没有 cdi3 的包既不是 ✓ 也不是 ✗（三态，别压成两档）
  | "info"
  // 详情页「保存到本地」与分享面板第四项共用
  | "download"
  // 模板货架搜索栏旁边那颗「出片模型」筛选
  | "filter"
  // ── 2026-10-21 首页长按菜单 / 做同款（docs/ui-benchmark-2026-10.md 第二、五节）──
  // 「做同款」的启梦招牌字形：两张叠着的塔罗卡、前面那张上一颗四角星（别家没有这个动作，才值得画专属图形；
  // 通用动作 —— 赞 / 评论 / 分享 / 搜索 —— 照旧用 Lucide 原形，调研第五节第 ① 条）
  | "remix"
  // 举报（长按菜单那一行）
  | "flag"
  // 倍速（长按菜单那一行）
  | "gauge"
  // ── 2026-10-21 底栏两枚启梦字形（调研第五节：Tab 栏「图标 + 一个词」保留，图形带一点平台特征，外形仍要认得出）──
  // 工坊：三张扇开的塔罗卡、正中那张一颗四角星（「工坊」不是通用概念，比通用的一叠层更说得清这里是卡片市场）
  | "workshop"
  // 分区：仍是指南针的圆，针换成上下长、左右短的四角星（罗盘玫瑰）—— 外形还是「指南针 = 发现」
  | "discover"
  // ── 2026-10-23 emoji → Icon 收口（docs/ui-refactoring-ui-pass-2026-10-23.md 第四节 ④）：设置页各行、客服页侧键、
  //    创作中心三扇门、剪辑工具条、BranchPlayer 的静音键原来都是 emoji —— 三台手机三个样、不随 currentColor 变色。
  //    路径取自 lucide-static 0.544.0（ISC），名字照 Lucide 原名
  | "id-card"
  | "mic"
  | "palette"
  | "globe"
  | "ban"
  | "hard-drive"
  | "lightbulb"
  | "shirt"
  | "drama"
  | "graduation-cap"
  | "volume"
  | "volume-x"
  | "scissors"
  | "trash"
  // 提示条 components/Warn 的图标（Lucide triangle-alert）
  | "alert"
  // ── 2026-10-24 画布 / 工坊顶栏 / 选法屏的 emoji 收口（2.68 真机验证抓到画布那一面漏了）──
  | "image"
  | "save"
  | "forward"
  | "clapper"
  // 客服页的危机求助卡（Lucide life-buoy，与官网 CompanionSafetyCard 同一个字形）
  | "life-buoy"
  // 「更多操作」（作品详情页顶栏那颗 ⋯，2026-10-26 视频详情页 P0；Lucide ellipsis）
  | "ellipsis";

/** 描边版（默认）。值是 <svg> 的内容，静态字面量，无外部输入。 */
const OUTLINE: Record<IconName, string> = {
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  compass:
    '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
  cards:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  // 单张卡（个人页「卡片」页签）：与上面的 cards（一叠）刻意分开——
  // 两个页签挨在一起用同一个图标，等于没有图标
  card: '<rect width="12" height="20" x="6" y="2" rx="2"/><path d="M9 7.5h6"/>',
  // 九宫格（个人页「作品」页签，对标 TikTok 的栅格图标）
  grid: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  comment: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  share: '<path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  play: '<path d="M6 4.5v15l13-7.5z"/>',
  pause: '<path d="M6 4.5h4v15H6z"/><path d="M14 4.5h4v15h-4z"/>',
  replay: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  branch:
    '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  // 四角外扩/内收：全屏与退出全屏。刻意不用「手机转一圈」那类图标——
  // 竖屏视频点它并不转屏，只是把边角的按钮文案收起来
  expand:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  shrink:
    '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  // 铅笔（弹幕键上那支小笔）
  pen: '<path d="M21.17 6.81a1 1 0 0 0-3.98-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.63l4.35-1.33a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  // 纸飞机（发弹幕的发送键）
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  // 铃铛（个人页顶栏的通知入口）
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  headset: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H3z"/><path d="M21 14h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3z"/><path d="M3 14v-2a9 9 0 0 1 18 0v2"/>',

  // 托盘 + 向上的箭头（「选一个 zip」「换一份素材」）
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 9l5-5 5 5"/><path d="M12 4v12"/>',
  // 折角的纸（包里那份 model3.json / 上传的素材文件）
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h6"/>',
  // 四角星（AI 生成这一步；与 emoji ✨ 同义，但能随 currentColor 变色）
  sparkle: '<path d="M12 3l2.2 5.3a2 2 0 0 0 1.5 1.5L21 12l-5.3 2.2a2 2 0 0 0-1.5 1.5L12 21l-2.2-5.3a2 2 0 0 0-1.5-1.5L3 12l5.3-2.2a2 2 0 0 0 1.5-1.5z"/>',
  // 圆圈里一个 i
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5"/><path d="M12 8h.01"/>',
  // 向下箭头 + 托盘（详情页「保存到本地」与分享面板第四项**共用这一个字形**）。
  // ★ 不许退回 emoji ⬇：见文件头——emoji 走系统彩色字体，做不到随 currentColor 跟色。
  download:
    '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  // 三条逐级变短的横线（Lucide list-filter）：筛选
  filter: '<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  // 做同款：后面那张卡只画露出来的左边与下边（描边图标叠两个完整矩形会互相穿线），前面那张 + 一颗四角星。
  // 24 网格、圆角 2、描边跟随 strokeWidth（与全套 1.75 同粗，别在一套里混两种粗细）
  remix:
    '<path d="M8.5 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2"/><rect x="8.5" y="3" width="11" height="16" rx="2"/><path d="M14 7.5l.9 2.2a1 1 0 0 0 .4.4l2.2.9-2.2.9a1 1 0 0 0-.4.4l-.9 2.2-.9-2.2a1 1 0 0 0-.4-.4l-2.2-.9 2.2-.9a1 1 0 0 0 .4-.4z"/>',
  // Lucide flag
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  // Lucide gauge
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  // 两侧那两张只画露在外面的半边（描边叠完整矩形会互相穿线），正中那张 + 四角星
  workshop:
    '<path d="M8 6.6 4.6 7.5a1.5 1.5 0 0 0-1.06 1.84l2.6 9.7a1.5 1.5 0 0 0 1.84 1.06L11 19"/><path d="M16 6.6l3.4.9a1.5 1.5 0 0 1 1.06 1.84l-2.6 9.7a1.5 1.5 0 0 1-1.84 1.06L13 19"/><rect x="8" y="3" width="8" height="16" rx="1.5"/><path d="M12 8.2l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z"/>',
  discover: '<circle cx="12" cy="12" r="10"/><path d="M12 6l1.2 4.8 4.3 1.2-4.3 1.2L12 18l-1.2-4.8L6.5 12l4.3-1.2z"/>',
  "id-card": '<path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/>',
  mic: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
  palette:
    '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  ban: '<path d="M4.929 4.929 19.07 19.071"/><circle cx="12" cy="12" r="10"/>',
  "hard-drive":
    '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
  lightbulb:
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  shirt:
    '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  drama:
    '<path d="M10 11h.01"/><path d="M14 6h.01"/><path d="M18 6h.01"/><path d="M6.5 13.1h.01"/><path d="M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3"/><path d="M17.4 9.9c-.8.8-2 .8-2.8 0"/><path d="M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7"/><path d="M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4"/>',
  "graduation-cap":
    '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  volume:
    '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  "volume-x":
    '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  forward: '<polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/>',
  clapper: '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  "life-buoy": '<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
};

/**
 * 实心版。只给需要「未激活→已激活」状态反馈的那几个：
 * 点赞、收藏、底栏当前页、播放控制。其余没有激活态的沿用描边。
 */
const SOLID: Partial<Record<IconName, string>> = {
  home: '<path d="M11.17 2.47a1.25 1.25 0 0 1 1.66 0l8 6.86c.28.24.44.59.44.95V19a2.5 2.5 0 0 1-2.5 2.5H15a.75.75 0 0 1-.75-.75V14.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75v6.25a.75.75 0 0 1-.75.75H5.23A2.5 2.5 0 0 1 2.73 19v-8.72c0-.36.16-.71.44-.95z"/>',
  user: '<circle cx="12" cy="7.5" r="4.5"/><path d="M4 21a8 8 0 0 1 16 0 1 1 0 0 1-1 1H5a1 1 0 0 1-1-1"/>',
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  cards:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m21.6 16.74-8.77 3.98a2 2 0 0 1-1.66 0L2.4 16.74a1 1 0 0 0-.4 1.74l9.17 4.17a2 2 0 0 0 1.66 0L22 18.48a1 1 0 0 0-.4-1.74" opacity=".45"/>',
  compass:
    '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m4.24 5.76-1.8 5.41a2 2 0 0 1-1.27 1.27L7.76 16.24l1.8-5.41a2 2 0 0 1 1.27-1.27z"/>',
  play: '<path d="M6 4.5v15l13-7.5z"/>',
  pause: '<path d="M6 4.5h4v15H6z"/><path d="M14 4.5h4v15h-4z"/>',
  // 有未读时用实心铃铛：红点告诉你"有几条"，实心告诉你"这个入口现在有内容"，
  // 一眼扫过去比只有一个 6px 的点更容易被看见
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0z"/><path d="M4 17a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 12 0c0 4.499 1.411 5.956 2.74 7.327A1 1 0 0 1 20 17z"/>',
  // 实心工坊：两侧两张半透明、正中那张实心并把四角星**挖空**（evenodd），星在实心卡面上仍看得见
  workshop:
    '<path opacity=".55" d="M8 6.6 4.6 7.5a1.5 1.5 0 0 0-1.06 1.84l2.6 9.7a1.5 1.5 0 0 0 1.84 1.06L8 19.8z"/><path opacity=".55" d="M16 6.6l3.4.9a1.5 1.5 0 0 1 1.06 1.84l-2.6 9.7a1.5 1.5 0 0 1-1.84 1.06L16 19.8z"/><path fill-rule="evenodd" d="M9.5 3h5A1.5 1.5 0 0 1 16 4.5v13a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 17.5v-13A1.5 1.5 0 0 1 9.5 3zM12 8.2l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z"/>',
  // 实心分区：整个圆实心、罗盘星挖空
  discover:
    '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4l1.2 4.8 4.3 1.2-4.3 1.2L12 18l-1.2-4.8L6.5 12l4.3-1.2z"/>',
};

export interface IconProps {
  name: IconName;
  /** 像素尺寸，默认 24 */
  size?: number;
  /** 实心态（点赞已赞、收藏已收、底栏当前页） */
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

export default function Icon({ name, size = 24, filled = false, className = "", style, strokeWidth = 1.75 }: IconProps) {
  // ★ 必须写成三元而不是 `filled && SOLID[name]`：后者在 filled=false 时得到的是
  //   布尔 false，而 `?? ` 只对 null/undefined 兜底，false 会原样穿过去，
  //   最后 dangerouslySetInnerHTML 收到 false 就渲染出字面量 "false" —— 图标全空。
  const solid = filled ? SOLID[name] : undefined;
  const markup = solid ?? OUTLINE[name] ?? "";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? "currentColor" : "none"}
      stroke={solid ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
      // 静态字面量，无外部输入
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
