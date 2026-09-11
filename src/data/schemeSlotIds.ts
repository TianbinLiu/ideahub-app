// 提示词方案「图位」的身份（slot id）—— **算 id / 换 id 的唯一实现**。
//
// ★★ 为什么要有它（2026-09-11 多语言 PR2，主人拍板「图位名字不再当身份键」）：
//   图位的 `tag` 是给人看的名字，此前却同时当身份键 —— 自建卡草稿里的照片（customCardStore.schemeShots）、
//   正在处理 / 出错 / 圈选改图的是哪一格，全按 tag 认。内置方案的名字一旦接 Lingui，切一次界面语言 tag 就变了：
//   照片不画、不当卡面、铸卡不带走，花钱出的 AI 图落在一个没人读的键上，全程零报错。
//   ⇒ 规则（这一批**没进 CLAUDE.md**：那份文件同时在好几条分支上被改，合流容易冲突 —— 暂时写在这里与
//     data/promptSchemes 文件头，之后补进 CLAUDE.md「已知的坑」）：
//     · 身份一律读 `slot.id`；`tag` 只是显示名，永远不当键、不拿来比。
//     · id 只有三个来处：内置图位写死的字面量（promptSchemes.BUILTIN_SCHEMES，门禁核它与名字成对）、编辑屏新加空白格子的
//       `freshSlotId`（暂定的，第一次保存时可能换成内置血统 id）、其余一律本文件的 `normalizeSlotIds`
//       （经 promptSchemes 的 load / withSlotIds / saveScheme / upsertMine 调它）。别在调用点自己拼 id。
//     · **role 是身份的一部分**：一个 id 只跟着同一种 role 走 —— 内置 id 的 role 由内置表定死，自建格子的 role 由本机存着的
//       那一版定（saveScheme 传 before）。role 变了就换 id，那格的草稿照片收起来，**绝不**以另一种 role 铸进卡里
//       （2026-09-11 复核抓到：另存内置方案的副本把「全身立绘」改成脸部那一格，id 还是 fullBody，全身照被当成脸部图铸卡、钱照扣）。
//     · **存下来的 id 就定了**：本机存着的某一格的 id，保存 / 重装时不会因为「别的格子被删、被换了 role」改成别的 id
//       （理由见 normalizeSlotIds 的 ★★ 存下来的 id）。唯一的例外是 id **自己写着的 role** 与格子对不上（派生 `lg:<role>:…`、
//       role 变体 `<原 id>~<原>~<现>`）：那是存坏的，读的时候就按现在的 role 重算（复核第 3 轮，见 roleFits 的 ★★）。
//     · 存编辑屏时 role 按哪一版核：本机**此刻**存着的那一版 + 编辑屏**打开时**拷贝的那一版（editBefore）。只看此刻那一版的话，
//       编辑屏开着的时候「已装 · 用它」回包换掉了图位，编辑屏手里的 id 在里面一个都找不到、role 就核不了（复核第 3 轮）。
//     · 服务端 z.object 会 strip `slots[].id`、回包也不带 ⇒ 读服务端回来的方案一律过 withSlotIds（api/schemes.apiToScheme 已经过了）。
//     · tsc 只逼调用方**选一档**（读 / 存编辑屏 / 对齐本机那份），选没选对它看不见 —— 几个调用点各传哪一档，
//       由 scripts/check-slot-ids.mjs 的「接线」一节从源码核（传错哪一边都零症状）。
//     · 存进 CardView.tag 的名字只由 promptSchemes.slotCardTag 决定，与 id 无关。
// ★ id 是**确定性**的：老方案、服务端来的方案每读一次都算出同一组 id。随机的话每次冷启动都重排，
//   幂等也没法测（被否掉的设计 1 就栽在这条）。随机只给编辑屏新建的格子（freshSlotId）。
// ★ 四类 id，来历不同、别混：
//   · **内置 id**（fullBody…，types.BUILTIN_SLOT_ZH 的键）：内置方案与它的副本，以及按内容 / 中文原名认回来的老图位。
//   · **派生 id**（`lg:<role>:<名字>`）：没有 id 的老图位、服务端回来的方案现算的，身份就是「名字 + role」。
//   · **新建 id**（`slot_…`，freshSlotId）：编辑屏新加的格子。**只在它头一回被保存的那一下**先让内置血统：名字（trim）+ role 或内容
//     对得上某个内置图位、而那个内置 id 在这一套里没被占（本机存着的那一版里也没有格子挂着它或它的变体），就换成内置 id ——
//     从空白建一套、格子起名「全身立绘」，与存量老方案、别人装到手的同一套一样认成 fullBody。对不上就一直用它；存下去之后不再让（改名、重装都不换）。
//   · **role 变体**（`<原 id>~<原 role>~<现 role>`）：存过的格子换了 role —— 三类 id 都一样（`slot_x~primary~face`、`fullBody~primary~face`、
//     `lg:primary:正面~primary~aux`）。换回原 role 就回到原 id，草稿照片跟着回来，与这中间名字、正文改没改无关。
//     ★ 新建 id 里既没有名字也没有 role：不记下原 role 的话，分两次保存「改过去再改回来」就再也认不回原 id（复核第 2 轮）。
//     ★ 派生 id 与内置 id 原先以为不需要它（「名字 + role」重算 / 按血统认回），复核第 5 轮抓到：就地改过名之后派生 id 里的名字就过期了，
//       分几次保存「改名 + 改 role → 改回 role → 改回名字」，改回 role 那一下按当时的名字算出另一个 id，名字改回来也回不去；
//       改过名 + 正文的内置 id 同理。那格的草稿照片（可能是花钱出的 AI 图）从此够不着，而改动前按名字认，名字改回来照片就回来。
// ★ 与改动前（按名字认）比，下面几种**收窄**了，计划接受。都没有删照片（照片还在草稿里）；多数换回原方案 / 改回原样就回来，
//   但 ③ 里「删掉一格、再加一格同名的」那一种例外：被删那格的照片在这一套里再也够不着（除非别的方案里有同一个 id，比如内置 id）：
//   ① 两套毫不相干的自建方案里同名的格子不再共用草稿照片 —— 除非两边都是派生 id（老方案 / 市场装来的）且 role 相同；
//      从空白建的（新建 id）与任何别的自建方案同名都不共用；
//   ② 名字相同、role 不同的格子不共用（那一种本来就是错的：脸部特写被挂到服装细节那格上铸卡）；
//   ③ 就地改 role → 藏起来，改回原 role 才回来（改动前留着、可能以新 role 铸卡）；反过来，在新 role 下另传的那张，改回原 role 之后藏起来
//      （改动前它留着、以原 role 铸卡）；同名两格互换 role → 两格都藏起来（改动前按名字各跟各的）；
//      删掉一格、再加一格同名的 → 新格子不接旧照片（上面说的够不着的那一种）；发布过的方案之后「已装 · 用它」/ 删掉再装回来，
//      新格子在上面传的照片照样跟着它（S 步让位，复核第 6 轮）。
//   ④ 自建方案里**存过的**格子（老方案的派生 id、存过的新建 id），在后来某一次保存里改名成内置原名（全身立绘 / 面部特写），
//      或删掉再加一格内置原名的 → 不换成内置 id，**不再与内置方案（以及带着 fullBody / faceCloseup 的副本）共用草稿照片**
//      （改动前按名字共用）。复核第 3 轮评估过「这一次改了名就让内置血统」那一版：它的代价是分两次保存「改成全身立绘、再改回原名」
//      之后，那格自己的照片（可能是花钱出的 AI 图）落在一个再也没人读的键上 —— 藏起来可以找回，够不着找不回，所以不采用。
//   ⑤ 「已装 · 用它」/ 删掉之后从市场装回来：服务端那份先认本机记下的「服务端那一版」（promptSchemes.noteServerSlots：推上去成功、
//      装回来之后写进 localStorage，App 重启也在），逐格内容相同就按位置接回记下的 id（本机之后新加的格子对得上的位置让给它，S 步）；
//      对不上再对齐本机那份（upsertMine 的 A、B，再按原 role 认换过 role 的格子，V）。删掉之后装回来，「本机那份」是同一次会话里删掉那一刻的
//      那一版（promptSchemes.removedSlots，只在内存里，与草稿照片活得一样久）。都对不上的格子拿新 id、照片藏起来。比改动前窄的是：
//      · 「只有名字对得上、role 不对」那种（同 ②）；
//      · 记录与服务端那一行对不上时 —— 在别的设备上又推过、推上去了但回包没收到、记录超过 64 套被挤掉 —— 本机改过的格子只剩 A、B、V 可认：
//        名字或正文有一样没改的认回原 id（只剩正文没改的，还要在同一个位置上；改过 role 的藏起来、重做一遍改动就回来）；
//        名字和正文都改过的那一格拿新 id，照片在这一套里够不着（改没改 role 都一样）；
//      · 这个 App 更新之前发布过、又在**更新之前**改过的格子（那时还没有记录，本机那份也没有 id）：改过 role 的（本机不知道它原来是哪种 role）
//        和名字、正文都改过的，照片在这一套里够不着，重做一遍改动也回不来（复核第 6 轮实测过，没有便宜的修法）。
//   ⚠ ①②④ 里换方案时，那句「「X」里没有「Y」这一格，你传的那张先收起来了」点名的格子，目标方案里**看得见一格同名的空格子**；
//     ④ 反方向也一样：从改了名的那套换回内置方案，点名的正是内置方案标题里写着的那一格（「全身立绘+面部特写」里没有「全身立绘」）。
//     这一批不动文案（目录冻结），留给接 Lingui 改内置图位名的下一批一起改措辞。门禁里有用例钉着 ①（「计划接受的收窄」）与 ④（18g、18m、18r）。
//   另：那句话只数目标方案**画得出来**的格子（CustomCardPage.drawnSlots，复核第 3 轮）—— 一格照片换过去之后落在 fromCrop 格上
//     （本页不画）也算收起来、照样说一句。与改动前比多说了一种：改动前名字没改的那一种不说（照片同样看不见），这是有意多说的。
// ★ 与改动前比也有几种**放宽**：照片跟过去，不是藏起来（复核第 4、5 轮点名要写明，别当成 bug）。都是同一种 role，不会以别的 role 铸卡：
//   ① 就地改名：照片跟着格子走（改动前藏起来）。另存内置方案的副本里改了名也一样 —— id 还是 fullBody 这类，照片仍与内置方案共用
//      （role 没改就算，正文改没改都一样）。
//   ② 老方案 / 市场装来的格子（没有 id、现算的）改过名，但正文、ref、size、fromCrop 与某个内置图位完全相同：C 步 (i) 按内容认回内置 id，
//      与内置方案共用草稿照片（改动前名字不同就不共用）。
//   ③ 名字只比内置原名（全身立绘 / 面部特写）多了**首尾空白**的格子 —— 编辑屏原样存输入、saveScheme 不 trim、schemeIssue 只拿 trim 过的
//      名字校验，所以存得出来 —— 在 C 步 (ii) 按 trim 过的名字 + role 认回内置 id，与内置方案（以及带着 fullBody / faceCloseup 的副本）共用，
//      换方案时照片直接带过去、不说「先收起来了」；改动前按原样的 tag 认，照片藏起来并说一句。服务端回来的那份本来就是 trim 过的，
//      这样作者本机与别人装到手的同一套认成同一个 id —— 是有意的。门禁 1g / 1h 钉着。
//   ④ 名字带首尾空白的自己的方案发布之后「已装 · 用它」：服务端 trim 过的名字照样对得上（S 步与 A 步两侧都 trim），照片不藏。
//   ⑤ 发布之后本机改过名（或名字 + 正文）再「已装 · 用它」：S 步按位置接回原 id，照片跟到服务端那一版的那一格上
//      （改动前按改过的名字认，照片藏起来，重做一遍改名才回来）。
// ★ 零运行时依赖（只准 import type、不许 enum / namespace）：scripts/check-slot-ids.mjs 用 Node 直接 import
//   本文件跑正反例（Node 24 只剥类型）。规则一条都不在测试里重打。

