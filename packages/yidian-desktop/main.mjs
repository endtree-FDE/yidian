// 一点 · 桌面常驻层（Electron）
//
// 职责边界：
//   扩展 = 采集器（它才知道当前网页的标题、URL、选段）
//   桌面端 = 常驻宠物 + 到期提醒 + 回看闭环 + 自己的采集通道
//
// 业务逻辑在 packages/yidian-core/（平台无关），这里只做「壳」：
// 窗口、托盘、热键、剪贴板/拖拽采集、本地桥、调度器、开机自启。
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  app, BrowserWindow, Tray, Menu, globalShortcut, Notification, shell, ipcMain, screen, nativeImage, protocol, clipboard, net,
} from 'electron';

import { createMessageLayer } from './vendor/yidian-core/messages.mjs';
import * as domain from './vendor/yidian-core/domain.mjs';
import { PAIR_CODE_TTL_MS } from './vendor/yidian-core/bridge-protocol.mjs';
import { decodePageBytes, extractMetaFromHtml } from './vendor/yidian-core/page-meta.mjs';
import { JsonStore } from './core/store.mjs';
import { createDesktopPlatform } from './core/platform.mjs';
import { createBridgeServer, DEFAULT_BRIDGE_PORTS } from './core/bridge-server.mjs';
import { createBridgeRoute } from './core/bridge-route.mjs';
import { createPairingManager } from './core/pairing.mjs';
import { DEFAULT_FETCH_TIMEOUT_MS, pickUrl, resolveCaptureTab } from './core/capture.mjs';

export { pickUrl };

const here = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(here, 'preload.mjs');
const bundleDir = path.join(here, 'assets', 'bundle');
const isCaptureMode = process.argv.includes('--capture');
// --pair-code：生成配对码并打到控制台（脚本化接入 / 自动化验收用）
const isPairCodeMode = process.argv.includes('--pair-code');
const captureDir = path.resolve(here, '..', '..', 'docs', 'captures');

// 全局热键：收下剪贴板里的链接（避开扩展的 Ctrl+Shift+Y，免得两边同时响应）
const CAPTURE_HOTKEY = 'Control+Alt+Y';

// 抓图模式关掉硬件加速：虚拟机/远程桌面下 GPU 合成会让 capturePage 抛 UnknownVizError。
if (isCaptureMode) app.disableHardwareAcceleration();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

let store = null;
let layer = null;         // 核心消息层
let bridge = null;
let petWindow = null;
let cardWindow = null;
let libraryWindow = null;
let pairWindow = null;
let tray = null;
let roaming = true;
let dragOffset = null;
let lastDueSignature = '';
let schedulerTimer = null;
let roamTimer = null;
let loginItem = false;

// 本地桥的配对状态：extensionId → { name, token, pairedAt }
let pairing = null;

const log = (...args) => console.log('[一点桌面端]', ...args);

/* ---------------------------------------------------------------- 协议 */

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// app://bundle/... → 桌面端自带的界面副本（打包后也带着）
// app://app/...    → 桌面端自己的渲染页
function hostRoot(host) {
  if (host === 'bundle') return bundleDir;
  if (host === 'app') return here;
  return null;
}

