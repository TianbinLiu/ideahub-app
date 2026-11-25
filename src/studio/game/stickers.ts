/**
 * 对局内的「贴纸」：表情 + 贴我的一张卡（2026-11-24，P1 = docs/game-lobby-ui-benchmark.md §2.1 #7 / #8、§2.3 第 3 条）。
 *
 * ★★ 为什么是"贴表情 / 贴卡"而不是自由打字聊天（文档 §3.1「明确不做」那一行）：
 *   UGC 昵称与卡名都要过审，而一句自由输入的中文/英文是审核面最大的一块；横屏弹键盘又把
 *   800×363 的可用高度吃掉一半。反过来，**卡面本来就是我们自己的内容** —— 贴一张卡出去，
 *   既是最省事的社交动作，也是只有这个 App 做得出来的东西（卡是玩家自己炼的）。
 *
 * ★★ **这一版只在本机播**（任务点名：服务端本轮不改）。服务端的房间里没有聊天 / 自定义事件端点
 *   （`api/game/rooms.ts` / `api/game/rounds.ts` 里一个都没有，`docs/game-lobby-ui-benchmark.md`
 *   §2.4 那张缺口表也没列它 —— 列它就得先有这个缺口）。所以：
 *   · `stickerStore` 一个请求都不发，贴纸只进本机这一个列表；
 *   · 界面上写明「联机贴纸要服务端支持后才会同步」（`labels.stickerSyncNote`），
 *     联机局里**不替别人编贴纸**（那些座位是真人，编一条就是假数据 —— 与 roster.ts 里
 *     "别人赞没赞服务端不下发就不摆"同一条纪律）；
 *   · 本机局里由 AI 每回合随机贴 1~2 条，面板 / 气泡才不至于一直空着。
 *   ★ 接上服务端时要动的只有三处：本文件的 `StickerBubble.senderName`（服务端昵称）、
 *     `stickerStore.sendFace / sendCard` 里加一发上行、`StickerBubbles` 里"online 时不播 AI"那段。
 *
 * ★★ 为什么单开一个零依赖模块（与 roster / connection / reports / phaseClock 同一条纪律）：
 *   节流（同一人 2 秒一条）、条数上限（同时最多 5 条）、4 秒淡出、AI 每回合 1~2 条 —— 这四条
 *   写进 JSX 就只能靠人点着试，而且错法全是"看起来没坏"：多发一条、少消失一条、
 *   AI 在 8 人局里刷屏。构建门禁（`scripts/check-game-ingame.mjs`）直接 import 本文件跑正反例。
 */
// ★ 带 .ts：构建门禁用 Node 直接 import 本文件跑断言（同 roster.ts / phaseClock.ts 的写法）。
import type { GameCard } from "./types.ts";

// ────────────────────────────── 时间与上限（全是"被量出来的"数） ──────────────────────────────

/**
 * 一条气泡在屏幕上活多久（毫秒）。
 * ★ 4 秒：一句话/一个表情扫一眼就够，再久左下角那块会一直堆着（真机 800×363 上一个气泡
 *   约 17px 高，5 条就占掉 90px —— 那是"创作面板左沿"的位置，见 STICKER_STACK_BOTTOM 的 ★）。
 */
export const STICKER_TTL_MS = 4_000;

/**
 * 淡出用多久（毫秒）。用 CSS transition（`.sticker-out`）而不是关键帧：
 * 减少动态效果的用户由 `index.css` 末尾那条 media query 把过渡关掉，气泡照样"4 秒后消失"，
 * 只是不淡（动效不许承担信息 —— 与大厅那几条同一条纪律）。
 */
export const STICKER_FADE_MS = 320;

/**
 * 同一个人两条之间的最小间隔（毫秒）。
 * ★ 2 秒：一局横屏 10~20 分钟，如果点一下就是一条，一个人两秒能刷满整块左下角
 *   （4 秒存活的 5 格），别人贴的全被挤掉。2 秒 = 一个"我看见了"的反应时间。
 * ★ 两个人互不影响（节流按发送者记），AI 的那 1~2 条也走同一个上限。
 */
export const STICKER_GAP_MS = 2_000;

/** 左下角同时最多挂几条（最近 5 条；第 6 条进来把最老的挤出去）。 */
export const STICKER_MAX = 5;

