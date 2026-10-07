#!/usr/bin/env node
// 构建门禁：「一场戏 → 九宫格分镜」（src/data/gridShots.ts，跟着做 C 的分镜清单 / 组图提示词 / 单格重画 / 一格一段）正反例实跑（2026-10-05 第三期）。
//
// ★★ 为什么要有它：模型的回话是不可信输入，收错了全是零报错 —— 重复键让九格悄悄只剩一格、画面里留着「镜头2：」把那一段切成两个镜头、
//   画面里的引号被当成台词配音、who 里混进路人就多带一张不相干的人物图。组图那句提示词同样：少了「每个人只出现一次」，
//   2026-10-05 付费对比里第 6 张就多画了一个林夏；空镜不写「画面里没有人」，模型会把参考图里的人画进去。
//   规则一条都不在这里重打：直接 import 那个模块（Node 只剥类型，所以它必须零运行时依赖），并拿 data/shotScript 的读法核对 ——
//   一格变成一段的那段话，分镜表必须读成一个镜头、读不出台词。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，下面几条各自变红：
//   ① 去掉重复键检查；② 画面里不摘引号；③ who 里不剔路人；④ 组图提示词去掉「只出现一次」；⑤ 空镜单画不写「没有任何人」；⑥ 一格一段写成「镜头1：」；
//   ⑦ castGaps 永远回空（2026-10-07 补：App 重开后人物没还原，重画 / 落段带不上卡图的那道闸）；
//   ⑧ 收回话时不把画面里点到名的人补进 who；⑨ 空镜不排到单画的最后（2026-10-07 主人「改」那一批）。
//
// 用法：node scripts/check-grid-shots.mjs [--module=<另一份 gridShots.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/data/gridShots.ts"));
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
    if (!(e instanceof M.GridShotsError) || e.code !== code) problems.push(`${what}：应当抛 ${code}，抛的是 ${e?.code ?? e?.message ?? e}`);
  }
};

// 零运行时依赖
ran++;
fs.readFileSync(modPath, "utf8")
  .split(/\r?\n/)
  .forEach((ln, i) => {
    if (/^\s*import\s+(?!type\b)/.test(ln)) problems.push(`gridShots.ts:${i + 1}  只准 import type（这个文件要能被 Node 直接 import 跑正反例）`);
  });

const CAST = ["林夏", "沈舟"];
const MAX = M.GRID_SHOTS_MAX;

// ── 发给模型的那一份 ──
{
  const zh = M.gridShotsBrief({ scene: "林夏来灯塔给沈舟送一封旧信", cast: CAST, place: "海边灯塔", lang: "zh" }).split("\n");
  eq("brief 第一行说语言（中文）", zh[0], "用中文写。");
  eq("brief 带卡名（顿号连）", zh[1], "出场人物：林夏、沈舟");
  eq("brief 带地点（场景卡名）", zh[2], "地点：海边灯塔");
  eq("brief 带这场戏原话", zh[3], "这场戏：林夏来灯塔给沈舟送一封旧信");
  const noPlace = M.gridShotsBrief({ scene: "x", cast: CAST, place: "", lang: "zh" }).split("\n");
  eq("没有场景卡就不写地点那一行", noPlace.length, 3);
  const en = M.gridShotsBrief({ scene: "x", cast: [], place: "", lang: "en" }).split("\n");
  ok(`英文那一份第一行没说用英文写：${en[0]}`, /英文/.test(en[0]));
  ok(`英文那一份没让 who 照抄名字：${en[0]}`, /who/.test(en[0]));
  ok(`没有卡名时没说「没有指定」：${en[1]}`, /没有指定/.test(en[1]));
  for (const k of ['"lead"', '"shots"', '"size"', '"picture"', '"action"', '"who"']) ok(`系统提示词里没有 ${k}（输出形状没说清）`, M.GRID_SHOTS_SYS.includes(k));
  ok("系统提示词没说镜头数的范围", M.GRID_SHOTS_SYS.includes(`${M.GRID_SHOTS_MIN}~${M.GRID_SHOTS_MAX}`));
  ok("系统提示词没交代「画面只写一个瞬间、动作写接下来发生什么」", /一个瞬间/.test(M.GRID_SHOTS_SYS) && /接着发生/.test(M.GRID_SHOTS_SYS));
  ok("系统提示词没说没有人的镜头 who 给空数组", /who 给空数组/.test(M.GRID_SHOTS_SYS));
}

