export const DAY_MS = 86_400_000;
export const MAX_STAGE = 4;
export const MAX_EXCERPT_LENGTH = 1_000;
export const MAX_ENCOUNTERS = 100;
export const ENCOUNTER_COOLDOWN_MS = 10 * 60_000;
export const STAGE_PERCENT = Object.freeze({ 1: 25, 2: 50, 3: 75, 4: 100 });
const NEXT_INTERVAL_DAYS = Object.freeze({ 1: 1, 2: 5, 3: 23 });
const ENCOUNTER_TYPES = new Set(['saved', 'review', 'encounter', 'restart']);
const TRACKING_PARAM = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|ocid|wt\.mc_id)$/i;

export function parseWebUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('仅支持 http:// 或 https:// 链接');
  }
  return url;
}

export function normalizeUrl(rawUrl) {
  const url = parseWebUrl(rawUrl);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

export function sourceDomain(rawUrl) {
  return parseWebUrl(rawUrl).hostname.replace(/^www\./, '') || '当前页面';
}

export function fallbackTitle(rawUrl, now = Date.now()) {
  const stamp = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Shanghai'
  }).format(new Date(now));
  return `${sourceDomain(rawUrl)} · ${stamp} 收藏`;
}

export function nextReviewAtFor(stage, completedAt) {
  const days = NEXT_INTERVAL_DAYS[stage];
  return days ? completedAt + days * DAY_MS : null;
}

export function createRecord({ title, url, canonicalUrl = '', excerpt = '', now = Date.now(), skinId = 'fluid-01' }) {
  const normalizedUrl = normalizeUrl(canonicalUrl || url);
  const savedExcerpt = String(excerpt || '').trim().slice(0, MAX_EXCERPT_LENGTH);
  return {
    title: String(title || '').trim() || fallbackTitle(url, now),
    excerpt: savedExcerpt,
    url,
    canonicalUrl: canonicalUrl ? normalizeUrl(canonicalUrl) : '',
    normalizedUrl,
    sourceDomain: sourceDomain(url),
    stage: 1,
    completedAt: now,
    nextReviewAt: nextReviewAtFor(1, now),
    createdAt: now,
    updatedAt: now,
    skinId,
    encounters: [{ type: 'saved', at: now, stage: 1, ...(savedExcerpt ? { excerpt: savedExcerpt } : {}) }],
  };
}

export function isDue(record, now = Date.now()) {
  return record.stage < MAX_STAGE && Number.isFinite(record.nextReviewAt) && record.nextReviewAt <= now;
}

export function advanceRecord(record, now = Date.now()) {
  if (record.stage >= MAX_STAGE) return { changed: false, reason: 'complete', record };
  if (!isDue(record, now)) return { changed: false, reason: 'not_due', record };
  const stage = Math.min(MAX_STAGE, record.stage + 1);
  const advanced = {
    ...record,
    stage,
    completedAt: now,
    nextReviewAt: nextReviewAtFor(stage, now),
    updatedAt: now,
  };
  return {
    changed: true,
    reason: 'advanced',
    record: addEncounter(advanced, { type: 'review', now }),
  };
}

export function restartRecord(record, now = Date.now()) {
  const restarted = {
    ...record,
    stage: 1,
    completedAt: now,
    nextReviewAt: nextReviewAtFor(1, now),
    updatedAt: now,
  };
  return addEncounter(restarted, { type: 'restart', now });
}

export function selectNextDue(records, now = Date.now()) {
  return records
    .filter((record) => isDue(record, now))
    .toSorted((a, b) => a.nextReviewAt - b.nextReviewAt || a.createdAt - b.createdAt)[0] ?? null;
}

export function upsertByNormalizedUrl(records, incoming) {
  const index = records.findIndex((item) => item.normalizedUrl === incoming.normalizedUrl);
  if (index >= 0) return { created: false, records, record: records[index] };
  return { created: true, records: [...records, incoming], record: incoming };
}

export function updateRecordUrl(record, url, now = Date.now()) {
  return {
    ...record,
    url,
    canonicalUrl: '',
    normalizedUrl: normalizeUrl(url),
    sourceDomain: sourceDomain(url),
    updatedAt: now,
  };
}
function cleanEncounter(event) {
  if (!event || !ENCOUNTER_TYPES.has(event.type) || !Number.isFinite(event.at)) return null;
  const stage = Number.isInteger(event.stage) && event.stage >= 1 && event.stage <= MAX_STAGE ? event.stage : 1;
  const excerpt = String(event.excerpt || '').trim().slice(0, MAX_EXCERPT_LENGTH);
  return { type: event.type, at: event.at, stage, ...(excerpt ? { excerpt } : {}) };
}

