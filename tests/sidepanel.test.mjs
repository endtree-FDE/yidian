import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRecord, normalizeUrl } from '../extension/domain.mjs';

const ids = [
  'progress-card', 'progress-text', 'meter-fill', 'source',
  'document-title', 'status-copy', 'excerpt', 'next-review', 'primary-action',
  'retry', 'open-extensions', 'manage', 'url-input', 'save-url', 'delete-record',
  'live-status', 'reduced-motion',
];
let importSequence = 0;

function harnessElement(id) {
  const listeners = new Map();
  return {
    dataset: {},
    style: {},
    hidden: ['progress-card', 'primary-action', 'retry', 'open-extensions', 'manage'].includes(id),
    checked: false,
    disabled: false,
    textContent: '',
    value: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type) { return listeners.get(type)?.(); },
  };
}

async function loadPanel({
  context = null,
  records = [],
  settings = { reducedMotion: false },
  sendMessage,
} = {}) {
  const elements = Object.fromEntries(ids.map((id) => [id, harnessElement(id)]));
  const state = { context, records, settings };
  const defaultSendMessage = async (message) => {
    if (message.type === 'get-pet-state') {
      const normalized = normalizeUrl(message.page.canonicalUrl || message.page.url);
      const record = state.records.find((item) => item.normalizedUrl === normalized) ?? null;
      return { ok: true, record, settings: state.settings };
    }
    if (message.type === 'get-settings') return { ok: true, settings: state.settings };
    throw new Error('Unexpected mutation');
  };

  globalThis.document = {
    documentElement: { dataset: {} },
    getElementById(id) { return elements[id]; },
  };
  globalThis.chrome = {
    windows: { getCurrent: async () => ({ id: 7 }) },
    storage: {
      session: { get: async (key) => ({ [key]: state.context }) },
      onChanged: { addListener() {} },
    },
    runtime: { sendMessage: sendMessage ?? defaultSendMessage },
    tabs: { create() {} },
  };

  importSequence += 1;
  await import(`../extension/sidepanel.mjs?test=${importSequence}`);
  return { elements, state };
}

const page = { title: '想见的一页', url: 'https://example.com/doc' };
const now = Date.now();

test('四态面板：未收下时先显示当前页动作和四步进度', async () => {
  const { elements } = await loadPanel({ context: { mode: 'current', page } });
  assert.equal(elements['document-title'].textContent, '想见的一页');
  assert.equal(elements['progress-text'].textContent, '0/4');
  assert.equal(elements['progress-card'].hidden, false);
  assert.equal(elements['primary-action'].textContent, '收下这条');
  assert.equal(elements['primary-action'].hidden, false);
  assert.equal(elements.manage.hidden, true, '未收下时不显示管理区');
  assert.equal(elements.retry.hidden, true);
  assert.equal(elements['open-extensions'].hidden, true);
});

test('四态面板：等待回看时显示下次时间且不催促', async () => {
  const record = { ...createRecord({ title: page.title, url: page.url, now }), excerpt: '当初收下它的那一段' };
  const { elements } = await loadPanel({ context: { mode: 'current', page }, records: [record] });
  assert.equal(elements['progress-text'].textContent, '1/4');
  assert.match(elements['next-review'].textContent, /下次回看：/);
  assert.equal(elements['primary-action'].hidden, true, '等待期不提供动作');
  assert.match(elements['status-copy'].textContent, /等待下一次回看/);
  assert.equal(elements.excerpt.textContent, '“当初收下它的那一段”', '回看前先见选段');
  assert.equal(elements.excerpt.hidden, false);
});

test('四态面板：没有选段时不显示选段块', async () => {
  const record = createRecord({ title: page.title, url: page.url, now });
  const { elements } = await loadPanel({ context: { mode: 'current', page }, records: [record] });
  assert.equal(elements.excerpt.textContent, '');
  assert.equal(elements.excerpt.hidden, true);
});

test('四态面板：到期时给出明确的完成动作', async () => {
  const record = { ...createRecord({ title: page.title, url: page.url, now }), nextReviewAt: now - 1000 };
  const { elements } = await loadPanel({ context: { mode: 'current', page }, records: [record] });
  assert.equal(elements['primary-action'].textContent, '完成这次回看');
  assert.equal(elements['primary-action'].hidden, false);
  assert.match(elements['status-copy'].textContent, /已到回看时间/);
});

