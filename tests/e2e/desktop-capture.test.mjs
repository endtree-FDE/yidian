// 真·端到端：桌面端（Electron 真进程）收下一个链接时，标题和一句描述都抓回来。
//
// 这一支验的是本轮内容层的核心：桌面端不再只存一个链接 ——
// 它会把页面的 <title> 和 meta description 一起收下，回看卡片上才有话可说。
//
// 运行（仓库根目录）：npm run test:e2e:desktop:capture
// 注意：会拉起一个 Electron 窗口。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DESKTOP_DIR = path.join(ROOT, 'packages', 'yidian-desktop');

const PAGE_WITH_META = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>如何把饭煮熟 | 厨房笔记</title>
<meta name="description" content="一篇讲怎么煮饭的文章。">
</head><body><h1>怎么煮饭</h1></body></html>`;

const PAGE_WITHOUT_META = `<!doctype html>
<html><head><meta charset="utf-8"><title>只有标题的页面</title></head>
<body><h1>只有标题</h1></body></html>`;

function waitFor(predicate, { timeout = 30_000, interval = 200, label = '条件' } = {}) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const value = await predicate();
        if (value) { resolve(value); return; }
      } catch (error) { /* 继续等 */ }
      if (Date.now() > deadline) { reject(new Error(`等待超时：${label}`)); return; }
      setTimeout(tick, interval);
    };
    tick();
  });
}

test('桌面端收下链接：标题和一句描述一起抓回来', { timeout: 180_000 }, async () => {
  const server = http.createServer((req, res) => {
    const body = req.url?.startsWith('/plain') ? PAGE_WITHOUT_META : PAGE_WITH_META;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const userDataDir = mkdtempSync(path.join(tmpdir(), 'yidian-capture-e2e-'));
  let app = null;
  try {
    const electronBinary = path.join(DESKTOP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: DESKTOP_DIR,
      executablePath: electronBinary,
      timeout: 60_000,
    });
    await app.firstWindow();

    // 走桌面端自己的采集通道（渲染页 preload 暴露的接口 → IPC → captureUrl）
    const outcome = await app.evaluate(async ({ BrowserWindow }, target) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.webContents.executeJavaScript(
        `window.yidianDesktop.capture({ url: ${JSON.stringify(target)}, source: 'e2e' })`,
      );
    }, `http://127.0.0.1:${port}/with-meta`);
    assert.equal(outcome?.ok, true, `采集应该成功：${JSON.stringify(outcome)}`);

    // 再收一条没有描述的页面：标题照旧，描述留空
    const plain = await app.evaluate(async ({ BrowserWindow }, target) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.webContents.executeJavaScript(
        `window.yidianDesktop.capture({ url: ${JSON.stringify(target)}, source: 'e2e' })`,
      );
    }, `http://127.0.0.1:${port}/plain`);
    assert.equal(plain?.ok, true, `采集应该成功：${JSON.stringify(plain)}`);

    // 卡片上的「收下剪贴板」按钮走的是 desktop-clipboard-mark 这条消息。
    // 它以前只被发出、没人处理 —— 点了没反应。现在补一条专门验它。
    const clipboardMark = await app.evaluate(async ({ BrowserWindow }, target) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.webContents.executeJavaScript(
        `chrome.runtime.sendMessage({ type: 'desktop-clipboard-mark', url: ${JSON.stringify(target)} })`,
      );
    }, `http://127.0.0.1:${port}/clipboard`);
    assert.equal(clipboardMark?.ok, true, `剪贴板按钮应该收得下来：${JSON.stringify(clipboardMark)}`);

    // 写一句批注（桌面端的消息层也要能处理 set-note）
    const noted = await app.evaluate(async ({ BrowserWindow }, target) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.webContents.executeJavaScript(
        `chrome.runtime.sendMessage({ type: 'set-note', normalizedUrl: ${JSON.stringify(target)}, note: '这条是我要的配色' })`,
      );
    }, `http://127.0.0.1:${port}/with-meta`);
    assert.equal(noted?.ok, true, `写批注应该成功：${JSON.stringify(noted)}`);
    assert.equal(noted?.record?.note, '这条是我要的配色');

    // 存盘是异步的，等它落盘
    const storePath = path.join(userDataDir, 'store.json');
    const records = await waitFor(() => {
      if (!existsSync(storePath)) return null;
      const raw = JSON.parse(readFileSync(storePath, 'utf8'));
      const list = raw.records ?? [];
      return list.length >= 3 ? list : null;
    }, { label: '桌面端把三条收藏写进 store.json' });

    const rich = records.find((record) => record.url.includes('/with-meta'));
    const poor = records.find((record) => record.url.includes('/plain'));
    const clipped = records.find((record) => record.url.includes('/clipboard'));
    assert.ok(rich, '应该收下带描述的那条');
    assert.equal(rich.title, '如何把饭煮熟 | 厨房笔记', '标题应该来自页面');
    assert.equal(rich.summary, '一篇讲怎么煮饭的文章。', '描述应该来自页面');
    assert.ok(poor, '应该收下没有描述的那条');
    assert.equal(poor.title, '只有标题的页面', '标题应该来自页面');
    assert.equal(poor.summary, '', '没有描述就留空，不编造');
    assert.ok(clipped, '剪贴板按钮应该真的收下了一条');
    assert.equal(clipped.title, '如何把饭煮熟 | 厨房笔记');
    assert.equal(clipped.summary, '一篇讲怎么煮饭的文章。');
    assert.equal(rich.note, '这条是我要的配色', '批注应该落在记录里');

    // 回看卡片上直接写一句：不用去收藏库，回看那一刻就能回应
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.webContents.executeJavaScript('window.yidianDesktop.toggleCard()');
    });
    const cardPage = await waitFor(
      () => app.windows().find((page) => page.url().includes('card.html')) ?? null,
      { label: '回看卡片窗出现' },
    );
    await cardPage.waitForSelector('#yidian-note-edit', { timeout: 20_000 });
    await cardPage.click('#yidian-note-edit');
    await cardPage.fill('#yidian-note-input', '等我把间隔算法调完');
    await cardPage.click('#yidian-note-save');
    await cardPage.waitForSelector('#otter-yidian-toast.show', { timeout: 20_000 });
    const cardNotes = JSON.parse(readFileSync(storePath, 'utf8')).records;
    assert.ok(
      cardNotes.some((record) => record.note === '等我把间隔算法调完'),
      `卡片上写的那句应该存下来，实际：${JSON.stringify(cardNotes.map((r) => r.note))}`,
    );
  } finally {
    await app?.close();
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* 留给系统清理 */ }
  }
});
