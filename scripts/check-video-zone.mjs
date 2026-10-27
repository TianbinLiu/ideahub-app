#!/usr/bin/env node
// 构建门禁：出片地区的纯规则（src/data/videoZoneRules.ts）正反例实跑（2026-10-26 出片地区 P1 审核：测得到的规则要进构建检查）。
//
// ★★ 为什么要有它：这几条判错的方向都是零报错 ——
//   · parseZone 认了 v:2 的回包（意思变了的字段按老意思读）、认了一个不认识的供应商名（摆出一家这一版 App 根本没有档的供应商）、
//     把一个坏国家码交出去（Intl.DisplayNames 拿它取国名会抛）；
//   · deniesOf 在「地区不知道」（null）时也拦 —— 冷启动问慢半拍就把节点上的档位持久改写掉（三态不变量，videoZone 文件头的 ★★）；
//   · zoneOfDenial 把 403 回包记成门禁没开（话就会说成「这台服务器没接上」），或者把上一个地区的国家名安到新地区上；
//   · regionalOf 在 off / observe 时也说「地区」（没配 MiniMax 的服务器会对中国用户说「你所在的地区只提供 Seedance」）。
//   规则一条都不在这里重打：直接 import 那个模块（Node 只剥类型，所以它必须零运行时依赖，check-import-direction 的零依赖表里有它）。
// ★ 仓内门禁纪律：写完先造真违规试红（--module= 指向改坏的副本）。逐条试过，下面五条各自变红：
//   ① parseZone 不查 v；② providers 不过滤认不出的名字；③ deniesOf 在 null 上回 true；④ zoneOfDenial 不把 gate 记成 on；
//   ⑤ regionalOf 把 observe 也当地区。
//   2026-10-26 终审加 tierGoOf（「换到哪一档就有」三种结局）与真表 + providers ["minimax"] 的反例，试红一条：⑥ tierGoOf 一档都做不了时回两串空名字（8 条变红）。
//
// 用法：node scripts/check-video-zone.mjs [--module=<另一份 videoZoneRules.ts 的路径，造违规试红用>]
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modArg = process.argv.find((a) => a.startsWith("--module="))?.slice("--module=".length);
const M = await import(url.pathToFileURL(path.resolve(modArg ?? path.join(root, "src/data/videoZoneRules.ts"))).href);

const problems = [];
let ran = 0;
const show = (v) => JSON.stringify(v);
const eq = (what, got, want) => {
  ran++;
  if (show(got) !== show(want)) problems.push(`${what}\n      want ${show(want)}\n      got  ${show(got)}`);
};

const ok = { ok: true, v: 1, zone: "intl", country: "US", providers: ["minimax"], gate: "on" };
const p = (o) => M.parseZone({ ...ok, ...o });

// ── parseZone：读得懂的 ──
eq("标准回包", M.parseZone(ok), { zone: "intl", country: "US", providers: ["minimax"], gate: "on" });
eq("境内两家都给", p({ zone: "cn", country: "CN", providers: ["ark", "minimax"], gate: "observe" }), {
  zone: "cn",
  country: "CN",
  providers: ["ark", "minimax"],
  gate: "observe",
});
eq("blocked 一家都不给", p({ zone: "blocked", country: "IR", providers: [] }), { zone: "blocked", country: "IR", providers: [], gate: "on" });
eq("providers 顺序按 PROVIDERS 归一（比较变没变时不受回包顺序影响）", p({ providers: ["minimax", "ark"] }).providers, ["ark", "minimax"]);
eq("认不出的供应商名丢掉（这一版 App 没有那一家的档可摆）", p({ providers: ["runway", "minimax", 7] }).providers, ["minimax"]);
eq("重复的名字只算一次", p({ providers: ["minimax", "minimax"] }).providers, ["minimax"]);
eq("判不出国家（空串）", p({ country: "" }).country, "");
eq("国家码小写 = 当判不出（要拿去取国名，形状不对会抛）", p({ country: "us" }).country, "");
eq("三位国家码 = 当判不出", p({ country: "USA" }).country, "");
eq("国家码不是字符串 = 当判不出", p({ country: 840 }).country, "");
eq("gate 认不出 → \"\"（只挑措辞，不算形状不对）", p({ gate: "ON" }).gate, "");
eq("gate 缺 → \"\"", M.parseZone({ ok: true, v: 1, zone: "intl", country: "US", providers: ["minimax"] }).gate, "");
eq("gate off", p({ gate: "off" }).gate, "off");

