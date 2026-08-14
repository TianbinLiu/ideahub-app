import { useGuardian } from "../data/guardian"

// 首次启用麦克风的监护人告知同意（采集侧）。
// ★ 为什么在这而不是发布时：《儿童个人信息网络保护规定》把监护人同意义务钉在
//   **收集**儿童个人信息之前——跟读识别（ASR）从第一次开麦就在采集孩子的声音，
//   哪怕即用即弃也不豁免（设计评审确认的 high）。
// ★ 为什么不设 PIN：这是告知性同意（轻量页），拦太狠会把"学习零门槛"打穿；
//   拒绝的后果被设计成无损——「我念完了」手动放行本来就是一等公民。

export function MicConsent({ purpose, onAllow, onDeny }: { purpose: string; onAllow: () => void; onDeny: () => void }) {
  const recordConsent = useGuardian((s) => s.recordConsent)
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-center bg-paper px-6">
      <div className="rounded-2xl border border-ink/10 bg-white/60 p-5">
        <div className="pb-2 font-kai text-xl">要用到麦克风啦</div>
        <p className="pb-3 text-sm leading-6 text-mist">
          {purpose}会听到孩子的声音。请让家长知道这几件事：
        </p>
        <ul className="space-y-1.5 pb-4 text-sm leading-6">
          <li>· 声音只用于当次{purpose}，不用于其它用途</li>
          <li>· 跟读识别即听即用，不保存录音；朗诵录音在发布前只存在这台设备上</li>
          <li>· 不用麦克风也能学：念完点「我念完了」一样能继续</li>
          <li>· 家长可以在「我的 → 家长中心」查看这条同意记录</li>
        </ul>
        <button
          onClick={() => {
            recordConsent("voice-capture", `首次启用麦克风（${purpose}）`)
            onAllow()
          }}
          className="w-full rounded-full bg-cinnabar py-3 text-paper"
        >
          家长已知情，同意使用麦克风
        </button>
        <button onClick={onDeny} className="mt-2 w-full py-2 text-sm text-mist">
          先不用麦克风（照样能学）
        </button>
      </div>
    </div>
  )
}
