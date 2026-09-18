// 每一屏的引导内容 —— **全仓唯一的一份**。
//
// ★★ 为什么内容集中在这里，而不是各页各写一段：引导是"把常驻说明从界面上搬走"的
//   容器。散回各页 = 说明文字还在各页，只是换了个组件名，减法一点没做成。
//   集中还带来一个可核对的好处：一眼看得出**哪几屏已经有引导、哪几屏还没有**。
//
// ★★★ 什么该写进来、什么绝不许写进来（判据在 data/guide.ts 的文件头，这里复述结论）：
//   ✅ 这个功能是什么、怎么用、会发生什么 —— 第一次进来看一遍就够的常驻说明。
//   ❌ **条件触发的故障解释**（离线 / 没登录 / 服务端没这个能力 / 余额不足 /
//      已发布不能改 / 超上限 / 删掉这个位子会怎样）。它们必须留在界面上：
//      引导看过一次就不再自动弹，把故障解释藏进去 = 静默失败（铁律八）。
//   ⚠ 这条在写这批内容时**真的挡下了东西**：首页那份原本想写"没关注过的会挂一个 + 号"，
//     而未登录时那枚 + 根本不渲染；改法不是补一句"登录后才有"（那就是把登录态解释
//     写进了引导），而是只给它命名、不承诺它一定在。
//
// ★★ 数字一律**插值**，不许照抄一个字面量。CLAUDE.md 已有一条「『最多出几张卡』的上限
//   自己抄一份」的事故（界面按 6 张报价、实际铸了 8 张，两个方向都不报错）。
//   引导里再抄一份数字就是同一个坑第三次。本文件目前插这几处（选段窗口、卡种列表、自制卡的比例上限、内置方案名与图位名），
//   其余各屏都是**有意不给数**：那些数界面上当下那一刻自己会报（报价行、按钮标签），
//   引导抄哪一个都是在造第 N 个需要维护的镜像。
//
// ── 锚点 ────────────────────────────────────────────────────────────
// `anchor` 指的是页面上带 `data-guide="..."` 的那个元素，引导会给它画一个高亮圈。
// ★ 找不到**不是错误**：那一步自动退成居中卡片，照样能读（见 GuideOverlay 的 FIND_TRIES）。
//   所以给条件渲染的元素挂锚点是安全的 —— 但也意味着**锚点写错了不会报错**，
//   只会安静地少一个圈。加锚点时对着页面看一眼。
// ⚠ 别把锚点挂到「只在某个下标成立」的元素上（例：轮播里的第一张卡）：用户在自动弹的
//   那 420ms 里划走、或者事后点 `?` 重看时轮播停在别处，圈就会画到**视口外** ——
//   而 off-screen 元素的 getBoundingClientRect 仍返回非零宽高，退化成居中卡片那条
//   兜底**不会**触发。要挂就挂到"当前那一张"上。
//
// ── 这批内容是怎么来的 ──────────────────────────────────────────────
// 8 屏各写一稿，再各由一个只读源码的审查者逐条对着实现核。审查抓到的真问题包括：
// 首页那份指向了一个**已经删掉的功能**（"分段剧情"，VideoPage 里写着删除理由）、
// 把发弹幕键说成"下面有计数"（它有意显示的是字不是数）、工坊那份漏了一种卡且改了卡种名。
// ⇒ 改这里的任何一句之前，先去对应组件里对一遍实现。这些话是**会被用户当真**的。
import type { ReactNode } from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
// 自制卡那份要点名内置方案：名字是读到时现翻的 getter（#272），顺序与选方案小窗同一个出处（listSchemes）。
// ★ promptSchemes 是叶子模块（只依赖 types），从这里引它不成环
import { listSchemes } from "../../data/promptSchemes";
import { BLOCKOUT_INPUT_RULES } from "../../data/templates";
import { BUILTIN_SLOT_ZH, CARD_TYPES, CARD_TYPE_LABELS, builtinSlotLabel } from "../../types";
// 自制卡那份要报比例上限：方舟的硬约束，数只能从这里取（数字一律插值，见 ★★）
import { REF_MAX_RATIO } from "../../utils/image";

export interface GuideStep {
  /**
   * 卡片标题（GuideOverlay 的 h2，手机宽度下单行截断 —— 英文控制在四个词上下）。
   * ★ 只收 msg 描述符（2026-09-17 多语言 T4 收口；T1~T3 分批迁这份文件的过渡期里还认中文字符串）：
   *   字符串标题不进目录，英文界面里就是一句中文、而且零报错 —— 现在写成字符串 tsc 当场报错。GuideOverlay 渲染时用 useLingui 的 t 翻。
   *   ⚠ 别写 t`…`：TOURS 在模块顶层，那一刻就翻会冻结在开机语言（check-i18n 会拦）。
   */
  title: MessageDescriptor;
  /** ★ 整段包一个 <Trans>（一步一条 msgid，别按句切）：它渲染时才查目录，放在模块顶层也跟得上切语言 */
  body: ReactNode;
  /** 要高亮的元素上 `data-guide` 的值。不给 = 这一步只讲话，卡片居中 */
  anchor?: string;
}

export interface GuideTour {
  id: string;
  /** 这一屏的名字，只进无障碍标签与调试。★ 形状同 GuideStep.title（只收 msg 描述符） */
  title: MessageDescriptor;
  /**
   * 版本号。★ **只在有意要让所有人重看一遍时才加**（比如这一屏改版到老引导会误导人）。
   *   平时改错别字不要动它 —— 用户明确要的是"弹过一次不再自动弹"。
   */
  version: number;
  steps: GuideStep[];
}

/**
 * 卡种列表（「人物卡 / 场景卡 / …」）：「卡片工坊」第 1 步把它插在 <Trans> 里，成一个 <n/> 占位。
 * ★ 做成组件、别在 TOURS 里直接 map：TOURS 在模块顶层求值，CARD_TYPE_LABELS 的 getter（types.liveLabels）
 *   会在 import 那一刻就被读掉，卡种名冻结在开机语言 —— <Trans> 里直接写那个表达式也一样（它被提前求值进 values）。
 *   组件是渲染时才读，切语言跟得上。卡种名本身不进 msgid（数字 / 卡种一律插值，见文件头 ★★）。
 */
function CardKindList() {
  return <>{CARD_TYPES.map((k) => CARD_TYPE_LABELS[k]).join(" / ")}</>;
}

/**
 * 「提取模板」第 5 步的正文。★ 单独做成组件、别直接写在 TOURS 里：选段窗口那两个数要先取名（minSec / maxSec），
 *   译文读到的才是 {minSec}~{maxSec}、不是 {0}~{1}；而 TOURS 在模块顶层求值，取名这一下放到渲染时做
 *   （与上面 CardKindList 同一个理由）。数照旧只从 BLOCKOUT_INPUT_RULES 取，别手写 5 / 30（文件头 ★★）。
 */
function BlockoutRoutesBody() {
  const minSec = BLOCKOUT_INPUT_RULES.minSec;
  const maxSec = BLOCKOUT_INPUT_RULES.maxSec;
  // ★ 2026-09-17 订正（未升 version —— 主人 09-11 定：订正不重弹）：自带白模片那条 2026-09-05 起拆成两屏 —— 第 1 屏只框选段与裁剪
  //   （不花钱，键是「下一步：挑 AI 分析帧」，拖过上限变成「下一步：标切段刀」），第 2 屏在框出来的那一段上定分析帧 / 切段刀、填标题、
  //   读报价、点「做成模板（不出片）」（VideoTemplateExtractor 的 ownRefStep 与 BoxFramePicker 的 axis="clip"）。原稿「读完报价才开炼」
  //   只对让 AI 换白模那条成立（它仍是一屏：BlockoutTrimmer 报两笔 +「开始白模化」）。
  //   TOURS 里第 5 步那段 2026-08-23 的注释「说的事一个字没变」说的是当时撤锚点那一次，不是这一次。
  //   ★ 订正记在这里、不记在 TOURS 那一步上：正文在这个组件里，订正与正文同一处、整块取舍。
  return (
    <Trans>
      选文件 → 上传（<b className="font-bold text-slate-100">不花钱</b>）→ 下一步拖时间轴框出 {minSec}~
      {maxSec} 秒、拖裁剪框把台标水印框到画面外。让 AI 换白模那条就在这一屏读完报价、点「开始白模化」才开炼；
      自带白模片那条这一屏不花钱，点「下一步：挑 AI 分析帧」去下一屏，在框出来的那一段上定 AI 分析哪几帧（自动或自己挑），
      报价也在那一屏、点「做成模板（不出片）」之前整句报出
      （把选段拖过上限，会自动变成<b className="font-bold text-slate-100">整条切段登记成一组</b>，那颗键换成「下一步：标切段刀」，按段计费）。
      让 AI 换白模那条还要注意：换人偶<b className="font-bold text-slate-100">不是每次都全对</b>，最容易漏画面正中央那一个——
      出片后对着画面从左往右核对，对不上的位子删掉就行（不用重炼、不花钱）。
    </Trans>
  );
}

/**
 * 「自己传图做卡片」第 2 步的正文。★ 做成组件的理由同上面两个：三套内置方案的名字是读到时现翻的 getter（promptSchemes.builtinScheme，#272），
 *   写死在 <Trans> 里英文界面会念出三个中文名；TOURS 在模块顶层求值，读 getter 要放到渲染时
 *   （引导开着时整屏锁死、切不了语言；关了再开是重新挂载，跟得上）。
 * ★ 顺序不手排：与选方案小窗同一个出处 listSchemes（无脸优先），只留内置的三套。
 */
