#!/usr/bin/env node
// 构建门禁：**对局收尾**（2026-11-24 晚；任务：打完一局问一句"这一局的片子要不要留下"）。
//
// ★★ 为什么单开一道：这一块的错全是"零报错"的账本错 ——
//   · 占位片也摆了保存键：点下去必然失败，而玩家看到的是"保存坏了"；
//   · 结束屏一出现就问（甚至在结算屏上问）：这一局还要接着打，问错了时机；
//   · 拿上一局的记录顶替这一局：屏幕上摆着一局看起来正常的片子，玩家不知道那是别人的局
//     （判据在 localHistory.localPickOf，这里钉住"整条链上都只有这一处"）；
//   · 发布带错了那一段 / 带过去一份空合成稿：发布页上编号、封面、段数全对不上；
//   · 想说"发到 B 站"却摆一颗按下去没反应的键（App 根本没有那个能力）。
//   这些在真机上只表现为"数字看着怪"，没有一条会抛异常。
//
// ★ 本文件**不重写一条规则**：import 的就是线上那份纯模块（`studio/game/wrapup.ts`），
//   拿正反例跑；界面接线用源码断言钉住（那几处要 React，Node 跑不起来）。
// ★ 平台发布那条现状（没有授权、没有上传接口）落在 docs/workshop-game-design.md §七，
//   这里另有一条断言钉住"仓里没有任何视频平台发布接口" —— 哪天真接上了，那条会红，
//   提醒把那一段文档和这一屏的措辞一起改掉。
//
// 用法：node scripts/check-game-wrapup.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(url.pathToFileURL(path.join(root, rel)).href);
const W = await load("src/studio/game/wrapup.ts");
/** 界面接线断言要读源码 */
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const problems = [];
let positive = 0;
const fail = (msg) => problems.push(msg);
const eq = (label, got, want) => {
  positive += 1;
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) fail(`${label}\n      want ${w}\n      got  ${g}`);
};
const ok = (label, cond) => {
  positive += 1;
  if (!cond) fail(`${label}：期待成立，实际是假`);
};

// ── 造一份"三回合"的战绩（形状照 docs/api-contract.md「历史回合」的样例）─────────────
const entryOf = (userId, extra = {}) => ({
  entryId: `e-${userId}`,
  userId,
  name: userId === "u1" ? "我" : "他",
  prompt: `${userId} 这一期的提示词`,
  cardNames: ["风格卡"],
  videoUrl: `https://cdn.example/${userId}.mp4`,
  posterUrl: `https://cdn.example/${userId}.jpg`,
  placeholder: false,
  modelTier: "draft",
  likes: 0,
  votes: 0,
  ...extra,
});
const rowOf = (userId, extra = {}) => ({
  userId,
  name: userId === "u1" ? "我" : "他",
  likes: 0,
  votes: 0,
  likeRank: 1,
  voteRank: 1,
  composite: 2,
  damage: 5,
  hp: 95,
  eliminated: false,
  ...extra,
});
/** 一回合：我（u1）交了什么 + 结算榜（缺省 u2 第一 / 我第二；`first` 为真时我第一） */
const roundOf = (round, mine, opts = {}) => ({
  round,
  settled: true,
  entries: [entryOf("u1", mine), entryOf("u2", { likes: 3, votes: 2 })],
  settlement: { ranking: opts.first ? [rowOf("u1"), rowOf("u2")] : [rowOf("u2"), rowOf("u1")] },
});
const historyOf = (rounds) => ({
  room: { code: "AB3K7Q", state: "over", winners: ["u2"], finishedAt: "2026-11-24T08:00:00.000Z" },
  rounds,
  summary: { roundsPlayed: rounds.length, perPlayer: [] },
});

// ── ① 有真片：每回合一条，首选"名次最好"的那一段 ──────────────────────────────
const three = historyOf([
  roundOf(1, { videoUrl: "https://cdn.example/r1.mp4", likes: 1, votes: 0 }),
  roundOf(2, { videoUrl: "https://cdn.example/r2.mp4" }, { first: true }),
  roundOf(3, { videoUrl: "https://cdn.example/r3.mp4", likes: 5, votes: 4 }),
]);
const w3 = W.wrapupOf(three, "u1");
eq("三回合都交了真片 → 三段都能带走", w3.clips.length, 3);
eq("我这一局交了几期", w3.myRounds, 3);
eq("段落地址原样带出来", w3.clips.map((c) => c.url), [
  "https://cdn.example/r1.mp4",
  "https://cdn.example/r2.mp4",
  "https://cdn.example/r3.mp4",
]);
eq("回合号按服务端给的顺序", w3.clips.map((c) => c.round), [1, 2, 3]);
eq("名次从结算榜的位置来（第 1 回合我第 2 名）", w3.clips[0].rank, 2);
eq("「最好的那一段」= 名次最靠前的那一期（第 2 回合拿过第一）", W.bestClipOf(w3.clips)?.round, 2);
eq("首选那一段还带着提示词（发布页预填正文）", w3.clips[1].prompt, "u1 这一期的提示词");
eq("首选那一段带着封面（发布页预填封面）", w3.clips[1].posterUrl, "https://cdn.example/u1.jpg");

