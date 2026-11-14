# 一点 · 桌面常驻层设计（Electron）

日期：2026-11-13
状态：已实现并验收（核心抽包完成、桌面端可跑可打包、扩展侧接桥完成、截图见 `docs/captures/`）。

## 0. 为什么是这一刀

浏览器限制有六条，但真正让一点「用不起来」的只有两条：

| 限制 | 后果 | 本次是否解决 |
|---|---|---|
| 宠物只在网页里（`chrome.scripting` 注入当前标签页） | 不打开网页，那只水獭根本不存在 | ✅ 桌面端常驻置顶 |
| 提醒只在浏览器活着时（MV3 SW 会被挂起） | 浏览器一关，提醒 = 不存在 | ✅ 桌面端自己的调度器 |
| 采集面窄（只能收标签页） | Notion 桌面版 / Obsidian / PDF 阅读器看不见 | ✅ 桌面端自己也有采集通道（热键收剪贴板 + 拖链接） |
| 数据绑死浏览器（chrome.storage.local） | 不跨设备、卸载即丢 | ⚠️ 桌面端成为权威源，跨设备见 §9 |
| 商店节奏（Edge 商店还停在 1.0.1，官网已 1.3.0） | 用户拿到的功能少三版 | ❌ 与桌面层无关，另行处理 |
| 快捷键是浏览器里的 | 不能对着别的应用「收下」 | ✅ 桌面端全局热键 `Control+Alt+Y` |

结论：**扩展继续当采集器 + 分发口，桌面端接管「提醒 + 宠物 + 回看」并成为主产品**。
产品从「浏览器里的一个功能」变成「系统里的一只宠物」。

### 这一轮为什么还要「抽核心」

上一轮桌面端是**给扩展的 `service-worker.mjs` 垫一层 chrome API 垫片**然后原样 import。
那版能跑，但它让「桌面端是主产品」这个目标站不住：

- 桌面端的主进程要 import 扩展目录里的文件 → 打包必须带上整个兄弟目录，`files` 白名单很难写；
- 业务逻辑仍住在扩展包里 → 扩展一旦冻结，桌面端就没法独立演进；
- 「谁在管业务」说不清。

所以这一轮把核心抽出来：`core/` 是**业务语义源头**，扩展与桌面端各自降级为**适配器**。

## 1. 架构总原则：业务逻辑零重复

核心资产只有两处，都在 `core/`：

| 文件 | 职责 | 约束 |
|---|---|---|
| `domain.mjs` | 纯函数领域层：归一化、合并、推进、分日、免打扰 | 时间函数带 `now = Date.now()` 注入点；**禁止触碰 chrome.\* / electron** |
| `messages.mjs` | 平台无关消息层：`createMessageLayer(platform)` | 只通过 platform 能力取数/通知；不出现任何端特有 API |

消息层统一实现 `handleMessage / maybeNotifyDue / scheduleNext / refreshBadge / openNotifiedRecord / getRecords` 等，
两端共用同一条代码路径。平台适配器要提供的能力：

```js
platform = {
  storage,          // chrome.storage.local 语义（桌面端 = 文件存储）
  openUrl,          // 打开原网页
  openLibrary,      // 打开收藏库
  notify,           // 系统通知
  clearNotification,
  setAlarm, clearAlarm,
  setBadge?,        // 扩展独有（角标）
  onRecordsChanged?,// 桌面端用它刷新界面
  now?,             // 注入时钟，测试用
}
```

各端只写「壳」：

| 端 | 适配器 | 独有能力 |
|---|---|---|
| 扩展 | `extension/service-worker.mjs` | 角标、内容脚本注入、浏览器快捷键、侧边栏、扩展桥同步 |
| 桌面端 | `packages/yidian-desktop/core/platform.mjs` | 托盘、置顶宠物窗、卡片窗、收藏库窗、全局热键、本地桥、开机自启 |

`tests/core-sync.test.mjs` 同时守三件事：副本一字不差、桌面端不再 import 扩展 SW、扩展里不再残留业务函数。

## 2. 数据流

```
        ┌──────────────── 扩展（Chromium MV3）────────────────┐
        │  网页 → 快捷键/工具栏 → 读 activeTab → createRecord  │
        │                    ↘ POST /records（本地桥，尽力而为） │
        └─────────────────────────────────────────────────────┘
                                     │  127.0.0.1:39717
                                     ▼
        ┌──────────────── 桌面端（Electron）───────────────────┐
        │  桥 → 合并进权威存储 → 调度器 → 到期 → 系统通知 + 宠物 │
        │  权威存储：%APPDATA%/一点/store.json                  │
        │  回拉：扩展每分钟 GET /state → 本地镜像覆盖成权威状态   │
        └─────────────────────────────────────────────────────┘

        ┌──────────────── 桌面端自己的采集 ────────────────────┐
        │  全局热键 Control+Alt+Y → 读剪贴板链接 → 收下        │
        │  把链接拖进宠物窗/卡片窗 → 收下                       │
        └─────────────────────────────────────────────────────┘
```

