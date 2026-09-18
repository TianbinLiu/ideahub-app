// 退出登录 / 注销之前：还有**在跑、花着钱**的活吗 —— 唯一判据（2026-09-18，铁律六）。
//
// ★★ 为什么要拦（主人真机点名同一台手机换账号后数据串号，见 data/deviceOwner）：这些活每一发请求都**现取 token**。
//   A 退出、B 登录之后，A 还没跑完的那几件接着往下走，带的就是 B 的 token：
//     · 铸卡 / 出图的最后一步（addCards）把 A 花钱铸的卡落进 **B 的卡库**；
//     · 正在上传的作品会以 B 的名义发出去（pushPublish 那边另有一道主人校验兜底）；
//     · 模板登记、合成这类活的结果落到 B 的账上。
//   换号那一拍内存里的活会被清掉（onOwnerSwitch），在炼的出片凭据留给 A（取回卡）——这些都是**事后**兜底；
//   最干净的是让人先等它们跑完。拦不住的只有被动登出（登录失效 401），那一种靠各处的主人校验兜。
// ★ 只拦「在花钱 / 在写账号数据」的活，不拦「保存到本地」这类只落本机缓存的下载（与账号无关）——
//   下载也领了任务票（kind "video-download"），数后台任务时要把它剔掉，否则存一条多段作品就把退出和注销都挡住了。
// ★ 说人话、说清要等什么：一颗点了没反应的「退出登录」比一句话更坏（铁律八）。
import { t } from "@lingui/core/macro";
import { useFlow } from "./flowStore";
import { studioDeriveInFlight, useStudio } from "./studioStore";
import { draftBusy, useCardDraft } from "./customCardStore";
import { runningJobs } from "../data/jobs";
import { publishInFlight } from "../data/videos";

/** 现在能不能退出登录：null = 能；否则是一句整句原因（带上要等什么） */
export function signOutBlocker(): string | null {
  const f = useFlow.getState();
  // 挂卡合成也持有 busy，先认它，好说准是哪一件
  if (f.castBusy) return t`正在合成挂卡的点名句，等它跑完再退出登录。`;
  // busy 的持有者不只出片：推演、按修改重画、取回都拿它（原来这句只说「视频正在生成」，推演时读着不对）
  if (f.busy || f.nodes.some((n) => n.status === "generating")) {
    return t`工作流里有一段正在跑（出片 / 推演 / 重画 / 取回；要花钱的那几样，钱在提交那一刻已经扣了）。等它跑完再退出登录，结果才会稳稳落在这个账号里。`;
  }
  const s = useStudio.getState();
  // ★ 铸段窗那一炉推演只挂 editor.generating 与模块级那把闸（节点要等推演回来才 appendNode），nodeGen 管不到它——
  //   漏问的话推演费已经扣了，回来时发现换了账号当场作废（2026-09-18 复核抓到）
  if (s.nodeGen || s.proposalRegen || s.frameRefining || s.editor?.generating || studioDeriveInFlight()) {
    return t`工坊里还有一步在跑（推演方案 / 重画画面 / 改图，钱已经在花了），等它跑完再退出登录。`;
  }
  // 铸卡师那一炉（forgeCards 只挂 dialog.busy）：离线模式下出炉那一拍按实收扣本机钱包，换了人就扣到别人头上
  if (s.dialog.busy) return t`铸卡师正在炼卡（出图的钱已经在花了），等这一炉出炉再退出登录，卡才会落在这个账号里。`;
  if (s.finalizing) return t`正在组稿（铸卡组），等它跑完再退出登录。`;
  if (publishInFlight()) return t`作品正在上传，等它传完再退出登录——现在退出的话，要等你再登录这个账号时才会补发。`;
  if (draftBusy(useCardDraft.getState())) {
    return t`「自己传图做卡片」那一页还有活在跑（AI 出图 / 铸卡），等它跑完再退出登录，卡才会落在这个账号里。`;
  }
  const jobs = runningJobs().filter((j) => j.kind !== "video-download");
  if (jobs.length > 0) {
    const names = jobs
      .slice(0, 3)
      .map((j) => j.title)
      .join(t({ message: "、", comment: "列举几件后台任务名时的分隔符" }));
    return t`后台还有 ${jobs.length} 件活在跑（${names}），等它们跑完再退出登录，结果才会落在这个账号里。`;
  }
  return null;
}
