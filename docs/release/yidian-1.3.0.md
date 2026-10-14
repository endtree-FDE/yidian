# 一点 1.3.0 发布记录

- 发布日期：2026-08-25
- 主题：更温柔的回看（市场调研后的第一批优化）

## 本次内容

### 反愧疚定位文案（copy）
- 官网 hero lead 增补：「收下的东西不会堆成愧疚——忘了也没关系，一点只负责在合适的时间，带你再见它一面。」
- 收藏库顶部新增 gentle-note：「没看完、忘了回看，都没关系。这里不是待办清单。」

### Markdown / Obsidian 友好导出（md）
- `core/domain.mjs` 新增 `recordsToMarkdown`：frontmatter（source/exportedAt/total）+ 每条记录一段（标题链接、status/stage/domain/savedAt、选段引用、足迹列表）。标题中的方括号会被清掉，避免破坏 Obsidian 链接语法。
- 收藏库「备份」菜单新增「导出 Markdown」按钮，产出 `yidian-YYYY-MM-DD.md`。
- 序列化器放在核心域，扩展导出、CLI、未来 Obsidian 插件共用一份输出。

### 每日 digest 通知（digest）
- 多条到期：每天只发一条计数通知（标题「一点」，正文「今天有 N 位老朋友想见你。」），点击进入收藏库；按北京时间分日并在本地持久去重。
- 单条到期：保持原行为——标题为记录标题，点击直达原网页。
- 免打扰时段跳过通知，并在静默结束时安排一次补判定；浏览器重启时也会补判定。

### 回看先见选段（excerpt）
- 侧边栏在状态文案下方展示记录选段（`“…”` 引用样式）；无选段时隐藏。
- 网页宠物卡片原本已展示选段，本次补齐侧边栏。

### 空状态引导（empty）
- 收藏库无任何记录时，展示三步指引（打开网页点一点 → 替我收好 → 第 2 天带回）+ Ctrl+Shift+Y 快捷键提示。

## 边界承诺（未变）
- 回看节奏 2/7/30 天不变；本地存储、无网络请求、最小权限不变。
- 无 streak、无倒计时、无已读压力。

## 质量
- 测试 102/102 通过（新增 digest 去重、Markdown 序列化、侧边栏选段用例）。

## 发布动作
1. `package.json` / `extension/manifest.json` 版本 → 1.3.0，两处测试断言同步。
2. `scripts/release.ps1` 当时出包到本地 `C:\12730\packages\yidian-1.3.0.zip`。公开附件：<https://github.com/endtree-FDE/yidian/releases/download/v1.3.0/yidian-1.3.0.zip>。
3. tag `v1.3.0`。
4. gh-pages：更新 zip、changelog 1.3.0 段落、下载卡与首页文案。
