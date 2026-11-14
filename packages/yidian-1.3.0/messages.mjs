// 一点 · 核心消息层（平台无关）
//
// 这一份是产品的语义所在：收下、回看、归档、导入、设置、到期提醒。
// 扩展（Chromium）、桌面端（Electron）、将来的手机端都只是「适配器」——
// 把 platform 里的几个能力接到自己平台上，然后共用这里的同一份逻辑。
//
// platform 接口：
//   storage:        { get(keys), set(values) }        —— chrome.storage.local 语义
//   openUrl(url):   打开一个网页
//   openLibrary():  打开收藏库
//   notify(id, options) / clearNotification(id)
//   setAlarm(name, info) / clearAlarm(name)
//   setBadge({ text, title })?   可选：工具栏角标（桌面端不需要）
//   now():          可选：时间源（默认 Date.now）
import {
  addEncounter, advanceRecord, canAddEncounter, consolidateRecords, createRecord, dayKeyFor, inQuietHours, isDue, MAX_STAGE,
  mergeByKey, mergeContent, normalizeImportedRecord, normalizeQuietHours, normalizeUrl, quietEndAt, restartRecord, selectNextDue, setNote, updateRecordUrl
} from './domain.mjs';

export const RECORDS_KEY = 'records';
export const ARCHIVED_KEY = 'archivedRecords';
export const SETTINGS_KEY = 'settings';
export const DIGEST_DAY_KEY = 'lastDigestDay';
export const REVIEW_ALARM = 'yidian-next-review';
export const QUIET_END_ALARM = 'yidian-quiet-end';
export const DUE_NOTIFICATION_ID = 'yidian-due';
export const DUE_BADGE_COLOR = '#28735F';

