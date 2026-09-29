import test from 'node:test';
import assert from 'node:assert/strict';

function chromeMock({ failWrites = 0, missingReceiverOnce = false, injectionError = null } = {}) {
  const local = {};
  const calls = { alarmCreates: [], alarmClears: [], badges: [], insertedCss: [], scripts: [], messages: [], opened: [] };
  const listeners = {};
  let writeFailures = failWrites;
  let missingReceivers = missingReceiverOnce ? 1 : 0;
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
      async sendMessage(tabId, message) {
        calls.messages.push({ tabId, message });
        if (missingReceivers > 0) {
          missingReceivers -= 1;
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { ok: true };
      },
      async create(options) { calls.opened.push(options); },
    },
    scripting: {
      async insertCSS(options) { calls.insertedCss.push(options); },
      async executeScript(options) {
        calls.scripts.push(options);
        if (injectionError) throw injectionError;
        if (options.func) return [{ result: true }];
        return [{ result: true }];
      },
    },
  };
  return { local, calls, listeners };
}

async function loadWorker(tag) {
  return import(`../extension/service-worker.mjs?${tag}=${Date.now()}-${Math.random()}`);
}

const tabA = { id: 1, windowId: 1, title: 'A', url: 'https://a.example/doc' };
const tabB = { id: 2, windowId: 2, title: 'B', url: 'https://b.example/doc' };

test('alarm 只安排未来记录，到期记录只触发 badge', async () => {
  const state = chromeMock();
  const { scheduleNext, refreshBadge } = await loadWorker('alarm');
  const now = 10_000;
  const due = { stage: 1, nextReviewAt: now - 1, createdAt: 1 };
  const future = { stage: 1, nextReviewAt: now + 8_000, createdAt: 2 };
  await scheduleNext([due, future], now);
  assert.deepEqual(state.calls.alarmCreates, [{ name: 'yidian-next-review', options: { when: now + 8_000 } }]);
  assert.deepEqual(state.calls.alarmClears, []);
  await refreshBadge([due, future], now);
  assert.ok(state.calls.badges.some(([kind, value]) => kind === 'text' && value.text === '1'));
  assert.ok(state.calls.badges.some(([kind, value]) => kind === 'color' && value.color === '#28735F'));
});

test('到期数量超过九条时 badge 显示 9+', async () => {
  const state = chromeMock();
  const { refreshBadge } = await loadWorker('badge-count');
  const now = 10_000;
  const due = Array.from({ length: 11 }, (_, index) => ({ stage: 1, nextReviewAt: now - index, createdAt: index }));
  await refreshBadge(due, now);
  assert.ok(state.calls.badges.some(([kind, value]) => kind === 'text' && value.text === '9+'));
  assert.ok(state.calls.badges.some(([kind, value]) => kind === 'title' && value.title === '有 11 份收藏想见你'));
});

test('没有未来记录时才清除 alarm，不把到期记录改排到一秒后', async () => {
  const state = chromeMock();
  const { scheduleNext } = await loadWorker('alarm-clear');
  await scheduleNext([{ stage: 1, nextReviewAt: 5, createdAt: 1 }], 10);
  assert.deepEqual(state.calls.alarmCreates, []);
  assert.deepEqual(state.calls.alarmClears, ['yidian-next-review']);
});

test('并发 Mark A、B 完整串行读改写并保留两条记录', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('marks');
  const [a, b] = await Promise.all([
    handleMessage({ type: 'mark-current', tab: tabA }),
    handleMessage({ type: 'mark-current', tab: tabB }),
  ]);
  assert.equal(a.created, true);
  assert.equal(b.created, true);
  assert.deepEqual(state.local.records.map((record) => record.title).sort(), ['A', 'B']);
});

test('Mark 会把用户主动选择的文本写入本地记录', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('mark-excerpt');
  const result = await handleMessage({ type: 'mark-current', tab: { ...tabA, excerpt: '关键段落' } });
  assert.equal(result.record.excerpt, '关键段落');
  assert.equal(state.local.records[0].excerpt, '关键段落');
});

