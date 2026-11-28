# @shware/workflow 与同类 user journey 产品的功能对比

截至 2026-11-28。

## 结论

编排核心已经和 Customer.io、Braze 同级，缺的集中在发送治理和运营工具两块。

- **已经齐全**：事件、分群、定时三种触发，延时、时间窗口、等待条件、多路分支、随机分流，重入策略，目标转化，订阅偏好和一键退订，打开点击追踪。
- **比同类强**：类型检查、版本固定、投递语义、自定义代码步骤、本地可测、数据自持。
- **最该补的两项**：跨流程频次上限，以及退信和投诉的自动抑制。两项都是托管产品的标配，缺了会直接伤到发信信誉。
- **其次**：全局免打扰时段、测试发送和暂停开关、按分支的实验报表、按日期属性和周期性的触发。
- **有意不做**：可视化画布编辑、发送时间优化、摘要合并。

## 对比对象与口径

对比的是六个产品的 journey 编排能力，不比较它们的邮件编辑器、CDP 或广告受众同步。

| 产品                 | 定位                     | 为什么选它                                                        |
| -------------------- | ------------------------ | ----------------------------------------------------------------- |
| Customer.io Journeys | 面向 SaaS 的营销自动化   | 事件驱动、开发者友好，SDK 的 re-entry 和 segment 触发规则参照过它 |
| Braze Canvas         | 企业级跨渠道编排         | 功能最全的基准                                                    |
| Iterable Journeys    | 企业级跨渠道编排         | 与 Braze 同档，节点模型清晰                                       |
| Klaviyo Flows        | 电商营销自动化           | 中小团队最常用                                                    |
| OneSignal Journeys   | 以推送为主的轻量 journey | 与 SDK 的推送能力最接近                                           |
| Knock Workflows      | 面向开发者的通知基础设施 | 唯一同样支持“工作流即代码”的同类                                  |

- **SDK 一列**取自 `@shware/workflow` 主干的 README 和源码，截至本文日期。
- **其他产品**取自各家官方文档，链接在文末“来源”里；这次没有查到对应段落、凭既有了解填写的格子带 °。
- **标记**：✓ 内置；◐ 能做到但要自己写代码或有明显限制；✗ 没有。

## 功能对比表

带 ° 的格子凭既有了解填写，这次没有查到官方文档的对应段落。

### 触发与进入

| 能力                                      | SDK | Customer.io | Braze | Iterable       | Klaviyo        | OneSignal          | Knock              |
| ----------------------------------------- | --- | ----------- | ----- | -------------- | -------------- | ------------------ | ------------------ |
| 事件触发，带负载条件和资料过滤            | ✓   | ✓           | ✓°    | ✓°             | ✓              | ✓                  | ✓                  |
| 进入分群时触发                            | ✓   | ✓           | ◐°    | ◐°             | ✓              | ✓                  | ✓°                 |
| 定时群发（一次）                          | ✓   | ✓           | ✓°    | ✓°             | ◐° 走 campaign | ◐°                 | ✓                  |
| 周期性重复进入                            | ✗   | ✓           | ✓°    | ✓°             | ✗°             | ✗°                 | ✓°                 |
| 按用户的日期属性触发（生日、到期前 N 天） | ✗   | ✓           | ◐°    | ◐°             | ✓              | ◐°                 | ◐ 相对时间戳延时   |
| 重入策略：一次、退出后、并发，带冷却期    | ✓   | ✓           | ✓     | ✓ 另有最大次数 | ◐°             | ✓ 冷却至少 10 分钟 | ◐ 用 throttle 近似 |
| 目标转化与提前退出条件                    | ✓   | ✓°          | ✓°    | ✓              | ◐ 流程过滤器   | ✓                  | ◐ 取消接口         |

### 流程编排

