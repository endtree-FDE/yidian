import { matchesRecordQuery, recordsToMarkdown } from './domain.mjs';

const recordsRoot = document.querySelector('#records');
const status = document.querySelector('#status');
const template = document.querySelector('#record-template');
const migrationGuide = document.querySelector('#migration-guide');
const archiveButton = document.querySelector('#archive-grown');
const searchInput = document.querySelector('#search');
const { progress, stepCopy } = globalThis.YIDIAN_COPY;
const reviewTime = new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
const encounterTime = new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
let activeFilter = 'all';
let activeQuery = '';
let currentRecords = [];
let currentArchived = [];

function encountersFor(record) {
  return Array.isArray(record.encounters) ? record.encounters : [];
}

function encounterCount(record) {
  return encountersFor(record).filter((event) => event.type === 'encounter').length;
}

function eventCopy(event) {
  if (event.type === 'saved') return '收下这条';
  if (event.type === 'encounter') return '途中偶遇，原计划继续';
  if (event.type === 'restart') return '从今天开始新一轮';
  if (event.type === 'review') return `完成第 ${Math.max(1, event.stage - 1)} 次回看`;
  return '见了一面';
}

function matchesFilter(record, now) {
  if (activeFilter === 'due') return record.stage < 4 && record.nextReviewAt <= now;
  if (activeFilter === 'active') return record.stage < 4;
  if (activeFilter === 'encountered') return encounterCount(record) > 0;
  if (activeFilter === 'complete') return record.stage === 4;
  return true;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '操作失败，请重试');
  return response;
}

function stateLabel(record, now = Date.now()) {
  if (record.stage === 4) return '回看计划已完成 · 宠物长成';
  if (record.nextReviewAt <= now) return `今天待回看 · 进度 ${record.stage}/4`;
  return `等待下次回看 · 进度 ${record.stage}/4`;
}

function nextLabel(record) {
  if (record.stage === 4) return '三次回看已经完成';
  return `下次回看：${reviewTime.format(new Date(record.nextReviewAt))} 后可回看`;
}

function render(records) {
  currentRecords = records;
  const now = Date.now();
  const archivedView = activeFilter === 'archived';
  const source = archivedView ? currentArchived : records;
  const visibleRecords = source.filter((record) => matchesRecordQuery(record, activeQuery) && matchesFilter(record, now));
  document.querySelector('#total').textContent = records.length;
  document.querySelector('#due').textContent = records.filter((item) => item.stage < 4 && item.nextReviewAt <= now).length;
  document.querySelector('#complete').textContent = records.filter((item) => item.stage === 4).length;
  document.querySelector('#encounters').textContent = records.reduce((total, record) => total + encounterCount(record), 0);
  archiveButton.disabled = !records.some((item) => item.stage === 4);
  recordsRoot.replaceChildren();
  if (!records.length && !archivedView && !migrationGuide.dataset.seen) {
    migrationGuide.open = true;
    migrationGuide.dataset.seen = 'true';
  }
  if (!visibleRecords.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    if (archivedView) {
      empty.textContent = currentArchived.length
        ? '归档里没有符合搜索的内容。'
        : '还没有归档。点“归档已完成”，完成回看计划的收藏会收进这里，随时可以带回来。';
    } else if (!source.length) {
      const strong = document.createElement('strong');
      strong.textContent = '还没有收藏。三十秒走一遍：';
      const steps = document.createElement('ol');
      steps.className = 'empty-steps';
      steps.innerHTML = '<li>打开任意普通网页，点工具栏里的“一点”；</li><li>在弹出的卡片里点“替我收好”；</li><li>第 2 天，一点会带它回来见你。见过四次，它长成归档——这里不会变成只进不出的坟墓。</li>';
      const kbdNote = document.createElement('p');
      kbdNote.className = 'empty-kbd';
      const kbd = document.createElement('kbd');
      kbd.textContent = 'Ctrl+Shift+Y';
      kbdNote.append('快捷键 ', kbd, ' 也能随时收下当前页。');
      empty.append(strong, steps, kbdNote);
    } else {
      empty.textContent = '这里暂时没有内容。换一个关系状态看看。';
    }
    recordsRoot.append(empty);
    return;
  }
  for (const record of visibleRecords) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.url = record.normalizedUrl;
    node.querySelector('.record-state').textContent = stateLabel(record, now);
    node.querySelector('h2').textContent = record.title;
    node.querySelector('.record-meta').textContent = `${record.sourceDomain} · ${nextLabel(record)}`;
    const excerpt = node.querySelector('.record-excerpt');
    if (record.excerpt) { excerpt.textContent = `“${record.excerpt}”`; excerpt.hidden = false; }
    const encounterTotal = encounterCount(record);
    const encounterSummary = node.querySelector('.encounter-summary');
    if (encounterTotal) {
      encounterSummary.textContent = `途中偶遇 ${encounterTotal} 次 · 原来的计划一直在继续`;
      encounterSummary.hidden = false;
    }
    const history = encountersFor(record).toSorted((a, b) => a.at - b.at).slice(-6);
    const footprints = node.querySelector('.footprints');
    footprints.hidden = history.length < 2;
    const list = footprints.querySelector('ol');
    for (const event of history) {
      const item = document.createElement('li');
      item.className = event.type;
      const time = document.createElement('time');
      time.dateTime = new Date(event.at).toISOString();
      time.textContent = encounterTime.format(new Date(event.at));
      const copy = document.createElement('span');
      copy.textContent = eventCopy(event);
      item.append(time, copy);
      list.append(item);
    }
    node.querySelector('.progress span').style.width = `${progress(record.stage)}%`;
    node.querySelector('.progress').setAttribute('aria-label', `进度 ${record.stage}/4，${stepCopy(record.stage)}，宠物成长 ${progress(record.stage)}%`);
    node.querySelector('.open').addEventListener('click', () => send({ type:'open-record', url:record.url }).catch(showError));
    node.querySelector('.delete').addEventListener('click', async () => {
      if (!confirm(`删除“${record.title}”的本地记录？`)) return;
      try { await send({ type:'remove-record', normalizedUrl:record.normalizedUrl }); await load('记录已删除'); }
      catch (error) { showError(error); }
    });
    const restore = node.querySelector('.restore');
    if (archivedView) {
      restore.hidden = false;
      restore.addEventListener('click', async () => {
        try { await send({ type:'restore-record', normalizedUrl:record.normalizedUrl }); await load('已带回收藏库'); }
        catch (error) { showError(error); }
      });
    }
    recordsRoot.append(node);
  }
}