export function encountersFor(record) {
  const existing = Array.isArray(record.encounters)
    ? record.encounters.map(cleanEncounter).filter(Boolean).toSorted((a, b) => a.at - b.at)
    : [];
  if (existing.length) return existing.slice(-MAX_ENCOUNTERS);
  const createdAt = Number.isFinite(record.createdAt) ? record.createdAt
    : Number.isFinite(record.completedAt) ? record.completedAt
      : Number.isFinite(record.updatedAt) ? record.updatedAt : 0;
  const encounters = [{ type: 'saved', at: createdAt, stage: 1, ...(record.excerpt ? { excerpt: record.excerpt } : {}) }];
  if (record.stage > 1 && Number.isFinite(record.completedAt) && record.completedAt !== createdAt) {
    encounters.push({ type: 'review', at: record.completedAt, stage: record.stage });
  }
  return encounters;
}

export function addEncounter(record, { type = 'encounter', now = Date.now(), excerpt = '' } = {}) {
  if (!ENCOUNTER_TYPES.has(type)) throw new TypeError('Unknown encounter type');
  const savedExcerpt = String(excerpt || '').trim().slice(0, MAX_EXCERPT_LENGTH);
  const encounter = { type, at: now, stage: record.stage, ...(savedExcerpt ? { excerpt: savedExcerpt } : {}) };
  return {
    ...record,
    ...(savedExcerpt ? { excerpt: savedExcerpt } : {}),
    encounters: [...encountersFor(record), encounter].slice(-MAX_ENCOUNTERS),
    updatedAt: now,
  };
}

export function canAddEncounter(record, now = Date.now()) {
  const lastSeenAt = encountersFor(record).at(-1)?.at ?? 0;
  return now - lastSeenAt >= ENCOUNTER_COOLDOWN_MS;
}

export function encounterCount(record) {
  return encountersFor(record).filter((event) => event.type === 'encounter').length;
}
export function consolidateRecords(records) {
  const groups = new Map();
  let changed = false;
  for (const record of records) {
    const identityUrl = record.canonicalUrl || record.url || record.normalizedUrl;
    const normalizedUrl = normalizeUrl(identityUrl);
    const normalized = {
      ...record,
      url: record.url || identityUrl,
      normalizedUrl,
      sourceDomain: sourceDomain(record.url || identityUrl),
      encounters: encountersFor(record),
    };
    if (record.normalizedUrl !== normalizedUrl || !Array.isArray(record.encounters)) changed = true;
    const group = groups.get(normalizedUrl) ?? [];
    group.push(normalized);
    groups.set(normalizedUrl, group);
  }

  const merged = [];
  let mergedCount = 0;
  for (const group of groups.values()) {
    const master = group.toSorted((a, b) =>
      (b.stage || 1) - (a.stage || 1) || (b.updatedAt || 0) - (a.updatedAt || 0)
    )[0];
    const events = group.flatMap((record) => encountersFor(record)).toSorted((a, b) => a.at - b.at);
    let keptSaved = false;
    const unique = new Map();
    for (const event of events) {
      const next = event.type === 'saved' && keptSaved ? { ...event, type: 'encounter' } : event;
      if (next.type === 'saved') keptSaved = true;
      unique.set(`${next.type}|${next.at}|${next.stage}|${next.excerpt || ''}`, next);
    }
    const encounters = [];
    for (const event of unique.values()) {
      if (event.type === 'encounter' && encounters.length
        && event.at - encounters.at(-1).at < ENCOUNTER_COOLDOWN_MS) {
        changed = true;
        continue;
      }
      encounters.push(event);
    }
    encounters.splice(0, Math.max(0, encounters.length - MAX_ENCOUNTERS));
    const latestExcerpt = encounters.toReversed().find((event) => event.excerpt)?.excerpt || master.excerpt;
    const masterUrl = master.canonicalUrl || master.url || master.normalizedUrl;
    merged.push({
      ...master,
      url: master.url || masterUrl,
      excerpt: latestExcerpt,
      normalizedUrl: normalizeUrl(masterUrl),
      sourceDomain: sourceDomain(master.url || masterUrl),
      createdAt: Math.min(...group.map((record) => Number.isFinite(record.createdAt) ? record.createdAt : 0)),
      updatedAt: Math.max(...group.map((record) => Number.isFinite(record.updatedAt) ? record.updatedAt : 0)),
      encounters,
    });
    if (group.length > 1) {
      changed = true;
      mergedCount += group.length - 1;
    }
  }
  return { records: merged, changed, mergedCount };
}

