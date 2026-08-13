import { DAILY_FREE_CLIPS, TASK_REWARDS } from "../data/economy"
import { POEMS } from "../data/poems"
import { quotaLeft, useShihui } from "../data/store"
import { nav } from "../router"
import { MY_AUTHOR_ID } from "../types"

export function Me() {
  const s = useShihui()
  const left = quotaLeft(s)
  const myWorks = s.works.filter((w) => w.authorId === MY_AUTHOR_ID)
  const learned = Object.values(s.learn).filter((l) => l.completedAt).length

  return (
    <div className="flex h-full flex-col">
      <header className="px-5 pb-3 pt-6">
        <h1 className="font-kai text-2xl">我的</h1>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-20">
        <div className="flex gap-3">
          <div className="flex-1 rounded-2xl border border-ink/10 bg-white/50 p-4 text-center">
            <div className="font-kai text-3xl text-cinnabar">{s.points}</div>
            <div className="text-xs text-mist">积分</div>
          </div>
          <div className="flex-1 rounded-2xl border border-ink/10 bg-white/50 p-4 text-center">
            <div className="font-kai text-3xl">{left}<span className="text-base text-mist">/{DAILY_FREE_CLIPS}</span></div>
            <div className="text-xs text-mist">今日免费画面</div>
          </div>
          <div className="flex-1 rounded-2xl border border-ink/10 bg-white/50 p-4 text-center">
            <div className="font-kai text-3xl">{learned}</div>
            <div className="text-xs text-mist">学完的诗</div>
          </div>
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white/50 p-4">
          <div className="pb-2 font-medium">小任务赚积分</div>
          <TaskRow
            label={`学完一首诗（+${TASK_REWARDS.learnPoem}/首）`}
            state={`${learned}/${POEMS.length}`}
            done={learned >= POEMS.length}
            onGo={() => nav("/")}
          />
          <TaskRow
            label={`每天分享一首作品（+${TASK_REWARDS.share}）`}
            state={s.shareClaimDate === new Date().toISOString().slice(0, 10) ? "今日已领" : "去广场分享"}
            done={s.shareClaimDate === new Date().toISOString().slice(0, 10)}
            onGo={() => nav("/feed")}
          />
          <TaskRow
            label={`第一次发布作品（+${TASK_REWARDS.firstPublish}）`}
            state={s.firstPublishClaimed ? "已完成" : "去创作"}
            done={s.firstPublishClaimed}
            onGo={() => nav("/compose")}
          />
          <p className="pt-2 text-xs text-mist">购买积分 / 订阅（更高清的生成模型）：骨架未接支付，见 IDEA-REVIEW「商业化」</p>
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white/50 p-4">
          <div className="pb-2 font-medium">我的作品</div>
          {myWorks.length === 0 && <div className="text-sm text-mist">还没有作品</div>}
          {myWorks.map((w) => (
            <div key={w.id} className="flex items-center justify-between border-b border-ink/5 py-2 last:border-0">
              <div>
                <span className="font-kai">《{w.title || "无题"}》</span>
                <span className="pl-2 text-xs text-mist">{w.published ? "已发布" : `草稿 · ${w.lines.length} 句`}</span>
              </div>
              <div className="flex gap-3 text-sm">
                {!w.published && (
                  <button onClick={() => nav(`/compose/w/${w.id}`)} className="text-cinnabar">
                    继续
                  </button>
                )}
                <button onClick={() => s.deleteWork(w.id)} className="text-mist">
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-ink/10 bg-white/50 p-4 text-xs leading-5 text-mist">
          <div className="pb-1 font-medium text-ink">家长与隐私（骨架占位）</div>
          真实产品这里是家长门：孩子的朗诵音频属于敏感个人信息，注册、发布、支付都要监护人确认；
          还需要青少年模式与时长提醒。合规清单见 docs/IDEA-REVIEW.md。
        </div>
      </div>
    </div>
  )
}

function TaskRow({ label, state, done, onGo }: { label: string; state: string; done: boolean; onGo: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-ink/5 py-2 text-sm last:border-0">
      <span>{label}</span>
      <button onClick={onGo} className={done ? "text-mist" : "text-cinnabar"}>
        {done ? `${state} ✓` : `${state} →`}
      </button>
    </div>
  )
}