// ── 好的回话 ──
const GOOD = JSON.stringify({
  lead: "清晨的海边灯塔，薄雾，暖金色的光",
  shots: [
    { size: "远景", picture: "林夏背着邮差包沿着海岸小路走向灯塔", action: "她加快脚步，海风吹起短发", who: ["林夏"] },
    { size: "中景", picture: "林夏站在灯塔门口抬手敲门", action: "门吱呀一声打开", who: ["林夏"] },
    { size: "近景", picture: "沈舟站在门里，看见林夏有些意外", action: "他慢慢露出微笑，侧身让她进来", who: ["沈舟", "林夏"] },
    { size: "特写", picture: "一封泛黄的旧信放在木桌上", action: "一只手把信推向前", who: [] },
    { size: "全景", picture: "两人站在灯塔顶层的窗边望向海面", action: "太阳从海平线上升起", who: ["林夏", "沈舟"] },
  ],
});
{
  const p = M.parseGridShots(GOOD, CAST, MAX);
  eq("五格都收下", p.shots.length, 5);
  eq("整体交代收下", p.lead, "清晨的海边灯塔，薄雾，暖金色的光");
  eq("好的回话没有 notes", p.notes, []);
  eq("第 3 格：景别 / 画面 / 动作 / 谁", p.shots[2], {
    size: "近景",
    picture: "沈舟站在门里，看见林夏有些意外",
    action: "他慢慢露出微笑，侧身让她进来",
    who: ["沈舟", "林夏"],
  });
  eq("空镜的 who 是空数组", p.shots[3].who, []);
  eq("整体交代补句号", M.gridLeadOf(p.lead, "zh"), "清晨的海边灯塔，薄雾，暖金色的光。");
}

// ── 包装与外壳 ──
eq("```json 围起来的", M.parseGridShots("```json\n" + GOOD + "\n```", CAST, MAX).shots.length, 5);
eq("前后带着一句话的", M.parseGridShots("好的，分镜如下：" + GOOD + " 希望有帮助。", CAST, MAX).shots.length, 5);
{
  const arr = M.parseGridShots(JSON.stringify([{ picture: "林夏看海" }, { size: "近景", picture: "沈舟点灯", who: ["沈舟"] }]), CAST, MAX);
  eq("顶层直接是数组：收镜头、交代为空", [arr.shots.length, arr.lead], [2, ""]);
  eq("景别 / 动作 / who 缺了照收", arr.shots[0], { size: "", picture: "林夏看海", action: "", who: [] });
}

// ── 坏的回话：整发不认 ──
throwsCode("一个字的 JSON 都没有", () => M.parseGridShots("可以拆成九个镜头。", CAST, MAX), "noJson");
throwsCode("JSON 坏了", () => M.parseGridShots('{"shots":[{"picture":"林夏进门",}', CAST, MAX), "badJson");
throwsCode("没有 shots 数组", () => M.parseGridShots('{"lead":"灯塔"}', CAST, MAX), "noShots");
throwsCode("画面全是空的", () => M.parseGridShots('{"shots":[{"picture":""},{"picture":"   "}]}', CAST, MAX), "noShots");
throwsCode(
  "镜头被写成一个对象里重复的键（JSON.parse 只留最后一个）",
  () => M.parseGridShots('{"shots":[{"size":"远景","picture":"林夏走来","size":"中景","picture":"沈舟开门"}]}', CAST, MAX),
  "dupKeys",
);

