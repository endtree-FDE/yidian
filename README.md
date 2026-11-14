# 一点｜工作与学习的收藏回看工具

> 重要的，不只见一次。

每条内容共 4 步：收下 1 次，再回看 3 次。

一点把你在工作和学习中收藏的重要内容，在第 2、7、30 天重新带到面前。当前版本是 `1.3.4`，面向 Chrome 与 Edge 电脑浏览器，扩展清单为 Manifest V3。第 1 天收下整页或选段，进度变为 1/4；以后在第 2、7、30 天各回看一次。记录留在这台浏览器里，使用时不需要登录。

如果一点确实帮你把一份重要内容重新带回了工作或学习，欢迎给这个开源项目一个 [Star](https://github.com/endtree-FDE/yidian)。

## 目录与架构

浏览器里运行的是 `extension/`。节奏、网址归一和记录规则写在 `core/domain.mjs`，并按字节复制到 `extension/domain.mjs`。`tests/core-sync.test.mjs` 会核对这两份文件是否一致。

- `core/`：与界面无关的领域逻辑。`domain.mjs` 负责网址规范化、1/2/7/30 的回看节奏、进度推进、免打扰、搜索、统计和 Markdown 导出。`adapter.mjs` 约定 `readRecords`、`writeRecords`、`readSettings`、`writeSettings`，并提供内存适配器与 JSON 文件适配器，给扩展以外的宿主使用。扩展本身直接读写 `chrome.storage.local`。
- `extension/`：Manifest V3 扩展，版本写在 `manifest.json`，与 `package.json` 同为 `1.3.4`。`service-worker.mjs` 是模块化后台，处理收藏、闹钟、工具栏数字、可选通知和消息。用户点击图标或快捷键时，后台用 `scripting` 把 `pet.js` 注入当前普通网页；清单里没有常驻内容脚本，也没有 `host_permissions`。`sidepanel.html` 显示打开时的网页状态，`library.html` 是“我的收藏”，同时作为选项页，`stats.html` 是本地回看统计。`runtime.mjs` 把后台连接失败转成中文说明，并打开当前浏览器的扩展管理页。`shared.js` 只放文案。图标在 `icons/`，宠物对白使用 `fonts/` 里的站酷小薇体。
- `studio/`：ModelScope Static 创空间。`studio/README.md` 声明 `sdk: static`，入口是 `index.html`。首页包含互动演示、安装说明和隐私摘要，另有 `changelog.html`、`privacy.html`、`contact.html`。`app.js` 负责演示，`pwa.js` 与 `service-worker.js` 提供离线外壳。本目录不存放扩展安装包。
- `tests/`：用 Node 内置测试运行器覆盖领域规则、后台消息、侧边栏、收藏库、宠物、清单和创空间页面。`tests/e2e/upgrade.mjs` 用 Playwright 做真实浏览器里的升级检查，不包含在 `npm test` 里。
- `scripts/`：`release.ps1` 在检查通过后，把 `extension/` 打成 ZIP，写到 `studio/yidian-<版本>.zip`。这个文件被 Git 忽略。
- `skills/`：`skills/yidian/SKILL.md` 给编程助手使用，在对话里执行“收下”和“回看”。它与浏览器扩展分开，记录可以写到当前目录的《一点记录.md》。
- `docs/`：品牌讨论、发布核对和手工验收记录。安装和发布以本说明以及当前源码为准。

清单里的快捷键：`Ctrl+Shift+Y`（macOS 为 `Command+Shift+Y`）收下当前网页或选段；`Alt+Shift+Y`（macOS 为 `MacCtrl+Shift+Y`）打开侧边栏。`minimum_chrome_version` 为 116。权限是 `activeTab`、`alarms`、`notifications`、`scripting`、`sidePanel`、`storage`、`unlimitedStorage`。

## 安装

Edge 商店版 `1.3.4` 已上线，扩展 ID 为 `mdpemepjnajchhlagfkpggenllebeacd`：[去 Edge 商店安装](https://microsoftedge.microsoft.com/addons/detail/mdpemepjnajchhlagfkpggenllebeacd)。商店状态在 2026-10-01 核对为 Live。

Chrome，或需要手动安装时，用“加载解压缩的扩展”：

1. 准备一个根目录里直接有 `manifest.json` 的文件夹。当前仓库的 `extension/` 就是 `1.3.4` 源码。已发布的历史安装包在 [GitHub Releases](https://github.com/endtree-FDE/yidian/releases)；撰写本说明时，上面的附件是 v1.0.0 与 v1.3.0。
2. 把 `chrome://extensions` 或 `edge://extensions` 粘贴到地址栏，打开“开发者模式”。
3. 点“加载解压缩的扩展”。选择器只显示文件夹，ZIP 不会出现；请选择直接包含 `manifest.json` 的那个文件夹。
4. 点浏览器右上角的“扩展”（拼图图标），把“一点”固定到工具栏。

解压版升级时，先在“我的收藏”导出 JSON 备份，再把新文件放进原来的安装文件夹，到扩展管理页刷新原来那一张卡片。换文件夹重新加载会生成另一个扩展 ID，旧收藏留在原来的那一份扩展里。商店版和解压版的数据各自保存，更换安装方式时先导出，再导入。

## 开发与测试

单元测试使用 Node.js 自带的测试运行器，运行前不需要安装依赖。

```text
npm test
npm run check
npm run test:e2e
```

- `npm test` 执行 `node --test`，运行 `tests/*.test.mjs`。
- `npm run check` 在上述测试之后，再用 `node --check` 检查 `extension/domain.mjs`、`extension/pet.js`、`extension/service-worker.mjs` 和 `extension/library.js` 的语法。
- `npm run test:e2e` 执行 `tests/e2e/upgrade.mjs`。先 `npm install` 安装开发依赖 `playwright`。仓库里没有旧版安装包，请设置 `YIDIAN_OLD_ZIP` 指向一份本地 ZIP，或先用 `scripts/release.ps1` 生成已被忽略的 `studio/yidian-<版本>.zip`。默认对照版本是 `1.3.1`，也可以设置 `YIDIAN_UPGRADE_FROM=1.0.1`。

## 发布

1. 同时修改 `package.json` 与 `extension/manifest.json` 的版本，并让官网文案、`studio/README.md` 和 `studio/service-worker.js` 里的缓存名与这个版本一致。
2. 改过领域逻辑后，把 `core/domain.mjs` 原样复制到 `extension/domain.mjs`。
3. 在 PowerShell 中运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1`。脚本会核对两边版本和两份领域文件，执行 `npm run check` 与 `npm run test:e2e`，再把 `extension/` 打成 ZIP，并按文件核对内容哈希。
4. ZIP 写到 `studio/yidian-<版本>.zip`，已被 `.gitignore` 排除。需要对外提供安装包时，把这个文件挂到 [GitHub Releases](https://github.com/endtree-FDE/yidian/releases)，不要提交进仓库。
5. Edge 商店更新沿用扩展 ID `mdpemepjnajchhlagfkpggenllebeacd`。创空间发布时同步 `studio/` 里的页面，不带上 ZIP。

## 隐私

扩展在用户点击图标或按下快捷键时，读取当前普通网页的标题、网址和用户主动选中的文字。它不读取未选择的网页正文，不把收藏记录发到网络，也不要求登录。浏览器本地保存标题、网址、用户主动选择的文本、进度、回来时间和宠物设置。

## 1.3.4 已包含

- 收下整页或选段，并保存主动选择的文字上下文
- 共 4 步：第 1 天收下 1 次，在第 2、7、30 天回看 3 次，进度从 1/4 到 4/4
- 一次只带回一条到期内容
- 收藏库顶部显示“今天看一条”；看过后可选“用上了”“稍后再看”“不再需要”。推迟到明天不改变进度，不再需要会收入可恢复的归档
- 网页宠物巡游、拖动与安静陪伴；站酷小薇体只用于宠物说的话
- 我的收藏：总数、今天待回看、已完成回看计划，以及日期、进度、打开原网页和删除
- JSON 备份的导入与导出，收藏库搜索，完成项归档与恢复，以及 Markdown 导出
- 可选到期通知、默认 22:00–08:00 免打扰，以及按北京时间去重的每日摘要
- 侧边栏展示打开时的网页状态、下次回看时间与操作；切换网页后停用旧页动作
- 短时间内重复点击只确认“已经记下”；隔一段时间再次收下同一内容时记为“途中偶遇”，原来的回看进度保留
- 在收藏页查看相见次数与时间足迹；完成一轮后可以重新开始

## 开发方式

这个仓库的开发由人主导，并使用了 AI 编程协助。提交历史里，不少提交的作者是 Codex。

## 反馈与共建

遇到不好用、不好懂或希望增加的场景，请到 [一点反馈入口](https://github.com/endtree-FDE/yidian/issues/new/choose) 留下问题或建议。仓库里的议题模板分成“使用问题”和“功能建议”。处理结果会回到 Issue 和后续版本记录中。

代码采用 MIT License。欢迎阅读、学习、提出建议；准备贡献代码前，请先在 Issue 里说清想解决的问题。
