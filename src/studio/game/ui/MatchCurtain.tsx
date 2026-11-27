// ★ 穿窗转场的**页面层**黑幕 + 收口（2026-11-27，`feat/gs-moon-window`）。
//
// 为什么黑幕要挂在页面层、而不是只放在大厅里：
//   · 淡入（穿窗那一拍）时大厅还在（首屏），黑幕必须在 3D 之上、大厅 UI 之下 → 大厅里那一层够用；
//   · 淡出（匹配成功）时**大厅整个卸载了**（startFromLobby → closeLobby → `Lobby` return null），
//     只放在大厅里的黑幕会跟着一起消失，画面就会从黑屏"啪"地跳回桌子；
//     这一层挂在大厅外面（z-35：高过 3D 画布与对局 UI 的 z-30、低于大厅的 z-40），
//     大厅没了它还在，淡出才连得上（0.4 s 之后露出设计机位的长桌）。
//
// 收口（谁把镜头放回设计机位）也只在这里一处，判据都来自现有 store：
//   · 匹配成功 / 开了一局：`useGame.state !== null`
//   · 从"匹配中"离开（取消 → 首屏、匹配到真人 → 房间屏、超时后点 AI 开局）
//   · 大厅关掉（✕ 返回工坊 / 路由卸载）
//   · 队列超时（note = queue-timeout）：镜头复位，但**匹配中那一屏还在** → 黑幕留着（coverDesign）
// ★ 这些判断一条都不改匹配逻辑本身：`lobbyStore.findMatch` / 队列 / AI 补位照旧。
import { useEffect, useRef } from "react";
import { useLobby } from "../lobbyStore";
import { useGame } from "../store";
import { coverDesign, leaveMatchPage, useMatchCam } from "../../scene/matchCam";

export default function MatchCurtain() {
  const veil = useMatchCam((s) => s.veil);
  const instant = useMatchCam((s) => s.instant);
  const stage = useMatchCam((s) => s.stage);
  const inGame = useGame((s) => s.state !== null);
  const lobbyOpen = useLobby((s) => s.open);
  const screen = useLobby((s) => s.screen);
  const noteKind = useLobby((s) => s.note?.kind ?? null);

  // 开了一局：镜头复位 + 黑幕淡出（大厅这一刻已经卸了，只剩这一层）
  useEffect(() => {
    if (inGame) leaveMatchPage();
  }, [inGame]);

  // 大厅关了（✕ 返回工坊、离开工坊路由、结束对局后回大厅又关掉）：一律回设计机位
  useEffect(() => {
    if (!lobbyOpen) leaveMatchPage();
  }, [lobbyOpen]);

  // 从"匹配中"那一屏离开：取消（→首屏）/ 匹配成功（→房间屏）/ 公开房那一屏
  const prevScreen = useRef(screen);
  useEffect(() => {
    const was = prevScreen.current;
    prevScreen.current = screen;
    if (was === "matching" && screen !== "matching") leaveMatchPage();
  }, [screen]);

  // 队列超时（60 s 没等到真人）：镜头先复位，但这一屏还留着（用户可以选择用 AI 开局）——
  // 黑幕不能撤，否则会露出桌子、与"匹配中"的界面打架（stage 从 outside 变 covered，黑幕保持 1）。
  useEffect(() => {
    if (screen === "matching" && noteKind === "queue-timeout" && stage === "outside") coverDesign();
  }, [screen, noteKind, stage]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[35] bg-black"
      style={{ opacity: veil, transition: instant ? "none" : "opacity 400ms ease-out" }}
    />
  );
}
