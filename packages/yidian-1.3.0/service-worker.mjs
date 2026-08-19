import {
  addEncounter, advanceRecord, canAddEncounter, consolidateRecords, createRecord, dayKeyFor, inQuietHours, isDue, MAX_STAGE,
  mergeByKey, normalizeImportedRecord, normalizeQuietHours, normalizeUrl, quietEndAt, restartRecord, selectNextDue, updateRecordUrl
} from './domain.mjs';

const RECORDS_KEY = 'records';
const ARCHIVED_KEY = 'archivedRecords';
const SETTINGS_KEY = 'settings';
const DIGEST_DAY_KEY = 'lastDigestDay';
const REVIEW_ALARM = 'yidian-next-review';
const QUIET_END_ALARM = 'yidian-quiet-end';
const LEGACY_REVIEW_ALARM = '12730-next-review';
const DUE_NOTIFICATION_ID = 'yidian-due';
const DUE_BADGE_COLOR = '#28735F';
const DEFAULT_ACTION_TITLE = '打开一点｜收下或回看当前内容';
const UNAVAILABLE_BADGE_COLOR = '#8A5200';

export function createSerialQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

const enqueueBadgeRefresh = createSerialQueue();
const enqueueRecordsMutation = createSerialQueue();

async function getRawRecords() {
  return (await chrome.storage.local.get(RECORDS_KEY))[RECORDS_KEY] ?? [];
}

async function getRecords() {
  return consolidateRecords(await getRawRecords()).records;
}

async function saveRecords(records) {
  await chrome.storage.local.set({ [RECORDS_KEY]: records });
}

async function getArchivedRecords() {
  const archived = (await chrome.storage.local.get(ARCHIVED_KEY))[ARCHIVED_KEY];
  return Array.isArray(archived) ? archived : [];
}

async function saveArchivedRecords(archived) {
  await chrome.storage.local.set({ [ARCHIVED_KEY]: archived });
}

async function getSettings() {
  const raw = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  const candidate = raw && typeof raw === 'object' ? raw : {};
  return {
    reducedMotion: Boolean(candidate.reducedMotion),
    notifyOnDue: Boolean(candidate.notifyOnDue),
    quietHours: normalizeQuietHours(candidate.quietHours),
  };
}

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

export async function scheduleNext(records = null, now = Date.now()) {
  const currentRecords = records ?? await getRecords();
  const next = currentRecords
    .filter((record) => Number.isFinite(record.nextReviewAt) && record.nextReviewAt > now)
    .toSorted((a, b) => a.nextReviewAt - b.nextReviewAt)[0];
  if (next) {
    await chrome.alarms.create(REVIEW_ALARM, { when: next.nextReviewAt });
  } else {
    await chrome.alarms.clear(REVIEW_ALARM);
  }
}

export async function refreshBadge(records = null, now = Date.now()) {
  const currentRecords = records ?? await getRecords();
  const dueCount = currentRecords.filter((record) => isDue(record, now)).length;
  await chrome.action.setBadgeBackgroundColor({ color: DUE_BADGE_COLOR });
  await chrome.action.setBadgeText({ text: dueCount > 9 ? '9+' : String(dueCount || '') });
  await chrome.action.setTitle({ title: dueCount ? `有 ${dueCount} 份收藏想见你` : '打开一点' });
}

function requestBadgeRefresh(records = null) {
  return enqueueBadgeRefresh(() => refreshBadge(records)).catch((error) => console.warn('yidian badge refresh failed', error));
}

async function syncDerivedState(records) {
  await scheduleNext(records).catch((error) => console.warn('yidian alarm scheduling failed', error));
  await requestBadgeRefresh(records);
}

// 到期提醒：默认关闭，用户在“我的收藏”里手动开启。用固定 id 重复创建即更新，避免刷屏。
// 免打扰时段内静默跳过：记录保持到期状态，并在静默结束时刻排一个补发闹钟；
// 浏览器重新启动时 onStartup 也会补判定。
// digest 口径：多条到期时每天只发一条计数通知（按北京墙钟分日、落盘去重，
// SW 重启不丢），点击进收藏库；单条才直达原网页。
let lastNotifiedRecord = null;
let lastNotifiedMany = false;