// ── parseZone：读不懂的一律 null（沿用上一次的结论）──
eq("v:2（改了已有字段的意思）", p({ v: 2 }), null);
eq("v 缺", M.parseZone({ ok: true, zone: "intl", providers: [] }), null);
eq("v 是字符串 \"1\"", p({ v: "1" }), null);
eq("ok 不是 true", p({ ok: false }), null);
eq("zone 不在三种之内", p({ zone: "us" }), null);
eq("providers 不是数组", p({ providers: "minimax" }), null);
eq("providers 缺", M.parseZone({ ok: true, v: 1, zone: "intl", country: "US" }), null);
eq("回包是数组", M.parseZone([ok]), null);
eq("回包是 null", M.parseZone(null), null);
eq("回包是字符串（SPA 回退的 index.html 读成文本）", M.parseZone("<!doctype html>"), null);

// ── deniesOf：三态里「不知道」恒不拦 ──
eq("地区不知道（null）不拦方舟", M.deniesOf(null, "ark"), false);
eq("地区不知道（null）不拦 MiniMax", M.deniesOf(null, "minimax"), false);
eq("海外只给 MiniMax：拦方舟", M.deniesOf({ providers: ["minimax"] }, "ark"), true);
eq("海外只给 MiniMax：不拦 MiniMax", M.deniesOf({ providers: ["minimax"] }, "minimax"), false);
eq("境内两家都给：都不拦", [M.deniesOf({ providers: ["ark", "minimax"] }, "ark"), M.deniesOf({ providers: ["ark", "minimax"] }, "minimax")], [false, false]);
eq("一家都不给：两家都拦", [M.deniesOf({ providers: [] }, "ark"), M.deniesOf({ providers: [] }, "minimax")], [true, true]);

// ── zoneOfDenial：403 REGION_UNAVAILABLE 的回包 ──
const body = { ok: false, code: "REGION_UNAVAILABLE", reason: "region", zone: "intl", providers: ["minimax"], message: "…", billed: false };
const prevUS = { zone: "intl", country: "US", providers: ["ark", "minimax"], gate: "observe" };
const prevCN = { zone: "cn", country: "CN", providers: ["ark", "minimax"], gate: "on" };
eq("门禁能拦人 = 开着：gate 记成 on", M.zoneOfDenial(body, null)?.gate, "on");
eq("回包不带国家、之前也不知道：当判不出", M.zoneOfDenial(body, null)?.country, "");
eq("地区没变：沿用上一份的国家名", M.zoneOfDenial(body, prevUS)?.country, "US");
eq("地区变了：上一个地区的国家名不安到新地区上", M.zoneOfDenial(body, prevCN)?.country, "");
eq("providers 照回包记（以它为准，不并旧的）", M.zoneOfDenial(body, prevUS)?.providers, ["minimax"]);
eq("回包读不出 JSON（null）", M.zoneOfDenial(null, prevUS), null);
eq("回包里的 zone 认不出", M.zoneOfDenial({ ...body, zone: "mars" }, prevUS), null);
eq("回包里没有 providers", M.zoneOfDenial({ ...body, providers: undefined }, prevUS), null);

// ── regionalOf：只有门禁开着时缺的那一家才说成「地区」──
eq("gate on → 地区", M.regionalOf({ gate: "on" }), true);
eq("gate observe → 这台服务器没接上", M.regionalOf({ gate: "observe" }), false);
eq("gate off → 这台服务器没接上", M.regionalOf({ gate: "off" }), false);
eq("gate 认不出 → 不说地区", M.regionalOf({ gate: "" }), false);
eq("地区不知道 → 不说地区", M.regionalOf(null), false);

