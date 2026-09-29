import { isDue, MAX_STAGE } from './domain.mjs';
import { explainRuntimeError, openExtensions, send } from './runtime.mjs';

const elements = Object.fromEntries(
  [
    'progress-card', 'progress-text', 'meter-fill', 'source',
    'document-title', 'status-copy', 'excerpt', 'next-review', 'primary-action',
    'retry', 'open-extensions', 'manage', 'url-input', 'save-url', 'delete-record',
    'live-status', 'reduced-motion',
  ].map((id) => [id, document.getElementById(id)]),
);

const reviewTime = new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

let model = null;
let busy = false;
let loadRevision = 0;
const panelWindowId = (await chrome.windows.getCurrent()).id;
const entryKey = `entryContext:${panelWindowId}`;

async function readEntryContext() {
  const result = await chrome.storage.session.get(entryKey);
  return result[entryKey] ?? null;
}

function stateName(record, now = Date.now()) {
  if (!record) return 'unmarked';
  if (record.stage >= MAX_STAGE) return 'grown';
  return isDue(record, now) ? 'due' : 'waiting';
}

async function loadModel() {
  const revision = ++loadRevision;
  const context = await readEntryContext();
  const page = context?.page ?? null;
  let record = null;
  let settings;
  if (page) {
    const petState = await send({ type: 'get-pet-state', mode: 'current', page });
    record = petState.record;
    settings = petState.settings;
  } else {
    settings = (await send({ type: 'get-settings' })).settings;
  }
  if (revision !== loadRevision) return;
  model = { page, record, settings, tabId: context?.tabId ?? null, name: stateName(record) };
  elements.retry.hidden = true;
  elements['open-extensions'].hidden = true;
  elements['live-status'].textContent = '';
  render();
}

function setVisible(element, visible) {
  element.hidden = !visible;
}

function render() {
  const { page, record, settings, name } = model;
  const stage = record?.stage ?? 0;

  elements['progress-text'].textContent = `${stage}/4`;
  elements['meter-fill'].style.width = `${stage * 25}%`;
  setVisible(elements['progress-card'], Boolean(page));
  elements.source.textContent = record?.sourceDomain ?? (page?.url ? new URL(page.url).hostname : '');
  elements['document-title'].textContent =
    page?.title || record?.title || '请先打开一个网页';
  elements['reduced-motion'].checked = Boolean(settings.reducedMotion);
  document.documentElement.dataset.reducedMotion = settings.reducedMotion ? 'true' : 'false';
  setVisible(elements.manage, Boolean(record));

  if (!page && !record) {
    elements['status-copy'].textContent = '请先打开普通网页，再用快捷键打开侧边栏。';
    elements['next-review'].textContent = '';
    setVisible(elements['primary-action'], false);
    return;
  }

  elements['url-input'].value = record?.url ?? page?.url ?? '';

  const views = {
    unmarked: {
      copy: '这页还没收藏。收下后，第 2、7、30 天各回来一次。',
      next: '',
      action: '收下这条',
    },
    waiting: {
      copy: '已经收下，等待下一次回看。',
      next: record
        ? `下次回看：${reviewTime.format(new Date(record.nextReviewAt))}`
        : '',
      action: '',
    },
    due: {
      copy: '这页已到回看时间。看过后，可以完成这次回看。',
      next: '',
      action: '完成这次回看',
    },
    grown: {
      copy: '三次回看已完成，不再自动提醒。',
      next: '',
      action: '',
    },
  }[name];

  elements['status-copy'].textContent = views.copy;
  elements['next-review'].textContent = views.next;
  const excerptText = String(record?.excerpt || '').trim();
  elements.excerpt.textContent = excerptText ? `“${excerptText}”` : '';
  elements.excerpt.hidden = !excerptText;
  elements['primary-action'].textContent = views.action;
  setVisible(elements['primary-action'], Boolean(views.action));
}

function showLoadError(error) {
  model = null;
  elements.source.textContent = '';
  elements['document-title'].textContent = '暂时读不到收藏';
  elements['status-copy'].textContent = explainRuntimeError(error);
  elements['next-review'].textContent = '';
  setVisible(elements['progress-card'], false);
  setVisible(elements['primary-action'], false);
  setVisible(elements.manage, false);
  setVisible(elements.retry, true);
  setVisible(elements['open-extensions'], true);
}

function showStalePage(reason = 'tab-switch') {
  if (!model || (model.stale && reason !== 'navigation')) return;
  model.stale = true;
  model.staleReason = reason;
  elements['status-copy'].textContent = '页面已切换或重新加载。再按 Alt+Shift+Y 更新这里。';
  elements['next-review'].textContent = '';
  setVisible(elements['primary-action'], false);
  setVisible(elements['progress-card'], false);
  setVisible(elements.manage, false);
}

async function currentPageIsActive() {
  if (!Number.isInteger(model?.tabId)) return true;
  const [active] = await chrome.tabs.query({ active: true, windowId: panelWindowId });
  if (active?.id === model.tabId && !model.stale) return true;
  showStalePage();
  return false;
}

async function mutate(message) {
  if (busy) return null;
  busy = true;
  elements['primary-action'].disabled = true;
  elements['live-status'].textContent = '';
  try {
    const response = await send(message);
    await loadModel();
    return response;
  } catch (error) {
    elements['live-status'].textContent = explainRuntimeError(error);
    return null;
  } finally {
    busy = false;
    elements['primary-action'].disabled = false;
  }
}

elements['primary-action'].addEventListener('click', async () => {
  if (!await currentPageIsActive()) return;
  if (model.name === 'unmarked') {
    const response = await mutate({ type: 'mark-current', tab: model.page });
    if (response?.created) elements['live-status'].textContent = '收下了。第 2 天一点会带它回来。';
  } else if (model.name === 'due') {
    const response = await mutate({ type: 'complete-review', normalizedUrl: model.record.normalizedUrl });
    if (response?.changed) elements['live-status'].textContent = '这次见面记下了。';
  }
});

elements.retry.addEventListener('click', () => loadModel().catch(showLoadError));
elements['open-extensions'].addEventListener('click', () => openExtensions().catch(showLoadError));

elements['save-url'].addEventListener('click', async () => {
  await mutate({ type: 'change-url', normalizedUrl: model.record.normalizedUrl, url: elements['url-input'].value });
});

elements['delete-record'].addEventListener('click', async () => {
  if (!confirm('删除这条记录？已有进度无法恢复。')) return;
  await mutate({ type: 'remove-record', normalizedUrl: model.record.normalizedUrl });
});

elements['reduced-motion'].addEventListener('change', async () => {
  const response = await mutate({ type: 'set-reduced-motion', value: elements['reduced-motion'].checked });
  if (!response) {
    await loadModel();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'session' || !changes[entryKey]) return;
  loadModel().catch(showLoadError);
});
chrome.tabs.onActivated?.addListener(({ tabId, windowId }) => {
  if (windowId !== panelWindowId || !Number.isInteger(model?.tabId)) return;
  if (tabId === model.tabId) {
    if (model.staleReason === 'tab-switch') loadModel().catch(showLoadError);
  } else showStalePage();
});
chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (tabId === model?.tabId && (changeInfo.status === 'loading'
    || (changeInfo.url && changeInfo.url !== model.page?.url))) showStalePage('navigation');
});

await loadModel().catch(showLoadError);
