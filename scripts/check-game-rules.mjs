#!/usr/bin/env node
// 构建门禁：工坊对局规则引擎（src/studio/game/rules.ts）的正反例实跑（G2 第一块）。
//
// ★★ 为什么要有它：规则层是**纯函数、零 UI**，它错的方式全是「零报错」的 ——
//     · 类型上限 / 9 格算错 ⇒ 玩家能买第 5 个角色、或装备一件道具后凭空多出一格（4+1+4=9 的算术被绕开）；
//     · 替换不是原子的 ⇒ 旧卡没了、新卡没装进去，而商店那边已经扣了钱（玩家只能干看着）；
//     · 利息按发完钱的金币算 ⇒ 每回合白送 1~2 金，整局节奏悄悄变快（没人会在界面上发现）；
//     · 第 5 回合就解锁 15 金的 L3 ⇒ 3 连胜门槛失守，§2.3b 的成长线作废；
//     · 扣血没按存活人数缩放 ⇒ 3 人局还是 -20，一回合直接打掉最后两人；
//     · 名次里少一个人 ⇒ 后面的人全体错位扣血，而游戏不会报错；
//     · 事件池不记已抽过 ⇒ 连着三次「模型军备」（§2.3b 明文要避免的那种尴尬）。
//    这些规则在界面上看不出来、在 png / 动画上也看不出来，只能在这里拿正反例跑。
// ★ 一条规则都不在这里重写：直接 import src/studio/game/rules.ts（Node 只剥类型，所以它零运行时依赖）。
// ★ 反例都写了「错的时候会怎样」：见每个待拒用例上面的注释。
// ★ 仓内门禁纪律（check-hook-order 那条）：写完先造真违规试红。上线前试过四处，各自变红：
//   ① 利息改成按发钱后的金币算；② 装备的道具不计入 9 格；③ 替换不检查带装备的角色；④ L3 去掉 3 连胜门槛。
//   （做法：复制一份改坏，用 --module= 指向它跑；四处都当场红，红在对应用例上。）
//
// 用法：node scripts/check-game-rules.mjs [--module=<另一份 rules.ts 的路径，造违规试红用>]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const modPath = path.resolve(modArg ?? path.join(root, "src/studio/game/rules.ts"));
const R = await import(url.pathToFileURL(modPath).href);

const problems = [];
let positive = 0;
let negative = 0;
const show = (v) => JSON.stringify(v);
const fail = (msg) => problems.push(msg);
const eq = (label, got, want) => {
  positive += 1;
  if (show(got) !== show(want)) fail(`${label}\n      want ${show(want)}\n      got  ${show(got)}`);
};
const ok = (label, cond) => {
  positive += 1;
  if (!cond) fail(`${label}：期待成立，实际是假`);
};
/** 本该成功的调用；失败就直接抛出（后面的用例没有状态可接着跑，别让它变成一串假失败）。 */
const must = (label, res) => {
  positive += 1;
  if (!res || !res.ok) throw new Error(`${label}：本该成功，却回了 ${res?.reason ?? "undefined"}`);
  return res;
};
/** 反例：期待被拒，并且拒绝原因要说对（原因错 = 界面会说错话）。 */
const rejects = (label, res, reason) => {
  negative += 1;
  if (!res || res.ok) {
    fail(`${label}：本该被拒（${reason}），却成功了 —— 这类规则错都是零报错的`);
    return;
  }
  if (res.reason !== reason) fail(`${label}：拒绝原因不对，want ${reason}，got ${res.reason}`);
};
const unchanged = (label, actual, before) => {
  positive += 1;
  if (show(actual) !== show(before)) fail(`${label}：失败时不该改任何东西（入参 / 状态被改动了）`);
};
const throws = (label, fn) => {
  negative += 1;
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) fail(`${label}：本该抛错（程序员的错要响），却正常返回了`);
};

const IDS = ["p1", "p2", "p3", "p4"];
const card = (id, type, quality = 1) => ({ id, type, quality, name: id.toUpperCase() });
const find = (state, id) => state.players.find((p) => p.id === id);
const withPlayer = (state, id, patch) => ({
  ...state,
  players: state.players.map((p) => (p.id === id ? { ...p, ...patch } : p)),
});
const withBag = (state, id, bag) => withPlayer(state, id, { bag });

/** 新开一局并选完风格、开第一回合商店（返回同一个 rng，后续刷新 / 结算都接着用，保证确定性）。 */
function newMatch(seed = 20261122) {
  const rng = R.createRng(seed);
  let state = R.createGame(IDS, rng);
  for (const id of IDS) {
    const player = find(state, id);
    state = must(`选风格卡 ${id}`, R.pickStyleCard(state, id, player.styleChoices[0])).state;
  }
  state = must("开第一回合", R.beginRound(state, rng)).state;
  return { state, rng };
}

/** 独立玩家（拿 createGame 产出的默认值当夹具，不手抄一份形状 —— 默认值改了这里跟着走）。 */
const basePlayer = () => R.createGame(["p1", "p2", "p3"], R.createRng(99)).players[0];
const withCards = (cards, extra = {}) => ({ ...basePlayer(), bag: cards, ...extra });

/**
 * 全员交片的夹具（G3）：展映要求"全员都有片子"（rules.enterScreening 的闸）。
 * 每人拿自己背包里的第一张卡（没卡就是空镜），提示词用一句英文夹具 —— 规则不认语言。
 */
function submitAll(state, prompt = "fixture shot") {
  let next = state;
  for (const id of next.players.filter((p) => !p.eliminated).map((p) => p.id)) {
    next = must(`交片 ${id}`, R.submitRoundEntry(next, id, { prompt })).state;
  }
  return next;
}

// ────────────────────────────── 0. 形状：零运行时依赖 / 常量 / 卡池 / 事件池 ──────────────────────────────

