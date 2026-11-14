---
name: yidian-extension-dev
description: 一点（yidian）Chrome/Edge MV3 收藏回看扩展 + 桌面常驻端的开发与发布守则。当在 c:\12730 仓库修改 core / extension / packages/yidian-desktop 源码、调试到期提醒/免打扰/通知链路、同步共享副本、做本地自测、或准备 Edge 商店上架、桌面端打包与版本发布时使用。内含本项目实测踩坑：alarm 下限、墙钟时间口径、storage 迁移、注入兜底、副本漂移与发布清单。
---

# yidian-extension-dev

一点是 Chrome/Edge MV3 扩展 + Windows/macOS 桌面常驻端：第 1 天收下网页，第 2、7、30 天回看（间隔 1/5/23 天，stage 1→4）。

## 权威源与副本

仓库现在是**三端一核**的结构，副本不是可选优化，是硬约束：

| 位置 | 角色 | 说明 |
|---|---|---|
| `core/` | **业务语义源头** | `domain.mjs`（纯函数领域层）+ `messages.mjs`（平台无关消息层） |
| `extension/` | 扩展发行物 | 扩展自己的适配器（`service-worker.mjs`）+ core 副本 + 界面源文件 |
| `packages/yidian-desktop/` | 桌面发行物 | 桌面适配器 + `vendor/yidian-core/`（core 副本）+ `assets/bundle/`（界面副本） |

**为什么必须留副本**：扩展被浏览器沙箱限制只能 import 自己目录内的文件；桌面端打包后不能依赖仓库里的兄弟目录。所以 `tools/sync-shared.mjs` 从源同步出三处副本：

- 改完 `core/` 或扩展包里的界面文件后，**必跑** `node tools/sync-shared.mjs`（`--check` 只校验）。
- `tests/core-sync.test.mjs` 守住「一字不差」，同时断言桌面端不再 import 扩展的 SW、扩展里不再有业务函数。**副本被手改 = 测试红**。
- 扩展发行 zip 必须从 `extension/` 重新打包（副本已包含在内）。

旧版本目录、`.deploy/`、`.diff-work/`、worktree 副本全部被 .gitignore 排除。用户习惯从 packages 目录以未打包扩展方式本地安装测试。

## 架构口径

- `core/domain.mjs` 是纯函数领域层，所有时间函数带 `now = Date.now()` 注入点；时间相关逻辑必须可注入、可被 `node --test` 覆盖，**禁止在领域层触碰 chrome.* 或 electron**。
- `core/messages.mjs` 是平台无关的消息层：`createMessageLayer(platform)` 统一实现 handleMessage / maybeNotifyDue / scheduleNext / refreshBadge / openNotifiedRecord / getRecords 等。平台能力通过 platform 参数注入：`storage / openUrl / openLibrary / notify / clearNotification / setAlarm / clearAlarm / setBadge? / onRecordsChanged? / now?`。
- `core/bridge-protocol.mjs` 是**双端桥协议**（扩展 ↔ 桌面端）：端点路径、配对码规则、token 头名、扩展身份头、记录指纹。两端共用一份，同步出副本。
- `core/page-meta.mjs` 是**页面元信息层**（纯函数）：HTML 字符串 → 标题 / 一句描述 / canonical，含 GBK 等编码识别。各端各接各的网络：桌面端用 Electron 的 `net.fetch`，扩展端直接读 DOM 的 `meta` 标签。
- **内容层口径**：`excerpt` = 用户亲手选的那段（带引号呈现）；`summary` = 页面自己写的那句描述（左侧竖线）；`note` = **用户自己写的那句批注**（蜜桃色竖线）。三者分开放，不混 —— 混了自动描述会盖掉用户选的段落。**呈现优先级：批注 > 选段 > 描述**（你的话最前）。合并时**真标题优先于兜底标题**（`isAutoTitle()` 靠比对兜底标题格式判定，不往记录里塞额外字段）。标题/描述/选段不受十分钟冷却限制，冷却只管「足迹记不记」；写批注（`set-note`）也不算一次「相见」。
- **各端只写适配器**：扩展的 `service-worker.mjs` 与桌面端的 `core/platform.mjs` 都只做「chrome / electron 能力对接 + 该端独有能力」，业务逻辑一律回核心层。扩展独有能力：角标、注入、快捷键、侧边栏；桌面独有能力：托盘、置顶窗、全局热键、系统通知。
- 时区口径统一为 Asia/Shanghai 墙钟：免打扰判定（inQuietHours）、分日去重（dayKeyFor，用 en-CA locale 取 YYYY-MM-DD）、静默结束时刻（quietEndAt）。不要用 toISOString().slice(0,10) 分日（那是 UTC）。
- 到期提醒链：alarm(yidian-next-review) → syncDerivedState → maybeNotifyDue（免打扰→到期过滤→digest 去重→selectNextDue）。免打扰跳过时用 yidian-quiet-end 闹钟在静默结束时刻补判定。桌面端用自己的 30s tick 调度器 + 到期签名去重，不依赖浏览器 alarm。
- digest 去重键 lastDigestDay 存在 storage.local，SW 重启不丢；单条到期直达原网页，多条进收藏库。
- 记录写入全部走 createSerialQueue 串行队列；storage 迁移核心是 consolidateRecords（按 canonical/url 归并跟踪参数变体）。
- 桌面端权威源口径：桌面端在跑时它权威（扩展推、按 updatedAt 合并、每分钟回拉）；桌面端缺席时扩展行为完全不变。设置各宿各管，v1 不跨端同步。
- **双端要先配对**：桌面端托盘「连接浏览器扩展」生成一次性 6 位码（5 分钟有效、只能用一次、猜错 5 次作废），扩展在收藏库页输入码换 token。业务端点（/records /state /events）必须带 `x-yidian-token`；扩展身份靠 `x-yidian-extension` 头。**没配对时扩展不推不拉，安静等着。**
- **装完即对齐**：扩展每个心跳（`yidian-desktop-sync` 闹钟）都推一次自己的状态，桌面端用指纹判重后不重复写盘；配对成功的那一次会立刻推一次。所以桌面端装好后，扩展里攒的收藏一分钟内自动过去。