### 谁是权威源

- **桌面端在跑** → 桌面端权威。扩展每次变更后 POST，桌面端按 `updatedAt` 合并（新的赢），
  并回一份全量状态；扩展把本地 `chrome.storage.local` 覆盖成这份状态（镜像）。
- **桌面端没跑** → 扩展照旧独立工作（现在的行为完全不变），本地存储就是权威。
- **桌面端后启动** → 扩展下次变更时会把本地记录推上来，按 `updatedAt` 合并。

合并规则复用 `domain.mjs` 的 `mergeByKey`（按 `normalizedUrl` 取 `updatedAt` 更新的一条）——
和仓库里「多标签页合并 = 新的赢」的既有口径一致。

### 设置各宿各管（v1 不跨端同步）

「到期时提醒我」「免打扰」「安静一下」这三个设置，**扩展存扩展的，桌面端存桌面端的**，
各自决定自己那一侧的行为。理由：设置没有时间戳，跨端同步会出现「后写赢」的互相覆盖，
反而比不同步更难预期。扩展侧只推记录与归档，不推设置。

### 为什么不用「云端权威」

一点的产品承诺是「本地优先、少权限、不建后端」。桌面端把权威源放在本机文件，
云同步是独立的一轮工程（§9），不混进这一刀。

## 3. 目录与命名

```
packages/
  yidian-core/                业务语义源头
    domain.mjs                纯函数领域层
    messages.mjs              平台无关消息层
  yidian-1.3.0/               扩展发行物
    service-worker.mjs        扩展适配器（chrome 能力 + 浏览器独有能力 + 桥同步）
    bridge-client.mjs         扩展侧桥客户端
    domain.mjs / messages.mjs  ← 同步副本（沙箱只能读自己目录）
    library.* / stats.* / pet.css / shared.js / fonts / icons
  yidian-desktop/             桌面发行物
    main.mjs                  应用装配：协议、窗口、托盘、热键、桥、调度器、开机自启
    preload.mjs               渲染进程垫片：window.chrome.runtime.{sendMessage,onMessage}
    core/
      platform.mjs            桌面平台适配器（createDesktopPlatform）
      store.mjs               文件存储：原子写、串行队列、chrome.storage.local 语义
      bridge-server.mjs       127.0.0.1 本地桥（GET /ping、GET /state、POST /records…）
    renderer/                 宠物窗与回看卡片窗
    vendor/yidian-core/       ← 同步副本（核心）
    assets/bundle/            ← 同步副本（界面：收藏库页、统计页、宠物样式、字体、图标）
    build/icon.ico            预生成图标（绕开 electron-builder 图标转换崩溃）
```

命名口径：

- 窗口：`petWindow`（宠物）、`cardWindow`（回看卡片）、`libraryWindow`（收藏库）。
- 消息类型：**完全沿用扩展的**（`list-records` / `complete-review` / `mark-current` …），不另起一套；
  桌面端专属的类型统一以 `desktop-` 前缀（`desktop-summary` / `desktop-clipboard-mark`）。
- 本地桥路径：`/ping`、`/state`、`/records`、`/settings`、`/events`；端口从 39717 起，冲突则顺延。
- 副本同步统一走 `node tools/sync-shared.mjs`（`--check` 只校验）。

## 4. 桌面端自己的采集通道

扩展再强也只能看见「浏览器里正在看的那个标签页」。桌面端必须能收下**浏览器之外**看到的东西。

### 4.1 全局热键 `Control+Alt+Y`

按住 `Ctrl+Alt+Y`：

- 剪贴板里是链接 → 立刻收下（标题与一句描述从页面抓回来，抓不到才回落到域名），弹出小气泡确认；
- 剪贴板里没有链接 → 呼出回看卡片窗（到期的那一条）。

**为什么不用 `Ctrl+Shift+Y`**：那是扩展已有的快捷键。两边都注册同一个键，
在浏览器前台时会被两边同时响应，用户会以为收下了两次。`Ctrl+Alt+Y` 与扩展的键不重叠。

### 4.2 拖链接进来

宠物窗与卡片窗都支持把浏览器标签页拖进来（`dragover` 高亮 `.o-drop` → `drop` 收下）。
这是零安装路径：不用装桌面端也能拖，但装了桌面端之后拖进来的东西直接进桌面端那份权威存储。

