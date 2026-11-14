import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../extension/domain.mjs';

function chromeMock({ failWrites = 0 } = {}) {
  const local = {};
  const calls = { alarmCreates: [], alarmClears: [], badges: [] };
  const listeners = {};
  let writeFailures = failWrites;
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return typeof key === 'string' ? { [key]: structuredClone(local[key]) } : structuredClone(local);
        },
        async set(values) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          if (writeFailures > 0) { writeFailures -= 1; throw new Error('storage unavailable'); }
          Object.assign(local, structuredClone(values));
        },
      },
      onChanged: { addListener(fn) { listeners.storage = fn; } },
    },
    alarms: {
      async clear(name) { calls.alarmClears.push(name); return true; },
      async create(name, options) { calls.alarmCreates.push({ name, options }); },
      onAlarm: { addListener(fn) { listeners.alarm = fn; } },
    },
    action: {
      async setBadgeBackgroundColor(value) { calls.badges.push(['color', value]); },
      async setBadgeText(value) { calls.badges.push(['text', value]); },
      async setTitle(value) { calls.badges.push(['title', value]); },
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
      async create() {},
    },
    scripting: {
      async insertCSS() {},
      async executeScript() { return [{ result: true }]; },
    },
  };
  return { local, calls, listeners };
}

async function loadWorker(tag) {
  return import(`../extension/service-worker.mjs?${tag}=${Date.now()}-${Math.random()}`);
}

function seedRecord(title, url, overrides = {}) {
  const record = createRecord({ title, url, now: 1_000 });
  return { ...record, ...overrides };
}

const grownRecord = (title, url, updatedAt = 2_000) => seedRecord(title, url, {
  stage: 4, nextReviewAt: null, completedAt: 2_000, updatedAt,
});

test('归档把已完成记录整体移入 archivedRecords，进行中记录留在收藏库', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('archive-grown');
  state.local.records = [grownRecord('长成的', 'https://a.example/1'), seedRecord('还在路上', 'https://b.example/1')];
  const result = await handleMessage({ type: 'archive-grown' });
  assert.equal(result.ok, true);
  assert.equal(result.archived, 1);
  assert.deepEqual(state.local.records.map((record) => record.title), ['还在路上']);
  assert.deepEqual(state.local.archivedRecords.map((record) => record.title), ['长成的']);
  const again = await handleMessage({ type: 'archive-grown' });
  assert.equal(again.archived, 0);
  assert.equal(state.local.archivedRecords.length, 1, '重复归档不产生重复条目');
});

test('归档写入失败时不先从收藏库移除记录', async () => {
  const state = chromeMock({ failWrites: 1 });
  const { handleMessage } = await loadWorker('archive-atomic');
  state.local.records = [grownRecord('仍在收藏库', 'https://safe.example/1')];
  await assert.rejects(handleMessage({ type: 'archive-grown' }), /无法保存本地记录/);
  assert.equal(state.local.records.length, 1);
  assert.equal(state.local.archivedRecords, undefined);
});

test('不再需要写入失败时仍保留正在回看的记录', async () => {
  const state = chromeMock({ failWrites: 1 });
  const { handleMessage } = await loadWorker('retire-atomic');
  const record = seedRecord('仍要保留', 'https://safe.example/2', { nextReviewAt: 0 });
  state.local.records = [record];
  await assert.rejects(handleMessage({ type: 'decide-review', normalizedUrl: record.normalizedUrl, choice: 'retire' }), /无法保存本地记录/);
  assert.equal(state.local.records.length, 1);
  assert.equal(state.local.archivedRecords, undefined);
});

test('导入旧备份不会让较新的不再需要选择重新开始提醒', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('retired-import');
  const old = seedRecord('旧备份', 'https://safe.example/3', { nextReviewAt: 0 });
  state.local.records = [old];
  await handleMessage({ type: 'decide-review', normalizedUrl: old.normalizedUrl, choice: 'retire' });
  await handleMessage({ type: 'import-records', records: [old] });
  assert.equal(state.local.records.length, 0);
  assert.equal(state.local.archivedRecords.length, 1);
  await handleMessage({ type: 'import-records', records: [{ title: old.title, url: old.url, stage: 1 }] });
  assert.equal(state.local.records.length, 0, '缺少旧时间字段的备份也不能覆盖较新的归档');
  const newer = { ...old, updatedAt: Date.now() + 1_000 };
  await handleMessage({ type: 'import-records', records: [newer] });
  assert.equal(state.local.records.length, 1);
  assert.equal(state.local.archivedRecords.length, 0);
});