/**
 * id 长度上限，只防存坏的超长串被当成键。★ 量法（复核第 6 轮改过：原先写「远大于任何 id」，派生 id 也有了 role 变体之后不对了）：
 *   今天的 role 最长 7 字（primary / display）。派生 id 最长 `lg:` + 7 + `:` + 名字 48 字（clipName）+ `#n` ≈ 62 字，它的 role 变体
 *   再加两段 `~role` ≈ 78 字，还在 80 以内（编辑屏 / 服务端的名字只到 24 字，实际更短）；freshSlotId 发的 id 约 20 字、变体约 36 字；
 *   最长的内置 id（mannequinTurnaround，19 字）的变体约 35 字。role 是存坏的长串（roleKey 收到 16 个字母）时派生 id 的变体会超过 80 ——
 *   超了就判成不合法、退回派生（见 roleVariant），不会拼出一个超长的键。
 */
export const SLOT_ID_MAX = 80;

/**
 * CardView 的三个 kind 词，图位 id 永远不许等于它们。
 * ★★ 自建卡页的 `busySlot` / `slotErr.key` 与非人物卡的 kind 共用**一个键空间**（customCardStore 那两位）：
 *   非人物卡按 `slotErr?.key === s.kind` 画报错，而 changeType 从不清 slotErr —— 图位 id 撞上 kind 词，
 *   人物卡那一格的报错切到场景卡之后就会画在「body」那一格上，零报错。
 */
