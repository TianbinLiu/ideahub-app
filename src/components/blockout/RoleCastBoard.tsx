// 视频编辑页【模式二 · 套用挂卡】：放白模模板视频 + 列出它的角色位，
// 一个角色位挂一张人物卡，产出 `标记 → cardId` 的映射交给上层去合成提示词。
//
// ★★ 版式自上而下就是操作顺序（2026-08-17 定）：**卡轨在上 → 画面在中 → 格子行在下**。
//   挂卡有**三条路**，前两条永远都在，第三条必须有位置数据才开：
//   ① **点格子选中 → 点卡轨上的一张卡**：不依赖任何位置数据，老模板走的就是这条。
//   ② **把卡从卡轨拖到格子上**：同样不依赖位置数据。格子上写着是哪个位子、用户是看着
//      标签放上去的，没有可推断错的余地，所以**不问第二遍**。
//   ③ **把卡拖到画面里那个人偶身上**（`markBoxes` 与 `markSlots` 长度相等、知道那些框
//      量自第几秒、且作者没动过角色位 —— 判据的唯一实现是下面的 `dragOn`）：画面落点是
//      **推断**出来的（框会重叠、人会走动），所以松手后**必须再确认一次**。
//   ⚠ 第三条路当年被明确否掉过（"我们没有逐帧的人物包围盒/分割数据，点画面必然点错人"）。
//   今天能开，唯一的原因是**服务端在看帧那一步真的把框量出来了**并跟着模板下发。
//   所以判据是**存在性**，缺一个框就整层关掉（`markBoxesOf` 在收货那一层已经整份丢掉）：
//   局部可拖会让用户以为"这个人拖不了 = 坏了"，而挂错人是零报错的。
//   ★ 关掉时界面上**一点可点的暗示都不给**（不加光标手型、不加悬停高亮），并明说一句
//     为什么（`!dragOn` 那段解释，画面正下方）—— 不说的话用户会一直去戳画面，以为是坏了。
//   ★ 2026-08-17 删掉了"逐行点开选卡浮层"那条老路（`CardPickSheet`）：选卡统一在最上面
//     那条卡轨上，"我刚才到底在哪儿挂的"不该有两个答案。下面那份按位子列的清单因此
//     退成**只读参考**（它独有的东西是每个位子的 `desc`），默认折叠。
//
// ★★ 界面上有**两个名字**，别混：
//   · `label` —— 服务端算出来的标记（"从左数第3个" / "编号 4"），**原样**进提示词，也是
//     `value` 这个映射的键。它只在**没有位置数据**时才露面（那时画面上不会有框亮起来，
//     "人物N 到底是画面里哪一个"只能靠它）——见格子里那枚 `MarkBadge`。
//   · 「人物N」—— 给人看的中性名字，**唯一实现是 `personNameOf`**（曾经在本文件里被拼过
//     七遍、编号算法有五份，改一处漏六处是零报错的）。它只是位次，不承诺左右次序。
//
// ★★ 标记（`label`）**原样用**，绝不重编、绝不换近义说法：编号方案下实测白模人偶身上的数字
//   稳定但**不连续**（一发四个人偶实出 1/2/4/5，见 types.ts 的 ★★）；序数方案下把
//   "从左数第3个"写成"第三个"是同一种错法。按下标显示成 1..N 的话，用户对着屏幕上的 "4" 号
//   点了列表里的第 3 项，映射就错了位。
//
// ★★ 两种标记方案，几句解释文案按 `spec` 分支（判据的唯一实现在 data/templates.markSpecOf；
//   本文件里就是那几处 `ordinal ? … : …`：超限、野标记、排到上限）：
//     · 序数：人偶**全都是一模一样的纯白色**，身上什么都没印 —— 唯一的线索是**站位**，
//       所以文案说的是"人挤在一起就数不准了"，绝不说"去人偶身上找记号"；
//     · 编号（存量老模板）：数字**只印在人偶的某一面**（多半是额头或后脑），转过身就没了。
//   "前后左右四面都印着同一个数"那句老引导是全 app 最硬的一句假承诺（实测从没被执行过），
//   所有文案都必须说实话 —— 一句过时的指路和一个坏功能长得一模一样。
//   ⚠ 措辞本身（"从左数第3个"这种）**不在本文件里造**：要显示就显示服务端给的 `label`
//     原文（走 MarkBadge），见上面那条「两个名字」。
//
// ★ 只收 props、不认识任何 store（PlanBoard 同款约束）：可挂的卡由宿主给。
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import HelpButton from "../guide/HelpButton";
import { useAutoGuide } from "../guide/useAutoGuide";
// ★ 原样显示一个标记（`label`）只有 MarkBadge 一处实现：两种方案的排版不同（编号要
//   tabular-nums、序数是一句会撑破格子的中文，要折行），各画一遍必然分叉
import MarkBadge from "./MarkBadge";
import VideoStage from "./VideoStage";
import type { TemplateRole } from "./arkVideoRules";
// ★ 角色位上限、"哪几个能挂卡"、"这个模板是哪种标记方案"全部取自 data 层（一处实现）——
//   这里只负责把它们画出来，不复述判断，更**不许**在本文件里出现任何序数措辞常量
//   （data/templates 那段 ★★★）
import { BLOCKOUT_MAX_ROLES, prominentRoleWarning, splitCastRoles, type MarkSpec } from "../../data/templates";
import type { Card, MarkBox } from "../../types";

/**
 * 「现在停的这一帧还算不算标记帧」的容差（秒）。
 *
 * ★ 不是拍脑袋：`timeupdate` 在主流浏览器上大约每 250ms 才报一次，容差写得比它小的话，
 *   播放头明明停在标记帧上、落点层也会一闪一闪地开关。0.5s 同时也是"人还没走几步"的量级。
 * ★★ 超出容差就**把落点层整个隐去**（而不是继续画一组已经不准的框）：框是**一帧**上量的，
 *   人是会走动的 —— 画一组过时的框，用户会照着它拖，而挂错人零报错。
 */
const ON_FRAME_TOL_SEC = 0.5;

/** 落点判定：不在任何框内时，横向最近的那个框还算不算数（阈值 = 平均框宽的一半）。
 *  ★ 只按**横向**找最近：序数说的就是横向位置，而人偶的头/脚落点在纵向差得很远 */
const NEAR_RATIO = 0.5;

/**
 * 有位置框时，舞台只播标记帧附近这么长一段（秒）。
 *
 * ★★ 它**不只是个播放范围**，还是"一进来就停在标记帧上"的唯一可靠做法：`VideoStage` 的
 *   首帧预热会把播放头放到 `clip.startSec`（没有 clip 时是 0.05）—— 那一步是在
 *   `loadedmetadata` 里同步做的，之后还有一次 `play().then(pause)` 会再把它拨回去。
 *   在宿主这边用 `seekTo` 抢是**竞态**（预热那一拨会赢），而落在 0.05 秒的话，
 *   面板一打开就是"离开标记帧了"，用户还没动过就被告知走远了。
 * ★ 2 秒：够看清这个人偶在动，又短到人还没走出自己那个框；播到头会自动回到标记帧
 *   （VideoStage 的 clip 语义），所以"回到标记帧"多数时候不用点。
 */
const BOX_CLIP_SPAN_SEC = 2;

