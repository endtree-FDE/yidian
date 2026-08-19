(() => {
  const ROOT_ID = 'otter-yidian-root';
  const existing = document.getElementById(ROOT_ID);
  if (existing) return;

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
    <div id="otter-yidian-pet" data-stage="0" role="button" tabindex="0" aria-label="打开一点">
      <div id="otter-yidian-body"><div id="otter-yidian-liquid"></div><div id="otter-yidian-face"><i id="otter-yidian-mouth"></i></div></div>
      <div id="otter-yidian-feet"><i></i><i></i></div>
    </div>
    <section id="otter-yidian-card" aria-live="polite" hidden></section>
    <div id="otter-yidian-toast" role="status"></div>`;
  document.documentElement.append(root);

  const pet = root.querySelector('#otter-yidian-pet');
  const card = root.querySelector('#otter-yidian-card');
  const toast = root.querySelector('#otter-yidian-toast');
  const liquid = root.querySelector('#otter-yidian-liquid');
  const reviewTime = new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const { stepCopy, progress } = globalThis.YIDIAN_COPY;
  let state = null;
  let mode = 'current';
  let x = 24;
  let y = Math.max(18, innerHeight - 142);
  let vx = 0.42;
  let dragging = false;
  let moved = false;
  let pointerId = null;
  let pointerOffsetX = 0;
  let pointerOffsetY = 0;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let idleUntil = performance.now() + 1400;
  let toastTimer = null;

  function page() {
    const excerpt = String(globalThis.getSelection?.()?.toString() ?? '').trim().slice(0, 1000);
    const canonicalUrl = document.querySelector?.('link[rel="canonical"]')?.href || '';
    return { title: document.title || '', url: location.href, ...(canonicalUrl ? { canonicalUrl } : {}), ...(excerpt ? { excerpt } : {}) };
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function setPosition() {
    const maxX = Math.max(0, innerWidth - pet.offsetWidth);
    const maxY = Math.max(0, innerHeight - pet.offsetHeight);
    x = Math.min(maxX, Math.max(0, x));
    y = Math.min(maxY, Math.max(0, y));
    pet.style.transform = `translate3d(${x}px,${y}px,0) scaleX(${vx < 0 ? -1 : 1})`;
    positionCard();
  }
  function positionCard() {
    if (card.hidden) return;
    const cardWidth = Math.min(310, innerWidth - 24);
    const left = Math.min(innerWidth - cardWidth - 12, Math.max(12, x + pet.offsetWidth / 2 - cardWidth / 2));
    const preferredTop = y - card.offsetHeight - 12;
    const above = preferredTop >= 12;
    const top = above ? preferredTop : Math.min(innerHeight - card.offsetHeight - 12, y + pet.offsetHeight + 8);
    card.dataset.placement = above ? 'above' : 'below';
    card.style.left = `${left}px`;
    card.style.top = `${Math.max(12, top)}px`;
    toast.style.left = `${Math.min(innerWidth - 272, Math.max(12, x))}px`;
    toast.style.top = `${Math.max(12, y - 48)}px`;
  }
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
    positionCard();
  }
  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok && response?.error) throw new Error(response.error);
    return response;
  }
  async function load() {
    state = await send({ type:'get-pet-state', page:page(), mode });
    root.classList.toggle('o-reduced', Boolean(state?.settings?.reducedMotion));
    render();
  }
  function render() {
    const record = state?.record ?? null;
    const due = Boolean(state?.isDue);
    const stage = record?.stage ?? 0;
    const currentRecord = state?.currentRecord ?? null;
    const isCurrent = Boolean(record && currentRecord?.normalizedUrl === record.normalizedUrl);
    const liveExcerpt = page().excerpt || '';
    const excerpt = (isCurrent && liveExcerpt) || record?.excerpt || liveExcerpt;
    const encounterTotal = record?.encounters?.filter((event) => event.type === 'encounter').length ?? 0;
    const canEncounter = Boolean(state?.canEncounter);
    pet.dataset.stage = String(stage);
    liquid.style.setProperty('--fill', `${progress(stage)}%`);
    liquid.style.height = `${progress(stage)}%`;
    const domain = location.hostname.replace(/^www\./,'') || '当前页面';
    if (!record) {
      card.innerHTML = `<div class="o-head"><p class="o-eyebrow">一点悄悄说</p><p class="o-say">这页，好像还想再见你。</p><h2 class="o-title">${escapeHtml(document.title || domain)}</h2><p class="o-meta">${escapeHtml(domain)}</p></div>${excerpt ? `<p class="o-excerpt">“${escapeHtml(excerpt)}”</p>` : ''}<div class="o-progress" style="--o-progress:0%"><div><strong>今天先收下</strong><span>往后再见 3 次</span></div><i aria-hidden="true"></i><small>共 4 步 · 收下 1 次，再回看 3 次</small></div><div class="o-actions"><button class="o-primary" data-action="mark">替我收好</button><button class="o-secondary" data-action="motion">${state?.settings?.reducedMotion ? '继续散步' : '安静一下'}</button><button class="o-secondary" data-action="library">我的收藏</button><button class="o-secondary o-hide" data-action="hide">先躲一躲</button></div>`;
    } else {
      const nextReview = reviewTime.format(new Date(record.nextReviewAt));
      const label = stage === 4 ? '一点长大了' : due ? '一点来找你了' : '一点记得';
      const say = stage === 4 ? '见了四次，它已经住进记忆里。' : due ? '它回来啦。今天再见一面？' : `我记得它。${nextReview}，再带回来。`;
      const encounterNote = encounterTotal ? `<p class="o-encounter"><i></i>途中偶遇 <strong>${encounterTotal}</strong> 次，原来的计划一直在继续</p>` : '';
      const primary = due
        ? '<button class="o-primary" data-action="review">完成这次回看</button>'
        : isCurrent && stage === 4
          ? '<button class="o-primary" data-action="restart">从今天再开始一轮</button>'
          : isCurrent && canEncounter
            ? '<button class="o-primary" data-action="mark">记下这次偶遇</button>'
            : isCurrent
              ? '<button class="o-primary" disabled>刚刚已经记下</button>'
              : '';
      const open = isCurrent ? '' : '<button class="o-open" data-action="open">打开原网页</button>';
      card.innerHTML = `<div class="o-head"><p class="o-eyebrow">${label}</p><p class="o-say">${escapeHtml(say)}</p><h2 class="o-title">${escapeHtml(record.title)}</h2><p class="o-meta">${escapeHtml(record.sourceDomain)}</p></div>${encounterNote}${excerpt ? `<p class="o-excerpt">“${escapeHtml(excerpt)}”</p>` : ''}<div class="o-progress" style="--o-progress:${progress(stage)}%"><div><strong>${stage === 4 ? '一起走完了' : `相见 ${stage}/4`}</strong><span>${stage === 4 ? '宠物已经长成' : stepCopy(stage)}</span></div><i aria-hidden="true"></i><small>进度 ${stage}/4 · 宠物 ${progress(stage)}%</small></div><div class="o-actions">${primary}${open}<button class="o-secondary" data-action="motion">${state?.settings?.reducedMotion ? '继续散步' : '安静一下'}</button><button class="o-secondary" data-action="library">我的收藏</button><button class="o-secondary o-hide" data-action="hide">先躲一躲</button></div>`;
    }
    positionCard();
  }
  async function act(action) {
    try {
      if (action === 'hide') { root.hidden = true; card.hidden = true; return; }
      if (action === 'mark') {
        const result = await send({ type:'mark-current', tab:page() });
        if (result.created) {
          showToast('已经收下。进度 1/4；满 24 小时后进行第 1 次回看。');
        } else if (result.alreadySaved) {
          showToast('刚刚已经记下了。原来的计划继续。');
        } else {
          const nextReview = reviewTime.format(new Date(result.record.nextReviewAt));
          showToast(`又遇见它了。原来的计划继续，下次还是 ${nextReview}。`);
        }
      }
      if (action === 'restart') {
        const result = await send({ type:'restart-journey', normalizedUrl:state.record.normalizedUrl });
        showToast(`新的一轮开始了。下次在 ${reviewTime.format(new Date(result.record.nextReviewAt))} 见。`);
      }
      if (action === 'review') {
        const result = await send({ type:'complete-review', normalizedUrl:state.record.normalizedUrl });
        showToast(result.changed ? `${stepCopy(result.record.stage)}。进度 ${result.record.stage}/4，宠物又长大了一点。` : '现在还没到下一次回看。');
      }
      if (action === 'open') await send({ type:'open-record', url:state.record.url });
      if (action === 'library') await send({ type:'open-library' });
      if (action === 'motion') {
        const wasReduced = Boolean(state?.settings?.reducedMotion);
        await send({ type:'set-reduced-motion', value:!wasReduced });
        showToast(wasReduced ? '宠物继续巡游了。' : '宠物会待在这里。');
      }
      await load();
    } catch (error) { showToast(error.message || '操作失败，请重试'); }
  }

  function toggleCard() {
    card.hidden = !card.hidden;
    positionCard();
  }
  function endDrag(event) {
    if (!dragging || (pointerId !== null && event.pointerId !== pointerId)) return;
    dragging = false;
    pet.classList.remove('dragging');
    if (pet.hasPointerCapture?.(event.pointerId)) pet.releasePointerCapture(event.pointerId);
    pointerId = null;
    idleUntil = performance.now() + 2600;
    setPosition();
    setTimeout(() => { moved = false; }, 0);
  }

  card.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const button = event.target.closest('button[data-action]');
    if (button) act(button.dataset.action);
  });
  pet.addEventListener('click', () => {
    if (!moved) toggleCard();
  });
  pet.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleCard(); }
  });
  pet.addEventListener('dragstart', (event) => event.preventDefault());
  pet.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    moved = false;
    pointerId = event.pointerId;
    idleUntil = Infinity;
    pointerOffsetX = event.clientX - x;
    pointerOffsetY = event.clientY - y;
    dragStartClientX = event.clientX;
    dragStartClientY = event.clientY;
    card.hidden = true;
    pet.classList.add('dragging');
    pet.setPointerCapture(event.pointerId);
  });
  pet.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    event.preventDefault();
    const nextX = event.clientX - pointerOffsetX;
    const nextY = event.clientY - pointerOffsetY;
    if (Math.hypot(event.clientX - dragStartClientX, event.clientY - dragStartClientY) >= 5) moved = true;
    x = nextX;
    y = nextY;
    setPosition();
  });
  pet.addEventListener('pointerup', endDrag);
  pet.addEventListener('pointercancel', endDrag);
  document.addEventListener('pointerdown', (event) => {
    if (!card.hidden && !root.contains(event.target)) card.hidden = true;
  });
  addEventListener('resize', setPosition);
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'show-pet') {
      mode = message.mode === 'review' ? 'review' : 'current';
      root.hidden = false;
      card.hidden = false;
      load().catch(() => {});
    }
    if (message.type === 'refresh-pet') load().catch(() => {});
  });

  function roam(now) {
    const systemReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!dragging && card.hidden && now > idleUntil && !state?.settings?.reducedMotion && !systemReduced) {
      x += vx;
      const maxX = Math.max(0, innerWidth - pet.offsetWidth);
      if (x >= maxX || x <= 0) { vx *= -1; x = Math.min(maxX, Math.max(0, x)); }
      setPosition();
    }
    requestAnimationFrame(roam);
  }
  let lastPageKey = `${location.href}\n${document.title}`;
  setInterval(() => {
    const nextPageKey = `${location.href}\n${document.title}`;
    if (nextPageKey !== lastPageKey) { lastPageKey = nextPageKey; load().catch(() => {}); }
  }, 1000);
  setPosition();
  globalThis.__YIDIAN_TEST_HOOK__?.({
    root, pet, card, roam,
    snapshot: () => ({ x, y, dragging, moved, pointerId, idleUntil, mode }),
  });
  requestAnimationFrame(roam);
  load().catch((error) => showToast(error.message || '无法读取当前页面'));
})();