test('升级时无法读取的旧归档也保留在备份中', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('archive-unreadable');
  state.local.archivedRecords = { oldFormat: true };
  await state.listeners.installed();
  assert.deepEqual(state.local.archivedRecords, []);
  assert.deepEqual(state.local.unreadableRecords, [
    { source: 'archivedRecords', record: { oldFormat: true } },
  ]);
  const backup = await handleMessage({ type: 'export-backup' });
  assert.deepEqual(backup.archived, []);
  assert.deepEqual(backup.unreadable, state.local.unreadableRecords);
});

test('归档默认不出现在收藏库列表，已归档按最近更新时间排序', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('archive-list');
  state.local.records = [seedRecord('进行中', 'https://b.example/1')];
  state.local.archivedRecords = [
    grownRecord('旧的', 'https://old.example/1', 1_500),
    grownRecord('新的', 'https://new.example/1', 3_000),
  ];
  const list = await handleMessage({ type: 'list-records' });
  assert.deepEqual(list.records.map((record) => record.title), ['进行中']);
  const archived = await handleMessage({ type: 'list-archived' });
  assert.deepEqual(archived.records.map((record) => record.title), ['新的', '旧的']);
});

test('恢复把归档记录带回收藏库，同一网页已有记录时拒绝', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('archive-restore');
  const archived = grownRecord('回来的', 'https://back.example/1');
  state.local.archivedRecords = [archived];
  state.local.records = [];
  const restored = await handleMessage({ type: 'restore-record', normalizedUrl: archived.normalizedUrl });
  assert.equal(restored.ok, true);
  assert.deepEqual(state.local.records.map((record) => record.title), ['回来的']);
  assert.deepEqual(state.local.archivedRecords, []);
  state.local.archivedRecords = [grownRecord('冲突的', 'https://back.example/1')];
  const conflict = await handleMessage({ type: 'restore-record', normalizedUrl: archived.normalizedUrl });
  assert.equal(conflict.ok, false);
  assert.equal(state.local.records.length, 1, '冲突时不写入收藏库');
  assert.equal(state.local.archivedRecords.length, 1, '冲突时不删除归档');
  const missing = await handleMessage({ type: 'restore-record', normalizedUrl: 'no-such' });
  assert.equal(missing.ok, false);
});

test('导入兼容带归档的 v2 备份，归档与收藏库各自合并', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('archive-import');
  state.local.records = [seedRecord('原有', 'https://keep.example/1')];
  const result = await handleMessage({
    type: 'import-records',
    records: [grownRecord('带回的活跃', 'https://active.example/1')],
    archived: [grownRecord('带回的归档', 'https://archived.example/1')],
  });
  assert.equal(result.ok, true);
  assert.equal(result.imported, 2);
  assert.equal(state.local.records.length, 2);
  assert.deepEqual(state.local.archivedRecords.map((record) => record.title), ['带回的归档']);
});

test('旧备份没有归档字段时导入行为不变', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('archive-import-legacy');
  const result = await handleMessage({
    type: 'import-records',
    records: [seedRecord('旧格式', 'https://legacy.example/1')],
  });
  assert.equal(result.ok, true);
  assert.equal(result.imported, 1);
  assert.deepEqual(state.local.archivedRecords ?? [], []);
});

test('归档部分包含无效记录时整批拒绝且不覆盖现有数据', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('archive-import-invalid');
  state.local.records = [seedRecord('原有', 'https://keep.example/1')];
  state.local.archivedRecords = [grownRecord('原归档', 'https://old.example/1')];
  // 与 runtime onMessage 入口一致：handleMessage 拒绝时抛错，由外层捕获回包
  await assert.rejects(
    handleMessage({
      type: 'import-records',
      records: [seedRecord('看起来正常', 'https://fine.example/1')],
      archived: [{ stage: 99, url: 'https://bad.example/1', title: '坏数据' }],
    }),
    /备份中的进度无效/,
  );
  assert.equal(state.local.records.length, 1, '无效归档不污染收藏库');
  assert.equal(state.local.archivedRecords.length, 1);
});
