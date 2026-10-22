启梦 2.65

· 涉及多个步骤的功能（跟着做的几个向导、铸段窗、铸卡窗、自己传图做卡片、上传 Live2D 模型、制作人格、建课、提取模板，以及剧本 → 分镜 / 按主题改写 / 一键成片三张面板）屏幕上方统一加了圆点进度条：做完的实心、当前这一步的圆圈放大，每颗下面写着这一步是什么；切步时平滑过渡。
· 首页与提取模板窗在开发构建里的两处生命周期判断修正，正式包行为不变。

QiMeng 2.65

· Multi-step features (the guided wizards, the segment and card forges, Upload-your-own-image cards, Live2D model upload, persona creation, course creation, template extraction, and the Script → Shots / Theme rewrite / Auto-edit panels) now show a dot progress bar at the top: finished steps are filled, the current one is enlarged, and each dot is labelled with its step; switching steps animates smoothly.
· Two lifecycle checks on Home and in the template extractor were corrected for development builds; release builds are unchanged.
启梦 2.64

· 安全更新：修复 App 内置网页组件（Capacitor）的一个高危漏洞，请尽快更新。
· 创意工坊改成两层：第一层是市场，一个搜索框按卡片 / 卡组 / 模板 / 工作流找，不登录也能逛；自己的东西和三个造卡入口在「我的仓库」里。
· 模板货架顶上多了「创建属于你的视频模板」入口（做过模板之后缩成一行）。
· 首页：按住屏幕两侧临时 2 倍速，松手恢复；按住中间弹出「更多操作」（倍速、清屏 / 转屏观看、保存到本地、举报）；双击点赞不再顺手把视频停住；右上角多了搜索；点赞、评论数按「万」显示。
· 分区：搜索框钉在顶上，点进去先看到搜索历史和近期热播；分区最前面加了「全部」；作品卡片重新排版。
· 「我的」：头像后面加了一条品牌带；草稿改用笔标记（锁只表示仅自己可见）；访客主页可以拉黑；往下滚时页签不再被顶栏压住一截。
· 发弹幕、写评论时右侧那一列按钮暂时收起，不再被键盘顶出屏幕。
· 第三方登录（Google / GitHub）：取消授权或登录失败会回到 App，用界面语言说明原因；登录前要去的页面，登录后接着去。
· 对话正反打：过肩镜头多画一个人的情况少了很多；三个机位画完 AI 会各看一遍（每张多一次看图的钱），可疑的那张会标出来，由你决定要不要重画。
· 延长与示例视频出片的报价改按方舟「含输入视频的最低用量」计算。
· AI 客服按界面语言作答；更新失败的提示按界面语言显示；剪辑页统一叫「合成」；几处小字调亮了一档。

QiMeng 2.64

