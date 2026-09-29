import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = mkdtempSync(path.join(tmpdir(), 'yidian-upgrade-'));
const profile = path.join(root, 'browser-profile');
const installed = path.join(root, 'installed-extension');
const duplicate = path.join(root, 'second-extension');
const injectionCopy = path.join(root, 'injection-test-extension');
const source = fileURLToPath(new URL('../../extension/', import.meta.url));
const site = fileURLToPath(new URL('../../studio/', import.meta.url));
const oldZip = fileURLToPath(new URL('../../studio/yidian-1.3.1.zip', import.meta.url));
let context;
let siteServer;

async function launch(...paths) {
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    channel: process.platform === 'win32' ? 'msedge' : 'chromium',
    args: [
      `--disable-extensions-except=${paths.join(',')}`,
      `--load-extension=${paths.join(',')}`,
      '--no-first-run',
    ],
  });
  if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker', { timeout: 20_000 });
  return context;
}

async function library(id) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/library.html`);
  await page.waitForSelector('h1');
  return page;
}

function ids() {
  return [...new Set(context.serviceWorkers().map((worker) => new URL(worker.url()).hostname))];
}

try {
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `Expand-Archive -LiteralPath ${quote(oldZip)} -DestinationPath ${quote(installed)}`,
  ]);

  await launch(installed);
  const originalId = ids()[0];
  assert.ok(originalId, '1.3.1 extension did not start');
  let page = await library(originalId);
  assert.equal(await page.evaluate(() => chrome.runtime.getManifest().version), '1.3.1');
  const marked = await page.evaluate(() => chrome.runtime.sendMessage({
    type: 'mark-current', tab: { title: '升级测试', url: 'https://example.com/upgrade' },
  }));
  assert.equal(marked.ok, true);
  assert.equal((await page.evaluate(() => chrome.storage.local.get('records'))).records.length, 1);
  await page.evaluate(async () => {
    const { records } = await chrome.storage.local.get('records');
    await chrome.storage.local.set({ records: [
      ...records,
      null,
      { title: '旧版无法识别的本地文档', url: 'file:///old-note' },
    ] });
  });
  await context.close();
  context = undefined;

  cpSync(source, installed, { recursive: true, force: true });
  await launch(installed);
  assert.equal(ids()[0], originalId, 'updating the same folder changed the extension ID');
  page = await library(originalId);
  assert.equal(await page.evaluate(() => chrome.runtime.getManifest().version), '1.3.3');
  await page.evaluate(() => chrome.runtime.reload());
  page = await library(originalId);
  await page.waitForFunction(async () => {
    const data = await chrome.storage.local.get(['records', 'unreadableRecords']);
    return data.records?.length === 1 && data.unreadableRecords?.length === 2;
  });
  await page.waitForFunction(() => document.querySelector('#total')?.textContent === '1', null, { timeout: 5_000 });
  assert.equal(await page.locator('#total').innerText(), '1');
  const migrated = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'export-backup' }));
  assert.equal(migrated.records.length, 1);
  assert.deepEqual(migrated.unreadable.map(({ record }) => record?.url ?? null), [null, 'file:///old-note']);
  await context.close();
  context = undefined;

  cpSync(source, duplicate, { recursive: true });
  await launch(installed, duplicate);
  if (ids().length < 2) await context.waitForEvent('serviceworker', { timeout: 20_000 });
  const otherId = ids().find((id) => id !== originalId);
  assert.ok(otherId, 'second folder did not create a separate extension');
  const first = await library(originalId);
  const second = await library(otherId);
  assert.equal((await first.evaluate(() => chrome.storage.local.get('records'))).records.length, 1);
  assert.equal((await second.evaluate(() => chrome.storage.local.get('records'))).records?.length ?? 0, 0);
  const shortcuts = await second.evaluate(() => chrome.commands.getAll());
  assert.equal(shortcuts.find((item) => item.name === 'open-current-document').shortcut, '');

  siteServer = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1) || 'index.html';
    const file = path.resolve(site, name);
    if (!file.startsWith(site) || !existsSync(file)) { response.writeHead(404).end(); return; }
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    response.setHeader('Content-Type', `${type}; charset=utf-8`);
    response.end(readFileSync(file));
  });
  await new Promise((resolve) => siteServer.listen(0, '127.0.0.1', resolve));
  const demo = await context.newPage();
  const pageErrors = [];
  demo.on('pageerror', (error) => pageErrors.push(error.message));
  await demo.goto(`http://127.0.0.1:${siteServer.address().port}/`);
  assert.equal(await demo.locator('#percent').innerText(), '0/4');
  for (let step = 0; step < 4; step++) await demo.locator('#advance').click();
  assert.equal(await demo.locator('#percent').innerText(), '4/4');
  assert.equal(await demo.locator('a[download]').getAttribute('href'), 'yidian-1.3.3.zip');
  assert.deepEqual(pageErrors, []);
  if (process.env.YIDIAN_CAPTURE) {
    const output = fileURLToPath(new URL('../../output/', import.meta.url));
    mkdirSync(output, { recursive: true });
    await demo.locator('#features').screenshot({ path: path.join(output, 'review-site-features.png') });
    await demo.locator('#updates').screenshot({ path: path.join(output, 'review-site-updates.png') });
  }

  await context.close();
  context = undefined;
  cpSync(source, injectionCopy, { recursive: true });
  const testManifest = path.join(injectionCopy, 'manifest.json');
  const manifest = JSON.parse(readFileSync(testManifest, 'utf8'));
  // Test-only host grant lets Playwright invoke the real injection path without browser-toolbar automation.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  writeFileSync(testManifest, JSON.stringify(manifest));
  await launch(injectionCopy);
  const injectionId = ids()[0];
  const webPage = await context.newPage();
  await webPage.goto(`http://127.0.0.1:${siteServer.address().port}/`);
  const extensionPage = await library(injectionId);
  await extensionPage.getByText('从一页值得再看的内容开始').waitFor({ state: 'visible' });
  assert.equal(await extensionPage.locator('.filters').isVisible(), false);
  assert.equal(await extensionPage.locator('#migration-guide').evaluate((element) => element.open), false);
  const tabs = await extensionPage.evaluate(() => chrome.tabs.query({}));
  const current = tabs.find((tab) => tab.url?.startsWith(`http://127.0.0.1:${siteServer.address().port}/`));
  assert.ok(current, 'test page was not visible to the extension');
  await extensionPage.evaluate(async ({ windowId, url }) => {
    await chrome.storage.session.set({
      [`entryContext:${windowId}`]: { mode: 'current', page: { title: '一点官网', url }, openedAt: Date.now() },
    });
  }, { windowId: current.windowId, url: current.url });
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 410, height: 820 });
  await panel.goto(`chrome-extension://${injectionId}/sidepanel.html`);
  await panel.waitForFunction(() => document.querySelector('#progress-text')?.textContent === '0/4');
  await extensionPage.evaluate(async ({ id, url }) => {
    const workerModule = await import(chrome.runtime.getURL('service-worker.mjs'));
    await workerModule.handleCommand('open-current-document', { id, url });
  }, { id: current.id, url: current.url });
  await webPage.locator('#otter-yidian-card').waitFor({ state: 'visible' });
  assert.equal(await webPage.locator('#otter-yidian-root').count(), 1);
  await webPage.locator('[data-action="mark"]').click();
  await webPage.waitForFunction(() => document.querySelector('#otter-yidian-card')?.textContent?.includes('相见 1/4'));
  assert.equal((await extensionPage.evaluate(() => chrome.storage.local.get('records'))).records.length, 1);
  await panel.waitForFunction(() => document.querySelector('#progress-text')?.textContent === '1/4');
  assert.equal(await panel.locator('#pet').count(), 0);
  assert.equal(await panel.locator('#document-title').innerText(), '一点官网');
  assert.ok(await panel.locator('#next-review').innerText());
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth), 410);
  await extensionPage.evaluate(async () => {
    const { records } = await chrome.storage.local.get('records');
    records[0].nextReviewAt = Date.now() - 1_000;
    await chrome.storage.local.set({ records });
  });
  await extensionPage.reload();
  await extensionPage.locator('#today-card').waitFor({ state: 'visible' });
  assert.match(await extensionPage.locator('#today-title').innerText(), /一点/);
  await extensionPage.setViewportSize({ width: 390, height: 820 });
  assert.equal(await extensionPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.YIDIAN_CAPTURE) {
    const output = fileURLToPath(new URL('../../output/', import.meta.url));
    mkdirSync(output, { recursive: true });
    await extensionPage.screenshot({ path: path.join(output, 'review-library.png'), fullPage: true });
    await panel.screenshot({ path: path.join(output, 'review-sidepanel.png') });
  }
  await extensionPage.setViewportSize({ width: 1280, height: 800 });
  await extensionPage.locator('#today-later').click();
  await extensionPage.locator('#today-card').waitFor({ state: 'hidden' });
  const postponed = (await extensionPage.evaluate(() => chrome.storage.local.get('records'))).records[0];
  assert.equal(postponed.stage, 1);
  assert.ok(postponed.nextReviewAt > Date.now());
  await extensionPage.evaluate(async () => {
    const { records } = await chrome.storage.local.get('records');
    records[0].nextReviewAt = Date.now() - 1_000;
    await chrome.storage.local.set({ records });
  });
  await extensionPage.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'show-pet', mode: 'review' }), current.id);
  await webPage.locator('[data-action="used"]').waitFor({ state: 'visible' });
  if (process.env.YIDIAN_CAPTURE) {
    const output = fileURLToPath(new URL('../../output/', import.meta.url));
    await webPage.screenshot({ path: path.join(output, 'review-pet.png') });
  }
  await webPage.locator('[data-action="used"]').click();
  await webPage.waitForFunction(() => document.querySelector('#otter-yidian-card')?.textContent?.includes('相见 2/4'));
  assert.equal((await extensionPage.evaluate(() => chrome.storage.local.get('records'))).records[0].stage, 2);
  await panel.waitForFunction(() => document.querySelector('#progress-text')?.textContent === '2/4');
  await extensionPage.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'mark-current', tab: { title: '可归档的一页', url: 'https://example.com/retire' } });
    const { records } = await chrome.storage.local.get('records');
    records.find((record) => record.url.endsWith('/retire')).nextReviewAt = Date.now() - 1_000;
    await chrome.storage.local.set({ records });
  });
  await extensionPage.reload();
  await extensionPage.locator('#today-card').waitFor({ state: 'visible' });
  await extensionPage.locator('#today-retire').click();
  await extensionPage.locator('#today-card').waitFor({ state: 'hidden' });
  const retired = await extensionPage.evaluate(() => chrome.storage.local.get(['records', 'archivedRecords']));
  assert.equal(retired.records.length, 1);
  assert.equal(retired.archivedRecords.length, 1);
  assert.equal(retired.archivedRecords[0].encounters.at(-1).type, 'retired');
  const collectionTab = context.waitForEvent('page');
  await panel.getByRole('link', { name: '全部收藏' }).click();
  assert.match((await collectionTab).url(), /\/library\.html$/);
  const disconnected = await context.newPage();
  await disconnected.addInitScript(() => {
    chrome.runtime.sendMessage = async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
  });
  await disconnected.goto(`chrome-extension://${injectionId}/library.html`);
  await disconnected.locator('#retry-load').waitFor({ state: 'visible' });
  assert.match(await disconnected.locator('#status').innerText(), /刷新“一点”后重试/);
  assert.equal(await disconnected.locator('.summary-line').isVisible(), false);
  assert.ok(await disconnected.locator('#status').evaluate((element) => element.classList.contains('error')));
  const backupDownload = disconnected.waitForEvent('download');
  await disconnected.locator('#export-local').click();
  const rawBackup = JSON.parse(readFileSync(await (await backupDownload).path(), 'utf8'));
  assert.equal(rawBackup.records.length, 1);
  const managerTab = context.waitForEvent('page');
  await disconnected.locator('#open-extensions').click();
  assert.match((await managerTab).url(), /^edge:\/\/extensions\//);
  const disconnectedPanel = await context.newPage();
  await disconnectedPanel.setViewportSize({ width: 410, height: 820 });
  await disconnectedPanel.addInitScript(() => {
    chrome.runtime.sendMessage = async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
  });
  await disconnectedPanel.goto(`chrome-extension://${injectionId}/sidepanel.html`);
  await disconnectedPanel.locator('#retry').waitFor({ state: 'visible' });
  assert.equal(await disconnectedPanel.locator('#document-title').innerText(), '暂时读不到收藏');
  assert.match(await disconnectedPanel.locator('#status-copy').innerText(), /刷新“一点”后重试/);
  assert.equal(await disconnectedPanel.locator('#progress-card').isVisible(), false);
  assert.equal(await disconnectedPanel.locator('#open-extensions').isVisible(), true);
  console.log('Browser upgrade verified: same folder keeps ID and record; second folder splits storage and shortcut.');
  console.log('Studio verified: four-step demo works and links to the current ZIP.');
  console.log('Extension verified: the pet saves and reviews a page, the side panel tracks 0/4 to 2/4, and a disconnected library shows recovery steps.');
} finally {
  await context?.close();
  if (siteServer) await new Promise((resolve) => siteServer.close(resolve));
  const resolved = realpathSync(root);
  if (path.dirname(resolved) !== realpathSync(tmpdir()) || !path.basename(resolved).startsWith('yidian-upgrade-')) {
    throw new Error(`Refusing to clean unexpected path: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true });
}