/** AI 每回合最多贴几条（任务点名：1~2 条，让面板不显得空，也不刷屏）。 */
export const AI_STICKER_MAX_PER_ROUND = 2;

/**
 * AI 的第 2 条比第 1 条晚多久（毫秒）。
 * ★ 1.4 秒：两条同时冒出来会一起消失（4 秒的窗口一模一样），看着像刷新出来的两条静态字；
 *   错开之后"另一个人跟着贴了一句"这件事才看得出来。
 * ★ 必须 < TTL（4 秒），否则第 2 条会在第 1 条没了之后才出现 —— 那不叫"跟着贴"。
 */
export const AI_STICKER_STAGGER_MS = 1_400;

/**
 * 气泡/淡出那个时钟走一格的间隔（毫秒）。
 * ★ 200ms：淡出是 320ms 的过渡，两格之间不会漏掉整个淡出窗口；再快就是每秒五次重渲
 *   （这块在 3D 画布上面，能省则省）。
 */
export const STICKER_TICK_MS = 200;

// ────────────────────────────── 贴纸目录（16 个常用表情） ──────────────────────────────

/** 贴纸的两种画法：仓库里的看板娘头像（webp）/ 一个内置 emoji 字形。 */
export type StickerKind = "mascot" | "emoji";

export interface StickerFace {
  /** 目录 id（与 labels.stickerFaceName 一一对应；也是 data-* 断言认的那个值） */
  id: string;
  kind: StickerKind;
  /** mascot = `public/` 下的图片路径（站点根相对）；emoji = 那一个字本身 */
  glyph: string;
}

/**
 * 16 个常用贴纸：**8 张仓库里现成的看板娘 Q 版头像** + 8 个内置 emoji。
 * ★ 头像只认 `public/avatars/mascot-*.webp`（256×256、单张 11~15KB，`public/avatars/README.md`
 *   记着它们的出处：从底栏精灵图裁的同一只角色）。**不新造素材** —— 新画一批的第一笔钱是出图，
 *   第二笔是"新脸和底栏那只宠物不是同一个人"（那份 README 的 ★ 已经踩过一次）。
 * ★ 名字一个都不在这个文件里（零依赖 + check-i18n 的棘轮盯着 .ts 里的中文字面量）：
 *   id → 中文名在 `labels.stickerFaceName`，界面用它读屏 / 写 title。
 * ★ 8 + 8 = 16：任务给的是 12~16，取上限 —— 8 张头像正好是一整行，emoji 再一行，
 *   面板 `grid-cols-8` 两行放满，800×363 上量出来正好 55px 高（见 StickerPanel 的 ★）。
 */
export const STICKER_FACES: readonly StickerFace[] = [
  // ── 看板娘 Q 版头像（public/avatars，八张一套）──
  { id: "smile", kind: "mascot", glyph: "/avatars/mascot-smile.webp" },
  { id: "hi", kind: "mascot", glyph: "/avatars/mascot-hi.webp" },
  { id: "laugh", kind: "mascot", glyph: "/avatars/mascot-laugh.webp" },
  { id: "cheer", kind: "mascot", glyph: "/avatars/mascot-cheer.webp" },
  { id: "joy", kind: "mascot", glyph: "/avatars/mascot-joy.webp" },
  { id: "wonder", kind: "mascot", glyph: "/avatars/mascot-wonder.webp" },
  { id: "focus", kind: "mascot", glyph: "/avatars/mascot-focus.webp" },
  { id: "nap", kind: "mascot", glyph: "/avatars/mascot-nap.webp" },
  // ── 内置 emoji（不占包体、离线可用、跨平台字形由系统给）──
  { id: "like", kind: "emoji", glyph: "👍" },
  { id: "heart", kind: "emoji", glyph: "❤️" },
  { id: "lol", kind: "emoji", glyph: "😂" },
  { id: "wow", kind: "emoji", glyph: "😮" },
  { id: "cry", kind: "emoji", glyph: "😭" },
  { id: "party", kind: "emoji", glyph: "🎉" },
  { id: "fish", kind: "emoji", glyph: "🐟" },
  { id: "eyes", kind: "emoji", glyph: "👀" },
];