function SchemePickBody() {
  const schemeNames = listSchemes("character")
    .filter((s) => s.builtin)
    .map((s) => s.title)
    .join(" / ");
  // ★ 2026-09-17 订正（未升 version —— 主人 09-11 定：订正不重弹）：最后一步页面顶栏写的是「④ 定名完成」（CustomCardPage 的 PageHeader 那行步骤名），
  //   原稿写成了「定名铸卡」（像的是上一步那颗键「下一步：定名与铸卡 ›」）。TOURS 里 version 4 那段注释用的还是老叫法。
  //   ★ 订正记在这里、不记在 TOURS 那一步上：正文在这个组件里，订正与正文同一处、整块取舍。
  return (
    <Trans>
      第 1 屏只做一件事：<b className="font-bold text-slate-100">挑卡种</b>。点「人物卡」会弹一扇小窗，
      <b className="font-bold text-slate-100">看图挑一套图位方案</b>（{schemeNames}），或者选<b className="font-bold text-slate-100">「真人素材扫脸认证」</b>——那条路先做
      肖像授权（授权照片自动填进卡面）、跟读录音或上传本地音频。之后人物卡按四步走：
      <b className="font-bold text-slate-100">选来源 → 图位预览 → 人物信息 → 定名完成</b>。
    </Trans>
  );
}

/**
 * 「自己传图做卡片」第 3 步的正文。★ 引的那个图位名（全身立绘）同样走显示名 getter（types.builtinSlotLabel，#272），
 *   退路照 promptSchemes.builtinSlot 的写法：不认得的 id 退回冻结原名。
 */
function SlotRulesBody() {
  const fullBody = builtinSlotLabel("fullBody") ?? BUILTIN_SLOT_ZH.fullBody;
  // ★ 2026-09-17 订正（未升 version）：① 「⭕ 圈选改图」只长在人物卡的格子上（CustomCardPage 图位区 isChar 那一支；其余卡种只有「换一张 / 移除」）；
  //   ② 原稿「改坏了不扣钱」拿掉，改指键上的价签（那颗键写的是「⭕ 圈选改图（价）」）。★ 别换成「没改成不扣钱」：远端模式下服务端先扣钱、再转发，
  //   没等到回包 / 回包读不出 / 图没取回来都算「没改成」、钱却可能已经扣了（arkClient 的 ArkNoReply 那段 ★★；同页 recognize() 为此分三档说话）—— 引导不许这个诺。
  return (
    <Trans>
      人物卡的图位由<b className="font-bold text-slate-100">方案</b>决定（格数也随方案走）；其余卡种由卡种决定
      （一把剑不该有「{fullBody}」）。<b className="font-bold text-slate-100">第一格既是卡面也是主形象参考</b>：
      卡框是竖版 2:3，别的比例会居中显示，不裁你的图。人物卡已有图的格子可以
      <b className="font-bold text-slate-100">⭕ 圈选改图</b>：圈出要改的地方写一句要求，AI 重画这一格
      （单张图的价，价钱印在那颗键上）。
    </Trans>
  );
}

/**
 * 「自己传图做卡片」第 4 步的正文。★ 比例上限照旧只从 utils/image 取（文件头 ★★），挪进组件是让读数发生在渲染时。
 *   标识符自己就是占位符的名字：译文里是 {REF_MAX_RATIO}，同一条里出现两次、两处都得留着。
 */
function RefImageBody() {
  // ★ 2026-09-17 订正（未升 version）：2026-09-10 起道具卡两格的图都先过「只留主体」层（CustomCardPage.onFile 里 type === "prop" 那一支 → PhotoSubjectPicker），
  //   不走「越界居中裁」那条（utils/image 的 composeSubjectImage：抠出来的主体铺 3:4 浅灰底，保留背景时越界是补边）。补一句把道具卡单拎出来；怎么框怎么描由那一层自己讲。
  return (
    <Trans>
      相册原图直接选：会自动压到 AI 认得出的尺寸，长宽比超过 {REF_MAX_RATIO}:1 的会被居中裁进
      {REF_MAX_RATIO}:1（方舟不收更极端的参考图），裁过会在那一格里写明。道具卡多一步：选图后要先框出那件道具、沿边描一圈，只留主体。出片时
      <b className="font-bold text-slate-100">不是每张都会喂进模型</b>：取几张要看这张卡在那一段里
      排第几、同段还挂了几张卡 —— 详情页会逐张标「出片用 / 仅展示」，那里是唯一的判据。
    </Trans>
  );
}

