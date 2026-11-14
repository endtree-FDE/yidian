// 桌面宠物窗：常驻在桌面上的一只水獭。
//
// 它做四件事：显示当前进度、被人拖走、被人点开回看卡片、接住拖过来的链接。
// 采集网页正文仍然由浏览器扩展负责；这里接的是「把链接丢给一点」。
(() => {
  const pet = document.getElementById('otter-yidian-pet');
  const liquid = document.getElementById('otter-yidian-liquid');
  const { progress } = globalThis.YIDIAN_COPY;

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || '操作失败，请重试');
    return response;
  }

  function render(state) {
    const stage = Math.max(0, Math.min(4, Number(state?.petStage ?? 0)));
    pet.dataset.stage = String(stage);
    const fill = `${progress(stage)}%`;
    liquid.style.setProperty('--fill', fill);
    liquid.style.height = fill;
    const due = Boolean(state?.due);
    pet.classList.toggle('o-due', due);
    const title = due
      ? '一点来找你了'
      : state?.upcoming
        ? `下次回看：${new Date(state.upcoming.nextReviewAt).toLocaleString('zh-CN')}`
        : '点开一点';
    pet.setAttribute('title', title);
    pet.setAttribute('aria-label', title);
  }

  async function load() {
    try {
      const state = await send({ type: 'desktop-summary' });
      render(state);
    } catch (error) {
      console.warn('[一点桌面端] 读取状态失败', error?.message ?? error);
    }
  }

  pet.addEventListener('click', () => {
    if (!moved) window.yidianDesktop.toggleCard();
  });

  pet.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      window.yidianDesktop.toggleCard();
    }
  });

  pet.addEventListener('dragstart', (event) => event.preventDefault());

  pet.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    moved = false;
    startX = event.screenX;
    startY = event.screenY;
    pet.classList.add('dragging');
    pet.setPointerCapture?.(event.pointerId);
    window.yidianDesktop.drag({ phase: 'start', pointerX: event.screenX, pointerY: event.screenY });
  });

  pet.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    event.preventDefault();
    if (Math.hypot(event.screenX - startX, event.screenY - startY) >= 4) moved = true;
    window.yidianDesktop.drag({ phase: 'move', pointerX: event.screenX, pointerY: event.screenY });
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    pet.classList.remove('dragging');
    if (pet.hasPointerCapture?.(event.pointerId)) pet.releasePointerCapture(event.pointerId);
    window.yidianDesktop.drag({ phase: 'end' });
    setTimeout(() => { moved = false; }, 0);
  };

  pet.addEventListener('pointerup', endDrag);
  pet.addEventListener('pointercancel', endDrag);

  /* 桌面端自己的采集：把链接拖到宠物身上 */
  for (const type of ['dragenter', 'dragover']) {
    pet.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      pet.classList.add('o-drop');
    });
  }
  pet.addEventListener('dragleave', () => pet.classList.remove('o-drop'));
  pet.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    pet.classList.remove('o-drop');
    const transfer = event.dataTransfer;
    const text = transfer?.getData('text/uri-list') || transfer?.getData('text/plain') || '';
    if (!text.trim()) return;
    await window.yidianDesktop.capture({ url: text, source: '拖拽' });
  });

  window.yidianDesktop.onPush((message) => {
    if (message?.type === 'refresh-pet' || message?.type === 'refresh-card') load();
  });

  load();
  setInterval(load, 30_000);
})();
