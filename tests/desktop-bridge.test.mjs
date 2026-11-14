// 本地桥测试：扩展 ↔ 桌面端之间那条窄通道，以及它的门（配对 + token）。
//
// 这里跑的全是生产代码：core/pairing.mjs 的鉴权、core/bridge-route.mjs 的路由、
// core/bridge-server.mjs 的 HTTP 层、扩展侧的 bridge-client.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { JsonStore } from '../packages/yidian-desktop/core/store.mjs';
import { createBridgeServer } from '../packages/yidian-desktop/core/bridge-server.mjs';
import { createBridgeRoute } from '../packages/yidian-desktop/core/bridge-route.mjs';
import { createPairingManager } from '../packages/yidian-desktop/core/pairing.mjs';
import { createDesktopPlatform } from '../packages/yidian-desktop/core/platform.mjs';
import { createMessageLayer } from '../packages/yidian-core/messages.mjs';
import { createBridgeClient } from '../packages/yidian-1.3.0/bridge-client.mjs';
import { EXTENSION_HEADER, TOKEN_HEADER } from '../packages/yidian-core/bridge-protocol.mjs';

const EXT_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EXT_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function makeStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yidian-bridge-'));
  return new JsonStore(path.join(dir, 'store.json'));
}

/** 起一套真的桥：真鉴权 + 真路由 + 真消息层。 */
async function startBridge({ store, now } = {}) {
  const target = store ?? await makeStore();
  const pairing = createPairingManager({ store: target, now });
  await pairing.load();
  const platform = createDesktopPlatform({
    store: target,
    openExternal: async () => undefined,
    openLibrary: async () => undefined,
    notify: async () => undefined,
    clearNotification: async () => undefined,
  });
  const layer = createMessageLayer(platform);
  const server = createBridgeServer({
    ports: [0],
    route: createBridgeRoute({ layer, pairing, version: '0.1.0' }),
    authorize: (ctx) => pairing.authorize(ctx),
  });
  const port = await server.start();
  return { server, port, pairing, store: target, layer };
}

function origin(extensionId) {
  return `chrome-extension://${extensionId}`;
}

/** 扩展发请求时的头：身份头 + Origin（简单 GET 实际上只有身份头，见下一个用例）。 */
function extHeaders(extensionId, extra = {}) {
  return { origin: origin(extensionId), [EXTENSION_HEADER]: extensionId, ...extra };
}

async function pairExtension(port, extensionId, code, name = '一点') {
  const response = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST',
    headers: extHeaders(extensionId, { 'content-type': 'application/json' }),
    body: JSON.stringify({ code, name }),
  });
  return { status: response.status, body: await response.json() };
}

test('没配对之前：本机进程、网页、别的扩展都读不到收藏', async () => {
  const { server, port } = await startBridge();
  try {
    // 本机进程：既不带 Origin，也不带身份头
    const noOrigin = await fetch(`http://127.0.0.1:${port}/state`);
    assert.equal(noOrigin.status, 403);

    // 网页：Origin 是 https
    const web = await fetch(`http://127.0.0.1:${port}/state`, {
      headers: { origin: 'https://evil.example', [EXTENSION_HEADER]: EXT_A },
    });
    assert.equal(web.status, 403);

    // 本机 web 服务：Origin 是 http://127.0.0.1
    const local = await fetch(`http://127.0.0.1:${port}/state`, {
      headers: { origin: 'http://127.0.0.1:8080', [EXTENSION_HEADER]: EXT_A },
    });
    assert.equal(local.status, 403);

    // 别的扩展：身份头是另一个 ID，没配对就挡掉
    const other = await fetch(`http://127.0.0.1:${port}/state`, { headers: extHeaders(EXT_B) });
    assert.equal(other.status, 403);

    // 连收藏都读不到
    const body = await other.json();
    assert.equal(body.records, undefined);
  } finally {
    await server.stop();
  }
});

