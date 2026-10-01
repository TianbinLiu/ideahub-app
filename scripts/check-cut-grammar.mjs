#!/usr/bin/env node
// 构建门禁：剪辑台指挥的句式（src/studio/cutGrammar.ts）拿正反例实跑。
//
// ★★ 为什么要有它：「对剪辑台说话」的本地档全靠正则分档，而分档判错的代价不对称 ——
//   没认出来只是多问一次模型（或者老实说没听懂），**认错了**就是替人删了一个片段、改了一句字幕。
//   这类规则只能靠正反例守住（studio/agentGrammar 与 check-agent-grammar.mjs 是同一条纪律的第一份）。
//   模型档的回话同样是不可信输入：parseCutReply 只放白名单里的操作过去，这里也钉着。
// ★ **直接 import 模块本身**（Node 只剥类型），一条正则都不在这里重打 —— 重打一遍就是第二处实现。
// ★ 写完先造真违规试红（仓内门禁纪律）。上线前试过十处，各自变红：删片段不要求点名；剥词法去掉
//   （「把片段2里那个路人删掉」被当成删片段）；「去掉闪黑」那条规则拿掉（那句话就没人认了）；模型回话里不认识的
//   操作不丢；句式表里放一句本地档听不懂的话；没说倍数的「放慢」写回成绝对的 0.75×；「第 N 段」当成位置认（与「片段 N」不分）；
//   没引号的正文不要求引出它的词（「标题不要了」被写成标题）；"去掉"只认一种语序。
//   另有一处：mentionsRemove 恒为真（模型自己加的删片段就拦不住了）。
//
// 用法：node scripts/check-cut-grammar.mjs [--module=<另一份 cutGrammar.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/studio/cutGrammar.ts"));
const G = await import(url.pathToFileURL(modPath).href);

const problems = [];
let ran = 0;
const fail = (msg) => problems.push(msg);
const eq = (label, got, want) => {
  ran++;
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) fail(`${label}：want ${w}，got ${g}`);
};

// ── 形状：零运行时依赖、正则都是字面量 ──
const src = fs.readFileSync(modPath, "utf8");
src.split(/\r?\n/).forEach((ln, i) => {
  if (/^\s*import\s+(?!type\b)/.test(ln)) fail(`cutGrammar.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  if (/@lingui/.test(ln) && !/^\s*(\/\/|\*)/.test(ln)) fail(`cutGrammar.ts:${i + 1}  不许引 @lingui：这里的中文是被解析的句式，回给人的话在 cutAgent 里说`);
  if (/^\s*(export\s+)?(const\s+)?enum\s+\w|^\s*(export\s+)?namespace\s+\w/.test(ln)) fail(`cutGrammar.ts:${i + 1}  不许用 enum / namespace`);
  // 正则写成字符串再 new RegExp，\d 会静默退化成字母 d（CLAUDE.md 那一格）。从字面量的 .source 派生的不算
  if (/new RegExp\(\s*["'`]/.test(ln)) fail(`cutGrammar.ts:${i + 1}  正则写字面量，别写成字符串再 new RegExp`);
});

/** 一句话 → 操作（只看 ops；unclear 另验） */
const ops = (text) => G.parseCutLocal(text).ops;
const unclear = (text) => G.parseCutLocal(text).unclear;
const yes = (text, want) => {
  const r = G.parseCutLocal(text);
  eq(`听得懂：${text}`, r.ops, want);
  eq(`没有没听懂的部分：${text}`, r.unclear, []);
};
/** 本地档不敢办（一个操作都不出，原句记进 unclear） */
const no = (text) => {
  const r = G.parseCutLocal(text);
  eq(`不敢办：${text}`, r.ops, []);
  eq(`记成没听懂：${text}`, r.unclear.length > 0, true);
};