// ── ② 占位片：不进 clips，只记回合号 ──────────────────────────────────────────
const withPlaceholder = historyOf([
  roundOf(1, { videoUrl: "https://cdn.example/r1.mp4" }),
  roundOf(2, { videoUrl: undefined, placeholder: true }),
  roundOf(3, { videoUrl: "https://cdn.example/r3.mp4" }),
]);
const wp = W.wrapupOf(withPlaceholder, "u1");
eq("占位片不算成片（不给保存入口的那一条判据）", wp.clips.map((c) => c.round), [1, 3]);
eq("占位片单独记下回合号（界面说「这一段是占位片，没有成片」）", wp.placeholderRounds, [2]);
eq("交过几期含占位片", wp.myRounds, 3);
eq("占位片不会被挑成「最好的那一段」", W.bestClipOf(wp.clips)?.round, 1);

const placeholderOnly = historyOf([roundOf(1, { videoUrl: undefined, placeholder: true })]);
const wOnly = W.wrapupOf(placeholderOnly, "u1");
eq("只有占位片的一局：一段能带走的都没有", wOnly.clips.length, 0);
eq("只有占位片的一局：首选为空（发布键也不该亮）", wOnly.best, null);
eq("只有占位片的一局：占位回合号还在", wOnly.placeholderRounds, [1]);

const noEntry = historyOf([{ round: 1, settled: true, entries: [entryOf("u2")], settlement: { ranking: [rowOf("u2")] } }]);
eq("这一回合我没交片 → 不算我的片子", W.wrapupOf(noEntry, "u1").myRounds, 0);
eq("拿不到「我是谁」时一律空（不猜别人的片子）", W.wrapupOf(three, null).clips.length, 0);
eq("没有记录时一律空", W.wrapupOf(null, "u1").clips.length, 0);

// ── ③ 首选那一段的并列规则：名次 → 热度 → 更早的回合 ────────────────────────────
const clip = (round, extra = {}) => ({
  round,
  url: `https://cdn.example/r${round}.mp4`,
  posterUrl: null,
  rank: 1,
  likes: 0,
  votes: 0,
  prompt: "",
  modelTier: null,
  ...extra,
});
eq("名次并列看热度（点赞 + 票多的赢）", W.bestClipOf([clip(1), clip(2, { likes: 4 })])?.round, 2);
eq("热度也并列取**更早**的那一回合", W.bestClipOf([clip(3), clip(2)])?.round, 2);
eq("没名次的一期排在有名次的后面（不当成第 0 名）", W.bestClipOf([clip(1, { rank: null, likes: 9 }), clip(4, { rank: 3 })])?.round, 4);
eq("一段都没有时首选为 null", W.bestClipOf([]), null);