· Security update: fixes a critical vulnerability in the app's built-in web component (Capacitor). Please update soon.
· The Workshop now has two layers: the first is the market — one search box across cards, decks, templates and workflows, no sign-in needed to browse; your own items and the three card-making entries live in "My Library".
· The template shelf now starts with a "Create your own video template" entry (it shrinks to one line once you've made one).
· Home: hold either side of the screen for 2× until you let go; hold the middle for "More options" (speed, clear-screen / rotate to watch, save to device, report); double-tap to like no longer pauses the video; search is now at the top right; like and comment counts are abbreviated (12.3K).
· Discover: the search box stays pinned, and tapping it shows your search history and recently popular videos first; an "All" category comes first; video cards have a new layout.
· Me: a brand band behind your avatar; drafts are marked with a pen (the lock only means "only you can see it"); you can block someone from their profile; the tab row no longer slides under the header when you scroll.
· While writing a bullet comment or a comment, the right-hand buttons step aside instead of being pushed off the top by the keyboard.
· Third-party login (Google / GitHub): cancelling or a failed login returns to the app with the reason in your interface language, and you land on the page you were heading to.
· Shot / reverse shot: over-the-shoulder shots add an extra person much less often; after drawing, the AI looks over each of the three angles (one extra image check per angle) and flags anything suspicious for you to redraw if you want.
· Extend and example-video renders are now quoted using Ark's minimum billed input length for video input.
· The AI support assistant answers in your interface language; update failures are explained in your interface language; the editor consistently says "merge"; some small text is brighter.

启梦 2.63

· 请尽快更新：11 月 24 日方舟停服一批模型。这一版出图「速写」换成同系列的新型号（画风接近、细节更多），「定妆」档撤掉（原来定妆出的卡照旧能用），「现做一个主角」改用精绘。「极速」「标准」两档到那天会自动收起。
· 以后遇到必须更新的版本，App 会直接提示、关不掉，但一定留着官网与 GitHub 两个下载源。
· 剪辑页配音现在真的免费：每个账号每天 1,000 字；放不下的那一句跳过，其余照配。
· 删草稿、删段不再先问一句：删掉之后 6 秒内可以「撤销」（花过钱的段仍要点两下）。
· 出错不再整页白屏：哪一块没画出来只换那一块，带「重载这一块」与「回首页」。
· 第三方登录（Google / GitHub）回到 App 那一步加了核对：不是本机刚发起的登录链接一律忽略。
· 工作流画布多了缩小 / 恢复 1:1 / 放大三颗键；首页进度条支持读屏与键盘调整；「加一段」被拒时先说原因。
· 真人档出片：请求超时、取件没回包都说清钱有没有扣；取件没回包的那一发稍后可以「取回」。
· 九宫格分镜：整组被拒或一张没出时，上一组画面摆回去，逐格说原因。
· 登录页勾选框改成方的、注册入口摆出来；设置页分组；「我的」页页签加名字；剪辑页「下一步」改成「合成并去发布」，取消 / 失败的提示也统一叫「合成」。
· 返回键：从链接冷启动进来再按返回不再白屏；出片完成的提示回到开炉的那一面（工坊或画布）。
· 自更新：清单不完整时不下不装。
· 修复：注册时昵称没存上会当场说；出图被模型拒绝时说人话；草稿满 20 条清掉最旧一条时会提示；小字说明调亮了一档。

QiMeng 2.63

· Please update: Ark retires a batch of models on November 24. This version switches the "Sketch" image model to its successor in the same family (similar style, finer detail), retires the "Studio" tier (cards made with it keep working), and "Make a lead now" uses "Fine" instead. The "Fast" and "Standard" video tiers disappear that day.
· When a future version is mandatory, the app says so and can't be dismissed, but always keeps two download sources (website and GitHub).
· Editor voiceover is now really free: 1,000 characters per account per day; a line that doesn't fit is skipped, the rest still get voiced.
· Deleting a draft or a segment no longer asks first: you get 6 seconds to "Undo" (segments that cost money still need two taps).
· Errors no longer blank the whole page: only the block that failed is replaced, with "Reload this block" and "Go home".
· Third-party login (Google / GitHub) now checks the return into the app: a login link this device didn't just start is ignored.
· The workflow canvas has zoom out / 1:1 / zoom in buttons; the home progress bar works with screen readers and the keyboard; "Add a segment" explains first when it's refused.
· Real-person tier: timeouts and a missing reply when fetching the file say whether tokens were charged; that render can be recovered later.
· Storyboard grid: when a set is refused or a panel fails, the previous set comes back and each panel explains why.
· Login page checkboxes are square and sign-up is visible; settings are grouped; profile tabs have names; the editor's "Next" is now "Merge & go to publish", and its cancel / failure messages match.
· Back button: no more blank screen when returning after a cold start from a link; the render-done pill returns to the side you started from (Studio or canvas).
· Self-update: an incomplete manifest is neither downloaded nor installed.
· Fixes: a nickname that didn't save at sign-up is reported right away; image refusals are explained in plain words; a notice when the oldest draft is removed past the 20-draft limit; small helper text is one shade brighter.

启梦 2.62

· 请尽快更新：服务端从今天起按下面的新规则走；旧版 App 里没有「草稿」档，额度和退款的说法也还是旧的。
· 免费版改了：没付过钱的账号，出片只能用「极速」和新的「草稿」档；标准、高清、电影级（含样片）、真人档，以及参考视频、片段重拍、延长，目前只对付费账号开放。免费额度改成新人一次 170,000（进 add-on，不过期）+ 每天补 2,000 套餐 token（最多攒到 14,000），不再每月发 300,000。已有账号不补发新人额度；之前剩下的免费额度原样保留，用到 14,000 以下才开始每天补。
· 套餐额度调整，价格不变：标准套餐 ¥30/月 改为 1,660,000（原 2,000,000），专业套餐 ¥98/月 改为 5,800,000（原 8,000,000）。
· 新档「草稿」：和「高清」同一个模型，480p，更省 token；能直接用素材卡的形象图出片，出片带 AI 生成的环境音。
· 电影级可以「先出样片」：先出一条 480p 样片，满意再把同一份样片定稿成 1080p（画面、动作、声音照样片），样片出来之后约 7 天内可以定稿。1080p 成片存好时会转成通用格式，转好之前（一般几分钟）个别手机可能只有声音。
· 失败退 token：从今天起提交的出片，受理之后如果生成方明确说失败、取消或过期，这一发的 token 自动退回（白模化、3D 建模同样）；退款时你不在 App 里，消息页会通知你。没等到结果的那一发不算失败，照旧用「取回」领回来、不再花钱。出片前已经画好的画面会留在方案上，重试不再收这几张的钱。
· 「极速」「标准」两档用的模型 11 月 24 日停服，到时这两档会自动收起。
· 加一段改成先选出片模型、再挑做法，每种做法都是固定几步。新做法：参考图直出、主角定妆 · 多镜头、九宫格分镜（写一场戏，AI 写成分镜并画出整组画面，挑几格、每格一段）、对话正反打（两个人一句一段，按卡上的声音说）、特效同款（12 种）。当前模型上用不了的做法不摆出来，并说明换到哪一档就有。
· 已出片的段多了「修这一段」：片段重拍（可以只改其中几秒，重拍出声，上一版可以还原；高清、电影级）、往后延长（电影级出的最后一段往后接几秒，接出来的是新的一段）。高清现在也能用示例视频出片。
· 自选卡片 / 自定义：出片前能看到「参考清单」（模型会收到哪几张图、各是第几张）；每段可以加最多 3 张临时参考图，在句子里写 @名字 点它；首尾帧在出片前可以一句话改、或圈出一处再改；成片回看里「截这一帧」可以给还没出片的段用；一段可以写成分镜表（最多 4 个镜头加台词，带声音样本的人物卡按自己的声音说；模型偶尔仍会把台词画成字幕）。
· 段时长放开：高清最长 15 秒、电影级最长 30 秒（越长越贵）。
· 修复：工坊方案台里选定的那一套、铸段窗那一格和放大看时，首尾帧显示不出来；多镜头的段补画结束画面时，不再画成带台词的分镜拼图。

QiMeng 2.62

· Please update: from today the server follows the new rules below. Older versions have no “Lite” tier and still describe tokens and refunds the old way.
· Free plan changes: accounts that have never paid can now generate video only on “Fast” and the new “Lite” tier; Standard, HD, Cinematic (including preview drafts), Real-person, reference videos, Reshoot and Extend are open to paid accounts only for now. The free allowance is now 170,000 tokens once when you join (add-on, never expires) plus 2,000 plan tokens a day (saving up to 14,000), instead of 300,000 a month. Existing accounts don't get the join bonus; whatever free tokens you have left stay, and the daily top-up starts once you're below 14,000.
· Plan allowances changed, prices unchanged: the Standard plan (¥30/month) now gives 1,660,000 tokens (was 2,000,000) and the Pro plan (¥98/month) 5,800,000 (was 8,000,000).
· New “Lite” tier: the same model as “HD” at 480p, cheaper; it can render straight from card images and adds AI ambient sound.
· “Cinematic” can render a preview draft first: a 480p preview, and if you like it, finalize the same preview at 1080p (picture, motion and sound follow the preview) within about 7 days. The 1080p video is converted to a common format when it's saved; until that finishes (usually a few minutes) a few phones may play sound only.
· Refunds for failed renders: for renders submitted from today, if a render was accepted and the provider then says it failed, was cancelled or expired, its tokens come back automatically (blockout and 3D modeling too); if you weren't in the app at the time, you get a notification. A render you just didn't get a result for isn't a failure — “Recover” it as before, at no extra charge. Frames already drawn for a failed render stay on the plan, so a retry doesn't charge for them again.
· The models behind “Fast” and “Standard” shut down on November 24; those two tiers will disappear then.
· Adding a segment now starts with picking the video model, then an approach, each a fixed few steps. New approaches: Reference images, direct; Lead first · multi-shot; Storyboard grid (write a scene, AI turns it into a storyboard and draws the whole set; pick panels, one segment each); Shot / reverse shot (two people, one line per segment, in each card's voice); Effect presets (12). Approaches that don't work on the chosen model are hidden, with a note on which tier has them.
· Rendered segments get “Fix this segment”: Reshoot (optionally just a few seconds; with sound; the previous version can be restored; HD and Cinematic) and Extend (continue the last Cinematic segment by a few seconds as a new segment). HD can now also render from an example video.
· Pick cards and Custom: “References” shows which images the model will get and in what order; add up to 3 extra reference images per segment and @mention them in your text; edit the first or last frame before rendering with a sentence or by circling a spot; “Capture frame” in playback grabs a frame for a segment not yet rendered; write a segment as a shot list (up to 4 shots plus lines; cards with a voice sample speak in their own voice — the model may still occasionally burn lines in as subtitles).
· Longer segments: HD up to 15 seconds, Cinematic up to 30 (longer costs more).
· Fixed: in Studio, the chosen plan, the segment slot and the enlarged view sometimes showed no first or last frame; multi-shot segments no longer get an end frame drawn as a storyboard collage with dialogue.