// ── 变速 ──
// 没说倍数的「慢一点 / 快一点」是相对的（speed_step）：落地那一步从现在的速度起挪一档
yes("把片段2放慢", [{ op: "speed_step", clip: 2, dir: -1 }]);
yes("第三个片段快一点", [{ op: "speed_step", clip: 3, dir: 1 }]);
// ★ 带"段"字的说法是另一种点名（{ seg }）：缩略图上标的「段 N」是出自稿子的第几段，换过序之后与位置对不上，
//   落地那一步核对读法是不是唯一（cutProject.segRefClip）。这里只管把两种说法分开标
yes("第三段快一点", [{ op: "speed_step", clip: { seg: 3 }, dir: 1 }]);
yes("把第2段静音", [{ op: "volume", clip: { seg: 2 }, value: 0 }]);
yes("段3静音", [{ op: "volume", clip: { seg: 3 }, value: 0 }]);
yes("把段3静音", [{ op: "volume", clip: { seg: 3 }, value: 0 }]);
yes("mute segment 2", [{ op: "volume", clip: { seg: 2 }, value: 0 }]);
yes("mute seg 2", [{ op: "volume", clip: { seg: 2 }, value: 0 }]);
yes("delete the second segment", [{ op: "remove", clip: { seg: 2 } }]);
yes("片段3静音", [{ op: "volume", clip: 3, value: 0 }]);
yes("第3个片段静音", [{ op: "volume", clip: 3, value: 0 }]);
yes("mute the third clip", [{ op: "volume", clip: 3, value: 0 }]);
yes("片段2和第2段都静音", [{ op: "volume", clip: 2, value: 0 }, { op: "volume", clip: { seg: 2 }, value: 0 }]);
yes("第2段和第2段静音", [{ op: "volume", clip: { seg: 2 }, value: 0 }]);
// 「段」是别的词的一部分 / 后面跟的是秒数：不是点名
yes("这一段3秒处切开", [{ op: "split", clip: "current", at: 3 }]);
eq("用带段字的说法点过的数", G.segRefsIn("把第2段放慢，片段3静音；seg 4 delete，段2再慢一点"), [2, 4]);
eq("没用带段字的说法", G.segRefsIn("把片段2放慢，最后一段静音，这一段删掉"), []);
yes("片段1 2倍速", [{ op: "speed", clip: 1, value: 2 }]);
yes("把最后一段放慢到0.5倍", [{ op: "speed", clip: "last", value: 0.5 }]);
yes("片段2恢复速度", [{ op: "speed", clip: 2, value: 1 }]);
yes("所有片段加快", [{ op: "speed_step", clip: "all", dir: 1 }]);
yes("放慢一点", [{ op: "speed_step", clip: "current", dir: -1 }]);
yes("再慢一点", [{ op: "speed_step", clip: "current", dir: -1 }]);
yes("slow down clip 2", [{ op: "speed_step", clip: 2, dir: -1 }]);
yes("speed up the last clip", [{ op: "speed_step", clip: "last", dir: 1 }]);
yes("make clip 3 1.5x", [{ op: "speed", clip: 3, value: 1.5 }]);
yes("play the second clip at half speed", [{ op: "speed", clip: 2, value: 0.5 }]);

// ── 原声 ──
yes("片段3静音", [{ op: "volume", clip: 3, value: 0 }]);
yes("把片段2和片段3静音", [{ op: "volume", clip: 2, value: 0 }, { op: "volume", clip: 3, value: 0 }]);
yes("全部静音", [{ op: "volume", clip: "all", value: 0 }]);
yes("片段2取消静音", [{ op: "volume", clip: 2, value: 1 }]);
yes("把片段2的原声调到30%", [{ op: "volume", clip: 2, value: 0.3 }]);
yes("mute clip 3", [{ op: "volume", clip: 3, value: 0 }]);
yes("unmute clip 3", [{ op: "volume", clip: 3, value: 1 }]);
yes("set clip 2 volume to 50%", [{ op: "volume", clip: 2, value: 0.5 }]);
// 配乐与原声是两件事
yes("配乐调到30%", [{ op: "music_volume", value: 0.3 }]);
yes("背景音乐音量 50%", [{ op: "music_volume", value: 0.5 }]);
yes("music volume 20%", [{ op: "music_volume", value: 0.2 }]);

// ── 转场 ──
yes("片段2从黑里淡入", [{ op: "fade", clip: 2, on: true }]);
yes("给片段3加个闪黑", [{ op: "fade", clip: 3, on: true }]);
yes("去掉片段2的闪黑", [{ op: "fade", clip: 2, on: false }]);
yes("片尾淡出", [{ op: "end_fade", on: true }]);
yes("取消片尾淡出", [{ op: "end_fade", on: false }]);
yes("fade in clip 2", [{ op: "fade", clip: 2, on: true }]);
yes("remove the fade from clip 2", [{ op: "fade", clip: 2, on: false }]);
yes("fade out at the end", [{ op: "end_fade", on: true }]);

