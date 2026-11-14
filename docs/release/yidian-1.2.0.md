# 一点 1.2.0 发布记录

> 发布日期：2026-08-18｜单次发版，包含收藏库增强、通知优化、温和统计与侧边栏四组功能。

## 这个版本做了什么

### 1. 收藏库增强（library.html / library.js / service-worker.mjs）

- 顶部新增搜索框：按标题、域名、收藏上下文模糊过滤，纯前端实现。
- 状态筛选 chips：进行中 / 待回看（已到期）/ 已完成 / 途中偶遇。
- 新增「归档已完成」动作：100% 记录移入独立存储键 `archivedRecords`，默认隐藏；可在「已归档」筛选中查看并单条恢复（收藏库已有同 URL 时拒绝恢复）。
- service-worker 新增 `archive-grown` / `restore-record` / `list-archived` 消息，归档写入纳入既有 mutation queue 串行。
- 导出备份升级为 v2 格式（含 `archived` 字段），导入向下兼容 v1。

### 2. 通知体验优化（service-worker.mjs）

- 新增设置 `quietHours: { start: "22:00", end: "08:00", enabled: true }`，默认开启；免打扰时段内到期通知静默跳过，记录保持到期状态，下次 alarm 或打开扩展时补提醒。
- 通知点击直达原网页（`chrome.tabs.create`），worker 重启等极端情况回退打开收藏库。
- 通知文案轻量化：标题用记录标题，正文统一为「一点想再见它一面。」。
- 收藏库设置区新增免打扰开关与时间段输入。

### 3. 温和统计（stats.html / stats.js / stats.css）

- 纯本地计算：收藏总数、完成次数、相见总次数、最常收藏的 3 个域名；归档记录计入完成与相见口径。
- 明确禁止 streak、连续天数、逾期计数等压力设计，并以测试断言固化（文案红线词、无图表库、无网络请求、reduced-motion）。
- 复用 mint/paper 视觉体系，无图表库，数字 + 文字。

### 4. 侧边栏视图（sidepanel.html / sidepanel.css / sidepanel.mjs）

- manifest 新增 `sidePanel` 权限与 `side_panel.default_path`；新增命令 `open-side-panel`（快捷键 Alt+Shift+Y，避开 Ctrl+Shift+Y）。
- 从 MVP worktree 移植四态面板（未收下 / 等待回看 / 到期 / 长成），数据改接 1.1.0 的 `records` 结构，经 `get-pet-state` 消息读取；配色由紫系改为 mint/paper，文案沿用「见过 / 再见」口径。
- 工具栏点击行为不变（仍唤起页面宠物）；侧边栏是新增入口，不改变现有习惯。
- 当前页上下文经 `chrome.storage.session` 的 `entryContext:${windowId}` 传递，面板随窗口刷新。

## 跨宿主 groundwork

- 新建 `core/domain.mjs`：URL 归一、1/2/7/30 排期、偶遇、到期选择等纯函数的跨宿主唯一真源；`extension/domain.mjs` 保留为逐字节一致副本。
- `tests/core-sync.test.mjs` 校验两份一致；`scripts/release.ps1` 打包前 SHA256 比对并自动同步，不一致即中止。
- 新建 `core/adapter.mjs`：最小存储适配器接口（readRecords / writeRecords / readSettings / writeSettings），为后续 CLI / Obsidian 铺路；扩展内仍直接用 chrome.storage。

## 测试与验证

- 新增测试：core-sync 一致性、library 搜索/筛选/归档、worker 归档与恢复、quietHours 判定与通知链路、统计口径与无压力设计断言、sidepanel 四态与快捷键命令。
- 全量 `npm test`：99/99 通过；release 脚本测试门禁与 core 同步门禁通过。
- 权限边界：manifest 权限仍严格等于 `activeTab, alarms, notifications, scripting, sidePanel, storage`，无 host_permissions。

## 产物与发布动作

- 本地构建产物 `packages/yidian-1.2.0.zip`（扁平目录结构，符合 Edge Add-ons 要求）与同名 unpacked 目录。该路径不在仓库中；后续公开安装包放在 [GitHub Releases](https://github.com/endtree-FDE/yidian/releases)。
- 官网 changelog（studio/changelog.html）新增 1.2.0 段落；gh-pages 站点同步 changelog 与下载链接。
- 打 tag `v1.2.0`。
- Edge 商店提交使用新 zip（审核周期长，作为最后一批动作，状态变化记录在官网更新页）。

## 边界与承诺

- 不做：云同步、账号、AI、多浏览器（Firefox）适配——维持本地优先与最小权限。
- `archivedRecords` 为新增存储键，1.1.0 用户升级无迁移负担。
- 回看节奏（第 2、7、30 天）与数据格式完全兼容。
