# 一点 · 桌面常驻端

浏览器扩展把网页收下，桌面端负责**在浏览器之外把你叫回来**：
托盘常驻、宠物在桌面上、透明置顶的小卡片、系统通知、浏览器关着也照常提醒。

这是「一点」现在的主产品。扩展保留为采集器与分发口（冻结，不加新功能）。

## 跑起来

```bash
cd packages/yidian-desktop
npm install
npm start
```

首次运行会在 `%APPDATA%/一点/store.json` 建一份本地存储（就是扩展那份数据的桌面版）。

抓图验收（会写入 `docs/captures/`）：

```bash
npm run capture
```

## 它是怎么工作的

| 部件 | 作用 |
|---|---|
| `main.mjs` | 托盘 / 置顶宠物窗 / 卡片窗 / 收藏库窗 / 配对窗 / 全局热键 / 本地桥 / 调度器 / 开机自启 |
| `core/platform.mjs` | 桌面平台适配器（`createDesktopPlatform`）：把存储、打开、通知接到 Electron |
| `core/store.mjs` | 文件存储（原子写 + 串行队列），语义对齐 `chrome.storage.local` |
| `core/bridge-server.mjs` | `127.0.0.1` 上的本地桥：只绑回环、CORS 只对扩展回显、鉴权交给上层 |
| `core/bridge-route.mjs` | 桥的路由（ping / pair / state / records / events），独立成模块便于测试 |
| `core/pairing.mjs` | 配对与鉴权：一次性配对码、扩展白名单、token 校验 |
| `core/capture.mjs` | 采集解析层：链接 → 一条带标题与描述的记录（网络那部分由 `main.mjs` 注入，方便单测） |
| `renderer/` | 宠物窗、回看卡片窗、配对窗；收藏库直接用扩展的 `library.html`（打包成 `app://bundle`） |
| `vendor/yidian-core/` | 核心副本（同步产物，勿手改） |
| `assets/bundle/` | 界面副本：收藏库页、统计页、宠物样式、字体、图标（同步产物，勿手改） |

**业务逻辑没有重写，也没有复制**：桌面端 import `vendor/yidian-core/messages.mjs`，
用 `createMessageLayer(platform)` 把「存储 / 打开 / 通知 / 闹钟」接到桌面实现上，
于是「收下 / 回看 / 归档 / 导入 / 到期提醒」两端跑的是同一份 `handleMessage`。

核心与界面的源头在 `core/` 与 `extension/`。
改了源头要跑一次同步（见下）。

## 采集通道

扩展只能看见「浏览器里正在看的那个标签页」，桌面端补的是**不打开浏览器也能收**：

| 方式 | 操作 | 说明 |
|---|---|---|
| 全局热键 | `Control+Alt+Y` | 剪贴板里有链接 → 收下；没有 → 呼出回看卡片 |
| 拖拽 | 把标签页拖进宠物窗 / 卡片窗 | 落下时高亮 `.o-drop` |
| 托盘 | 右键「收下剪贴板里的链接」 | 热键被别的软件抢走时的备选入口 |
| 扩展桥 | 扩展自动推送 | 主力采集面 |

热键选 `Ctrl+Alt+Y` 是为了避开扩展自己的 `Ctrl+Shift+Y` —— 两边都注册同一个键会被同时响应。

**桌面端收下的东西是有内容的**：采集时会用 Electron 的 `net.fetch` 抓一次页面，
把**真实标题**和**页面自己写的一句描述**一起收下（抓不到就退回「域名 · 时间 收藏」的兜底标题，收藏照收）。
所以桌面端收的链接不再只是一个坐标，回看卡片上有一句能想起来的话。
解析口径在 `core/page-meta.mjs`（纯函数，两端共用）。

自动化验收：

```bash
cd C:\12730
npm run test:e2e:desktop:capture   # 真 Electron × 真本地网页：标题与描述都进了 store.json
npm run test:e2e:desktop:packaged   # 直接跑装好的 exe 再验一遍（没打过包会跳过）
```

## 回看那一刻给你什么

一点把你叫回来的那一刻，**递给你的不是链接，是内容本身**：

