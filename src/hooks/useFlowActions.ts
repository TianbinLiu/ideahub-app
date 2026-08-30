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
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AI_REAL } from "../ai";
import { fmtTokens } from "../data/economy";
import { nodeDone, useFlow } from "../studio/flowStore";
import { deckQuoteOf, useStudio } from "../studio/studioStore";

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
    setFinalizing("组稿中…");
    try {
      // ★ mode 与 deckOff 同一拍从 store 现读：报价（deckQuoteOf）读的就是这两个 ——
      //   报什么价就收什么钱
      const st = useFlow.getState();
      const ok = await useStudio.getState().finalizeFromFlow(st.nodes, st.mode, (s) => setFinalizing(s), st.deckOff);
      if (ok) {
        opts?.onLeave?.();
        useFlow.getState().reset();
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
