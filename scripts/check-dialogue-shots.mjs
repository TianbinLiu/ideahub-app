#!/usr/bin/env node
// 构建门禁：「对话正反打」（src/data/dialogueShots.ts，跟着做 I 的对白 / 三个机位 / 一句一段）正反例实跑（2026-10-05 第一批）。
//
// ★★ 为什么要有它：这里写错了全是零报错 ——
//   · 回话收错：重复键让四句悄悄只剩一句；台词里留着模型写的引号，拼出来一句里两层引号；说话人混进路人，那一句配给谁都不对；
//   · 一句一段的那段话：说话人没紧挨在引号前面（「林夏看着沈舟，说：“……”」），shotScript.lineSpeakers 认不准 ⇒
//     声音样本照旧全带，说话的人拿不到「只带自己」的那份；写进了「镜头1：」⇒ 被当成分镜表、出片规则悄悄换掉；
//   · 机位那句：站位不写死，两个过肩接在一起时两人的视线对不上（越轴），画出来的东西不报错，只是看着别扭。
//   规则一条都不在这里重打：直接 import 那个模块（Node 只剥类型，所以它必须零运行时依赖），台词认法拿 data/shotScript 本尊核对，
//   语速那两个数拿 data/cutProject 本尊核对。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。下面几条各自试过、各自变红：
//   ① 去掉重复键检查；② 台词里不摘引号；③ 说话人不是这两个人也收；④ 一句一段写成「林夏看着沈舟，说：“……”」（动作接在说话人后面）；
//   ⑤ 双人镜头不写谁左谁右；⑥ 一句一段写成「镜头1：……」。
//
// 用法：node scripts/check-dialogue-shots.mjs [--module=<另一份 dialogueShots.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/dialogueShots.ts"));
const M = await import(url.pathToFileURL(modPath).href);
const S = await import(url.pathToFileURL(path.join(root, "src/data/shotScript.ts")).href);
const C = await import(url.pathToFileURL(path.join(root, "src/data/cutProject.ts")).href);

const problems = [];
let ran = 0;
const show = (v) => JSON.stringify(v);
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) problems.push(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};
const ok = (what, cond) => {
  ran++;
  if (!cond) problems.push(what);
};
const throwsCode = (what, fn, code) => {
  ran++;
  try {
    fn();
    problems.push(`${what}：应当抛 ${code}，却收下了`);
  } catch (e) {
    if (!(e instanceof M.DialogueError) || e.code !== code) problems.push(`${what}：应当抛 ${code}，抛的是 ${e?.code ?? e?.message ?? e}`);
  }
};

