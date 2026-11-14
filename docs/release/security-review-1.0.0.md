# 一点 1.0.0 上线安全检查

检查日期：2026-07-27

## 执行摘要

**结论：可以上线，没有发现阻塞发布的 Critical、High 或 Medium 风险。**

当前版本没有账号、服务端数据库或远程脚本；扩展记录保存在浏览器本地。权限、网址校验、导入边界、网页安全策略和动态文本转义均符合第一版的风险范围。

## Critical

无。

## High

无。

## Medium

无。

## Low

### SEC-001：静态托管响应头需在上线后复核

- 位置：`studio/index.html:5`、`studio/contact.html:5`、`studio/changelog.html:5`
- 证据：页面已使用严格的 meta CSP，`script-src 'self'`，没有 `unsafe-inline` 或 `unsafe-eval`。
- 影响：meta CSP 不支持 `frame-ancestors`，仓库内也无法确认 ModelScope 最终响应头，因此页面是否允许被第三方站点 iframe 嵌入需要上线后查看真实响应。
- 处理：不阻塞本次上线；发布后检查 HTTP 响应头。页面不包含登录、支付或敏感操作，当前点击劫持风险较低。

## 已验证的安全边界

- `extension/manifest.json:7` 只申请 `activeTab`、`alarms`、`scripting`、`storage`，没有 `host_permissions` 和常驻 `content_scripts`。
- `extension/domain.mjs:9-11` 只接受 `http:` 与 `https:` 链接。
- `extension/service-worker.mjs:271-273` 打开收藏前再次校验网址协议。
- `extension/service-worker.mjs:196-237` 校验导入记录类型、数量、网址、进度和字段长度，再整体写入。
- `extension/library.js:39-45` 使用 `textContent` 展示导入和收藏内容。
- `extension/pet.js:40-42,90-94` 的动态 HTML 对标题、域名、选段和记录字段执行转义；其余模板内容为固定字符串。
- 官网不加载远程脚本、字体、分析工具或追踪器。
- 扩展代码没有 `fetch`、XHR、WebSocket 或 `sendBeacon`，不会上传收藏记录。
- 所有新窗口外链均使用 `rel="noopener noreferrer"`。

## 发布结论

安全门槛：**GO**。

上线后只需完成 SEC-001 的真实响应头复核；若未来加入官网内反馈、账号、同步或支付，必须重新做包含服务端和隐私合规的安全检查。

