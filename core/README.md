# 一点 · 核心（平台无关）

这一包是产品的语义所在，**不含任何浏览器/桌面专属 API**：

| 文件 | 作用 |
|---|---|
| `domain.mjs` | 纯函数：1/2/7/30 的调度、记录形状、合并、归档、免打扰、分日 |
| `messages.mjs` | 消息层：收下 / 回看 / 归档 / 导入 / 设置 / 到期提醒，平台无关 |

## 平台适配器

各端只要实现 `platform` 这几个能力，就能共用同一份语义：

```js
createMessageLayer({
  storage: { get(keys), set(values) },   // chrome.storage.local 语义
  openUrl(url),          // 打开网页
  openLibrary(),         // 打开收藏库
  notify(id, options),   // 系统通知
  clearNotification(id),
  setAlarm(name, info),  // 排下一次到期检查
  clearAlarm(name),
  setBadge({ text, title })?,   // 可选：工具栏角标
  onRecordsChanged?(),          // 可选：记录变更后的副作用（推桥、刷新界面）
  now?(),                      // 可选：时间源
});
```

- **扩展**：`extension/service-worker.mjs`（把 `chrome.*` 接成 platform）
- **桌面端**：`packages/yidian-desktop/main.mjs`（把 Electron 接成 platform）

## 扩展包里的副本

扩展被浏览器沙箱限制，只能 import 自己目录下的文件，所以 `extension/`
里保留一份 `domain.mjs` / `messages.mjs` 副本，由 `node tools/sync-core.mjs` 生成，
`tests/core-sync.test.mjs` 守住「副本与核心一字不差」。**改核心后记得同步。**