| 能力                     | SDK                    | Customer.io | Braze          | Iterable          | Klaviyo      | OneSignal    | Knock         |
| ------------------------ | ---------------------- | ----------- | -------------- | ----------------- | ------------ | ------------ | ------------- |
| 延时                     | ✓ 含随机               | ✓ 含随机    | ✓              | ✓                 | ✓            | ✓            | ✓ 最长 365 天 |
| 时间窗口，按用户时区     | ✓                      | ✓           | ✓°             | ✓°                | ✓°           | ✓            | ✓             |
| 等待条件，超时走另一分支 | ✓                      | ✓           | ✓ Action Paths | ✓ 最长 30 天      | ◐°           | ✓            | ✓             |
| 多路条件分支             | ✓                      | ✓           | ✓              | ✓                 | ✓ 最多 20 路 | ◐ 仅是/否    | ✓             |
| 随机分流 A/B             | ✓                      | ✓           | ✓              | ✓ 最多 10 路      | ✓            | ✓ 最多 25 路 | ✓             |
| 对照组 holdout           | ◐ 留一条空分支         | ✓           | ✓ 含全局对照组 | ✓ 在实验里        | ◐°           | ◐°           | ◐             |
| 发出事件或触发另一个流程 | ✓                      | ✓°          | ◐°             | ✓°                | ✗°           | ◐ 打标签     | ✓             |
| 调用外部系统             | ✓ 自定义代码，带幂等键 | ✓ webhook   | ✓ webhook      | ✓ webhook，可限速 | ✓ 仅 POST    | ✓ webhook    | ✓ fetch       |
| 批量合并成摘要（digest） | ✗                      | ✗°          | ✗°             | ✗°                | ✗°           | ✗°           | ✓             |
| 发送时间优化（按人预测） | ✗                      | ✗°          | ✓              | ✓                 | ◐°           | ✓            | ✗°            |

### 渠道

| 渠道               | SDK                    | Customer.io | Braze | Iterable | Klaviyo | OneSignal | Knock        |
| ------------------ | ---------------------- | ----------- | ----- | -------- | ------- | --------- | ------------ |
| Email              | ✓ SES、Cloudflare      | ✓           | ✓     | ✓        | ✓       | ✓         | ✓            |
| 移动推送           | ✓ APNs、FCM            | ✓           | ✓     | ✓        | ✓       | ✓         | ✓            |
| Web Push           | ✓                      | ✗°          | ✓°    | ✓°       | ✗°      | ✓         | ◐°           |
| SMS                | ◐ 有节点，无内置发送器 | ✓           | ✓     | ✓        | ✓       | ✓         | ✓            |
| WhatsApp           | ✗                      | ✓           | ✓°    | ✓        | ✓       | ✗°        | ✓            |
| 应用内消息或收件箱 | ◐ 有节点，无内置发送器 | ✓           | ✓°    | ✓°       | ◐°      | ✓         | ✓            |
| Slack、Discord     | ✓                      | ◐ 仅 Slack  | ✗°    | ✗°       | ✗°      | ✗°        | ✓ 另有 Teams |

### 发送治理与合规

| 能力                                | SDK              | Customer.io      | Braze | Iterable           | Klaviyo         | OneSignal           | Knock        |
| ----------------------------------- | ---------------- | ---------------- | ----- | ------------------ | --------------- | ------------------- | ------------ |
| 跨流程频次上限（每人每周最多 N 条） | ✗                | ✓ 窗口最长 31 天 | ✓     | ✓ 按渠道，日/周/月 | ◐ Smart Sending | ◐ 仅推送            | ◐ 不能跨流程 |
| 全局免打扰时段                      | ◐ 逐步加时间窗口 | ◐°               | ✓     | ✓                  | ◐° 仅短信       | ◐°                  | ✓            |
| 发送速率限制                        | ✗                | ✓                | ✓     | ◐                  | ✗°              | ◐ 不适用于 Journeys | ✗°           |
| 退信、投诉自动抑制                  | ✗                | ✓°               | ✓°    | ✓°                 | ✓°              | ✓°                  | ◐°           |
| 按主题的订阅偏好                    | ✓ 按渠道×主题    | ✓°               | ✓°    | ✓°                 | ◐°              | ◐°                  | ✓            |
| 一键退订（RFC 8058）                | ✓                | ✓°               | ✓°    | ✓°                 | ✓°              | ✓°                  | ◐°           |
| 用户数据擦除                        | ✓                | ✓°               | ✓°    | ✓°                 | ✓°              | ✓°                  | ✓°           |

