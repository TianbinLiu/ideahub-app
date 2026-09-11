// 「剪到一半的那条成片」—— 剪辑页的合成稿落盘。
//
// ★★ 为什么必须落盘（这是**钱**的问题，不是体验问题）：进剪辑页那一刻，用户手上已经有
//   一摊**真花过钱**的东西，而它们**全都只活在内存里**：
//     · 组稿铸出来的卡组（最多 8 张，按真实调用逐笔真扣）与 3D 建模
//       （最多 2 个 × 160k token）—— GLB 落了 idb，但 `idb:` 指针只在内存 draft 上；
//     · 圈选重拍已经改好并已扣钱的那几段；
//     · 合并录出来的那条 webm（几十 MB，实时录制几分钟）；
//     · 方舟直链跨境转存的成果。
//   切后台被系统回收（这正是丢结果最常见的方式）之后，这些全部重来 —— 而"重来"意味着
//   **再收一次那笔钱**。守卫还会把人 `navigate("/studio")`，屏幕上一个字都不解释。
//
// ★ 照 `videos.ts` 的 PendingPublish 写（idb 键 + 内存镜像 + 启动装载 + 可见入口 + 放弃出路），
//   那一套的理由与这里逐条对得上。**不塞进 `data/drafts.ts`**：那是"还没做完的流水线"，
//   字段完全不重叠，而且它有 20 条上限 —— 塞进去等于拿剪辑稿挤真正的在途工程
//   （与「简约模式不进草稿库」被挡掉的理由同型）。
//
// ★ **永远只有一条**：同一时刻只可能在剪一条片子，新的整体覆盖旧的。所以不需要淘汰策略，
//   也不跟草稿那 20 条抢配额。
//
// ⚠ webm 与 GLB 的**字节不进这个键**，进来的只是 `idb:<键>` 指针 —— 但正因为如此，
//   `cacheSweep.collectReferenced` **必须把这条稿子里的指针算进引用**（那边第 5 段），
//   否则放过一夜的剪辑稿会被「清理缓存」把成片和模型真删掉，稿子还在、指针指向空气。
import { idbRead, idbSet, idbDel } from "./db";
import type { DraftVideo } from "../types";

const CUT_KEY = "ideahub-app.cut.v1";

export interface CutSession {
  draft: DraftVideo;
  /**
   * 剪辑页的**音轨预置**（`studioStore.draftAudioHint` 的那份，模板原片地址）。
   *
   * ★★ 为什么它必须跟着稿子落盘（2026-09-07 主人真机：「原本有声音的又没声音了」）：
   *   `draftAudioHint` 只在**组稿那一拍**（finalizeInner）算一次，而且只活在内存 store 上。
   *   白模复刻段的成片文件本身是**无声**的（BLOCKOUT_TASK 钉着 generate_audio:false，
   *   那是版权拦截换来的），声音全靠这条预置在合并时混进去。于是只要 App 重启过一次，
   *   再从个人页「接着剪」回到剪辑页，音频页签就是空的 —— 合出来的成片**整条没有声音**，
   *   而屏幕上一个字都不会说（音频是"可选项"，空着不算错）。
   *   ⇒ 稿子存了、声音没存 = 把一条只在内存里的关键状态漏在了重启的另一边。
   * ★ 老稿子没有这一位（undefined）**按"没有预置"算**，不是"预置为空" —— 判否定，
   *   与本仓「后加的字段一律判否定」同一条。
   */
  audioHint?: string;
  /** 存下来的时刻（横幅上说"什么时候剪的"用） */
  at: number;
}

/** 内存镜像：页面与守卫都要**同步**问"有没有一条剪到一半的" */
let mirror: CutSession | null = null;
let loaded = false;

const listeners = new Set<() => void>();
function emit(): void {
  for (const fn of listeners) fn();
}
export function subscribeCutSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 剪辑稿没读出来时的原因（空串 = 读好了）。
 *
 * ★★ 2026-09-11 改：原来读失败直接当"没有"（注释写着"这是个恢复用的副本，不该让它把启动搞挂"）。
 *   启动确实不该被它搞挂 —— 现在也不挂；但「没有」在这里是一句**有后果**的话：组稿前那道闸
 *   （useFlowActions.cut）问的正是 cutSession() 有没有一条剪到一半的，没有才放行，而组稿会覆盖这个
 *   唯一的落盘键。读失败当成没有 = 一条花过钱的剪辑稿被**不打招呼地顶掉**，个人页那条横幅也凭空消失。
 * ★ 所以非空时：横幅改说「没读出来 + 重试」；组稿闸、saveCutSession、dropCutSession 都先重读一次，
 *   还读不出来就拒（组稿 / 存）或只清内存不动磁盘（丢）。
 * ★ 形状不对（validate 判 null）仍然按"没有"算 —— 那是一份坏稿，不是读不出来。
 */
