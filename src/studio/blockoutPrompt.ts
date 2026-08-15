// 白模模板「套用」那一段提示词的合成 —— **全仓唯一实现**（方案 WM_V2 第五章）。
//
// 这条链路上有两段提示词，这里只放**第二段**：
//   ① 白模化（把作者自己的视频里的人全换成带编号的白模人偶）—— 由**服务端**拼，
//      不在本仓（它要跟着「先看」那一步的视觉结果逐个点名，客户端根本没有那份清单）；
//   ② 套用（别人给每个编号的人偶挂上人物卡，出片时把白模换回真人）—— 就是本文件。
//
// ★★ 为什么合成的结果要**填进用户的要求输入框**而不是在出片时偷偷拼上去：
//   这段话决定"哪个编号换成谁"，换错人是**画面照出、零报错**的故障，只有作者肉眼能发现。
//   摆在输入框里，用户出片前一定会看见它、也随时能改；藏在代码里，他连"模型被告知了什么"
//   都不知道。改完**以输入框为准**（segmentGen 那边对有 roles 的模板不再拼 BLOCKOUT_SWAP，
//   就是为了不和这段话打架）。
import { AI_REAL } from "../ai";
import { chat } from "../ai/arkClient";
import type { Card } from "../types";

/** 一个角色位 + 它挂上了谁。编辑页把 `template.roles` 与用户挂的卡合成这张表交过来 */
export interface BlockoutCastSlot {
  /**
   * 人偶胸口那个编号 —— **原样来自 `template.roles[].label`**。
   *
   * ★★ 实测**稳定但不连续**（2026-08-15 一发四个人偶实出 1/2/4/5）。所以：
   *   别按下标推编号、别拿 `roles.length` 当最大编号、这里**原样用**，
   *   不许"顺手规整成 1..N" —— 对着 4 号说 3 号的话，模型就把卡换到别人身上。
   */
  label: string;
  /** 这个位子在原视频里替换掉的是谁（`roles[].desc`，如「穿黑袍的白发少年」）。
   *  只进 chat 的上下文，**不进成品提示词** —— 成品里说的是"换成谁"，不是"原来是谁"。 */
  desc: string;
  /** 挂上的人物卡；null = 没挂（这个人偶保持白模原样） */
  card: Card | null;
}

/**
 * 合成结果建议的字数。
 *
 * ★ 这不是方舟的限制，是**预算**：出片时提示词的硬顶是 `ai.VIDEO_PROMPT_MAX`（400 字），
 *   而尾巴上还要挂素材设定与 `<图片N>` 绑定句（约 150~250 字，见 segmentGen 的拼装），
 *   截断又是**从正文这头切**的。合成句写到 300 字，进模型时就会被切掉后半段 ——
 *   而后半段恰恰是「不要出现字幕」这类收尾要求。留一半给尾巴是经验值，不是精确算的：
 *   真被截了 segmentGen 会当场整句报出来（那才是唯一可靠的一环）。
 */
export const BLOCKOUT_PROMPT_BUDGET = 200;

/** 角色位排序：**只为读起来顺**，按编号的数值升序（认不出数字的排最后、保持原序）。
 *  ★ 排序不改 label 本身 —— 编号不连续是实测事实，这里只是让「1、2、4、5」按人眼习惯排。 */
function byLabel(a: BlockoutCastSlot, b: BlockoutCastSlot): number {
  const na = Number.parseInt(a.label, 10);
  const nb = Number.parseInt(b.label, 10);
  if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
  if (Number.isNaN(na)) return 1;
  if (Number.isNaN(nb)) return -1;
  return na - nb;
}