### 4.3 托盘菜单

「收下剪贴板里的链接」「开机时自动打开」都放在托盘右键菜单里，作为热键的备选入口
（有些环境全局热键会被别的软件抢走）。

### 4.4 边界（诚实说明）

Windows 上**拿不到别的应用的 URL**——只能拿到窗口标题，做不到「对着 Notion 桌面版按一下就收下」。
所以现实做法是「剪贴板 + 拖拽 + 扩展桥」三件套，扩展桥仍是主力，桌面端补的是「不打开浏览器也能收」。

## 5. 画风与体验约束（照抄扩展，不重新发明）

- 视觉：**直接加载扩展的 `pet.css`**，DOM 结构与类名保持一致（`#otter-yidian-pet` 等），
  所以桌面宠物和网页宠物长得一模一样。桌面端只加一层覆盖样式，压掉「网页端假设根节点铺满视口」的定位方式。
- 文案：沿用 `shared.js` 的 `YIDIAN_COPY` 与扩展里的口吻（「一点想再见它一面」「它来啦」）。
  桌面端不新造人格。
- 一次只带回一份：到期时只展示最早到期的那一份，不显示剩余数量（延续扩展的原则）。
- 不惩罚中断：桌面端不做逾期计数、不做倒计时施压。
- 免打扰：沿用 `inQuietHours` / `quietEndAt`，静默结束 30s tick 补判定。
- 零拦截：宠物窗不抢焦点（`focusable: false`），只有点击它才拿焦点。
- reduced-motion：JS 层 gate（`matchMedia`）+ 设置项，动画全关、宠物不巡游。

## 6. 宠物窗的行为

- 窗口：透明、无边框、置顶（`floating`）、不进任务栏、尺寸贴着宠物本体（约 132×152）。
- 位置：默认主屏右下；**窗口自己在屏幕上慢慢走**（主进程定时移动窗口，碰到边缘折返），
  而不是网页端那种 DOM 内游走——桌面端这样才像真站在桌面上。托盘里可以让它停下。
- 拖动：按住宠物拖 → 主进程跟随指针移动窗口；松手后停在原地。
- 点击：弹出回看卡片窗（贴在宠物旁边），卡片内容与扩展的 `.o-*` 卡片同款；
  卡片窗按内容自动改尺寸，不挡住桌面其他部分。
- 到期时：系统通知（默认关闭，可在收藏库打开，与扩展口径一致）+ 托盘菜单可查。

## 7. 扩展侧的最小改动

1. `manifest.json` 增加 `host_permissions: ["http://127.0.0.1/*"]`。
2. 新增 `extension/bridge-client.mjs`：
   探活 `/ping`（失败静默，负缓存 30 秒）、配对 `/pair`、推 `/records`、拉 `/state`、发 `/events`。
3. `service-worker.mjs`：
   - 重写为**适配器**：调用 `createMessageLayer(createExtensionPlatform())`，自身只留 chrome 独有能力；
   - 每次记录变更后 `POST /records`（不阻塞主流程，失败只打日志）；
   - 新增 `yidian-desktop-sync` 闹钟（每分钟）拉一次 `/state`，按 `updatedAt` 合并回本地镜像；
   - **心跳也推一次自己的状态** —— 桌面端刚装上时，扩展里攒的收藏会自动过去（装完即对齐）；
   - 同步期间用 `suppressBridgePush` 关掉回推，避免推拉循环。
4. **桌面端缺席时行为完全不变**（桥的任何失败都不影响扩展原有链路）。
5. **桥要先配对**：业务请求要带 token，没配对就安静等着 —— 设计与残余风险见 `research/bridge-trust-design.md`。

## 8. 打包与分发

| 项 | 取值 |
|---|---|
| 工具 | electron-builder 26.18.0 + electron 45.3.2 |
| appId | `com.yidian.desktop` |
| productName | 一点 |
| Windows | NSIS 安装包（可选安装目录 + 桌面快捷方式 + 开始菜单），x64 |
| macOS | dmg + zip（需在 mac 上打） |
| 输出 | `packages/yidian-desktop/dist/` |

打包必带国内镜像，否则 Electron 与 builder 二进制拉不下来：

```bash
cd packages/yidian-desktop
export ELECTRON_MIRROR='https://registry.npmmirror.com/-/binary/electron/'
export ELECTRON_BUILDER_BINARIES_MIRROR='https://registry.npmmirror.com/-/binary/electron-builder-binaries/'
npm run dist        # NSIS 安装包
npm run dist:dir    # 免安装目录
```

**图标坑**：electron-builder 的 `icon-tool.js` 在本机 Windows 上崩溃（退出码 3221225477）。
解法是用 PIL 预生成多尺寸 `build/icon.ico`，在 `build.win.icon` 里直接指向它。

