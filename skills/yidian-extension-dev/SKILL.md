---
name: yidian-extension-dev
description: 一点（yidian）Chrome/Edge MV3 收藏回看扩展的开发与发布守则。当在 c:\12730 仓库修改 packages/yidian-* 扩展源码、调试到期提醒/免打扰/通知链路、做本地自测、或准备 Edge 商店上架与版本发布时使用。内含本项目实测踩坑：alarm 下限、墙钟时间口径、storage 迁移、注入兜底与发布清单。
---

# yidian-extension-dev

一点是 Chrome/Edge MV3 扩展：第 1 天收下网页，第 2、7、30 天回看（间隔 1/5/23 天，stage 1→4）。

## 权威源与副本

- 唯一权威源：`packages/yidian-<最新版本>/`；旧版本目录、`.deploy/`、`.diff-work/`、worktree 副本全部被 .gitignore 排除。
- 改完权威源后运行 `powershell -File tools/sync-pkg-to-wt.ps1` 同步到开发 worktree；发行 zip 需从权威源重新打包。
- 用户习惯从 packages 目录以未打包扩展方式本地安装测试。

## 架构口径

- `domain.mjs` 是纯函数领域层，所有时间函数带 `now = Date.now()` 注入点；时间相关逻辑必须可注入、可被 `node --test` 覆盖，禁止在领域层触碰 chrome.*。
- 时区口径统一为 Asia/Shanghai 墙钟：免打扰判定（inQuietHours）、分日去重（dayKeyFor，用 en-CA locale 取 YYYY-MM-DD）、静默结束时刻（quietEndAt）。不要用 toISOString().slice(0,10) 分日（那是 UTC）。
- 到期提醒链：alarm(yidian-next-review) → syncDerivedState → maybeNotifyDue（免打扰→到期过滤→digest 去重→selectNextDue）。免打扰跳过时用 yidian-quiet-end 闹钟在静默结束时刻补判定。
- digest 去重键 lastDigestDay 存在 chrome.storage.local，SW 重启不丢；单条到期直达原网页，多条进收藏库。
- 记录写入全部走 createSerialQueue 串行队列；storage 迁移核心是 consolidateRecords（按 canonical/url 归并跟踪参数变体）。

## 实测踩坑（本项目验证过）

- 未打包扩展 alarm 最小间隔约 30 秒；打包（商店）版会被钳到 1 分钟以上。自测把 nextReviewAt 拨到 1 分钟后：`node tools/seed-due.mjs --count 1 --in-minutes 1` 生成可粘贴到 Service Worker 控制台的片段。
- MV3 Service Worker 会被挂起：内存态（lastNotifiedRecord 等）重启即丢，去重与状态必须落 storage；此时点通知兜底进 library.html，属预期行为。
- 通知默认关闭（notifyOnDue=false），自测前先在“我的收藏”打开。
- 工具栏点击回看优先：只要存在到期记录，打开的是到期记录宠物（review 模式）而非当前页。
- 内容脚本注入失败（chrome://、商店页）用棕色 ! 角标提示，页面 navigation 时清除。

## 验证路由

- 纯函数聚焦检查：`node --test tests/domain.test.mjs`（node:test，无框架无构建管线）。
- 通知链路本地诊断（不触碰 chrome.*）：`node tools/simulate-review.mjs --records records.json [--now <ISO>]`，输出含时间、normalizedUrl 记录键与决策。
- 真实浏览器 UI 测试：`node --test tests/e2e/extension.test.mjs`（Playwright 加载未打包扩展，需先 `npm install`）。

## 发布清单

1. `node --test tests/domain.test.mjs` 全绿。
2. 权威源 zip 重打包：`Compress-Archive` packages/yidian-X.Y.Z 内容（不含外层目录）。
3. manifest.json version 与目录名一致。
4. git 提交后打 tag `vX.Y.Z`；改过快捷键等关键配置需删旧 tag 重打，并同步 gh-pages 产物 zip。
5. Edge 商店素材：300x300 Logo、1280x800 封面、商店截图（见 交付/ 目录历史结构）。

## Windows PowerShell 5.1 注意

- 无 BOM 的 UTF-8 脚本会按 ANSI 误读中文：ps1 文件必须带 UTF-8 BOM；param 必须是脚本第一条语句。
- `>` 重定向会写 UTF-16LE，需要 UTF-8 落盘时用 node 脚本或 Out-File -Encoding utf8。