test('刚刚重复 Mark 只确认已保存，不新增偶遇', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('immediate-repeat-mark');
  await handleMessage({ type: 'mark-current', tab: tabA });
  const before = structuredClone(state.local.records[0]);
  const result = await handleMessage({ type: 'mark-current', tab: tabA });
  assert.equal(result.created, false);
  assert.equal(result.encountered, false);
  assert.equal(result.alreadySaved, true);
  assert.deepEqual(state.local.records[0], before);
});

test('隔一段时间重复 Mark 记为途中偶遇，不新增记录或重置计划', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('repeat-mark');
  await handleMessage({ type: 'mark-current', tab: tabA });
  state.local.records[0].encounters[0].at = Date.now() - 11 * 60_000;
  state.local.records[0].updatedAt = state.local.records[0].encounters[0].at;
  state.local.records[0].stage = 2;
  state.local.records[0].nextReviewAt = 123_456;
  const result = await handleMessage({
    type: 'mark-current',
    tab: { ...tabA, url: 'https://a.example/doc?utm_source=again#part', excerpt: '再次遇见' },
  });
  assert.equal(result.created, false);
  assert.equal(result.encountered, true);
  assert.equal(state.local.records.length, 1);
  assert.equal(state.local.records[0].stage, 2);
  assert.equal(state.local.records[0].nextReviewAt, 123_456);
  assert.equal(state.local.records[0].excerpt, '再次遇见');
  assert.equal(state.local.records[0].encounters.filter((event) => event.type === 'encounter').length, 1);
});

test('页面提供 canonical 链接时按正文身份识别同一页', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('canonical-mark');
  const canonicalUrl = 'https://news.example/story';
  await handleMessage({
    type: 'mark-current',
    tab: { ...tabA, url: 'https://m.news.example/story?from=feed' },
  });
  const result = await handleMessage({
    type: 'mark-current',
    tab: { ...tabA, url: 'https://m.news.example/story?from=feed#comments', canonicalUrl },
  });
  assert.equal(result.created, false);
  assert.equal(state.local.records.length, 1);
  assert.equal(state.local.records[0].normalizedUrl, canonicalUrl);

});

test('再次偶遇会同时收拢 canonical 与旧网址重复项', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('canonical-alias-merge');
  const url = 'https://m.news.example/story';
  const canonicalUrl = 'https://news.example/story';
  await handleMessage({ type:'mark-current', tab:{ ...tabA, url, canonicalUrl } });
  const legacy = {
    ...structuredClone(state.local.records[0]),
    title:'旧网址记录', url, canonicalUrl:'', normalizedUrl:url, stage:2,
  };
  state.local.records.push(legacy);
  const result = await handleMessage({ type:'mark-current', tab:{ ...tabA, url, canonicalUrl } });
  assert.equal(result.created, false);
  assert.equal(state.local.records.length, 1);
  assert.equal(state.local.records[0].normalizedUrl, canonicalUrl);
  assert.equal(state.local.records[0].stage, 2);
});

