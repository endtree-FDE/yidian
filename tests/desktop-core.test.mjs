// 桌面端核心测试：文件存储 + 平台适配器 + 核心消息层。
//
// 这里刻意不启动 Electron：桌面端跑的就是 packages/yidian-core/ 那份语义，
// 所以「桌面端行为」可以直接在 node 里验。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { JsonStore } from '../packages/yidian-desktop/core/store.mjs';
import { createDesktopPlatform } from '../packages/yidian-desktop/core/platform.mjs';
import { createMessageLayer } from '../packages/yidian-core/messages.mjs';
import * as domain from '../packages/yidian-core/domain.mjs';

async function makeStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yidian-desktop-'));
  return new JsonStore(path.join(dir, 'store.json'));
}

function makeLayer(store, hooks = {}) {
  const notifications = [];
  const opened = [];
  const platform = createDesktopPlatform({
    store,
    openExternal: async (url) => { opened.push(url); },
    openLibrary: async () => { hooks.openedLibrary?.(); },
    notify: async (id, options) => { notifications.push({ id, options }); },
    clearNotification: async () => {},
    onRecordsChanged: hooks.onRecordsChanged,
  });
  return { layer: createMessageLayer(platform), notifications, opened, platform };
}

test('文件存储对齐 chrome.storage.local 的读写语义', async () => {
  const store = await makeStore();
  assert.deepEqual(await store.get(null), {});
  assert.deepEqual(await store.get('records'), {});

  await store.set({ records: [{ normalizedUrl: 'a' }] });
  assert.deepEqual((await store.get('records')).records, [{ normalizedUrl: 'a' }]);
  assert.deepEqual(await store.get(['records', 'missing']), { records: [{ normalizedUrl: 'a' }] });
  assert.deepEqual(await store.get({ missing: '兜底' }), { missing: '兜底' });

  await store.set({ records: undefined });
  assert.deepEqual(await store.get('records'), {});

  await store.remove('records');
  assert.deepEqual(await store.get(null), {});
});

test('文件存储是原子写：中途不会留下半截 JSON', async () => {
  const store = await makeStore();
  await store.set({ records: [1, 2, 3], settings: { notifyOnDue: true } });
  const raw = await fs.readFile(store.file, 'utf8');
  assert.deepEqual(JSON.parse(raw), { records: [1, 2, 3], settings: { notifyOnDue: true } });
  const siblings = await fs.readdir(path.dirname(store.file));
  assert.ok(!siblings.some((name) => name.endsWith('.tmp')), '不该留下临时文件');
});

test('桌面端跑的是核心同一份语义：收下 → 列表 → 回看推进', async () => {
  const store = await makeStore();
  const { layer, opened } = makeLayer(store);

  const marked = await layer.handleMessage({
    type: 'mark-current',
    tab: { title: '桌面端测试文档', url: 'https://example.com/desktop-test', excerpt: '一段选段' },
  });
  assert.equal(marked.ok, true);
  assert.equal(marked.created, true);
  assert.equal(marked.record.stage, 1);

  const listed = await layer.handleMessage({ type: 'list-records' });
  assert.equal(listed.records.length, 1);
  assert.equal(listed.records[0].normalizedUrl, marked.record.normalizedUrl);

  // 还没到期，不该推进
  const early = await layer.handleMessage({ type: 'complete-review', normalizedUrl: marked.record.normalizedUrl });
  assert.equal(early.changed, false);
  assert.equal(early.record.stage, 1);

  // 把它挪到昨天，再推进
  const raw = await store.get('records');
  await store.set({ records: raw.records.map((record) => ({ ...record, nextReviewAt: Date.now() - 1000 })) });

  const advanced = await layer.handleMessage({ type: 'complete-review', normalizedUrl: marked.record.normalizedUrl });
  assert.equal(advanced.changed, true);
  assert.equal(advanced.record.stage, 2);

  // 幂等：再点一次不会多推一阶
  const again = await layer.handleMessage({ type: 'complete-review', normalizedUrl: marked.record.normalizedUrl });
  assert.equal(again.changed, false);
  assert.equal(again.record.stage, 2);

  // 打开原网页走系统浏览器
  await layer.handleMessage({ type: 'open-record', url: 'https://example.com/desktop-test' });
  assert.deepEqual(opened, ['https://example.com/desktop-test']);
});

test('桌面端与扩展按 updatedAt 合并：新的赢，旧的留不下多余进度', async () => {
  const store = await makeStore();
  const base = domain.createRecord({ title: '合并测试', url: 'https://example.com/merge', now: Date.now() - 86_400_000 });

  const newer = { ...base, stage: 3, updatedAt: Date.now() };
  const merged = domain.consolidateRecords(domain.mergeByKey([base], [newer])).records;
  assert.equal(merged.length, 1);
  assert.equal(merged[0].stage, 3, '更新的那条应该赢');

  const older = { ...base, stage: 1, updatedAt: base.updatedAt - 1000 };
  const merged2 = domain.consolidateRecords(domain.mergeByKey([base], [older])).records;
  assert.equal(merged2[0].stage, base.stage, '更旧的记录不该覆盖本地');
});

