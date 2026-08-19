import { isDue, MAX_STAGE } from './domain.mjs';

const elements = Object.fromEntries(
  [
    'mode-label', 'pet', 'progress-text', 'meter-fill', 'source',
    'document-title', 'status-copy', 'excerpt', 'next-review', 'primary-action',
    'open-original', 'manage', 'url-input', 'save-url', 'delete-record',
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

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '操作失败，请重试');
  return response;
}

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
  model = { page, record, settings, name: stateName(record) };
  render();
}

function setVisible(element, visible) {
  element.hidden = !visible;
}

function render() {
  const { page, record, settings, name } = model;
  const stage = record?.stage ?? 0;

  elements.pet.dataset.stage = String(stage);
  elements['progress-text'].textContent =
    stage === 0 ? '还没有开始' : `${stage * 25}% · 第 ${stage} 次见面`;
  elements['meter-fill'].style.width = `${stage * 25}%`;
  elements.source.textContent = record?.sourceDomain ?? '';
  elements['document-title'].textContent =
    page?.title || record?.title || '这里还不能收下';
  elements['reduced-motion'].checked = Boolean(settings.reducedMotion);
  document.documentElement.dataset.reducedMotion = settings.reducedMotion ? 'true' : 'false';
  setVisible(elements.manage, Boolean(record));
  setVisible(elements['open-original'], Boolean(record || page));

  if (!page && !record) {
    elements['status-copy'].textContent = '请在普通网页中打开侧边栏，一点才能看见它。';
    elements['next-review'].textContent = '';
    setVisible(elements['primary-action'], false);
    return;
  }

  elements['url-input'].value = record?.url ?? page?.url ?? '';

  const views = {
    unmarked: {
      copy: '今天愿意见它一面吗？收下来，一点会替你记得再见它。',
      next: '',
      action: '收下这条',
    },
    waiting: {
      copy: '不用惦记，一点会在合适的时候轻轻提醒你。',
      next: record
        ? `下次回看：${reviewTime.format(new Date(record.nextReviewAt))}`
        : '',
      action: '',
    },
    due: {
      copy: '它没有迟到，也没有催你。现在想再见它一面吗？',
      next: '',
      action: '见一面',
    },
    grown: {
      copy: '三次回看已经完成。它长成了，不再自动提醒。',
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
    elements['live-status'].textContent = error.message;
    return null;
  } finally {
    busy = false;
    elements['primary-action'].disabled = false;
  }
}

elements['primary-action'].addEventListener('click', async () => {
  if (model.name === 'unmarked') {
    const response = await mutate({ type: 'mark-current', tab: model.page });
    if (response?.created) elements['live-status'].textContent = '收下了。第 2 天一点会带它回来。';
  } else if (model.name === 'due') {
    const response = await mutate({ type: 'complete-review', normalizedUrl: model.record.normalizedUrl });
    if (response?.changed) elements['live-status'].textContent = '这次见面记下了。';
  }
});

elements['open-original'].addEventListener('click', () => {
  const url = model.record?.url ?? model.page?.url;
  if (url) chrome.tabs.create({ url });
});

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
  loadModel();
});

await loadModel();
