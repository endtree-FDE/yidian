// 一点 1.3.0 核心领域逻辑聚焦检查。
// 运行方式（仓库根目录，Node >= 20，无需 package.json）：
//   node --test tests/domain.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  nextReviewAtFor,
  isDue,
  advanceRecord,
  selectNextDue,
  inQuietHours,
  dayKeyFor,
  quietEndAt,
  consolidateRecords,
  mergeByKey,
  normalizeImportedRecord,
  createRecord,
} from '../packages/yidian-1.3.0/domain.mjs';

const NOW = Date.parse('2026-08-19T04:00:00Z'); // 北京墙钟 12:00

// ---- 到期判定 ----

test('nextReviewAtFor：第 1/2/3 阶段间隔为 1/5/23 天，第 4 阶段无下次', () => {
  assert.equal(nextReviewAtFor(1, NOW), NOW + 1 * DAY_MS);
  assert.equal(nextReviewAtFor(2, NOW), NOW + 5 * DAY_MS);
  assert.equal(nextReviewAtFor(3, NOW), NOW + 23 * DAY_MS);
  assert.equal(nextReviewAtFor(4, NOW), null);
});

test('isDue：恰好在到期时刻变为到期，之前不算；第 4 阶段永不到期', () => {
  const record = { stage: 1, nextReviewAt: NOW + DAY_MS };
  assert.equal(isDue(record, NOW + DAY_MS - 1), false);
  assert.equal(isDue(record, NOW + DAY_MS), true);
  assert.equal(isDue({ stage: 4, nextReviewAt: NOW - 1 }, NOW), false);
  assert.equal(isDue({ stage: 1, nextReviewAt: Number.NaN }, NOW), false);
});

test('advanceRecord：到期才推进，间隔递进，到顶停止且不改原记录', () => {
  const stage1 = { stage: 1, nextReviewAt: NOW, createdAt: NOW, encounters: [] };
  const advanced = advanceRecord(stage1, NOW);
  assert.equal(advanced.changed, true);
  assert.equal(advanced.reason, 'advanced');
  assert.equal(advanced.record.stage, 2);
  assert.equal(advanced.record.nextReviewAt, NOW + 5 * DAY_MS);
  assert.equal(stage1.stage, 1); // 原记录不被原地修改

  assert.deepEqual(advanceRecord(stage1, NOW - 1).reason, 'not_due');
  const complete = { stage: 4, nextReviewAt: NOW, createdAt: NOW, encounters: [] };
  assert.deepEqual(advanceRecord(complete, NOW).reason, 'complete');
});

test('selectNextDue：取最旧到期记录，全部未到期返回 null', () => {
  const newer = { stage: 1, nextReviewAt: NOW - 1, createdAt: NOW, encounters: [] };
  const older = { stage: 2, nextReviewAt: NOW - DAY_MS, createdAt: NOW - DAY_MS, encounters: [] };
  const future = { stage: 1, nextReviewAt: NOW + DAY_MS, createdAt: NOW, encounters: [] };
  assert.equal(selectNextDue([future, newer, older], NOW), older);
  assert.equal(selectNextDue([future], NOW), null);
  assert.equal(selectNextDue([], NOW), null);
});

// ---- 跨午夜免打扰（Asia/Shanghai 墙钟）----
// 2026-08-19T04:00:00Z = 北京 12:00；14:00Z = 22:00；23:30Z = 次日 07:30；
// 2026-08-20T02:00:00Z = 北京 10:00。

test('inQuietHours：跨午夜时段 22:00-08:00 在两侧午夜区内命中、午间不命中', () => {
  const hours = { enabled: true, start: '22:00', end: '08:00' };
  assert.equal(inQuietHours(hours, Date.parse('2026-08-19T14:00:00Z')), true); // 22:00
  assert.equal(inQuietHours(hours, Date.parse('2026-08-19T23:30:00Z')), true); // 07:30
  assert.equal(inQuietHours(hours, NOW), false); // 12:00
});

test('inQuietHours：关闭、同日时段与起止相同各有明确口径', () => {
  assert.equal(inQuietHours({ enabled: false, start: '00:00', end: '23:59' }, NOW), false);
  const day = { enabled: true, start: '12:00', end: '14:00' };
  assert.equal(inQuietHours(day, NOW), true); // 12:00 含起点
  assert.equal(inQuietHours(day, Date.parse('2026-08-19T06:00:00Z')), false); // 14:00 不含终点
  assert.equal(inQuietHours({ enabled: true, start: '12:00', end: '12:00' }, NOW), false);
});