/**
 * 骨架（方案第五章「套用」那段模板的**逐字实现**）—— 纯函数，不打网络。
 *
 * ★★ 它是**确定性**的，这一点不能让给模型：`编号 N` 与 `角色「XX」` 的对应关系是
 *   机器生成、用户改不出来的那一半，任何"顺手重编号/顺手改个名"都会让卡换到别人身上
 *   （F5）。所以 chat 那一步只许**把作者那句话揉进去**，揉完还要逐条核对这些串还在
 *   （见 composeBlockoutPrompt 的校验）。
 *
 * ★ 与方案第五章的**一处有意偏离**：模板里写的是「编号 N 的白色人偶替换为 <图片M> 的角色」，
 *   这里写的是「…替换为角色「XX」」。原因：`<图片M>` 的编号**在这一刻还不存在** ——
 *   它由出片时的 `prepareMaterialRefs` 现分配（一次最多 3 张、超了的卡按规则被挤掉、
 *   同一张卡的图还要连号），而那一步产出的绑定句已经把 `<图片M>` 与 `角色「XX」` 绑好了。
 *   在这里猜一个 M 写死，正是 F5 警告的那种"编号对不上就换错人"，只是搬到了上一层。
 *   走名字，两段话自然接得上：这里说"编号 4 换成角色「张三」"，绑定句说"<图片2> 是角色「张三」"。
 */
export function blockoutApplySkeleton(cast: BlockoutCastSlot[], userLine = ""): string {
  const slots = [...cast].sort(byLabel);
  // flatMap 而不是 filter：filter 之后 TS 仍然认为 card 可能是 null，只能靠 `!` 硬压 ——
  // 而这一句正是"哪个编号换成谁"的正文，压错了没有任何报错，只是换错人
  const taken = slots.flatMap((s) => (s.card ? [{ label: s.label, name: s.card.name }] : []));
  const free = slots.filter((s) => !s.card);
  const parts: string[] = [
    "以参考视频完美复刻原视频的人物站位、动作、节奏卡点、运动轨迹、队形变化与镜头构图。",
  ];
  if (taken.length > 0) {
    parts.push(`${taken.map((s) => `编号 ${s.label} 的白色人偶替换为角色「${s.name}」`).join("；")}。`);
  }
  if (free.length > 0) {
    // ★ 没挂卡的**也要点名说"保持原样"**，不能只靠"没提到就是不动"：模型对没提到的
    //   主体会自己发挥（实测白模化那一发正是"泛指会漏掉主角"的同一个机理，F4）。
    parts.push(`编号 ${free.map((s) => s.label).join("、")} 的白色人偶保持白色人偶原样不变。`);
  }
  parts.push(
    "动作必须严格跟随参考视频：抬手、摆臂、身体倾斜、弹跳、重心变化、转向、停顿与定格姿势，每个动作的起始时间、落点与强拍定格都要与原视频一致。",
  );
  const line = userLine.trim();
  if (line) parts.push(line.endsWith("。") ? line : `${line}。`);
  parts.push("不要出现字幕。");
  return parts.join("");
}

/**
 * 「合成结果里还有没有这个编号」。
 *
 * ★ 必须卡住**右边界**：`text.includes("编号 1")` 会被句子里的「编号 12」命中 ——
 *   于是"1 号被 AI 弄丢了"这件事被 12 号顶掉，检查形同虚设。而检查一旦有假阳性，
 *   就等于我们**以为**核对过了（比不核对更坏）。
 * ★ 左边界不卡：中间那个空格模型很爱吞掉（「编号1」），那是排版不是语义。
 */
function hasLabel(text: string, label: string): boolean {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`编号\\s*${esc}(?![0-9])`).test(text);
}

const COMPOSE_SYSTEM = [
  "你是视频生成提示词的编辑。用户会给你一段已经写好的中文提示词，以及作者补充的一句话。",
  "你唯一的任务：把作者那句话自然地融进这段提示词，让全文读起来像一段连贯的中文。",
  "硬性要求（违反任何一条都算失败）：",
  "1. 不许改动、删除或重新编号任何「编号 N」，N 不连续是正常的，原样保留；",
  "2. 不许改动或删除任何用「」括起来的角色名；",
  "3. 不许增加原文没有的画面要求，也不许删掉原文任何一条要求；",
  "4. 直接输出成品正文，不要解释、不要加引号、不要用 Markdown、不要分点。",
].join("\n");

