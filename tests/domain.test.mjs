import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS, ENCOUNTER_COOLDOWN_MS, addEncounter, advanceRecord, canAddEncounter, consolidateRecords, createRecord, deferRecord, encounterCount,
  normalizeImportedRecord, normalizeUrl, recordsToMarkdown, restartRecord, selectNextDue, upsertByNormalizedUrl, updateRecordUrl
} from '../extension/domain.mjs';

const T0 = Date.UTC(2026, 6, 1, 8);

function marked(overrides = {}) {
  return { ...createRecord({ title: '文档', url: 'https://example.com/doc?q=1#part', now: T0 }), ...overrides };
}

test('Mark 立即得到 25%，一天后到期', () => {
  const record = marked();
  assert.equal(record.stage, 1);
  assert.equal(record.nextReviewAt, T0 + DAY_MS);
});

test('Mark 保存选中文本并限制收藏上下文长度', () => {
  const record = createRecord({
    title: '文档', url: 'https://example.com/doc', excerpt: `  ${'x'.repeat(1_001)}  `, now: T0,
  });
  assert.equal(record.excerpt.length, 1_000);
  assert.equal(record.excerpt, 'x'.repeat(1_000));
});

test('正常 1/2/7/30 节奏对应 25/50/75/100', () => {
  let record = marked();
  const day2 = T0 + DAY_MS;
  record = advanceRecord(record, day2).record;
  assert.equal(record.stage, 2);
  assert.equal(record.nextReviewAt, T0 + 6 * DAY_MS);
  record = advanceRecord(record, T0 + 6 * DAY_MS).record;
  assert.equal(record.stage, 3);
  assert.equal(record.nextReviewAt, T0 + 29 * DAY_MS);
  record = advanceRecord(record, T0 + 29 * DAY_MS).record;
  assert.equal(record.stage, 4);
  assert.equal(record.nextReviewAt, null);
});

test('延迟完成从实际完成时间重新排期', () => {
  const late = T0 + 4 * DAY_MS;
  const stage2 = advanceRecord(marked(), late).record;
  assert.equal(stage2.nextReviewAt, late + 5 * DAY_MS);
});

test('未到期和快速重复点击都不会重复推进', () => {
  const first = advanceRecord(marked(), T0 + DAY_MS);
  assert.equal(first.changed, true);
  const duplicate = advanceRecord(first.record, T0 + DAY_MS);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.record.stage, 2);
});

test('100% 后终止自动提醒', () => {
  const complete = { ...marked(), stage: 4, nextReviewAt: null };
  const result = advanceRecord(complete, T0 + 99 * DAY_MS);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'complete');
  assert.equal(result.record.nextReviewAt, null);
});

test('URL 去重移除 fragment 和跟踪参数，但保留业务 query', () => {
  assert.equal(normalizeUrl('https://example.com/doc?q=1#x'), 'https://example.com/doc?q=1');
  assert.equal(
    normalizeUrl('https://example.com/doc/?utm_source=feed&q=1&fbclid=x'),
    'https://example.com/doc?q=1',
  );
  assert.notEqual(normalizeUrl('https://example.com/doc?q=1'), normalizeUrl('https://example.com/doc?q=2'));
  const original = marked();
  const duplicate = createRecord({ title: '同一页', url: 'https://example.com/doc?q=1#other', now: T0 + 1 });
  const result = upsertByNormalizedUrl([original], duplicate);
  assert.equal(result.created, false);
  assert.equal(result.records.length, 1);
});
test('途中偶遇只记录相见，不改变原回看计划', () => {
  const original = marked({ stage: 2, nextReviewAt: T0 + 6 * DAY_MS });
  const metAgain = addEncounter(original, { now: T0 + 3 * DAY_MS, excerpt: '后来又看到的一段' });
  assert.equal(metAgain.stage, 2);
  assert.equal(metAgain.nextReviewAt, original.nextReviewAt);
  assert.equal(metAgain.excerpt, '后来又看到的一段');
  assert.equal(encounterCount(metAgain), 1);
});

test('刚刚点过只确认已保存，不制造一次偶遇', () => {
  const original = marked();
  assert.equal(canAddEncounter(original, T0 + ENCOUNTER_COOLDOWN_MS - 1), false);
  assert.equal(canAddEncounter(original, T0 + ENCOUNTER_COOLDOWN_MS), true);
  const noisy = addEncounter(original, { now: T0 + 1 });
  const cleaned = consolidateRecords([noisy]);
  assert.equal(cleaned.changed, true);
  assert.equal(encounterCount(cleaned.records[0]), 0);
});

