// 「创建属于你的视频模板」入口卡（2026-10-21 主人点名：原来那一行虚线文字「传一段视频做白模模板（自己做好的白模片也行）」
// 太容易被忽略、也太简陋，要一张带看板娘背景、写「创建属于你的视频模板」的入口）。
//
// ★ 调研结论（docs/ui-benchmark-2026-10.md 第一节）：剪映「剪同款」页的「专业能力者发现计划」、CapCut 模板栏的创作者 banner、
//   RunningHub 的插画头图都是「头图 / 插画 + 一句动词打头的标题 + 一个主按钮 + 一行说明」，摆在模板货架上；
//   没有一家把技术细节写进主标题 —— 「自己做好的白模片也行」这类话放到副标题 / 下一步。
// ★ 两种形态（同 CapCut 按人的状态给不同大小的入口）：还没有自己的模板 → 大卡（hero）；已经做过 → 一行小条（slim），
//   不在货架上反复占一大块。
// ★ 背景图是 public/create/mode-tpl.jpg（看板娘把一张人物卡按进白色人偶胸口、脚下法阵 —— 画的正是「做白模模板、别人换上自己的角色」），
//   本来就随包发出、2026-10-04 选法屏换代后一直没人引用：复用它包体零增长。
//   ⚠ 那张图的下三分之一并不暗（裙子 + 发光法阵），文字一律放在左侧、靠左往右的渐变压暗，别往图下半部放字。
// ★ 不许诺奖励：同款奖励（data/remixReward）只认「按别人的作品 / 配方做同款」（flowStore.remixOf），套用模板不写 remixOf ——
//   这里说「别人用你的模板做同款你能拿 token」是假话。
// ★ 不报数：白模化的价跟着选段时长走（economy.blockoutizeCost），点开之后框选那一屏整句报；套餐够不够也在提取器第一屏
//   （templates.blockoutizeBlockReason）选文件之前说。这里只说「开始前会报价」，别另算一份。
//   ⚠ 「每条路都要花 token」别改回「白模化要花 token」：自带白模片那条也收钱（economy.ownRefTemplateCost，提取器里写着「只认人、不出片 · 约 …」），
//   只点名其中一条收钱 = 当面告诉人另一条不要钱（tours.tsx 工坊那一步的注释记过同一个坑，2026-10-21 评审又抓到一次）。
// ★ 两种路数（2026-10-26 文字模板 P1）：video = 宿主的 blockoutCap（remoteTemplatesCapable 唯一实现）为真时说「传视频 / 写提示词」两样，
//   为假时只说「写提示词 + 选封面」（那条不碰服务端，离线 / 老服务端也做得了，所以这张卡不再整张藏）。
//   ⚠ 钱上那句跟着改：做文字模板不调 AI、不花 token —— 只说「视频那几条要花」，别再写「每条路都要花」（那句对文字路是假话）。
import { useLocation, useNavigate } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import Icon from "./Icon";
import { useAuthState } from "../hooks/useAccount";
import { showToast } from "../data/toast";

export default function TemplateCreateCard({ variant, video, onStart }: { variant: "hero" | "slim"; video: boolean; onStart: () => void }) {
  const { t } = useLingui();
  const auth = useAuthState();
  const nav = useNavigate();
  const loc = useLocation();
  // 没登录的人在市场上也看得到这张卡（逛市场不用登录）：点了先去登录，登完回到这一页的这个地址
  const start = () => {
    if (auth === "out") return nav(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`);
    // pending 不是「没登录」（CLAUDE.md「拿 !currentUser() 当没登录」那一格）：说一句，等认出人再点
    if (auth === "pending") return showToast(t`正在确认登录状态，稍等一下再点`);
    onStart();
  };

  if (variant === "slim") {
    return (
      <button
        data-guide="template-create"
        onClick={start}
        className="mb-3 flex w-full items-center gap-2.5 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-left active:opacity-60"
      >
        <img src="/avatars/mascot-cheer.webp" alt="" aria-hidden className="h-9 w-9 flex-none rounded-full bg-ink object-cover" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-100">
            <Trans>再做一个视频模板</Trans>
          </span>
          <span className="block truncate text-[11px] text-slate-400">
            {video ? <Trans>传视频或写提示词，别人照着你拍</Trans> : <Trans>写提示词、选封面，别人照着你拍</Trans>}
          </span>
        </span>
        <span className="flex-none rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-ink">
          <Trans>开始</Trans>
        </span>
      </button>
    );
  }

  return (
    <div className="mb-3">
      <button
        data-guide="template-create"
        onClick={start}
        className="relative block w-full overflow-hidden rounded-2xl border border-sky-400/30 bg-ink text-left active:opacity-80"
      >
        {/* 插画：只占右边六成、按上半身取景（人物卡与人偶胸口那一块）。aria-hidden：意思全在左边那几行字里 */}
        <img
          src="/create/mode-tpl.jpg"
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          className="absolute inset-y-0 right-0 h-full w-[62%] object-cover"
          style={{ objectPosition: "50% 22%" }}
        />
        {/* 左往右压暗：字落在不透明的那一段上（图的下半部不暗，别靠图本身托字） */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-ink from-[42%] via-ink/80 via-[58%] to-transparent" />
        <div className="relative z-10 flex w-[64%] flex-col gap-1.5 p-4">
          <span className="text-base font-bold leading-snug text-slate-50">
            <Trans>创建属于你的视频模板</Trans>
          </span>
          <span className="text-[11px] leading-relaxed text-slate-300">
            {video ? (
              <Trans>传一段视频让 AI 换成白模人偶，或者只写一段提示词配一张封面；别人换上自己的角色或图片，就能照着你的做法出片。</Trans>
            ) : (
              <Trans>写一段提示词、选一张封面图，做成能反复套用的模板；别人补上自己的图片，就能照着你的做法出片。</Trans>
            )}
          </span>
          {/* 三步预览（剪映 / PixVerse 都把「点进去之后要做什么」摆在入口上）。数字是真的先后，不是装饰。
              ★ 箭头跟前一步粘在一起（nowrap）：英文三步放不下一行，分开排的话第三行会以一个孤零零的 › 开头（浏览器 363px 宽实测） */}
          <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-sky-200/90">
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              {video ? <Trans>① 传视频 / 写提示词</Trans> : <Trans>① 写提示词</Trans>}
              <Icon name="chevron" size={10} className="opacity-60" />
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              {video ? <Trans>② 做成模板</Trans> : <Trans>② 选封面</Trans>}
              <Icon name="chevron" size={10} className="opacity-60" />
            </span>
            <span className="whitespace-nowrap">
              <Trans>③ 套用出片</Trans>
            </span>
          </span>
          <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-ink">
            <Icon name="plus" size={13} />
            <Trans>开始创建</Trans>
          </span>
        </div>
      </button>
      {/* ★★ 这句别删（2026-08-17 那次改文案的教训）：带着一段自己做好的白模片点进去的人，不知道有第二条路，会再付费白模化一次、画质还更差。
          原来塞在按钮文字的括号里，现在放到卡片下面，并点名提取器里那条路的原话 */}
      {video ? (
        <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-slate-400">
          <Trans>已经有做好的白模 / 人偶片？点开后选「它本来就是白模 / 人偶片，直接用」，不用再让 AI 换一遍。传视频的两条都要花 token，按下开始之前会先报出价钱；只用文字 + 封面做模板不花。</Trans>
        </p>
      ) : (
        <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-slate-400">
          <Trans>做模板不花 token；套用出片时按出片模型计费，选档那一步会报价。</Trans>
        </p>
      )}
    </div>
  );
}