test('简单 GET 不带 Origin 也能认出扩展：靠身份头（真实浏览器就是这样）', async () => {
  const { server, port } = await startBridge();
  try {
    // 扩展的 /ping 探活：Chromium 对简单 GET 不补 Origin，只带我们自己的身份头
    const response = await fetch(`http://127.0.0.1:${port}/ping`, {
      headers: { [EXTENSION_HEADER]: EXT_A },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.app, 'yidian-desktop');
    assert.equal(body.paired, false);

    // 但业务端点还是要配对 + token
    const denied = await fetch(`http://127.0.0.1:${port}/state`, {
      headers: { [EXTENSION_HEADER]: EXT_A },
    });
    assert.equal(denied.status, 403);
  } finally {
    await server.stop();
  }
});

test('Origin 与身份头对不上就拒', async () => {
  const { server, port } = await startBridge();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/ping`, {
      headers: { origin: origin(EXT_A), [EXTENSION_HEADER]: EXT_B },
    });
    assert.equal(response.status, 403);
  } finally {
    await server.stop();
  }
});

test('/ping 是公开的，但只回状态不碰收藏', async () => {
  const { server, port } = await startBridge();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/ping`, { headers: extHeaders(EXT_A) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.app, 'yidian-desktop');
    assert.equal(body.paired, false);
    assert.equal(body.records, undefined);
    assert.equal(response.headers.get('access-control-allow-origin'), origin(EXT_A));
  } finally {
    await server.stop();
  }
});

test('配对：码不对被拒，码对了换到 token，之后才能读写', async () => {
  const { server, port, pairing } = await startBridge();
  try {
    // 桌面端还没发起配对 → 明确拒绝
    const early = await pairExtension(port, EXT_A, '123456');
    assert.equal(early.status, 409);

    const { code } = pairing.beginPairing();

    // 码不对
    const wrong = await pairExtension(port, EXT_A, '000000');
    assert.equal(wrong.status, 401);

    // 码对了
    const paired = await pairExtension(port, EXT_A, code);
    assert.equal(paired.status, 200);
    const token = paired.body.token;
    assert.equal(typeof token, 'string');
    assert.ok(token.length >= 32);

    // 配对后：不带 token 仍然不行
    const noToken = await fetch(`http://127.0.0.1:${port}/state`, { headers: extHeaders(EXT_A) });
    assert.equal(noToken.status, 403);

    // 带错 token 也不行
    const badToken = await fetch(`http://127.0.0.1:${port}/state`, {
      headers: extHeaders(EXT_A, { [TOKEN_HEADER]: 'deadbeef' }),
    });
    assert.equal(badToken.status, 403);

    // 带对 token 就能读了
    const ok = await fetch(`http://127.0.0.1:${port}/state`, {
      headers: extHeaders(EXT_A, { [TOKEN_HEADER]: token }),
    });
    assert.equal(ok.status, 200);
    const state = await ok.json();
    assert.deepEqual(state.records, []);
  } finally {
    await server.stop();
  }
});

test('配对只认那一个扩展：别的扩展拿同一个 token 也不行', async () => {
  const { server, port, pairing } = await startBridge();
  try {
    const { code } = pairing.beginPairing();
    const paired = await pairExtension(port, EXT_A, code);
    const token = paired.body.token;

    const stolen = await fetch(`http://127.0.0.1:${port}/state`, {
      headers: extHeaders(EXT_B, { [TOKEN_HEADER]: token }),
    });
    assert.equal(stolen.status, 403);
  } finally {
    await server.stop();
  }
});

test('配对码过期就作废，猜错太多次也要作废', async () => {
  let stamp = 1_000_000;
  const { server, port, pairing } = await startBridge({ now: () => stamp });
  try {
    const { code } = pairing.beginPairing();
    stamp += 10 * 60_000; // 过期
    const expired = await pairExtension(port, EXT_A, code);
    assert.equal(expired.status, 410);

    // 猜错太多次
    pairing.beginPairing();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await pairExtension(port, EXT_A, '111111');
      assert.equal(response.status, 401);
    }
    const blocked = await pairExtension(port, EXT_A, '111111');
    assert.equal(blocked.status, 429);
  } finally {
    await server.stop();
  }
});

test('配对名单会存下来：桌面端重启后扩展还认得', async () => {
  const { server, port, pairing, store } = await startBridge();
  try {
    const { code } = pairing.beginPairing();
    await pairExtension(port, EXT_A, code);

    // 模拟桌面端重启：新的 pairing 管理器读同一个 store
    const reopened = createPairingManager({ store });
    await reopened.load();
    assert.equal(reopened.listPeers().length, 1);
    assert.equal(reopened.isPaired(EXT_A), true);
    assert.equal(reopened.isPaired(EXT_B), false);
  } finally {
    await server.stop();
  }
});

