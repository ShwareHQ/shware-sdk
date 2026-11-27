# Meta 内置浏览器（FB / IG）跳出与参数接力：实测结论

实测日期：2026-11-17。设备：iPhone（iPhone Mirroring 操作）、Pixel 7（scrcpy + adb）。
测试页：自建页面，通过 cloudflared 隧道访问，https。

> **状态（2026-11-27）：决定暂不实现 `_svh` 接力**，原因见第 10 节。本文保留为调研记录。

## 1. 内置浏览器 UA 特征

| App       | 平台          | UA 关键字                                                                                                                                |
| --------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Facebook  | iOS           | `FBAN/FBIOS`、`FBAV`、`IABMV/1`                                                                                                          |
| Facebook  | Android       | `FB_IAB/FB4A`、`FBAV/…`                                                                                                                  |
| Instagram | iOS / Android | `Instagram <版本>`，没有 `FBAN`                                                                                                          |
| Threads   | iOS           | 测试页用 `/Barcelona                                                                                                                     | Threads/` 识别成功，完整 UA 未截取 |
| Threads   | Android       | `… wv) … Chrome/157… Mobile Safari/537.36 Barcelona 455.0.0.55.72 Android (…)`，含 `Barcelona`（Threads 内部代号），**不含 `Instagram`** |

检测正则：`/FBAN|FBAV|FB_IAB|FBIOS|Instagram|Barcelona|Threads/`

## 2. 右上角菜单「在浏览器中打开」能否带上页面写入的参数

页面加载后用 JS 改 URL（加一个接力参数），再点 App 自带菜单跳出，看外部浏览器拿到的 URL。

| 平台 / App      | replaceState | pushState | location.hash | 备注                                                                                                                                                                  |
| --------------- | ------------ | --------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS IG          | ✅           | ✅        | ✅            | 菜单打开系统默认浏览器，IG 追加 `fbclid`，hash 保留（pushState / hash 于 2026-11-17 补测）                                                                            |
| iOS FB          | ✅           | ✅        | ✅            | 菜单打开系统默认浏览器；FB 有时追加 `fbclid`，hash 保留（pushState / hash 于 2026-11-17 补测）                                                                        |
| Android FB      | ✅           | ✅        | ✅            | 不追加 fbclid，无确认框（pushState / hash 于 2026-11-17 补测）                                                                                                        |
| iOS Threads     | ✅           | ✅        | ✅            | 菜单打开系统默认浏览器，不追加 fbclid；replaceState 为干净测试（重启 App、新打开、只 replaceState）（2026-11-17）                                                     |
| Android Threads | ✅           | ✅        | ✅            | replaceState 为干净测试（新打开、加载时只 replaceState）；不追加 fbclid；pushState / hash 后菜单多出一项，「在外部浏览器打开」位置下移（同 Android IG）（2026-11-17） |
| Android IG      | ❌           | ✅        | ✅            | replaceState 时打开的是原始链接 + fbclid；https 下同样失败，**和 http 无关**                                                                                          |

Android IG 的菜单取的是「最后一次 pushState / hash 变化时」的 URL。之前用 replaceState 写入的参数，只要之后发生过一次 pushState 或 hash 变化，也会被带上。

**结论：加载时用 `pushState` 写入一次接力参数，六种组合都能带出去**（2026-11-17 实测）。只有 Android IG 不认 replaceState，所以也可以只在 Android IG 用 pushState、其他用 replaceState，减少返回键多一步的副作用。

## 3. 页面内按钮跳出（不靠右上角菜单）

