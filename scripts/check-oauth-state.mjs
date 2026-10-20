#!/usr/bin/env node
// 构建门禁：第三方登录深链回程的 state 绑定（src/data/oauthState.ts）正反例实跑（2026-10-15 教材人格评审，owasp-security-1）。
//
// ★★ 为什么要有它：这张判定表是「别人投一条 ideahub://oauth?token=… 能不能把用户换成别人的登录态」的全部防线，
//   而它判错的两个方向都零报错：放松一格 = 登录 CSRF 回来了；收紧一格（比如把老服务端那条「不回带」也拒了）= 服务端那一版
//   还没发时所有人登不上第三方账号。规则一条都不在这里重打：直接 import 那个模块（Node 只剥类型，所以它必须零运行时依赖）。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，下面五条各自变红：
//   ① 没记过也放行；② 过期（TTL+1ms）也放行；③ 回带的 state 对不上也放行；④ 正好到 TTL 那一毫秒就拒；
//   ⑤ 不回带（老服务端）也拒 —— 那是后一版 App 才能收紧的那一支，今天收了就把所有人关在门外。
//   2026-10-19 加失败回程归类（classifyOauthFailure）时又试了两条，各自变红：⑥ 「login failed」那条去掉首尾锚定；⑦ 删掉 oauth_conflict 码那一支。
//
// 用法：node scripts/check-oauth-state.mjs [--module=<另一份 oauthState.ts 的路径，造违规试红用>]
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const M = await import(url.pathToFileURL(path.resolve(modArg ?? path.join(root, "src/data/oauthState.ts"))).href);

const problems = [];
let ran = 0;
const show = (v) => JSON.stringify(v);
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) problems.push(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};

// ── state 的形状 ──
const zeros = M.encodeStateBytes(new Uint8Array(16));
eq("16 字节 → hex 32 位", zeros.length, 32);
eq("全 0 的 16 字节", zeros, "0".repeat(32));
eq("逐字节两位、不足补 0、小写", M.encodeStateBytes(new Uint8Array([0, 15, 255, 16, 171])), "000fff10ab");
eq("生成的 state 落在服务端那条正则里", M.STATE_RE.test(zeros), true);
eq("服务端正则：太短不收", M.STATE_RE.test("abc"), false);
eq("服务端正则：带 = 不收", M.STATE_RE.test("abcdefg="), false);
eq("TTL 是 15 分钟", M.STATE_TTL_MS, 15 * 60 * 1000);

// ── 判定表 ──
const NOW = 1_760_000_000_000;
const S = "0123456789abcdef0123456789abcdef";
const OTHER = "ffffffffffffffffffffffffffffffff";
const fresh = { state: S, at: NOW - 60_000 }; // 一分钟前发起的
const d = (ret, remembered, now = NOW) => M.decideOauthReturn(ret, remembered, now);

// 没记过：这台设备近期没发起过登录 —— 不管链接长什么样都不收
eq("没记过 + 带 token 不带 state：unsolicited", d({ token: "t" }, null), "unsolicited");
eq("没记过 + 带 token 带 state：unsolicited（随便编一个 state 也不行）", d({ token: "t", state: S }, null), "unsolicited");
eq("没记过 + 只带 error：unsolicited（?error= 文本同样不上屏）", d({ error: "x" }, null), "unsolicited");

// 记着、没过期
eq("对得上：accept", d({ token: "t", state: S }, fresh), "accept");
eq("只带 error、对得上：accept（服务端的失败回跳也回带 state，这一句才许上屏）", d({ error: "x", state: S }, fresh), "accept");
eq("对不上：mismatch", d({ token: "t", state: OTHER }, fresh), "mismatch");
eq("对不上（只差一位）：mismatch", d({ token: "t", state: S.slice(0, -1) + "0" }, fresh), "mismatch");
eq("不回带（老服务端）：accept —— 暂且放行，后一版 App 才收紧", d({ token: "t" }, fresh), "accept");
eq("回带了空串：按没回带算（老服务端）", d({ token: "t", state: "" }, fresh), "accept");
eq("回带了 null：按没回带算", d({ token: "t", state: null }, fresh), "accept");

