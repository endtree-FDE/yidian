import { summarizeRecords } from './domain.mjs';

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '操作失败，请重试');
  return response;
}

async function render() {
  const [active, archived] = await Promise.all([
    send({ type: 'list-records' }),
    send({ type: 'list-archived' }),
  ]);
  const summary = summarizeRecords([...active.records, ...archived.records]);
  document.querySelector('#total').textContent = summary.total;
  document.querySelector('#completed').textContent = summary.completed;
  document.querySelector('#encounters').textContent = summary.encounters;
  const domains = document.querySelector('#domains');
  const empty = document.querySelector('#domains-empty');
  domains.replaceChildren();
  if (!summary.topDomains.length) {
    empty.hidden = false;
    return;
  }
  for (const { domain, count } of summary.topDomains) {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = domain;
    const times = document.createElement('span');
    times.textContent = `收下了 ${count} 次`;
    item.append(name, times);
    domains.append(item);
  }
}

render().catch((error) => {
  document.querySelector('.intro').textContent = error.message || '统计暂时读不到数据，请稍后再来。';
});
