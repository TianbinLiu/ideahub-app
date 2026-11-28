#!/usr/bin/env node
// 构建门禁：对局**流程机 + 三机位**（2026-11-28，主人点名的相机与流程这一轮）。
//
// ★★ 为什么必须有这一道：这一轮改的两件事**错了都不报错**——
//   · 第 1 轮不开商店：改错时界面上只是"第一轮商店栏又自动弹出来了"，只有对着屏幕看才发现；
//     而 `finishStyle` / `nextRound` / 联机重连三条路各写一次 `shopOpen: true` 时，改一处漏两处。
//   · 相机：三机位参数 / 过渡时长 / 环视上限 / 点 NPC 的距离全是数，写错只会表现为"镜头有点怪"；
//     自由环视不在商店时还接着手势，症状是"俯视桌面拖一下视角歪了"（没有报错、没有红字）。
//   所以这里跟 rules / phases 的检查同一条纪律：**import 线上那一份纯模块**（matchFlow / gameCamSpec），
//   正反例实跑；接线（React 那一半）用源码断言钉住，不重写一遍逻辑。
//
// 用法：node scripts/check-game-matchflow.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(url.pathToFileURL(path.join(root, rel)).href);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const M = await load("src/studio/game/matchFlow.ts");
const C = await load("src/studio/scene/gameCamSpec.ts");

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
const near = (label, got, want, eps = 1e-6) => {
  positive += 1;
  if (!(Math.abs(got - want) <= eps)) fail(`${label}: want ${want}±${eps} got ${got}`);
};

// ── 1. 阶段名与顺序（主人给的那条链）─────────────────────────────────────────
console.log("1) 流程阶段（MATCH_STAGES / INITIAL_MATCH_FLOW）");
{
  eq("阶段顺序逐字是主人给的那条链", M.MATCH_STAGES, [
    "matching",
    "stylePick",
    "table",
    "shop",
    "placing",
    "generating",
    "waiting",
    "voting",
    "leaderboard",
    "nextPhase",
  ]);
  eq("一开始是 matching（还没建局，镜头归大厅）", M.INITIAL_MATCH_FLOW, { stage: "matching", phaseIndex: 0 });
  eq("匹配完成 → stylePick（全屏浮层）", M.matchFlowAfterStart(), { stage: "stylePick", phaseIndex: 0 });
  eq("round 1 → phaseIndex 0（1 起始减 1）", M.phaseIndexOf(1), 0);
  eq("round 2 → phaseIndex 1", M.phaseIndexOf(2), 1);
  eq("坏值（NaN）不把 NaN 传给镜头", M.phaseIndexOf(Number.NaN), 0);
  eq("负数也夹到 0", M.phaseIndexOf(-3), 0);
}

// ── 2. 第 1 轮不开商店（★★ 主人点名）──────────────────────────────────────
console.log("2) 第 1 轮不自动开商店（shopAutoOpen）");
{
  eq("第 1 期（phaseIndex 0）不自动开", M.shopAutoOpen(0), false);
  eq("第 2 期自动开（回合间要买卡）", M.shopAutoOpen(1), true);
  eq("第 3 期起继续自动开", M.shopAutoOpen(2), true);
  eq("负数不当成第 1 期之后", M.shopAutoOpen(-1), false);
}

// ── 3. 商店开关幂等（连点 / StrictMode 双跑不抖）────────────────────────────
console.log("3) 商店开关（setShopOpen / canToggleShop）");
{
  const table = { stage: "table", phaseIndex: 0 };
  const shop = M.setShopOpen(table, true);
  eq("桌面 → 商店", shop.stage, "shop");
  ok("已经是商店再开：**同一个对象**（引用不变 = 订阅不重渲 = 不抖）", M.setShopOpen(shop, true) === shop);
  const back = M.setShopOpen(shop, false);
  eq("商店 → 桌面", back.stage, "table");
  ok("已经是桌面再关：同一个对象", M.setShopOpen(table, false) === table);
  for (const stage of ["matching", "stylePick", "placing", "generating", "waiting", "voting", "leaderboard", "nextPhase"]) {
    const flow = { stage, phaseIndex: 3 };
    eq(`${stage} 里商店开关是空操作`, M.setShopOpen(flow, true).stage, stage);
  }
  eq("table / shop 两格可以开", [M.canToggleShop("table"), M.canToggleShop("shop")], [true, true]);
  eq("其余格不许开", ["placing", "generating", "waiting", "voting", "leaderboard"].map(M.canToggleShop), [false, false, false, false, false]);
}