test('四态面板：完成后进度满格且不再提醒', async () => {
  const record = {
    ...createRecord({ title: page.title, url: page.url, now }),
    stage: 4, nextReviewAt: null, completedAt: now,
  };
  const { elements } = await loadPanel({ context: { mode: 'current', page }, records: [record] });
  assert.equal(elements['progress-text'].textContent, '4/4');
  assert.equal(elements['meter-fill'].style.width, '100%');
  assert.match(elements['status-copy'].textContent, /三次回看已完成/);
  assert.equal(elements['primary-action'].hidden, true);
});

test('非普通网页上下文提示去普通网页呼出', async () => {
  const { elements } = await loadPanel({ context: { mode: 'current', page: null } });
  assert.match(elements['status-copy'].textContent, /请先打开普通网页/);
  assert.equal(elements['primary-action'].hidden, true);
  assert.equal(elements['progress-card'].hidden, true);
});

test('后台连接失败时不留空白占位，重试后恢复当前页状态', async () => {
  let calls = 0;
  const { elements } = await loadPanel({
    context: { mode: 'current', page },
    sendMessage: async () => {
      calls += 1;
      if (calls === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
      return { ok: true, record: null, settings: { reducedMotion: false } };
    },
  });
  assert.equal(elements['document-title'].textContent, '暂时读不到收藏');
  assert.match(elements['status-copy'].textContent, /刷新“一点”后重试/);
  assert.equal(elements['primary-action'].hidden, true);
  assert.equal(elements.retry.hidden, false);
  assert.equal(elements['open-extensions'].hidden, false);
  await elements.retry.dispatch('click');
  assert.equal(elements['document-title'].textContent, page.title);
  assert.equal(elements.retry.hidden, true);
  assert.equal(elements['open-extensions'].hidden, true);
});

test('reduced-motion 设置同步到根节点，面板不发网络请求', async () => {
  const { elements } = await loadPanel({
    context: { mode: 'current', page },
    settings: { reducedMotion: true },
  });
  assert.equal(elements['reduced-motion'].checked, true);
  assert.equal(globalThis.document.documentElement.dataset.reducedMotion, 'true');

  const [html, script, style] = await Promise.all([
    readFile(new URL('../extension/sidepanel.html', import.meta.url), 'utf8'),
    readFile(new URL('../extension/sidepanel.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../extension/sidepanel.css', import.meta.url), 'utf8'),
  ]);
  const bundle = `${html}\n${script}\n${style}`;
  assert.doesNotMatch(bundle, /https?:\/\//, '侧边栏不引用任何远程资源');
  assert.doesNotMatch(bundle, /fetch\(|XMLHttpRequest/);
  assert.match(style, /prefers-reduced-motion/);
  assert.match(style, /data-reduced-motion="true"/);
  assert.doesNotMatch(html, /id="pet"/);
  assert.match(html, /收下 1 次 · 第 2、7、30 天各回看 1 次/);
  assert.match(html, /href="library\.html"[^>]*>全部收藏<\/a>/);
});

test('快捷键 open-side-panel 写入当前页上下文并打开侧边栏', async () => {
  const session = {};
  const calls = { panelOpens: [] };
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return typeof key === 'string' ? { [key]: undefined } : {}; },
        async set() {},
      },
      session: { async set(values) { Object.assign(session, values); } },
      onChanged: { addListener() {} },
    },
    alarms: { async clear() { return true; }, async create() {}, onAlarm: { addListener() {} } },
    action: {
      async setBadgeBackgroundColor() {}, async setBadgeText() {}, async setTitle() {},
      onClicked: { addListener() {} },
    },
    runtime: {
      getURL(path) { return `edge-extension://test/${path}`; },
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
    },
    commands: { onCommand: { addListener() {} } },
    tabs: { onUpdated: { addListener() {} }, async query() { return []; }, async sendMessage() {}, async create() {} },
    scripting: { async insertCSS() {}, async executeScript() { return [{ result: true }]; } },
    sidePanel: { async open(options) { calls.panelOpens.push(options); } },
  };
  importSequence += 1;
  const { handleCommand } = await import(`../extension/service-worker.mjs?panel-cmd=${importSequence}`);
  await handleCommand('open-side-panel', { id: 3, windowId: 5, title: '当前页', url: 'https://a.example/doc' });
  const context = session['entryContext:5'];
  assert.equal(context.mode, 'current');
  assert.deepEqual(context.page, { title: '当前页', url: 'https://a.example/doc' });
  assert.equal(typeof context.openedAt, 'number');
  assert.deepEqual(calls.panelOpens, [{ windowId: 5 }]);
});
