# 教材评审人格：用软件工程 / UX / 质量交付的教材检查单回顾 App（2026-10-15）

> 主人 10-15：「检索网络上 software engineering 教材并生成人格来回顾 app 的各个方面并优化」。
> 做法：三路检索教材（软件工程与设计 / UX 与 HCI / 质量、交付与安全），各自整理成「原则 + 能在本仓找证据的检查单」；据此合成 12 个评审人格，各扎根 1~2 本书、各管 App 的一个方面；
> 每个人格只读审代码，每条发现带真实的文件与行号；再由两个反驳者（事实是否成立 / 是否撞主人已拍板的约定）核验；最后去重排成「现在改 / 提案」。
> 教材内容都是用自己的话转述，来源 URL 列在表里；主人的明文决定（CLAUDE.md / AGENTS.md）始终高于教材原则。

## 一、教材（24 本）

| 书 | 作者 | 管的方面 | 来源 |
|---|---|---|---|
| Software Engineering (10th edition) | Ian Sommerville | 软件工程全貌：过程模型、需求、架构设计、测试分层、演化与维护、可靠性 / 安全性工程、配置管理、风险管理 | <https://software-engineering-book.com/> <https://www.pearson.com/en-us/subject-catalog/p/software-engineering/P200000003258/9780137503148> |
| Code Complete: A Practical Handbook of Software Construction (2nd edition) | Steve McConnell | 软件构建：管理复杂性、子程序与变量设计、防御性编程、代码布局与自文档化、调试、协作构建与开发者测试 | <https://en.wikipedia.org/wiki/Code_Complete> <https://www.construx.com/books/code-complete-second-edition/> |
| Clean Code: A Handbook of Agile Software Craftsmanship | Robert C. Martin（与 Object Mentor 同事） | 代码级可读性与可维护性：命名、函数、注释、格式、错误处理、第三方边界、单元测试、类与系统的职责划分、代码异味目录 | <https://www.pearson.com/en-nz/subject-catalog/p/clean-code-a-handbook-of-agile-software-craftsmanship/P200000009044/9780136083252> <https://en.wikipedia.org/wiki/Robert_C._Martin> |
| Clean Architecture: A Craftsman's Guide to Software Structure and Design | Robert C. Martin | 架构与组件设计：依赖规则、用例层、跨边界的数据、SOLID、组件内聚 / 耦合原则、把细节（框架、数据库、UI）推到外层并推迟决策 | <https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html> <https://www.pearson.com/store/en-us/p/clean-architecture-a-craftsman-s-guide-to-software-structure-and-design/P200000009528/9780134494166> |
| Refactoring: Improving the Design of Existing Code (2nd edition) | Martin Fowler（第 1 版含 Kent Beck 等贡献） | 演进式设计：行为不变的小步结构改动、代码异味目录、自测代码作为前提、重构手法目录（提炼 / 内联 / 搬移 / 拆分阶段 / 以多态取代条件等） | <https://refactoring.com/> <https://martinfowler.com/articles/201803-refactoring-2nd-ed.html> |
| Design Patterns: Elements of Reusable Object-Oriented Software | Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides（Gang of Four） | 可复用的面向对象设计：23 个模式的意图 / 适用性 / 结构 / 后果，两条总原则（面向接口编程、组合优于继承），创建型 / 结构型 / 行为型三类 | <https://en.wikipedia.org/wiki/Design_Patterns> <https://www.oreilly.com/library/view/design-patterns-in/0201633612> |
| The Pragmatic Programmer: Your Journey to Mastery (20th Anniversary Edition) | David Thomas, Andrew Hunt | 工程师个人与团队的实践哲学：DRY、正交性、可逆性、曳光弹、破窗、设计契约、早崩溃、不靠巧合编程、无情测试、版本控制一切、工程日志 | <https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/> <https://en.wikipedia.org/wiki/The_Pragmatic_Programmer> |
| Working Effectively with Legacy Code | Michael C. Feathers | 让没有测试的代码可安全修改：遗留代码定义、缝（seam）、特征测试、依赖破除手法、发芽 / 包裹、影响分析、变更算法 | <https://understandlegacycode.com/blog/key-points-of-working-effectively-with-legacy-code/> <https://bssw.io/items/working-effectively-with-legacy-code> |
| The Design of Everyday Things（Revised and Expanded Edition） | Don Norman | 认知心理学 / 交互设计基本原理（可发现性、示能、指示、映射、反馈、概念模型、约束、人为错误） | <https://jnd.org/the-design-of-everyday-things-revised-and-expanded/> |
| Usability Engineering ＋ 10 Usability Heuristics for User Interface Design | Jakob Nielsen（启发式页面由 Kate Moran、Feifei Liu 更新） | 可用性工程 / 启发式评估 / 折扣可用性 | <https://www.nngroup.com/articles/ten-usability-heuristics/> <https://www.nngroup.com/books/usability-engineering/> |
| Don't Make Me Think, Revisited: A Common Sense Approach to Web (and Mobile) Usability（3rd Edition） | Steve Krug | 常识派可用性 / 扫描式阅读 / 导航与文案 / 低成本可用性测试 | <https://www.peachpit.com/store/dont-make-me-think-revisited-a-common-sense-approach-to-9780321965516> |
| About Face: The Essentials of Interaction Design（4th Edition）＋ Designing for the Digital Age（Goodwin，同一套目标导向方法的完整手册） | Alan Cooper、Robert Reimann、David Cronin、Christopher Noessel；Kim Goodwin（Designing for the Digital Age） | 目标导向设计（Goal-Directed Design）/ 产品行为与姿态 / 消除 excise / 心流 / 错误与撤销 / 移动与触屏 | <https://www.wiley.com/en-us/About+Face%3A+The+Essentials+of+Interaction+Design%2C+4th+Edition-p-9781118766576> <https://www.kinokuniya.co.jp/f/dsg-12-EY00060894> |
| Designing the User Interface: Strategies for Effective Human-Computer Interaction（6th Edition）—— 黄金八律（Eight Golden Rules） | Ben Shneiderman、Catherine Plaisant、Maxine Cohen、Steven Jacobs、Niklas Elmqvist、Nicholas Diakopoulos | 人机交互教材 / 界面设计八律 / 直接操纵 / 普适可用性 | <https://www.cs.umd.edu/~ben/goldenrules.html> |
| Designing Interfaces: Patterns for Effective Interaction Design（3rd Edition） | Jenifer Tidwell、Charles Brewer、Aynne Valencia | 交互设计模式语言 / 用户行为模式 / 导航与布局 / 动作与命令 / 表单与输入 / 移动界面模式 | <https://books.google.com/books?vid=ISBN9781492051961> <https://bookshare.org/browse/book/6423575> |
| 100 Things Every Designer Needs to Know About People（2nd Edition） | Susan M. Weinschenk | 设计心理学 / 认知与知觉 / 注意与记忆 / 动机与决策 / 人会犯错 | <https://www.informit.com/store/100-things-every-designer-needs-to-know-about-people-9780136746911> |
| Material Design / Android 无障碍与触控指南 ＋ WCAG 2.2（含 W3C 移动无障碍映射注记） | Google（Material Design、Android Developers、Android Accessibility Help）；W3C Web Accessibility Initiative（WCAG 2.2；Mobile Accessibility Mapping 编辑 Kim Patch、Jeanne Spellman、Kathy Wahlbin） | 移动无障碍 / 触控目标与间距 / 对比度 / 标签与屏幕阅读器 / 焦点 / 拖拽替代 / 多步骤流程的重复输入 | <https://support.google.com/accessibility/android/answer/7101858> <https://developer.android.com/guide/topics/ui/accessibility/apps> |
| How Google Tests Software | James A. Whittaker, Jason Arbon, Jeff Carollo | 软件测试组织与工程实践（测试分级、风险驱动测试、提交门禁） | <https://www.informit.com/store/how-google-tests-software-9780321803023> <https://www.oreilly.com/library/view/how-google-tests/9780132851572/> |
| Test-Driven Development: By Example（辅以 Meszaros《xUnit Test Patterns》的测试坏味道目录） | Kent Beck（xUnit Test Patterns：Gerard Meszaros） | 测试驱动开发、测试用例的写法与可维护性 | <https://www.informit.com/store/test-driven-development-by-example-9780321146533> <https://www.pearson.com/en-ca/subject-catalog/p/test-driven-development-by-example/P200000009421/9780321146533> |
| Continuous Delivery: Reliable Software Releases through Build, Test, and Deployment Automation（辅以 Kim《The Three Ways》/ DevOps Handbook） | Jez Humble, David Farley（The Three Ways：Gene Kim；DevOps Handbook：Kim, Humble, Debois, Willis, Forsgren） | 部署流水线、发布自动化、配置与版本管理 | <https://www.pearson.com/en-us/subject-catalog/p/continuous-delivery/P200000003788/9780321601919> <https://continuousdelivery.com/principles/> |
| Accelerate: The Science of Lean Software and DevOps（DORA 四指标） | Nicole Forsgren, Jez Humble, Gene Kim | 软件交付绩效度量、驱动绩效的能力 | <https://itrevolution.com/product/accelerate/> <https://dora.dev/guides/dora-metrics-four-keys/> |
| Site Reliability Engineering: How Google Runs Production Systems | Betsy Beyer, Chris Jones, Jennifer Petoff, Niall Richard Murphy（编） | 可靠性目标、发布工程、琐事消除、复盘文化 | <https://sre.google/sre-book/table-of-contents/> <https://sre.google/sre-book/embracing-risk/> |
| Release It! Design and Deploy Production-Ready Software (2nd ed.) | Michael T. Nygard | 生产环境稳定性模式与反模式（集成点、超时、断路器、舱壁、稳态） | <https://pragprog.com/titles/mnee2/release-it-second-edition/> <https://oreilly.com/library/view/release-it-2nd/9781680504552> |
| OWASP MASVS（Mobile Application Security Verification Standard）v2 + OWASP Mobile Top 10 (2024) | OWASP Mobile Application Security 项目（Sven Schleier、Carlos Holguera 等维护） | 移动应用安全验证标准与十大风险 | <https://mas.owasp.org/MASVS/> <https://mas.owasp.org/MASVS/05-MASVS-STORAGE/> |
| The Practical Test Pyramid（martinfowler.com）+ Test Pyramid（bliki） | Ham Vocke（Practical Test Pyramid, 2018）；Martin Fowler（Test Pyramid bliki, 2012；概念源自 Mike Cohn） | 自动化测试的分层与配比、契约测试、测试重复 | <https://martinfowler.com/articles/practical-test-pyramid.html> <https://martinfowler.com/bliki/TestPyramid.html> |

### 各书提炼的原则（转述）

**Software Engineering (10th edition)**
- 过程要配产品：用户驱动、需求常变的产品用增量 / 敏捷交付，计划驱动只留给安全关键系统；别把一种过程当默认。
- 需求工程是独立活动：功能需求与非功能需求（性能、可靠性、可用性、安全）都要被写下来、能被验证，不能只活在口头。
- 架构是最早、影响最大的决策：选哪种架构模式（分层、仓库、管道 / 过滤器）直接决定非功能属性，之后很难翻。
- 测试分层、目的是暴露缺陷：开发测试（单元 / 组件 / 系统）→ 发布测试 → 用户测试；每一层回答不同的问题，一层替代不了另一层。
- 演化是常态：软件生命周期的大头在维护；要有变更影响分析、可维护性度量和专门的重构窗口。
- 可靠性靠工程不靠运气：故障避免（防御性编程、输入校验）、故障检测、故障容忍（降级、冗余）分开设计，各有各的证据。
- 配置与发布管理是工程的一部分：构建自动化、版本标识、变更追踪、发布自检都要可重复。
- 风险管理贯穿项目：识别 → 分析 → 规划 → 监控，项目风险 / 产品风险 / 业务风险分开登记。

**Code Complete: A Practical Handbook of Software Construction (2nd edition)**
- 管理复杂性是软件的首要技术命令：把系统拆成人脑一次能装下的块，每一层只暴露该层的抽象。
- 构建前先做准备：需求与架构要清楚到足以开工，但不要求把所有设计做完才写代码。
- 高质量子程序：目的单一、名字说清做什么、参数少、抽象层次一致、长度适中；复杂度要被度量不是被感觉。
- 防御性编程：在边界校验输入、用断言钉不变量、错误处理策略全系统统一、用「隔离区」把脏数据挡在外面。
- 变量纪律：声明靠近首次使用、生命周期最短、一个变量只有一个含义、布尔用具名而不是裸 true/false。
- 代码要自文档化，注释写「为什么」：解释意图、取舍、踩过的坑，不复述代码在做什么。
- 先度量再优化：性能直觉常错，没有数据不改。
- 协作构建与开发者测试：代码审查、检查单、增量集成，缺陷越早发现越便宜。

**Clean Code: A Handbook of Agile Software Craftsmanship**
- 名字要揭示意图：读名字就不需要注释；不用误导性词、不用编码前缀，可搜索、可读出声。
- 函数要小、只做一件事、停在一个抽象层次；参数越少越好，不传布尔开关，不产生隐藏副作用，命令与查询分开。
- 注释是代码表达力不足的补偿：能用代码说清的就不写注释；注释掉的代码、噪音注释、过期注释都是债。
- 错误处理不能遮住主逻辑：用异常 / 带类型的失败对象而不是返回码或魔法字符串；不返回 null、不传 null；异常带足够上下文。
- 第三方 API 是边界：包一层自己的接口，别让外部类型漫进业务代码；用「学习性测试」钉住对它的假设。
- 测试代码与生产代码同样干净：FIRST（快、独立、可重复、自验证、及时），一个测试一个概念。
- 类要小、单一职责、高内聚；系统层面把「构造」与「使用」分开（依赖注入 / 工厂）。
- 代码异味目录：重复、死码、不一致、魔法数、功能依恋、过度耦合、用注释当遮羞布 —— 看到就处理。

**Clean Architecture: A Craftsman's Guide to Software Structure and Design**
- 依赖规则：源码依赖只能指向内层（策略）；UI、数据库、框架、设备是外层细节，内层不许提到外层的名字或数据格式。
- 用例层承载应用业务规则，它既不知道界面也不知道存储；控制流可以向外，依赖方向靠接口 + 依赖反转保持向内。
- 跨边界的数据是简单结构（DTO / 普通对象），按内层的需要塑形；实体对象、数据库行、框架对象不能跨边界。
- 组件内聚三原则：一起复用的放一起（REP）、因同一原因一起变的放一起（CCP）、不要逼使用者依赖它不用的东西（CRP）。
- 组件耦合三原则：依赖图无环（ADP）、依赖指向更稳定的组件（SDP）、越稳定的组件越应抽象（SAP）。
- SOLID：模块只对一个变更来源负责（SRP）、对扩展开放对修改关闭（OCP）、子类型可替换（LSP）、接口按客户拆（ISP）、依赖抽象不依赖具体（DIP）。
- 好架构让决策可以推迟：用什么数据库 / 框架 / 传输方式越晚定越好，因为信息越晚越多。
- 边界要划在变化率不同的地方；划边界有成本，可以先划「部分边界」，但要有意识地划。

**Refactoring: Improving the Design of Existing Code (2nd edition)**
- 重构 = 一系列不改变外部行为的小步变换；「加功能」和「重构」是两顶帽子，同一时刻只戴一顶。
- 重构的前提是自测代码：没有能快速跑的测试就先补测试，否则你无法知道改动变好还是变坏。
- 代码异味是信号不是罪名：重复代码、长函数、长参数列表、发散式变化、霰弹式修改、特性依恋、数据泥团、基本类型偏执、用注释遮羞。
- 小步前进、随时可编译可运行、每一步可提交；一步做大了出错就回退到上一步。
- 重构的理由是经济的：让下一次修改更便宜、让代码更容易被理解，不是为了美。
- 手法要有名字和机械步骤：提炼函数、内联函数、搬移函数、拆分阶段、封装记录、引入参数对象、以多态取代条件表达式、分解条件。
- 性能：先把结构理清，再用度量找热点优化；清晰的代码更容易调优。
- 演进式架构 + YAGNI：不预先为想象中的需求建抽象，靠重构在需要时引入。

**Design Patterns: Elements of Reusable Object-Oriented Software**
- 面向接口（抽象）编程，不面向实现：客户只依赖契约，具体类型可换。
- 优先对象组合而非类继承：继承把父类实现细节暴露给子类，组合在运行时可换、耦合更低。
- 找出会变化的部分并封装起来：每个模式本质上都是在隔离某一种变化（算法、对象创建、状态、通知方式）。
- 创建型模式把「造什么」与「怎么用」分开（工厂方法、抽象工厂、建造者、单例），让系统不依赖具体类。
- 结构型模式处理边界与组合（适配器、外观、代理、装饰器、组合），用来包第三方、简化接口、加横切行为。
- 行为型模式把算法 / 状态 / 命令 / 通知做成对象（策略、状态、命令、观察者、备忘录、模板方法、迭代器），便于替换和撤销。
- 模式要被命名并记录取舍：名字、意图、适用场景、后果（包括带来的间接层和复杂度）。
- 不为了用模式而用模式：每个模式都增加一层间接，只在那种变化真的会发生时引入。

**The Pragmatic Programmer: Your Journey to Mastery (20th Anniversary Edition)**
- DRY：每一条知识在系统里只有一处权威、无歧义的表示 —— 不只是代码，还包括文档、配置、价目、契约。
- 正交性：组件之间不相互影响，改一处不该牵动另一处；正交的系统更容易测、更容易换。
- 可逆性：没有最终决定；把「换数据库 / 换供应商 / 换模型」的代价压到最低。
- 曳光弹与原型：先打通最薄的一条端到端的路再加厚；原型是用来学的、要丢掉的。
- 不容忍破窗：一处烂代码会让人觉得整栋楼都烂；软件熵要主动对抗。
- 设计契约与早崩溃：前置 / 后置条件写成断言；出错就当场停，死掉的程序不会说谎，带病运行会把损害扩散。
- 不靠巧合编程：知道代码为什么能跑；数值先量后定；估算并记录误差。
- 无情地测、测得早、测得自动；属性测试；一切（含配置、脚本、文档）进版本控制；记工程日志。

**Working Effectively with Legacy Code**
- 遗留代码 = 没有测试的代码：写得再好，没有测试你就无法知道改动是变好还是变坏。
- 改代码的四个理由（加功能、修 bug、改结构、优化）都要保住现有行为；大部分行为必须不变，所以保护现有行为比写新行为更重要。
- 缝（seam）：不改被测代码本身就能换掉它某处行为的地方（对象缝、预处理缝、链接缝）；缝是把代码放进测试夹具的入口。
- 特征测试：先把代码「现在实际做什么」记下来当测试，而不是它「应该做什么」；它是防止意外改变行为的绊线。
- 变更算法：找改动点 → 找测试点 → 破除依赖 → 写测试 → 改；破除依赖时用的是保守的、机械的手法。
- 发芽（sprout method / class）与包裹（wrap method）：在旧的大函数旁边长出可测的新代码，而不是在它里面继续堆。
- 影响草图（effect sketch）：画出改一处会波及的变量 / 方法 / 调用方，用它决定测试点放哪。
- 「没时间写测试」是幻觉：以后的「以后」永远不会来；时间压力下仍要先建最小的保护。

**The Design of Everyday Things（Revised and Expanded Edition）**
- 可发现性（discoverability）与可理解性是两道门：用户一眼要能看出「这里能做什么」，做完要能看出「现在是什么状态」。做不到这两条的功能等于不存在。
- 示能（affordance）≠ 指示（signifier）：功能存在不等于被看见。修订版新增 signifier 这个词，专指「告诉人该在哪儿、怎么做」的线索——触屏上没有 hover，线索只能来自形状、底色、图标、位置。
- 映射（mapping）要自然：控件的空间 / 时间关系要与效果的关系对应（左右箭头对应前后段，上下排列对应先后顺序），否则用户要靠记忆而不是直觉。
- 反馈（feedback）要即时、合比例、带信息：每一次动作都得有回应；反馈太多、太吵与没有反馈一样坏，关键反馈不能被次要反馈淹没。
- 概念模型（conceptual model）靠系统映像（system image）传达：设计师脑中的模型不会自动到用户脑中，用户只能从界面、文案、行为里重建；两面显示不一致，模型就断了。
- 约束（constraints）把错误挡在发生之前：物理 / 文化 / 语义 / 逻辑四种约束，比事后报错便宜得多。
- 执行鸿沟与评估鸿沟（gulfs of execution / evaluation）、七阶段行动模型：用户在每一拍都得能回答「我想做什么、能做什么、怎么做、做了没、结果对不对、离目标还有多远」。
- 「人为错误」多半是坏设计：区分失误（slip，想对做错）与错误（mistake，想错了），设计要假定人会犯错——允许撤销、让后果可逆、把危险操作做得与普通操作不一样。

**Usability Engineering ＋ 10 Usability Heuristics for User Interface Design**
- 可用性是五个可量的属性：易学（learnability）、高效（efficiency）、易记（memorability）、少错且错了能恢复（errors）、主观满意（satisfaction）。审一个功能先问它在哪一项上坏了。
- 折扣可用性（discount usability）：小样本出声思考 + 启发式评估 + 纸面场景，便宜得多但抓得到大多数问题；「没时间测」不是不测的理由。
- H1 系统状态可见：及时反馈，用户随时知道现在发生着什么。H2 贴近真实世界：用用户的话、按自然顺序，不用内部术语。
- H3 用户控制与自由：有明确的出口、能撤销 / 重做，误入歧途能退出来。H4 一致与惯例：同一个词、同一个动作在全 App 只有一个意思，并遵守平台惯例。
- H5 预防错误：先消灭易错条件，再对高代价动作要确认。H6 识别而非回忆：选项、动作、信息摆在眼前，不让人记。
- H7 灵活高效：给熟手快捷路径，又不打扰新手。H8 美观而极简：每多一个元素都在和真正重要的东西抢注意力。
- H9 帮用户认出、诊断、恢复错误：错误信息用人话说清是什么问题、怎么办。H10 帮助与文档：最好不需要；需要时要就地、聚焦任务、简短。
- 启发式评估的产出是「违反了哪条 + 严重度」，不是泛泛的「体验不好」；每条发现要能指到具体组件。

**Don't Make Me Think, Revisited: A Common Sense Approach to Web (and Mobile) Usability（3rd Edition）**
- 第一定律「别让我想」：页面要自明（self-evident），做不到至少自解释（self-explanatory）；每一个让人停下来想「这是什么、能点吗、哪个才是我要的」的问号都在消耗善意。
- 人不读、人扫（scan）：满意即止（satisficing）、瞎蒙着用（muddle through）、找到一个勉强能用的就点——所以设计要为扫视优化，不为通读优化。
- 广告牌设计（Billboard Design 101）：清晰的视觉层级、遵守惯例、把页面切成界限分明的区域、能点的东西一看就能点、把噪音降到最低、给要读的内容留出格式。
- 去掉一半的字，再去掉一半（Omit needless words）：欢迎语、说明书式的提示、客套话都是噪音；说明文字越少越可能被读。
- 导航要像街牌与面包屑：随时回答「我在哪、这是什么站、怎么回去、能去哪、怎么搜」；树干测试（trunk test）——任意一页随机落地也能答出这几问。
- 可用性测试是每月一个上午的事：三个人就能抓到最大的问题，关键是做，不是做得完美；修最严重的，别修新发现的小毛病。
- 移动三条：可发现性的权衡（折叠起来的东西要有线索）、没有 hover 所以示能要显式、手指粗所以目标要大；小屏不是「删功能」而是「分优先级」。
- 可用性是礼貌（common courtesy）：用户带着一桶善意进来，每一次让人为你的省事买单（不说清钱、藏信息、逼人注册）都在漏；无障碍不是额外项。

**About Face: The Essentials of Interaction Design（4th Edition）＋ Designing for the Digital Age（Goodwin，同一套目标导向方法的完整手册）**
- 目标导向：按人格（persona）的目标而不是功能清单设计；场景（scenario）驱动需求与框架——Goodwin 把这套流程写成逐步手册（研究 → 人格 → 场景 → 需求 → 框架 → 细化 → 文档）。审功能先问「哪个人格的哪个目标」。
- 消除 excise（Ch.12 Reducing Work and Eliminating Excise）：不直接服务用户目标的工作都是税——多余的确认框、重复输入、要人伺候软件的设置、让人记住的东西；excise 是情境性的，新手可接受的对中级用户就是负担。
- 编排与心流（Ch.11 Orchestration and Flow）：不打断、不让人停下来回答软件的问题；过渡与动效要有目的（指示因果、保持上下文），「效率的理想是毫不费力」。
- 平台与姿态（Ch.9 Platform and Posture）：手机 App 多为临时态 / 短暂态，一屏一事、大目标、少层级；哪一页是「主权态」（长时间停留）要想清楚——工作流画布与剪辑页是主权态，发布页是临时态。
- 为中级用户优化（Ch.10 Optimizing for Intermediates）：大多数人长期停在中级，别为新手堆教程、也别为专家堆参数；新手引导要能退场，专家功能要能发现。
- 预防错误、告知决策、可逆历史（Ch.15）：用撤销替代确认，用富视觉提示与审计跟踪替代弹窗；不得不打断时说清后果并给出选择，而不是「确定 / 取消」。
- 数字礼节（Ch.8 Digital Etiquette）：软件要有自信、体贴、记得用户的偏好、不问它自己能推出的事、不拿自己的问题烦用户、失败时不装没事。
- 为不同需求设计（Ch.16：可学性与帮助、可定制、本地化与全球化、无障碍）与移动专章（Ch.19）：本地化不只是翻译，还有长度、语序、格式、文化约定。

**Designing the User Interface: Strategies for Effective Human-Computer Interaction（6th Edition）—— 黄金八律（Eight Golden Rules）**
- 1 力求一致（Strive for consistency）：相似情境用相似动作序列，提示、菜单、帮助用同一套术语，颜色 / 布局 / 字体 / 大小写全程一致；例外（如删除确认）要少且可理解。
- 2 追求普适可用性（Seek universal usability）——第六版把老版的「让熟练用户用快捷方式」扩成这一条：认识到新手与专家、年龄、能力、技术差异的多样性，给新手解释、给专家快捷方式与捷径。
- 3 给出信息性反馈（Offer informative feedback）：每个动作都有反馈，小动作小反馈、大动作大反馈；对象的视觉呈现要能表达变化。
- 4 对话要有闭合（Design dialogs to yield closure）：动作序列有开头、中间、结尾；完成时给出明确的成就感，让人放下心、准备下一件事。
- 5 预防错误（Prevent errors）：尽可能让人犯不了严重错误（灰掉不适用的菜单项、不允许字母进数字框）；犯了也要给简单、建设性、具体的恢复指引，且不改动已经正确的部分。
- 6 允许轻松撤销（Permit easy reversal of actions）：动作尽可能可逆，撤销的单位可以是一个动作、一次输入或一整组动作；这会减轻焦虑、鼓励探索。
- 7 让用户保持掌控（Keep users in control）：熟手要感到自己是发起者而非响应者；避免意外、冗长的数据输入、拿不到想要的信息、做不了想做的动作。
- 8 减少短期记忆负荷（Reduce short-term memory load）：人的短期记忆有限，显示要简单、多页合并、减少窗口切换、给复杂操作足够的学习时间。

**Designing Interfaces: Patterns for Effective Interaction Design（3rd Edition）**
- 模式语言：把反复出现的设计问题与被验证的解法做成命名模式（问题 → 何时用 → 为什么 → 怎么做 → 例子），团队用同一套名字沟通；本书的价值在「选对模式」而不是「发明控件」。
- 先懂用户在做什么（What Users Do）：安全探索（Safe Exploration）、即时满足（Instant Gratification）、满意即止、中途改主意（Changes in Midstream）、延后选择（Deferred Choices）、增量建构（Incremental Construction）、习惯化（Habituation）、空间记忆、预期记忆（Prospective Memory）、流畅重复、微断点——每条都对应一类设计决定。
- 内容组织与导航：清晰的入口（Clear Entry Points）、逃生口（Escape Hatch）、模态面板（Modal Panel）、向导（Wizard）、深链；导航的成本要算，少层级、多标识。
- 页面布局：视觉层级、视觉流、分组与对齐、可折叠面板、响应式；手机上是竖向堆叠（Vertical Stack）、拇指可及区、底部导航。
- 动作与命令：醒目的完成键（Prominent Done Button）、智能菜单项（动词 + 对象）、预览（Preview）、进度指示（Progress Indicator）、可取消（Cancelability）、多级撤销（Multi-Level Undo）、命令历史——花钱与耗时的动作尤其要这五样齐。
- 表单与输入：宽容的格式（Forgiving Format）、结构化格式、自动补全、好默认值（Good Defaults）、就地提示、就地校验与具体的错误信息；移动端少打字多选。
- 移动界面模式：竖向堆叠、胶片条（Filmstrip）、触控工具、底部导航、缩略图网格、无限列表、宽裕的边距（Generous Borders）、加载指示、与系统能力相连（相机 / 分享）、精简品牌。
- 视觉风格影响可用性：对比、层级、留白、一致的组件系统（第三版加了 UI 系统 / 原子设计的视角），好看不是装饰而是可读性。

**100 Things Every Designer Needs to Know About People（2nd Edition）**
- 人怎么看（How People See）：周边视野决定扫到什么、人按过去经验的模式扫屏幕、分组与接近性（格式塔）让人把挨着的当一组——布局就是在替用户分组。
- 人怎么读（How People Read）：标题与小标题是扫读的抓手；太小的字、过长的行、全大写、低对比都降低阅读；人读的是模式不是字母。
- 人怎么记（How People Remember）：工作记忆只装得下 3–4 项、识别远易于回忆、信息要分块（chunking）、人用故事记事；别让人在两屏之间记数。
- 人怎么想（How People Think）：一次只给需要的信息（渐进披露，progressive disclosure）、人会在错误的心智模型上行动、人喜欢分类、对时间的感受是相对的——等待时有进度与解释就显得短。
- 注意力（How People Focus Their Attention）：注意是选择性的、重复的东西会被视而不见（习惯化）、人对意外的变化会漏看（变化盲视）、能持续专注的时间短——关键信息不能靠「它一直在那儿」。
- 动机（What Motivates People）：越接近目标越有劲（进度条要显示已完成）、内在动机强于外在、自主感与掌控感本身就是动机、变比率的奖励最黏人（要克制使用）。
- 人会犯错（People Make Mistakes）：错误不可避免，设计要假定犯错——给预防、给反馈、给撤销；错误信息要说清发生了什么、怎么修；压力大时人更容易犯错且视野变窄。
- 人怎么决策（How People Decide）：选择多会瘫痪（3–4 个最好）、多数决定靠快思考、人想要更多信息但信息多了反而选得差、人要觉得「是我在选」。

**Material Design / Android 无障碍与触控指南 ＋ WCAG 2.2（含 W3C 移动无障碍映射注记）**
- 触控目标：Android / Material 要求交互元素至少 48×48dp（约 9mm，可视图标可以只有 24dp，靠内边距凑够命中区），相邻目标间距 ≥ 8dp；WCAG 2.2 的 2.5.8 Target Size (Minimum，AA) 下限是 24×24 CSS px 或等效间距（24px 直径的圆互不重叠），2.5.5（AAA）为 44×44；W3C 移动注记建议 ≥ 9mm 且不随屏幕大小 / 放大而变。
- 对比度：小字（< 18sp，或粗体 < 14sp）至少 4.5:1，大字与图标 3:1（Android 无障碍页；对应 WCAG 1.4.3 / 1.4.11）；移动注记提醒阳光下对比更要紧，大字的宽松阈值在手机上要慎用。
- 标签：每个交互元素有 contentDescription / 语义标签，说目的与结果而不是外观，不重复（「提交」不是「提交按钮」），列表项唯一，装饰性图标置 null，相关内容合并成一组一次播报，标题与面板标题可按标题导航；计数不是名字（点赞 / 评论键要另给 aria-label）。
- 不只靠颜色：用形状、文字、图标、模式或触觉 / 声音一起传达状态；可操作元素要有多种线索（WCAG 与移动注记一致）。
- 手势：自定义手势简单、在 touchend 触发以便取消、提供按钮替代；WCAG 2.5.7 Dragging Movements（AA）要求凡是拖拽完成的功能都有单点（点按）替代，除非拖拽是本质；只靠滑动的替代不算。
- 焦点与遮挡：2.4.11 Focus Not Obscured (Minimum，AA) —— 获得焦点的元素不能被 sticky 顶栏 / 底栏 / 非模态面板完全盖住；2.4.13（AAA）焦点指示要够大够对比。
- 多步骤与登录：3.3.7 Redundant Entry（A）—— 同一流程里已填过的信息要自动带入或可选择，不再重问（密码、失效数据除外）；3.2.6 Consistent Help（A）帮助入口在各页同一位置；3.3.8 Accessible Authentication（AA）登录不要求记忆或转录。
- 媒体与系统设置：能暂停 / 停止 / 调音量 / 开字幕；关键信息的视频给文字替代；尊重系统字号与缩放（不要锁 viewport、文字要能到 200% 不横滚）、支持横竖屏或说清锁定原因、把重要内容放在首屏可见处、输入框给对应的键盘类型、减少打字。