// ── 4. 规则阶段 → 流程阶段（store 的唯一同步点）──────────────────────────────
console.log("4) reconcileMatchFlow（规则阶段 → 流程阶段）");
{
  const at = (phase, shopOpen = false, stage = "matching") => M.reconcileMatchFlow({ stage, phaseIndex: 0 }, { phase, shopOpen }).stage;
  eq("没有 state（没开局）→ matching", at(null), "matching");
  eq("rules style → stylePick", at("style"), "stylePick");
  eq("rules ready（我选完 AI 没选完）→ 仍是 stylePick", at("ready"), "stylePick");
  eq("rules shop + 商店栏收起 → 桌面（第 1 轮落地就这一格）", at("shop", false), "table");
  eq("rules shop + 商店栏开着 → shop", at("shop", true), "shop");
  eq("rules create → placing", at("create"), "placing");
  eq("rules screening → voting（两屏合一，投票页下一轮做）", at("screening"), "voting");
  eq("rules voting → voting", at("voting"), "voting");
  eq("rules event → leaderboard（结算占位）", at("event"), "leaderboard");
  eq("rules round-end → leaderboard", at("round-end"), "leaderboard");
  eq("rules over → leaderboard（结束屏也在这一格）", at("over"), "leaderboard");
  // generating / waiting 在 rules.phase 里看不出来（都属 create），必须保留现场
  eq("create 里正在出片：保留 generating", at("create", false, "generating"), "generating");
  eq("create 里已交片等其他人：保留 waiting", at("create", false, "waiting"), "waiting");
  eq("换期（shop）时 generating 不残留", at("shop", true, "generating"), "shop");
  ok("阶段没变时返回同一个对象（每写一次 state 不白重渲）", (() => {
    const f = { stage: "table", phaseIndex: 0 };
    return M.reconcileMatchFlow(f, { phase: "shop", shopOpen: false }) === f;
  })());
}

// ── 5. 生成 / 交片 / 投票 / 排行榜 / 下一期：能进能出（占位也要走通）──────────
console.log("5) 流程转移（generating / waiting / voting / leaderboard / nextPhase）");
{
  const placing = { stage: "placing", phaseIndex: 0 };
  const generating = M.startGenerating(placing);
  eq("placing → generating", generating.stage, "generating");
  eq("table 也能直接出片（老路径：桌面点生成）", M.startGenerating({ stage: "table", phaseIndex: 0 }).stage, "generating");
  eq("stylePick 不能直接进 generating（坏状态按不动处理）", M.startGenerating({ stage: "stylePick", phaseIndex: 0 }).stage, "stylePick");
  eq("出片结束回 placing（失败要能改词重试）", M.finishGenerating(generating).stage, "placing");
  eq("交片 → waiting", M.markSubmitted(placing).stage, "waiting");
  eq("重复交片不抖（同一个对象）", (() => {
    const w = { stage: "waiting", phaseIndex: 0 };
    return M.markSubmitted(w) === w;
  })(), true);
  eq("重交 / 改片回 placing", M.backToPlacing({ stage: "waiting", phaseIndex: 0 }).stage, "placing");
  eq("全员就绪 → voting", M.enterVoting({ stage: "waiting", phaseIndex: 0 }).stage, "voting");
  eq("投票完 → leaderboard", M.openLeaderboard({ stage: "voting", phaseIndex: 0 }).stage, "leaderboard");
  eq("关排行榜 → nextPhase", M.closeLeaderboard({ stage: "leaderboard", phaseIndex: 0 }).stage, "nextPhase");
  eq("nextPhase（第 2 期）→ shop（自动开商店）", M.advancePhase({ stage: "nextPhase", phaseIndex: 0 }, 1), { stage: "shop", phaseIndex: 1 });
  eq("nextPhase（第 1 期，理论上走不到）→ table（不开商店）", M.advancePhase({ stage: "nextPhase", phaseIndex: 0 }, 0), { stage: "table", phaseIndex: 0 });
  eq("不在 nextPhase 调 advancePhase 是空操作", M.advancePhase({ stage: "table", phaseIndex: 0 }, 1).stage, "table");
  eq("不在 leaderboard 调 close 是空操作", M.closeLeaderboard({ stage: "voting", phaseIndex: 0 }).stage, "voting");
}

