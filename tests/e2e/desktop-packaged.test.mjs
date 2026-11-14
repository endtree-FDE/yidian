// 打包版真跑：直接跑装好的 exe，收下一个链接，看标题和一句描述是不是真的抓回来了。
//
// 这一支验的是「交付物本身」—— 不是工作区里的源码，是打包后发给用户的那个二进制。
// 没打过包就跳过（dist/win-unpacked/一点.exe 不存在）。
//
// 运行（仓库根目录）：npm run test:e2e:desktop:packaged
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGED = path.join(ROOT, 'packages', 'yidian-desktop', 'dist', 'win-unpacked', '一点.exe');

test('打包版：收下链接时，标题和一句描述都抓得回来', {
  timeout: 180_000,
  skip: existsSync(PACKAGED) ? false : '还没打包（先跑 npm run dist）',
}, async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8">
      <title>打包版也能抓到 | 厨房笔记</title>
      <meta name="description" content="打包版实跑：描述也一起带回来。">
      </head><body><h1>正文</h1></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const userDataDir = mkdtempSync(path.join(tmpdir(), 'yidian-packaged-e2e-'));
  let app = null;
  try {
    app = await electron.launch({
      executablePath: PACKAGED,
      args: ['.', `--user-data-dir=${userDataDir}`],
      timeout: 60_000,
    });
    await app.firstWindow();

    const outcome = await app.evaluate(async ({ BrowserWindow }, target) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.webContents.executeJavaScript(
        `window.yidianDesktop.capture({ url: ${JSON.stringify(target)}, source: 'e2e' })`,
      );
    }, `http://127.0.0.1:${port}/`);
    assert.equal(outcome?.ok, true, `采集应该成功：${JSON.stringify(outcome)}`);

    const storePath = path.join(userDataDir, 'store.json');
    const deadline = Date.now() + 30_000;
    let records = [];
    while (Date.now() < deadline) {
      if (existsSync(storePath)) {
        records = JSON.parse(readFileSync(storePath, 'utf8')).records ?? [];
        if (records.length) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal(records.length, 1, '打包版应该收下这一条');
    assert.equal(records[0].title, '打包版也能抓到 | 厨房笔记');
    assert.equal(records[0].summary, '打包版实跑：描述也一起带回来。');
  } finally {
    await app?.close();
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* 留给系统清理 */ }
  }
});
