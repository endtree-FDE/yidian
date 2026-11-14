// 桌面端本地桥客户端（扩展侧）。
//
// 原则：尽力而为。桌面端不在、端口不通、超时——任何一种情况都必须静默失败，
// 扩展自己的存储与提醒链路完全不受影响。
//
// 安全：业务请求要带配对后拿到的 token。token 存在扩展自己的 chrome.storage.local，
// 别的扩展读不到（沙箱隔离），网页更读不到。没有 token 时不推不拉，安静等着。
import {
  BRIDGE_PATHS, BRIDGE_PROTOCOL_VERSION, EXTENSION_HEADER, TOKEN_HEADER, normalizePairCode,
} from './bridge-protocol.mjs';

const DEFAULT_PORTS = [39717, 39718, 39719, 39720, 39721];
const TIMEOUT_MS = 800;
const NEGATIVE_CACHE_MS = 30_000;

export function createBridgeClient({
  ports = DEFAULT_PORTS,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  timeoutMs = TIMEOUT_MS,
  negativeCacheMs = NEGATIVE_CACHE_MS,
  extensionId = '',
  extensionName = '',
  tokenStore = null,
} = {}) {
  let endpoint = null;
  let lastProbeAt = 0;
  let probing = null;
  let paired = false;
  let memoryToken = null;

  async function getToken() {
    if (tokenStore?.get) {
      try {
        const token = await tokenStore.get();
        if (token) return token;
      } catch { /* 读不到就当没配对 */ }
    }
    return memoryToken;
  }

  async function setToken(token) {
    memoryToken = token || null;
    if (tokenStore?.set) {
      try {
        await tokenStore.set(token || null);
      } catch { /* 存不住也不影响本次会话 */ }
    }
  }

  async function request(url, { method = 'GET', body = null, auth = false } = {}) {
    if (!fetchImpl) return null;
    const headers = {};
    // 身份头：扩展的简单 GET 不带 Origin，桌面端靠这个认出我们
    if (extensionId) headers[EXTENSION_HEADER] = extensionId;
    if (body !== null) headers['content-type'] = 'application/json';
    if (auth) {
      const token = await getToken();
      if (!token) return null;
      headers[TOKEN_HEADER] = token;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      let data = null;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok) {
        return { ok: false, status: response.status, error: data?.error || `HTTP ${response.status}`, data };
      }
      return data;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function probe() {
    for (const port of ports) {
      const data = await request(`http://127.0.0.1:${port}${BRIDGE_PATHS.ping}`, { method: 'GET' });
      if (data?.ok && data.app === 'yidian-desktop') {
        if (data.protocol && data.protocol !== BRIDGE_PROTOCOL_VERSION) {
          console.warn('[一点] 桌面端协议版本对不上，先不连', data.protocol);
          return null;
        }
        paired = Boolean(data.paired);
        return `http://127.0.0.1:${port}`;
      }
    }
    return null;
  }

  async function resolve() {
    if (endpoint) return endpoint;
    const sinceLastProbe = Date.now() - lastProbeAt;
    if (sinceLastProbe < negativeCacheMs) return null;
    if (!probing) {
      lastProbeAt = Date.now();
      probing = probe()
        .then((found) => {
          endpoint = found;
          probing = null;
          return found;
        })
        .catch(() => {
          probing = null;
          return null;
        });
    }
    return probing;
  }

  return {
    async isOnline() {
      return Boolean(await resolve());
    },

    /** 桌面端是不是已经认了我们（配对过）。 */
    async isPaired() {
      if (!await resolve()) return false;
      return paired;
    },

    /**
     * 用桌面上显示的一次性码换 token。
     * 成功后会立刻把本地收藏推过去，桌面端那边马上就有数据。
     */
    async pair(code) {
      const normalized = normalizePairCode(code);
      if (!normalized) return { ok: false, error: '配对码是 6 位数字' };
      const base = await resolve();
      if (!base) return { ok: false, error: '桌面端没有在运行' };
      const result = await request(`${base}${BRIDGE_PATHS.pair}`, {
        method: 'POST',
        body: { code: normalized, name: extensionName, id: extensionId },
      });
      if (!result) return { ok: false, error: '桌面端没有回应' };
      if (!result.ok || !result.token) {
        return { ok: false, error: result.error || '配对失败' };
      }
      await setToken(result.token);
      paired = true;
      return { ok: true };
    },

    async pushState({ records = [], archived = [] } = {}) {
      const base = await resolve();
      if (!base) return null;
      return request(`${base}${BRIDGE_PATHS.records}`, {
        method: 'POST',
        auth: true,
        body: { records, archived },
      });
    },

    async pullState() {
      const base = await resolve();
      if (!base) return null;
      return request(`${base}${BRIDGE_PATHS.state}`, { method: 'GET', auth: true });
    },

    async sendEvent(message) {
      const base = await resolve();
      if (!base) return null;
      return request(`${base}${BRIDGE_PATHS.events}`, {
        method: 'POST',
        auth: true,
        body: message,
      });
    },

    reset() {
      endpoint = null;
      lastProbeAt = 0;
      paired = false;
    },
  };
}
