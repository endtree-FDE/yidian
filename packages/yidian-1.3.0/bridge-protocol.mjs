// 桥协议：扩展 ↔ 桌面端 之间平台无关的约定。
//
// 两端都要用同一份，所以放在 core 里，由 tools/sync-shared.mjs 同步成副本
// （扩展包内一份、桌面端 vendor 里一份），tests/core-sync.test.mjs 守住不漂移。
//
// 安全模型（抄成熟做法）：
//   - Chrome Native Messaging：host manifest 里 allowed_origins 写死扩展 ID；
//   - mcp-chrome：本机服务只连 127.0.0.1，并硬编码扩展 ID 白名单逐个校验；
//   - LocalSend / KDE Connect：两边都要主动参与，用一次性配对码做带外确认。
//
// 我们照抄这三条：只认浏览器扩展的 Origin、扩展 ID 进白名单、配对码一次性带外传递。
// 已知残余风险：同用户的恶意进程仍能读用户目录里的文件（详见 research/bridge-trust-design.md）。

export const BRIDGE_PROTOCOL_VERSION = 1;

export const BRIDGE_PATHS = Object.freeze({
  ping: '/ping',
  pair: '/pair',
  records: '/records',
  state: '/state',
  events: '/events',
});

/** 业务请求带 token 的头名（自定义头会触发 CORS 预检，预检里不带 token，所以预检要单独放行）。 */
export const TOKEN_HEADER = 'x-yidian-token';

/**
 * 扩展身份头。
 *
 * 为什么不能只靠 Origin：扩展发起的**简单 GET 不带 Origin 头**（实测 Chromium 就是这样，
 * 浏览器只在非简单请求上补 Origin）。所以身份要由我们自己带，Origin 只用来交叉校验。
 * 扩展有 host_permissions，不走 CORS 预检，自定义头能直接送到。
 */
export const EXTENSION_HEADER = 'x-yidian-extension';

export const PAIR_CODE_LENGTH = 6;
export const PAIR_CODE_TTL_MS = 5 * 60_000;
export const PAIR_MAX_ATTEMPTS = 5;

/** 扩展 ID 是 32 位 [a-p]（Chromium 用公钥哈希映射出来的）。 */
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** 从 Origin 头里解出扩展 ID。网页（https://）与本机进程（无 Origin）都拿不到。 */
export function parseExtensionOrigin(origin) {
  if (typeof origin !== 'string') return null;
  const prefix = 'chrome-extension://';
  if (!origin.startsWith(prefix)) return null;
  const extensionId = origin.slice(prefix.length).replace(/\/+$/, '');
  if (!EXTENSION_ID_PATTERN.test(extensionId)) return null;
  return { extensionId };
}

export function isExtensionOrigin(origin) {
  return parseExtensionOrigin(origin) !== null;
}

/** 扩展 ID 是不是 32 位 [a-p]。 */
export function isExtensionId(value) {
  return typeof value === 'string' && EXTENSION_ID_PATTERN.test(value);
}

/** 生成一次性配对码（纯数字，好读好报）。 */
export function createPairCode() {
  const digits = Array.from(randomBytes(PAIR_CODE_LENGTH), (byte) => byte % 10);
  return digits.join('');
}

/** 把用户输入归一化成 6 位数字；不合法返回 null。 */
export function normalizePairCode(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(cleaned)) return null;
  return cleaned;
}

/** 交换成功后给扩展的长期 token。 */
export function createToken() {
  return Array.from(randomBytes(24), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 定长比较，避免用时侧信道。 */
export function timingSafeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

/** 记录集合的指纹：用来判断「合并后有没有真的变」，避免每次心跳都写盘。 */
export function fingerprintRecords(records) {
  if (!Array.isArray(records)) return '';
  return records
    .map((record) => `${record?.normalizedUrl ?? ''}@${record?.updatedAt ?? 0}@${record?.stage ?? 0}`)
    .sort()
    .join('|');
}