function showError(error) { status.textContent = error.message || '操作失败，请重试'; }

async function load(message = '') {
  const [response, archivedResponse] = await Promise.all([
    send({ type:'list-records' }),
    send({ type:'list-archived' }),
  ]);
  currentArchived = archivedResponse.records;
  render(response.records);
  status.textContent = message;
}

searchInput.addEventListener('input', () => {
  activeQuery = searchInput.value;
  render(currentRecords);
});

archiveButton.addEventListener('click', async () => {
  if (!confirm('把已完成回看计划的收藏收进归档？它们会从收藏库中隐藏，随时可在“已归档”里找回。')) return;
  try {
    const result = await send({ type:'archive-grown' });
    await load(result.archived ? `已把 ${result.archived} 份完成的收藏收进归档` : '暂时没有可归档的收藏');
  } catch (error) { showError(error); }
});

for (const button of document.querySelectorAll('.filters button')) {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    for (const item of document.querySelectorAll('.filters button')) {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    }
    render(currentRecords);
  });
}

document.querySelector('#export').addEventListener('click', async () => {
  try {
    const [response, archivedResponse] = await Promise.all([
      send({ type:'list-records' }),
      send({ type:'list-archived' }),
    ]);
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      records: response.records,
      archived: archivedResponse.records,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `yidian-backup-${new Date().toISOString().slice(0,10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    status.textContent = archivedResponse.records.length
      ? `已导出 ${response.records.length} 份记录（另含 ${archivedResponse.records.length} 份归档）`
      : `已导出 ${response.records.length} 份记录`;
  } catch (error) { showError(error); }
});

document.querySelector('#export-markdown').addEventListener('click', async () => {
  try {
    const [response, archivedResponse] = await Promise.all([
      send({ type:'list-records' }),
      send({ type:'list-archived' }),
    ]);
    const markdown = recordsToMarkdown({ records: response.records, archived: archivedResponse.records });
    const blob = new Blob([markdown], { type:'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `yidian-${new Date().toISOString().slice(0,10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
    status.textContent = '已导出 Markdown，可直接放进 Obsidian 或任何笔记库。';
  } catch (error) { showError(error); }
});

document.querySelector('#import').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 5_000_000) {
    showError(new Error('备份文件不能超过 5 MB'));
    event.target.value = '';
    return;
  }
  try {
    const payload = JSON.parse(await file.text());
    const result = await send({ type:'import-records', records:payload.records ?? payload, archived:payload.archived });
    await load(`已带回 ${result.imported} 份记录，现在共有 ${result.total} 份收藏`);
  } catch (error) { showError(error); }
  event.target.value = '';
});

const notifyToggle = document.querySelector('#notify-toggle');
const quietToggle = document.querySelector('#quiet-toggle');
const quietStart = document.querySelector('#quiet-start');
const quietEnd = document.querySelector('#quiet-end');

function applyQuietControls(quietHours) {
  quietToggle.checked = Boolean(quietHours.enabled);
  quietStart.value = quietHours.start;
  quietEnd.value = quietHours.end;
  quietStart.disabled = !quietHours.enabled;
  quietEnd.disabled = !quietHours.enabled;
}

async function initSettings() {
  try {
    const { settings } = await send({ type:'get-settings' });
    notifyToggle.checked = Boolean(settings.notifyOnDue);
    applyQuietControls(settings.quietHours);
  } catch (error) { showError(error); }
}
notifyToggle.addEventListener('change', async () => {
  try {
    await send({ type:'set-notify-on-due', value:notifyToggle.checked });
    status.textContent = notifyToggle.checked ? '好，到期时一点会轻轻提醒你。' : '好，一点继续安静地等。';
  } catch (error) { showError(error); notifyToggle.checked = !notifyToggle.checked; }
});

async function saveQuietHours() {
  try {
    const result = await send({
      type:'set-quiet-hours',
      value:{ enabled:quietToggle.checked, start:quietStart.value, end:quietEnd.value },
    });
    applyQuietControls(result.settings.quietHours);
    status.textContent = quietToggle.checked
      ? `好，${result.settings.quietHours.start} 到 ${result.settings.quietHours.end} 之间不打扰你。`
      : '好，到期时一点不再分时段安静。';
  } catch (error) { showError(error); await initSettings(); }
}
quietToggle.addEventListener('change', saveQuietHours);
quietStart.addEventListener('change', saveQuietHours);
quietEnd.addEventListener('change', saveQuietHours);
initSettings();

load().catch(showError);