### 内容与个性化

| 能力                     | SDK                    | Customer.io      | Braze            | Iterable            | Klaviyo | OneSignal        | Knock            |
| ------------------------ | ---------------------- | ---------------- | ---------------- | ------------------- | ------- | ---------------- | ---------------- |
| 模板形式                 | React 组件，类型化参数 | 编辑器 + Liquid° | 编辑器 + Liquid° | 编辑器 + Handlebars | 编辑器° | 编辑器 + Liquid° | 编辑器 + Liquid° |
| 多语言                   | ◐ 模板内按语言自行分支 | ✓°               | ✓°               | ✓°                  | ◐°      | ✓°               | ✓                |
| 预览                     | ✓ Studio               | ✓°               | ✓                | ✓°                  | ✓°      | ✓°               | ✓°               |
| 给自己发一封测试         | ✗                      | ✓°               | ✓°               | ✓                   | ✓°      | ✓°               | ✓°               |
| 发送时拉取外部数据进模板 | ◐                      | ✓                | ✓°               | ✓°                  | ◐°      | ◐°               | ✓                |

### 报表与运营工具

| 能力                     | SDK                      | Customer.io | Braze          | Iterable | Klaviyo | OneSignal | Knock      |
| ------------------------ | ------------------------ | ----------- | -------------- | -------- | ------- | --------- | ---------- |
| 打开、点击追踪           | ✓                        | ✓°          | ✓              | ✓°       | ✓°      | ✓         | ✓°         |
| 机器打开和机器点击的剔除 | ✓ 含扫描器、企业代理     | ◐°          | ◐°             | ◐°       | ◐°      | ◐°        | ✗°         |
| 进入、转化报表           | ✓                        | ✓°          | ✓°             | ✓°       | ✓°      | ✓         | ◐°         |
| 按分支对比实验结果       | ◐ 数据在库里，无现成视图 | ✓           | ✓              | ✓        | ✓°      | ✓°        | ✓°         |
| 可视化画布编辑           | ✗ Studio 只读            | ✓           | ✓              | ✓        | ✓       | ✓         | ✓          |
| 非工程人员改流程和文案   | ✗                        | ✓           | ✓              | ✓        | ✓       | ✓         | ✓          |
| 按用户查看所在步骤和历史 | ◐ 查库                   | ✓°          | ✓ 预览用户路径 | ✓°       | ✓°      | ◐°        | ✓°         |
| 暂停或停止正在运行的流程 | ◐ 重新部署或逐个终止     | ✓°          | ✓°             | ✓°       | ✓°      | ✓°        | ✓ 取消接口 |

### 工程与部署

| 能力                           | SDK                     | Customer.io | Braze      | Iterable   | Klaviyo | OneSignal    | Knock              |
| ------------------------------ | ----------------------- | ----------- | ---------- | ---------- | ------- | ------------ | ------------------ |
| 流程即代码，编译期类型检查     | ✓                       | ✗           | ✗          | ✗          | ✗       | ◐ 有创建接口 | ◐ CLI 同步，无类型 |
| 运行中的实例固定在进入时的版本 | ✓                       | ◐           | ◐°         | ◐°         | ◐°      | ◐°           | ◐°                 |
| 本地单测与时间加速             | ✓                       | ✗°          | ◐ 路径预览 | ◐ 测试模式 | ✗°      | ✗°           | ◐°                 |
| 自托管，数据在自己的 Postgres  | ✓ Cloudflare、AWS、Node | ✗           | ✗          | ✗          | ✗       | ✗            | ✗                  |