test('启动升级会合并旧重复项，并清理刚刚产生的假偶遇', async () => {
  const state = chromeMock();
  await loadWorker('startup-migration');
  const now = Date.now();
  state.local.records = [
    { title:'旧记录', url:'https://a.example/doc#first', normalizedUrl:'https://a.example/doc', sourceDomain:'a.example', stage:2, completedAt:now-5, nextReviewAt:now+10, createdAt:now-20, updatedAt:now-5, skinId:'fluid-01' },
    { title:'后来又存', url:'https://a.example/doc/?utm_source=again', normalizedUrl:'https://a.example/doc/?utm_source=again', sourceDomain:'a.example', stage:1, completedAt:now-2, nextReviewAt:now+20, createdAt:now-2, updatedAt:now-2, skinId:'fluid-01' },
  ];
  await state.listeners.startup();
  assert.equal(state.local.records.length, 1);
  assert.equal(state.local.records[0].stage, 2);
  assert.equal(state.local.records[0].nextReviewAt, now + 10);
  assert.equal(
    state.local.records[0].encounters.filter((event) => event.type === 'encounter').length,
    0,
  );
});
test('并发完成同一回访只能推进一级', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('reviews');
  await handleMessage({ type: 'mark-current', tab: tabA });
  state.local.records[0].nextReviewAt = 0;
  const normalizedUrl = state.local.records[0].normalizedUrl;
  const [first, second] = await Promise.all([
    handleMessage({ type: 'complete-review', normalizedUrl }),
    handleMessage({ type: 'complete-review', normalizedUrl }),
  ]);
  assert.equal([first.changed, second.changed].filter(Boolean).length, 1);
  assert.equal(state.local.records[0].stage, 2);
});

test('records mutation queue 一次写入失败后仍执行下一次操作', async () => {
  const state = chromeMock({ failWrites: 1 });
  const { handleMessage } = await loadWorker('recover');
  await assert.rejects(handleMessage({ type: 'mark-current', tab: tabA }), /无法保存本地记录/);
  const result = await handleMessage({ type: 'mark-current', tab: tabB });
  assert.equal(result.created, true);
  assert.deepEqual(state.local.records.map((record) => record.title), ['B']);
});

test('今天看一条的选择会改排提醒、推进进度或保留到归档', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('review-decisions');
  await handleMessage({ type: 'mark-current', tab: tabA });
  await handleMessage({ type: 'mark-current', tab: tabB });
  for (const record of state.local.records) record.nextReviewAt = 0;
  const [a, b] = state.local.records.map((record) => record.normalizedUrl);
  const later = await handleMessage({ type: 'decide-review', normalizedUrl: a, choice: 'later' });
  assert.equal(later.changed, true);
  assert.equal(later.record.stage, 1);
  assert.ok(later.record.nextReviewAt > Date.now());
  assert.equal(later.record.encounters.at(-1).type, 'deferred');
  assert.deepEqual((await handleMessage({ type: 'list-records' })).records.map((record) => record.normalizedUrl), [b, a]);
  const used = await handleMessage({ type: 'decide-review', normalizedUrl: b, choice: 'used' });
  assert.equal(used.record.stage, 2);
  assert.equal(used.record.encounters.at(-1).type, 'used');
  const retired = await handleMessage({ type: 'decide-review', normalizedUrl: a, choice: 'retire' });
  assert.equal(retired.changed, false, '推到明天的记录今天不能被旧动作归档');
  state.local.records.find((record) => record.normalizedUrl === a).nextReviewAt = 0;
  const archived = await handleMessage({ type: 'decide-review', normalizedUrl: a, choice: 'retire' });
  assert.equal(archived.changed, true);
  assert.equal(state.local.records.length, 1);
  assert.equal(state.local.archivedRecords[0].encounters.at(-1).type, 'retired');
  assert.equal((await handleMessage({ type: 'export-backup' })).archived.length, 1);
});

test('升级隔离无法识别的旧记录，正常收藏仍可读取且原始数据可导出', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('unreadable-migration');
  const valid = { ...tabA, stage: 1, nextReviewAt: Date.now() + 86_400_000, createdAt: 1, updatedAt: 1 };
  state.local.records = [valid, null, { title: '本地旧文档', url: 'file:///old-note' }];
  await state.listeners.installed();
  assert.equal(state.local.records.length, 1);
  assert.deepEqual(state.local.unreadableRecords.map((item) => item.source), ['records', 'records']);
  const list = await handleMessage({ type: 'list-records' });
  assert.equal(list.records.length, 1);
  assert.equal(list.unreadableCount, 2);
  const backup = await handleMessage({ type: 'export-backup' });
  assert.equal(backup.records.length, 1);
  assert.deepEqual(backup.unreadable, state.local.unreadableRecords);
});