test('dayKeyFor：摘要去重按北京墙钟分日，跨午夜口径与免打扰一致', () => {
  assert.equal(dayKeyFor(Date.parse('2026-08-19T15:59:00Z')), '2026-08-19'); // 北京 23:59
  assert.equal(dayKeyFor(Date.parse('2026-08-19T16:00:00Z')), '2026-08-20'); // 北京 00:00
  assert.equal(dayKeyFor(NOW), '2026-08-19'); // 北京 12:00，按 UTC 分日结果相同只是口径不同
});

test('quietEndAt：静默期内给出结束时刻供补发闹钟，静默期外返回 null', () => {
  const hours = { enabled: true, start: '22:00', end: '08:00' };
  // 北京 22:00 进入静默 -> 10 小时后（次日北京 08:00）结束
  assert.equal(quietEndAt(hours, Date.parse('2026-08-19T14:00:00Z')), Date.parse('2026-08-20T00:00:00Z'));
  // 北京 07:30 仍在静默 -> 30 分钟后结束
  assert.equal(quietEndAt(hours, Date.parse('2026-08-19T23:30:00Z')), Date.parse('2026-08-20T00:00:00Z'));
  // 北京 12:00 不在静默
  assert.equal(quietEndAt(hours, NOW), null);
  assert.equal(quietEndAt({ enabled: false, start: '22:00', end: '08:00' }, Date.parse('2026-08-19T14:00:00Z')), null);
});

// ---- 备份导入/合并（原 service-worker 内联逻辑下沉）----

test('mergeByKey：同键取 updatedAt 更新的一条，异键全部保留', () => {
  const old = { normalizedUrl: 'https://a.example.com/', updatedAt: 1 };
  const fresh = { normalizedUrl: 'https://a.example.com/', updatedAt: 2 };
  const other = { normalizedUrl: 'https://b.example.com/', updatedAt: 1 };
  assert.deepEqual(mergeByKey([old, other], [fresh]), [fresh, other]);
  assert.deepEqual(mergeByKey([fresh], [old]).length, 1); // 旧数据不覆盖新数据
});

test('normalizeImportedRecord：补齐缺省时间，拒绝无效进度与超长字段', () => {
  const normalized = normalizeImportedRecord({ url: 'https://example.com/post', stage: 2 }, NOW);
  assert.equal(normalized.normalizedUrl, 'https://example.com/post');
  assert.equal(normalized.completedAt, NOW);
  assert.equal(normalized.nextReviewAt, NOW + 5 * DAY_MS);
  assert.equal(normalizeImportedRecord({ url: 'https://example.com/', stage: 4 }, NOW).nextReviewAt, null);
  assert.throws(() => normalizeImportedRecord(null), TypeError);
  assert.throws(() => normalizeImportedRecord({ url: 'https://example.com/', stage: 9 }, NOW), /进度无效/);
  assert.throws(() => normalizeImportedRecord({ url: 'https://example.com/', stage: 1, title: 'x'.repeat(501) }, NOW), /过长/);
});

// ---- 记录迁移/合并（migrateStoredRecords 的核心纯逻辑）----

test('consolidateRecords：跟踪参数差异合并为一条，保留高阶段主人并去重 saved', () => {
  const base = createRecord({ title: '甲', url: 'https://example.com/post', now: NOW - 2 * DAY_MS });
  const dup = createRecord({
    title: '甲（带跟踪参数）',
    url: 'https://example.com/post?utm_source=feed',
    now: NOW - DAY_MS,
  });
  const kept = createRecord({ title: '乙', url: 'https://other.example.com/', now: NOW });
  const { records, changed, mergedCount } = consolidateRecords([base, dup, kept]);

  assert.equal(records.length, 2);
  assert.equal(changed, true);
  assert.equal(mergedCount, 1);
  const master = records.find((record) => record.normalizedUrl === 'https://example.com/post');
  assert.ok(master);
  assert.equal(master.encounters.filter((event) => event.type === 'saved').length, 1);
});

test('consolidateRecords：已规范的唯一记录集不产生变更', () => {
  const only = createRecord({ title: '丙', url: 'https://solo.example.com/', now: NOW });
  const first = consolidateRecords([only]);
  const second = consolidateRecords(first.records);
  assert.equal(second.changed, false);
  assert.equal(second.mergedCount, 0);
  assert.equal(second.records.length, 1);
});