// 按 normalizedUrl 合并两个记录集，同一键取 updatedAt 更新的一条。
// 用于备份导入与归档恢复，纯函数，不依赖 chrome.*。
export function mergeByKey(current, incoming) {
  const merged = new Map(current.map((record) => [record.normalizedUrl, record]));
  for (const record of incoming) {
    const existing = merged.get(record.normalizedUrl);
    if (!existing || record.updatedAt >= existing.updatedAt) merged.set(record.normalizedUrl, record);
  }
  return [...merged.values()];
}

// 校验并规范一条备份记录；无效字段直接抛错，由调用方决定如何提示。
export function normalizeImportedRecord(record, now = Date.now()) {
  if (!record || typeof record !== 'object') throw new TypeError('备份中包含无效记录');
  const stage = Number(record.stage);
  if (!Number.isInteger(stage) || stage < 1 || stage > MAX_STAGE) throw new TypeError('备份中的进度无效');
  const url = String(record.url || '');
  const title = String(record.title || '').trim();
  const excerpt = String(record.excerpt || '').trim();
  const skinId = String(record.skinId || 'fluid-01');
  const canonicalUrl = String(record.canonicalUrl || '');
  const encounters = Array.isArray(record.encounters) ? record.encounters : [];
  if (canonicalUrl.length > 4096 || encounters.length > MAX_ENCOUNTERS) throw new TypeError('Backup encounter history is too large');
  for (const event of encounters) {
    if (!event || !['saved', 'review', 'encounter', 'restart'].includes(event.type)
      || !Number.isFinite(event.at) || String(event.excerpt || '').length > MAX_EXCERPT_LENGTH) {
      throw new TypeError('Backup contains an invalid encounter');
    }
  }
  if (url.length > 4096 || title.length > 500 || excerpt.length > MAX_EXCERPT_LENGTH || skinId.length > 64) {
    throw new TypeError('备份中的文本字段过长');
  }
  const normalizedUrl = normalizeUrl(canonicalUrl || url);
  const completedAt = Number.isFinite(record.completedAt) ? record.completedAt : now;
  const createdAt = Number.isFinite(record.createdAt) ? record.createdAt : completedAt;
  return {
    title: title || sourceDomain(url),
    excerpt,
    url,
    canonicalUrl: canonicalUrl ? normalizeUrl(canonicalUrl) : '',
    normalizedUrl,
    sourceDomain: sourceDomain(url),
    stage,
    completedAt,
    nextReviewAt: stage === MAX_STAGE
      ? null
      : (Number.isFinite(record.nextReviewAt) ? record.nextReviewAt : nextReviewAtFor(stage, completedAt)),
    createdAt,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : completedAt,
    skinId,
    encounters,
  };
}

// 免打扰时段：默认开启。跨午夜时段（如 22:00-08:00）按墙钟时间判定，
// 只影响通知是否发出，不改变记录的到期状态。
const TIME_OF_DAY = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// 墙钟日期键（YYYY-MM-DD），与免打扰同一时区口径；
// 摘要通知"每天一条"的去重按此分日，不按 UTC。
export function dayKeyFor(now = Date.now(), timeZone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  }).format(new Date(now));
}