const source = fs.readFileSync(modPath, "utf8");
{
  // 这个文件要能被 Node 直接 import（check 脚本 import 的就是线上那一份），所以不许有运行时 import。
  for (const [i, line] of source.split(/\r?\n/).entries()) {
    if (/^\s*import\s+(?!type\b)/.test(line)) fail(`rules.ts:${i + 1}  只准 import type（Node 直接 import 的前提）`);
    if (/^\s*(export\s+)?(const\s+)?enum\s|^\s*(export\s+)?namespace\s/.test(line)) {
      fail(`rules.ts:${i + 1}  不许用 enum / namespace（Node 只剥类型，跑不了它们）`);
    }
    // 随机数必须走注入的 Rng：同一 seed 复盘一局 / 写确定性用例都靠它（注释里提到不算，认调用形状）。
    if (/Math\s*\.\s*random\s*\(/.test(line)) fail(`rules.ts:${i + 1}  不许调全局随机数：随机源只能从参数注入`);
  }
  const imports = [...source.matchAll(/^\s*import[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  eq("rules.ts 的 import 只有 ./types（零依赖）", imports, ["./types"]);

  // ★ G4 施工单 §3：9 格与"按种类计数"整组撤了，上限落在桌面卡位与"每角色 3 张道具"上。
  eq("背包不再有 9 格（撤掉的老规则不许长回来）", "bagUsage" in R && !("BAG_SIZE" in R), true);
  eq("不再有按种类的上限表", "TYPE_CAPS" in R, false);
  eq("G4 桌面角色位 4 个", R.TABLE_ROLE_SLOTS, 4);
  eq("100 血起跑（§2.1）", R.START_HP, 100);
  eq("回合上限 8（§5-2 默认值）", R.MAX_ROUNDS, 8);
  eq("事件在第 2/4/6 回合后（§2.3b / §5-7 默认值）", R.EVENT_AFTER_ROUNDS, [2, 4, 6]);
  eq("商店 5 张（§2.3）", R.SHOP_SIZE, 5);
  eq("刷新 2 金（§2.3）", R.SHOP_REFRESH_COST, 2);
  eq("卖卡 1 金（§2.1）", R.CARD_SELL_GOLD, 1);
  eq("收入基础 5 / 利息上限 5（§2.3）", [R.INCOME_BASE, R.INTEREST_CAP], [5, 5]);
  eq("模型升级价 8 / 15（§2.3b）", R.MODEL_LEVEL_UP_COST, { 2: 8, 3: 15 });

  // 权重表：每一行必须合计 100，且每一档在卡池里抽得出牌（否则抽卡时会抛 / 静默退化成 1 费）。
  for (const [i, row] of R.SHOP_QUALITY_WEIGHTS.entries()) {
    eq(`品质权重第 ${i + 1} 行合计 100`, row.reduce((a, b) => a + b, 0), 100);
    for (const q of [1, 2, 3, 4, 5]) {
      if (row[q - 1] > 0) ok(`权重第 ${i + 1} 行 ${q} 费在卡池里有卡`, R.CARD_LIBRARY.some((c) => c.quality === q));
    }
  }
  eq("第 1 回合不刷 5 费卡（§2.3 后期才有高费）", R.SHOP_QUALITY_WEIGHTS[0][4], 0);
  eq("卡池 id 唯一", new Set(R.CARD_LIBRARY.map((c) => c.id)).size, R.CARD_LIBRARY.length);
  for (const type of ["role", "scene", "item"]) {
    ok(`卡池有 ${type} 卡`, R.CARD_LIBRARY.some((c) => c.type === type));
  }
  for (const quality of [1, 2, 3, 4, 5]) {
    ok(`卡池有 ${quality} 费卡`, R.CARD_LIBRARY.some((c) => c.quality === quality));
  }

  ok("风格池 6~8 套（§2.2）", R.STYLE_POOL.length >= 6 && R.STYLE_POOL.length <= 8);
  eq("风格池 id 唯一", new Set(R.STYLE_POOL.map((s) => s.id)).size, R.STYLE_POOL.length);
  for (const style of R.STYLE_POOL) {
    ok(`风格卡 ${style.id} 有技法名词`, style.technique.length > 0);
    ok(`风格卡 ${style.id} 有题材`, style.topic.length > 0);
    eq(`风格卡 ${style.id} 的样张路径（§2.2 打进包）`, style.sample, `public/styles/${style.id}.webp`);
  }

  // 样张是**打进门包的产品素材**（G2-c）：id 就是文件名，缺一张界面上就是一块碎图，
  // 而 `vite build` 对"public/ 里少一个文件"零意见 —— 只有这里能拦。体积也在这里钉住：
  // 每张 ≤ 80KB、合计 ≤ 600KB（这是进 APK 的资源，生成口径见 design/gen-style-samples.mjs）。
  // 反方向同样要核：池子外的残留图会跟着打进包白占体积（改 id 时最容易留下它）。
  const styleDir = path.join(root, "public", "styles");
  let styleBytes = 0;
  for (const style of R.STYLE_POOL) {
    const file = path.join(root, style.sample);
    const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
    styleBytes += bytes;
    ok(`风格样张 ${style.id}.webp 在仓库里`, bytes > 0);
    ok(`风格样张 ${style.id} 单张 ≤ 80KB（现在 ${Math.round(bytes / 1024)}KB）`, bytes > 0 && bytes <= 80 * 1024);
  }
  ok(`八张风格样张合计 ≤ 600KB（现在 ${Math.round(styleBytes / 1024)}KB）`, styleBytes <= 600 * 1024);
  const stray = (fs.existsSync(styleDir) ? fs.readdirSync(styleDir) : []).filter(
    (n) => n.endsWith(".webp") && !R.STYLE_POOL.some((s) => `${s.id}.webp` === n),
  );
  eq("public/styles/ 里没有风格池之外的样张", stray, []);

  eq("事件池 3 个示例（§2.3b）", R.GAME_EVENTS.map((e) => e.id), ["model-arms-race", "inspiration-burst", "supply-drop"]);
  for (const event of R.GAME_EVENTS) {
    eq(`事件 ${event.id} 的小图路径`, event.art, `public/events/${event.id}.webp`);
    eq(`事件 ${event.id} 选项 id 唯一`, new Set(event.options.map((o) => o.id)).size, event.options.length);
  }
  eq("模型军备有 8 金 / 15 金两条升级线（§2.3b）", [
    R.gameEventById("model-arms-race").options.find((o) => o.id === "upgrade-draft").cost,
    R.gameEventById("model-arms-race").options.find((o) => o.id === "upgrade-cinema").cost,
  ], [8, 15]);
}

// ────────────────────────────── 1. 开局：100 血 / 初始金币 / 全员 L1 / 3 张风格卡 ──────────────────────────────

{
  const state = R.createGame(IDS, R.createRng(7));
  eq("开局 4 个玩家", state.players.length, 4);
  eq("开局阶段是选风格卡", state.phase, "style");
  eq("第 1 回合", state.round, 1);
  eq("开局档位 L1（§2.3 ★ 草稿 480p）", state.modelLevel, 1);
  for (const player of state.players) {
    eq(`${player.id} 100 血（§2.1）`, player.hp, R.START_HP);
    eq(`${player.id} 初始金币 4`, player.gold, R.START_GOLD);
    eq(`${player.id} 背包空`, player.bag, []);
    eq(`${player.id} 没有装备`, player.equipment, []);
    eq(`${player.id} L1（§2.3）`, player.modelLevel, 1);
    eq(`${player.id} 没淘汰`, player.eliminated, false);
    eq(`${player.id} 连胜 / 连败都是 0`, [player.winStreak, player.loseStreak], [0, 0]);
    eq(`${player.id} 抽到 3 张风格卡（§2.2）`, player.styleChoices.length, 3);
    eq(`${player.id} 风格卡不重复`, new Set(player.styleChoices).size, 3);
    for (const id of player.styleChoices) ok(`${player.id} 抽到的风格卡 ${id} 在池里`, R.STYLE_POOL.some((s) => s.id === id));
    eq(`${player.id} 还没锁定风格`, player.styleCardId, null);
  }
  // 反例：人数 / 重复 id 是程序员的错，必须抛 —— 静默开一局少一个人比崩掉更难查。
  throws("2 人开局（§5-1 默认 4 人，至少 3 人）", () => R.createGame(["a", "b"], R.createRng(1)));
  throws("重复 id 开局", () => R.createGame(["a", "a", "b"], R.createRng(1)));
  throws("空 id 开局", () => R.createGame(["a", "", "c"], R.createRng(1)));

  const model = basePlayer();
  eq("L1 的生成档位是草稿 480p（§2.3b）", R.generationTierOf({ ...model, modelLevel: 1 }), { level: 1, tier: "draft", resolution: "480p" });
  eq("L2 的生成档位是高清 720p", R.generationTierOf({ ...model, modelLevel: 2 }), { level: 2, tier: "hd", resolution: "720p" });
  eq("L3 的生成档位是电影级 1080p", R.generationTierOf({ ...model, modelLevel: 3 }), { level: 3, tier: "cinema", resolution: "1080p" });

  eq("4 人还在打的时候不给胜者（§2.5 剩下 ≤2 人才给）", R.winnersOf(state), []);
  eq("4 人局开局不算结束", R.isGameOver(state), false);
}

// ────────────────────────────── 2. 风格卡：3 选 1、抽到即固定、选定锁死（§2.2） ──────────────────────────────

{
  const rolled = R.rollStyleChoices(R.createRng(11));
  eq("随机 3 张风格卡", rolled.length, 3);
  eq("抽到的风格卡不重复", new Set(rolled.map((c) => c.id)).size, 3);
  ok("抽到的风格卡都在池里", rolled.every((c) => R.STYLE_POOL.some((s) => s.id === c.id)));
  eq("同一 seed 抽到同一组风格卡", R.rollStyleChoices(R.createRng(11)).map((c) => c.id), rolled.map((c) => c.id));

  let state = R.createGame(IDS, R.createRng(21));
  const p1 = find(state, "p1");
  const notOffered = R.STYLE_POOL.find((s) => !p1.styleChoices.includes(s.id)).id;
  // 反例：能选一张没抽到的卡 = 玩家 3 选 1 的随机池白摆，可以直接背下最强风格。
  rejects("选一张没抽到的风格卡", R.pickStyleCard(state, "p1", notOffered), "style-not-offered");
  rejects("替不存在的玩家选风格卡", R.pickStyleCard(state, "nobody", p1.styleChoices[0]), "unknown-player");
  state = must("选自己抽到的风格卡", R.pickStyleCard(state, "p1", p1.styleChoices[0])).state;
  eq("选定后 styleCardId 记下", find(state, "p1").styleCardId, p1.styleChoices[0]);
  ok("能按 id 取回风格卡对象", R.styleCardOf(find(state, "p1"))?.id === p1.styleChoices[0]);
  // 反例：允许改选 = §2.2「选定后整局所有出片都带这套风格」失守（中途换风格，前半局的片子与后半局不是一套）。
  rejects("选定后再改选", R.pickStyleCard(state, "p1", p1.styleChoices[1]), "style-locked");
  eq("还有 3 个人没选的时候阶段仍是 style", state.phase, "style");

  for (const id of ["p2", "p3", "p4"]) {
    state = must(`选风格卡 ${id}`, R.pickStyleCard(state, id, find(state, id).styleChoices[0])).state;
  }
  eq("全员选完进入 ready", state.phase, "ready");
  // 反例：ready 之后还能选风格 = 锁死只锁了一半（后选的人能改，先选的人不能）。
  rejects("ready 阶段再选风格卡", R.pickStyleCard(state, "p1", p1.styleChoices[1]), "wrong-phase");
  // 反例：还没选完就开商店 = 没风格的人也能出片（§2.2 风格卡是开局入口）。
  rejects("风格阶段直接开回合", R.beginRound(R.createGame(IDS, R.createRng(22)), R.createRng(22)), "wrong-phase");
}

// ────────────────────────────── 3. 背包 / 桌面卡位 / 卖卡 / 装备（G4 §3 改造） ──────────────────────────────
//
// ★ G4 第 3 步把「按种类计数」整组撤了：背包没有 9 格、也没有角色 ≤4 / 场景 ≤1 / 道具 ≤4。
//   上限只剩两处：**桌面卡位**（4 角色 + 1 场景）与**每张角色最多 3 张道具**。
//   所以这一节测的规矩换了：摆卡（含拖错类型 / 位子满了）、拖回背包、替换、道具 3 张上限、拆除工具。

{
  const base = basePlayer();
  eq("桌面卡位：角色 4 / 场景 1（施工单 §2）", [R.TABLE_ROLE_SLOTS, R.TABLE_SCENE_SLOTS], [4, 1]);
  eq("每张角色最多挂 3 张道具（施工单 §3）", [R.ITEMS_PER_ROLE, R.itemLimitOf(basePlayer())], [3, 3]);
  eq("空桌面 5 个位全空", R.tableSlotsOf(base), { roles: [null, null, null, null], scene: null });

  // 背包不再限量（§3 第一条）。
  // 反例：还能按种类数上限时这里会拒 —— 那说明旧的那套（9 格 / 角色 ≤4）没有删干净。
  let bag = base;
  for (let i = 0; i < 8; i += 1) bag = must(`背包不再限量 ${i}`, R.addCardToBag(bag, card(`b${i}`, "role"))).player;
  eq("背包能收 8 张角色（不再有 9 格 / 角色 ≤4）", bag.bag.length, 8);
  eq("背包占用只报数、没有上限字段", Object.keys(R.bagUsage(bag)).sort(), ["byType", "total"]);
  eq("收卡恒成功（canAddCard 恒 null）", R.canAddCard(bag, card("x", "role")), null);

  // ── 摆卡（施工单 §2：拖进 4 个角色位 + 1 个场景位） ──
  let t = must("角色 A 进背包", R.addCardToBag(base, card("rA", "role"))).player;
  t = must("场景进背包", R.addCardToBag(t, card("sA", "scene"))).player;
  t = must("道具进背包", R.addCardToBag(t, card("iA", "item"))).player;
  t = must("摆角色 A 到 1 号位", R.placeCardOnTable(t, "rA", { kind: "role", index: 0 })).player;
  eq("摆上桌的卡离开背包", t.bag.map((c) => c.id), ["sA", "iA"]);
  eq("桌上 1 号位是 A", R.tableSlotsOf(t).roles.map((c) => c?.id ?? null), ["rA", null, null, null]);
  t = must("摆场景", R.placeCardOnTable(t, "sA", { kind: "scene" })).player;
  eq("场景位是 sA", R.tableSlotsOf(t).scene?.id, "sA");
  eq("桌面上的卡 = 角色 + 场景", R.tableCardsOf(t).map((c) => c.id).sort(), ["rA", "sA"]);
  eq("拥有的卡 = 背包 + 桌面 + 装备（不重复计）", R.ownedCards(t).map((c) => c.id).sort(), ["iA", "rA", "sA"]);

  // 反例：位子与卡种对不上（角色卡丢进场景位 / 场景卡丢进角色位 / 道具想占卡位）。
  //   错的时候：出片时"场景那张"会挂进人物位，画面里少一个人、多一个地点。
  rejects("场景卡丢进角色位", R.placeCardOnTable(must("再收一张场景", R.addCardToBag(base, card("sB", "scene"))).player, "sB", { kind: "role", index: 0 }), "wrong-slot-type");
  rejects("角色卡丢进场景位", R.placeCardOnTable(must("再收一张角色", R.addCardToBag(base, card("rB", "role"))).player, "rB", { kind: "scene" }), "wrong-slot-type");
  rejects("道具卡不占卡位", R.placeCardOnTable(must("再收一件道具", R.addCardToBag(base, card("iB", "item"))).player, "iB", { kind: "role", index: 0 }), "wrong-slot-type");
  // 反例：位子下标越界 = 界面的号码与规则对不上（静默把卡吞掉比崩溃更难查）。
  rejects("越界的角色位", R.placeCardOnTable(must("越界夹具", R.addCardToBag(base, card("rC", "role"))).player, "rC", { kind: "role", index: 9 }), "bad-table-slot");
  // 反例：不在背包里的卡被摆（卖掉了 / 已经挂到角色身上）。
  rejects("摆一张不在背包里的卡", R.placeCardOnTable(base, "nope", null), "card-not-in-bag");

  // 4 个角色位都占满之后再摆第 5 张 = type-cap（这就是"type-cap 只保留桌面卡位这一层"）。
  //   拖到桌面空处（slot=null）时由规则自己找空位；一个空位都没有才拒。
  let full = base;
  for (let i = 0; i < 4; i += 1) {
    full = must(`满位角色 ${i}`, R.addCardToBag(full, card(`f${i}`, "role"))).player;
    full = must(`摆满 ${i}`, R.placeCardOnTable(full, `f${i}`, { kind: "role", index: i })).player;
  }
  full = must("第 5 张角色", R.addCardToBag(full, card("f4", "role"))).player;
  const capped = R.placeCardOnTable(full, "f4", null);
  rejects("角色位满了再摆", capped, "type-cap");
  eq("type-cap 报的是桌面卡位 4/4", [capped.count, capped.cap, capped.cardType], [4, 4, "role"]);
  // 场景位同理只有 1 个。
  let oneScene = must("场景占位", R.addCardToBag(base, card("s1", "scene"))).player;
  oneScene = must("摆上场景 1", R.placeCardOnTable(oneScene, "s1", { kind: "scene" })).player;
  oneScene = must("第 2 张场景", R.addCardToBag(oneScene, card("s2", "scene"))).player;
  rejects("场景位只有一个", R.placeCardOnTable(oneScene, "s2", null), "type-cap");

  // 替换：拖到**已占**的位子上 = 新卡上位、旧卡回背包（施工单「已占的位可以拖回背包/替换」）。
  let rep = must("替换：角色进背包", R.addCardToBag(base, card("r1", "role"))).player;
  rep = must("替换：旧卡进背包", R.addCardToBag(rep, card("r2", "role"))).player;
  rep = must("替换：旧卡上位", R.placeCardOnTable(rep, "r1", { kind: "role", index: 0 })).player;
  rep = must("替换：新卡顶掉旧卡", R.placeCardOnTable(rep, "r2", { kind: "role", index: 0 })).player;
  eq("替换后位子上是新卡", R.tableSlotsOf(rep).roles[0]?.id, "r2");
  eq("替换后旧卡回背包", rep.bag.map((c) => c.id).sort(), ["r1"]);
  // 反例：同一张卡拖回原位当成"替换" = 旧卡（其实是它自己）被丢进背包，桌上凭空多一张。
  const noop = must("同一张卡拖回原位", R.placeCardOnTable(rep, "r2", { kind: "role", index: 0 })).player;
  eq("原位不动、背包不变", [R.tableSlotsOf(noop).roles[0]?.id, noop.bag.map((c) => c.id).sort()], ["r2", ["r1"]]);

  // 拖回背包（施工单：已占的位可以拖回背包）。
  const back = must("角色拖回背包", R.returnTableCardToBag(noop, { kind: "role", index: 0 })).player;
  eq("拖回来之后位子空了", R.tableSlotsOf(back).roles[0], null);
  eq("拖回来之后卡在背包", back.bag.map((c) => c.id).sort(), ["r1", "r2"]);
  // 反例：空位子上"拖回背包" = 界面上拖了一张不在那儿的卡（静默成功会让玩家以为收回了）。
  rejects("空的角色位拖回背包", R.returnTableCardToBag(base, { kind: "role", index: 0 }), "table-slot-empty");
  rejects("空的场景位拖回背包", R.returnTableCardToBag(base, { kind: "scene" }), "table-slot-empty");

  // ── 道具（施工单 §3：每个角色最多 3 张；右侧栏拖到角色卡上） ──
  // 夹具：桌上一个角色 + 背包里 4 件道具。
  let wearer = must("角色进背包", R.addCardToBag(base, card("role0", "role"))).player;
  for (let i = 0; i < 4; i += 1) wearer = must(`道具进背包 ${i}`, R.addCardToBag(wearer, card(`i${i}`, "item"))).player;
  // 反例：道具挂到**还没上桌**的角色身上 —— 右侧栏只列道具、桌面上没有那张角色，玩家看不出它属于谁。
  rejects("挂到还没上桌的角色", R.equipItemOnRole(wearer, "role0", "i0"), "role-not-on-table");
  let onTable = must("角色上桌", R.placeCardOnTable(wearer, "role0", { kind: "role", index: 0 })).player;
  onTable = must("挂第 1 张道具", R.equipItemOnRole(onTable, "role0", "i0")).player;
  onTable = must("挂第 2 张道具", R.equipItemOnRole(onTable, "role0", "i1")).player;
  onTable = must("挂第 3 张道具", R.equipItemOnRole(onTable, "role0", "i2")).player;
  eq("挂上之后道具离开背包", onTable.bag.map((c) => c.id).sort(), ["i3"]);
  eq("按角色查道具（复数）", R.equippedItemsOf(onTable, "role0").map((c) => c.id), ["i0", "i1", "i2"]);
  eq("计数 = 3", R.equippedCountOf(onTable, "role0"), 3);
  // 反例：还能挂第 4 张 = 「每角色 3 张」失守（对齐参照游戏的那一条）。
  rejects("第 4 张道具", R.equipItemOnRole(onTable, "role0", "i3"), "item-limit");
  // 事件加的 +1（补给站）：上限只从 itemLimitOf 读，别处不许自己写 3。
  eq("事件 +1 之后上限 4", R.itemLimitOf({ ...onTable, itemLimitBonus: 1 }), 4);
  must("加成后能挂第 4 张", R.equipItemOnRole({ ...onTable, itemLimitBonus: 1 }, "role0", "i3"));
  // 反例：道具挂到道具上 / 角色当道具挂 / 挂一件不存在的道具。
  rejects("把道具挂到道具上", R.equipItemOnRole(onTable, "role0", "i0"), "item-equipped"); // w0 已经在身上
  rejects("把角色当道具挂", R.equipItemOnRole(onTable, "role0", "i0"), "item-equipped");

  // 反例：同一件道具挂到第二个角色上 = 一件道具被两个角色引用（拆一个时另一个指向空气）。
  let twoRoles = must("第二个角色进背包", R.addCardToBag(onTable, card("w9", "role"))).player;
  twoRoles = must("第二个角色上桌", R.placeCardOnTable(twoRoles, "w9", { kind: "role", index: 1 })).player;
  rejects("同一件道具挂两个角色", R.equipItemOnRole(twoRoles, "w9", "i0"), "item-equipped");

  // 拆除工具：一次卸下这张角色身上的**所有**道具（施工单 §3）。
  const stripped = must("拆除工具一次卸光", R.unequipAllFromRole(onTable, "role0")).player;
  eq("3 张全回背包", stripped.bag.map((c) => c.id).sort(), ["i0", "i1", "i2", "i3"]);
  eq("装备关系清空", stripped.equipment, []);
  // 反例：拆一张身上什么都没有的角色 = 界面上那颗工具会"点了没反应"（要说原因）。
  rejects("拆一张没有道具的角色", R.unequipAllFromRole(stripped, "role0"), "no-equipped-item");

  // 带道具的角色不能拖回背包 / 不能被替换（道具会指向一张不在桌上的卡）。
  rejects("带道具的角色拖回背包", R.returnTableCardToBag(onTable, { kind: "role", index: 0 }), "role-equipped");
  rejects("带道具的角色被替换", R.placeCardOnTable(must("替换夹具", R.addCardToBag(onTable, card("w8", "role"))).player, "w8", { kind: "role", index: 0 }), "role-equipped");

  // 卖卡：只卖背包里的（§2.1 回收 1 金）。桌上的 / 挂在角色身上的都要先说清楚。
  const seller = withCards([card("s1", "role", 5), card("s2", "item")], { gold: 5 });
  const soldOne = must("卖一张 5 费角色", R.sellCardFromBag(seller, "s1"));
  eq("卖卡回收 1 金（5 费也只回 1，§2.1）", soldOne.refund, 1);
  eq("卖完金币 +1", soldOne.player.gold, 6);
  eq("卖掉的卡不在背包里", soldOne.player.bag.map((c) => c.id), ["s2"]);
  rejects("卖一张不在背包里的卡", R.sellCardFromBag(seller, "nope"), "card-not-in-bag");
  // 反例：把桌上那张卖了 = 桌面留一个空位，而出片刚读过它（成片里少一个人）。
  rejects("卖一张摆在桌上的卡", R.sellCardFromBag(noop, "r2"), "card-on-table");
  rejects("卖一件正装备着的道具", R.sellCardFromBag(onTable, "i0"), "item-equipped");

  // 阶段闸：卖卡只准商店阶段；**摆卡 / 装备两阶段都行**（G4 §2：出片按钮在创作阶段，
  //   进那一阶段才发现没摆就永远补不上）。
  const match = newMatch(31);
  rejects("创作阶段卖卡", R.sellCard({ ...match.state, phase: "create" }, "p1", "whatever"), "wrong-phase");
  rejects("展映阶段买卡", R.buyShopCard({ ...match.state, phase: "screening" }, "p1", 0), "wrong-phase");
  rejects("展映阶段摆卡", R.placeOnTable({ ...match.state, phase: "screening" }, "p1", "r1", null), "wrong-phase");
  let create = withBag({ ...match.state, phase: "create" }, "p1", [card("r1", "role"), card("i1", "item")]);
  create = must("创作阶段摆卡", R.placeOnTable(create, "p1", "r1", { kind: "role", index: 0 })).state;
  create = must("创作阶段装备", R.equipItem(create, "p1", "r1", "i1")).state;
  eq("创作阶段也能摆 + 装备", [R.tableSlotsOf(find(create, "p1")).roles[0]?.id, find(create, "p1").equipment.length], ["r1", 1]);
  create = must("创作阶段卸下", R.unequipAll(create, "p1", "r1")).state;
  // 角色还摆在桌上（没跟着回背包），回来的只有那件道具
  eq("创作阶段卸下退回背包", find(create, "p1").bag.map((c) => c.id).sort(), ["i1"]);
  // 状态级卖卡 / 摆卡（界面走这些口子；核心逻辑仍是上面那些纯函数）。
  let shopState = newMatch(32);
  shopState = withBag(shopState.state, "p1", [card("r1", "role"), card("i1", "item")]);
  shopState = must("状态级摆卡", R.placeOnTable(shopState, "p1", "r1", { kind: "role", index: 0 })).state;
  shopState = must("状态级装备", R.equipItem(shopState, "p1", "r1", "i1")).state;
  eq("状态级装备写回玩家", find(shopState, "p1").equipment.length, 1);
  shopState = must("状态级卸下", R.unequipAll(shopState, "p1", "r1")).state;
  eq("状态级卸下退回背包", find(shopState, "p1").bag.map((c) => c.id).sort(), ["i1"]);
  shopState = must("状态级回背包", R.returnToBag(shopState, "p1", { kind: "role", index: 0 })).state;
  eq("状态级回背包：位子空了、卡在背包", [R.tableSlotsOf(find(shopState, "p1")).roles[0], find(shopState, "p1").bag.length], [null, 2]);
  const beforeSell = find(shopState, "p1").gold;
  shopState = must("状态级卖卡", R.sellCard(shopState, "p1", "r1")).state;
  eq("状态级卖卡到账 1 金", find(shopState, "p1").gold, beforeSell + 1);
}


// ────────────────────────────── 4. 经济：利息封顶 / 连胜档位 / 回合收入（§2.3） ──────────────────────────────

{
  eq("利息：0 金 0", R.interestFor(0), 0);
  eq("利息：9 金 0", R.interestFor(9), 0);
  eq("利息：10 金 1", R.interestFor(10), 1);
  eq("利息：19 金 1（向下取整）", R.interestFor(19), 1);
  eq("利息：20 金 2", R.interestFor(20), 2);
  eq("利息：50 金 5", R.interestFor(50), 5);
  eq("利息：100 金封顶 5（§2.3 上限 5）", R.interestFor(100), 5);
  eq("利息：负数不产生利息", R.interestFor(-50), 0);

  eq("2 连 +1（§2.3）", R.streakBonusFor(2), 1);
  eq("3 连 +2", R.streakBonusFor(3), 2);
  eq("4 连 +2", R.streakBonusFor(4), 2);
  eq("5 连 +3（§2.3）", R.streakBonusFor(5), 3);
  eq("9 连仍是 +3（封顶）", R.streakBonusFor(9), 3);
  eq("0 / 1 连没有奖励", [R.streakBonusFor(0), R.streakBonusFor(1)], [0, 0]);

  const earner = withCards([], { gold: 37, winStreak: 3, loseStreak: 0 });
  eq("收入 = 5 + 利息 3 + 3 连 2（§2.3）", R.incomeFor(earner), { base: 5, interest: 3, streak: 2, total: 10 });
  const loser = withCards([], { gold: 100, winStreak: 0, loseStreak: 5 });
  eq("连败也吃同一张奖励表（§2.3）", R.incomeFor(loser), { base: 5, interest: 5, streak: 3, total: 13 });
  const noStreak = withCards([], { gold: 4, winStreak: 0, loseStreak: 0 });
  eq("开局收入只有基础 5", R.incomeFor(noStreak), { base: 5, interest: 0, streak: 0, total: 5 });

  const match = newMatch(41);
  eq("第一回合不自动发收入（开局金币原样）", find(match.state, "p1").gold, R.START_GOLD);
  const next = must("进第 2 回合", R.beginRound({ ...match.state, phase: "round-end" }, match.rng)).state;
  eq("第 2 回合（§2.3 每回合收入）", next.round, 2);
  eq("4 金 → 4 + 5（利息 0）", find(next, "p1").gold, 9);
  // 反例：利息按发完钱的金币算 = 这里会从 4 金变成 6（白送 1 金/回合，整局节奏悄悄变快）。
  const rich = withPlayer({ ...match.state, phase: "round-end" }, "p1", { gold: 100 });
  const richNext = must("高利息回合", R.beginRound(rich, R.createRng(42))).state;
  eq("100 金时收入 5 + 利息 5", find(richNext, "p1").gold, 110);
  // 反例：没有回合上限 = 8 回合之后还能一直开局（§5-2 的「打满 8 回合结束」失守）。
  rejects("第 8 回合之后还开下一回合", R.beginRound({ ...match.state, phase: "round-end", round: R.MAX_ROUNDS }, R.createRng(43)), "round-limit");
}

// ────────────────────────────── 5. 商店：每回合 5 张 / 刷新 2 金 / 锁定免费 / 买卡（§2.3） ──────────────────────────────

{
  eq("回合 0 夹到第 1 行权重", R.qualityWeightsForRound(0), R.SHOP_QUALITY_WEIGHTS[0]);
  eq("回合 9 夹到最后一行权重", R.qualityWeightsForRound(9), R.SHOP_QUALITY_WEIGHTS[R.SHOP_QUALITY_WEIGHTS.length - 1]);

  const a = newMatch(51);
  const b = newMatch(51);
  eq("同一 seed 的商店一样（可复盘）", find(a.state, "p1").id, find(b.state, "p1").id);
  eq("商店 5 格（§2.3）", a.state.shops.p1.cards.length, 5);
  eq("5 格都刷出了卡", a.state.shops.p1.cards.filter(Boolean).length, 5);
  const shopIds = a.state.shops.p1.cards.map((c) => c.id);
  eq("同一回合 5 张卡实例 id 唯一", new Set(shopIds).size, 5);
  eq("同一 seed 刷出同一批卡", b.state.shops.p1.cards.map((c) => c.id), shopIds);
  for (const shopCard of a.state.shops.p1.cards) {
    ok(`商店卡 ${shopCard.id} 的品质在 1~5`, shopCard.quality >= 1 && shopCard.quality <= 5);
    ok(`商店卡 ${shopCard.id} 在卡池里认得出类型`, ["role", "scene", "item"].includes(shopCard.type));
  }

  // 刷新：2 金（§2.3）。
  const beforeRefresh = find(a.state, "p1").gold;
  const refreshed = must("刷新商店", R.refreshShop(withPlayer(a.state, "p1", { gold: 10 }), "p1", a.rng)).state;
  eq("刷新扣 2 金（§2.3）", find(refreshed, "p1").gold, 8);
  eq("刷新后仍是 5 格", refreshed.shops.p1.cards.length, 5);
  eq("刷新换了新卡", refreshed.shops.p1.cards.map((c) => c.id).join() === shopIds.join(), false);
  // 反例：钱不够还刷新 = 金币变负数（界面上买卡报价全乱）。
  const poor = withPlayer(a.state, "p1", { gold: 1 });
  const poorBefore = show(poor);
  rejects("1 金时刷新商店", R.refreshShop(poor, "p1", a.rng), "not-enough-gold");
  unchanged("刷新失败不改状态", poor, JSON.parse(poorBefore));
  // 免费刷新券（补给站免费项 ×2）：先用券、不动金币。
  const coupon = withPlayer(a.state, "p1", { gold: 10, buffs: { ...find(a.state, "p1").buffs, freeRefreshes: 2 } });
  const couponUsed = must("用免费刷新券", R.refreshShop(coupon, "p1", a.rng)).state;
  eq("用券不扣金币", find(couponUsed, "p1").gold, 10);
  eq("用掉一张券", find(couponUsed, "p1").buffs.freeRefreshes, 1);

  // 锁定：免费；锁着的商店在 beginRound 不自动刷新（§2.3）。
  const lockBefore = find(a.state, "p1").gold;
  const locked = must("锁定商店", R.toggleShopLock(a.state, "p1")).state;
  eq("锁定免费", find(locked, "p1").gold, lockBefore);
  eq("锁定状态记下", locked.shops.p1.locked, true);
  const lockedCards = locked.shops.p1.cards.map((c) => c.id);
  const round2 = must("锁着进下一回合", R.beginRound({ ...locked, phase: "round-end" }, a.rng)).state;
  eq("锁定商店不自动刷新（§2.3）", round2.shops.p1.cards.map((c) => c.id), lockedCards);
  eq("锁定期间照样发收入", find(round2, "p1").gold, lockBefore + 5);
  const unlocked = must("解锁商店", R.toggleShopLock(round2, "p1")).state;
  const round3 = must("解锁后进下一回合", R.beginRound({ ...unlocked, phase: "round-end" }, a.rng)).state;
  eq("解锁后自动刷新", round3.shops.p1.cards.map((c) => c.id).join() === lockedCards.join(), false);

  // 买卡：价钱 = 品质；买走的那一格空掉（保持 5 格）。
  const buying = withPlayer(newMatch(52).state, "p1", { gold: 20 });
  const slot = buying.shops.p1.cards.findIndex((c) => c !== null);
  const slotCard = buying.shops.p1.cards[slot];
  const bought = must("买商店卡", R.buyShopCard(buying, "p1", slot)).state;
  eq("买卡扣品质金（§2.1）", find(bought, "p1").gold, 20 - slotCard.quality);
  eq("买到的卡进背包", find(bought, "p1").bag.map((c) => c.id), [slotCard.id]);
  eq("买走的那一格空掉", bought.shops.p1.cards[slot], null);
  eq("商店仍是 5 格", bought.shops.p1.cards.length, 5);
  rejects("买已经空掉的格子", R.buyShopCard(bought, "p1", slot), "slot-empty");
  // 反例：越界下标不报错 = 读到 undefined 当卡卖（扣 0 金、白送一张 undefined）。
  rejects("下标 -1", R.buyShopCard(buying, "p1", -1), "bad-slot");
  rejects("下标 5", R.buyShopCard(buying, "p1", R.SHOP_SIZE), "bad-slot");
  rejects("小数下标", R.buyShopCard(buying, "p1", 1.5), "bad-slot");
  const broke = withPlayer(buying, "p1", { gold: 0 });
  const brokeBefore = show(broke);
  rejects("0 金买卡", R.buyShopCard(broke, "p1", slot), "not-enough-gold");
  unchanged("买卡失败不改状态", broke, JSON.parse(brokeBefore));
  // 反例：背包满还硬买 = 多扣钱、卡没有落点。
  const fullBag = withPlayer(buying, "p1", { bag: Array.from({ length: 9 }, (_, i) => card(`f${i}`, "role")) });
  const fullBefore = show(fullBag);
  ok("背包没有上限时，买卡只会被钱拦住（不再有 bag-full 这条路）", "bag-full" !== (R.buyShopCard(fullBag, "p1", slot).reason ?? ""));
  unchanged("背包满买卡失败不改状态", fullBag, JSON.parse(fullBefore));

  // ★ G4 施工单 §3 起没有"装不下 → 替换旧卡"那条路：背包不限量，买得到买不到只看钱。
  //   反例：`buyShopCard` 还认第四位 replaceCardId = 旧的那套没删干净（界面早就不传它了）。
  eq("买卡不再收 replaceCardId（那条路随背包上限一起撤了）", R.buyShopCard.length, 3);
}

// ────────────────────────────── 6. 模型等级：8 金 L2 / 15 金 L3 + 3 连胜门槛（§2.3b） ──────────────────────────────

{
  const event = R.gameEventById("model-arms-race");
  const p1 = basePlayer();
  const optionsAt = (player) => R.optionsForPlayer(player, event).map((o) => o.id);
  eq("L1 能看到的模型军备选项（8 金升级 + 半价 + 免费）", optionsAt(p1), ["upgrade-draft", "half-next", "free-gold"]);
  const l2NoStreak = { ...p1, modelLevel: 2, winStreak: 2 };
  // 反例：2 连胜也摆出 15 金的 L3 = §2.3b「L3 要求 3 连胜才开放」失守（第 5 回合就有人 1080p）。
  eq("L2 + 2 连胜看不到 L3 选项", optionsAt(l2NoStreak), ["half-next", "free-gold"]);
  const l2Streak = { ...p1, modelLevel: 2, winStreak: 3 };
  eq("L2 + 3 连胜出现 15 金的 L3 选项（§2.3b）", optionsAt(l2Streak), ["upgrade-cinema", "half-next", "free-gold"]);
  eq("3 连胜门槛的另一边：4 连胜当然可以", optionsAt({ ...p1, modelLevel: 2, winStreak: 4 }), ["upgrade-cinema", "half-next", "free-gold"]);
  eq("L3 封顶后两条升级线都不出现（§5-8 默认不放开）", optionsAt({ ...p1, modelLevel: 3, winStreak: 9 }), ["half-next", "free-gold"]);
  eq("L1 不能跳级买 L3（升级线一条一条走）", R.optionsForPlayer(p1, event).some((o) => o.id === "upgrade-cinema"), false);

  const at = (eventId, playerPatch = {}, seed = 61) => {
    const match = newMatch(seed);
    let state = { ...match.state, phase: "event", currentEventId: eventId, eventPicks: {} };
    state = withPlayer(state, "p1", playerPatch);
    return { state, rng: match.rng };
  };

  const up = at("model-arms-race", { gold: 20 });
  const upgraded = must("8 金升 L2", R.applyEventChoice(up.state, "p1", "upgrade-draft", up.rng));
  eq("升 L2 扣 8 金", find(upgraded.state, "p1").gold, 12);
  eq("升 L2 后档位 720p", R.generationTierOf(find(upgraded.state, "p1")).resolution, "720p");
  eq("还有 3 个人没选，阶段仍是 event", upgraded.state.phase, "event");

  const l3 = at("model-arms-race", { modelLevel: 2, winStreak: 3, gold: 20 });
  const toL3 = must("15 金升 L3", R.applyEventChoice(l3.state, "p1", "upgrade-cinema", l3.rng));
  eq("升 L3 扣 15 金", find(toL3.state, "p1").gold, 5);
  eq("升 L3 后档位 1080p", R.generationTierOf(find(toL3.state, "p1")).resolution, "1080p");
  // 反例：2 连胜也能买 L3（15 金）—— 选项根本不该出现。
  const noGate = at("model-arms-race", { modelLevel: 2, winStreak: 2, gold: 20 });
  const noGateBefore = show(noGate.state);
  rejects("2 连胜买 15 金的 L3", R.applyEventChoice(noGate.state, "p1", "upgrade-cinema", noGate.rng), "option-unavailable");
  unchanged("买不了的选项不改状态", noGate.state, JSON.parse(noGateBefore));
  // 反例：1 级直接买 L3 = 跳级（8 + 15 的成长线被 15 金一步到位）。
  const jump = at("model-arms-race", { modelLevel: 1, winStreak: 9, gold: 20 });
  rejects("L1 直接买 L3", R.applyEventChoice(jump.state, "p1", "upgrade-cinema", jump.rng), "option-unavailable");
  // 反例：钱不够先扣成负数 / 先升级后扣钱 = 账对不上。
  const poor = at("model-arms-race", { gold: 7 });
  const poorBefore = show(poor.state);
  rejects("7 金升 L2", R.applyEventChoice(poor.state, "p1", "upgrade-draft", poor.rng), "not-enough-gold");
  unchanged("升级失败不改状态", poor.state, JSON.parse(poorBefore));

  // 升级整局保留：进下一回合不掉回 L1。
  const kept = withPlayer(at("model-arms-race", { modelLevel: 3 }).state, "p1", { modelLevel: 3 });
  const nextRound = must("升级后进下一回合", R.beginRound({ ...kept, phase: "round-end" }, R.createRng(62))).state;
  eq("模型等级整局保留（§2.3b）", find(nextRound, "p1").modelLevel, 3);
}

// ────────────────────────────── 6b. 免费账号只能停在 L1（任务 A，2026-11-23 主人拍板） ──────────────────────────────
//
// 判据在 data/account.payingNow（谁付过钱），规则层只收一个 `ModelGate`（见 rules.ModelGate 的 ★）。
// ★ 反例为什么必须是反例：免费账号升到 L2/L3 之后，出片那一发在服务端是 403 PLAN_REQUIRED
//   （L2/L3 在档位表里都是会员档），而**出片前补画的设定帧已经各自结算过了** —— 玩家花 8 / 15 金
//   买到一个点了必失败的档位，界面上还写着"高清"。所以升级项必须整条不出现，真发出去的档位也必须夹回 L1。
{
  const FREE = { upgrade: false };
  const PAID = { upgrade: true };
  const event = R.gameEventById("model-arms-race");
  const p1 = basePlayer();
  const ids = (list) => list.map((o) => o.id);
  /** 事件阶段的夹具（与上面第 6 节那个 at 同一形状，不跨块共用变量） */
  const at = (playerPatch = {}, seed = 61) => {
    const match = newMatch(seed);
    const state = withPlayer(
      { ...match.state, phase: "event", currentEventId: "model-arms-race", eventPicks: {} },
      "p1",
      playerPatch,
    );
    return { state, rng: match.rng };
  };

  // 付费账号（= 今天的形状）：两条升级线照旧按等级与连胜出现
  eq("付费账号 L1 能看到 8 金的 L2", ids(R.optionsForPlayer(p1, event, PAID)), ["upgrade-draft", "half-next", "free-gold"]);
  eq("付费账号能拿到 L2 的报价", R.modelUpgradeOffer(p1, PAID), { level: 2, cost: 8 });
  // ★ 反面：免费账号看到 L2 选项 = 他花 8 金买一个到出片才 403 的档位。
  eq("免费账号看不到 L2 升级项（只剩后两条）", ids(R.optionsForPlayer(p1, event, FREE)), ["half-next", "free-gold"]);
  eq("免费账号的 modelUpgradeOffer 是 null", R.modelUpgradeOffer(p1, FREE), null);
  eq("免费账号 L2+3 连胜也看不到 L3", ids(R.optionsForPlayer({ ...p1, modelLevel: 2, winStreak: 3 }, event, FREE)), ["half-next", "free-gold"]);
  eq("免费账号 modelUpgradeOffer 连 L3 也不给", R.modelUpgradeOffer({ ...p1, modelLevel: 2, winStreak: 3 }, FREE), null);

  // 形态：免费账号点不着（与"界面摆不摆"两条独立的闸，别只靠界面）
  const free = at({ gold: 20 });
  const before = show(free.state);
  rejects("免费账号直接买 L2（绕过界面）", R.applyEventChoice(free.state, "p1", "upgrade-draft", free.rng, FREE), "option-unavailable");
  unchanged("被拦下的升级不改状态", free.state, JSON.parse(before));
  const paidTry = at({ gold: 20 });
  const paidUp = must("付费账号同一发能买 L2", R.applyEventChoice(paidTry.state, "p1", "upgrade-draft", paidTry.rng, PAID));
  eq("付费账号升完是 L2", find(paidUp.state, "p1").modelLevel, 2);

  // 出片档位：同一个 gate 夹回 L1（UI 写什么、发出去就是什么）
  eq("免费账号的有效档位是 L1 草稿 480p", R.generationTierOf({ ...p1, modelLevel: 3 }, FREE), { level: 1, tier: "draft", resolution: "480p" });
  eq("付费账号的档位照等级走（L3 电影级 1080p）", R.generationTierOf({ ...p1, modelLevel: 3 }, PAID), { level: 3, tier: "cinema", resolution: "1080p" });
  eq("不传 gate = 能升（规则层缺省，AI 陪玩与单机演练走这一支）", R.generationTierOf({ ...p1, modelLevel: 2 }).resolution, "720p");
  eq("不传 gate 时 L2 升级项照旧摆出来", ids(R.optionsForPlayer(p1, event)), ["upgrade-draft", "half-next", "free-gold"]);

  // ★ 源码棘轮：App 那三个调用点必须显式带 gate（漏传不会红在类型上 —— 有缺省值）。
  //   漏传的症状是"免费用户升上去、出片 403"，而那一条只在真机真出片时才看得见。
  const gateCallers = {
    "view.ts": path.join(root, "src/studio/game/view.ts"),
    "store.ts": path.join(root, "src/studio/game/store.ts"),
    "genTier.ts": path.join(root, "src/studio/game/genTier.ts"),
  };
  const viewSrc = fs.readFileSync(gateCallers["view.ts"], "utf8");
  ok("view.ts 的 eventOptionsFor 带了 gate（摆选项那一处）", /eventOptionsFor\([^)]*modelUpgradeGate\(\)\)/.test(viewSrc));
  const storeSrc = fs.readFileSync(gateCallers["store.ts"], "utf8");
  ok("store.ts 的 applyEventChoice 带了 gate（扣钱那一处）", /applyEventChoice\([^)]*modelUpgradeGate\(\)\)/.test(storeSrc));
  const genTierSrc = fs.readFileSync(gateCallers["genTier.ts"], "utf8");
  ok("genTier.ts 的出片档位过 modelUpgradeGate（发出去那一处）", /modelUpgradeGate\(\)\.upgrade/.test(genTierSrc));
  ok("「付没付过钱」只问 account.payingNow（不在对局层另拼 plan.monthly / paid）", /payingNow\(\) !== false/.test(genTierSrc) && !/plan\s*\.\s*monthly/.test(genTierSrc));
}

// ────────────────────────────── 7. 事件：每 2 回合三选一 / 池子不重样 / 收益落账（§2.3b） ──────────────────────────────

{
  // 1~6 回合整跑：第 2/4/6 回合结算后各出一次事件，三个人选免费项，事件不重样。
  const rng = R.createRng(71);
  let state = R.createGame(IDS, rng);
  for (const id of IDS) state = must(`整跑选风格 ${id}`, R.pickStyleCard(state, id, find(state, id).styleChoices[0])).state;
  state = must("整跑开商店", R.beginRound(state, rng)).state;
  const eventRounds = [];
  for (let round = 1; round <= 6; round += 1) {
    state = must(`第 ${round} 回合创作`, R.enterCreation(state)).state;
    state = submitAll(state, `round ${round} fixture`);
    state = must(`第 ${round} 回合展映`, R.enterScreening(state)).state;
    state = must(`第 ${round} 回合投票`, R.enterVoting(state)).state;
    const ranking = state.players.filter((p) => !p.eliminated).map((p) => p.id);
    const settled = must(`第 ${round} 回合结算`, R.settleRound(state, ranking, rng));
    state = settled.state;
    if (state.phase === "event") {
      eventRounds.push({ round, id: state.currentEventId });
      eq(`第 ${round} 回合的事件在池子里`, R.GAME_EVENTS.some((e) => e.id === state.currentEventId), true);
      // 全员各选一个免费项（AI 的最简行为），选完进 round-end。
      while (state.phase === "event") {
        const picker = state.players.find((p) => !p.eliminated && state.eventPicks[p.id] === undefined);
        const options = must(`第 ${round} 回合 ${picker.id} 的事件选项`, R.eventOptionsFor(state, picker.id)).options;
        const free = options.find((o) => o.cost === 0) ?? options[0];
        state = must(`第 ${round} 回合 ${picker.id} 选事件`, R.applyEventChoice(state, picker.id, free.id, rng)).state;
      }
    }
    if (round < 6) state = must(`第 ${round + 1} 回合开商店`, R.beginRound(state, rng)).state;
  }
  eq("事件只在第 2/4/6 回合之后（§2.3b / §5-7）", eventRounds.map((e) => e.round), [2, 4, 6]);
  eq("三次事件抽到的池子不重样（§2.3b）", new Set(eventRounds.map((e) => e.id)).size, 3);
  eq("事件池记下已抽过的 3 个", state.drawnEventIds.length, 3);
  eq("整跑 6 回合后收在 round-end", state.phase, "round-end");

  // 第 1 回合结算后没有事件（§2.3b 只在双数回合）。
  const first = newMatch(72);
  const firstSettle = must("第 1 回合结算", R.settleRound({ ...first.state, phase: "voting" }, IDS, first.rng));
  eq("第 1 回合不出事件", firstSettle.state.phase, "round-end");
  eq("第 1 回合 currentEventId 为空", firstSettle.state.currentEventId, null);

  // 反例：池子抽空了还硬抽 = 连着来同一个事件（§2.3b 明文要避免）。
  const exhausted = {
    ...newMatch(73).state,
    phase: "voting",
    round: 4,
    drawnEventIds: R.GAME_EVENTS.map((e) => e.id),
  };
  const exhaustedSettle = must("池子抽空后的结算", R.settleRound(exhausted, IDS, R.createRng(74)));
  eq("池子空了就不再出事件（不重样）", exhaustedSettle.state.phase, "round-end");
  eq("池子空了 currentEventId 为空", exhaustedSettle.state.currentEventId, null);

  const eventState = (eventId, patch = {}, seed = 75) => {
    const match = newMatch(seed);
    let state = { ...match.state, phase: "event", currentEventId: eventId, eventPicks: {} };
    state = withPlayer(state, "p1", patch);
    return { state, rng: match.rng };
  };

  eq("灵感爆发对 L1 也是三选一", R.optionsForPlayer(basePlayer(), R.gameEventById("inspiration-burst")).map((o) => o.id), ["double-shoot", "long-prompt", "free-blue-card"]);
  eq("补给站对 L1 也是三选一", R.optionsForPlayer(basePlayer(), R.gameEventById("supply-drop")).map((o) => o.id), ["bag-expand", "heal", "free-refresh"]);

  // 免费项 +4 金（模型军备的兜底，§2.3b）。
  const freeGold = eventState("model-arms-race", { gold: 10 });
  const gotGold = must("免费项 +4 金", R.applyEventChoice(freeGold.state, "p1", "free-gold", freeGold.rng));
  eq("免费 +4 金", find(gotGold.state, "p1").gold, 14);
  eq("事件选择记进 eventPicks", gotGold.state.eventPicks.p1, "free-gold");
  // 反例：同一个人能选两次 = 一份事件领两份收益。
  rejects("同一个人选两次事件", R.applyEventChoice(gotGold.state, "p1", "free-gold", gotGold.rng), "event-already-picked");
  // 反例：没抽事件（currentEventId 为空）也能选 = 事件收不到 / 收益凭空发。
  const noEvent = { ...newMatch(76).state, phase: "event", currentEventId: null };
  rejects("没抽事件就选", R.eventOptionsFor(noEvent, "p1"), "event-not-drawn");
  rejects("没抽事件直接选", R.applyEventChoice(noEvent, "p1", "free-gold", R.createRng(1)), "event-not-drawn");
  // 反例：不在事件阶段也能选 = 商店里点一下白拿收益。
  rejects("商店阶段选事件", R.eventOptionsFor(newMatch(77).state, "p1"), "wrong-phase");
  rejects("不存在的选项 id", R.applyEventChoice(eventState("model-arms-race").state, "p1", "nope", R.createRng(2)), "option-unavailable");

  // 回血（补给站 3 金 / 15 血，§2.3b）：回血封顶 100，别出现 105 血。
  const hurt = eventState("supply-drop", { hp: 70, gold: 10 });
  const healed = must("回 15 血", R.applyEventChoice(hurt.state, "p1", "heal", hurt.rng));
  eq("70 → 85 血", find(healed.state, "p1").hp, 85);
  eq("回血扣 3 金", find(healed.state, "p1").gold, 7);
  const nearlyFull = eventState("supply-drop", { hp: 95, gold: 10 });
  const capped = must("回血封顶", R.applyEventChoice(nearlyFull.state, "p1", "heal", nearlyFull.rng));
  eq("95 + 15 封顶 100", find(capped.state, "p1").hp, 100);

  // 道具上限 +1（补给站 5 金：每角色 3→4 张，G4 §3 起这条事件效果改挂在道具上 ——
  // 背包不再按种类计数，桌面角色位也不会被事件撑大，只有"每角色能挂几张"还是个可改的数）。
  const expand = eventState("supply-drop", { gold: 10 });
  eq("事件之前：每角色 3 张（§3）", R.itemLimitOf(find(expand.state, "p1")), 3);
  const expanded = must("道具上限 +1", R.applyEventChoice(expand.state, "p1", "bag-expand", expand.rng));
  eq("道具上限 3→4（§2.3b）", R.itemLimitOf(find(expanded.state, "p1")), 4);

  // 免费刷新券 ×2（补给站免费项）。
  const coupon = eventState("supply-drop");
  const coupons = must("领免费刷新券", R.applyEventChoice(coupon.state, "p1", "free-refresh", coupon.rng));
  eq("免费刷新券 ×2", find(coupons.state, "p1").buffs.freeRefreshes, 2);

  // 下一回合出片费减半 / 下一回合两段 / 本回合提示词上限 +50%（灵感爆发、模型军备）。
  const half = eventState("model-arms-race", { gold: 10 });
  const halfApplied = must("下一回合半价", R.applyEventChoice(half.state, "p1", "half-next", half.rng));
  eq("半价增益记下", find(halfApplied.state, "p1").buffs.nextRoundCostHalf, true);
  eq("生成层读半价只走 filmCostMultiplier", R.filmCostMultiplier(find(halfApplied.state, "p1")), 0.5);
  const twoShots = eventState("inspiration-burst", { gold: 10 });
  const shots = must("下一回合两段", R.applyEventChoice(twoShots.state, "p1", "double-shoot", twoShots.rng));
  eq("下一回合可出 2 段", R.segmentsAllowed(find(shots.state, "p1")), 2);
  const prompt = eventState("inspiration-burst", { gold: 10 });
  const promptApplied = must("提示词上限 +50%", R.applyEventChoice(prompt.state, "p1", "long-prompt", prompt.rng));
  eq("提示词上限增益 50", R.promptLimitBonusPct(find(promptApplied.state, "p1")), 50);

  // 随机一张蓝卡（灵感爆发免费项）：品质必须 3。
  const blue = eventState("inspiration-burst", { gold: 0 });
  const blueApplied = must("随机一张蓝卡", R.applyEventChoice(blue.state, "p1", "free-blue-card", blue.rng));
  const blueBag = find(blueApplied.state, "p1").bag;
  eq("随机卡进背包", blueBag.length, 1);
  eq("随机卡是 3 费（蓝卡）", blueBag[0].quality, 3);
  // 反例：背包满还硬发 = 卡被静默丢掉（玩家看不到、仓库里也没有）。
  const fullForBlue = eventState("inspiration-burst", { gold: 0, bag: Array.from({ length: 9 }, (_, i) => card(`f${i}`, "item")) });
  const fullForBlueBefore = show(fullForBlue.state);
  ok("随机蓝卡不再会因为背包满失败（背包不限量）", R.applyEventChoice(fullForBlue.state, "p1", "free-blue-card", fullForBlue.rng).ok === true);
  unchanged("随机卡发不下来时整项不改状态", fullForBlue.state, JSON.parse(fullForBlueBefore));

  // 时效增益在「这一回合结束」时清掉；免费刷新券不过期（§2.3b 的「下一回合 / 本回合」语义）。
  const timed = withPlayer(
    { ...newMatch(78).state, phase: "voting", round: 3 },
    "p1",
    {
      buffs: { nextRoundCostHalf: true, nextRoundSegments: 2, promptLimitPct: 50, freeRefreshes: 2 },
    },
  );
  const timedSettle = must("带时效增益结算", R.settleRound(timed, IDS, R.createRng(79))).state;
  eq("半价只保一回合", find(timedSettle, "p1").buffs.nextRoundCostHalf, false);
  eq("两段只保一回合", R.segmentsAllowed(find(timedSettle, "p1")), 1);
  eq("提示词上限只保一回合", R.promptLimitBonusPct(find(timedSettle, "p1")), 0);
  eq("免费刷新券不过期", find(timedSettle, "p1").buffs.freeRefreshes, 2);
}

// ────────────────────────────── 8. 回合结算：扣血 20/15/10/5、缩放、淘汰（§2.5） ──────────────────────────────

{
  eq("4 人局最后一名 -20", R.damageForRank(4, 0), 20);
  eq("4 人局倒数第二 -15", R.damageForRank(4, 1), 15);
  eq("4 人局倒数第三 -10", R.damageForRank(4, 2), 10);
  eq("4 人局其余 -5", R.damageForRank(4, 3), 5);
  eq("3 人局按 3/4 缩放（向下取 5）：15/10/5", [R.damageForRank(3, 0), R.damageForRank(3, 1), R.damageForRank(3, 2)], [15, 10, 5]);
  eq("2 人局按 2/4 缩放：10/5", [R.damageForRank(2, 0), R.damageForRank(2, 1)], [10, 5]);
  eq("4 人局第一名 -5（其余也掉血）", R.damageForRank(4, 3), 5);
  eq("名次前一半算胜（4 人：1/2 名）", [R.streakOutcomeOf(4, 0), R.streakOutcomeOf(4, 1), R.streakOutcomeOf(4, 2), R.streakOutcomeOf(4, 3)], ["win", "win", "lose", "lose"]);
  eq("3 人局前 2 算胜", [R.streakOutcomeOf(3, 1), R.streakOutcomeOf(3, 2)], ["win", "lose"]);

  const match = newMatch(81);
  const voting = { ...match.state, phase: "voting" };
  const before = show(voting);
  const settled = must("4 人局结算", R.settleRound(voting, IDS, match.rng));
  eq("扣血按名次排：第 1 名 -5 … 最后一名 -20（§2.5）", settled.summary.damages.map((d) => d.damage), [5, 10, 15, 20]);
  eq("名次从好到差", settled.summary.damages.map((d) => [d.rank, d.playerId]), [[1, "p1"], [2, "p2"], [3, "p3"], [4, "p4"]]);
  eq("血量 95/90/85/80", settled.summary.damages.map((d) => d.hpAfter), [95, 90, 85, 80]);
  eq("没人被淘汰", settled.summary.eliminated, []);
  eq("还剩 4 个人", settled.summary.alive.length, 4);
  eq("4 个人还在不给胜者", settled.summary.winners, []);
  eq("胜负：前 2 名连胜 +1", [find(settled.state, "p1").winStreak, find(settled.state, "p2").winStreak], [1, 1]);
  eq("胜负：后 2 名连败 +1", [find(settled.state, "p3").loseStreak, find(settled.state, "p4").loseStreak], [1, 1]);
  eq("第 1 回合结算后 phase 是 round-end", settled.state.phase, "round-end");
  unchanged("结算不改入参（纯函数）", voting, JSON.parse(before));

  // 淘汰：hp 扣到 0 就出局，且夹到 0（不出现 -15 血）。
  const doomed = withPlayer(voting, "p4", { hp: 10 });
  const doomedSettle = must("淘汰结算", R.settleRound(doomed, IDS, R.createRng(82)));
  eq("最后一个 -20 直接打到 0", find(doomedSettle.state, "p4").hp, 0);
  eq("hp 夹到 0 不是 -10", find(doomedSettle.state, "p4").hp >= 0, true);
  eq("p4 淘汰（§2.5）", find(doomedSettle.state, "p4").eliminated, true);
  eq("淘汰名单", doomedSettle.summary.eliminated, ["p4"]);
  eq("淘汰后剩 3 人", doomedSettle.summary.alive, ["p1", "p2", "p3"]);
  eq("4 人局第 1 回合还不结束", doomedSettle.state.phase, "round-end");

  // 3 人局缩放：p4 早就淘汰，排名 3 个人 → 15/10/5。
  const three = withPlayer(voting, "p4", { eliminated: true, hp: 0 });
  const threeSettle = must("3 人局结算", R.settleRound(three, ["p1", "p2", "p3"], R.createRng(83)));
  eq("3 人局扣血按名次排 5/10/15（人少按比例缩放）", threeSettle.summary.damages.map((d) => d.damage), [5, 10, 15]);

  // 2 人局缩放（理论上打不到这里，公式仍要能对）。
  const two = withPlayer(withPlayer(voting, "p3", { eliminated: true, hp: 0 }), "p4", { eliminated: true, hp: 0 });
  const twoSettle = must("2 人局结算", R.settleRound(two, ["p1", "p2"], R.createRng(84)));
  eq("2 人局扣血按名次排 5/10", twoSettle.summary.damages.map((d) => d.damage), [5, 10]);

  // 剩下 2 人 → 两名胜者，phase over（§2.5）。
  const almost = withPlayer(voting, "p4", { eliminated: true, hp: 0 });
  const finisher = withPlayer(almost, "p3", { hp: 10 });
  const finishSettle = must("打到剩 2 人", R.settleRound(finisher, ["p1", "p2", "p3"], R.createRng(85)));
  eq("剩 2 人时给胜者（§2.5）", finishSettle.summary.winners.sort(), ["p1", "p2"]);
  eq("剩 2 人后本局结束", finishSettle.state.phase, "over");
  eq("结束时不抽事件", finishSettle.state.currentEventId, null);

  // 同归于尽：2 人残血同时被扣到 0 = 平局（胜者空，不许凭空发一个冠军）。
  const bothLow = withPlayer(withPlayer(two, "p1", { hp: 5 }), "p2", { hp: 5 });
  const drawSettle = must("两人同归于尽", R.settleRound(bothLow, ["p1", "p2"], R.createRng(86)));
  eq("同归于尽 = 0 人存活", drawSettle.summary.alive, []);
  eq("平局不给胜者", drawSettle.summary.winners, []);

  // 打满 8 回合（§5-2）：血最多的两名胜出（设计稿没写打满怎么挑，这是规则层拍的，报告里单列）。
  const lastRound = withPlayer(
    withPlayer(withPlayer(withPlayer({ ...voting, round: 8 }, "p1", { hp: 90 }), "p2", { hp: 80 }), "p3", { hp: 70 }), "p4", { hp: 60 },
  );
  const cappedSettle = must("打满 8 回合", R.settleRound(lastRound, ["p3", "p4", "p1", "p2"], R.createRng(87)));
  eq("第 8 回合结算后本局结束（§5-2）", cappedSettle.state.phase, "over");
  // 排名 p3 第 1 / p4 第 2 / p1 第 3 / p2 最后：掉血后 p1 75、p3 65 最高。
  eq("打满 8 回合取血最多的两名", cappedSettle.summary.winners, ["p1", "p3"]);

  // 名次校验：少人 / 多人 / 重复 / 陌生人 / 已淘汰的人 —— 全都整份拒。
  // 反例：名次少一个人时静默按数组顺序算 = 后面的人全体错位扣血，而游戏不会报错。
  rejects("名次少一个人", R.settleRound(voting, ["p1", "p2", "p3"], match.rng), "ranking-mismatch");
  rejects("名次多一个人", R.settleRound(voting, [...IDS, "p5"], match.rng), "ranking-mismatch");
  rejects("名次重复", R.settleRound(voting, ["p1", "p1", "p3", "p4"], match.rng), "ranking-mismatch");
  rejects("名次里有陌生人", R.settleRound(voting, ["p1", "p2", "p3", "nobody"], match.rng), "ranking-mismatch");
  rejects("名次里混进已淘汰的人", R.settleRound(withPlayer(voting, "p4", { eliminated: true }), IDS, match.rng), "ranking-mismatch");
  // 反例：不在投票阶段也能结算 = 商店点一下就把血扣了。
  rejects("商店阶段结算", R.settleRound(match.state, IDS, match.rng), "wrong-phase");
}

// ────────────────────────────── 9. 胜负：剩下 ≤2 人给出胜者列表（§2.5） ──────────────────────────────

{
  const match = newMatch(91);
  const threeAlive = withPlayer(match.state, "p4", { eliminated: true, hp: 0 });
  // 反例：3 个人还在就宣布两名胜者 = 第三个人的本期结算被跳过。
  eq("3 人存活时不给胜者", R.winnersOf(threeAlive), []);
  const twoAlive = withPlayer(threeAlive, "p3", { eliminated: true, hp: 0 });
  eq("2 人存活时两人都是胜者（§2.5）", R.winnersOf(twoAlive).sort(), ["p1", "p2"]);
  eq("2 人存活 = 本局结束", R.isGameOver(twoAlive), true);
  eq("3 人存活 + 没打满 = 未结束", R.isGameOver(threeAlive), false);
  eq("打满 8 回合 = 结束（§5-2）", R.isGameOver({ ...threeAlive, round: R.MAX_ROUNDS }), true);
  // 1 人存活（另外 3 个同一期全灭）：剩下的人就是胜者。
  const lastOne = withPlayer(withPlayer(withPlayer(match.state, "p2", { eliminated: true }), "p3", { eliminated: true }), "p4", { eliminated: true });
  eq("只剩 1 人时那 1 个是胜者", R.winnersOf(lastOne), ["p1"]);
  // 打满 8 回合时按血量取两名（同血看金币，再同按 id 定序）。
  const capped = withPlayer(
    withPlayer(withPlayer(withPlayer({ ...match.state, round: R.MAX_ROUNDS }, "p1", { hp: 50 }), "p2", { hp: 90 }), "p3", { hp: 80 }), "p4", { hp: 70 },
  );
  eq("打满 8 回合取血最多的两名", R.winnersOf(capped), ["p2", "p3"]);
  eq("0 人存活不给胜者（平局）", R.winnersOf(withPlayer(match.state, "p1", { eliminated: true })), []);
}

// ────────────────────────────── 10. 阶段机（§2.0 的 ①②③④） ──────────────────────────────

{
  const match = newMatch(101);
  rejects("商店阶段直接进投票", R.enterVoting(match.state), "wrong-phase");
  const created = must("商店 → 创作", R.enterCreation(match.state)).state;
  eq("创作阶段", created.phase, "create");
  rejects("创作阶段直接投票", R.enterVoting(created), "wrong-phase");
  // 创作阶段一片都没交就进不了展映（§2.0 ③ 播的是全员的作品）：这条闸的回执由界面说人话。
  rejects("没交片就进不了展映", R.enterScreening(created), "entries-pending");
  const screened = must("创作 → 展映", R.enterScreening(submitAll(created))).state;
  eq("展映阶段", screened.phase, "screening");
  const voted = must("展映 → 投票", R.enterVoting(screened)).state;
  eq("投票阶段", voted.phase, "voting");
  // 反例：投票阶段再进一次投票 = 阶段机可以原地打转，回合循环会卡住。
  rejects("投票阶段再进投票", R.enterVoting(voted), "wrong-phase");
  rejects("选风格阶段开商店", R.beginRound(R.createGame(IDS, R.createRng(102)), R.createRng(102)), "wrong-phase");

  // 还有人没交片：只差一个人也不能进（一个人没片 = 这一期少一张榜）
  const oneMissing = R.createGame(IDS, R.createRng(103));
  let three = oneMissing;
  for (const id of IDS) three = must(`选风格 ${id}`, R.pickStyleCard(three, id, find(three, id).styleChoices[0])).state;
  three = must("开第一回合", R.beginRound(three, R.createRng(103))).state;
  three = must("进创作", R.enterCreation(three)).state;
  for (const id of ["p1", "p2", "p3"]) three = must(`交片 ${id}`, R.submitRoundEntry(three, id, { prompt: "only three" })).state;
  const almost = R.enterScreening(three);
  rejects("只差一个人交片也不能开始展映", almost, "entries-pending");
  eq("缺口人数报给界面（count）", almost.count, 1);
  eq("缺口人数组的上限（cap）", almost.cap, 4);
}

// ────────────────────────────── 11. 创作 / 展映 / 点赞 / 投票 / 榜单（§2.4 / §2.5，G3） ──────────────

{
  eq("占位视频固定 5 秒（§2.4）", R.VIDEO_SECONDS, 5);
  eq("提示词基础上限 80 字（§2.4）", R.PROMPT_BASE_MAX, 80);
  // 反例：三个虚框那套（SLOT_TYPES）还在 = G4 第 3 步没删干净（摆卡改成桌面 5 个卡位了）。
  eq("没有 SLOT_TYPES 了（虚框随桌面卡位一起撤）", "SLOT_TYPES" in R, false);

  /**
   * 4 人局走到创作阶段：p1 桌上摆好 1 角色 + 1 场景、身上挂 1 件道具（一期作品的卡从桌面派生）。
   * ★ G4 第 3 步起**卡不由调用方递进交片接口**，所以夹具必须先把卡摆到桌上（placeCardOnTable）。
   */
  function createPhase(seed) {
    const match = newMatch(seed);
    let state = match.state;
    state = withBag(state, "p1", [card("c-r", "role", 5), card("c-s", "scene", 3), card("c-i", "item", 2)]);
    state = withBag(state, "p2", [card("d-r", "role", 1)]);
    state = must("进创作", R.enterCreation(state)).state;
    state = must("夹具：角色上桌", R.placeOnTable(state, "p1", "c-r", { kind: "role", index: 0 })).state;
    state = must("夹具：场景上桌", R.placeOnTable(state, "p1", "c-s", { kind: "scene" })).state;
    state = must("夹具：道具挂上", R.equipItem(state, "p1", "c-r", "c-i")).state;
    return { state, rng: match.rng };
  }

  const { state: createA } = createPhase(111);
  const submitted = must("交片：桌面的卡 + 一句提示词", R.submitRoundEntry(createA, "p1", { prompt: "  雨夜回头  " })).state;
  const mine = R.entryOfPlayer(submitted, "p1");
  eq("作品 id 是 r<回合>-<玩家>（稳定，不靠下标）", mine.id, R.roundEntryId(1, "p1"));
  eq("提示词去掉首尾空白再存", mine.prompt, "雨夜回头");
  eq("占位视频时长 = rules 的 5 秒（没出片时）", mine.seconds, R.VIDEO_SECONDS);
  eq("作品记下风格卡（出片整局带这套）", mine.styleCardId, find(submitted, "p1").styleCardId);
  // ★ 一期作品的卡 = 桌面上的卡 + 挂在角色身上的道具（rules.castCardsOf 一处派生）
  eq(
    "作品里的卡 = 桌面（角色 + 场景）+ 装备的道具",
    mine.cards.map((c) => c.id).sort(),
    ["c-i", "c-r", "c-s"],
  );
  eq("空镜也能交片（桌上没卡 —— 不然没卡的玩家出不去创作阶段）", must("空镜交片", R.submitRoundEntry(createA, "p2", { prompt: "空镜" })).entry.cards, []);
  eq("交片后作品进了本期名单", R.entryOfPlayer(submitted, "p1") !== null, true);
  eq("别人没交就是 null（不是空对象）", R.entryOfPlayer(submitted, "p3"), null);

  // 真出片那一发：videoUrl / seconds 由界面（game/gen）传进来，展映屏放的就是它。
  const withVideo = must("交一条真出片的", R.submitRoundEntry(createA, "p1", { prompt: "出片了", videoUrl: "https://cdn.example/x.mp4", seconds: 5 })).entry;
  eq("真出片记下地址", withVideo.videoUrl, "https://cdn.example/x.mp4");
  eq("时长用出片那一发给的", withVideo.seconds, 5);

  // 重交：作品 id 不变、名单不涨（创作阶段改词重摆不花钱）
  const resubmitted = must("重交", R.submitRoundEntry(submitted, "p1", { prompt: "重拍一次" })).state;
  eq("重交只留一条作品（同 id 覆盖）", resubmitted.entries.length, 1);
  eq("重交把提示词换掉", R.entryOfPlayer(resubmitted, "p1").prompt, "重拍一次");
  // 重摆卡之后重交：作品里的卡跟着桌面走（不是交片那一刻的旧快照）
  let reTable = withBag(submitted, "p1", R.ownedCards(find(submitted, "p1")).concat([card("c-r2", "role", 4)]));
  // 带道具的角色不能被顶掉（role-equipped）：先拆道具再换人
  reTable = must("重交夹具：拆道具", R.unequipAll(reTable, "p1", "c-r")).state;
  reTable = must("重交夹具：换人", R.placeOnTable(reTable, "p1", "c-r2", { kind: "role", index: 0 })).state;
  const reSubmitted = must("重交（换过桌上的卡）", R.submitRoundEntry(reTable, "p1", { prompt: "再来一次" })).state;
  // 道具已经拆回背包了，所以这一份只剩桌上的角色 + 场景
  eq("重交后卡换成桌上那一份", R.entryOfPlayer(reSubmitted, "p1").cards.map((c) => c.id).sort(), ["c-r2", "c-s"]);

  // 反例：提示词是玩家自己写的，空着就不知道这一期拍什么（不给"默认提示词"兜底 —— 那是在替玩家做决定）
  rejects("提示词空着不能交片", R.submitRoundEntry(createA, "p1", { prompt: "   " }), "prompt-empty");
  const longPrompt = "字".repeat(R.PROMPT_BASE_MAX + 1);
  const tooLong = R.submitRoundEntry(createA, "p1", { prompt: longPrompt });
  rejects("提示词超上限不能交片", tooLong, "prompt-too-long");
  eq("提示词上限报给界面（cap）", [tooLong.cap, tooLong.have], [R.PROMPT_BASE_MAX, R.PROMPT_BASE_MAX + 1]);
  eq("正好顶到上限可以交", R.submitRoundEntry(createA, "p1", { prompt: "字".repeat(R.PROMPT_BASE_MAX) }).ok, true);
  // 事件「灵感爆发」的 +50% 走 promptLimitOf 一处（别在界面里再乘一遍）
  const inspired = withPlayer(createA, "p1", { buffs: { ...find(createA, "p1").buffs, promptLimitPct: 50 } });
  eq("灵感爆发 +50% → 120 字上限（rules.promptLimitOf）", R.promptLimitOf(find(inspired, "p1")), 120);
  rejects("商店阶段不能交片", R.submitRoundEntry(newMatch(117).state, "p1", { prompt: "x" }), "wrong-phase");
  rejects("已淘汰的人不能交片", R.submitRoundEntry(withPlayer(createA, "p4", { eliminated: true }), "p4", { prompt: "x" }), "player-eliminated");
  rejectUnknownPlayer: {
    rejects("不在这一局的人不能交片", R.submitRoundEntry(createA, "nobody", { prompt: "x" }), "unknown-player");
  }


  // ── 展映顺序（§2.5：上一期综合名次倒序，落后先放） ──
  let screen = createA;
  for (const id of IDS) screen = must(`全员交片 ${id}`, R.submitRoundEntry(screen, id, { prompt: `shot ${id}` })).state;
  eq("第 1 回合没有上一期名次：按座位表", R.screeningOrderOf(screen).map((e) => e.playerId), IDS);
  screen = must("进参展", R.enterScreening(screen)).state;
  screen = must("进投票", R.enterVoting(screen)).state;
  // 让 p4 全票第一、p3 第二、p2 第三、p1 最后（投票给除自己外的第一条）
  const votable = R.screeningOrderOf(screen);
  for (const id of IDS) {
    const target = votable.find((entry) => entry.playerId !== id);
    screen = must(`投票 ${id}`, R.voteEntry(screen, id, target.id)).state;
  }
  eq("全员表态后没有待投的人", R.votesPendingOf(screen), []);
  const settled = must("从票数结算", R.settleRoundFromVotes(screen, R.createRng(112)));
  eq("结算回执带着两个榜（点赞榜 + 投票榜）", [settled.tally.likeBoard.length, settled.tally.voteBoard.length], [4, 4]);
  eq("结算把本期名次记进 lastRanking（下一期展映倒序读它）", settled.state.lastRanking, settled.tally.ranking);
  const nextRound = must("下一回合开张", R.beginRound(settled.state, R.createRng(113))).state;
  eq("换回合清掉上一期的作品", nextRound.entries, []);
  eq("换回合清掉上一期的弃权", nextRound.abstained, []);
  eq("换回合保留上一期名次（展映顺序要用）", nextRound.lastRanking, settled.tally.ranking);
  let nextCreate = must("下一回合进创作", R.enterCreation(nextRound)).state;
  for (const id of IDS) nextCreate = must(`第 2 回合交片 ${id}`, R.submitRoundEntry(nextCreate, id, { prompt: `shot2 ${id}` })).state;
  eq(
    "第 2 回合按上一期名次倒序播（落后先放）",
    R.screeningOrderOf(nextCreate).map((e) => e.playerId),
    [...settled.tally.ranking].reverse(),
  );

  // ── 点赞（§2.5 播放中可点，一条一次） ──
  const likePhase = must("第 2 回合进参展", R.enterScreening(nextCreate)).state;
  const p1Entry = R.entryOfPlayer(likePhase, "p1");
  rejects("创作阶段还不能点赞", R.likeEntry(createA, "p1", p1Entry.id), "wrong-phase");
  const liked = must("给 p1 那条点赞", R.likeEntry(likePhase, "p2", p1Entry.id)).state;
  eq("点赞数落在作品上", R.entryById(liked, p1Entry.id).likedBy, ["p2"]);
  rejects("同一个人对同一条只能点一次", R.likeEntry(liked, "p2", p1Entry.id), "entry-already-liked");
  eq("自己也可以点自己那条（§2.5 只写\"任何人可点赞\"）", must("自赞", R.likeEntry(liked, "p1", p1Entry.id)).ok, true);
  rejects("给不存在的作品点赞", R.likeEntry(likePhase, "p2", "r2-nobody"), "entry-not-found");
  rejects("不在这一局的人点赞", R.likeEntry(likePhase, "nobody", p1Entry.id), "unknown-player");

  // ── 投票（§2.5：不能投自己、一人一票、可弃权） ──
  const votePhase = must("进投票", R.enterVoting(likePhase)).state;
  const roundNo = votePhase.round;
  rejects("不能投自己", R.voteEntry(votePhase, "p1", p1Entry.id), "self-vote");
  rejects("给不存在的作品投票", R.voteEntry(votePhase, "p1", R.roundEntryId(roundNo, "nobody")), "entry-not-found");
  rejects("展映阶段还不能投票", R.voteEntry(likePhase, "p1", R.roundEntryId(roundNo, "p2")), "wrong-phase");
  const votedOnce = must("投票给 p2", R.voteEntry(votePhase, "p1", R.roundEntryId(roundNo, "p2"))).state;
  rejects("一人一票", R.voteEntry(votedOnce, "p1", R.roundEntryId(roundNo, "p3")), "already-voted");
  rejects("投完不能再弃权", R.abstainVote(votedOnce, "p1"), "already-voted");
  const abstainedState = must("弃权", R.abstainVote(votePhase, "p1")).state;
  eq("弃权记在 abstained 上", abstainedState.abstained, ["p1"]);
  rejects("弃权后也不能再投", R.voteEntry(abstainedState, "p1", R.roundEntryId(roundNo, "p2")), "already-voted");
  eq("还差几个人表态（votesPendingOf，弃权也算表过态）", R.votesPendingOf(abstainedState), ["p2", "p3", "p4"]);
  eq("一个人都没表态时待投 4 人", R.votesPendingOf(votePhase), IDS);
  const pendingSettle = R.settleRoundFromVotes(abstainedState, R.createRng(114));
  rejects("有人没投票不能结算", pendingSettle, "votes-pending");
  eq("待投人数报给界面（count / cap）", [pendingSettle.count, pendingSettle.cap], [3, 4]);

  // ── 两个榜 + 综合名次（§2.5「名次相加、并列看投票」） ──
  // 手造一份：点赞 p1=3 p2=2 p3=1 p4=0；投票 p4=2 p1=1 p3=1 p2=0
  const boardState = {
    ...nextCreate,
    entries: IDS.map((id, index) => ({
      id: R.roundEntryId(nextCreate.round, id),
      round: nextCreate.round,
      playerId: id,
      cards: [],
      prompt: `b ${id}`,
      styleCardId: null,
      seconds: R.VIDEO_SECONDS,
      likedBy: IDS.slice(0, [3, 2, 1, 0][index]),
      votedBy: id === "p1" ? ["p4"] : id === "p2" ? [] : id === "p3" ? ["p1"] : ["p2", "p3"],
    })),
  };
  const tally = R.tallyRound(boardState);
  const row = (id) => tally.entries.find((e) => e.playerId === id);
  eq("点赞数从作品上数", IDS.map((id) => row(id).likes), [3, 2, 1, 0]);
  eq("投票数从作品上数", IDS.map((id) => row(id).votes), [1, 0, 1, 2]);
  eq("点赞榜名次 1/2/3/4", IDS.map((id) => row(id).likeRank), [1, 2, 3, 4]);
  eq("投票榜：并列拿同一个名次（2,1,1,0 票 → p4 第 1、p1/p3 并列第 2、p2 第 4）", IDS.map((id) => row(id).voteRank), [2, 4, 2, 1]);
  eq("总分 = 两个榜名次相加", IDS.map((id) => row(id).score), [3, 6, 5, 5]);
  eq("综合名次：总分并列时看投票榜（p4 与 p3 都是 5 分，p4 的投票榜更好）", tally.ranking, ["p1", "p4", "p3", "p2"]);
  eq("综合名次不并列（扣血要唯一解）", new Set(tally.entries.map((e) => e.rank)).size, 4);
  eq("点赞榜按条数排（p1 3 > p2 2 > p3 1 > p4 0）", tally.likeBoard, IDS.map((id) => R.roundEntryId(nextCreate.round, id)));
  eq("投票榜按票数排（p4 2 > p1/p3 1 > p2 0）", tally.voteBoard.map((entryId) => boardState.entries.find((e) => e.id === entryId).playerId), ["p4", "p1", "p3", "p2"]);
  // 并列同名次：2,2,1 → 1,1,3（竞赛排名）
  const tieState = {
    ...boardState,
    entries: boardState.entries.map((entry, index) => ({ ...entry, likedBy: IDS.slice(0, [2, 2, 1, 0][index]) })),
  };
  eq("点赞并列拿同名次（2,2,1,0 → 1,1,3,4）", IDS.map((id) => R.tallyRound(tieState).entries.find((e) => e.playerId === id).likeRank), [1, 1, 3, 4]);
  eq("两个榜都并列时按 playerId 定序（结算要确定）", R.tallyRound({ ...boardState, entries: boardState.entries.map((entry) => ({ ...entry, likedBy: [], votedBy: [] })) }).ranking, IDS);

  // 从票数结算：名次直接影响扣血（4 人局 5/10/15/20）
  const fullVoted = { ...boardState, phase: "voting", abstained: [] };
  for (const id of IDS) {
    const target = IDS.filter((other) => other !== id)[0];
    // 用 entry 投票：p1→p2 / p2→p1 / p3→p1 / p4→p1 造一个明确的榜
    const entryId = R.roundEntryId(nextCreate.round, id === "p1" ? "p2" : "p1");
    fullVoted.entries = fullVoted.entries.map((entry) => (entry.id === entryId ? { ...entry, votedBy: [...entry.votedBy, id] } : entry));
  }
  const finalSettle = must("从票数结算出扣血", R.settleRoundFromVotes(fullVoted, R.createRng(115)));
  eq("名次与扣血同序（第 1 名 -5 … 最后一名 -20）", finalSettle.summary.damages.map((d) => [d.rank, d.damage]), [[1, 5], [2, 10], [3, 15], [4, 20]]);
  eq("榜单名次与结算名次是同一份", finalSettle.summary.ranking, finalSettle.tally.ranking);
  eq("扣血落在血上（100 → 95）", find(finalSettle.state, finalSettle.tally.ranking[0]).hp, find(boardState, finalSettle.tally.ranking[0]).hp - 5);
  rejects("不在投票阶段不能从票数结算", R.settleRoundFromVotes(boardState, R.createRng(116)), "wrong-phase");
}

// ────────────────────────────── 汇总 ──────────────────────────────

if (problems.length) {
  console.error(`\n❌ 工坊对局规则检查没过（${problems.length} 条问题 / 共 ${positive + negative} 条断言）：\n`);
  for (const p of problems) console.error(`   - ${p}\n`);
  process.exit(1);
}
console.log(`✓ 工坊对局规则检查通过：${positive + negative} 条断言（正例 ${positive} / 反例 ${negative}），规则 module = ${path.relative(root, modPath).split(path.sep).join("/")}`);
