// 工作流画布要用的三件页级活儿：存草稿 / 组稿（完成视频）/ 组稿那一笔的整句报价。
//
// 2026-08-30 从 FlowPage 抽出（主人点名「工坊与工作流合成一体」）：画布现在有**两个宿主**
// —— /flow 与工坊页里的全屏浮层。这三样此前只长在 FlowPage 上，画布靠 prop 借；
// 工坊要挂画布就得也有一份，而"另写一份"必然与那边分叉（组稿要回写真帧、提炼卡组、
// 清流水线、跳剪辑页，任何一处漏掉都是钱与数据的事故）。所以实现仍然只有一份，
// 只是从"某一页的函数"升级成"两页共用的 hook"。
//
// ★ 它**不认识画布**：只交出状态与动作，谁来画、画成什么样由宿主定。
// ★ 与报价的关系：deckNote 与真正扣钱的 finalizeFromFlow 读同一个 mode、同一份文字、
//   同一批常量（studioStore.deckQuoteOf）—— 报什么价就收什么钱（CLAUDE.md 那条铁律）。
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AI_REAL } from "../ai";
import { fmtTokens } from "../data/economy";
import { nodeDone, useFlow } from "../studio/flowStore";
import { deckQuoteOf, useStudio } from "../studio/studioStore";
import { cutSession } from "../data/cutSession";

export interface FlowActions {
  /** 存草稿按钮的四态（idle/saving/saved/failed） */
  saveState: "idle" | "saving" | "saved" | "failed";
  saveNow: () => void;
  /** 每一段都出片了 = 可以组稿 */
  allDone: boolean;
  /** 非空 = 正在组稿（同时是按钮上的进度句） */
  finalizing: string;
  /** 组稿那一笔的整句报价（空串 = 这次不提炼卡组，也不收那笔钱） */
  deckNote: string;
  deckOff: boolean;
  toggleDeck: () => void;
  toCut: () => void;
}

