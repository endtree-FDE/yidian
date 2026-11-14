// 一点 1.3.0 真实浏览器 UI 测试：Playwright 加载未打包扩展，驱动 library.html。
// 运行（仓库根目录）：npm run test:e2e
// 前置：npm install 且 npx playwright install chromium 完成。
// 注意：扩展加载需要有头浏览器（headless: false），本地运行会弹出浏览器窗口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXTENSION_PATH = path.join(ROOT, 'extension');
const PAIR_CODE = '123456';
const PAIR_TOKEN = 'e2e-pair-token';

/**
 * 假桌面端：按桌面端真桥的协议应答（/ping /pair /records /state），
 * 用来在真实浏览器里验证扩展侧的配对流程。
 *
 * 鉴权口径跟真桌面端一致：Origin 有就必须���扩展的；身份靠 x-yidian-extension 头；
 * 业务端点要 token。
 */
async function startFakeDesktop() {
  const seen = { pings: 0, pairs: [], pushes: [], requests: [] };
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin ?? '';
    const extensionId = req.headers['x-yidian-extension'] ?? '';
    seen.requests.push({ path: req.url, method: req.method, origin, extensionId });

    if (origin && !origin.startsWith('chrome-extension://')) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '只接受浏览器扩展的连接' }));
      return;
    }
    if (!extensionId) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '只接受浏览器扩展的连接' }));
      return;
    }

    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-yidian-token,x-yidian-extension',
      'access-control-max-age': '600',
      vary: 'Origin',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      const send = (payload) => {
        res.writeHead(200, { ...cors, 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      };
      if (req.url === '/ping') {
        seen.pings += 1;
        send({ ok: true, app: 'yidian-desktop', version: '0.1.0', protocol: 1, paired: false, pairingOpen: true });
        return;
      }
      if (req.url === '/pair') {
        seen.pairs.push(body);
        if (body?.code === PAIR_CODE) send({ ok: true, token: PAIR_TOKEN, extensionId });
        else send({ ok: false, error: '配对码不对' });
        return;
      }
      if (req.url === '/records') {
        if (req.headers['x-yidian-token'] !== PAIR_TOKEN) {
          res.writeHead(403, { ...cors, 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: '配对凭证无效' }));
          return;
        }
        seen.pushes.push({ body, token: req.headers['x-yidian-token'] });
        send({ ok: true, records: body?.records ?? [] });
        return;
      }
      if (req.url === '/state') {
        send({ ok: true, records: [], archived: [], settings: {} });
        return;
      }
      res.writeHead(404, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '未知接口' }));
    });
  });
  // 扩展的客户端固定探测 39717 起的那几个端口
  const ports = [39717, 39718, 39719, 39720, 39721];
  let port = null;
  for (const candidate of ports) {
    const ok = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(candidate, '127.0.0.1', () => resolve(true));
    });
    if (ok) { port = candidate; break; }
  }
  if (!port) throw new Error('假桌面端没抢到端口');
  return { server, port, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('收藏库：空态渲染、注入记录后列表与计数更新', { timeout: 120_000 }, async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'yidian-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
    ],
  });
  try {
    // 等 Service Worker 就绪，从中取出扩展 id
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).hostname;

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/library.html`);
    await page.waitForSelector('h1');
    assert.equal((await page.textContent('h1')).trim(), '我的收藏');
    assert.equal((await page.textContent('#total')).trim(), '0');

    // 在扩展页上下文里直接写 chrome.storage，模拟"收下"一条记录后刷新验证渲染
    await page.evaluate(() => new Promise((resolve) => {
      const now = Date.now();
      chrome.storage.local.set({
        records: [{
          title: 'e2e 测试记录', excerpt: '', url: 'https://example.com/', canonicalUrl: '',
          normalizedUrl: 'https://example.com/', sourceDomain: 'example.com',
          stage: 1, completedAt: now, nextReviewAt: now + 86_400_000,
          createdAt: now, updatedAt: now, skinId: 'fluid-01',
          encounters: [{ type: 'saved', at: now, stage: 1 }],
        }],
      }, resolve);
    }));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#total')?.textContent === '1', { timeout: 15_000 });
    assert.ok(await page.getByText('e2e 测试记录').count(), '收藏库应显示注入的记录标题');
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('Service Worker：消息层（收下 → 列表 → 回看推进）在真实浏览器里跑通', { timeout: 120_000 }, async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'yidian-e2e-sw-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
    ],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).hostname;

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/library.html`);
    await page.waitForSelector('h1');

    // 走 SW 的消息层：收下一条 → 列表里能看到 → 未到期不推进
    const result = await page.evaluate(async () => {
      const marked = await chrome.runtime.sendMessage({
        type: 'mark-current',
        tab: { title: 'SW 消息层测试', url: 'https://example.com/sw-message-test', excerpt: '' },
      });
      const listed = await chrome.runtime.sendMessage({ type: 'list-records' });
      const advanced = await chrome.runtime.sendMessage({
        type: 'complete-review',
        normalizedUrl: marked?.record?.normalizedUrl,
      });
      return { marked, listed, advanced };
    });

    assert.equal(result.marked?.ok, true, '收下应该成功');
    assert.equal(result.marked?.created, true);
    assert.equal(result.marked?.record?.stage, 1);
    assert.equal(result.listed?.records?.length, 1, '列表里应该有 1 条');
    assert.equal(result.listed.records[0].title, 'SW 消息层测试');
    assert.equal(result.advanced?.changed, false, '没到期不该推进');
    assert.equal(result.advanced?.record?.stage, 1);
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('宠物在真实网页上：没有选中文字时，用页面的一句话描述顶上', { timeout: 120_000 }, async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8">
      <title>如何把饭煮熟</title>
      <meta name="description" content="一篇讲怎么煮饭的文章。">
      </head><body><h1>正文</h1></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const userDataDir = mkdtempSync(path.join(tmpdir(), 'yidian-e2e-pet-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
    ],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).hostname;

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/library.html`);
    await extensionPage.waitForSelector('h1');

    // 一个真实网页（带 title 和 meta description）
    const target = await context.newPage();
    await target.goto(`http://127.0.0.1:${port}/`);

    // 走扩展自己的注入通道，把宠物放进这个网页
    await extensionPage.evaluate(async (pattern) => {
      const [tab] = await chrome.tabs.query({ url: pattern });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['pet.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['shared.js', 'pet.js'] });
    }, `http://127.0.0.1:${port}/*`);

    // 卡片上出现的是页面的一句话描述（不是空的）
    await target.waitForSelector('#otter-yidian-card .o-summary', { state: 'attached', timeout: 20_000 });
    assert.equal(
      (await target.textContent('#otter-yidian-card .o-summary')).trim(),
      '一篇讲怎么煮饭的文章。',
      '没有选中文字时，卡片上应该有页面的一句话描述',
    );

    // 真的收一下：记录里要带上标题和描述
    await target.click('#otter-yidian-pet');
    await target.click('#otter-yidian-card button[data-action="mark"]');
    await target.waitForSelector('#otter-yidian-toast.show', { timeout: 20_000 });

    const listed = await extensionPage.evaluate(async () => chrome.runtime.sendMessage({ type: 'list-records' }));
    const record = listed.records.find((item) => String(item.url).includes('127.0.0.1'));
    assert.ok(record, '应该收下这一条');
    assert.equal(record.title, '如何把饭煮熟');
    assert.equal(record.summary, '一篇讲怎么煮饭的文章。');
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
    server.close();
  }
});