export async function maybeNotifyDue(records = null, now = Date.now()) {
  const settings = await getSettings();
  if (!settings.notifyOnDue) return;
  if (inQuietHours(settings.quietHours, now)) {
    const quietEnd = quietEndAt(settings.quietHours, now);
    if (quietEnd != null) await chrome.alarms.create(QUIET_END_ALARM, { when: quietEnd });
    return;
  }
  const currentRecords = records ?? await getRecords();
  const dueRecords = currentRecords.filter((record) => isDue(record, now));
  if (!dueRecords.length) return;
  const many = dueRecords.length > 1;
  const day = dayKeyFor(now);
  if (many) {
    const storedDay = (await chrome.storage.local.get(DIGEST_DAY_KEY))[DIGEST_DAY_KEY];
    if (storedDay === day) return;
    await chrome.storage.local.set({ [DIGEST_DAY_KEY]: day });
  }
  const record = selectNextDue(currentRecords);
  lastNotifiedRecord = many ? null : record;
  lastNotifiedMany = many;
  await chrome.notifications.create(DUE_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: many ? '一点' : record.title,
    message: many
      ? `今天有 ${dueRecords.length} 位老朋友想见你。`
      : '一点想再见它一面。',
  }).catch((error) => console.warn('yidian notification failed', error));
}

function openNotifiedRecord() {
  const record = lastNotifiedRecord;
  const many = lastNotifiedMany;
  lastNotifiedRecord = null;
  lastNotifiedMany = false;
  chrome.notifications?.clear(DUE_NOTIFICATION_ID).catch(() => undefined);
  const url = !many && record && isWebUrl(record.url) ? record.url : chrome.runtime.getURL('library.html');
  return chrome.tabs.create({ url }).catch(() => undefined);
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
    chrome.action.setBadgeBackgroundColor({ tabId, color: DUE_BADGE_COLOR }),
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
  await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'refresh-pet' })));
}

async function markCurrent(tab) {
  return enqueueRecordsMutation(async () => {
    const records = await getRecords();
    const incoming = createRecord({ title: tab.title, url: tab.url, canonicalUrl: tab.canonicalUrl, excerpt: tab.excerpt });
    const pageNormalized = normalizeUrl(tab.url);
    const aliases = new Set([incoming.normalizedUrl, pageNormalized]);
    const created = !records.some((item) => aliases.has(item.normalizedUrl));
    let record = incoming;
    let next = [...records, incoming];
    let encountered = false;
    if (!created) {
      const promoted = records.map((item) => aliases.has(item.normalizedUrl) ? {
        ...item,
        canonicalUrl: incoming.canonicalUrl || item.canonicalUrl || '',
        normalizedUrl: incoming.normalizedUrl,
      } : item);
      next = consolidateRecords(promoted).records;
      const index = next.findIndex((item) => item.normalizedUrl === incoming.normalizedUrl);
      record = next[index];
      if (canAddEncounter(record)) {
        record = addEncounter(record, { excerpt: tab.excerpt });
        next = next.with(index, record);
        encountered = true;
      }
    }
    await saveRecords(next);
    await syncDerivedState(next);
    await refreshInjectedPets().catch(() => undefined);
    return { ok: true, created, encountered, alreadySaved: !created && !encountered, record };
  });
}

async function completeReview(normalizedUrl) {
  return enqueueRecordsMutation(async () => {
    const records = await getRecords();
    const index = records.findIndex((record) => record.normalizedUrl === normalizedUrl);
    if (index < 0) return { ok: false, error: '记录不存在' };
    const result = advanceRecord(records[index]);
    if (!result.changed) return { ok: true, changed: false, reason: result.reason, record: result.record };
    const next = records.with(index, result.record);
    await saveRecords(next);
    await syncDerivedState(next);
    await refreshInjectedPets().catch(() => undefined);
    return { ok: true, changed: true, record: result.record };
  });
}

async function removeRecord(normalizedUrl) {
  return enqueueRecordsMutation(async () => {
    const records = await getRecords();
    const next = records.filter((record) => record.normalizedUrl !== normalizedUrl);
    if (next.length !== records.length) await saveRecords(next);
    await syncDerivedState(next);
    await refreshInjectedPets().catch(() => undefined);
    return { ok: true, removed: next.length !== records.length };
  });
}

async function changeUrl(normalizedUrl, url) {
  return enqueueRecordsMutation(async () => {
    const records = await getRecords();
    const index = records.findIndex((record) => record.normalizedUrl === normalizedUrl);
    if (index < 0) return { ok: false, error: '记录不存在' };
    const normalized = normalizeUrl(url);
    if (records.some((record, i) => i !== index && record.normalizedUrl === normalized)) {
      return { ok: false, error: '这个 URL 已有记录' };
    }
    const next = records.with(index, updateRecordUrl(records[index], url));
    await saveRecords(next);
    await syncDerivedState(next);
    await refreshInjectedPets().catch(() => undefined);
    return { ok: true, record: next[index] };
  });
}

