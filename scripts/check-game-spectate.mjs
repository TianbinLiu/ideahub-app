#!/usr/bin/env node
// 构建门禁：**公开房列表 + 观战**（2026-11-24）的纯映射与"接得上"的缝。
//
// ★★ 为什么要有它：这两条路自己不会"报错"，坏法的症状全是零报错 ——
//   · 能力位读错方向：老服务端上常驻摆一张点开必 404 的卡 / 一颗点了必 404 的「观战」键；
//   · 观战屏漏摆一颗写键：观众点了没反应（服务端其实回了 403 `SPECTATOR_NOT_ALLOWED`）；
//   · 三种拒绝压成同一句"没连上"：玩家不知道该去退房 / 等席位 / 别观战；
//   · 列表把 `joinable` 自己按 members<seats 算一遍：服务端哪天改了"满员也列出来"就是两把尺。
// ★ 这里**不重写一条规则**：import 的就是线上那一份 `src/studio/game/spectate.ts`（零依赖，
//   Node 直接跑正反例）；界面接线那一段是源码断言（纯函数对了、界面不接也是白搭）。
// ★ 判据唯一实现：能力位只认 `api/game/rooms.publicRoomsAvailable / spectateAvailable`
//   （读 `data/serverCaps.serverGamePublicRooms / serverGameSpectators`，且只有 `=== true` 算有）。
//
// 用法：node scripts/check-game-spectate.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const S = await import(url.pathToFileURL(path.join(root, "src/studio/game/spectate.ts")).href);

const problems = [];
let positive = 0;
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

// ────────────────── ① 三种拒绝 / 房间没了 / 断网 → 各自的结局（纯函数实跑） ──────────────────
console.log("1) 观战的失败映射（四类错误各自一句人话）");
{
  const code = (c, extra = {}) => ({ ok: false, reason: "code", code: c, ...extra });

  eq("403 SPECTATOR_NOT_ALLOWED → 观战不能操作这个", S.spectateNoteOf(code("SPECTATOR_NOT_ALLOWED")), {
    kind: "spectator-not-allowed",
  });
  eq("429 TOO_MANY_SPECTATORS → 观战席位满了", S.spectateNoteOf(code("TOO_MANY_SPECTATORS")), { kind: "spectators-full" });
  eq(
    "409 ALREADY_IN_ROOM → 你已经是这间房的玩家（房号一起带出去）",
    S.spectateNoteOf(code("ALREADY_IN_ROOM", { roomCode: "K7M2QX" })),
    { kind: "already-player", code: "K7M2QX" },
  );
  eq("409 但没带房号也是 already-player（code = null）", S.spectateNoteOf(code("ALREADY_IN_ROOM")), {
    kind: "already-player",
    code: null,
  });
  eq("404 ROOM_NOT_FOUND → gone（房间过期 / 解散）", S.spectateNoteOf(code("ROOM_NOT_FOUND")), { kind: "gone" });
  eq("404 ROUND_NOT_FOUND → gone（还没有回合）", S.spectateNoteOf(code("ROUND_NOT_FOUND")), { kind: "gone" });
  eq("503 GAME_SPECTATORS_OFF → spectate-off", S.spectateNoteOf(code("GAME_SPECTATORS_OFF")), { kind: "spectate-off" });
  eq("503 GAME_PUBLIC_ROOMS_OFF → public-rooms-off", S.spectateNoteOf(code("GAME_PUBLIC_ROOMS_OFF")), {
    kind: "public-rooms-off",
  });
  eq("断网 / 超时 → offline", S.spectateNoteOf({ ok: false, reason: "unavailable" }), { kind: "offline" });
  eq("认不出的码原样带出去（不编一句没有信息的话）", S.spectateNoteOf(code("SOMETHING_NEW")), {
    kind: "code",
    code: "SOMETHING_NEW",
  });
  eq("一页 20 条 = 服务端的最大页大小", S.PUBLIC_ROOMS_PAGE_SIZE, 20);
}