/** 目录 id → 贴纸；认不出回 null（不许凭空造一个空贴纸 —— 界面按 null 不发）。 */
export function stickerFaceOf(id: string): StickerFace | null {
  return STICKER_FACES.find((face) => face.id === id) ?? null;
}

// ────────────────────────────── 一条气泡 ──────────────────────────────

/**
 * 左下角挂着的一条贴纸。
 * ★ 卡是**快照**（卡名 + 卡面）：贴出去之后这张卡可能被卖掉、被换上桌、被换掉，
 *   气泡里那条还得是当时那一张（4 秒之内就消失，但 4 秒里足够发生一次卖卡）。
 */
export interface StickerBubble {
  /** 列表内的唯一 id（store 用 `序号` 保证；React key 与 data-* 都认它） */
  id: string;
  /** 发送者的座位 id（本机 = "me"，AI = "ai-N"；接上服务端后是 userId） */
  senderId: string;
  /** 发送者名字（服务端昵称）。null = 本机局，界面按 `labels.playerName(senderId)` 念 */
  senderName: string | null;
  /** 表情贴纸（与 card 二选一） */
  face: StickerFace | null;
  /** 贴出来的一张卡（与 face 二选一） */
  card: GameCard | null;
  /**
   * 该上屏的时刻（毫秒）。
   * ★ 不只是"发出的时刻"：AI 的第 2 条会带 `AI_STICKER_STAGGER_MS` 的延迟，
   *   到点之前它已经在列表里、但不画 —— 淡出的 4 秒也从这个时刻起算
   *   （否则延迟出来的那一条会比第 1 条早消失）。
   */
  at: number;
}

/**
 * 最多留 5 条（最近 5 条；更老的挤出去）。
 * ★ 为什么在**进列表**这一拍就裁，而不是画的时候裁：列表长度就是"屏幕上最多几条"，
 *   构建门禁断言的是这个数（`STICKER_MAX`），画的时候再裁等于有两处上限。
 */
export function pushStickerBubbles(
  bubbles: readonly StickerBubble[],
  incoming: readonly StickerBubble[],
): StickerBubble[] {
  const next = [...bubbles, ...incoming];
  return next.length > STICKER_MAX ? next.slice(next.length - STICKER_MAX) : next;
}

/** 这一刻该不该画（还没到上屏时刻 → 不画；过了 TTL + 淡出 → 不画）。 */
export function stickerVisibleAt(bubble: Pick<StickerBubble, "at">, now: number): boolean {
  const age = now - bubble.at;
  return age >= 0 && age < STICKER_TTL_MS + STICKER_FADE_MS;
}

/** 这一刻是不是正在淡出（TTL 之后那 320ms）。 */
export function stickerFadingAt(bubble: Pick<StickerBubble, "at">, now: number): boolean {
  return now - bubble.at >= STICKER_TTL_MS;
}

/** 这一刻屏幕上的那几条（顺序 = 进列表的顺序，最老的在前）。 */
export function liveStickersAt(bubbles: readonly StickerBubble[], now: number): StickerBubble[] {
  return bubbles.filter((bubble) => stickerVisibleAt(bubble, now));
}

/**
 * 丢掉彻底过期的（`TTL + 淡出` 之后）。
 * ★ 判据是"**已经过了** TTL + 淡出"，不是 `!stickerVisibleAt`：AI 第 2 条的 `at` 在 1.4 秒之后
 *   （还没上屏），拿"看不看得见"当判据，这一拍就会把它一起清掉 —— 表现是"AI 每回合只贴一条"，
 *   而且只在 2 秒轮询恰好落在那 1.4 秒窗口里时才复现（零报错、看屏幕也看不出来）。
 * ★ store 只在这一拍清：清早了会闪一下（淡出还没走完就没了），清晚了列表就超 5 条的唯一来源
 *   是 push 那一处 trim —— 两处都有上限就必然有一处先松。
 */
export function pruneStickers(bubbles: readonly StickerBubble[], now: number): StickerBubble[] {
  const alive = bubbles.filter((bubble) => now - bubble.at < STICKER_TTL_MS + STICKER_FADE_MS);
  return alive.length === bubbles.length ? (bubbles as StickerBubble[]) : alive;
}

// ────────────────────────────── 节流：同一人 2 秒最多 1 条 ──────────────────────────────