| 方法                                                                                     | iOS FB                                     | iOS IG                             | iOS Threads | Android FB               | Android IG               | Android Threads                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------- | ----------- | ------------------------ | ------------------------ | -------------------------------------------------------- |
| `x-safari-https://`                                                                      | ✅ FB 自己的确认框 → Safari（追加 fbclid） | ❌ 静默拦截（两次实测 + 资料印证） | 未测        | —                        | —                        | —                                                        |
| `googlechromes://`                                                                       | ✅ FB 确认 + 系统确认（不带 fbclid）       | ✅ 需装 Chrome，首次有系统确认     | 未测        | ❌                       | ❌                       | 未测                                                     |
| `intent://…#Intent;scheme=https;action=android.intent.action.VIEW;end`（不指定 package） | —                                          | —                                  | —           | ✅ 一次确认 → 默认浏览器 | ✅ 一次确认 → 默认浏览器 | ✅ Threads 的「You're leaving our app」确认 → 默认浏览器 |
| `<a target="_blank">`                                                                    | ❌ 留在 IAB                                | ❌ 留在 IAB                        | 未测        | ❌ 留在 IAB              | ❌ 留在 IAB              | 未测                                                     |
| `window.open`                                                                            | ❌ 留在 IAB                                | ❌ 留在 IAB                        | 未测        | ❌ 留在 IAB              | ❌ 留在 IAB              | 未测                                                     |

按钮跳出时，接力参数直接拼在目标 URL 上，不依赖菜单行为。

Android intent 不指定 package，走系统默认浏览器，**不依赖 Chrome**。目标 URL 必须强制 `https:`（曾因 Gboard 把 "Https" 首字母大写，导致 IG 以 http 打开，intent 拼成了 `http//…`）。

## 4. 跳出失败检测（iOS IG）

做法：触发 scheme 后监听 `blur` / `pagehide` / `visibilitychange`，2 秒内页面仍可见就判定失败，显示「点右上角 … → 在外部浏览器打开」引导。

| 场景                                     | 事件                       | 结果                        |
| ---------------------------------------- | -------------------------- | --------------------------- |
| 未安装的 App（假 scheme）                | 2 秒内无任何事件           | ✅ 显示引导                 |
| 已装 Chrome                              | ~940 ms 触发 blur + hidden | ✅ 不显示引导               |
| 弹出系统确认框（「要打开 Chrome 吗」）时 | —                          | **未测**（本次 iOS 没弹框） |

iOS FB 的 x-safari 走 FB 自己的确认框，可能不触发 blur，计时器建议放宽到 4–5 秒。

## 5. iOS IG 的其他出路（资料调研，未实测）

| 方法                             | 条件           | 可靠性       |
| -------------------------------- | -------------- | ------------ |
| `microsoft-edge-https://`        | 需装 Edge      | 未测         |
| `firefox://open-url?url=`        | 需装 Firefox   | 未测         |
| `shortcuts://run-shortcut`       | 需预装快捷指令 | 不现实       |
| 复制链接 + 提示粘贴到 Safari     | 无             | 可用但摩擦大 |
| 菜单引导（… → 在外部浏览器打开） | 无             | 最通用的兜底 |

没有找到其他能在 iOS IG 里可靠地用程序跳到 Safari 的方法。

## 6. x-safari-https 的风险

- IG 已经拦截它，FB 目前放行，但它不是公开的 Apple API，Meta 随时可以在 FB 里同样拦截。
- 应视为 best-effort：必须配失败检测和菜单引导兜底，并按 App 版本 / iOS 版本监控成功率。

## 7. 推荐方案

### 7.1 跳出按钮

| 平台 / App                | 首选按钮                           | 兜底                  |
| ------------------------- | ---------------------------------- | --------------------- |
| Android FB / IG / Threads | `intent://`（无 package）          | 2 秒未离开 → 菜单引导 |
| iOS FB                    | `x-safari-https://`（计时 4–5 秒） | 菜单引导              |
| iOS IG                    | 尝试 `googlechromes://`            | 2 秒未离开 → 菜单引导 |
| iOS Threads               | 未测，暂按 iOS IG 处理             | 菜单引导              |

### 7.2 接力参数（客户端采纳，不走服务端）

和 GA4 的 `_gl` 一样，新浏览器在发出第一个事件之前就决定用哪个 visitor_id，不额外发请求，服务端和漏斗查询都不用改。