test('旧重复项合为一条，并把后一次收藏保留为途中偶遇', () => {
  const progressed = advanceRecord(marked(), T0 + DAY_MS).record;
  const duplicate = createRecord({
    title: '同一文档', url: 'https://example.com/doc/?q=1&utm_source=newsletter',
    excerpt: '第二次看到', now: T0 + 3 * DAY_MS,
  });
  const result = consolidateRecords([progressed, duplicate]);
  assert.equal(result.records.length, 1);
  assert.equal(result.mergedCount, 1);
  assert.equal(result.records[0].stage, 2);
  assert.equal(result.records[0].nextReviewAt, progressed.nextReviewAt);
  assert.equal(result.records[0].excerpt, '第二次看到');
  assert.equal(encounterCount(result.records[0]), 1);
});

test('稍后再看只推到明天，用上了才推进回看进度，备份保留选择', () => {
  const dueAt = T0 + DAY_MS;
  const deferred = deferRecord(marked(), dueAt).record;
  assert.equal(deferred.stage, 1);
  assert.equal(deferred.nextReviewAt, dueAt + DAY_MS);
  assert.equal(deferred.encounters.at(-1).type, 'deferred');
  assert.equal(selectNextDue([deferred], dueAt), null);
  const used = advanceRecord(deferred, dueAt + DAY_MS, 'used').record;
  assert.equal(used.stage, 2);
  assert.equal(used.nextReviewAt, dueAt + 6 * DAY_MS);
  assert.equal(used.encounters.at(-1).type, 'used');
  assert.deepEqual(normalizeImportedRecord(used).encounters, used.encounters);
  assert.match(recordsToMarkdown({ records: [used] }), /稍后再看[\s\S]*用上了/);
  assert.equal(deferRecord(used, dueAt + DAY_MS).changed, false);
});

test('异常旧记录不阻断正常收藏，并交给存储层留存', () => {
  const valid = marked();
  const invalid = { title: '旧记录', url: 'file:///old-note' };
  const result = consolidateRecords([valid, null, invalid]);
  assert.deepEqual(result.records.map((record) => record.title), [valid.title]);
  assert.deepEqual(result.rejected, [null, invalid]);
  assert.equal(result.changed, true);
  assert.deepEqual(consolidateRecords({ broken: true }).rejected, [{ broken: true }]);
});

test('完成后可显式开始新一轮', () => {
  const complete = { ...marked(), stage: 4, nextReviewAt: null };
  const restarted = restartRecord(complete, T0 + 40 * DAY_MS);
  assert.equal(restarted.stage, 1);
  assert.equal(restarted.nextReviewAt, T0 + 41 * DAY_MS);
  assert.equal(restarted.encounters.at(-1).type, 'restart');
});


test('到期选择按 nextReviewAt、createdAt 排序且只返回一份', () => {
  const a = marked({ normalizedUrl: 'https://a.test/', nextReviewAt: T0, createdAt: T0 + 2 });
  const b = marked({ normalizedUrl: 'https://b.test/', nextReviewAt: T0 - 1, createdAt: T0 + 9 });
  const c = marked({ normalizedUrl: 'https://c.test/', nextReviewAt: T0, createdAt: T0 + 1 });
  assert.equal(selectNextDue([a, b, c], T0).normalizedUrl, b.normalizedUrl);
  assert.equal(selectNextDue([a, c], T0).normalizedUrl, c.normalizedUrl);
});

test('失效链接可修改且保留进度', () => {
  const updated = updateRecordUrl(marked({ stage: 3 }), 'https://new.example.com/doc#top', T0 + 10);
  assert.equal(updated.stage, 3);
  assert.equal(updated.normalizedUrl, 'https://new.example.com/doc');
});

test('仅接受 http 和 https URL', () => {
  assert.equal(normalizeUrl('http://example.com/a#b'), 'http://example.com/a');
  assert.equal(normalizeUrl('https://example.com/a#b'), 'https://example.com/a');
  for (const url of ['javascript:alert(1)', 'data:text/plain,x', 'file:///tmp/x']) {
    assert.throws(() => normalizeUrl(url), /仅支持 http:\/\/ 或 https:\/\//);
    assert.throws(() => createRecord({ title: '危险链接', url, now: T0 }), /仅支持 http:\/\/ 或 https:\/\//);
  }
});