const KIND_WORDS: readonly string[] = ["face", "body", "detail"];

/** 编辑屏新建格子的 id 前缀（freshSlotId 只发这种）。★ 内置 id 不许用它（门禁核），派生 id 是 `lg:` 开头，撞不上 */
const FRESH_PREFIX = "slot_";

/** role 变体里隔开原 id 与两段 role 的字符。★ freshSlotId 发的 id 里没有它（base36 + 下划线），isFreshSlotId 也拒带它的 */
const VARIANT_SEP = "~";

/**
 * role 变体：`<原 id>~<原 role>~<现 role>`（原 id 里不许有 `~`）。原 id 可以是三类里任何一类：新建 id `slot_x~primary~face`、
 * 内置 id `fullBody~primary~face`、派生 id `lg:primary:正面~primary~aux`。
 * ★ 正则字面量，不写成字符串再 new RegExp（CLAUDE.md 那条坑：`"\d"` 在字符串里会退化成字母 d）。
 * ★ 名字里带 `~` 的派生 id（`lg:primary:a~b~c`）会被这条读成变体、现 role 是 c：roleFits 核不过就接 `#2`，确定性的，不串格。
 */
const ROLE_VARIANT = /^([^~]+)~([A-Za-z]{1,16})~([A-Za-z]{1,16})$/;

/**
 * 派生 id 里写着的 role 段：`lg:<role>:…`。★ 只收 1~16 个英文字母（与 roleKey 同一把尺）：role 是坏值时派生出来的
 *   `lg::名字` 不算写着 role —— 否则 C 步给坏 role 的格子派生 id 时，接 `#2`、`#3` 永远过不了 roleFits，死循环。
 */
const LG_ROLE = /^lg:([A-Za-z]{1,16}):/;

/** 一个值能不能当图位 id：1~80 字、首尾没有空白、不是 kind 词 */
export function isValidSlotId(x: unknown): x is string {
  return typeof x === "string" && x.length >= 1 && x.length <= SLOT_ID_MAX && x.trim() === x && !KIND_WORDS.includes(x);
}

/**
 * 是不是编辑屏新建的 id（freshSlotId 发的那种；role 变体**不算**）。
 * 这种 id 只有在「这一次编辑新建、还没存过」时才是暂定的（见 normalizeSlotIds 的 0 步）。
 */
export function isFreshSlotId(x: unknown): x is string {
  return isValidSlotId(x) && x.startsWith(FRESH_PREFIX) && !x.includes(VARIANT_SEP);
}

/**
 * 进来算 id 的图位。★ `id` 是 unknown：从 localStorage / 服务端读回来的都是不可信输入，
 * 可能没有、可能是坏值（数字、空串、kind 词），一律交给 isValidSlotId 判。
 */
export interface SlotIdInput {
  id?: unknown;
  tag: string;
  role: string;
  prompt?: string;
  ref?: string;
  size?: string;
  fromCrop?: boolean;
}

/** 一个内置图位的「血统」：按它把没有 id 的老图位认回内置 id（由 promptSchemes.builtinLineage 现算） */
export interface BuiltinSlotLineage {
  id: string;
  /** 冻结的中文原名（types.BUILTIN_SLOT_ZH） */
  zh: string;
  role: string;
  prompt: string;
  ref?: string;
  size?: string;
  fromCrop?: boolean;
}

/**
 * 取字符串字段并 trim。★★ 判**形状**不判真值：存坏的数据里 `size: 5` 这种值 `(x || "").trim()` 会当场抛 ——
 *   而这里在 promptSchemes.load() 里跑，抛出去被 load 的 catch 吞掉、返回 []，下一次 persist() 就把用户
 *   整个方案库覆盖成空。所以本文件任何一步都不许抛（check-slot-ids 有一条坏形状用例钉着）。
 * ★ 要 trim：服务端对 tag / prompt / size 都是 `.trim()` 之后才存，本机那份与服务端回来那份差的往往就是首尾空白。
 */
