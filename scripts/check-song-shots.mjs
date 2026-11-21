#!/usr/bin/env node
// 构建门禁：「唱一段」（src/data/songShots.ts，跟着做 L 的歌词 / 提示词 / 作词回话）正反例实跑（2026-10-31）。
//
// ★★ 为什么要有它：这里写错了全是零报错 ——
//   · 提示词的台词格式一歪（「林夏唱道：“……”」「林夏（唱）台词：」），shotScript.lineSpeakers 认不出是谁唱 ⇒ 声音样本带不上、
//     「本人声音样本自证」整个落空；写进了「镜头N：」⇒ 被当成分镜表、出片规则悄悄换掉；
//   · 歌词里留着引号 ⇒ 一句里两层引号，引号外的字被配音；
//   · 时长与行数的尺子一松（8 行塞进 5 秒）⇒ 模型念一半截掉，钱照收；
//   · 作词回话的重复键让四行悄悄只剩一行；
//   · 「成年」那句掉了 ⇒ 2.5 又把人画成未成年（10-31 探测的 s4）。
//   规则一条都不在这里重打：直接 import 那个模块（Node 只剥类型，所以它必须零运行时依赖），台词认法拿 data/shotScript 本尊核对。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。下面几条各自试过、各自变红：
//   ① 台词格式改成「林夏唱道：」；② 去掉「成年」；③ 两行一句改成每行独立且写进「镜头1：」；④ parseLyricsReply 去掉重复键检查；
//   ⑤ lyricsIssue 不按时长算；⑥ parseLyrics 不摘引号。
//
// 用法：node scripts/check-song-shots.mjs [--module=<另一份 songShots.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/songShots.ts"));
const M = await import(url.pathToFileURL(modPath).href);
const S = await import(url.pathToFileURL(path.join(root, "src/data/shotScript.ts")).href);

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
    if (!(e instanceof M.LyricsError) || e.code !== code) problems.push(`${what}：应当抛 ${code}，抛的是 ${e?.code ?? e?.message ?? e}`);
  }
};

