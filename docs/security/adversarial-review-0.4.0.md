# 12730 0.4.0 · 对抗性安全检查

## 执行摘要

未发现 Critical 或 High 风险。检查发现一项宿主网页可伪造点击的数据完整性问题，以及两项导入/静态页面的纵深防御缺口；三项均已修复并纳入自动检查。扩展维持 `activeTab`、`alarms`、`scripting`、`storage` 四项最小权限，无全站 `host_permissions`。

## Medium

### SEC-01 · 宿主网页可伪造宠物卡片点击（已修复）

- 位置：`extension/pet.js:133-134`，卡片点击入口。
- 原证据：卡片监听器只根据 `data-action` 分发操作，宿主页面可对注入 DOM 调用 `.click()`。
- 影响：恶意网页可能在用户未点击时 Mark 当前页面或触发其他卡片动作，污染本地记录。
- 修复：要求 `event.isTrusted`，只接受浏览器产生的真实用户点击。
- 验证：`tests/pet.test.mjs` 覆盖伪造点击不产生 `mark-current` 消息。

## Low

### SEC-02 · 备份输入缺少完整体积边界（已修复）

- 位置：`extension/library.js:79`；`extension/service-worker.mjs:192-216`。
- 原证据：已有 5000 条记录上限，但导入页会先读取任意大小文件，单条标题、URL 和皮肤 ID 也没有长度限制。
- 影响：用户误选异常文件时可能造成内存压力或反复触发存储配额错误。
- 修复：文件限制 5 MB；URL、标题、皮肤 ID 分别限制为 4096、500、64 字符；验证失败时整批拒绝，现有数据不覆盖。
- 验证：`tests/worker-flow.test.mjs` 覆盖字段过长时原记录保持不变。

### SEC-03 · Static 展示页缺少仓库内可见 CSP（已修复）

- 位置：`studio/index.html:5`。
- 原证据：展示页没有 CSP，虽然不加载远程脚本，也不渲染用户输入。
- 影响：当前风险较低，但缺少对未来误加远程脚本、对象或内联执行的纵深防御。
- 修复：加入仅允许同源脚本、样式和图片的 meta CSP，禁止 object、base 和 form；不使用 `unsafe-inline` 或 `unsafe-eval`。
- 验证：Edge 页面级交互、拖动和移动端检查在 CSP 下通过。

## 已审计但不构成漏洞

- `extension/pet.js:39` 对进入卡片 `innerHTML` 的页面标题和记录标题执行 HTML 转义；其余结构为扩展常量。
- `extension/service-worker.mjs:269` 打开记录前仅允许 `http:` 和 `https:`。
- `extension/service-worker.mjs:246` 拒绝空消息或非对象消息。
- 无 `eval`、`new Function`、`document.write`、远程脚本、分析追踪器或明文密钥。

## 发布后仍需验证

ModelScope 实际 HTTP 响应头不在仓库内可见。上线后应确认 HTTPS 正常、下载包可访问；`frame-ancestors` 等只能通过 HTTP 头提供的策略不由本项目的 meta CSP 声明。
