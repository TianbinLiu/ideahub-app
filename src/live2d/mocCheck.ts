/**
 * @file mocCheck.ts - 加载 .moc3 之前的那道检查：版本读不读得了 + Cubism Core 的结构一致性检查（csmHasMocConsistency）
 * @category Utility
 *
 * ★ 零运行时依赖、不碰 window：Core 由调用方传进来（loader.ts 装在运行时上的那层包装、上传向导第 ① 步的本地核对都走这里），
 *   这样同一份判定在 node 里拿真 Core（vm 里跑 live2dcubismcore.min.js）就能实跑。
 * ★ 这是**格式校验**，不是安全补丁（别把文案写成「没通过安全检查」）：Live2D 官方的漏洞应对页给 Web SDK 写的是
 *   「没有漏洞，但提供一个检查 MOC3 格式的 API」—— WebView 里跑的是 wasm 版 Core，越界写出不了它自己的堆。
 *   真正的收益（2026-10-26 本机 node vm 实测，官方 mascot.moc3 做 45 种结构篡改，各在一份新 Core 里跑）：
 *   一致性检查判 0 的 20 份里，16 份**不开检查照样加载成功**（画成什么样没人知道，也没人说一句为什么）、
 *   3 份在 JS 层抛 RangeError、**1 份把 Core 共用的堆写坏**，同一页里再加载官方 mascot 也抛 —— 那就是
 *   「市场形象和官方形象都没出来」的一个成因。检查在 Core 读这份文件之前就把它拦下。
 *   检查只核结构不核内容（另外 25 份改写照样判 1、也照样加载），所以它不是「文件完好」的证明。
 *   复现脚本的做法：vm 里跑 live2dcubismcore.min.js，每种篡改各开一份新 Core，先 hasMocConsistency、再 Moc.fromArrayBuffer + Model.fromMoc、
 *   再在同一份 Core 里加载原版 mascot 看堆有没有被写坏。
 * ★ 先判版本再判一致性：版本号高于 Core 能读的那一档时，一致性检查同样回 0（实测把 mascot 的版本字节改成 6、7 都是 0），
 *   而这种文件**没坏**，只是我们的运行时太旧 —— 混成一类就是对作者的诬告，所以单独一个 kind，文案也单独一句。
 * ★ 实测（node vm）：随包 Core 5.1.0、csmGetLatestMocVersion = 5；官方 mascot.moc3（122,752 字节，版本字节 4）判 1，耗时约 3ms。
 *   Blend Shape 合法文件被误判 0 是 Core R6_1 的毛病，R6_2（2023-03-16）已修，我们这份比它新。
 */

/** 被拦下的两类：`tooNew` = 版本比 Core 能读的高（文件没坏）；`inconsistent` = 结构一致性检查没过（坏了或被改过） */
export type MocCheckKind = "tooNew" | "inconsistent";

/** 我们用到的那几个 Core 成员（全局 Live2DCubismCore 没有类型） */
export type CubismCoreLike = {
  Version: { csmGetLatestMocVersion(): number };
  /** ★ 挂在 prototype 上、但不读 this（Core 源码：malloc → 拷进去 → csmHasMocConsistency → free），可以直接调。回 1 / 0；申请不到内存回 undefined */
  Moc: { prototype: { hasMocConsistency(mocBytes: ArrayBuffer | Uint8Array): number | undefined } };
};

/**
 * 一致性检查 / 版本检查没过。**按类型认、别按 message 认**（CLAUDE.md 坑表「按错误 message 里的关键词判」）：
 * message 是给控制台看的英文原话，给人看的那句由各调用方按 `kind` 说（客服页、上传向导的场景不一样）。
 */
export class MocCheckFailed extends Error {
  readonly kind: MocCheckKind;
  /** 文件头里的版本字节（下标 4） */
  readonly mocVersion: number;
  /** 这份 Core 能读的最高版本 */
  readonly latestVersion: number;
  constructor(kind: MocCheckKind, mocVersion: number, latestVersion: number) {
    super(
      kind === "tooNew"
        ? `MOC3 version ${mocVersion} is newer than this Cubism Core can read (latest ${latestVersion})`
        : "MOC3 consistency check failed (csmHasMocConsistency = 0)",
    );
    this.name = "MocCheckFailed";
    this.kind = kind;
    this.mocVersion = mocVersion;
    this.latestVersion = latestVersion;
  }
}

/** moc3 文件头：前 4 字节 "MOC3"，第 5 个字节（下标 4）是版本（1 = 3.0 … 4 = 4.2、5 = 5.0）。读不到回 0 */
export function mocVersionOf(mocBytes: ArrayBuffer | Uint8Array): number {
  const view = mocBytes instanceof Uint8Array ? mocBytes : new Uint8Array(mocBytes);
  return view.byteLength > 4 ? view[4] : 0;
}

/**
 * 加载前的检查：不过就抛 `MocCheckFailed`，过了什么都不做。
 * ★ `hasMocConsistency` 回 undefined（Core 申请不到内存）时**放行**：那不是文件的问题，交给后面真加载那一步按它自己的方式失败，
 *   别把「手机内存紧」说成「文件被改过」。
 */
export function checkMoc(mocBytes: ArrayBuffer | Uint8Array, core: CubismCoreLike): void {
  const version = mocVersionOf(mocBytes);
  const latest = core.Version.csmGetLatestMocVersion();
  if (version > latest) throw new MocCheckFailed("tooNew", version, latest);
  if (core.Moc.prototype.hasMocConsistency(mocBytes) === 0) throw new MocCheckFailed("inconsistent", version, latest);
}

/** 这个错误是不是检查拦下的、是哪一类；别的错误回 null */
export function mocCheckKindOf(error: unknown): MocCheckKind | null {
  return error instanceof MocCheckFailed ? error.kind : null;
}