// 零运行时依赖
ran++;
fs.readFileSync(modPath, "utf8")
  .split(/\r?\n/)
  .forEach((ln, i) => {
    if (/^\s*import\s+(?!type\b)/.test(ln)) problems.push(`dialogueShots.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  });

const NAMES = ["林夏", "沈舟"];
const MAX = M.DIALOGUE_LINES_MAX;
const QUOTE_RE = new RegExp(S.LINE_QUOTE.source);
const MARK_RE = /(镜头|shot)\s*[0-9一二三四五六七八九十]+\s*[:：]/i;
const speakersOf = (plot) => {
  const s = S.lineSpeakers(plot, NAMES);
  return s === null ? null : [...s];
};

// (a) 发给模型的那一份
{
  const zh = M.dialogueBrief({ situation: "林夏在车站等了一夜，沈舟终于来了", names: NAMES, place: "旧车站", lang: "zh" }).split("\n");
  eq("brief 第一行说语言（中文）", zh[0], "用中文写。");
  eq("brief 带两个人的名字（按点的先后）", zh[1], "两个人：林夏、沈舟");
  eq("brief 带地点（场景卡名）", zh[2], "地点：旧车站");
  eq("brief 末行是情境", zh[3], "情境：林夏在车站等了一夜，沈舟终于来了");
  const noPlace = M.dialogueBrief({ situation: "雨夜重逢", names: NAMES, place: "", lang: "zh" }).split("\n");
  eq("没挂场景卡：没有地点那一行", noPlace.length, 3);
  const en = M.dialogueBrief({ situation: "They meet again at the station", names: ["Rin", "Kai"], place: "", lang: "en" }).split("\n");
  ok("英文：第一行明说用英文写、按单词算长度", en[0].includes("用英文写") && en[0].includes("单词"));
  ok("系统提示词规定了输出形状（lines / who / text / act）", ["\"lines\"", "\"who\"", "\"text\"", "\"act\""].every((k) => M.DIALOGUE_SYS.includes(k)));
  ok("系统提示词说了句数范围", M.DIALOGUE_SYS.includes(`${M.DIALOGUE_LINES_MIN}~${M.DIALOGUE_LINES_MAX} 句`));
  ok("系统提示词说了不要引号", M.DIALOGUE_SYS.includes("不要出现引号"));
}

// (b) 收回话
{
  const good = JSON.stringify({
    lead: "深夜的旧车站，站台灯昏黄，下着小雨",
    lines: [
      { who: "沈舟", text: "你还在等？", act: "收起伞" },
      { who: "林夏", text: "“我说过会等你。”", act: "林夏站起身" },
      { who: "沈舟", text: "镜头2：对不起，我来晚了。", act: "" },
      { who: "林夏", text: "回家吧。", act: "笑了笑" },
    ],
  });
  const p = M.parseDialogue("```json\n" + good + "\n```", NAMES, MAX);
  eq("整体交代收下", p.lead, "深夜的旧车站，站台灯昏黄，下着小雨");
  eq("四句都收下", p.lines.length, 4);
  eq("说话人按名字认成 0 / 1", p.lines.map((l) => l.who), [1, 0, 1, 0]);
  eq("台词里的引号摘掉（引号由一句一段那里加）", p.lines[1].text, "我说过会等你。");
  eq("台词里的「镜头2：」摘掉（留着会被当成多镜头）", p.lines[2].text, "对不起，我来晚了。");
  eq("动作开头的说话人名字剥掉", p.lines[1].act, "站起身");
  eq("缺省机位：第一句双人，之后拍说话的人", p.lines.map((l) => l.angle), ["two", "faceA", "faceB", "faceA"]);
  eq("没处理掉什么就没有 notes", p.notes, []);

  const arr = M.parseDialogue(JSON.stringify([{ who: "林夏", text: "早。" }, { who: "沈舟", text: "早。" }]), NAMES, MAX);
  eq("直接回一个数组也收（没有 lead）", [arr.lead, arr.lines.length], ["", 2]);

  const strangers = M.parseDialogue(
    JSON.stringify({ lines: [{ who: "林夏", text: "你好。" }, { who: "列车员", text: "车要开了！" }, { who: "列车员", text: "快上车！" }, { who: "沈舟", text: "走吧。" }] }),
    NAMES,
    MAX,
  );
  eq("说话人不是这两个人：整句不收", strangers.lines.map((l) => l.text), ["你好。", "走吧。"]);
  eq("路人记一条（只记一次）", strangers.notes, [{ kind: "strangers", names: ["列车员"] }]);
  eq("去掉路人之后机位按剩下的句子重排", strangers.lines.map((l) => l.angle), ["two", "faceB"]);

  const many = M.parseDialogue(JSON.stringify({ lines: Array.from({ length: 8 }, (_, i) => ({ who: NAMES[i % 2], text: `第${i + 1}句。` })) }), NAMES, MAX);
  eq("多出来的句子不收", many.lines.length, MAX);
  eq("多出来几句记一条", many.notes, [{ kind: "dropped", count: 2 }]);

  const empty = M.parseDialogue(JSON.stringify({ lines: [{ who: "林夏", text: "" }, { who: "沈舟", text: "嗯。" }] }), NAMES, MAX);
  eq("空台词不收、记一条", [empty.lines.length, empty.notes], [1, [{ kind: "empty", count: 1 }]]);

  throwsCode("重复键（几句挤进同一个对象）", () => M.parseDialogue('{"lines":[{"who":"林夏","text":"你来了","who":"沈舟","text":"嗯"}]}', NAMES, MAX), "dupKeys");
  throwsCode("不是 JSON", () => M.parseDialogue("好的，下面是对白：林夏说你来了", NAMES, MAX), "noJson");
  throwsCode("JSON 坏了", () => M.parseDialogue('{"lines":[{"who":"林夏","text":"你来了"', NAMES, MAX), "noJson");
  throwsCode("括号配上了但读不出来", () => M.parseDialogue('{"lines": [ {who: 林夏} ]}', NAMES, MAX), "badJson");
  throwsCode("没有 lines", () => M.parseDialogue('{"lead":"车站"}', NAMES, MAX), "noLines");
  throwsCode("一句都收不下（全是路人）", () => M.parseDialogue('{"lines":[{"who":"列车员","text":"车要开了"}]}', NAMES, MAX), "noLines");
}

// (c) 画机位的那一句
{
  const two = M.angleMoment("two", NAMES, "深夜的旧车站。");
  const fa = M.angleMoment("faceA", NAMES, "深夜的旧车站");
  const fb = M.angleMoment("faceB", NAMES, "");
  for (const [what, s] of [["双人", two], ["拍林夏", fa], ["拍沈舟", fb]]) {
    ok(`${what}：两个人都点名`, s.includes("林夏") && s.includes("沈舟"));
    ok(`${what}：每个人只出现一次（组图那次付费对比里多画过一个人）`, s.includes("只出现一次"));
    ok(`${what}：不写台词（没有引号）`, !QUOTE_RE.test(s));
  }
  ok("双人：写死谁左谁右（守 180 度线）", two.includes("林夏在画面左边") && two.includes("沈舟在画面右边"));
  ok("拍林夏：越过沈舟的肩膀、沈舟在右侧前景、林夏在左侧", fa.includes("镜头在沈舟身后") && fa.includes("右侧前景是沈舟") && fa.includes("林夏在画面左侧"));
  ok("拍沈舟：越过林夏的肩膀、林夏在左侧前景、沈舟在右侧", fb.includes("镜头在林夏身后") && fb.includes("左侧前景是林夏") && fb.includes("沈舟在画面右侧"));
  ok("整体交代接在最前（句末标点不重复）", two.startsWith("深夜的旧车站。中景") && fa.startsWith("深夜的旧车站。近景"));
  ok("没有整体交代就直接从景别开始", fb.startsWith("近景"));
  ok("补一句要求接在最后", M.angleMoment("two", NAMES, "", "沈舟戴着眼镜。").endsWith("。要求：沈舟戴着眼镜"));
  ok("名字里的引号 / 花括号剥掉", !/[“”{}]/.test(M.angleMoment("two", ["“阿{B}”", "沈舟"], "")));

  eq("参考图点名：没有双人镜头、没有卡图 = 空", M.angleRefLine("", false), "");
  ok("参考图点名：卡图", M.angleRefLine("图1 是林夏；图2 是沈舟", false).startsWith("。参考图：图1 是林夏；图2 是沈舟"));
  const based = M.angleRefLine("图2 是林夏；图3 是沈舟", true);
  ok("参考图点名：画过肩时图1 是双人镜头、卡图从图2 起", based.startsWith("。参考图：图1 是这场戏的双人镜头") && based.includes("；图2 是林夏"));
}

// (d) 一句一段：说话人认得准、不是多镜头、有台词、不超长
{
  const lead = "深夜的旧车站，站台灯昏黄";
  const cases = [];
  for (const angle of M.DIALOGUE_ANGLES)
    for (const who of [0, 1])
      for (const act of ["", "看着沈舟放下杯子", "看着林夏，笑了笑"]) cases.push({ angle, who, act, text: "我说过会等你。" });
  for (const c of cases) {
    const plot = M.linePlot(c, NAMES, lead, "zh");
    const tag = `${c.angle}/${c.who}/${c.act || "无动作"}`;
    eq(`[${tag}] lineSpeakers 认出说话人（动作里提到另一个人也不弄混）`, speakersOf(plot), [NAMES[c.who]]);
    ok(`[${tag}] 有台词（hasDialogue 那个引号认法）`, QUOTE_RE.test(plot));
    ok(`[${tag}] 不写「镜头N：」（会被当成分镜表）：${plot}`, !MARK_RE.test(plot) && !S.isMultiShot(plot));
    ok(`[${tag}] 整体交代在最前`, plot.startsWith("深夜的旧车站，站台灯昏黄。"));
  }
  const reaction = M.linePlot({ who: 0, text: "你还好吗？", act: "皱眉", angle: "faceB" }, NAMES, "", "zh");
  ok("反应镜头（拍听的人）：说话的人在画外", reaction.includes("沈舟静静听着") && reaction.includes("画外传来林夏的声音"));
  ok("反应镜头：说话的人看不见，不写他的动作", !reaction.includes("皱眉"));
  eq("反应镜头：台词仍认在林夏身上", speakersOf(reaction), ["林夏"]);
  ok("facesSpeaker：双人算、拍说话的人算、拍听的人不算", M.facesSpeaker({ who: 1, angle: "two" }) && M.facesSpeaker({ who: 1, angle: "faceB" }) && !M.facesSpeaker({ who: 1, angle: "faceA" }));
  const quoted = M.linePlot({ who: 0, text: "“你来了”", act: "", angle: "faceA" }, NAMES, "", "zh");
  eq("台词里的引号摘掉，只留一层", (quoted.match(/[“”]/g) ?? []).length, 2);

  // 英文
  const EN = ["Rin", "Kai"];
  for (const angle of M.DIALOGUE_ANGLES)
    for (const who of [0, 1]) {
      const plot = M.linePlot({ who, text: "I said I would wait for you.", act: "looks at Kai", angle }, EN, "A quiet train station at night", "en");
      const s = S.lineSpeakers(plot, EN);
      eq(`[en ${angle}/${who}] lineSpeakers 认出说话人`, s === null ? null : [...s], [EN[who]]);
      ok(`[en ${angle}/${who}] 不是多镜头`, !S.isMultiShot(plot) && !MARK_RE.test(plot));
      ok(`[en ${angle}/${who}] 整体交代补句号`, plot.startsWith("A quiet train station at night. "));
    }

  // 最长的输入也放得进最紧的那一档（1.x 两档 400 字），给系统兜底句留出余量
  const longName = ["名字十二个字的第一个人物", "名字十二个字的第二个人物"];
  const longest = M.linePlot(
    { who: 0, text: "台".repeat(M.LINE_TEXT_MAX), act: "动".repeat(M.LINE_ACT_MAX), angle: "faceA" },
    longName,
    "交".repeat(M.DIALOGUE_LEAD_MAX),
    "zh",
  );
  ok(`最长的一句一段 ${longest.length} 字，要 ≤ 300（给参考清单 / 别出字幕那几句留位）`, longest.length <= 300);
}

// (e) 时长：念完要多久 + 前后留白；语速两个数与剪辑页配音实测的那组相等
{
  eq("语速与 cutProject.TTS_CPS 相等", M.SPEECH_CPS, C.TTS_CPS);
  eq("字母折算与 cutProject.LATIN_UNIT 相等", M.LATIN_UNIT, C.LATIN_UNIT);
  eq("短句：5 个字 → 3 秒（按档位窗口夹由调用方做）", M.lineSec("你终于来了。"), 3);
  eq("20 个字 → 7 秒", M.lineSec("我在这个车站等了你整整一夜你终于还是来了啊"), 7);
  eq("标点和空格不算", M.lineSec("你，终于……来了！"), 3);
  eq("英文按字母折算：29 个字母 → 5 秒", M.lineSec("I said I would wait for you all night"), 5);
}

// (f) 机位的版本：人、交代、画幅变了都过期；过肩还认它照着哪一张双人镜头画的
{
  const k = (angle, o = {}) => M.angleKey(angle, o.names ?? NAMES, o.lead ?? "车站", o.aspect ?? "portrait", o.base ?? "b1");
  ok("换人 → 过期", k("two") !== k("two", { names: ["林夏", "陆远"] }));
  ok("换整体交代 → 过期", k("faceA") !== k("faceA", { lead: "天台" }));
  ok("换画幅 → 过期", k("faceB") !== k("faceB", { aspect: "landscape" }));
  ok("双人镜头重画过 → 两个过肩过期", k("faceA") !== k("faceA", { base: "b2" }) && k("faceB") !== k("faceB", { base: "b2" }));
  eq("双人镜头自己不认 base", k("two"), k("two", { base: "b2" }));
  eq("defaultAngle", [M.defaultAngle(0, 1), M.defaultAngle(1, 0), M.defaultAngle(2, 1)], ["two", "faceA", "faceB"]);
}

if (problems.length) {
  console.error(`\n❌ 对话正反打检查没过（${problems.length} / ${ran}）：\n`);
  for (const p of problems) console.error("  · " + p);
  console.error("\n改法：规则只在 src/data/dialogueShots.ts；台词怎么认在 src/data/shotScript.ts（lineSpeakers），别在这里另写一份。\n");
  process.exit(1);
}
console.log(`✓ 对话正反打检查通过（${ran} 条：提示词 / 收回话 / 三个机位 / 一句一段认说话人 / 时长 / 机位版本）`);