/**
 * 这个人还差多少毫秒才能再贴（0 = 现在就可以）。
 * ★ 时钟往回跳（用户改时间 / NTP 校正）时 `now - lastAt` 是负数：按"已经等了 0 毫秒"算，
 *   不是按"还要再等 2 秒 + 跳回去的那一段" —— 否则时钟一歪，贴纸键会灰上几分钟
 *   （与 phaseClock.elapsedMsOf 同一个口径：负数按 0）。
 */
export function stickerWaitMs(now: number, lastAt: number | null | undefined): number {
  if (typeof lastAt !== "number" || !Number.isFinite(lastAt)) return 0;
  const waited = Math.max(0, now - lastAt);
  const left = STICKER_GAP_MS - waited;
  return left > 0 ? Math.ceil(left) : 0;
}

/** 这个人现在能不能贴。 */
export function canStickerAt(now: number, lastAt: number | null | undefined): boolean {
  return stickerWaitMs(now, lastAt) === 0;
}

// ────────────────────────────── AI：每回合 1~2 条 ──────────────────────────────

/** AI 这一回合要贴的一条（由 store 在回合开始那一拍照着它落成 StickerBubble）。 */
export interface AiStickerPlan {
  /** 谁贴（调用方已经扣掉我、扣掉出局的人） */
  seatId: string;
  /** 贴哪一张（`STICKER_FACES` 的 id） */
  faceId: string;
  /** 相对"这一刻"的延迟（毫秒）：第 1 条 0，第 2 条 `AI_STICKER_STAGGER_MS` */
  delayMs: number;
}

/**
 * 本机局的 AI 这一回合贴什么。
 *
 * ★ 为什么是**纯函数 + 注入 seed**（不是 Math.random）：同一局（seed 相同）重开、复盘、
 *   构建门禁跑两遍，出来的必须是同一批贴纸 —— 与 rules / bots 里"rng 从参数来"同一条纪律。
 *   `round` 也进 key：同一局每一回合各抽各的，不重样能看出来 AI 是真的每回合贴。
 *
 * ★ 为什么是 1~2 条、而不是每回合固定 2 条：固定 2 条会变成节拍器（第 1/3/5 回合永远两条），
 *   玩家很快就知道"这不是人在贴"。取 1 条约 55%、2 条约 45%。
 *
 * ★ 为什么两条必须给**不同的人**：同一人 2 秒内最多 1 条是全局规则（`STICKER_GAP_MS`），
 *   而第 2 条只隔 1.4 秒 —— 同一个座位贴两条就自己违反了自己的节流。
 *   可贴的人只剩一个时，这一回合就只贴 1 条（宁少不多）。
 *
 * ★ 为什么排除已经出局的人：出局的人还在贴表情，等于告诉玩家"这一局是假的"。
 *   （扣人这一步在调用方：它手里才有 `state.players`，这里只认 id 字符串。）
 */
export function aiStickerPlanOf(input: {
  /** 第几回合（1 起）。每回合重新抽一批。 */
  round: number;
  /** 这一局的种子（game/store 的 seed）：同一局永远同一条序列 */
  seed: number;
  /** 这一桌可以贴纸的座位（调用方扣掉我、扣掉出局的人） */
  seats: readonly string[];
}): AiStickerPlan[] {
  const seats = [...new Set(input.seats)];
  if (seats.length === 0) return [];
  const rng = lcgOf(mix32(input.seed >>> 0, Math.floor(input.round) || 0));
  // 1 条（55%）还是 2 条（45%）：先摇一次，后面的抽取顺序才不会因为"要不要第 2 条"而错位
  const wanted = rng() < 0.45 ? 2 : 1;
  const count = Math.min(wanted, AI_STICKER_MAX_PER_ROUND, seats.length);
  // 座位与贴纸都按"洗过一遍"的顺序取前 N 个：两条永远不会撞人或撞脸
  const seatOrder = shuffle(seats, rng);
  const faceOrder = shuffle(
    STICKER_FACES.map((face) => face.id),
    rng,
  );
  const plan: AiStickerPlan[] = [];
  for (let index = 0; index < count; index += 1) {
    plan.push({
      seatId: seatOrder[index],
      faceId: faceOrder[index % faceOrder.length],
      delayMs: index === 0 ? 0 : AI_STICKER_STAGGER_MS,
    });
  }
  return plan;
}

