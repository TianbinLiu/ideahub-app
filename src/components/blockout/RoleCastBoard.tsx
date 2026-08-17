// 视频编辑页【模式二 · 套用挂卡】：放白模模板视频 + 列出它的角色位，
// 一个角色位挂一张人物卡，产出 `标记 → cardId` 的映射交给上层去合成提示词。
//
// ★★ 挂卡有**两条路**，第二条 2026-08-17 才有，而且**必须有位置数据才开**：
//   ① **点列表**（永远都在）：点某一行的卡位 → `CardPickSheet` 选卡。老模板、以及任何
//      拿不到 `markBoxes` 的模板只有这一条。
//   ② **拖到画面上**（`markBoxes` 与 `markSlots` 长度相等、且知道那些框量自第几秒才开）：
//      把下面那排卡拖到画面里那个人偶身上，松手后**必须再确认一次**。
//   ⚠ 这条路当年被明确否掉过（"我们没有逐帧的人物包围盒/分割数据，点画面必然点错人"）。
//   今天能开，唯一的原因是**服务端在看帧那一步真的把框量出来了**并跟着模板下发。
//   所以判据是**存在性**，缺一个框就整层关掉（`markBoxesOf` 在收货那一层已经整份丢掉）：
//   局部可拖会让用户以为"这个人拖不了 = 坏了"，而挂错人是零报错的。
//   ★ 关掉时界面上**一点可点的暗示都不给**（不加光标手型、不加悬停高亮），并明说一句
//     为什么 —— 不说的话用户会一直去戳画面，以为是坏了。
//
// ★★ 标记（`label`）**原样用**，绝不重编、绝不换近义说法：编号方案下实测白模人偶身上的数字
//   稳定但**不连续**（一发四个人偶实出 1/2/4/5，见 types.ts 的 ★★）；序数方案下把
//   "从左数第3个"写成"第三个"是同一种错法。按下标显示成 1..N 的话，用户对着屏幕上的 "4" 号
//   点了列表里的第 3 项，映射就错了位。
//
// ★★ 两种标记方案，界面按 `spec` 分支（判据的唯一实现在 data/templates.markSpecOf）：
//     · 序数：人偶**全都是一模一样的纯白色**，身上什么都没印 —— 唯一的线索是**站位**，
//       所以引导语说的是"从左往右数"，不是"找记号"；
//     · 编号（存量老模板）：数字**只印在人偶的某一面**（多半是额头或后脑），转过身就没了。
//   "前后左右四面都印着同一个数"那句老引导是全 app 最硬的一句假承诺（实测从没被执行过），
//   两条路的文案都必须说实话 —— 一句过时的指路和一个坏功能长得一模一样。
//
// ★ 只收 props、不认识任何 store（PlanBoard 同款约束）：可挂的卡由宿主给。
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import CardPickSheet from "./CardPickSheet";
import MarkBadge from "./MarkBadge";
import VideoStage from "./VideoStage";
import type { TemplateRole } from "./arkVideoRules";
// ★ 角色位上限、"哪几个能挂卡"、"这个模板是哪种标记方案"全部取自 data 层（一处实现）——
//   这里只负责把它们画出来，不复述判断，更**不许**在本文件里出现任何序数措辞常量
//   （data/templates 那段 ★★★）
import { BLOCKOUT_MAX_ROLES, splitCastRoles, type MarkSpec } from "../../data/templates";
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

/** 拖拽中的那张卡（跟手卡影 + 当前压在哪个框上）。null = 没在拖 */
interface DragState {
  card: Card;
  x: number;
  y: number;
  /** 压在 `spec.slots` 的第几个上；null = 没压在任何位子上 */
  over: number | null;
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
  /** 正在给哪个角色位挑卡；null = 没开浮层 */
  const [picking, setPicking] = useState<TemplateRole | null>(null);
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