// ── 收的时候处理掉的事 ──
{
  const twelve = JSON.stringify({ shots: Array.from({ length: 12 }, (_, i) => ({ picture: `第${i + 1}个画面` })) });
  const p = M.parseGridShots(twelve, CAST, MAX);
  eq("多给的镜头截到上限", p.shots.length, MAX);
  eq("截掉了几个记下来", p.notes, [{ kind: "dropped", count: 12 - MAX }]);
}
{
  const p = M.parseGridShots('{"shots":[{"picture":"林夏进门"},{"picture":""},{"picture":"沈舟抬头"}]}', CAST, MAX);
  eq("空画面的镜头不收、记下来", [p.shots.length, p.notes], [2, [{ kind: "empty", count: 1 }]]);
}
{
  const p = M.parseGridShots('{"shots":[{"picture":"邮差与林夏在门口","who":["邮差","林夏","林夏"," 沈舟 "]}]}', CAST, MAX);
  eq("who 里的路人剔掉、重复的去掉、名字两头的空白去掉", p.shots[0].who, ["林夏", "沈舟"]);
  eq("路人记下来", p.notes, [{ kind: "strangers", names: ["邮差"] }]);
}
{
  const p = M.parseGridShots('{"shots":[{"picture":"门上挂着“营业中”的牌子，镜头2：林夏推门","action":"她念出「欢迎」两个字"}]}', CAST, MAX);
  eq("画面里的引号与「镜头N：」摘掉", p.shots[0].picture, "门上挂着营业中的牌子，林夏推门");
  eq("动作里的引号摘掉", p.shots[0].action, "她念出欢迎两个字");
}
{
  const p = M.parseGridShots('{"shots":[{"picture":"林夏走来","who":["林夏"]}]}', [], MAX);
  eq("没给卡名时 who 照收（不当路人）", [p.shots[0].who, p.notes], [["林夏"], []]);
}

// ── 组图带几张参考图：参考图 + 张数 ≤ 15，每个人最多两张 ──
eq("九格、两个人、一张场景卡 → 5 张（每人两张 + 场景一张）", M.groupRefsCap(9, 2, 1), 5);
eq("九格、四个人、一张场景卡 → 6 张（被 15 − 9 卡住）", M.groupRefsCap(9, 4, 1), 6);
eq("六格、四个人、一张场景卡 → 9 张", M.groupRefsCap(6, 4, 1), 9);
eq("十五格 → 一张参考图都带不了", M.groupRefsCap(15, 2, 0), 0);
ok("协议上限是 15（与服务端 config/tokens.GROUP_MAX_IMAGES 同一个数）", M.GROUP_TOTAL_MAX === 15);

// ── 写分镜的两条新规矩（2026-10-07 付费验证：画面描述点了画外的人就会被画进去；特写写成整个人的动作就画成半身）──
ok("系统提示词没说画外的人不写进画面", /不在 who 里的人名字不要出现在画面里/.test(M.GRID_SHOTS_SYS) && /望向画外/.test(M.GRID_SHOTS_SYS));
ok("系统提示词没说特写写清拍的是哪个局部", /特写的那一格，画面写清拍的是哪个局部/.test(M.GRID_SHOTS_SYS));

// ── 画面里点到名、who 里没有的人：收回话时补进 who ──
{
  const p = M.parseGridShots(
    JSON.stringify({ shots: [{ size: "中景", picture: "沈舟站在车厢门口，目光落在林夏身上", who: ["沈舟"] }, { size: "全景", picture: "火车进站", who: [] }] }),
    CAST,
    MAX,
  );
  eq("画面点到了林夏：补进 who（排在模型给的后面）", p.shots[0].who, ["沈舟", "林夏"]);
  eq("补了谁记下来", p.notes, [{ kind: "named", names: ["林夏"] }]);
  eq("空镜的画面没点名：照旧没有人", p.shots[1].who, []);
  eq(
    "空镜（who 给了空数组）的画面点了名：不补（多半是「林夏的房间」这种，补了就把人画进空镜）",
    M.parseGridShots('{"shots":[{"size":"全景","picture":"林夏的房间，窗外下着雨","who":[]}]}', CAST, MAX).shots[0].who,
    [],
  );
  eq("没给卡名时不补（没有名单可认）", M.parseGridShots('{"shots":[{"picture":"沈舟看着林夏","who":["沈舟"]}]}', [], MAX).shots[0].who, ["沈舟"]);
  eq("namedOutside：画面点到、上面没选的", M.namedOutside({ size: "", picture: "沈舟看着林夏", action: "", who: ["沈舟"] }, CAST), ["林夏"]);
  eq("namedOutside：都选上了就空", M.namedOutside({ size: "", picture: "沈舟看着林夏", action: "", who: ["沈舟", "林夏"] }, CAST), []);
}