export function useFlowActions(opts?: {
  /** 组稿成功、跳走之前调一下（宿主用来关自己的浮层/记一笔"是我主动离开的"） */
  onLeave?: () => void;
}): FlowActions {
  const navigate = useNavigate();
  const nodes = useFlow((s) => s.nodes);
  const mode = useFlow((s) => s.mode);
  const busy = useFlow((s) => s.busy);
  const deckOff = useFlow((s) => s.deckOff);
  const [saveState, setSaveState] = useState<FlowActions["saveState"]>("idle");
  const [finalizing, setFinalizing] = useState("");

  const allDone = nodes.length > 0 && nodes.every(nodeDone);

  // ── 又炼出一段 → 自动存盘 ────────────────────────────────────────
  // ★★ **必须放在这个共用 hook 里**（2026-08-30 复核抓到）：它原来只长在 FlowPage 上，
  //   于是同一颗「炼这一段」按钮在 /flow 会自动存草稿、在工坊的画布浮层里**不会** ——
  //   而那一刻钱刚花出去，草稿正是那些付费段唯一的备份。
  // ★ 只挂在"又炼出一段"这一个事件上，不做定时/每次改动都存：草稿正文带整份首尾帧
  //   base64，一条几 MB，频繁写盘会拖慢主线程还费配额。改文字那种廉价改动交给手动按钮。
  // ★ 简约模式不落草稿（saveWorkDraft 里挡掉，那条路本来就不进草稿库）。
  // ★★ 存盘失败当场说（铁律八）：静默失败 + 「已经有一条工作流在跑」那道按"存住了"
  //   劝人放心的确认卡，两件一叠会让用户踏实地把刚花钱炼出来的段丢掉。
  const doneCount = nodes.filter(nodeDone).length;
  const prevDone = useRef(doneCount);
  useEffect(() => {
    if (mode === "simple") {
      prevDone.current = doneCount;
      return;
    }
    if (doneCount > prevDone.current) {
      void (async () => {
        let ok = false;
        try {
          ok = !!(await useStudio.getState().saveWorkDraft({ from: "flow" }));
        } catch {
          ok = false;
        }
        if (!ok)
          useFlow.setState({
            err: "这一段炼好了，但自动存草稿失败（存储空间不足或浏览器隐私模式）——先别离开这一页，点上面的「存草稿」再试一次",
          });
      })();
    }
    prevDone.current = doneCount;
  }, [doneCount, mode]);
  const deck = useMemo(() => deckQuoteOf(nodes, mode, deckOff), [nodes, mode, deckOff]);

  /**
   * 组稿那一笔的整句报价 —— **只拼这一处**（两个宿主印的是同一笔钱）。
   * ⚠ 措辞三处都不许含糊：**最多**（张数是上限，按实际出卡结算）、**约**（单价还没与
   *   火山账单对过）、以及余额不足会自动跳过（那是 finalizeFromFlow 真实的行为，
   *   不写的话用户会以为钱不够就完不成片）。
   */
  const deckNote =
    deck.on && AI_REAL
      ? [
          `点「完成视频」还会提炼本片卡组：你挂过的卡直接入组，缺的卡种（风格卡必有）AI 补齐，最多 ${deck.maxCards} 张、约 ${fmtTokens(deck.cards)} token`,
          deck.wants3d
            ? `；这条片写了 3D / 建模一类的画风，还会给派生的角色卡铸最多 ${deck.max3d} 个 3D 建模，另约 ${fmtTokens(deck.model3d)} token`
            : "",
          "。都按实际出卡结算，余额不够会自动跳过（成片不受影响）。",
        ].join("")
      : // 勾了「只出片」：报价行也要如实换话——空着的话用户看不出这个选择生效了没有
        deckOff && mode !== "simple"
        ? "已选择只出片：这次「完成视频」不提炼卡组，也不收那笔钱。"
        : "";

  /** 存盘。失败要说出来：配额满/隐私模式下 IndexedDB 写不进去，
   *  静默"保存成功"会让用户放心地关掉页面，然后什么都没了（铁律八） */
  async function save() {
    setSaveState("saving");
    const meta = await useStudio.getState().saveWorkDraft({ from: "flow" });
    setSaveState(meta ? "saved" : "failed");
    if (!meta) useFlow.setState({ err: "草稿保存失败（存储空间不足或浏览器隐私模式）" });
    setTimeout(() => setSaveState("idle"), 2200);
  }

  /** 全部满意 → 组稿（回写真帧 + 提炼卡组）→ 进剪辑页 */
  async function cut() {
    if (busy || finalizing) return;
    // ★★ **先看有没有一条剪到一半的**（2026-08-30 发版前复核抓到）。
    //   组稿会整表换掉合成稿并覆盖那个唯一的落盘键，而里面躺着的是**真钱**：
    //   最多 8 张铸好的卡组（约 110k）+ 最多 2 个 3D 建模（各 160k）+ 可能已经实时
    //   录制了几分钟的成片。这些派生卡在发布之前**只存在于那份稿子里**，账号卡库里
    //   没有第二份。而同一份东西用户自己点「不要了」要两步确认、横幅上还写着
    //   "丢掉就得重做一遍" —— App 替他丢的时候却一声不吭。
    //   ⇒ 照本仓对「整表换掉 nodes」的成方办：**整句拒 + 给出路**，不静默覆盖。
    //   （不做"再问一句"的弹层是因为这个 hook 有两个宿主页面，弹层要各接一遍；
    //     而拒绝在这里只有一处实现，出路就在他刚看过的那条横幅上。）
    if (cutSession()) {
      useFlow.setState({
        err: "你还有一条剪到一半的成片（里面的卡组已经铸好、花过 token 了）。先去「我的」把它剪完发出去，或在那条横幅上丢掉它，再来组这一条 —— 直接组会把它顶掉。",
      });
      return;
    }
    setFinalizing("组稿中…");
    try {
      // ★ mode 与 deckOff 同一拍从 store 现读：报价（deckQuoteOf）读的就是这两个 ——
      //   报什么价就收什么钱
      const st = useFlow.getState();
      const ok = await useStudio.getState().finalizeFromFlow(st.nodes, st.mode, (s) => setFinalizing(s), st.deckOff);
      if (ok) {
        // ★★ 落盘就在这一拍：卡组刚铸完（最多 8 张，真扣过钱）、3D 建模的 GLB 刚落 idb 而
        //   **指针只在内存 draft 上**。下面马上要 reset() 流水线，此后这摊活的唯一副本
        //   就是那份内存 draft —— 切后台被系统回收就得从草稿箱重来一遍，**再收一次那笔钱**。
        //   存不住不挡人进剪辑页（那只会更糟），但必须说出来（铁律八）。
        // ★ 回执是**整句人话**（null = 存住了）。⚠ 别写成 `if (!(await …))` —— 那在
        //   回执从 boolean 换成 string|null 之后会**整个反过来**：成功时报错、失败时沉默。
        const why = await useStudio.getState().persistCutDraft();
        if (why) {
          useFlow.setState({ err: `卡组已经铸好了，但${why}——现在切后台会丢掉它，请先把片子剪完发出去。` });
        }
        opts?.onLeave?.();
        useFlow.getState().reset();
        // ★ 工坊那一面的投影窗/聚焦是**独立的一份状态**，reset() 只清流水线 ——
        //   不一起收的话，回到 /studio 会看到一块指着已不存在的节点的空面板（关不掉）
        useStudio.getState().closeProjection();
        // ★ replace 而不是 push：组稿成功那一下 reset() 已经把流水线清空了，历史里这一格
        //   就是个死页 —— 从剪辑页按返回退到它，它当场又把人 replace 走，白闪一下
        navigate("/cut", { replace: true });
      }
    } catch (e) {
      console.warn("[flow] 组稿失败:", e);
      useFlow.setState({ err: `组稿失败：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` });
    } finally {
      setFinalizing("");
    }
  }

  return {
    saveState,
    saveNow: () => void save(),
    allDone,
    finalizing,
    deckNote,
    deckOff,
    toggleDeck: () => useFlow.setState({ deckOff: !useFlow.getState().deckOff }),
    toCut: () => void cut(),
  };
}