// 归档已完成：把 stage 4 的记录整体移入 archivedRecords，收藏库默认不再显示。
async function archiveGrown() {
  return enqueueRecordsMutation(async () => {
    const records = await getRecords();
    const grown = records.filter((record) => record.stage === MAX_STAGE);
    if (!grown.length) return { ok: true, archived: 0, remaining: records.length };
    const remaining = records.filter((record) => record.stage !== MAX_STAGE);
    const merged = new Map((await getArchivedRecords()).map((record) => [record.normalizedUrl, record]));
    for (const record of grown) {
      const existing = merged.get(record.normalizedUrl);
      if (!existing || record.updatedAt >= existing.updatedAt) merged.set(record.normalizedUrl, record);
    }
    await saveRecords(remaining);
    await saveArchivedRecords([...merged.values()]);
    await syncDerivedState(remaining);
    return { ok: true, archived: grown.length, remaining: remaining.length };
  });
}

async function restoreArchived(normalizedUrl) {
  return enqueueRecordsMutation(async () => {
    const archived = await getArchivedRecords();
    const index = archived.findIndex((record) => record.normalizedUrl === normalizedUrl);
    if (index < 0) return { ok: false, error: '归档里没有这条记录' };
    const records = await getRecords();
    if (records.some((record) => record.normalizedUrl === normalizedUrl)) {
      return { ok: false, error: '收藏库里已有同一网页的记录' };
    }
    const next = consolidateRecords([...records, archived[index]]).records;
    await saveRecords(next);
    await saveArchivedRecords(archived.filter((_, i) => i !== index));
    await syncDerivedState(next);
    await refreshInjectedPets().catch(() => undefined);
    return { ok: true, record: archived[index] };
  });
}

async function importRecords(rawRecords, rawArchived) {
  if (!Array.isArray(rawRecords) || rawRecords.length > 5000) throw new TypeError('请选择有效的一点备份文件');
  const archivedList = rawArchived == null ? [] : rawArchived;
  if (!Array.isArray(archivedList) || archivedList.length > 5000) throw new TypeError('请选择有效的一点备份文件');
  const incoming = rawRecords.map((record) => normalizeImportedRecord(record));
  const incomingArchived = archivedList.map((record) => normalizeImportedRecord(record));
  return enqueueRecordsMutation(async () => {
    const records = consolidateRecords(mergeByKey(await getRecords(), incoming)).records;
    const archived = mergeByKey(await getArchivedRecords(), incomingArchived);
    await saveRecords(records);
    await saveArchivedRecords(archived);
    await syncDerivedState(records);
    await refreshInjectedPets().catch(() => undefined);
    return { ok: true, imported: incoming.length + incomingArchived.length, total: records.length };
  });
}

async function setReducedMotion(value) {
  const settings = { ...(await getSettings()), reducedMotion: Boolean(value) };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return { ok: true, settings };
}

async function setNotifyOnDue(value) {
  const settings = { ...(await getSettings()), notifyOnDue: Boolean(value) };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  if (!settings.notifyOnDue) {
    await chrome.notifications.clear(DUE_NOTIFICATION_ID).catch(() => undefined);
    await chrome.alarms.clear(QUIET_END_ALARM).catch(() => undefined);
  }
  return { ok: true, settings };
}

async function setQuietHours(value) {
  const settings = { ...(await getSettings()), quietHours: normalizeQuietHours(value) };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return { ok: true, settings };
}

