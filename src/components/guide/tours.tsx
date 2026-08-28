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
//   引导里再抄一份数字就是同一个坑第三次。本文件目前只插两处（选段窗口、卡种列表），
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
import { BLOCKOUT_INPUT_RULES } from "../../data/templates";
import { CARD_TYPES, CARD_TYPE_LABELS } from "../../types";
// 自制卡那份要报比例上限：方舟的硬约束，数只能从这里取（数字一律插值，见 ★★）
import { REF_MAX_RATIO } from "../../utils/image";

export interface GuideStep {
  title: string;
  body: ReactNode;
  /** 要高亮的元素上 `data-guide` 的值。不给 = 这一步只讲话，卡片居中 */
  anchor?: string;
}

export interface GuideTour {
  id: string;
  /** 这一屏的名字，只进无障碍标签与调试 */
  title: string;
  /**
   * 版本号。★ **只在有意要让所有人重看一遍时才加**（比如这一屏改版到老引导会误导人）。
   *   平时改错别字不要动它 —— 用户明确要的是"弹过一次不再自动弹"。
   */
  version: number;
  steps: GuideStep[];
}

/** 全部引导。★ 新增一屏就在这里加一条，别在页面里塞第二份内容 */
export const TOURS: GuideTour[] = [
  {
    id: "feed",
    title: "首页视频流",
    version: 1,
    steps: [
      {
        title: "上下滑着看",
        body: (
          <>
            整屏一支，上下滑换下一支——划到哪支哪支就自动播，<b className="font-bold text-slate-100">划走就停下、划回来从头播</b>。<b className="font-bold text-slate-100">单击暂停</b>，再点一下接着放；<b className="font-bold text-slate-100">双击点赞</b>，连点两下只会点亮、不会取消。顶上的「关注 / 推荐」切换看谁的作品。
          </>
        ),
      },
      {
        title: "右边那一列",
        anchor: "feed-rail",
        body: (
          <>
            最上面是<b className="font-bold text-slate-100">作者头像</b>（点进主页，下面那枚 + 号关注）。往下依次是发弹幕、点赞、评论、收藏、分享，<b className="font-bold text-slate-100">下面的数字是已经有多少人做过</b>。评论就地滑出来，不用离开这一屏。
          </>
        ),
      },
      {
        title: "底下那条细线",
        anchor: "feed-progress",
        body: (
          <>
            底缘那条细线是<b className="font-bold text-slate-100">播放进度</b>，右上小字是当前 / 总时长，按住能<b className="font-bold text-slate-100">拖着跳到任意一处</b>。多段的作品，这条线走的是整片。
          </>
        ),
      },
      {
        title: "标题进详情页",
        anchor: "feed-title",
        body: (
          <>
            <b className="font-bold text-slate-100">点标题进详情页</b>——本片卡组、多 P 选集、完整简介、「互动 · 你来选」的分支，都<b className="font-bold text-slate-100">只在那儿</b>。点作者名或头像，去的是他的主页。
          </>
        ),
      },
      {
        title: "全屏与转屏",
        anchor: "feed-fullscreen",
        body: (
          <>
            那一列最下面单独一枚是全屏键，点了只留画面；<b className="font-bold text-slate-100">横屏的片子会连屏幕一起转过来</b>，所以它在横屏片上写的是「转屏」。退出点右上角那枚缩小键。
          </>
        ),
      },
    ],
  },
  {
    id: "create",
    title: "创作入口",
    version: 1,
    steps: [
      {
        title: "挑一种创作方式",
        anchor: "create-dots",
        body: (
          <>
            底栏的 ➕ 先落到这里：每张卡是一种创作方式，左右滑动，或者点画面边上的箭头、底部的圆点，都能翻到下一张。它们<b className="font-bold text-slate-100">不是各走各的</b>，而是同一条流水线的不同入口，最后都汇到剪辑与发布。
          </>
        ),
      },
      {
        title: "挑定了就进去",
        anchor: "create-cta",
        body: (
          <>
            看中哪张，就点卡片底部那枚按钮从这条路进去：工坊落到 3D 铸卡桌面，另外两种直接落到写要求、出片的那一页。出片之后都汇到<b className="font-bold text-slate-100">同一个剪辑页</b>，再从那里发布。
          </>
        ),
      },
    ],
  },
  {
    id: "flow",
    title: "工作流出片",
    version: 1,
    steps: [
      {
        title: "这一段拍什么",
        anchor: "flow-req-input",
        body: (
          <>
            工作流把一条片<b className="font-bold text-slate-100">拆成一段一段</b>地炼。先在这里写清楚这一段要拍什么，AI 按你这句话去推演走向。这句话是<b className="font-bold text-slate-100">你自己的话</b>，与方案里 AI 写的剧情分开存着——改了它再重推，就按新要求来。
          </>
        ),
      },
      {
        title: "先挑方案再出片",
        anchor: "flow-stage",
        body: (
          <>
            <b className="font-bold text-slate-100">还没有方案时</b>，点「生成本段」先不炼视频：AI 先推演出几套走向，各带首尾帧预览铺在这块屏幕上。挑定一套之后还能换首尾帧、逐字改剧情，改完再炼。推演和出片是<b className="font-bold text-slate-100">两笔钱</b>，各花多少就印在那颗按钮上，点之前看一眼那个数。
          </>
        ),
      },
      {
        title: "同一颗推进键",
        anchor: "flow-main-btn",
        body: (
          <>
            全程只有这一颗键往前推，它<b className="font-bold text-slate-100">按当前这一拍变样</b>：还没方案时点它去推演，方案摊开、还没挑定时它是「重新生成方案」，挑定之后才变回「生成本段」——这一下才真去炼视频。旁边「⚙」里改本段的时长、画质与画幅。
          </>
        ),
      },
      {
        title: "一段炼完再往下",
        anchor: "flow-node-strip",
        body: (
          <>
            下一段<b className="font-bold text-slate-100">默认接着这一段的真实结尾画面</b>起拍，所以本段炼出来之前，后面的段一直锁着，也加不了新的一段。这不是在限制你——第一段人物就不对的话，你在这里就能止损，不必铺完整条片才发现。
          </>
        ),
      },
      {
        title: "合成一条完整片",
        anchor: "flow-finish",
        body: (
          <>
            每一段都出片之后，点右上角「完成视频」把各段并成一条片子，进剪辑页收工。炼完一段会<b className="font-bold text-slate-100">自动存一次草稿</b>；只改文字不会自动存，想留住就点旁边的「存草稿」，之后能从个人页接着做。
          </>
        ),
      },
    ],
  },
  {
    id: "studio",
    title: "卡片工坊",
    version: 1,
    steps: [
      {
        title: "工坊是什么",
        body: (
          <>
            这是一张铸卡桌：<b className="font-bold text-slate-100">素材炼成卡</b>，卡摆上桌铸成<b className="font-bold text-slate-100">一段视频</b>，段够了再推成成片。卡分这几种——{CARD_TYPES.map((t) => CARD_TYPE_LABELS[t]).join(" / ")}——它们决定每一段里出现谁、长什么样。
          </>
        ),
      },
      {
        title: "卡从哪来",
        body: (
          <>
            卡有两条来路，都在<b className="font-bold text-slate-100">点一下桌对面的铸卡师</b>之后：「📎 添加素材」先挑卡种，再把图片或文本交给她炼；「🛒 逛市场」把现成的卡摊到桌上，看中了收进卡组。递素材那一屏会先摆出这一炉要花多少 token；炼出来先过目，点「收下这批卡」才真的进你的卡组。
          </>
        ),
      },
      {
        title: "铸一段视频",
        anchor: "studio-hint",
        body: (
          <>
            点你这一侧那排上的<b className="font-bold text-slate-100">虚线卡位</b>：挑几张素材卡、写清这一段要发生什么，AI 会推演出几套走向，每套都带首尾帧预览。挑定一套后还能换帧、改剧情、按修改重画，满意了再<b className="font-bold text-slate-100">炼出本段视频</b>。底下这条提示会跟着你当前这一步换措辞。
          </>
        ),
      },
      {
        title: "一段一段来",
        body: (
          <>
            <b className="font-bold text-slate-100">炼出本段视频，下一段的卡位才会亮</b>：段与段靠上一段的真实尾帧承接起拍，攒着最后一起炼会接不上，第一段人物不对也要铺完才发现。每段都出片后，桌子右端的<b className="font-bold text-slate-100">法阵</b>会亮起，点它把这条走向铺成工作流，跟着走完就去剪辑成片。
          </>
        ),
      },
      {
        title: "退出与存草稿",
        anchor: "studio-back",
        body: (
          <>
            左上角这颗按钮是<b className="font-bold text-slate-100">唯一的出口</b>，它会说出自己下一步退什么：先关浮层、再退市场或对话，最后才回首页。桌上摆好的这些只在内存里，刷新或关掉 App 就没了——一动手，顶栏右侧就会出现<b className="font-bold text-slate-100">存草稿</b>，想过会儿接着做就先点它。
          </>
        ),
      },
    ],
  },
  {
    id: "templates",
    title: "视频模板",
    version: 1,
    steps: [
      {
        title: "模板是成品配方",
        body: (
          <>
            这一屏摆的是调好的<b className="font-bold text-slate-100">成品配方</b>：画风、运镜、分镜骨架都定好了，挑一个套上去，写一句话或者给人偶挂上你的角色卡就能出片。它和工坊的卡片市场是两回事——卡片是素材，得自己组装剧情；模板是拿来就能出片的成品。
          </>
        ),
      },
      {
        title: "封面上的角标",
        anchor: "template-card",
        body: (
          <>
            角标写着这个模板能干什么。<b className="font-bold text-slate-100">白模</b>：出片时整段复刻它的场景、道具与运镜，只把人换掉，旁边报的是这条模板视频有多长——成片长度和画幅都跟着它走；<b className="font-bold text-slate-100">几个角色位可换人</b>：画面里那几个白色人偶，各能挂一张你的角色卡。没角标的是经典配方模板，按分镜骨架重新画，旁边报的是分几段。
          </>
        ),
      },
      {
        title: "用它出片",
        anchor: "template-pick",
        body: (
          <>
            点<b className="font-bold text-slate-100">用它出片</b>就跳到出片那一屏，接下来怎么走按模板分两种：<b className="font-bold text-slate-100">带角色位</b>的那种，本段内容区是一颗挂卡的钮——点开把你的角色卡逐个挂到人偶身上，还能另加一句自己的要求；其余的（经典配方、没有角色位的老白模）是写一句话，配方会把它填进每一段剧情。每段要花多少写在「生成本段」那颗按钮上，点它之前不花钱。
          </>
        ),
      },
      {
        title: "做自己的模板",
        anchor: "templates-tab-mine",
        body: (
          <>
            <b className="font-bold text-slate-100">我的模板</b>装的是你自己做的，新做一个也从那里进：传一段视频，让 AI 把画面里的人换成一模一样的白色人偶，或者直接拿你本来就做好的白模片用。两条路在框选那一屏里挑，各要花多少钱也由那一屏当场整句报出来，确认了才开炼。
          </>
        ),
      },
      {
        title: "发布与下架",
        anchor: "template-owner-row",
        body: (
          <>
            自己的模板，卡片上只标一个<b className="font-bold text-slate-100">状态</b>（草稿 / 已发布 / 已下架）。<b className="font-bold text-slate-100">核对位置、识别角色位、发布、删除</b>这些操作都收进了模板详情页——点开卡片进去，那里按「核对 → 识别 → 试炼 → 发布」的顺序排好了。
          </>
        ),
      },
    ],
  },
  {
    id: "extractor",
    title: "提取模板",
    // ★ 2026-08-17 从 1 升到 2：这一屏的第一层从「一个白模开关」改成了**三选一**，
    //   老引导教的是一个已经不存在的开关。这正是"引导指着不存在的东西说话"那种错，
    //   所以要让**所有人重看一遍** —— 版本号平时不许动，这次是它存在的理由本身。
    version: 2,
    steps: [
      {
        title: "这一屏做什么",
        anchor: "extractor-routes",
        body: (
          <>
            拿一段参考视频，让 AI 把它变成能反复套用的<b className="font-bold text-slate-100">模板</b>。第一步就是这里的
            <b className="font-bold text-slate-100">三选一</b>：选哪条决定后面几步长什么样，也决定花不花钱、花多少。
            选错了随时能回来改，但已经传上去的视频会被回收、要重传。
          </>
        ),
      },
      {
        title: "让 AI 换成白模",
        anchor: "extractor-routes",
        body: (
          <>
            第一条：<b className="font-bold text-slate-100">任意视频都行</b>，AI 把画面里的人全换成一模一样的纯白人偶。
            别人套用时整段复刻你这段的<b className="font-bold text-slate-100">场景与运镜</b>，再逐个人偶挂上自己的人物卡，
            没挂卡的位子保持人偶原样。这条会真的出一次片，所以要花钱——具体多少在框选那一步整句报出来。
          </>
        ),
      },
      {
        title: "本来就是白模片",
        anchor: "extractor-routes",
        body: (
          <>
            第二条：这段<b className="font-bold text-slate-100">已经是白模 / 人偶片</b>（你自己做好的预演片）。
            不出片、不换人，只认出画面里有谁、量出他们在哪，<b className="font-bold text-slate-100">便宜两个量级</b>。
            这两条我们分不出来，只能你自己选：该出片的没出，模板里全是真人；不该出片的出了，白花一次钱、画质还被二次白模化。
          </>
        ),
      },
      {
        title: "经典配方",
        anchor: "extractor-routes",
        body: (
          <>
            第三条，也是默认那条：AI 从整段视频里<b className="font-bold text-slate-100">均匀抽</b>几帧看（你只定抽几帧），
            总结画风质感、运镜与分镜骨架，再提炼可复用的场景／道具卡。帧数越多认得越准，也越贵。
            它<b className="font-bold text-slate-100">不出片、不把你的视频传上公网，也是三条里唯一不需要付费套餐的</b>。
          </>
        ),
      },
      {
        title: "白模那两条怎么走",
        // ★★ 这一步**故意不带锚点**（2026-08-23）：选文件那颗按钮已经搬到第 2 步，
        //   而引导是一进这屏就跑的（那时还停在第 1 步的三选一上）。留着 anchor 的话
        //   `rectOf` 会连量 FIND_TRIES 帧都量不到，才退成居中卡片 —— 结果一样，
        //   过程却是"引导指着一个不存在的东西"（这条 tour 自己 v2 就是为这种错升的版）。
        //   ⇒ 不升 version：说的事一个字没变（选文件 → 上传 → 框选 → 报价），
        //   变的只是"指哪儿"，没必要让所有人重看一遍。
        body: (
          <>
            选文件 → 上传（<b className="font-bold text-slate-100">不花钱</b>）→ 下一步拖时间轴框出 {BLOCKOUT_INPUT_RULES.minSec}~
            {BLOCKOUT_INPUT_RULES.maxSec} 秒、拖裁剪框把台标水印框到画面外，读完报价才开炼。
            换人偶这一步<b className="font-bold text-slate-100">不是每次都全对</b>，最容易漏的是画面正中央那一个；
            出片后对着画面从左往右核对，对不上的位子删掉就行（不用重炼、不花钱）。
          </>
        ),
      },
    ],
  },
  {
    id: "cast",
    title: "挂卡面板",
    // ★ 2026-08-17 从 1 升到 2：挂卡的主界面从"一行一个人偶的竖列表"改成了
    //   **画面正下方的横排格子行**（格子还能直接接住拖拽）。老引导教的是已经折叠起来的
    //   那一列，指路会指错。版本号平时不许动，这次正是它存在的理由。
    version: 2,
    steps: [
      {
        title: "这一屏在做什么",
        anchor: "cast-stage",
        body: (
          <>
            这段视频是模板的<b className="font-bold text-slate-100">白模视频</b>：里面的人偶是占位的，还不是具体的人。给一个人偶挂上一张人物卡，出片时它就会被换成那张卡上的角色；没挂卡的位子通常保持人偶原样 —— 但素材切镜多时可能被 AI 拿已挂的卡换掉，要稳就挂满。
          </>
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
        title: "一格一个角色位",
        anchor: "cast-slot-strip",
        body: (
          <>
            画面正下方这一排格子，<b className="font-bold text-slate-100">一格就是这个模板的一个角色位</b>；
            格子上的「人物1 / 人物2」只是它的名字，<b className="font-bold text-slate-100">不表示画面里从左到右的次序</b>。
            挂卡分两下：<b className="font-bold text-slate-100">先点一格选中它，再点上面那排卡里的一张</b>；
            也可以直接把上面那排卡<b className="font-bold text-slate-100">往下拖到格子上</b> —— 拖到格子上是直接落，不会再问一遍。
            画面上画得出落点框的模板，点中一格时<b className="font-bold text-slate-100">画面上对应的那个框会亮起来</b>，
            想知道这一格是画面里的哪一个就看它。挂卡这条路任何模板都有，与画面里有没有画框无关。
            卡片只列人物卡（人偶换的是「人」）。
          </>
        ),
      },
      {
        // ★ 2026-08-17 订正：版式改成「卡在上 → 画面在中 → 格子在下」之后，拖拽只认**向下**
        //   （RoleCastBoard.beginDrag 的 `dy < 10` 直接 return）。原稿教的「往上拖」是静默死路：
        //   照着做怎么拖都没反应，零报错。同一句里的「下面那排卡」也一并反过来了。
        title: "也能拖到画面上",
        anchor: "cast-card-rail",
        body: (
          <>
            <b className="font-bold text-slate-100">不是每个模板都有这条路</b>：画面上画出了落点框才有（没有框就用格子行挂，那条路任何模板都有）。
            有框时也可以按住上面这排卡里的一张，<b className="font-bold text-slate-100">往下拖到画面里那个人偶身上</b>，人少的时候更直观。
            框是照<b className="font-bold text-slate-100">某一帧</b>量出来的，所以这时画面只在那一帧附近播一小下就自动停回去；
            播远了、人走动了，框会自己消失，画面下面会给一颗「回到标记帧」把它拨回去 —— 这是有意的，不是坏了。
          </>
        ),
      },
      {
        title: "拖到画面上会再问一次",
        body: (
          <>
            <b className="font-bold text-slate-100">只有拖到画面上</b>那一条会先问你一句「是这个人吗」，同时把画面上那个人偶高亮起来 ——
            因为那个落点是<b className="font-bold text-slate-100">推断</b>出来的（人偶会重叠、人会走动）。
            请对着高亮的那个再看一眼：挂错人<b className="font-bold text-slate-100">不会报错</b>，要等成片炼出来才看得见，
            那时已经花过一次出片的钱了。落到格子上不问 —— 落在哪一格是你眼睛看着放的，没有可推断错的余地。
          </>
        ),
      },
      {
        title: "不挂满也能出片",
        body: (
          <>
            不用挂满：挂几个换几个，剩下的照旧是人偶。挂过的位子随时能换 —— <b className="font-bold text-slate-100">点中那一格，再点另一张卡</b>就换掉了；
            那一格挂着卡时，上面卡片那一行的右端会出现<b className="font-bold text-slate-100">「取下」</b>。都弄好之后点底部的<b className="font-bold text-slate-100">「完成挂卡」</b>，就带着这份对应关系回到上一步去炼视频。
          </>
        ),
      },
    ],
  },
  {
    id: "roleconfirm",
    title: "核对角色位",
    version: 1,
    steps: [
      {
        title: "这份清单是猜的",
        body: (
          <>
            清单上每一行说的是「画面上那个人偶，原来是谁」。这份对应关系是生成时 AI 猜出来的，不保证跟成片对得上。猜错时，别人给这个位子挂的角色卡会<b className="font-bold text-slate-100">换到另一个人身上</b>，而且<b className="font-bold text-slate-100">不会有任何报错</b>——所以只有看着画面的你能确认它。
          </>
        ),
      },
      {
        title: "对着视频逐行核对",
        anchor: "roleconfirm-video",
        body: (
          <>
            视频就摆在清单上面，进度条可以拖着停在你想看的那一帧。然后逐行核对这个人偶的标记跟画面对不对得上：给的是<b className="font-bold text-slate-100">位置</b>，就对着画面从左往右数一遍；给的是<b className="font-bold text-slate-100">编号</b>，就照人偶身上印的数字改。标记必须跟你眼睛看到的完全一致——你这个模板的标记具体怎么看清楚，视频上面那段说明会讲。
          </>
        ),
      },
      {
        title: "描述给套用者看",
        anchor: "roleconfirm-desc",
        body: (
          <>
            每行那句描述说的是<b className="font-bold text-slate-100">这个位子在原视频里是谁</b>。套用你模板的人看不到你的原片，画面上又全是长得一样的人偶——他只能靠<b className="font-bold text-slate-100">标记加这句话</b>决定把哪张卡挂上去。写认得出来的外形（例：白发、黑袍的少年），别写只有你自己看得懂的代号。
          </>
        ),
      },
      {
        title: "不对就改，不用重炼",
        anchor: "roleconfirm-del",
        body: (
          <>
            对不上是可以就地改的：<b className="font-bold text-slate-100">标记写错了直接改成画面上那个</b>；清单里多出一个<b className="font-bold text-slate-100">画面上根本找不到</b>的位子，就用「删掉」去掉那一行。两件事都<b className="font-bold text-slate-100">不会再花一次钱</b>。至于你看到的是哪一种对不上、各该怎么办，视频上面那几段说明会按你这个模板讲。
          </>
        ),
      },
      {
        title: "改完一次提交",
        anchor: "roleconfirm-submit",
        body: (
          <>
            点「删掉」只是先标成待删，提交之前随时能撤销。底部那颗按钮把<b className="font-bold text-slate-100">改好的标记和要删的位子一次提交完</b>，不会留下改了一半的状态。提交完这个核对入口<b className="font-bold text-slate-100">也不会消失</b>——以后发现哪个人偶对不上，还能回来接着改。
          </>
        ),
      },
    ],
  },
  {
    id: "trim",
    title: "选段与裁剪",
    version: 1,
    steps: [
      {
        title: "这一屏在决定两件事",
        body: (
          <>
            你在这里框出的那一段、裁出的那一块，就是 AI 真正拿去白模化的全部内容。
            它同时决定<b className="font-bold text-slate-100">这一发多少钱</b>（时长越长越贵），
            而钱一开始算就退不了。
          </>
        ),
      },
      {
        title: "先框出哪一段",
        anchor: "trim-range",
        body: (
          <>
            拖两头的把手只取你要的那几秒。
            挑<b className="font-bold text-slate-100">人最齐、镜头最稳</b>的一段——
            切镜多的素材里，同一个人在不同镜头里的位置不一样，套用时容易换错人。
          </>
        ),
      },
      {
        title: "再裁掉台标与水印",
        anchor: "trim-crop",
        body: (
          <>
            拖四个角调裁剪框。水印<b className="font-bold text-amber-300">必须框到框外</b>：
            出片是逐帧复刻画面，提示词去不掉它（实测），而模板会被反复套用——
            留一个水印就是永久的。
          </>
        ),
      },
      {
        title: "裁得太小会被挡下",
        body: (
          <>
            方舟对画面大小、宽高比、时长都有硬门槛。
            不过关时下面会<b className="font-bold text-slate-100">直接说是哪一条不合</b>，按那句话改就行，
            不用在这里背数。
          </>
        ),
      },
    ],
  },
  {
    id: "workshop",
    title: "创意工坊",
    version: 1,
    steps: [
      {
        title: "这一页管卡，不出片",
        anchor: "workshop-studio-entry",
        body: (
          <>
            这里只管<b className="font-bold text-slate-100">卡片和卡组</b>这些素材，不出片。
            要摆桌铸卡、把卡炼成视频，从这条路进 3D 工坊。
          </>
        ),
      },
      {
        title: "造卡四条路，一条花钱",
        anchor: "workshop-extract-card",
        body: (
          <>
            只有工坊铸卡（AI 出图）<b className="font-bold text-slate-100">要花 token</b>。
            从视频圈选提取、自己传图、从市场拿都<b className="font-bold text-slate-100">不花</b>——
            提取是拖到某一帧、亲手圈出要的人或物，圈出来的画面就是参考图。
          </>
        ),
      },
      {
        // ★ 有意不挂锚点：它排在卡片网格下面，卡一多就掉出首屏，而引导期间页面滚不动。
        //   （屏外锚点现在会退成居中卡片，不再把「下一步」沉出屏幕 —— 但退化了圈就没了，
        //   不如一开始就写清位置。）
        title: "市场里点哪儿才是拿",
        body: (
          <>
            下面「从市场添加」那一栏：点卡面只是<b className="font-bold text-slate-100">看详情</b>，
            卡片下面那行小字才是收进自己的库。那一栏还能切成卡组、整套装走，都不花钱。
          </>
        ),
      },
      {
        title: "卡组是干什么的",
        anchor: "workshop-tabs",
        body: (
          <>
            把常用的几张归成一组；出片时<b className="font-bold text-slate-100">人物和场景由卡组锁住，全片保持一致</b>。
            散着的卡在旁边那个页签。
          </>
        ),
      },
      {
        title: "组卡组：怎么加、怎么改",
        anchor: "workshop-deck-new",
        body: (
          <>
            先点「编辑」<b className="font-bold text-slate-100">再</b>点卡片，才是加进来或拿出去；卡角能定封面。
            组名点上去直接改。删掉整组<b className="font-bold text-slate-100">不会删卡</b>。
          </>
        ),
      },
    ],
  },
  {
    id: "discover",
    title: "分区",
    version: 1,
    steps: [
      {
        title: "一个框搜两样",
        anchor: "discover-search",
        body: (
          <>
            打字之后上面先出<b className="font-bold text-slate-100">人</b>、下面出作品。
            作品是拿标题、简介、作者、分区一起对的，不只对标题。
          </>
        ),
      },
      {
        title: "搜到的人",
        anchor: "discover-users",
        body: (
          <>
            人排在作品前面，点一行进他主页 —— 有些作品这里搜不到，去他主页能看全。
            名字底下那串 <b className="font-bold text-slate-100">@ 开头的</b>，就是 @ 他时要打的那串。
          </>
        ),
      },
      {
        title: "分区图标就是开关",
        anchor: "discover-cats",
        body: (
          <>
            点一个就只看这一类，选中的那个会放大亮起来；
            <b className="font-bold text-slate-100">再点同一个才取消</b> —— 没有别的地方能关掉它。
          </>
        ),
      },
      {
        title: "现在筛的是什么",
        anchor: "discover-scope",
        body: (
          <>
            分区和搜索词是<b className="font-bold text-slate-100">叠加</b>的。这行小字写着当前筛的是什么、有几个；
            觉得作品变少了先看它。右边那两颗换排法：最火按播放多少排，最新按发布时间倒着排。
          </>
        ),
      },
    ],
  },
  {
    id: "profile",
    title: "我的",
    version: 1,
    steps: [
      {
        title: "出片花的就是这些 token",
        anchor: "profile-wallet",
        body: (
          <>
            出片、出图、铸卡、解锁付费作品，扣的都是它。点开看余额、买套餐或直充 ——
            <b className="font-bold text-slate-100">套餐按月给且先扣，直充的不过期</b>。
          </>
        ),
      },
      {
        title: "五个图标各管一堆",
        anchor: "profile-tabs",
        body: (
          <>
            从左到右是作品、草稿、卡片、卡组、收藏，点一下换一堆看。
            图标旁边那个数字是这堆有几件；<b className="font-bold text-slate-100">空的那几堆不显示数字</b>。
          </>
        ),
      },
      {
        title: "没做完的半成品在这一格",
        anchor: "profile-tab-drafts",
        body: (
          <>
            存着的半成品都在这儿。那把锁是「<b className="font-bold text-slate-100">还没发布</b>」，
            不是私密。点一张要先挑用工坊还是工作流打开 —— 同一份内容，两边都进得去。
          </>
        ),
      },
      {
        title: "谁赞了你、谁关注了你",
        anchor: "profile-notify",
        body: (
          <>
            点它看消息 —— 全 app <b className="font-bold text-slate-100">只有这一个入口</b>。
            有新的时候图标上会多一个红点，红点不报条数，进去才知道有几条。
          </>
        ),
      },
      {
        title: "这三个数字里有一个能点",
        anchor: "profile-stats",
        body: (
          <>
            「关注」那格点开是你关注过的人的名单，就地能取关。
            旁边两个是你<b className="font-bold text-slate-100">所有作品加起来</b>的总数，不是某一支的。
          </>
        ),
      },
    ],
  },
  {
    id: "tpldetail",
    title: "模板详情",
    version: 1,
    steps: [
      {
        title: "白模那种模板：视频就是成片",
        anchor: "template-refvideo",
        body: (
          <>
            白模那种模板，出片就是<b className="font-bold text-slate-100">整段复刻这段视频</b>、只把人偶换掉。
            上面的报价把模板视频自己的时长也计了一遍，不是只按出片时长算。
          </>
        ),
      },
      {
        title: "点「用它出片」还不扣钱",
        body: (
          <>
            那颗按钮只是把配方铺到出片那一屏，<b className="font-bold text-slate-100">钱要到那边点生成才扣</b>。
            有角色位的模板会先领你去给人偶挂卡。
          </>
        ),
      },
      {
        title: "自己做的那条才多一行",
        body: (
          <>
            最底下那一行<b className="font-bold text-slate-100">只有作者看得见</b>。
            发布＝别人搜得到、能付费套用；白模模板要先用它真出过一段片才让发。
            下架只是收回来，你那份还在。
          </>
        ),
      },
      {
        title: "删除是真的销毁",
        body: (
          <>
            那一行最右那颗不是从列表里划掉：<b className="font-bold text-slate-100">云端那段模板视频和原始素材会一起没掉</b>，
            谁都找不回。所以要点两下才认。
          </>
        ),
      },
    ],
  },
  {
    id: "canvas",
    title: "流水线画布",
    // v2（2026-08-27）：末步原来讲的是「≡ 收起画布回线性视图」，而线性视图 08-23 已
    // 下线、那颗按钮改成了「🎴 工坊」——老引导在教一个不存在的退路，正是文件头说的
    // 「改版到老引导会误导人」，所以升版本让所有人重看。
    version: 2,
    steps: [
      {
        title: "一屏看完整条片",
        anchor: "canvas-card",
        body: (
          <>
            每一格是<b className="font-bold text-slate-100">一段</b>，从左往右就是这条片的顺序。
            点一格<b className="font-bold text-slate-100">就地打开这一段的编辑窗</b>，再点一下收起，点别的格子就换过去。
            画布可以拖着平移、两指捏合缩放。
          </>
        ),
      },
      {
        title: "一段有两种做法",
        anchor: "canvas-modes",
        body: (
          <>
            编辑窗顶部这对按钮切的是<b className="font-bold text-slate-100">这一段</b>怎么做：
            「套模板」是拿一段白模视频复刻运镜与站位，你只需给里面的人偶挂上自己的角色卡；
            「自选卡片」是自己挑素材卡、写一句要求，AI 推演几套走向让你挑。
            两种<b className="font-bold text-slate-100">每段各选各的</b>，同一条片里可以混着来。
          </>
        ),
      },
      {
        title: "对画布说话",
        anchor: "canvas-agent",
        body: (
          <>
            一句话就能改流水线：给哪段套哪个模板、把谁挂到哪个位子、这段拍什么、加一段。
            {/* ★ 这三件里**挂卡合成是免费的**（cost 恒 0，见 canvasAgent 的 AgentProposal）。
                写成"会花钱的三件"是错的报价口径，而这个仓库里报价说错是最贵的一类错
                （CLAUDE.md「两仓价目表各写各的」）。所以措辞按**要不要你点头**分，
                确认卡上那行标的是价钱**或**后果。 */}
            <b className="font-bold text-slate-100">它不替你按那三件</b> —— 推演、出片（真花钱），
            以及挂卡合成（不花钱，但会把你改过的点名句整段重写）。它只摆一张确认卡，
            上面写着这一下要花多少、或者会覆盖掉什么，你点了才真跑。办成了什么、被拒了什么，它逐条列给你看。
          </>
        ),
      },
      {
        // ★ 这一步**有意不挂锚点**：终端格子在流水线**末段之后**，段一多就在视口外，
        //   而 off-screen 元素的 rect 仍返回非零宽高 —— 退化成居中卡片那条兜底不会触发，
        //   圈会画到屏幕外（本文件顶部那条 ⚠ 说的就是它）。所以改成用文字自定位。
        title: "流水线的终点",
        body: (
          <>
            一直往右拖到<b className="font-bold text-slate-100">末段后面</b>，跟着两格：一格<b className="font-bold text-slate-100">加下一段</b>，
            一格<b className="font-bold text-slate-100">把各段合成整片</b>（每段都出片了才亮，还差几段它会说）。
            已经出片的格子右上角有个 ▶，随时能回看那一段。
          </>
        ),
      },
      {
        title: "横竖都能用",
        anchor: "canvas-rotate",
        body: (
          <>
            竖屏时编辑窗从下面升起，横屏时它挪到右边、画布留给左边 —— 段多的时候横过来看更痛快。
            旁边那颗 💾 随时把这条片存成草稿，回头接着做。
          </>
        ),
      },
      {
        title: "同一条片的另一面",
        anchor: "canvas-linear",
        body: (
          <>
            点它把这条流水线带去 <b className="font-bold text-slate-100">3D 工坊</b>：画布是摊开的流水线，
            工坊是摆在桌上的节点卡，<b className="font-bold text-slate-100">两边改的是同一份</b>，
            换个面打开不用重炼、不重复收费。
          </>
        ),
      },
    ],
  },
  {
    id: "cut",
    title: "剪辑",
    // 2026-08-28 从 CutPage 自带的那份帮助弹窗迁来（铁律六：帮助内容只在 tours 一处）。
    // 首次进页自动弹是新增的行为——原来那份只有主动点 ? 才看得到。
    version: 1,
    steps: [
      {
        title: "三个页签各管一摊",
        anchor: "cut-tabs",
        body: (
          <>
            <b className="font-bold text-slate-100">剪辑</b>管顺序与取舍，
            <b className="font-bold text-slate-100">圈选</b>管改画面（要花钱的那种改），
            <b className="font-bold text-slate-100">音频</b>管配乐 —— AI 生成的画面本身没有声音，
            想要声音就在这儿配。
          </>
        ),
      },
      {
        title: "剪辑：不花钱的整理",
        anchor: "cut-timeline",
        body: (
          <>
            点一个片段选中，就能在播放头处<b className="font-bold text-slate-100">✂️ 分割</b>、
            <b className="font-bold text-slate-100">🗑 删除</b>、拖拽或前移后移<b className="font-bold text-slate-100">换序</b>。
            这些只改导出范围，<b className="font-bold text-slate-100">一个 token 都不花</b>。
          </>
        ),
      },
      {
        title: "圈选：花钱的重生成",
        body: (
          <>
            拖进度条停在要改的画面，⭕ 圈出物体、写一句要求；可以<b className="font-bold text-slate-100">跨帧跨段圈多处</b>，
            攒齐了一次性重新生成 —— 按钮上会标出几段、多少钱，<b className="font-bold text-slate-100">点那一下才计费</b>。
          </>
        ),
      },
      {
        title: "右上角是终点",
        anchor: "cut-next",
        body: (
          <>
            整条模式下「下一步」把时间轴按顺序导出成<b className="font-bold text-slate-100">一整条视频</b>、进发布页
            —— <b className="font-bold text-slate-100">发布后作品不可再修改</b>。从工坊单段进来时它是「保存本段」，
            改完写回那一段、不合并不发片。
          </>
        ),
      },
    ],
  },
  {
    id: "publish",
    title: "发布",
    version: 1,
    steps: [
      {
        title: "先核对成片",
        anchor: "publish-segments",
        body: (
          <>
            预览里各段按时间线连播。这张清单标着每段的<b className="font-bold text-slate-100">来历</b>：
            ✓ 是真生成的影像，⚠ 是没生成成功、用首尾帧渐变顶替的段 ——
            <b className="font-bold text-slate-100">发布前把 ⚠ 的段看一眼</b>，别让顶替画面替你见观众。
          </>
        ),
      },
      {
        title: "谁能看、要不要钱",
        anchor: "publish-pricing",
        body: (
          <>
            可见性管<b className="font-bold text-slate-100">谁看得到</b>，收费管
            <b className="font-bold text-slate-100">看要不要花 token</b>。付费解锁的收益按平台抽成后进你的
            add-on 钱包，能直接拿来生成视频 —— 具体到手多少，定价那一行会当场算给你看。
          </>
        ),
      },
      {
        title: "发布就是定稿",
        anchor: "publish-actions",
        body: (
          <>
            发布后<b className="font-bold text-slate-100">内容不可再改</b>（编辑页只能改标题、封面这些壳），
            想换内容就重新发一条。「放弃本次合成」会把这条成片丢掉 —— 点它会先问你一句。
          </>
        ),
      },
    ],
  },
  {
    id: "customcard",
    title: "自己传图做卡片",
    // 2026-08-28 文案收纳：页面顶上那块三条 bullet 的对比说明压成一句，展开讲在这。
    // 首次进页强制放一遍，"这是另一条路、默认铸卡不用传图"这件事仍然人人看得到。
    version: 1,
    steps: [
      {
        title: "这是另一条路",
        anchor: "cc-compare",
        body: (
          <>
            默认铸卡是 <b className="font-bold text-slate-100">AI 全自动出图</b>（3D 工坊找铸卡师），
            一张图都不用传。这一页反过来：全用你自己的图，
            <b className="font-bold text-slate-100">不调模型、不耗 token</b>，也没有 AI 帮你补图位。
            铸出来的卡与 AI 铸的完全同一种东西 —— 能进卡组、当出片的形象参考、发布到创意工坊。
          </>
        ),
      },
      {
        title: "图位怎么摆",
        anchor: "cc-slots",
        body: (
          <>
            卡种决定有哪几个图位、每格锁住什么（一把剑不该有「全身立绘」）；换卡种时对不上的格子会被
            取下来并当场告诉你。<b className="font-bold text-slate-100">第一格既是卡面也是主形象参考</b>：
            卡框是竖版 2:3，别的比例会居中显示，不裁你的图。
          </>
        ),
      },
      {
        title: "图会被怎么处理",
        body: (
          <>
            相册原图直接选：会自动压到 AI 认得出的尺寸，长宽比超过 {REF_MAX_RATIO}:1 的会被居中裁进
            {REF_MAX_RATIO}:1（方舟不收更极端的参考图），裁过会在那一格里写明。出片时
            <b className="font-bold text-slate-100">不是每张都会喂进模型</b>：取几张要看这张卡在那一段里
            排第几、同段还挂了几张卡 —— 详情页会逐张标「出片用 / 仅展示」，那里是唯一的判据。
          </>
        ),
      },
      {
        title: "写给 AI 的那段信息",
        anchor: "cc-info",
        body: (
          <>
            第 ④ 步那段信息，之后 AI 复刻这张卡的画面 / 建模时会读，
            <b className="font-bold text-slate-100">写得越具体越像</b>。不填也行 ——
            详情页会按卡名与简介现补一份。
          </>
        ),
      },
    ],
  },
  // ── 设置子页（2026-08-27 设置页拆分时一起加）──────────────────────
  // 设置页原来把说明文字直接铺在每一节里；拆成子页后常驻说明进这里，页面上只留
  // 控件与条件触发的事实（离线/失败/管理员那几句仍在界面上，理由见文件头 ❌ 那条）。
  {
    id: "setprofile",
    title: "编辑资料",
    version: 1,
    steps: [
      {
        title: "换头像",
        anchor: "setprofile-avatar",
        body: (
          <>
            点头像打开选择器：官方看板娘现成可选，最后一格从相册选自己的图，
            <b className="font-bold text-slate-100">能拖动裁切、双指缩放</b>。不想用图，下面还能挑一个
            emoji 顶着。
          </>
        ),
      },
      {
        title: "昵称和简介",
        anchor: "setprofile-form",
        body: (
          <>
            昵称是别人看到的名字，简介挂在主页名字底下。这两样改完要点
            <b className="font-bold text-slate-100">「保存资料」</b>才算数 —— 头像不用，点了就换。
          </>
        ),
      },
    ],
  },
  {
    id: "setvoice",
    title: "铸卡师的声音",
    version: 1,
    steps: [
      {
        title: "点一条就试听",
        anchor: "setvoice-list",
        body: (
          <>
            每一条是一把嗓子，<b className="font-bold text-slate-100">点一下立刻念一句样本、同时选定它</b>。
            标着「调和」的是几把嗓子混出来的。
          </>
        ),
      },
      {
        title: "挑完嗓子还有两个旋钮",
        anchor: "setvoice-tune",
        body: (
          <>
            语速管快慢；语调用一句话描述想要的语气，
            <b className="font-bold text-slate-100">改完点上面任意音色即刻再听</b>。语调那一段不计费，
            只对单音色生效 ——「调和」那几条用不了。
          </>
        ),
      },
    ],
  },
  {
    id: "setquality",
    title: "画面质量",
    version: 1,
    steps: [
      {
        title: "只管 3D 工坊",
        anchor: "setquality-opts",
        body: (
          <>
            这三档管的是工坊里 3D 形象的贴图精细度，
            <b className="font-bold text-slate-100">跟出片视频的清晰度无关</b>。第一次进工坊会按机型
            自动选一档；之后想换，全 app 只有这里能改。换档会重新加载一次。
          </>
        ),
      },
    ],
  },
  {
    id: "setstorage",
    title: "存储与清理",
    version: 1,
    steps: [
      {
        title: "占的空间在这看、也在这清",
        anchor: "setstorage-usage",
        body: (
          <>
            上面是这台设备已经占用的空间。「清理缓存」
            <b className="font-bold text-slate-100">只删生成过程中留下、已经没人引用的中间文件</b> ——
            未发布的草稿和还没传上去的作品一个不动。
          </>
        ),
      },
    ],
  },
];

export function tourById(id: string): GuideTour | null {
  return TOURS.find((t) => t.id === id) ?? null;
}
