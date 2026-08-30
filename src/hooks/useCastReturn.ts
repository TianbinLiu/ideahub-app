import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { tplOfNode, useFlow } from "../studio/flowStore";
import { VIDEO_EDITOR_RESULT_KEY, type VideoEditorResult } from "../pages/VideoEditorPage";

/**
 * 收「挂卡编辑页」的回程结果并落进 flowStore（applyCast）—— **唯一实现**。
 *
 * 2026-08-30 从 FlowPage 抽出：工坊也能就地发起挂卡了（projection 的模板段面板），
 * `castEditorState` 的 returnTo 从恒 `/flow` 变成"谁发起回谁"，于是回程的收口
 * 必须两页共用同一份——各抄一遍的话，模板对号那道闸（下面那段 ★）迟早只改一处。
 *
 * ★ 结果经 location.state 传（VideoEditorPage 顶部的跨页约定）；收完立刻把 state 洗掉
 *   （replace），否则返回/前进会把同一份结果再灌一遍。
 * ★ 挂在**页面**上而不是 store：路由 state 只有挂着 useLocation 的组件拿得到。
 */
export function useCastReturn(): void {
  const loc = useLocation();
  const navigate = useNavigate();
  /** 已消费过的那份结果（对象同一性）：StrictMode 双跑 effect 时别把同一份灌两遍 */
  const castTaken = useRef<unknown>(null);
  useEffect(() => {
    const raw = (loc.state as Record<string, unknown> | null)?.[VIDEO_EDITOR_RESULT_KEY];
    if (!raw || castTaken.current === raw) return;
    castTaken.current = raw;
    navigate(loc.pathname, { replace: true, state: null });
    const r = raw as Partial<VideoEditorResult> & { cast?: unknown };
    if (r.mode !== "cast" || !r.cast || typeof r.cast !== "object") return;
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.cast as Record<string, unknown>)) if (typeof v === "string" && v) map[k] = v;
    const st = useFlow.getState();
    // 对号入座：模板对不上就整句拒绝，绝不"就近用"——编号是**这个模板**的编号，
    // 张冠李戴地套到另一个模板上，出片时就是换错人且零报错（types.roles 的 ★★）
    // ★ 比的是**当前这一段**的模板（tplOfNode），不是 store 级那份 —— 后者在换段时
    //   可能还停在上一段上，那样这道闸恒相等、等于没有（对抗评审确认的 high 的一半）
    const curTpl = tplOfNode(st.nodes[st.cursor] ?? st.nodes[0]);
    if (r.templateId && curTpl && r.templateId !== curTpl.id) {
      useFlow.setState({
        err: "刚才挂卡的是另一个模板（这条流水线上套的模板中途换过了）——回模板详情页重新套用一次再挂卡",
      });
      return;
    }
    void st.applyCast(map);
  }, [loc.state, loc.pathname, navigate]);
}
