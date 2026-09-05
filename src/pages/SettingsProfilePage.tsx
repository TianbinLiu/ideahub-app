// 编辑资料：头像 + 昵称 + 简介。从设置页拆出来的单功能子页（2026-08-27）。
//
// ★ 换头像走 AvatarPicker（与个人页点头像**同一个组件**，铁律六）：设置页原来
//   自带一份"相册直选压 256px + emoji 网格"的实现 —— 和个人页那份（官方看板娘 +
//   圆形裁切）是同一件事的两种做法，改一处漏一处。拆页时收口成一份；emoji 那条
//   小路保留（新账号默认值就是 emoji，不想上传照片的人还得有它）。
// ★ 使用说明在引导弹窗里（tours.tsx 的 setprofile），页面上只留控件与失败提示。
import { useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import AvatarPicker from "../components/AvatarPicker";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import { updateProfile } from "../data/account";
import { useCurrentUser } from "../hooks/useAccount";

const AVATARS = ["🦊", "🐺", "🐱", "🦉", "🐙", "🦋", "🌙", "⭐", "🔮", "🎴", "🎬", "🍥"];

/** 昵称/简介的落库上限（updateProfile 前的 slice 与输入框 maxLength 必须是同一个数，
 *  否则又是"硬顶从正文那头下刀"——输入框不拦、保存时静默截断） */
const NAME_MAX = 16;
const BIO_MAX = 120;

export default function SettingsProfilePage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [saved, setSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 头像换失败的原因（AvatarPicker 的 onError）。失败必须看得见，铁律八 */
  const [avatarErr, setAvatarErr] = useState("");
  /** 昵称/简介没能同步到服务器的原因。★ 与 avatarErr 分开：两个动作在两块 UI 上 */
  const [profileErr, setProfileErr] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useAutoGuide("setprofile", !!user);

  // 路由已套 RequireAuth；这里只为 TS 收窄（render 里 navigate 会被 React 丢弃，别改回来）
  if (!user) return null;

  // ★ 等回包再说「已保存」（见 account.updateProfile 的 ★★）：远端模式下本机不落盘，
  //   那一发 PUT 就是唯一的真相，即发即忘等于对用户说了一句没有依据的话
  async function save() {
    setProfileErr("");
    const why = await updateProfile({ name: name.trim().slice(0, NAME_MAX) || user!.name, bio: bio.slice(0, BIO_MAX) });
    if (why) {
      setProfileErr(why);
      return;
    }
    setSaved(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader className="mb-6" onBack={() => navigate(-1)} title="编辑资料" right={<HelpButton tour="setprofile" />} />

      {/* ── 头像 ──────────────────────────────────────────────── */}
      <section data-guide="setprofile-avatar" className="mb-7 flex flex-col items-center">
        <button
          onClick={() => setPickerOpen(true)}
          className="relative rounded-full transition active:scale-95"
          aria-label="更换头像"
        >
          <Avatar name={user.name} src={user.avatar} size={88} />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-brand text-ink">
            <Icon name="plus" size={15} strokeWidth={2.5} />
          </span>
        </button>
        {avatarErr && <p className="mt-2 text-center text-[11px] text-rose-400">{avatarErr}</p>}

        {/* 不想上传照片的用户仍可用 emoji（新账号的默认值也是 emoji） */}
        <details className="mt-3 w-full">
          <summary className="cursor-pointer text-center text-xs text-slate-500">或选一个 emoji</summary>
          <div className="mt-2 grid grid-cols-6 gap-2">
            {AVATARS.map((a) => (
              <button
                key={a}
                // ★ emoji 头像走的是同一条路，同样要接住失败（不然又是"点了变了、重启变回来"）
                onClick={() => void updateProfile({ avatar: a }).then((why) => setAvatarErr(why ?? ""))}
                className={`flex aspect-square items-center justify-center rounded-xl text-2xl transition ${
                  user.avatar === a ? "bg-brand/25 ring-2 ring-brand" : "bg-panel"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </details>
      </section>

      {/* ── 昵称与简介 ────────────────────────────────────────── */}
      <section data-guide="setprofile-form" className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={NAME_MAX}
          placeholder="昵称"
          className="w-full rounded-xl border border-slate-700 bg-panel px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-brand"
        />
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={BIO_MAX}
          placeholder="一句话简介"
          rows={3}
          className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-brand"
        />
        {/* ★ 失败那句话摆在**按钮这一侧**：用户按的是这颗键，报在别处等于没报（铁律八） */}
        {profileErr && (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-200">
            {profileErr}
          </p>
        )}
        <button onClick={() => void save()} className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">
          {saved ? "已保存 ✓" : "保存资料"}
        </button>
      </section>

      {pickerOpen && (
        <AvatarPicker
          name={user.name}
          current={user.avatar}
          onClose={() => setPickerOpen(false)}
          onError={setAvatarErr}
        />
      )}
    </div>
  );
}