/**
 * 合成这一段的要求提示词：骨架 + 作者那句话 → 一段能直接填进输入框的长提示词。
 *
 * @throws 合成失败时抛出**整句可显示**的原因。调用方（编辑页）必须把它显示出来，
 *   并让用户**手写**这一段（输入框保持可编辑，也可以拿 `blockoutApplySkeleton`
 *   的骨架当起点）。★ 绝不许 catch 成空串："输入框空着"在界面上和"用户还没写"
 *   长得一模一样，用户会以为自己写了一句就够，出片时那句点名映射整个没发出去 ——
 *   而换错人是零报错的（铁律八）。
 *
 * ★ mock 构建（没配 ARK_API_KEY）直接返回骨架：那**不是**静默降级 —— 骨架本身就是
 *   第五章那份模板，chat 只负责把作者那句话揉得顺一点。返回空串才是降级。
 * ★ 为什么直连 `ai/arkClient.chat` 而不是走 `ai/index` 的出口：`ai/index` 今天唯一的
 *   对话出口是 `npcChat`，而它按 90 字截断回复（NPC 气泡只有三行高）—— 拿它合成
 *   200 字的提示词等于每次都被切掉大半。要收口成统一出口得在 `ai/index` 加一个
 *   文本合成入口，那个文件这一轮不归本施工位改（`utils/mediaUrl.ts` 已有直连先例）。
 */
export async function composeBlockoutPrompt(cast: BlockoutCastSlot[], userLine = ""): Promise<string> {
  const skeleton = blockoutApplySkeleton(cast, userLine);
  if (!AI_REAL) return skeleton;
  const line = userLine.trim();
  // 作者一个字都没写 = 没有要"融"的东西，骨架已经是成品。省一次调用，也省一次
  // 「模型把好好的句子改坏」的机会
  if (!line) return skeleton;

  const budget = Math.max(BLOCKOUT_PROMPT_BUDGET, skeleton.length);
  const context = cast
    .flatMap((s) => (s.card ? [`编号 ${s.label}（原视频里是${s.desc || "某个人物"}）→ 角色「${s.card.name}」`] : []))
    .join("\n");
  let out = "";
  try {
    out = await chat(
      COMPOSE_SYSTEM,
      [
        "【已写好的提示词】",
        skeleton,
        "",
        "【作者补充的那句话】",
        line,
        "",
        "【角色位对照（仅供你理解，不要写进成品）】",
        context || "（无）",
        "",
        `【长度】全文不超过 ${budget} 个字。`,
      ].join("\n"),
    );
  } catch (e) {
    throw new Error(
      `提示词合成失败（${e instanceof Error ? e.message : String(e)}）——这一段的要求请自己写，或用下面那份默认写法。`,
    );
  }

  const text = out.replace(/```[a-z]*|```/gi, "").trim();
  if (!text) {
    throw new Error("提示词合成失败：AI 什么都没返回——这一段的要求请自己写，或用下面那份默认写法。");
  }
  // ★★ 逐条核对**机器生成的那一半还在不在**。这不是洁癖：模型很爱把「1、2、4、5」
  //   顺手规整成「1、2、3、4」，或者把角色名换成它觉得更顺口的说法 —— 两者都不报错，
  //   只表现为出片时换错了人。核不过就整句拒，绝不"差不多就用了"。
  const missLabel = cast.find((s) => !hasLabel(text, s.label));
  if (missLabel) {
    throw new Error(
      `提示词合成失败：AI 改写时把「编号 ${missLabel.label}」这个角色位弄丢了（编号错一位就会把卡换到别人身上）——这一段的要求请自己写，或用下面那份默认写法。`,
    );
  }
  const missCard = cast.find((s) => s.card && !text.includes(s.card.name));
  if (missCard?.card) {
    throw new Error(
      `提示词合成失败：AI 改写时把角色「${missCard.card.name}」的名字改掉了（名字对不上，形象参考图就绑不到这个角色）——这一段的要求请自己写，或用下面那份默认写法。`,
    );
  }
  return text;
}
