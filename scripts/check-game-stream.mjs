#!/usr/bin/env node
// 构建门禁：联机对局 **SSE 推送** 的帧切分与重连节奏（2026-11-24）。
//
// ★★ 为什么要单独一道：推送这一条路在构建里跑不起来（要一条真的长连接），而它坏起来全是静默的 ——
//   · 半帧没拼回去 → 那一帧的 JSON 永远解析失败 → 服务端每次变化都被当成坏帧 → 一直"断了重连"；
//   · 心跳帧的 data 是**空串**（服务端 `frameOf("ping")` 写的是 `data: \n`），
//     拿 `if (data)` 判一下就把心跳吃掉 → 45 秒看门狗到点 → 每 45 秒断一次；
//   · CRLF / 末尾没有空行的那一帧：机器上看着一切正常，换一个中间层就丢事件；
//   · 重连退避写成"1s、2s、3s"或忘了 5 次上限 → 断网时每 3 秒一条新连接，把服务端每用户 2 条的名额撞成 429。
//   这些在真机上只表现成"偶尔不刷新"，没人能复现。
//
// ★ 这里**不重写一条规则**：import 的就是线上那两份（`api/sseBody` 的读循环、`studio/game/streamRetry` 的节奏）。
//   `api/game/roomStream.ts` 自己不能被 Node import（它要 fetch / API_BASE / import.meta.env），
//   所以"它有没有真的走这两份"用源码断言钉住（第 3 节）。
//
// 用法：node scripts/check-game-stream.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(url.pathToFileURL(path.join(root, rel)).href);
const S = await load("src/api/sseBody.ts");
const R = await load("src/studio/game/streamRetry.ts");

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

const enc = new TextEncoder();

/**
 * 一条假的 SSE 响应体：`chunks` 逐块 enqueue（每块就是一次 `reader.read()` 的返回）。
 * 元素可以是字符串（按 UTF-8 编码）或 Uint8Array（**用来把多字节字符切在两块之间**）。
 * ★ "半帧"就是这么造的：一个事件被写进两个 chunk —— 与真实 TCP 分片同一形状。
 */
function bodyOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
      controller.close();
    },
  });
}

/** 跑一遍读循环，收集所有帧（`chunks === null` = 没有 ReadableStream，走 readText 兜底） */
async function framesOf(chunks, readText) {
  const frames = [];
  await S.readSseBody(chunks === null ? null : bodyOf(chunks), readText ?? (async () => ""), (e) => frames.push(e));
  return frames;
}

/**
 * 服务端 `services/gameRoomStream.service.js` 的 `frameOf`（逐字照抄的行为）：
 * 一帧 = `event: <name>\ndata: <JSON 或空串>\n\n`。心跳的 data 是**空串**，不是没有 data 行。
 * ★ 用它造"线上真的会来的字节"，而不是自己随手写一个更友好的格式。
 */
function serverFrame(event, data) {
  return `event: ${event}\ndata: ${data === undefined || data === null ? "" : JSON.stringify(data)}\n\n`;
}

