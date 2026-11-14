// 桌面端回看卡片：一次只带回一份到期内容，不显示积压数量。
// 结构与文案沿用扩展的宠物卡片（.o-* 系列），这样两端看起来是同一只宠物。
(() => {
  const card = document.getElementById('otter-yidian-card');
  const toast = document.getElementById('otter-yidian-toast');
  // 写一句：这一行的文案在 card.html 里（card.js 被字体守卫扫着，不在 JS 里写中文）
  const noteRow = document.getElementById('yidian-note-row');
  const noteEdit = document.getElementById('yidian-note-edit');
  const noteInput = document.getElementById('yidian-note-input');
  const noteSave = document.getElementById('yidian-note-save');
  const { progress, stepCopy } = globalThis.YIDIAN_COPY;
  const reviewTime = new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  let toastTimer = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || '操作失败，请重试');
    return response;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function progressBlock(stage) {
    const percent = progress(stage);
    return `<div class="o-progress" style="--o-progress:${percent}%"><div><strong>${stage === 4 ? '一起走完了' : `相见 ${stage}/4`}</strong><span>${stage === 4 ? '宠物已经长成' : stepCopy(stage)}</span></div><i aria-hidden="true"></i><small>进度 ${stage}/4 · 宠物 ${percent}%</small></div>`;
  }

  function secondaryActions() {
    return `<button class="o-secondary" data-action="clipboard">收下剪贴板</button><button class="o-secondary" data-action="library">我的收藏</button><button class="o-secondary o-hide" data-action="hide">先躲一躲</button>`;
  }

  function render(state) {
    const due = state?.due ?? null;
    const upcoming = state?.upcoming ?? null;
    const recent = state?.recent ?? null;
    const record = due ?? upcoming ?? recent;

    if (!record) {
      card.innerHTML = `<div class="o-head"><p class="o-eyebrow">一点悄悄说</p><p class="o-say">还没有收下什么。</p><h2 class="o-title">在浏览器里按 Ctrl+Shift+Y，或者把链接拖到这里。</h2><p class="o-meta">一点在桌面等你</p></div><div class="o-actions"><button class="o-primary" data-action="clipboard">收下剪贴板里的链接</button>${secondaryActions()}</div>`;
      mountNote(null);
      return;
    }

    const stage = record.stage ?? 1;
    const encounterTotal = record.encounters?.filter((event) => event.type === 'encounter').length ?? 0;
    const encounterNote = encounterTotal ? `<p class="o-encounter"><i></i>途中偶遇 <strong>${encounterTotal}</strong> 次，原来的计划一直在继续</p>` : '';
    const excerpt = record.excerpt ? `<p class="o-excerpt">“${escapeHtml(record.excerpt)}”</p>` : '';
    // 没有选段时用页面的一句话描述顶上：卡片上至少有句能想起来的话。
    const summary = !record.excerpt && record.summary ? `<p class="o-summary">${escapeHtml(record.summary)}</p>` : '';
    // 你自己写的那句排在最前面：你的话 > 你选的段落 > 页面的话。
    const note = record.note ? `<p class="o-note">“${escapeHtml(record.note)}”</p>` : '';

    if (due) {
      card.innerHTML = `<div class="o-head"><p class="o-eyebrow">一点来找你了</p><p class="o-say">它来啦。今天再见一面？</p><h2 class="o-title">${escapeHtml(record.title)}</h2><p class="o-meta">${escapeHtml(record.sourceDomain)}</p></div>${encounterNote}${note}${excerpt}${summary}${progressBlock(stage)}<div class="o-actions"><button class="o-primary" data-action="review">完成这次回看</button><button class="o-open" data-action="open">打开原网页</button>${secondaryActions()}</div>`;
      mountNote(record);
      return;
    }

    const nextReview = reviewTime.format(new Date(record.nextReviewAt));
    card.innerHTML = `<div class="o-head"><p class="o-eyebrow">一点记得</p><p class="o-say">我记得它。${nextReview}，再带回来。</p><h2 class="o-title">${escapeHtml(record.title)}</h2><p class="o-meta">${escapeHtml(record.sourceDomain)}</p></div>${encounterNote}${note}${excerpt}${summary}${progressBlock(stage)}<div class="o-actions"><button class="o-open" data-action="open">打开原网页</button>${secondaryActions()}</div>`;
    mountNote(record);
  }

  // 写一句：行留在 HTML 里，渲染后挂到卡片里、进度条前面。
  // 卡片上已经写好的那一句用 .o-note 展示；点「写一句」才换成输入框。
  function mountNote(record) {
    if (!record) {
      noteRow.hidden = true;
      return;
    }
    noteRow.hidden = false;
    card.insertBefore(noteRow, card.querySelector('.o-progress'));
    noteEdit.textContent = record.note ? noteRow.dataset.edit : noteRow.dataset.write;
    noteEdit.hidden = false;
    noteInput.hidden = true;
    noteSave.hidden = true;
    if (document.activeElement !== noteInput) noteInput.value = record.note || '';
  }

  async function saveNote() {
    try {
      const state = await send({ type: 'desktop-summary' });
      const target = state?.due ?? state?.upcoming ?? state?.recent ?? null;
      if (!target) { showToast(noteRow.dataset.failed); return; }
      const result = await send({ type: 'set-note', normalizedUrl: target.normalizedUrl, note: noteInput.value });
      showToast(result?.ok ? noteRow.dataset.saved : noteRow.dataset.failed);
      await load();
    } catch (error) {
      showToast(error.message || noteRow.dataset.failed);
    }
  }

  noteEdit.addEventListener('click', () => {
    noteEdit.hidden = true;
    noteInput.hidden = false;
    noteSave.hidden = false;
    noteInput.focus();
  });
  noteSave.addEventListener('click', () => { saveNote(); });
  noteInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    saveNote();
  });

  async function act(action) {
    try {
      const state = await send({ type: 'desktop-summary' });
      if (action === 'hide') {
        await window.yidianDesktop.hideCard();
        return;
      }
      if (action === 'review') {
        const target = state?.due ?? null;
        if (!target) { showToast('现在没有到期的内容。'); return; }
        const result = await send({ type: 'complete-review', normalizedUrl: target.normalizedUrl });
        showToast(result.changed ? `${stepCopy(result.record.stage)}。进度 ${result.record.stage}/4，宠物又长大了一点。` : '现在还没到下一次回看。');
      }
      if (action === 'open') {
        const target = state?.due ?? state?.upcoming ?? state?.recent ?? null;
        if (!target) { showToast('还没有可以打开的内容。'); return; }
        await send({ type: 'open-record', url: target.url });
      }
      if (action === 'library') {
        await window.yidianDesktop.hideCard();
        await send({ type: 'open-library' });
        return;
      }
      if (action === 'clipboard') {
        const { text } = await window.yidianDesktop.clipboard();
        const url = String(text ?? '').trim();
        if (!/^https?:\/\//i.test(url)) { showToast('剪贴板里没有链接。'); return; }
        const result = await send({ type: 'desktop-clipboard-mark', url });
        showToast(result?.created ? '已经收下。进度 1/4；满 24 小时后进行第 1 次回看。' : '又遇见它了。原来的计划继续。');
      }
      await load();
    } catch (error) {
      showToast(error.message || '操作失败，请重试');
    }
  }

  card.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (button) act(button.dataset.action);
  });

  /* 桌面端自己的采集：把链接拖到卡片上 */
  for (const type of ['dragenter', 'dragover']) {
    card.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      card.classList.add('o-drop');
    });
  }
  card.addEventListener('dragleave', () => card.classList.remove('o-drop'));
  card.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    card.classList.remove('o-drop');
    const transfer = event.dataTransfer;
    const text = transfer?.getData('text/uri-list') || transfer?.getData('text/plain') || '';
    if (!text.trim()) return;
    await window.yidianDesktop.capture({ url: text, source: '拖拽' });
    await load();
  });

  async function load() {
    try {
      const state = await send({ type: 'desktop-summary' });
      render(state);
      requestAnimationFrame(async () => {
        const width = Math.ceil(document.documentElement.scrollWidth);
        const height = Math.ceil(document.documentElement.scrollHeight);
        await window.yidianDesktop.resizeCard({ width, height });
      });
    } catch (error) {
      showToast(error.message || '读取状态失败');
    }
  }

  window.yidianDesktop.onPush((message) => {
    if (message?.type === 'toast') {
      showToast(message.message ?? '');
      return;
    }
    if (message?.type === 'refresh-card' || message?.type === 'refresh-pet') load();
  });

  load();
})();