// ── sameZone：变没变（决定广播、决定门禁要不要从头再判）──
const a = { zone: "intl", country: "US", providers: ["minimax"], gate: "on" };
eq("内容一样 = 没变", M.sameZone(a, { ...a }), true);
eq("国家变了 = 变了", M.sameZone(a, { ...a, country: "CA" }), false);
eq("providers 变了 = 变了", M.sameZone(a, { ...a, providers: ["ark", "minimax"] }), false);
eq("gate 变了 = 变了（措辞要跟着换）", M.sameZone(a, { ...a, gate: "observe" }), false);
eq("不知道 → 知道 = 变了", M.sameZone(null, a), false);
eq("一直不知道 = 没变", M.sameZone(null, null), true);

// ── tierGoOf：「换到哪一档就有」的三种结局（2026-10-26 终审）──
//   null 必须与「全是会员档」分开：原来混在一起，句子印出「换到「」就有」「用「」出的段才能延长（会员档）」，还摆着「去升级」。
{
  const rows = [{ id: "a", x: true }, { id: "b", x: true }, { id: "c", x: false }];
  const has = (r) => r.x;
  const ids = (go) => go && { usable: go.usable.map((r) => r.id), member: go.member.map((r) => r.id) };
  eq("有人用得了：usable 非空", ids(M.tierGoOf(rows, has, (r) => r.id === "b")), { usable: ["a"], member: ["b"] });
  eq("做得了的全是会员档：usable 空、member 非空（不是 null）", ids(M.tierGoOf(rows, has, () => true)), { usable: [], member: ["a", "b"] });
  eq("一档都做不了：null（不是两串空名字）", M.tierGoOf(rows, () => false, () => false), null);
  eq("一档都摆不出来：null", M.tierGoOf([], has, () => false), null);
}
// 真表 + providers ["minimax"]（门禁开着的海外）：摆得出来的只剩「真人」档 —— 下面这几件事 account.tierGo / tierNamesFor 都必须落到 null，
// 调用方说 noTierLine（反例：哪天给「真人」那一行误开了某一位，或者 H3 那几行加进来了，这里会红 —— 那时去看那几句话还对不对，再改这张表）
{
  const T = await import(url.pathToFileURL(path.join(root, "src/data/videoTierTable.ts")).href);
  const live = T.VIDEO_TIER_SPECS.filter((r) => !r.retireAt);
  const intl = live.filter((r) => !M.deniesOf({ providers: ["minimax"] }, r.provider ?? "ark"));
  const both = live.filter((r) => !M.deniesOf({ providers: ["ark", "minimax"] }, r.provider ?? "ark"));
  eq("海外门禁开着时摆得出来的档（真表）", intl.map((r) => r.id), ["real"]);
  const NEEDS = {
    "收参考图（refImg）": (r) => r.refImg,
    "带参考视频（refVid + 有价签）": (r) => r.refVid && r.r2vMult !== null,
    "能延长（extendOk）": (r) => r.extendOk,
    "带声音样本（refAudio）": (r) => r.refAudio,
    "出声（audio）": (r) => r.audio,
    "收认证素材（assetRef）": (r) => r.assetRef,
  };
  for (const [what, has] of Object.entries(NEEDS)) {
    eq(`海外门禁开着 · ${what}：没有可换的档 = null`, M.tierGoOf(intl, has, () => false), null);
    ran++;
    if (!M.tierGoOf(both, has, () => false)) problems.push(`境内两家都给 · ${what}：应该有可换的档（真表里一行都没有了？）`);
  }
}

if (problems.length) {
  console.error(`❌ 出片地区规则有 ${problems.length} 条对不上（共 ${ran} 条，src/data/videoZoneRules.ts）：\n   ${problems.join("\n   ")}`);
  process.exit(1);
}
console.log(`✓ 出片地区规则 ${ran} 条正反例全过（videoZoneRules：回包解析 / 403 记法 / 不知道不拦 / 措辞挑哪种 / 换到哪一档的三种结局）`);
