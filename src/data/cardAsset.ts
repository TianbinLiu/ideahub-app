// 人物卡的**方舟可信素材 ID**（`asset://…`）—— 本机侧库，不进 Card 对象。
//
// ★★ 这是什么：方舟 Seedance 2.0/2.5 **不收直接上传的真人人脸**，但收「可信素材库」里
//   已授权的素材。被拍的人扫码做完真人认证 + 肖像授权后，方舟给一个
//   `asset-20260401123823-6d4x2` 形式的资产 ID，出片时按 `asset://<id>` 当参考图传，
//   就不会撞人脸审核。这是**官方合规通道**，不是绕过（docs/backlog.md §1 有三条路的对照）。
//
// ★★ 为什么是侧库而不是 `Card.assetId`（与 cardVoice 同一条理由，外加两条更强的）：
//   ① 远端模式下卡的真相是服务端那份，`loadRemoteAssets` 冷启动**整体覆盖** db.cards，
//      而服务端 zod 会 strip 未声明字段（`deck` 就这么丢过）；
//   ② 资产**绑死在某个火山账号**下 —— 跟着卡分享出去对别人一点用都没有（他那个账号
//      拿这个 id 只会收到 400 asset not found），存进卡里等于承诺了一件做不到的事；
//   ③ 它背后是**某个真人的肖像授权**。授权给的是"这个账号"，不是"拿到这张卡的任何人"。
//      让它随卡走，就是我们替被授权人做了一个他没同意的授权。
//   ⇒ 不随分享是**有意的**，与「真人卡不可分享」同一条产品决定。
//
// ★★ 但「不跨设备」不是（2026-09-05 主人真机：并排装了 debug 包再登录，卡从服务端回来了、
//   绑定却没有 —— 屏幕上就是「退出再登录，授权就失效了」）。授权给的是**账号**，所以服务端
//   按卡存一份（server BranchCard.portrait：只有卡主自己读得到，广场与安装都不带），
//   这个侧库退成它的**本机镜像**：登录时 `adoptRemoteAssets` 以服务端那份为准装回来，
//   本机独有的（离线绑的 / 老版本绑的）由 account.syncCardAssets 补传上去。
//   ⇒ **写入口只有一处 `account.bindCardAsset`**（本机 + 服务端两步各自回执），
//     这里的 saveAsset / removeAsset 是它的本机那一半，别在页面里直接调。
//
// ★ 读是同步的（渲染层每拍都问），全部数据靠模块加载时 hydrate 一次（同 cardVoice）。
import { idbGet, idbSet } from "./db";

/**
 * 授权范围。**枚举不是布尔** —— 将来若开放"形象公开化"（被拍者同意公开给平台内他人用），
 * 存量数据必须分得清「没授权」与「只授权了我自己」，布尔到那时就没法迁移了
 * （docs/backlog.md §1.4 拍板时就点了这一条）。
 */
export type AssetScope = "private" | "public";

export interface CardAsset {
  /** 纯 id（**不带** `asset://` 前缀）—— 前缀在拼 URI 那一处加，见 assetUri */
  assetId: string;
  /** 授权范围。当前只可能是 private（public 那条还没开） */
  scope: AssetScope;
  /** 来源备注（"2026-08-27 由本人扫码授权"），详情页展示 */
  note?: string;
}

const KEY = "ideahub.cardAssets";

/**
 * 方舟资产 ID 的形状：`asset-` + 时间戳 + `-` + 随机短串
 * （官方示例 `asset-20260401123823-6d4x2` / `asset-20260222234430-mxpgh`）。
 *
 * ★ 收得**不算太紧**：这是方舟那边生成的格式，我们没有权威规格，写太死会把合法 id 拒掉，
 *   而"明明是从控制台复制来的却说格式不对"比放过一个错 id 更难排查。真错了方舟会回
 *   400 asset not found，那一句才是权威判据。
 */
const ASSET_ID_RE = /^asset-\d{8,14}-[A-Za-z0-9]{3,16}$/;

/**
 * 把用户粘贴的东西**归一成纯 id**。控制台上「复制 asset ID」与「复制 URI」是两颗按钮，
 * 用户两种都可能粘进来，所以两种都收（唯一实现，别在 UI 里再剥一次前缀）。
 * 返回 null = 认不出来。
 */