// ── 分拣：哪几格进组图、哪几格单画 ──
{
  const s = (size, who) => ({ size, picture: "x", action: "", who });
  eq("没有人 = 空镜", M.panelKindOf(s("全景", [])), "empty");
  eq("特写", M.panelKindOf(s("特写", ["林夏"])), "close");
  eq("大特写也算特写", M.panelKindOf(s("大特写", ["林夏"])), "close");
  eq("英文 Close-up 也算特写", M.panelKindOf(s("Close-up", ["林夏"])), "close");
  eq("ECU 也算特写", M.panelKindOf(s("ECU", ["林夏"])), "close");
  eq("近景不是特写", M.panelKindOf(s("近景", ["林夏"])), "group");
  const plan = M.gridDrawPlan([s("远景", ["林夏"]), s("全景", []), s("中景", ["沈舟"]), s("特写", ["林夏"]), s("近景", ["林夏", "沈舟"])]);
  eq("普通格进组图（按原顺序）", plan.group, [0, 2, 4]);
  eq("特写先单画、空镜排最后（要拿画好的格子定画风）", plan.singles, [{ index: 3, kind: "close" }, { index: 1, kind: "empty" }]);
  const lone = M.gridDrawPlan([s("远景", ["林夏"]), s("全景", []), s("特写", ["沈舟"])]);
  eq("进组图的不到两格：不开组图", lone.group, []);
  eq("落单的那一格单画、空镜照旧排最后", lone.singles, [{ index: 0, kind: "single" }, { index: 2, kind: "close" }, { index: 1, kind: "empty" }]);
  const shots = [s("中景", ["林夏", "沈舟"]), s("全景", []), s("远景", ["林夏"]), s("全景", ["林夏", "沈舟"])];
  eq("定画风：画好的格子里景别最宽的", M.styleRefIndex(shots, [true, false, true, true], 1), 2);
  eq("定画风：最宽的那格没画好就退一档", M.styleRefIndex(shots, [true, false, false, true], 1), 3);
  eq("定画风：一样宽挑人少的", M.styleRefIndex([s("全景", ["林夏", "沈舟"]), s("全景", ["林夏"]), s("全景", [])], [true, true, false], 2), 1);
  eq("定画风：不拿自己", M.styleRefIndex([s("远景", []), s("中景", ["林夏"])], [true, true], 0), 1);
  eq("定画风：一格都没画好就不带", M.styleRefIndex(shots, [false, false, false, false], 1), -1);
}

// ── 点名那一句：九宫格标用途（labeledBindLine），对话正反打 / 特效同款照旧（groupBindLine） ──
{
  const refs = [
    { name: "林夏", type: "character", nums: [1, 2], kinds: ["face", "body"], idLine: "栗色齐肩短发、琥珀色眼睛" },
    { name: "沈舟", type: "character", nums: [3], kinds: ["body"], idLine: "沈舟" },
    { name: "海边灯塔", type: "scene", nums: [4], kinds: ["body"], idLine: "海边灯塔" },
    { name: "旧信", type: "prop", nums: [5], kinds: ["body"], idLine: "旧信" },
  ];
  eq(
    "老写法照旧（对话正反打 / 特效同款还在用）",
    M.groupBindLine(refs),
    "图1、图2 是林夏（栗色齐肩短发、琥珀色眼睛）；图3 是沈舟；图4 是场景「海边灯塔」（只用来定地点的样子，构图照分镜来）；图5 是「旧信」",
  );
  eq(
    "标用途：脸 / 服装和身形分开说、不写外貌",
    M.labeledBindLine(refs),
    "图1是林夏的脸，图2是林夏的服装和身形，图3是沈舟，图4是场景「海边灯塔」（只用来定地点的样子，构图照分镜来），图5是「旧信」",
  );
  eq("同一个人两张同类的图：标不出谁管什么，退回合着说", M.labeledBindLine([{ name: "林夏", type: "character", nums: [2, 3], kinds: ["body", "body"], idLine: "" }]), "图2、图3是林夏");
  eq("不知道是哪一类图：合着说", M.labeledBindLine([{ name: "林夏", type: "character", nums: [1, 2], kinds: ["", "face"], idLine: "" }]), "图1、图2是林夏");
  eq("画幅：竖屏", M.gridFraming("9:16"), "竖版9:16");
  eq("画幅：横屏", M.gridFraming("16:9"), "横版16:9");
}