export async function handleMessage(message) {
  if (!message || typeof message !== 'object') return { ok: false, error: '无效操作' };
  if (message.type === 'get-pet-state') {
    const [records, settings] = await Promise.all([getRecords(), getSettings()]);
    const normalized = normalizeUrl(message.page.canonicalUrl || message.page.url);
    const currentRecord = records.find((item) => item.normalizedUrl === normalized) ?? null;
    const dueRecord = selectNextDue(records);
    const reviewMode = message.mode === 'review';
    const record = reviewMode ? (dueRecord ?? currentRecord) : currentRecord;
    return {
      ok: true, record, currentRecord, dueRecord,
      isDue: Boolean(reviewMode && dueRecord),
      canEncounter: Boolean(currentRecord && canAddEncounter(currentRecord)),
      settings,
    };
  }
  if (message.type === 'list-records') {
    const records = (await getRecords()).toSorted((a, b) => {
      const aTime = a.stage === MAX_STAGE ? Infinity : a.nextReviewAt;
      const bTime = b.stage === MAX_STAGE ? Infinity : b.nextReviewAt;
      return aTime - bTime || b.updatedAt - a.updatedAt;
    });
    return { ok: true, records };
  }
  if (message.type === 'list-archived') {
    const records = (await getArchivedRecords()).toSorted((a, b) => b.updatedAt - a.updatedAt);
    return { ok: true, records };
  }
  if (message.type === 'open-library') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
    return { ok: true };
  }
  if (message.type === 'open-record') {
    if (!isWebUrl(message.url)) return { ok: false, error: '仅支持 http:// 或 https:// 链接' };
    await chrome.tabs.create({ url: message.url });
    return { ok: true };
  }
  if (message.type === 'mark-current') return markCurrent(message.tab);
  if (message.type === 'complete-review') return completeReview(message.normalizedUrl);
  if (message.type === 'restart-journey') return restartJourney(message.normalizedUrl);
  if (message.type === 'remove-record') return removeRecord(message.normalizedUrl);
  if (message.type === 'change-url') return changeUrl(message.normalizedUrl, message.url);
  if (message.type === 'archive-grown') return archiveGrown();
  if (message.type === 'restore-record') return restoreArchived(message.normalizedUrl);
  if (message.type === 'set-reduced-motion') return setReducedMotion(message.value);
  if (message.type === 'get-settings') return { ok: true, settings: await getSettings() };
  if (message.type === 'set-notify-on-due') return setNotifyOnDue(message.value);
  if (message.type === 'set-quiet-hours') return setQuietHours(message.value);
  if (message.type === 'import-records') return importRecords(message.records, message.archived);
  return { ok: false, error: '未知操作' };
}

async function handleToolbarClick(tab) {
  const records = await getRecords();
  await showPetOnTab(tab, selectNextDue(records) ? 'review' : 'current');
}

// 侧边栏入口：快捷键 open-side-panel。把当前页上下文写进 session 存储，
// 让侧边栏知道该看哪一页；sidePanel.open 必须留在用户手势调用栈里。
async function openSidePanel(tab) {
  if (!Number.isInteger(tab?.windowId)) return;
  const page = tab.url && isWebUrl(tab.url) ? { title: tab.title ?? '', url: tab.url } : null;
  await chrome.storage.session.set({
    [`entryContext:${tab.windowId}`]: { mode: 'current', page, openedAt: Date.now() },
  });
  await chrome.sidePanel.open({ windowId: tab.windowId });
}

export async function handleCommand(command, tab) {
  if (command === 'open-current-document') {
    await showPetOnTab(tab, 'current');
    return;
  }
  if (command === 'open-side-panel') await openSidePanel(tab);
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message || '操作失败，请重试' }));
    return true;
  });
  chrome.runtime.onInstalled.addListener(async () => {
    await chrome.alarms.clear(LEGACY_REVIEW_ALARM); // 清理 1.0.x 时代的旧闹钟名
    const migration = await migrateStoredRecords();
    await syncDerivedState(migration.records);
  });
  chrome.runtime.onStartup.addListener(async () => {
    const migration = await migrateStoredRecords();
    await syncDerivedState(migration.records);
    await maybeNotifyDue(migration.records).catch(() => undefined);
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REVIEW_ALARM || alarm.name === QUIET_END_ALARM) {
      syncDerivedState()
        .then(() => maybeNotifyDue())
        .catch(console.error);
    }
  });
  chrome.notifications?.onClicked.addListener(() => {
    openNotifiedRecord();
  });
  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === 'local') requestBadgeRefresh();
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') clearTabInjectionError(tabId);
  });
  chrome.action.onClicked.addListener((tab) => {
    handleToolbarClick(tab).catch((error) => console.warn('yidian pet injection failed', error));
  });
  chrome.commands.onCommand.addListener((command, tab) => {
    handleCommand(command, tab).catch((error) => console.warn('yidian shortcut injection failed', error));
  });
}
async function migrateStoredRecords() {
  return enqueueRecordsMutation(async () => {
    const result = consolidateRecords(await getRawRecords());
    if (result.changed) await saveRecords(result.records);
    return result;
  });
}
async function restartJourney(normalizedUrl) {
  return enqueueRecordsMutation(async () => {
    const records = await getRecords();
    const index = records.findIndex((record) => record.normalizedUrl === normalizedUrl);
    if (index < 0) return { ok: false, error: '\u8bb0\u5f55\u4e0d\u5b58\u5728' };
    const record = restartRecord(records[index]);
    const next = records.with(index, record);
    await saveRecords(next);
    await syncDerivedState(next);
    await refreshInjectedPets().catch(() => undefined);
    return { ok: true, record };
  });
}