#### 参数格式

```
_svh=1*<visitorId>*<ts>*<via>*<fp>
```

| 段          | 内容                                                         | 示例                                   | 说明                                                        |
| ----------- | ------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------- |
| `1`         | 格式版本号                                                   | `1`                                    | 以后改格式就升版本；读取方不认识的版本一律丢弃              |
| `visitorId` | 内置浏览器里的 visitor_id，原样                              | `019a8f3c-7b2e-7c41-9d3a-5e6f7a8b9c0d` | uuidv7 只含 `0-9a-f` 和 `-`，不需要编码                     |
| `ts`        | **写入参数那一刻**的 `Date.now()`，转 base36                 | `mwjxedc0`                             | 不能用 uuidv7 里的时间：那是 visitor 创建时间，可能是几天前 |
| `via`       | 写入方式：`m` = 加载时写入、靠菜单跳出；`b` = 按钮点击时生成 | `m`                                    | 决定读取方用哪个时间窗口                                    |
| `fp`        | 指纹：CRC-32 后转 base36                                     | `kvtjqy`                               | 见下                                                        |

参数名用 `_svh`（shware visitor handoff，`s` 是厂商前缀，`vh` 对应事件名 `visitor_handoff`）。查过常见的分析、推荐、归因系统，都没有用 `_svh` 或 `_vh` 的；选带前缀的 `_svh` 是因为短名更容易撞；格式自带版本号和指纹，真撞上了也只是校验失败、不采纳。

#### 指纹

只用两边实测一致的 6 个设备字段，再把参数里的其他段也算进去，防止单独篡改 `visitorId`、`ts` 或 `via`：

```ts
function osOf(ua: string): string {
  const ios = ua.match(/(?:iPhone|CPU) OS (\d+(?:_\d+)*)/);
  if (ios) return 'iOS ' + ios[1].replace(/_/g, '.');
  const android = ua.match(/Android (\d+(?:\.\d+)*)/);
  return android ? 'Android ' + android[1] : '';
}

function fingerprint(visitorId: string, ts: string, via: 'm' | 'b'): string {
  const input = [
    osOf(navigator.userAgent), // 'iOS 27.2.1' / 'Android 10'
    new Date().getTimezoneOffset(), // -480
    Intl.DateTimeFormat().resolvedOptions().timeZone, // 'Asia/Shanghai'
    `${screen.width}x${screen.height}`, // '412x915'
    devicePixelRatio, // 2.625
    navigator.hardwareConcurrency ?? '', // 8
    visitorId,
    ts,
    via,
  ].join('*');
  return crc32(input).toString(36); // CRC-32 (0xEDB88320)，同 gtag 的 lr()
}
```

- **不含 UA**：内置浏览器和系统浏览器的 UA 一定不同。OS 只从 UA 里解析出名称和版本号。Android 的 Chrome 和 WebView 都用了精简 UA，版本号固定是 `Android 10`，所以在 Android 上这个字段区分度很低，主要靠其他字段。
- **不含语言**、`availHeight`：实测在内置浏览器里不一致（见下表）。
- **不含时间桶**：`ts` 明文带上并参与哈希，读取方直接算差值，不用像 gtag 那样按分钟枚举。
- 没有密钥，谁都能算。它防的是链接被转发后误采纳，不防伪造。
- **全程同步**：CRC-32 是纯 JS 查表计算（256 项表，首次调用时生成），不依赖 `crypto.subtle`（那是 async 的）。所有字段也都是同步读取，所以写入和读取都可以在 SDK 初始化、发第一个事件之前同步完成。

实测（Pixel 7，Android 10，2026-11-17），同一页面在 Chrome 和三个内置浏览器里读取：