// ── 组图提示词（新写法：压短、标用途、正面写画幅；空镜与特写不在这一发里）──
{
  const p = M.parseGridShots(GOOD, CAST, MAX);
  const bind = "图1是林夏的脸，图2是林夏的服装和身形，图3是沈舟";
  const groupShots = M.gridDrawPlan(p.shots).group.map((i) => p.shots[i]);
  const prompt = M.groupPrompt({ lead: p.lead + "。", shots: groupShots, bind, framing: M.gridFraming("9:16") });
  ok(`组图提示词没以点名那一句开头：${prompt.slice(0, 30)}`, prompt.startsWith(`${bind}。按顺序生成${groupShots.length}张视频静帧，一张一个镜头：`));
  const order = groupShots.map((s) => prompt.indexOf(s.picture));
  ok(`镜头没按顺序列出来：${show(order)}`, order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])));
  ok("只有一个人的格子没写「只有某某」", prompt.includes("林夏站在灯塔门口抬手敲门（只有林夏）"));
  ok("两个人都写在画面里了还重复写了一遍", prompt.includes("沈舟站在门里，看见林夏有些意外；"));
  ok("组图提示词丢了「每人在一张里只出现一次」（10-05 付费对比第 6 张多画了一个林夏）", prompt.includes("每人在一张里只出现一次"));
  ok("组图提示词丢了防双胞胎那半句", prompt.includes("不出现两个长相、着装一样的人"));
  ok("整体交代没进组图提示词（句末的句号要去掉再接）", prompt.includes("清晨的海边灯塔，薄雾，暖金色的光。每张竖版9:16、单个完整画面"));
  ok("组图提示词里还有「上下留出呼吸空间」（10-06 那张上下两格拼图猜是它给的空）", !prompt.includes("呼吸空间"));
  ok("组图提示词里还写着外貌（交给参考图了）", !prompt.includes("栗色"));
  const bare = M.groupPrompt({ lead: "", shots: p.shots.slice(0, 2), bind: "", framing: M.gridFraming("16:9") });
  ok(`没有参考图时还在点名：${bare.slice(0, 20)}`, bare.startsWith("按顺序生成2张视频静帧"));
  ok("横屏的画幅没写进去", bare.includes("每张横版16:9、单个完整画面"));
  // 10-06 那份 8 格分镜里的 6 个普通格（付费验证里组图那一发就是这么拼出来的）：官方建议 300 字以内
  const real = [
    ["远景", "雨夜旧车站站台，路灯下林夏撑伞站着，望向轨道方向", ["林夏"]],
    ["中景", "沈舟站在车厢门口，脚刚踏站台，目光落在林夏身上", ["沈舟"]],
    ["中景", "林夏和沈舟隔着几步距离面对面，互相望着彼此", ["林夏", "沈舟"]],
    ["近景", "沈舟伸手从怀里取出一封旧信，递向林夏面前", ["林夏", "沈舟"]],
    ["近景", "林夏抬起头，眼眶发红，嘴角却弯着笑看向沈舟", ["林夏", "沈舟"]],
    ["中景", "沈舟抬手把伞举到林夏头顶，伞面倾斜向她", ["林夏", "沈舟"]],
  ].map(([size, picture, who]) => ({ size, picture, action: "", who }));
  const len = [...M.groupPrompt({ lead: "雨夜旧车站站台，路灯昏黄，雨丝斜飘，氛围湿冷又带着期待", shots: real, bind, framing: M.gridFraming("9:16") })].length;
  ok(`10-06 那份分镜的 6 个普通格拼出来 ${len} 字，超过 300（官方建议的上限）`, len <= 300);
}