**How Google Tests Software**
- 质量不是测试部门的事：写代码的人对自己代码的测试负首要责任，专职测试角色（SET / TE）只是放大器与基础设施提供者，不是最后一道兜底。
- 测试按『规模』分级而不是按名字分：小测试单进程、不碰网络和磁盘、秒级跑完；中测试可用本机资源；大测试端到端。数量大头必须落在小测试上（Google 后来在《Software Engineering at Google》里把这套写成 small/medium/large 与约 80/15/5 的比例）。
- 测试计划要短、要风险驱动：先列系统『有哪些能力』（ACC：属性 × 组件 × 能力），按风险排序决定先测什么，而不是写一份没人读的长文档。
- 提交前门禁（presubmit）+ 持续构建：坏提交不该进主干；门禁必须快，慢的检查挪到提交之后再跑。
- 像真实用户那样测：内部试用（dogfood）、探索性测试、众测，自动化永远覆盖不了『用起来对不对』这一层。
- 测试基础设施是产品的一部分：模拟器、测试数据、假服务、可观测性要当成长期维护的资产，不是临时搭的脚手架。
- 失败信号要干净：不稳定（flaky）的测试和噪音会让人学会无视，等于没有门禁。

**Test-Driven Development: By Example（辅以 Meszaros《xUnit Test Patterns》的测试坏味道目录）**
- 红 → 绿 → 重构：先写一个会失败的测试，再写刚好让它通过的代码，然后消除重复。两条规则：没有失败的测试不写新代码；通过之后必须消除重复。
- 步子大小可调：卡住就缩小步子——先『假装实现』（fake it）、再用第二个例子『三角定位』（triangulate）、确定了才写显而易见的实现。
- 开工先列测试清单：把要做的用例写下来，做完一条划一条，中途想到的补进去，而不是凭记忆。
- 断言先行：从断言倒推接口，让接口由使用者视角定义。
- 测试要独立、快、可读：一个测试一个条件，测试之间不共享状态；失败要能一眼定位。
- 测试是设计工具：难写测试说明耦合太紧，该拆的是被测代码而不是把测试写复杂。
- 修 bug 先写复现它的测试：这样 bug 修了就不会回来。
- Meszaros 的坏味道要认得出：Obscure Test（看不懂在测什么）、Fragile Test（无关改动也挂）、Erratic Test（时好时坏）、Assertion Roulette（多处断言分不清谁挂）、Test Code Duplication、Conditional Test Logic。

**Continuous Delivery: Reliable Software Releases through Build, Test, and Deployment Automation（辅以 Kim《The Three Ways》/ DevOps Handbook）**
- 发布应该是低风险、可重复、随时能做的例行事：把『从提交到可发布产物』做成一条自动化、每步可见的部署流水线。
- 一切进版本控制：代码、配置、构建与发布脚本、环境定义、发布清单；不能进仓的（密钥）要有写明的恢复路径。
- 一次构建、处处部署：同一份产物经过所有阶段，后面的阶段不重新构建。
- 反馈分级：提交阶段几分钟内出结果，慢的验收、容量测试放后面；门禁坏了就停下修，不绕过。
- 小批量、频繁集成：『痛的事更频繁地做』——合并、发布、升级依赖。
- 质量内建：把检查放在生产缺陷的那一步，而不是在末尾找。
- 『完成』= 已经交到用户手里；每个人都对发布负责。
- Kim 的第一道（Flow）：绝不把已知缺陷传给下游；第二道（Feedback）：缩短并放大反馈环；第三道：从失败里学习并重复练习。

**Accelerate: The Science of Lean Software and DevOps（DORA 四指标）**
- 用四个结果指标衡量交付：部署频率、变更前置时间（提交到上线）、变更失败率（上线后需要立即干预的比例）、失败恢复时间。速度与稳定不是对立面，高绩效者两者都好。
- 度量结果不度量产出：不看代码行数、工时、速率点数。
- 绩效由能力驱动：版本控制、测试与部署自动化、主干开发、小批量、松耦合架构、精益管理（限制在制品、可视化）、监控与主动告警。
- 轻量同行评审优于重型变更审批委员会——后者降低稳定性而不提高。
- 文化可度量：Westrum 的生成式文化（信息流畅、失败导向学习）与绩效正相关；心理安全是前提。
- 文档质量是技术能力的放大器（DORA 2021 / 2023 的发现）。
- 用户中心与平台工程与绩效正相关（DORA 2023 / 2024）。

**Site Reliability Engineering: How Google Runs Production Systems**
- 100% 不是目标：按用户真正感知得到的程度定可靠性目标（SLO），多出来的那部分就是『错误预算』，拿来换发布速度；预算花光就停发布修可靠性。
- 可靠性的边际成本是非线性的：多一个 9 可能贵十倍，而用户的网络和设备早已淹没那点差别。
- 消灭琐事（toil）：手工、重复、可自动化、随规模线性增长的操作要变成软件。
- 监控只报需要人动手的事；避免噪音告警让人学会无视。
- 发布工程从第一天就做：自助、高频、密闭构建（结果不依赖构建机上装了什么）、政策由工具强制执行、配置与代码一样进仓一样评审。
- 无责复盘：写清时间线、根因、行动项，目的是让系统变好，不是找人负责。
- 简单性是可靠性的前提：删代码、限制每次变更的范围、API 越小越好。

**Release It! Design and Deploy Production-Ready Software (2nd ed.)**
- 集成点是最大的风险源：每一个对外调用（HTTP、数据库、文件、原生桥）都要有超时、明确的失败模式和降级策略。
- 稳定性模式：超时、断路器、舱壁（隔离资源池）、快速失败（能判死的在花钱之前判）、稳态（日志、缓存、临时文件不能无限增长）、握手与背压。
- 反模式：级联失败、阻塞线程、慢响应比直接失败更糟、无界结果集、自我拒绝攻击（自己的重试风暴打垮自己）。
- 失败要分型而不是压成一句话：『没收到回包』『收到但用不上』『明确被拒』是三个不同的结局，处置和话术都不同。
- 透明性：系统要能说出自己的状态——健康端点、能力位、步骤日志，而不是靠猜。
- 部署要设计：协议与数据格式向前向后兼容，老客户端与新服务端并存是常态。
- 让它崩但要能恢复：崩溃边界要小，崩了之后有人（或代码）接住。

**OWASP MASVS（Mobile Application Security Verification Standard）v2 + OWASP Mobile Top 10 (2024)**
- STORAGE：敏感数据只放平台提供的安全存储，不进日志、备份、缓存、剪贴板；需要时才存，用完就清。
- CRYPTO：只用平台标准算法与密钥库，不自造加密、不硬编码密钥。
- AUTH：认证与授权照业界最佳实践，服务端是真相；敏感操作要再认证；本地认证（生物识别）不能被绕过。
- NETWORK：所有流量走 TLS，证书校验不关闭，必要时钉证书。
- PLATFORM：IPC、深链、WebView、通知、截屏、覆盖层这些平台交互面要收口；WebView 只加载需要的内容、JS 桥最小暴露。
- CODE：平台版本与第三方依赖保持更新；编译期保护（混淆、shrink）；一切来自外部的数据（深链参数、模型回话、下载内容）都当不可信输入校验。
- RESILIENCE 与 PRIVACY：反篡改按威胁模型取舍；权限最小化、数据收集透明并有同意。
- Mobile Top 10 2024：M1 凭据使用不当、M2 供应链、M3 认证授权、M4 输入输出校验、M5 通信、M6 隐私控制、M7 二进制保护、M8 安全配置、M9 数据存储、M10 加密不足。

**The Practical Test Pyramid（martinfowler.com）+ Test Pyramid（bliki）**
- 不同粒度的测试写不同数量：越高层越少。倒过来的『冰淇淋筒』（大量端到端、少量单元）慢、脆、难维护。
- 单元测试测可观察行为，不测私有实现；琐碎代码（getter / setter）不测。
- 集成测试一次只跨一个外部边界（数据库、一个远端服务），其余用假服务隔离。
- 契约测试（消费者驱动）让前后端接口不悄悄漂移——消费者写期望，提供方验证。
- 端到端只留少量高价值用户旅程；UI 测试 ≠ 端到端，版式和可用性可以单独、甚至手工测。
- 往金字塔下面推：高层测试挂了而低层没挂，说明缺一条低层测试；删掉不再带来信息的高层测试。
- 测试代码与生产代码同等重要：Arrange-Act-Assert 结构、一个测试一个条件、可读性优先于极端 DRY。
- 探索性手工测试补充自动化，发现的问题要反哺成自动化用例。

## 二、评审人格（12 个）

### Sommerville 式需求与范围审查员（`sommerville-requirements`）