async function serveAppUrl(request) {
  const url = new URL(request.url);
  const root = hostRoot(url.host);
  if (!root) return new Response('not found', { status: 404 });
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root))) return new Response('forbidden', { status: 403 });
  try {
    const data = await fs.readFile(target);
    return new Response(data, {
      status: 200,
      headers: {
        'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
        // 本地内容，不联网：页面只准从 app:// 自取资源
        'content-security-policy': "default-src 'self' app: data:; style-src 'self' app: 'unsafe-inline'; font-src app: data:; img-src app: data:; script-src 'self' app:",
      },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

/* ---------------------------------------------------------------- 消息路由 */

async function routeMessage(message) {
  if (!message || typeof message !== 'object') return { ok: false, error: '无效操作' };
  if (message.type === 'desktop-summary') {
    const records = await layer.getRecords();
    const now = Date.now();
    const due = domain.selectNextDue(records, now);
    const upcoming = records
      .filter((record) => record.stage < domain.MAX_STAGE && !domain.isDue(record, now))
      .toSorted((a, b) => a.nextReviewAt - b.nextReviewAt)[0] ?? null;
    const recent = records.toSorted((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    const petRecord = due ?? recent ?? null;
    return {
      ok: true,
      due,
      upcoming,
      recent,
      petRecord,
      petStage: petRecord?.stage ?? 0,
      total: records.length,
      settings: await layer.getSettings(),
      now,
    };
  }
  if (message.type === 'desktop-clipboard-mark') {
    // 桌面端卡片上的「收下剪贴板」：走和托盘一样的采集通道（含抓标题与描述）。
    return captureUrl(message.url ?? '', '剪贴板');
  }
  return layer.handleMessage(message);
}

/* ---------------------------------------------------------------- 采集 */

// 抓页面元信息时用的 UA：Electron 默认带 Electron 字样，不少站点会直接挡掉。
const FETCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * 抓一次页面，拿到标题、一句描述和 canonical 链接。
 * 抓不到就返回 null —— 收下这条链接照旧，只是标题走兜底。
 */
async function fetchPageMeta(url, { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await net.fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': FETCH_USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    if (!response.ok) {
      log(`[采集] 抓不到页面信息：${url} → HTTP ${response.status}`);
      return null;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) return null;
    const bytes = await response.arrayBuffer();
    const html = decodePageBytes(bytes, contentType);
    const meta = extractMetaFromHtml(html, url);
    log(`[采集] 抓到「${meta.title || '（无标题）'}」：${url}`);
    return meta;
  } catch (error) {
    log(`[采集] 抓页面失败：${url} → ${error?.message ?? error}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 收下一条链接（剪贴板或拖进来的）。标题与描述尽量从页面里抓，抓不到再兜底。 */
async function captureUrl(url, source = '剪贴板') {
  const tab = await resolveCaptureTab(url, { fetchMeta: fetchPageMeta });
  if (!tab) return { ok: false, error: '没找到 http/https 链接' };
  const result = await layer.handleMessage({ type: 'mark-current', tab });
  log(`[采集] 从${source}收下了 ${tab.url}`);
  refreshWindows();
  return result;
}

/* ---------------------------------------------------------------- 窗口 */

function watchWindow(win, label) {
  // 新版 Electron 的 console-message 传事件对象，旧版传 (level, message, ...)
  win.webContents.on('console-message', (event, ...legacy) => {
    const isEvent = event && typeof event === 'object' && 'message' in event;
    const level = isEvent ? event.level : legacy[0];
    const message = isEvent ? event.message : legacy[1];
    if (level >= 2) log(`[${label} 控制台] ${message}`);
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    log(`[${label} 加载失败] ${code} ${description} ${url}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    log(`[${label} 渲染进程退出] ${details?.reason ?? ''}`);
  });
  return win;
}

function petWindowOptions() {
  return {
    width: 132,
    height: 152,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  };
}

function ensurePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) return petWindow;
  petWindow = new BrowserWindow(petWindowOptions());
  petWindow.setAlwaysOnTop(true, 'floating');
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  watchWindow(petWindow, '宠物窗');
  petWindow.loadURL('app://app/renderer/pet.html');
  petWindow.on('closed', () => { petWindow = null; });
  return petWindow;
}

function ensureCardWindow() {
  if (cardWindow && !cardWindow.isDestroyed()) return cardWindow;
  cardWindow = new BrowserWindow({
    width: 372,
    height: 430,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  cardWindow.setAlwaysOnTop(true, 'floating');
  watchWindow(cardWindow, '卡片窗');
  cardWindow.loadURL('app://app/renderer/card.html');
  cardWindow.on('closed', () => { cardWindow = null; });
  return cardWindow;
}

function placeCardWindow() {
  if (!petWindow || petWindow.isDestroyed() || !cardWindow || cardWindow.isDestroyed()) return;
  const pet = petWindow.getBounds();
  const card = cardWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: pet.x + pet.width / 2, y: pet.y + pet.height / 2 });
  const area = display.workArea;
  let x = pet.x + pet.width / 2 - card.width / 2;
  let y = pet.y - card.height - 10;
  if (y < area.y) y = Math.min(area.y + area.height - card.height, pet.y + pet.height + 10);
  x = Math.min(Math.max(area.x, x), area.x + area.width - card.width);
  y = Math.min(Math.max(area.y, y), area.y + area.height - card.height);
  cardWindow.setPosition(Math.round(x), Math.round(y));
}

function toggleCardWindow() {
  const card = ensureCardWindow();
  if (card.isVisible()) {
    card.hide();
    return;
  }
  placeCardWindow();
  card.showInactive();
  card.webContents.send('yidian:push', { type: 'refresh-card' });
}

function openLibraryWindow() {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    libraryWindow.show();
    libraryWindow.focus();
    return libraryWindow;
  }
  libraryWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: '一点 · 我的收藏',
    backgroundColor: '#f7f6f1',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  watchWindow(libraryWindow, '收藏库');
  libraryWindow.loadURL('app://bundle/library.html');
  libraryWindow.on('closed', () => { libraryWindow = null; });
  return libraryWindow;
}

function refreshWindows() {
  for (const win of [petWindow, cardWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('yidian:push', { type: 'refresh-pet' });
  }
}

/* ---------------------------------------------------------------- 托盘 */

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '打开我的收藏', click: () => openLibraryWindow() },
    { label: '回看卡片', click: () => toggleCardWindow() },
    { label: `收下剪贴板里的链接（${CAPTURE_HOTKEY}）`, click: () => { captureFromClipboard(); } },
    { type: 'separator' },
    { label: '连接浏览器扩展', click: () => startPairing() },
    {
      label: '断开浏览器扩展',
      enabled: (pairing?.listPeers().length ?? 0) > 0,
      click: () => { disconnectPeers(); },
    },
    { type: 'separator' },
    {
      label: '让它在桌面散步',
      type: 'checkbox',
      checked: roaming,
      click: (item) => { roaming = item.checked; },
    },
    {
      label: '开机时自动打开',
      type: 'checkbox',
      checked: loginItem,
      click: (item) => { setLoginItem(item.checked); },
    },
    { label: '回到右下角', click: () => movePetToCorner() },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function buildTray() {
  const iconPath = path.join(bundleDir, 'icons', 'icon-32.png');
  let image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('一点 · 桌面常驻');
  refreshTrayMenu();
  tray.on('click', () => toggleCardWindow());
}

function movePetToCorner() {
  const pet = ensurePetWindow();
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const bounds = pet.getBounds();
  pet.setPosition(area.x + area.width - bounds.width - 40, area.y + area.height - bounds.height - 40);
}

/* ---------------------------------------------------------------- 开机自启 */

function setLoginItem(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
    loginItem = app.getLoginItemSettings().openAtLogin;
  } catch (error) {
    log('[开机自启] 设置失败', error?.message ?? error);
    loginItem = false;
  }
  refreshTrayMenu();
}