function minutesOfDay(value) {
  const match = TIME_OF_DAY.exec(String(value ?? '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// 下一个免打扰结束时刻（毫秒时间戳）。Asia/Shanghai 无夏令时，
// 墙钟分钟与 UTC 毫秒等步长推进，可直接用分钟差换算。
// 不在免打扰内时返回 null；到期落在静默期时用它排补发闹钟。
export function quietEndAt(quietHours, now = Date.now(), timeZone = 'Asia/Shanghai') {
  const hours = normalizeQuietHours(quietHours);
  if (!hours.enabled || !inQuietHours(hours, now, timeZone)) return null;
  const end = minutesOfDay(hours.end);
  if (end == null) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  }).formatToParts(new Date(now));
  const minuteNow = Number(parts.find((part) => part.type === 'hour').value % 24) * 60
    + Number(parts.find((part) => part.type === 'minute').value);
  let delta = (end - minuteNow + 1440) % 1440;
  if (delta === 0) delta = 1440; // 恰好在终点不属于静默（终点不含），兜底到明天
  return now + delta * 60_000;
}

export function normalizeQuietHours(input) {
  const candidate = input && typeof input === 'object' ? input : {};
  return {
    enabled: candidate.enabled !== false,
    start: minutesOfDay(candidate.start) != null ? candidate.start.trim() : '22:00',
    end: minutesOfDay(candidate.end) != null ? candidate.end.trim() : '08:00',
  };
}

export function inQuietHours(quietHours, now = Date.now(), timeZone = 'Asia/Shanghai') {
  const hours = normalizeQuietHours(quietHours);
  if (!hours.enabled) return false;
  const start = minutesOfDay(hours.start);
  const end = minutesOfDay(hours.end);
  if (start == null || end == null) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  }).formatToParts(new Date(now));
  const minuteNow = Number(parts.find((part) => part.type === 'hour').value % 24) * 60
    + Number(parts.find((part) => part.type === 'minute').value);
  if (start === end) return false;
  return start < end
    ? minuteNow >= start && minuteNow < end
    : minuteNow >= start || minuteNow < end;
}

// 收藏库搜索：按标题、域名、选段与链接做不区分大小写的模糊匹配。
export function matchesRecordQuery(record, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [record.title, record.sourceDomain, record.excerpt, record.url]
    .map((value) => String(value ?? '').toLowerCase());
  return haystack.some((value) => value.includes(needle));
}

// 温和统计：只描述已经发生的事，不做连续天数、逾期数量等压力口径。
export function summarizeRecords(records) {
  const list = Array.isArray(records) ? records : [];
  const domainCount = new Map();
  let completed = 0;
  let encounters = 0;
  for (const record of list) {
    if (record.stage === MAX_STAGE) completed += 1;
    encounters += encountersFor(record).length;
    const domain = String(record.sourceDomain ?? '');
    if (domain) domainCount.set(domain, (domainCount.get(domain) ?? 0) + 1);
  }
  const topDomains = [...domainCount.entries()]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([domain, count]) => ({ domain, count }));
  return { total: list.length, completed, encounters, topDomains };
}

// Markdown 序列化：每条记录一段，frontmatter 元信息 + 选段 + 足迹。
// 跨宿主共用：扩展导出、CLI、Obsidian 插件都走这一份输出。
const EVENT_LABELS = { saved: '收下', review: '回看', encounter: '途中偶遇', restart: '重新开始' };

export function recordsToMarkdown({ records = [], archived = [], exportedAt = new Date().toISOString() } = {}) {
  const day = (value) => (Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : '');
  const section = (record, status) => {
    const lines = [
      `## [${String(record.title || '未命名').replace(/[[\]]/g, ' ')}](${record.url})`,
      '',
      `- status: ${status}`,
      `- stage: ${record.stage}/${MAX_STAGE}`,
      `- domain: ${record.sourceDomain}`,
      `- savedAt: ${day(record.createdAt)}`,
    ];
    const excerpt = String(record.excerpt || '').trim();
    if (excerpt) lines.push('', `> ${excerpt}`);
    const events = Array.isArray(record.encounters) ? record.encounters : [];
    if (events.length) {
      lines.push('', '### 足迹', '');
      for (const event of events) {
        lines.push(`- ${day(event.at)} ${EVENT_LABELS[event.type] || event.type}（${event.stage}/${MAX_STAGE}）`);
      }
    }
    return lines.join('\n');
  };
  const blocks = [
    ['---', 'source: yidian', `exportedAt: ${exportedAt}`, `total: ${records.length + archived.length}`, '---'].join('\n'),
    '# 一点 · 收藏备份',
    ...records.map((record) => section(record, record.stage >= MAX_STAGE ? '长成' : '进行中')),
    ...archived.map((record) => section(record, '已归档')),
  ];
  return `${blocks.join('\n\n')}\n`;
}