// 过期：TTL 的边界
const atTtl = { state: S, at: NOW - M.STATE_TTL_MS };
const past = { state: S, at: NOW - M.STATE_TTL_MS - 1 };
eq("正好到 TTL 那一毫秒：还算数", d({ token: "t", state: S }, atTtl), "accept");
eq("过了 TTL 一毫秒：stale", d({ token: "t", state: S }, past), "stale");
eq("过期 + 不回带：stale（老服务端那条放行也只在 TTL 之内）", d({ token: "t" }, past), "stale");
eq("过期 + 对不上：stale（先判过期，日志说的是过期）", d({ token: "t", state: OTHER }, past), "stale");
eq("时钟被往回拨（记录在未来）：不当过期", d({ token: "t", state: S }, { state: S, at: NOW + 5_000 }), "accept");

// ── 失败回程归类（classifyOauthFailure，2026-10-19）──
// 服务端那几句是**照 server#119 的 src/routes/oauth.routes.js 逐字抄的**（redirectFail / failBack / redirectStateFail / getOauthConflictMessage）。
// 判错的方向要安全：认不出 = 原样显示（与改之前一样），所以宁可漏认；锚定整句，免得把拼进来的长句认成我们的。
const cf = (error, message) => M.classifyOauthFailure(error, message);
eq("google login failed → 没完成（Google）", cf("oauth_failed", "google login failed"), { kind: "notCompleted", provider: "google" });
eq("github login failed → 没完成（GitHub）", cf("oauth_failed", "github login failed"), { kind: "notCompleted", provider: "github" });
eq("/oauth/fail 缺省的 oauth login failed → 没完成（不知道哪家）", cf("oauth_failed", "oauth login failed"), { kind: "notCompleted", provider: null });
eq("Invalid or expired OAuth state → state 过期", cf("oauth_failed", "Invalid or expired OAuth state"), { kind: "stateExpired" });
eq(
  "邮箱被别的登录方式占了（Google）",
  cf("oauth_conflict", "Google email is already linked to another IdeaHub login method. Please use the original sign-in method for that account."),
  { kind: "emailTaken", provider: "google" },
);
eq(
  "邮箱被别的登录方式占了（GitHub）",
  cf("oauth_conflict", "GitHub email is already linked to another IdeaHub login method. Please use the original sign-in method for that account."),
  { kind: "emailTaken", provider: "github" },
);
eq("Google email not available → 没给邮箱", cf("oauth_failed", "Google email not available"), { kind: "noEmail", provider: "google" });
eq("Missing google profile → 没拿到资料", cf("oauth_failed", "Missing google profile"), { kind: "noProfile", provider: "google" });
eq("Missing github profile → 没拿到资料", cf("oauth_failed", "Missing github profile"), { kind: "noProfile", provider: "github" });
eq("GitHub callback error → 回调出错", cf("oauth_failed", "GitHub callback error"), { kind: "callbackError", provider: "github" });
eq("只有 oauth_failed 码 → 没完成（不知道哪家）", cf("oauth_failed", ""), { kind: "notCompleted", provider: null });
eq("只有 oauth_conflict 码 → 邮箱被占", cf("oauth_conflict", null), { kind: "emailTaken", provider: null });
eq("message 只有空白 → 看码", cf("oauth_failed", "   "), { kind: "notCompleted", provider: null });
eq("message 比码细：码是 conflict、话是 login failed → 按话", cf("oauth_conflict", "google login failed"), { kind: "notCompleted", provider: "google" });
// 认不出的一律原样（与改之前一样上屏）
eq("服务端 catch 里回的中文原话 → 原样", cf("oauth_failed", "生成用户名失败，请重试"), { kind: "raw", text: "生成用户名失败，请重试" });
eq("前面多一截 → 不认（锚定开头）", cf("oauth_failed", "Hello google login failed"), { kind: "raw", text: "Hello google login failed" });
eq("后面多一截 → 不认（锚定结尾）", cf("oauth_failed", "google login failed, visit evil.example"), { kind: "raw", text: "google login failed, visit evil.example" });
eq("不认识的码、没有话 → 原样显示码", cf("access_denied", ""), { kind: "raw", text: "access_denied" });
eq("什么都没带 → unknown", cf(null, undefined), { kind: "unknown" });

if (problems.length) {
  console.error(`\n❌ 第三方登录 state 绑定检查没过（${problems.length} / ${ran}）：\n`);
  for (const p of problems) console.error("  · " + p);
  console.error("\n改法：判定只在 src/data/oauthState.ts；utils/oauth.acceptOauthReturn 与 pages/OauthCallbackPage 都读它，改之前先读那个文件头与 docs/api-contract.md「第三方登录深链的 state 绑定」。\n");
  process.exit(1);
}
console.log(`✓ 第三方登录 state 绑定检查通过（${ran} 条：state 形状 / 没记过 / 对得上对不上 / 老服务端不回带 / TTL 边界 / 失败回程归类）`);