## 实测踩坑（本项目验证过）

- **扩展发起的简单 GET 不带 Origin 头！** Chromium 只在非简单请求上补 Origin。Node 的 fetch 会自动带 Origin，**单元测试全绿**，真扩展去探活时桌面端却会把请求当成本机进程拒掉——扩展根本发现不了桌面端。→ 桥的身份必须由我们自己带的头（`x-yidian-extension`）承担，Origin 只用来交叉校验。改桥的鉴权前，先用 `npm run test:e2e` 在真浏览器里验一遍。
- **扩展有 host_permissions 时不走 CORS 预检**，自定义头能直接送到；CORS 回显只对扩展来源开，其它一律不回显（回显任意来源等于把收藏送出去）。
- 未打包扩展 alarm 最小间隔约 30 秒；打包（商店）版会被钳到 1 分钟以上。自测把 nextReviewAt 拨到 1 分钟后：`node tools/seed-due.mjs --count 1 --in-minutes 1` 生成可粘贴到 Service Worker 控制台的片段。
- MV3 Service Worker 会被挂起：内存态（lastNotifiedRecord 等）重启即丢，去重与状态必须落 storage；此时点通知兜底进 library.html，属预期行为。
- 通知默认关闭（notifyOnDue=false），自测前先在“我的收藏”打开。
- 工具栏点击回看优先：只要存在到期记录，打开的是到期记录宠物（review 模式）而非当前页。
- 内容脚本注入失败（chrome://、商店页）用棕色 ! 角标提示，页面 navigation 时清除。
- **扩展页面缺 `domain.mjs` 会静默停在「0 条收藏」**（ES 模块 404，页面脚本压根没跑）。桌面端 bundle 必须带 `domain.mjs`——core-sync 测试已守。
- **electron-builder 的图标转换工具在 Windows 上崩溃**（`icon-tool.js` 退出码 3221225477）→ 用 PIL 预生成 `build/icon.ico` 并在 build 配置里指向它。
- **Electron / GitHub 直连失败** → 打包必须带镜像：`ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/`、`ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/`。
- **`capturePage` 对后台窗口抛 `UnknownVizError`** → 抓图前先 `showInactive()` + `focus()` + 等约 900ms。
- 站酷小薇体**上游就把「回」「一」画成实心方块** → 大字文案避开「回」，子集必须覆盖界面文案全部字符（`tests/font-guard.test.mjs` 会卡住）。
- **往 `pet.js` / `card.js` / `shared.js` 里加新的中文文案，会要求重建字体子集**（守卫扫这三个文件的非注释字符）。要新文案又不想重建字体，就把新界面放到**不在守卫范围**的文件里（例如收藏库页 `library.*`、宠物卡只展示动态内容），或者老实跑 `tools/build-font-subset.py` 重建（要上游字体 + fonttools，还要改 `tests/font-guard.test.mjs` 里的指纹）。
- **字体守卫原本扫全文取字（含注释）** → 改一句中文注释就要求重建字体子集，纯噪音。现在守卫与 `tools/build-font-subset.py` 都按「整行注释豁免」处理（行尾注释仍计入，宁可严不可漏），字体二进制不用动。
- **`start === end` 的免打扰窗口等于「永不静默」**（`inQuietHours` 里零长度窗口直接返回 false）。写静默窗口要给出真实区间，别拿「当前小时」当 start=end。
- **桌面端采集曾经只拿到一个 URL**（`tab: { title: '', url, excerpt: '' }`）→ 标题走兜底「域名 · 时间 收藏」、摘录恒空，主产品收的东西比扩展还弱。现在 `core/capture.mjs` 负责组装，`main.mjs` 的 `fetchPageMeta()` 负责抓（`net.fetch` + 超时 + 普通 Chrome UA，Electron 默认 UA 会被不少站点挡掉）。
- **桌面端专属消息要有人接**：卡片上的「收下剪贴板」发的是 `desktop-clipboard-mark`，之前只有发送方没有处理方 → 点了没反应。现在它在 `routeMessage` 里转给 `captureUrl`。
- 抓页面元信息要用**标准 meta 优先**（`name=description` > `og:description`）：og 多半是投放文案，标准 description 才是站点自己写的那句话。
- **到期通知的正文要带内容本身**（批注 > 选段 > 描述，截断 120 字），不是一句气氛话 —— 被叫回来的那一刻就该把内容递到眼前（Readwise 的每日邮件正文就是高亮原文）。
- **别在扩展注入的宠物卡里放输入框**：内容脚本跑在别人的页面上，输入框会抢页面的键盘。写批注放收藏库（两端同一份 `library.js`），宠物卡只负责**展示**。
- **别为了「内容更全」去抓正文**：涉及版权、存储膨胀和隐私，且与「一次只带一份到期内容」的口径冲突。正文快照是演进路径。

