// 一点 · 扩展 Service Worker（Chromium 适配器）
//
// 业务语义都在 core/ 里（平台无关）。
// 这里只做三件事：
//   1) 把 chrome.* 接成核心要的 platform；
//   2) 注册浏览器独有的能力（工具栏角标、标签页注入、快捷键、侧边栏）；
//   3) 与桌面端的本地桥同步。
//
// 注意：扩展包被浏览器沙箱限制，只能 import 自己目录下的文件，
// 所以 core/ 的内容由 tools/sync-shared.mjs 同步进来（见 tests/core-sync.test.mjs）。
import { createMessageLayer, REVIEW_ALARM, QUIET_END_ALARM } from './messages.mjs';
import { consolidateRecords, mergeByKey, selectNextDue } from './domain.mjs';
import { createBridgeClient } from './bridge-client.mjs';

// 消息入口与提醒逻辑住在核心消息层里，这里原样转出去：
// 测试与外部脚本 import 这个文件时拿到的仍是同一份实现，不是第二套逻辑。
export { createSerialQueue } from './messages.mjs';

const LEGACY_REVIEW_ALARM = '12730-next-review';
const DESKTOP_SYNC_ALARM = 'yidian-desktop-sync';
const UNAVAILABLE_BADGE_COLOR = '#8A5200';
const DEFAULT_ACTION_TITLE = '打开一点｜收下或回看当前内容';

// chrome.* 一律延迟到调用时才取：这个文件会被测试直接 import，
// 那时全局还没有 chrome（浏览器里才有）。取不到就安静地什么都不做。
const chromeApi = () => globalThis.chrome;

const layer = createMessageLayer({
  storage: {
    get: (keys) => chromeApi().storage.local.get(keys),
    set: (values) => chromeApi().storage.local.set(values),
  },
  openUrl: (url) => chromeApi().tabs.create({ url }),
  openLibrary: () => chromeApi().tabs.create({ url: chromeApi().runtime.getURL('library.html') }),
  // 通知接口在某些环境（比如测试的精简 mock）里不存在：那就安静地不做，
  // 不能因为「没有通知权限」把整个回看流程带崩。
  notify: (id, options) => chromeApi().notifications?.create?.(id, options) ?? Promise.resolve(),
  clearNotification: (id) => chromeApi().notifications?.clear?.(id) ?? Promise.resolve(),
  setAlarm: (name, info) => chromeApi().alarms.create(name, info),
  clearAlarm: (name) => chromeApi().alarms.clear(name),
  setBadge: async ({ text, title }) => {
    await chromeApi().action.setBadgeBackgroundColor({ color: '#28735F' });
    await chromeApi().action.setBadgeText({ text: text ?? '' });
    await chromeApi().action.setTitle({ title: title ?? DEFAULT_ACTION_TITLE });
  },
  onRecordsChanged: () => { pushToDesktop().catch(() => undefined); },
});

export const { handleMessage, maybeNotifyDue, scheduleNext, refreshBadge } = layer;

/* ------------------------------------------------ 桌面端本地桥 */

// 桌面端（Electron）开着时它是权威源——扩展把记录推过去，并按分钟回拉一次状态。
// 桌面端不在时，桥的任何失败都静默吞掉，扩展行为完全不变。
//
// 业务请求要带配对后拿到的 token：token 存在扩展自己的 chrome.storage.local，
// 别的扩展读不到（沙箱隔离）。没配对就不推不拉，安静等着用户配对。
const bridgeTokenStore = {
  get: async () => {
    const raw = await chrome.storage.local.get('bridgeToken');
    return typeof raw?.bridgeToken === 'string' && raw.bridgeToken ? raw.bridgeToken : null;
  },
  set: async (token) => {
    if (token) await chrome.storage.local.set({ bridgeToken: token });
    else await chrome.storage.local.remove('bridgeToken');
  },
};

const desktopBridge = createBridgeClient({
  extensionId: globalThis.chrome?.runtime?.id,
  extensionName: globalThis.chrome?.runtime?.getManifest?.()?.name ?? '',
  tokenStore: bridgeTokenStore,
});
let suppressBridgePush = false;

