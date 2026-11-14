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
  mergeContent,
  isAutoTitle,
  normalizeImportedRecord,
  createRecord,
  addEncounter,
  setNote,
  MAX_NOTE_LENGTH,
  matchesRecordQuery,
  recordsToMarkdown,
} from '../packages/yidian-core/domain.mjs';

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

// ---- 内容层：标题 / 一句描述 / 选段 ----

test('createRecord：描述与选段分开放，标题空了走兜底', () => {
  const withTitle = createRecord({ title: '真标题', url: 'https://example.com/a', summary: '一句描述', now: NOW });
  assert.equal(withTitle.title, '真标题');
  assert.equal(withTitle.summary, '一句描述');
  assert.equal(withTitle.excerpt, '');

  const fallback = createRecord({ title: '', url: 'https://example.com/b', now: NOW });
  assert.match(fallback.title, /^example\.com · /);
  assert.equal(isAutoTitle(fallback), true);
  assert.equal(isAutoTitle(withTitle), false);
});

test('mergeContent：真标题顶掉兜底标题，描述和选段只补不覆盖', () => {
  const auto = createRecord({ title: '', url: 'https://example.com/a', now: NOW });
  const real = createRecord({ title: '真标题', url: 'https://example.com/a', summary: '一句描述', now: NOW + 1000 });
  const merged = mergeContent(auto, real);
  assert.equal(merged.title, '真标题');
  assert.equal(merged.summary, '一句描述');

  // 已有描述时，后来的空值不覆盖
  const keep = mergeContent(merged, createRecord({ title: '', url: 'https://example.com/a', now: NOW + 2000 }));
  assert.equal(keep.summary, '一句描述');
  assert.equal(keep.title, '真标题');

  // 内容没变就原样返回，不动 updatedAt
  const same = mergeContent(merged, real);
  assert.equal(same, merged);
});

test('addEncounter：空描述不覆盖已有描述', () => {
  const record = createRecord({ title: '甲', url: 'https://example.com/a', summary: '一句描述', now: NOW });
  const next = addEncounter(record, { type: 'review', now: NOW + 1000 });
  assert.equal(next.summary, '一句描述');
  const withSummary = addEncounter(record, { type: 'review', now: NOW + 1000, summary: '新的描述' });
  assert.equal(withSummary.summary, '新的描述');
});

test('consolidateRecords：合并时真标题不被兜底标题挤掉，描述取最近的非空', () => {
  const auto = createRecord({ title: '', url: 'https://example.com/post', now: NOW - DAY_MS });
  const real = createRecord({ title: '真标题', url: 'https://example.com/post', summary: '一句描述', now: NOW });
  const { records } = consolidateRecords([auto, real]);
  assert.equal(records.length, 1);
  assert.equal(records[0].title, '真标题');
  assert.equal(records[0].summary, '一句描述');
});

test('matchesRecordQuery：描述也能搜到', () => {
  const record = createRecord({ title: '标题', url: 'https://example.com/a', summary: '独特的一句描述', now: NOW });
  assert.equal(matchesRecordQuery(record, '独特'), true);
  assert.equal(matchesRecordQuery(record, '找不到'), false);
});

test('recordsToMarkdown：描述与选段都写进备份', () => {
  const record = createRecord({ title: '标题', url: 'https://example.com/a', summary: '一句描述', excerpt: '一段选中的话', now: NOW });
  const markdown = recordsToMarkdown({ records: [record] });
  assert.match(markdown, /一句描述/);
  assert.match(markdown, /> 一段选中的话/);
});

test('normalizeImportedRecord：描述跟着导入，超长拒绝', () => {
  const normalized = normalizeImportedRecord({ url: 'https://example.com/post', stage: 1, summary: '一句描述' }, NOW);
  assert.equal(normalized.summary, '一句描述');
  assert.throws(() => normalizeImportedRecord({ url: 'https://example.com/', stage: 1, summary: 'x'.repeat(400) }, NOW), /过长/);
});

// ---- 内容层第三件：一句话批注（你自己写的那句）----

test('setNote：写一句、清除、超长截断，且不算一次「相见」', () => {
  const record = createRecord({ title: '甲', url: 'https://example.com/a', now: NOW });
  const noted = setNote(record, '  这条是我要的配色  ', NOW + 1000);
  assert.equal(noted.note, '这条是我要的配色');
  assert.equal(noted.updatedAt, NOW + 1000);
  assert.equal(noted.encounters.length, record.encounters.length, '写批注不算一次相见');
  assert.equal(setNote(record, '').note, '', '空字符串就是清除');
  assert.equal(setNote(record, 'x'.repeat(900)).note.length, MAX_NOTE_LENGTH);
});

test('合并时批注不被后来的采集覆盖', () => {
  const base = createRecord({ title: '甲', url: 'https://example.com/post', now: NOW });
  const noted = setNote(base, '我的一句', NOW + 1000);
  const later = createRecord({ title: '甲', url: 'https://example.com/post', now: NOW + 2000 });
  const { records } = consolidateRecords([noted, later]);
  assert.equal(records.length, 1);
  assert.equal(records[0].note, '我的一句');
});

test('matchesRecordQuery / recordsToMarkdown 都带上批注', () => {
  const record = setNote(
    createRecord({ title: '标题', url: 'https://example.com/a', now: NOW }),
    '独特的批注词',
  );
  assert.equal(matchesRecordQuery(record, '独特'), true);
  assert.match(recordsToMarkdown({ records: [record] }), /批注：独特的批注词/);
});

test('normalizeImportedRecord：批注跟着导入，超长拒绝', () => {
  const normalized = normalizeImportedRecord({ url: 'https://example.com/post', stage: 1, note: '我的一句' }, NOW);
  assert.equal(normalized.note, '我的一句');
  assert.throws(() => normalizeImportedRecord({ url: 'https://example.com/', stage: 1, note: 'x'.repeat(900) }, NOW), /过长/);
});