/** 全部引导。★ 新增一屏就在这里加一条，别在页面里塞第二份内容 */
export const TOURS: GuideTour[] = [
  {
    id: "feed",
    title: msg`首页视频流`,
    version: 1,
    steps: [
      {
        title: msg`上下滑着看`,
        body: (
          <Trans>
            整屏一支，上下滑换下一支——划到哪支哪支就自动播，<b className="font-bold text-slate-100">划走就停下、划回来从头播</b>。<b className="font-bold text-slate-100">单击暂停</b>，再点一下接着放；<b className="font-bold text-slate-100">双击点赞</b>，连点两下只会点亮、不会取消。顶上的「关注 / 推荐」切换看谁的作品。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-17 订正（主人点名核一遍新版引导；未升 version —— 主人 09-11 定：订正不重弹）：四枚里只有点赞、评论下面是数字
        //   （FeedPage 的 RailBtn 拿到的 label 是 String(likes) / String(commentCountOf(video))）；收藏与分享 2026-08-30 起**有意**只写名字 ——
        //   服务端没有收藏端点、`VideoItem.shares` 全仓没人写过，摆一个只反映自己点了几下的数会让作者据此判断作品受不受欢迎
        //   （那两颗 RailBtn 头上的 ★★ 各写了一段理由）。本文件头记着「把发弹幕说成『下面有计数』」那次同类错，这次落在它下面两颗上。
        //   ★ 两个数不是同一种东西，所以括号里各说各的：赞是**人数**（一人一票），评论那个是**条数**
        //     （commentCountOf = commentCount ?? comments.length —— 一个人能发好几条）。原稿那句「有多少人做过」一口气盖了四枚，
        //     订正后范围窄到两枚，这半句反而更要说准：说窄了的错会被当成准话读。
        title: msg`右边那一列`,
        anchor: "feed-rail",
        body: (
          <Trans>
            最上面是<b className="font-bold text-slate-100">作者头像</b>（点进主页，下面那枚 + 号关注）。往下第一枚是发弹幕；再往下点赞、评论、收藏、分享，<b className="font-bold text-slate-100">点赞和评论下面是数字</b>（多少人点过赞、有多少条评论），收藏和分享下面写的是名字、不报数。评论就地滑出来，不用离开这一屏。
          </Trans>
        ),
      },
      {
        title: msg`底下那条细线`,
        anchor: "feed-progress",
        body: (
          <Trans>
            底缘那条细线是<b className="font-bold text-slate-100">播放进度</b>，右上小字是当前 / 总时长，按住能<b className="font-bold text-slate-100">拖着跳到任意一处</b>。多段的作品，这条线走的是整片。
          </Trans>
        ),
      },
      {
        title: msg`标题进详情页`,
        anchor: "feed-title",
        body: (
          <Trans>
            <b className="font-bold text-slate-100">点标题进详情页</b>——本片卡组、多 P 选集、完整简介、「互动 · 你来选」的分支，都<b className="font-bold text-slate-100">只在那儿</b>。点作者名或头像，去的是他的主页。
          </Trans>
        ),
      },
      {
        title: msg`全屏与转屏`,
        anchor: "feed-fullscreen",
        body: (
          <Trans>
            那一列最下面单独一枚是全屏键，点了只留画面；<b className="font-bold text-slate-100">横屏的片子会连屏幕一起转过来</b>，所以它在横屏片上写的是「转屏」。退出点右上角那枚缩小键。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "create",
    title: msg`创作入口`,
    // version 2（2026-08-30）：轮播换成一张卡的正反面，工作流并进工坊 —— 老文案教的
    // 「左右滑动/边上的箭头/底部圆点」在页面上全都不存在了
    version: 2,
    steps: [
      {
        title: msg`挑一种创作方式`,
        anchor: "create-dots",
        body: (
          <Trans>
            底栏的 ➕ 先落到这里。这是<b className="font-bold text-slate-100">一张卡的正反面</b>：正面工坊、背面简约，点右上角那枚按钮翻面（上面写着背面是谁）。两面<b className="font-bold text-slate-100">不是各走各的</b>，而是同一条流水线的两个入口，最后都汇到剪辑与发布。
          </Trans>
        ),
      },
      {
        title: msg`挑定了就进去`,
        anchor: "create-cta",
        body: (
          <Trans>
            挑定了就点卡片底部那枚按钮：工坊落到 3D 铸卡桌面（顶栏 🧩 随时把同一条流水线换成<b className="font-bold text-slate-100">工作流画布</b>那一面），简约落到一步一屏的向导。出片之后都汇到<b className="font-bold text-slate-100">同一个剪辑页</b>，再从那里发布。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "flow",
    title: msg`简约出片`,
    // v2（2026-08-28 重写）：老版讲的是「先推三套方案、逐段解锁、节点条」那套线性
    // 单段 UI —— 2026-08-23 线性视图下线后，这份引导唯一还能弹出的地方是**简约模式**，
    // 而简约恰好一个特性都对不上（单段、不推方案、不存草稿）。FlowPage 当时把自动弹
    // 关掉、注明"简约独立成页之后要改写它"，这次照办：整份按简约那一屏重写，
    // 升版本让所有人重看（老引导教的是屏幕上不存在的操作，正是该升版的那种错）。
    version: 2,
    steps: [
      {
        title: msg`写一句话就出片`,
        anchor: "flow-simple-plot",
        body: (
          <Trans>
            简约模式只有一段、<b className="font-bold text-slate-100">不推方案</b>：在这里写清想拍什么，
            出片直接照它来。套了模板的话由配方管画风与分镜；
            <b className="font-bold text-slate-100">带角色位的白模模板</b>，这一块换成挂卡入口——把你的角色卡挂到画面里的人偶上。
          </Trans>
        ),
      },
      {
        title: msg`这颗键印着价钱`,
        anchor: "flow-main-btn",
        body: (
          <Trans>
            点它才真花钱开炼，花多少就印在键上。旁边「⚙」改本段的<b className="font-bold text-slate-100">时长、画质与画幅</b>——价钱跟着变，点之前看一眼。
            出片之后多一颗「⭕ 圈选」：圈出画面里要改的地方、写句要求，就地重画。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-11 订正（多语言 T2 对着实现核出来的；未升 version —— 要不要让看过的人重看等主人定）：
        //   ① 简约模式出片前没有设定帧可显示：seedSolo 铺的是空方案，大屏幕只画 poster || firstFrame，
        //      firstFrame 只有「🖼 自定义首尾帧」里自己给了才有，否则是一句「还没有画面——…」；
        //   ② 写要求的框在大屏幕**下面**（FlowPage 里 flow-stage 排在「本段内容」之前），原稿写的是「上面」。
        title: msg`结果就在这块屏幕上`,
        anchor: "flow-stage",
        body: (
          <Trans>
            出片前这里显示你给的<b className="font-bold text-slate-100">开头帧</b>（没给就先空着），出片后就地回放这一段。
            不满意就改下面那句话（或换圈选）再来一次。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-11 订正（未升 version）：创作入口早就只剩「工坊模式 / 简约模式」两张（CreatePage 的 MODES），
        //   工作流是工坊里画布那一面（工坊顶栏 🧩），没有单独的入口可「换」。
        title: msg`完成直通发布`,
        anchor: "flow-finish",
        body: (
          <Trans>
            满意了点右上角「完成视频」，去剪辑页收尾、发布。
            <b className="font-bold text-slate-100">简约不进草稿库</b>：中途退出这一段就不在了——
            想细做、想留草稿，回创作入口换工坊（工作流画布是它的另一面）。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "studio",
    title: msg`卡片工坊`,
    version: 1,
    steps: [
      {
        title: msg`工坊是什么`,
        body: (
          <Trans>
            这是一张铸卡桌：<b className="font-bold text-slate-100">素材炼成卡</b>，卡摆上桌铸成<b className="font-bold text-slate-100">一段视频</b>，段够了再推成成片。卡分这几种——<CardKindList />——它们决定每一段里出现谁、长什么样。
          </Trans>
        ),
      },
      {
        title: msg`卡从哪来`,
        body: (
          <Trans>
            卡有两条来路，都在<b className="font-bold text-slate-100">点一下桌对面的铸卡师</b>之后：「📎 添加素材」先挑卡种，再把图片或文本交给她炼；「🛒 逛市场」把现成的卡摊到桌上，看中了收进卡组。递素材那一屏会先摆出这一炉要花多少 token；炼出来先过目，点「收下这批卡」才真的进你的卡组。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-11 订正（未升 version）：点虚线卡位开的铸段窗，第①步是三选一（projection 的「这一段怎么拍？挑一张」：
        //   套模板 / 自选卡片 / 自定义），原稿只讲了「自选卡片」那一条。拖卡进卡位会跳过第①步 —— 这里说的是「点」。
        title: msg`铸一段视频`,
        anchor: "studio-hint",
        body: (
          <Trans>
            点你这一侧那排上的<b className="font-bold text-slate-100">虚线卡位</b>，先挑这一段怎么拍：「套模板」给白模视频里的人偶挂卡换人；「自选卡片」挑几张素材卡、写清这一段要发生什么，AI 推演出几套走向，每套都带首尾帧预览，挑定一套后还能换帧、改剧情、按修改重画；「自定义」全按你给的示例视频或首尾帧来。满意了再<b className="font-bold text-slate-100">炼出本段视频</b>。底下这条提示会跟着你当前这一步换措辞。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-11 订正（未升 version）：法阵早就不「铺」了 —— 单一真相之后它只是去画布那一面的门
        //   （studioStore.requestFlow → StudioPage 就地打开工作流画布），去剪辑要在画布终点格点「🎬 完成视频」。
        title: msg`一段一段来`,
        body: (
          <Trans>
            <b className="font-bold text-slate-100">炼出本段视频，下一段的卡位才会亮</b>：段与段靠上一段的真实尾帧承接起拍，攒着最后一起炼会接不上，第一段人物不对也要铺完才发现。每段都出片后，桌子右端的<b className="font-bold text-slate-100">法阵</b>会亮起，点它打开这条流水线的工作流画布，在那儿点「🎬 完成视频」去剪辑成片。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-11 订正（未升 version）：① 返回键 2026-08-30 起只留图标，「退到哪儿」只进了 aria-label / title，
        //   屏幕上不再「说出来」；② 💾 存草稿一直摆在顶栏（桌上还没有段时灰着），不是「铸出第一段后才出现」；
        //   ③ 每炼出一段会自动存一次草稿（useFlowActions 的「又炼出一段 → 自动存盘」，工坊页也挂着它）。
        title: msg`退出与存草稿`,
        anchor: "studio-back",
        body: (
          <Trans>
            左上角这颗按钮是<b className="font-bold text-slate-100">唯一的出口</b>，一层一层往外退：先关浮层、再退市场或对话，最后才回首页。<b className="font-bold text-slate-100">卡片收下就入账</b>，刷新还在；但桌上的流水线只在内存里，要存成草稿才留得住——每炼出一段会自动存一次；改了别的、想过会儿接着做，就先点顶栏右侧那颗<b className="font-bold text-slate-100">💾 存草稿</b>（桌上铸出第一段之前它是灰的）。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "templates",
    title: msg`视频模板`,
    version: 1,
    steps: [
      {
        // ★ 正文「工坊的卡片市场」里的「工坊」是底栏那一格（/workshop，英文 Workshop；写这句时它还叫「创意工坊」）的「从市场添加」，不是 3D 铸卡桌（Studio）
        title: msg`模板是成品配方`,
        body: (
          <Trans>
            这一屏摆的是调好的<b className="font-bold text-slate-100">成品配方</b>：画风、运镜、分镜骨架都定好了，挑一个套上去，写一句话或者给人偶挂上你的角色卡就能出片。它和工坊的卡片市场是两回事——卡片是素材，得自己组装剧情；模板是拿来就能出片的成品。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-17 订正（未升 version）：一张封面上的角标不止讲能力的这两枚 —— 七天内登记的还有一枚「新」、
        //   模板视频出不了片的还有一枚「暂时不可用」（都在 TemplateShelf 的 TemplateCard 里，同一张封面上最多四枚）。
        //   原稿「没角标的是经典配方模板」对一条刚发布的经典模板就不成立；改成「没有这两枚角标的」，只认能力位。
        title: msg`封面上的角标`,
        anchor: "template-card",
        body: (
          <Trans>
            角标写着这个模板能干什么。<b className="font-bold text-slate-100">白模</b>：出片时整段复刻它的场景、道具与运镜，只把人换掉，旁边报的是这条模板视频有多长——成片长度和画幅都跟着它走；<b className="font-bold text-slate-100">几个角色位可换人</b>：画面里那几个白色人偶，各能挂一张你的角色卡。没有这两枚角标的是经典配方模板，按分镜骨架重新画，旁边报的是分几段。
          </Trans>
        ),
      },
      {
        // 标题与货架上那颗按钮同一个 msgid（「用它出片」）：引导说的就是那颗键，英文跟着它走
        title: msg`用它出片`,
        anchor: "template-pick",
        body: (
          <Trans>
            点<b className="font-bold text-slate-100">用它出片</b>就跳到出片那一屏，接下来怎么走按模板分两种：<b className="font-bold text-slate-100">带角色位</b>的那种，本段内容区是一颗挂卡的钮——点开把你的角色卡逐个挂到人偶身上，还能另加一句自己的要求；其余的（经典配方、没有角色位的老白模）是写一句话，配方会把它填进每一段剧情。每段要花多少写在「生成本段」那颗按钮上，点它之前不花钱。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-17 订正（未升 version）：报价在哪一屏**按路分**，T3 已在「提取模板」那份引导里订正过同一处漂移 ——
        //   让 AI 换白模那条在框选屏（BlockoutTrimmer 报两笔 +「开始白模化」），自带白模片那条 2026-09-05 起拆成两屏、
        //   报价落在**下一屏**（VideoTemplateExtractor 的 ownRefStep：点「做成模板（不出片）」之前才整句报出），而且那条根本不出片，
        //   说「开炼」也不对。改成与路线无关的说法：都在按下那颗开始键之前报出来、确认了才扣。
        //   ★ 一个路数都不写：上一句刚说「第一屏挑」，而那一屏摆的是**三条**（routeOpts：让 AI 换白模 / 自带白模片 /
        //     经典配方），写「两条路」与屏幕上数得出来的对不上；而「先报价、确认了才扣」三条都成立 —— 去掉数字更准也更短。
        title: msg`做自己的模板`,
        anchor: "templates-tab-mine",
        body: (
          <Trans>
            <b className="font-bold text-slate-100">我的模板</b>装的是你自己做的，新做一个也从那里进：传一段视频，让 AI 把画面里的人换成一模一样的白色人偶，或者直接拿你本来就做好的白模片用。走哪条路在提取器<b className="font-bold text-slate-100">打开后的第一屏</b>挑；要花多少钱都在按下开始那颗键之前整句报出来，确认了才扣。
          </Trans>
        ),
      },
      {
        // ★ 有意不挂锚点（2026-08-28 撤掉 template-owner-row）：那一行只对自己的模板
        //   渲染，而这份引导在市场页签自动弹——那一刻它多半不存在，圈画不出来
        title: msg`发布与下架`,
        body: (
          <Trans>
            自己的模板，卡片上只标一个<b className="font-bold text-slate-100">状态</b>（草稿 / 已发布 / 已下架）。<b className="font-bold text-slate-100">识别角色位、核对、试炼、发布、删除</b>这些操作都收进了模板详情页——点开卡片进去，作者工作台就在那儿（先让 AI 识别画面里的人，再逐个核对）。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "extractor",
    // ★ 带 context：「提取模板」这个 msgid 已经是简约出片页那颗键（Extract template）；这里是拼进「… 使用引导」的屏名，
    //   英文要能换一种说法（理由同下面「剪辑」「发布」那两条；context 各写各的，因为撞的不是同一处）
    title: msg({ message: "提取模板", context: "新手引导的屏名：只拼进无障碍标签「… 使用引导」（与简约出片页的「提取模板」键同字不同用）" }),
    // ★ 2026-08-17 从 1 升到 2：这一屏的第一层从「一个白模开关」改成了**三选一**，
    //   老引导教的是一个已经不存在的开关。这正是"引导指着不存在的东西说话"那种错，
    //   所以要让**所有人重看一遍** —— 版本号平时不许动，这次是它存在的理由本身。
    version: 2,
    steps: [
      {
        // ★ 2026-09-17 订正（多语言 T3 对着实现核出来的；未升 version —— 主人 09-11 定：订正不重弹）：
        //   原稿说「在白模与经典之间换会回收已传的视频、要重传（白模那两条互换不用）」。2026-08-23 拆成两步之后，
        //   回三选一的那颗「‹ 换一种做法」只在**还没传完**（!receipt）时才画（VideoTemplateExtractor 的 step === "pick" 那块），
        //   传完整屏归框选器、回不去 —— 「手上有一份已传的视频、又能换路」这种局面走不到了。现在真会发生的只有：
        //   经典那条选好了文件（它不上传）再回来换到白模那两条，文件会被清掉、要重新选（路线键 onClick 里跨线那一支）。
        title: msg`这一屏做什么`,
        anchor: "extractor-routes",
        body: (
          <Trans>
            拿一段参考视频，让 AI 把它变成能反复套用的<b className="font-bold text-slate-100">模板</b>。第一步就是在这里
            <b className="font-bold text-slate-100">选做法</b>：选哪条决定后面几步长什么样，也决定花不花钱、花多少。
            <b className="font-bold text-slate-100">上传之前</b>随时能点「‹ 换一种做法」回来换（在白模与经典之间换，已经选好的文件要重新选一次）。
            传完就定死了——要换只能取消整个重来。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-17 订正（未升 version）：原稿「没挂卡的位子保持人偶原样」是无条件的说法，2026-08-18 实拍证伪过
        //   （切镜多的素材上，没挂卡的位子会被 AI 拿已挂的卡换掉 —— RoleCastBoard 底部 emptyCount 提示的 ★★★，那里已改口「通常」）。
        //   挂卡引导第 1 / 5 步同一句都带「通常」，这里按同一个口径补上；例外是什么由挂卡那一屏自己说。
        //   （提取器成功卡上那句「没挂的保持人偶原样」同样还没改口 —— 那是界面文案，不在这份引导里。）
        title: msg`让 AI 换成白模`,
        anchor: "extractor-routes",
        body: (
          <Trans>
            第一条：<b className="font-bold text-slate-100">任意视频都行</b>，AI 把画面里的人全换成一模一样的纯白人偶。
            别人套用时整段复刻你这段的<b className="font-bold text-slate-100">场景与运镜</b>，再逐个人偶挂上自己的人物卡，
            没挂卡的位子通常保持人偶原样。这条会真的出一次片，所以要花钱——具体多少在框选那一步整句报出来。
          </Trans>
        ),
      },
      {
        title: msg`本来就是白模片`,
        anchor: "extractor-routes",
        body: (
          <Trans>
            第二条：这段<b className="font-bold text-slate-100">已经是白模 / 人偶片</b>（你自己做好的预演片）。
            不出片、不换人，只认出画面里有谁、量出他们在哪，<b className="font-bold text-slate-100">便宜两个量级</b>。
            这两条我们分不出来，只能你自己选：该出片的没出，模板里全是真人；不该出片的出了，白花一次钱、画质还被二次白模化。
          </Trans>
        ),
      },
      {
        // 与提取器第三条路线卡同一个叫法（VideoTemplateExtractor 的 routeOpts：「经典配方（不做白模）」，那边的注释也点了这里的名）：改名两处一起改，英文也一样（Classic recipe）
        // ★ 2026-09-17 订正（未升 version）：原稿写「第三条，也是默认那条」。缺省选中哪条要看入口：从「我的模板」那颗上传键进来
        //   带 defaultBlockout，探测过了就拨到第一条（VideoTemplateExtractor 挂载 effect 里的 setRoute("aiBlockout")，TemplateShelf 传的 defaultBlockout）；
        //   只有简约出片页的「提取模板」才停在经典。引导一进这屏就弹，那时 ● 多半亮在第一条上 —— 「也是默认那条」删掉。
        title: msg`经典配方`,
        anchor: "extractor-routes",
        body: (
          <Trans>
            第三条：AI 从整段视频里<b className="font-bold text-slate-100">均匀抽</b>几帧看（你只定抽几帧），
            总结画风质感、运镜与分镜骨架，再提炼可复用的场景／道具卡。帧数越多认得越准，价钱不变。
            它<b className="font-bold text-slate-100">不出片、不把你的视频传上公网，也是三条里唯一不需要付费套餐的</b>。
          </Trans>
        ),
      },
      {
        title: msg`白模那两条怎么走`,
        // ★★ 这一步**故意不带锚点**（2026-08-23）：选文件那颗按钮已经搬到第 2 步，
        //   而引导是一进这屏就跑的（那时还停在第 1 步的三选一上）。留着 anchor 的话
        //   `rectOf` 会连量 FIND_TRIES 帧都量不到，才退成居中卡片 —— 结果一样，
        //   过程却是"引导指着一个不存在的东西"（这条 tour 自己 v2 就是为这种错升的版）。
        //   ⇒ 不升 version：说的事一个字没变（选文件 → 上传 → 框选 → 报价），
        //   变的只是"指哪儿"，没必要让所有人重看一遍。
        // ★ 正文在上面的 BlockoutRoutesBody（选段窗口那两个数要在渲染时取名，见那边的注释）
        body: <BlockoutRoutesBody />,
      },
    ],
  },
  {
    id: "cast",
    title: msg`挂卡面板`,
    // ★ 2026-08-17 从 1 升到 2：挂卡的主界面从"一行一个人偶的竖列表"改成了
    //   **画面正下方的横排格子行**（格子还能直接接住拖拽）。老引导教的是已经折叠起来的
    //   那一列，指路会指错。版本号平时不许动，这次正是它存在的理由。
    version: 2,
    steps: [
      {
        title: msg`这一屏在做什么`,
        anchor: "cast-stage",
        body: (
          <Trans>
            这段视频是模板的<b className="font-bold text-slate-100">白模视频</b>：里面的人偶是占位的，还不是具体的人。给一个人偶挂上一张人物卡，出片时它就会被换成那张卡上的角色；没挂卡的位子通常保持人偶原样 —— 但素材切镜多时可能被 AI 拿已挂的卡换掉，要稳就挂满。
          </Trans>
        ),
      },
      {
        // ★ 2026-08-17 订正：原稿承诺了两条我们并不保证的线索 ——「格子从左到右一一对应
        //   画面里的人偶」和「格子上那枚标记指的是哪一个」。格子上印的是「人物N」这种
        //   **中性名字**，RoleCastBoard 那段 ★★ 写了为什么：真实素材里人会重叠、镜头会切、
        //   人数会变，序数是我们自己都不保证的承诺。
        // ⇒ "这一格到底是画面里的哪一个"只有一个诚实答案：**点格子之后亮起来的那个框**。
        //   而那个框要模板带了位置数据才有，所以这里也只敢说到"有框时"为止 ——
        //   没框的模板这一句不成立，不许写成无条件的承诺。
        // ★ 2026-09-17 订正（未升 version）：末句原来是「卡片只列人物卡（人偶换的是「人」）」—— 靠「人物卡」与「人」同一个字呼应，
        //   译不出去（英文是 Character card / Person）。改成直说理由：VideoEditorPage 只把人物卡交给这块面板（myCards 按 type === "character" 过滤）。
        title: msg`一格一个角色位`,
        anchor: "cast-slot-strip",
        body: (
          <Trans>
            画面正下方这一排格子，<b className="font-bold text-slate-100">一格就是这个模板的一个角色位</b>；
            格子上的「人物1 / 人物2」只是它的名字，<b className="font-bold text-slate-100">不表示画面里从左到右的次序</b>。
            挂卡分两下：<b className="font-bold text-slate-100">先点一格选中它，再点上面那排卡里的一张</b>；
            也可以直接把上面那排卡<b className="font-bold text-slate-100">往下拖到格子上</b> —— 拖到格子上是直接落，不会再问一遍。
            画面上画得出落点框的模板，点中一格时<b className="font-bold text-slate-100">画面上对应的那个框会亮起来</b>，
            想知道这一格是画面里的哪一个就看它。挂卡这条路任何模板都有，与画面里有没有画框无关。
            卡片只列人物卡：人偶要换成的是角色，场景卡、道具卡挂上去没有意义。
          </Trans>
        ),
      },
      {
        // ★ 2026-08-17 订正：版式改成「卡在上 → 画面在中 → 格子在下」之后，拖拽只认**向下**
        //   （RoleCastBoard.beginDrag 的 `dy < 10` 直接 return）。原稿教的「往上拖」是静默死路：
        //   照着做怎么拖都没反应，零报错。同一句里的「下面那排卡」也一并反过来了。
        title: msg`也能拖到画面上`,
        anchor: "cast-card-rail",
        body: (
          <Trans>
            <b className="font-bold text-slate-100">不是每个模板都有这条路</b>：画面上画出了落点框才有（没有框就用格子行挂，那条路任何模板都有）。
            有框时也可以按住上面这排卡里的一张，<b className="font-bold text-slate-100">往下拖到画面里那个人偶身上</b>，人少的时候更直观。
            框是照<b className="font-bold text-slate-100">某一帧</b>量出来的，所以这时画面只在那一帧附近播一小下就自动停回去；
            播远了、人走动了，框会自己消失，画面下面会给一颗「回到标记帧」把它拨回去 —— 这是有意的，不是坏了。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-17 订正（未升 version）：原稿引了一句「是这个人吗」，界面上从来没有这句话。真的那一条是卡轨正下方的内联确认条
        //   （RoleCastBoard 的 ask：「把「卡名」挂到 人物N 身上？」+「就是他」/「点错了」，2026-09-06 起摆在卡轨与画面之间）。
        //   引号里只留真有的两颗键；那句问话带着卡名与人物名、不好整句引，改成转述。
        title: msg`拖到画面上会再问一次`,
        body: (
          <Trans>
            <b className="font-bold text-slate-100">只有拖到画面上</b>那一条会先问一遍：上面那排卡的正下方会出现一条确认，写着要把哪张卡挂到哪个人物身上，同时把画面上那个人偶高亮起来 ——
            因为那个落点是<b className="font-bold text-slate-100">推断</b>出来的（人偶会重叠、人会走动）。
            请对着高亮的那个再看一眼，对了点「就是他」，不对点「点错了」：挂错人<b className="font-bold text-slate-100">不会报错</b>，要等成片炼出来才看得见，
            那时已经花过一次出片的钱了。落到格子上不问 —— 落在哪一格是你眼睛看着放的，没有可推断错的余地。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-17 订正（未升 version）：原稿「剩下的照旧是人偶」是无条件的说法，2026-08-18 第十二发实拍证伪过
        //   （切镜多的素材上，没挂卡的位子会被 AI 拿已挂的卡换掉 —— RoleCastBoard 底部那段 emptyCount 提示的 ★★★）。
        //   第 1 步当时改了口，这一步漏了；按同一个口径补上「通常」。
        title: msg`不挂满也能出片`,
        body: (
          <Trans>
            不用挂满：挂几个换几个，剩下的通常照旧是人偶（切镜多的素材例外，第 1 步说过）。挂过的位子随时能换 —— <b className="font-bold text-slate-100">点中那一格，再点另一张卡</b>就换掉了；
            那一格挂着卡时，上面卡片那一行的右端会出现<b className="font-bold text-slate-100">「取下」</b>。都弄好之后点底部的<b className="font-bold text-slate-100">「完成挂卡」</b>，就带着这份对应关系回到上一步去炼视频。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "roleconfirm",
    title: msg`核对角色位`,
    // v2（2026-08-28 审计修）：三处漂移一起纠——①「对不上怎么办」那三段 08-23 已收进
    // 视频**下方**的折叠块，老引导还说在"视频上面"；② 描述框有两种含义（进出片提示词 /
    // 只给套用者看），老引导只教了后一种，照着写会把原片人物写进付费提示词；
    // ③ 漏了「加回来」与序数删位要挪号那两件。②是钱上的口径，够格升版重看。
    version: 2,
    steps: [
      {
        title: msg`这份清单是猜的`,
        body: (
          <Trans>
            清单上每一行说的是「画面上那个人偶，原来是谁」。这份对应关系是生成时 AI 猜出来的，不保证跟成片对得上。猜错时，别人给这个位子挂的角色卡会<b className="font-bold text-slate-100">换到另一个人身上</b>，而且<b className="font-bold text-slate-100">不会有任何报错</b>——所以只有看着画面的你能确认它。
          </Trans>
        ),
      },
      {
        title: msg`对着视频逐行核对`,
        anchor: "roleconfirm-video",
        body: (
          <Trans>
            视频就摆在清单上面，进度条可以拖着停在你想看的那一帧。然后逐行核对这个人偶的标记跟画面对不对得上：给的是<b className="font-bold text-slate-100">位置</b>，就对着画面从左往右数一遍；给的是<b className="font-bold text-slate-100">编号</b>，就照人偶身上印的数字改。标记必须跟你眼睛看到的完全一致——你这个模板的标记具体怎么看清楚，视频上面那段说明会讲。
          </Trans>
        ),
      },
      {
        title: msg`描述给套用者看`,
        anchor: "roleconfirm-desc",
        body: (
          <Trans>
            每行那句描述给<b className="font-bold text-slate-100">套用你模板的人</b>看：他看不到你的原片，画面上又全是长得一样的人偶，只能靠<b className="font-bold text-slate-100">标记加这句话</b>决定把哪张卡挂上去。写什么看输入框上面那行小字：写着「会进出片提示词」时，描述的是<b className="font-bold text-slate-100">人偶现在的样子</b>（例：白色、弯腰前倾、在最左那盏路灯下）；否则写原片里这个人认得出来的外形（例：白发、黑袍的少年）。别写只有你自己看得懂的代号。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-17 订正（未升 version）：原稿把「加回来」放在引号里当键名引。清单下面那颗加号键的字样分两种：按位置指认的模板是
        //   「画面上还有一个白色人偶没列出来？把它加回来」，编号方案的存量模板是「画面里还有人没列出来，加一个」（RoleConfirmSheet 的 canAdd 那颗键）——
        //   后一种上引文对不上任何字样（中英文都一样）。去掉引号、改成指路（清单下面那颗带加号的键），两种模板都成立。
        title: msg`不对就改，不用重炼`,
        anchor: "roleconfirm-del",
        body: (
          <Trans>
            对不上是可以就地改的：<b className="font-bold text-slate-100">标记写错了直接改成画面上那个</b>；清单里多出画面上找不到的位子就「删掉」；AI 漏认的人偶还能用清单下面那颗带加号的键<b className="font-bold text-slate-100">加回清单</b>。这些都<b className="font-bold text-slate-100">不会再花一次钱</b>。按位置指认的模板删掉一位后，记得把它右边各位往左挪一位——面板在待删行和提交前都会提醒。各种对不上的细节，展开视频<b className="font-bold text-slate-100">下面</b>那个「对不上怎么办？」看。
          </Trans>
        ),
      },
      {
        title: msg`改完一次提交`,
        anchor: "roleconfirm-submit",
        body: (
          <Trans>
            点「删掉」只是先标成待删，提交之前随时能撤销。底部那颗按钮把<b className="font-bold text-slate-100">改好的标记和要删的位子一次提交完</b>，不会留下改了一半的状态。提交完这个核对入口<b className="font-bold text-slate-100">也不会消失</b>——以后发现哪个人偶对不上，还能回来接着改；模板<b className="font-bold text-slate-100">已经发布</b>时要先下架才能改，面板里有那颗按钮。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "trim",
    // 与 /video-editor 那一页的页标题同一个 msgid（「选段与裁剪」）：说的就是那一屏，英文跟着它走
    // ★ 入口**只有一处**（2026-09-17 补）：提取器里 **AI 白模化的框选屏**（VideoTemplateExtractor 的 aiTrimScreen：标题栏那颗 ? + 首次自动弹）。
    //   同日把 /video-editor 的 blockoutize 那一档上的入口撤了：那一档走不到，而 check-guides 只按字样认入口 ——
    //   死入口留着，等于活的那颗被删也照样绿（这份引导此前失踪就是这么没被发现的）。
    //   自带白模片那条路的第 1 步**不挂**：第 1 步说的钱、第 4 步的「AI 看哪几帧」在那条路上不成立。
    //   ⇒ 改内容时对着 BlockoutTrimmer 的**缺省形态**核，再看一眼宿主多加了什么（提取器那一屏多了标题与「补充说明」两栏）。
    title: msg`选段与裁剪`,
    // v2（2026-08-28 审计修）：老版漏了整块「AI 看哪几帧」（它直接影响认不认得出人），
    // 且 trim-crop 锚点圈的是说明文字不是裁剪框本体。
    // ★ 2026-09-10：第一步原来写"看的帧越多越贵"—— 不对，看帧是一次 chat 定额（economy.blockoutTemplateCost），
    //   这一发的钱只随时长变。只改措辞。
    version: 2,
    steps: [
      {
        title: msg`这一屏在决定三件事`,
        body: (
          <Trans>
            框出哪一段、裁出哪一块，就是 AI 真正拿去白模化的全部内容；再加上下面
            「AI 看哪几帧」，决定它认不认得全画面里的人。<b className="font-bold text-slate-100">这一发多少钱</b>只看时长（越长越贵，多看几帧不额外收费），
            而钱一开始算就退不了。
          </Trans>
        ),
      },
      {
        title: msg`先框出哪一段`,
        anchor: "trim-range",
        body: (
          <Trans>
            拖两头的把手只取你要的那几秒。
            挑<b className="font-bold text-slate-100">人最齐、镜头最稳</b>的一段——
            切镜多的素材里，同一个人在不同镜头里的位置不一样，套用时容易换错人。
          </Trans>
        ),
      },
      {
        title: msg`再裁掉台标与水印`,
        anchor: "trim-crop",
        body: (
          <Trans>
            拖四个角调裁剪框。水印<b className="font-bold text-amber-300">必须框到框外</b>：
            出片是逐帧复刻画面，提示词去不掉它（实测），而模板会被反复套用——
            留一个水印就是永久的。
          </Trans>
        ),
      },
      {
        // 标题与编辑页上那一块的小标题同一个 msgid（「AI 看哪几帧」）：引导说的就是那一块，英文跟着它走（第 1 步正文也逐字引了它）
        // ★ 2026-09-17 订正（未升 version）：① 原稿末句「帧数直接算进下面的报价，多看更准也更贵」是按帧计价时代的说法 ——
        //   看帧是一次 chat 定额，几帧都一个价（economy.blockoutTemplateCost 不读 frameCount；编辑页报价行写的是「多看几帧不额外收费」）。
        //   第 1 步 2026-09-10 改过口，这一步漏了，两步并排自相矛盾，而这是钱上的话。
        //   ② 「那排帧」：缺省的「自动」档只有一句「现在是 N 帧」，缩略图那一排要切到「自己挑」并标过帧才有（VisionFramePicker）—— 改成「那一块」。
        title: msg`AI 看哪几帧`,
        body: (
          <Trans>
            时间轴下面那一块：AI <b className="font-bold text-slate-100">只看这几帧</b>去认画面里有谁——
            被看漏的人照样会变成白人偶，但清单里<b className="font-bold text-slate-100">没有他的位置，谁的卡都挂不上</b>，
            还会把别人的位置挤歪。可以让它自动挑，也可以自己标人最全的几帧；
            <b className="font-bold text-slate-100">帧数不进报价</b>：多看几帧更准，也不额外收费。
          </Trans>
        ),
      },
      {
        title: msg`裁得太小会被挡下`,
        body: (
          <Trans>
            方舟对画面大小、宽高比、时长都有硬门槛。
            不过关时下面会<b className="font-bold text-slate-100">直接说是哪一条不合</b>，按那句话改就行，
            不用在这里背数。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "workshop",
    title: msg`创意工坊`,
    // v2（2026-08-28）：2026-08-21 本页加了第三个页签「我的模板」（内嵌模板货架与
    // 提取器，其中 AI 白模化是真花钱出一次片的），老引导还在说"只管卡片和卡组、
    // 只有两个页签"——页面改版到老引导会误导人，升版本让所有人重看。
    version: 2,
    steps: [
      {
        // ★ 这一屏（创意工坊，底栏那一格写的是「工坊」= Workshop）与标题里的「工坊」（3D 铸卡桌 = Studio）是两个地方，英文别译成同一个词：这一步讲的正是二者的分工。
        //   ⚠ 光秃秃的「工坊」得看上下文：本文件里多数指 3D 铸卡桌，但「视频模板」第 1 步那句「工坊的卡片市场」指的是底栏这一格
        // ★ 2026-09-17 订正（未升 version —— 主人 09-11 定：订正不重弹）：① 「唯一的例外」不成立 —— 这一页「从视频提取卡组 / 提取卡片」
        //   打开的提取窗里，人物卡那一步有一颗付费键「✨ 按这套方案炼形象图（N 张 · 约 X）」（VideoCardAnnotator.makePortraits），
        //   同一份引导第 2 步说的就是它，两步不该各说各的；② 「AI 换白模」不是屏幕上的字样（提取器那条路线卡写的是
        //   「让 AI 把里面的人换成白模人偶」），去掉引号、照那条路线卡转述。
        //   ★★ 这里**一个数都不许写**：模板栏那颗「传一段视频做白模模板（自己做好的白模片也行）」开的提取器摆着三条路，
        //     **条条要钱** —— 自带白模片那条的价就印在路线卡上（「只认人、不出片 · 约 …」，economy.ownRefTemplateCost），
        //     经典配方那条在 run() 里真的 spendTokens（报价 templateCost(TEMPLATE_MAX_CARDS)，提交前还摆一行「预估消耗」）。
        //     写「两处要花钱」= 当面告诉用户另外两条免费，正是本条订正要治的那种错（「唯一」不成立）。所以只说「有要花钱的地方」，
        //     第一项直接盖住整条做模板的路，将来再添一条路也不会把这句话变成假话。
        title: msg`这一页管素材，成片在工坊`,
        anchor: "workshop-studio-entry",
        body: (
          <Trans>
            这里管<b className="font-bold text-slate-100">卡片、卡组和模板</b>这些素材。
            要摆桌铸卡、把卡炼成视频，从这条路进 3D 工坊。
            这一页自己也有<b className="font-bold text-slate-100">要花钱的地方</b>：模板栏里做模板那几条路都要钱（让 AI 把视频里的人换成白模人偶那条还会真出一次片），
            以及提取窗里那颗「✨ 按这套方案炼形象图」。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-17 订正（未升 version —— 主人 09-11 定：订正不重弹）：T4 那次订正（句首由「只有 AI 出图」改成「只有交给 AI 的」）
        //   把「从视频圈选提取」**同时**写进了要花钱的括号和不花钱的那一串，同一句里自相矛盾。
        //   照实分两层说：路子本身只有工坊铸卡一定花（那一炉的报价在递素材那一屏摆出来），圈选提取与自己传图是**窗口里那几颗 AI 键**才花
        //   （VideoCardAnnotator 的「✨ 按这套方案炼形象图」、CustomCardPage 的「✨ 生成 N 张图位与人物信息」「⭕ 圈选改图」与场景卡 / 道具卡的识别），
        //   价都印在键上；从市场拿不花。与第 1 步订正后的说法对齐。
        //   ★ 标题「一条花钱」**不动**：它说的是「四条路里有一条本身要钱」，与订正后的正文第一句同义；而它的英文（Four ways to get cards, one paid）
        //   已经是本文件里最宽的一条标题（360 宽下量到 228.7 / 可用 253.6 px），换个说法必然撑过那一行。
        title: msg`造卡四条路，一条花钱`,
        anchor: "workshop-extract-card",
        body: (
          <Trans>
            四条路里<b className="font-bold text-slate-100">只有工坊铸卡一定花 token</b>。从视频圈选提取、自己传图本身
            <b className="font-bold text-slate-100">不花</b>，只有窗口里那几颗带 AI 的键要钱（价印在键上）；从市场拿也不花。
            提取是拖到某一帧、亲手圈出要的人或物，圈出来的画面就是参考图。
          </Trans>
        ),
      },
      {
        // ★ 有意不挂锚点：它排在卡片网格下面，卡一多就掉出首屏，而引导期间页面滚不动。
        //   （屏外锚点现在会退成居中卡片，不再把「下一步」沉出屏幕 —— 但退化了圈就没了，
        //   不如一开始就写清位置。）
        title: msg`市场里点哪儿才是拿`,
        body: (
          <Trans>
            下面「从市场添加」那一栏：点卡面只是<b className="font-bold text-slate-100">看详情</b>，
            卡片下面那行小字才是收进自己的库。那一栏还能切成卡组、整套装走，都不花钱。
          </Trans>
        ),
      },
      {
        title: msg`卡组是干什么的`,
        anchor: "workshop-tabs",
        body: (
          <Trans>
            把常用的几张归成一组；出片时<b className="font-bold text-slate-100">人物和场景由卡组锁住，全片保持一致</b>。
            散着的卡在「我的卡片」页签，你自己做的模板在「我的模板」。
          </Trans>
        ),
      },
      {
        // ★ 有意不挂锚点（2026-08-28 撤掉 workshop-deck-new）：那颗按钮只在「我的卡组」
        //   页签下渲染，而引导在默认的「我的卡片」页签自动弹——那一刻它不存在，圈画不出来
        title: msg`组卡组：怎么加、怎么改`,
        body: (
          <Trans>
            在「我的卡组」页签里：先点「编辑」<b className="font-bold text-slate-100">再</b>点卡片，才是加进来或拿出去；卡角能定封面。
            组名点上去直接改。删掉整组<b className="font-bold text-slate-100">不会删卡</b>。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "discover",
    // ★ 带 context：「分区」「我的」两个 msgid 已经是底栏页签的名字；这里是拼进「… 使用引导」的屏名，英文要能换一种说法
    title: msg({ message: "分区", context: "新手引导的屏名：只拼进无障碍标签「… 使用引导」（与底栏页签同字不同用）" }),
    version: 1,
    steps: [
      {
        // ★ 2026-09-17 订正（未升 version）：连着服务器时（正式包就是这一支）搜作品只对 title / description / tags 三样 ——
        //   作者是外键、分区是另一个 query 参数（data/videos.matchesQuery 头上那段 ★ 把两边的差别写死了：只有离线那份才额外认作者名与分区）。
        //   照原稿去搜作者名，屏幕上给的是「没有找到相关作品」，而不会说为什么。只留两边都成立的三样；找人有上面那半专门的搜人结果（第 2 步讲的就是它）。
        title: msg`一个框搜两样`,
        anchor: "discover-search",
        body: (
          <Trans>
            打字之后上面先出<b className="font-bold text-slate-100">人</b>、下面出作品。
            作品是拿标题、简介、话题标签一起对的，不只对标题；<b className="font-bold text-slate-100">按作者找人用上面那半</b>。
          </Trans>
        ),
      },
      {
        title: msg`搜到的人`,
        anchor: "discover-users",
        body: (
          <Trans>
            人排在作品前面，点一行进他主页 —— 有些作品这里搜不到，去他主页能看全。
            名字底下那串 <b className="font-bold text-slate-100">@ 开头的</b>，就是 @ 他时要打的那串。
          </Trans>
        ),
      },
      {
        title: msg`分区图标就是开关`,
        anchor: "discover-cats",
        body: (
          <Trans>
            点一个就只看这一类，选中的那个会放大亮起来；
            <b className="font-bold text-slate-100">再点同一个才取消</b> —— 没有别的地方能关掉它。
          </Trans>
        ),
      },
      {
        title: msg`现在筛的是什么`,
        anchor: "discover-scope",
        body: (
          <Trans>
            分区和搜索词是<b className="font-bold text-slate-100">叠加</b>的。这行小字报的是当前分区和筛出的条数；
            觉得作品变少了，先看分区图标亮没亮、搜索框清没清。右边那两颗换排法：最火按播放多少排，最新按发布时间倒着排。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "profile",
    // ★ 带 context，理由同上面「分区」那一条
    title: msg({ message: "我的", context: "新手引导的屏名：只拼进无障碍标签「… 使用引导」（与底栏页签同字不同用）" }),
    version: 1,
    steps: [
      {
        title: msg`出片花的就是这些 token`,
        anchor: "profile-wallet",
        body: (
          <Trans>
            出片、出图、铸卡、解锁付费作品，扣的都是它。点开看余额、买套餐或直充 ——
            <b className="font-bold text-slate-100">套餐按月给且先扣，直充的不过期</b>。
          </Trans>
        ),
      },
      {
        title: msg`五个图标各管一堆`,
        anchor: "profile-tabs",
        body: (
          <Trans>
            从左到右是作品、草稿、卡片、卡组、收藏，点一下换一堆看。
            图标旁边那个数字是这堆有几件；<b className="font-bold text-slate-100">空的那几堆不显示数字</b>。
          </Trans>
        ),
      },
      {
        title: msg`没做完的半成品在这一格`,
        anchor: "profile-tab-drafts",
        body: (
          <Trans>
            存着的半成品都在这儿。那把锁是「<b className="font-bold text-slate-100">还没发布</b>」，
            不是私密。点一张要先挑用工坊还是工作流打开 —— 同一份内容，两边都进得去。
          </Trans>
        ),
      },
      {
        title: msg`谁赞了你、谁关注了你`,
        anchor: "profile-notify",
        body: (
          <Trans>
            点它看消息 —— 全 app <b className="font-bold text-slate-100">只有这一个入口</b>。
            有新的时候图标上会多一个红点，红点不报条数，进去才知道有几条。
          </Trans>
        ),
      },
      {
        title: msg`这三个数字里有一个能点`,
        anchor: "profile-stats",
        body: (
          <Trans>
            「关注」那格点开是你关注过的人的名单，就地能取关。
            旁边两个是你<b className="font-bold text-slate-100">所有作品加起来</b>的总数，不是某一支的。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "tpldetail",
    title: msg`模板详情`,
    version: 1,
    steps: [
      {
        title: msg`白模那种模板：视频就是成片`,
        anchor: "template-refvideo",
        body: (
          <Trans>
            白模那种模板，出片就是<b className="font-bold text-slate-100">整段复刻这段视频</b>、只把人偶换掉。
            下面那行报价把模板视频自己的时长也计了一遍，不是只按出片时长算。
          </Trans>
        ),
      },
      {
        title: msg`点「用这个模板出片」还不扣钱`,
        body: (
          <Trans>
            那颗按钮只是把配方铺到出片那一屏，<b className="font-bold text-slate-100">钱要到那边点生成才扣</b>。
            有角色位的模板会先领你去给人偶挂卡。
          </Trans>
        ),
      },
      {
        title: msg`自己做的才多一块工作台`,
        body: (
          <Trans>
            互动区上面那一大块「✎ 模板信息」<b className="font-bold text-slate-100">只有作者看得见</b>。
            发布＝别人搜得到、能付费套用；白模模板要先用它真出过一段片才让发。
            下架只是收回来，你那份还在。
          </Trans>
        ),
      },
      {
        title: msg`删除是真的销毁`,
        body: (
          <Trans>
            工作台里的「删除」不是从列表里划掉：<b className="font-bold text-slate-100">云端那段模板视频和原始素材会一起没掉</b>，
            谁都找不回。所以要点两下才认。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "canvas",
    title: msg`流水线画布`,
    // v2（2026-08-27）：末步原来讲的是「≡ 收起画布回线性视图」，而线性视图 08-23 已
    // 下线、那颗按钮改成了「🎴 工坊」——老引导在教一个不存在的退路，正是文件头说的
    // 「改版到老引导会误导人」，所以升版本让所有人重看。
    // v3（2026-08-28）：agent 那一步补上「说话本身按对话计费」——老口径读起来像
    // "说话免费、只有点确认才花钱"，报价说错是本仓最贵的一类错，再升一版。
    version: 3,
    steps: [
      {
        title: msg`一屏看完整条片`,
        anchor: "canvas-card",
        body: (
          <Trans>
            每一格是<b className="font-bold text-slate-100">一段</b>，从左往右就是这条片的顺序。
            点一格<b className="font-bold text-slate-100">就地打开这一段的编辑窗</b>，再点一下收起，点别的格子就换过去。
            画布可以拖着平移、两指捏合缩放。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-11 订正（未升 version）：编辑窗顶部是三颗（FlowCanvas 的 canvas-modes：🧪 套模板 / 🃏 自选卡片 / ✍ 自定义），
        //   原稿还写着「这对按钮」「两种」。自定义那条的形状见 NodePanel 的 customStep（示例视频 → 首尾帧）。
        title: msg`一段有三种做法`,
        anchor: "canvas-modes",
        body: (
          <Trans>
            编辑窗顶部这三颗按钮切的是<b className="font-bold text-slate-100">这一段</b>怎么做：
            「套模板」是拿一段白模视频复刻运镜与站位，你只需给里面的人偶挂上自己的角色卡；
            「自选卡片」是自己挑素材卡、写一句要求，AI 推演几套走向让你挑；
            「自定义」全按你给的来：传一段示例视频当整段参考，或者直接给自己的首尾帧。
            三种<b className="font-bold text-slate-100">每段各选各的</b>，同一条片里可以混着来。
          </Trans>
        ),
      },
      {
        title: msg`对画布说话`,
        anchor: "canvas-agent",
        body: (
          <Trans>
            一句话就能改流水线：给哪段套哪个模板、把谁挂到哪个位子、这段拍什么、加一段。
            {/* ★ 这三件里**挂卡合成是免费的**（cost 恒 0，见 canvasAgent 的 AgentProposal）。
                写成"会花钱的三件"是错的报价口径，而这个仓库里报价说错是最贵的一类错
                （CLAUDE.md「两仓价目表各写各的」）。所以措辞按**要不要你点头**分，
                确认卡上那行标的是价钱**或**后果。 */}
            <b className="font-bold text-slate-100">它不替你按那三件</b> —— 推演、出片（真花钱），
            以及挂卡合成（不花钱，但会把你改过的点名句整段重写）。它只摆一张确认卡，
            上面写着这一下要花多少、或者会覆盖掉什么，你点了才真跑。办成了什么、被拒了什么，它逐条列给你看。
            另外<b className="font-bold text-slate-100">对它说的每句话本身也按对话计一次费</b>——价印在输入框里。
          </Trans>
        ),
      },
      {
        // ★ 这一步**有意不挂锚点**：终端格子在流水线**末段之后**，段一多就在视口外，
        //   而 off-screen 元素的 rect 仍返回非零宽高 —— 退化成居中卡片那条兜底不会触发，
        //   圈会画到屏幕外（本文件顶部那条 ⚠ 说的就是它）。所以改成用文字自定位。
        title: msg`流水线的终点`,
        body: (
          <Trans>
            一直往右拖到<b className="font-bold text-slate-100">末段后面</b>，跟着两格：一格<b className="font-bold text-slate-100">加下一段</b>，
            一格<b className="font-bold text-slate-100">把各段合成整片</b>（每段都出片了才亮，还差几段它会说）。
            已经出片的格子右上角有个 ▶，随时能回看那一段。
          </Trans>
        ),
      },
      {
        title: msg`横竖都能用`,
        anchor: "canvas-rotate",
        body: (
          <Trans>
            竖屏时编辑窗从下面升起，横屏时它挪到右边、画布留给左边 —— 段多的时候横过来看更痛快。
            旁边那颗 💾 随时把这条片存成草稿，回头接着做。
          </Trans>
        ),
      },
      {
        title: msg`同一条片的另一面`,
        anchor: "canvas-linear",
        body: (
          <Trans>
            点它把这条流水线带去 <b className="font-bold text-slate-100">3D 工坊</b>：画布是摊开的流水线，
            工坊是摆在桌上的节点卡，<b className="font-bold text-slate-100">两边改的是同一份</b>，
            换个面打开不用重炼、不重复收费。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "cut",
    // ★ 带 context：「剪辑」「发布」两个 msgid 已经是剪辑页页签（Edit）和发布键（Publish）；这里是拼进「… 使用引导」的屏名，
    //   英文要换一种说法（同 T1 给「分区」「我的」加 context 的理由；不复用那条 context，因为那条写的是"与底栏页签同字"）
    title: msg({ message: "剪辑", context: "新手引导的屏名：只拼进无障碍标签「… 使用引导」（与剪辑页页签、发布键同字不同用）" }),
    // 2026-08-28 从 CutPage 自带的那份帮助弹窗迁来（铁律六：帮助内容只在 tours 一处）。
    // 首次进页自动弹是新增的行为——原来那份只有主动点 ? 才看得到。
    version: 1,
    steps: [
      {
        // ★ 2026-09-11 订正（未升 version）：不是所有画面都没声音 —— 高清 / 电影级档（economy.VIDEO_TIERS 的 audio:true）
        //   出片自带 AI 生成的环境音；极速 / 标准档（默认档）、真人档与白模复刻段（arkClient.BLOCKOUT_TASK 的 generate_audio:false）才是哑的。
        //   档名不写进这句：档位表会变，引导里抄一份档名就是又一个要维护的镜像（文件头 ★★ 同理）。
        title: msg`三个页签各管一摊`,
        anchor: "cut-tabs",
        body: (
          <Trans>
            <b className="font-bold text-slate-100">剪辑</b>管顺序与取舍，
            <b className="font-bold text-slate-100">圈选</b>管改画面（要花钱的那种改），
            <b className="font-bold text-slate-100">音频</b>管配乐 —— 不是每一档出的画面都带声音（白模复刻段一律没有），
            想要声音、想加配乐，就在这儿配。
          </Trans>
        ),
      },
      {
        title: msg`剪辑：不花钱的整理`,
        anchor: "cut-timeline",
        body: (
          <Trans>
            点一个片段选中，就能在播放头处<b className="font-bold text-slate-100">✂️ 分割</b>、
            <b className="font-bold text-slate-100">🗑 删除</b>、拖拽或前移后移<b className="font-bold text-slate-100">换序</b>。
            这些只改导出范围，<b className="font-bold text-slate-100">一个 token 都不花</b>。
          </Trans>
        ),
      },
      {
        title: msg`圈选：花钱的重生成`,
        body: (
          <Trans>
            拖进度条停在要改的画面，⭕ 圈出物体、写一句要求；可以<b className="font-bold text-slate-100">跨帧跨段圈多处</b>，
            攒齐了一次性重新生成 —— 按钮上会标出几段、多少钱，<b className="font-bold text-slate-100">点那一下才计费</b>。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-11 订正（未升 version）：① 「发布后作品不可再修改」2026-09-07 起不成立（编辑页「🛠 回炉重做」能换成片内容，
        //   PublishPage / EditPage 那两处早已改口），这一页不必讲发布之后，删掉；② 已经合好的稿子这颗键写的是「去发布」（CutPage 的 alreadyMerged）。
        title: msg`右上角是终点`,
        anchor: "cut-next",
        body: (
          <Trans>
            整条模式下「下一步」把时间轴按顺序导出成<b className="font-bold text-slate-100">一整条视频</b>、进发布页（已经合好的稿子它写的是「去发布」，直接进发布页）。
            从工坊单段进来时它是「保存本段」，改完写回那一段、不合并不发片。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "publish",
    // ★ 带 context，理由同上面「剪辑」那一条
    title: msg({ message: "发布", context: "新手引导的屏名：只拼进无障碍标签「… 使用引导」（与剪辑页页签、发布键同字不同用）" }),
    version: 1,
    steps: [
      {
        // ★ 2026-09-11 订正（未升 version）：发布页只收得到**一整条合好的成片**。进 /publish 的路都在剪辑页
        //   （合并成功，或已经合好的稿子点「去发布」）；合并对没出片的段整句拒（CutPage.mergeAndGo 的「还没有视频（只有设定帧）」），
        //   合好之后稿子换成 segments: [mergedSeg]。于是这张清单恒为一行 ✓，「⚠ 渐变回退」在这条路上出不来 ——
        //   原稿「各段连播」「把 ⚠ 的段看一眼」都不成立。发布页自己那句「成片预览（各段按时间线依次播放）」同样过时，不在本 PR 改。
        title: msg`先核对成片`,
        anchor: "publish-segments",
        body: (
          <Trans>
            预览里播的就是剪辑页合好的<b className="font-bold text-slate-100">这一整条成片</b>，下面这行的 ✓ 表示它是真生成的影像。
            <b className="font-bold text-slate-100">发布前从头到尾看一遍</b>，确认就是你要发的这一条。
          </Trans>
        ),
      },
      {
        title: msg`谁能看`,
        anchor: "publish-pricing",
        body: (
          <Trans>
            可见性管<b className="font-bold text-slate-100">谁看得到</b>：公开、凭链接可见、仅自己可见。
            发完在作品编辑页随时能改。收费这一栏现在<b className="font-bold text-slate-100">所有作品都是免费观看</b>
            —— 付费解锁等收款和分账真的通了再放出来。
          </Trans>
        ),
      },
      {
        // ★ 2026-09-11 订正（未升 version）：「发布即定稿」2026-09-07 起不成立 —— 编辑页「🛠 回炉重做」把工坊工程取回来接着改、
        //   同一个链接（EditPage 那段说明与 PublishPage「发布后会留存这条片的工坊工程」同一个口径）。
        //   能不能回炉由编辑页当场说（reforgeWhy），这里不抄那几条（文件头 ❌：条件触发的解释留在界面上）。
        title: msg`发布之后怎么改`,
        anchor: "publish-actions",
        body: (
          <Trans>
            发布后编辑页随时能改标题、封面这些壳；想换<b className="font-bold text-slate-100">成片内容</b>，去编辑页点「🛠 回炉重做」，
            把这条片的工坊工程取回工坊接着改，链接不变。「放弃本次合成」会把这条成片丢掉 —— 点它会先问你一句。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "customcard",
    // 与 /custom-card 那一页的页标题（创意工坊里那颗入口键也是这几个字）同一个 msgid：说的就是那一屏，英文跟着它走
    title: msg`自己传图做卡片`,
    // 2026-08-28 文案收纳：页面顶上那块三条 bullet 的对比说明压成一句，展开讲在这。
    // 首次进页强制放一遍，"这是另一条路、默认铸卡不用传图"这件事仍然人人看得到。
    // ★ version 4（2026-08-30 人物卡拆成四步向导）：选来源（自传图/AI 生成）→ 图位预览
    //   （可圈选改图）→ 人物信息 → 定名铸卡。第 1 屏仍只有五个卡种大按钮；
    //   第 1 屏在场的锚只有 cc-type——cc-slots / cc-info 在后面的步骤，自动弹时找不到
    //   会退成居中卡片（GuideOverlay 的既定行为），照样能读。
    version: 4,
    steps: [
      {
        // ★ 2026-09-17 订正（多语言 T4 对着实现核出来的；未升 version —— 主人 09-11 定：订正不重弹）：原稿「只有那条才计费」不成立 —— 这一页花 token 的键有四颗：
        //   「✨ 生成 N 张图位与人物信息」、「⭕ 圈选改图」（本引导第 3 步自己就写着「单张图的价」）、场景卡 / 道具卡的「✨ 让 AI 按…填写」与第 1 屏弹窗里的「拍摄识别」（后两样 2026-09-10 加的）。
        //   按 CustomCardPage 文件头那句「花钱的都是可选的一颗键」改口；「拍摄识别」的价写在那两张牌下面那行字里，所以说「当面标着」。
        title: msg`这是另一条路`,
        body: (
          <Trans>
            默认铸卡是 <b className="font-bold text-slate-100">AI 全自动出图</b>（3D 工坊找铸卡师）。
            这一页反过来：<b className="font-bold text-slate-100">用你自己的图，不耗 token</b>；
            也可以只交一张素材，让 AI 按方案把图位都画出来。要花 token 的只有那几颗带 AI 的键（AI 生成图位、圈选改图、场景卡与道具卡的识别），价钱都当面标着，不点就不花。
            铸出来的卡与 AI 铸的完全同一种东西 —— 能进卡组、当出片的形象参考、发布到创意工坊。
          </Trans>
        ),
      },
      {
        title: msg`先挑卡种，再挑方案`,
        anchor: "cc-type",
        // ★ 正文在上面的 SchemePickBody（内置方案名要在渲染时按界面语言取，见那边的注释）
        body: <SchemePickBody />,
      },
      {
        title: msg`图位怎么摆、怎么改`,
        anchor: "cc-slots",
        // ★ 正文在上面的 SlotRulesBody（引的图位名走显示名 getter，见那边的注释）
        body: <SlotRulesBody />,
      },
      {
        title: msg`图会被怎么处理`,
        // ★ 正文在上面的 RefImageBody（比例上限在渲染时读，见那边的注释）
        body: <RefImageBody />,
      },
      {
        title: msg`写给 AI 的那段信息`,
        anchor: "cc-info",
        body: (
          <Trans>
            「人物信息」那一步的文字，之后 AI 复刻这张卡的画面 / 建模时会读，
            <b className="font-bold text-slate-100">写得越具体越像</b>。不填也行 ——
            详情页会按卡名与简介现补一份；选了 AI 生成图位的话，这段连同卡名、标签
            都已按素材写好，随意改。
          </Trans>
        ),
      },
    ],
  },
  // ── 设置子页（2026-08-27 设置页拆分时一起加）──────────────────────
  // 设置页原来把说明文字直接铺在每一节里；拆成子页后常驻说明进这里，页面上只留
  // 控件与条件触发的事实（离线/失败/管理员那几句仍在界面上，理由见文件头 ❌ 那条）。
  {
    id: "setprofile",
    // 与那一页的页标题（设置页那一行也是这几个字）同一个 msgid，英文跟着页面走；下面「铸卡师的声音」「画面质量」同理
    title: msg`编辑资料`,
    version: 1,
    steps: [
      {
        title: msg`换头像`,
        anchor: "setprofile-avatar",
        body: (
          <Trans>
            点头像打开选择器：官方看板娘现成可选，最后一格从相册选自己的图，
            <b className="font-bold text-slate-100">能拖动裁切、双指缩放</b>。不想用图，下面还能挑一个
            emoji 顶着。
          </Trans>
        ),
      },
      {
        title: msg`昵称和简介`,
        anchor: "setprofile-form",
        body: (
          <Trans>
            昵称是别人看到的名字，简介挂在主页名字底下。这两样改完要点
            <b className="font-bold text-slate-100">「保存资料」</b>才算数 —— 头像不用，点了就换。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "setvoice",
    title: msg`铸卡师的声音`,
    version: 1,
    steps: [
      {
        title: msg`点一条就试听`,
        anchor: "setvoice-list",
        body: (
          <Trans>
            每一条是一把嗓子，<b className="font-bold text-slate-100">点一下立刻念一句样本、同时选定它</b>。
            标着「调和」的是几把嗓子混出来的。
          </Trans>
        ),
      },
      {
        title: msg`挑完嗓子还有两个旋钮`,
        anchor: "setvoice-tune",
        body: (
          <Trans>
            语速管快慢；语调用一句话描述想要的语气，
            <b className="font-bold text-slate-100">改完点上面任意音色即刻再听</b>。语调那一段不计费，
            只对单音色生效 ——「调和」那几条用不了。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "setquality",
    title: msg`画面质量`,
    version: 1,
    steps: [
      {
        title: msg`只管 3D 工坊`,
        anchor: "setquality-opts",
        body: (
          <Trans>
            这三档管的是工坊里 3D 形象的贴图精细度，
            <b className="font-bold text-slate-100">跟出片视频的清晰度无关</b>。第一次进工坊会按机型
            自动选一档；之后想换，全 app 只有这里能改。换档会重新加载一次。
          </Trans>
        ),
      },
    ],
  },
  {
    id: "setstorage",
    // ★ 2026-09-17 订正（未升 version）：原来叫「存储与清理」，是引导自己的叫法；那一页的页标题（设置页那一行也是）按模式是「本机缓存」/「存储」
    //   （SettingsStoragePage 的 PageHeader）。屏名是模块顶层的描述符、跟不了模式，取正式包（远端模式）上的那个，与页标题同一个 msgid；
    //   它只拼进无障碍标签「… 使用引导」，屏幕上看不见。
    title: msg`本机缓存`,
    version: 1,
    steps: [
      {
        title: msg`占的空间在这看、也在这清`,
        anchor: "setstorage-usage",
        body: (
          <Trans>
            上面是这台设备已经占用的空间。「清理缓存」
            <b className="font-bold text-slate-100">只删生成过程中留下、已经没人引用的中间文件</b> ——
            未发布的草稿和还没传上去的作品一个不动。
          </Trans>
        ),
      },
    ],
  },
];

export function tourById(id: string): GuideTour | null {
  return TOURS.find((tour) => tour.id === id) ?? null;
}