// 零运行时依赖
ran++;
fs.readFileSync(modPath, "utf8")
  .split(/\r?\n/)
  .forEach((ln, i) => {
    if (/^\s*import\s+(?!type\b)/.test(ln)) problems.push(`songShots.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  });

const QUOTE_RE = new RegExp(S.LINE_QUOTE.source);
const MARK_RE = /(镜头|shot)\s*[0-9一二三四五六七八九十]+\s*[:：]/i;
const NAMES = ["林夏", "沈舟"];
const EN = ["Lin Xia", "Kai"];
const ZH4 = ["夜色落在窗台上", "风把灯火吹得轻轻晃", "我把名字写进月光", "等一个人回头望"];
const EN4 = ["The night comes down on the windowsill", "The wind keeps every lantern still", "I write your name into the moon", "And wait for you to turn around"];

// (a) 自己写的歌词怎么收
{
  eq("按换行切、空行不算、行尾句读摘掉", M.parseLyrics("夜色落在窗台上。\n\n风把灯火吹得轻轻晃，\n"), ["夜色落在窗台上", "风把灯火吹得轻轻晃"]);
  eq("按句号 / 斜杠切也行", M.parseLyrics("夜色落在窗台上。风把灯火吹得轻轻晃 / 我把名字写进月光"), ["夜色落在窗台上", "风把灯火吹得轻轻晃", "我把名字写进月光"]);
  eq("引号摘掉（引号外的字会被当成台词之外的话配音）", M.parseLyrics("“夜色落在窗台上”\n「风把灯火吹得轻轻晃」"), ["夜色落在窗台上", "风把灯火吹得轻轻晃"]);
  eq("镜头标识摘掉（会被当成分镜表）", M.parseLyrics("镜头1：夜色落在窗台上\n镜头2：风把灯火吹得轻轻晃"), ["夜色落在窗台上", "风把灯火吹得轻轻晃"]);
  ok("一行超过硬顶被截到硬顶", M.parseLyrics("一".repeat(80))[0].length === M.LYRIC_LINE_MAX);
  eq("英文行里的逗号留着", M.parseLyrics("The night comes down, the wind is still\nI wait for you"), ["The night comes down, the wind is still", "I wait for you"]);
}

// (b) 单位与时长的尺子
{
  eq("汉字一个算 1", M.lyricUnits("夜色落在窗台上"), 7);
  ok("字母一个算 0.4、空格标点不算（11 个字母）", Math.abs(M.lyricUnits("I wait, for you") - 11 * 0.4) < 1e-9);
  eq("15 秒唱得完 37 个单位（2.5 / 秒）", M.lyricCapUnits(15), 37);
  eq("四行中文（31 字）至少要 13 秒", M.lyricsMinSec(ZH4), 13);
  eq("四行配 15 秒：行", M.lyricsIssue(ZH4, 15), null);
  eq("四行配 5 秒：唱不完，要 13 秒", M.lyricsIssue(ZH4, 5), { code: "over", needSec: 13 });
  eq("一行不成段", M.lyricsIssue(["夜色落在窗台上"], 15), { code: "few", min: 2 });
  eq("九行太多", M.lyricsIssue(Array(9).fill("夜色"), 30), { code: "many", max: 8 });
  eq("八行短句配 30 秒：行（上限不是按行数一刀切）", M.lyricsIssue(Array(8).fill("夜色落在窗台上"), 30), null);
  eq("语言：中文歌词", M.songLang(ZH4.join("\n")), "zh");
  eq("语言：英文歌词", M.songLang(EN4.join("\n")), "en");
  eq("默认时长 15 秒、单位速度 2.5", [M.SONG_DEFAULT_SEC, M.SING_UNITS_PER_SEC], [15, 2.5]);
}

// (c) 发给视频模型的那段话（中文）
{
  const p = M.songPrompt({ singer: "林夏", lines: ZH4, styleId: "ballad", moodId: "tender", place: "", lang: "zh" });
  const lines = p.split("\n");
  eq("四行歌词合成两句台词 + 头尾各一句", lines.length, 4);
  ok("头一句：缺省舞台 + 成年 + 唱歌不是念白 + 曲风 + 旋律 + 伴奏", lines[0].includes("林夏是成年人，对着麦克风唱歌，不是念白：抒情民谣，慢板，有清晰的旋律起伏，每一句拖长尾音，背景只有轻柔的钢琴伴奏。") && lines[0].startsWith("小剧场的舞台上"));
  eq("台词格式：名字台词（唱，情绪）：“两行用逗号接、句号收”", lines[1], "林夏台词（唱，温柔）：“夜色落在窗台上，风把灯火吹得轻轻晃。”");
  eq("第二句同形", lines[2], "林夏台词（唱，温柔）：“我把名字写进月光，等一个人回头望。”");
  eq("尾句：严格按歌词", lines[3], "严格按歌词演唱，不要增减歌词。");
  eq("lineSpeakers 认出唱的人（只有林夏）", [...(S.lineSpeakers(p, NAMES) ?? ["null"])], ["林夏"]);
  ok("有台词（hasDialogue 那个引号认法）", QUOTE_RE.test(p));
  ok("不写「镜头N：」、不是多镜头", !MARK_RE.test(p) && !S.isMultiShot(p));
  ok("「画面上不要出现字幕」不在这里写（segmentGen.noSubtitleLine 会接）", !p.includes("字幕"));
  const odd = M.songPrompt({ singer: "林夏", lines: ZH4.slice(0, 3), styleId: "pop", moodId: "joyful", place: "", lang: "zh" }).split("\n");
  eq("三行：最后一行单独一句", odd[2], "林夏台词（唱，欢快）：“我把名字写进月光。”");
  ok("曲风换成流行", odd[0].includes("流行歌，中速，节奏明快") && odd[0].includes("轻快的鼓点和合成器伴奏"));
  const placed = M.songPrompt({ singer: "林夏", lines: ZH4, styleId: "guofeng", moodId: "deep", place: "江南水巷", lang: "zh" });
  ok("挑了场景卡：舞台换成卡名，缺省舞台不写", placed.startsWith("江南水巷。林夏是成年人") && !placed.includes("小剧场"));
  const quirky = M.songPrompt({ singer: "林“夏”：", lines: ZH4, styleId: "ballad", moodId: "tender", place: "", lang: "zh" });
  eq("名字里的引号 / 冒号剥掉（会和台词格式打架）", [...(S.lineSpeakers(quirky, ["林夏"]) ?? ["null"])], ["林夏"]);
  ok("没名字时兜底「主唱」", M.songPrompt({ singer: "", lines: ZH4, styleId: "ballad", moodId: "tender", place: "", lang: "zh" }).includes("主唱台词（唱，温柔）"));
  ok("四行 + 缺省舞台 + 场景卡名放得进 2.x 的 500 字", M.songPromptIssue(placed, 500) === null);
  const eight = M.songPrompt({ singer: "林夏", lines: Array(8).fill("风把灯火吹得轻轻晃"), styleId: "ballad", moodId: "tender", place: "", lang: "zh" });
  ok("八行 9 字歌词也放得进 500 字", M.songPromptIssue(eight, 500) === null);
  eq("超了就说长度", M.songPromptIssue("一".repeat(501), 500), { len: 501, max: 500 });
}

// (d) 英文
{
  const p = M.songPrompt({ singer: "Lin Xia", lines: EN4, styleId: "ballad", moodId: "tender", place: "", lang: "en" });
  const lines = p.split("\n");
  eq("英文：两句台词 + 头尾", lines.length, 4);
  ok("英文头一句：成年、singing not speaking、曲风", lines[0].includes("Lin Xia is an adult singing into the microphone — singing, not speaking: a slow acoustic ballad"));
  eq("英文台词格式", lines[1], 'Lin Xia lyrics (singing, tender): "The night comes down on the windowsill, The wind keeps every lantern still."');
  eq("lineSpeakers 认出英文名", [...(S.lineSpeakers(p, EN) ?? ["null"])], ["Lin Xia"]);
  ok("英文也不是多镜头", !MARK_RE.test(p) && !S.isMultiShot(p));
}

// (e) 作词回话怎么收
{
  eq("正常回话", M.parseLyricsReply('{"lines":["夜色落在窗台上","风把灯火吹得轻轻晃"]}', 8), { lines: ["夜色落在窗台上", "风把灯火吹得轻轻晃"], dropped: 0 });
  eq("带 ```json 围栏与解释也读得出", M.parseLyricsReply('好的：\n```json\n{"lines":["夜色落在窗台上","风把灯火吹得轻轻晃"]}\n```', 8).lines.length, 2);
  eq("多出来的行不收、数出来", M.parseLyricsReply(`{"lines":${JSON.stringify(Array(10).fill("夜色落在窗台上"))}}`, 8), { lines: Array(8).fill("夜色落在窗台上"), dropped: 2 });
  eq("行里的引号与镜头标识摘掉", M.parseLyricsReply('{"lines":["“夜色落在窗台上”","镜头2：风把灯火吹得轻轻晃"]}', 8).lines, ["夜色落在窗台上", "风把灯火吹得轻轻晃"]);
  throwsCode("不是 JSON", () => M.parseLyricsReply("夜色落在窗台上\n风把灯火吹得轻轻晃", 8), "noJson");
  throwsCode("有括号但不是合法 JSON", () => M.parseLyricsReply('{"lines":["夜色落在窗台上",]}', 8), "badJson");
  throwsCode("半截 JSON（连右括号都没有）", () => M.parseLyricsReply('{"lines":["夜色落在窗台上",', 8), "noJson");
  throwsCode("没有 lines", () => M.parseLyricsReply('{"title":"夜色"}', 8), "noLines");
  throwsCode("全是空行", () => M.parseLyricsReply('{"lines":["",""]}', 8), "noLines");
  throwsCode("重复键（几段写进同一个对象）", () => M.parseLyricsReply('{"lines":["夜色落在窗台上"],"lines":["风把灯火吹得轻轻晃"]}', 8), "dupKeys");
  const brief = M.lyricsBrief({ theme: "冬夜等人", singer: "林夏", styleId: "ballad", lines: 4, lang: "zh" }).split("\n");
  eq("brief 第一行说语言", brief[0], "用中文写。");
  eq("brief 带曲风 / 行数 / 唱的人 / 主题", brief.slice(1), ["曲风：抒情民谣，慢板", "行数：恰好 4 行", "唱的人：林夏", "主题：冬夜等人"]);
  ok("系统提示：原创、不抄已有歌曲、只输出 JSON", M.LYRICS_SYS.includes("原创") && M.LYRICS_SYS.includes("不抄") && M.LYRICS_SYS.includes("只输出 JSON"));
}

if (problems.length) {
  console.error(`check-song-shots：${problems.length} 条没过（跑了 ${ran} 条）`);
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log(`check-song-shots ✓ ${ran} 条`);
