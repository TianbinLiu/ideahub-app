// 「/」面板里的技能区：我的技能（点一下填进输入框）+ 存当前输入为技能 + 技能市场。
//
// ★ 只画。存/删/校验在 data/agentSkills（skillIssue 唯一实现），联网在 data/skillMarket
//   （remoteOn 那道闸也在那边）。这里不自己判任何规则。
// ★ 点技能只是把 text **填进输入框** —— 发送才真跑，花钱照旧过确认卡：别人写的句子
//   和你自己打的字走完全同一条 canvasAgent 白名单，装技能不多开任何一道口子。
// ★ 技能市场长在这里而不是 SchemeMarketSheet：技能的用武之地就是这条输入条，
//   在用的地方逛、装完当场能点，比塞进工坊那张方案表多一层跳转要顺。
import { useState, useSyncExternalStore } from "react";
import {
  SKILL_INTRO_MAX,
  SKILL_TITLE_MAX,
  mineSkills,
  removeSkill,
  saveSkill,
  skillsVersion,
  subscribeSkills,
  type AgentSkill,
} from "../../data/agentSkills";
import {
  installSharedSkill,
  refreshSharedSkills,
  sharedSkills,
  shareSkill,
  skillMarketBusy,
  skillMarketErr,
  skillMarketOn,
} from "../../data/skillMarket";

export default function SkillPanel({ draft, onPick }: { draft: string; onPick: (s: string) => void }) {
  useSyncExternalStore(subscribeSkills, skillsVersion, () => 0);
  const mine = mineSkills();
  const marketOn = skillMarketOn();
  const busy = skillMarketBusy();
  const marketErr = skillMarketErr();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [err, setErr] = useState("");
  /** 两拍删除：第一拍把「删」变「真删？」。★ 不用 confirm 弹窗（仓里零处 alert/confirm） */
  const [delId, setDelId] = useState("");
  const [marketOpen, setMarketOpen] = useState(false);

  function doSave() {
    try {
      // 校验在 saveSkill 里（skillIssue 唯一实现）——这里只把整句原因摆出来
      saveSkill({ title: name, intro, text: draft });
      setSaving(false);
      setName("");
      setIntro("");
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function doDel(s: AgentSkill) {
    // ★ 已发布的先下架再删：本机那行一删，广场上那条就成了没人能下架的孤儿
    if (s.published) {
      setErr(`「${s.title}」还挂在广场上——先下架再删`);
      return;
    }
    if (delId !== s.id) {
      setDelId(s.id);
      return;
    }
    removeSkill(s.id);
    setDelId("");
  }

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-300">我的技能（点一个 = 填进输入框）</span>
        <span className="flex-1" />
        {!saving && (
          <button
            onClick={() => {
              if (!draft.trim()) {
                setErr("输入条里先打好那句话，再来存成技能");
                return;
              }
              setSaving(true);
              setErr("");
            }}
            className="flex-none rounded-full border border-slate-600 px-2.5 py-1 text-[10px] text-slate-300"
          >
            ＋ 存为技能
          </button>
        )}
      </div>
      {saving && (
        <div className="mb-2 rounded-xl border border-slate-700/70 bg-panel px-2.5 py-2">
          <p className="truncate text-[10px] text-slate-500">「{draft.trim()}」</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={SKILL_TITLE_MAX}
            placeholder={`技能名（≤${SKILL_TITLE_MAX} 字）`}
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-ink px-2 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-600"
          />
          <input
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            maxLength={SKILL_INTRO_MAX}
            placeholder="一句话简介（可空）"
            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-ink px-2 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-600"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button onClick={doSave} className="rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-ink">
              存
            </button>
            <button
              onClick={() => {
                setSaving(false);
                setErr("");
              }}
              className="rounded-full border border-slate-600 px-2.5 py-1 text-[10px] text-slate-300"
            >
              算了
            </button>
          </div>
        </div>
      )}
      {mine.length === 0 && !saving && (
        <p className="text-[10px] leading-relaxed text-slate-600">还没有技能——输入条写好常用指令，点「＋ 存为技能」。</p>
      )}
      {mine.length > 0 && (
        <div className="space-y-1">
          {mine.slice(0, 12).map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-xl border border-slate-700/70 bg-panel px-2.5 py-2">
              <button onClick={() => onPick(s.text)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-[12px] font-semibold text-slate-100">{s.title}</span>
                  {s.published && (
                    <span className="flex-none rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] text-emerald-300">已发布</span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-slate-500">{s.intro || s.text}</div>
              </button>
              {marketOn && (
                <button
                  onClick={() => void shareSkill(s.id, !s.published)}
                  disabled={busy}
                  className="flex-none rounded-full border border-slate-600 px-2 py-1 text-[10px] text-slate-300 disabled:opacity-50"
                >
                  {s.published ? "下架" : "发布"}
                </button>
              )}
              <button
                onClick={() => doDel(s)}
                className={`flex-none rounded-full px-2 py-1 text-[10px] ${
                  delId === s.id ? "bg-rose-500/20 text-rose-300" : "border border-slate-600 text-slate-400"
                }`}
              >
                {delId === s.id ? "真删？" : "删"}
              </button>
            </div>
          ))}
        </div>
      )}
      {marketOn && (
        <button
          onClick={() => {
            const next = !marketOpen;
            setMarketOpen(next);
            if (next) void refreshSharedSkills();
          }}
          className="mt-2 w-full rounded-xl border border-slate-700/70 bg-panel px-2.5 py-2 text-left text-[12px] font-semibold text-slate-100"
        >
          逛技能市场 {marketOpen ? "▴" : "▾"}
        </button>
      )}
      {marketOpen && (
        <div className="mt-1 space-y-1">
          {busy && <p className="text-[10px] text-slate-500">拉取中…</p>}
          {!busy && sharedSkills().length === 0 && !marketErr && (
            <p className="text-[10px] text-slate-600">广场上还没有人发布技能——发布你的第一条？</p>
          )}
          {sharedSkills().map((s) => {
            const installed = mine.some((m) => m.id === s.id);
            return (
              <div key={s.id} className="flex items-center gap-2 rounded-xl border border-slate-700/70 bg-panel px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-[12px] font-semibold text-slate-100">{s.title}</span>
                    {s.author && <span className="flex-none text-[9px] text-slate-500">by {s.author}</span>}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-slate-500">{s.intro || s.text}</div>
                </div>
                <button
                  onClick={() => void installSharedSkill(s.id)}
                  disabled={busy || installed}
                  className="flex-none rounded-full border border-slate-600 px-2.5 py-1 text-[10px] text-slate-300 disabled:opacity-50"
                >
                  {installed ? "已装" : "装"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {(err || marketErr) && <p className="mt-1.5 text-[10px] leading-relaxed text-rose-300">{err || marketErr}</p>}
    </div>
  );
}