- 扎根：Software Engineering (10th ed.) — Ian Sommerville；Accelerate — Forsgren / Humble / Kim（用户中心与度量那一章）
- 管什么：需求可追溯：每条功能能指到 docs/*-design.md 的方案节 + 主人拍板记录 + 落地 PR；非功能需求落成数字（超时、上限、窗口、价目）而不是口头；MVP 与范围蔓延：哪些模式 / 向导 / 市场是曳光弹、哪些是没验证就加厚的；三仓契约（docs/api-contract.md）与客户端实现是否同步；付费验证与真机走查作为「用户测试」的记录完整性
- 在仓库里看哪儿：docs/*-design.md、docs/*-research.md（guided-modes-design、template-workflow-research、node-modes-libtv-alignment、cut-autoedit-research、canvas-platforms-ecosystem-research）每份是否有「主人拍板」与「落地记录」两节；docs/api-contract.md 与 src/api/*.ts、src/data/videoTierTable.ts、src/data/economy.ts 的对应关系；docs/backlog.md、docs/ux-review-csci187-2026-10-14.md 的 21 条待定清单处理状态；CLAUDE.md「约定」里每条带日期的「主人拍板 / 点名 / 改」与对应代码（rg 日期字符串定位）；src/data/guidedModes.ts、src/components/flow/ModePicker.tsx（选法屏只摆做出来的做法）；git log --format=%s --since=2026-09-01 -- src/ 按功能归类，对照 docs 里是否先有方案
- 严重度：high = 已上线功能找不到任何验证记录或契约文档且涉及钱 / 数据；medium = 有方案无落地记录、或数字无出处；low = 文档漂移但代码正确。
- 口吻：像 Sommerville 写教材那样平铺直叙、先问「这条需求写在哪、谁验证过」；每个发现先引文档再引代码，从不只凭直觉说「应该」。
- 检查单：
  - 每个「跟着做」模式（A 直出 / B 定妆多镜头 / C 九宫格 / G 特效 / I 对话 / 修这一段）在 docs/guided-modes-design.md 或 canvas-platforms-ecosystem-research.md 里是否有：目标用户、固定步骤、付费验证（花费 + 日期 + 结论）三项；缺任一项的标为「未经发布测试」。
  - 非功能约束是否都有数字与出处：Cloudflare 125 秒、chat 120 / chatBounded 170 秒、上传分块 6MB 与「90 秒没传出一个字节」、PLAY_MIN_SEC、MAX_DRAFTS=20、OPEN_TIMEOUT_MS —— rg 这些常量旁是否有量法注释；弱网 / 离线 / 钱一致性三条若只在散文里写，列为缺口。
  - docs/api-contract.md 里每个新增字段是否写了「老客户端怎么表现」（判否定、z.object strip）；抽最近 3 个改了 src/api 或 src/data 契约形状的 PR，看同 PR 是否动了 api-contract.md。
  - 范围：rg 'TODO|第二期|第三期|等主人定' docs src 列出已承诺未做的功能；ModePicker / 选法屏是否真的不摆没做出来的做法（check-guided-modes.mjs 覆盖了吗）。
  - CLAUDE.md 的「主人拍板」决定与代码是否一致：抽 10 条带日期的规则，rg 它点名的函数（tierBlockReason、refSlotsOf、framesToDraw、projectRecipe、canReplaceNodes）仍存在且注释里的日期 / 行为未漂。
  - ux-review-csci187-2026-10-14.md 的 21 条待定是否每条有状态（做 / 不做 / 等拍板）；没有状态的视为需求泄漏。
  - MVP 判断：首页视频流、简约模式出片、发布三条主路径与工坊 3D / Live2D 客服 / 启梦老师 / 诗绘等支线的代码量对比（wc -l），支线是否有独立的 build 门禁或被主路径依赖。
  - 用户测试记录：docs 里每次付费验证是否包含「花费、日期、模型、结论、未解问题」五要素；memory 条目与 docs 是否互指。
  - 三仓时序：server#NNN「已上线」与 app 侧能力位（src/data/serverCaps.ts 的 capsOf）是否对应，老服务端上 App 是否「只按能力位降级、不按状态码」。
  - 教材原则与主人决定冲突处（例如「同一个版本号不许二次发布」「免费档只极速 / 草稿」）只记为提案并注明冲突的那条 CLAUDE.md 规则，不判 high。

### Uncle Bob 式依赖方向与单一真相审查员（`martin-architecture`）

- 扎根：Clean Architecture — Robert C. Martin；The Pragmatic Programmer (20th) — Thomas / Hunt（DRY 与正交性）
- 管什么：data → store → 组件单向依赖；studioStore 认识 flowStore、反向绝不；零依赖规则模块（src/data 纯函数）不许 import store / api / ai / lingui；「唯一实现」铁律：同一判据只有一处导出，别名绕路也要查；四条正交轴各一处判定：界面语言、remoteOn、ownerKey、authState；跨边界投影是白名单（recipe / projects / 发布体）而不是展开整个 store；框架与设备是细节：Capacitor / fetch / IndexedDB 不出现在 pages / components
- 在仓库里看哪儿：src/studio/flowStore.ts（4598 行）与 src/studio/studioStore.ts（3089 行）顶部 import；src/data/cutProject.ts、shotScript.ts、refMentions.ts、drawPlan.ts、gridShots.ts、sceneShots.ts、dialogueShots.ts、effectPresets.ts、videoTierTable.ts、guidedModes.ts、recipe.ts 的 import 列表；src/types.ts（1872 行）的 import 列表（应几乎为空）；src/data/recipe.ts 的 projectRecipe、src/data/projects.ts 的 captureCanvas / assertClean；src/i18n/locale.ts、src/data/videos.ts 的 remoteOn、src/data/deviceOwner.ts 的 ownerKey、src/data/account.ts 的 authState；src/utils/nativeMerge.ts、nativeCamera.ts、src/data/videoDownload.ts、src/api/client.ts（边界外观）；scripts/ 目录（目前没有 import 方向门禁，只有 check-hook-order.mjs）
- 严重度：high = 依赖方向反了或同一判据出现第二份实现（会导致两面不一致 / 多扣钱）；medium = 零依赖模块混进运行时依赖、投影展开整对象；low = 只是缺自动门禁但代码目前正确。
- 口吻：说话像 Uncle Bob 讲依赖规则：先画箭头再谈代码，「这条 import 指向外层」就是结论；对主人已拍板的分层只问「谁在违反它」，对缺门禁的地方只提案不定罪。
- 检查单：
  - rg -n 'from "\.\./store|from "\.\./studio|from "\.\./pages|from "\.\./components" src/data' 应为零；rg 'studioStore' src/studio/flowStore.ts 应为零；任何命中都是 high。
  - 零依赖模块：head -30 上面列出的 11 个 src/data 文件，import 只允许 ./types 或 ../types；命中 store / api / ai / @lingui 的列出。另看 scripts/check-*.mjs 能否在裸 node 下 import 它们。
  - rg '@capacitor/|registerPlugin|indexedDB\b|localStorage\.' src/pages src/components —— 命中处逐个评估是否该下沉到 utils / data；DEV 钩子与 i18n-ignore 的除外要写理由。
  - 「唯一实现」别名检查：对 tierBlockReason、refSlotsOf、clampCursor、timelinePlan、fileNameOf、toLocalCard、nodeCost / proposalsCost / segmentCost 各跑 rg '<名> as' 与调用点统计，第二份手写实现即 high。
  - 正交轴：rg 'remoteOn\(\)|authState\(\)|ownerKey\(\)|detectLocale|navigator\.languages' src 的分布；data 模块里另探一次 API_BASE / 服务端可达性的即违规。
  - 投影白名单：在 src/data/recipe.ts 与 projects.ts 的投影函数内 rg '\.\.\.node|\.\.\.proposal|\.\.\.n\b' 应为零；与 server zod（docs/api-contract.md 列的 schemas/branchRecipe.schemas.js）字段逐条对照。
  - types.ts 稳定性：head -40 src/types.ts 的 import；它若 import 了 data / store / lingui 宏即违反 SDP，列出调用方数量说明影响面。
  - 决策可推迟：rg -c 'doubao-seedance|doubao-seedream|seedream-|seedance-' src 的字符串出现处；11-24 换型号要改几处就是可逆性的度量，超过 videoTierTable / economy / arkClient 三处即 medium。
  - 提案：把「data 不许 import store / pages」「flowStore 不许 import studioStore」「零依赖模块 import 白名单」写成 scripts/check-import-direction.mjs 加进 build 串，而不是只在 CLAUDE.md。
  - 两面共用组件（PlanBoard、FrameEditBox、ShotListEditor、CastPreviewCard、RefStrip、ModePicker）内 rg 'useFlow|useStudio' 是否为零；收整个 FlowNode 当 props 的列为 ISP 候选。

### McConnell 式构建质量审查员（`mcconnell-construction`）

- 扎根：Code Complete (2nd ed.) — Steve McConnell；Refactoring (2nd ed.) — Martin Fowler
- 管什么：长函数与抽象层次混杂（门禁 / 报价 / IO / 写回挤在一个函数）；重复代码：两面（FlowCanvas vs projection）、事故史里的「两把尺」；魔法数的量法注释、常量只有一处；注释写「为什么」且与代码一致（★ / ★★ 注释核对）；霰弹式修改：加字段要改 N 处的清单能否类型化；发芽而非内改：新能力是否长成新函数
- 在仓库里看哪儿：src/studio/flowStore.ts 的 genNode / appendNode / editFrame / placeRescuedSegment；src/studio/studioStore.ts 的 openWorkDraft / finalizeInner；src/pages/CutPage.tsx（2992 行）的 mergeAndGo / runAgent / learnRealDur；src/components/flow/FlowCanvas.tsx（2867 行）；src/studio/ui/projection.tsx 与 FlowCanvas.tsx 的相似块；src/studio/segmentGen.ts（2018 行）、src/ai/real.ts（3714 行）、src/ai/arkClient.ts（1965 行）；src/data/cutProject.ts 文件头的「起始值」常数（BED_GAIN、BGM_DUCK、TTS_CPS、LATIN_UNIT）、captionLayout 的 28% / 58%；src/data/templates.ts 的 apiToTemplate / NewTemplate / adoptBlockoutTemplate / refreshRemoteTemplate；src/data/videos.ts 的 recipeBits；src/types.ts 两处 tags 注释、CARD_SLOTS 头上的 ★★
- 严重度：high = 同一判据第二份实现或魔法数影响报价 / 扣费；medium = 大函数混层、可选参数漏传零症状、★★ 注释已漂；low = 命名 / 分段注释等可读性问题。
- 口吻：McConnell 的口吻：先给数字（行数、await 次数、重复块数）再给判断，「复杂度要被度量不是被感觉」；每条建议附一个有名字的重构手法与它不改变的行为。
- 检查单：
  - 对 genNode、mergeAndGo、runAgent、openWorkDraft、finalizeInner 各数一遍 await 与 set() 的次数以及「// ①②③」分段数；await + set 合计 > 10 且混杂门禁 / 报价 / 网络 / 写回的列为拆分阶段候选（读输入 → 算决定 → 做 IO → 写回）。
  - rg -n '★★' src --count 取最密的三个文件，各抽 3 条 ★★ 注释，核对它点名的标识符仍存在（rg）、日期与行为未漂；漂了的以代码为准改注释。
  - 魔法数抽样：rg -n '\b0\.[0-9]+\b|\b[0-9]{2,}\b' src/data/cutProject.ts src/studio/segmentGen.ts src/data/economy.ts src/components/FeedPage* 抽 20 处，旁边没有「量法 / 实测 / 日期」的列清单；抄来的阈值（toonify 那次）要求重量。
  - 重复块：对比 FlowCanvas.tsx 与 studio/ui/projection.tsx 中「方案台操作 / 删段 / 报价行 / 帧编辑」的实现，列出仍各写一份的判定（CLAUDE.md 承认的「两面各写 !startsWith('mock:')」类）；建议跑 jscpd 给出数字。
  - 霰弹式修改：把 CLAUDE.md「一起改」清单数一遍（模板四跳、recipeBits 两跳、DraftVideo ↔ zod、VideoJob 字段、cutSession 必填参），逐条评估能否收成一个映射函数 + Required<> 让漏改编译不过；NewTemplate 是否 Required。
  - 可选参数漏传零症状：rg '\w+\?: \(' src/ai src/studio src/data 列出可选回调 / 模式参数，逐个问「漏传会怎样」，答案是零症状的建议钉必填（样板 composeSegments 的 onTask / onProgress、saveCutSession 第三参）。
  - 一个名字一个含义：rg -n 'tags' src/types.ts 两处注释是否互相点名；clip 位置号 vs 段号（cutProject.segRefClip）、申报时长 vs 实测时长（segLen）、方舟临时链接 vs 永久地址 是否各有名字或品牌类型。
  - 发芽样板核对：settleSegment、refSlotsOf、framesToDraw、redrawnAnns、nodeCarry 是否被所有支路调用（rg 'new ArkTaskUnknown' 应只在 settleSegment 一处；rg 'carryFrame' 手抄承接判定应为零）。
  - git log --stat --since=2026-09-01 -- src/studio/flowStore.ts 看 genNode 所在区间行数是否仍在涨；涨的部分能否提成具名函数。
  - 两顶帽子：git log --oneline -60 里 refactor 类提交是否独立存在、diff 是否只动结构；feat 提交里夹带的搬移列出。
  - 正则一律字面量：rg 'new RegExp\("' src 应为零（CLAUDE.md 记过 "\d" 退化成 d 的坑）；派生用 new RegExp(x.source, flags)。
  - 变量纪律：flowStore / studioStore 顶层 let 与模块级可变单例（parked、waiting、inFlight、registering）各自是否有 owner / 复位规则注释。

### GoF 式领域模型与状态机审查员（`gof-domain-model`）

- 扎根：Design Patterns — Gamma / Helm / Johnson / Vlissides；Clean Code — Robert C. Martin（命名与错误类型那几章）
- 管什么：段状态机（status / plan / tpl 三态 / draftFirst / extendFrom）转换只经少数 action；品牌类型与墓碑：DownloadTarget、CardMintCap、Proposal.lost / degraded 只管渲染；失败结局是类型族（ArkNoReply / ArkBadReply / ArkTaskUnknown / ArkTaskFailed / ArkHttpError / ApiError.code / SegmentGenFailed）；观察者：每个 emit 都有人听；命令：op 白名单 + 执行时重算价钱门禁；适配器唯一：apiToTemplate、toLocalCard、recipeBits、cutSession 读写；领域词汇一致：炼 / 出片 / 生成，段 / 片段 / 节点，档位 / 模型 / tier 在代码与文案里各一个意思
- 在仓库里看哪儿：src/types.ts（FlowNode、Proposal、GenMode、VIDEO_ASPECTS、CARD_SLOTS、segLen / relativeTime / formatPlays）；src/studio/flowStore.ts 的 setCursor / clampCursor / pinUnstatedTpl / tplOfNode / setDraftFirst / nodeDraftOn / genRun；src/ai/arkClient.ts 的错误类族、src/ai/failCharge.ts 的 chargeOnFail / chargeNote、src/studio/segmentGen.ts 的 settleSegment / unwrapFailure；src/studio/canvasAgent.ts、src/studio/agentGrammar.ts、src/studio/cutGrammar.ts、src/data/cutProject.ts 的 applyCutOps / CutReceipt；src/data/videos.ts、danmaku.ts、recipes.ts 的 emit / subscribe；src/api/client.ts 的 emitApiError；src/data/videoDownload.ts 的 DownloadTarget、src/data/economy.ts 的 CardMintCap；src/locales/zh.po / en.po 里同一概念的多个译法
- 严重度：high = 状态转换绕过 store action、错误按文案分流、第二份适配器漏字段（零报错丢数据）；medium = 同一概念多个名字、emit 无人听；low = 可加牌子但当前无事故。
- 口吻：用模式的名字说话：「这是一个没被命名的状态模式」「这个 emit 没有观察者」；每条发现先说意图（intent）再说结构，最后说引入这层间接的代价。
- 检查单：
  - rg -n 'status: "' src/studio src/components src/pages 列出直接给 FlowNode.status 赋值的位置；出现在组件里的即违规（状态转换只经 store action）。
  - tpl 三态：rg 'node\.tpl|n\.tpl' src 的读点是否全部经 tplOfNode；凡让某段有明确 tpl 的动作（套模板 / 摘模板 / addNode / appendNode / appendSpecs）是否都调 pinUnstatedTpl。
  - 墓碑纪律：rg 'firstFrame: \{|lastFrame: \{|poster: \{' src 应为零；Proposal.lost / degraded 是否只在渲染层被读（rg 'degraded|\.lost' 的调用点不应出现在 segmentGen / economy）。
  - 错误类族：rg '/(网络|失败|审核|超时|不可用)/' src 应为零；catch 分支按 instanceof / .code / .status 分叉；rg 'instanceof ArkNoReply' 不应直接作用在 ArkBatchPartial 上（拆壳只在 failCharge / briefArkReason）。
  - 观察者配对：rg 'emit\w*\(' src/data src/api 与 'on\w*\(|subscribe|addEventListener\("api:error"' 配对计数；无监听者的事件（历史上的 emitApiError）要么接上要么删。
  - 命令白名单：canvasAgent 的 AgentProposal 与 cutGrammar 的 op 是否 discriminated union + exhaustive switch；executeAgentProposal / applyCutOps 是否按 node.id / clip id 而非下标、执行时是否重算 nodeCost / proposalsCost 与 clampCursor。
  - 适配器唯一：rg 'views:' src/pages src/components 找第二份卡片映射（WorkshopPage.toLocalShape 那类）；apiToTemplate 之外有没有手写的模板形状重建。
  - 品牌类型候选：rg 'videoUrl: string|durationSec: number|realDurationSec' src/types.ts，评估「方舟临时链接 vs 永久地址」「申报 vs 实测时长」「位置号 vs 段号」是否值得加牌子；至少要求注释互相点名。
  - 单例的主人：下载队列（videoDownload.inFlight）、data/jobs、customCardStore.parked、videoJobs.waiting、templates.registering 在 StrictMode 双挂载与换账号（deviceOwner.ownerEpoch）下的复位规则是否写明并实现。
  - 领域词汇：rg 在 zh.po 里「炼 / 出片 / 生成 / 合成 / 合并」「段 / 片段 / 节点」「档 / 档位 / 模型」各出现在哪些 msgid，列出同一概念多词的清单；en.po 里对应 msgstr 是否也不一致。
  - 策略模式泄漏：rg 'isMock|mock:' src/studio src/pages src/components 的分支数，超过 proposalDone / realVideoOf 这两个边界函数即泄漏。
  - 备忘录：cutStore 快照是否深拷贝、carryOver（导出档位 / 合并留底）不入快照、圈选重拍落地清栈 —— 对照 scripts/check-cut-project.mjs 是否有这三条用例。

### Norman / Cooper 式触屏交互审查员（`norman-interaction`）

- 扎根：The Design of Everyday Things (Revised) — Don Norman；About Face (4th) + Designing for the Digital Age — Cooper / Reimann / Cronin / Noessel；Goodwin
- 管什么：指示（signifier）：375px 触屏上能点的东西不靠 hover 就看得出，灰键旁有原因；反馈合比例：受理回执、进度在动、失败第一句说钱；约束先于报错：顺序门禁 / 档位 / 套餐在 UI 上先画出来；可逆：先做再撤销（Toast 带键）优先于确认卡；确认卡按已知事实说会丢什么；excise：确认框、重复输入、向导里不服务目标的步骤；两面一致：工坊与画布同一段同一状态同一价钱
- 在仓库里看哪儿：src/components/ConfirmDialog.tsx、DeleteConfirmShell.tsx、flow/DiscardFlowDialog.tsx、DeleteCardDialog.tsx、DeleteDeckDialog.tsx 的调用点；src/data/toast.ts / components/Toast.tsx 的撤销键用法；DraftsPage.tsx、ProfilePage.tsx 的删草稿；src/components/flow/ModePicker.tsx、LeadShotsWizard.tsx、GridShotsWizard.tsx、EffectWizard.tsx、DialogueWizard.tsx 的步骤计数与主键文案；src/components/GenerationPill.tsx、src/data/jobs.ts、src/components/flow/SegmentRecoverCards.tsx；src/studio/flowStore.ts 的 clampCursor / appendBlocked / canReplaceNodes；src/data/account.ts 的 tierBlockReason / tierGo；src/data/templates.ts 的 templatePlanIssue；src/components/flow/FlowCanvas.tsx 与 src/studio/ui/projection.tsx、PlanBoard.tsx、PickedActions（同一笔钱两面各算一次的历史）；src/pages/SimpleModePage.tsx、PublishPage.tsx、CutPage.tsx 的主键；docs/ux-review-csci187-2026-10-14.md
- 严重度：high = 花钱 / 丢数据的动作没有预览、没有可逆路径或确认卡说假话；medium = 灰键无原因、进度不动、两面显示不一致；low = 文案与形状的小不一致。
- 口吻：Norman 的问法：「用户站在这一屏能回答『我能做什么、做了没、结果对不对』吗？」；Cooper 的狠劲：把每个确认框当税看，先问能不能换成撤销；只指具体组件，不说「体验不好」。
- 检查单：
  - ConfirmDialog 调用点清单（rg '<ConfirmDialog|DeleteConfirmShell'）逐条标注：可逆？花钱？丢数据？能换成「先做 + Toast 撤销」的列出来（删草稿已改，删段 / 删卡 / 清缓存是否也能）。
  - 灰掉的键：rg 'disabled=' src/components src/pages 抽 20 处，旁边是否有一句「为什么点不动 + 去哪解锁」（tierGo / UpgradeLink / templatePlanIssue）；只有 disabled 的列出。
  - 受理回执：出片、合成、上传、取回、组图五类长活，按下那一拍是否有 toast / 收窗 / 票（startJob）；rg 'startJob\(' 覆盖的 kind 与 CLAUDE.md「长活登记」清单对照。
  - 进度在动：GenerationPill 与票据文案是否含「已等 N 秒 / 步骤 i/N / 约几分钟 / 可以离开」；一动不动的一句话列为 medium。
  - 约束先于报错：clampCursor / tierBlockReason / templatePlanIssue / modeBlock / durationChoices 的调用是否覆盖每个入口（画布页签、工坊铸段窗、货架、详情页、对画布说话确认卡）；点了才被 store 整句拒的入口列出。
  - 两面一致：同一段在 FlowCanvas 与 projection 上显示的状态 / 价钱 / 模板是否读同一函数（nodeCost、tplOfNode、realVideoOfNode、chosenProposal）；rg 'proposalsCost\(' 的调用点是否都由上层算一次传下去。
  - 向导目标：每个向导的每一步写一句「服务于哪个目标」；说不出的（例如重复确认、让人再选一次已选过的档位 / 画幅）列为 excise；状态是否在 store（leadDraftStore / gridDraftStore / effectDraftStore / dialogueDraftStore）退出再进原样还在。
  - 映射：剪辑页缩略图位置编号 vs 「说一句」认的编号、画布「第 N 段」vs 确认卡 nodeId —— 换序 / 删段后再核一遍（cutProject.segRefClip、AgentProposal.nodeId）。
  - 失误 vs 错误：花钱键（bg-brand + 价签）与免费键在形状 / 位置上分得开；rg 'TokenCost|costLabel' 的价签是否挨着它定价的键、单位是否写出。
  - 主权态 vs 临时态：发布页 / 确认卡 / 抽屉是否一屏一事一颗整宽主键；画布 / 剪辑页允许密度但工具是否可折叠。
  - 手势替代：横划切段、两指平移缩放、拖序、圈选、滑杆各有按钮替代（底部节点条、箭头、点轨道）并有一次性说明；列出没有替代的手势。
  - 礼节：记得偏好（上次档位 account.defaultTierId、画幅、音色）；「网络不可用」是否分档说；失败不装没事（rg 'void .*\.catch' src/pages src/components）。

### Krug / Nielsen 式信息架构与文案审查员（`krug-copy-ia`）

- 扎根：Don't Make Me Think, Revisited — Steve Krug；Usability Engineering + 10 Usability Heuristics — Jakob Nielsen
- 管什么：树干测试：任意路由落地 3 秒能答「这是哪、怎么回去、主动作是什么」；去字：提示 / 空态 / 确认卡正文删一半，客套话与行话出清；面向用户的文案里没有内部词（r2v、tier、blockout、proposal、pending、NOT_FOUND）；错误信息三段式：出了什么事、钱花没花、现在能做什么；一致：同一动作一个词、同一控件一种壳（PageHeader / Sheet / ConfirmDialog / EmptyState）；就地帮助：PageHeader 的 ? 插槽与 EmptyState hint 真有内容、双语都有
- 在仓库里看哪儿：src/locales/zh.po、en.po（msgstr 超过 120 字的条目、同一概念多译法、缺译数）；src/components/PageHeader.tsx、EmptyState.tsx、Sheet.tsx、InfoDialog.tsx、InfoTip.tsx、components/guide/；src/ai/failCharge.ts 的 chargeNote 句子、src/studio/cutIssues.ts、src/data/templates.ts 的 retiredNote、src/data/videos.ts 的 uploadFailOf；docs/ui-copy-grammar.md、docs/ux-review-csci187-2026-10-14.md；src/pages/FeedPage.tsx 叠在视频上的元素清单（AigcBadge、RailBtn、进度条、时长、底栏）；src/components/flow/DirectTips.tsx、CustomFrameSlots.tsx 的 fates 说明、ModePicker 的说明段落；src/pages/SettingsPage.tsx、ProfilePage.tsx 的分组标题与页签名
- 严重度：high = 错误信息对钱说错或指向不存在的出口；medium = 内部词裸露、首屏答不出树干测试、同一动作多词；low = 文案冗长或样式回潮。
- 口吻：Krug 的常识口吻：「我停下来想了 —— 这就是问题」；每条发现附删改后的文案样例（中英各一句），不空谈；Nielsen 的产出格式：违反了哪条启发式 + 严重度 + 指到组件。
- 检查单：
  - 树干测试：逐路由（App.tsx 的 Route 列表）只看首屏 3 秒：PageHeader 标题是否说清这是哪、返回键经 useBackOr 回来路、主动作是否整宽在底部；工坊 / 画布 / 剪辑页三张桌子各能一句话说清。
  - 内部词出清：rg -n 'r2v|tier|blockout|proposal|pending|NOT_FOUND|BUSY|token' src/locales/zh.po 的 msgid，列出裸露在界面文案里的；错误码必须翻成人话。
  - 去字：awk 统计 zh.po / en.po 里 msgstr 长度 > 120 字的条目，抽 10 条试删一半再读；客套话（请 / 您 / 我们）与重复主语列出。
  - 错误三段式：抽 15 个 catch 分支的用户文案（segmentGen、flowStore.genNode、CutPage.mergeAndGo、PublishPage、CustomCardPage），核对是否齐「什么事 / 钱 / 能做什么」；钱那段是否只走 ai/failCharge。
  - 一致：rg 'rounded-t-' --glob '*.tsx' | rg -v 'border-t border-slate-700 bg-ink'、rg 'bg-brand' | rg 'rounded-(lg|md)'、rg 'text-\[1[2-9]px\]'、rg 'overflow-x-auto' | rg -v no-scrollbar 四条 CLAUDE.md 查法各跑一遍，列出回潮处。
  - 同一动作一个词：在 zh.po 里数「生成 / 出片 / 炼」「合并 / 合成」「取回 / 领回」「删除 / 删掉 / 移除」各出现次数；en.po 里对应 Generate / Render / Forge 等是否也多头。
  - 就地帮助：PageHeader 右侧 ? 插槽在哪些页有内容（rg 'help=' 或 InfoTip 用法），EmptyState 的 hint 是否说下一步而不是重复标题；双语各有。
  - 噪音：FeedPage 视频层上的 DOM 元素逐个问「删了会怎样」，只有 AigcBadge 是法规要求；其余角标 / 徽标要有理由。
  - 可点一看就能点：非交互芯片 / 徽标是否误用 bg-brand 或胶囊按钮样式（rg 'rounded-full bg-brand' 的非 button 元素）；说明灰字 text-slate-500 与可点灰链接 underline 分得开。
  - H2 自然顺序：向导与铸段窗的步骤顺序是否符合用户心智（先选模型再选做法已拍板）；表单字段顺序与发布流程是否按「先必填后可选」。
  - 「免费」措辞：rg '免费|free' src/locales 列出每处，核对是否真免费（配音「免费 + 限量」要说清限量；语音 / 对话收费处不能写免费）。
  - 便宜测试：本版（2.63）是否有 docs/ux-review-* 条目与三人走查记录；没有的列为流程缺口而非代码缺口。

### WCAG / Material 式无障碍与国际化审查员（`wcag-a11y-i18n`）

- 扎根：Material Design / Android 无障碍指南 + WCAG 2.2（含移动映射注记）；100 Things Every Designer Needs to Know About People (2nd) — Susan Weinschenk
- 管什么：触控目标 ≥ 44×44（IconTapButton）与相邻间距 ≥ 8px；对比度：深色主题 slate-500 / 600 只用于说明；/10 底色上的文字达标；aria-label：图标键有名字、计数不是名字、装饰图标 aria-hidden；不只靠颜色：选中态 / 四种提示色 / 节点状态各带形状或图标；拖拽与手势有单点替代；焦点不被 sticky 层遮挡；Lingui：顶层只放 msg、<Trans> 整句带占位符、relativeTime / formatPlays 按语言分派、en.po 缺译为零；系统字号 130% / 英文长度下按钮芯片不溢出；输入框 inputmode / type / autocomplete
- 在仓库里看哪儿：src/components/IconTapButton.tsx（CloseButton / BackButton）、PageHeader.tsx、TabBar.tsx、FeedPage 的 RailBtn；src/i18n/locale.ts、src/locales/zh.po、en.po、scripts/check-i18n.mjs、scripts/i18n-baseline.json；src/types.ts 的 relativeTime / formatPlays；src/data/cutProject.ts 的 lineUnits / capWords / briefLang；src/pages/LoginPage.tsx 的 input 属性；TagInput.tsx、MentionInput.tsx、DanmakuInput.tsx；src/components/FrameAnnotator.tsx、CutPage 片段条拖序、FlowCanvas 的 pointer 手势、SegSettings 滑杆；src/components/SegmentPlayer.tsx、BranchPlayer.tsx、FeedPage.tsx 的播放器控件；AigcBadge 位置；src/hooks/useOrientationLock.ts、index.html 的 viewport meta
- 严重度：high = 命中区 < 32px 的主要操作、按钮无 aria-label 导致 TalkBack 读不出、英文界面文案拼接错序或溢出截断；medium = 对比度不达标、手势无替代、缺译；low = 装饰图标未 aria-hidden 等。
- 口吻：像无障碍审计报告一样逐条给 WCAG 条款号与 Material 的 dp 数值，「量出来是 32px，标准是 48dp」；对中英两版各截一张图说话，不接受「看起来差不多」。
- 检查单：
  - rg -n 'h-8 w-8|h-7 w-7|h-6 w-6' --glob '*.tsx' src 命中 button / 可点元素的列出（32px 命中区违规）；IconTapButton 覆盖率 = 图标键总数 / 走 IconTapButton 的数。
  - rg -n '<button' src --glob '*.tsx' 找没有文字子节点且无 aria-label 的；RailBtn 的点赞 / 评论是否 name 而非计数；装饰 Icon 是否 aria-hidden。
  - 对比度：取 tailwind 配置里 ink / panel / brand / slate-300 / 400 / 500 / 600 的色值算比值（4.5:1 小字、3:1 大字 / 图标）；rg 'text-slate-500' 用作正文（非 hint / 说明）的列出；视频上的白字是否有阴影或底条。
  - 不只靠颜色：选中态 bg-brand 是否同时 font-semibold 或带勾；amber / rose / sky / emerald 提示条是否各带图标或前缀词；去色截图后节点四态仍可分辨。
  - 手势替代表：列出所有 pointer / touch 手势（横划切段、两指平移缩放、拖序、圈选、滑杆、上下滑切视频）与对应按钮替代；缺的列为 WCAG 2.5.7 违规。
  - 焦点遮挡：键盘弹起时输入框（发布页标题、弹幕输入、画布就地编辑）是否可见；z-50 弹层盖住的错误条是否在弹层内自带一份（PlanSheet / TemplatePicker 已做，其余弹层查）。
  - Lingui 纪律：node scripts/check-i18n.mjs 当前基线数；rg -n '^(const|export const) .*= (t|msg)`' 模块顶层的 t 调用；.tsx 里从 @lingui/core/macro 引 t 的；en.po 缺译（msgstr ""）条数。
  - 语序与拼接：rg '\{relativeTime\(|\{formatPlays\(' src 后面直接接中文的（「3 minutes ago改过」那类）；<Trans> 是否整句带占位符。
  - 英文长度：切 en 后 375px 逐页截图（或 rg en.po 里最长的按钮 msgstr），主键 / 芯片 / 页签不换两行不溢出；ModePicker、TierRow、SegSettings 尤其。
  - 输入框语义：rg -n '<input' src --glob '*.tsx' 列出 type / inputmode / autocomplete；登录页 email / password 的 autocomplete、搜索框 type=search、数字框 inputmode=numeric。
  - 系统设置：viewport meta 是否禁缩放（若禁要说明原因）；useOrientationLock 在首页全屏时能转横屏；系统字号 130% 下主键不截断（模拟器截图）。
  - 媒体：SegmentPlayer / BranchPlayer / FeedPage 控件清单含暂停、静音 / 出声、字幕 / 配音可关；成片无声当面说（hasAudio 三态）；AigcBadge 不遮控件。
  - 工作记忆：向导步骤 ≤ 5 且有进度、ModePicker 每组选项 ≤ 4、确认卡数字 ≤ 3；超过的列出。

### Feathers / Beck 式可测性与回归面审查员（`feathers-testing`）

- 扎根：Working Effectively with Legacy Code — Michael Feathers；Test-Driven Development: By Example — Kent Beck（辅以 Meszaros 的测试坏味道、Fowler 的测试金字塔、How Google Tests Software 的测试分级）
- 管什么：构建期 18 道 check-*.mjs 是本仓唯一自动测试：覆盖面、正反例成对、从源文件 import 真实实现；哪些规则还埋在 store / 组件里（appendIssue、clampCursor、nodeCarry、usableFrames、tierBlockReason）能下沉成可 import 的纯函数；坑表即回归清单：CLAUDE.md「已知的坑」每格对应一条用例；缝（seam）：DEV 钩子 window.__studio / __flow、deps 注入、内存服务端 + 假代理；并发 / 时序规则（genRun 令牌、waiting、canReplaceNodes、取消在每轮开头判）目前零自动保护；中层（IndexedDB / HTTP / store）测试缺位要摆明，装机验证限定高价值路径
- 在仓库里看哪儿：scripts/check-*.mjs 全部 18 个（agent-grammar、cut-project、cut-grammar、camera-vocab、ref-mentions、shot-script、draw-plan、guided-modes、video-tiers、image-tiers、scene-shots、grid-shots、effect-presets、dialogue-shots、slot-ids、i18n、guides、hook-order）的 import 与 assert 工具；package.json 的 build 串、.github/workflows/build.yml、scripts/land.mjs 的门禁段；src/studio/flowStore.ts 导出的 *Issue / *Of / *For 判据与它们的 import；src/data/account.ts 的 tierBlockReason / tierFreeOk / realFaceIssue；src/data/db.ts、boot.ts（idbRead、冻结写）、src/data/videoJobs.ts（waiting / taken）、src/data/jobs.ts；CLAUDE.md「已知的坑」表、「验剪辑页的合并」第 7、8 步（假代理）、memory 的 real-device-testing；android/app/src/test、androidTest（Capacitor 样例）、VideoMergePlugin.java 的 GainAudioProcessor / 时间轴换算；git log -p -- scripts/check-*.mjs src/studio/agentGrammar.ts src/studio/cutGrammar.ts src/data/shotScript.ts
- 严重度：high = 涉及钱 / 丢数据的规则既无脚本也无记录在案的真机验证；medium = 规则可下沉却仍埋在 store、正反例不成对、坑表无对应用例；low = 脚本结构 / 工具重复。
- 口吻：Feathers 的冷静：「没有测试的代码就是遗留代码，写得再好也一样」；每条发现给出「改动点 → 测试点 → 要破除的依赖」三步，先补特征测试再谈重构；Beck 式地把要补的用例写成「输入 → 期望」一行。
- 检查单：
  - 金字塔现状表：底层 = 18 道脚本（列出各自覆盖的模块与用例数）；中层 = 0；顶层 = 手工走查 —— 写进 docs/backlog.md 并指出「最值得补的中层」第一候选（fake-indexeddb 跑 db.ts + boot.ts 的冻结写）。
  - 同源：各 check-*.mjs 顶部 import 是否来自 ../src/data 或 ../src/studio 真实导出，不应出现复制过来的正则常量；check-shot-script / check-draw-plan「从源文件核对调用路径」的例外要有注释说明理由。
  - 正反例成对：抽 check-agent-grammar、check-cut-grammar、check-ref-mentions、check-shot-script 的用例表，统计只有正例没有反例的规则；CLAUDE.md 要求「改一条正则补一正一反」，git log -p 看最近 5 次改正则的提交是否同拍动了脚本。
  - 坑表 ↔ 用例：从「已知的坑」抽 8 格（按申报时长截片段、受控输入 trim、正则字符串常量、承接判定手抄、tpl 三态兜底、hook 在早退之后、两把尺报价、重复键 JSON），rg scripts/ 找对应用例；找不到的列缺口并评估能否补。
  - 可下沉清单：rg 'export function \w+(Issue|Of|For|Blocked|Ok)\(' src/studio/flowStore.ts src/studio/studioStore.ts src/data/account.ts，逐个看函数体是否只读参数 / 纯数据；能搬到零依赖文件让脚本 import 的列出（appendIssue、extendIssue、nodeBlank、nodeRecastable、tierBlockReason、clampCursor）。
  - 缝：rg '^import .* from "\.\./(api|ai|data/db)"' src/studio/*Store.ts 的数量；是否存在 setDeps / __test 钩子；DEV 的 window.__studio / __flow / __deviceOwner 是否在生产包剥掉且在 e2e 构建保留。
  - 时序规则零保护：genRun 令牌只有「我这一炉」才清 busy、videoJobs.waiting 受理置真 finally 解除、canReplaceNodes 在途不许换、CutPage 取消在每轮开头 break、StrictMode mount 标志复位 —— 评估能否用手写 Promise 时序在 node 里钉成 check 脚本；做不到的列为最高风险区。
  - Erratic / Fragile：rg 'Date.now|Math.random|readdirSync|process.env' scripts/check-*.mjs 应为空或有理由；各脚本失败是否 exit 非 0 且输出指向具体输入（Assertion Roulette 检查）。
  - 原生侧：android/app/src/test 只有样例；VideoMergePlugin 里不依赖设备的纯逻辑（GainAudioProcessor 样本乘法、字幕 / 配音绝对秒换算）能否在 JVM 单测；列为提案。
  - 回归验证脚本化：CLAUDE.md「验剪辑页的合并」1–8 步与 memory real-device-testing 里哪些已进 scripts/ 或 design/（prune-app-assets 出包闸、release ④ 公网拉清单），哪些仍靠人（模拟器起停、CDP 写剪辑稿、假代理）；建议把假代理写成 scripts/dev-proxy.mjs。
  - 像用户那样测：冷启动、断网、换账号、从后台回来四种场景在 docs/ux-review-csci187-2026-10-14.md 与坑表「真机」条目里各出现几次；没出现的场景列为未测。
  - assert 工具重复：18 个脚本各带一套 assert / eq / 用例表；提案抽 scripts/lib/check.mjs 并一条命令汇总跑全部（SRE 简单性）。

### Nygard 式可靠性与失败处理审查员（`nygard-reliability`）

- 扎根：Release It! (2nd ed.) — Michael T. Nygard；The Pragmatic Programmer (20th) — Thomas / Hunt（早崩溃、设计契约、不靠巧合）
- 管什么：每个集成点有超时与明确失败模式（API、方舟、媒体事件、IndexedDB open、原生探测）；失败分型靠类型：没收到回包 / 收到但用不上 / 明确被拒 / 受理后上游失败，钱上的话只走 failCharge；长活：受理即落凭据、人不在时谁通知、冷启动接回、取回不再花钱；离线 / 远端半边天：remoteOn 一处判、远端写操作 await + 整句人话、persist() 远端不写；稳态：本机存储有上限或清扫器、重试有退避与上限、无界输入有上限；舱壁与并发：同时只炼一段、合并 BUSY、试听只响一段；崩溃边界（ErrorBoundary 缺位）
- 在仓库里看哪儿：src/api/client.ts（ApiError.code TIMEOUT / NETWORK、withAppVersion）、src/ai/arkClient.ts（chat 120s / chatBounded 170s、ArkTaskUnknown 族、REVISE_TASK / BLOCKOUT_TASK）；src/ai/real.ts 的 withTimeout、src/utils/videoFrames（在 components/videoFrames.ts）、src/data/db.ts 的 OPEN_TIMEOUT_MS、VideoMergePlugin.probeHasAudio；src/ai/failCharge.ts、src/studio/segmentGen.ts 的 settleSegment / SegmentGenFailed / 样片闸、src/ai/real.ts 的 validateGenSpec / describeGenSpec；src/data/videoJobs.ts（rememberVideoJob、waiting、taken、importServerVideoJobs、checkVideoJobCharge）、src/data/jobs.ts、src/components/flow/SegmentRecoverCards.tsx；src/data/videos.ts（remoteOn、pending 队列 ownerKey、flushPending、refreshFeed）、src/data/account.ts（persist 远端闸、fetchMe 退避、authState）；src/data/cacheSweep.ts、drafts.ts 的 MAX_DRAFTS、videoDownload.ts 的 .part / inFlight、src/api/uploads.ts 的 putDirect 分块超时；src/pages/CutPage.tsx 的 mergeAndGo 取消 / 转存轮询 / stillArk、src/studio/flowStore.ts 的 settleNodeMedia / genRun、src/data/boot.ts 两份清单；App.tsx 根、studio/TableScene、导演台 Canvas（ErrorBoundary 有无）
- 严重度：high = 花钱 / 丢数据路径上的静默失败、无超时等待、报价与真扣不同源、取回入口指向不存在的出口；medium = 远端写不 await、存储无上限、重试无退避；low = 降级说得不够清楚。
- 口吻：Nygard 的口吻：每个集成点都是一次事故预演，「这个 await 永远不回来会怎样？」「这一发钱扣了没？」；发现一律写成「触发条件 → 用户看到什么 → 钱 / 数据后果」三段，拒绝「可能有问题」。
- 检查单：
  - 等待点清单：rg -n 'await .*(fetch|load\(|seeked|canplay|loadedmetadata|timeupdate|open\()' src 列出所有等待，逐条核对有上限（withTimeout / AbortSignal / OPEN_TIMEOUT_MS）；无上限的记缺口，并确认客户端超时 > 服务端 150 秒那条（chatBounded）。
  - 失败分型：rg '/(网络|失败|审核|超时|不可用)/' src 应为零；rg 'new Error\(res\.error|new Error\(.*message' src/ai src/studio 找把类型压成字符串的；composeSegments 的 failure 是否原样上抛（SegmentGenFailed）、expired 是否被认成终态。
  - 快速失败在花钱前：每条付费路（segmentGen.generateSegment、real.mintCards、arkClient.runImageGroup、structuredSkills.*、cutAgent、canvasAgent 确认卡）列出「花钱前整句拒」的函数与「报价 = 真扣」的同源函数（economy.*）；缺任一的 high。
  - 钱上的话：rg 'catch' src/pages src/components src/studio 里提到「扣 / 钱 / token / 退」的文案是否全部经 ai/failCharge（chargeOnFail / chargeNote）；自己往钱包镜像加退款的（rg 'wallet.*refund|balance \+') 应为零。
  - 长活三问：对出片 / 组图 / 合并 / 上传 / 铸卡各答「受理即落盘在哪、人不在时谁通知（route）、冷启动怎么接回」；rg 'startJob\(' 的 kind 集合与 CLAUDE.md「长活登记」清单对照，只 console.log 的长活列出。
  - 取回路径真能走：SegmentRecoverCards 在画布 / 工坊 / 创作入口三个宿主各挂一份（rg '<SegmentRecoverCards'）；recoverableVideoJobs 读 waiting 不吓人；取回成功当场存草稿；真人档的凭据是否也能取回（ArkTaskUnknown 配取回路）。
  - 离线 / 远端：rg 'remoteOn\(\)' 的分布只在 videos；rg 'void .*\.catch\(emitApiError\)|void .*\.catch\(' src/data src/api 远端写操作列出（应 await + 回滚 + 整句）；persist() 的远端闸仍在；pending 队列按 ownerKey 跳过不删。
  - 稳态：每种本机存储（drafts.v1、cut.v1、cutbgm: / cutvoice: / merged: 键、videoJobs localStorage、.part 文件、原生 staged 目录、gridGroup.v1）各有上限或 cacheSweep 认它；cacheSweep 读全量事实（allPendingDraftsForSweep）而非界面视图。
  - 自我拒绝攻击：rg -n 'setInterval|while \(true\)|for \(;;\)' src/api src/data src/studio 的每处有退出条件与间隔；fetchMe 五轮退避、转存短轮询可取消、上传分块「90 秒无字节」超时仍在。
  - 无界输入：promptMaxOf、VIDEO_TAG_MAX、上传 100MB、组图张数、输入框 maxLength —— rg '<textarea|<input' 没有 maxLength 的列出；客户端上限 ≤ 服务端（docs/api-contract.md「有意不相等」）。
  - 舱壁：genRun 令牌、合并 BUSY、voicePreview 同时只响一段；多任务在途时钱包只刷一次（rg 'refreshWallet|fetchWallet' 调用点）。
  - 崩溃边界：App 根、TableScene、导演台 Canvas、画布是否各包 ErrorBoundary 并给「重载这一块」出口；useFrame 里的外部状态先校验（camOk 样板）；hook 排在早退之前（check-hook-order.mjs 覆盖 .tsx 全部吗）。
  - 版本兼容：新字段一律判否定（rg '=== "' 对可选字段判肯定的列出）、X-App-Version 只进日志；老服务端 /sign 404 退老路的判据看 Content-Type 不看状态码（serverCaps）。
  - 早崩溃 vs 静默：rg -n 'catch\(\(\) => \[\]\)|catch\(\(\) => null\)|catch\(\(\) => undefined\)|catch \{\}|console\.warn' src 逐条判「有意降级并说出来」还是「静默」；listCards 回 null ≠ [] 的样板是否推广到其它远端拉取。

### OWASP MASVS 式安全与隐私审查员（`owasp-security`）

- 扎根：OWASP MASVS v2 + OWASP Mobile Top 10 (2024)
- 管什么：凭据与本机数据：JWT 在 localStorage、allowBackup=false、IndexedDB 不存密钥、日志不打 token；OAuth / 深链 / QQ 微信原生 SDK：state / redirect 校验、openid 不上客户端、exported Activity 的 intent-filter；输入输出：模型回话 op 白名单、深链参数、下载地址牌子、innerHTML、CSP 按 mode；网络：明文禁、debug 变体单独放行、Cloudinary 签名三道防线；隐私：真人照片 / 声音样本 / EXIF GPS / 权限最小化 / 数据安全表一致；供应链与自更新链：npm audit / Dependabot、SDK 版本钉死、APK sha256 校验、备用源只拼安全字符
- 在仓库里看哪儿：src/api/client.ts（TOKEN_KEY、withAppVersion）、src/api/auth.ts（logout / logoutAllSessions / qqNativeLogin）、src/utils/oauth.ts（oauthStartUrl、state）；android/app/src/main/AndroidManifest.xml、android/app/src/sideload/AndroidManifest.xml、android/app/src/play/AndroidManifest.xml、res/xml/network_security_config.xml、src/debug/res/xml/；android/app/src/main/java/com/ideahub/branchvideo/QQLoginPlugin.java、WeChatPlugin.java、wxapi/、MainActivity.java 的 onActivityResult；sideload 的 AppUpdaterPlugin；vite.config.ts 的 cspFor(mode)；src/studio/canvasAgent.ts、cutGrammar.ts 的白名单；src/data/videoDownload.ts 的 DownloadTarget；src/utils/nativeCamera.ts 的 stripExif；src/data/cardAsset.ts（portrait 绑定）、cardVoice.ts；docs/play-store-checklist.md 数据安全表；android/app/build.gradle（buildTypes、minifyEnabled、productFlavors、签名缺失即失败）、android/variables.gradle、package-lock.json、.github/workflows/build.yml；src/data/appUpdate.ts（UpdateInfo.sha256、githubApkUrl 备用源）、scripts/release.mjs ①②
- 严重度：high = 凭据 / openid / AppKey 泄漏面、exported 组件收任意 intent、模型或深链输入未经白名单直接执行、更新包不校验；medium = 缺审计 / Dependabot、minify 未开、权限表与 manifest 不一致；low = 文档与注释缺失。
- 口吻：按 MASVS 控制项编号说话（MASVS-STORAGE-1、PLATFORM-2、M4），每条给「攻击者怎么利用 → 现有缓解 → 残余风险」；不夸大（localStorage 放 JWT 是已知取舍，有 allowBackup=false 缓解），也不放过「只在注释里说安全」的地方。
- 检查单：
  - M1/M9：rg -n 'console\.(log|warn|error).*(token|Authorization|password)' src 应为零；logout / logoutAllSessions 清 TOKEN_KEY 与按 owner 的本机键；IndexedDB 各库里不存密码 / API key（rg 'apiKey|secret' src/data）；manifest allowBackup=false 仍在且注释说明理由。
  - M3：oauthStartUrl 的 state 生成与回跳校验（OauthCallbackPage.tsx）；深链 ideahub://oauth 的 intent-filter 只收预期 scheme / host；QQ 走 loginServerSide 只传 code，rg 'openid' src 客户端不应上传；AppKey 不在仓里（rg -i 'appkey|app_secret' 全仓）。
  - M8：android 各变体 manifest 里 exported=true 的 Activity（深链回调、tencent${qqAppId}、WXEntryActivity）逐个核对 intent-filter；REQUEST_INSTALL_PACKAGES 只在 src/sideload，play 变体 tools:node=remove 仍在；debug 包 .debug 后缀不共享存储。
  - M4：rg 'dangerouslySetInnerHTML|innerHTML' src 为零或有理由；模型回话只能发白名单 op（discriminated union）、半截 JSON 不办；深链 / navigation state / query 参数进 store 前形状检查；DownloadTarget 裸 string 传不进下载函数。
  - M5：network_security_config 禁明文、debug 变体单独放行 localhost、release 不含 debug xml；API_BASE / SITE_BASE 均 https；cspFor(production) 不放行 localhost、connect-src / img-src / media-src 只列需要的源；Cloudinary 直传签名三道防线（public_id 服务端生成、overwrite:false、allowed_formats）在 docs/api-contract.md 与 src/api/uploads.ts 对得上。
  - M6：真人照片 portrait 只有卡主读得到（服务端）、广场 / 安装不带；声音样本不出本机；nativeCamera.stripExif 剥 GPS；manifest 权限与 docs/play-store-checklist.md 数据安全表一致（无 CAMERA、无不必要的存储权限）。
  - M7：build.gradle release buildType 的 minifyEnabled / shrinkResources 现值；VITE_ASSET_KEY 随包发的事实在 docs 里明说「只防顺手拷贝不防版权」；protected 目录只含自有资产（rin / gratia / tsumire 不入包）。
  - M2 供应链：.github 下无 dependabot.yml / renovate.json、build.yml 无 npm audit —— 提案加 `npm audit --audit-level=high`；android/variables.gradle 与 build.gradle 无 `+` 版本（grep -n '+"'）；腾讯 SDK 6.8.40、media3、billing 升级有核对记录。
  - 自更新链：appUpdate.ts 下载后 sha256 校验失败即删残包不拉安装器；清单经服务端转发；备用源版本号只拼 [\w.-]；release.mjs ① 签名一致 ② versionCode 递增 ⑤b 同 tag 不同内容拒；minVersionCode 只升不降。
  - PLATFORM：Capacitor WebView 未命中路径回 200 + index.html —— 能力判断全部读能力位 / Content-Type（serverCaps.capsOf）；原生插件只认自己目录（VideoMergePlugin staged、Filesystem Directory.Cache）；MainActivity.onActivityResult 对非 QQ requestCode 调 super。
  - 多账号隔离：deviceOwner / ownerEpoch 下，待发布队列、收藏、剪辑稿、凭据各按 owner 分键；换账号时对不上的只跳过不删（videos.pending 样板）。
  - 隐私文案：/child-safety 与 play-store-checklist 承诺的每一句对应代码（拉黑 BlockButton、举报 ReportButton、条款前置 LoginPage）仍存在。

### Humble / Farley 式交付与运维审查员（`humble-delivery`）

- 扎根：Continuous Delivery — Jez Humble / David Farley；Site Reliability Engineering — Google（发布工程、琐事、复盘；辅以 Accelerate 的 DORA 四指标）
- 管什么：流水线三段各一个入口：提交门禁（build.yml）→ 出包闸（prune-app-assets）→ 发布六项核对（release.mjs）；一次构建处处部署：GitHub Release / 镜像 / latest.json sha256 一致、包先落位再发清单；门禁不可绕：land.mjs 无 skip、release.mjs 未知参数即停、main 分支保护；版本可追溯：versionCode 只在 main 涨、tag 与 Release 一一对应、check-published-version 提醒；数据迁移在流水线里：DB_VERSION、迁移分支有老数据用例；琐事清单与自动化进度、应急手册可照做、DORA 四指标能从仓库算出；可观测性：客户端无崩溃上报，三类失败（更新 / IndexedDB 损坏 / 付费失败）至少可对账
- 在仓库里看哪儿：.github/workflows/build.yml、scripts/land.mjs、scripts/release.mjs、scripts/prune-app-assets.mjs、scripts/check-published-version.mjs、scripts/worktree-changes.mjs；package.json scripts（build / build:app / apk / apk:release / aab / release / land）；android/app/build.gradle（versionCode、signingConfigs 缺 keystore 即失败、productFlavors sideload / play）、docs/app-distribution.md、docs/signing-keystore.md；src/data/appUpdate.ts、sideload 的 AppUpdaterPlugin、src/api/appVersion.ts；src/data/db.ts 的 DB_VERSION / pendingDataLoss、src/data/videos.ts 迁移分支、src/data/account.ts V3 清库、docs/local-storage-failure.md；vite.config.ts 的 cspFor 与 .env.example / .env.production / .env.e2e.local 三种 mode；docs/ONBOARDING.md；CLAUDE.md「已知的坑」表（复盘质量）、docs/backlog.md、git tag 与 GitHub Releases
- 严重度：high = 门禁可绕、同版本二次发布可发生、签名 / versionCode / sha256 任一道闸缺失、密钥可能入仓；medium = 文档与脚本不一致、迁移无用例、无可观测性；low = 琐事未自动化。
- 口吻：Humble / Farley 的口吻：「发布应该是无聊的」；每条发现指到具体脚本行与 workflow 步骤名，给出「自动化之后这一步会变成什么」；SRE 式地把手工步骤算成琐事并排优先级，不责怪人。
- 检查单：
  - 流水线对照表：docs/app-distribution.md 的每一步 ↔ package.json / scripts 的实现；「文档里有、脚本里没有」的步骤（出包前 git log -1 对一眼、装完 dumpsys 核对）列为琐事待自动化。
  - 提交门禁：build.yml 跑的是否就是 `npm run build` + `git diff --exit-code src/locales`、timeout-minutes 合理；gh api repos/<owner>/ideahub-app/branches/main/protection 看它是必需检查；land.mjs 合并前跑同一道门且无 --skip 参数。
  - 本地 `time npm run build` 量 tsc + lingui extract + 18 道 check 的总耗时；超过几分钟的脚本列出并评估拆出提交阶段。
  - 一次构建处处部署：release.mjs ⑤⑥ 步把 GitHub Release apk、镜像 apk、latest.json sha256 三者比对；5b「已发过的 tag + 内容不同 = 拒」仍在；镜像先 .part 再改名（#391）。
  - 门禁不可绕：release.mjs parseArgs 对未知参数当场停、从 npm_config_* 捡回 --dry；land.mjs --dry 只检查；assertClean 按内容判并自动刷新 stat（CRLF 假阳性那条坑）。
  - 版本可追溯：git tag -l 'v*' 与 GitHub Releases 一一对应；versionCode 只在 main 涨（git log -p android/app/build.gradle 看是否有分支上涨过的痕迹）；check-published-version 在 workflow 里单独命名为「只提醒」。
  - 密钥与恢复路径：android/keystore/ 与 .env.local 被 gitignore；缺 keystore 时 release 构建失败而非出无签名包（build.gradle 那段）；prune-app-assets 缺 VITE_ASSET_KEY / milltina-opt.glbx 时 exit 1；docs/signing-keystore.md 可照做。
  - 数据迁移：DB_VERSION 每次改动是否有「老数据读回」用例或装老包升级的记录；videos.ts 迁移分支、account.ts V3 清库的截线常量是否有 check；pendingDataLoss 走 DataLossNotice。
  - 配置分离：三种 vite mode（production / e2e / offline）各读哪些 .env.*、CSP 差在哪、哪份入仓 —— 在 CLAUDE.md「真机联调」与 vite.config.ts 注释里是否对得上；新增环境变量是否同时进 .env.example 与出包闸。
  - 回滚 / 前进修复：同一版本号不许二次发布（镜像 immutable）、只能涨版本重发；强制更新 minVersionCode 只升不降且每次理由记在 docs/app-distribution.md（11-24 方舟下线那次）。
  - DORA 四指标：用 git log --merges 与 git tag 时间戳算部署频率、前置时间；变更失败率 = 紧急重发 / 强制更新次数（2.51–2.55 那段）；恢复时间 = release.mjs 从出包到清单上线耗时；写进 docs/backlog.md 的每版发布记录。
  - 可观测性：客户端只有 X-App-Version 进服务端日志；更新失败（appUpdate）、IndexedDB 损坏（db.pendingDataLoss）、付费失败未退（failCharge「可能已扣」档）三类能否从服务端日志或钱包流水对账；没有的列为提案（最小计数上报）。
  - 应急手册：更新链坏了（镜像 404、CF 缓存半截包、GitHub 国内打不开）的处理步骤是否在 docs/app-distribution.md 可照做，而非只埋在 release.mjs / appUpdate.ts 注释（githubApkUrl 备用源）。
  - 复盘质量：抽「已知的坑」近 10 格，核对「症状 / 根因 / 怎么办 / 日期 / 怎么验证修好了」五要素；缺根因或「谁的错」措辞的列出；可自动化的转成 check 脚本。
  - 密闭构建：CI 用 npm ci + package-lock、Node 版本钉死；gradle 依赖无 `+`；腾讯 SDK 升级「逐字节核过」的记录在 memory / docs。

### McConnell / Nygard 式性能量测审查员（`mcconnell-performance`）

- 扎根：Code Complete (2nd ed.) — Steve McConnell（先度量再优化）；Release It! (2nd ed.) — Michael Nygard（稳态、无界结果集、慢响应比失败更糟）
- 管什么：渲染循环：useFrame / rAF 里不抛错、不 setState、不信任外部形状；动画只动 transform / opacity；首页视频流：同时解码的 <video> 数、预加载策略、不可见时不解码、PLAY_MIN_SEC 计数；IndexedDB 大对象：草稿正文带 1MB 级帧、索引与正文分开、读好之后不重读、cacheSweep；包体与资源：prune-app-assets 裁剪、protected 模型 ?v=、Live2D / three 自托管、懒加载边界；视频解码与截帧：Cloudinary 抽帧优先、直连 Range 兜底、1080p HEVC 10bit WebView 解不出；桥上大数据：base64 整条过桥、CDP 读大文件按片、STAGE_CHUNK 512KB；性能改动有度量：帧率 / 时长 / 体积数据与量法，而不是「感觉更顺」
- 在仓库里看哪儿：src/studio/stage/、src/studio/TableScene（useFrame、camOk、toonify 的 customProgramCacheKey）、src/studio/quality.ts（NPC_VER / PLAYER_VER）；src/pages/FeedPage.tsx（<video> 挂载数、muted 解锁、IntersectionObserver、PLAY_MIN_SEC）、src/components/BranchPlayer.tsx、SegmentPlayer.tsx；src/data/drafts.ts（索引 / 正文分离、MAX_DRAFTS）、src/data/db.ts、src/data/boot.ts（readyXxx 读好直接返回）、src/data/cacheSweep.ts、src/data/projects.ts（瘦身画布）；src/ai/real.ts 的 grabViaCloudinary / captureVideoHeadTail / withTimeout、src/components/videoFrames.ts、src/utils/mediaUrl.ts（useMediaUrl forCapture）；src/utils/nativeMerge.ts（STAGE_CHUNK、stageFile）、VideoMergePlugin.java（staged 目录、probeHasAudio 执行器超时）；scripts/prune-app-assets.mjs、vite.config.ts（manualChunks / 懒加载）、public/live2d/、public/models/protected/、index.html；src/components/flow/FlowCanvas.tsx 的 pointermove / reanchor（整体重算）、src/live2d/prefetch.ts；CLAUDE.md「动画只动 transform / opacity」「渲染循环里别信任外部状态」「在看不见的窗口里测」三条
- 严重度：high = 渲染循环可能抛错整页白、首页多条视频同时解码导致可量到的掉帧、桥上整条 base64 的大文件；medium = 动画触发重排、大 chunk 未懒加载、缓存版本未顶；low = 缺度量数据但当前无症状。
- 口吻：McConnell 的「先量再说」：每条发现附一个能跑的量法（DevTools Performance、ffprobe、dist 体积、dumpsys gfxinfo）与预期数字；Nygard 式地把「慢」当成一种失败来写后果；对主人已拍板的取舍（4K 随包、Cloudinary 抽帧）只核对是否仍成立。
- 检查单：
  - 渲染循环：rg -n 'useFrame\(' src 的每个回调里是否有 setState / store set / 未校验的外部坐标（camOk 样板）；抛错一次整页白的风险点列出；toonify 之类改着色器的地方是否都设 customProgramCacheKey。
  - 动画只动合成层：rg -n 'transition-(all|width|height|top|left|margin|padding)|animate-' src --glob '*.tsx' 列出会触发重排的动画，首页 FeedPage 与画布上的优先。
  - 首页同时解码：FeedPage 同时挂载的 <video> 数（前后各一条？）、不可见项是否卸载 src 或 pause；从后台回来 / visibilityState hidden 时是否停解码；PLAY_MIN_SEC 按 currentTime 增量而非墙钟。
  - IndexedDB 大对象：drafts.ts 索引与正文分开、个人页列表只读索引；readyDrafts 等「读好之后不再读一遍」；草稿正文里 data: 帧的体积上限或压缩（utils/image 的缩放窗口）；projects 瘦身画布只含永久 URL（assertClean）。
  - 截帧路径：出片后截帧优先 Cloudinary so_ 抽帧（两张几十 KB），直连 Range 与下载后截只做兜底且带 withTimeout；剪辑页播放直连 https、截帧流后台取；1080p HEVC 10bit 转成 8bit H.264 之前按钮旁照实说。
  - 桥上数据：rg 'base64|toDataURL|readAsDataURL' src/utils src/data 找整条过桥的大对象；本地 BGM 经 STAGE_CHUNK 512KB 切片；拍照 stripExif 重编码的尺寸上限。
  - 包体：npm run build 后 dist 体积与最大 chunk（vite 的 build 报告）；three / pixi / Cubism / lingui 目录是否懒加载（React.lazy / dynamic import 边界：工坊 3D、客服 Live2D、导演台、剪辑页）；prune-app-assets 裁掉了什么、4K 贴图随包的理由。
  - 缓存失效：换 protected 模型 / Live2D 资源是否同步顶 ?v=（TableScene 的 mNN、quality.ts 的 NPC_VER / PLAYER_VER、live2d/prefetch）；Cloudflare 对 APK 的 immutable 缓存与 Vary: Origin 的历史。
  - 画布手势：FlowCanvas pointermove 整体重算 + reanchor 四处共用；滚轮 / 程序化平移不与手势打架；两指缩放是否节流到 rAF 一次。
  - 稳态（性能面）：cutbgm: / cutvoice: / merged: 键与 .part 文件的清扫；原生 staged 目录在合并后清理；videoJobs localStorage 只存地址不存对象（tplRefVideo 只存 url）。
  - 度量纪律：git log --grep='性能\|掉帧\|fps\|耗时' --oneline 看性能型提交是否附帧率 / 时长 / 体积数据与量法；CLAUDE.md 里「量过」的常数（CharacterPerch bottom 系数、captionLayout 28% / 58%、合并约 11 秒）是否仍与代码一致。
  - 测试环境可见性：性能结论是否来自可见窗口（document.visibilityState）；不可见窗口下 rAF 节流、<video> 不解码、smooth scroll 不动三类假故障是否在走查记录里被排除。
  - 慢响应比失败更糟：转存轮询、组图等待（22 分钟上限）、取回查询这几处有没有「等太久就换一种说法 / 给出口」而不是无限转圈；进度文字一直在动。


## 三、每个人格审出了什么（经两种视角反驳核验）

核验规则：每条发现由两个反驳者各判一次 —— 「事实」（打开引用的行核对，拿不准默认反驳）与「价值 / 约定」（是否撞主人已拍板的决定、改了得到什么）；**两个都判成立才留**。12 个人格共报 89 条，留 72 条。

### Sommerville 式需求与范围审查员

> 整体看，这个仓库的需求可追溯性在同类产品里算高的：四项大功能（跟着做、模板体系、节点对齐、剪辑指挥层）每份设计文档都有「主人拍板」与「落地记录」两节，付费验证普遍带花费 / 日期 / 模型 / 结论，CLAUDE.md 点名的 14 个判定函数（tierBlockReason、refSlotsOf、framesToDraw、projectRecipe、canReplaceNodes、extendIssue…）全部仍在且注释日期未漂，选法屏「只摆做出来的做法」由 check-guided-modes.mjs 实跑覆盖，能力位探测（serverCaps.capsOf）与契约 :2136 列的七位逐一对应。缺口集中在两类：一是定价 / 法规这种「横切」需求没有享受功能需求那套三件套（定价只有数字没有理由，隐式标识只有注释没有方案），二是上线之后的回收——文档和代码里写着「上线前跑一发核」「还欠」「要主人定」的条目，在 2.62 发版后没有一个被改成「已核 / 已定」，契约也没跟上 extend / 高清 r2v。系统性模式是：验证在开发构建上闭环、正式路径靠「发版后看一眼服务端日志」兜底，但没有一个「发版后结案」的步骤把这些待核项收回来，于是每一轮验证都留下一小截永远开着的尾巴，账单核对尤其如此（480p、14/15 两处都涉及实扣）。支线规模上，3D 工坊 32.5k 行、Live2D 客服 8.6k、启梦老师 1.7k、诗绘 4.5k（独立工程）对比四条主路径页面约 5k 行，App.tsx:13-51 把全部 36 页静态 import，vendor-3d 只在 node_modules 层拆块；在 Capacitor 包里这只影响冷启动解析时间而非下载，没量过就不列为发现。

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✓ | 中 | **sommerville-requirements-1** 480p 单价与高清 r2v 系数已随 2.62 上线，代码注释仍写「还没对过账单 / 上线前跑一发核」 | `src/data/videoTierTable.ts:34` | 事实✓ 核到 src/data/videoTierTable.ts:34「还没对过一张 480p 的真账单 —— 上线前跑一发核」与 :104「⚠ 还没对过账单」原样在；economy.ts:164 明说「系数的出处与账单核对记录也搬过去了，两仓对账就对那一张表」，即这张表就是记核对的地方，而同文件 :97 ULTRA_R2V_MULT 的「✅ 对过真账单」是仓库自己的记法；git log --since=2026-10-08 对 videoTierTable.ts 与 canvas-platforms 文档均无提交；docs/api-contract.md:2596-2598 甚至还写着 2.0-mini 含视频输入档「未入表…没核过的价不进表」，与 :107/:237 已入表相反。10-07~08 的付费验证只对了用量（帧数）与 App 报价 = 服务端实扣，没对方舟的千 token 单价。；价值✓ 证据属实且与仓库自己的约 |
| ✓ | 中 | **sommerville-requirements-2** api-contract 的 r2v 规则仍写「只有两条来源、model 首发只有 2.5、omni_reference_task_type 必须是 edit」，与 App 2.62 已发的 reference / extend 与高清 r2v 不同步 | `docs/api-contract.md:2299` | 事实✓ api-contract.md:2286 标题「只有两条合法来源」、:2296「首发只有 Seedance 2.5 = 2.8」、:2299「必须是 edit」原样在；git show --stat 81498f1（30 个文件）与 53cd68c（14 个文件）都没动 api-contract.md，该文件此后的提交（ab362af、5fb6605…）与 r2v 无关；AGENTS.md:139 写明它是「三仓共享的契约，改了要通知另外两仓」；:2596-2598 仍说 2.0-mini 含视频输入档「未入表」，与 videoTierTable.ts:107/:237 矛盾；CLAUDE.md:589 记 server#107 认「本人自己的成片」已于 10-05 上线。；价值✓ 契约漂移比 auditor 说的还重，而且是内部自相矛盾。docs/api-contract.md:2286「只有两条合法来源」、:2296 |
| ✓ | 中 | **sommerville-requirements-3** 第一批（特效同款 / 对话正反打 / 修这一段）的端到端付费验证只走了开发构建直连方舟，正式路径（服务端结算 / 转存）发版后无结案记录；对话正反打的已知缺陷「要主人定」仍悬着 | `docs/canvas-platforms-ecosystem-research.md:344` | 事实✓ canvas-platforms-ecosystem-research.md:339「⚠ 这次没走到的」与 :344-347 四条「还欠」原样在；该文件最后一次改动是 a93c96f（2026-10-06），2.62 于 10-08 发版（support-knowledge-base.md:14），此后无提交触及；docs 里关于正式包真重拍 / 真延长看服务端日志的只有 :341/:346 这两句本身，没有结案；「过肩」在 docs 只出现在 :154 与 :347，没有拍板记录；DialogueWizard.tsx:508、:532 两句说明确实没有人数提醒，唯一的缓解是提示词侧 dialogueShots.ts:200「画面里只有这两个人，每个人只出现一次」，而文档自己记了这句在付费验证里没压住。；价值✓ 事实成立但一半是重复、一半要降格。docs/canvas-platforms-ecosystem-resear |
| ✗ | 中 | **sommerville-requirements-4** 2026-10-07 定价 / 免费档改版（新人 170,000 + 每天 2,000、套餐额度、草稿档、失败退回）在仓库里只有契约数字和一句「主人拍板」，没有方案与理由的文档 | `docs/api-contract.md:2684` | 事实✗ 事实本身成立（api-contract.md:2684-2685 只有数、CLAUDE.md:184 只写「主人拍板」、27 份入库文档里没有 pricing-*.md），但仓库里查不到理由是有意的：gh repo view 显示 ideahub-app 是 PUBLIC，10-07 的定价调研连同毛利 / 回本分析被刻意放在私密文件夹（会话记忆 pricing-research-2026-10：「没进仓库：三个仓库都是 PUBLIC，定价与毛利放私密文件夹」）。建议把「刊例依据、备选、回本」整理进公开仓的 docs/pricing-research-2026-10.md，正是当时决定不做的事。用户能看到的那一半（额度能出几段片）已在 support-knowledge-base.md:250-259 写了。；价值✗ 建议本身撞到一条已记录的决定。三个仓库都是 PUBLIC（gh repo view ideahub-ap |
| ✗ | 中 | **sommerville-requirements-5** 隐式 AIGC 标识（《标识办法》第五条「应当」）在已上线的导出 / 转存文件里为零，代码与 backlog 都只写「需服务端做」，没有方案、排期与拍板记录 | `src/data/aigcLabel.ts:46` | 事实✗ 引用的行都在（aigcLabel.ts:46-50、backlog.md:1037、:1085-1090），但「没有方案、排期与拍板记录」三条里两条不成立：拍板有 —— videoDownload.ts:62-73 与 backlog:1085-1086 记着 2026-09-07 主人拍板 filename-only；方案与归属有 —— backlog:1087-1090 定了「服务端转存那一步」并点名存量回填，要写的字段在 aigcLabel.ts:47（Label / ContentProducer / ProduceID）；对外口径也守住了（agreements.tsx:10、support-knowledge-base.md:810/:940 不许说已实现）。backlog.md:3-4 的章程恰是「已经决定要做、但这一轮不做 / 做之前必须先定的前置」，这条已按仓库惯例登记；实现本身在服务端仓，本仓做不了更多 |
| ✗ | 低 | **sommerville-requirements-6** ux-review 的 21 条「没改、留给主人定的」没有任何一条带状态（做 / 不做 / 等拍板）与归宿 | `docs/ux-review-csci187-2026-10-14.md:60` | 事实✗ ux-review-csci187-2026-10-14.md:60 的节标题「四、没改、留给主人定的」本身就是这 21 条的状态（= 等拍板）；该文档由分支头提交 1f05034 在 2026-10-14 21:12 建立，主人还没看过。仓库惯例（12 份文档，如 guided-modes-design.md:181/:359「等主人定」、node-modes-libtv-alignment.md:416「没做的 / 等主人定的」，主人答复后另加 :146「## 五、主人拍板」一节）就是待定项留在设计文档里；backlog.md:3-4 章程写明只记「已经决定要做」的事、「想法 / 调研放各自的 design doc」，把 21 条未决项并进 backlog 反而违反 backlog 自己的规则。；价值✗ 教材洁癖，而且是自证式的：docs/review-personas-2026-10.md:290 就是这位审查员的 |
| ✓ | 低 | **sommerville-requirements-7** backlog.md 仍把「出片凭据搬到服务端」列为待做（要先改跨仓契约），而 2026-09-06 服务端受理即登记 + App importServerVideoJobs 已经落地 | `docs/backlog.md:1047` | 事实✓ backlog.md:1047-1049「只活在这一台设备…要做得先改跨仓契约」与 videoJobs.ts:22-24（2026-09-06 起服务端 ArkVideoTask 受理即登记）、:612 importServerVideoJobs 对不上；该函数在正式路径上被调（SegmentRecoverCards.tsx:300，:613 只在 API_BASE + token 即远端模式下生效，CutPage.tsx:1329 也引用）；backlog.md:4 自己规定「已完成的从这里删」。:1037「浏览器写不了 webm 元数据」说的是 09-07 已退役的 MediaRecorder 路径（CLAUDE.md「这一整套录屏实现已经退役」，合并现在是原生 mp4）。；价值✓ backlog 过期是真的，但 auditor 给的替换文本本身是错的，照抄会把一个没解决的问题写成已解决。docs/backlog.m |
| ✓ | 低 | **sommerville-requirements-8** MAX_DRAFTS = 20 有理由（IndexedDB 配额）但没有量法：一条草稿多大、配额多少、为什么是 20，注释里都没有数 | `src/data/drafts.ts:113` | 事实✓ drafts.ts:110-113 的注释只有「几 MB 到几十 MB」「配额」两个没量过的词，20 无出处；同仓 db.ts:16-21（OPEN_TIMEOUT_MS 中位 0.2ms）与 uploads.ts:470-477（CHUNK_STALL_MS 真机 30~40KB/s）都带量法；淘汰在 drafts.ts:314-318 直接 idbDel、无提示（projects.ts:7-8 原话）。仓库内对草稿体积的说法还互相矛盾（CLAUDE.md:644/:647 说「1MB 级」，drafts.ts:110 说「几 MB 到几十 MB」），印证没量过；而 db.ts:220 已经在调 navigator.storage.estimate() 给设置页用，配额在 App 里本来就量得到。；价值✓ 前一半（量出来写在常量旁）成立且与约定同向，后一半（改淘汰规则）要降成提案。src/data/drafts.ts: |

### Uncle Bob 式依赖方向与单一真相审查员

> 先画箭头：data → store → 组件 这条主干今天是对的——src/data 没有一条 import 指向 studio / pages / components，flowStore 的 import 列表里没有 studioStore，11 个零依赖规则模块只 `import type` 自 types，types.ts 以外的 store 也没有反向依赖；主人拍板的分层没人在违反。问题集中在两个边缘：① 边界外观被绕——/api/tts 有三份 HTTP 实现、openExternal 被一处抄回、Capacitor 原语与 IndexedDB 键铸造漏进 CutPage，这些都是「某一页自己拼一次」而不是「谁改了方向」；② 已收口的唯一实现在收口之后又长回来（"mock:" 三处、ownerKey 一处、界面语言 9 处内联），而 types.ts 作为 113 个文件的公共依赖把 Lingui 运行时带给了所有人。系统性模式是：这个仓库靠「★ 注释 + CLAUDE.md」记住收口，靠 18 道 check-*.mjs 守住纯函数的行为，却没有一道脚本守住 import 方向与「某个字符串 / 判据只许出现在一处」——于是每一次收口都是一次性的，回潮零报错；第 8 条那个门禁脚本是把这些发现变成一次性修复而不是周期性修复的最便宜办法。

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✓ | 高 | **martin-architecture-1** /api/tts 的 HTTP 契约有三份实现：api 层那份带「回的是不是音频」守卫，页面与 studio 的两份没有 | `src/pages/SettingsVoicePage.tsx:67` | 事实✓ 核对属实：`src/api/support.ts:213-225` 的 synthesizeSpeech 在 res.ok 之后查 content-type 以 audio/ 开头；`src/pages/SettingsVoicePage.tsx:65-84`（fetch 在 :67）与 `src/studio/speech.ts:272-292` 各自手拼 getToken + withAppVersion + fetch(`${API_BASE}/api/tts`)，各按 404/501/401/403 判「没有云端嗓子」、都没有 content-type 守卫；两条都是正式包用户会走的路（设置页试听、工坊铸卡师开口）。`src/api/stream.ts:29` 的 throwHttp 只抛带 status 的 ApiError、没有 401 清 token 之类的副作用，所以改调 synthesizeSpeech |
| ✓ | 中 | **martin-architecture-2** utils/openExternal 自称「唯一实现、别再各抄一遍那个 if」，VolcCompatToggle.openHere 正是抄的那个 if | `src/components/VolcCompatToggle.tsx:111` | 事实✓ 核对属实：`src/utils/openExternal.ts:1-14` 头注写明「唯一实现 … 别再各抄一遍那个 if」并把 window.open 回 null 统一成 throw；`src/components/VolcCompatToggle.tsx:111-123` 的 openHere 正是那个 if 的第二份（网页分支不看 window.open 返回值，原生分支同样 Browser.open），git log 显示它写于 2026-09-30（d72f877），比 09-29 的收口晚一天；VolcCompatToggle 是三个真人卡宿主（CustomCardPage / CardDetailPage / VideoCardAnnotator）共用的正式功能。；价值✓ 核实成立。`src/utils/openExternal.ts:1-14` 收口于 2026-09-29（7361da3），文件头明写 |
| ✓ | 中 | **martin-architecture-3** videos.ts 私有的 ownerKey() 是 deviceOwner() 的第二份实现（ownerKey 这条正交轴有两处判定） | `src/data/videos.ts:313` | 事实✓ 核对属实：`src/data/videos.ts:313-316` ownerKey() = currentUser()?.id 或 ""，文件内 20 处调用；`src/data/deviceOwner.ts:49-53` deviceOwner() 是同一条规则加 DEV 顶替位，文件头自称「唯一实现（铁律六）」。videos.ts:26 已经 import deviceOwner 的 mayClaimLegacy，deviceOwner.ts 全文不 import videos，删 ownerKey 改调 deviceOwner 不会成环。；价值✓ 核实：`src/data/videos.ts:313-316` 的 `ownerKey()` 与 `src/data/deviceOwner.ts:49-53` 的 `deviceOwner()` 正式包里逐字等价，20 处调用（`grep ownerKey()` 计  |
| ✓ | 中 | **martin-architecture-4** 「能不能播」的 !startsWith("mock:") 在 2026-08-21 收口之后又长回了三处 | `src/studio/studioStore.ts:2439` | 事实✓ 核对属实：`src/studio/studioStore.ts:2439` `video && !video.startsWith("mock:")`（video = nodeVideo(n)，与 flowStore.ts:672-675 的 realVideoOfNode 逐字同义，而 studioStore.ts:12 已从 flowStore import nodeVideo）、`:2432` 对 alts 的 videoByProposal 同一句、`src/studio/flowStore.ts:4484` prevReal 又一句；flowStore.ts:665-668 的注释与 CLAUDE.md 都记着 2026-08-21 已收口到 realVideoOfNode / realVideoOf（studioStore.ts:131-133）。；价值✓ 核实成立但价值低。视频地址上的内联判据确有三处：`s |
| ✗ | 中 | **martin-architecture-5** types.ts（113 个文件的公共依赖）import 了 Lingui 运行时与宏，并自己再判一次界面语言 | `src/types.ts:2` | 事实✗ 行号属实（types.ts:2-3 import @lingui/core 与 macro；:1809 / :1830 两处 i18n.locale === "en"；113 个文件 import types；switch.ts:21-23 有 activeLang），但这是主人记在案的决定而非漂移：CLAUDE.md 明文把 `types.relativeTime` / `types.formatPlays` 定为「只有一份、按界面语言分派」的唯一实现，Lingui 约定又规定「模块顶层只准放 msg 描述符」——types.ts 12 处 i18n._ 都在 getter 里、零顶层翻译，check-i18n.mjs 守着这一条；src/i18n/* 不 import 应用里任何模块、@lingui/core 在 main.tsx 激活语言时早于 App 加载，「稳定依赖」在这里没有成环或加载顺序的实害。CLAUDE |
| ✗ | 低 | **martin-architecture-6** CutPage 直接调 Capacitor.convertFileSrc 与 idbSet，并自己拼 merged: 键前缀——而 nativeMerge 与 cacheSweep 各管着同一件事的另一半 | `src/pages/CutPage.tsx:1719` | 事实✗ 行号属实（CutPage.tsx:98 import Capacitor、:1713 mergedFileToBlob、:1714-1715 铸 merged: 键 + idbSet、:1719 convertFileSrc；nativeMerge.ts:214；cacheSweep.ts:45；cutNarration.ts:226），但「页面里不该出现存储原语」不是本仓约定：CardDetailPage / CustomCardPage / CutPage 三个页面都直接 import idbSet/idbGet；「键的两半分在两处」也是 cacheSweep.ts:38-44 头注记录的既定模式——cutbgm: 在 CutPage.tsx:893 铸、cutvoice: 在 cutNarration.ts:226 铸、merged: 在 CutPage 铸，扫的一侧逐条点名了产出方，merged: 不是例外；Ca |
| ✗ | 中 | **martin-architecture-7** 工坊工程的留存把 flowStore 的整份内部形状原样送上服务端，取回时 as 一下就铺进工坊——配方那条路是白名单，这条不是 | `src/hooks/useFlowActions.ts:199` | 事实✗ 行号属实（useFlowActions.ts:197-208 整份 flow 状态进 captureCanvas；projects.ts:560-568 assertClean 只扫本机地址；:871-872 只查 nodes.length），但形状是有意的：projects.ts:55-70 的 CanvasSnapshot 注明「字段与 flowStore 同名状态一一对应 … 与 drafts.FlowSnapshot 同一种写法、同一个理由」，drafts.ts:40-46 的草稿正本就是同样的整棵 unknown[] 节点树——回炉是按打开草稿的方式重开工程，草稿需要的每一个 FlowNode 字段工程都需要。推荐的白名单投影恰恰是 CLAUDE.md「服务端给实体加了字段，本机库那几跳必须一起搬」那格记的「逐字段重建 → 少写一行零症状」的陷阱：reviewer 自己列的字段表已经漏掉回炉今天在用的 stag |
| ✓ | 低 | **martin-architecture-8** 构建串里没有 import 方向门禁：三条分层铁律今天只靠 CLAUDE.md 与肉眼 | `package.json:8` | 事实✓ 核对属实：package.json:8 的 build 串跑 18 道 check-*.mjs（scripts/ 下 19 个，check-published-version 归发版），全是纯函数正反例、hook 顺序、i18n 棘轮；仓根没有任何 eslint 配置，也没有 no-restricted-imports 一类的 import 门禁。机械核对三条铁律当前确实干净（src/data 无 ../studio／pages／components／hooks 的值 import；flowStore.ts 只在 :8 注释里提到 studioStore；src/studio 不 import pages/components），而第 4 条 "mock:" 判据在 08-21 收口后回潮三处，说明只写在文档里挡不住。；价值✓ 值得做但要降级成单独的提案 PR，并把规则收窄。事实：`package.json:8` 的 b |

### McConnell 式构建质量审查员

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✓ | 高 | **mcconnell-construction-1** 画布「推演三套」价签是 deriveCostOf 的第二份手抄实现 | `src/components/flow/FlowCanvas.tsx:1171` | 事实✓ 核到 FlowCanvas.tsx:1169-1171 与 2101-2102/2176 各手写一遍 `chosenOf(prev) → !!(node.chain && prevP?.lastFrame) → proposalsCost(...)`，与 flowStore.ts:1124-1129 的 deriveCostOf 逐字相同；1115-1121 的 ★★ 把它钉成「UI 上那个数与 deriveProposals 真扣的钱都问它」、2713 真扣确实读它，projection.tsx:1519/1562 已改问它而画布没改。画布是正式包的主路径，没有别处守住这条分叉。；价值✓ 核实：FlowCanvas.tsx:1169-1171、:2101-2102 与 :2176、FlowPage.tsx:382/386 各自手写 `carried = !!(node.chain && prevP?.lastFrame |
| ✗ | 中 | **mcconnell-construction-2** genNode 一函数 543 行：18 道门禁、4 种报价、受理落盘、写回、结局分型全挤在一起 | `src/studio/flowStore.ts:3907` | 事实✓ 核到 genNode 从 flowStore.ts:3907 到 4452 的 `},`（546 行），try（4095）之前 18 个 `return false`、函数内 23 次 `set(`、请求字面量 4111-4168、凭据字面量 4183-4220、catch 按 ArkTaskUnknown（4328）/ SegmentGenFailed（4376）/ ArkTaskFailed（4413-4425）分三档，都如所说；这是正式包每一段出片的必经路，没有别的分层替它收过。；价值✗ 事实核实无误：genNode 跨 flowStore.ts:3907-4452，try（4095）之前恰好 18 个 `return false`，catch 里按 ArkTaskUnknown / SegmentGenFailed / ArkTaskFailed 分档。但按「改了之后谁得到什么」算，这条推荐在本仓是净负的：① * |
| ✓ | 中 | **mcconnell-construction-3** mergeAndGo 502 行、14 个 await，同一段「已取消」收尾逐字抄了 4 份 | `src/pages/CutPage.tsx:1388` | 事实✓ 核到 CutPage.tsx:1388-1889（502 行）内 14 个 await、8 次 say、10 次 setErr、12 次 warns.push、7 个裸 return，取消收尾块在 1513-1517、1565-1569、1670-1674、1705-1709 逐字相同；这是剪辑页「合成并去发布」的正式路径。；价值✓ 核实：mergeAndGo 跨 CutPage.tsx:1388-1889；`if (cancelRef.current) { setBusy(""); setErr(t`已取消合并…`); return; }` 在 1513-1517、1565-1569、1670-1674、1705-1709 逐字相同，catch 里 1856 又写了第五遍同一句话。四份收成一个 bailCancelled() 符合铁律六，且与 CLAUDE.md「取消要在每一轮开头判」那格不冲突 —— 收的是**块的内 |
| ✓ | 中 | **mcconnell-construction-4** mergeAndGo 的 ★★ 注释与 docstring 仍在描述 2026-09-07 已撤掉的 MediaRecorder 录屏 | `src/pages/CutPage.tsx:1387` | 事实✓ 核到 CutPage.tsx:1387 docstring 写「重编码成单条 webm（混入音频轨）」、1389-1392 把防重入理由写成「两条 MediaRecorder 实时录同一块画布、两条 AudioContext 解同一条音轨」、630-634 写「合并那边仍然走 AudioContext 混轨」「几十秒的实时录制」；而同函数 1531-1536 自己写着录屏 2026-09-07 整条撤掉，全文件 MediaRecorder／AudioContext／captureStream 只命中注释行（633、1390、1531、1533、1730）。CLAUDE.md 也明说「代码里已经没有 MediaRecorder 了，别照着去找」。；价值✓ 核实：CutPage.tsx:1387 docstring 写「重编码成单条 webm（混入音频轨）」，1389-1392 把防重入的理由写成「两条 MediaRecor |
| ✓ | 中 | **mcconnell-construction-5** refreshRemoteTemplate 用 7 段手写块重做 apiToTemplate 已经做过的字段解析 | `src/data/templates.ts:1217` | 事实✓ 核到 templates.ts:1225-1291 的 mine 分支确有七段手写块（published 1228、roles 1235-1239、markSlots 1247-1251、markBoxes+markBoxAtSec 1253-1259、markDescs 1265-1269、realDurationSec 1280-1284、category 1287-1290），各自重跑 apiToTemplate（496-551）已经跑过的 rolesOf/markSlotsOf/markBoxesOf/markDescsOf/refRealSecKey；adoptRemoteTemplate 2702-2703 已改成 `const mapped = apiToTemplate(api)`。2695-2698 的 ★★ 自己承认两份「迟早有一处漏搬一位」。；价值✓ 核实：refreshRemoteTemplate |
| ✓ | 中 | **mcconnell-construction-6** 组稿与取回仍各自手写 !startsWith("mock:")，绕过已宣称唯一实现的 realVideoOfNode / realVideoOf | `src/studio/studioStore.ts:2439` | 事实✓ 核到 studioStore.ts:2432 `if (v && !v.startsWith("mock:"))`、2439 `nodeVideo(n)` 后紧跟 `!video.startsWith("mock:")`（正是 flowStore.ts:672-675 realVideoOfNode 的函数体），flowStore.ts:4484 takeJob 又一份；667-669 的 ★★ 把 realVideoOfNode 钉成唯一实现、670 还点名 studioStore 的 realVideoOf 是 Proposal 形状的另一条路。组稿（finalizeInner）与取回都是正式路径，发布体的 videoByProposal 正从 2432/2439 出来。；价值✓ 核实：studioStore.ts:2432 `if (v && !v.startsWith("mock:"))`、2438-2439 ` |
| ✓ | 低 | **mcconnell-construction-7** 素材栏「{n}/20 张」把 EDITOR_SLOTS_MAX 的 20 又手写了一份，导出常量的注释自己点名了这条欠账 | `src/studio/ui/projection.tsx:923` | 事实✓ 核到 projection.tsx:923 `<Trans>{slotCards.length}/20 张 · 同类型可多张</Trans>` 的 20 是字面量；studioStore.ts:922-927 导出 EDITOR_SLOTS_MAX = 20，924-926 的 ⚠ 点名的正是这一行；全仓 EDITOR_SLOTS_MAX 只被 studioStore 1528/1529/1542 读。铸段窗素材栏是工坊正式路径。；价值✓ 核实：projection.tsx:923 `<Trans>{slotCards.length}/20 张 · 同类型可多张</Trans>` 的 20 是字面量；studioStore.ts:922-927 导出 EDITOR_SLOTS_MAX = 20，⚠ 原话就点名这一行是「第三份手写的 20」，并说「收它要改那条 msgid（归 projection.tsx 那份 PR）」— |
| ✓ | 低 | **mcconnell-construction-8** 五处 ★★ 注释的日期停在「2026-09-XX」，Card.tags 没有与 VideoItem.tags 互相点名 | `src/studio/flowStore.ts:4097` | 事实✓ grep 核到五处 `2026-09-XX`（flowStore.ts:1396、4097；segmentGen.ts:872、1004；TierRow.tsx:61）；types.ts:818 `tags?: string[]` 一行注释都没有，而 1354-1361 VideoItem.tags 只单向点名；FlowCanvas.tsx:1168 仍写「与线性视图同一把尺」。只改注释，无运行时影响。；价值✓ 核实：flowStore.ts:1396、:4097，segmentGen.ts:872、:1004，TierRow.tsx:61 五处「2026-09-XX」属实；`git log -S'2026-09-XX'` 显示它们全部来自同一个提交 1fe109c7（2026-09-03「backlog §2.11 那五条落地」），所以填法是一个已知日期而不是五次考古，docs/backlog.md 也在，§2.11  |

### GoF 式领域模型与状态机审查员

> 整体看这是一份纪律罕见地好的领域模型：墓碑一处不违（三条 grep 为零）、错误分流全部按类型（关键词正则为零）、画布指挥与剪辑台两套命令都是封闭联合 + 认 id + 执行前重算价签与顺序门禁、tpl 三态在每条整表换 nodes 的入口都钉住、Observer 除了走查已列的 api:error 之外每个 emit 都有人听。系统性的模式是：单字段规则都收成了「唯一实现」，但**跨几个字段的复合转换**（换档 = 档位 + 时长 + 示例视频；重拍 = 帧 + 协议 + 计价；地址 = 主机表 + 永久性）仍在调用点现拼——根子是 flowStore 暴露了一个 `updateNode(id, Partial<FlowNode>)` 万能写口，它让任何组件都能拼出一次没有名字的转换，而 `regenSegment` 这类早于 GenSpec 契约出生的函数没被收编进命令对象。建议的顺序：先堵万能写口（#1，顺带把 tierSwitchLoss 搬出组件），再把重拍收进契约（#2，要主人点头一次付费验证），词表（#3）与域名表（#4）各自一次收口即可。

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✗ | 中 | **gof-domain-model-1** 「换档」是一个没被命名的状态转换：门禁只活在 TierRow 的 disabled 里，落地在两个组件各抄一份 | `src/components/flow/TierRow.tsx:120` | 事实✗ TierRow.tsx:109–126 的 apply（:116 摘示例视频、:120 updateNode、:123 clampDuration）、:138–148 的 disabled 判定、tierSwitchLoss :30 全仓零其它引用、FlowCanvas.tsx:430–435 加段路那份、store 里没有 setNodeTier，逐行核对属实；但 TierRow 文件头就宣告它是「两处共用的唯一实现」，两个宿主（SegSettings.tsx:141、projection.tsx:1390）都只挂它，FlowCanvas 那份是对 addNode 刚造的空白段（没有 customRef / 素材 / 帧可损失）只抄了 3 行时长吸附并注释回指，档位本身在 ModePicker.tsx:108–113 已按 tierBlockReason 灰掉，canvasAgent 对画质「本地档不办、只指路」（ag |
| ✓ | 中 | **gof-domain-model-2** 剪辑页圈选重拍是 GenSpec 契约之外的第四条出片路：首尾帧协议直发，付过钱的尾帧改图在 flf:false 的档上被静默丢掉 | `src/ai/real.ts:2763` | 事实✓ real.ts:2757–2763 regenSegment 直接 generateVideo、lastFrameUrl 只在 tier.flf 时传，全仓 validateGenSpec 只在 :3397 调；CutPage.tsx:1313–1314 后半段圈选先付费改 seg.lastFrame、:1337 按 annRedrawCost(list.length) 实扣；videoTierTable.ts:229（fast，freeOk:true、11-24 前仍在售）与 :275（real）flf:false；arkClient.ts:1574 无 refImages 即 'frames' 模式 ⇒ hd / ultra 上重拍走 first_frame/last_frame 而主路走参考图。核对属实：极速档上圈在后半段，图钱扣了、改好的尾帧不发、零提示。；价值✓ 证据核实：real.ts:2740-2771 r |
| ✓ | 中 | **gof-domain-model-3** 同一件事两个名字：剪辑页把「把片段合成一条成片」同时叫「合成」和「合并」，英文译成三个词，「合成」又兼指配音合成 | `src/pages/CutPage.tsx:1675` | 事实✓ CutPage.tsx:1429「合成成片」、:1675「合成中…」、:2003「合成并去发布」、:2198「合成中——」与 :1515/:1672「已取消合并」、:2159「取消合并」、:1874「合并失败：」、:2228「回到合并之前」、:2694「配音合成中…」逐行属实；en.po 9673「合成中…」→ Composing…、9681 → Merge & go to publish、9243 → Cancel merge，9418 / 4244「节点」两译也属实；ux-review §四 17 列的是工坊 / 生成键 / 工作流 / 人物卡 / 做同款五组，不含这一组，不算重复。；价值✓ 证据核实：同一个动作在 CutPage.tsx 里两个词并用 —— :1429「合成成片」、:1675「合成中…」、:2003「合成并去发布」、:2198「合成中——」对 :1515 / :1672「已取消合并」、:2159「取 |
| ✗ | 中 | **gof-domain-model-4** 「方舟临时链接 vs 永久地址」靠四条各自手写的域名正则分类，名单已经不相等 | `src/ai/arkClient.ts:118` | 事实✗ 四条正则的行号与内容属实（arkClient.ts:118、publishAssets.ts:25、projects.ts:434、recipe.ts:114），名单确实不等；但它们答的不是同一个问题：arkClient.ts:112–113 自己写明 isArkAssetUrl 是服务端 videoAsset.service 域名表的镜像、只判「要不要转存 / 自救」、判错只多打或少打一次转存请求；另三处镜像的是服务端 zod 不变量（api-contract.md:428–432 只认 volces.com/ 与 volccdn.com/，projects.ts:434 注明「逐字同源」），且 projects.isLocalAsset（:27、:441）已复用 publishAssets.isPermanentUrl —— 实际是两份名单各对一份服务端契约，不是四处各写各的。客户端把不变量放宽到服务端不认的域名反而 |
| ✓ | 低 | **gof-domain-model-5** Strategy 的秘密泄漏："mock:" 占位串的判据在两个边界函数之外又长出 5 处，其中 studioStore 的一处逐字重抄了「唯一实现」 | `src/studio/studioStore.ts:2439` | 事实✓ studioStore.ts:2432 与 :2439 逐字抄了 flowStore.ts:672–675 realVideoOfNode（:667–669 的注释明说收口前两面就是这么分叉的）、flowStore.ts:4484 prevReal 再抄一份、flowStore.ts:3654 与 FuseFrameSheet.tsx:53 把判据套在卡面 / 帧地址上，而全仓只有 flowStore.ts:4292/:4299 往 videoUrl / videoByProposal 写 'mock:'，核对属实；CLAUDE.md 把「能不能播」钉在 realVideoOfNode 一处，这几处是对自家唯一实现纪律的回潮。；价值✓ 证据核实：flowStore.ts:662-675 realVideoOfNode 自称唯一实现（注释：studioStore.realVideoOf 收 Proposal、形状不同另算一 |
| ✗ | 低 | **gof-domain-model-6** 备忘录的「哪几格不归快照管」规则（carryOver）长在 store 里，构建里的纯函数检查够不着它 | `src/studio/cutStore.ts:53` | 事实✗ cutStore.ts:53–58 carryOver、check-cut-project.mjs 对 resId / merged 跨撤销保持没有用例（grep 只有 :181 setRes 与 :195–202 markMerged / unmarkMerged）、clearHistory 只在 CutPage.tsx:488 / :1354 调用，核对属实；但 CLAUDE.md「剪辑页的时间轴是一份剪辑工程」第 ④ 条明文把这条规则安在 cutStore.carryOver（「导出档位与合并留底不归快照管」），data/cutProject = 改法纯函数、studio/cutStore = 带撤销栈的运行时是记在案的分工，5 行函数也没有可指出的错 —— 搬去 data 层加两条用例是重构提案，不是缺陷或未决事项。；价值✓ 证据核实：cutStore.ts:49-58 carryOver 把撤销回来的快照的 r |
| ✓ | 低 | **gof-domain-model-7** 墓碑旗 `Proposal.degraded` 的类型注释还在描述一条 2026-09-10 已删的路，而它实际已在 usableFrames 里当判据用 | `src/types.ts:1002` | 事实✓ types.ts:1002 注释仍写「帧是本地占位图（合成前会先重画真帧）」，而 real.ts:2036–2043 记着占位图 2026-09-10 已改成留空串、那条重画分支是已删的死码，flowStore.ts:791 usableFrames 又拿 `degraded && firstFrame && lastFrame` 当老数据占位图的识别判据 —— 同一字段三种说法，类型注释确已过期，核对属实。；价值✓ 证据核实：types.ts:1002-1003 写「帧是本地占位图（合成前会先重画真帧）」；real.ts:2037-2044 写帧现在留空串、那条重画分支是死码已删、「degraded，只管渲染」；flowStore.ts:782 / 789-796 usableFrames 却拿 degraded && firstFrame && lastFrame 当老草稿占位图的识别判据，flowStore.ts: |

### Norman / Cooper 式触屏交互审查员

> 整体看，凡是长在全局 store 与 data 层上的动作（出片、合成、取回、组图、删草稿），这个仓库已经把 Norman / Cooper 要的东西做齐了：受理即收窗 + 轻提示、票据与「回去看看」、门禁在 store 一处、确认卡按已知事实说话、删草稿先做再撤销。短板集中在动作落在组件 useState 或旁路 Promise 上的那些地方：技能面板的付费回话、注册时的昵称 PUT、上传型票据的静态一句话、画布上永远亮着的「＋ 加一段」—— 这些要么零反馈、要么点了才被拒，而同一件事在另一面（工坊卡位、updateProfile 的修法、剪辑页转存的「已等 N 秒」）早有正确样板。系统性模式是「铁律六的唯一实现守住了钱与门禁，但『反馈 / 可逆』没有被当成同一条铁律来收口」：建议把「长活必须领票且进度要动」「一拍就成的删除走撤销而不是确认」「两面同一起点」写成与报价同级的查法（`rg startJob` 对照 `await .*chat`、`rg ConfirmDialog` 逐条标可逆性），下一轮才不会在新的面板上再长出同样的四种形状。

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✓ | 高 | **norman-interaction-1** 「剧本 → 分镜」「按主题改写」两张付费技能面板：结果只活在组件 state 里，点一下遮罩就把花了钱的回话丢掉，也没登记进后台任务 | `src/components/flow/ScriptSkillSheet.tsx:82` | 事实✓ 核对属实：ScriptSkillSheet.tsx:33-35 plan/step/busy 全是 useState，:47 await runScriptToShots（structuredSkills.ts:95 超时 170 秒、:207-208 请求成功即 spendTokens，远端由服务端按调用收费），:82 遮罩 onClick={onClose}、:93 CloseButton 都不判 busy；FlowCanvas.tsx:2483-2491 的 onClose 直接 setScriptSkill(false) 卸载面板，回包落在已卸载的组件上；ThemeRewriteSheet.tsx:72 同形（runThemeRewrite :420-421 每发扣一次）。全仓 startJob 的 kind 清单（rg）里没有任何 skill 类票据。ux-review 文档未列此项。；价值✓ 证据全部核实：S |
| ✓ | 中 | **norman-interaction-2** 画布「＋ 加一段」永远亮着：末段没出片 / 末段是白模段时点了才被 addNode 整句拒，而工坊那一面的虚线卡位早就按同一判据不亮了 | `src/components/flow/FlowCanvas.tsx:807` | 事实✓ 行号属实：FlowCanvas.tsx:805-810 点击时才问 appendIssue 再交给 addNode 拒（flowStore.ts:3073-3083 写 err），:794-795 注释明写「这里不重判」；同一块 :828-832 的「完成视频」却按「不摆灰按钮、只说还差几段」处理；studioStore.ts:193-199 placeholderVisible 用同一个 appendBlocked + proposalDone 把工坊卡位直接隐掉。两面对同一状态确实给了两种指示。；价值✓ 证据核实：FlowCanvas.tsx:794-795 注释明说「这里不重判，点了被拒就由上面那条错误条说话」，:805-810 点击后才问 appendIssue；studioStore.ts:193-199 的 placeholderVisible 问的是同一个 appendBlocked + proposalD |
| ✓ | 中 | **norman-interaction-3** 工坊铸段窗每开一次新段都把出片模型退回套餐默认档，画幅却继承上一段；画布「＋ 加一段」则停在上一段的档 —— 同一动作两面两个起点 | `src/studio/studioStore.ts:916` | 事实✓ 属实：studioStore.ts:916 freshEditor 返回 aspect 继承 prev、videoTier: defaultTierId()；openPlaceholder :1391 每开一次新段都 freshEditor([])，projection.tsx:471-472 的 ModePicker 读的正是 editor.videoTier；而画布 FlowCanvas.tsx:812 与 flowStore.addNode :3091 都是 usableTierId(prev?.videoTier)。:915 注释担心的「免费用户停在点不动的会员档」在 usableTierId（account.ts:1173-1186，先过 tierBlockReason）里已经处理，所以不构成保留 defaultTierId 的理由。；价值✓ 证据核实：studioStore.ts:916 freshEdito |
| ✓ | 中 | **norman-interaction-4** 选法屏「自选卡片」卡上的「推演 X」按 `proposalsCost(false)` 报，第 2 段起真正的报价（承接上段尾帧、只画尾帧）是它的一半 —— 同一笔钱两把尺 | `src/components/flow/ModePicker.tsx:177` | 事实✓ 行号属实：ModePicker.tsx:177 写 proposalsCost(false) 且没有「约」；flowStore.ts:1124-1128 deriveCostOf = proposalsCost(!!(node.chain && prev?.lastFrame))，newFlowNode :920 缺省 chain: i > 0，economy.ts:1443-1445 有开头帧时图量减半。接在已出片段后面加段时，选法屏的数与方案台真扣的数确实不同。；价值✓ 证据核实：ModePicker.tsx:177 写死 proposalsCost(false)；唯一实现 deriveCostOf（flowStore.ts:1124-1129）按 !!(node.chain && prev?.lastFrame) 算、新段缺省 chain: i > 0 / !!prev（:920 / :3089）；economy. |
| ✓ | 中 | **norman-interaction-5** 「🗑 删除本段」：没花过钱的段一点就没、没有撤销；花过钱的段也只有 3 秒的二次点按 —— 删草稿已经改成「先删再撤销」，删段没有跟上 | `src/components/flow/DeleteSegBtn.tsx:40` | 事实✓ 属实：DeleteSegBtn.tsx:40-44 只有 done ／／ derived 才二次点按（3 秒），其余一拍 onConfirm；flowStore.removeNode :3744-3754 直接 filter 掉节点并 delete alts[id]，rg 全仓无 segTrash / restoreSeg；DraftSheet.tsx:36-47 删草稿已改成 trashDraft + 6 秒「撤销」。ux-review 第 15 条说的是卡片放大层的「删掉这张」，不是删段。这是与 10-14 已落地方向一致的提案，不与主人明文决定冲突（08-21 定的是「花过钱的段要点两下」，撤销可以兼容它）。；价值✓ 证据核实：DeleteSegBtn.tsx:40-47 只对 done ／／ derived 做 3 秒二次点按，其余一拍 onConfirm；flowStore.ts:3744-3754 remov |
| ✓ | 中 | **norman-interaction-6** 邮箱注册填的昵称：PUT 失败只 `emitApiError`（全 app 没人听），屏幕上照样显示新昵称，下次冷启动悄悄退回用户名 | `src/data/account.ts:2866` | 事实✓ 属实：account.ts:2864-2867 registerWithEmailOtp 把 local.name 改成 nick 后 void updateProfile().catch(emitApiError)，api/client.ts:108-116 的 emitApiError 只 console.warn + dispatch，rg 全仓 API_ERROR_EVENT 只有定义 :54 与派发 :115、零监听；:431-436 注释自己写明远端 persist() 不落盘、这一发 PUT 是唯一真相。LoginPage.tsx:209-215 真的把 displayName 传进来，而昵称输入框 :339-345 没有 maxLength，服务端 400 也会被吞。；价值✓ 证据核实：account.ts:2836-2839 与 :2864-2868 两处都是 local.name = nick 后 v |
| ✗ | 低 | **norman-interaction-7** 两张纯「税」确认卡：「清理缓存」自己声明不会动任何用户东西却还要再点一次；「重看所有新手引导」是一个随手可逆的开关也走确认卡 | `src/pages/SettingsStoragePage.tsx:226` | 事实✗ 两张卡都有明文理由、且都不是能撤销的动作。「清理缓存」真跑的是 cacheSweep.ts:207-210 对 IndexedDB 逐键 idbDel，不可逆；删哪些靠 collectReferenced（:87）的启发式引用收集，:183 的「*」守卫与 :181 的 blocked 正是因为它误删过（CLAUDE.md 记过「清理缓存把待传成片的唯一磁盘指针删了」那次事故），对不可逆的启发式删除先问一句符合本仓「确认走 ConfirmDialog」的约定，Goodwin 的「撤销优于确认」在这里无法落地（没有可撤销的实现）。「重看新手引导」SettingsPage.tsx:361-365 注释明写说明文案只在确认小窗里说、一年点不了几次，是主人认过的取舍；建议里的「撤销 = 重新 markGuidesSeen」也不是真逆操作（把全部标成已看，而之前未必每屏都看过）。属于口味级 excise，不算缺陷。；价值✗ 两张卡 |
| ✓ | 中 | **norman-interaction-8** 几条分钟级上传长活的票据只有一句不动的话：Live2D「发布模型」600 秒上传全程「正在发布…」、铸卡上传「存卡并把图传到服务器…」从不 update | `src/studio/live2dUploadStore.ts:609` | 事实✓ 票据静止属实：live2dUploadStore.ts:609 startJob 后 :612-628 整个 try 块没有一次 job.update；api/uploads.ts:59-65 postMultipart 没有进度回调；CustomCardPage.tsx:1121-1126 的 card-mint 票从 :1121 到 :1245 也没有 job.update（:729/:746 那两处属于 :705 的 card-ai 票），而 :1119 自己写着远端要串行传几张图、弱网几十秒。；价值✓ 证据核实：live2dUploadStore.ts:609-611 只在 startJob 时写一句「正在发布…」，try 块里零次 job.update（文件里唯一的 update 在识别步 :468）；createLive2dModel 两条路都是 600 秒上限（companion.ts:394-396 mu |

### Krug / Nielsen 式信息架构与文案审查员

> 整体状况：钱上的话已经收得很干净 —— 我打开的每一处 catch（flowStore 2946 / 3717、CustomCardPage 804 / 851 / 872 / 922 / 1090、SegmentRecoverCards）都先过 ai/failCharge，只有 chargeNote 回 null 才说「没扣钱」，三段式里最要命的「钱」那一段没有找到说错的；CLAUDE.md 四条查法只剩 MaterialSheet 一行回潮，en.po 缺译 0，ConfirmDialog 正文（EditPage 735、PublishPage 855）都是按事实说的短句；私有词汇、「这台服务器 / 方舟」漏出、e.message 原样拼进界面这三大块 docs/ux-review-csci187-2026-10-14.md 已列（#16 / #17 / #18 / #20），这里不重复。系统性模式只有一个：**同一件事在同一条流程的两端叫两个名字** —— 2.63 把剪辑页主键改成「合成并去发布」、把轻提示改成「已删掉」，却把另一端（取消 / 失败 / 确认卡 / 画布上的删段键）留在旧词上；目录里 合并 19 / 合成 97、删除 57 / 删掉 108 就是这么来的，建议在 scripts/check-i18n.mjs 里加一条「一个源文件同时含有 合并+合成 / 删除+删掉 / 取回+领回 就拦」的棘轮，比靠人记得住便宜。另外两件只记不报：① flowStore 2062 / 2139 / 2234 与 segmentGen 1377 的「白模（r2v）」「方舟档」（英文 "Blockout templates only render on Ark tiers … r2v"）今天在正式包里走不到（电影级 blockoutOk 为真、blockoutIssue 在更早一道门就拒了），是目录债不是现场事故，下次清文案一并收；② 本版（2.63）有 docs/ux-review-csci187-2026-10-14.md 与三份只读审计记录，「便宜测试」这一条流程上不缺口，只是那份清单里 21 条待定还等主人逐条拍板。

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✓ | 中 | **krug-copy-ia-1** 剪辑页同一件事两个名字：主键叫「合成」，取消 / 失败 / 回执叫「合并」 | `src/pages/CutPage.tsx:2159` | 事实✓ 六处逐行核对无误：CutPage.tsx:1429 任务票 t`合成成片`、1675 say(t`合成中…`)、2003「合成并去发布」，对着 1515 / 1672 两处 t`已取消合并。…`、1874 t`合并失败：${raw}`、2159 <Trans>取消合并</Trans>；en.po 9243/9651/9673/9681/9685 也是 Cancel merge / Merge failed / Composing… / Merge & go to publish / Merge video 混着。2003 行注释写明是 10-14 UX 课只改了主键，另一端没跟着改；CLAUDE.md 与 docs/ux-review-csci187 都没有钉定哪个词，不算已解决，也不与 #17 列出的那几组重复。剪辑页是正式包必经之路。；价值✓ 六处引文全部核实：src/pages/CutPage.tsx:1429「合 |
| ✓ | 中 | **krug-copy-ia-2** 删卡那条路上键说「删除」、确认卡说「删掉」；删段三处各一个词 | `src/pages/CardDetailPage.tsx:1012` | 事实✓ 行号属实：CardDetailPage.tsx:1012「删除这张卡」（owned 才画，正式路径）→ DeleteCardDialog.tsx:54 danger={t`删掉这张卡`}；DeleteSegBtn.tsx:60「🗑 删除本段」、CutPage.tsx:2422「🗑 删除片段」、canvasAgent.ts:108「🗑 删掉某段」。zh.po 按行数 删掉 220 / 删除 119（msgid+msgstr 各一份，折成条目约 110 / 60，与所说 108 / 57 相符）。仓里没有任何约定或 ★ 注释钉死用哪个词，ux-review #17 列的是工坊 / 生成键名 / 工作流等几组，不含这一组。只是严重度偏高：删掉 / 删除是同义口语与书面之差。；价值✓ 流程内的词不一致是真的：CardDetailPage.tsx:1012 键「删除这张卡」→ DeleteCardDialog.tsx:53- |
| ✓ | 中 | **krug-copy-ia-3** 个人页「还没传到服务器」横幅把工程诊断原样念给用户：请求体上限、网关兜到静态页 | `src/data/videos.ts:2568` | 事实✓ videos.ts:2564 bad-shape「服务器没有正常返回这条作品（多半是服务器地址配错了，或网关把请求兜到了静态页）」、2568 network「上传被拒（作品体积较大，可能是服务器的请求体上限）」属实，经 pendingErrorText（2585）在 ProfilePage.tsx:1231 取出、1239 行接在标题后画出；两句括号里确是开发者才看得懂的诊断，ux-review #20 的清单（方舟 / 火山 / 这台服务器 / HTTP 码 / e.message）没点到这两句。但「现在能做什么一个字没有」不成立：同一横幅 ProfilePage.tsx:1246-1248 紧接着写「内容还在这台设备上，没有丢。修好网络或服务器后点重试即可。」，1250 行起就是「立即重试」键。；价值✓ 两句引文核实（src/data/videos.ts:2564-2566「服务器没有正常返回这条作品（多半是服务器地 |
| ✓ | 中 | **krug-copy-ia-4** 一键成片面板写「现在免费」却不说每天限量，剪辑页同一件事旁边说了 | `src/components/cut/AutoEditSheet.tsx:253` | 事实✓ AutoEditSheet.tsx:253「用完就配音（{voiceName}，现在免费）」只在 typeof voiceFree === "number" 时画却不印数字；CutPage.tsx:2783「🔊 给 N 句配音（现在免费）」旁 2798 行「配音免费，每个账号每天 {voiceFree} 字」；cutNarration.ts:169「今天的免费配音用完了」—— 四处属实，面板上确实不提限量。但证据里的机理错了：voiceFree 不是「今天剩下的字数」，CutPage:260 setVoiceFree(cat.freeDaily)，cutNarration:74-75 freeDaily = narrationFree.dailyChars，是每天的上限；余量只在被拒之后从回包 details 的 limit/used 算（cutNarration:158-160）。「现在」也是有意的：cutNarra |
| ✓ | 低 | **krug-copy-ia-5** 素材抽屉的横轨漏了 no-scrollbar，空态也绕开了 EmptyState | `src/components/MaterialSheet.tsx:178` | 事实✓ MaterialSheet.tsx:178 rail 是 `grid … grid-flow-col … overflow-x-auto pb-1 pr-1`，没有 no-scrollbar；全仓 `overflow-x-auto` 不带 no-scrollbar 的另两处（TemplateShelf.tsx:632、DiscoverPage.tsx:250）都是注释，正是 CLAUDE.md 那条查法说「只该剩注释」的唯一代码回潮。180-186 行空态手拼 flex flex-col items-center gap-2 py-7 + <a href="#/workshop"> 胶囊，违反「空态走 EmptyState（弹层里用 compact）」。MaterialSheet 由 FlowPage.tsx:35 引入、1502 行挂载，/flow 是简约与白模挂卡的正式路径，不是死码。；价值✓ 一半是假阳性：`rai |
| ✗ | 低 | **krug-copy-ia-6** 制作过程页封面上「模板市场 · 工作流」是实底品牌色胶囊，看着像能点去市场，其实点哪都是去看成片 | `src/pages/RecipePage.tsx:196` | 事实✗ 行号属实（RecipePage.tsx:194 bg-black/60「示例视频 · 看成片」、196 / 213 bg-brand「模板市场 · 工作流」压在去 /video/:id 的 Link 上；VoiceMarket.tsx:252、SupportModelsPage.tsx:279、SupportPersonasPage.tsx:320「使用中」同款），但不算问题：「使用中」是「这一个是当前选中的」状态记号，CLAUDE.md 规定选中态一律 bg-brand font-semibold text-ink，用同一副面孔表达同一语义是合约定而非违约定；CLAUDE.md 的徽标那条只定内边距、并明说徽标是另一种控件。RecipePage 两枚徽标两种壳是刻意突出「已上架」，而整块的可供性是中央的播放圈（190-192）。品牌色同时当主键 / 选中态引出的「视线先落哪」张力，docs/ux-review-csci |
| ✗ | 低 | **krug-copy-ia-7** 最快的首次上手路「写一句话出片」是创作屏里唯一没有「?」的一页 | `src/pages/SimpleModePage.tsx:111` | 事实✗ 事实核对无误：SimpleModePage.tsx:111 title 写一句话出片，right 插槽只有「第 N / 3 步」（112-116），文件内 HelpButton / InfoTip / tour 零命中；tours.tsx 共 21 条（176-1420）没有 simple。但建议补的三句引导页内已经各有一句就地写着：第 1 步 187「想怎么开始？」+ 两块砖各带说明（193-204），第 2 步 336「想拍什么？」，第 3 步 400「确认一下就出片」+ 481「可以离开这一页，出片好了会在顶上提醒你」（10-14 刚补的）；创作入口的 create 引导（tours.tsx:254-284）也交代了简约是「一步一屏的向导」。一步一屏、每屏一个问题的向导本来就不该再靠「?」，缺的只是与别页的形式一致，发现本身也标了 fixNow=false。；价值✗ 事实层面：SimpleModePage.tsx: |

### WCAG / Material 式无障碍与国际化审查员

> 整体状况：国际化是这份代码最扎实的一面 —— check-i18n 基线 enMissing 0、en.po 6013 条只有文件头一条空 msgstr、`<html lang>` 随语言切（i18n/activate.ts:19）、`{relativeTime()}改过` 都包在 `<Trans>` 里且英文 msgstr 真的换了语序（en.po:912「edited {2}」）、模块顶层零 t 调用、登录页 autocomplete / inputMode / one-time-code 齐全、Icon 一律 aria-hidden、IconTapButton / HelpButton / TabBar（min-h 44）把常规图标键收到了 44px、剪辑页拖序有 ◀▶ 替代、FrameAnnotator 圈选属 2.5.7「essential」豁免、ModePicker 每组 2 / 4 / 2 个选项都 ≤4。系统性模式：凡是不用原生 `<button>` / `<input>` 而是自绘的控件 —— div 进度条（首页、SegmentPlayer）、div 抽屉与确认卡、span 轻提示、用 `filled` 画的切换态、裸 range 滑杆 —— ARIA 角色 / 状态 / 播报就一处都没有（全仓 aria-live 零命中、role="dialog" 只有 2 个文件、aria-pressed 12 个文件），PageHeader / Sheet / Toast 的注释量的全是 px，没有一条量 TalkBack 怎么读，说明「读屏」从来不在组件壳的规格里，补法也应该补在那几个壳上而不是逐页打补丁。两件没列为发现但要记一笔：index.html:8 的 `user-scalable=no` 在 APK 里被 Capacitor 默认的 zoomEnabled=false 盖住、系统字号缩放（WebView textZoom）照常生效，所以不算 1.4.4 违规（只在浏览器 / PWA 路径成立）；四色提示条多数没带图标（RoleConfirmSheet 等）但信息都在文字里，1.4.1 不成立，只是 BlockoutTrimmer 带 ⚠ / ✗ / ✓ 的写法更稳；对比度那条（#6）撞的是 CLAUDE.md 钉死的字色约定，列为提案请主人改口径，不建议逐处绕开约定。

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✓ | 高 | **wcag-a11y-i18n-1** 成片播放器的大播放键没有可读名字，进度条是一块裸 div | `src/components/SegmentPlayer.tsx:152` | 事实✓ 核对 src/components/SegmentPlayer.tsx：152–162 行的大播放键里只有 <Icon name="play" …/>（Icon.tsx:164 把 svg 写成 aria-hidden="true"），button 上没有 aria-label；216–223 行进度条是 <div className="-my-2 py-2" onClick={seek}> 包一条 h-1.5 的 div，无 role / tabIndex / 键盘，命中区 6 + 2×8 = 22px；225–240 行播放/暂停键 `-m-2 p-2` + 20px 图标 = 36px。组件在正式路径上：PublishPage.tsx:428 与 VideoPage.tsx:490（非分支作品）。docs/ux-review 第 12 条只泛说「28 颗图标键没有读屏名」，没点到这个组件，进度条的滑杆语义更没提过。 |
| ✓ | 高 | **wcag-a11y-i18n-2** 首页进度条能点中的只剩 14px，且不是滑杆控件 | `src/pages/FeedPage.tsx:608` | 事实✓ FeedPage.tsx:600 容器 bottom = calc(var(--tabbar-h) - 0.375rem)，index.css:30 的 --tabbar-h = 3.5rem + safe-area ⇒ 容器底沿离屏幕底 50px；606–613 行触控盒 `relative mx-2 h-5 touch-none` 是 div + onPointerDown（scrubStart :238，:241 setPointerCapture），无 role="slider" / tabIndex / aria-value* / 键盘。TabBar.tsx:70 nav `fixed inset-x-0 bottom-0 z-40`、:78 h-14，没有 pointer-events-none；FeedPage 的 <section>（:488）没有 z-index，进度条 z-20 落在底栏 z-40 之 |
| ✓ | 中 | **wcag-a11y-i18n-3** 轻提示（含删草稿后唯一的「撤销」键）没有 live region，读屏一个字听不到 | `src/components/Toast.tsx:13` | 事实✓ Toast.tsx:9 `if (!t) return null`、:11–26 外层 div 与 span 都没有 role / aria-live；对 src 整仓 grep aria-live／role="status"／role="alert" 零命中。data/toast.ts:31 默认 1800ms；DraftSheet.tsx:40 `showToast(t`已删掉…`, 6000, { label: t`撤销` … })` 是删草稿后唯一的拿回入口（drafts 注释 :24–31 明说没有回收站）。ux-review 只记了这颗键的加入，没有从读屏角度评过。；价值✓ Toast.tsx:9 `if (!t) return null`、:13-26 的 span 无 role / aria-live，data/toast.ts 是全 app 唯一总线（41 处 showToast）；DraftSheet |
| ✓ | 中 | **wcag-a11y-i18n-4** 抽屉 / 确认卡 / 说明卡四个壳都不是对话框：无 role、不挪焦点、无 Escape、背景可穿 | `src/components/Sheet.tsx:12` | 事实✓ 四个壳逐一打开：Sheet.tsx:12–18、ConfirmDialog.tsx:33–37、InfoDialog.tsx:23–27、DeleteConfirmShell.tsx:39–43 都是 `fixed inset-0 … bg-black/60` + 内层 div，没有 role="dialog" / aria-modal / aria-labelledby；在 src/components 下 grep Escape／inert／.focus() 只命中 DraftTitle:74、MentionInput:218 与几处输入框自动聚焦，四个壳里一处都没有。role="dialog" 全仓只在 GuideOverlay.tsx:233 与 PhotoSubjectPicker.tsx:252。四个壳的调用点 grep 共 39 处 / 22 个文件，与所报 16/14/7 量级相符。；价值✓ Sheet. |
| ✓ | 中 | **wcag-a11y-i18n-5** 工作流画布的缩放只有两指捏合与滚轮，没有单指 / 按钮替代 | `src/components/flow/FlowCanvas.tsx:331` | 事实✓ FlowCanvas.tsx 里对 scale 的写入只有两处：302–311 行两指捏合（:308 算 k、:309 写 scale: k）与 351–366 行 onWheel（:361）；:511 panTo 保留 scale，:394 注释明写「不动 scale」。在该文件 grep 放大／缩小／zoom／复位 没有任何按钮。手机上没有滚轮，缩放就只剩双指，WCAG 2.5.1 的单指替代不存在。；价值✓ 核实 FlowCanvas.tsx：scale 只在 :309（捏合）与 :361（滚轮）两处写入，没有任何缩放按钮；CutPage.tsx:2403-2415 的 ◀▶ 替代确实存在。recommendation 正确遵守了 CLAUDE.md「手势进行中被别的东西改了视图」那格坑（:314-319 reanchor 的 ★★、:356-365 onWheel「只 setView 会被手势那条路当场抹掉」）， |
| ✓ | 中 | **wcag-a11y-i18n-6** slate-600（2.50:1）与 slate-500（3.98:1）被当正文 / 提示 / 占位用，小字不达标 | `src/components/EmptyState.tsx:74` | 事实✓ EmptyState.tsx:74 补充行 `text-xs leading-relaxed text-slate-600`；tailwind.config.js:7–8 ink #0b1020 / panel #111a33；按相对亮度重算：slate-600 #475569 对 ink 2.50:1、slate-500 #64748b 对 ink 3.98:1，与所报一致。CommentDelete.tsx:84 `text-[10px] text-slate-600`、LoginPage.tsx:617 `text-[11px] … text-slate-600`、PageHeader.tsx:61 副标题 `text-[11px] … text-slate-500`、TabBar.tsx:89 非首页未选中页签 `text-slate-500`（10px）都如所说。不过这正是 CLAUDE.md 钉死的字色刻度（ |
| ✓ | 中 | **wcag-a11y-i18n-7** 剪辑页播放头、配乐音量、设置页语速三条滑杆没有名字 | `src/pages/CutPage.tsx:2110` | 事实✓ CutPage.tsx:2110–2118 全局播放头 <input type="range"> 没有 aria-label，外面也没有 <label>；:2876 「音量」是裸 <span>，:2877–2891 那条 range 同样无名；SettingsVoicePage.tsx:140 「语速」在 span 里，:145–157 的 range 无 aria-label。对照写法也核了：AvatarPicker.tsx:304 `aria-label={t`缩放`}`、components/blockout/VisionFramePicker.tsx:200 带 aria-label、studio/stage/StageOverlay.tsx:423 与 :439 用 <label> 包住。三条都在正式路径（剪辑页、设置→声音）。；价值✓ CutPage.tsx:2110-2118（全局播放头）、:2877-28 |
| ✓ | 中 | **wcag-a11y-i18n-8** 首页点赞 / 收藏是切换键，状态只靠图标填色，读屏读不出「已点过」 | `src/pages/FeedPage.tsx:125` | 事实✓ FeedPage.tsx:122–139 RailBtn 的 <button aria-label={name ?? label}> 没有 aria-pressed，名字不随状态变；:759 点赞 `filled={liked}`、:770–774 收藏 `filled={saved}`，filled 只改 Icon 的实心与 tint。VideoPage.tsx:560–567 那颗键既无 aria-pressed 也无 aria-label。CommentSheet.tsx:209–210 同一件事已经做对（状态化的 aria-label + aria-pressed）。；价值✓ FeedPage.tsx:122-125 RailBtn 只有 aria-label={name ?? label}，:759 点赞 / :770-772 收藏 的 filled 只改图标填充与色，没有 aria-pressed；Video |

### Feathers / Beck 式可测性与回归面审查员

> 金字塔现状：底层 = 构建串里 18 道 check-*.mjs（15 道正反例脚本 + hook-order / guides / i18n 三道结构检查），纯函数模块一律 `await import` 真实 .ts（Node 24 剥类型）、粗数约 1,200 条断言（cut-project ≈320、cut-grammar ≈160、camera-vocab ≈145、shot-script ≈122、grid-shots ≈120、agent-grammar ≈111、ref-mentions ≈71…），git log 近 13 次改正则源文件的提交 100% 同拍动了脚本，两处读源文件的例外（shot-script (j)(k)、video-tiers 的 tierOf、camera-vocab 抠 hasDialogue）都写了理由；中层（IndexedDB / HTTP / zustand store）= 0；顶层 = 手工走查 + 付费真机验证，docs/backlog.md 没有任何测试章节，10-14 的 UX 走查只在 375×812 浏览器里过了页面，冷启动 / 断网 / 换账号 / 从后台回来四种场景一次都没碰（坑表里这四样分别是 9 / 2 / 1 / 1 条事故记录），这张表值得写进 backlog。系统性模式是「可测性止步于 import 边界」：作者有意做成零依赖的文件（cutProject / shotScript / refMentions / drawPlan / videoTierTable / *Shots）被钉得极死，而钱与并发的真正闸门——genRun、canReplaceNodes、appendIssue、tplOfNode 三态、nodeCarry、setVideoJobWaiting 的 finally、idbRead 与冻结写——全部长在 import 了 lingui `t`、`../ai`、store 或 localStorage 的文件里，于是坑表里最贵的几格（tpl 三态、承接手抄、两把尺报价、作废回包清 busy）只有事故记录、没有一条会变红的用例，且 e2e 包连 window.__ 缝都被剥掉。最值得补的第一刀不是引入大框架，而是沿 cutProject 已经示范的「原因代码 + 纯判据下沉」把 flowStore 的闸门搬进零依赖文件让现有脚本机制直接吃掉，其次用 fake-indexeddb 给 db.ts / boot.ts 补第一份中层测试并保留 e2e 构建的调试缝，把装机验证留给合并 / 出片这类真要硬件与钱的路径。

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✓ | 中 | **feathers-testing-1** flowStore 里的钱闸判据（appendIssue / appendBlocked / clampCursor / tplOfNode 三态 / nodeCarry / usableFrames）不可被 Node import，坑表四格零回归用例 | `src/studio/flowStore.ts:1191` | 事实✓ 逐行核对成立：flowStore.ts:21 引 @lingui/core/macro 的 t、:23 从 ../ai 整条拉进、:1191 tplOfNode 退回 useFlow.getState().template、:1209-1214 appendBlocked 直接返回 t`…`、:1420 nodeCarry 没有 export；studioStore.ts:112-116 nextStartFrame 读 activePath()。scripts/ 下 rg genRun／tplOfNode／nodeCarry／appendBlocked／appendIssue／clampCursor／usableFrames／nextStartFrame／pinUnstatedTpl 零命中（check-shot-script.mjs:277/328 只把 flowStore 当源文本扫，不 import）。pinUn |
| ✓ | 高 | **feathers-testing-2** genRun 令牌 / canReplaceNodes / setVideoJobWaiting finally / 剪辑页逐轮取消这几条并发规则零自动保护，全靠人在 12 处 set 里记得判 | `src/studio/flowStore.ts:2514` | 事实✓ 事实核对成立：五处 `const myRun = get().genRun + 1`（2514 / 2721 / 2883 / 2997 / 4084）、:1941-1945 的 ★★ 注释、canReplaceNodes 在 1998-2006、setVideoJobWaiting(id2, true) 在 4223、finally 解除在 4450、CutPage.tsx 1480 / 1551 / 1653 都是 for 循环头的 `if (cancelRef.current) break`；scripts/ 下 genRun / canReplaceNodes / cancelRef 零命中，没有任何自动检查。；价值✓ 证据属实：flowStore.ts 五处 `const myRun = get().genRun + 1`（:2514/:2721/:2883/:2997/:4084），跑里的 12 处 `bus |
| ✓ | 中 | **feathers-testing-3** 中层为零：db.idbRead 抛错 / open 忘掉失败 Promise / boot 冻结写 / videoJobs 凭据与 taken 名单没有一条自动测试，且 videoJobs 在模块顶层就读 localStorage | `src/data/db.ts:147` | 事实✓ 逐行成立：db.ts:21 OPEN_TIMEOUT_MS = 10_000、:51-54「不许把失败的 Promise 留在缓存里」、:147-159 idbRead 抛 IdbError、:161-168 idbGet 吞成 undefined；boot.ts:15「冻结会盖掉磁盘数据的写」；drafts.ts:165 draftsLoadIssue、cutSession.ts:125 cutSessionLoadIssue、cacheSweep.ts:181 按两者 blocked；videoJobs.ts:43-45 引 @lingui/core/macro、api/client、ai/arkClient，:165 `let taken = loadTaken()`、:192 `let jobs = load()` 在 import 那一拍就读 localStorage（TAKEN_TTL_MS = 72h）。s |
| ✓ | 低 | **feathers-testing-4** 「正则写成字符串常量」那格坑只有 check-cut-grammar 装了形状闸，agent-grammar / ref-mentions / shot-script / cut-project 四道脚本都没有 | `scripts/check-agent-grammar.mjs:25` | 事实✓ 成立：check-agent-grammar.mjs:25-27 只拦非 type import / @lingui / enum，check-cut-grammar.mjs:42 多出 `/new RegExp\(\s*["'`]/` 一行；agentGrammar.ts:160 / 164 / 168 / 199 正是 `new RegExp(String.raw`…`)` 拼句式，:129-131 用 `.source` 派生；shotScript.ts:303 / 323 用 `.source` 派生。check-ref-mentions / check-shot-script / check-cut-project 的形状段都没有这一行。；价值✓ 证据属实：只有 scripts/check-cut-grammar.mjs:42 有 `if (/new RegExp\(\s*["'`]/.test(ln)) fa |
| ✓ | 中 | **feathers-testing-5** check-cut-grammar 里 trim / split / fade / voice / music_volume / end_fade 六个家族只有正例、零反例，「认不准就不办」的安全方向没钉 | `scripts/check-cut-grammar.mjs:128` | 事实✓ 成立：check-cut-grammar.mjs:4-5 文件头自述「认错了就是替人删了一个片段、改了一句字幕」；107-115（转场 fade / end_fade）、128-134（trim / split）、150-156（voice / unvoice）全是 yes(；全文 31 条 no(（179-197、207-214、222-231）只覆盖 remove / volume / speed_step / line / title / move（挪的唯一反例正是 :192），trim / split / fade / end_fade / voice / music_volume 六个家族一条 no( 都没有，200-205 对这几个家族加的也仍是 yes(。CLAUDE.md「改一条正则就去补一句正例、一句反例」的纪律在这六家族上没落实。；价值✓ 证据属实：check-cut-grammar.mjs 有 10 |
| ✓ | 低 | **feathers-testing-6** 18 道脚本各抄一套 eq / fail / show / --module 解析与零依赖形状检查，而且没有一条命令能单独跑全部（只能连 tsc + lingui + vite build 一起跑） | `package.json:8` | 事实✓ 成立：package.json:8 的 build 串里 node scripts/check-*.mjs 共 18 道，没有 check:all，land.mjs:75 也是 `run("npm run build")`，所以单跑全部检查只能连 tsc + lingui extract + vite build；15 道脚本各自定义 eq / fail / ok（check-cut-project.mjs:41-46、check-ref-mentions.mjs:27-34、check-video-tiers.mjs:30-38 三份实现各异）；`--module=` 解析在 13 道里逐字重复、「只准 import type / 不许 @lingui / 不许 enum」那三行在 8 道里逐字重复；scripts/lib 不存在；新加一道要改 build 串与 npm 别名两处。；价值✓ 证据属实：package.j |
| ✓ | 中 | **feathers-testing-7** window.__flow / __studio / __cut / __deviceOwner 这些 E2E 缝只在 `import.meta.env.DEV` 下存在，`vite build --mode e2e` 的联调包里全被剥掉，装机 / 模拟器验证只能经 CDP 手写 IndexedDB | `src/studio/flowStore.ts:4596` | 事实✓ 成立：flowStore.ts:4596、studioStore.ts:3087、cutStore.ts:124、deviceOwner.ts:151 四处都是 `if (import.meta.env.DEV)` 才挂 window.__x；vite.config.ts:266-267 cspFor 按 mode === "e2e" 单独放行；仓里只有 .env.example / .env.local / .env.production，没有任何地方改写 NODE_ENV，所以 `vite build --mode e2e` 下 DEV 为假、MODE 为 "e2e"；CLAUDE.md:1030 与「验剪辑页的合并」第 4 步都明写这种包没有 __studio / __cut、只能经 CDP 写 IndexedDB。release 走 apk:release → npm run build（production）， |
| ✓ | 低 | **feathers-testing-8** 原生侧只有 Capacitor 样例测试（2+2）；GainAudioProcessor / TailFade / FadeRgb 与秒→微秒换算是设备无关的纯逻辑，却被锁成插件类里的 private 嵌套类 | `android/app/src/main/java/com/ideahub/branchvideo/VideoMergePlugin.java:644` | 事实✓ 成立：VideoMergePlugin.java:644 `private static final class GainAudioProcessor`、:703 `private static final class FadeRgb implements RgbMatrix`（SLACK_US 在 705）、:749 `private static final class TailFadeAudioProcessor`；秒→微秒的 `Math.round(… * 1_000_000d)` 散在 261-264、424、434-435、843-844；android/app/src/test 只有 ExampleUnitTest 的 `assertEquals(4, 2 + 2)`，build.gradle:225 已有 junit；FadeRgb 在 727 / 738 / 739 调 android.opengl.M |

### Nygard 式可靠性与失败处理审查员

> 整体看，方舟主路径上的可靠性纪律是扎实的：出片受理即落凭据、ArkTaskUnknown / ArkNoReply / ArkTaskFailed 按类型分流、钱上的话只走 failCharge、genRun 令牌与合并 BUSY 当舱壁、localStorage / IndexedDB 各有 TTL 或清扫器、fetchMe 五轮退避、SSE 与分块上传按「停了多久」计时 —— 这些在代码里都对得上 CLAUDE.md 的说法。缺口集中在**主路径之外的第二条支路**：真人档（第二家供应商）把 fetch 超时与 ArkNoReply 分型两样都漏了，api/client 之外的几处业务 fetch 没有 deadline，结构化技能抽屉把付费回话落在会被一指关掉的组件 state 里，注册昵称的补发沿用了已经被淘汰的 `void … .catch(emitApiError)` 写法。系统性模式就是仓库自己记过的「第二条支路抄漏两行」：每次新开一条入口（新供应商、新抽屉、新注册路）都重新手写集成点，而主路径上的超时 / 分型 / 停靠 / 落盘没有被抽成一个必经的壳 —— 加上全 app 至今没有一个 ErrorBoundary，任何一处渲染抛错都会把这些辛苦守住的状态一起带进白屏。

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✓ | 高 | **nygard-reliability-1** 真人档出片的三发 fetch 没有超时，提交那一发的网络失败不分型：钱扣了、屏幕说「没扣」、凭据不存在 | `src/ai/minimaxVideo.ts:166` | 事实✓ src/ai/minimaxVideo.ts:165-180 的 create 是裸 fetch（无 signal、无 catch），:34-36 getJson 同样裸；对照 src/ai/arkClient.ts:698-706 是 AbortSignal.timeout + catch→ArkNoReply。失败落到 src/ai/failCharge.ts:87-88 的 shape "other" → :110 tier "none"，flowStore.ts:4408-4429 于是对钱一个字不说、只剩「重新生成」；taskId 为空所以无凭据（:188 onTask 在 create 成功之后才跑是对的，问题是回包丢了就什么都没有）。src/data/videoJobs.ts:22-25/:622/:642 的服务端登记表导入只认方舟任务且写死 provider:"ark"。真人档在 videoTierTa |
| ✓ | 高 | **nygard-reliability-2** 全 app 零 ErrorBoundary：任何一次渲染抛错 = 整页白屏，没有「重载这一块」的出口 | `src/App.tsx:295` | 事实✓ src/App.tsx:277-295 直接渲染 <GenerationPill/><Toast/><Routes>，全仓 grep ErrorBoundary／componentDidCatch／getDerivedStateFromError 在 src/ 下只命中注释（economy.ts:843、studioStore.ts:228、projection.tsx:333、SimpleModePage.tsx:67、check-hook-order.mjs:6），package.json 无 error-boundary 依赖；CLAUDE.md 坑表两处（protected 模型缺失、hook 排在早退后）记的都是真发生过的整页白屏，现有对策全是根因侧（check-hook-order、prune 出包闸、camOk），没有一道兜底边界，也不是主人明文决定不做。；价值✓ 核实 src/App.tsx:277-29 |
| ✓ | 中 | **nygard-reliability-3** api/client 的超时只盖到响应头，`res.text()` 无上限；另有几处业务 fetch 连 AbortSignal 都没有 | `src/api/client.ts:199` | 事实✓ src/api/client.ts:177-178 起计时器、:184-197 只把 fetch 包进 try/catch/finally，:195 clearTimeout 与 :196 移除外部 signal 的监听都在拿到响应头那一拍跑完，:199 `await res.text()` 之后既没有超时、调用方传的 signal 也取消不了；而且 body 读断线时抛的是裸 TypeError 而非 ApiError(NETWORK)，绕过了「认 code 不认 message」那套分流。另几处裸 fetch 核实：src/api/auth.ts:103-107、src/api/portrait.ts:84-86、src/api/support.ts:240-245 收 signal 但 src/components/support/HoldToTalk.tsx:164 没传、src/data/cardViews.t |
| ✓ | 中 | **nygard-reliability-4** 「剧本 → 分镜」「按主题改写」两张抽屉：付费回话只落在组件 state，等回话的 170 秒里点一下遮罩就整张卸掉、结果静默丢弃 | `src/components/flow/ScriptSkillSheet.tsx:82` | 事实✓ src/components/flow/ScriptSkillSheet.tsx:82 遮罩 onClick={onClose} 与 :93 CloseButton 都不看 busy，:47-49 结果 setPlan 进组件 state，busy 只禁了 textarea 与按钮；ThemeRewriteSheet.tsx:72/:83 同形、:49-52 同样落组件 state；上层 FlowCanvas.tsx:2448 AgentPalette 遮罩也是 onClick={onClose}，关它就卸掉 :2443/:2445 挂的子抽屉。structuredSkills.ts:207-208 与 :420-421 在请求成功那拍 spendTokens(CHAT_TURN_TOKENS)、:95 超时 170 秒；grep startJob( 在这三个文件零命中，而 CLAUDE.md「长活登记进 data/jo |
| ✓ | 中 | **nygard-reliability-5** 注册时填的昵称用 `void updateProfile().catch(emitApiError)` 补发：失败零提示，冷启动后昵称退回用户名 | `src/data/account.ts:2838` | 事实✓ src/data/account.ts:2864-2866（registerWithEmailOtp）先 local.name = nick 再 `void authApi.updateProfile(...).catch(emitApiError)`；LoginPage.tsx:209-215 真把 displayName: nick.trim() 传进来（昵称框在 :457）。client.ts:108-116 的 emitApiError 只 dispatch，全仓无人监听（grep 只命中「api:error 没人听」的注释）；persist() :258-260 远端模式不写 IndexedDB；冷启动 hydrateProfile → toLocalUser :2397 `name: u.displayName ／／ u.username`，PUT 失败就退回用户名。CLAUDE.md 坑表那格「远端写操作写 |

### OWASP MASVS 式安全与隐私审查员

> 整体状况：凭据与本机数据这一面做得扎实，而且是在代码里而不只在注释里 —— JWT 只在 localStorage 且 allowBackup=false 带理由、QQ / 微信只传 code 由服务端换身份、全仓日志不打 token、明文全禁且 debug 变体单独放行 localhost、capacitor.config 禁混合内容、Cloudinary 直传三道防线与 docs/api-contract.md 对得上、EXIF 在相机入口剥掉且相册图经 canvas 重编码、模型回话逐条按白名单验形（canvasAgent.parseReply）、下载地址带牌子、VideoMergePlugin 只认自己 staged 目录、QQ 请求码之外一律交回 Capacitor、多账号隔离按 owner 分键且对不上只跳过不删、exported 组件只有 MainActivity / 腾讯 AuthActivity / WXEntryActivity 三个且各有 SDK 层面的校验。真正的缺口集中在「边界上的外部输入没有绑定到发起它的那一次动作」：深链 token 没有 state、更新清单缺摘要时照装、社区模型包的引用不限域 —— 三条是同一个形状，某个外部字符串被当成「我们自己发出去的那份」直接执行。系统性模式：仓库里大量安全约束以注释中的「★ 以后 / 应当」存在（CSP 的「域名固定后收窄」、权限表的「应当只有三条」、对 docs/security-checklist.md 的引用）而没有对应的构建门，于是在条件变了之后（域名钉死、media3 引入）静默过时；建议把这类「应当」逐条变成 scripts/check-*.mjs 那种在构建里实跑的检查，与仓库已有的纯函数检查同一套做法。

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✓ | 高 | **owasp-security-1** 第三方登录深链回程没有 state 绑定：任何 App / 网页投一条 ideahub://oauth?token= 就能把用户登进别人的账号 | `src/utils/oauth.ts:73` | 事实✓ 核对属实：src/utils/oauth.ts:68-75 对任何 ideahub:// 带 token 的地址直接 return {token}；App.tsx:87-91 拿到就 signInWithOauthToken → api/auth.ts:296-298 adoptToken = setToken(token)+fetchMe，data/account.ts:2850-2854 finishRemoteSignIn 不看现有会话；api/auth.ts:252-256 oauthStartUrl 只带 next、无 state；AndroidManifest.xml:41-46 的 VIEW/BROWSABLE intent-filter 在 exported=true 的 MainActivity 上，任何 App / 网页链接都投得进来；对照 WeChatPlugin.java:117-127、251- |
| ✗ | 中 | **owasp-security-2** 供应链没有门：CI 不跑 npm audit，仓库没有 Dependabot / Renovate | `.github/workflows/build.yml:38` | 事实✗ 仓内事实对（.github 只有 copilot-instructions.md 与 build.yml，build.yml:38-62 无 audit 步，package.json 依赖为 ^ 范围 + 锁文件），但核心断言「锁里那版有 CVE 时没有任何东西会说」不成立：gh api 实查 TianbinLiu/ideahub-app 为 public 仓，/vulnerability-alerts 回 204（Dependabot 告警已开）且 security_and_analysis.dependabot_security_updates=enabled（有漏洞的锁文件依赖会自动开 PR），覆盖的正是 npm audit 同一份 GitHub Advisory 库；dependabot.yml 只是「版本更新」所需，不是告警所需。；价值✓ 证据核实：.github 下只有 copilot-instruction |
| ✓ | 中 | **owasp-security-3** 生产 CSP 的 connect / img / media-src 放行任意 https:，注释里「域名固定后收窄」从未兑现（引用的 security-checklist.md 也不存在） | `vite.config.ts:259` | 事实✓ 核对属实：vite.config.ts:256/257/259 的 img/media/connect-src 都是 'self' data: blob: https:，:245-246 注释写「域名固定后可进一步收窄成白名单」，:247 引用的 docs/security-checklist.md 在 app/docs 与 client/docs 两仓都不存在；.env.production 已钉死 VITE_API_BASE=https://api.ideahubs.org、utils/shareLink.ts:9 钉死 SITE_BASE，AGENTS.md / CLAUDE.md 里没有保留 https: 通配的决定；真人档等第三方调用已经过 API_BASE 代理（ai/minimaxVideo.ts:24），需要的来源集合不大。它只是 XSS 之后的第二道墙（script-src 'self' 无 unsaf |
| ✓ | 中 | **owasp-security-4** 权限期望表已过时：真实合并清单比文档多了 ACCESS_NETWORK_STATE 与 WAKE_LOCK（media3-exoplayer 带进来的） | `docs/play-store-checklist.md:22` | 事实✓ 核对属实且比所说更过时：docs/play-store-checklist.md:22 写「整表应当仍然只有 INTERNET / RECORD_AUDIO / MODIFY_AUDIO_SETTINGS 三条」；本 worktree 2026-10-08 构建的 sideloadRelease 合并清单 :53-54 有 ACCESS_NETWORK_STATE 与 WAKE_LOCK，manifest-merger-sideload-release-report.txt:489-497 明确 ADDED from androidx.media3:media3-exoplayer:1.11.0；源清单（src/main:98-105）确实只有三条，所以差异全来自依赖。；价值✓ 证据核实：docs/play-store-checklist.md:22 写「整表应当仍然只有 INTERNET / RECORD_AUDIO  |
| ✓ | 低 | **owasp-security-5** 自更新 fail-open：清单里没有 sha256 时照样下载并拉起安装器，apkUrl 主机也不限 | `android/app/src/sideload/java/com/ideahub/branchvideo/AppUpdaterPlugin.java:312` | 事实✓ 代码属实：AppUpdaterPlugin.java:312-320 只在 expectSha 非空时校验，否则 :323-325 改名返回并 launchInstaller；:165 check() 对缺 sha256 的清单用 optString 缺省 ""；data/appUpdate.ts:167 只要求 apkUrl、:204 传 sha256 ／／ undefined；fetchInto(:347) 对 apkUrl 主机不设限（明文由 network_security_config.xml cleartextTrafficPermitted=false 挡住）。但它只是 fail-closed 卫生，不是可利用的口子，见 corrected。；价值✓ 证据核实：AppUpdaterPlugin.java:312 `if (expectSha != null && !expectSha.isEmpty())` |
| ✓ | 低 | **owasp-security-6** 社区 Live2D 模型包的文件引用按 new URL(ref, base) 解析：包里写一个绝对地址，每个换装的用户都会去打那台第三方主机 | `src/live2d/prefetch.ts:68` | 事实✓ App 侧属实：src/live2d/prefetch.ts:33-53 原样收下 Moc/Textures/Physics/Pose/DisplayInfo/UserData/Expressions[].File/Motions{File,Sound}，:68 new URL(ref, modelJsonUrl) 对 https:// 引用直接得到外域地址并在 :76 fetch；舞台用 pixi-live2d-display（live2d/companionModel.ts:257 Live2DModel.from，bundlePreview.ts:11 注明它按 url.resolve 解引用）同样放绝对地址过；CSP img/connect-src https: 不拦。服务端（ideahub-server live2dBundle.service.js:212-258 inspectModel3Json）只对 M |
| ✗ | 低 | **owasp-security-7** release 包 minifyEnabled=false、无 shrinkResources（提案：主人已在注释里拍板关闭） | `android/app/build.gradle:113` | 事实✗ android/app/build.gradle:112-113 的 minifyEnabled false 旁边就是主人的明文决定（「webview 壳应用：原生代码只有 Capacitor 桥，minify 收益小，保持关闭省心」），MASVS-RESILIENCE 属可选加固、OWASP Mobile Top 10 不作硬要求，发现本身也自称「只作为提案」；没有可核对的缺陷，按任务口径主人决定优先、不算发现。；价值✗ build.gradle:112-113 是主人记在注释里的决定（「webview 壳应用……保持关闭省心」），发现本身也承认只是 L2/R 可选项。改了用户与维护者得不到什么：业务全在 Web 层，Vite 已压缩；AppID 本就公开、AppKey 在服务端（CLAUDE.md 坑表「QQ 登录让客户端把 openid 一起传」那格）；防重打包靠的是签名一致性，不是混淆。代价却是本仓最怕的那类：R |

### Humble / Farley 式交付与运维审查员

> 整体状况：「发布应该是无聊的」已经做到七成——ruleset 强制 PR + `build` 检查且无 bypass、land.mjs 无 skip 参数、release.mjs 认不出参数即停，签名指纹 / versionCode 递增 / 同名拒发 / 镜像先 .part 落位再发清单 / 整包经 Cloudflare 下一遍全是机器判，46 个 tag 与 46 个 Release 一一对应、近 8 版 tag 树与出包分支树逐一相等、keystore 与 .env 从未入仓、CI 一轮约 90 秒、gradle 依赖无 `+`。按 git tag 算的 DORA：09-24 到 10-08 发了 14 版（约一天一版），此后 6 天里 5 个 PR 合进 main 未发版；但 2.51–2.55 五版连续带着工坊白屏出门（那两周的变更失败率约三成）、恢复时间 5 天 7 小时，2.58→2.60 两小时内三连发——这些没有一件是从日志里看出来的，全靠主人真机。系统性模式：每道闸都是某次事故之后补在事故那一个点上（钥匙、铸卡师、清单顺序、参数拼写、`.part`），于是闸是点状的、覆盖面停在「出过事的地方」——APK 内的 web 资产与第三方模型、GitHub 备用包、原生层编译、数据迁移、客户端失败计数、以及 35 条没人删的 claude/ land/ 远端分支（land.mjs:116 只在直推成功时删，而 ruleset 从不允许直推）都还靠人眼，下一次事故最可能从这些「还没出过事」的缝里来。

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✓ | 中 | **humble-delivery-1** 「包里的内容是本次构建的」「只有自有模型」两条出包必验仍是人工 unzip：release.mjs 只核版本号、prune 是黑名单 | `scripts/release.mjs:373` | 事实✓ 核对属实：scripts/release.mjs:371-378 第 2 步只用 aapt2 dump badging 比 versionCode/versionName，整个脚本不打开 APK；docs/app-distribution.md:314-323「出包前必验两条（都要验包本身）」把 unzip -l protected/ 与入口 js 文件名两条明写成人工步骤；scripts/prune-app-assets.mjs:32-77 的 PRUNE 是按文件名列举的黑名单，末尾出包闸（:90-127）只断言 milltina-opt.glbx 在包里且解得开，不断言 protected/ 下没有别的东西。public/models/protected/（本 worktree 是到主检出的符号链接）里 gratia×3、rin×4 七个第三方文件与 milltina 并排，不在表上的新文件会默认随包发。jszip |
| ✓ | 中 | **humble-delivery-2** GitHub Release 上的 APK（强制更新时的备用下载源）从不被核对 sha256：三份产物只验了两份 | `scripts/release.mjs:697` | 事实✓ 核对属实：release.mjs:660-689 整包下载核对的只有 mirrorUrl（APK_MIRROR_PUBLIC），:634-636 比的是 GitHub latest.json 与服务端转的清单里的 sha256 字段，:697 对 GitHub 那份 APK 只打印 check.apkUrl；src/data/appUpdate.ts:64-68 githubApkUrl 按 tag/资产名拼地址，components/UpdateSheet.tsx:50 在强制更新弹层上真用它当备用下载（正式包路径）。脚本里没有任何一步核对 GitHub 资产的大小或摘要。「GitHub 对资产回 digest」是外部事实，没法在仓内核实，但不影响结论。；价值✓ 核对属实：release.mjs 第 8 步整包下载只对镜像（:660-689），sha 比对只有两份清单（:634-636），GitHub 那份 APK 只 |
| ✓ | 中 | **humble-delivery-3** 提交门禁只编译 web 那一半：原生插件（更新器 / 合成器 / 登录）的 Java 改动合进 main 不经任何编译 | `.github/workflows/build.yml:46` | 事实✓ 核对属实：.github/workflows/build.yml:46-48 只跑 npm run build 与 git diff --exit-code src/locales，没有 gradle；scripts/land.mjs:74-75 的本地门禁同样只是 npm run build。git log --since=2026-09-01 -- android/app/src/{main,sideload}/java 恰好 19 条提交（含 VideoMergePlugin 09-07/08 那一串、AppUpdaterPlugin 10-09 强制更新）。Java 第一次被编译是 package.json:15 的 apk:release（gradlew assembleSideloadRelease），即发版那一刻。land.mjs:98 注释也证实 ruleset 只要求 build 检查。；价值✓ 事实成 |
| ✓ | 中 | **humble-delivery-4** 客户端三类失败（更新失败 / 本地库损坏 / 渲染崩溃白屏）零上报：服务端只见到 X-App-Version，事故全靠主人真机撞上 | `src/api/client.ts:27` | 事实✓ 核对属实：src/api/client.ts:24-38 明写 X-App-Version「只为服务端的日志」且服务端不做任何判断；AppUpdaterPlugin.java:169-172 与 :223-224 失败只 call.reject；src/data/appUpdate.ts:169-172 silent 时直接回 null；src/data/db.ts:91-100 noteDataLoss 只写 localStorage + console.error；economy.ts:843 自己记着「全 app 没有任何 ErrorBoundary」，全仓 grep ErrorBoundary/componentDidCatch 四处命中全是注释，main.tsx/App.tsx 没有 window.onerror / unhandledrejection，也没有任何 client-events 类上报端点。ta |
| ✗ | 中 | **humble-delivery-5** 数据迁移全在流水线之外：DB_VERSION 恒 1，V3 截线清库三处各写一份、localStorage→IndexedDB 迁移分支，一个构建期用例都没有 | `src/types.ts:14` | 事实✓ 事实核对属实：types.ts:14 V3_CARD_WIPE_MS；account.ts:200 按卡 createdAt、templates.ts:157 按模板 createdAt、studioStore.ts:2849 按草稿 updatedAt 各判一次；videos.ts:437-452 是 localStorage→IndexedDB 迁移分支；db.ts:8 DB_VERSION = 1。scripts/ 下没有一道脚本引用 V3_CARD_WIPE_MS 或喂老数据（check-camera-vocab.mjs 那条「老草稿」只是文案提示）。但两处说法要修正，见 corrected。；价值✗ 引用的行都在，但结论站不住。三处 V3 判定（account.ts:199-200 按卡 createdAt、templates.ts:157 按模板 createdAt、studioStore.ts:2849 按 |
| ✓ | 中 | **humble-delivery-6** 应急手册缺「发出去的那一版是坏的」怎么止血：撤回只在失败清单里作为故障出现，2.51–2.55 因此连发五版 | `docs/app-distribution.md:115` | 事实✓ 核对属实：docs/app-distribution.md:97-102 只讲「发布之后不许同版本二发 → 涨版本重发」，:115 把 draft/pre-release 当成一种故障列在失败表里；全部 docs/ 与 CLAUDE.md/AGENTS.md grep 撤回/回滚/止血/发错/pre-release 没有任何一节讲「发出去的那版是坏的先做什么」。release.mjs:46-67 parseArgs 只认 --dry 与 --min-version-code，没有撤回入口。git tag：v2.51 09-25 16:32、v2.52 09-25、v2.53 09-26、v2.54 09-30 13:29、v2.55 09-30 19:37、v2.56 09-30 23:26，与 prune-app-assets.mjs:90-92「2.51–2.55 就是这么坏的 / 出包闸 2026-09-30 加」 |
| ✓ | 低 | **humble-delivery-7** 出包提交与 tag 的绑定靠约定：release.mjs 不核对 HEAD 与 origin/main、tag 不带 --target、包里不带 commit——CLAUDE.md 的「git log -1 对一眼 / dumpsys 核对」是两条人工琐事 | `scripts/release.mjs:569` | 事实✓ 核对属实：release.mjs:569-579 gh release create 不带 --target，脚本全文没有一条 git 命令（rev-parse 只出现在 land.mjs / worktree-changes.mjs），既不核对 HEAD 树与 origin/main 也不查工作区干净；vite.config.ts:323-330 的 define 只烤 __APP_VERSION__（来自 build.gradle），没有 commit；SettingsPage.tsx:436-438 只显示 versionName（versionCode）；CLAUDE.md:49「出包前 git log --oneline -1 对一眼、装完 dumpsys」正是两条人工步骤。约定目前守住了，发现本身也只定为 low。；价值✓ 事实对：release.mjs:569-579 gh release create 不 |
| ✓ | 低 | **humble-delivery-8** 密闭构建三处松动：CI 的 Node 只钉大版本、QQ SDK 的 jar 入仓但没有来源 / 校验记录、Gradle wrapper 不校验发行包 | `.github/workflows/build.yml:33` | 事实✓ 核对属实：build.yml:32-33 node-version "24" 且注释写「不写死小版本，拿 24.x 最新」，仓内无 .nvmrc、package.json 无 engines；android/app/libs/open_sdk_3.5.19_r9483ffc7_lite.jar 经 build.gradle:198 fileTree(include: ['*.jar']) 进包，仓内与 docs/ 对它的唯一记载是 QQLoginPlugin.java:18/:282 两句注释（版本号与 javap 实读），没有下载来源与校验值，「逐字节核过」只在 build.gradle:200 说的微信 SDK；android/gradle/wrapper/gradle-wrapper.properties 只有 distributionUrl + validateDistributionUrl，没有 distrib |

### McConnell / Nygard 式性能量测审查员

> 整体状况：这个仓库在「踩过坑的路」上性能纪律很硬——useFrame 全部回调都不 setState、camOk 校验外部形状、toonify 给了 customProgramCacheKey、截帧 Cloudinary 优先且每一步带超时、原生 staged/merged 目录定期清扫、BGM 按 512KB 分片过桥、拍照走 Uri 不走 base64、?v= 版本钉在模型文件之后、所有轮询都有上界与终态文案、量过的常数（captionLayout 0.28/0.58 等）与代码一致。真正的洞在「没出过事故的路」上：开机包体、看不见时照常渲染、简约模式播放器、objectURL 缓存、存储页的全量扫描，这些从没被真机事故逼着量过。系统性模式是「性能承诺写在注释里而不是检查里」——vite.config 说首页不用等 3D 块、rigidBones 说 ammo 是独立 chunk、FlowCanvas 头说只动 transform、剪辑页学到的「播放直连、截帧后台取」没传到简约那一面——而仓库对纯函数早已有十几道 check-*.mjs，唯独没有一道对着 dist 产物断言 chunk 依赖图与体积、也没有一次用可见窗口（document.visibilityState === \"visible\"）录下来的开机 / 画布 / 首页 Performance 基线，建议先补这两样再谈下一轮优化。

| 留 | 严重 | 发现 | 位置 | 反驳者怎么说 |
|---|---|---|---|---|
| ✓ | 中 | **mcconnell-performance-1** 开机就把 three / three-vrm / ammo 物理（vendor-3d 2.95MB）与整份 App（1.98MB）静态拉进首页路径，一个 React.lazy 边界都没有 | `src/App.tsx:52` | 事实✓ 核对属实：App.tsx:13–52 把全部页面含 StudioPage（:52）静态 import，src 下 `React.lazy` 零命中；main.tsx:66 虽动态 import App，但 dist/assets/App-D9tAM5_x.js 第 2 行（字节 1165）确有 `from"./vendor-3d-A0NXektC.js"` 静态 import，vendor-3d 2,948,996 B 含 378 处 btRigidBody，rigidBones.ts:42–43 那句 `import("ammojs-typed")`「独立 chunk」被 vite.config.ts:339 的 manualChunks 正则并进了同一块（App 里同时出现 `import("./vendor-3d…")`）。vite.config.ts:336–337「首页不用等 3D 块」与产物相反。冷启动是每个 |
| ✓ | 中 | **mcconnell-performance-2** 工作流画布浮层盖住 3D 桌面时，TableScene 仍以 frameloop=always 每帧渲染 NPC、弹簧骨、卡面轮播，还开着 preserveDrawingBuffer | `src/studio/StudioPage.tsx:249` | 事实✓ StudioPage.tsx:249–255 `<Canvas dpr={[1,2]} gl={{ preserveDrawingBuffer: true }}>` 无 frameloop（src 内 frameloop 只出现在 StageOverlay 注释，scene/ 下 16 处 useFrame 无一按 canvasOpen 早退，grep `canvasOpen` 在 scene/ 零命中）；:426–444 在 canvasOpen 时把 FlowCanvas 挂在同一容器里，FlowCanvas.tsx:543 根是 `fixed inset-0 z-40 flex flex-col bg-ink` 不透明整屏。该 Canvas 的 toDataURL 消费方只有 TableScene.tsx:1418 的 CaptureHook，而它在 :1686 `{import.meta.env.DEV && < |
| ✓ | 中 | **mcconnell-performance-3** 简约模式出片后的播放器要等整条成片先 fetch 成 blob 才出画（forCapture），取流失败只 console.warn、画面静默停在海报 | `src/pages/FlowPage.tsx:342` | 事实✓ FlowPage.tsx:342 `useMediaUrl(realVideo, { forCapture: true })`，:629–630 `done && vsrc ? <video src={vsrc}…>` 否则 :631 退到海报；NodeScreen 在 :1168 `{simple && (` 闸内（:1388 渲染，:1157 注释明说只属简约模式），简约模式是创作入口的正式路径。mediaUrl.ts:28–55 forCapture 时整条 fetch 成 blob（120s 超时、重试一次）才返回，:75 失败只 console.warn；arkClient.ts:89–91 对非方舟域（转存后的 Cloudinary）也是整文件直连 fetch。CutPage.tsx:372–376 已把同一坑修成「播放直连、截帧后台取」，FlowPage 没跟上。；价值✓ 这条不是教材洁癖，是仓库自己记在  |
| ✓ | 中 | **mcconnell-performance-4** mediaUrl 的 objectUrlCache 无上限、从不 revokeObjectURL：剪辑页每一段的整条截帧流 blob 在整个进程生命周期里常驻 | `src/utils/mediaUrl.ts:14` | 事实✓ mediaUrl.ts:14 `const objectUrlCache = new Map<string,string>()`，:24 / :53 只有 set，模块内无 delete，且全仓 `revokeObjectURL` 命中都不在 utils/mediaUrl.ts（grep 核对）；objectUrlCache 是模块私有常量，别处无法清。CutPage.tsx:379–406 `loadCaptureSrc` 对每段 `resolveMediaUrl(url, { forCapture: true })`（:398），FlowPage.tsx:342、CoverPicker.tsx:138 同路。退出页面不释放、按进程生命周期常驻属实。；价值✓ 泄漏本身属实：src/utils/mediaUrl.ts:14 `objectUrlCache` 只在 :24 / :53 写入，整个模块没有 delete /  |
| ✓ | 中 | **mcconnell-performance-5** 首页缓冲提示线 `feed-buffer-line` 用关键帧动 width，缓冲期间每帧一次布局 + 重绘，正压在解码中的视频上 | `src/index.css:127` | 事实✓ index.css:127–137 `@keyframes feed-buffer` 动的是 width（16%→90%）+ opacity，.feed-buffer-line 0.9s 无限循环；FeedPage.tsx:588–594 在 `active && buffering && !paused && prog.d === 0` 时挂它；同文件 :143–144 弹幕注释自己写着「只动 transform…动 left 就是每帧重排」，CLAUDE.md 也钉了「动画只动 transform / opacity」。三处 transition-all 进度条（CutPage.tsx:2132、ProfilePage.tsx:1220、StudioPage.tsx:84）也核到。违反仓库自己的约定属实。；价值✓ 证据属实且直接撞仓库写下的约定：src/index.css:127-131 的 `@keyframes  |
| ✗ | 中 | **mcconnell-performance-6** 进「存储」设置页就跑 planSweep：把所有账号的每一条草稿正文（含 MB 级帧）读进内存再 JSON.stringify 一遍，主线程上无上限 | `src/pages/SettingsStoragePage.tsx:182` | 事实✓ SettingsStoragePage.tsx:64 在 storageEstimate 回来后就挂 `<CacheSweeper>`，:182–184 `useEffect(() => { void planSweep().then(setPlan); }, [])` 进页即跑；cacheSweep.ts:178–182 planSweep → collectReferenced，:127–135 对 `allDraftsForSweep()`（drafts.ts:227 所有账号）逐条 `await loadDraftForSweep`（drafts.ts:232 idbGet 整份正文）再 `JSON.stringify(body)` 扫 idb: 指针；drafts.ts:110 自述一条几 MB 到几十 MB。结构化克隆与序列化都在主线程，工作量随草稿总字节涨，没有别处预先算好引用表。；价值✗ 事实部分属实（s |
| ✓ | 低 | **mcconnell-performance-7** FlowCanvas 拖动时每个 pointermove 改整屏网格的 background-size / background-position，整屏重新光栅化，与文件头「只动 transform」不符 | `src/components/flow/FlowCanvas.tsx:268` | 事实✓ FlowCanvas.tsx:263–271 `paintView` 每次都写 `g.style.backgroundSize` / `backgroundPosition`（:268–269），:301 与 :310 两条 pointermove 分支每次都调它；gridRef 那层是 :637–645 的 `absolute inset-0` 整屏 radial-gradient 点阵。background-* 改动不触发布局但会让这一整屏元素重绘 / 重光栅，与 :232「拖移/缩放（transform-only）」、:238「直接写 transform」的说法不符；stage 那层（:646–650 will-change-transform）才是真 transform-only。未量过帧耗时，但代码事实与自述矛盾成立，严重度 low 合适。；价值✓ 证据成立：src/components/flow/FlowCa |

## 四、排优先级

主题：
- 钱与结果不丢：报价第二把尺（推演价签 / 选法屏估价）、付费回话落在组件 state、真人档没超时没分型、重拍尾帧白改
- 崩溃与长活反馈：零 ErrorBoundary、票据不动、两面不同起点、注册昵称失败装没事
- 唯一实现回潮与边界外观：mock: 谓词、ownerKey、openExternal、/api/tts 三份实现
- 读屏与无障碍：自绘控件壳（播放器 / 抽屉 / 轻提示 / 滑杆 / 切换键）一处 ARIA 都没有
- 发版链路靠人眼：APK 内容、受保护模型、GitHub 备用包、tag 树、权限表、撤回手册
- 构建里的检查闸：反例缺、正则形状闸只装一道、没有 check:all、e2e 缝被剥、import 方向无门禁；钱闸纯判据下沉与测试基建待定
- 文案与注释漂移：合成 / 合并、删掉 / 删除、横幅念工程诊断、免费不说限量、过期注释与 backlog
- 性能先量再改：看不见时照常渲染、简约播放器整条下载；懒加载 / objectURL 缓存 / 网格光栅量了再动

### 现在改（15 簇，已在本 PR 落地或在「五」里说明没做的部分）

1. **[nygard-reliability-2] 全 app 补 ErrorBoundary：路由一层 + 两个 Canvas + 画布 portal，坏了只重挂这一块** — `src/App.tsx:295`
   - 为什么：全仓零边界：任何渲染抛错（受保护模型解不开、hook 顺序、空指针）= 整页白屏且一个字一颗键都没有，2.51–2.55 就是这么发出去的；在途出片还在跑却没人画进度，内存里没自动存盘的流水线整条丢。
   - 怎么改：写一个几十行 class ErrorBoundary（getDerivedStateFromError + fallback：一句 Lingui 文案 + 「重载这一块」键，键只换 key 重挂这棵子树，store 与其余部分原地不动；不做 location.reload、不自动重试成死循环）。App.tsx 包住 <Routes>，再各包一层 TableScene 的 <Canvas>、导演台 <Canvas> 与 FlowCanvas 的 portal。注释写明它接不住 useFrame 里抛的错（rAF 循环不经 React，那一类仍只靠 camOk 式先校验）。英文 msgstr 同 PR；dev 里在某页故意抛一次看 fallback。
2. **[norman-interaction-1] 「剧本 → 分镜」「按主题改写」的付费回话停进模块级 parked + 领票心跳；两张上传票也补心跳** — `src/components/flow/ScriptSkillSheet.tsx:82`
   - 为什么：plan / busy / step 都是 useState，遮罩 :82 与 ✕ :93 不判 busy，等回话的 30~170 秒里点到外面就卸载，已按次计费（CHAT_TURN_TOKENS）的分镜 / 改写静默丢掉、再点再扣；ThemeRewriteSheet 同形；live2d-publish / card-mint 两张票从 startJob 起一句不动，分不清在跑还是卡死。
   - 怎么改：照 customCardStore / 提取窗 parked 的做法建一个模块级 store（按 deviceOwner 分人暂存）：run() 把在途 Promise 与 plan / step / err 停进去，ScriptSkillSheet / ThemeRewriteSheet 只订阅、重开抽屉接回；busy 期间遮罩 / ✕ 只收起不丢。同时 startJob({ kind: skill-shots / skill-rewrite })，route 用 data/jobs 的 currentRoute()（画布是 StudioPage 浮层、路由可能是 /studio，别写死 /flow），每 5 秒 update「拆分镜中 · 已等 N 秒」，回包后人在则 done({ silent }) 否则 done({ msg, route })。live2dUploadStore.ts:609 与 CustomCardPage.tsx:1121 的两张票同样加 5 秒心跳并与页内 progress 同源（multipart 换 putDirect 已是现状不做；XHR 百分比 / addCards 逐张进度另立提案）。
3. **[nygard-reliability-1] 真人档三发 fetch 加超时并包成 ArkNoReply；api/client 的 body 读也盖上限；顺手关掉 backlog 里已做的凭据条目** — `src/ai/minimaxVideo.ts:166`
   - 为什么：create :166 与 getJson :35 都是裸 fetch：弱网中断抛裸 TypeError → failCharge 判 shape=other → 屏幕上钱一个字不说、onTask 没跑到、凭据不存在，唯一的键是全价「♻ 重新生成」= 双倍扣；轮询 / 取件挂在 await 里 10 分钟死线永远到不了。client.ts:195 的 clearTimeout 在拿到响应头那一拍就跑完，:199 res.text() 无上限，裸 TypeError 还让 ApiError 分流全判不到。
   - 怎么改：minimaxVideo.ts :166 create 与 :35 getJson 一律 `signal: AbortSignal.timeout(大于服务端转发预算)` 并 `.catch(e => { throw new ArkNoReply(...) })`（chargeOnFail 顺手刷钱包那条副作用保留）。client.ts 把 clearTimeout 挪到 res.text() 之后（或给 body 读单独上限），AbortError 也包成 ApiError TIMEOUT；auth.ts:103 uploadAvatar（小文件）加同样的 signal。HoldToTalk / portrait.ts:84 / viewSourceBlob 不动（要按「停了多久」计时、先量再定，见提案）。服务端 video-tasks 登记表记真人档是跨仓契约（videoJobs.ts:642 写死 provider ark 也得跟着改），只作提案。顺手把 docs/backlog.md:1047「出片凭据搬到服务端」改成「已做（2026-09-06，server ArkVideoTask + importServerVideoJobs），剩『服务端不知道哪台设备取没取回』」，:1037 的 webm 说法改指原生 mp4 转存那一步。
4. **[mcconnell-construction-1] 推演价签全部改读 deriveCostOf、选法屏估价由宿主算一次传进来；同批改掉过期注释（线性视图 / 2026-09-XX / Card.tags / degraded）** — `src/components/flow/FlowCanvas.tsx:1171`
   - 为什么：FlowCanvas :1170-1171 / :2102 / :2176 与 canvasAgent :543-544 / :729 各自手抄 `proposalsCost(!!(node.chain && prev?.lastFrame))`，而真扣的是 deriveCostOf（它头上 ★★ 记着 2026-09-03 两个 prev 差成倍价的事故）；ModePicker:177 按 proposalsCost(false) 报，第 2 段起多报 3×IMAGE_TOKENS 且同屏唯独它没有「约」。五处 ★ 注释日期停在「2026-09-XX」，FlowCanvas 多处还说线性视图活着，Card.tags 没与 VideoItem.tags 互指，Proposal.degraded 注释描述一条已删的路。
   - 怎么改：FlowCanvas.tsx:1171 / :2176（carried 只留给 fuseSourcesOf）、canvasAgent.ts:543-544 与 :729（下标 o.seg-1 / p.seg-1）改 `deriveCostOf(nodes, idx)`（flowStore 已 export），:721-724 ★★ 改成「复核与真扣同一处实现 deriveCostOf」，FlowPage.tsx:386 那份 simple 闸里的死码顺手同改。ModePicker 加必填 `derivePrice: number`：画布按将要落的段 `proposalsCost(!!chosenOf(last)?.lastFrame)`（新段 chain 恒为 !!prev），工坊复用 projection.tsx:1090 的 nextStartFrame(editor.startFrame)；:177 带「约」并说承接减半。注释：FlowCanvas:1168 改「与工坊方案台同一把尺（deriveCostOf）」，按 `rg 线性视图` 把 :160 / :1902 / :2150 / :2158 等仍宣称它存在的改成「已下线」口径；flowStore.ts:1396 / :4097、segmentGen.ts:872 / :1004、TierRow.tsx:61 的 XX 统一填 2026-09-03（都是 1fe109c7 写的）；types.ts:818 Card.tags 加「卡的关键词、进提示词；与 VideoItem.tags 同名不同物（那是作品话题）」；types.ts:1002 degraded 改成现状（推演没画出来帧为空串；老草稿 / 回炉工程里为真且两帧非空 = 占位图）并与 flowStore.usableFrames:782 和 :4389 那第二处读法互相点名（或抽成共用小函数）。
5. **[gof-domain-model-2] 剪辑页圈选重拍：先按档位 flf 算哪些圈选真会发出去，后半段在 flf:false 档不改图不收钱、真人档整句拒；同文件过期的录屏注释改掉** — `src/pages/CutPage.tsx:1313`
   - 为什么：后半段圈选先付费改 seg.lastFrame（:1314，:1337 按 annRedrawCost(list.length) 实扣），而极速 / 真人档 flf:false ⇒ regenSegment 不发那张尾帧，钱扣了图作废、零报错（主路 segmentGen 已按 redrawnAnns 处理同一件事）；regenSegment 只认方舟，真人档的段也会走进来。:627-634 / :1387-1392 / :1531 的注释还在讲 MediaRecorder、AudioContext 混轨与 <video muted>，全文件一行相关代码都没有。
   - 怎么改：重拍前照 segmentGen.redrawnAnns 的样子按 `tierOf(seg.videoTier).flf` 把后半段圈选从「要改的」里剔掉：报价 :621 与真跑 :1312 读同一个判据，busy 行说一句「这一档收不了结束帧，后半段的圈选只进文字要求」；seg.videoTier 是真人档时整句拒。别照原审稿「后半段圈选整句拒」—— 那会把前半段能办的也办不成。GenSpec 加 reshoot 模式走 composeSegments 留作提案（L、要付费验）。注释：:1387 docstring 改「交给原生 Media3 合成单条 mp4 → 发布页」，:1389-1392 防重入理由改成现在的后果（原生 BUSY、后到的一炉覆盖已在发布页看到的成片、两次写库 / navigate），:627-634 改成预览带声音（playVideo）、合成由原生混轨，各留一句旧做法当历史。
6. **[norman-interaction-6] 邮箱注册的昵称 PUT 失败不再装没事：退回服务端那份 + 轻提示指去「我的 → 编辑资料」** — `src/data/account.ts:2866`
   - 为什么：`void updateProfile().catch(emitApiError)` 全 app 没人听，远端 persist() 不落盘，这一发 PUT 是昵称的唯一真相（注册端点不收 displayName）：整个会话显示新昵称、冷启动退回用户名，用户读到「App 吞了我的昵称」；:2838 的 signUpWithPassword 是同形死码（全仓无调用方）。
   - 怎么改：:2866 保住「不阻塞注册跳转」（LoginPage 的 done() 紧跟其后）：请求 settle 后失败则把 local.name 退回 finishRemoteSignIn 认下的服务端那份 + emit() + showToast(t`账号建好了，昵称没存上 —— 去「我的 → 编辑资料」再填一次`, 7000)（Toast 挂在 App 根，活得过换路由）。:2838 signUpWithPassword 删掉或一并改；:2824-2825 注释改成写「为什么」；英文同 PR；用 ideahub-api-mem 拦掉 PUT /api/me/profile 验一次。
7. **[owasp-security-5] 自更新 fail-closed：清单缺 / 坏 sha256 一律不下不装** — `android/app/src/sideload/java/com/ideahub/branchvideo/AppUpdaterPlugin.java:312`
   - 为什么：expectSha 为空时直接改名、launchInstaller；Web 侧 checkUpdate :167 只要求 apkUrl、:204 传 `sha256 || undefined`。release.mjs 每版必写 sha，缺 sha 只可能来自转手逻辑回归 / 手改清单，没有理由放行（严重度 low，但零成本关口）。
   - 怎么改：appUpdate.ts:167 在 `!/^[0-9a-f]{64}$/i.test(info.sha256)` 时回 null，手动检查那条路说「更新清单不完整，稍后再试」；:204 不再 `|| undefined`；原生 downloadAndInstall（:207 / :312）缺 sha 一律 call.reject。不做 apkUrl 主机限制（撞 .env.production / release.mjs 的 APP_APK_BASE 决定）。
8. **[humble-delivery-1] release.mjs 把六件人工核对变成断言：APK 内容与受保护模型白名单、GitHub 包摘要、tag 树与 __BUILD_SHA__、权限表、jar 来源与 wrapper 校验；文档加「发错了」一节与 --withdraw** — `scripts/release.mjs:373`
   - 为什么：第 2 步只比版本号，「入口 js 等于本次 dist」「protected/ 只有 milltina」「GitHub 那份 APK 是同一份」「tag 落在 HEAD 树上」「权限表没漂（media3 带进的 WAKE_LOCK / ACCESS_NETWORK_STATE 文档没写）」全靠人眼，prune 是黑名单（新丢一个 .glbx 默认随包发）；2.51–2.55 连发五版没有止血步骤；QQ SDK jar 入仓无来源 / sha，wrapper 不校验发行包。
   - 怎么改：① 自有加密模型白名单放一个共用 scripts 小模块（release.mjs 与 prune-app-assets.mjs 都 import，docs/app-distribution.md:318 改指它）；第 2 步用 jszip 打开 APK：入口 assets/index-*.js 与 dist/index.html 比（只在首次发布核，重跑 `exists` 那支跳过）、assets/public/models/protected/ 不等于恰好白名单就 die，AAB 同跑。② 第 7 步后 `gh release view <tag> --json assets` 断言 size == manifest.sizeBytes 且 digest == sha256:+manifest.sha256（无 digest 退回 size + HEAD），不符 die 并提示 --clobber。③ 开头 fetch 后断言 HEAD 树 == origin/main 树且工作区干净（干净判定复用 scripts/worktree-changes.mjs 的 changesOf，不用 porcelain —— .po 的 CRLF 假 M 会拦住每次发版；首次发布才核，远端 tag 已存在时改断言 tag 树 == HEAD 树），`gh release create --target`；vite define 加 __BUILD_SHA__（短 sha + 按内容判的脏标记），印在 SettingsPage.tsx:437 版本号后与 build:app 末尾。④ `aapt2 dump permissions` 与入仓的 sideload / play 两份允许表逐条比、多一条就停；docs/play-store-checklist.md:22 期望表改成 7 条并注明来源（WAKE_LOCK / ACCESS_NETWORK_STATE 来自 media3、BILLING 有意、DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION 由 androidx.core 生成、Play 不需申报）与 AAB 由谁核。⑤ android/app/libs/README.md 记 open_sdk jar 的来源页 / 下载日期 / sha256 并在第 2 步旁核一次，gradle-wrapper.properties 加 distributionSha256Sum（.nvmrc / engines 不做：撞 build.yml:32 明文决定）。⑥ docs/app-distribution.md 加「发错了」三步（`gh release edit --prerelease` 止血、已更新的人退不回只能涨号 roll-forward、修好后保留 pre-release 归档）与 release.mjs `--withdraw v<版本>` 子命令，打印三条后果（退不回、带新 minVersionCode 的坏版门槛随之退回上一版、镜像坏包不删）。
9. **[wcag-a11y-i18n-1] 自绘控件壳补 ARIA：播放器大键与进度条、轻提示 live region、抽屉 / 确认卡的 dialog 语义与焦点、三条滑杆名字、点赞收藏 aria-pressed** — `src/components/SegmentPlayer.tsx:152`
   - 为什么：凡不用原生 button / input 自绘的控件 ARIA 一处都没有：aria-live 全仓零命中（读屏连删草稿后唯一的「撤销」都听不到）、role=dialog 只 2 个文件、SegmentPlayer 大播放键无名字、进度条是裸 div、三条 range 无 label、点赞 / 收藏只靠图标填色。补在那几个壳上一次收口，比逐页打补丁便宜。
   - 怎么改：SegmentPlayer :152 大播放键加 aria-label={t`播放`}（Icon :164 已 aria-hidden；:225 那颗 :237 已有名字，不动）；:216 进度条 div 加 role=slider tabIndex={0} aria-label={t`播放进度`} aria-valuenow/min/max + aria-valuetext={formatDuration(time)}、左右键走 seek，触控盒 `-my-2 py-2` → `-my-3 py-3` 并在注释写清与按钮行的重叠量（保住 219-221 的分界刻度）。Toast.tsx 外层常驻 role=status aria-live=polite aria-atomic=true，只换内容不随消息挂卸载，焦点落在「撤销」键上时暂停计时（6000 不改）。Sheet / ConfirmDialog / InfoDialog / DeleteConfirmShell 面板 role=dialog aria-modal=true aria-labelledby={titleId} tabIndex={-1}（Sheet 加可选 label），开窗 rAF 后 panel.focus()、关窗焦点回触发键（判 isConnected），Escape 顺手调 onClose，不给 #root 加 inert。CutPage.tsx:2110 播放头 aria-label={t`播放位置`} + aria-valuetext、:2877 配乐音量、SettingsVoicePage.tsx:156 语速各补 aria-label（对照 blockout/VisionFramePicker.tsx:200）。FeedPage RailBtn 收可选 pressed 输出 aria-pressed，点赞 / 收藏传 liked / saved；VideoPage.tsx:560 补 aria-pressed + 两态 aria-label（照 CommentSheet.tsx:209-210）。英文 msgstr 同 PR；浏览器里 read_page 看树。
10. **[martin-architecture-4] 唯一实现回潮三处收口：mock: 谓词、videos.ownerKey → deviceOwner、VolcCompatToggle.openHere → openExternal** — `src/studio/studioStore.ts:2439`
   - 为什么：2026-08-21 收口的 `!startsWith("mock:")` 又长回 studioStore :2432 / :2439（:2439 逐字就是 realVideoOfNode 的函数体）与 flowStore :4484，发布体的 videoByProposal 正是从这两行出来的；videos.ts:313 ownerKey 是 deviceOwner() 的第二份（DEV 顶替位盖不到点赞与待发布队列）；VolcCompatToggle.tsx:111 抄了 openExternal 自称「别再各抄」的那个 if，弹窗被拦时静默。
   - 怎么改：在 genNode 写 mock: 的那处旁导出 `isRealVideoUrl(u)`（占位串只在那一处出现），realVideoOfNode 与 studioStore.realVideoOf 改调它；:2439 改 realVideoOfNode(n)（studioStore.ts:12 那行 import 加个名字），:2432 与 flowStore:4484 用谓词；FuseFrameSheet:53 / flowStore:3654 判的是图片地址，不动。删 videos.ts:313 ownerKey，20 处改 import deviceOwner（videos 已 import 该模块的 mayClaimLegacy，无新环）。openHere 改 `try { await openExternal(url) } catch { setMsg(…); setQr(true) }`，browserFinished 监听留着。
11. **[martin-architecture-1] /api/tts 只经 api/support.synthesizeSpeech 一个网关：设置页与 studio/speech 的两份手拼 fetch 改调它** — `src/pages/SettingsVoicePage.tsx:67`
   - 为什么：四个调用方共用的那份在 res.ok 之后还查 content-type 以 audio/ 开头并抛带 status 的 ApiError；SettingsVoicePage :65-84 与 studio/speech.ts:272-292 各自手拼 token + withAppVersion + fetch、各用一套状态码判「没有云端嗓子」，都没有守卫 —— SPA 回退的 200 + HTML 会被当成音频（本仓最常见的静默故障形状）。
   - 怎么改：两处都改成 `await synthesizeSpeech(body, signal)`：speech.ts 用 blob.arrayBuffer() 喂 decodeAudioData，cloudOn 的关闭判据与设置页退回系统合成那一支一律 `e instanceof ApiError && [404, 501, 401, 403].includes(e.status)`。用 ideahub-api-mem（/api/tts/health 回 tts:false）在浏览器里把设置页试听与工坊 NPC 出声各走一遍。
12. **[mcconnell-performance-3] 简约模式播放器直连播放、截帧流后台取；画布浮层开着时 3D 桌面停帧、preserveDrawingBuffer 只在 DEV；首页缓冲线改 scaleX** — `src/pages/FlowPage.tsx:342`
   - 为什么：简约出片完要等整条成片 fetch 成 blob（120s 超时）才出画，失败只 console.warn 停在海报（剪辑页 CutPage:372-376 同坑已修、这一面没跟上）；FlowCanvas 不透明盖住时 TableScene 仍 frameloop=always 画 NPC / 弹簧骨 / 卡面轮播，preserveDrawingBuffer 正式包里没有消费方却逼每帧整屏拷贝；feed-buffer 关键帧动 width 每帧一次 Layout（严重度 low，改法两行）。
   - 怎么改：FlowPage :342 改 `useMediaUrl(realVideo)` 直连；:498-510 openAnnotator 要的同源截帧改用共用的一份「从 forCapture 流离屏截一帧」—— 把 SegPlayer.grab（:87-110）/ utils/videoFrames.loadVideoAt 抽成一处，别在 FlowPage 抄第二份；取不到时在圈选入口旁说一句（不再 console.warn）。StudioPage.tsx:251 `frameloop={canvasOpen ? "never" : "always"}`、`preserveDrawingBuffer: import.meta.env.DEV`（不动「画布是工坊里的浮层、不卸 3D」决定）。index.css:127 线固定 width 90%，关键帧改 transform: scaleX(0.18 → 1) + transform-origin center + will-change（★ 记一句圆角两端会被压扁、肉眼看不出）；CutPage / ProfilePage / StudioPage 三条 transition-all 进度条可选。
13. **[norman-interaction-2] 两面一致：画布「＋ 加一段」被拒时画成状态框而不是点了才报；工坊铸段窗档位接上一段；素材栏「/20 张」读常量** — `src/components/flow/FlowCanvas.tsx:807`
   - 为什么：末段没出片 / 是白模段时画布按钮恒亮、点了才由错误条说，工坊虚线卡位早按同一个 appendBlocked 不亮；freshEditor :916 把档位退回套餐默认、画幅却继承，电影级炼完第 1 段、第 2 段选法屏又回标准档；projection.tsx:923 手写 20，studioStore:924-926 自己记着这条欠账。
   - 怎么改：FlowCanvas 渲染时 `const why = appendIssue(st)`，非空就把虚线卡换成与「合成整片 · 还差 N 段」同形的非按钮状态框，只画前两档原因（busy 那档仍由 addNode 的错误条说，画布已有进度条，别同屏两处重复），store 闸原样。studioStore.ts:916 `videoTier: usableTierId(prev?.videoTier)`（与 FlowCanvas:812 同一函数，免费用户仍落到能用的档）。projection.tsx:923 改 `{slotCards.length}/{max} 张 · 同类型可多张`（max = EDITOR_SLOTS_MAX），lingui extract 换 msgid 并补 en.po，删 studioStore:924-926 那三行 ⚠。
14. **[feathers-testing-5] 构建检查补五件：cutGrammar 六个家族的反例、正则字符串形状闸推广、check-all.mjs、e2e 包保留 window.__ 缝、import 方向门禁** — `scripts/check-cut-grammar.mjs:128`
   - 为什么：trim / split / fade / voice / music_volume / end_fade 六个家族零反例，「片段2的闪黑」这种没动词的句子今天真会办；「正则写成字符串」的闸只装在 check-cut-grammar 一道；没有一个动词能单独跑全部检查；e2e 构建剥掉 __flow / __cut，装机验证只能经 CDP 手写 IndexedDB；import 方向只靠 CLAUDE.md（mock: 判据已回潮一次）。
   - 怎么改：check-cut-grammar.mjs 各家族补 no()：片段2切开 / 片段2去掉2秒 / 把片段2裁到 / 闪黑太长了 / 片段2的配音听着怪 / 配乐音量 / 片尾别淡出得那么快 / 片段2的闪黑，跑出 ops 非空的句式顺手收紧正则。共用形状检查只拦「new RegExp( 实参以引号或反引号开头、非 String.raw 前缀、且串里含未转义的反斜杠 + 字母」，.source 派生 / String.raw / 双写放行（shotScript.ts:323 那种模板串要过），装进 check-agent-grammar / check-ref-mentions / check-shot-script / check-cut-project 的 (a) 段，用 --module= 造一次真违规试红，注释写明管不到先存数组再 map 的写法。scripts/check-all.mjs 顺序 spawnSync 每道并汇总退出码与失败脚本名，package.json 加 check:all，build 串与 land 改调它（各道 npm 别名保留；共用 eq / moduleArg 的 lib 另议）。flowStore:4596 / studioStore:3087 / cutStore:124 / deviceOwner:151 守卫改 `DEV || MODE === "e2e"`（正式包一字不变），prune-app-assets 的 __flow 断言按 mode 分支，同 PR 改 CLAUDE.md「验剪辑页的合并」第 4 步。新增 check-import-direction.mjs（裸 node 扫 import：src/data 不 import studio / pages / components / hooks；flowStore.ts 不出现 studioStore；零依赖模块只 import type；pages / components 不直接 import @capacitor/，白名单 utils/）挂进 build 串。
15. **[krug-copy-ia-2] 文案四处收口：删卡 / 删卡组 / 删段芯片与入口键同词、待发布横幅去工程诊断、一键成片配音行印每天额度、素材抽屉空态走 EmptyState** — `src/components/DeleteCardDialog.tsx:54`
   - 为什么：卡片页键「删除这张卡」、确认卡危险键「删掉这张卡」（卡组同形）、canvasAgent 芯片「删掉某段」而它上一行注释指路「删除本段」；横幅把「请求体上限」「网关兜到静态页」念给用户，断网也落到那句；「现在免费」不说每天限量，额度不够第一次听说是在合成那一步；MaterialSheet 空态手拼绕开 EmptyState。
   - 怎么改：DeleteCardDialog.tsx:54 → t`删除这张卡`（:53 标题可跟「删除「X」？」）、DeleteDeckDialog.tsx:29 → t`删除这个卡组`、canvasAgent.ts:108 → msg`🗑 删除某段`；英文不动；CutPage「删除片段」/ DeleteSegBtn「删除本段」保持（不同对象），整目录往哪个词收归 ux-review #17 由主人定。videos.ts:2568 network → 「上传没成功（网络断了，或者作品太大、传到一半被掐断）」、:2564 bad-shape → 「服务器没有收下这条作品」（可加「一直这样就把这句话发给客服」，不写原因；出路横幅 :1247 已有，不重复），诊断留 console。AutoEditSheet.tsx:253 → 「用完就配音（{voiceName}，现在免费 · 每天 {voiceFree} 字）」/ 英文 (…, free for now · {voiceFree} characters a day)，不写「还剩」（voiceFree 是上限不是余量；「现在」两处 :253 与 CutPage:2783 都留着，去留交主人）。MaterialSheet.tsx:180-186 空态换 `<EmptyState compact …>` 用 :240 / :265 现有两组文案（横轨那行不动）。lingui extract + en.po。

### 提案（22 条，要主人拍板）

- **[sommerville-requirements-1] 480p 单价与高清 r2v 系数随 2.62 上线后从未对过真账单，注释仍写「上线前跑一发核」**（Sommerville 式需求与范围审查员）
  - 为什么：videoTierTable.ts:34 / :104 与 docs 都写着「还没对过账单」，而草稿档自 10-08 起是免费用户唯一的档、HD_R2V_MULT = 14/15 同版上线；两个数直接决定实扣与报价是否相等。
  - 要定的事：请主人从方舟费用中心取 10-08 之后一条草稿档 480p 纯任务与一条高清重拍任务的账单行（任务号 + 单价），对 perSecTokens 那张表与 HD_R2V_MULT 各核一次；核上把日期 / 任务号写回两行注释与 api-contract「跨仓核对」表，核不上两仓一起改系数。
- **[sommerville-requirements-2] api-contract 的 r2v 一节落后于 2.62：reference / extend 两种 task_type、第四种来源、高清 r2v 系数都没写**（Sommerville 式需求与范围审查员）
  - 为什么：契约仍写「只有两条来源、首发只有 2.5、omni_reference_task_type 必须是 edit」，arkClient.refTask 已是四种，server#107 / #108 已上线；改契约形状的两个提交都没动 api-contract.md，契约失去验收依据的资格。
  - 要定的事：补写要逐条对照 server#107 / #108 的 spec 抄（跨仓文档，别凭 App 侧注释写）：这一轮由谁核、是否同时把 VIDEO_MULT_R2V 加 2.0 mini = 14/15 那行与 extend 的参数钉子（adaptive + 窗口内整数时长、(输入+输出)×系数）一并写进去。
- **[sommerville-requirements-3] 第一批（特效 / 对话正反打 / 修这一段）只在开发构建直连方舟验过，正式路径发版后无结案记录；过肩人数复核「要主人定」仍悬着**（Sommerville 式需求与范围审查员）
  - 为什么：docs §九「还欠」四条在 2.62 发版后没有一条改成「已核 / 已定」；DialogueWizard 第③步没有「看一眼人数」的提醒。
  - 要定的事：① 主人从服务端日志各挑一条真延长 / 真重拍任务写进 §九结案（日期、任务号、实扣是否 = (输入+输出)×系数）；② 过肩机位多画出一个人：只在第③步画完后加一句「看一眼每张里是不是只有该出现的两个人」（不花钱），还是加看图复核（花钱）。
- **[sommerville-requirements-8] MAX_DRAFTS = 20 有理由（IndexedDB 配额）但没有量法，而被淘汰的草稿直接 idbDel 零提示**（Sommerville 式需求与范围审查员）
  - 为什么：「几 MB 到几十 MB」与「配额」都没量过，同仓同类常数都带量法；这个数直接决定哪些付费段的备份会悄悄消失。
  - 要定的事：在主人的真机上量一次 navigator.storage.estimate() 的配额与一条带帧草稿的中位体积并写在常量旁；若配额远大于 20 × 中位体积，是否改成按字节预算淘汰、或至少在淘汰那一拍给一条轻提示。
- **[wcag-a11y-i18n-2] 首页进度条能点中的只剩 14px（底栏盖住 6px），且不是滑杆控件**（WCAG / Material 式无障碍与国际化审查员）
  - 为什么：触控盒 h-5 紧贴五个页签，无 role / 键盘 / 读屏值；但底缘 50 / 86 / 104 三个数是联动量过的，不能按原话直接 h-5 → h-8。
  - 要定的事：二选一：把时长文字改成绝对定位钉在 86px 不随盒子走、只把触控盒往上长并加 role=slider + 方向键走 seekGlobal；或三个数在真机上一起重量后一并改并把量法写进注释（effort M，按 CLAUDE.md「动了首页底缘」那格一起重算）。
- **[wcag-a11y-i18n-5] 工作流画布的缩放只有两指捏合与滚轮，没有单指 / 按钮替代**（WCAG / Material 式无障碍与国际化审查员）
  - 为什么：全仓唯一没替代的多点手势（WCAG 2.5.1）；单指平移与底部节点条都在，影响是「缩放没替代」而非内容不可达。
  - 要定的事：与 ux-review 第 2 条一并定「复位 1:1 / ＋ / −」三颗键摆哪儿、什么形状（主打复位的通用价值）；定了按 onWheel 同一段算法以容器中心为锚，走 liveView + reanchor + setView 三步落。
- **[wcag-a11y-i18n-6] slate-600（2.50:1）与 slate-500（3.98:1）被当小字正文 / 提示 / 占位用**（WCAG / Material 式无障碍与国际化审查员）
  - 为什么：与 CLAUDE.md 显式字色约定冲突，逐处绕开会被「字色只用刻度」查法打回，只能改约定再全仓收口。
  - 要定的事：是否改 CLAUDE.md 口径：≤12px 的说明 / 占位 / 副标题改 slate-400，slate-600 只给装饰（含 EmptyState:74 这类约定点名的格），并加「text-slate-600 不与 text-xs / text-[9–12px] 同行」的棘轮查法；slate-500 那半不动，除非主人改口径。
- **[feathers-testing-1] flowStore 里的钱闸判据（tpl 三态 / nodeCarry / nextStartFrame / clampCursor）不可被脚本 import，坑表里最贵的几格零回归用例**（Feathers / Beck 式可测性与回归面审查员）
  - 为什么：flowStore import 了 lingui t 与 ../ai，18 道脚本没有一道能 import 它；真正零用例的是 tpl 三态兜底、承接判定、两把尺报价三格（usableFrames / noDrawFor 的核心判据已在 drawPlan 被钉住）。
  - 要定的事：第一刀范围：把已经纯的那七个函数（连 nodeDone / chosenOf / planOf、并 export nodeCarry）原签名搬进零依赖文件、flowStore 原名 re-export，新脚本只钉 pinUnstatedTpl / clampCursor / nodeCarry / usableFrames，tplOfNode 的 store 读留在 flowStore；appendBlocked / appendIssue 回原因码、nextStartFrame 显式入参两处要不要做；同一 PR 改 CLAUDE.md 里的点名。effort L、risk 中。
- **[feathers-testing-2] 并发规则（genRun 令牌 / canReplaceNodes / 取消循环）与中层（db / boot / videoJobs）零自动保护**（Feathers / Beck 式可测性与回归面审查员）
  - 为什么：今天 12 处 busy:false 全挂着 genRun === myRun（不是现存缺陷），但没有会变红的闸；db.idbRead / boot 冻结写 / videoJobs taken 名单只有手工造故障的记录。
  - 要定的事：要不要引一个能 mock ../ai 与 lingui 的 runner（基建）。在那之前两刀不需决定可随时做：check-gen-run.mjs 结构检查（含 genRun: myRun 的函数体里 busy:false 必须在 genRun === myRun 条件之后，照 check-hook-order 先造真违规试红）；scripts/check-db.mjs 手写 indexedDB.open 桩（永不 settle / reject / 成功三档），不加 vitest / fake-indexeddb，不动 videoJobs 惰性化。
- **[feathers-testing-8] 原生 Gain / TailFade / 秒→微秒换算是纯算术却锁在插件私有类里，android/app/src/test 只有 2+2**（Feathers / Beck 式可测性与回归面审查员）
  - 为什么：这组 JVM 单测钉的是 Gain / TailFade / secToUs 的回归，不是 CLAUDE.md 记的两次原生事故（那两次不在这几个类里）；严重度 low。
  - 要定的事：是否给原生层开 JVM 单测：抽 `static long secToUs(double)` 统一 :843-844 的夹零，只给 Gain / TailFade 写 JVM 单测（不动 FadeRgb、不挂进 build:app），与 CLAUDE.md 的 ★ 注释一起搬。
- **[humble-delivery-3] 提交门禁只编译 web 一半：原生插件的 Java 改动合进 main 不经 gradle**（Humble / Farley 式交付与运维审查员）
  - 为什么：09-01 以来 19 条提交动了 android/.../java，ruleset 要求的 build 检查对它们恒绿，编译错要到发版那天才暴露。
  - 要定的事：先只在 build.yml 加一个 assembleSideloadDebug job（不设 required、timeout-minutes 跟着放宽）跑两周看时长；之后是否加进 ruleset 的 required_status_checks —— 那会把 land 等 CI 从约 90 秒拉到 gradle 冷启动的 5~10 分钟，是工作流节奏的取舍。
- **[humble-delivery-4] 客户端三类失败（更新失败 / 本地库损坏 / 渲染白屏）零上报，事故全靠主人真机撞上**（Humble / Farley 式交付与运维审查员）
  - 为什么：唯一进服务端的客户端信号是 X-App-Version；2.51–2.55 五版白屏发出去 5 天，日志里没有一行能看出来。
  - 要定的事：跨仓：是否加 POST /api/client-events {kind, version}（window.onerror / unhandledrejection + update-failed / idb-dataloss / boot-blocked 各一次；像 X-App-Version 一样只进日志不做判断、按 IP 限流、不带账号与 message 原文），先写进 api-contract.md、server 先发。
- **[norman-interaction-5] 「🗑 删除本段」没有撤销：没花钱的段一点就没，花过钱的只有 3 秒二次点按**（Norman / Cooper 式触屏交互审查员）
  - 为什么：删草稿已改成「先删再撤销」，删段没跟上；removeNode 只是 filter + delete alts[id]，写好的要求 / 分镜 / 挂的卡 / 临时参考图一起没了。
  - 要定的事：是否按「先删再撤销」改：removeNode 把被删节点 + 下标 + alts[id] 停进 flowStore.segTrash，两面删完 6 秒「撤销」；done / derived 的 3 秒二次点按保留（10-14 口径：花过钱的东西确认与撤销两道都在）；restore 在 busy / generating 时整句拒、只剩一段的规则照 nodeRecastable。effort M、risk 中。
- **[krug-copy-ia-1] 剪辑页同一件事两个词：主键「合成」、取消 / 失败 / 回执「合并」，英文译成三个词，「合成」又兼指配音合成**（Krug / Nielsen 式信息架构与文案审查员）
  - 为什么：10-14 主键刚定成「合成并去发布」，另一端还留在「取消合并 / 合并失败 / 已取消合并」上；CLAUDE.md 与 cutProject 注释一律写「合并」；「合成中…」与 CastPreviewCard / 融图共用一个 msgid。
  - 要定的事：二选一由主人定：保留刚定的「合成」并把「配音合成」改口，或随代码注释一律「合并」；英文随之统一成 merge；「合成中…」要先拆 context 才能单独译成 Merging…（不能只改 msgstr）。
- **[owasp-security-1] 第三方登录深链回程没有 state 绑定：任何 App / 网页投一条 ideahub://oauth?token= 就能把用户换成别人的登录态**（OWASP MASVS 式安全与隐私审查员）
  - 为什么：parseDeepLink 对任何带 token 的 ideahub:// 直接返回、Bridge 直接 signInWithOauthToken；垃圾 token 也会先覆盖 localStorage 里的 JWT 再被 401 清掉、静默登出；微信原生那条有 loginState 校验，网页 OAuth 这条没有。
  - 要定的事：跨仓（先改 api-contract、server 先发）：startOauth 用 crypto.getRandomValues 生成一次性 state（带时间戳存 localStorage）交给 /api/auth/oauth/:provider，服务端 302 原样回带（老 App 不带就不回带，向后兼容），App 对不上 / 缺失 / 过期一律丢弃并清记录，?error= 文本同样只在 state 对上时上屏；App 侧是否先加一道「本机近期确实调过 startOauth 才收深链」的闸（窗口多长）。
- **[owasp-security-3] 生产 CSP 的 connect / img / media-src 放行任意 https:，「域名固定后收窄」从未兑现（引用的 security-checklist.md 不存在）**（OWASP MASVS 式安全与隐私审查员）
  - 为什么：XSS 之后没有第二道墙；收窄同时能在 App 层堵住社区 Live2D 包外链。漏一个域名的症状是图片 / 视频静默不出。
  - 要定的事：白名单范围先限 connect-src，域名表以服务端 videoAsset.service 为准，补 MiniMax、方舟临时链接 *.volces.com / *.volccdn.com、Cloudinary、三家登录头像 CDN（qlogo.cn / Google / GitHub）；装机把出片 / 直传 / 市场换装 / 真人档各走一遍。vite.config.ts:247 的死引用与 :245-246 注释可随手改成当前决定。
- **[owasp-security-6] 社区 Live2D 包的 Motions / Expressions / Physics / Sound 引用按 new URL(ref, base) 解析，可指向外域（追踪像素）**（OWASP MASVS 式安全与隐私审查员）
  - 为什么：贴图外链会被服务端 inspectModel3Json 拒收，过得去的是动作 / 表情 / 物理 / 声音这几类引用，prefetch 与舞台加载都会去拉。
  - 要定的事：主修在服务端 live2dBundle.service.js:231 resolveRef（显式拒 scheme / 以 / 开头 / data:，并让 Physics / Pose / Expressions / Motions / Sound 同走它，跨仓先发）；App 侧是否顺带在 CompanionModel.acquire 调 Live2DModel.from 之前预检 model3.json（规则复用 bundlePreview.resolveInZip）并在 prefetch 里把丢弃的引用说出来。
- **[mcconnell-performance-1] 开机静态拉进 vendor-3d 2.95MB + App 1.98MB，全仓零 React.lazy；vite.config 的注释与产物相反**（McConnell / Nygard 式性能量测审查员）
  - 为什么：Capacitor 包里代价是解析 / 求值不是下载，V8 code cache 会减轻二次启动，量级没量过；结构上首页路径确实等着 3D 块。
  - 要定的事：先量：真机 chrome://inspect Performance 录三次冷启动看 vendor-3d / App 的 Compile+Evaluate；量到几百毫秒以上再做 lazy（范围必须含 CardDetailPage / CardHologram，先给 lazy 边界一个 bootError 样式的失败屏，check-bundle 放到那之后装）。不论量到多少都可做的零风险一刀：把 ammojs-typed 从 vite.config.ts:339 的 vendor-3d 正则拿掉让 rigidBones 的动态 import 真成独立 chunk，并把各 chunk 体积打印进构建日志。
- **[mcconnell-performance-4] mediaUrl 的 objectUrlCache 无上限、从不 revokeObjectURL：剪辑页每段的截帧流 blob 钉到文档卸载为止**（McConnell / Nygard 式性能量测审查员）
  - 为什么：cap: 条目是 fetch 回来的 blob，objectURL 把 Blob 钉住无上界；但这份缓存同时起去重作用，简单 LRU 会丢掉它。
  - 要定的事：先按 dumpsys meminfo 在 6 段草稿进出剪辑页前后各量三次；释放策略按消费者生命周期而不是条数：CutPage / FlowPage / CoverPicker 卸载时 release，同一地址多消费者计数，不许 revoke 还被 <video> / 标注器引用的地址，idb: 那类照旧。effort M、risk 中。
- **[mcconnell-performance-7] FlowCanvas 拖动时每个 pointermove 改整屏网格的 background-size / position，整屏重新光栅化**（McConnell / Nygard 式性能量测审查员）
  - 为什么：与文件头「只动 transform」不符，但没量过；舞台那一层的 transform 与 reanchor 已做对。
  - 要定的事：先在真机 Rendering → Paint flashing 下拖一次画布，整屏闪绿再改：网格铺成比视口大两格、拖动只写 transform: translate(tx mod cell, …)、缩放的 backgroundSize 只在抬手提交那一拍改一次；★ 里记下「捏合期间点阵不跟着缩放、抬手才对齐」的取舍。
- **[mcconnell-construction-3] mergeAndGo 502 行、14 个 await，「已取消」收尾逐字抄了 4 份（catch 里第 5 份形状不同）**（McConnell 式构建质量审查员）
  - 为什么：每个 await 前的取消检查点是 CLAUDE.md 那格刻意加的，数目一个不能少；抽阶段函数要在模拟器上跑多段稿子验。
  - 要定的事：(a) 四份取消收尾 + catch 里第五句收成一个 bailCancelled()（S / low），搭任何已经要跑模拟器合并验证的 CutPage PR；(b) transferArkSegs / measureUnknownLens / stageAudioInputs / landMergedDraft 的抽取要不要做 —— risk 中、effort M，前提是按「验剪辑页的合并」在模拟器上跑多段稿子并在转存轮询与配乐落盘两个阶段各按一次取消。
- **[mcconnell-construction-5] refreshRemoteTemplate 三份手写块（mine 两段 + shared 一段）重做 apiToTemplate 已做过的字段解析**（McConnell 式构建质量审查员）
  - 为什么：CLAUDE.md 把「四处一起改」记成现行约定，这是对既定做法的提案；直接循环 fresh[k] !== undefined 会改掉 markBoxes / markDescs 按本机清单长度校验、markBoxAtSec 写入条件两处语义。
  - 要定的事：是否改做法：纯函数 `syncMineFromRemote(local, fresh) → patch` 放零依赖模块 + 新 check 脚本用「回包 → mine 更新」夹具钉住四种特例（框随清单成对搬、本机清单长度兜底、无 refVideo 仍校准 published、realDurationSec 只回写 refVideo 那一位），shared 分支同批改；risk 中、effort M~L。

### 并入 / 丢弃（35 条）

- nygard-reliability-4：与 norman-interaction-1 同一处代码（ScriptSkillSheet.tsx:82 / ThemeRewriteSheet），已并入那条（park + 票据）。
- nygard-reliability-5：与 norman-interaction-6 同一处代码（account.ts:2866 / :2838），已并入那条。
- nygard-reliability-3：并入 nygard-reliability-1 一起做（同一类集成点超时：client.ts body 读 + uploadAvatar；HoldToTalk / portrait / viewSourceBlob 按「停了多久」先量再定，不照原话加 20 秒 signal）。
- gof-domain-model-5：与 martin-architecture-4 同一处代码（studioStore:2432 / :2439、flowStore:4484 的 mock: 判据），已并入。
- mcconnell-construction-6：与 martin-architecture-4 同一处代码（mock: 判据），已并入；isRealVideoUrl 放在写 mock: 的那处旁。
- martin-architecture-2：并入 martin-architecture-4 一起做（同一类「唯一实现回潮」，VolcCompatToggle.openHere 改调 openExternal）。
- martin-architecture-3：并入 martin-architecture-4 一起做（videos.ownerKey → deviceOwner，20 处 import）。
- martin-architecture-8：并入 feathers-testing-5 一起做（check-import-direction.mjs 与其它构建检查脚本同一个 PR）。
- norman-interaction-4：并入 mcconnell-construction-1 一起做（同一把尺：ModePicker 的 derivePrice 由宿主算一次传进来）。
- norman-interaction-3：并入 norman-interaction-2 一起做（两面一致：freshEditor 档位改 usableTierId(prev?.videoTier)）。
- norman-interaction-8：并入 norman-interaction-1 一起做（live2d-publish / card-mint 两张票加 5 秒心跳；XHR 百分比与 addCards 逐张进度另立 M 级提案，这里不列）。
- mcconnell-construction-7：并入 norman-interaction-2 一起做（projection.tsx:923 的 20 改读 EDITOR_SLOTS_MAX，顺手删 studioStore:924-926 的欠条）。
- mcconnell-construction-4：并入 gof-domain-model-2 一起做（CutPage 同一文件，:627-634 / :1387-1392 过期的 MediaRecorder / AudioContext / muted 注释改成现状）。
- mcconnell-construction-8：并入 mcconnell-construction-1 一起做（FlowCanvas:1168 随 deriveCostOf 改、线性视图口径、五处 2026-09-XX 填 2026-09-03、Card.tags 互指）。
- gof-domain-model-7：并入 mcconnell-construction-1 那批注释改动（types.ts:1002 degraded 改成现状，与 flowStore.usableFrames:782 与 :4389 互相点名）。
- sommerville-requirements-7：并入 nygard-reliability-1 一起做（docs/backlog.md:1047 改「已做」、:1037 改指原生 mp4 转存，两行文档）。
- gof-domain-model-3：与 krug-copy-ia-1 同一处（剪辑页合成 / 合并），并入那条提案；按核验这是文案决定、不当场改。
- feathers-testing-3：并入 feathers-testing-2 提案（同一个「要不要引能 mock lingui 的 runner」决定；db.ts 那片 S 级手写桩不等 runner 可先做，已写在那条里）。
- feathers-testing-4：并入 feathers-testing-5 一起做（正则字符串形状闸推广到四道脚本，按核验改判据放行 .source / String.raw）。
- feathers-testing-6：并入 feathers-testing-5 一起做（只做 check-all.mjs + check:all；共用 eq / moduleArg lib 降为另议）。
- feathers-testing-7：并入 feathers-testing-5 一起做（四处守卫改 DEV || MODE === e2e、出包闸按 mode 分支、同 PR 改 CLAUDE.md 第 4 步）。
- wcag-a11y-i18n-3：并入 wcag-a11y-i18n-1 一起做（Toast 常驻 live region + 焦点落在「撤销」键上时暂停计时，6000 不改）。
- wcag-a11y-i18n-4：并入 wcag-a11y-i18n-1 一起做（四个壳的 dialog 语义与焦点，去掉 #root inert）。
- wcag-a11y-i18n-7：并入 wcag-a11y-i18n-1 一起做（三条滑杆 aria-label，路径按核验更正）。
- wcag-a11y-i18n-8：并入 wcag-a11y-i18n-1 一起做（RailBtn pressed、VideoPage:560 aria-pressed + 两态 aria-label）。
- humble-delivery-2：并入 humble-delivery-1 一起做（release.mjs 第 7 步后核 GitHub 资产 size + digest）。
- humble-delivery-6：并入 humble-delivery-1 一起做（docs「发错了」一节 + --withdraw 子命令，三条后果照核验写）。
- humble-delivery-7：并入 humble-delivery-1 一起做（HEAD 树 == origin/main 树、干净判定复用 worktree-changes.changesOf、--target、__BUILD_SHA__）。
- humble-delivery-8：并入 humble-delivery-1 一起做（jar README + sha 核对放 release.mjs 第 2 步旁、wrapper distributionSha256Sum；.nvmrc / engines 不做）。
- owasp-security-4：并入 humble-delivery-1 一起做（权限期望表改 7 条并注明来源、aapt2 dump permissions 与两份允许表逐条比）。
- mcconnell-performance-2：并入 mcconnell-performance-3 一起做（StudioPage frameloop never / preserveDrawingBuffer 只在 DEV）。
- mcconnell-performance-5：并入 mcconnell-performance-3 一起做（feed-buffer 线改 scaleX；严重度 low，两行改动）。
- krug-copy-ia-3：并入 krug-copy-ia-2 一起做（videos.ts:2564 / :2568 两句按核验改成只说已知的事）。
- krug-copy-ia-4：并入 krug-copy-ia-2 一起做（AutoEditSheet:253 印每天额度、不写「还剩」）。
- krug-copy-ia-5：并入 krug-copy-ia-2 一起做（MaterialSheet 空态改 EmptyState compact；横轨那行按核验不动）。

## 五、落地记录（2026-10-15）

15 簇全部动了：7 个执行 agent 按文件分工并行（各自只读上面的工作单、不跑构建、不碰 git），我做路由级 ErrorBoundary 与收尾。构建全绿：tsc、lingui extract、20 道检查（含同日新加的 `check-import-direction`）、en.po 缺译 0；剪辑台句式 341 条（+7 条反例 + 「片段2的闪黑」）。

| 簇 | 做了 | 没做 / 取舍 |
|---|---|---|
| 1 ErrorBoundary | `components/ErrorBoundary`（class，只换 key 重挂子树、按 pathname 复位、不 reload）：App 的 `<Routes>`、3D 桌面、导演台、卡牌全息、工作流画布 portal 各一层；3D 桌面那层顺带加了 `SceneClockKeeper`（r3f 切 frameloop 会把 three 时钟归零，飞卡与碰撞体按绝对时间记起点） | 接不住 `useFrame` 里抛的错（那是 CLAUDE.md 原有那条）；没有崩溃上报（提案 humble-delivery-4） |
| 2 技能面板 | `studio/skillSheetStore`：两张付费面板的状态进模块级 store、按人暂存、busy 时遮罩 / ✕ 只收起不丢；领票 + 5 秒心跳（`jobs.heartbeatJob` 一处实现）；Live2D 发布票与铸卡上传票同样心跳 | 分块直传 / XHR 百分比、addCards 逐张进度另议；胶囊回来不会自动重开面板（通知里把路说清） |
| 3 真人档超时 | `minimaxVideo` 三发各带 `AbortSignal.timeout`（数从 server 路由的预算加余量）并归 `ArkNoReply`；`api/client` 正文读也在超时内、失败分型不变；HoldToTalk / uploadAvatar / portrait / viewSourceBlob / 下载 HEAD / companion.json 六处裸 fetch 加上限（各记量法）；backlog 两行改「已做」 | 取件那一发没收到回包更准的类型是 `ArkTaskUnknown`（产物还在，行为改动另议）；`SupportModelsPage` 调 `prefetchLive2dModel` 没传 signal（另议） |
| 4 价签单尺 | 推演价签全部读 `flowStore.deriveCostOf`（FlowCanvas ×2、canvasAgent ×2、FlowPage）；`ModePicker` 必填 `derivePrice: { tokens, carried }` 由两个宿主各算一次；五处「2026-09-XX」填成 2026-09-03（`git log -S`）；`Card.tags` / `VideoItem.tags` 互相点名；`degraded` 注释改现状并抽出 `placeholderFrames` | — |
| 5 圈选重拍 | `CutPage.reshootAnns`：按 `tierOf(videoTier).flf` 只改前半段，报价与真跑同一判据，busy 行说清后半段只进文字；真人档整句拒（判据 `providerOf === "minimax"`，与 segmentGen 同一个路由谓词）；两段过期的录屏注释改现状 | GenSpec 加 `reshoot` 模式走 composeSegments（L，提案） |
| 6 注册昵称 | `account.settleSignUpNick`：PUT 不阻塞跳转，失败退回服务端那份 + 轻提示 | `signUpWithPassword` 全仓零调用方，没删（等主人定） |
| 7 自更新 | 清单 sha256 不是 64 位 hex → 不下不装（Web 三处 + Java 三处，fail-closed） | 不限 apkUrl 主机（撞 .env.production / release.mjs 的镜像配置） |
| 8 发版链路 | `release.mjs`：第 0 步 HEAD 树 == origin/main 树 + 工作区按内容干净（`--dry` 只警告）；2b 开包核入口 js 与受保护模型白名单（`scripts/lib/protected-models.mjs`，prune 出包闸同一份）；2c 权限表（aapt2 可用时）；2d jar 来源（`android/app/libs/README.md`）；4c versionCode 压过所有 pre-release；7b GitHub 资产 size + digest；`--withdraw <tag>`；`gh release create --target`。`.nvmrc` / `engines` / wrapper `distributionSha256Sum`；docs「发错了」一节、权限期望表 8 行 | 工作单原文说 .nvmrc / engines 不做，我按「隐含约定写成机器可读」做了；`__BUILD_SHA__` 没做；AAB 权限走合并清单不走 bundletool |
| 9 ARIA | `Sheet.useDialogShell`（四个壳共用：dialog 语义、焦点进出、Escape）；Toast 常驻两个 live region + 焦点落在「撤销」上停计时（`toast.pauseToast`）；`SegmentPlayer` 进度条是真滑杆（方向键、Home/End）；`RailBtn` / 作品页点赞 `aria-pressed`；三条滑杆名字 | 作品页点赞按更正给了两态名字（APG 建议切换键名字不随状态变，想严格就固定成「点赞 · N」） |
| 10 唯一实现回潮 | `flowStore.isRealVideoUrl` / `MOCK_VIDEO_URL` 一处，studioStore / takeJob 改调；`FuseFrameSheet` 与 `imageOf` 去掉对图片地址的 mock 判断（占位串只进 videoUrl）；`videos.ownerKey` → `deviceOwner`（21 处）；`VolcCompatToggle.openHere` → `openExternal` | DEV 的 `__deviceOwner` 顶替要等下一次账号事件才被 videos 那段看见（正式包不受影响，注释写了） |
| 11 TTS 一个网关 | 设置页与 `studio/speech` 都走 `api/support.synthesizeSpeech`；关云端语音的判据只剩 `speech.noCloudVoice`（404/501/401/403）；`TTS_SENTENCE_MS` 导出 | — |
| 12 性能 | 简约播放器直连（`useMediaUrl`），截帧只剩 `components/videoFrames.grabVideoFrame` 一份（SegPlayer / FlowPage 共用），取不到在入口旁说；浮层盖住桌面时 `frameloop="never"`、`preserveDrawingBuffer` 只在 DEV（全仓只有 DEV 的 `__r3fCapture` 读像素）；首页缓冲线改 `scaleX` | StudioLoader 的 `transition-all`、CutPage / ProfilePage 两条进度条（可选）；懒加载 / objectURL LRU / 网格光栅按更正先量再动（提案） |
| 13 两面一致 | `flowStore.appendIssueStatic`（appendIssue 的前两档）→ 画布「＋ 加一段」被拒时画成状态框；`freshEditor` 档位接上一段（`usableTierId`）；素材栏「/N 张」读 `EDITOR_SLOTS_MAX`；`__flow` 等四处守卫改 `DEV \|\| MODE === "e2e"`（含 `deviceOwner()` 本身的谓词） | 没抽共用的 DEBUG_HOOKS 常量：Vite 只对原地的 `import.meta.env.*` 做静态替换 |
| 14 构建检查 | `check-cut-grammar` +7 反例 + 「片段2的闪黑」（`ZH_FADE` 加 `(?<!的)`）；`scripts/lib/regex-shape.mjs` 装进五道脚本；`check-all.mjs` + `npm run check:all`；`check-import-direction.mjs`（规则①②③，49 个文件 0 违规；`recipe.ts` 按 CLAUDE.md 原话「零 store 依赖」只禁 studio） | 规则④「pages / components 不直接 import `@capacitor/`」没装：现状 CutPage 一处（另议） |
| 15 文案 | 删卡 / 删卡组标题与危险键同用「删除」；canvasAgent「🗑 删除某段」；待发布横幅两句只说已知的事；一键成片那行印每天额度（保留「现在免费」）；素材抽屉空态走 EmptyState | 「合成 / 合并」要主人定（提案 krug-copy-ia-1） |

执行中冒出来、等主人定的（提案之外）：`signUpWithPassword` 删不删；真人档取件那一发的类型；`prefetchLive2dModel` 的 signal 与预算；import 方向规则④；作品页点赞名字随不随状态变。

**验证**：`npm run build` 全绿（tsc、lingui extract、20 道检查、en.po 缺译 0）。浏览器（离线 mock，375×812）：工作流画布的「＋ 加一段」在首段没出片时画成「先把这一段炼出来，再铸下一段」的状态框、「🎲 推演三套方案」印的是 deriveCostOf 的价；两个轻提示 live region 常驻；把 `nodes` 换成非数组逼画布抛错 → 路由级边界画出「这一页没画出来 + 错误原文 + 重载 / 回首页」，恢复状态后点「重载这一块」画布回来；作品页点赞键的名字是「点赞 · 0」并带 aria-pressed。真机 / 模拟器没验（发版脚本的新断言要在下一次 `npm run release` 时第一次真跑）。