export function createSerialQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export function isWebUrl(rawUrl) {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function createMessageLayer(platform) {
  const {
    storage,
    openUrl = async () => undefined,
    openLibrary = async () => undefined,
    notify = async () => undefined,
    clearNotification = async () => undefined,
    setAlarm = async () => undefined,
    clearAlarm = async () => undefined,
    setBadge = async () => undefined,
    onRecordsChanged = () => undefined,
    now = () => Date.now(),
  } = platform ?? {};

  if (!storage) throw new Error('缺少 storage：核心消息层需要一个 chrome.storage.local 语义的存储');

  const enqueueBadgeRefresh = createSerialQueue();
  const enqueueRecordsMutation = createSerialQueue();

  /* ---------------------------------------------------------- 存储 */

  async function getRawRecords() {
    return (await storage.get(RECORDS_KEY))[RECORDS_KEY] ?? [];
  }

  async function getRecords() {
    return consolidateRecords(await getRawRecords()).records;
  }

  async function saveRecords(records) {
    try {
      await storage.set({ [RECORDS_KEY]: records });
    } catch (error) {
      console.error('[一点] 保存收藏失败', error);
      throw new Error('本地存储空间不足，请导出备份后清理部分记录');
    }
    onRecordsChanged();
  }

  async function getArchivedRecords() {
    const archived = (await storage.get(ARCHIVED_KEY))[ARCHIVED_KEY];
    const list = Array.isArray(archived) ? archived : [];
    return consolidateRecords(list).records;
  }

  async function saveArchivedRecords(archived) {
    try {
      await storage.set({ [ARCHIVED_KEY]: archived });
    } catch (error) {
      console.error('[一点] 保存归档失败', error);
      throw new Error('本地存储空间不足，请导出备份后清理部分记录');
    }
    onRecordsChanged();
  }

  async function getSettings() {
    const raw = (await storage.get(SETTINGS_KEY))[SETTINGS_KEY];
    const candidate = raw && typeof raw === 'object' ? raw : {};
    return {
      reducedMotion: Boolean(candidate.reducedMotion),
      notifyOnDue: Boolean(candidate.notifyOnDue),
      quietHours: normalizeQuietHours(candidate.quietHours),
    };
  }

  /* ---------------------------------------------------------- 派生状态 */

  async function scheduleNext(records = null, at = now()) {
    const currentRecords = records ?? await getRecords();
    const next = currentRecords
      .filter((record) => Number.isFinite(record.nextReviewAt) && record.nextReviewAt > at)
      .toSorted((a, b) => a.nextReviewAt - b.nextReviewAt)[0];
    if (next) {
      await setAlarm(REVIEW_ALARM, { when: next.nextReviewAt });
    } else {
      await clearAlarm(REVIEW_ALARM);
    }
  }

  async function refreshBadge(records = null, at = now()) {
    const currentRecords = records ?? await getRecords();
    const dueCount = currentRecords.filter((record) => isDue(record, at)).length;
    await setBadge({ text: dueCount > 9 ? '9+' : String(dueCount || ''), title: dueCount ? `有 ${dueCount} 份收藏想见你` : '打开一点' });
  }

  function requestBadgeRefresh(records = null) {
    return enqueueBadgeRefresh(() => refreshBadge(records)).catch((error) => console.warn('yidian badge refresh failed', error));
  }

  async function syncDerivedState(records) {
    await scheduleNext(records).catch((error) => console.warn('yidian alarm scheduling failed', error));
    await requestBadgeRefresh(records);
  }

  /* ---------------------------------------------------------- 到期提醒 */

  // 到期提醒：默认关闭，用户在「我的收藏」里手动开启。
  // 免打扰时段内静默跳过，记录保持到期状态，并在静默结束时刻排一个补发闹钟。
  // digest 口径：多条到期时每天只发一条计数通知（按北京墙钟分日、落盘去重）。
  let lastNotifiedRecord = null;
  let lastNotifiedMany = false;

  async function maybeNotifyDue(records = null, at = now()) {
    const settings = await getSettings();
    if (!settings.notifyOnDue) return;
    if (inQuietHours(settings.quietHours, at)) {
      const quietEnd = quietEndAt(settings.quietHours, at);
      if (quietEnd != null) await setAlarm(QUIET_END_ALARM, { when: quietEnd });
      return;
    }
    const currentRecords = records ?? await getRecords();
    const dueRecords = currentRecords.filter((record) => isDue(record, at));
    if (!dueRecords.length) return;
    const many = dueRecords.length > 1;
    const day = dayKeyFor(at);
    if (many) {
      const storedDay = (await storage.get(DIGEST_DAY_KEY))[DIGEST_DAY_KEY];
      if (storedDay === day) return;
      await storage.set({ [DIGEST_DAY_KEY]: day });
    }
    const record = selectNextDue(currentRecords, at);
    lastNotifiedRecord = many ? null : record;
    lastNotifiedMany = many;
    // 通知正文带内容本身：你的话 > 你选的段落 > 页面那句描述。
    // 成熟产品（Readwise 的每日邮件、Raindrop 的提醒）都这么做 ——
    // 被叫回来的那一刻就该把内容递到眼前，而不是只给一个标题。
    const line = many ? '' : String(record?.note || record?.excerpt || record?.summary || '').trim();
    const preview = line.length > 120 ? `${line.slice(0, 119)}…` : line;
    await notify(DUE_NOTIFICATION_ID, {
      type: 'basic',
      title: many ? '一点' : record.title,
      message: many ? `今天有 ${dueRecords.length} 位老朋友想见你。` : (preview || '一点想再见它一面。'),
    }).catch((error) => console.warn('yidian notification failed', error));
  }

  async function openNotifiedRecord() {
    const record = lastNotifiedRecord;
    const many = lastNotifiedMany;
    lastNotifiedRecord = null;
    lastNotifiedMany = false;
    await clearNotification(DUE_NOTIFICATION_ID);
    if (!many && record && isWebUrl(record.url)) await openUrl(record.url);
    else await openLibrary();
  }

  /* ---------------------------------------------------------- 记录变更 */

  async function markCurrent(tab) {
    return enqueueRecordsMutation(async () => {
      const records = await getRecords();
      const incoming = createRecord({
        title: tab.title,
        url: tab.url,
        canonicalUrl: tab.canonicalUrl,
        excerpt: tab.excerpt,
        summary: tab.summary,
        now: now(),
      });
      const pageNormalized = normalizeUrl(tab.url);
      const aliases = new Set([incoming.normalizedUrl, pageNormalized]);
      const created = !records.some((item) => aliases.has(item.normalizedUrl));
      let record = incoming;
      let next = [...records, incoming];
      let encountered = false;
      if (!created) {
        const promoted = records.map((item) => aliases.has(item.normalizedUrl) ? {
          ...mergeContent(item, incoming),
          canonicalUrl: incoming.canonicalUrl || item.canonicalUrl || '',
          normalizedUrl: incoming.normalizedUrl,
        } : item);
        next = consolidateRecords(promoted).records;
        const index = next.findIndex((item) => item.normalizedUrl === incoming.normalizedUrl);
        record = next[index];
        // 内容（标题 / 描述 / 选段）不受冷却限制，先补上；冷却只管「足迹」记不记。
        record = mergeContent(record, incoming);
        if (canAddEncounter(record, now())) {
          record = addEncounter(record, { excerpt: tab.excerpt, summary: tab.summary, now: now() });
          next = next.with(index, record);
          encountered = true;
        }
      }
      await saveRecords(next);
      await syncDerivedState(next);
      return { ok: true, created, encountered, alreadySaved: !created && !encountered, record };
    });
  }

  async function completeReview(normalizedUrl) {
    return enqueueRecordsMutation(async () => {
      const records = await getRecords();
      const index = records.findIndex((record) => record.normalizedUrl === normalizedUrl);
      if (index < 0) return { ok: false, error: '记录不存在' };
      const result = advanceRecord(records[index], now());
      if (!result.changed) return { ok: true, changed: false, reason: result.reason, record: result.record };
      const next = records.with(index, result.record);
      await saveRecords(next);
      await syncDerivedState(next);
      return { ok: true, changed: true, record: result.record };
    });
  }

  async function removeRecord(normalizedUrl) {
    return enqueueRecordsMutation(async () => {
      const records = await getRecords();
      const archived = await getArchivedRecords();
      const nextRecords = records.filter((record) => record.normalizedUrl !== normalizedUrl);
      const nextArchived = archived.filter((record) => record.normalizedUrl !== normalizedUrl);
      const removedFromRecords = nextRecords.length !== records.length;
      const removedFromArchived = nextArchived.length !== archived.length;
      if (!removedFromRecords && !removedFromArchived) {
        return { ok: false, error: '记录不存在，可能已被删除' };
      }
      if (removedFromRecords) await saveRecords(nextRecords);
      if (removedFromArchived) await saveArchivedRecords(nextArchived);
      await syncDerivedState(nextRecords);
      return { ok: true, removed: true, fromArchived: removedFromArchived };
    });
  }

  // 写一句批注：你自己写的那句（「这条对我意味着什么」）。
  // 空字符串就是清除。归档里的记录也能写 —— 归档只是收起来，不是扔掉。
  async function writeNote(normalizedUrl, note) {
    return enqueueRecordsMutation(async () => {
      const records = await getRecords();
      const archived = await getArchivedRecords();
      const inRecords = records.findIndex((record) => record.normalizedUrl === normalizedUrl);
      const inArchived = archived.findIndex((record) => record.normalizedUrl === normalizedUrl);
      if (inRecords < 0 && inArchived < 0) return { ok: false, error: '记录不存在' };
      if (inRecords >= 0) {
        const next = records.with(inRecords, setNote(records[inRecords], note, now()));
        await saveRecords(next);
        await syncDerivedState(next);
        return { ok: true, record: next[inRecords] };
      }
      const nextArchived = archived.with(inArchived, setNote(archived[inArchived], note, now()));
      await saveArchivedRecords(nextArchived);
      return { ok: true, record: nextArchived[inArchived] };
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
      const next = records.with(index, updateRecordUrl(records[index], url, now()));
      await saveRecords(next);
      await syncDerivedState(next);
      return { ok: true, record: next[index] };
    });
  }

  // 归档已完成：把 stage 4 的记录整体移入归档，收藏库默认不再显示。
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
      return { ok: true, record: archived[index] };
    });
  }

  async function importRecords(rawRecords, rawArchived) {
    if (!Array.isArray(rawRecords) || rawRecords.length > 5000) throw new TypeError('请选择有效的一点备份文件');
    const archivedList = rawArchived == null ? [] : rawArchived;
    if (!Array.isArray(archivedList) || archivedList.length > 5000) throw new TypeError('请选择有效的一点备份文件');
    const incoming = rawRecords.map((record) => normalizeImportedRecord(record, now()));
    const incomingArchived = archivedList.map((record) => normalizeImportedRecord(record, now()));
    return enqueueRecordsMutation(async () => {
      const records = consolidateRecords(mergeByKey(await getRecords(), incoming)).records;
      const archived = consolidateRecords(mergeByKey(await getArchivedRecords(), incomingArchived)).records;
      await saveRecords(records);
      await saveArchivedRecords(archived);
      await syncDerivedState(records);
      return { ok: true, imported: incoming.length + incomingArchived.length, total: records.length };
    });
  }

  async function restartJourney(normalizedUrl) {
    return enqueueRecordsMutation(async () => {
      const records = await getRecords();
      const index = records.findIndex((record) => record.normalizedUrl === normalizedUrl);
      if (index < 0) return { ok: false, error: '记录不存在' };
      const record = restartRecord(records[index], now());
      const next = records.with(index, record);
      await saveRecords(next);
      await syncDerivedState(next);
      return { ok: true, record };
    });
  }

  /* ---------------------------------------------------------- 设置 */

  async function setReducedMotion(value) {
    const settings = { ...(await getSettings()), reducedMotion: Boolean(value) };
    await storage.set({ [SETTINGS_KEY]: settings });
    return { ok: true, settings };
  }

  async function setNotifyOnDue(value) {
    const settings = { ...(await getSettings()), notifyOnDue: Boolean(value) };
    await storage.set({ [SETTINGS_KEY]: settings });
    if (!settings.notifyOnDue) {
      await clearNotification(DUE_NOTIFICATION_ID);
      await clearAlarm(QUIET_END_ALARM);
    }
    return { ok: true, settings };
  }

  async function setQuietHours(value) {
    const settings = { ...(await getSettings()), quietHours: normalizeQuietHours(value) };
    await storage.set({ [SETTINGS_KEY]: settings });
    return { ok: true, settings };
  }

  /* ---------------------------------------------------------- 消息入口 */

  async function handleMessage(message) {
    if (!message || typeof message !== 'object') return { ok: false, error: '无效操作' };
    if (message.type === 'get-pet-state') {
      const [records, settings] = await Promise.all([getRecords(), getSettings()]);
      let normalized;
      try {
        normalized = normalizeUrl(message.page.canonicalUrl || message.page.url);
      } catch {
        normalized = null;
      }
      const currentRecord = normalized ? records.find((item) => item.normalizedUrl === normalized) ?? null : null;
      const dueRecord = selectNextDue(records, now());
      const reviewMode = message.mode === 'review';
      const record = reviewMode ? (dueRecord ?? currentRecord) : currentRecord;
      return {
        ok: true, record, currentRecord, dueRecord,
        isDue: Boolean(reviewMode && dueRecord),
        canEncounter: Boolean(currentRecord && canAddEncounter(currentRecord, now())),
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
      await openLibrary();
      return { ok: true };
    }
    if (message.type === 'open-record') {
      if (!isWebUrl(message.url)) return { ok: false, error: '仅支持 http:// 或 https:// 链接' };
      await openUrl(message.url);
      return { ok: true };
    }
    if (message.type === 'mark-current') return markCurrent(message.tab);
    if (message.type === 'complete-review') return completeReview(message.normalizedUrl);
    if (message.type === 'restart-journey') return restartJourney(message.normalizedUrl);
    if (message.type === 'remove-record') return removeRecord(message.normalizedUrl);
    if (message.type === 'change-url') return changeUrl(message.normalizedUrl, message.url);
    if (message.type === 'set-note') return writeNote(message.normalizedUrl, message.note);
    if (message.type === 'archive-grown') return archiveGrown();
    if (message.type === 'restore-record') return restoreArchived(message.normalizedUrl);
    if (message.type === 'set-reduced-motion') return setReducedMotion(message.value);
    if (message.type === 'get-settings') return { ok: true, settings: await getSettings() };
    if (message.type === 'set-notify-on-due') return setNotifyOnDue(message.value);
    if (message.type === 'set-quiet-hours') return setQuietHours(message.value);
    if (message.type === 'import-records') return importRecords(message.records, message.archived);
    return { ok: false, error: '未知操作' };
  }

  return {
    handleMessage,
    maybeNotifyDue,
    scheduleNext,
    refreshBadge,
    syncDerivedState,
    openNotifiedRecord,
    getRecords,
    getArchivedRecords,
    getSettings,
    saveRecords,
    saveArchivedRecords,
  };
}
