/**
 * 创作中心（/support/create）：数字人的三样东西各自的制作入口 —— 人物模型（Live2D）/ 人物音频（豆包混音）/ 人物人格。
 * 设计正本 docs/digital-human-creator-center.md §1（App 那一栏）。
 *
 * ★ 这一页**只是三扇门**，不自己做任何创作动作：模型与人格各去一个向导页，音频回客服页把「声音」面板掀开
 *   （混音器本来就长在那个面板里，§5「不动」——为它再造一页就是同一个混音器的第二处实现）。
 * ★ 「我的作品 n」的 n **取不到就不显示**，不显示成 0（CLAUDE.md：「没问到」与「确实没有」是两回事）。
 *   三条各问各的、各失败各的：声音市场挂了不该让模型那张卡也变哑。
 * ★ 计数只要 total，`limit: 1` —— 服务端照样回全量的 total，不用把 40 条正文拉回来。
 * ★ 登录墙由路由的 RequireAuth 管（三条 scope=mine 都要登录）。
 */
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "react-router";
import Icon, { type IconName } from "../components/Icon";
import PageHeader from "../components/PageHeader";
import { useBackOr } from "../hooks/useBackOr";
import { listLive2dModels, listPersonas, listVoiceTemplates } from "../api/companion";

/** null = 还没问到 / 问失败了（不显示数字）；数字 = 服务端认账的那个数 */
type Count = number | null;

function CreateCard({
  icon,
  emoji,
  title,
  desc,
  count,
  cta,
  onGo,
}: {
  icon: IconName;
  emoji: string;
  title: string;
  desc: string;
  count: Count;
  cta: string;
  onGo: () => void;
}) {
  return (
    <section className="rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xl">{emoji}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-100">{title}</div>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{desc}</p>
        </div>
        <Icon name={icon} size={18} className="shrink-0 text-slate-600" />
      </div>
      {count !== null && <div className="mt-2 text-[11px] text-slate-500"><Trans>我的作品 {count}</Trans></div>}
      <button onClick={onGo} className="mt-2 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40">
        {cta}
      </button>
    </section>
  );
}

export default function SupportCreatePage() {
  const navigate = useNavigate();
  const back = useBackOr("/support");
  const { t } = useLingui();
  const [models, setModels] = useState<Count>(null);
  const [voices, setVoices] = useState<Count>(null);
  const [personas, setPersonas] = useState<Count>(null);

  useEffect(() => {
    let alive = true;
    // 三条各问各的：任何一条挂了只是那张卡上少一行小字，另外两张照常（catch 里什么都不做是刻意的 ——
    // 这里没有"失败要响"的东西，屏幕上本来就没有承诺过这个数字一定在）
    listLive2dModels({ scope: "mine", page: 1, limit: 1 })
      .then((r) => alive && setModels(r.total))
      .catch(() => {});
    listPersonas({ scope: "mine", page: 1, limit: 1 })
      .then((r) => alive && setPersonas(r.total))
      .catch(() => {});
    listVoiceTemplates({ scope: "mine", page: 1, limit: 1 })
      .then((r) => alive && setVoices(r.total))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader sticky inset onBack={back} title={t`创作中心`} />
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        <Trans>自己做数字人的三样东西：长什么样、什么嗓子、怎么说话。做好的可以自己用，也可以公开到市场给别人用。</Trans>
      </p>

      <div className="space-y-3">
        <CreateCard
          icon="upload"
          emoji="🧍"
          title={t`人物模型`}
          desc={t`上传自己的 Live2D 包（zip），对好动作、表情和触摸区，就能给数字人换上。`}
          count={models}
          cta={t`去制作`}
          onGo={() => navigate("/support/models/new")}
        />
        <CreateCard
          icon="settings"
          emoji="🎙️"
          title={t`人物音频`}
          desc={t`把 1～3 味豆包音色按比例调成自己的嗓子，可以发布成声音模板。`}
          count={voices}
          cta={t`去制作`}
          // 混音器长在客服页的「声音」面板里（一处实现），带上 ?sheet=voice 让那一页直接掀开它
          onGo={() => navigate("/support?sheet=voice")}
        />
        <CreateCard
          icon="sparkle"
          emoji="🎭"
          title={t`人物人格`}
          desc={t`喂一段聊天记录或者答几道题，AI 帮你写出说话风格，试聊满意了再发布。`}
          count={personas}
          cta={t`去制作`}
          onGo={() => navigate("/support/personas/new")}
        />
      </div>

      <p className="mt-5 text-center text-[11px] leading-5 text-slate-500"><Trans>发布出去的东西署你的名，别人下载后你能看到下载数。</Trans></p>
    </div>
  );
}