export interface RoleCastBoardProps {
  /** 白模模板视频地址（模板的 refVideo.url） */
  videoUrl: string;
  /** 角色位。★ 顺序、标记都原样用服务端给的那份 */
  roles: TemplateRole[];
  /**
   * 这个模板的标记方案 + 它那份顺序表（判据的唯一实现是 `data/templates.markSpecOf`，
   * 本组件只问它、不自己判）。
   *
   * ★ 缺省走编号是**安全的那一侧**（由 markSpecOf 保证）：线上老模板天然没有 markSlots，
   *   界面照旧按数字说话。反过来默认序数的话，老模板会让用户对着一群印着号的人偶
   *   从左往右数 —— 数出来的和号对不上，只会以为坏了。
   */
  spec: MarkSpec;
  /**
   * 每个位置在**某一帧**上的画面框（归一化 0~1000），与 `spec.slots` **按下标对齐**。
   * 缺省 / 长度对不上 / 不知道量自第几秒 → 拖拽层整层不出现，退回点列表。
   */
  boxes?: MarkBox[];
  /** 上面那些框量自第几秒 */
  boxAtSec?: number;
  /** 可挂的卡（宿主从素材库读并决定要不要只给人物卡） */
  cards: Card[];
  /** `label → cardId`。★ 受控：组件自己不留状态，宿主要存草稿/退出合成提示词都靠它 */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /**
   * 这一次出片最多能带几张人物参考图。给了才显示"挂多了会被挤掉"那句提醒。
   * ★ 不给默认值、也**不在这里判该挤掉谁**：那条规则的唯一实现在出片管线
   *   （`ai/real.ts` 的预算与两轮分配）。在这儿复述一遍排序，
   *   哪天那边改了这里就会开始说假话。
   */
  maxRefImages?: number;
  busy?: boolean;
  /** 底部主按钮（宿主决定叫什么、做什么）。不给就不渲染 */
  onDone?: () => void;
  doneLabel?: string;
  onCancel?: () => void;
  /** 宿主往按钮上方塞的东西（比如"这一段要求"的输入框） */
  extra?: ReactNode;
}

/** 拖拽中的那张卡（跟手卡影 + 当前压在哪儿）。null = 没在拖 */
interface DragState {
  card: Card;
  x: number;
  y: number;
  /** 压在**画面上**第几个人偶（`spec.slots` 的下标）；null = 没压在任何人偶上 */
  over: number | null;
  /**
   * 压在**格子行**的第几个格子（`castable` 的下标）；null = 没压在格子上。
   *
   * ★★ 与 `over` 有意分开成两位：它们的落点语义不同 —— 画面上的落点是**推断**出来的
   *   （框会重叠、人会走动，所以松手要再问一句「是这个人吗」），而格子是用户
   *   **看着标签**放上去的，没有任何可推断错的余地，直接落。合成一位的话，
   *   两种落点就只能共用一套确认流程，而多问一句正是格子行要解决的那个麻烦。
   */
  overCell: number | null;
}