// ── 删 / 挪 / 裁 / 切 ──
yes("删掉片段2", [{ op: "remove", clip: 2 }]);
yes("把最后一段去掉", [{ op: "remove", clip: "last" }]);
yes("delete clip 2", [{ op: "remove", clip: 2 }]);
yes("remove the third clip please", [{ op: "remove", clip: 3 }]);
yes("把片段3挪到最前面", [{ op: "move", clip: 3, to: "first" }]);
yes("把片段1挪到第3位", [{ op: "move", clip: 1, to: 3 }]);
yes("片段2后移", [{ op: "move", clip: 2, to: { delta: 1 } }]);
yes("片段2前移", [{ op: "move", clip: 2, to: { delta: -1 } }]);
yes("move clip 3 to the front", [{ op: "move", clip: 3, to: "first" }]);
yes("move clip 1 to position 2", [{ op: "move", clip: 1, to: 2 }]);
yes("片段2去掉开头2秒", [{ op: "trim", clip: 2, edge: "start", sec: 2, mode: "cut" }]);
yes("片段3裁掉结尾1.5秒", [{ op: "trim", clip: 3, edge: "end", sec: 1.5, mode: "cut" }]);
yes("片段1只留前3秒", [{ op: "trim", clip: 1, edge: "end", sec: 3, mode: "keep" }]);
yes("trim 2 seconds off the start of clip 2", [{ op: "trim", clip: 2, edge: "start", sec: 2, mode: "cut" }]);
yes("keep only the first 3 seconds of clip 1", [{ op: "trim", clip: 1, edge: "end", sec: 3, mode: "keep" }]);
yes("在片段2的第3秒切开", [{ op: "split", clip: 2, at: 3 }]);
yes("split clip 2 at 3 seconds", [{ op: "split", clip: 2, at: 3 }]);

// ── 字幕 / 标题 / 配音 ──
yes("片段1的字幕改成「雨停了，她收起伞。」", [{ op: "line", clip: 1, text: "雨停了，她收起伞。" }]);
yes("给片段2写字幕：天亮了", [{ op: "line", clip: 2, text: "天亮了" }]);
yes("去掉片段2的字幕", [{ op: "line", clip: 2, text: "" }]);
yes('set clip 1 caption to "The rain stopped."', [{ op: "line", clip: 1, text: "The rain stopped." }]);
yes("remove the caption from clip 2", [{ op: "line", clip: 2, text: "" }]);
yes("标题改成「雨夜信使」", [{ op: "title", text: "雨夜信使" }]);
yes("片头标题：雨夜信使", [{ op: "title", text: "雨夜信使" }]);
yes("去掉标题", [{ op: "title", text: "" }]);
yes('set the title to "Rainy Night"', [{ op: "title", text: "Rainy Night" }]);
yes("不要字幕", [{ op: "captions", on: false }]);
yes("去掉字幕", [{ op: "captions", on: false }]); // 没点名片段：是不烧字幕，不是删某一段的字
yes("打开字幕", [{ op: "captions", on: true }]);
yes("turn off captions", [{ op: "captions", on: false }]);
yes("全部配音", [{ op: "voice", clip: "all" }]);
yes("给片段2配音", [{ op: "voice", clip: 2 }]);
yes("配音", [{ op: "voice", clip: "all" }]);
yes("去掉片段2的配音", [{ op: "unvoice", clip: 2 }]);
yes("voice all clips", [{ op: "voice", clip: "all" }]);
yes("add voiceover to clip 2", [{ op: "voice", clip: 2 }]);
yes("remove the voiceover from clip 2", [{ op: "unvoice", clip: 2 }]);

// ── 撤销 / 重做 / 一键成片 ──
yes("撤销", [{ op: "undo" }]);
yes("撤销上一步", [{ op: "undo" }]);
yes("重做", [{ op: "redo" }]);
yes("undo", [{ op: "undo" }]);
yes("redo", [{ op: "redo" }]);
yes("一键成片", [{ op: "auto" }]);
yes("帮我写旁白", [{ op: "auto" }]);

// ── 一句话几件事 ──
yes("把片段2放慢，片段3静音；片尾淡出", [
  { op: "speed_step", clip: 2, dir: -1 },
  { op: "volume", clip: 3, value: 0 },
  { op: "end_fade", on: true },
]);
yes("delete clip 2, mute clip 3, thanks", [{ op: "remove", clip: 2 }, { op: "volume", clip: 3, value: 0 }]);
// 引号里的逗号不切句
yes("片段1的字幕改成「你好，世界；再见」，片段2静音", [{ op: "line", clip: 1, text: "你好，世界；再见" }, { op: "volume", clip: 2, value: 0 }]);

