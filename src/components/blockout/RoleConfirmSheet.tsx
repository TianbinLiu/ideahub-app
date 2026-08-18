// 作者核对角色位标记（白模 V2）—— 入口 + 面板，**只有作者自己看得到**。
//
// ★★ 为什么必须有这一步：白模化落库那一刻的 label 是**服务端按视觉那一步的结果猜的**
//   （序数是按 AI 量出来的横向位置排的名次，编号是按顺序编的），而画面上真正长什么样
//   要看成片。两者对不上时，套用者给「从左数第3个」（老模板是"3 号位"）挂上张三 ——
//   模型老老实实换掉画面上真正的第 3 个人（另一个人），**钱照扣、零报错**。
//   所以这一屏把白模视频摆在最上面：标记只能由**看着画面的人**确认。
//
// ★★ 两种标记方案，这一屏整体分支（判据的唯一实现是 `data/templates.markSpecOf`）：
//     · **序数**（2026-08-17 起新做的）：人偶全是一模一样的纯白色，靠"从左往右第几个"
//       指认。左边那格从文本输入框换成**位置选择器**，候选集是 `t.markSlots`（这段视频里
//       真实存在的那几个位置）—— **不是**一张凭空的 1..9 表：让作者选到一个画面上根本
//       没有的位置，就造出一个永远挂不上、也永远不报错的死位子。
//     · **编号**（存量老模板）：数字输入框，逐字保留今天的样子。线上那两个还在用的
//       老模板走的就是这条路，**一个像素都不许动**。
//
// ★★ 为什么这一屏还必须能**删掉一个角色位**（实测逼出来的常规操作，两种方案都要）：
//   · 编号版：方舟画编号并不可靠。同一段 5 人素材实出过 2/2/1/1/5（两组重号，3 和 4
//     整个没出现）与 3/1/1/4/5。而**库里永远不会有两个「1」**——落库那份是服务端自己编的
//     连续 1..N，PATCH 又拒重号。所以重号只发生在**画面上**，作者的真实局面是：
//     画面 2/2/1/1/5 ⇒ 可寻址的号只有 2、1、5 三个 ⇒ 改三个位子的号 + **删掉另外两个**。
//   · 序数版：白模化那一步仍然会漏人（最常见的还是**画面正中央那个"最像主角"的没被换成
//     人偶**），而且 AI 报的横向名次本身就是猜测。前者只能删位，后者对调相邻两行。
//   没有"删"这一步，作者唯一的出路是再花一次钱重炼整段。
//
// ★★★ 序数方案独有的一条失效模式（编号/颜色时代都不存在，必须在界面上明说）：
//   **删掉一个位子之后，它右边那些位子的序数会变** —— 因为序数不是印在人身上的记号，
//   而是"从左往右数第几个"这个**相对**说法。作者若是因为"画面上根本没有这个人偶"才删它，
//   那么它右边所有位子都要往左挪一位；若只是这一行多余（比如两行指的是同一个人），
//   画面上人偶还在，右边的就不用动。这两件事只有看着画面的人分得清，所以我们
//   **不自动改**，只把话说清楚（自动改一次就等于替他做了一个可能错的决定，而且零报错）。
//
// ★★ 改标记与删位是**同一次动作的两半，必须一次提交**：把 1 号位改成「2」时库里已经有个
//   「2」（序数同理：把这一行改成「最右边」时库里已经有个「最右边」）—— 任何"先改后删"的
//   中间态都会撞服务端的重号闸（400）。而"先删后改"能走通却会在中间态落库，第二次失败就
//   留下一个「删了但没改完、labelConfirmed 已被置 true」的模板，作者从入口看它是"已核对"、
//   实际标记是错的（正是这条链路最要防的形状：错了零报错）。
//   所以这一屏收集**完整的那一份**，一次 PATCH（服务端整份替换，"少给一条 = 删掉它"）。
//
// ★★ 剩下的 label **一个字都不许动**：它就是"怎么指认这个人偶"那句话本身。删掉一条之后
//   把剩下的重排成 1..N、或者把"从左数第3个"顺手写成"第三个"，等于把卡挂到别人身上，
//   且两边都不报错。所以本组件对 rows **只做两件事**：改某一行的 label/desc、
//   `filter` 掉待删的那几行。全组件内不许出现对 rows 的 `sort`、按下标重新赋 label、
//   任何"补齐/连号"。
//
// ★★★ 本文件里**没有任何序数措辞常量**：位置选择器的候选来自 `t.markSlots`（服务端给的）。
//   措辞的唯一实现在服务端（data/templates 那段 ★★★）。
//
// ★ 判据一律不在这里重写（铁律六）：下限问 `data/templates.roleFloorIssue`，上限问
//   `BLOCKOUT_MAX_ROLES`（跨仓镜像常量），重号/已发布/仅作者的唯一实现在服务端 ——
//   提交后原样显示它回的整句，绝不自己编一句盖过去。
// ★ 只收 props、不认 store（PlanBoard / RoleCastBoard 同款约束）。调 data 层的唯一入口
//   （confirmTemplateRoles / setTemplatePublished / remoteStateOf）不算"认 store"：
//   那几个函数本身就是"一处实现"。
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Icon from "../Icon";
import HelpButton from "../guide/HelpButton";
import { useAutoGuide } from "../guide/useAutoGuide";
import MarkBadge from "./MarkBadge";
import {
  BLOCKOUT_MAX_ROLES,
  confirmTemplateRoles,
  markNoun,
  markSpecOf,
  refreshRemoteTemplate,
  remoteStateOf,
  roleFloorIssue,
  setTemplatePublished,
  subscribeTemplates,
  templatesVersion,
} from "../../data/templates";
import { uid, VideoTemplate } from "../../types";