/** deterministic 洗牌（Fisher–Yates；只求"同一个 seed 出同一手"，不求统计学质量）。 */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/** 32 位混合（round / seed → 一个确定的起点）。 `Math.imul` 保证各平台的 32 位行为一致。 */
function mix32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = (h + Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** 经典 LCG：只要"同一个种子出同一条序列"，不需要好的统计性质。 */
function lcgOf(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ────────────────────────────── 气泡栈的几何（量出来的数，别改着玩） ──────────────────────────────

/**
 * 气泡栈的**底边**：让开底部那条阶段条。
 *
 * 800×363 dev 实测（`getBoundingClientRect`，舞台 788×351 —— StudioPage 的 p-1.5 让 GameLayer
 * 那一层从 (6, 6) 起、高 351，它的底边是 **y 357**）：
 *   阶段条 y **321.3**（高 29.8，底 351.1）；背包行 y 248.1、高 67.2（盒 x **148.5** 起）；
 *   创作面板 y 135.8~242.1、x 32~768；HUD 药丸 y 70~96（x 160~640）；
 *   贴纸键 x 657.5（挂在商店键右沿 651.4 后 6px）。
 * 底边 41.6px = 2.6rem（= 阶段条高 29.8 + 内边距 5.9 + 那条缝 5.9）→ 气泡栈的底落在 **y 315.4**，
 * 比阶段条上沿还高 5.9px —— **一条都不叠**。
 * ★ 为什么不是"贴着屏幕下沿"：贴着下沿就压在阶段条上（那是这一屏唯一说"下一步点哪"的条）。
 * ★ 为什么带 `env(safe-area-inset-bottom)`：真机横屏底部可能有安全区；底部其他组件没有扣它，
 *   这里是**多留一点**的方向（气泡往上挪，绝不往下压阶段条）。
 */
export const STICKER_STACK_BOTTOM = "calc(env(safe-area-inset-bottom, 0px) + 2.6rem)";

/** 2.6rem 在 16px 根字号下的像素值（构建门禁拿它与阶段条实测高度对一遍，见文件尾的 ★）。 */
export const STICKER_STACK_BOTTOM_PX = 41.6;

/**
 * 气泡栈的**宽**：17.5vw（800 上 140px）。
 * ★ 不是审美：背包盒从 x 148.5 起（量过，连商店键那一行的左沿也是它），气泡栈挂在舞台左沿
 *    （`left-0` → 视口 x 6；GameLayer 自己的根从 x 6 起，写 left-1.5 会挪到 12），
 *   6 + 140 = 右沿 146 → 留 2.5px；再宽就压在背包条上（任务点名"不挡背包条"）。
 * ★ 上限 11rem（176px）给 1384×797 那种宽窗：那里的背包行离左边远得多（x 390 起），
 *   但气泡再宽就变成"一堵墙"，盖住桌面卡位的左半边。
 */
export const STICKER_STACK_WIDTH = "clamp(6.5rem, 17.5vw, 11rem)";

/** 17.5vw 在 800 宽下的像素值（与 STICKER_STACK_BOTTOM_PX 同一类：门禁拿它对一遍背包行左沿）。 */
export const STICKER_STACK_WIDTH_PX = 140;

/**
 * 气泡栈的**最高**：28vh（363 上 101.6px）。
 * ★ 一条单行气泡 17px（头像 15 + 上下各 1px 内边距）、间距 2px → 5 条 89px（量到过），装得下
 *   （任务是"最近 5 条"）；贴着卡的 4 条（每条 24px）也装得下。
 * ★ 为什么不封到"创作面板下沿"（800 上 242.1，也就是只剩 79px）：那样只能放 4 条单行气泡，
 *   而任务是 5 条。代价是**创作 / 展映那几屏**里 5 条堆满时栈顶在 y 226.4，
 *   与那块面板（y 135.8~242.1）的**左下角**重叠 15.7px —— 那 15.7px 上只有一行
 *   "道具挂在哪张卡上"的小字。实测与取舍在 docs/game-lobby.md §7.15。
 *   （本机局实际最多同时 4 条：我 2 秒 1 条 + AI 每回合最多 2 条；5 条要 5 个人在 4 秒里一起贴。）
 */
export const STICKER_STACK_MAX_HEIGHT = "clamp(4.5rem, 28vh, 11rem)";

