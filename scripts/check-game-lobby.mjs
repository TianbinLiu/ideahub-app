#!/usr/bin/env node
// 构建门禁：大厅 / 自定义房间的**纯状态机**（src/studio/game/lobby.ts）正反例实跑（2026-11-23）。
//
// ★★ 为什么要它：这一层的错全是「零报错」的 ——
//     · 房主被当成客人 ⇒ 点「开始对局」什么也不发生（界面上就是一颗按钮坏了）；
//     · 踢人按错下标 ⇒ 把房主自己踢掉，房间还在但没人能开；
//     · 人数改成 9 / 1 ⇒ 座位表越界，对局建局时 createGame 才抛（玩家看到的是"开局失败"而不是"人数不对"）；
//     · 缩人数把真人挤掉 ⇒ 那个人静默掉线（联机接通之后就是真的把人踢了）；
//     · 空位没有补 AI ⇒ 这一局永远开不起来（联机没接通的这版里，等真人 = 等不到）。
//   这些在界面上都只是"按钮点了没反应"，只有拿正反例跑才看得见。
// ★ 一条规矩都不在这里重写：直接 import 线上那份 lobby.ts（Node 只剥类型，所以它零运行时依赖）。
// ★ 反例都写了"错的时候会怎样"：见每个待拒用例上面的注释。
//
// 用法：node scripts/check-game-lobby.mjs
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const L = await import(url.pathToFileURL(path.join(root, "src/studio/game/lobby.ts")).href);
// 随机源只有 rules 一份（mulberry32）：房间码也要能"同一 seed 同一个码"，不另写一份
const R = await import(url.pathToFileURL(path.join(root, "src/studio/game/rules.ts")).href);

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
/** 本该成功的调用；失败就直接抛出（后面的用例没有状态可接着跑）。 */
const must = (label, res) => {
  positive += 1;
  if (!res || !res.ok) throw new Error(`${label}：本该成功，却回了 ${res?.reason ?? "undefined"}`);
  return res;
};
/** 反例：期待被拒，而且拒绝原因要说对（原因错 = 界面会说错话）。 */
const rejects = (label, res, reason) => {
  negative += 1;
  if (!res || res.ok) {
    fail(`${label}：本该被拒（${reason}），却成功了 —— 这类错误的形状是「按钮点了没反应」`);
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

const ME = L.LOCAL_SEAT_ID;
const room = (size = 4) => must(`开一间 ${size} 人房`, L.createRoom({ code: "123456", hostId: ME, size })).room;

// ────────────────────────────── 0. 座位 id 与人数（大厅定人数，规则层认座位） ──────────────────────────────

{
  eq("4 人桌的座位 = 我 + 3 个 AI", L.seatIdsFor(4), ["me", "ai-1", "ai-2", "ai-3"]);
  eq("8 人桌的座位 = 我 + 7 个 AI", L.seatIdsFor(8), ["me", "ai-1", "ai-2", "ai-3", "ai-4", "ai-5", "ai-6", "ai-7"]);
  eq("2 人桌的座位 = 我 + 1 个 AI", L.seatIdsFor(2), ["me", "ai-1"]);
  eq("人数超上界时夹到 8（座位表的防呆）", L.seatIdsFor(12).length, L.ROOM_MAX_SIZE);
  eq("人数低于下界时夹到 2", L.seatIdsFor(0).length, L.ROOM_MIN_SIZE);
  eq("AI 的 id 是 ai-1 … ai-7（labels.playerName 认它）", L.aiSeatIds(7), ["ai-1", "ai-2", "ai-3", "ai-4", "ai-5", "ai-6", "ai-7"]);
  eq("上下界与规则层的座位数同一个值", [L.ROOM_MIN_SIZE, L.ROOM_MAX_SIZE], [2, 8]);
}

// ────────────────────────────── 1. 房间码：6 位、首位非 0、同一 seed 同一个码 ──────────────────────────────

{
  const code = L.roomCodeOf(() => 0.5);
  eq("6 位数字", code.length, L.ROOM_CODE_LENGTH);
  ok("首位不是 0（念给人听时不会被补成 5 位）", /^[1-9]/.test(code));
  eq("0 的 rng 也落在 100000~999999", L.roomCodeOf(() => 0).length, 6);
  ok("rng 回 0 时是下界 100000", L.roomCodeOf(() => 0) === "100000");
  ok("rng 回 0.999999 时是上界 999999", L.roomCodeOf(() => 0.999999) === "999999");
  // 同一个 seed 同一个码（检查脚本 / 复盘都靠它）
  eq("同一 seed 生成同一个房间码", L.roomCodeOf(R.createRng(4242)), L.roomCodeOf(R.createRng(4242)));
  ok("不同 seed 生成不同房间码", L.roomCodeOf(R.createRng(1)) !== L.roomCodeOf(R.createRng(2)));
  // 坏 rng（NaN）不许产出 NaN 码：夹进 [0,1) 之后仍是合法码
  ok("坏 rng 也不出 NaN 码", L.isRoomCode(L.roomCodeOf(() => NaN)));
  ok("isRoomCode 认 6 位非 0 开头的码", L.isRoomCode("654321"));
  ok("isRoomCode 不认 0 开头", !L.isRoomCode("012345"));
  ok("isRoomCode 不认 5 位", !L.isRoomCode("12345"));
  ok("isRoomCode 不认字母", !L.isRoomCode("12345a"));
}

// ────────────────────────────── 2. 开房间：房主在 0 号、其余 AI 补位、人数 2~8 ──────────────────────────────

{
  const four = room(4);
  eq("房间人数", four.size, 4);
  eq("座位数 = 人数", four.seats.length, 4);
  eq("0 号是房主", [four.seats[0].playerId, four.seats[0].kind, four.seats[0].ready], [ME, "host", true]);
  eq(
    "其余座位是 AI 补位（ai-1 … ai-3）",
    four.seats.slice(1).map((s) => [s.playerId, s.kind]),
    [
      ["ai-1", "ai"],
      ["ai-2", "ai"],
      ["ai-3", "ai"],
    ],
  );
  eq("本机房不是联机房（online 缺省 false）", four.online, false);
  eq("房间码原样带在房间里", four.code, "123456");
  eq("8 人房坐得下", room(8).seats.length, 8);
  eq("2 人房坐得下（自定义房间的下界）", room(2).seats.length, 2);
  // 反例：人数越界是程序员的错（大厅只给 2~8 的按钮）
  rejects("1 人房", L.createRoom({ code: "123456", hostId: ME, size: 1 }), "size-out-of-range");
  rejects("9 人房", L.createRoom({ code: "123456", hostId: ME, size: 9 }), "size-out-of-range");
  rejects("人数是 NaN", L.createRoom({ code: "123456", hostId: ME, size: NaN }), "size-out-of-range");
  eq("越界时把上下界一起回给界面", L.createRoom({ code: "123456", hostId: ME, size: 9 }).min, L.ROOM_MIN_SIZE);
}

// ────────────────────────────── 3. 改人数（房主，2~8；缩人数不许把真人挤掉） ──────────────────────────────

{
  const four = room(4);
  const grown = must("房主把 4 人改成 8 人", L.setRoomSize(four, ME, 8)).room;
  eq("长大的座位补 AI", grown.seats.slice(4).map((s) => s.playerId), ["ai-4", "ai-5", "ai-6", "ai-7"]);
  eq("已坐的人不动", grown.seats[0].playerId, ME);
  eq("人数记进 size", grown.size, 8);
  const shrunk = must("房主把 8 人改回 2 人", L.setRoomSize(grown, ME, 2)).room;
  eq("缩人数只留前 2 格", shrunk.seats.map((s) => s.playerId), [ME, "ai-1"]);
  eq("缩完之后 size 也跟着变", shrunk.size, 2);
  // 反例
  rejects("非房主改人数", L.setRoomSize(four, "ai-1", 8), "not-host");
  rejects("改成 9 人", L.setRoomSize(four, ME, 9), "size-out-of-range");
  rejects("改成 1 人", L.setRoomSize(four, ME, 1), "size-out-of-range");
  // 反例：缩到 2 人但 5 号位坐着真人 ⇒ 那个人会被静默挤掉（联机之后就是"掉线"）
  const withGuest = {
    ...room(8),
    seats: room(8).seats.map((s) => (s.index === 4 ? { ...s, playerId: "u-9", kind: "guest", ready: true } : s)),
  };
  rejects("缩人数跨过坐着的真人", L.setRoomSize(withGuest, ME, 2), "seat-occupied");
  // 纯函数：失败不改入参
  const before = show(four);
  L.setRoomSize(four, "ai-1", 8);
  unchanged("改人数失败不改房间", four, JSON.parse(before));
}

// ────────────────────────────── 4. 踢人（房主；只踢 AI，踢掉的格子空着、开局 AI 再补） ──────────────────────────────

{
  const four = room(4);
  const kicked = must("房主踢掉 2 号 AI", L.kickSeat(four, ME, 2)).room;
  eq("2 号变成空位", [kicked.seats[2].playerId, kicked.seats[2].kind], [null, "empty"]);
  eq("别的座位不动", kicked.seats.map((s) => s.kind), ["host", "ai", "empty", "ai"]);
  eq("空位上的准备状态也清掉", kicked.seats[2].ready, false);
  // 反例
  rejects("非房主踢人", L.kickSeat(four, "ai-1", 1), "not-host");
  rejects("踢房主自己", L.kickSeat(four, ME, 0), "seat-host");
  rejects("踢已经是空位的格子", L.kickSeat(kicked, ME, 2), "seat-empty");
  rejects("踢不存在的座位", L.kickSeat(four, ME, 9), "seat-out-of-range");
  const before = show(four);
  L.kickSeat(four, "ai-1", 1);
  unchanged("踢人被拒时房间不变", four, JSON.parse(before));
}

// ────────────────────────────── 5. 准备 / 离开（非房主只能这两件事，§3） ──────────────────────────────

{
  // 造一间"3 号位坐着客人"的房间（联机接通后才有，形状先钉住）
  const guestRoom = {
    ...room(4),
    seats: room(4).seats.map((s) => (s.index === 3 ? { ...s, playerId: "u-9", kind: "guest", ready: false } : s)),
  };
  const readied = must("客人点准备", L.toggleReady(guestRoom, "u-9")).room;
  eq("客人准备上了", readied.seats[3].ready, true);
  const unreadied = must("客人取消准备", L.toggleReady(readied, "u-9")).room;
  eq("客人可以取消准备", unreadied.seats[3].ready, false);
  // 反例
  rejects("房主点准备（他点开始就是表态）", L.toggleReady(room(4), ME), "host-always-ready");
  rejects("不在房里的人点准备", L.toggleReady(room(4), "nobody"), "not-member");

  // 离开：客人走 = 那一格空出来；房主走 = 这间房散掉
  const guestLeft = must("客人离开", L.leaveRoom(guestRoom, "u-9"));
  eq("客人走之后那一格是空位", [guestLeft.room.seats[3].kind, guestLeft.room.seats[3].playerId], ["empty", null]);
  const hostLeft = must("房主离开", L.leaveRoom(room(4), ME));
  eq("房主走 = 这间房没了", hostLeft.room, null);
  rejects("不在房里的人离开", L.leaveRoom(room(4), "u-9"), "not-member");
}

// ────────────────────────────── 6. 开局：只有房主能开、空位照样由 AI 补（§4） ──────────────────────────────

{
  const four = room(4);
  const plan = must("房主开局", L.canStartRoom(four, ME)).plan;
  eq("4 人房开局 = 4 个座位", plan.playerCount, 4);
  eq("真人只有房主", plan.humanIds, [ME]);
  eq("3 个 AI 补位", plan.aiCount, 3);
  // 把两个 AI 踢掉（房主想等真人）：开局照样补上 —— 不补的话这一局开不起来
  const kicked = must("踢 2 号", L.kickSeat(four, ME, 2)).room;
  const kicked2 = must("踢 3 号", L.kickSeat(kicked, ME, 3)).room;
  const planAfterKick = must("踢完人房主仍能开局", L.canStartRoom(kicked2, ME)).plan;
  eq("踢掉的空位在开局时仍由 AI 补", planAfterKick.aiCount, 3);
  eq("座位数不因为踢人变少", planAfterKick.playerCount, 4);
  // 8 人房
  eq("8 人房开局 = 7 个 AI", L.canStartRoom(room(8), ME).plan.aiCount, 7);
  // 反例：非房主不能开始（「非房主只能准备/离开」）
  rejects("非房主开始", L.canStartRoom(four, "ai-1"), "not-host");
  // roomStartPlan 与 canStartRoom 同一份读数
  eq("roomStartPlan 与房主开始那一份一致", L.roomStartPlan(kicked2).aiCount, planAfterKick.aiCount);
}

// ────────────────────────────── 7. 入口 → 人数 ──────────────────────────────

{
  eq("4 人匹配 = 4 个座位", L.playerCountOf("match4", null), 4);
  eq("8 人匹配 = 8 个座位", L.playerCountOf("match8", null), 8);
  eq("自定义房间按房间的人数是几", L.playerCountOf("room", room(6)), 6);
  eq("房间还没开出来时回落到 4", L.playerCountOf("room", null), 4);
  eq("认房主只认 id 不认第 0 格", L.isHostOf(room(4), ME), true);
  eq("别人不是房主", L.isHostOf(room(4), "ai-1"), false);
  eq("没房间时谁都不是房主", L.isHostOf(null, ME), false);
}

// ────────────────────────────── 收尾 ──────────────────────────────

if (problems.length) {
  console.error(`\n❌ 大厅 / 房间状态机检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}\n`);
  process.exit(1);
}
console.log(`✓ 大厅 / 房间状态机检查通过：${positive + negative} 条断言（正例 ${positive} / 反例 ${negative}）`);