let loadIssue = "";

export function cutSessionLoadIssue(): string {
  return loadIssue;
}

/**
 * 装载。开机调一次，横幅上的「重试」与写之前的自愈也调它。**不会 reject**。
 * ★ 读好了之后再调直接返回：内存镜像此后由 save / drop 维护，再读一遍只会拿磁盘上的旧值去盖它。
 */
export async function readyCutSession(): Promise<void> {
  if (loaded && !loadIssue) return;
  try {
    // ★★ 读失败要抛（idbRead）落进 catch，不能当成"没有"（见 loadIssue）
    const raw = await idbRead<unknown>(CUT_KEY);
    mirror = validate(raw);
    loadIssue = "";
  } catch (e) {
    mirror = null;
    loadIssue = e instanceof Error ? e.message : String(e);
    console.warn("[cutSession] 剪辑稿没读出来:", e);
  }
  loaded = true;
  emit();
}

/**
 * 存下来的东西当**不可信输入**：形状不对整条丢。
 * ★ 一份坏稿不该让剪辑页崩掉 —— 而它恰恰是"上次崩了/被杀了"才留下的。
 */
function validate(raw: unknown): CutSession | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<CutSession>;
  const d = o.draft as DraftVideo | undefined;
  if (!d || typeof d !== "object" || !Array.isArray(d.segments) || d.segments.length === 0) return null;
  return {
    draft: d,
    ...(typeof o.audioHint === "string" && o.audioHint ? { audioHint: o.audioHint } : {}),
    at: typeof o.at === "number" ? o.at : 0,
  };
}

/** 同步读镜像。★ 没装载完时返回 null —— 调用方要能分清"没有"和"还没装完"就问 `cutSessionReady()` */
export function cutSession(): CutSession | null {
  return mirror;
}

export function cutSessionReady(): boolean {
  return loaded;
}

/**
 * 存一稿。**回执是 boolean**（`idbSet` 本来就返回它）：存不住必须能被上层说出来 ——
 * 而调用它的每一处都恰好是"钱刚花出去"的那一拍（铁律八）。
 */
export async function saveCutSession(draft: DraftVideo, audioHint: string | null): Promise<boolean> {
  // ★ `audioHint` **必填**（哪怕传 null）：漏传它是零症状的 —— 稿子照存、回执照样是 true，
  //   只有几天后用户抱怨"合出来没声音"时才看得见。本仓「漏了就零症状的参数一律钉成必填」。
  // ★★ 上一条没读出来时先重读一次（见 loadIssue）：读出来了就照常写（组稿闸那边已经问过要不要顶掉）；
  //   还读不出来就拒 —— 盖下去的可能是一条花过钱、用户此刻看不见的剪辑稿。原因由调用方问 cutSessionLoadIssue() 说
  if (loadIssue) {
    await readyCutSession();
    if (loadIssue) return false;
  }
  const next: CutSession = { draft, ...(audioHint ? { audioHint } : {}), at: Date.now() };
  const ok = await idbSet(CUT_KEY, next);
  if (ok) {
    mirror = next;
    emit();
  }
  return ok;
}

/** 这摊活收工了（发布成功 / 用户明确丢掉）。★ blob 不在这里删：交给 cacheSweep 24h 后收
 *  —— 在这儿再写一处删除逻辑就是第二份实现，而且它没有"还有没有别人引用"的全局视野 */
export async function dropCutSession(): Promise<void> {
  // ★★ 上一条没读出来时**只清内存、不动磁盘**（2026-09-11）：这时要收工的是这次会话里那份 —— 它根本没存进去
  //   （saveCutSession 在读不出来时拒），磁盘上那个键装的是读不出来的**上一条**，删掉就是替用户丢了一条他没见过、
  //   花过钱的剪辑稿。顺手再读一次：读得出来的话它会照常以横幅出现，接着剪还是丢由用户自己决定。
  if (loadIssue) {
    mirror = null;
    emit();
    void readyCutSession();
    return;
  }
  mirror = null;
  emit();
  await idbDel(CUT_KEY);
}