async function pushToDesktop() {
  if (suppressBridgePush) return;
  try {
    const raw = await chrome.storage.local.get(['records', 'archivedRecords']);
    await desktopBridge.pushState({
      records: Array.isArray(raw?.records) ? raw.records : [],
      archived: Array.isArray(raw?.archivedRecords) ? raw.archivedRecords : [],
    });
  } catch (error) {
    console.warn('[一点] 桌面端桥接失败', error);
  }
}

/** 用户在扩展里输入桌面上显示的配对码。配对成功立刻把本地收藏推过去。 */
async function pairWithDesktop(code) {
  const result = await desktopBridge.pair(code);
  if (!result?.ok) return { ok: false, error: result?.error || '配对失败' };
  await pushToDesktop();
  return { ok: true };
}

function recordsFingerprint(records) {
  return records
    .map((record) => `${record.normalizedUrl}@${record.updatedAt}@${record.stage}`)
    .sort()
    .join('|');
}

async function syncFromDesktop() {
  if (suppressBridgePush) return false;
  try {
    const state = await desktopBridge.pullState();
    if (!state?.ok) return false;
    const localRecords = await layer.getRecords();
    const localArchived = await layer.getArchivedRecords();
    const mergedRecords = consolidateRecords(mergeByKey(localRecords, state.records ?? [])).records;
    const mergedArchived = consolidateRecords(mergeByKey(localArchived, state.archived ?? [])).records;
    if (recordsFingerprint(mergedRecords) === recordsFingerprint(localRecords)
      && recordsFingerprint(mergedArchived) === recordsFingerprint(localArchived)) {
      return true;
    }
    suppressBridgePush = true;
    try {
      await layer.saveRecords(mergedRecords);
      await layer.saveArchivedRecords(mergedArchived);
    } finally {
      suppressBridgePush = false;
    }
    await layer.syncDerivedState(mergedRecords);
    return true;
  } catch (error) {
    console.warn('[一点] 桌面端同步失败', error);
    return false;
  }
}

/* ------------------------------------------------ 浏览器独有能力 */

function isWebUrl(rawUrl) {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

async function currentTab(windowId = null) {
  const query = windowId == null ? { active: true, currentWindow: true } : { active: true, windowId };
  const [tab] = await chrome.tabs.query(query);
  if (!tab?.url || !isWebUrl(tab.url)) return null;
  return { id: tab.id, tabId: tab.id, windowId: tab.windowId, title: tab.title ?? '', url: tab.url };
}

function isMissingMessageReceiver(error) {
  const message = String(error?.message ?? error);
  return message.includes('Receiving end does not exist')
    || message.includes('Could not establish connection');
}

async function injectCurrentPet(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.getElementById('otter-yidian-root')?.remove(),
  });
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['pet.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['shared.js', 'pet.js'] });
}

async function setTabInjectionError(tabId) {
  if (!tabId) return;
  await Promise.allSettled([
    chrome.action.setBadgeBackgroundColor({ tabId, color: UNAVAILABLE_BADGE_COLOR }),
    chrome.action.setBadgeText({ tabId, text: '!' }),
    chrome.action.setTitle({ tabId, title: '请在普通网页中使用一点' }),
  ]);
}

async function clearTabInjectionError(tabId) {
  if (!tabId) return;
  await Promise.allSettled([
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#28735F' }),
    chrome.action.setBadgeText({ tabId, text: '' }),
    chrome.action.setTitle({ tabId, title: DEFAULT_ACTION_TITLE }),
  ]);
}

async function showPetOnTab(tab, mode = 'current') {
  if (!tab?.id || !tab?.url || !isWebUrl(tab.url)) {
    await setTabInjectionError(tab?.id);
    throw new Error('请在普通网页中使用一点');
  }
  const message = { type: 'show-pet', mode };
  try {
    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      if (!isMissingMessageReceiver(error)) throw error;
      await injectCurrentPet(tab.id);
      await chrome.tabs.sendMessage(tab.id, message);
    }
    await clearTabInjectionError(tab.id);
  } catch (error) {
    await setTabInjectionError(tab.id);
    throw error;
  }
}

async function refreshInjectedPets() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.filter((tab) => tab.id && isWebUrl(tab.url)).map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'refresh-pet' }))
  );
}