test('收藏库写一句批注：记录里有了，卡片上显示的是你的话', { timeout: 120_000 }, async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8">
      <title>一页能收下的内容</title>
      <meta name="description" content="页面自己写的那句描述。">
      </head><body><h1>正文</h1></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const pageUrl = `http://127.0.0.1:${port}/`;

  const userDataDir = mkdtempSync(path.join(tmpdir(), 'yidian-e2e-note-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
    ],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).hostname;

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/library.html`);
    await extensionPage.waitForSelector('h1');

    const target = await context.newPage();
    await target.goto(pageUrl);

    // 把宠物注入这个真实网页，收下这一条
    const tabId = await extensionPage.evaluate(async (pattern) => {
      const [tab] = await chrome.tabs.query({ url: pattern });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['pet.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['shared.js', 'pet.js'] });
      return tab.id;
    }, `http://127.0.0.1:${port}/*`);
    await target.waitForSelector('#otter-yidian-card button[data-action="mark"]', { state: 'attached', timeout: 20_000 });
    await target.click('#otter-yidian-pet');
    await target.click('#otter-yidian-card button[data-action="mark"]');
    await target.waitForSelector('#otter-yidian-toast.show', { timeout: 20_000 });

    // 回收藏库，给它写一句
    await extensionPage.reload();
    await extensionPage.waitForFunction(() => document.querySelector('#total')?.textContent === '1', { timeout: 20_000 });
    await extensionPage.locator('.note-edit').first().click();
    await extensionPage.locator('.note-input').first().fill('这条是我要的配色');
    await extensionPage.locator('.note-save').first().click();
    await extensionPage.waitForFunction(
      () => document.querySelector('.record-note')?.textContent?.includes('这条是我要的配色'),
      { timeout: 20_000 },
    );

    // 记录里真的有了
    const listed = await extensionPage.evaluate(async () => chrome.runtime.sendMessage({ type: 'list-records' }));
    const record = listed.records.find((item) => String(item.url).includes('127.0.0.1'));
    assert.ok(record, '应该收下这一条');
    assert.equal(record.note, '这条是我要的配色');

    // 宠物卡片上显示的是你的话
    await extensionPage.evaluate(async (id) => {
      await chrome.tabs.sendMessage(id, { type: 'refresh-pet' });
    }, tabId);
    await target.waitForSelector('#otter-yidian-card .o-note', { state: 'attached', timeout: 20_000 });
    assert.equal(
      (await target.textContent('#otter-yidian-card .o-note')).trim(),
      '“这条是我要的配色”',
      '卡片上应该显示你自己写的那句',
    );
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
    server.close();
  }
});