// ── 6. 相机：三机位 / 限幅 / 拉近 ──────────────────────────────────────────
console.log("6) 三机位（cameraModeOf / freeLookOf / gameCamSpec）");
{
  eq("matching 镜头不归对局这一套", M.cameraModeOf("matching"), "off");
  eq("商店 = NPC 正前", M.cameraModeOf("shop"), "npcFront");
  eq("桌面 / 摆卡 / 生成 / 等待 / 投票 / 排行榜 = 固定俯视", [
    "stylePick",
    "table",
    "placing",
    "generating",
    "waiting",
    "voting",
    "leaderboard",
    "nextPhase",
  ].map(M.cameraModeOf), ["tableTop", "tableTop", "tableTop", "tableTop", "tableTop", "tableTop", "tableTop", "tableTop"]);
  eq("自由环视只有商店这一格", M.MATCH_STAGES.map((s) => [s, M.freeLookOf(s)]), [
    ["matching", false],
    ["stylePick", false],
    ["table", false],
    ["shop", true],
    ["placing", false],
    ["generating", false],
    ["waiting", false],
    ["voting", false],
    ["leaderboard", false],
    ["nextPhase", false],
  ]);

  eq("过渡上限 0.6 s", C.GAME_CAM.transitionMs, 600);
  ok("过渡时长 ≤ 主人给的上限", C.GAME_CAM.transitionMs <= 600);
  eq("NPC 正前基准距离 1.6 m", C.GAME_CAM.npcFrontDistance, 1.6);
  eq("点 NPC 拉近到 0.8 m", C.GAME_CAM.npcCloseDistance, 0.8);
  eq("距离上下限 0.8~1.6 m", [C.GAME_CAM.distanceMin, C.GAME_CAM.distanceMax], [0.8, 1.6]);
  eq("环视上限 ±6° / ±3°", [C.GAME_CAM.freeLookMaxYawDeg, C.GAME_CAM.freeLookMaxPitchDeg], [6, 3]);

  // 纯位姿：头骨 (0,1,0)、面朝 +x，站在 1.6 m 外 = (1.6,1,0) 看向 (0,1,0)
  eq("NPC 正前位姿（头 0,1,0 / 面朝 +x / 1.6 m）", C.npcFrontPose([0, 1, 0], [1, 0, 0], 1.6, 0, 0), {
    pos: [1.6, 1, 0],
    look: [0, 1, 0],
  });
  eq("拉近到 0.8 m 的位姿", C.npcFrontPose([0, 1, 0], [1, 0, 0], 0.8, 0, 0).pos, [0.8, 1, 0]);
  eq("环视偏移夹到 ±6°/±3°", (() => {
    const c = C.clampFreeLook(10, 10);
    return [Number(c.yaw.toFixed(6)), Number(c.pitch.toFixed(6))];
  })(), [Number(((6 * Math.PI) / 180).toFixed(6)), Number(((3 * Math.PI) / 180).toFixed(6))]);
  near("自由环视的 yaw 最大值就是 6°", (C.FREE_LOOK_YAW_MAX * 180) / Math.PI, 6);
  near("自由环视的 pitch 最大值就是 3°", (C.FREE_LOOK_PITCH_MAX * 180) / Math.PI, 3);
  eq("距离夹进 0.8~1.6", [C.clampNpcDistance(0.1), C.clampNpcDistance(9), C.clampNpcDistance(Number.NaN)], [0.8, 1.6, 1.6]);
  // 环视之后视线方向与"正前方"的夹角不超过 6°（垂直不超过 3°）——不是把相机转走
  const base = C.npcFrontPose([0, 1, 0], [1, 0, 0], 1.0, 0, 0);
  const turned = C.npcFrontPose([0, 1, 0], [1, 0, 0], 1.0, (6 * Math.PI) / 180, 0);
  ok("环视时相机位置不动（只转视线）", base.pos.join(",") === turned.pos.join(","));
  const dir = [turned.look[0] - turned.pos[0], turned.look[1] - turned.pos[1], turned.look[2] - turned.pos[2]];
  near("yaw 6° 后视线偏转角（相对正前方 -x）", (Math.atan2(dir[2], -dir[0]) * 180) / Math.PI, 6, 1e-6);
}