// ── 不敢办的（判错的方向要安全）──
// ★ 命令词之外还有说不清的内容：那多半是在说别的事（圈选重拍的活），删片段 / 静音就错大了
no("把片段2里那个路人删掉");
no("片段3里背景的车太吵了静音");
no("把片段2的天空换成晚霞");
no("delete the dog in clip 2");
// 删片段必须点名；「全部删掉」不办
no("删掉");
no("delete");
no("删掉所有片段");
// 写字幕要点名一个片段，而且得有字
no("字幕改成「你好」");
no("片段1和片段2的字幕改成「你好」");
no("片段1的字幕改成");
// 挪只对一个片段办
no("把所有片段挪到最前面");
// 认不出的数字 / 设置类的话
no("第零段放慢");
no("换一个音色");
no("把画面调亮一点");
no("make it more cinematic");
// ★ 「去掉 X」的两种语序都是"去掉"，不是把正文写成"去掉"两个字（探句子时真抓到过：标题被写成了"不要了"）
yes("标题不要了", [{ op: "title", text: "" }]);
yes("标题去掉", [{ op: "title", text: "" }]);
yes("片段2字幕去掉", [{ op: "line", clip: 2, text: "" }]);
yes("片段2的配音不要了", [{ op: "unvoice", clip: 2 }]);
yes("片段2闪黑去掉", [{ op: "fade", clip: 2, on: false }]);
yes("片尾淡出不要了", [{ op: "end_fade", on: false }]);
yes("字幕去掉", [{ op: "captions", on: false }]);
// ★ 没用引号的正文要有引出它的词（改成 / 叫 / to）；评价、问话不是正文
no("片段2的字幕不要去掉");
no("clip 2 caption should stay");
no("the title looks wrong");
no("the title is too long");
no("标题是不是太长了");
no("标题叫什么好");
no("片段1字幕是雨停了");
no("片段2的字幕改成 雨停了吗");
yes("片段2的字幕改成「雨停了吗」", [{ op: "line", clip: 2, text: "雨停了吗" }]);
yes("给片段2写一句字幕 雨停了", [{ op: "line", clip: 2, text: "雨停了" }]);
yes("片段2字幕：雨停了", [{ op: "line", clip: 2, text: "雨停了" }]);
yes("标题叫雨夜信使", [{ op: "title", text: "雨夜信使" }]);
yes("title: Rainy Night", [{ op: "title", text: "Rainy Night" }]);
yes("set clip 1 caption to hello world", [{ op: "line", clip: 1, text: "hello world" }]);
// 否定的话一律不办（命令词还在句子里，可意思是反的 —— 剥词法剥不掉"不 / 别"，剩下的那个字把它挡住）
no("片段2不要静音");
no("别把片段2静音");
no("片段2先别删");
no("不要删片段2");
no("片段2不要删掉");
no("片段2别放慢");
no("don't mute clip 2");
no("do not delete clip 2");
no("can you not mute clip 2");
no("删掉片段2还是片段3");
// 连着说几件事的衔接词是壳，不算"没听懂"（不然会为了"然后"两个字去问一次模型）
yes("撤销，然后把片段1静音", [{ op: "undo" }, { op: "volume", clip: 1, value: 0 }]);
yes("先把片段1静音，然后把片段2放慢，最后片尾淡出", [{ op: "volume", clip: 1, value: 0 }, { op: "speed_step", clip: 2, dir: -1 }, { op: "end_fade", on: true }]);
yes("first mute clip 1, then slow down clip 2, and finally fade out at the end", [{ op: "volume", clip: 1, value: 0 }, { op: "speed_step", clip: 2, dir: -1 }, { op: "end_fade", on: true }]);
yes("另外把片段3也删掉", [{ op: "remove", clip: 3 }]);
// 一半听懂一半没听懂：听懂的照办，没听懂的记下来
eq("一半听懂一半没听懂：听懂的那半", ops("片段2放慢，再把画面调亮"), [{ op: "speed_step", clip: 2, dir: -1 }]);
eq("一半听懂一半没听懂：没听懂的那半", unclear("片段2放慢，再把画面调亮"), ["再把画面调亮"]);

// ── 面板上的句式：每一句都得是本地档真听得懂的 ──
for (const lang of ["zh", "en"]) {
  for (const phrase of G.CUT_PHRASES[lang]) {
    const r = G.parseCutLocal(phrase);
    eq(`面板句式听得懂（${lang}）：${phrase}`, [r.ops.length > 0, r.unclear], [true, []]);
  }
}
eq("两套句式一样多", G.CUT_PHRASES.zh.length, G.CUT_PHRASES.en.length);

