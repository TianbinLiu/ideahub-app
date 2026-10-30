// 自有的加密模型白名单 —— `public/models/protected/` 下**允许随包发布**的只有这几个（2026-10-15 教材人格评审，humble-delivery-1）。
//
// ★★ 为什么是一份共用的白名单、而不是在 prune-app-assets.mjs 与 release.mjs 里各抄一份：
//   以后再加一个自有加密模型时两处必须同时改，漏一处的症状是零 —— 出包闸放行、发版闸拒绝（或反过来），人只会在
//   发版那一刻才撞上。铁律六：同一条规则只有一处实现。
// ★★ 为什么是白名单、不是裁剪表那种黑名单：`protected/` 装的是"要加密的"，不是"能发的"。rin（远坂凛）、gratia、tsumire
//   都是第三方版权素材（授权不含分发，加密拦不住 —— 解密密钥就在同一个包里）；新丢进去一个不在裁剪表上的 .glbx，
//   黑名单默认让它随包发出去、零报错。白名单的方向相反：不在表上的一律不许进包。
// ★ milltina 是委托定制、我们自有的默认铸卡师，**必须随包发**（裁掉它的后果是进工坊看不到人且不报错，2026-08-11 发出去过一版；
//   2.51–2.55 则是 worktree 里根本没有这个文件、一进工坊整页白屏）。
//
// 读它的地方：scripts/prune-app-assets.mjs（出包闸：dist/models/protected 必须**恰好**是这几个）、
//           scripts/release.mjs 第 2b 步（开包看 APK / AAB 里 assets/public/models/protected 必须恰好是这几个）。
// 加自有模型：只改这里；第三方素材别加进来 —— 加进 prune-app-assets.mjs 的裁剪表（PRUNE）让它在 dist 里就被裁掉。

/** `public/models/protected/` 下允许进包的文件名（恰好这几个：多一个 = 来路不明或第三方，少一个 = 坏包） */
export const OWN_PROTECTED_MODELS = Object.freeze(["milltina-opt.glbx"]);

/** 默认铸卡师（工坊 TableScene 无条件加载的那一个）：出包闸还要拿 VITE_ASSET_KEY 真解一次 */
export const NPC_MODEL = "milltina-opt.glbx";

/** 相对 dist/ 与 public/ 的目录名；APK 里前面再接 `assets/public/`，AAB 里接 `base/assets/public/` */
export const PROTECTED_DIR = "models/protected";
