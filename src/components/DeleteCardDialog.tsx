// 删卡确认 —— **全 app 唯一的一份**（卡片详情页 / 工坊卡片格子共用）。
//
// ★★ 为什么值得单独一个组件：这段话必须**按已知事实**说，而事实分散在四处
//   （卡组引用、流水线快照、分享状态、声音样本/肖像授权），任何一处说错都是骗人：
//   往吓人的方向说错（"删了正在用的段就废了"）会让用户为了保住其实没危险的东西
//   不敢清理；往放心的方向说错（"随时能恢复"）更糟——删掉是真的没了。
//   抄成两份必然分叉（CLAUDE.md「确认卡说的与事实相反」那条坑）。
//
// 事实核过一遍（2026-08-30，读 data/account.removeCard 与 flowStore.FlowNode）：
//   · 卡组：removeCard 会把它从**所有**卡组的 cardIds 里摘掉，远端也同步 → 要说"会从 N 个卡组里移出"
//   · 流水线：FlowNode.materials 存的是**当时那张卡的副本**（Card[] 快照，不是 id 引用），
//     所以已经摆上桌、甚至已经出片的段**不受影响** → 要说清楚，否则用户不敢删
//   · 分享：published 为真时删卡会连远端那份一起删（branch.removeCard）→ 别人**已经装走**的
//     是他们自己库里的副本，不受影响 → 两句都要说
//   · 声音样本与肖像授权是本机侧库，跟着一起清（removeVoice / cardAsset）
//
// ★★ 删除是**等得起**的：`removeCard` 现在会先跟服务端确认删掉了才动本地
//   （不这么做的话删失败的卡下次冷启动会长回来，见 account.removeCard 的 ★★）。
//   所以这张卡自己扛两件事：等的时候说「删除中…」，没删成就把**整句原因**留在
//   卡上、卡不关 —— 关掉卡再去别处报错，用户只会看见"点了没反应"（铁律八）。
import DeleteConfirmShell from "./DeleteConfirmShell";
import { myDecks } from "../data/account";
import { useFlow } from "../studio/flowStore";
import type { Card } from "../types";

export default function DeleteCardDialog({
  card,
  onConfirm,
  onCancel,
}: {
  card: Card;
  /** 返回 null = 真删掉了（卡自己关）；返回字符串 = 整句失败原因，留在卡上 */
  onConfirm: () => Promise<string | null>;
  onCancel: () => void;
}) {
  const decks = myDecks().filter((d) => d.cardIds.includes(card.id));
  // 流水线上挂着它的段：认**名字**不认 id —— materials 是快照，副本的 id 与卡库那张相同
  // （addMaterials 传的就是 Card 对象），所以按 id 比对是准的；这里只用来数段数
  const usedSegs = useFlow
    .getState()
    .nodes.map((n, i) => ((n.materials ?? []).some((m) => m.id === card.id) ? i + 1 : 0))
    .filter(Boolean);

  return (
    <DeleteConfirmShell
      title={`删掉「${card.name}」？`}
      danger="删掉这张卡"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
          <p>
            <span className="text-rose-300">删了就找不回来</span>：卡面、形象参考图、
            {card.genPrompt ? "铸造提示词、" : ""}声音样本与肖像授权都会一起清掉。
          </p>
          {decks.length > 0 && (
            <p>· 它会从 {decks.length} 个卡组里移出（{decks.map((d) => d.name).slice(0, 2).join("、")}
            {decks.length > 2 ? " 等" : ""}），卡组本身还在。</p>
          )}
          {usedSegs.length > 0 && (
            // ★ 这一句是"别吓着用户"的那一半：段里存的是副本，删卡不会让已经花过钱的段变样
            <p>
              · 第 {usedSegs.join("、")} 段挂着它 —— <span className="text-slate-200">那几段不受影响</span>
              （摆上桌那一刻存的是副本），已经炼好的画面也不会变。
            </p>
          )}
          {card.published && (
            <p>· 它已经分享到创意工坊：删卡会<span className="text-slate-200">同时下架</span>；
            别人已经装走的那份在他们自己的库里，不受影响。</p>
          )}
    </DeleteConfirmShell>
  );
}