// ── 模型档：回话的形状检查（不可信输入）──
{
  const good = G.parseCutReply(
    JSON.stringify({
      say: "好的，放慢了第二段。",
      ops: [
        { op: "speed", clip: 2, value: 0.75 },
        { op: "volume", clip: "all", value: 30 },
        { op: "fade", clip: 3, on: true },
        { op: "move", clip: 3, to: "first" },
        { op: "move", clip: 2, to: "later" },
        { op: "trim", clip: 1, edge: "start", sec: 2 },
        { op: "line", clip: 1, text: "  雨停了。 " },
        { op: "title", text: "雨夜信使" },
        { op: "music_volume", value: 0.4 },
        { op: "end_fade", on: "true" },
      ],
    }),
  );
  eq("形状对的收下（百分数折成 0~1、布尔字符串也认、字幕去掉两头空白）", good, {
    say: "好的，放慢了第二段。",
    ops: [
      { op: "speed", clip: 2, value: 0.75 },
      { op: "volume", clip: "all", value: 0.3 },
      { op: "fade", clip: 3, on: true },
      { op: "move", clip: 3, to: "first" },
      { op: "move", clip: 2, to: { delta: 1 } },
      { op: "trim", clip: 1, edge: "start", sec: 2, mode: "cut" },
      { op: "line", clip: 1, text: "雨停了。" },
      { op: "title", text: "雨夜信使" },
      { op: "music_volume", value: 0.4 },
      { op: "end_fade", on: true },
    ],
    dropped: 0,
  });
  const bad = G.parseCutReply(
    JSON.stringify({
      say: 5,
      ops: [
        { op: "generate", clip: 1 }, // 白名单里没有：花钱的事模型碰不到
        { op: "regen", clip: 1 },
        { op: "speed_step", clip: 1, dir: -1 }, // 本地档专用（模型看得见现在的速度，给绝对值），提示词里没有就不收
        { op: "speed", clip: 0, value: 2 }, // 片段从 1 起
        { op: "speed", clip: 2, value: 99 },
        { op: "speed", clip: 2 }, // 缺值
        { op: "remove", clip: "all" }, // 不许一句话删光
        { op: "move", clip: "all", to: 1 },
        { op: "line", clip: "all", text: "x" },
        { op: "trim", clip: 1, edge: "middle", sec: 2 },
        { op: "split", clip: 1, at: -1 },
        "乱入",
        null,
        { op: "remove", clip: 2 },
      ],
    }),
  );
  eq("不认识的 / 缺字段的 / 越界的逐条丢，剩下的照收", bad && [bad.say, bad.ops, bad.dropped], ["", [{ op: "remove", clip: 2 }], 13]);
  eq("回话里没有 JSON：整句不办", G.parseCutReply("好的，我已经帮你删掉了第二段。"), null);
  eq("包在代码块里的 JSON 读得出", G.parseCutReply('```json\n{"say":"好","ops":[{"op":"undo"}]}\n```')?.ops, [{ op: "undo" }]);
  eq("没有 ops 就是一句话", G.parseCutReply('{"say":"这个我办不了"}'), { say: "这个我办不了", ops: [], dropped: 0 });
  const flood = G.parseCutReply(JSON.stringify({ ops: Array.from({ length: 40 }, () => ({ op: "undo" })) }));
  eq("一口气回几十条：只收前 CUT_OPS_MAX 条", flood && [flood.ops.length, flood.dropped], [G.CUT_OPS_MAX, 40 - G.CUT_OPS_MAX]);
}

// ── 模型档的删片段要人的话里真提过"删"（模型自己加的戏不办）──
for (const t of ["把片段2删了", "片段2不要了", "delete clip 2", "get rid of the second clip", "把那段剪掉", "去掉片段3"]) eq(`提过删：${t}`, G.mentionsRemove(t), true);
for (const t of ["把片段2放慢", "片段2静音", "make it more cinematic", "让节奏紧凑一点", "把片段2的结尾收一下"]) eq(`没提过删：${t}`, G.mentionsRemove(t), false);

if (problems.length) {
  console.error(`\n❌ 剪辑台指挥句式检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：句式只改 src/studio/cutGrammar.ts；改一条正则就在这里补一句正例、一句反例（判错的方向要安全：认不准就不办）。\n");
  process.exit(1);
}
console.log(`✓ 剪辑台指挥句式检查通过（${ran} 条）`);
