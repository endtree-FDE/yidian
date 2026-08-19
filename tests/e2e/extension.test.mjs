// 一点 1.3.0 真实浏览器 UI 测试：Playwright 加载未打包扩展，驱动 library.html。
// 运行（仓库根目录）：npm run test:e2e
// 前置：npm install 且 npx playwright install chromium 完成。
// 注意：扩展加载需要有头浏览器（headless: false），本地运行会弹出浏览器窗口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXTENSION_PATH = path.join(ROOT, 'packages', 'yidian-1.3.0');

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