export default function RoleCastBoard({
  videoUrl,
  roles,
  spec,
  boxes,
  boxAtSec,
  cards,
  value,
  onChange,
  maxRefImages,
  busy,
  onDone,
  doneLabel = "完成挂卡",
  onCancel,
  extra,
}: RoleCastBoardProps) {
  // ★ 这一屏不是路由（它是 /video-editor 的一个模式），所以自己声明引导。
  //   `enabled` 挂角色位：没有角色位时整块面板退成一段解释 + 完成键，五步全都无从谈起。
  useAutoGuide("cast", roles.length > 0);
  /** 这个模板是不是序数方案（判据的唯一实现在 data/templates.markSpecOf，这里只取结论） */
  const ordinal = spec.scheme === "ordinal";

  /**
   * 拖拽层开不开 —— **一处判断**，下面所有"要不要画框/要不要说画面点不了"都读它。
   *
   * ★★ 三个条件缺一不可，而且是 `&&` 不是"尽力而为"：序数方案（框按 slots 下标对齐）、
   *   框数与位置数**相等**、并且知道这些框量自第几秒（没有时刻的框没法核对，人是会走的）。
   */
  const dropSlots = ordinal ? spec.slots : [];
  /**
   * 第四个条件（2026-08-17 审查逼出来的）：**作者改过角色位之后，这些框就不能信了**。
   *
   * ★★ `markSlots`/`markBoxes` 是**白模化那一刻的历史事实**，服务端刻意不让 PATCH /roles
   *   动它们。而序数方案独有的修复动作恰恰是「删掉画面上根本不存在的那个位子，
   *   并把它右边所有位子各左移一位」—— 核对面板正在主动教作者这么做。
   *   这个动作一执行，label 的语义（在**剩下的**人偶里从左数第几个）就与 markSlots
   *   下标的语义（白模化那一刻**全部**人偶里从左数第几个）分了叉：
   *   `boxOfLabel` 按 `markSlots.indexOf(label)` 查出来的框指向的是**另一个人**。
   * ★★ 而原来那三个条件**没有一条**会因此变假（markSlots 与 markBoxes 长度都没变），
   *   于是拖拽层照常开着，把落点框画在错的人偶上、二次确认还理直气壮地高亮它 ——
   *   而拖拽层的全部意义就是"让用户照着框做决定"。这是**最坏的一种**错：
   *   用户看着画面点头，换出来的却是另一个人，零报错、要花一发 r2v 才看得见。
   * ★★ 判据是**条数相等 + 每个 label 都还在表里**，不是"下标递增"。
   *   建模板时服务端写的是 `markSlots = roles.map(r => r.label)`，两者**逐条对应**；
   *   删掉一位就再也不等了 —— 这才是那个动作真正破坏的不变量。
   *   （我第一版写的是"下标严格递增"，抓不住它：删掉「从左数第2个」并把
   *    「从左数第3个」改名成「从左数第2个」之后，下标是 0 < 1 < 3，照样递增。）
   * ★ 这条判据同时**放过**作者的另一个合法修复：把相邻两行的措辞对调
   *   （"AI 把这两个人的左右排反了"）。那时条数没变、措辞都还在表里，
   *   而 `boxOfLabel` 按新 label 查出来的框正好是对的那个位置 —— 本来就该继续能拖。
   * ⚠ 不许改成"尽力而为"（把对得上的那几个留着可拖）：对不上的那几个恰恰是作者
   *   刚刚指出画面有问题的地方，让它们看起来"只是不能拖"是把最危险的部分藏起来。
   */
  const boxesStillMatchRoles =
    ordinal && roles.length === dropSlots.length && roles.every((r) => dropSlots.includes(r.label));
  /**
   * 「这段素材里有个特别显眼的人，挂卡可能被换到它身上」—— 判据的**唯一实现**在
   * `data/templates.prominentRoleWarning`（颜色异类 ∧ 就在正中，两个都要，九发实拍标定的）。
   * ★ 这里只负责显示：别在组件里补一句"顺便也判判谁最大"，那就是第二处判据了
   *   （而"最大的那个"实测指向的是另一个人，加了会当场说错话）。
   */
  const prominent = useMemo(() => prominentRoleWarning(roles, dropSlots, boxes), [roles, dropSlots, boxes]);
  const dragOn =
    ordinal &&
    !!boxes &&
    boxes.length > 0 &&
    boxes.length === dropSlots.length &&
    typeof boxAtSec === "number" &&
    boxesStillMatchRoles;

  /** 播放头（秒）。★ 初值就是标记帧：下面 `seek` 也从它起步，一进来舞台就停在那一帧上 */
  const [nowSec, setNowSec] = useState(boxAtSec ?? 0);
  const [seek, setSeek] = useState<number | null>(dragOn ? (boxAtSec as number) : null);
  const onFrame = dragOn && Math.abs(nowSec - (boxAtSec as number)) <= ON_FRAME_TOL_SEC;

  const [drag, setDrag] = useState<DragState | null>(null);
  /** 松手之后的**二次确认**：换错人是零报错的，这一问是唯一的拦截 */
  const [ask, setAsk] = useState<{ card: Card; slot: number } | null>(null);
  /** 一次落点同时压在两个重叠的框上 —— **不猜**，把候选摆出来让用户点 */
  const [ambiguous, setAmbiguous] = useState<{ card: Card; slots: number[] } | null>(null);
  /** 刚挂上的那个 label：列表里同步高亮一下，否则用户不知道自己刚才动了哪一行 */
  const [flash, setFlash] = useState("");
  /**
   * 选中的格子（`castable` 的下标）。null = 没选。
   *
   * ★★★ 这是新版式的**核心**：格子上写的是「人物1 / 人物2」这种中性名字，**不写序数措辞**。
   *   理由是真的：序数只有在画面里的人真是"整齐一排从左到右"时才有意义，而实测
   *   （2026-08-17，四发付费）真实素材里人会前后重叠、镜头会切、人数会变 ——
   *   在格子上印一句「从左数第3个」等于对用户做一个我们自己都不保证的承诺。
   * ⇒ 有位置数据（`dragOn`）时，「这一格是画面里的哪一个」由**画面上那个框亮起来**回答。
   *   点格子 → 框变色，这是最诚实的指认方式（它直接来自服务端量出来的坐标，不经过任何措辞）。
   * ⚠ **没有位置数据时这条链是断的**：没有框会亮，「人物N」就只剩排序。所以 `!dragOn` 时
   *   格子上会补出原始 `label`（那时它是唯一的线索，编号方案的老模板尤其如此），
   *   并在画面正下方那段解释里说清它为什么这时才出现 —— 见格子里的 `MarkBadge`。
   * ★ label 本身**一个字都没变**：它照旧原样进提示词（那是服务端算的、r2v 认的东西），
   *   变的只是"给人看的那一面"。两者分开是有意的。
   */
  const [selected, setSelected] = useState<number | null>(null);

  /** 画面覆盖层的根节点：落点换算只量它（它正好等于画面本身，见 VideoStage 文件头 ★★） */
  const stageRef = useRef<HTMLDivElement>(null);
  /**
   * 格子行的根节点 —— 拖拽落到**格子**上的命中判定量它。
   * ★ 用一个容器 + `data-cell` 属性去量每个格子，而不是给每个格子各存一个 ref：
   *   格子数是变的（删角色位、换模板），一个 ref 数组要跟着维护长度，而漏维护的表现是
   *   "某一格永远接不住拖拽"，零报错。
   */
  const stripRef = useRef<HTMLDivElement>(null);
  /** 一次拖拽的起点。★ 与 MaterialSheet.begin 同款：方向仲裁 + pointer capture */
  const start = useRef<{ x: number; y: number; id: number; active: boolean; card: Card } | null>(null);
  /**
   * 「刚拖完，别把紧跟着那次 click 当成点击」。
   *
   * ★★ 卡片同时挂着 pointer 拖拽和 `onClick`（点卡 = 挂给选中的格子）。浏览器在一次
   *   pointerdown→move→up 之后**照样会补发一次 click**（设了 pointer capture 时，
   *   click 就落在这张卡上），于是拖一次 = 挂两次：一次落在拖到的格子/人偶上，
   *   一次落在"当前选中的格子"上 —— 后者是用户**从没做过**的一条映射，而挂错人零报错。
   *   桌面 Chrome 必现；触摸设备上补发的 click 同样会来。
   * ★ 只在**真拖过**（`start.active` 为真）时压，"按下没动就抬手"那次 click 必须放行 ——
   *   点一张卡挂给选中格子正是主路径。
   * ★ 在 pointerdown 处复位而不是靠定时器：某些路径（拖出去后 pointercancel）根本不会补
   *   click，标记留着的话会把**下一次**真点击吃掉，表现是"点卡没反应"，同样零报错。
   */
  const swallowClick = useRef(false);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  // ★ 能挂卡的只有前 BLOCKOUT_MAX_ROLES 个（判定的唯一实现在 data/templates.splitCastRoles，
  //   flowStore 落 materials 时问的是同一个函数）。多出来的**照样列出来**但不给挂卡按钮 ——
  //   画面上那些人偶真的站在那儿，列表里悄悄少几项，用户只会以为坏了。
  // ★ 重命名成 overflowRoles：`extra` 这个名字已经被宿主那块自定义内容的 props 占了，
  //   同名会把它遮掉 —— 表现是"输入框整个不见了"，而 TS 一声不吭
  const { castable, extra: overflowRoles } = useMemo(() => splitCastRoles(roles), [roles]);
  const mountedLabels = castable.filter((r) => value[r.label]).map((r) => r.label);
  const emptyCount = castable.length - mountedLabels.length;
  /** 能挂卡的那几个位子在 `spec.slots` 里的下标 —— 落点判定只认这一份。
   *  ★ 超出上限的位子**不给落点**：它本来就挂不了卡，让它接得住一次拖拽只会白问一次 */
  const dropIndexes = useMemo(
    () => (dragOn ? castable.map((r) => dropSlots.indexOf(r.label)).filter((i) => i >= 0) : []),
    [castable, dropSlots, dragOn],
  );

  /**
   * 映射里那些**这块面板上根本挂不上**的键，**按原因分成两摞**。
   *
   * ★★ 必须给一颗**能点的**按钮：出片前的 flowStore.applyCast 会因为它们整句拒绝，
   *   而这块面板又不渲染这些位子 —— 不给出路的话，用户看着一句"把这几张取下"却无处可取，
   *   挂卡这条路整个走不下去（比静默丢掉更糟：那至少还能出片）。
   * ★★ 为什么要分两摞（2026-08-15 修）：原来一句话并列猜「超出上限，或者已经被删掉了」。
   *   删位现在是常规操作（AI 分配的标记会错，作者把画面上对不上的那个位子删掉是唯一
   *   不用再花一次钱的修法），最常见的就是"被删掉"那一种 —— 让用户去数"我是不是挂超过
   *   9 个了"，他怎么数都对不上。两种情况的**下一步也不同**：超上限是这个模板本来就装不下，
   *   被删掉是作者改过标记（重新套用一次模板就会看到新的位子）。
   * ★ 判据没有新写：能不能挂由 splitCastRoles（唯一实现）说了算，这里只是按"这个标记
   *   在不在模板的 roles 里"把已经算出来的结果分类。
   */
  const { strayOverCap, strayRemoved } = useMemo(() => {
    const ok = new Set(castable.map((r) => r.label));
    const known = new Set(roles.map((r) => r.label));
    const stray = Object.keys(value).filter((label) => !ok.has(label));
    return {
      strayOverCap: stray.filter((l) => known.has(l)),
      strayRemoved: stray.filter((l) => !known.has(l)),
    };
  }, [castable, roles, value]);
  const strayLabels = useMemo(() => [...strayOverCap, ...strayRemoved], [strayOverCap, strayRemoved]);

  function assign(label: string, cardId: string | null) {
    const next = { ...value };
    if (cardId) next[label] = cardId;
    else delete next[label];
    onChange(next);
  }

  /** 回到量框的那一帧。★ 同值赋 seekTo 不会触发跳转（VideoStage 只在值变了才跳），
   *  所以第二次点要给一个 epsilon —— 不给的话按钮会"点了没反应" */
  function backToFrame() {
    const at = boxAtSec ?? 0;
    setSeek((s) => (s === at ? at + 0.001 : at));
  }

  /**
   * 落点 → 哪个位子。**唯一实现**（拖拽中的高亮与松手时的判定读同一个函数，
   * 两处各写一遍必然分叉，而分叉的表现是"高亮的是这个、挂上的是那个"）。
   *
   * ★ 先看框内命中；一个都没命中就取**横向最近**且在阈值内的那个；再远就不算落点。
   * ★ 命中两个以上（重叠的人偶）时**全都返回**，由调用方去问用户 —— 不猜。
   */
  function hitSlots(clientX: number, clientY: number): number[] {
    const el = stageRef.current;
    if (!el || !boxes) return [];
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return [];
    const px = ((clientX - r.left) / r.width) * 1000;
    const py = ((clientY - r.top) / r.height) * 1000;
    if (px < 0 || px > 1000 || py < 0 || py > 1000) return [];
    const inside = dropIndexes.filter((i) => {
      const b = boxes[i];
      return Math.abs(px - b.cx) <= b.w / 2 && Math.abs(py - b.cy) <= b.h / 2;
    });
    if (inside.length > 0) return inside;
    const avgW = dropIndexes.reduce((a, i) => a + boxes[i].w, 0) / Math.max(1, dropIndexes.length);
    let best = -1;
    let bestD = Infinity;
    for (const i of dropIndexes) {
      const d = Math.abs(px - boxes[i].cx);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 && bestD <= avgW * NEAR_RATIO ? [best] : [];
  }

  /**
   * 落点 → 哪个**格子**（`castable` 的下标）。null = 没压在任何格子上。
   *
   * ★★ 与 `hitSlots`（画面上的人偶）是两条独立的路，理由见 DragState.overCell：
   *   画面落点是推断的（框会重叠、人会走动），格子落点是用户看着标签放的。
   * ★ 判定就是"点在这个格子的矩形里"，**没有"最近的凑合一下"那条兜底** ——
   *   格子是并排紧挨着的，往旁边找最近的等于把落点悄悄挪给邻居，而挂错人零报错。
   * ★ 量的是**当下的** getBoundingClientRect：格子行是可横向滚动的，缓存下来的坐标
   *   在用户滚过之后全是错的。
   */
  function hitCell(clientX: number, clientY: number): number | null {
    const el = stripRef.current;
    if (!el) return null;
    const cells = el.querySelectorAll<HTMLElement>("[data-cell]");
    for (const cell of cells) {
      const r = cell.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        const i = Number(cell.dataset.cell);
        return Number.isInteger(i) ? i : null;
      }
    }
    return null;
  }

  /**
   * 把一张卡从**最上面**那条卡轨拖出来 —— 手势细节全部照 `MaterialSheet.begin` 抄，别新发明：
   * ★ 必须用 pointer 事件（HTML5 `draggable` 在 Android WebView 的触摸下根本不触发）；
   * ★ 卡片与轨道**都是** `touch-action: pan-x`：横向留给轨道自己滚，竖向留给拖拽。
   *   卡片上写 `touch-none`（2026-08-17 那一版）看着更"干净"，实际是把轨道滚动整条关掉 ——
   *   触摸下横滑纹丝不动，而这条轨是**唯一**的选卡入口，卡一多后面那些就永远够不到。
   *   反过来完全不写又会让浏览器把竖向拖接管成页面滚动并发 `pointercancel`，
   *   拖拽在真机上时灵时不灵（桌面鼠标下两种毛病都看不出来，所以最容易漏过）。
   * ★ 方向优先仲裁：横向走得多就**彻底放手**（`start.current = null`），让浏览器去滚轨道；
   *   判据是"哪个方向走得多"而不是"有没有横向位移"——手指下滑总会带一点横向抖动。
   * ★ 只认**向下**拖：2026-08-17 版式改成「卡轨在上 → 画面在中 → 格子行在下」之后，
   *   两种落点（画面里的人偶、下面的格子）都在卡的**下方**；向上拖没有落点，让给页面滚动。
   *   （这段注释此前还写着"只认向上拖：画面在上面"，那是改版式之前的事。）
   */
  function beginDrag(card: Card) {
    return {
      onPointerDown: (e: RPointerEvent) => {
        // ★ 新手势起头，先把上一次可能没被消费掉的"吞一次 click"标记清掉（见 swallowClick）
        swallowClick.current = false;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false, card };
      },
      onPointerMove: (e: RPointerEvent) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (!s.active) {
          // ★ 横向占优：整条手势让给轨道自己滚（卡片是 touch-pan-x，浏览器接得住），
          //   我们**不接管**，也不再跟这次手势有任何关系
          if (Math.abs(dx) > Math.abs(dy)) {
            start.current = null;
            return;
          }
          // ★★ 只认【向下】拖：2026-08-17 版式改成「卡在上 → 画面在中 → 格子在下」之后，
          //   落点全在卡的**下方**。这一行原来是 `dy > -10`（只认向上），版式一改就等于
          //   把整条拖拽路关掉了 —— 而且是静默的：手指怎么拖都没反应，没有任何报错。
          if (dy < 10) return;
          s.active = true;
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* 合成事件/已失效指针没有可捕获的 pointerId —— 拖拽本身不受影响，
               只是拖出元素外会断（与 CropOverlay / FrameAnnotator 同一处理） */
          }
        }
        const hit = onFrame ? hitSlots(e.clientX, e.clientY) : [];
        setDrag({
          card: s.card,
          x: e.clientX,
          y: e.clientY,
          over: hit.length === 1 ? hit[0] : null,
          overCell: hitCell(e.clientX, e.clientY),
        });
      },
      onPointerUp: (e: RPointerEvent) => {
        const s = start.current;
        start.current = null;
        if (!s?.active) return;
        // ★★ 真拖过一次 → 吞掉浏览器紧跟着补发的那次 click（见 swallowClick 的 ★★）。
        //   必须在这里置位而不是在落点分支里：落不落得中都会补 click，而"落空的那一拖"
        //   补出来的 click 同样会把卡挂到当前选中的格子上
        swallowClick.current = true;
        setDrag(null);
        // ★★ **格子先判、且不问第二遍**：格子上明写着是哪个位子，用户是看着标签放上去的，
        //   没有任何可推断错的余地 —— 再问一句「是这个人吗」是纯粹的摩擦。
        //   （另一条入口「点格子选中 → 点卡轨上的一张卡」同样是直接落，两条行为一致。）
        // ★ 它排在画面判定**之前**：格子行就在画面下方，两者不重叠，但万一将来布局变了
        //   压在一起，"用户看得见标签的那个"永远该赢。
        const cell = hitCell(e.clientX, e.clientY);
        if (cell !== null) {
          const r = castable[cell];
          if (r) {
            assign(r.label, s.card.id);
            setFlash(r.label);
            setAsk(null);
            setAmbiguous(null);
          }
          return;
        }
        if (!onFrame) return;
        const hit = hitSlots(e.clientX, e.clientY);
        // ★ 一个都没命中：什么都不做（松手回弹）。★★ 绝不"最近的那个凑合一下" ——
        //   挂错人是零报错的，宁可让他再拖一次
        if (hit.length === 0) return;
        if (hit.length > 1) {
          setAsk(null);
          setAmbiguous({ card: s.card, slots: hit });
          return;
        }
        setAmbiguous(null);
        setAsk({ card: s.card, slot: hit[0] });
      },
      onPointerCancel: () => {
        start.current = null;
        setDrag(null);
      },
    };
  }

  /** 二次确认点了「就是他」。★ 「点错了」= 什么都不做（不落 cast）：
   *  落了再撤是两次状态变更，中间那一下会被宿主的草稿存下去 */
  function confirmAsk(card: Card, slot: number) {
    const label = dropSlots[slot];
    assign(label, card.id);
    setFlash(label);
    setAsk(null);
    setAmbiguous(null);
  }

  if (roles.length === 0) {
    // 空壳保护：服务端 roles 为空时本来就整句拒绝建模板，走到这儿只可能是老模板/老数据。
    // 给一句能读懂的解释，而不是一个空列表（空列表看起来就是"坏了"）
    return (
      <div className="space-y-3">
        <VideoStage src={videoUrl} disabled={busy} />
        <p className="rounded-lg border border-slate-700 bg-panel/60 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          这个白模模板没有登记角色位（它是更早版本做出来的）。它照样能用 —— 出片时会按
          「把白模人偶换成你挂的角色」这条通用说法来，只是不能逐个指定谁是谁。
        </p>
        {extra}
        {onDone && (
          <button
            onClick={onDone}
            disabled={busy}
            className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            {doneLabel}
          </button>
        )}
      </div>
    );
  }

  /** 格子下标 → `dropSlots` 下标（画面上那个框）。查不到 = 这个位子没有框 */
  const slotOfCell = (i: number) => {
    const label = castable[i]?.label;
    const at = label ? dropSlots.indexOf(label) : -1;
    return at >= 0 ? at : null;
  };
  /**
   * 标记 → 给人看的名字「人物N」。**唯一实现**，所有渲染点（卡轨那句提示、格子、
   * aria-label、二次确认、歧义列表、折叠清单、超限区）都从这里取。
   *
   * ★★ 这条注释此前是**假话**：它自称唯一实现，实际上「人物N」在本文件里被拼了七遍、
   *   算号的写法有五份（`selected + 1` / `i + 1` / `cellNoOfSlot` / `castable.length + i + 1`）。
   *   四份各自都对，所以改一处漏六处**没有任何症状** —— 只会变成同一个人在两个地方叫两个
   *   名字（比如二次确认说"人物3"、格子上写"人物4"），而挂错人零报错。
   * ★★ 编号空间只有一个：**`roles` 里的位次 +1**。`splitCastRoles` 是按原顺序切前后两半
   *   （castable / overflowRoles），所以超限区那几个"接着往下数"本来就是同一条编号，
   *   不需要 `castable.length + i` 这种在调用点复述一遍切分规则的算法。
   * ★ 查不到就返回中性说法而**不编一个号**：映射里的野标记（作者删过位子）在这块面板上
   *   本来就没有位次，编一个出来会指到别人身上。
   * ★ 按 label 查是稳的：一份 roles 里 label 唯一 —— `value` 就是按它做键，各处 React key
   *   也是它，重了的话这块面板早就不止"名字重了"这一个毛病。
   */
  const personNameOf = (label: string | undefined) => {
    const at = label ? roles.findIndex((r) => r.label === label) : -1;
    return at >= 0 ? `人物${at + 1}` : "这个位子";
  };
  /** 高亮哪个框：拖拽中压着的那个 / 正在二次确认的那个 / 选中格子对应的那个。
   *  ★ 拖拽期间**只听 drag**（哪怕它现在没压住任何位子）：写成 `drag?.over ?? ask?.slot`
   *    的话，手指离开所有人偶时会退回去高亮上一次确认框，等于告诉用户"松手会挂到那儿" */
  const litSlot = drag ? drag.over : (ask?.slot ?? (selected !== null ? slotOfCell(selected) : null));

  return (
    <div className="space-y-3">
      {/* ══ ①′ “这段素材里有个特别显眼的人” ══════════════════════
          ★★★ 这句话是 **2026-08-18 九发付费实拍的唯一产出**：当画面里有一个
            颜色异类、而且它就在正中时，r2v 会把卡换到**它**身上 —— 不管你挂给谁。
            序数、多维描述、连“这个不要换”的反向点名都推不动它（第三发还多赔了一个）。
          ★★ 不说的后果是铁律八那一类：用户认真挂完卡、付了 r2v 的钱，拿到一段换错人的片，
            而全程没有任何一层会喊。我们既然已经知道了，就得在他花钱**之前**说出来。
          ★ 带着一条**真能做的事**（拿原视频重走一遍 AI 白模化 → 人偶全变纯白），
            而不是只扔一句警告：白模化恰好打断了那个合取里的“颜色异类”一半。
          ★ 措辞里必须有“不重做也能用”与“看错了直接忽略”：它是尽力而为的启发式，
            不是闸（判据与完整复盘在 data/templates.prominentRoleWarning）。 */}
      {prominent && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
          {prominent}
        </div>
      )}

      {/* ══ ① 人物卡：一条横轨，摆在**最上面** ══════════════════════════════
          ★★ 2026-08-17 版式改成「卡在上 → 画面在中 → 格子在下」。此前卡在最下面，
            于是"拖卡"是**向上**拖、要越过整块画面；而挂卡的落点（格子）又在画面下方，
            手势方向与视觉顺序是拧着的。现在自上而下就是「拿哪张卡 → 给画面里的谁 → 落到哪一格」。
          ★ 只列**人物卡**（VideoEditorPage 一处过滤，没有开关）：白模人偶换的就是"人"。
          ★★ 轨道与卡片**都是** `touch-action: pan-x`（不是 `touch-none`）：竖向留给拖拽
            （不写的话浏览器把竖向拖接管成页面滚动并发 pointercancel，真机上拖拽时灵时不灵），
            横向留给这条轨自己滚。卡片上写 `touch-none` 会把横滚也一起关掉 —— 而删掉逐行
            选卡浮层之后这条轨是**唯一**的选卡入口，卡一多，右边那些就再也够不到了。
            两种毛病桌面鼠标下都看不出来（滚轮/拖拽都不受 touch-action 管），所以最容易漏过。 */}
      {castable.length > 0 && (
        <div className="space-y-1 rounded-lg border border-slate-700 bg-panel/50 px-2 py-2">
          <p className="flex items-center gap-2 px-1 text-[10px] text-slate-500">
            <span className="min-w-0 flex-1">
              {cards.length === 0
                ? "素材库里还没有可挂的人物卡"
                : selected !== null
                  ? `点一张卡，挂给「${personNameOf(castable[selected]?.label)}」`
                  : "先点下面一个格子，再点一张卡；也可以直接把卡拖到格子上"}
            </span>
            {/* ★★ 「取下」只在**选中的那一格已经挂着卡**时出现。没有它的话，挂错了
                就再也拿不下来 —— 选卡浮层删掉之后这里是唯一的出口。 */}
            {selected !== null && castable[selected] && value[castable[selected].label] && (
              <button
                onClick={() => {
                  const r = castable[selected];
                  if (r) assign(r.label, null);
                }}
                className="flex-none rounded-full border border-slate-600 px-2 py-0.5 text-[10px] text-slate-300"
              >
                取下
              </button>
            )}
            {/* ★ 这一屏没有标题栏（它嵌在编辑页里），所以 ? 贴在这一行的右端 */}
            <HelpButton tour="cast" className="flex-none" />
          </p>
          {cards.length > 0 && (
            <div data-guide="cast-card-rail" className="no-scrollbar flex gap-2 overflow-x-auto pb-1" style={{ touchAction: "pan-x" }}>
              {cards.map((c) => (
                <div
                  key={c.id}
                  {...beginDrag(c)}
                  // ★ 点一张卡 = 挂给**当前选中的格子**。没选中时不静默失败 ——
                  //   上面那句话已经说了"先点下面一个格子"，这里就什么都不做
                  onClick={() => {
                    // ★★ 刚拖完的那次 click 是浏览器补发的，不是用户点的 —— 吞掉它，
                    //   否则一次拖拽会额外挂出一条"挂给当前选中格子"的映射（见 swallowClick）
                    if (swallowClick.current) {
                      swallowClick.current = false;
                      return;
                    }
                    if (selected === null) return;
                    const r = castable[selected];
                    if (r) {
                      assign(r.label, c.id);
                      setFlash(r.label);
                    }
                  }}
                  // ★ touch-pan-x 而不是 touch-none：横滑要能滚这条轨（理由见上面那段 ★★）
                  className="w-[58px] flex-none touch-pan-x select-none active:scale-95"
                >
                  <div className="h-[86px] w-full overflow-hidden rounded-md border border-slate-700 bg-slate-800">
                    {c.cover ? (
                      <img src={c.cover} alt="" className="h-full w-full object-cover" draggable={false} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-lg opacity-40">🔮</div>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-slate-300">{c.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ★ 引导要圈的是**画面**，而 VideoStage 自己声明 props、不透传 rest；这里外面这层
          只是给它一个可量的盒子，不带任何 className —— 不引入任何布局变化
          （父级是 space-y-3 的纵向流，多一层无样式 div 的渲染结果一模一样）。 */}
      <div data-guide="cast-stage">
      <VideoStage
        src={videoUrl}
        disabled={busy}
        // ★ clip 在这里担两件事：把首帧预热钉在标记帧上（见 BOX_CLIP_SPAN_SEC 的 ★★），
        //   以及让"播一下看看"不会一路播远。没有位置框时一个字都不变（clip = null）
        clip={dragOn ? { startSec: boxAtSec as number, durSec: BOX_CLIP_SPAN_SEC } : null}
        seekTo={seek}
        onTime={dragOn ? setNowSec : undefined}
        overlay={
          dragOn
            ? () => (
                // ★ 整层 `pointer-events-none`：这块面板是能上下滚的，整层吃手势会把画面
                //   那 300px 变成滚不动的死区。落点判定走的是拖拽中的 clientX/Y + 这层的
                //   getBoundingClientRect，本来就不需要它接收事件
                <div ref={stageRef} className="pointer-events-none absolute inset-0">
                  {onFrame &&
                    dropIndexes.map((i) => {
                      const b = boxes![i];
                      const lit = litSlot === i;
                      const taken = !!value[dropSlots[i]];
                      return (
                        <div
                          key={dropSlots[i]}
                          className={`absolute rounded-md border-2 transition-colors ${
                            lit
                              ? "border-gold bg-gold/25"
                              : taken
                                ? "border-gold/50"
                                : "border-sky-300/70 bg-sky-300/10"
                          }`}
                          style={{
                            left: `${(b.cx - b.w / 2) / 10}%`,
                            top: `${(b.cy - b.h / 2) / 10}%`,
                            width: `${b.w / 10}%`,
                            height: `${b.h / 10}%`,
                          }}
                        >
                          {/* ★ 框上不写序数、也不写卡名：写了就是"本仓自己拼措辞"的入口，
                              而且一个 6 字标签会把小框整个盖住。列表里那一行才是权威 */}
                        </div>
                      );
                    })}
                </div>
              )
            : undefined
        }
      />
      </div>

      {/* 「画面点不了」+「那怎么认位子」—— 都要明说，而且只在真的点不了时说。
          ★★ 这段 2026-08-17 改版式时被整段删过一次，必须补回来：它是一条**条件触发的
            故障解释**（只有拿不到位置数据的模板才会遇到），本仓铁律八说这类解释要留在
            界面上、留在触发的那一刻 —— 搬进只弹一次的新手引导等于没说（tours.tsx 的
            文件头也明文禁止）。少了它，用户只会一直去戳画面，以为功能坏了。
          ★★ 判据只读 `dragOn` 这一处（拖拽层开不开的唯一实现），别在这儿另判一遍
            "有没有 boxes"——两份判断分叉的表现是"画面明明能拖，下面却写着点不了"。
          ★★ 编号方案那半句 2026-08-16 就改成实话了：「四面都印着同一个数、转过身也看得见」
            **从来没有被模型执行过**（实测每发只印一面，哪一面还不可控）。所以这里绝不指路
            "去人偶身上找记号"，只说标记本身长什么样 —— 一句过时的指路和一个坏功能没有区别。 */}
      {!dragOn && (
        <p className="rounded-lg border border-slate-700 bg-panel/60 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          这个模板<b className="text-slate-200">没有画面位置数据</b>，所以画面
          <b className="text-slate-200">点不了、也拖不上</b>：我们没有逐帧的人物位置，
          点画面必然点错人，而换错人<b className="text-slate-200">不会报错</b>，
          要等成片出来才看得见。
          <br />
          用下面的格子行挂就行：先点一个格子，再点上面卡轨里的一张卡（也可以把卡直接拖到格子上）。
          格子上那行小字是这个模板<b className="text-slate-200">原本的标记</b>（原样照抄、一个字没改）——
          画面上不会有框亮起来，「人物几」只是排序，认人得靠它和下面「每个位子原来是谁」。
        </p>
      )}

      {/* ══ 格子行：画面正下方，一个白模一个格子 ══════════════════════════
          ★★ 为什么要有它（2026-08-17 加）：此前唯一的"拖着挂"是**拖到画面上那个人偶身上**，
            而人偶一多，画面上的落点框就互相重叠 —— 压在两个上面时按设计是"不猜"，
            于是拖动全程一个框都不亮、松手才弹出一个歧义列表让你再点一次。人越多越难拖，
            而人多恰恰是最需要挂卡的时候。
          ★★ 格子行把同一件事变成**确定**的：格子明写着是哪个位子，用户看着它放，
            没有任何可推断错的余地。所以它落卡**不问第二遍**（画面那条路仍然问，
            因为那个落点是推断出来的）。
          ★ 两条路都留着：拖到画面上更直观（尤其人少的时候），格子行更可靠。
            判断只有一处（assign），两个入口不是两套逻辑。
          ★★ 它**不依赖 markBoxes**，所以对没有画面位置数据的老模板同样可用 —— 那批模板
            此前只能一行行点开选卡浮层挑卡，而那个浮层 2026-08-17 已经删了，这里就是它们
            唯一的挂卡入口。也正因如此，`!dragOn` 时格子上要补出原始标记（见下面的 MarkBadge）。 */}

      {castable.length > 0 && (
        <div data-guide="cast-slot-strip" className="rounded-lg border border-slate-700 bg-panel/50 px-2 py-2">
          <div ref={stripRef} className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1" style={{ touchAction: "pan-x" }}>
            {castable.map((r, i) => {
              const card = value[r.label] ? byId.get(value[r.label]) : undefined;
              const missing = !!value[r.label] && !card;
              const lit = drag?.overCell === i;
              return (
                <button
                  key={r.label}
                  data-cell={i}
                  // ★★ 点格子 = **选中**（选卡浮层已删，挑卡在上面那条卡轨）。有位置数据时
                  //   选中之后画面上对应那个框会亮起来 —— 那是"这一格是画面里的哪一个"最诚实
                  //   的答案（格子上写的「人物N」是中性名字，故意不承诺任何左右次序）。
                  //   没有位置数据时不会有框亮，所以格子上另外印出原始标记（见下面的 MarkBadge）。
                  //   再点一次取消选中：不给取消的话，用户想换一格时会先挂错一张。
                  onClick={() => setSelected((cur) => (cur === i ? null : i))}
                  disabled={busy}
                  className={`flex w-[72px] flex-none flex-col items-center gap-1 rounded-lg border p-1 disabled:opacity-40 ${
                    selected === i
                      ? "border-gold bg-gold/25"
                      : lit
                        ? "border-gold bg-gold/20"
                        : flash === r.label
                          ? "border-gold bg-black/20"
                          : card
                            ? "border-gold/50 bg-black/20"
                            : "border-dashed border-slate-600 bg-black/20"
                  }`}
                  aria-label={`${personNameOf(r.label)}${
                    dragOn ? "" : `（标记：${r.label}）`
                  }${card ? `（现在挂着 ${card.name}）` : "，还没挂卡"}`}
                >
                  {/* ★★ 有位置数据时这里**不写序数措辞**（「从左数第3个」那种）：它只有在画面里
                      的人真是整齐一排时才成立，而实测真实素材会重叠、会切镜头、人数会变 ——
                      印在格子上等于做一个我们自己都不保证的承诺。「人物N」是中性名字，
                      "到底是画面里哪一个"由**点它之后亮起来的那个框**回答。
                      ⚠ label 本身一个字没改，照旧原样进提示词（服务端算的、r2v 认的东西）。 */}
                  <span
                    className={`block w-full rounded-md px-1 py-0.5 text-center text-[11px] font-bold ${
                      selected === i ? "bg-gold/30 text-gold" : "bg-sky-500/20 text-sky-200"
                    }`}
                  >
                    {personNameOf(r.label)}
                  </span>
                  {/* ★★ 没有位置数据时（`!dragOn`）才补出**原始标记**：那时点格子不会有任何框
                      亮起来，「人物N」就只剩排序、回答不了"是画面里哪一个"——尤其是编号方案的
                      老模板，画面上那个数字是认人的唯一线索，界面上却一处都不显示它。
                      ★ 有位置数据时**不显示**：那时"是哪一个"由亮起来的框回答，再印一句序数
                        措辞就是上面那条 ★★ 说的"不保证的承诺"，两个答案还可能互相矛盾。
                      ★ 用 MarkBadge（原样显示标记的唯一实现）：编号要 tabular-nums、序数最长
                        6 个汉字得折行，自己再画一遍必然分叉。 */}
                  {!dragOn && <MarkBadge spec={spec} label={r.label} tone="muted" wrap />}
                  <span className="flex h-[52px] w-full items-center justify-center overflow-hidden rounded bg-slate-800">
                    {card?.cover ? (
                      <img src={card.cover} alt="" className="h-full w-full object-cover" draggable={false} />
                    ) : (
                      <span className="text-[10px] leading-tight text-slate-400">{missing ? "？" : "挂卡"}</span>
                    )}
                  </span>
                  {/* 挂了谁 / 还空着。★ 空着也占同样高度：不占的话整行会随挂卡进度忽高忽低 */}
                  <span className={`block w-full truncate text-center text-[9px] ${card ? "text-slate-200" : "text-slate-500"}`}>
                    {missing ? "卡已丢失" : (card?.name ?? "未挂")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}


      {/* 离开标记帧了：**把落点层隐去**并给一颗回跳键。
          ★ 框是**一帧**上量的，人是会走动的 —— 继续画一组过时的框，用户会照着它拖，
            而挂错人零报错。所以这里不是"提醒一下"，是真的把那一层关掉。 */}
      {dragOn && !onFrame && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-amber-200">
            离开标记帧了，这里的落点会不准（画面上的人已经走动过）—— 回到第 {(boxAtSec ?? 0).toFixed(1)} 秒再拖。
          </p>
          <button
            onClick={backToFrame}
            className="flex-none rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-ink"
          >
            回到标记帧
          </button>
        </div>
      )}

      {/* 二次确认。★ 摆在画面**下方**的内联条，不是弹窗、更不是 window.confirm：
          用户要一边看画面一边确认，遮住画面等于让他闭着眼点。
          ★★ 四行缺一不可：挂给谁、这个位子原来是谁（套用者认人的唯一依据）、卡面、
            以及"换错人不会报错"这句 —— 少了最后一句，这一问就退化成走过场。 */}
      {ask && (
        <div className="space-y-2 rounded-xl border border-gold/60 bg-gold/10 px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-slate-100">
            把「<b className="font-bold">{ask.card.name}</b>」挂到{" "}
            <b className="font-bold">{personNameOf(dropSlots[ask.slot])}</b> 身上？
          </p>
          <div className="flex items-start gap-2">
            <div className="h-16 w-[43px] flex-none overflow-hidden rounded-md border border-gold/70 bg-slate-800">
              {ask.card.cover ? (
                <img src={ask.card.cover} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-lg opacity-40">🔮</div>
              )}
            </div>
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-300">
              这个位子原来是：
              {castable.find((r) => r.label === dropSlots[ask.slot])?.desc || "（这个位子没有描述）"}
            </p>
          </div>
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            换错人<b className="font-bold">不会报错</b>，成片出来才看得见 —— 请对着画面上高亮的那个人偶确认。
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => confirmAsk(ask.card, ask.slot)}
              className="rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-ink"
            >
              就是他
            </button>
            <button onClick={() => setAsk(null)} className="rounded-full px-3 py-1 text-[11px] text-slate-300">
              点错了
            </button>
          </div>
        </div>
      )}

      {/* 落点同时压在两个人偶上（前后站位重叠）——**不猜**，摆出来让他点。
          ★ 宁可多问一次：误挂是零报错故障，而"猜一个"猜错了没有任何人会发现 */}
      {ambiguous && (
        <div className="space-y-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2.5">
          <p className="text-[11px] leading-relaxed text-amber-200">
            这一下同时落在 {ambiguous.slots.length} 个人偶上（他们在画面上叠着）——
            「{ambiguous.card.name}」要挂给哪一个？
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ambiguous.slots.map((i) => (
              <button
                key={dropSlots[i]}
                onClick={() => {
                  setAmbiguous(null);
                  setAsk({ card: ambiguous.card, slot: i });
                }}
                className="rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-100"
              >
                {personNameOf(dropSlots[i])}
              </button>
            ))}
            <button
              onClick={() => setAmbiguous(null)}
              className="rounded-full px-2.5 py-1 text-[11px] text-slate-300"
            >
              算了
            </button>
          </div>
        </div>
      )}

      {/* ══ 每个位子原来是谁 —— **默认折叠** ═══════════════════════════════
          ★ 加了格子行之后这一列的大部分内容重复了（标记、卡面、卡名、挂卡入口格子行都有），
            但它独有一样东西：每个位子的 `desc`（这个人偶在原视频里是谁）。编号方案的老模板
            尤其靠它认人。所以**收起来而不是删掉**。
          ★ 默认收起：用户抱怨过这一屏东西太多，而 desc 是"想不起来时才查"的信息，
            不是每次都要读的。 */}
      {castable.length > 0 && (
        <details className="rounded-lg border border-slate-700 bg-panel/40">
          <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-slate-400">
            每个位子原来是谁（{castable.length} 个）
          </summary>
          <div className="px-2 pb-2">
      <div className="space-y-2">
        {castable.map((r) => {
          const card = value[r.label] ? byId.get(value[r.label]) : undefined;
          /** 挂了一张这台设备上找不到的卡（换了账号/卡被删了）——必须说出来，
           *  否则界面显示"未挂卡"、映射里却还留着它，出片时按一个不存在的卡走 */
          const missing = !!value[r.label] && !card;
          return (
            <div
              key={r.label}
              className={`flex items-start gap-2.5 rounded-xl border bg-panel/50 p-2.5 ${
                // ★ 刚从画面上挂完的那一行同步高亮：画面与列表两个视图必须当场对上，
                //   否则用户不知道自己刚才动了哪一行
                flash === r.label ? "border-gold" : "border-slate-700"
              }`}
            >
              {/* ★ 与格子行同一个名字（同一个 personNameOf）。这一列是**只读的参考**：
                  挂卡只有格子行一条路，两个入口会让"我到底在哪儿挂的"变成一个问题 */}
              <span className="mt-0.5 flex-none rounded-md bg-sky-500/20 px-2 py-0.5 text-[11px] font-bold text-sky-200">
                {personNameOf(r.label)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-3 text-[11px] leading-relaxed text-slate-300">{r.desc}</p>
                {missing && (
                  <p className="mt-1 text-[10px] leading-relaxed text-rose-300">
                    这个位子挂着一张本机找不到的卡（可能已被删除或属于另一个账号）——请重新挂一张，
                    或取下它。
                  </p>
                )}
                {card && (
                  <p className="mt-1 truncate text-[11px] text-slate-200">
                    → <b>{card.name}</b>
                  </p>
                )}
              </div>
              {/* 只读卡面（挂/换/取下都在上面的格子行 + 卡轨）。
                  ★ 空着也占同样宽度：不占的话每一行会随挂卡进度左右跳 */}
              <div
                className={`flex h-16 w-[43px] flex-none items-center justify-center overflow-hidden rounded-md border ${
                  card ? "border-gold/70" : "border-dashed border-slate-600"
                } bg-slate-800`}
              >
                {card?.cover ? (
                  <img src={card.cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] leading-tight text-slate-400">{missing ? "？" : "未挂"}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
          </div>
        </details>
      )}


      {/* 超出上限的角色位：列出来（画面上真有这些人偶），但**不给挂卡按钮**，并说清它们会怎样。
          ★ 不摆一个点不动的按钮（本仓的老坑：界面上摆永远点不动的东西，用户只会觉得功能坏了），
            所以这里只有标记 + 描述 + 一句原因。 */}
      {overflowRoles.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-slate-700 bg-panel/60 px-3 py-2">
          <p className="text-[11px] leading-relaxed text-slate-300">
            这个模板认出了 {roles.length} 个人物，超过了一次能挂卡的 {BLOCKOUT_MAX_ROLES} 个上限。
            下面这 {overflowRoles.length} 个<b className="text-slate-200">会保持人偶原样、挂不了卡</b>
            （上限是 {BLOCKOUT_MAX_ROLES}，因为
            {ordinal ? "再多的人挤在一起，从左数到第几个也数不准了" : "再多的编号在画面上也认不出来了"}）。
          </p>
          {overflowRoles.map((r) => (
            <div key={r.label} className="flex items-start gap-2 opacity-60">
              {/* ★ 编号接着 castable 往下数（`personNameOf` 数的就是 roles 里的位次，
                  overflowRoles 是同一份 roles 的后半截，所以这里不用、也不许自己加偏移）：
                  画面上这些人偶真的站在那儿，只是挂不了卡 */}
              <span className="mt-0.5 flex-none rounded-md bg-slate-700 px-1.5 py-0.5 text-[11px] font-bold text-slate-300">
                {personNameOf(r.label)}
              </span>
              <p className="line-clamp-2 min-w-0 flex-1 text-[10px] leading-relaxed text-slate-400">{r.desc}</p>
            </div>
          ))}
        </div>
      )}

      {/* 挂在"挂不上的位子"上的卡：说清楚 + 一颗真能点的按钮（理由见 strayLabels 的 ★★） */}
      {strayLabels.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          {/* 分类说准，别并列猜（见 strayOverCap/strayRemoved 的 ★★） */}
          {strayRemoved.length > 0 && (
            <p className="text-[11px] leading-relaxed text-amber-200">
              {ordinal ? "「" : "编号 "}
              {strayRemoved.join(ordinal ? "」「" : "、")}
              {ordinal ? "」" : " "}上挂着的卡<b>不会生效</b>：模板作者在核对
              {ordinal ? "位置" : "编号"}时<b>删掉了这个位子</b>（多半是因为
              {ordinal ? "画面上那个人根本没被换成人偶" : "画面上根本找不到这个号"}）。那个人偶会保持原样出现。
            </p>
          )}
          {strayOverCap.length > 0 && (
            <p className="text-[11px] leading-relaxed text-amber-200">
              {ordinal ? "「" : "编号 "}
              {strayOverCap.join(ordinal ? "」「" : "、")}
              {ordinal ? "」" : " "}上挂着的卡<b>不会生效</b>：这些位子超出了一次能挂卡的{" "}
              {BLOCKOUT_MAX_ROLES} 个上限。
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-amber-200">出片前必须把它们取下。</p>
          <button
            onClick={() => {
              const next = { ...value };
              for (const label of strayLabels) delete next[label];
              onChange(next);
            }}
            disabled={busy}
            className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-ink disabled:opacity-40"
          >
            取下这 {strayLabels.length} 张
          </button>
        </div>
      )}

      {/* 正好排到上限：画面里可能还有别人。说一句，否则用户会以为"那个人是漏掉了"。
          ★ 只在到顶时说 —— 两三个角色位的模板上摆这句话是纯噪音 */}
      {overflowRoles.length === 0 && roles.length >= BLOCKOUT_MAX_ROLES && (
        <p className="rounded-lg border border-slate-700 bg-panel/60 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          这个模板已经排到一次能挂卡的上限（{BLOCKOUT_MAX_ROLES} 个）。画面里如果还有别人，
          {ordinal
            ? "他们同样是白色人偶，但清单里没有他们的位置，挂不了卡 —— 人再多，从左数到第几个也数不准了。"
            : "他们身上不会有编号，会保持白模人偶原样、也挂不了卡 —— 编号再多，画面上也认不出来。"}
        </p>
      )}

      {/* 没挂满不拦 —— 但必须说清没挂的会怎样（不说的话用户会以为"没挂 = 那个人不出现"）。
          ★★ 2026-08-17 这句话终于可以说得很轻：序数方案下人偶本来就是纯白的，没挂卡的位子
            在成片里就是一个白人偶（看起来像风格化）。颜色时代那笔债（画面里站着一个紫色
            塑料人，观众只会觉得是 bug，所以那一版要劝用户挂满）随颜色方案一起还掉了。 */}
      {emptyCount > 0 && (
        <p className="rounded-lg border border-slate-700 bg-panel/60 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          还有 {emptyCount} 个角色位没挂卡 —— <b>可以直接出片</b>，
          没挂的那些会保持白色人偶的样子（不会自动变成别人）。
        </p>
      )}

      {maxRefImages != null && mountedLabels.length > maxRefImages && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          ⚠ 已挂 {mountedLabels.length} 张，超过一次出片能带的 {maxRefImages} 张参考图上限。
          多出来的会在出片时按出片管线既有的规则被挤掉 —— 建议你自己减到 {maxRefImages} 张，
          免得被挤掉的正好是最要紧的那张。
        </p>
      )}

      {extra}

      <div className="flex gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-none rounded-xl border border-slate-600 px-4 py-2.5 text-sm text-slate-300 disabled:opacity-40"
          >
            取消
          </button>
        )}
        {onDone && (
          <button
            onClick={onDone}
            disabled={busy}
            className="min-w-0 flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            {doneLabel}
          </button>
        )}
      </div>


      {/* 跟手的卡影。★ createPortal 到 body：祖先上任何一个 backdrop-blur / transform 都会给
          `position: fixed` 的后代造包含块，卡影会被钉在那个盒子里（CLAUDE.md 的坑） */}
      {drag &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[80] h-[86px] w-[58px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border-2 border-gold bg-slate-800 opacity-90 shadow-lg"
            style={{ left: drag.x, top: drag.y }}
          >
            {drag.card.cover ? (
              <img src={drag.card.cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg opacity-40">🔮</div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