  /** 画面覆盖层的根节点：落点换算只量它（它正好等于画面本身，见 VideoStage 文件头 ★★） */
  const stageRef = useRef<HTMLDivElement>(null);
  /** 一次拖拽的起点。★ 与 MaterialSheet.begin 同款：方向仲裁 + pointer capture */
  const start = useRef<{ x: number; y: number; id: number; active: boolean; card: Card } | null>(null);

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
   * 把一张卡从下面那排拖出来 —— 手势细节全部照 `MaterialSheet.begin` 抄，别新发明：
   * ★ 必须用 pointer 事件（HTML5 `draggable` 在 Android WebView 的触摸下根本不触发）；
   * ★ 卡片自己 `touch-none`、外层轨道 `touchAction: pan-x`：不写的话浏览器把竖向拖接管成
   *   页面滚动并发 `pointercancel`，于是拖拽在真机上时灵时不灵（桌面鼠标下一切正常，
   *   所以这种 bug 最容易漏过）；
   * ★ 方向优先仲裁：横向走得多就让给轨道自己滚。落点在**上方**（画面在这排卡上面），
   *   所以只认向上拖 —— 向下拖没有语义，让给页面滚动。
   */
  function beginDrag(card: Card) {
    return {
      onPointerDown: (e: RPointerEvent) => {
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false, card };
      },
      onPointerMove: (e: RPointerEvent) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (!s.active) {
          if (Math.abs(dx) > Math.abs(dy)) {
            start.current = null; // 让给轨道横向滚
            return;
          }
          if (dy > -10) return; // 只认【向上】拖：画面在上面
          s.active = true;
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* 合成事件/已失效指针没有可捕获的 pointerId —— 拖拽本身不受影响，
               只是拖出元素外会断（与 CropOverlay / FrameAnnotator 同一处理） */
          }
        }
        const hit = onFrame ? hitSlots(e.clientX, e.clientY) : [];
        setDrag({ card: s.card, x: e.clientX, y: e.clientY, over: hit.length === 1 ? hit[0] : null });
      },
      onPointerUp: (e: RPointerEvent) => {
        const s = start.current;
        start.current = null;
        if (!s?.active) return;
        setDrag(null);
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

  /** 高亮哪个框：拖拽中压着的那个，或者正在二次确认的那个。
   *  ★ 拖拽期间**只听 drag**（哪怕它现在没压住任何位子）：写成 `drag?.over ?? ask?.slot`
   *    的话，手指离开所有人偶时会退回去高亮上一次确认框，等于告诉用户"松手会挂到那儿" */
  const litSlot = drag ? drag.over : (ask?.slot ?? null);

  return (
    <div className="space-y-3">
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

      {/* 怎么认位子 + 能不能点画面 —— 都要明说。
          ★★ 编号那半句 2026-08-16 改成了实话：「四面都印着同一个数、转过身也看得见」
            **从来没有被模型执行过**（实测每发只印一面，哪一面还不可控）。用户照着那句话
            去转身找号，找不到只会以为功能坏了 —— 一句过时的指路和一个坏功能没有区别。
          ★ 序数那半句是这次唯一能说的一句**更好的实话**：人偶全都一模一样，
            位置本来就是画面上唯一稳定的线索，不需要在人偶身上找任何记号。 */}
      <p className="text-[11px] leading-relaxed text-slate-400">
        {ordinal ? (
          <>
            人偶全都<b className="text-slate-200">一模一样</b>（纯白、没有编号也没有颜色），
            靠<b className="text-slate-200">从左往右数第几个</b>来认位子，在下面找到同一个位置挂卡。
          </>
        ) : (
          <>
            对着画面记住人偶<b className="text-slate-200">头上那个数字</b>（编号只印在某一面，
            多半是额头或后脑 —— 转过身可能就看不见了，拖动进度条找到能看清的那一帧），
            在下面找到同一个数字挂卡。
          </>
        )}
        {dragOn ? (
          <>
            {" "}
            也可以<b className="text-slate-200">直接把下面的卡拖到画面上那个人偶身上</b>，
            松手后会问你一句「是这个人吗」。
          </>
        ) : (
          " 画面本身点不了：这个模板没有画面位置数据，点画面必然点错人（换错角色是不会报错的，只有你自己能看出来）。"
        )}
      </p>

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
            把「<b className="font-bold">{ask.card.name}</b>」挂到 <b className="font-bold">{dropSlots[ask.slot]}</b>{" "}
            的人偶上？
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
                {dropSlots[i]}
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

      {/* 可拖的卡：一条横轨。★ 轨道 `touchAction: pan-x` + 卡片 `touch-none`（见 beginDrag 的 ★） */}
      {dragOn && (
        <div className="space-y-1 rounded-lg border border-slate-700 bg-panel/50 px-2 py-2">
          <p className="px-1 text-[10px] text-slate-500">
            {cards.length > 0 ? "按住一张卡往上拖到画面里那个人偶身上" : "素材库里还没有可挂的人物卡"}
          </p>
          {cards.length > 0 && (
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" style={{ touchAction: "pan-x" }}>
              {cards.map((c) => (
                <div key={c.id} {...beginDrag(c)} className="w-[58px] flex-none touch-none select-none active:scale-95">
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
              <MarkBadge spec={spec} label={r.label} className="mt-0.5" />
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
              <button
                onClick={() => setPicking(r)}
                disabled={busy}
                className="flex-none disabled:opacity-40"
                /* ★ 不硬拼「N 号」：序数方案下那会读成"从左数第3个号"。用「」把标记括起来，
                   两种方案都读得通（「从左数第3个」人偶 /「4」人偶） */
                aria-label={card ? `换掉「${r.label}」人偶的卡` : `给「${r.label}」人偶挂卡`}
              >
                <div
                  className={`flex h-16 w-[43px] items-center justify-center overflow-hidden rounded-md border ${
                    card ? "border-gold/70" : "border-dashed border-slate-600"
                  } bg-slate-800`}
                >
                  {card?.cover ? (
                    <img src={card.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[10px] leading-tight text-slate-400">{missing ? "？" : "挂卡"}</span>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>

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
              <MarkBadge spec={spec} label={r.label} tone="muted" small className="mt-0.5" />
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

      {picking && (
        <CardPickSheet
          label={picking.label}
          spec={spec}
          desc={picking.desc}
          cards={cards}
          currentId={value[picking.label]}
          onPick={(c) => {
            assign(picking.label, c.id);
            setFlash(picking.label);
            setPicking(null);
          }}
          onClear={() => {
            assign(picking.label, null);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}

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