// ── ④ 这一局的记录该拿哪一份（联机按房号 / 本机问"存下来了没有"）──────────────────
const recordOf = (code, rounds = [roundOf(1, { videoUrl: "https://cdn.example/r1.mp4" })]) => ({
  v: 1,
  owner: "u-me",
  savedAt: 1000,
  meId: "u1",
  history: { ...historyOf(rounds), room: { ...historyOf(rounds).room, code } },
});
const roomRecord = recordOf("AB3K7Q");
const localRecord = recordOf("");
const pickOk = W.wrapupPickOf({ roomCode: "AB3K7Q", localOutcome: null, latest: { kind: "none" }, roomRecord });
eq("联机局：按房号找到本机缓存就用它", pickOk.kind === "ok" ? pickOk.source : pickOk.kind, "online");
eq("联机局：meId 从记录里来（座位 id 与账号 id 不是一个世界）", pickOk.kind === "ok" ? pickOk.meId : null, "u1");
eq(
  "联机局：本机还没留到那一份时如实说（不是「这一局没有片子」）",
  W.wrapupPickOf({ roomCode: "AB3K7Q", localOutcome: null, latest: { kind: "none" }, roomRecord: null }),
  { kind: "denied", denial: "room-missing" },
);
eq(
  "本机局：这一局存下来了就用它",
  W.wrapupPickOf({ roomCode: null, localOutcome: { kind: "saved", at: 1000 }, latest: { kind: "ok", record: localRecord }, roomRecord: null }).kind,
  "ok",
);
eq(
  "本机局：写入失败时绝不许拿上一局顶替（判据在 localPickOf）",
  W.wrapupPickOf({ roomCode: null, localOutcome: { kind: "failed" }, latest: { kind: "ok", record: localRecord }, roomRecord: null }),
  { kind: "denied", denial: "local-missing" },
);
eq(
  "本机局：savedAt 对不上（存储被清 / 换了账号）也说没存下来",
  W.wrapupPickOf({ roomCode: null, localOutcome: { kind: "saved", at: 999 }, latest: { kind: "ok", record: localRecord }, roomRecord: null }),
  { kind: "denied", denial: "local-missing" },
);
eq(
  "本机局：存储里一局都没有时也是 denied",
  W.wrapupPickOf({ roomCode: null, localOutcome: null, latest: { kind: "none" }, roomRecord: null }),
  { kind: "denied", denial: "local-missing" },
);
eq(
  "本机局：读回来是坏数据时也 denied（不摆别人的局）",
  W.wrapupPickOf({ roomCode: null, localOutcome: { kind: "saved", at: 1000 }, latest: { kind: "broken" }, roomRecord: null }),
  { kind: "denied", denial: "local-missing" },
);
eq("房号两端空白剥掉再比", W.wrapupPickOf({ roomCode: "  AB3K7Q  ", localOutcome: null, latest: { kind: "none" }, roomRecord }).kind, "ok");

// ── ⑤ 落盘目录 / 文件名的那个 id ──────────────────────────────────────────────
eq("联机局：目录 id 用房号", W.clipIdOf({ roomCode: "AB3K7Q", finishedAt: "2026-11-24T08:00:00.000Z", savedAt: 1 }), "game-AB3K7Q");
eq(
  "本机局：目录 id 用结束时刻（同一时刻 = 同一个 id，队列才认得出是同一批）",
  W.clipIdOf({ roomCode: null, finishedAt: "2026-11-24T08:00:00.000Z", savedAt: 1 }),
  `game-local-${Date.parse("2026-11-24T08:00:00.000Z")}`,
);
eq(
  "本机局：没有结束时刻时退回记录的 savedAt（不给 NaN）",
  W.clipIdOf({ roomCode: null, finishedAt: undefined, savedAt: 4242 }),
  "game-local-4242",
);
ok(
  "目录 id 是纯 ASCII（SharePlugin 的 MIME 判定对文件名有硬正则）",
  [W.clipIdOf({ roomCode: "AB3K7Q", finishedAt: null, savedAt: 1 }), W.clipIdOf({ roomCode: null, finishedAt: null, savedAt: 7 })].every((one) =>
    /^[A-Za-z0-9_-]+$/.test(one),
  ),
);

// ── ⑥ 发布页预填：一份"只有这一段"的合成稿 ────────────────────────────────────
const draft = W.wrapupDraftOf(w3.clips[1], { title: "工坊对局 · 第 2 回合", category: "剧情", durationSec: 7.6 });
eq("合成稿只有一段（发的是这一局最好的那一段，不是 8 回合合集）", draft.segments.length, 1);
eq("这一段带着原成片地址", draft.segments[0].videoUrl, "https://cdn.example/r2.mp4");
eq("标题进两处（作品标题 / 这一段的名字）", [draft.title, draft.segments[0].title], ["工坊对局 · 第 2 回合", "工坊对局 · 第 2 回合"]);
eq("封面用这一期的封面", draft.cover, "https://cdn.example/u1.jpg");
eq(
  "首尾帧都用这一期的封面（发布页没有帧可挑时那一格不是空的）",
  [draft.segments[0].firstFrame, draft.segments[0].lastFrame],
  ["https://cdn.example/u1.jpg", "https://cdn.example/u1.jpg"],
);
eq("时长四舍五入（量出来的 7.6 秒）", draft.segments[0].durationSec, 8);
eq("量不出时长时写 0 而不是 NaN", W.wrapupDraftOf(w3.clips[1], { title: "t", category: "剧情", durationSec: Number.NaN }).segments[0].durationSec, 0);
eq("不写 videoTier（语义名 ≠ 档位表 id，写错会让回看的档位标注指错一行）", draft.segments[0].videoTier, undefined);
const noPoster = W.wrapupDraftOf({ ...w3.clips[1], posterUrl: null }, { title: "t", category: "剧情", durationSec: 5 });
eq("这一期没记封面时封面是空串（不是 undefined）", [noPoster.cover, noPoster.segments[0].firstFrame], ["", ""]);