// ── 1. 帧切分：半帧 / CRLF / 心跳空 data / 一个 chunk 多帧 / 末尾半帧 ─────────────────
console.log("1) SSE 帧切分");
{
  // ① 一个 chunk 里两帧
  const frames = await framesOf([`${serverFrame("snapshot", { round: null })}${serverFrame("update", { round: 1 })}`]);
  eq("一 chunk 两帧 → 两帧", frames.length, 2);
  eq("第一帧 event", frames[0]?.event, "snapshot");
  eq("第二帧 event", frames[1]?.event, "update");
}
{
  // ② 一个事件被切成三块（字段名、JSON 中间、结尾的空行）
  const whole = serverFrame("update", { room: { code: "BWSDNP" }, round: { round: 2, phase: "voting" } });
  const cut1 = whole.indexOf("code") + 3;
  const cut2 = whole.indexOf("voting") + 2;
  const frames = await framesOf([whole.slice(0, cut1), whole.slice(cut1, cut2), whole.slice(cut2)]);
  eq("三块拼回一帧", frames.length, 1);
  eq("半帧拼接后 data 完整", JSON.parse(frames[0]?.data ?? "{}").round.phase, "voting");
}
{
  // ③ CRLF（nginx / 某些中间层会改写行尾）
  const frames = await framesOf(["event: ping\r\ndata: \r\n\r\n"]);
  eq("CRLF 帧 → 一帧", frames.length, 1);
  eq("CRLF 帧 event", frames[0]?.event, "ping");
  eq("CRLF 心跳 data 为空串", frames[0]?.data, "");
}
{
  // ④ 心跳：服务端写的是 `event: ping\ndata: \n\n` —— data **是空串**，必须照样吐出来
  const frames = await framesOf([serverFrame("ping")]);
  eq("心跳帧不被吃掉", frames.length, 1);
  eq("心跳 event", frames[0]?.event, "ping");
  eq("心跳 data 是空串（不是 undefined）", frames[0]?.data, "");
  ok("心跳 data 长度为 0 但帧存在（`if (!frame.data) return` 那种写法会在这里红）", frames[0]?.data === "");
}
{
  // ⑤ 多行 data 按 SSE 规范用 \n 拼；注释行（`: keep-alive`）忽略
  const frames = await framesOf([": keep-alive\n\nevent: message\ndata: 第一行\ndata: 第二行\n\n"]);
  eq("注释块不算事件", frames.length, 1);
  eq("多行 data 用换行拼", frames[0]?.data, "第一行\n第二行");
}
{
  // ⑥ 末尾一帧没有空行（连接被掐断 / 服务端最后一次 write 没赶上）：读完要 flush 出来
  const frames = await framesOf([`event: error\ndata: ${JSON.stringify({ ok: false, code: "STREAM_ERROR" })}`]);
  eq("末尾无空行的半帧也 flush", frames.length, 1);
  eq("flush 出来的 error 帧", frames[0]?.event, "error");
  eq("flush 帧的码", JSON.parse(frames[0]?.data ?? "{}").code, "STREAM_ERROR");
}
{
  // ⑦ UTF-8 多字节字符被切在两块之间（中文 JSON 在弱网下真的会这样断）
  const whole = enc.encode(serverFrame("snapshot", { room: { code: "房" } }));
  const cut = whole.length - 6; // 落在中文那三个字节中间
  const frames = await framesOf([whole.slice(0, cut), whole.slice(cut)]);
  eq("多字节字符跨块", JSON.parse(frames[0]?.data ?? "{}").room.code, "房");
}
{
  // ⑧ 没有 ReadableStream 的老 WebView：整份读回来再切，结果一样
  const frames = await framesOf(null, async () => `${serverFrame("snapshot", { round: null })}${serverFrame("ping")}`);
  eq("readText 兜底也能切帧", frames.map((f) => f.event), ["snapshot", "ping"]);
}
{
  // ⑨ 线上真实的一串：建连 snapshot → ping → update → end（30 分钟寿命到）
  const frames = await framesOf([
    serverFrame("snapshot", { room: { code: "BWSDNP" }, round: null }),
    serverFrame("ping"),
    serverFrame("update", { room: { code: "BWSDNP" }, round: { round: 1, phase: "creating" } }),
    serverFrame("end", { reason: "lifetime" }),
  ]);
  eq("一串线上帧的事件顺序", frames.map((f) => f.event), ["snapshot", "ping", "update", "end"]);
  eq("end 帧原因", JSON.parse(frames[3]?.data ?? "{}").reason, "lifetime");
}

// ── 2. 重连节奏：1s、2s、4s、8s、15s，最多 5 次 ─────────────────────────────────
console.log("2) 重连退避");
{
  eq("五次退避的毫秒数", [1, 2, 3, 4, 5].map((n) => R.retryDelayOf(n)), [1000, 2000, 4000, 8000, 15000]);
  ok("第 5 次就封顶（不出现 16 秒）", R.retryDelayOf(5) === R.STREAM_RETRY_MAX_MS);
  eq("第 1 次就是 1 秒", R.retryDelayOf(1), 1000);
  ok("上限常量是 15 秒", R.STREAM_RETRY_MAX_MS === 15000);
  eq("最多重连 5 次", R.STREAM_RETRY_MAX, 5);
  ok("失败 5 次还可以再试一次", R.canRetryStream(5) === true);
  ok("失败 6 次就停流", R.canRetryStream(6) === false);
  ok("失败 0 次（还没试过）当然可以试", R.canRetryStream(0) === true);
}