// ────────────────── ② 能力位：只有 `=== true` 算有，且只认两处读法 ──────────────────
console.log("2) 能力位（gamePublicRooms / gameSpectators）：读不到就不摆");
{
  const caps = read("src/data/serverCaps.ts");
  ok("ServerCaps 有 gamePublicRooms 一位", /gamePublicRooms: boolean;/.test(caps));
  ok("ServerCaps 有 gameSpectators 一位", /gameSpectators: boolean;/.test(caps));
  ok("capsOf 只认 === true（形状不对 = 没有）", /gamePublicRooms: j\.gamePublicRooms === true/.test(caps));
  ok("capsOf 只认 === true（观战）", /gameSpectators: j\.gameSpectators === true/.test(caps));
  ok("NONE 两份里都是 false（老服务端）", (caps.match(/gamePublicRooms: false/g) ?? []).length >= 2);
  ok("ALL（dev / 离线包）也是 false：没有 /api/game/rooms 可问", (caps.match(/gameSpectators: false/g) ?? []).length >= 2);
  ok("两个读法各一份（serverGamePublicRooms）", /export function serverGamePublicRooms\(\)/.test(caps));
  ok("两个读法各一份（serverGameSpectators）", /export function serverGameSpectators\(\)/.test(caps));
  ok("两个读法都用 force 探测（dev + 本地服务端要能问到）", (caps.match(/void probeServerCaps\(true\)/g) ?? []).length >= 4);

  const roomsApi = read("src/api/game/rooms.ts");
  ok(
    "公开房能力的唯一判据 = publicRoomsAvailable → serverGamePublicRooms() === true",
    /export function publicRoomsAvailable\(\): boolean \{\s*return serverGamePublicRooms\(\) === true;/.test(roomsApi),
  );
  ok(
    "观战能力的唯一判据 = spectateAvailable → serverGameSpectators() === true",
    /export function spectateAvailable\(\): boolean \{\s*return serverGameSpectators\(\) === true;/.test(roomsApi),
  );

  const lobby = read("src/studio/game/ui/Lobby.tsx");
  // ★ 2026-11-27（feat/ui-match-b-c）：大厅首屏拆成 B 案组件（MatchLobbyB.tsx），
  //   公开房入口与「公开这间房」开关都搬过去了；判据仍在这两份文件里各查一处。
  const lobbyB = read("src/studio/game/ui/MatchLobbyB.tsx");
  ok("大厅用 usePublicRoomsCap 读能力位（探到会重画）", lobby.includes("usePublicRoomsCap()"));
  ok("公开房入口按能力位摆（老服务端不摆）", lobby.includes("publicRoomsCap") && /\{publicRoomsCap && \(/.test(lobbyB));
  ok("「公开这间房」开关也按能力位摆（老服务端不摆）", /showPublicToggle=\{pick === "room" && publicRoomsCap\}/.test(lobby) && /\{showPublicToggle && \(/.test(lobbyB));

  const lobbyStore = read("src/studio/game/lobbyStore.ts");
  ok(
    "能力位为假时观战那一发一个请求都不发（enterSpectate 先问 spectateAvailable）",
    /if \(!spectateAvailable\(\)\) \{/.test(lobbyStore) && lobbyStore.indexOf("spectateAvailable()") < lobbyStore.indexOf("spectateRemoteRoom(code)"),
  );

  const list = read("src/studio/game/ui/PublicRooms.tsx");
  ok("列表里「观战」键按能力位摆（canSpectate 才画）", list.includes("canSpectate ?") && list.includes("useSpectateCap()"));
}

// ────────────────── ③ 列表：一行五件事 + 空态 + 下拉刷新 / 分页 ──────────────────
console.log("3) 公开房列表（行 / 空态 / 下拉刷新 / 滚到底加载更多）");
{
  const roomsApi = read("src/api/game/rooms.ts");
  ok("listPublicRooms 写死 visibility=public（别的值服务端 400）", /new URLSearchParams\(\{ visibility: "public" \}\)/.test(roomsApi));
  ok("分页参数 page / limit 真的发出去", roomsApi.includes('params.set("page"') && roomsApi.includes('params.set("limit"'));
  ok("state / mode 是可选查询参数（三个页签 / 模式筛选）", roomsApi.includes('params.set("state"') && roomsApi.includes('params.set("mode"'));
  ok("列表一行解析 joinable / hostName / members / seats / state", ["joinable", "hostName", "members", "seats"].every((k) => roomsApi.includes(k)));
  ok("观战 / 出席两个端点都在（spectate / leaveSpectate）", roomsApi.includes("export async function spectate(") && roomsApi.includes("export async function leaveSpectate("));
  ok("三只拒绝码进了 GAME_CODES（否则会被压成 unavailable）", ["TOO_MANY_SPECTATORS", "SPECTATOR_NOT_ALLOWED", "ALREADY_IN_ROOM"].every((c) => roomsApi.includes(`"${c}"`)));

  const list = read("src/studio/game/ui/PublicRooms.tsx");
  ok("每行有房主名（hostName，读不到时一句「房主」）", list.includes("room.hostName") && list.includes("昵称读不到"));
  ok("每行有模式（roomModeText）", list.includes("roomModeText(room.mode)"));
  ok("每行有人数 x/y", list.includes("{room.members}/{room.seats}"));
  ok("每行有状态（roomStateText）", list.includes("roomStateText(room.state)"));
  ok("joinable 为真 → 「加入」", list.includes("room.joinable ?") && list.includes(">加入<"));
  ok("否则 → 「观战」（能力位为真才摆）", list.includes(">观战<") && list.includes("canSpectate ?"));
  ok("空列表那一句「现在没有公开房」", list.includes("现在没有公开房"));
  ok("空列表给「去建房」", list.includes("去建房"));
  ok("三个页签（等真人 / 进行中 / 已结束）", list.includes("STATES") && list.includes("pickPublicState"));
  ok("下拉刷新（pointerdown → pointermove → 松手刷）", list.includes("onPointerDown") && list.includes("onPointerMove") && list.includes("PULL_TRIGGER"));
  ok("滚到底加载更多（onScroll + hasMore）", list.includes("onScroll") && list.includes("loadMorePublicRooms()"));
  ok("加载更多按房号去重（实时列表翻页会位移）", (read("src/studio/game/lobbyStore.ts").match(/new Set\(get\(\)\.publicRooms\.map/g) ?? []).length === 1);

  const lobbyStore = read("src/studio/game/lobbyStore.ts");
  ok("列表状态进了 store（openPublicRooms / refreshPublicRooms / loadMorePublicRooms）", ["openPublicRooms:", "refreshPublicRooms:", "loadMorePublicRooms:"].every((k) => lobbyStore.includes(k)));
  ok("换页签重读第一页（pickPublicState → refreshPublicRooms）", /pickPublicState: \(state\)[\s\S]{0,400}?refreshPublicRooms\(\)/.test(lobbyStore));
  ok("建房带 visibility：勾了公开才发 public（缺省 private）", lobbyStore.includes("publicRoomOn && publicRoomsAvailable()") && lobbyStore.includes('"public" as const'));
  ok("换屏 / 关大厅时把列表清掉（PUBLIC_STATE_RESET 三处共用）", (lobbyStore.match(/\.\.\.PUBLIC_STATE_RESET/g) ?? []).length >= 3);
}

// ────────────────── ④ 观战视图：砍掉了所有写操作，只留只读四样 ──────────────────
console.log("4) 观战视图（只读：桌面 / 阶段条 / 展映 / 结算 / 历史回放）");
{
  const screen = read("src/studio/game/ui/SpectateScreen.tsx");
  ok("顶部标「👁 观战中 · 房主 …」", screen.includes("👁") && screen.includes("观战中") && screen.includes("房主"));
  ok("左边「桌面」（座位 / 血量 / 状态）", screen.includes("桌面") && screen.includes("function SeatTable"));
  ok("阶段条（四格）", screen.includes("function PhaseStrip") && screen.includes('"creating"'));
  ok("展映播放（原生 <video>，只读）", screen.includes("function ScreeningView") && screen.includes("<video"));
  ok("投票那一屏只有票数（没有投票键）", screen.includes("function VotingView") && screen.includes("观战中：不能投票"));
  ok("结算榜（服务端 ranking 原样渲染）", screen.includes("function SettlementTable") && screen.includes("settlement.ranking"));
  ok("历史回放（每回合 + 结算 + 播放器）", screen.includes("function HistorySheet") && screen.includes("function EntryPlayer"));
  ok("每 2 秒跟一拍（SPECTATE_POLL_MS）", screen.includes("SPECTATE_POLL_MS") && read("src/studio/game/spectateStore.ts").includes("SPECTATE_POLL_MS = 2_000"));
  ok("退出席位（quitSpectateToLobby 一处实现）", screen.includes("quitSpectateToLobby") && read("src/studio/game/ui/quitSpectate.ts").includes("useSpectate.getState().exit()") && read("src/studio/game/spectateStore.ts").includes("leaveSpectate(code)"));
  ok("设置页换成「退出观战」", screen.includes("<GameSettings spectate") && read("src/studio/game/ui/GameSettings.tsx").includes("quitSpectateToLobby"));

  // ★ 写操作一个都不许出现：服务端那十来个写端点对观众一律 403，界面漏摆一颗就等于"点了没反应"
  const forbidden = [
    "ShopPanel",
    "BagBar",
    "CreatePanel",
    "VotingPanel",
    "ItemRail",
    "StickerPanel",
    "OnlineScreeningPanel",
    "useGame(",
    "like(",
    "vote(",
    "advance(",
    "settle(",
    "next(",
    "enterScreening(",
    "enterCreate(",
    "startRoom(",
    "setReady(",
  ];
  const hits = forbidden.filter((token) => screen.includes(token));
  eq("观战屏一个写操作 / 一个商店背包创作组件都不 import", hits, []);
  ok(
    "「不能点赞 / 不能投票 / 不能推进」是这一屏唯一提到写动作的地方（只读是文案也是事实）",
    screen.includes("观战中：不能点赞") && screen.includes("观战中：不能投票"),
  );

  const store = read("src/studio/game/spectateStore.ts");
  ok("观战 store 不调任何写端点", !/(like|vote|advance|settle|next|setReady|startRoom|submit)\(/.test(store));
  ok("房间没了 / 不在观众席了才停拍（lost）", store.includes("lost: true"));
  ok("弱网那一拍不清画面（unavailable 只留一句）", /reason === "unavailable"[\s\S]{0,120}?note: \{ kind: "offline" \}/.test(store));
  ok("还没开打（ROUND_NOT_FOUND）不当错误", /roundRes\.code === "ROUND_NOT_FOUND"[\s\S]{0,120}?round: null/.test(store));
  ok("结算那一拍顺手拉历史（结算榜只在 history 里）", /phase === "settled"[\s\S]{0,200}?refreshHistory\(\)/.test(store));

  const studio = read("src/studio/StudioPage.tsx");
  ok("StudioPage 挂上了观战屏", studio.includes("<SpectateScreen />"));
  ok("观战盖着时 3D 停帧（canvasCovered 含 spectateOpen）", studio.includes("|| spectateOpen"));
  ok("离开工坊时退出席位", /if \(useSpectate\.getState\(\)\.open\) void useSpectate\.getState\(\)\.exit\(\)/.test(studio));
}

// ────────────────── ⑤ 文案：三句拒绝必须是任务点名的那几句 ──────────────────
console.log("5) 三句拒绝（403 / 429 / 409）的文案");
{
  const reasons = read("src/studio/game/lobbyReasons.ts");
  ok("403 → 「观战不能操作这个」", reasons.includes("观战不能操作这个"));
  ok("429 → 「观战席位满了」", reasons.includes("观战席位满了"));
  ok("409 → 「你已经是这间房的玩家，直接进房」", reasons.includes("你已经是这间房的玩家，直接进房"));
  ok("底栏给「直接进房」一颗键", read("src/studio/game/ui/Lobby.tsx").includes("直接进房"));
  ok("房间没了那一句照实说（不装成空列表）", reasons.includes("这间房已经不在了"));
}

if (problems.length) {
  console.error(`\n❌ 公开房 / 观战检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}\n`);
  process.exit(1);
}
console.log(`✓ 公开房 / 观战检查通过：${positive} 条断言`);