/** 面板里的一行。★ `key` 只是 React 的稳定身份，**不参与提交**；`doomed` = 待删（两段式
 *  删除的第一段，此刻还没从 rows 里移除，见 delRow 的 ★） */
interface Row {
  key: string;
  label: string;
  desc: string;
  doomed: boolean;
}

/** data 层版本订阅：下架成功后要**就地**转入可编辑态（remoteStateOf 那份快照变了）。
 *  ★ 不从 pages/TemplateMarketPage 借 useTemplatesVersion —— 那会让组件 import 页面、
 *    而页面又 import 这个组件，Vite 下的循环 import 会拿到半初始化的模块 */
function useTemplatesTick(): number {
  return useSyncExternalStore(subscribeTemplates, templatesVersion, () => 0);
}

export default function RoleConfirmSheet({ t, onClose }: { t: VideoTemplate; onClose: () => void }) {
  // ★ 浮层也要自己声明引导（不是路由，按 pathname 集中判的话这一屏永远轮不到）。
  //   第一次打开时强制放一遍，看过一次不再自动弹；标题栏那颗 ? 随时能重看。
  useAutoGuide("roleconfirm");
  const [rows, setRows] = useState<Row[]>(() =>
    (t.roles ?? []).map((r) => ({ key: uid("role"), label: r.label, desc: r.desc, doomed: false })),
  );
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState("");
  const [pubBusy, setPubBusy] = useState(false);
  useTemplatesTick();

  /** 这个模板是哪种标记方案（判据只有 data 层一处）。整屏的输入方式与措辞都跟着它走 */
  const spec = markSpecOf(t);
  const ordinal = spec.scheme === "ordinal";
  /**
   * 这一条描述会不会**进到付费提示词里**。
   *
   * ★★★ 判据是 `markDescs` 存不存在，与服务端 PATCH /roles 那一条逐字同源：
   *   它只**改已有的**、绝不凭空创建。两边一漂就是这屏在骗人：
   *   要么说“只给人看”而它其实进了提示词，要么说“会进提示词”而作者白写一场。
   * ★ V2（白模化）那条路没有这一位 —— 它的描述说的是“原片里是谁”，只给人看。
   */
  const descGoesToPrompt = ordinal && !!t.markDescs?.length;
  const noun = markNoun(spec);
  /** 序数方案下可选的那几个位置 = **这段视频里真实存在的**那几个（不是一张凭空的 1..9 表）。
   *  ★ 这正是当初选择存 `markSlots`（而不是一个 `markScheme` 枚举）的理由之一：
   *    删掉一个位子之后还能把它**加回来**，而"这段里只有这几个位置"这句话也才说得准
   *    —— 删过位之后从 `rows` 推是错的。 */
  const slots = ordinal ? spec.slots : [];

  // 服务端那份状态快照（remoteStateOf 唯一实现）。null = 还没到货 —— 那就什么都不断言，
  // 由提交时服务端的整句 400 说了算（★ UI 只把已知的快照画出来，不自己判"能不能改"）
  const rs = remoteStateOf(t);
  const kept = rows.filter((r) => !r.doomed);
  const doomed = rows.filter((r) => r.doomed);
  /** 再删一条会不会跌破下限（判据的唯一实现在 data 层，这里只问它） */
  const floorNext = roleFloorIssue(kept.length - 1);
  /** 提交时真正会发出去的条数已经到上限了吗（上限是**服务端收几条**，不是屏幕上有几行，
   *  所以数的是 kept 而不是 rows —— 9 行里有 1 行待删时，再加一行提交仍是 9 条） */
  const atMax = kept.length >= BLOCKOUT_MAX_ROLES;
  /** 序数方案下"还能加一个吗"另有一道**更早的**天花板：这段视频里一共就那么几个位置。
   *  ★ 加出来的那一行必须**预先落上一个真实存在的位置**（见「加一个」按钮的 ★）：
   *    空 label 会被 confirmTemplateRoles 整句拒，而摆一个必然被拒的按钮是本仓的老坑。 */
  const freeSlots = slots.filter((s) => !kept.some((r) => r.label === s));
  const canAdd = ordinal ? !atMax && freeSlots.length > 0 : !atMax;

  function setRow(key: string, patch: Partial<Pick<Row, "label" | "desc">>) {
    setRows((rs0) => rs0.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /**
   * ★★ 两段式删除（点一下进"待删"，提交时才真的少发那一条），不用系统 confirm、不用弹窗：
   *   ① 删掉的 `desc` 是 AI/作者写的原文，直接移除就没了，只能手打回来——**无 undo 的
   *      损失是无声的**；
   *   ② 底部那条汇总把"这次整份替换会少哪几条"在点最终按钮**之前**变成可见的，正面对冲
   *      "服务端分不清作者有意删和客户端状态丢了一条"这个已知风险；
   *   ③ 弹窗在这一屏最没用：作者要一边看视频一边删，弹窗会把视频盖住。
   */
  function delRow(key: string) {
    setRows((rs0) => rs0.map((r) => (r.key === key ? { ...r, doomed: true } : r)));
  }

  async function save() {
    setIssue("");
    setBusy(true);
    try {
      // ★ 唯一的变换是 filter 掉待删的那几行（再脱掉本地 key）：顺序与 label 逐字沿用
      //   作者面板里的那一份。**别在这里排序或补号**（见文件头 ★★）
      await confirmTemplateRoles(
        t.id,
        kept.map((r) => ({ label: r.label, desc: r.desc })),
      );
      onClose();
    } catch (e) {
      // 服务端/数据层给的是整句人话（重号、已发布、下限、老服务端…），原样显示。
      // ★ 全 app 没有任何地方监听 emitApiError —— 这里不接住就是静默失败（铁律八）
      setIssue(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 已发布的模板服务端拒改编号（要先下架）。★ 走 setTemplatePublished 唯一入口，
   *  别自己调 branch API —— 本机 published 镜像与市场缓存要跟着一起翻 */
  async function unpublish() {
    setIssue("");
    setPubBusy(true);
    try {
      await setTemplatePublished(t.id, false);
    } catch (e) {
      setIssue(e instanceof Error ? e.message : String(e));
    } finally {
      setPubBusy(false);
    }
  }

  // ★ createPortal 到 body：祖先上任何一个 backdrop-blur / transform 都会给
  //   `position: fixed` 的后代造包含块，inset-0 于是只铺满那个盒子（CLAUDE.md 的坑）
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/85 backdrop-blur-sm">
      <div className="safe-top flex items-center gap-2 px-4 py-3">
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel">
          <Icon name="close" size={16} className="text-slate-300" />
        </button>
        <h2 className="text-sm font-bold text-slate-100">核对角色位{noun}</h2>
        <HelpButton tour="roleconfirm" className="ml-auto" />
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-40">
        {/* 已发布：**不藏入口、也不禁输入框**（真正的判据在服务端，UI 只把快照画出来），
            而是给一颗真能点的「先下架」。绝不摆一个点了必然失败的按钮，也绝不让作者
            对着一句 400 干瞪眼（铁律八：失败要响 + 要有下一步） */}
        {rs?.status === "published" && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-[11px] leading-relaxed text-amber-200">
              这个模板<b className="font-bold">已经发布在市场上</b>，服务端不许直接改它的{noun}（包括删掉画面上
              找不到的那个位子）—— {noun}一变，正在用它的人手里那份「哪个人偶挂谁」就全对不上了，而他们那边
              不会有任何提示。先下架，改完再发布一次。
            </p>
            <button
              onClick={() => void unpublish()}
              disabled={pubBusy}
              className="mt-2 rounded-full bg-amber-500/90 px-3 py-1 text-[11px] font-bold text-ink disabled:opacity-50"
            >
              {pubBusy ? "下架中…" : `先下架，再改${noun}`}
            </button>
          </div>
        )}
        {rs?.status === "blocked" && (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-300">
            这个模板已被平台下架，状态由平台管理 —— {noun}改不了，你自己也下架不了它。
          </p>
        )}

        {/* 老模板（编号版）：回答作者心里真正的问题 ——「我这个是不是过时了、要不要重做」。
            ★ 低调色（不是警告色）：它不是问题，只是一条说明。答案是**不用重做**。 */}
        {!ordinal && (
          <p className="rounded-lg border border-slate-700/70 bg-panel/60 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
            这是<b className="font-bold">编号版</b>的老模板（2026-08-17 之前做的）。新做的模板改用
            按位置指认了 —— 这一个继续按编号用，不受影响，<b className="font-bold">也不用重做</b>。
          </p>
        )}

        {/* ★ 这几段话不许缩写成"请核对一下"：不说清后果，作者会以为这只是个可填可不填的
            表单；不说"对不上也不用重炼"，他看到画面对不上时会直接去重炼（再花一次钱）。
            ★★ 顺序 = 作者的操作顺序，也是**按实测频率**排的：序数方案下最常见的仍然是
            "有个人没被人偶化"（历次失败里画面正中央那个最像主角的占绝大多数），
            其次是"相邻两行的位置排反了"，重号一次都没出现过 —— 但那一段不能删，
            服务端的重号闸还在，撞上闸的作者必须读得懂那句话并知道下一步。
            ★ 这里**不出现任何百分比**：钱已经花完了，讲概率没有用，只讲"你现在看到的是
            哪一种错、下一步做什么"。命中率那句话在花钱**之前**的两屏说（提取器/看帧那屏）。 */}
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          {ordinal ? (
            <>
              下面这份「从左往右第几个是谁」是生成时<b className="font-bold">按 AI 量的位置排的猜测</b>，
              不保证与画面上真实的站位一致。请对着视频<b className="font-bold">从左往右数一遍</b> ——
              对不上时，别人给「最左边」挂的角色卡会换到另一个人身上，而且
              <b className="font-bold">不会有任何报错</b>。
              好消息是人偶全都一模一样、身上没有任何记号：你只需要数数，不用去找看不清的号。
            </>
          ) : (
            <>
              下面这份编号是生成时<b className="font-bold">按顺序编的猜测</b>，不保证与画面上人偶头上的
              数字一致（编号只印在人偶的某一面，多半是额头或后脑，转过身可能就看不见了 ——
              拖动进度条找到能看清号的那一帧再核对）。请对着视频逐个看清楚，改成画面上真实的数字 ——
              编号对不上时，别人给「3 号位」挂的角色卡会换到另一个人身上，而且
              <b className="font-bold">不会有任何报错</b>。
            </>
          )}
        </p>
        {ordinal ? (
          <>
            <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-[11px] leading-relaxed text-sky-200/90">
              最常见的一种：<b className="font-bold">有个人根本没被换成人偶</b>（还是原来的样子），
              尤其是画面正中央、看起来最像主角的那一个。这时清单里就多出一个画面上不存在的位子 ——
              <b className="font-bold">把它删掉就行，不用重炼</b>。
              ⚠ 但删完要顺手检查一遍：画面上少了一个人偶，<b className="font-bold">它右边那些人从左数
              就都要往左挪一位</b>（这一条是按位置指认独有的，编号版没有）。
            </p>
            <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-[11px] leading-relaxed text-sky-200/90">
              第二种：<b className="font-bold">相邻两行的位置排反了</b>（清单说他是从左数第 2 个，
              画面上他其实是第 3 个）。把这两行的位置互换过来就行，同样不用重炼。
            </p>
            <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-[11px] leading-relaxed text-sky-200/90">
              万一<b className="font-bold">两个人偶站得几乎重叠</b>、从左往右数不出先后：挂在这个位置上
              的卡<b className="font-bold">可能会换错人</b>（模型也只能按从左到右去找）。
              不想赌，就把这个位子删掉 —— 那两个人偶会保持白色人偶原样出现在片子里。
            </p>
          </>
        ) : (
          <>
            <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-[11px] leading-relaxed text-sky-200/90">
              画面上<b className="font-bold">可能有两个人偶印着同一个号</b>，也可能<b className="font-bold">某个号在画面上
              根本找不到</b>（实测都出现过：一段 5 人素材实出 2/2/1/1/5，3 号和 4 号整个没出现）。
              这两种<b className="font-bold">都不用重炼</b>：把找不到的那个位子删掉就行，剩下的编号一个都不会变。
            </p>
            <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-[11px] leading-relaxed text-sky-200/90">
              如果两个人偶印着同一个号：挂在这个号上的卡<b className="font-bold">可能会把两个人一起换成同一张卡</b>
              （模型只认数字，分不出哪个是你要的）。不想要这个效果，就把这个号的位子也删掉 ——
              那两个人偶会保持白模原样出现在片子里。
            </p>
          </>
        )}
        {/* 诚实的边界：不写这句，作者会以为删位是万能的，对着一段全错的白模删到只剩一个 */}
        <p className="px-1 text-[10px] leading-relaxed text-slate-500">
          {ordinal
            ? "如果画面上根本数不出这么多人偶，这段白模本身就没做好 —— 删位只能救回一部分，要全对得上只能重炼（要再花一次钱）。"
            : "如果画面上大部分号都对不上，这段白模的编号本身就没画好 —— 删位只能救回一部分，要全对得上只能重炼（要再花一次钱）。"}
        </p>

        {t.refVideo && (
          <video
            data-guide="roleconfirm-video"
            src={t.refVideo.url}
            controls
            playsInline
            className="max-h-[38vh] w-full rounded-xl bg-black object-contain"
          />
        )}

        {rows.map((r, i) =>
          r.doomed ? (
            // 待删态：整行降透明度 + 整句后果 + 一颗撤销。★ 此刻**不从 rows 里移除**
            <div
              key={r.key}
              className="rounded-xl border border-dashed border-rose-500/50 bg-rose-500/5 p-2.5 opacity-80"
            >
              <div className="flex items-center gap-2">
                <MarkBadge spec={spec} label={r.label || `（空${noun}）`} tone="doomed" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400 line-through">{r.desc}</span>
                <button
                  onClick={() => setRows((rs0) => rs0.map((x) => (x.key === r.key ? { ...x, doomed: false } : x)))}
                  className="flex flex-none items-center gap-1 rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-100"
                >
                  <Icon name="replay" size={12} />
                  撤销
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-rose-200/90">
                {ordinal ? (
                  <>
                    删掉之后，<b className="font-bold">{r.label || "这个位置"}</b>那个人偶就
                    <b className="font-bold">没法挂卡了</b> —— 它会保持白色人偶原样出现在片子里。
                    <br />
                    ⚠ 如果你删它是因为<b className="font-bold">画面上根本没有这个人偶</b>，那么它右边
                    所有位子从左数都要<b className="font-bold">往左挪一位</b>，请顺手把它们也改一下；
                    如果画面上那个人偶还在（只是你不想让人挂卡），右边的一个都不用动。
                  </>
                ) : (
                  <>
                    删掉之后，画面上这个人偶就<b className="font-bold">没有编号了</b> ——
                    套用你模板的人不能给它挂卡，它会保持白模人偶原样出现在片子里。剩下的编号一个都不会变。
                  </>
                )}
              </p>
            </div>
          ) : (
            <div key={r.key} className="rounded-xl border border-slate-700/70 bg-panel p-2.5">
              {/* 序数方案：选择器摆在自己一行（最多 9 个 6 字措辞，塞不进左边那个 w-14 的格子）。
                  ★★ **已被别的行占用的位置照样可选**：作者最常做的操作就是把相邻两行对调，
                    中途必然出现两行同位置的中间态。把它禁掉的话对调根本做不到。
                    重号的唯一判据仍在服务端（提交后原样显示它那句 400），这里一个字都不重写。
                  ★ 候选集是 `t.markSlots`（这段视频里真实存在的位置），**不是**一张凭空的 1..9 表 ——
                    选到一个画面上根本没有的位置，就造出一个永远挂不上也永远不报错的死位子。
                  ★★★ 这些按钮上的文字是 `markSlots[i]` **原样**，本仓不许自己拼「第 N 个」
                    （data/templates 那段 ★★★：措辞的唯一实现在服务端）。 */}
              {ordinal ? (
                <div className="mb-2">
                  <div className="mb-1 text-[9px] text-slate-500">这个人偶在画面上排第几（点一下换）</div>
                  <div className="flex flex-wrap gap-1.5">
                    {slots.map((s) => (
                      <button
                        key={s}
                        onClick={() => setRow(r.key, { label: s })}
                        aria-label={`把这个角色位改成${s}`}
                        aria-pressed={s === r.label}
                        className={`rounded-md px-1.5 py-1 text-[11px] font-bold ${
                          s === r.label ? "bg-sky-500/25 text-sky-100 ring-1 ring-sky-400" : "bg-black/40 text-slate-400"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex items-start gap-2">
                {/* 编号方案：逐字保留今天那个输入框（线上老模板走的就是这条路） */}
                {!ordinal && (
                  <div className="flex-none">
                    <div className="mb-1 text-[9px] text-slate-500">人偶编号</div>
                    <input
                      value={r.label}
                      onChange={(e) => setRow(r.key, { label: e.target.value })}
                      inputMode="text"
                      maxLength={8}
                      className="w-14 rounded-lg bg-black/40 px-2 py-1.5 text-center text-sm font-bold text-slate-100 outline-none"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-[9px] text-slate-500">
                    {descGoesToPrompt
                      ? "画面里怎么认出这个人偶（这句话会进出片提示词）"
                      : "这个位置原来是谁（套用的人只看这句话）"}
                  </div>
                  <input
                    /* ★ 引导锚点只给第一行：每行都写的话 querySelector 命中的仍是第一个，
                         但高亮圈会随列表顺序漂移（第一行被删成待删态时那一行就没有输入框了） */
                    data-guide={i === 0 ? "roleconfirm-desc" : undefined}
                    value={r.desc}
                    onChange={(e) => setRow(r.key, { desc: e.target.value })}
                    maxLength={300}
                    placeholder={descGoesToPrompt ? "例：白色、弯腰前倾、在最左那盏路灯下" : "例：白发、黑袍的少年"}
                    className="w-full rounded-lg bg-black/40 px-2 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-600"
                  />
                </div>
                {/* ★ 最后一条不给删：**不摆点不动的按钮**（本仓老坑），整句解释与出口画在列表下方。
                    判据问的是 data 层的 roleFloorIssue，这里不写 rows.length <= 1。
                    ★ 裸 ✕ 改成图标 + 「删掉」两个字：一排输入框旁边的 ✕ 看起来像"清空这一行的文字" */}
                {!floorNext && (
                  <button
                    data-guide={i === 0 ? "roleconfirm-del" : undefined}
                    onClick={() => delRow(r.key)}
                    className="mt-4 flex flex-none items-center gap-1 rounded-full bg-black/40 px-2 py-1.5 text-[11px] text-slate-300"
                    aria-label="删掉这个角色位"
                  >
                    <Icon name="close" size={12} className="text-slate-400" />
                    删掉
                  </button>
                )}
              </div>
            </div>
          ),
        )}

        {/* 下限那句（唯一实现在 data 层）：只在"再删一条就不行了"时出现 */}
        {floorNext && <p className="px-1 text-[11px] leading-relaxed text-slate-400">{floorNext}</p>}

        {/* AI 可能少认一个人（画面里 5 个只列了 4 个）：让作者补，比"只能确认 AI 认出的那些"诚实。
            ★ 到上限时**换成一句说明**而不是摆一颗灰按钮 —— 否则作者加到第 10 条才在提交时
              吃 zod 的英文 "Validation error"（删位常规化之后，增删会频繁很多） */}
        {canAdd ? (
          <button
            /* ★ 序数方案下**预先填上一个还没被占用的位置**，绝不留空 label：
                 空 label 会被 confirmTemplateRoles 整句拒（那是有意的，"删"只能有一种表达），
                 而摆一个点了必然失败的按钮是本仓的老坑。选错了在这一行的选择器里改就是。 */
            onClick={() =>
              setRows((rs0) => [
                ...rs0,
                { key: uid("role"), label: ordinal ? (freeSlots[0] ?? "") : "", desc: "", doomed: false },
              ])
            }
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-600 py-2.5 text-[11px] text-slate-400"
          >
            <Icon name="plus" size={13} />
            {ordinal ? "画面上还有一个白色人偶没列出来？把它加回来" : "画面里还有人没列出来，加一个"}
          </button>
        ) : (
          // 到顶时**换成一句说明**而不是摆一颗灰按钮 —— 否则作者点了才在提交时吃 zod 的
          // 英文 "Validation error"（删位常规化之后，增删会频繁很多）。
          // ★ 序数方案有两种"到顶"，说的是不同的事：位子到 9 个，或者这段视频里的位置用完了
          <p className="rounded-xl border border-slate-700 bg-panel/60 px-3 py-2.5 text-[11px] leading-relaxed text-slate-300">
            {ordinal && !atMax ? (
              <>
                这段视频里只认出了这 {slots.length} 个位置，都已经在列表里了。
                清单之外的人同样是白色人偶，但没有位置能指认他们，<b className="font-bold">挂不了卡</b>。
              </>
            ) : ordinal ? (
              <>
                已经排到一次能挂卡的上限（{BLOCKOUT_MAX_ROLES} 个）。画面里如果还有别人，
                他们同样是白色人偶但挂不了卡 —— 人再多，从左数到第几个也数不准了。
              </>
            ) : (
              <>
                已经排到一次能挂卡的上限（{BLOCKOUT_MAX_ROLES} 个）。画面里如果还有别人，
                他们身上不会有编号，会保持白模人偶原样 —— 编号再多，画面上也认不出来。
              </>
            )}
          </p>
        )}

        {issue && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-300">{issue}</p>}
      </div>

      <div className="safe-bottom absolute inset-x-0 bottom-0 border-t border-slate-800 bg-black/80 px-4 py-3">
        {/* ★★ 提交前的汇总：整份替换意味着"少发一条 = 删掉它"，而服务端**分不清**"作者有意
            删"和"客户端状态丢了一条"。把这次会少哪几条摆在最终按钮上方，是这个风险在
            App 侧唯一的对冲 —— 点下去之前它是看得见的。 */}
        {doomed.length > 0 && (
          <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2">
            <p className="text-[11px] leading-relaxed text-rose-200">
              这次提交会删掉{noun}{" "}
              <b className="font-bold">{doomed.map((r) => r.label || `（空${noun}）`).join("、")}</b>
              {doomed.length > 1 ? ` 共 ${doomed.length} 个角色位` : " 这一个角色位"}，
              <b className="font-bold">其余位子一个都不动</b>。
            </p>
            {/* ★ 「随时能再加回来」这句在序数方案下**靠 markSlots 才成立**（它存着白模化那一刻
                算出来的整份位置清单，删过位之后仍然查得到）——所以这一位当初才没做成一个
                只回答"是不是序数方案"的枚举 */}
            <p className="mt-1 text-[10px] leading-relaxed text-rose-200/80">
              提交后这几条的描述文字找不回来（这几{ordinal ? "个位置" : "个编号"}随时能再加回来，描述要自己重写）。
            </p>
            {/* ★★ 序数独有：删掉一个位子会让它右边那些位子的序数变。提交前**再说一次** ——
                待删行里说过一次，但那时作者在逐行看；这里是他按下最终按钮之前的最后一眼 */}
            {ordinal && (
              <p className="mt-1 text-[10px] leading-relaxed text-rose-200/80">
                ⚠ 如果删它是因为画面上根本没有那个人偶，记得把它<b className="font-bold">右边</b>那些位子
                各往左挪一位再提交（按位置指认独有的一条，编号版没有）。
              </p>
            )}
          </div>
        )}
        <button
          data-guide="roleconfirm-submit"
          onClick={() => void save()}
          disabled={busy}
          className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-50"
        >
          {busy
            ? "提交中…"
            : doomed.length > 0
              ? `提交：改完${noun}并删掉 ${doomed.length} 个角色位`
              : `我已逐个核对，${noun}无误`}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 核对入口 —— **两个页面共用的唯一实现**（市场页「我的模板」与详情页 OwnerBar）。
 *
 * ★★ 为什么入口必须**常驻**：判据 `rolesNeedConfirm` 在提交成功后就变 false（服务端把
 *   全部 labelConfirmed 置 true），于是琥珀提示条消失 —— 改造之前全 app 再没有第二个入口。
 *   作者点完「我已逐个核对」才发现画面上有两个「1」时，App 侧就只剩"重炼整段"这一条路，
 *   **而服务端那边一直开着门**（仅 pending、仅作者，改多少次都行）。所以"删位"这个能力
 *   成立的前提不是删本身，是这个入口回得来。
 * ★ 身份判定不在这里另写一遍：调用方本来就只在作者自己那一侧渲染它（市场页的「我的模板」
 *   tab、详情页的 OwnerBar 各有自己的唯一判据）。这里只回答"这个模板有没有角色位、
 *   登记了没有、待不待核对"。
 * ★ 没有 remoteId（登记还没成功）时不渲染：编号登记在服务端，摆个点了必然失败的按钮
 *   只会让作者以为功能坏了 —— 登记失败的原因与「重新登记」在详情页已经有出口。
 */
export function RoleConfirmEntry({ t }: { t: VideoTemplate }) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  useTemplatesTick();

  const rs = remoteStateOf(t);
  const ordinal = markSpecOf(t).scheme === "ordinal";
  if (!t.roles?.length || !t.remoteId) return null;

  async function openSheet() {
    setOpening(true);
    // ★ 打开前先取一次服务端那份（读路径，refreshRemoteTemplate 内部吞掉失败、降级用
    //   本机那份）：作者可能在**另一台设备**上改过编号。拿这台设备上那份过时的猜测去
    //   整份替换，等于把别处改对的编号又覆盖回错的 —— 而且两边都不报错。
    //   （两台设备同时编辑仍会后到者覆盖前者，本次不加乐观锁：那是一条新的跨仓规则。
    //    缓解是面板里摆着完整的那一份，作者自己看得见。已知、可接受。）
    await refreshRemoteTemplate(t.id);
    setOpening(false);
    setOpen(true);
  }

  return (
    <>
      {/* ★★ 判**否定**：`rs` 为 null（服务端快照还没到货）也走"还没核对"这一档。
          写成 `rs?.rolesNeedConfirm` 的话，null 落进 else —— 也就是"核对过了"那一档，
          而那一档里**没有「核对之前不能发布」这句话**。失败场景：弱网冷启动进「我的模板」，
          补快照那个 effect 按 `asked.current` 记名、一条只发一次、失败不重试（冷启动更没有
          "上次的快照"可降级），于是一个**从没核对过**的模板整场会话都显示成低调的
          「重新核对编号」。作者据此以为这关过了，去详情页点发布 → 服务端 400。
          ★ 这与 recordState 里那条自定的规矩是同一个方向：老服务端不回这一位就判成待核对，
          **不确定时往"多提醒"那一侧退**（也是 CLAUDE.md「后加的字段一律判否定」那条）。 */}
      {!rs || rs.rolesNeedConfirm ? (
        // 第一档：还没核对过 —— 这条是**拦路的**（服务端发布闸会 400），说清后果
        <button
          onClick={() => void openSheet()}
          disabled={opening}
          className="flex w-full items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-200/90 disabled:opacity-60"
        >
          <Icon name="pen" size={13} className="flex-none" />
          {/* ★ 这是**拦路条**，不是科普位：命中率那句话（"7 发里 4 发全对"）说在花钱之前的
              两屏，这里只放一句短的 + 下一步 */}
          <span>
            {opening ? (
              "正在取最新的角色位…"
            ) : ordinal ? (
              <>
                位置还没核对：AI 排的「从左往右第几个」只是猜测，可能与画面上对不上，
                <b className="font-bold">核对之前不能发布</b>（对不上会让别人的角色卡换到别人身上）。点这里去核对。
              </>
            ) : (
              <>
                编号还没核对：AI 编的号可能与画面上人偶头上的数字对不上，
                <b className="font-bold">核对之前不能发布</b>（对不上会让别人的角色卡换到别人身上）。点这里去核对。
              </>
            )}
          </span>
        </button>
      ) : (
        // 第二档：核对过了也留着（低调）。★ 这一档才是"删位"真正的入口 —— 作者多半是
        // 确认完之后才发现画面上有两个一样的号
        <button
          onClick={() => void openSheet()}
          disabled={opening}
          className="flex w-full items-center gap-2 rounded-xl border border-slate-700/70 bg-panel/60 px-3 py-2 text-left text-[11px] leading-relaxed text-slate-400 disabled:opacity-60"
        >
          <Icon name="pen" size={13} className="flex-none" />
          <span>
            {opening
              ? "正在取最新的角色位…"
              : ordinal
                ? "重新核对位置 —— 有个人没被换成人偶？相邻两行排反了？点这里改，不用重炼"
                : "重新核对编号 —— 画面上有两个一样的号？有个号找不着？点这里改，不用重炼"}
          </span>
        </button>
      )}
      {open && <RoleConfirmSheet t={t} onClose={() => setOpen(false)} />}
    </>
  );
}
