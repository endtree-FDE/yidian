// 本地桥：扩展 → 桌面端的一条窄通道。
//
// 只绑 127.0.0.1。来源判定与鉴权交给调用方给的 authorize：
//   - 默认只接受浏览器扩展的 Origin（网页与本机进程都拿不到 chrome-extension:// 的 Origin）；
//   - /ping 与 /pair 是公开的（只回「在不在」「配对码对不对」，不泄露收藏）；
//   - 业务端点（/records /state /events）必须带配对后拿到的 token。
//
// CORS 只对扩展来源回显，不再有 '*' 兜底——回显任意来源等于把收藏送出去。
import http from 'node:http';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export const DEFAULT_BRIDGE_PORTS = [39717, 39718, 39719, 39720, 39721];

function isExtensionOrigin(origin) {
  return typeof origin === 'string' && origin.startsWith('chrome-extension://');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {object} options
 * @param {(ctx: {method: string, path: string, origin: string, headers: object}) => Promise<object>|object} options.authorize
 *   返回 { ok, status?, error?, cors?, context? }。cors=true 表示允许把 Origin 回显进 CORS 头。
 */
export function createBridgeServer({ route, ports = DEFAULT_BRIDGE_PORTS, logger = null, authorize = null } = {}) {
  let server = null;
  let boundPort = null;

  const handler = async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url, 'http://127.0.0.1');
    const routePath = url.pathname;

    let verdict = { ok: true, cors: false };
    if (authorize) {
      try {
        verdict = await authorize({
          method: req.method,
          path: routePath,
          origin,
          headers: req.headers,
        }) || { ok: false, status: 403, error: '无权访问' };
      } catch (error) {
        verdict = { ok: false, status: 403, error: error?.message || '无权访问' };
      }
    }

    const cors = {};
    if (verdict.cors && isExtensionOrigin(origin)) {
      cors['access-control-allow-origin'] = origin;
      cors['access-control-allow-methods'] = 'GET,POST,OPTIONS';
      cors['access-control-allow-headers'] = 'content-type,x-yidian-token,x-yidian-extension';
      cors['access-control-max-age'] = '600';
      // 扩展的来源算「公网」，回环地址算「本地网络」：Chrome 的 Private Network Access
      // 会先发预检，回应里必须明确允许访问本地网络，否则请求在浏览器里就被拦掉。
      cors['access-control-allow-private-network'] = 'true';
      cors.vary = 'Origin';
    }

    if (req.method === 'OPTIONS') {
      if (!verdict.ok) {
        res.writeHead(verdict.status ?? 403, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: verdict.error || '来源不被允许' }));
        return;
      }
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (!verdict.ok) {
      res.writeHead(verdict.status ?? 403, {
        ...cors,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({ ok: false, error: verdict.error || '来源不被允许' }));
      return;
    }

    let body = null;
    if (req.method === 'POST') {
      const raw = await readBody(req).catch(() => '');
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = null; }
      }
    }

    try {
      const result = await route({
        method: req.method,
        path: routePath,
        body,
        origin,
        headers: req.headers,
        context: verdict.context ?? null,
      });
      const payload = JSON.stringify(result?.body ?? { ok: true });
      res.writeHead(result?.status ?? 200, {
        ...cors,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(payload);
    } catch (error) {
      res.writeHead(500, { ...cors, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: error?.message || '桌面端内部错误' }));
    }
  };

  return {
    get port() { return boundPort; },
    async start() {
      for (const port of ports) {
        const candidate = http.createServer(handler);
        const ok = await new Promise((resolve) => {
          candidate.once('error', () => resolve(false));
          candidate.listen(port, '127.0.0.1', () => resolve(true));
        });
        if (ok) {
          server = candidate;
          boundPort = typeof candidate.address()?.port === 'number' ? candidate.address().port : port;
          logger?.(`[本地桥] 已启动 127.0.0.1:${boundPort}`);
          return boundPort;
        }
        candidate.close();
      }
      throw new Error(`本地桥端口都被占用了（${ports.join(', ')}）`);
    },
    async stop() {
      if (!server) return;
      await new Promise((resolve) => server.close(resolve));
      server = null;
      boundPort = null;
    },
  };
}