/* ---------------------------------------------------------------- 调度器 */

async function tick() {
  try {
    const records = await layer.getRecords();
    const now = Date.now();
    const due = records.filter((record) => domain.isDue(record, now));
    const signature = due.map((record) => `${record.normalizedUrl}@${record.nextReviewAt}`).join('|');
    if (signature !== lastDueSignature) {
      lastDueSignature = signature;
      if (due.length) {
        await layer.maybeNotifyDue(records, now);
        log(`[调度] 有 ${due.length} 份到期，已提醒`);
      }
    }
    refreshWindows();
  } catch (error) {
    log('[调度] 出错', error?.message ?? error);
  }
}

/* ---------------------------------------------------------------- 本地桥 */

/* ---------------------------------------------------------------- 配对 */

/** 生成一次性配对码：复制到剪贴板，并弹一个窗让用户照着输入。 */
function startPairing() {
  const { code } = pairing.beginPairing();
  clipboard.writeText(code);
  openPairWindow(code);
  refreshTrayMenu();
  log('[配对] 已生成配对码并复制到剪贴板');
}

function openPairWindow(code) {
  const query = `code=${encodeURIComponent(code)}&expires=${Date.now() + PAIR_CODE_TTL_MS}`;
  if (pairWindow && !pairWindow.isDestroyed()) {
    pairWindow.loadURL(`app://app/renderer/pair.html?${query}`);
    pairWindow.show();
    pairWindow.focus();
    return;
  }
  pairWindow = new BrowserWindow({
    width: 380,
    height: 320,
    resizable: false,
    maximizable: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#fffdf7',
    title: '一点 · 连接浏览器扩展',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  pairWindow.loadURL(`app://app/renderer/pair.html?${query}`);
  pairWindow.on('closed', () => { pairWindow = null; });
  pairWindow.setAlwaysOnTop(true, 'screen-saver');
}

function closePairWindow() {
  if (pairWindow && !pairWindow.isDestroyed()) pairWindow.close();
  pairWindow = null;
}

async function disconnectPeers() {
  if (!pairing.listPeers().length) return;
  await pairing.disconnectAll();
  refreshTrayMenu();
  log('[本地桥] 已断开全部浏览器扩展');
}

function createDesktopPlatformAdapter() {
  const notifications = new Map();
  return createDesktopPlatform({
    store,
    openExternal: async (url) => {
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url);
    },
    openLibrary: async () => { openLibraryWindow(); },
    notify: async (id, options) => {
      const notification = new Notification({
        title: options?.title ?? '一点',
        body: options?.message ?? '',
      });
      notifications.set(id, notification);
      notification.on('click', () => {
        layer.openNotifiedRecord().catch(() => undefined);
      });
      notification.show();
    },
    clearNotification: async (id) => {
      notifications.get(id)?.close();
      notifications.delete(id);
    },
    onRecordsChanged: () => refreshWindows(),
  });
}

async function bootstrap() {
  store = new JsonStore(path.join(app.getPath('userData'), 'store.json'));
  await store.get(null);

  pairing = createPairingManager({ store });
  await pairing.load();

  layer = createMessageLayer(createDesktopPlatformAdapter());

  protocol.handle('app', serveAppUrl);

  registerIpc();
  buildTray();
  ensurePetWindow();

  try {
    loginItem = app.getLoginItemSettings().openAtLogin;
  } catch {
    loginItem = false;
  }

  bridge = createBridgeServer({
    route: createBridgeRoute({
      layer,
      pairing,
      version: app.getVersion(),
      onEvent: (body) => routeMessage(body),
      onPaired: async () => {
        closePairWindow();
        refreshTrayMenu();
      },
      logger: (m) => log(m),
    }),
    ports: DEFAULT_BRIDGE_PORTS,
    logger: (m) => log(m),
    authorize: (ctx) => pairing.authorize(ctx),
  });
  try {
    await bridge.start();
  } catch (error) {
    log('[本地桥] 启动失败', error?.message ?? error);
  }

  const registered = globalShortcut.register(CAPTURE_HOTKEY, () => { captureFromClipboard(); });
  if (!registered) log(`[全局热键] ${CAPTURE_HOTKEY} 注册失败（可能已被占用）`);

  if (isPairCodeMode) {
    const { code } = pairing.beginPairing();
    // Windows 上 Electron 是 GUI 程序，stdout 不可靠 → 配对码同时写进 user-data-dir 的文件，
    // 脚本与自动化验收直接读那个文件，不用去认控制台里的数字。
    const codeFile = path.join(app.getPath('userData'), 'pair-code.txt');
    try {
      await fs.writeFile(codeFile, `${code}\n`, 'utf8');
      log(`[配对] 配对码已写入 ${codeFile}`);
    } catch (error) {
      log('[配对] 配对码写文件失败', error?.message ?? error);
    }
    process.stdout.write(`[配对码] ${code}\n`);
    log('[配对] 已生成配对码（--pair-code）');
  }

  schedulerTimer = setInterval(tick, 30_000);
  startRoaming();
  await tick();
}

/* ---------------------------------------------------------------- 采集入口 */

async function captureFromClipboard() {
  const text = clipboard.readText();
  const url = pickUrl(text);
  if (!url) {
    log('[采集] 剪贴板里没有链接，改为呼出回看卡片');
    toggleCardWindow();
    return { ok: false, error: '剪贴板里没有链接' };
  }
  try {
    const result = await captureUrl(url, '剪贴板');
    toastToCard(result?.created ? '已经收下。进度 1/4；满 24 小时后进行第 1 次回看。' : '又遇见它了。原来的计划继续。');
    return result;
  } catch (error) {
    toastToCard(error?.message ?? '收下失败，请重试');
    return { ok: false, error: error?.message ?? '收下失败' };
  }
}

function toastToCard(message) {
  if (!cardWindow || cardWindow.isDestroyed()) return;
  cardWindow.showInactive();
  cardWindow.webContents.send('yidian:push', { type: 'toast', message });
}

/* ---------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('yidian:message', async (_event, message) => {
    try {
      return await routeMessage(message);
    } catch (error) {
      return { ok: false, error: error?.message || '操作失败，请重试' };
    }
  });

  ipcMain.handle('yidian:open-url', async (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('yidian:open-library', async () => {
    openLibraryWindow();
    return { ok: true };
  });

  ipcMain.handle('yidian:toggle-card', async () => {
    toggleCardWindow();
    return { ok: true };
  });

  ipcMain.handle('yidian:hide-card', async () => {
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.hide();
    return { ok: true };
  });

  ipcMain.handle('yidian:resize-card', async (_event, size) => {
    if (!cardWindow || cardWindow.isDestroyed()) return { ok: false };
    const width = Math.max(240, Math.min(520, Math.round(Number(size?.width) || 372)));
    const height = Math.max(180, Math.min(760, Math.round(Number(size?.height) || 430)));
    const bounds = cardWindow.getBounds();
    if (bounds.width === width && bounds.height === height) return { ok: true };
    cardWindow.setSize(width, height);
    placeCardWindow();
    return { ok: true };
  });

  ipcMain.handle('yidian:drag', async (_event, payload) => {
    if (!petWindow || petWindow.isDestroyed()) return { ok: false };
    const { pointerX, pointerY, phase } = payload ?? {};
    if (phase === 'start') {
      const bounds = petWindow.getBounds();
      dragOffset = { x: pointerX - bounds.x, y: pointerY - bounds.y };
      return { ok: true };
    }
    if (phase === 'move' && dragOffset) {
      petWindow.setPosition(Math.round(pointerX - dragOffset.x), Math.round(pointerY - dragOffset.y));
      return { ok: true };
    }
    if (phase === 'end') {
      dragOffset = null;
      return { ok: true };
    }
    return { ok: true };
  });

  // 桌面端自己的采集：拖进来的链接
  ipcMain.handle('yidian:capture', async (_event, payload) => {
    try {
      const result = await captureUrl(payload?.url ?? '', payload?.source ?? '拖拽');
      toastToCard(result?.created ? '已经收下。进度 1/4；满 24 小时后进行第 1 次回看。' : '又遇见它了。原来的计划继续。');
      return { ok: true, result };
    } catch (error) {
      toastToCard(error?.message ?? '收下失败');
      return { ok: false, error: error?.message ?? '收下失败' };
    }
  });

  ipcMain.handle('yidian:clipboard', async () => {
    return { ok: true, text: clipboard.readText() };
  });
}

/* ---------------------------------------------------------------- 散步 */

function startRoaming() {
  roamTimer = setInterval(() => {
    if (!roaming || dragOffset || !petWindow || petWindow.isDestroyed()) return;
    if (cardWindow && !cardWindow.isDestroyed() && cardWindow.isVisible()) return;
    const bounds = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    const area = display.workArea;
    let x = bounds.x + (petWindow.__dir ?? 1) * 6;
    if (x <= area.x) { x = area.x; petWindow.__dir = 1; }
    if (x + bounds.width >= area.x + area.width) { x = area.x + area.width - bounds.width; petWindow.__dir = -1; }
    petWindow.setPosition(Math.round(x), bounds.y);
  }, 2600);
}

/* ---------------------------------------------------------------- 演示数据 */

async function seedDemoData() {
  const records = await layer.getRecords();
  if (records.length) return;
  const now = Date.now();
  const demo = [
    // 到期的那条：你自己写的那句 —— 卡片上最上面就是它
    { title: '间隔重复的最小实现 · 一篇长文', url: 'https://example.com/spaced-repetition', note: '等我把间隔算法调完，就照着它做。', offsetDays: -8 },
    { title: 'Notion 官方指南：块与数据库', url: 'https://www.notion.so/help/intro-to-blocks', excerpt: '块是内容，数据库是块的集合。', offsetDays: -1 },
    { title: '今天要写的产品周报草稿', url: 'https://example.com/weekly-note', summary: '本周：桌面常驻层开工，顺手把采集通道补齐了。', offsetDays: 2 },
    { title: '一张安静的配色参考', url: 'https://example.com/palette', excerpt: '薄荷绿 + 米白。', offsetDays: 12 },
  ];
  const built = demo.map((item) => domain.createRecord({
    title: item.title, url: item.url, excerpt: item.excerpt, summary: item.summary, note: item.note,
    now: now + item.offsetDays * 86_400_000,
  }));
  const grown = { ...built[3], stage: 4, nextReviewAt: Infinity, updatedAt: now };
  await layer.saveRecords([...built.slice(0, 3), grown]);
  await layer.handleMessage({ type: 'set-notify-on-due', value: true });
  log('[演示] 已写入 4 条示例收藏');
}

/* ---------------------------------------------------------------- 启动 */

app.whenReady().then(async () => {
  await bootstrap();
  movePetToCorner();
  if (petWindow) petWindow.showInactive();

  if (isCaptureMode) {
    await seedDemoData();
    await tick();
    const card = ensureCardWindow();
    placeCardWindow();
    card.showInactive();
    // 抓图时把「写一句」展开，让截图能看到这个新入口
    await new Promise((resolve) => setTimeout(resolve, 900));
    await card.webContents.executeJavaScript("document.getElementById('yidian-note-edit')?.click()").catch(() => undefined);
    openLibraryWindow();
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await captureScreenshots();
    // 配对窗是置顶的，放最后开：不然它会盖住收藏库，那张就抓不到了
    startPairing();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await captureWindow(pairWindow, 'pair');
    app.exit(0);
    return;
  }

  app.on('activate', () => {
    if (!petWindow || petWindow.isDestroyed()) ensurePetWindow();
  });
});

app.on('window-all-closed', () => {
  // 托盘常驻：窗口全关也不退出。
});

app.on('will-quit', () => {
  clearInterval(schedulerTimer);
  clearInterval(roamTimer);
  globalShortcut.unregisterAll();
  bridge?.stop();
});

async function captureScreenshots() {
  await fs.mkdir(captureDir, { recursive: true });
  const targets = [
    ['pet', petWindow],
    ['card', cardWindow],
    ['library', libraryWindow],
  ];
  for (const [name, win] of targets) {
    if (!win || win.isDestroyed()) continue;
    await captureWindow(win, name);
  }
}

// capturePage 对「还没被合成过」的窗口会抛 UnknownVizError（后台窗口、大窗口更容易中）。
// 这里亮出来 + 强制重绘 + 重试，直到拿到非空画面。
async function captureWindow(win, name) {
  const file = path.join(captureDir, `yidian-desktop-${name}.png`);
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      if (win.webContents.isLoading()) {
        await new Promise((resolve) => {
          win.webContents.once('did-finish-load', resolve);
          setTimeout(resolve, 4000);
        });
      }
      if (!win.isVisible()) win.showInactive();
      win.focus();
      win.moveTop?.();
      try { win.webContents.invalidate?.(); } catch { /* 老版本没这 API */ }
      await new Promise((resolve) => setTimeout(resolve, 600 + attempt * 400));
      const image = await win.webContents.capturePage();
      if (!image || image.isEmpty()) throw new Error('画面为空');
      await fs.writeFile(file, image.toPNG());
      log(`[截图] ${file}`);
      return true;
    } catch (error) {
      lastError = error;
      const bounds = win.getBounds?.();
      log(`[截图] ${name} 第 ${attempt} 次失败：${error?.message ?? error}（可见=${win.isVisible?.()} 载入中=${win.webContents?.isLoading?.()} 位置=${bounds ? `${bounds.width}x${bounds.height}@${bounds.x},${bounds.y}` : '?'}）`);
      // 抓不到时把窗口挪到屏幕左上角并缩小：窗口超出可见区域时 Chromium 给不出可抓的画面
      if (attempt === 2) {
        try {
          win.setBounds({ x: 40, y: 40, width: 900, height: 680 });
          win.show();
        } catch { /* 挪不动就下轮再说 */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }
  log(`[截图] ${name} 放弃：${lastError?.message ?? lastError}`);
  return false;
}