test('到期提醒：默认安静，开启后只提醒一次（多条按天去重）', async () => {
  const store = await makeStore();
  const { layer, notifications } = makeLayer(store);
  const due = domain.createRecord({ title: '到期了', url: 'https://example.com/due', now: Date.now() - 86_400_000 });
  await store.set({ records: [due] });

  // 默认不提醒
  await layer.maybeNotifyDue();
  assert.equal(notifications.length, 0);

  await store.set({ settings: { notifyOnDue: true, quietHours: { enabled: false, start: '23:00', end: '08:00' } } });
  await layer.maybeNotifyDue();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].options.title, '到期了');

  // 多条到期时按天去重：同一天不再刷第二条
  const second = domain.createRecord({ title: '也到期了', url: 'https://example.com/due2', now: Date.now() - 86_400_000 });
  await store.set({
    records: [due, second],
    settings: { notifyOnDue: true, quietHours: { enabled: false, start: '23:00', end: '08:00' } },
  });
  await layer.maybeNotifyDue();
  assert.equal(notifications.length, 2, '多条到期的第一条应该发出去');
  await layer.maybeNotifyDue();
  assert.equal(notifications.length, 2, '同一天不该反复提醒');
});

test('免打扰时段内不提醒', async () => {
  const store = await makeStore();
  const { layer, notifications } = makeLayer(store);
  const due = domain.createRecord({ title: '静默期', url: 'https://example.com/quiet', now: Date.now() - 86_400_000 });
  await store.set({ records: [due] });

  // 静默窗口取「当前这一小时」，时间口径与产品一致（Asia/Shanghai 墙钟）。
  // 注意不能拿 start === end：那是零长度窗口，等于「永不静默」。
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai',
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour').value) % 24;
  const nextHour = String((hour + 1) % 24).padStart(2, '0');
  await store.set({
    settings: {
      notifyOnDue: true,
      quietHours: { enabled: true, start: `${String(hour).padStart(2, '0')}:00`, end: `${nextHour}:00` },
    },
  });
  await layer.maybeNotifyDue();
  assert.equal(notifications.length, 0, '免打扰时段内不该响');
});

test('平台适配器：网页交给系统浏览器，收藏库交给应用内窗口', async () => {
  const store = await makeStore();
  let libraryOpened = 0;
  const { layer, opened } = makeLayer(store, { openedLibrary: () => { libraryOpened += 1; } });

  await layer.handleMessage({ type: 'open-record', url: 'https://example.com' });
  await layer.handleMessage({ type: 'open-library' });
  assert.deepEqual(opened, ['https://example.com']);
  assert.equal(libraryOpened, 1);
});

test('写一句批注：存得下，并且到期提醒的正文带的是这句话', async () => {
  const store = await makeStore();
  const { layer, notifications } = makeLayer(store);
  await layer.handleMessage({
    type: 'mark-current',
    tab: { title: '批注测试', url: 'https://example.com/note', excerpt: '页面选段' },
  });
  const [record] = await layer.getRecords();
  const saved = await layer.handleMessage({
    type: 'set-note',
    normalizedUrl: record.normalizedUrl,
    note: '这条是我要的配色',
  });
  assert.equal(saved.ok, true, '写批注应该成功');
  assert.equal(saved.record.note, '这条是我要的配色');
  const [after] = await layer.getRecords();
  assert.equal(after.note, '这条是我要的配色');

  // 到期提醒：正文带的是你写的那句，而不是一句气氛话
  await store.set({
    records: [{ ...after, stage: 1, nextReviewAt: Date.now() - 1000 }],
    settings: { notifyOnDue: true, quietHours: { enabled: false, start: '22:00', end: '08:00' } },
  });
  await layer.maybeNotifyDue();
  assert.equal(notifications.length, 1, '到期应该提醒一次');
  assert.equal(notifications[0].options.message, '这条是我要的配色');
});

test('写一句批注：没有内容时退回选段，再没有才回到那句气氛话', async () => {
  const store = await makeStore();
  const { layer, notifications } = makeLayer(store);
  await layer.handleMessage({
    type: 'mark-current',
    tab: { title: '退回测试', url: 'https://example.com/fallback', excerpt: '你选的那一段' },
  });
  await store.set({
    records: [{ ...(await layer.getRecords())[0], stage: 1, nextReviewAt: Date.now() - 1000 }],
    settings: { notifyOnDue: true, quietHours: { enabled: false, start: '22:00', end: '08:00' } },
  });
  await layer.maybeNotifyDue();
  assert.equal(notifications[0].options.message, '你选的那一段');
});

test('记录变更会通知平台（桌面端用它刷新界面）', async () => {
  const store = await makeStore();
  let changes = 0;
  const { layer } = makeLayer(store, { onRecordsChanged: () => { changes += 1; } });
  await layer.handleMessage({ type: 'mark-current', tab: { title: '变更通知', url: 'https://example.com/notify' } });
  assert.ok(changes >= 1, '存盘之后应该通知平台');
});

test('收下时带上一句描述，存进去也带得上', async () => {
  const store = await makeStore();
  const { layer } = makeLayer(store);
  await layer.handleMessage({
    type: 'mark-current',
    tab: { title: '如何把饭煮熟', url: 'https://example.com/rice', summary: '一篇讲怎么煮饭的文章。' },
  });
  const [record] = await layer.getRecords();
  assert.equal(record.title, '如何把饭煮熟');
  assert.equal(record.summary, '一篇讲怎么煮饭的文章。');
});

test('兜底标题的记录，事后拿到真标题会被顶上来', async () => {
  const store = await makeStore();
  const { layer } = makeLayer(store);
  // 第一次：桌面端没抓到页面信息，标题走兜底
  await layer.handleMessage({ type: 'mark-current', tab: { title: '', url: 'https://example.com/late' } });
  const [first] = await layer.getRecords();
  assert.match(first.title, /^example\.com · /);

  // 第二次：扩展在同一页面上拿到了真标题和描述
  await layer.handleMessage({
    type: 'mark-current',
    tab: { title: '真标题', url: 'https://example.com/late', summary: '一句描述' },
  });
  const [second] = await layer.getRecords();
  assert.equal(second.title, '真标题');
  assert.equal(second.summary, '一句描述');
  assert.equal(second.stage, first.stage, '内容补上不该动回看进度');
});
