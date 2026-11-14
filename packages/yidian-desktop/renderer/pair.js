// 配对窗：把桌面端生成的一次性码显示出来，让人抄到扩展里去。
// 码与过期时刻由主进程通过 URL 查询串传进来，页面不碰任何存储。
const params = new URLSearchParams(location.search);
const code = (params.get('code') || '').trim();
const expiresAt = Number(params.get('expires') || 0);

const codeEl = document.querySelector('#code');
const copyButton = document.querySelector('#copy');
const statusEl = document.querySelector('#status');
const countdownEl = document.querySelector('#countdown');

codeEl.textContent = code || '------';

function formatRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
}

function tick() {
  const remaining = expiresAt - Date.now();
  if (!expiresAt) {
    countdownEl.textContent = '5 分钟内有效';
    return;
  }
  if (remaining <= 0) {
    countdownEl.textContent = '已过期，请重新生成';
    codeEl.classList.add('is-expired');
    return;
  }
  countdownEl.textContent = `${formatRemaining(remaining)}后失效`;
}

tick();
const timer = setInterval(tick, 1000);
window.addEventListener('beforeunload', () => clearInterval(timer));

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(code);
    statusEl.textContent = '已复制，去扩展里粘贴';
    statusEl.classList.add('is-done');
  } catch {
    statusEl.textContent = `复制失败，请手动记下：${code}`;
    statusEl.classList.add('is-warn');
  }
});