function clean(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

/**
 * 派生 id 用的名字截断：按**整个码点**往里放，UTF-16 长度到 48 为止，截完再 trim。
 * ★ 三处都量过才这么写（门禁的坏形状用例钉着）：按 UTF-16 下标截会把 emoji 劈成半个；按码点数截 48 个，
 *   60 个 emoji 的名字截出来是 96 个 UTF-16 单元，`lg:` 一加就超过 SLOT_ID_MAX、判成不合法；
 *   截口正好落在空格上不 trim，id 带尾空白也判成不合法。传进来的 tag 已经 trim 过，所以截出来至少一个字。
 */
function clipName(tag: string): string {
  let out = "";
  for (const ch of tag) {
    if (out.length + ch.length > 48) break;
    out += ch;
  }
  return out.trim();
}

/**
 * 派生 id / role 变体里的 role 段。★ role 来自存储 / 服务端，是不可信输入：只收 1~16 个英文字母（CardRole 的四个值都是），
 * 别的一律写空 —— 否则一个存坏的超长 role 会把 id 撑过 SLOT_ID_MAX（判成不合法），或者带进 `:` / `~` 把段搅乱。
 */
function roleKey(role: unknown): string {
  return typeof role === "string" && /^[A-Za-z]{1,16}$/.test(role) ? role : "";
}

/** role 变体的原 id；不是变体就是它自己 */
function baseOf(id: string): string {
  return ROLE_VARIANT.exec(id)?.[1] ?? id;
}

/**
 * 存过的格子换了 role 之后该用的 id（只在 saveScheme 那条路问它：本机存着的那一版里有这个 id，或者它是内置 id）：
 * `slot_x`（存着时是 primary）改成 face → `slot_x~primary~face`；再改成 aux → `slot_x~primary~aux`；改回 primary → `slot_x`。
 * 内置 id、派生 id 一样：`fullBody` 改成 face → `fullBody~primary~face`，`lg:primary:正面` 改成 aux → `lg:primary:正面~primary~aux`。
 * ★ 原 role 记进 id：新建 id 里没有名字也没有 role，不记的话改回来那一下不知道该回哪个 id。
 * ★★ 内置 id 与派生 id 也要（复核第 5 轮抓到）：原先说它们「改回原 role 本来就认得回去」—— 派生 id 按「名字 + role」重算、
 *   内置 id 按血统认。可就地改名之后派生 id 里的名字就过期了：分几次保存「改名 + 改 role → 改回 role → 改回名字」，改回 role 那一下
 *   按**当时的名字**重算出 `lg:primary:侧面`，名字再改回来 id 也不变，那格的草稿照片（可能是花钱出的 AI 图）从此够不着；
 *   改过名 + 正文的内置 id 同理（血统对不上）。记下原 id，改回原 role 就回到它，与名字、正文改没改无关。
 * ★ 原 id 不合法（带 `~`、kind 词…）或原 role 不知道回 undefined；拼出来不合法（原 id 太长、超过 SLOT_ID_MAX）由调用方 isValidSlotId 拦下，退回派生。
 */
function roleVariant(id: string, storedRole: unknown, role: unknown): string | undefined {
  const now = roleKey(role);
  if (!now) return undefined;
  const m = ROLE_VARIANT.exec(id);
  const base = m ? m[1] : id;
  const baseRole = m ? m[2] : roleKey(storedRole);
  if (!isValidSlotId(base) || base.includes(VARIANT_SEP) || !baseRole) return undefined;
  return now === baseRole ? base : `${base}${VARIANT_SEP}${baseRole}${VARIANT_SEP}${now}`;
}

/**
 * 两格**内容逐项相同**（名字 trim、role、正文 trim、ref、size、fromCrop）：upsertMine 认服务端那份是不是本机记下的那一版（normalizeSlotIds 的 S 步）。
 */
function sameContent(a: SlotIdInput, b: SlotIdInput): boolean {
  return clean(a.tag) === clean(b.tag) && fingerprint(a) === fingerprint(b);
}

/**
 * 「内容上是不是同一格」的指纹：role + 正文 + 参考 + 尺寸 + 是否原片裁剪。
 * ★ ref 按**语义**归一：缺省 ref 就是 body（编辑屏点过「参考主裁剪」会显式写 `ref: "body"`，服务端回包照写），
 *   fromCrop 缺省与 false 同义（编辑屏的勾选框会显式写 false）。不归一的话同一格因为「写没写缺省值」就对不上。
 * ★ size 只把**缺省 / 空白**当默认：显式写了 CARD_SIZE 的那格**不**算与缺省相同（这里零依赖，拿不到 CARD_SIZE）。
 *   今天没有任何一条路会写出显式的 size（编辑屏不写、服务端对空值不回），真出现了也只是那格派生一个 `lg:` id，
 *   草稿照片藏起来，不会挪到别的格子上。
 */
function fingerprint(x: { role: unknown; prompt?: unknown; ref?: unknown; size?: unknown; fromCrop?: unknown }): string {
  return JSON.stringify([
    typeof x.role === "string" ? x.role : "",
    clean(x.prompt),
    typeof x.ref === "string" && x.ref ? x.ref : "body",
    clean(x.size),
    !!x.fromCrop,
  ]);
}

/**
 * 给一组图位定 id —— **唯一实现**。
 *
 * 参数（都不给 = 读：冷启动 load、读服务端回包）：
 *   `prev` = 本机那份（upsertMine 拿服务端回包对齐本机时给；本机没有这一套时给空数组）；
 *   `server` = 本机记下的「服务端现在存着的那一版」（带 id，promptSchemes.serverSlotsOf；upsertMine 给，只在给了 prev 时看）；
 *   `edit` = 存编辑屏的改动（只有 saveScheme 给）：`before` 是本机存着的**同一套**方案改之前那一版，新建 / 另存为时是 null。
 *   给了 prev 就不看 edit。
 *
 * 各步按顺序跑（`used` = 这一组里已经分出去的；`reserved` = prev 与 server 用着的全部 id；`held` = before 里挂着的全部 id，连同那些 role 变体的原 id）：
 *   0. **没有 prev 时**：图位自带的 id 合法、没被占、**role 对得上**（见下面 ★★ role），就认它（显式的赢过派生的）。
 *      有 prev 时一律不看自带的 id —— 那是 apiToScheme 现算的，不是作者存下的。
 *      认下的 id 只有一种是**暂定**的：给了 edit、是新建 id、held 里没有它（= 这一次编辑新加、还没存过的格子）。其余认下就定了。
 *   0b. 给了 edit：自带的 id 在 before 里（内置 id 不在也算：另存为时 before 是 null）、被 0 步因为 role 变了拒掉 → 换成 role 变体
 *      （改回原 role 就是原 id）。三类 id（新建 / 内置 / 派生）都这样。变体没被占、before 里也没有别的格子挂着它才给；
 *      给了之后它的原 id 这一次也进 held（别的格子不许按血统 / 派生拿走）。
 *   S. 有 prev、给了 server，而服务端回来的这一份与 server **逐格内容相同**（格数、名字 trim、role、正文 trim、ref、size、fromCrop）：
 *      按位置接回 server 里记下的 id（没被占、role 对得上、本机那份里它挂的 role 也相同才接；见 ★★ 服务端那一版）。
 *      **让位**：记下的那个 id 本机那份里已经没有了（删掉了），而本机那份里有一格**不在记录里**的（之后新加的；或者它是 role 变体、按原 id + 原 role）
 *      按 A 或 B 对得上这个位置 → 这个位置留给 A、B / V（看得见的那一格优先，复核第 6 轮）。
 *   A. 有 prev：认 prev 里第一个没被占、**名字（trim）、role、正文（trim）都相同**的那格；
 *      剩下的再认**名字（trim）与 role 相同**的第一格（正文相同的先挑，重名的两格换了顺序也不串）。
 *   B. 有 prev：prev 同一位置的那格没被占、**role 相同且正文（trim）相同**，认它。
 *   V. 有 prev：prev 里的 role 变体换成**原 id + 原 role**，再走一遍 A、B（原 id 本机那份里另有一格字面上挂着的不算）——
 *      记录对不上时，本机换过 role 的格子（名字或正文有一样没改）靠它认回原 id，重做一遍换 role 照片就回来（复核第 6 轮）。
 *   S、A、B、V 认来的 id 另外要求它在 prev 里挂的 role 也相同（prev 里是它的 role 变体时，比的是变体的原 role）。
 *   C. 还没定下来的（没有 id 的，和暂定的）：
 *      (i)  内置图位里指纹完全相同、id 可用的第一个 —— 英文名的副本从服务端回来也认得出血统；
 *      (ii) 内置图位里原名 === 名字（trim）且 role 相同、id 可用的第一个 —— 改过措辞之前另存的副本靠它；
 *           「可用」= 这一组没占、不在 reserved、**不在 held**（见 ★★ 存下来的 id）；
 *      (iii) 暂定的：让完内置血统还没着落，就用它自己那个；
 *      (iv) `lg:<role>:` + 名字（trim，截 48 字）；名字是空的用 `lg:<role>:#<第几格>`。撞了（不可用 / role 对不上）就接 `#2`、`#3`…
 *
 * ★★ role：一个 id 代表哪种 role，由内置表（内置 id）、`before`（本机存着的那一版里它挂在哪种 role 上）与 **id 自己写着的 role**
 *   （派生 `lg:<role>:`、role 变体的「现 role」）定。0 步自带的 id、S/A/B 步认来的 id、C 步派生的 id，**都要与那个 role 相同**才给
 *   —— 写着的 role 对不上的 id 连读的时候都不认（存坏的，按现在的 role 重算；这是「存下来的 id 就定了」唯一的例外）。role 变了的格子换 id ——
 *   来回点一下又点回原 role 不算变（比的是存下来的那一版，不是编辑过程）；分几次保存改过去再改回来，三类 id 都靠 0b 的 role 变体回到原 id，
 *   与这中间名字、正文改没改、先改回哪一样都无关（复核第 5 轮：原先只有新建 id 有变体，派生 id 就地改过名之后再改回 role，会按**当时的名字**
 *   重算出另一个派生 id，名字改回来也回不去；改过名 + 正文的内置 id 同理，血统对不上）。
 * ★★ A、B 两步**都要求 role 相同**（设计 3 的阻断项）：只按位置认的话，「已装 · 用它」重装自己的方案时
 *   会把一张脸部照片挂到全身那一格上 —— 出片按 role 取参考图，钱照扣，人不对，零报错。
 * ★★ 派生出来的 id **绝不复用** prev 与 server 里任何一个 id（reserved），也不拿 held 里的：被删掉 / 改掉的那格收着的草稿照片，
 *   不许凭一个撞上的 id 挂到另一格上去。内置血统同样不拿它们。
 *   ⚠ 两档不对称，是有意的（复核第 6 轮点名要写明）：对齐服务端回包（有 prev）时 held 是空的，prev 里 role 变体的**原 id** 只在 V 步认，
 *   V 认不上的不拦 C 步 —— 服务端回来的这一格往往正是本机改 role 之前的那一格，C 步按「名字 + role」派生 / 按血统认回的原 id 是对的
 *   （原 id 收着的照片就是在这种 role 下传的；拦了的话那几张照片反而够不着）。代价：记录对不上、服务端那一行又多出一格
 *   同名同 role（或内置原名、内置正文）的格子时，原 id 的照片会出现在那一格上 —— 同一种 role，不会以别的 role 铸卡。
 *   存编辑屏时是另一回事：变体那一格就在这一次保存里，别的格子派生出它的原 id 就是挪照片，所以 held 拦着。
 * ★★ 服务端那一版（复核第 4、5 轮）：只拿 prev 对齐的话，下面两种里那格的 id 在对齐之后**没有任何一套方案拿着** ——
 *   草稿照片（可能是花钱出的 AI 图）从此够不着，而改动前按名字认，照片会回来：
 *   ① 删掉自己发布过的方案、再从市场装回来：本机已经没有这一套，prev 是空的，每一格都派生新 id；
 *   ② 发布之后本机又改过、存下了（换了 role，或者名字和正文一起改了），再点「已装 · 用它」：服务端那份是**改之前**那一版，
 *      A 要名字 + role、B 要位置 + role + 正文，跟改过的 prev 都对不上；事后在编辑屏把改动重做一遍也认不回原 id。
 *   第 4 轮拿「这一次会话里本机被换掉 / 删掉之前的旧版」（只在内存里）逐版对。第 5 轮抓到它不够：照片可以是 App 重启**之后**才传到
 *   改过的那一格上的，而服务端那份是更早某一次会话推上去的 —— 重启之后旧版没了，照片照样够不着。所以改成记**服务端存着的那一版本身**
 *   （promptSchemes.noteServerSlots：推上去成功、装回来之后写进 localStorage，删掉方案时不删）：服务端回来的与它逐格内容相同，
 *   就是同一份图位，按位置认，不用猜。内容对不上（在别的设备上又推过、回包没收到）就退回 A、B、V —— 对不上的格子拿新 id、照片藏起来，不挪。
 *   ★ 复核第 6 轮补了两处：① S 先于 A、B 跑，原先会把**本机之后新加的**格子挤掉（删掉一格再加一格同名的，记录把被删那格的 id 给了这个位置），
 *   所以 S 让位（见上面 S 步）；② 删掉再装回来时 prev 不再是空的，而是同一次会话里删掉那一刻的本机那份（promptSchemes.removedSlots）——
 *   否则新加的那一格没有任何东西可认，S 让了位也救不回来。
 * ★★ 存下来的 id（复核第 2 轮抓到）：原先**所有** `slot_` id 都是暂定的，连本机存着的、从 prev / before 里认来的也算 ——
 *   某一格占着 fullBody、被删掉（或换了 role）之后，另一格早就存下的 `slot_` id 在下一次保存 / 「已装 · 用它」时悄悄换成 fullBody：
 *   被删那格的照片出现在它身上、照样铸进卡里，它自己那张（可能是花钱出的 AI 图）落在一个再也没人读的键上，零报错。
 *   所以只有「这一次编辑新加的」才暂定；C 步（内置血统与派生）也不许拿 held 里的 id —— before 里有格子挂着的，连同那些 role 变体的原 id
 *   （带着它的那一格要么在 0 / 0b 步认走了，要么这一次被删 / 换了 role —— 照片还挂在上面，给了别的格子就是挪照片）。
 *   ⚠ 没有 edit 的那几遍（冷启动 load、读服务端、upsertMine）根本没有暂定的 id：存下去的 id 下次冷启动原样读回来（幂等门禁钉着）。
 * ★ id 没变的图位**原样返回同一个对象**（内置图位对象上将来可能有 getter，展开一次就丢了），变了的才 `{ ...slot, id }`。
 * ★ 任何一步都不许抛（理由见 clean 的 ★★）。
 */
export function normalizeSlotIds<S extends SlotIdInput>(
  slots: readonly S[],
  o: {
    builtins: readonly BuiltinSlotLineage[];
    prev?: readonly (SlotIdInput & { id: string })[];
    /** 本机记下的「服务端现在存着的那一版」（带 id，promptSchemes.serverSlotsOf）。只在给了 prev 时看，理由见 ★★ 服务端那一版 */
    server?: readonly (SlotIdInput & { id: string })[] | null;
    edit?: { before: readonly (SlotIdInput & { id: string })[] | null };
  },
): { slots: Array<S & { id: string }>; changed: boolean } {
  const n = slots.length;
  const ids: (string | undefined)[] = Array.from({ length: n }, () => undefined);
  /** 暂定的 id（这一次编辑新加、还没存过的格子自带的新建 id）：C 步先让内置血统，让不出去才落定 */
  const provisional: (string | undefined)[] = Array.from({ length: n }, () => undefined);
  const used = new Set<string>();
  const prev = o.prev;
  // ★ 服务端那一版只在有 prev 时看：没有 prev 是「读」（0 步认自带的 id），混进来就说不清该听谁的。坏形状（不是数组的）整版不要
  const server = prev && Array.isArray(o.server) ? o.server : undefined;
  const edit = prev ? undefined : o.edit;
  const before = edit?.before ?? undefined;
  // ★ prev / server / before 里的元素也是读回来的不可信输入：先判是不是对象再取字段（理由见 clean 的 ★★，门禁的坏形状用例喂了 null）
  const reserved = new Set<string>();
  for (const v of [prev ?? [], server ?? []]) for (const p of v) if (p && typeof p.id === "string") reserved.add(p.id);
  // 本机那份里每个 id 挂在哪种 role 上；role 变体的原 id 记它的**原 role**（本机那份里没有原 id 本身时）——
  //   本机把 slot_x 从全身改成脸部（存成 slot_x~primary~face）之后，slot_x 收着的照片是全身照，只许接回全身格
  const prevRole = new Map<string, unknown>();
  if (prev) {
    for (const p of prev) if (p && typeof p.id === "string" && !prevRole.has(p.id)) prevRole.set(p.id, p.role);
    for (const p of prev) {
      const m = p && typeof p.id === "string" ? ROLE_VARIANT.exec(p.id) : null;
      if (m && !prevRole.has(m[1])) prevRole.set(m[1], m[2]);
    }
  }
  const stored = new Set<string>();
  /** before 里有格子挂着的 id，连同那些 role 变体的原 id：照片还挂在上面，C 步不许把它们给别的格子（见 ★★ 存下来的 id） */
  const held = new Set<string>();
  if (before) {
    for (const p of before) {
      if (!p || typeof p.id !== "string") continue;
      stored.add(p.id);
      held.add(p.id);
      held.add(baseOf(p.id));
    }
  }
  const builtinIds = new Set(o.builtins.map((b) => b.id));

  // 每个 id 代表哪种 role：内置 id 由内置表定死（先登记，before 里存坏的 role 盖不掉它）；自建的由本机存着的那一版定
  const ownerRole = new Map<string, unknown>();
  for (const b of o.builtins) ownerRole.set(b.id, b.role);
  if (before) {
    for (const p of before) if (p && isValidSlotId(p.id) && !ownerRole.has(p.id)) ownerRole.set(p.id, p.role);
  }
  // ★★ id 自己写着 role 的两种（派生 `lg:<role>:…`、role 变体 `slot_…~<原>~<现>` 的「现」）也要对得上（复核第 3 轮）：
  //   ownerRole 只认得内置表与 before，它们都说不上话的 id 原先一律放行 —— 编辑屏开着的时候本机那份被「已装 · 用它」换掉、
  //   或者别的路存坏了，一个写着 primary 的 id 就挂在脸部那格上，那格的草稿照片（可能是另一套方案里传的全身照）以脸部 role 铸卡，
  //   而冷启动读回来原样放行，永远修不好。派生 id 与变体都是按现在的 role 拼的，自己算出来的永远过得了这一关。
  //   ★ 先认变体（`lg:primary:正面~primary~aux` 的现 role 是 aux，不是开头写着的 primary）
  const encodedRole = (id: string): string | undefined => ROLE_VARIANT.exec(id)?.[3] ?? LG_ROLE.exec(id)?.[1];
  const roleFits = (id: string, role: unknown) => {
    const e = encodedRole(id);
    return (e === undefined || e === role) && (!ownerRole.has(id) || ownerRole.get(id) === role);
  };

  /** 落定一个 id（进 used，别的格子不许再认） */
  const settle = (i: number, id: string) => {
    used.add(id);
    ids[i] = id;
  };
  const pending = (i: number) => ids[i] === undefined && provisional[i] === undefined;

  if (!prev) {
    // 0. 自带的合法 id（role 对得上）先占位；这一次编辑新加的新建 id 暂定
    for (let i = 0; i < n; i++) {
      const id = slots[i].id;
      if (!isValidSlotId(id) || used.has(id) || !roleFits(id, slots[i].role)) continue;
      if (edit && isFreshSlotId(id) && !held.has(id)) {
        used.add(id);
        provisional[i] = id;
      } else {
        settle(i, id);
      }
    }
    // 0b. 存过的格子（before 里有它；内置 id 另存为时 before 是 null，也算）换了 role → role 变体（改回原 role 就是原 id）。三类 id 都这样
    if (edit) {
      for (let i = 0; i < n; i++) {
        if (!pending(i)) continue;
        const id = slots[i].id;
        if (!isValidSlotId(id) || !(stored.has(id) || builtinIds.has(id))) continue;
        const v = roleVariant(id, ownerRole.get(id), slots[i].role);
        if (v === undefined || !isValidSlotId(v) || used.has(v) || stored.has(v) || !roleFits(v, slots[i].role)) continue;
        settle(i, v);
        // ★ 原 id 收着的照片是原 role 下传的：这一次别的格子（按血统 / 派生）不许拿走它（与 before 里的变体同一条，见 held）
        held.add(baseOf(v));
      }
    }
  } else {
    type Held = SlotIdInput & { id: string };
    // ★ 本机那份里这个 id（或以它为原 id 的变体）挂的 role 也得相同：它收着的照片是在那种 role 下传的
    const roleInPrev = (id: string, role: unknown) => !prevRole.has(id) || prevRole.get(id) === role;
    const canTake = (p: Held | null | undefined, s: S): p is Held =>
      !!p && isValidSlotId(p.id) && !used.has(p.id) && p.role === s.role && roleInPrev(p.id, s.role) && roleFits(p.id, s.role);
    /** 名字（trim）相同。★ 空名字不是证据 */
    const sameTag = (p: SlotIdInput, s: S) => !!clean(s.tag) && clean(p.tag) === clean(s.tag);
    /** 本机那份里**字面上**挂着的 id（role 变体就是变体本身，不含它的原 id） */
    const inPrev = new Set<unknown>(prev.map((p) => p && p.id));
    // V 步的候选：本机那份里的 role 变体，换成它的**原 id + 原 role**（与 prev 按位置对应，不是变体的位置是 undefined）。
    //   ★ 原 id 本机那份里另有一格字面上挂着的不算：那一格收着的是它自己的照片（存坏的数据才会两样都有）
    const bases: (Held | undefined)[] = prev.map((p) => {
      const m = p && typeof p.id === "string" ? ROLE_VARIANT.exec(p.id) : null;
      return m && !inPrev.has(m[1]) ? { ...p, id: m[1], role: m[2] } : undefined;
    });
    /** `list` 里有没有一格按 A（名字 + role）或 B（同一位置 + role + 正文）对得上第 i 格、而且不在记录里 */
    const newerAt = (list: readonly (Held | null | undefined)[], i: number, inRecord: Set<unknown>) =>
      list.some((p, k) => canTake(p, slots[i]) && !inRecord.has(p.id) && (sameTag(p, slots[i]) || (k === i && clean(p.prompt) === clean(slots[i].prompt))));
    // S. 服务端那一版：服务端回来的这一份与本机记下的**逐格内容相同** → 就是同一份图位，按位置接回记下的 id（见 ★★ 服务端那一版）
    if (server && server.length === n && server.every((p, i) => !!p && typeof p === "object" && sameContent(p, slots[i]))) {
      const inRecord = new Set<unknown>(server.map((p) => p.id));
      for (let i = 0; i < n; i++) {
        const id = server[i].id;
        if (!isValidSlotId(id) || used.has(id) || !roleInPrev(id, slots[i].role) || !roleFits(id, slots[i].role)) continue;
        // ★★ 看得见的那一格优先（复核第 6 轮）：记下的这一格本机那份里已经没有了（删掉了），而本机之后新加的一格（不在记录里；
        //   或者它后来换了 role、按原 role 对得上）按 A、B 认得上这个位置 → 这个位置交给 A、B / V。
        //   不让的话：发布之后删掉一格、再加一格同名的（编辑屏没有上移 / 下移，挪位置就是这么挪的），在新格子上传了照片再「已装 · 用它」，
        //   记录把被删那格的 id 给了服务端这一格，新格子的 id 在哪一套里都没有了 —— 照片（可能是花钱出的 AI 图）从此够不着；
        //   改动前按名字认，照片会回来。被删那格的照片本来就够不着（文件头收窄 ③），让出去不损失什么。
        if (!inPrev.has(id) && (newerAt(prev, i, inRecord) || newerAt(bases, i, inRecord))) continue;
        settle(i, id);
      }
    }
    /** A、B 两步（`list` 与 slots 按位置对应）：A = 名字 + role，正文也相同的先认、剩下的再只看名字 + role；B = 同一位置 + role + 正文 */
    const align = (list: readonly (Held | null | undefined)[]) => {
      for (const samePrompt of [true, false]) {
        for (let i = 0; i < n; i++) {
          if (!pending(i)) continue;
          const hit = list.find((p) => canTake(p, slots[i]) && sameTag(p, slots[i]) && (!samePrompt || clean(p.prompt) === clean(slots[i].prompt)));
          if (hit) settle(i, hit.id);
        }
      }
      for (let i = 0; i < n; i++) {
        if (!pending(i)) continue;
        const p = list[i];
        if (canTake(p, slots[i]) && clean(p.prompt) === clean(slots[i].prompt)) settle(i, p.id);
      }
    };
    // A、B：本机那份里的格子
    align(prev);
    // V. 本机那份里换过 role 的格子按**原 id + 原 role** 再走一遍 A、B（排在 A、B 后面：字面上对得上的格子先认）。
    //   ★★ 为什么（复核第 6 轮）：记录对不上服务端那一行时（别的设备又推过、推上去了但回包没收到……），只剩本机那份可对。
    //   本机把一格从全身改成细节（存成 slot_x~primary~aux）之后，服务端回来的还是全身那一格：A、B 要 role 相同，对不上，
    //   C 步给它派生一个新 id —— `slot_` 开头的原 id 永远派生不回来，重做一遍换 role 也回不去，那格的照片从此够不着。
    //   原 id 收着的照片就是在原 role 下传的，服务端这一格正是原 role，认回原 id 不会以另一种 role 铸卡。
    align(bases);
  }

  // C. 内置血统 → 暂定的用自己那个 → 按名字 + role 派生
  // ★★ 内置血统与派生出来的 id 都不许是 before 里有格子挂着的（连同变体的原 id，见 held）：带着它的那一格在 0 / 0b 步就认走了，
  //   走到这里的都是**别的**格子 —— 那一格这一次被删了 / 换了 role，照片还挂在这个 id 上（理由见函数头 ★★ 存下来的 id）。
  //   ★ 复核第 5 轮之前派生 id 不受这条管（「身份就是名字 + role」）；派生 id 也有了 role 变体之后，同名两格互换 role 各自换成变体（门禁 17d），
  //   不再让照片按「名字 + role」跳到另一格上。
  const free = (id: string) => !used.has(id) && !reserved.has(id) && !held.has(id);
  for (let i = 0; i < n; i++) {
    if (ids[i] !== undefined) continue;
    const s = slots[i];
    const own = provisional[i];
    const fp = fingerprint(s);
    const tag = clean(s.tag);
    const lineage =
      o.builtins.find((b) => free(b.id) && fingerprint(b) === fp) ??
      (tag ? o.builtins.find((b) => free(b.id) && b.role === s.role && b.zh === tag) : undefined);
    if (lineage) {
      settle(i, lineage.id);
      continue;
    }
    if (own) {
      ids[i] = own;
      continue;
    }
    const base = `lg:${roleKey(s.role)}:${tag ? clipName(tag) : `#${i + 1}`}`;
    let id = base;
    for (let k = 2; !free(id) || !roleFits(id, s.role); k++) id = `${base}#${k}`;
    settle(i, id);
  }

  let changed = false;
  const out = slots.map((s, i) => {
    const id = ids[i] as string;
    if (s.id === id) return s as S & { id: string };
    changed = true;
    return { ...s, id };
  });
  return { slots: out, changed };
}

/**
 * 存编辑屏时交给 normalizeSlotIds 的 `edit.before` —— **唯一实现**（promptSchemes.saveScheme 调它）。
 *   `stored` = 本机**此刻**存着的同一套；`base` = 编辑屏**打开时**拷贝的那一版（改自己那套时才有，新建 / 另存为是 null）。
 * ★★ 为什么两份都要（复核第 3 轮）：编辑屏开着的时候本机那份可能被换掉 —— 「已装 · 用它」没等回包就关掉市场、点「改」，
 *   回包到了 upsertMine 换掉图位（VideoCardAnnotator 里两层浮层各开各的）。编辑屏手里的 id 来自打开时那一版，只拿此刻
 *   存着的那一版当 before，这些 id 在里面一个都找不到 ⇒ role 核不了 ⇒ 名字、role 一起改了的格子留着原 id，
 *   那格的全身照以脸部 role 铸进卡里。
 * ★ 此刻存着的排前面，打开时那一版里**同一个 id 不再登记第二次**：两份对同一个 id 说法不一样时听此刻存着的 ——
 *   role 核不过就换 id、照片收起来，藏起来总比跟到另一种 role 上安全。
 * ★ 两份都没有回 null（新建 / 另存为）。坏元素（null）不带进去：normalizeSlotIds 自己也判形状，这里只是不添乱。
 */
export function editBefore<T extends SlotIdInput & { id: string }>(
  stored: readonly T[] | null | undefined,
  base: readonly T[] | null | undefined,
): T[] | null {
  if (!stored && !base) return null;
  const out: T[] = [];
  const seen = new Set<unknown>();
  for (const list of [stored, base]) {
    for (const p of list ?? []) {
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/**
 * 编辑屏「＋ 再加一个图位」那一格的新 id（一律 `slot_` 开头、不带 `~`：normalizeSlotIds 认这个形状，头一回保存时让它先认内置血统）。
 * ★ 带时间戳与随机串：删掉的那格收着的草稿照片（customCardStore.schemeShots 按 id 存）不会因为新格子
 *   碰巧拿到同一个 id 又挂回来。生成器可以换（门禁里拿它造「先撞一个再给新的」）。
 * ★ 生成器坏了（恒返回同一个被占的值 / 非法值 / 不带前缀或带 `~` 的值）也不许死循环卡住编辑屏：试满 64 次退成计数后缀。
 */
export function freshSlotId(
  taken: Iterable<string>,
  gen: () => string = () => `${FRESH_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
): string {
  const t = new Set(taken);
  for (let i = 0; i < 64; i++) {
    const id = gen();
    if (isFreshSlotId(id) && !t.has(id)) return id;
  }
  for (let k = 1; ; k++) {
    const id = `${FRESH_PREFIX}${Date.now().toString(36)}_n${k}`;
    if (!t.has(id)) return id;
  }
}