- **你写的那句**（批注）排最前面 —— 「这条对我意味着什么」；
- 其次是**你亲手选的那段**；
- 再其次是**页面自己写的一句描述**；
- 最后才是标题和域名。

到期提醒的**正文**也是那句话（批注 > 选段 > 描述），不是一句气氛话。
批注写在收藏库里（扩展与桌面端同一份页面），随时能改、能清；宠物卡片与回看卡片只负责**展示**它。

写下的东西是链接失效后唯一还在的东西 —— 这是「一点」和「稍后读」最不一样的地方。

## 连接浏览器扩展（配对）

桌面端和扩展共用一个收藏库，但**不是**谁都能读写它：

1. 桌面端托盘里点「连接浏览器扩展」→ 生成一串 6 位码（自动复制到剪贴板），并弹一个窗显示它；
2. 在浏览器里打开扩展的「我的收藏」页，把码粘进去，回车；
3. 接上了。扩展里攒的收藏会在一分钟内自动搬到桌面端（不用你再做什么）。

那串码只能用一次、5 分钟失效、猜错 5 次就作废。接上之后，收藏的读写都要带一把只有两端知道的凭证，
本机其它进程、网页、别的扩展都碰不到你的收藏。

托盘里随时可以「断开浏览器扩展」。

脚本化接入（或者自动化验收）可以用 `--pair-code`：配对码会同时写到 `user-data-dir` 里的 `pair-code.txt`。

```bash
npx electron . --pair-code --user-data-dir=/tmp/yidian
```

设计与残余风险见 `research/bridge-trust-design.md`。

## 同步共享副本

扩展被浏览器沙箱限制只能 import 自己目录内的文件；桌面端打包后不能依赖仓库里的兄弟目录。
所以核心与界面都以源为准，同步出副本：

```bash
cd C:\12730
node tools/sync-shared.mjs          # 写入
node tools/sync-shared.mjs --check  # 只校验
```

副本被手改或忘记同步，`tests/core-sync.test.mjs` 会红（`npm test` 里已包含）。

## 打包

必须带国内镜像，否则 Electron / builder 二进制拉不下来：

```bash
cd packages/yidian-desktop
export ELECTRON_MIRROR='https://registry.npmmirror.com/-/binary/electron/'
export ELECTRON_BUILDER_BINARIES_MIRROR='https://registry.npmmirror.com/-/binary/electron-builder-binaries/'
npm run dist        # NSIS 安装包 → dist/一点 Setup 0.1.0.exe
npm run dist:dir    # 免安装目录 → dist/win-unpacked
npm run dist:mac    # dmg + zip（需在 mac 上打）
```

图标用预生成的 `build/icon.ico`（electron-builder 自带的图标转换工具在 Windows 上会崩）。

打包完可以核对一下包里到底有什么（`domain.mjs` 缺失会让收藏库页**静默停在 0 条**，
因为它是 ES 模块、404 了页面脚本压根没跑）：

```bash
node tools/verify-pack.mjs
```

它会逐个抽取 asar 里的关键文件做内容断言，并比对打包产物与本次构建是否字节一致。

## 与扩展的关系

- 扩展是**采集器 + 分发口**：只有它知道当前网页的标题、URL、选段；零安装、一键采集是别的端做不到的。
- 桌面端是**提醒与回看闭环**：到期时系统通知 + 宠物卡片，`Ctrl+Alt+Y` 全局呼出。
- 两端通过 `127.0.0.1` 上的窄桥同步，**要先配对**（见上）。配对后：
  - 桌面端在跑时它权威（扩展推、按 `updatedAt` 合并、每分钟回拉）；
  - 桌面端不在时扩展照旧独立工作，行为完全不变（桥的失败一律静默）。
- 设置各宿各管，v1 不跨端同步。

## 还没做的

跨设备 / 云同步、手机端、代码签名与自动更新、多显示器与 DPI 适配、
本地桥的 token 配对（现在有一次性配对码 + token，但没有带外共享密钥的强绑定）、
macOS 实跑验证。清单见 `research/desktop-layer-design.md` §9。

设计与残余风险见 `research/desktop-layer-design.md` 与 `research/bridge-trust-design.md`。