| 字段                                                           | 取值方式                          | Chrome                                  | FB              | IG        | Threads   | 是否采用                                      |
| -------------------------------------------------------------- | --------------------------------- | --------------------------------------- | --------------- | --------- | --------- | --------------------------------------------- |
| OS 名称和版本                                                  | 从 UA 解析                        | Android 10                              | 同              | 同        | 同        | ✅                                            |
| 时区偏移                                                       | `getTimezoneOffset()`             | -480                                    | 同              | 同        | 同        | ✅                                            |
| 时区名                                                         | `Intl…resolvedOptions().timeZone` | Asia/Shanghai                           | 同              | 同        | 同        | ✅                                            |
| 屏幕尺寸                                                       | `screen.width x height`           | 412x915                                 | 同              | 同        | 同        | ✅                                            |
| 像素比                                                         | `devicePixelRatio`                | 2.625                                   | 同              | 同        | 同        | ✅                                            |
| CPU 核数                                                       | `hardwareConcurrency`             | 8                                       | 同              | 同        | 同        | ✅（iOS 待测）                                |
| 语言                                                           | `navigator.language`              | en-US                                   | **zh-CN**       | en-US     | en-US     | ❌ 跟随 App 自己的语言设置                    |
| 语言列表                                                       | `navigator.languages`             | en-US,en                                | **zh-CN,en-US** | **en-US** | **en-US** | ❌                                            |
| 可用屏幕高度                                                   | `screen.availHeight`              | 840                                     | **915**         | **915**   | **915**   | ❌ 内置浏览器全屏                             |
| Intl locale                                                    | `resolvedOptions().locale`        | en-US                                   | 同              | 同        | 同        | ❌ 和语言同源，不冒险                         |
| colorDepth / platform / deviceMemory / maxTouchPoints / vendor | —                                 | 24 / Linux armv81 / 8 / 5 / Google Inc. | 同              | 同        | 同        | ❌ 区分度低，或 Safari 不支持                 |
| WebGL 显卡、canvas / audio 哈希、`userAgentData`               | —                                 | 未测                                    |                 |           |           | ❌ 不采用：两边能力不对等，或 Safari 会加噪声 |
| UA、设备型号                                                   | UA                                | —                                       | —               | —         | —         | ❌ 一定不一致                                 |

iOS 三个 App 和 Safari / Chrome 还没对比，尤其是 `hardwareConcurrency`；如果 iOS 上不一致，就从指纹里去掉这一项（升版本号）。

#### 写入（内置浏览器）

```ts
const IAB = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Barcelona|Threads/;

function handoffValue(via: 'm' | 'b'): string {
  const id = visitorId();
  const ts = Date.now().toString(36);
  return ['1', id, ts, via, fingerprint(id, ts, via)].join('*');
}
```

- 只在 UA 匹配 `IAB` 时写。
- 加载时写一次 `handoffValue('m')`：Android IG 必须用 `pushState`（它不认 `replaceState`），其他 App 用 `replaceState`；也可以统一 `pushState`，代价是返回键要多按一次，并且要和前端 router 协调。
- 按钮跳出时，在点击那一刻生成 `handoffValue('b')`，拼到目标 URL 上。

#### 读取（系统浏览器）

在 SDK 初始化、生成或读取本地 visitor_id 之前执行。依次检查，全部通过才采纳：

1. 按 `*` 拆成 5 段，版本号是 `1`，`visitorId` 是合法的 uuid，`via` 是 `m` 或 `b`。
2. `age = Date.now() - parseInt(ts, 36)`：
   - `via = m`：`-2 分钟 ≤ age ≤ 30 分钟`；
   - `via = b`：`-2 分钟 ≤ age ≤ 3 分钟`（和 gtag 一样）。
   - 负方向留 2 分钟，吸收系统校时的抖动；gtag 只接受向后偏差。
3. 用本机字段重算 `fingerprint(visitorId, ts, via)`，和 `fp` 相等。
4. 本地 visitor：
   - 没有 → 采纳；
   - 有但从没 identify 过 → 采纳（覆盖，同 GA4 默认的 `accept_incoming`）；
   - 已经 identify 过 → 不覆盖（SDK 需要在本地记一个「是否 identify 过」的标记）。