## 验证路由

- 全量单测：`npm test`（根目录）。含领域层、core 副本守卫、桌面端内核与平台适配器、本地桥鉴权、字体守卫。
- 纯函数聚焦检查：`node --test tests/domain.test.mjs`（node:test，无框架无构建管线）。
- 副本漂移检查：`node tools/sync-shared.mjs --check`（等价于 core-sync 测试的那部分）。
- 通知链路本地诊断（不触碰 chrome.*）：`node tools/simulate-review.mjs --records records.json [--now <ISO>]`，输出含时间、normalizedUrl 记录键与决策。
- 真实浏览器 UI 测试：`npm run test:e2e`（Playwright 加载未打包扩展，需先 `npm install` + `npx playwright install chromium`）。**改了桥的鉴权、配对、消息类型，必须跑这个** —— 单元测试的 fetch 行为跟浏览器不一样。
- 真桌面端 × 真扩展联调：`npm run test:e2e:desktop`（会拉起 Electron + Chromium，验证配对与「装完即对齐」）。
- 桌面端采集链路（真 Electron × 真本地网页，验 `net.fetch` → store.json 里标题和描述都在）：`npm run test:e2e:desktop:capture`。
- **打包版真跑**（直接跑装好的 exe，验交付物本身）：`npm run test:e2e:desktop:packaged`；没打过包会跳过。
- 桌面端实跑：`npm run desktop`；抓图验收：`npm run desktop:capture`（写入 `docs/captures/`）；打包内容核对：`npm --prefix packages/yidian-desktop run verify:pack`。

设计口径的来源：`research/content-layer-design.md`（采集端补内容）与 `research/resurfacing-review-design.md`（复现那一刻该交付什么，对标 Readwise / Raindrop / Instapaper）。

## 发布清单

扩展：

1. `npm test` 全绿。
2. `node tools/sync-shared.mjs`（改了 core 或界面就必须跑）。
3. 权威源 zip 重打包：`Compress-Archive` packages/yidian-X.Y.Z 内容（不含外层目录）。
4. manifest.json version 与目录名一致。
5. git 提交后打 tag `vX.Y.Z`；改过快捷键等关键配置需删旧 tag 重打，并同步 gh-pages 产物 zip。
6. Edge 商店素材：300x300 Logo、1280x800 封面、商店截图（见 交付/ 目录历史结构）。

桌面端：

1. `npm test` 全绿 + `node tools/sync-shared.mjs --check` 一致。
2. `cd packages/yidian-desktop`，带镜像环境变量跑 `npm run dist`（NSIS 安装包）或 `npm run dist:dir`（免安装目录）。
3. 产物在 `packages/yidian-desktop/dist/`；实跑安装包确认桥起、提醒正常。
4. macOS 需在 mac 上跑 `npm run dist:mac`（dmg + zip），Windows 上打不出可用签名包。

## Windows PowerShell 5.1 注意

- 无 BOM 的 UTF-8 脚本会按 ANSI 误读中文：ps1 文件必须带 UTF-8 BOM；param 必须是脚本第一条语句。
- `>` 重定向会写 UTF-16LE，需要 UTF-8 落盘时用 node 脚本或 Out-File -Encoding utf8。
- 删文件走 `rm -- "<绝对路径>"`（mavis-trash），`Remove-Item` 被硬策略拦截。
- `git mv` 前先建目标目录，否则报 “No such file or directory”。