test('连接桌面端：收藏库页填配对码 → 换到 token → 收藏推过去', { timeout: 120_000 }, async () => {
  const desktop = await startFakeDesktop();
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'yidian-e2e-pair-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
    ],
  });
  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).hostname;

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/library.html`);
    await page.waitForSelector('h1');

    // 桌面端面板要出现，并认出「桌面端在跑」
    await page.waitForSelector('#desktop-panel:not([hidden])', { timeout: 20_000 });
    await page.waitForFunction(
      () => document.querySelector('#desktop-status')?.textContent?.includes('桌面端'),
      { timeout: 20_000 },
    );
    // 留一张扩展侧的截图：未连接时的配对面板
    await page.screenshot({ path: path.join(ROOT, 'docs', 'captures', 'yidian-extension-desktop-panel.png') });

    // 码不对要有反馈，不能静默
    await page.fill('#desktop-code', '000000');
    await page.click('#desktop-connect');
    await page.waitForFunction(
      () => document.querySelector('#desktop-status')?.textContent?.includes('配对码不对'),
      { timeout: 20_000 },
    );

    // 码对了就接上
    await page.fill('#desktop-code', PAIR_CODE);
    await page.click('#desktop-connect');
    await page.waitForFunction(
      () => document.querySelector('#desktop-status')?.textContent?.includes('连上'),
      { timeout: 20_000 },
    );
    assert.equal(await page.locator('#desktop-form').isVisible(), false, '接上后不该再要配对码');

    // 配对成功后，收藏立刻被推过去，而且带着 token
    await page.waitForFunction(() => true);
    const deadline = Date.now() + 15_000;
    while (!desktop.seen.pushes.length && Date.now() < deadline) {
      await page.waitForTimeout(200);
    }
    assert.ok(desktop.seen.pushes.length, '配对成功后应该推一次收藏过去');
    assert.equal(desktop.seen.pushes[0].token, PAIR_TOKEN, '推送要带配对 token');
    assert.ok(
      desktop.seen.requests.every((item) => item.extensionId === extensionId),
      `每个请求都要带扩展身份头，实际：${JSON.stringify(desktop.seen.requests)}`,
    );
    assert.ok(
      desktop.seen.requests.every((item) => !item.origin || item.origin.startsWith('chrome-extension://')),
      `有 Origin 的请求必须来自扩展，实际：${JSON.stringify(desktop.seen.requests)}`,
    );

    // token 要落到扩展自己的存储里
    const stored = await page.evaluate(async () => {
      const raw = await chrome.storage.local.get('bridgeToken');
      return raw.bridgeToken ?? null;
    });
    assert.equal(stored, PAIR_TOKEN);
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
    await desktop.close();
  }
});
