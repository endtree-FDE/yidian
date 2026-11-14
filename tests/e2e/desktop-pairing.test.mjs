// 真·端到端：桌面端（Electron 真进程） + 浏览器扩展（真 Chromium）联调。
//
// 验收的是这一轮的核心目标：
//   1) 配对前：扩展碰不到桌面端的收藏；
//   2) 配对：填一次码就换到 token；
//   3) 装完即对齐：扩展里攒的收藏，桌面端立刻就有。
//
// 运行（仓库根目录）：npm run test:e2e:desktop
// 注意：会拉起一个 Electron 窗口和一个 Chromium 窗口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXTENSION_PATH = path.join(ROOT, 'packages', 'yidian-1.3.0');
const DESKTOP_DIR = path.join(ROOT, 'packages', 'yidian-desktop');

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

test('桌面端 + 扩展：配对一次，收藏立刻对齐', { timeout: 180_000 }, async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'yidian-desktop-e2e-'));
  const browserProfile = mkdtempSync(path.join(tmpdir(), 'yidian-browser-e2e-'));
  let desktop = null;
  let context = null;
  try {
    // 1) 起桌面端（真 Electron），用独立的 user-data-dir，不碰用户自己的数据
    const electronBinary = path.join(DESKTOP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
    desktop = spawn(electronBinary, ['.', '--pair-code', `--user-data-dir=${userDataDir}`], {
      cwd: DESKTOP_DIR,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    desktop.stdout.setEncoding('utf8');
    desktop.stdout.on('data', (chunk) => { stdout += chunk; });
    desktop.stderr.setEncoding('utf8');
    desktop.stderr.on('data', (chunk) => { stderr += chunk; });
    desktop.on('exit', (code) => { stdout += `\n[进程退出] code=${code}\n`; });

    // 2) 等配对码与桥
    //    Windows 上 Electron 是 GUI 程序，stdout 不可靠 → 读 user-data-dir 里的配对码文件
    const codeFile = path.join(userDataDir, 'pair-code.txt');
    const code = await waitFor(() => {
      if (!existsSync(codeFile)) return null;
      const text = readFileSync(codeFile, 'utf8').trim();
      return /^\d{6}$/.test(text) ? text : null;
    }, { label: '桌面端写出配对码' });
    assert.match(code, /^\d{6}$/, '桌面端应该写出 6 位配对码');

    await waitFor(async () => {
      // 带身份头探活：没配对的扩展也能 ping，但 403 也说明桥活着
      const response = await fetch('http://127.0.0.1:39717/ping', {
        headers: { 'x-yidian-extension': 'a'.repeat(32) },
      });
      return response.status < 500;
    }, { label: `桌面端本地桥启动\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}` });

    // 3) 起浏览器（真 Chromium）加载扩展
    context = await chromium.launchPersistentContext(browserProfile, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
      ],
    });
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker', { timeout: 30_000 });
    const extensionId = new URL(worker.url()).hostname;

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/library.html`);
    await page.waitForSelector('h1');

    // 4) 先在扩展里存一条收藏（模拟之前已经用过扩展）
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: 'mark-current',
        tab: { title: '联调测试收藏', url: 'https://example.com/e2e-desktop-pair', excerpt: '' },
      });
    });

    // 5) 配对：填码 → 接上
    await page.waitForSelector('#desktop-panel:not([hidden])', { timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelector('#desktop-status')?.textContent?.includes('桌面端'),
      { timeout: 30_000 },
    );
    await page.fill('#desktop-code', code);
    await page.click('#desktop-connect');
    await page.waitForFunction(
      () => document.querySelector('#desktop-status')?.textContent?.includes('连上'),
      { timeout: 30_000 },
    );

    // 6) 装完即对齐：桌面端的存储里应该已经有扩展那条收藏
    const storePath = path.join(userDataDir, 'store.json');
    const records = await waitFor(() => {
      if (!existsSync(storePath)) return null;
      const raw = JSON.parse(readFileSync(storePath, 'utf8'));
      const list = raw.records ?? [];
      return list.length ? list : null;
    }, { timeout: 30_000, label: '桌面端收到扩展推来的收藏' });
    assert.equal(records.length, 1, '桌面端应该收到扩展推过来的收藏');
    assert.equal(records[0].title, '联调测试收藏');
    assert.equal(records[0].normalizedUrl, 'https://example.com/e2e-desktop-pair');

    // 7) 桌面端也把扩展记进了配对名单
    const store = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(store.bridgePaired?.[extensionId]?.token?.length > 0, true, '桌面端应记下这个扩展');
  } finally {
    await context?.close();
    desktop?.kill();
    // Electron 被杀后文件句柄要过一会儿才松开，清理失败不影响验收结论
    await new Promise((resolve) => setTimeout(resolve, 1500));
    for (const dir of [userDataDir, browserProfile]) {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* 留给系统清理 */ }
    }
  }
});