async function handleToolbarClick(tab) {
  await rememberPanelContext(tab).catch(() => undefined);
  const records = await layer.getRecords();
  await showPetOnTab(tab, selectNextDue(records) ? 'review' : 'current');
}

async function rememberPanelContext(tab) {
  if (!Number.isInteger(tab?.windowId)) return;
  const page = tab.url && isWebUrl(tab.url) ? { title: tab.title ?? '', url: tab.url } : null;
  await chrome.storage.session?.set({
    [`entryContext:${tab.windowId}`]: { mode: 'current', page, tabId: tab.id, openedAt: Date.now() },
  });
}

async function forgetPanelContext(tabId, tab) {
  if (!Number.isInteger(tab?.windowId) || !chrome.storage.session?.get) return;
  const key = `entryContext:${tab.windowId}`;
  const current = (await chrome.storage.session.get(key))[key];
  if (current?.tabId === tabId) await chrome.storage.session.remove(key);
}

// sidePanel.open 必须留在用户手势调用栈里。
async function openSidePanel(tab) {
  if (!Number.isInteger(tab?.windowId)) return;
  await rememberPanelContext(tab);
  await chrome.sidePanel.open({ windowId: tab.windowId });
}

export async function handleCommand(command, tab) {
  if (command === 'open-current-document') {
    await rememberPanelContext(tab).catch(() => undefined);
    await showPetOnTab(tab, 'current');
    return;
  }
  if (command === 'open-side-panel') await openSidePanel(tab);
}

async function migrateStoredRecords() {
  return layer.migrateCollections();
}

/* ------------------------------------------------ 注册浏览器事件 */

// 浏览器里才有 chrome。没有 chrome 的环境（比如测试直接 import 这个文件）
// 就安静地不注册任何监听——导入本身不该抛错。
if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'pair-desktop') {
      pairWithDesktop(message.code)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error?.message || '配对失败，请重试' }));
      return true;
    }
    if (message?.type === 'desktop-status') {
      (async () => {
        const online = await desktopBridge.isOnline();
        const paired = online ? await desktopBridge.isPaired() : false;
        sendResponse({ ok: true, online, paired });
      })().catch(() => sendResponse({ ok: false, online: false, paired: false }));
      return true;
    }
    layer.handleMessage(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message || '操作失败，请重试' }));
    return true;
  });

  chrome.runtime.onInstalled.addListener(async () => {
    await chrome.alarms.clear(LEGACY_REVIEW_ALARM); // 清理 1.0.x 时代的旧闹钟名
    await chrome.alarms.create(DESKTOP_SYNC_ALARM, { periodInMinutes: 1 });
    const migration = await migrateStoredRecords();
    await layer.syncDerivedState(migration.records);
    pushToDesktop().catch(() => undefined);
  });

  chrome.runtime.onStartup.addListener(async () => {
    await chrome.alarms.create(DESKTOP_SYNC_ALARM, { periodInMinutes: 1 });
    const migration = await migrateStoredRecords();
    await layer.syncDerivedState(migration.records);
    await layer.maybeNotifyDue(migration.records).catch(() => undefined);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REVIEW_ALARM || alarm.name === QUIET_END_ALARM) {
      layer.syncDerivedState()
        .then(() => layer.maybeNotifyDue())
        .catch(console.error);
    }
    if (alarm.name === DESKTOP_SYNC_ALARM) {
      syncFromDesktop().catch(() => undefined);
      // 心跳也推一次：桌面端刚装上时，扩展里攒的收藏要自动过去（一个心跳内，不靠用户操作）
      pushToDesktop().catch(() => undefined);
    }
  });

  chrome.notifications?.onClicked.addListener(() => {
    layer.openNotifiedRecord().catch(() => undefined);
  });

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === 'local') layer.refreshBadge().catch(() => undefined);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' || changeInfo.url) {
      clearTabInjectionError(tabId);
      // 页面换了，侧边栏记住的那个页面就过期了——别让它还指着旧页面。
      forgetPanelContext(tabId, tab).catch(() => undefined);
    }
  });

  chrome.action.onClicked.addListener((tab) => {
    handleToolbarClick(tab).catch((error) => console.warn('yidian pet injection failed', error));
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    handleCommand(command, tab).catch((error) => console.warn('yidian shortcut injection failed', error));
  });
}