// ── 单画一格（组图之后的空镜 / 特写，与单格重画同一个函数）──
{
  const p = M.parseGridShots(GOOD, CAST, MAX);
  const framing = M.gridFraming("9:16");
  const empty = M.panelPrompt({ shot: p.shots[3], lead: p.lead, ask: "", bind: "", framing, styleRef: true });
  ok("空镜单画：没说图1 只用来定画风", empty.startsWith("图1只用来参考地点、光线、色调和画风，不要画出图1里的人。"));
  ok("空镜单画：没说画面里没有任何人", empty.includes("画面里没有任何人（没有人物、人影或剪影）"));
  const emptyBare = M.panelPrompt({ shot: p.shots[3], lead: "", ask: "", bind: "图1是场景「海边灯塔」（只用来定地点的样子，构图照分镜来）", framing, styleRef: false });
  ok("没有定画风的那一格就不提图1 只用来定画风", !emptyBare.includes("只用来参考地点、光线"));
  ok("场景卡的点名接在最前", emptyBare.startsWith("图1是场景「海边灯塔」"));
  const close = M.panelPrompt({ shot: { size: "特写", picture: "林夏的手指捏着旧信纸", action: "", who: ["林夏"] }, lead: "", ask: "", bind: "图1是林夏的脸，图2是林夏的服装和身形", framing, styleRef: false });
  ok("特写单画：没说只拍局部", close.includes("特写镜头，只拍局部，主体占满画面：林夏的手指捏着旧信纸（只有林夏）"));
  const normal = M.panelPrompt({ shot: p.shots[2], lead: p.lead, ask: " 沈舟只出现一次 ", bind: "图1是沈舟，图2是林夏", framing, styleRef: false });
  ok("普通格单画：没写清画面上下各是什么", normal.includes("画面上方是场景的背景，下方是地面"));
  ok("普通格单画：没写画面里只有谁", normal.includes("（画面里只有沈舟、林夏）"));
  ok("补一句要求没接上", normal.includes("要求：沈舟只出现一次。"));
  ok("普通格单画：丢了防双胞胎那半句", normal.includes("不出现两个长相、着装一样的人"));
  for (const [name, txt] of [["空镜", empty], ["特写", close], ["普通格", normal]]) {
    ok(`${name}单画还带着「上下留出呼吸空间」`, !txt.includes("呼吸空间"));
    ok(`${name}单画还在用否定句「不要分格」（新写法正面写「单个完整画面 / 同一个连续的场景」）`, !txt.includes("不要分格"));
  }
  eq("特效同款还在用的那一句照旧", M.panelRefLine("图1 是沈舟"), "。参考图：图1 是沈舟；人物的长相、发型与服装与参考图一致");
}

// ── 画完看一遍（只问几格 / 几个人 / 有没有两个一样的人）──
{
  ok("核对提示词没给能直接解析的 JSON 样子", M.PANEL_CHECK_SYS.includes('{"panels": 1, "people": 0, "duplicate": false}'));
  ok("核对提示词还在问景别（付费验证里只会误报）", !/景别/.test(M.PANEL_CHECK_SYS));
  eq("正常回话", M.parsePanelCheck('{"panels": 1, "people": 2, "duplicate": false}'), { panels: 1, people: 2, duplicate: false });
  eq("前后带着话、值加了引号也认", M.parsePanelCheck('好的：{"panels": "2", "people": "3", "duplicate": "true"}'), { panels: 2, people: 3, duplicate: true });
  eq("没有 duplicate 就当没有", M.parsePanelCheck('{"panels":1,"people":0}'), { panels: 1, people: 0, duplicate: false });
  eq("抠不出人数就当没核对上", M.parsePanelCheck('{"panels": 1, "note": "两个人"}'), null);
  eq("空回话", M.parsePanelCheck(""), null);
  const two = { size: "中景", picture: "x", action: "", who: ["林夏", "沈舟"] };
  eq("人数对、单张、没有重复：没问题", M.panelIssues({ panels: 1, people: 2, duplicate: false }, two), []);
  eq("多画了一个、同一个人两次", M.panelIssues({ panels: 1, people: 3, duplicate: true }, two), [
    { kind: "people", got: 3, want: 2 },
    { kind: "duplicate" },
  ]);
  eq("空镜里有人", M.panelIssues({ panels: 1, people: 2, duplicate: false }, { size: "全景", picture: "x", action: "", who: [] }), [{ kind: "people", got: 2, want: 0 }]);
  eq("拼图", M.panelIssues({ panels: 2, people: 2, duplicate: false }, two), [{ kind: "panels", got: 2 }]);
}