## SDK 独有或更强的地方

这些是六个产品都没有、或只有 Knock 部分具备的能力，都来自“代码优先、自托管”这个定位。

- **类型安全**：事件、资料字段、模板参数由同一份 contract 约束，写错字段名或时长在编译期报错。其他产品要到运行时才发现。
- **版本固定**：运行中的实例留在进入时的流程版本上，部署会破坏运行中实例时返回 409 并列出它们。
- **投递语义写明且可选**：默认最多一次，单个模板可改为至少一次；“被拒绝”“没有应答”“未确认”分别记录原因。
- **自定义代码步骤**：`.run()` 在持久化步骤里执行任意代码，带重试和幂等键；其他产品只能发 webhook。
- **渠道回退**：`.prefer()` 按用户可达的渠道选一个发，只发一条。
- **可复用片段**：`flow()` 和 `.use()` 把一段流程当函数复用。
- **点击分类**：区分人和机器的打开与点击，包括邮件安全网关和企业代理（网络规则仅在 Cloudflare 上生效）。
- **本地可测**：解释器不碰数据库和网络，流程可以单测；`timeScale` 把一天压成几分钟做演练。
- **数据归属和成本**：数据在自己的 Postgres，按云资源付费，不按联系人数或发送量计价。

## 缺口清单

按“不补会出什么事”排序，前两项直接影响送达率和用户体验。

| 优先级 | 缺口                               | 同类情况                                        | 不补的后果                                                  | 做法与工作量                                                                     |
| ------ | ---------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 高     | 跨流程频次上限                     | Customer.io、Braze、Iterable 内置，其余部分具备 | 流程一多，同一个人一天收到好几封；README 自己也把它列为未做 | 发送前按用户×渠道查近期已发数量，超限按“未送达”结算；复用现有的 message 表，中等 |
| 高     | 退信、投诉自动抑制                 | 托管产品普遍内置                                | 继续向硬退信地址发信，发信域名信誉下降，SES 可能限流        | 接 SES、Cloudflare 的反馈通知，写入现有的 suppression 表，中等                   |
| 中     | 全局免打扰时段                     | Braze、Iterable、Knock 内置                     | 每个流程都要记得加时间窗口，漏一个就半夜推送                | 配置里加一个默认窗口，底层能力已有，小                                           |
| 中     | 给自己发测试、暂停开关、按用户排查 | 全部内置                                        | 上线前看不到真实收件效果；出事故时只能重新部署或查库        | Studio 加三个入口，数据都在库里，各自较小                                        |
| 中     | 按分支的实验报表和对照组           | 全部内置                                        | `.cohort()` 能分流但看不到哪条赢                            | Studio 按分支统计转化，另加一个明确的 holdout 分支，中等                         |
| 中     | 按日期属性触发、周期性重复         | Customer.io、Klaviyo 内置                       | 续费提醒、生日、每周摘要要应用自己算好时间再发事件          | 新增两种触发器，扫描机制可复用，中等                                             |
| 低     | Webhook 触发的运行时路由           | —                                               | 已能编译和部署但不会启动，属于半成品                        | 补上路由，或先从 DSL 里拿掉，小                                                  |
| 低     | 内置多语言                         | 多数内置                                        | 每个模板自己按语言分支，能用但重复                          | 模板声明按语言的文案表，小到中                                                   |
| 低     | SMS、WhatsApp、应用内的内置发送器  | 全部内置                                        | 要用这些渠道时自己写发送器                                  | 按需要逐个加，各自较小                                                           |

可以不做的三项，都与代码优先的定位相悖或投入产出比低：

- **可视化画布编辑和非工程人员改流程**：类型检查和版本固定正是靠“流程在代码里”换来的。
- **发送时间优化**：需要每个用户的历史互动模型，用户量小的时候效果有限。
- **批量合并成摘要**：是产品通知（评论、提及）的需求，只有 Knock 做了，生命周期营销很少用到。