test('扩展侧客户端：没配对就不推不拉，配对后能推能拉', async () => {
  const { server, port, pairing } = await startBridge();
  try {
    const tokens = { value: null };
    // 浏览器里 fetch 会自动带上扩展的 Origin；Node 不会，这里手动补上，模拟浏览器行为。
    const fetchAsExtension = (url, options = {}) => fetch(url, {
      ...options,
      headers: { ...(options.headers ?? {}), origin: origin(EXT_A) },
    });
    const client = createBridgeClient({
      ports: [port],
      fetchImpl: fetchAsExtension,
      extensionId: EXT_A,
      extensionName: '一点',
      tokenStore: {
        get: async () => tokens.value,
        set: async (token) => { tokens.value = token; },
      },
    });

    // 没配对：推拉都是安静的 null，不报错
    assert.equal(await client.isOnline(), true);
    assert.equal(await client.isPaired(), false);
    assert.equal(await client.pushState({ records: [{ normalizedUrl: 'https://example.com/a' }] }), null);
    assert.equal(await client.pullState(), null);

    // 配对码不对
    const wrong = await client.pair('000000');
    assert.equal(wrong.ok, false);

    // 配对码对
    const { code } = pairing.beginPairing();
    const result = await client.pair(code);
    assert.equal(result.ok, true);
    assert.equal(await client.isPaired(), true);
    assert.ok(tokens.value);

    // 现在能推能拉了
    const pushed = await client.pushState({ records: [{ normalizedUrl: 'https://example.com/a' }] });
    assert.equal(pushed.ok, true);
    const state = await client.pullState();
    assert.equal(state.records.length, 1);
    assert.equal(state.records[0].normalizedUrl, 'https://example.com/a');
  } finally {
    await server.stop();
  }
});

test('扩展侧客户端：桌面端不在时安静失败', async () => {
  const client = createBridgeClient({ ports: [1], timeoutMs: 200 });
  assert.equal(await client.isOnline(), false);
  assert.equal(await client.pushState({ records: [] }), null);
  assert.equal(await client.pullState(), null);
  const paired = await client.pair('123456');
  assert.equal(paired.ok, false);
});

test('CORS 只对扩展来源回显，网页与本机进程拿不到任何响应头', async () => {
  const { server, port } = await startBridge();
  try {
    const web = await fetch(`http://127.0.0.1:${port}/ping`, {
      headers: { origin: 'https://evil.example', [EXTENSION_HEADER]: EXT_A },
    });
    assert.equal(web.headers.get('access-control-allow-origin'), null);

    const extension = await fetch(`http://127.0.0.1:${port}/ping`, { headers: extHeaders(EXT_A) });
    assert.equal(extension.headers.get('access-control-allow-origin'), origin(EXT_A));
  } finally {
    await server.stop();
  }
});

test('预检：已配对的扩展放行并声明允许自定义头，未配对的挡掉', async () => {
  const { server, port, pairing } = await startBridge();
  try {
    const { code } = pairing.beginPairing();
    await pairExtension(port, EXT_A, code);

    const allowed = await fetch(`http://127.0.0.1:${port}/records`, {
      method: 'OPTIONS',
      headers: {
        ...extHeaders(EXT_A),
        'access-control-request-headers': 'content-type,x-yidian-token,x-yidian-extension',
      },
    });
    assert.equal(allowed.status, 204);
    assert.match(allowed.headers.get('access-control-allow-headers') ?? '', /x-yidian-token/);
    assert.match(allowed.headers.get('access-control-allow-headers') ?? '', /x-yidian-extension/);

    const blocked = await fetch(`http://127.0.0.1:${port}/records`, {
      method: 'OPTIONS',
      headers: {
        ...extHeaders(EXT_B),
        'access-control-request-headers': 'content-type,x-yidian-token,x-yidian-extension',
      },
    });
    assert.equal(blocked.status, 403);
  } finally {
    await server.stop();
  }
});

test('未知接口返回 404，不吞错', async () => {
  const { server, port, pairing } = await startBridge();
  try {
    const { code } = pairing.beginPairing();
    const paired = await pairExtension(port, EXT_A, code);
    const response = await fetch(`http://127.0.0.1:${port}/nope`, {
      headers: extHeaders(EXT_A, { [TOKEN_HEADER]: paired.body.token }),
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.ok, false);
  } finally {
    await server.stop();
  }
});

test('未配对的扩展看不到接口清单：未知路径也挡在门外', async () => {
  const { server, port } = await startBridge();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/nope`, { headers: extHeaders(EXT_A) });
    assert.equal(response.status, 403);
  } finally {
    await server.stop();
  }
});