// ── 3. 源码断言：真正跑不了的那几处（能力位 / 清理 / 降级间隔）不许被改掉 ───────────────
console.log("3) 源码断言");
{
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const stream = read("src/api/game/roomStream.ts");
  ok("流用 Bearer 头（token 不进 URL）", stream.includes("Authorization = `Bearer "));
  ok("流走 withAppVersion（打自家 /api 的裸 fetch 都要过它）", stream.includes("withAppVersion(url"));
  ok("流的帧切分走 api/sseBody（不另写一份）", stream.includes("readSseBody(") && !stream.includes("getReader("));
  ok("认 Content-Type 不认状态码（SPA 回退 200 + HTML）", stream.includes("text/event-stream"));
  ok("close() 会 abort 底层连接（服务端每用户限 2 条）", /close: \(\) => \{[\s\S]*?ctrl\.abort\(\)/.test(stream));
  ok("收尾（end / error / 断开）都会关连接", /const finish = [\s\S]*?ctrl\.abort\(\)/.test(stream));
  ok("能力位判据只有 roomStreamCapability 一处（返回 true / false / null 三态）", /export function roomStreamCapability\(\): boolean \| null \{\s*return serverGameRoomStream\(\);/.test(stream));
  ok("能力位为 null（还不知道）时不当成「没有」：hook 里另排一次追问", stream.includes("roomStreamCapability"));

  const hook = read("src/studio/game/ui/useOnlineRounds.ts");
  ok("useOnlineRounds 先问能力位（为假一条流都不开）", hook.includes("roomStreamCapability()"));
  ok("能力位还不知道（null）时隔一会儿再问，不把这一局永久关掉", hook.includes("STREAM_CAP_RETRY_MS"));
  ok("useOnlineRounds 真的开流", hook.includes("subscribeRoomStream("));
  ok("cleanup 里 close()（离房 / 卸载 / 转竖屏）", hook.includes("closeSub()"));
  ok("重连节奏走 streamRetry（不在 hook 里另写一套数）", hook.includes("canRetryStream(") && hook.includes("retryDelayOf("));
  ok("有推送时轮询降级为兜底（读 ROUND_POLL_LIVE_MS）", hook.includes("ROUND_POLL_LIVE_MS"));

  const store = read("src/studio/game/roundsStore.ts");
  ok("兜底轮询间隔是 15 秒", /export const ROUND_POLL_LIVE_MS = 15_000;/.test(store));
  ok("推送与轮询共用 applyRemote（不另写一套应用逻辑）", store.includes("const applyRemote = (") && store.includes("applyRemote(room, round)"));
  ok("流正常 / 正在重连时兜底轮询失败不切单机", store.includes('get().stream === "live"') && store.includes('get().stream === "retrying"'));

  // ── 界面那一侧：**「已交片 x/y」与阶段条都读推送写进 store 的那一份快照** ──
  // ★★ 2026-11-24 真机上量过：push 帧到达 → React 重渲只有 **2ms**；剩下的 1~2 秒全是
  //   服务端写库（跨太平洋那条 RTT）与推送扇出。所以这两处一旦改成"自己数一个本地计数"，
  //   屏幕上就会慢回轮询量级 —— 这条断言钉住"读的是 snapshot，不是别的计数"。
  const create = read("src/studio/game/ui/CreatePanel.tsx");
  ok("创作面板的「已交片 x/y」读 snapshot.entries", create.includes("useRounds((s) => s.snapshot)") && create.includes("snapshot?.entries.length"));
  const phase = read("src/studio/game/ui/PhaseBar.tsx");
  ok("阶段条也读 snapshot（同一条推送源）", phase.includes("useRounds((s) => s.snapshot)") && phase.includes("snapshot?.entries.length"));
}

// ── 结论 ─────────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`\n❌ 联机推送检查没过（${problems.length} 条）：\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error("");
  process.exit(1);
}
console.log(`\n✓ 联机推送检查通过（${positive} 条）`);