**开机自启**：`app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath })`，
托盘菜单可开关。注意 Windows 上「装了就自动开」会让人以为装完就有东西在跑，
所以默认关闭、由用户自己开。

## 9. 明确还没做的部分

- **跨设备 / 手机端 / 云同步**：需要账号与后端，是独立一轮工程（与「本地优先」有张力，需先决策）。
- **对别的应用直接采集**：见 §4.4，Windows 拿不到别的应用的 URL。
- **多显示器 / 缩放比例（DPI）**：位置按物理像素算，未做多屏与缩放适配。
- **macOS 实跑验证**：配置已写好（dmg + zip），但没在 mac 上打过包、没实跑过。
- **自动更新**：未做（electron-builder 的 publish 也没配）。
- **代码签名 / 公证**：未做，Windows 会弹 SmartScreen 警告，macOS 无法正常分发。
- **本地桥的强绑定**：已经加了配对码 + token（见 `research/bridge-trust-design.md`），
  但同用户的恶意进程仍能读用户目录里的文件；要彻底解决要换成 Native Messaging（浏览器做中介）。
- **双端同时推进同一条记录**：扩展的本地副本若比桌面端旧，仍可推进一阶；
  合并按 `updatedAt` 取新的那条，因此**进度不会多涨一阶**，但下次回看的日期可能差几天。
- **扩展 1.3.1 上架**：Edge 商店仍停在 1.0.1，工作区里的 1.3.1 未提交、未上架。
- **侧边栏那条采集路径还不带描述**：扩展侧边栏（`Alt+Shift+Y`）保存时拿不到页面描述，
  要拿得在 SW 里 `chrome.scripting.executeScript`，但 `chrome.sidePanel.open` 必须留在用户手势调用栈里，
  前面加 await 会破坏手势 —— 这条路暂时不安全。

> 「开机后扩展与桌面端的首次同步」这条**已经修掉**：扩展每个心跳都会推一次自己的状态，
> 配对成功时也会立刻推一次 —— 所以桌面端装好后，扩展里攒的收藏一分钟内自动过去。

> 「桌面端收下的东西只有一个链接」这条**已经修掉**：采集时会抓页面的标题与一句描述，
> 见 `research/content-layer-design.md`。

> 「回看时只能『完成』，不能『回应』」这条**已经修掉**：新增一句话批注（`note`），
> 到期通知的正文也带上了内容本身，见 `research/resurfacing-review-design.md`。

## 10. 顺手发现并修掉的一个视觉坑

桌面端复用扩展的 `pet.css` 后，卡片上最显眼的那行大字出现了**一个黑色方块**（本该是「回」）。

查下来不是子集化出错：站酷小薇体这款展示字体**上游就把「回」「一」画成实心方块**
（`tools/build-font-subset.py` 会对这类字给出提醒）。三步处理：

1. 文案避开它：宠物的到期台词从「它回来啦。」改成「**它来啦。**」，语气不变。
2. 字体子集重建：从原始字体重新子集，覆盖界面文案用到的全部 214 个字，
   避免新增文案掉到系统字体、整句话变成两种字体。
3. 加守卫：`tests/font-guard.test.mjs` 解析 TTF 的 cmap，断言
   「界面文案里的每个字都在内置字体里」，同时锁住字体指纹，防止有人把旧字体换回来。

产物：`tools/build-font-subset.py`（重建 + 栅格化自检）、`tests/font-guard.test.mjs`（node 守卫）。

## 11. 验收方式

- `npm test`：领域层 + core 副本守卫 + 桌面端内核与平台适配器 + 本地桥鉴权 + 字体守卫 + 页面元信息（87 项）。
- `npm run test:e2e`：Playwright 加载未打包扩展，验证扩展侧没有回归（含真实浏览器里跑通 SW 消息层、配对流程，以及「没有选中文字时用页面描述顶上」）。
- `npm run test:e2e:desktop`：真 Electron × 真 Chromium 联调，验证配对一次后收藏立刻对齐；随后跑桌面端采集链路（真 Electron × 真本地网页，验标题与描述都进了 `store.json`）。
- `npm run test:e2e:desktop:packaged`：直接跑装好的 exe 再验一遍抓取（没打过包会跳过）。
- `npm run desktop:capture`：启动桌面端、写入演示数据，抓宠物窗/卡片窗/收藏库/配对窗四张图到 `docs/captures/`。
- `npm --prefix packages/yidian-desktop run verify:pack`：核对打包产物里的关键文件。
- `node tools/sync-shared.mjs --check`：副本与源头一字不差。