采纳 = 把 `visitorId` 写进本地存储，当作本浏览器的 visitor_id，之后长期沿用（和 `_gl` 写 `_ga` cookie 一样，窗口只决定是否接受这条链接）。

不管采纳与否，读完都立即用 `history.replaceState` 删掉 `_svh`，并把它加进 `redactUrl`，保证不出现在 `page_location` 里。

#### 埋点

- 采纳：发 `visitor_handoff`，带 `via`、`age`、来源 App（可从 visitor 的上一个 session 的 UA 得知，不需要放进参数）。
- 拒绝：同一个事件带 `reason`：`bad_format` / `expired` / `clock_skew` / `fp_mismatch` / `identified`。上线后看 `fp_mismatch` 的比例，判断指纹字段是否需要调整。

#### 能防 / 不能防

能防：链接被转发后过了很久才打开、在不同系统 / 时区 / 屏幕的设备上打开、收藏或复制后再用（参数已删）。挡不住：窗口内同系统、同时区、同屏幕尺寸、同核数的另一个人打开转发的链接，这和 `_gl` 是同一级别的风险。

fbclid 只能用来判断渠道，不能当身份（菜单跳出时 FB 会新生成 fbclid）。

**监控**：按钮点击、外部浏览器落地、引导展示、`visitor_handoff` 采纳 / 拒绝，按 App、App 版本、OS 版本拆分。

### 7.3 参考：GA4 的 `_gl` 跨域接力（gtag.js 源码）

`_gl` 解决的是**同一个浏览器里跨域名**跳转（cookie 按域名隔离）。以下根据 2026-11-17 下载的 `googletagmanager.com/gtag/js` 整理，函数名是压缩后的名字。

| 环节     | 源码里的做法                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 何时写入 | 在 `document` 上监听 `mousedown`、`keyup`、`submit`，并改写 `HTMLFormElement.prototype.submit`；用户按下指向 `linker.domains` 的链接那一刻才生成 `_gl` 并改写 href。广告点击本身不产生 `_gl` |
| 格式     | `1*<指纹>*<cookie名>*<base64值>*…`，cookie 值去掉 `GA1.2.` 这类前缀后做 base64，`=` 换成 `.`                                                                                                 |
| 指纹     | `lr(a, b)`：`[userAgent, getTimezoneOffset(), userLanguage \|\| language, floor(now/60000) - b, a].join("*")`，CRC-32（`0xEDB88320`）后转 base36。无密钥                                     |
| 有效期   | `rr(a, 3)`：依次用 `b = 0, 1, 2` 重算指纹，有一个对上就接受。即当前分钟和前两个整分钟，实际 120–180 秒。不接受时间倒退                                                                       |
| 清理     | `or()`：用 `history.replaceState` 把 `_gl` 从 query 和 hash 里删掉                                                                                                                           |
| 采纳之后 | client_id 写进新域名的 `_ga` cookie，之后长期沿用；窗口只决定是否接受这条链接                                                                                                                |

示例（本地按同一算法计算，iPhone Safari、UTC+8、`zh-CN`、2026-11-17 09:30）：

```
_gl=1*kvtjqy*_ga*MTM2MDM4NDg1MS4xNjYxODIxMjQy*_ga_ABC123*czE3OTQ4Nzg0MDAkbzMkZzEkdDE3OTQ4Nzg0NjA.
```

同样输入换到下一分钟，指纹变成 `1m90ua8`。

和我们场景的差别：

- `_gl` 在点击时生成；菜单跳出时页面收不到点击，只能在加载时提前写入，所以窗口要放宽到 30 分钟左右。
- `_gl` 两端是同一个浏览器，拿 UA 做指纹合理；我们两端 UA 一定不同，只能用弱特征。
- GA4 本身不处理「内置浏览器 → 系统浏览器」，跳出后在 GA4 里同样是两个 client_id。
- Meta 没有 `_gl` 的对应机制：`_fbp` 是各浏览器自己生成的，`_fbc` 只是从 fbclid 派生出来的；跨浏览器识别靠 CAPI 的 `external_id` 和高级匹配，要等用户登录。