// ── 7. 接线（React 那一半：源码断言，别在检查脚本里重写一遍）────────────────
console.log("7) 接线（store / GameLayer / TableScene / TripoNpc / StudioPage）");
{
  const store = read("src/studio/game/store.ts");
  ok("store 有流程机状态", /match:\s*MatchFlowState/.test(store) && /match:\s*INITIAL_MATCH_FLOW/.test(store));
  ok("每个动作写完 state 都经 reconcileMatchFlow 同步（唯一同步点）", /reconcileMatchFlow\(prev\.match/.test(store));
  ok("finishStyle 的商店开关走 shopAutoOpen（不再硬写 true）", /shopOpen:\s*shopAutoOpen\(phaseIndexOf\(advanced\.state\.round\)\)/.test(store));
  ok("nextRound 的商店开关也走 shopAutoOpen", /shopOpen:\s*shopAutoOpen\(phaseIndexOf\(opened\.state\.round\)\)/.test(store));
  ok("toggleShop 用 setShopOpen（幂等）+ 同一目标态不写", /setShopOpen\(match, desired\)/.test(store) && /if \(next === match\) return/.test(store));
  ok("交片显式把阶段推到 waiting", /match:\s*markSubmitted\(get\(\)\.match\)/.test(store));
  ok("生成 / 结束生成两个动作在 store 里", /beginGenerating:/.test(store) && /endGenerating:/.test(store));

  const layer = read("src/studio/game/ui/GameLayer.tsx");
  ok("GameLayer 从 store.match 读阶段", /useGame\(\(s\) => s\.match\.stage\)/.test(layer));
  ok("商店栏 = 流程机的 shop 格（不再 phase + shopOpen 两处拼）", /const shopVisible = stage === "shop"/.test(layer));
  ok("风格屏 = stylePick（浮层）", /if \(stage === "stylePick"\)/.test(layer));
  ok("阶段喂给 gameCam", /setGameCamStage\(stage\)/.test(layer));
  ok("卸载时 resetGameCam（相机是模块单例，不能带进下一局）", /resetGameCam\(\)/.test(layer));
  ok(
    "不再调工坊的 enterShopCam / exitShopCam（相机归 gameCam）",
    !/getState\(\)\.(enter|exit)ShopCam\(/.test(layer),
  );

  const table = read("src/studio/scene/TableScene.tsx");
  ok("CameraRig 每帧问 gameCam 要位姿", /stepGameCam\(dt/.test(table));
  ok("对局里手势只走 gameCam（tableTop 一律不接）", /if \(gameCamActive\(\)\) return freeLookEnabled\(\)/.test(table));
  ok("单指滑屏接 gameCamLookDrag", /gameCamLookDrag\(dx, dy\)/.test(table));
  ok("捏合 / 滚轮接 gameCamZoomBy", /gameCamZoomBy\(/.test(table));

  const npc = read("src/studio/scene/TripoNpc.tsx");
  ok("对局里点 NPC = 拉近（非商店阶段什么都不做，不弹对话框）", /if \(gameCamActive\(\)\)[\s\S]{0,80}gameCamClickNpc\(\);[\s\S]{0,40}return;/.test(npc));
  // ★ 2026-11-28（模拟器验收抓到）：点 NPC 那一拍原来会先被"点商店栏外面收起"吃掉 ——
  //   商店一关，gameCamClickNpc 就变成空操作。现在两层用同一条 3D 命中探针分开。
  ok("3D 命中探针只有一条实现（scene/interactivePick）", read("src/studio/scene/interactivePick.ts").includes("export function hitInteractiveAt"));
  ok("商店的'点栏外收起'不吞 3D 物件上的点击", /hitInteractiveAt\(e\.clientX, e\.clientY\)/.test(layer));
  ok("TableCatcher 注册/归还同一条射线", /setInteractiveHitProbe\(hitAt\)/.test(table) && /setInteractiveHitProbe\(null\)/.test(table));
  // 验收探针 `__pickProbe`：只在 DEV / 显式 gsAcceptDebug 下挂（生产里不存在，与 __gsAccept 同一条约定）
  ok(
    "命中探针的验收口子只在 DEV / gsAcceptDebug 下挂",
    /__pickProbe/.test(table) && /acceptHooks[\s\S]{0,500}localStorage\.getItem\("gsAcceptDebug"\)/.test(table),
  );

  const gen = read("src/studio/game/ui/GenSheet.tsx");
  ok("出片那一发打 beginGenerating", gen.includes("beginGenerating()"));
  ok("出片结束（成功 / 失败）打 endGenerating", gen.includes("endGenerating()"));

  const studio = read("src/studio/StudioPage.tsx");
  ok("风格浮层时 3D 停帧、不卸载（canvasCovered 含 stylePick）", /stylePickCover/.test(studio) && /canvasCovered\s*=/.test(studio));
  const pick = read("src/studio/game/ui/StylePick.tsx");
  ok("风格屏是全屏浮层（absolute inset-0 + z-40）", /absolute inset-0 z-40/.test(pick));
  // ★ 2026-11-28：入场动效原先是 160 ms 的 ingame-rise（普通淡入），主人要求"复用工作流那套：波浪/淡入"
  //   —— 现在走 ui/waveReveal 的圆扩散（与工作流小窗同一份实现）。
  ok("风格屏的入场是工作流那套波浪（playWaveReveal）", pick.includes("playWaveReveal") && pick.includes("__stylePickWave"));
  ok(
    "波浪只有一份实现（工作流小窗与风格屏共用 ui/waveReveal）",
    read("src/studio/ui/WorkflowWindow.tsx").includes("playWaveReveal") && read("src/studio/ui/waveReveal.ts").includes("export function playWaveReveal"),
  );
  ok(
    "波浪参数是主人给的数（开 520 ms / 收 460 ms / reduced-motion 180 ms）",
    /WAVE_OPEN_MS = 520/.test(read("src/studio/ui/waveReveal.ts")) &&
      /WAVE_CLOSE_MS = 460/.test(read("src/studio/ui/waveReveal.ts")) &&
      /WAVE_FADE_MS = 180/.test(read("src/studio/ui/waveReveal.ts")),
  );
  // ★ 2026-11-28：gameCam 接管相机时也要过一遍取景右移 —— 否则桌面机位的 viewOffset 会带进 NPC 正前那一台。
  ok(
    "gameCam 接管时同步取景右移（NPC 正前不带桌面机位的移轴）",
    (table.match(/syncGsFrameShift\(/g) ?? []).length >= 2 && /gameCamMode\(\) === "tableTop"/.test(table),
  );
}

// ── 汇总 ───────────────────────────────────────────────────────────────────
console.log("");
if (problems.length > 0) {
  console.error(`✗ check-game-matchflow: ${problems.length} 条不通过（共 ${positive} 条断言）`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✓ check-game-matchflow: ${positive} 条断言全部通过`);
