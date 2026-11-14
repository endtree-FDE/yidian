import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../extension/domain.mjs';

function chromeMock() {
  const local = {};
  const calls = { notifications: [], clears: [], opened: [] };
  const listeners = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return typeof key === 'string' ? { [key]: structuredClone(local[key]) } : structuredClone(local);
        },
        async set(values) { Object.assign(local, structuredClone(values)); },
      },
      onChanged: { addListener(fn) { listeners.storage = fn; } },
    },
    alarms: {
      async clear() { return true; },
      async create() {},
      onAlarm: { addListener(fn) { listeners.alarm = fn; } },
    },
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText() {},
      async setTitle() {},
      onClicked: { addListener(fn) { listeners.action = fn; } },
    },
    runtime: {
      getURL(path) { return `edge-extension://test/${path}`; },
      onMessage: { addListener(fn) { listeners.message = fn; } },
      onInstalled: { addListener(fn) { listeners.installed = fn; } },
      onStartup: { addListener(fn) { listeners.startup = fn; } },
    },
    commands: { onCommand: { addListener(fn) { listeners.command = fn; } } },
    tabs: {
      onUpdated: { addListener(fn) { listeners.tabUpdated = fn; } },
      async query() { return []; },
      async sendMessage() { return { ok: true }; },
      async create(options) { calls.opened.push(options); },
    },
    scripting: {
      async insertCSS() {},
      async executeScript() { return [{ result: true }]; },
    },
    notifications: {
      async create(id, options) { calls.notifications.push({ id, options }); },
      async clear(id) { calls.clears.push(id); return true; },
      onClicked: { addListener(fn) { listeners.notificationClicked = fn; } },
    },
  };
  return { local, calls, listeners };
}

async function loadWorker(tag) {
  return import(`../extension/service-worker.mjs?${tag}=${Date.now()}-${Math.random()}`);
}

// 固定用东八区墙钟构造时间戳，与 core-sync 测试保持一致
function at(hour, minute) {
  return Date.UTC(2026, 7, 18, hour - 8, minute);
}

function dueRecord(title, url, now) {
  return { ...createRecord({ title, url, now }), nextReviewAt: now - 1000 };
}

test('开启提醒且不在免打扰时段时，通知用记录标题和统一文案', async () => {
  const state = chromeMock();
  const { maybeNotifyDue } = await loadWorker('notify-copy');
  const now = at(12, 0);
  state.local.settings = { notifyOnDue: true };
  const record = dueRecord('想见的一篇笔记', 'https://note.example/1', now);
  await maybeNotifyDue([record], now);
  assert.equal(state.calls.notifications.length, 1);
  assert.equal(state.calls.notifications[0].options.title, '想见的一篇笔记');
  assert.equal(state.calls.notifications[0].options.message, '一点想再见它一面。');
});

test('默认免打扰 22:00-08:00 内静默跳过，白天正常提醒', async () => {
  const state = chromeMock();
  const { maybeNotifyDue } = await loadWorker('notify-quiet');
  state.local.settings = { notifyOnDue: true };
  const nightNow = at(3, 0);
  const record = dueRecord('深夜到期的收藏', 'https://night.example/1', nightNow);
  await maybeNotifyDue([record], nightNow);
  assert.equal(state.calls.notifications.length, 0, '免打扰时段不发通知');
  await maybeNotifyDue([record], at(12, 0));
  assert.equal(state.calls.notifications.length, 1);
});

test('提醒关闭或没有到期记录时不发通知', async () => {
  const state = chromeMock();
  const { maybeNotifyDue } = await loadWorker('notify-off');
  const now = at(12, 0);
  state.local.settings = { notifyOnDue: false };
  await maybeNotifyDue([dueRecord('安静的收藏', 'https://quiet.example/1', now)], now);
  assert.equal(state.calls.notifications.length, 0);
  state.local.settings = { notifyOnDue: true, quietHours: { enabled: false, start: '00:00', end: '23:59' } };
  const future = { ...createRecord({ title: '还没到期', url: 'https://future.example/1', now }), nextReviewAt: now + 86_400_000 };
  await maybeNotifyDue([future], now);
  assert.equal(state.calls.notifications.length, 0);
});

test('多条到期时发一条计数 digest，点击进收藏库，且当天不重复发', async () => {
  const state = chromeMock();
  const { maybeNotifyDue } = await loadWorker('notify-digest');
  const now = at(12, 0);
  state.local.settings = { notifyOnDue: true };
  const records = [
    dueRecord('第一篇', 'https://note.example/a', now),
    dueRecord('第二篇', 'https://note.example/b', now),
  ];
  await maybeNotifyDue(records, now);
  assert.equal(state.calls.notifications.length, 1);
  assert.equal(state.calls.notifications[0].options.title, '一点');
  assert.equal(state.calls.notifications[0].options.message, '今天有 2 位老朋友想见你。');
  await maybeNotifyDue(records, now + 3_600_000);
  assert.equal(state.calls.notifications.length, 1, '同一天多条到期只发一条 digest');
  state.listeners.notificationClicked();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(state.calls.opened, [{ url: 'edge-extension://test/library.html' }]);
});

test('点击通知直达原网页，并清掉这条通知', async () => {
  const state = chromeMock();
  const { maybeNotifyDue } = await loadWorker('notify-click');
  const now = at(12, 0);
  state.local.settings = { notifyOnDue: true };
  await maybeNotifyDue([dueRecord('点开就见', 'https://open.example/1', now)], now);
  state.listeners.notificationClicked();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(state.calls.opened, [{ url: 'https://open.example/1' }]);
  assert.deepEqual(state.calls.clears, ['yidian-due']);
});

test('set-quiet-hours 归一化时段并持久化，get-settings 带回默认值', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('notify-settings');
  const saved = await handleMessage({ type: 'set-quiet-hours', value: { enabled: true, start: '23:30', end: '7:00' } });
  assert.deepEqual(saved.settings.quietHours, { enabled: true, start: '23:30', end: '7:00' });
  const current = await handleMessage({ type: 'get-settings' });
  assert.deepEqual(current.settings.quietHours, { enabled: true, start: '23:30', end: '7:00' });
  const fresh = chromeMock();
  void fresh;
  const { handleMessage: freshHandle } = await loadWorker('notify-settings-default');
  const defaults = await freshHandle({ type: 'get-settings' });
  assert.deepEqual(defaults.settings.quietHours, { enabled: true, start: '22:00', end: '08:00' });
});
