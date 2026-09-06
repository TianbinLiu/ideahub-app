// src/components/blockout/DetectRolesEntry.tsx
// 「去认一遍画面里有哪些人」的识别入口 —— 2026-08-23 从 TemplateShelf 抽出来的中立模块。
//
// ★★ 为什么单独成模块：模板详情页（TemplateDetailPage）也要用这个入口，而它**不能**
//   import TemplateShelf —— RoleConfirmSheet 记过那条 页面↔组件↔useTemplatesVersion 的
//   循环 import 坑。放在中立的 blockout/ 下，货架与详情页两边都只依赖它、互不依赖。
import { useState } from "react";
import BoxFramePicker, { boxMarksInSelection, type BoxFrameMode } from "./BoxFramePicker";
import { fmtTokens, ownRefTemplateCost } from "../../data/economy";
import { detectTemplateRoles, remoteStateOf } from "../../data/templates";
import { VideoTemplate } from "../../types";

/**
 * 「去认一遍画面里有哪些人」的入口。**只对自己、只对白模模板**，两种情形：
 *   · **还没有角色位** → 第一次认（下面那段 ★★ 说的就是它）；
 *   · **已经有了、但一条都还没核对** → 重新认一遍。
 *
 * ★★★ 重认那一档是 2026-08-18 真机跑一遍才发现必须加的：老写法是
 *   `(t.roles?.length ?? 0) > 0` 就整个不出，于是一个用**旧提示词**认出来的模板
 *   （描述是「全白关节人偶」这种一句话）**永远升不上来** —— 拿不到多维描述、
 *   拿不到 `markDescs`，那句「有个特别显眼的人」也永远报不出来（它靠描述里的颜色）。
 *   而服务端**本来就允许**重认（只要没核对过）—— 是 App 把入口藏了。
 *   ⇒ 不加这一档的话，这一轮做的多维描述只对**今后新建**的模板生效，
 *     而存量模板的作者只能重传一遍视频、重新花一次钱。
 * ★ 允不允许重认只问 `remoteStateOf(t).rolesRedetectable` 一处（与服务端那道闸同源），
 *   别在这里写 `roles.some(...)` —— 写了就是同一条规则的第二处实现，
 *   而它漂了的表现是“摆一颗写着价钱、点下去却 400”的按钮。
 *
 * ★★ 它存在的理由就是那条路会失败：认人+量框要打上游，而上游耗时实测在 6.6s~140s
 *   之间浮动（连续调用会排队）。没有这个入口的话，一次抖动 = 作者永久拿到一个
 *   没有角色位的模板 —— 挂卡面板不出现、核对入口不出现，而他**看不出为什么，
 *   也无处重来**。服务端保证失败不留痕，所以再点一次就是干净的一次重试。
 * ★ 每点一次都**真花钱**（认人 + 量框都是计费的 chat），所以：① 按钮上把价钱说出来；
 *   ② 绝不做成自动重试。
 * ★ 结果三档都照实说（服务端回的 note 原样显示）：全成 / 有角色位没框 / 一个没认出来。
 */
export function DetectRolesEntry({ t }: { t: VideoTemplate }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  /** 折叠态（2026-08-20 塞进卡片格子后默认收起）：挑帧那块有高度，常驻会把列表撑成长文 */
  const [openPanel, setOpenPanel] = useState(false);
  /** AI 自己挑帧 / 我自己挑。★ 状态留在这一层：它只影响这一次识别，不进模板 */
  const [mode, setMode] = useState<BoxFrameMode>("auto");
  const [marks, setMarks] = useState<number[]>([]);
  // 只对**白模模板**（有参考视频）、**已登记**的自己那条出
  if (!t.refVideo || !t.remoteId) return null;
  const rs = remoteStateOf(t);
  if (rs?.isOwner === false) return null;
  const has = (t.roles?.length ?? 0) > 0;
  // ★ 已经核对过的不出：重认会把作者一条条改过的措辞整份冲掉，服务端也会 400。
  //   ★★ `rs` 为 null = 远端状态还没到货。已经有角色位时**往不出那一侧退**：
  //     摆一颗可能被服务端拒的付费按钮，比少一个入口坏。
  if (has && !rs?.rolesRedetectable) return null;
  const cost = ownRefTemplateCost();
  // 展开面板是 w-full：外层是 flex-wrap 的按钮行，按钮内联、面板独占一行
  return (
    <>
      <button
        onClick={() => setOpenPanel((v) => !v)}
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          openPanel ? "bg-sky-400 text-ink" : "border border-sky-500/50 bg-sky-500/15 text-sky-200"
        }`}
      >
        {has ? "重新识别角色位" : "识别角色位"}
      </button>
      {openPanel && (
        <div className="w-full space-y-2 rounded-lg border border-sky-500/40 bg-sky-500/5 px-3 py-2">
          {/* ★ 一句话说清这个面板是干嘛的。"每一段视频"不是笔误：挑的帧同时就是
              长视频的分段点（场景/人数一变就该标一帧），见分段出片那条产品线 */}
          <div className="text-[11px] leading-relaxed text-sky-100">
            选定场景/人物数量变化的特定帧，让 AI 分析每一段视频中的人物。
            {has && (
              <>
                {" "}
                重认会<b className="font-bold">覆盖现有描述</b>（你自己改过的也会没），按一次收一次费；核对过之后不能再重认。
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
          onClick={() => {
            setBusy(true);
            setMsg("");
            // ★ 只有「自己挑」且真标了帧才传：`auto` 或一帧没标都发空，
            //   服务端那边 `pickedFrameCandidates` 退成 null → 自动铺法接手，
            //   与"没标"完全同一条路径（判据只在服务端一处，这里不另判）
            //   ★ 即使这条路没有选段（src 就是裁好的模板视频），也要走
            //     `boxMarksInSelection` —— 它是"标记 → 提交值"的唯一实现。今天两者结果
            //     相同（marks 插入时已量化+排序+判重），但那个函数再加一条规则时，
            //     这里手写的一份会**静默分叉**，正是它自己的注释要防的形状。
            void detectTemplateRoles(t.id, mode === "manual" ? boxMarksInSelection(marks).atSecs : undefined)
              .then((note) => setMsg(note || "认好了 ✓"))
              .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
          disabled={busy}
          className="flex-none rounded-full bg-sky-400 px-3 py-1 text-[11px] font-bold text-ink disabled:opacity-40"
        >
          {busy ? "识别中…（要一到几分钟）" : `开始识别（${fmtTokens(cost)}）`}
            </button>
            {msg && <span className="min-w-0 flex-1 text-[10px] leading-relaxed text-sky-200">{msg}</span>}
          </div>
          {/* ★★ 挑帧摆在**这一屏**而不是登记那一步：这颗按钮多半是**重试**用的
              （第一次是登记时自动跑的），而重试正是"自动那条没认全、我来指一帧"的时刻。
              ★ 报价不随标几帧变：服务端依次试、第一个成的就停，上限本来就是
                BLOCKOUT_BOX_TRIES —— 标 1 帧和标满都在同一个上限内，报的一直是那个上限。 */}
          <BoxFramePicker
            mode={mode}
            onModeChange={setMode}
            src={t.refVideo.url}
            marks={marks}
            onMarksChange={setMarks}
            disabled={busy}
          />
        </div>
      )}
    </>
  );
}