## 来源

外部产品的信息来自对各家官方文档的检索摘录，没有逐页通读全文。

- Customer.io：[Automation journeys](https://docs.customer.io/messaging/send/automations/journeys/)、[Wait until](https://docs.customer.io/messaging/send/workflows/delays/wait-until/)、[Randomized delay](https://docs.customer.io/journeys/random-delay)、[Workflow builder](https://docs.customer.io/journeys/workflow-builder)、[Holdout tests](https://docs.customer.io/journeys/holdout-test)、[Message frequency limits](https://docs.customer.io/messaging/send/message-limits/overview/)、[Campaign triggers](https://docs.customer.io/journeys/campaign-triggers/)
- Braze：[Canvas components](https://www.braze.com/docs/user_guide/engagement_tools/canvas/canvas_components/)、[Decision Split](https://www.braze.com/docs/user_guide/engagement_tools/canvas/canvas_components/decision_split/)、[Rate limiting and frequency capping](https://www.braze.com/docs/user_guide/messaging/messaging_fundamentals/frequency_capping)、[Quiet hours](https://www.braze.com/docs/user_guide/messaging/messaging_fundamentals/quiet_hours)、[Intelligent Timing](https://www.braze.com/docs/user_guide/brazeai/intelligence_suite/intelligent_timing)、[Preview User Paths](https://www.braze.com/docs/user_guide/engagement_tools/canvas/testing_canvases/preview_user_paths/)
- Iterable：[Delay Tiles](https://support.iterable.com/hc/en-us/articles/14319818758036-Journey-Setup-Delay-Tiles)、[Filter Tiles](https://support.iterable.com/hc/en-us/articles/16331484154132-Filter-Tiles)、[Journeys FAQ](https://support.iterable.com/hc/en-us/articles/5367225442324-Journeys-Frequently-Asked-Questions)、[Frequency Management](https://support.iterable.com/hc/en-us/articles/15342990564372-Frequency-Management)、[Quiet Hours](https://support.iterable.com/hc/en-us/articles/16928857601940-Quiet-Hours)、[Configuring Experiments](https://support.iterable.com/hc/en-us/articles/22872099556116-Configuring-Experiments)、[Testing and Publishing Journeys](https://support.iterable.com/hc/en-us/articles/4411905637396-Testing-and-Publishing-Journeys)
- Klaviyo：[Multi-Branch Splits](https://help.klaviyo.com/hc/en-us/articles/52369094030235)、[Understanding webhooks in flows](https://help.klaviyo.com/hc/en-us/articles/4534329515931)、[Understanding Smart Sending](https://help.klaviyo.com/hc/en-us/articles/115002779311)、[Getting started with flows](https://help.klaviyo.com/hc/en-us/articles/115002774932)
- OneSignal：[Journey actions](https://documentation.onesignal.com/docs/en/journeys-actions)、[Journey settings](https://documentation.onesignal.com/docs/en/journeys-settings)、[Create journey](https://documentation.onesignal.com/reference/create-journey)、[Push frequency capping](https://documentation.onesignal.com/docs/en/frequency-capping)、[Push throttling](https://documentation.onesignal.com/docs/en/throttling)
- Knock：[Designing workflows](https://docs.knock.app/designing-workflows/overview)、[Delay function](https://docs.knock.app/designing-workflows/delay-function)、[Branch function](https://docs.knock.app/designing-workflows/branch-function)、[Throttle function](https://docs.knock.app/designing-workflows/throttle-function)、[Send windows](https://docs.knock.app/designing-workflows/send-windows)、[Preferences overview](https://docs.knock.app/preferences/overview)、[Channels](https://docs.knock.app/concepts/channels)、[Canceling workflows](https://docs.knock.app/send-notifications/canceling-workflows)
