"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/studio/blockoutPrompt.ts
var blockoutPrompt_exports = {};
__export(blockoutPrompt_exports, {
  blockoutApplySkeleton: () => blockoutApplySkeleton,
  blockoutPromptBudget: () => blockoutPromptBudget,
  castNameIssue: () => castNameIssue,
  composeBlockoutPrompt: () => composeBlockoutPrompt,
  orderSlots: () => orderSlots
});
module.exports = __toCommonJS(blockoutPrompt_exports);

// stub:../ai
var AI_REAL = false;
var VIDEO_PROMPT_MAX = 400;

// stub:../ai/arkClient
async function chat() {
  return "";
}

// src/studio/blockoutPrompt.ts
var BIND_RESERVE_FIXED = 40;
var BIND_RESERVE_PER_CARD = 13;
function blockoutPromptBudget(cardCount) {
  return Math.max(80, VIDEO_PROMPT_MAX - BIND_RESERVE_FIXED - Math.max(0, cardCount) * BIND_RESERVE_PER_CARD);
}
var APPLY_DESC_MAX = 18;
function descIn(desc) {
  const s = desc.replace(/[、]/g, "\uFF0C").replace(/[（）()=＝；;@＠\n\r]/g, "").trim().slice(0, APPLY_DESC_MAX);
  return s || null;
}
function byNumber(a, b) {
  const na = Number.parseInt(a.label, 10);
  const nb = Number.parseInt(b.label, 10);
  if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
  if (Number.isNaN(na)) return 1;
  if (Number.isNaN(nb)) return -1;
  return na - nb;
}
function orderSlots(cast, spec) {
  if (spec.scheme === "number") return [...cast].sort(byNumber);
  const rank = (s) => {
    const i = spec.slots.indexOf(s.label);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...cast].sort((a, b) => rank(a) - rank(b));
}
function castNameIssue(name) {
  const bad = ["=", "\uFF1D", "\uFF1B", ";", "\u3001", "@", "\uFF20", "\n"].filter((ch) => name.includes(ch));
  if (bad.length === 0) return null;
  return `\u89D2\u8272\u540D\u300C${name}\u300D\u91CC\u6709 ${bad.map((c) => `\u300C${c === "\n" ? "\u6362\u884C" : c}\u300D`).join("")}\u2014\u2014\u51FA\u7247\u65F6"\u54EA\u4E2A\u4EBA\u5076\u6362\u6210\u8C01"\u662F\u7528\u8FD9\u51E0\u4E2A\u7B26\u53F7\u5206\u9694\u7684\uFF0C\u540D\u5B57\u91CC\u5E26\u7740\u5B83\u4EEC\u4F1A\u8BA9 AI \u628A\u4E00\u6761\u7ED1\u5B9A\u8BFB\u6210\u4E24\u6761\uFF08\u6362\u9519\u4EBA\u4E0D\u4F1A\u62A5\u9519\uFF0C\u53EA\u6709\u4F60\u81EA\u5DF1\u770B\u5F97\u51FA\u6765\uFF09\u3002\u8BF7\u7ED9\u8FD9\u5F20\u5361\u6539\u4E2A\u540D\u5B57`;
}
function blockoutApplySkeleton(cast, userLine, spec) {
  const slots = orderSlots(cast, spec);
  const taken = slots.flatMap((s) => s.card ? [{ label: s.label, name: s.card.name, desc: descIn(s.desc) }] : []);
  const free = slots.filter((s) => !s.card);
  const ordinal = spec.scheme === "ordinal";
  const build = (withDescs) => {
    const bind = (s) => `${s.label}${withDescs && ordinal && s.desc ? `\uFF08${s.desc}\uFF09` : ""}=${s.name}`;
    const parts = ["\u4EE5\u53C2\u8003\u89C6\u9891\u590D\u523B\u539F\u89C6\u9891\u7684\u4EBA\u7269\u7AD9\u4F4D\u3001\u52A8\u4F5C\u3001\u8282\u594F\u5361\u70B9\u3001\u8FD0\u52A8\u8F68\u8FF9\u3001\u961F\u5F62\u4E0E\u8FD0\u955C\u3002"];
    if (taken.length > 0) {
      parts.push(
        ordinal ? `\u6309\u753B\u9762\u91CC\u4ECE\u5DE6\u5230\u53F3\u7684\u4F4D\u7F6E\u66FF\u6362\u767D\u8272\u4EBA\u5076\uFF08\u62EC\u53F7\u91CC\u662F\u8FD9\u4E2A\u4EBA\u5076\u5728\u753B\u9762\u91CC\u7684\u6837\u5B50\uFF09\uFF1A${taken.map(bind).join("\u3001")}\u3002` : `\u628A\u5E26\u7F16\u53F7\u7684\u767D\u8272\u4EBA\u5076\u66FF\u6362\u4E3A\u5BF9\u5E94\u89D2\u8272\uFF1A${taken.map((s) => `\u7F16\u53F7${s.label}=${s.name}`).join("\u3001")}\u3002`
      );
    }
    return buildRest(parts, free, ordinal, userLine);
  };
  const cards = new Set(taken.map((s) => s.name)).size;
  const full = build(true);
  return full.length <= blockoutPromptBudget(cards) ? full : build(false);
}
function buildRest(parts, free, ordinal, userLine) {
  if (free.length > 0) {
    parts.push(
      ordinal ? `${free.map((s) => `${s.label}\u7684\u4EBA\u5076`).join("\u3001")}\u4FDD\u6301\u767D\u8272\u4EBA\u5076\u7684\u6837\u5B50\uFF0C\u4E0D\u8981\u66FF\u6362\u6210\u4EFB\u4F55\u4EBA\u3002` : `${free.map((s) => `\u7F16\u53F7${s.label}`).join("\u3001")}\u4FDD\u6301\u767D\u8272\u4EBA\u5076\u7684\u6837\u5B50\uFF0C\u4F46\u540C\u6837\u53BB\u6389\u7F16\u53F7\u3002`
    );
  }
  parts.push("\u52A8\u4F5C\u3001\u8D77\u6B62\u65F6\u95F4\u3001\u843D\u70B9\u4E0E\u5F3A\u62CD\u5B9A\u683C\u90FD\u8981\u4E0E\u53C2\u8003\u89C6\u9891\u4E00\u81F4\u3002");
  const line = userLine.trim();
  if (!ordinal) parts.push("\u628A\u4EBA\u5076\u5934\u4E0A\u548C\u8EAB\u4E0A\u7684\u7F16\u53F7\uFF08\u6570\u5B57\u3001\u53F7\u7801\u724C\uFF09\u5168\u90E8\u53BB\u6389\uFF0C\u6210\u7247\u91CC\u4E0D\u8BB8\u51FA\u73B0\u4EFB\u4F55\u7F16\u53F7\u6216\u6570\u5B57\u3002");
  if (line) parts.push(line.endsWith("\u3002") ? line : `${line}\u3002`);
  parts.push("\u4E0D\u8981\u51FA\u73B0\u5B57\u5E55\u3002");
  return parts.join("");
}
function hasLabel(text, label, spec) {
  const l = esc(label);
  return new RegExp(spec.scheme === "ordinal" ? `${l}${DESC_PAREN}(?=\\s*[=\uFF1D]|\u7684?\u4EBA\u5076)` : `\u7F16\u53F7\\s*${l}(?![0-9])`).test(
    text
  );
}
var DESC_PAREN = "(?:\\s*[\uFF08(][^\uFF09)]*[\uFF09)])?";
function hasPair(text, label, name, spec) {
  const l = esc(label);
  const n = esc(name);
  return new RegExp(
    spec.scheme === "ordinal" ? `${l}${DESC_PAREN}\\s*[=\uFF1D]\\s*${n}` : `\u7F16\u53F7\\s*${l}(?![0-9])\\s*[=\uFF1D]\\s*${n}`
  ).test(text);
}
function labelText(label, spec) {
  return spec.scheme === "ordinal" ? label : `\u7F16\u53F7${label}`;
}
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var COMPOSE_SYSTEM = {
  number: [
    "\u4F60\u662F\u89C6\u9891\u751F\u6210\u63D0\u793A\u8BCD\u7684\u7F16\u8F91\u3002\u7528\u6237\u4F1A\u7ED9\u4F60\u4E00\u6BB5\u5DF2\u7ECF\u5199\u597D\u7684\u4E2D\u6587\u63D0\u793A\u8BCD\uFF0C\u4EE5\u53CA\u4F5C\u8005\u8865\u5145\u7684\u4E00\u53E5\u8BDD\u3002",
    "\u4F60\u552F\u4E00\u7684\u4EFB\u52A1\uFF1A\u628A\u4F5C\u8005\u90A3\u53E5\u8BDD\u81EA\u7136\u5730\u878D\u8FDB\u8FD9\u6BB5\u63D0\u793A\u8BCD\uFF0C\u8BA9\u5168\u6587\u8BFB\u8D77\u6765\u50CF\u4E00\u6BB5\u8FDE\u8D2F\u7684\u4E2D\u6587\u3002",
    "\u786C\u6027\u8981\u6C42\uFF08\u8FDD\u53CD\u4EFB\u4F55\u4E00\u6761\u90FD\u7B97\u5931\u8D25\uFF09\uFF1A",
    "1. \u300C\u7F16\u53F7N=\u89D2\u8272\u540D\u300D\u8FD9\u79CD\u7B49\u53F7\u7ED1\u5B9A\u5FC5\u987B**\u9010\u5B57\u539F\u6837**\u4FDD\u7559\uFF1A\u7F16\u53F7\u3001\u7B49\u53F7\u3001\u89D2\u8272\u540D\u4E00\u4E2A\u5B57\u90FD\u4E0D\u80FD\u6539\uFF0C",
    "   \u4E0D\u8BB8\u8C03\u6362\u7B49\u53F7\u4E24\u8FB9\uFF0C\u4E0D\u8BB8\u6539\u5199\u6210\u53E5\u5B50\uFF0C\u4E0D\u8BB8\u91CD\u65B0\u7F16\u53F7\uFF08\u7F16\u53F7\u4E0D\u8FDE\u7EED\u662F\u6B63\u5E38\u7684\uFF09\uFF1B",
    "2. \u4E0D\u8BB8\u6539\u52A8\u6216\u5220\u9664\u4EFB\u4F55\u4E00\u4E2A\u300C\u7F16\u53F7N\u300D\uFF0C\u5305\u62EC\u90A3\u4E9B\u8BF4\u300C\u4FDD\u6301\u767D\u8272\u4EBA\u5076\u539F\u6837\u300D\u7684\uFF1B",
    "3. \u4E0D\u8BB8\u589E\u52A0\u539F\u6587\u6CA1\u6709\u7684\u753B\u9762\u8981\u6C42\uFF0C\u4E5F\u4E0D\u8BB8\u5220\u6389\u539F\u6587\u4EFB\u4F55\u4E00\u6761\u8981\u6C42\uFF1B",
    "4. \u76F4\u63A5\u8F93\u51FA\u6210\u54C1\u6B63\u6587\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u52A0\u5F15\u53F7\u3001\u4E0D\u8981\u7528 Markdown\u3001\u4E0D\u8981\u5206\u70B9\u3002"
  ].join("\n"),
  ordinal: [
    "\u4F60\u662F\u89C6\u9891\u751F\u6210\u63D0\u793A\u8BCD\u7684\u7F16\u8F91\u3002\u7528\u6237\u4F1A\u7ED9\u4F60\u4E00\u6BB5\u5DF2\u7ECF\u5199\u597D\u7684\u4E2D\u6587\u63D0\u793A\u8BCD\uFF0C\u4EE5\u53CA\u4F5C\u8005\u8865\u5145\u7684\u4E00\u53E5\u8BDD\u3002",
    "\u4F60\u552F\u4E00\u7684\u4EFB\u52A1\uFF1A\u628A\u4F5C\u8005\u90A3\u53E5\u8BDD\u81EA\u7136\u5730\u878D\u8FDB\u8FD9\u6BB5\u63D0\u793A\u8BCD\uFF0C\u8BA9\u5168\u6587\u8BFB\u8D77\u6765\u50CF\u4E00\u6BB5\u8FDE\u8D2F\u7684\u4E2D\u6587\u3002",
    "\u786C\u6027\u8981\u6C42\uFF08\u8FDD\u53CD\u4EFB\u4F55\u4E00\u6761\u90FD\u7B97\u5931\u8D25\uFF09\uFF1A",
    "1. \u300C\u6700\u5DE6\u8FB9=\u89D2\u8272\u540D\u300D\u8FD9\u79CD\u7B49\u53F7\u7ED1\u5B9A\u5FC5\u987B**\u9010\u5B57\u539F\u6837**\u4FDD\u7559\uFF1A\u4F4D\u7F6E\u8BF4\u6CD5\u3001\u7B49\u53F7\u3001\u89D2\u8272\u540D\u4E00\u4E2A\u5B57\u90FD\u4E0D\u80FD\u6539\uFF0C",
    "   \u4E0D\u8BB8\u8C03\u6362\u7B49\u53F7\u4E24\u8FB9\uFF0C\u4E0D\u8BB8\u6539\u5199\u6210\u53E5\u5B50\uFF0C**\u4E0D\u8BB8\u628A\u4F4D\u7F6E\u6362\u6210\u8FD1\u4E49\u8BF4\u6CD5**\uFF08\u628A\u300C\u4ECE\u5DE6\u6570\u7B2C3\u4E2A\u300D\u5199\u6210\u300C\u7B2C\u4E09\u4E2A\u300D\u300C\u5DE6\u8D77\u7B2C\u4E09\u4F4D\u300D\u90FD\u7B97\u5931\u8D25\uFF09\uFF1B",
    "   \u4F4D\u7F6E\u8BF4\u6CD5\u540E\u9762\u82E5\u5E26\u7740\u4E00\u4E2A\u62EC\u53F7\uFF08\u4F8B\uFF1A\u300C\u6700\u5DE6\u8FB9\uFF08\u7EAF\u767D\uFF0C\u5F13\u6B65\u524D\u503E\uFF09=\u51DB\u300D\uFF09\uFF0C\u90A3\u4E2A\u62EC\u53F7\u8FDE\u540C\u91CC\u9762\u7684\u5B57**\u4E00\u8D77\u539F\u6837\u7559\u5728\u7B49\u53F7\u5DE6\u8FB9**\uFF0C",
    "   \u4E0D\u8BB8\u628A\u5B83\u632A\u8D70\u3001\u62C6\u6210\u53E6\u4E00\u53E5\u8BDD\u3001\u6216\u6539\u5199\u6210\u300C\u90A3\u4E2A\u5F13\u6B65\u524D\u503E\u7684\u4EBA\u5076\u300D\u2014\u2014\u5B83\u662F\u7528\u6765\u6307\u8BA4\u8FD9\u4E2A\u4EBA\u5076\u7684\u7B2C\u4E8C\u4E2A\u4F9D\u636E\uFF1B",
    "2. \u4E0D\u8BB8\u6539\u52A8\u6216\u5220\u9664\u4EFB\u4F55\u4E00\u4E2A\u4F4D\u7F6E\u8BF4\u6CD5\uFF08\u300C\u6700\u5DE6\u8FB9\u300D\u300C\u4ECE\u5DE6\u6570\u7B2CN\u4E2A\u300D\u300C\u6700\u53F3\u8FB9\u300D\uFF09\uFF0C\u5305\u62EC\u90A3\u4E9B\u8BF4\u300C\u4FDD\u6301\u767D\u8272\u4EBA\u5076\u7684\u6837\u5B50\u300D\u7684\uFF1B",
    "3. **\u5FC5\u987B\u4FDD\u6301\u8FD9\u4E9B\u7ED1\u5B9A\u5728\u53E5\u5B50\u91CC\u7684\u5148\u540E\u987A\u5E8F\uFF0C\u4E00\u5F8B\u4E0D\u8BB8\u8C03\u6362**\u2014\u2014\u5B83\u4EEC\u662F\u6309\u4EBA\u7269\u5728\u753B\u9762\u4E0A\u4ECE\u5DE6\u5230\u53F3\u6392\u597D\u7684\uFF0C",
    "   \u987A\u5E8F\u4E00\u4E71\uFF0CAI \u5C31\u4F1A\u628A\u89D2\u8272\u6362\u5230\u522B\u4EBA\u8EAB\u4E0A\uFF1B",
    "4. \u4E0D\u8BB8\u589E\u52A0\u539F\u6587\u6CA1\u6709\u7684\u753B\u9762\u8981\u6C42\uFF0C\u4E5F\u4E0D\u8BB8\u5220\u6389\u539F\u6587\u4EFB\u4F55\u4E00\u6761\u8981\u6C42\uFF1B",
    "5. \u76F4\u63A5\u8F93\u51FA\u6210\u54C1\u6B63\u6587\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u52A0\u5F15\u53F7\u3001\u4E0D\u8981\u7528 Markdown\u3001\u4E0D\u8981\u5206\u70B9\u3002"
  ].join("\n")
};
async function composeBlockoutPrompt(cast, userLine, spec) {
  const skeleton = blockoutApplySkeleton(cast, userLine, spec);
  const slots = orderSlots(cast, spec);
  if (!AI_REAL) return skeleton;
  const line = userLine.trim();
  if (!line) return skeleton;
  const cards = new Set(slots.flatMap((s) => s.card ? [s.card.id] : []));
  const budget = Math.max(blockoutPromptBudget(cards.size), skeleton.length);
  const context = slots.flatMap((s) => s.card ? [`${labelText(s.label, spec)}\uFF08\u539F\u89C6\u9891\u91CC\u662F${s.desc || "\u67D0\u4E2A\u4EBA\u7269"}\uFF09\u2192 ${s.card.name}`] : []).join("\n");
  let out = "";
  try {
    out = await chat(
      COMPOSE_SYSTEM[spec.scheme],
      [
        "\u3010\u5DF2\u5199\u597D\u7684\u63D0\u793A\u8BCD\u3011",
        skeleton,
        "",
        "\u3010\u4F5C\u8005\u8865\u5145\u7684\u90A3\u53E5\u8BDD\u3011",
        line,
        "",
        "\u3010\u89D2\u8272\u4F4D\u5BF9\u7167\uFF08\u4EC5\u4F9B\u4F60\u7406\u89E3\uFF0C\u4E0D\u8981\u5199\u8FDB\u6210\u54C1\uFF09\u3011",
        context || "\uFF08\u65E0\uFF09",
        "",
        `\u3010\u957F\u5EA6\u3011\u5168\u6587\u4E0D\u8D85\u8FC7 ${budget} \u4E2A\u5B57\u3002`
      ].join("\n")
    );
  } catch (e) {
    throw new Error(
      `\u63D0\u793A\u8BCD\u5408\u6210\u5931\u8D25\uFF08${e instanceof Error ? e.message : String(e)}\uFF09\u2014\u2014\u8FD9\u4E00\u6BB5\u7684\u8981\u6C42\u8BF7\u81EA\u5DF1\u5199\uFF0C\u6216\u7528\u4E0B\u9762\u90A3\u4EFD\u9ED8\u8BA4\u5199\u6CD5\u3002`
    );
  }
  const text = out.replace(/```[a-z]*|```/gi, "").trim();
  if (!text) {
    throw new Error("\u63D0\u793A\u8BCD\u5408\u6210\u5931\u8D25\uFF1AAI \u4EC0\u4E48\u90FD\u6CA1\u8FD4\u56DE\u2014\u2014\u8FD9\u4E00\u6BB5\u7684\u8981\u6C42\u8BF7\u81EA\u5DF1\u5199\uFF0C\u6216\u7528\u4E0B\u9762\u90A3\u4EFD\u9ED8\u8BA4\u5199\u6CD5\u3002");
  }
  const missLabel = slots.find((s) => !hasLabel(text, s.label, spec));
  if (missLabel) {
    throw new Error(
      `\u63D0\u793A\u8BCD\u5408\u6210\u5931\u8D25\uFF1AAI \u6539\u5199\u65F6\u628A\u300C${labelText(missLabel.label, spec)}\u300D\u8FD9\u4E2A\u89D2\u8272\u4F4D\u5F04\u4E22\u4E86\uFF08${spec.scheme === "ordinal" ? "\u4F4D\u7F6E\u6362\u4E2A\u8BF4\u6CD5" : "\u7F16\u53F7\u9519\u4E00\u4F4D"}\u5C31\u4F1A\u628A\u5361\u6362\u5230\u522B\u4EBA\u8EAB\u4E0A\uFF09\u2014\u2014\u8FD9\u4E00\u6BB5\u7684\u8981\u6C42\u8BF7\u81EA\u5DF1\u5199\uFF0C\u6216\u7528\u4E0B\u9762\u90A3\u4EFD\u9ED8\u8BA4\u5199\u6CD5\u3002`
    );
  }
  const missPair = slots.find((s) => s.card && !hasPair(text, s.label, s.card.name, spec));
  if (missPair?.card) {
    throw new Error(
      `\u63D0\u793A\u8BCD\u5408\u6210\u5931\u8D25\uFF1AAI \u6539\u5199\u65F6\u52A8\u4E86\u300C${labelText(missPair.label, spec)}=${missPair.card.name}\u300D\u8FD9\u6761\u7ED1\u5B9A\uFF08${spec.scheme === "ordinal" ? "\u4F4D\u7F6E" : "\u7F16\u53F7"}\u4E0E\u89D2\u8272\u540D\u5FC5\u987B\u539F\u6837\u6210\u5BF9\uFF0C\u914D\u9519\u4E86\u5C31\u662F\u628A\u5361\u6362\u5230\u522B\u4EBA\u8EAB\u4E0A\uFF09\u2014\u2014\u8FD9\u4E00\u6BB5\u7684\u8981\u6C42\u8BF7\u81EA\u5DF1\u5199\uFF0C\u6216\u7528\u4E0B\u9762\u90A3\u4EFD\u9ED8\u8BA4\u5199\u6CD5\u3002`
    );
  }
  if (spec.scheme === "ordinal") {
    const posOf = (s) => {
      const l = esc(s.label);
      const re = s.card ? new RegExp(`${l}${DESC_PAREN}\\s*[=\uFF1D]\\s*${esc(s.card.name)}`) : new RegExp(`${l}${DESC_PAREN}(?=\\s*[=\uFF1D]|\u7684?\u4EBA\u5076)`);
      return text.search(re);
    };
    const ordered = (group) => {
      let prev = -1;
      for (const s of group) {
        const at = posOf(s);
        if (at <= prev) return false;
        prev = at;
      }
      return true;
    };
    if (!ordered(slots.filter((s) => s.card)) || !ordered(slots.filter((s) => !s.card))) {
      throw new Error(
        "\u63D0\u793A\u8BCD\u5408\u6210\u5931\u8D25\uFF1AAI \u6539\u5199\u65F6\u628A\u89D2\u8272\u4F4D\u7684\u5148\u540E\u987A\u5E8F\u6253\u4E71\u4E86\uFF08\u8FD9\u6BB5\u8BDD\u5FC5\u987B\u6309\u753B\u9762\u4E0A\u4ECE\u5DE6\u5230\u53F3\u7684\u987A\u5E8F\u5199\uFF0C\u987A\u5E8F\u4E00\u4E71\u5C31\u4F1A\u6362\u9519\u4EBA\u2014\u2014\u5B9E\u6D4B\u540C\u6837\u4E09\u5F20\u5361\uFF0C\u53EA\u628A\u987A\u5E8F\u5199\u53CD\uFF0C5 \u4E2A\u4F4D\u5B50\u91CC\u5C31\u9519\u4E86 3 \u4E2A\uFF09\u2014\u2014\u8FD9\u4E00\u6BB5\u7684\u8981\u6C42\u8BF7\u81EA\u5DF1\u5199\uFF0C\u6216\u7528\u4E0B\u9762\u90A3\u4EFD\u9ED8\u8BA4\u5199\u6CD5\u3002"
      );
    }
  }
  const clearsMarks = text.split(/[。；;!！\n]/).some(
    (s) => (
      // ★ 动词放得比原来更松（不再要求"不许**出现**"这种固定搭配）：真正把假阳性
      //   挡住的是下面那两个**同句共现**的名词，动词严一点只会误伤合理的改写
      /(去掉|去除|抹掉|擦掉|删掉|不保留|不许|不要|不得|不能|没有)/.test(s) && /(编号|数字|号码)/.test(s) && /人偶/.test(s)
    )
  );
  if (spec.scheme === "number" && !clearsMarks) {
    throw new Error(
      "\u63D0\u793A\u8BCD\u5408\u6210\u5931\u8D25\uFF1AAI \u6539\u5199\u65F6\u628A\u300C\u53BB\u6389\u4EBA\u5076\u8EAB\u4E0A\u7684\u7F16\u53F7\u300D\u8FD9\u53E5\u4E22\u4E86\uFF08\u4E22\u4E86\u7684\u8BDD\u6210\u7247\u91CC\u4EBA\u7269\u5934\u4E0A\u4F1A\u9876\u7740\u7F16\u53F7\uFF0C\u94B1\u82B1\u5B8C\u624D\u770B\u5F97\u51FA\u6765\uFF09\u2014\u2014\u8FD9\u4E00\u6BB5\u7684\u8981\u6C42\u8BF7\u81EA\u5DF1\u5199\uFF0C\u6216\u7528\u4E0B\u9762\u90A3\u4EFD\u9ED8\u8BA4\u5199\u6CD5\u3002"
    );
  }
  return text;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  blockoutApplySkeleton,
  blockoutPromptBudget,
  castNameIssue,
  composeBlockoutPrompt,
  orderSlots
});