export function normalizeAssetId(raw: string): string | null {
  const s = (raw || "").trim().replace(/^asset:\/\//i, "");
  return ASSET_ID_RE.test(s) ? s : null;
}

/**
 * 拼成发给方舟的 URI。**唯一实现** —— 调用点不许自己 `"asset://" + id`：
 * 那是第二处拼法，哪天前缀变了会有一处漏掉，而表现是 400（还算好）或者更糟的静默不生效。
 */
export function assetUri(id: string): string {
  return `asset://${id}`;
}

let map: Record<string, CardAsset> = {};
let version = 0;
const subs = new Set<() => void>();

function emit(): void {
  version++;
  for (const fn of subs) fn();
}

export function subscribeAssets(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function assetsVersion(): number {
  return version;
}

/** 这张卡的可信素材（同步读）。没有 = 这张卡还没做过授权 */
export function assetOf(cardId: string | undefined): CardAsset | null {
  if (!cardId) return null;
  return map[cardId] ?? null;
}

/** 这张卡有没有可用的可信素材 —— 出片闸问的就是这一句 */
export function hasAsset(cardId: string | undefined): boolean {
  return !!assetOf(cardId);
}

/**
 * 落一条肖像授权绑定。
 * @returns `false` = **只写进了内存，没落盘**（配额满 / 隐私模式），重启就没了。
 *
 * ★★ 为什么必须回布尔（2026-09-01 复核抓到）：`idbSet` 自己 try/catch 把异常吞掉、回 false
 *   （见 data/db.ts），所以这里原来的 `await idbSet(...)` **永远不会抛**。后果是
 *   `CardDetailPage` 那处认认真真写着「写失败要出声（铁律八）」的 `.catch` 一次都跑不到 ——
 *   用户以为授权绑好了，重启后绑定消失，卡上还挂着真人声明，出片那一刻才被拒。
 * ★ 内存那份**照写不误**：这一次会话里出片仍然走得通，回 false 只是说"别指望它还在"。
 */
/**
 * 哪几条**只写进了内存、没落盘**。
 * ★★ 为什么必须记（2026-09-01 复核抓到）：`saveAsset` 是"内存照写不误 + 落盘可能失败"，
 *   而卡详情页那条授权窄条的隐藏判据是 `assetOf(card.id)`（绑上即消失）——写内存那一拍
 *   `emit()` 就把窄条收了，**连同它自己那句错误提示一起**。于是「写失败要出声」这件事
 *   在那一页做不到，而铸卡页给的出路（「去卡详情页重做一次授权」）也当场走不通：
 *   到了那一页，窄条根本不出现。判据换成"落盘了吗"，这两条才通。
 * ★ 只在本次会话有效（进程重启后内存那份本来就没了，窄条会因为 assetOf 为空自然出现）。
 */
const unpersisted = new Set<string>();

/**
 * 本机绑上了、**服务端还没收下**的那几张：卡 id → 原因（整句人话）。
 * ★ 与 unpersisted 是两件事：那个说"重启就没"，这个说"换台设备就没"。后者不是丢 ——
 *   下次登录 account.syncCardAssets 会把本机独有的补传，所以只要有人把话说出来（卡详情页）。
 * 唯一写方：account.bindCardAsset / syncCardAssets。只在本次会话有效。
 */
const syncIssues = new Map<string, string>();

export function setAssetSyncIssue(cardId: string, reason: string | null): void {
  if (reason) syncIssues.set(cardId, reason);
  else if (!syncIssues.delete(cardId)) return;
  emit();
}

/** 这张卡的绑定服务端还没收下的原因；null = 收下了 / 没绑过 / 离线模式 */
export function assetSyncIssue(cardId: string | undefined): string | null {
  return cardId ? (syncIssues.get(cardId) ?? null) : null;
}

/** 这张卡的授权绑定**真的存住了吗**（false = 只在内存里，重启就没）。没绑过也回 false */
export function assetPersisted(cardId: string | undefined): boolean {
  if (!cardId || !map[cardId]) return false;
  return !unpersisted.has(cardId);
}

export async function saveAsset(cardId: string, a: CardAsset): Promise<boolean> {
  map = { ...map, [cardId]: a };
  unpersisted.add(cardId); // 先当成没存住，落盘成了再摘掉 —— 中间那一拍窄条不该消失
  emit();
  const ok = await idbSet(KEY, map);
  if (ok) unpersisted.delete(cardId);
  emit(); // 落盘结果本身也是可见状态（窄条按 assetPersisted 判去留）
  return ok;
}

/** 撤掉绑定。@returns `false` = 内存里撤了但没落盘（重启会"复活"）——同 saveAsset 的 ★★ */
export async function removeAsset(cardId: string): Promise<boolean> {
  if (!map[cardId]) return true;
  const next = { ...map };
  delete next[cardId];
  map = next;
  unpersisted.delete(cardId);
  emit();
  return await idbSet(KEY, next);
}

// 模块加载时 hydrate 一次（同 cardVoice）。失败就当没有 —— 侧库不该让工坊打不开。
// ★ 与内存里已有的**合并**（内存优先）：hydrate 还没回来时就绑上的那一条不该被盘上那份盖掉。
const hydrated: Promise<void> = (async () => {
  try {
    const saved = await idbGet<Record<string, CardAsset>>(KEY);
    if (saved && typeof saved === "object") {
      map = { ...saved, ...map };
      emit();
    }
  } catch {
    /* 读不出来就当空的 */
  }
})();

/**
 * 登录 / 冷启动时用服务端那份（BranchCard.portrait）对齐本机镜像 —— **服务端为准**。
 * @param remote 卡 id → 绑定（服务端有的那些）
 * @param ownedIds 这次从服务端拉回来的、我名下的全部卡 id
 * @returns 本机有、服务端没有的那几张（**只限我名下的卡**）—— 调用方补传上去。
 * ★ 只增不删：服务端没有 ≠ 用户在别处解绑了（app 至今没有解绑入口），更可能是老版本 /
 *   离线时绑的还没上行 —— 删了就是把用户做过的授权丢掉。
 * ★ 不在我名下的卡（别人的、已删的）原样留着不动：侧库只按 id 记，不认主人。
 * ★ 等 hydrate 回来再算，否则"本机独有"会把盘上那些也算进去、白白补传一遍。
 */
export async function adoptRemoteAssets(remote: Record<string, CardAsset>, ownedIds: Iterable<string>): Promise<string[]> {
  await hydrated;
  const owned = new Set(ownedIds);
  const localOnly = Object.keys(map).filter((id) => owned.has(id) && !remote[id]);
  const changed = Object.keys(remote).some(
    (id) => map[id]?.assetId !== remote[id].assetId || (map[id]?.note ?? "") !== (remote[id].note ?? ""),
  );
  if (changed) {
    map = { ...map, ...remote };
    for (const id of Object.keys(remote)) unpersisted.delete(id);
    emit();
    await idbSet(KEY, map);
  }
  return localOnly;
}
