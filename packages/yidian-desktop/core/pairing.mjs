// 配对与鉴权：本地桥的「门」。
//
// 抄的成熟做法：
//   - Chrome Native Messaging：allowed_origins 写死扩展 ID；
//   - mcp-chrome：本机服务逐个校验扩展 ID；
//   - LocalSend / KDE Connect：两边都要主动参与，一次性配对码做带外确认。
//
// 已知残余风险：同用户的恶意进程仍能读用户目录里的文件（token 也在那儿）。
// 彻底解决要换成 Native Messaging（浏览器做中介），那是下一轮的演进路径。
import {
  BRIDGE_PATHS, EXTENSION_HEADER, PAIR_CODE_TTL_MS, PAIR_MAX_ATTEMPTS, TOKEN_HEADER,
  createPairCode, createToken, isExtensionId, normalizePairCode, parseExtensionOrigin, timingSafeEqual,
} from '../vendor/yidian-core/bridge-protocol.mjs';

export function createPairingManager({ store, now = () => Date.now() } = {}) {
  /** extensionId → { name, token, pairedAt } */
  let peers = {};
  /** 当前等待配对的一次性码：{ code, createdAt, attempts } */
  let active = null;

  async function load() {
    const saved = await store?.get?.({ bridgePaired: {} });
    const stored = saved?.bridgePaired;
    peers = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
    return peers;
  }

  async function persist() {
    await store?.set?.({ bridgePaired: peers });
  }

  function isPaired(extensionId) {
    return Boolean(extensionId && peers[extensionId]);
  }

  function listPeers() {
    return Object.entries(peers).map(([extensionId, peer]) => ({
      extensionId,
      name: peer?.name ?? '',
      pairedAt: peer?.pairedAt ?? 0,
    }));
  }

  /**
   * 鉴权。返回 { ok, status?, error?, cors?, context? }。
   * cors=true 表示允许把来源回显进 CORS 头（只对扩展来源生效）。
   *
   * 身份从两个地方拿，互相校验：
   *   - 扩展身份头 x-yidian-extension（扩展每次请求都带，简单 GET 不带 Origin 也能认出来）；
   *   - Origin 头（扩展的非简单请求会带；网页也带，但网页的 Origin 不是 chrome-extension://）。
   */
  function authorize({ method, path: routePath, origin, headers } = {}) {
    const parsedOrigin = parseExtensionOrigin(origin);
    if (origin && !parsedOrigin) {
      // 网页的 Origin 是 https://…，本机其它服务是 http://127.0.0.1…，都拒。
      return { ok: false, status: 403, error: '只接受浏览器扩展的连接' };
    }
    const headerId = headers?.[EXTENSION_HEADER];
    const extensionId = parsedOrigin?.extensionId ?? (isExtensionId(headerId) ? headerId : null);
    if (!extensionId) {
      // 没有身份：本机进程随手 curl 就是这一类。
      return { ok: false, status: 403, error: '只接受浏览器扩展的连接' };
    }
    if (parsedOrigin && isExtensionId(headerId) && parsedOrigin.extensionId !== headerId) {
      return { ok: false, status: 403, error: '来源身份对不上' };
    }
    const peer = peers[extensionId] ?? null;

    if (routePath === BRIDGE_PATHS.ping) {
      return { ok: true, cors: true, context: { extensionId, paired: Boolean(peer) } };
    }
    if (routePath === BRIDGE_PATHS.pair) {
      // 配对接口对任意扩展开放，否则扩展读不到「码不对」；它只回成败，不碰收藏。
      return { ok: true, cors: true, context: { extensionId } };
    }
    if (!peer) {
      return { ok: false, status: 403, error: '还没有和桌面端配对' };
    }
    if (method === 'OPTIONS') {
      // 预检不带自定义头，所以这里只看「来源形状 + 是否已配对」，token 在真正请求里再验。
      return { ok: true, cors: true, context: { extensionId } };
    }
    const token = headers?.[TOKEN_HEADER];
    if (!token || !timingSafeEqual(peer.token, token)) {
      return { ok: false, status: 403, error: '配对凭证无效' };
    }
    return { ok: true, cors: true, context: { extensionId } };
  }

  /** 开始一次配对：生成一次性码，5 分钟内有效。 */
  function beginPairing() {
    active = { code: createPairCode(), createdAt: now(), attempts: 0 };
    return { code: active.code, expiresAt: active.createdAt + PAIR_CODE_TTL_MS };
  }

  function cancelPairing() {
    active = null;
  }

  function isPairingOpen() {
    return Boolean(active);
  }

  /** 用扩展带来的码换 token。 */
  async function handlePair({ body, extensionId } = {}) {
    if (!extensionId) return { status: 403, body: { ok: false, error: '来源不被允许' } };
    if (!active) {
      return {
        status: 409,
        body: { ok: false, error: '桌面端没有在等待配对，请先在桌面端点「连接浏览器扩展」' },
      };
    }
    const stamp = now();
    if (stamp - active.createdAt > PAIR_CODE_TTL_MS) {
      active = null;
      return { status: 410, body: { ok: false, error: '配对码过期了，请重新生成' } };
    }
    if (active.attempts >= PAIR_MAX_ATTEMPTS) {
      active = null;
      return { status: 429, body: { ok: false, error: '尝试次数太多，请重新生成配对码' } };
    }
    const code = normalizePairCode(body?.code);
    if (!code || !timingSafeEqual(code, active.code)) {
      active.attempts += 1;
      return { status: 401, body: { ok: false, error: '配对码不对' } };
    }
    const token = createToken();
    peers[extensionId] = {
      name: String(body?.name ?? '').slice(0, 80),
      token,
      pairedAt: stamp,
    };
    active = null;
    await persist();
    return { body: { ok: true, token, extensionId } };
  }

  async function disconnectAll() {
    peers = {};
    await persist();
  }

  async function disconnect(extensionId) {
    if (!peers[extensionId]) return false;
    delete peers[extensionId];
    await persist();
    return true;
  }

  return {
    authorize,
    handlePair,
    beginPairing,
    cancelPairing,
    isPairingOpen,
    isPaired,
    listPeers,
    load,
    disconnectAll,
    disconnect,
    get peers() { return peers; },
  };
}