## 8. 引导跳出在 Meta web 广告里常见吗

| 做法                                   | 常见程度   | 典型场景                                                              |
| -------------------------------------- | ---------- | --------------------------------------------------------------------- |
| 不跳出，在内置浏览器里完成注册         | 最常见     | 邮箱验证码 / 魔法链接、手机验证码、Apple 登录、Facebook 登录          |
| 点 Google 登录时提示「在浏览器中打开」 | 常见       | 依赖 Google 登录的产品（WebView 里 Google 报 `disallowed_useragent`） |
| 落地页一打开就弹横幅引导跳出           | 较少       | link-in-bio、联盟营销、需要下载文件的页面                             |
| 加载时自动跳出                         | 少，有风险 | 可能影响落地页体验评估和落地页浏览量统计                              |

建议：默认在内置浏览器里注册，只在用户点「用 Google 登录」时走上面这套跳出流程。这样跳出人数最少，归因分裂成两个 visitor 的情况也最少。

## 9. 未覆盖 / 上线前待补测

- Threads：iOS 按钮跳出（x-safari / googlechromes）未测；iOS Threads 私信里发送方自己发的链接点不开（Android 发送方可以点开）
- iOS 弹系统确认框时的失败检测
- iOS 上 Edge、Firefox 的 scheme
- Android 默认浏览器不是 Chrome 时的 intent
- Messenger、Google App、TikTok 等其他内置浏览器
- 弱指纹字段：Android 已测；iOS 三个 App vs Safari / Chrome 待测（尤其 `hardwareConcurrency`、屏幕尺寸）

## 10. 决定：暂不实现（2026-11-27）

评估了在 `@shware/analytics` 里实现第 7.2 节的 `_svh` 接力后，决定先不做。

- **能捞回的流量有限**：这套方法在 Android 上比较可靠（按钮 `intent://` 和菜单都能带出参数），但 Android 一般只占 Meta 广告流量的 15% 左右；iOS 上 IG / Threads 没有可靠的按钮跳出，指纹字段也还没对比过。
- **只有跳出后才转化的用户才需要接力**：按第 8 节的建议，默认在内置浏览器里完成注册，只在「用 Google 登录」时跳出，需要接力的人本来就少。
- **菜单路径维护成本高**：加载时写入的参数在 SPA 换页后就丢了，要在每次换页、`identify` / `reset`、页面重新可见时重写；Android IG 还必须用 `pushState`，会影响返回键，也要和前端 router 协调。
- **不接力也保留了渠道归因**：从落地页用菜单跳出时，URL 里的 `utm_*` / `fbclid` 会一起带过去，系统浏览器那边的 session 仍能归到 Meta 广告；丢掉的只是两段访问不是同一个 visitor。

### 以后要做的话

1. 先看数据：Meta 广告流量里 Android / iOS 各自的内置浏览器占比，以及有多少注册或付费发生在系统浏览器、且该 visitor 首个 session 带 `fbclid`（即「跳出后才转化」的上限）。
2. 只做按钮这一条路：点击时生成参数、拼到跳出目标上，系统浏览器在 `setupAnalytics` 里同步读取、校验、采纳，读完立刻用 `replaceState` 删掉 `_svh`，并加进 `redactUrl` 和 `getPageKey` 的 `TRACKING_PARAMS`。不在加载时改写页面 URL。
3. 采纳逻辑放在 `setupAnalytics` 里执行一次（像 `deepLink` 一样作为可选项注入），不放在 `visitor/id.ts` 的 `newVisitorId`：后者只在本地没有 visitor 时才被调用，覆盖不到「本地有 visitor 但没 identify 过」的情况，`reset()` 也会走到它，而且 `id.ts` 是 web 和 native 共用的。