test('首次写入前遇到异常旧记录，也先留存原始数据', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('unreadable-write');
  state.local.records = [null];
  const result = await handleMessage({ type: 'mark-current', tab: tabA });
  assert.equal(result.created, true);
  assert.equal(state.local.records.length, 1);
  assert.deepEqual(state.local.unreadableRecords, [{ source: 'records', record: null }]);
});

test('包含异常旧数据的备份仍可导入，并保留无法显示的原始条目', async () => {
  const source = chromeMock();
  const { handleMessage: exportMessage } = await loadWorker('unreadable-export');
  source.local.records = [{ ...tabA, stage: 1, createdAt: 1, updatedAt: 1, nextReviewAt: Date.now() + 86_400_000 }, null];
  const backup = await exportMessage({ type: 'export-backup' });
  assert.equal(backup.records.length, 1);
  assert.deepEqual(backup.unreadable, [{ source: 'records', record: null }]);

  const target = chromeMock();
  const { handleMessage: importMessage } = await loadWorker('unreadable-import');
  await importMessage({ type: 'import-records', ...backup });
  assert.equal(target.local.records.length, 1);
  assert.deepEqual(target.local.unreadableRecords, backup.unreadable);
});

test('工具栏有到期记录时显示回访，快捷键始终显示当前页面 Mark', async () => {
  const state = chromeMock();
  await loadWorker('entry-semantics');
  state.local.records = [{ stage: 1, nextReviewAt: 0, createdAt: 0, normalizedUrl: 'https://due.example/' }];
  state.listeners.action(tabA);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(state.calls.messages.at(-1).message.mode, 'review');
  state.listeners.command('open-current-document', tabB);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(state.calls.messages.at(-1).message.mode, 'current');
  assert.equal(state.calls.messages.at(-1).tabId, tabB.id);
});

test('活跃宠物响应消息时不重复插入 CSS 或脚本', async () => {
  const state = chromeMock();
  await loadWorker('single-injection');
  state.listeners.command('open-current-document', tabA);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(state.calls.insertedCss.length, 0);
  assert.equal(state.calls.scripts.filter((item) => item.files).length, 0);
  assert.equal(state.calls.messages.at(-1).message.type, 'show-pet');
});

test('旧 root 失去接收端时清理后重新注入', async () => {
  const state = chromeMock({ missingReceiverOnce: true });
  await loadWorker('stale-root-recovery');
  state.listeners.command('open-current-document', tabA);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(state.calls.messages.length, 2);
  assert.equal(state.calls.insertedCss.length, 1);
  assert.equal(state.calls.scripts.filter((item) => item.func).length, 1);
  assert.equal(state.calls.scripts.filter((item) => item.files?.includes('pet.js')).length, 1);
  assert.equal(state.calls.messages.at(-1).message.type, 'show-pet');
});

test('受保护页面显示当前标签专属错误 badge 和标题', async () => {
  const state = chromeMock();
  await loadWorker('protected-page');
  state.listeners.action({ id: 77, windowId: 1, title: '扩展管理', url: 'chrome://extensions/' });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(state.calls.badges.some(([kind, value]) => kind === 'text' && value.tabId === 77 && value.text === '!'));
  assert.ok(state.calls.badges.some(([kind, value]) => kind === 'title' && value.tabId === 77 && value.title === '请在普通网页中使用一点'));
});

