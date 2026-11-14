import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createRecord, inQuietHours, matchesRecordQuery, normalizeQuietHours, recordsToMarkdown, summarizeRecords,
} from '../core/domain.mjs';
import { createJsonFileAdapter, createMemoryAdapter, mergeSettings } from '../core/adapter.mjs';

test('extension/domain.mjs 与 core/domain.mjs 保持逐字节一致', async () => {
  const [core, copy] = await Promise.all([
    readFile(new URL('../core/domain.mjs', import.meta.url)),
    readFile(new URL('../extension/domain.mjs', import.meta.url)),
  ]);
  assert.ok(core.equals(copy), '副本漂移：修改核心域后请运行 scripts/release.ps1 或手工同步 core/domain.mjs 到 extension/');
});

function at(hour, minute) {
  // 固定用东八区墙钟构造时间戳，避免测试机时区差异
  const utcMs = Date.UTC(2026, 7, 18, hour - 8, minute);
  return utcMs;
}

test('免打扰默认 22:00-08:00 跨午夜生效，白天不打扰判定为否', () => {
  const quiet = { enabled: true, start: '22:00', end: '08:00' };
  assert.equal(inQuietHours(quiet, at(23, 30)), true);
  assert.equal(inQuietHours(quiet, at(7, 59)), true);
  assert.equal(inQuietHours(quiet, at(8, 0)), false);
  assert.equal(inQuietHours(quiet, at(12, 0)), false);
  assert.equal(inQuietHours(quiet, at(21, 59)), false);
});

test('免打扰关闭时一律不静默，缺省输入回退默认时段', () => {
  assert.equal(inQuietHours({ enabled: false, start: '00:00', end: '23:59' }, at(12, 0)), false);
  assert.equal(inQuietHours({ enabled: false, start: '00:00', end: '23:59' }, at(3, 0)), false);
  // 缺省/非法字段会被 normalizeQuietHours 修复为默认 22:00-08:00，行为与默认一致
  assert.equal(inQuietHours(null, at(12, 0)), false);
  assert.equal(inQuietHours(null, at(3, 0)), true);
  assert.equal(inQuietHours({ enabled: true, start: 'bad', end: '08:00' }, at(3, 0)), true);
  assert.equal(inQuietHours({ enabled: true, start: 'bad', end: '08:00' }, at(12, 0)), false);
});

test('同日时段按起止区间判定且不包含终点分钟', () => {
  const quiet = { enabled: true, start: '12:00', end: '14:00' };
  assert.equal(inQuietHours(quiet, at(12, 0)), true);
  assert.equal(inQuietHours(quiet, at(13, 59)), true);
  assert.equal(inQuietHours(quiet, at(14, 0)), false);
  assert.equal(inQuietHours(quiet, at(9, 0)), false);
});

test('normalizeQuietHours 修复缺省与非法输入', () => {
  assert.deepEqual(normalizeQuietHours(), { enabled: true, start: '22:00', end: '08:00' });
  assert.deepEqual(
    normalizeQuietHours({ enabled: false, start: '9:5', end: 'xx' }),
    { enabled: false, start: '22:00', end: '08:00' },
  );
});

const baseRecord = (overrides = {}) => createRecord({
  title: '示例文章', url: 'https://example.com/doc', now: at(10, 0), ...overrides,
});

test('收藏库搜索按标题、域名、选段与链接模糊匹配', () => {
  const record = baseRecord({ excerpt: '关于 spaced repetition 的笔记' });
  assert.equal(matchesRecordQuery(record, '示例'), true);
  assert.equal(matchesRecordQuery(record, 'EXAMPLE.COM'), true);
  assert.equal(matchesRecordQuery(record, 'spaced'), true);
  assert.equal(matchesRecordQuery(record, 'doc'), true);
  assert.equal(matchesRecordQuery(record, '完全不相关'), false);
  assert.equal(matchesRecordQuery(record, '   '), true);
});

test('温和统计只汇总已发生事实，域名按频次取前三', () => {
  const records = [
    baseRecord({ url: 'https://a.example/1' }),
    baseRecord({ url: 'https://a.example/2' }),
    baseRecord({ url: 'https://b.example/1' }),
    { ...baseRecord({ url: 'https://c.example/1' }), stage: 4, nextReviewAt: null },
  ];
  const summary = summarizeRecords(records);
  assert.equal(summary.total, 4);
  assert.equal(summary.completed, 1);
  assert.equal(summary.encounters, 4);
  assert.deepEqual(summary.topDomains[0], { domain: 'a.example', count: 2 });
  assert.equal(summary.topDomains.length, 3);
  assert.deepEqual(summarizeRecords([]), { total: 0, completed: 0, encounters: 0, topDomains: [] });
});

test('内存适配器读写隔离且设置带默认值', async () => {
  const adapter = createMemoryAdapter();
  assert.deepEqual(await adapter.readRecords(), []);
  await adapter.writeRecords([baseRecord()]);
  const readBack = await adapter.readRecords();
  readBack[0].title = '被篡改';
  assert.equal((await adapter.readRecords())[0].title, '示例文章');
  assert.deepEqual(await adapter.readSettings(), mergeSettings());
  await adapter.writeSettings({ notifyOnDue: true });
  assert.equal((await adapter.readSettings()).notifyOnDue, true);
  assert.deepEqual((await adapter.readSettings()).quietHours, { enabled: true, start: '22:00', end: '08:00' });
});

test('JSON 文件适配器与扩展备份格式同构且缺失文件时回退空状态', async () => {
  const store = new Map();
  const fs = {
    async readFile(path) {
      if (!store.has(path)) throw new Error('ENOENT');
      return store.get(path);
    },
    async writeFile(path, content) { store.set(path, content); },
  };
  const adapter = createJsonFileAdapter('/tmp/yidian.json', fs);
  assert.deepEqual(await adapter.readRecords(), []);
  await adapter.writeRecords([baseRecord()]);
  const payload = JSON.parse(store.get('/tmp/yidian.json'));
  assert.equal(payload.version, 2);
  assert.equal(payload.records.length, 1);
  assert.deepEqual(payload.settings.quietHours, { enabled: true, start: '22:00', end: '08:00' });
  await adapter.writeSettings({ reducedMotion: true });
  const next = JSON.parse(store.get('/tmp/yidian.json'));
  assert.equal(next.records.length, 1, '写设置不覆盖记录');
  assert.equal(next.settings.reducedMotion, true);
});

test('recordsToMarkdown 输出 frontmatter、选段与足迹，Obsidian 可直接入库', () => {
  const record = { ...baseRecord({ excerpt: '值得再见的一段' }), encounters: [{ type: 'review', at: at(15, 0), stage: 2 }] };
  const archived = { ...baseRecord({ title: '长成[归档]的笔记', url: 'https://example.com/done' }), stage: 4 };
  const markdown = recordsToMarkdown({ records: [record], archived: [archived], exportedAt: '2026-08-19T00:00:00.000Z' });
  assert.match(markdown, /^---\nsource: yidian\nexportedAt: 2026-08-19T00:00:00\.000Z\ntotal: 2\n---/);
  assert.match(markdown, /## \[示例文章\]\(https:\/\/example\.com\/doc\)/);
  assert.match(markdown, /- status: 进行中/);
  assert.match(markdown, /> 值得再见的一段/);
  assert.match(markdown, /### 足迹/);
  assert.match(markdown, /- 2026-08-18 回看（2\/4）/);
  assert.match(markdown, /## \[长成 归档 的笔记\]/, '标题里的方括号被清掉，避免破坏 Obsidian 链接语法');
  assert.match(markdown, /- status: 已归档/);
});