// ── 一格一段：视频提示词 ──
{
  const p = M.parseGridShots(GOOD, CAST, MAX);
  const plot = M.panelPlot(p.shots[2], p.lead, "zh");
  eq("一格一段的视频提示词：交代 + 景别 + 画面 + 动作", plot, "清晨的海边灯塔，薄雾，暖金色的光。近景。沈舟站在门里，看见林夏有些意外。他慢慢露出微笑，侧身让她进来。");
  ok("一格一段被分镜表读成了多镜头", !S.isMultiShot(plot));
  ok("一格一段里读出了台词", !new RegExp(S.LINE_QUOTE.source).test(plot));
  eq(
    "英文的一格一段用空格连",
    M.panelPlot({ size: "Close-up", picture: "Shen opens the door", action: "He smiles", who: ["沈舟"] }, "Dawn at the lighthouse", "en"),
    "Dawn at the lighthouse. Close-up. Shen opens the door. He smiles.",
  );
  eq("动作空着就只到画面", M.panelPlot({ size: "", picture: "林夏看海", action: "", who: ["林夏"] }, "", "zh"), "林夏看海。");
}

// ── 这一格的画面认哪一版分镜 ──
{
  const a = { size: "近景", picture: "沈舟开门", action: "他笑了", who: ["沈舟"] };
  ok("动作改了不算画面过期", M.shotKey(a) === M.shotKey({ ...a, action: "他转身" }));
  ok("画面改了要算过期", M.shotKey(a) !== M.shotKey({ ...a, picture: "沈舟关门" }));
  ok("景别改了要算过期", M.shotKey(a) !== M.shotKey({ ...a, size: "远景" }));
  ok("画面里的人改了要算过期", M.shotKey(a) !== M.shotKey({ ...a, who: ["沈舟", "林夏"] }));
}

// ── 分镜里点到、却没选上的人（出一组 / 单格重画 / 落段之前拦下；2026-10-06 付费验证：App 重开后名单是空的，重画画出陌生人）──
{
  const a = { size: "中景", picture: "林夏和沈舟对望", action: "", who: ["林夏", "沈舟"] };
  const b = { size: "全景", picture: "火车进站", action: "", who: [] };
  const c = { size: "近景", picture: "沈舟递信给林夏", action: "", who: ["沈舟", "林夏"] };
  eq("人都选上了：一个都不缺", M.castGaps([a, b, c], CAST), []);
  eq("名单是空的（App 重开后）：按出现先后、去重", M.castGaps([a, b, c], []), ["林夏", "沈舟"]);
  eq("第 1 步取下了沈舟：只缺沈舟", M.castGaps([a, c], ["林夏"]), ["沈舟"]);
  eq("空镜那一格不缺人", M.castGaps([b], []), []);
  eq("没有格子就不缺人", M.castGaps([], []), []);
  eq("名单里多出来的人不算缺", M.castGaps([b, c], ["沈舟", "林夏", "路人"]), []);
}

if (problems.length) {
  console.error(`\n❌ 九宫格分镜检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("\n   改法：规则只改 src/data/gridShots.ts；改完在这里补一句正例、一句反例。\n");
  process.exit(1);
}
console.log(`✓ 九宫格分镜检查通过（${ran} 条：问法 / 收法 / 坏回话 / 路人与引号 / 参考图预算 / 写分镜规矩 / 点名补进 who / 分拣 / 标用途 / 组图提示词 / 单画一格 / 看一遍 / 一格一段 / 画面过期 / 缺人）`);