test('错误 badge 在刷新或换页时清除并恢复全局到期颜色', async () => {
  const state = chromeMock();
  await loadWorker('clear-tab-error');
  state.listeners.action({ id: 77, windowId: 1, title: '扩展管理', url: 'chrome://extensions/' });
  await new Promise((resolve) => setTimeout(resolve, 15));
  state.listeners.tabUpdated(77, { status: 'loading' });
  await new Promise((resolve) => setTimeout(resolve, 15));
  const tabTextCalls = state.calls.badges.filter(([kind, value]) => kind === 'text' && value.tabId === 77);
  assert.equal(tabTextCalls.at(-1)[1].text, '');
  const tabColorCalls = state.calls.badges.filter(([kind, value]) => kind === 'color' && value.tabId === 77);
  assert.equal(tabColorCalls.at(-1)[1].color, '#28735F');
  const tabTitleCalls = state.calls.badges.filter(([kind, value]) => kind === 'title' && value.tabId === 77);
  assert.equal(tabTitleCalls.at(-1)[1].title, '打开一点｜收下或回看当前内容');
});
test('普通网页注入失败也显示当前标签专属可见反馈', async () => {
  const state = chromeMock({ missingReceiverOnce: true, injectionError: new Error('Cannot access contents of the page') });
  await loadWorker('injection-failure');
  state.listeners.action(tabA);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(state.calls.badges.some(([kind, value]) => kind === 'text' && value.tabId === tabA.id && value.text === '!'));
  assert.ok(state.calls.badges.some(([kind, value]) => kind === 'title' && value.tabId === tabA.id && value.title === '请在普通网页中使用一点'));
});

test('打开记录拒绝非 http/https 协议', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('open-url');
  for (const url of ['javascript:alert(1)', 'data:text/plain,x', 'file:///tmp/x']) {
    const result = await handleMessage({ type: 'open-record', url });
    assert.equal(result.ok, false);
  }
  assert.equal(state.calls.opened.length, 0);
});

test('记录页可打开，导入按 URL 合并并保留较新的进度', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('library-import');
  await handleMessage({ type:'mark-current', tab:tabA });
  const now = Date.now();
  const result = await handleMessage({
    type:'import-records',
    records:[
      {
        title:'A restored', url:'https://a.example/doc#section', stage:2,
        completedAt:now, nextReviewAt:now - 1, createdAt:now - 2,
        updatedAt:now + 1,
      },
      {
        title:'B complete', url:'https://b.example/doc', stage:4,
        completedAt:now, nextReviewAt:null, createdAt:now, updatedAt:now,
      },
    ],
  });
  assert.deepEqual(result, { ok:true, imported:2, total:2 });
  const listed = await handleMessage({ type:'list-records' });
  assert.deepEqual(listed.records.map((item) => item.title), ['A restored', 'B complete']);
  assert.equal(listed.records[0].normalizedUrl, 'https://a.example/doc');
  assert.equal(listed.records[0].sourceDomain, 'a.example');
  await handleMessage({ type:'open-library' });
  assert.deepEqual(state.calls.opened.at(-1), { url:'edge-extension://test/library.html' });
});

test('无效备份整批拒绝且不覆盖现有记录', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('library-invalid-import');
  await handleMessage({ type:'mark-current', tab:tabA });
  const before = structuredClone(state.local.records);
  await assert.rejects(
    handleMessage({ type:'import-records', records:[{ url:'file:///bad', stage:1 }] }),
    /http|https/,
  );
  assert.deepEqual(state.local.records, before);
});

test('备份导入限制为五千份', async () => {
  chromeMock();
  const { handleMessage } = await loadWorker('library-import-limit');
  await assert.rejects(
    handleMessage({ type:'import-records', records:Array(5001).fill({}) }),
    /备份文件/,
  );
});

test('消息入口拒绝空消息，导入字段过长时不覆盖数据', async () => {
  const state = chromeMock();
  const { handleMessage } = await loadWorker('security-boundaries');
  assert.deepEqual(await handleMessage(null), { ok:false, error:'无效操作' });
  await handleMessage({ type:'mark-current', tab:tabA });
  const before = structuredClone(state.local.records);
  await assert.rejects(
    handleMessage({
      type:'import-records',
      records:[{
        title:'x'.repeat(501),
        url:'https://safe.example/doc',
        stage:1,
        completedAt:Date.now(),
        nextReviewAt:Date.now() + 1,
        createdAt:Date.now(),
        updatedAt:Date.now(),
      }],
    }),
    /字段过长/,
  );
  assert.deepEqual(state.local.records, before);
});