// ── ⑦ 保存那条链路：一个规则都不许有第二份实现 ──────────────────────────────────
const dlSrc = read("src/data/videoDownload.ts");
const sheetSrc = read("src/studio/game/ui/WrapupSheet.tsx");
const panelSrc = read("src/studio/game/ui/WrapupPanel.tsx");
const resultSrc = read("src/studio/game/ui/RoundResultPanel.tsx");
const storeSrc = read("src/studio/game/store.ts");
ok("保存到本地仍然只有那一个模块（对局收尾没有另写一份下载）", dlSrc.includes("export function planClipDownload(") && sheetSrc.includes("planClipDownload("));
ok("不能存 / 存哪几个 / 叫什么名字只在 data/videoDownload（对局面板里不拼文件名）", !sheetSrc.includes("AIGC-") && !panelSrc.includes("AIGC-"));
ok("存不存得了只问 downloadSupport（浏览器里那句「只能在 App 里用」）", /export function planClipDownload[\s\S]{0,400}downloadSupport\(\)/.test(dlSrc));
ok("AIGC 标识闸复用同一处常量（两档口径不各写一份）", /planClipDownload[\s\S]{0,900}AIGC_MARK_POLICY/.test(dlSrc) && /export const AIGC_MARK_POLICY/.test(dlSrc));
ok("文件名拼法只有一处（两处调用同一个 composeFileName）", /function composeFileName\(/.test(dlSrc) && (dlSrc.match(/composeFileName\(\{/g) ?? []).length === 2);
ok("文件名的日期那一格也只有一处（ymdOf）", (dlSrc.match(/ymdOf\(/g) ?? []).length === 3);
ok("一局多段 = 逐段存（下载队列本来就支持多目标）", dlSrc.includes('kind: targets.length <= 1 ? "single" : "linear"'));
ok("文件名里的序号带 r 前缀（第几回合 ≠ 第几段）", dlSrc.includes('`r${String(n).padStart(2, "0")}`'));
ok("成功要说存到哪：路径的唯一来源是 downloadsPathOf", dlSrc.includes("export function downloadsPathOf(") && sheetSrc.includes("downloadsPathOf(clipId)"));
ok("每一行的状态话只有一处实现（rowStatusText）", dlSrc.includes("export function rowStatusText(") && sheetSrc.includes("rowStatusText(row, "));
ok("作品详情那张保存面板也读同一份（不是两份状态话）", read("src/components/DownloadSheet.tsx").includes("rowStatusText(row, "));
ok("失败要说原因：行上的 err / 整批的 outcome 都摆出来了", sheetSrc.includes("row.err") && sheetSrc.includes("dl.outcome"));
ok("运行中要看得见进度（不许点了没反应）", sheetSrc.includes("正在保存") && sheetSrc.includes("停止"));
ok("面板打开时 HEAD 问一次总量（与详情页那张同一套做法）", sheetSrc.includes("probeSizes(targets)"));
ok("「开始保存」被拒也要说话（重入闸 / 空批次不静默）", sheetSrc.includes("setErr(r.blocked)"));

// ── ⑧ 三颗键的接线 ────────────────────────────────────────────────────────────
ok("三颗键的字面就是任务要的那三个", ["⬇️ 保存到本地", "🚀 发布", "先不存"].every((one) => panelSrc.includes(one)));
ok("结束才出现：两个 over 分支各挂一块", (resultSrc.match(/<WrapupPanel \/>/g) ?? []).length === 2);
const onlineRoundEnd = resultSrc.slice(resultSrc.indexOf("📊 第 {state.round} 回合结算（联机）"), resultSrc.indexOf("── 对局结束：谁赢了 ──"));
ok("联机结算屏那一支不摆收尾（这一局还要接着打）", onlineRoundEnd.length > 0 && !onlineRoundEnd.includes("<WrapupPanel />"));
const localRoundEnd = resultSrc.slice(resultSrc.indexOf("📊 第 {report.summary.round} 回合结算"));
ok("本机结算屏那一支不摆收尾", localRoundEnd.length > 0 && !localRoundEnd.includes("<WrapupPanel />"));
ok("占位片不摆保存键（只在有真片时才摆那三颗）", panelSrc.includes("const canSave = view.wrapup.clips.length > 0") && /canSave \? \(/.test(panelSrc));
ok("占位片那一句就是任务要的原话", panelSrc.includes("这一段是占位片，没有成片"));
ok("「先不存」真的关掉（答过的局认在 seed 上，不留二次弹）", panelSrc.includes("answeredSeed = seed;"));
ok("新的一局自然重新问（seed 变了就对不上）", panelSrc.includes("answeredSeed === seed") && panelSrc.includes("const seed = useGame((s) => s.seed);"));
ok("收尾不往 game store 里加一格（那一条漏归位就会「下一局不问」）", !storeSrc.includes("wrapupClosed"));
ok("关掉之后这一块一个像素都不再渲染", panelSrc.includes("if (answered) return null;"));
ok("发布那一下也算答过（从发布页回来不再问同一件事）", /closeWrapup\(\);\s*\n\s*navigate\("\/publish"\)/.test(panelSrc));
ok("片子来源：联机读本机留的那一份、本机读本机战绩（都经 wrapupPickOf）", panelSrc.includes("readLocalGameOfRoom(") && panelSrc.includes("readLatestLocalGame(") && panelSrc.includes("wrapupPickOf("));
ok("「这一份是不是这一局」不在面板里另判一次（localStorage 一个字节都不直接读）", !/localStorage\s*\./.test(panelSrc) && !panelSrc.includes("JSON.parse"));
ok("联机那一份是异步落的：存好之后跟着重读", panelSrc.includes("subscribeHistoryCache(") && panelSrc.includes("setTick"));
ok("联机那份还没读到给一条重试的路", panelSrc.includes("captureOnlineHistory(roomCode") && panelSrc.includes("再试一次"));
ok("名次 / 点赞 / 票不在面板里重算（全从 wrapupOf 来）", !panelSrc.includes("settlement.ranking") && !panelSrc.includes("perPlayer"));
ok("发布走现有发布流程：写合成稿 + 跳 /publish", panelSrc.includes("useStudio.setState({") && panelSrc.includes("wrapupDraftOf(clip") && panelSrc.includes('navigate("/publish")'));
ok("写合成稿时把上一份发布痕迹清掉（发布页的守卫据此判「这是新的一份」）", panelSrc.includes("publishedWorkId: null"));
ok("量时长失败不拦发布（那一格只是锦上添花）", /probeDuration\([\s\S]{0,200}catch/.test(panelSrc));
ok("面板与合成稿之间只有那一处翻译（wrapup.wrapupDraftOf）", !panelSrc.includes("segments: [") && panelSrc.includes("wrapupDraftOf"));

// ── ⑨ 平台发布：**现状是没有**，所以不摆假键、把缺口写在文档里 ───────────────────
// ★ 只认**视频平台**的发布接口（微信「开放平台」是分享插件的登录/分享资格，与发布成片无关）
const platformHits = fs
  .readdirSync(path.join(root, "src"), { recursive: true })
  .filter((f) => typeof f === "string" && /\.(ts|tsx)$/.test(f))
  .filter((f) => /bilibili|douyin|open\.douyin|developer\.toutiao|抖音开放平台|B 站开放平台/i.test(read(path.join("src", f))));
eq("仓里没有任何视频平台的发布接口（App 侧直连平台这件事今天是零）", platformHits, []);
ok("那一格说清 App 做不到什么（不摆一颗按下去没反应的键）", sheetSrc.includes("没有直连平台的发布能力") && sheetSrc.includes("不摆一颗发不出去的键"));
ok("给的是真能走的路：先存到本地，再去平台 App / 浏览器上传", sheetSrc.includes("平台 App 或浏览器里上传") && sheetSrc.includes('setMode("save")'));
const designDoc = read("docs/workshop-game-design.md");
ok("缺口写进了设计文档（docs/workshop-game-design.md §7.4 现状与缺口）", designDoc.includes("B 站") && designDoc.includes("现状与缺口") && designDoc.includes("直连平台发布"));

// ── 汇总 ─────────────────────────────────────────────────────────────────────
for (const p of problems) console.error(`❌ ${p}`);
if (problems.length) {
  console.error(`\n❌ 对局收尾检查没过：${problems.length} 处（正例 ${positive} 条）\n`);
  process.exit(1);
}
console.log(`✓ 对局收尾检查通过：${positive} 条（片子来源 / 首选那一段 / 占位片 / 关闭状态 / 保存链路 / 发布预填 / 平台现状）`);
