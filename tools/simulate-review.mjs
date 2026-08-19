#!/usr/bin/env node
// 一点 1.3.0 到期提醒链路本地诊断路由（只读模拟，不触碰 chrome.*、不发通知）。
// 复用 domain.mjs 纯函数，镜像 service-worker.mjs maybeNotifyDue 的判定顺序：
//   免打扰（quiet hours）-> 到期过滤（isDue）-> 多条摘要口径 -> 选取下一条（selectNextDue）。
//
// 用法（仓库根目录）：
//   node tools/simulate-review.mjs --records records.json [--now <ISO时间>] [--quiet-start 22:00] [--quiet-end 08:00] [--quiet-disabled]
//
// records.json 形如 [{ "url": "...", "title": "...", "stage": 1, "nextReviewAt": 1755571200000 }]
// 省略 nextReviewAt 时按 stage 从 now 反推（便于构造样例）。
// 每条输出包含时间、记录键（normalizedUrl）与决策，可关联单条记录。

import { readFileSync } from 'node:fs';
import {
  isDue,
  selectNextDue,
  inQuietHours,
  normalizeUrl,
  nextReviewAtFor,
} from '../packages/yidian-1.3.0/domain.mjs';

function parseArgs(argv) {
  const args = { quietStart: '22:00', quietEnd: '08:00', quietDisabled: false, now: new Date().toISOString(), records: null };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--records') args.records = argv[++i];
    else if (key === '--now') args.now = argv[++i];
    else if (key === '--quiet-start') args.quietStart = argv[++i];
    else if (key === '--quiet-end') args.quietEnd = argv[++i];
    else if (key === '--quiet-disabled') args.quietDisabled = true;
    else throw new Error(`未知参数：${key}`);
  }
  if (!args.records) throw new Error('缺少 --records <records.json>');
  return args;
}

const args = parseArgs(process.argv);
const now = Date.parse(args.now);
if (!Number.isFinite(now)) throw new Error(`--now 不是合法时间：${args.now}`);

const raw = JSON.parse(readFileSync(args.records, 'utf8'));
const records = (Array.isArray(raw) ? raw : [raw]).map((item, index) => {
  if (!item || !item.url) throw new Error(`第 ${index + 1} 条记录缺少 url`);
  const normalizedUrl = normalizeUrl(item.url);
  const stage = Number.isInteger(item.stage) ? item.stage : 1;
  const nextReviewAt = Number.isFinite(item.nextReviewAt) ? item.nextReviewAt : nextReviewAtFor(Math.min(stage, 3), now) ?? now;
  return { title: item.title || normalizedUrl, normalizedUrl, stage, nextReviewAt, createdAt: item.createdAt ?? now };
});

const quietHours = { enabled: !args.quietDisabled, start: args.quietStart, end: args.quietEnd };
const quiet = inQuietHours(quietHours, now);
const dueRecords = records.filter((record) => isDue(record, now));

const decision = {
  at: new Date(now).toISOString(),
  quietHours,
  inQuietHours: quiet,
  recordCount: records.length,
  dueCount: dueRecords.length,
  notify: false,
  reason: quiet ? 'quiet_hours' : dueRecords.length ? 'due' : 'nothing_due',
  selected: null,
  digest: dueRecords.length > 1,
};
if (!quiet && dueRecords.length) {
  decision.notify = true;
  const next = selectNextDue(records, now);
  decision.selected = dueRecords.length > 1 ? null : { normalizedUrl: next.normalizedUrl, title: next.title, stage: next.stage };
}

console.log(JSON.stringify(decision, null, 2));
for (const record of records) {
  console.log(JSON.stringify({
    normalizedUrl: record.normalizedUrl,
    stage: record.stage,
    nextReviewAt: new Date(record.nextReviewAt).toISOString(),
    due: isDue(record, now),
    selected: decision.selected?.normalizedUrl === record.normalizedUrl,
  }));
}
