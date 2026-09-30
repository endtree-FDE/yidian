import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const sharedSource = await readFile(new URL('../extension/shared.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../extension/pet.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../extension/pet.css', import.meta.url), 'utf8');

function declarationsFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]]+)\\}`));
  if (!match) return {};
  return Object.fromEntries(match[1].split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf(':');
    return [item.slice(0, index).trim(), item.slice(index + 1).replace(/!important/g, '').trim()];
  }));
}

const resetMatch = css.match(/#otter-yidian-root,\s*#otter-yidian-root \*\s*\{([^}]+)\}/);
const resetStyle = Object.fromEntries(resetMatch[1].split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
  const index = item.indexOf(':');
  return [item.slice(0, index).trim(), item.slice(index + 1).replace(/!important/g, '').trim()];
}));
const petBaseStyle = declarationsFor('#otter-yidian-pet');

class FakeClassList {
  values = new Set();
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    if (force === undefined ? !this.values.has(value) : force) this.values.add(value);
    else this.values.delete(value);
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(id = '', viewport = { width: 1280, height: 720 }) {
    this.id = id;
    this.viewport = viewport;
    this.hidden = false;
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = new FakeClassList();
    this.listeners = {};
    this.offsetWidth = id.includes('pet') ? 108 : 260;
    this.offsetHeight = id.includes('pet') ? 126 : id.includes('card') ? 340 : 180;
    this.textContent = '';
    this.captured = new Set();
    this.innerHTML = '';
    this.children = new Set();
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type, props = {}) {
    const event = { preventDefault() {}, target: this, isTrusted: true, ...props };
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  closest(selector) { return selector === 'button[data-action]' && this.dataset.action ? this : null; }
  contains(element) { return element === this || this.children.has(element); }
  getBoundingClientRect() {
    if (this.id === 'otter-yidian-root') return { top: 0, left: 0, right: this.viewport.width, bottom: this.viewport.height, width: this.viewport.width, height: this.viewport.height };
    let left = 0;
    let top = 0;
    let width = this.offsetWidth;
    let height = this.offsetHeight;
    if (this.id === 'otter-yidian-pet') {
      left = Number.parseFloat(petBaseStyle.left) || 0;
      top = petBaseStyle.top?.startsWith('calc(100vh') ? this.viewport.height - 142 : Number.parseFloat(petBaseStyle.top) || 0;
      const match = String(this.style.transform || '').match(/translate3d\(([-\d.]+)px,([-\d.]+)px/);
      if (match) { left += Number(match[1]); top += Number(match[2]); }
    } else if (this.id === 'otter-yidian-card') {
      left = Number.parseFloat(this.style.left) || 0;
      top = Number.parseFloat(this.style.top) || 0;
      width = Math.min(310, this.viewport.width - 24);
    }
    return { top, left, right: left + width, bottom: top + height, width, height };
  }
}

function createHarness({ reducedMotion = false, record = null, due = false, canEncounter = true, selection = '', canonicalUrl = '' } = {}) {
  const viewport = { width: 1280, height: 720 };
  const elements = new Map();
  const appended = [];
  const runtimeListeners = [];
  const sent = [];
  const raf = [];
  const documentListeners = {};
  let hook;
  const documentElement = {
    append(root) {
      appended.push(root);
      elements.set(root.id, root);
      for (const element of elements.values()) root.children.add(element);
    },
  };
  const document = {
    title: '初始标题',
    documentElement,
    getElementById(id) { return elements.get(id) ?? null; },
    querySelector(selector) { return selector === 'link[rel="canonical"]' && canonicalUrl ? { href: canonicalUrl } : null; },
    createElement() {
      const root = new FakeElement('', viewport);
      Object.defineProperty(root, 'innerHTML', {
        set(value) {
          this._innerHTML = value;
          for (const id of ['otter-yidian-pet','otter-yidian-card','otter-yidian-toast','otter-yidian-liquid']) {
            elements.set(id, new FakeElement(id, viewport));
          }
          elements.get('otter-yidian-card').hidden = true;
        },
        get() { return this._innerHTML || ''; },
      });
      root.querySelector = (selector) => elements.get(selector.slice(1));
      return root;
    },
    addEventListener(type, fn) { (documentListeners[type] ??= []).push(fn); },
    dispatch(type, props = {}) { for (const fn of documentListeners[type] ?? []) fn({ target: document, ...props }); },
  };
  const location = { href: 'https://example.com/first', hostname: 'example.com' };
  const chrome = {
    runtime: {
      async sendMessage(message) {
        sent.push(structuredClone(message));
        if (message.type === 'get-pet-state') return {
          ok: true, record, currentRecord: record, dueRecord: due ? record : null,
          isDue: due, canEncounter, settings: { reducedMotion },
        };
        if (message.type === 'remove-record') return { ok: true, removed: true };
        if (message.type === 'mark-current') return { ok: true, created: true };
        if (message.type === 'complete-review') return { ok: true, changed: true };
        if (message.type === 'set-reduced-motion') { reducedMotion = Boolean(message.value); return { ok: true }; }
        return { ok: true };
      },
      onMessage: { addListener(fn) { runtimeListeners.push(fn); } },
    },
  };
  const context = vm.createContext({
    document, location, chrome, innerWidth: viewport.width, innerHeight: viewport.height,
    performance: { now: () => 1_000 },
    requestAnimationFrame(fn) { raf.push(fn); return raf.length; },
    setInterval() { return 1; }, setTimeout(fn) { fn(); return 1; }, clearTimeout() {},
    getSelection: () => ({ toString: () => selection }),
    addEventListener() {}, matchMedia: () => ({ matches: false }),
    getComputedStyle(element) {
      const hostStyle = { margin: '64px', padding: '20px', opacity: '0.8', boxSizing: 'content-box', display: element.hidden ? 'none' : 'block', visibility: 'visible' };
      if (element.id?.startsWith('otter-yidian-')) {
        return {
          ...hostStyle,
          margin: resetStyle.margin || hostStyle.margin,
          padding: resetStyle.padding || hostStyle.padding,
          opacity: resetStyle.opacity || hostStyle.opacity,
          boxSizing: resetStyle['box-sizing'] || hostStyle.boxSizing,
        };
      }
      return hostStyle;
    },
    structuredClone, console, Date, Intl,
    __YIDIAN_TEST_HOOK__(value) { hook = value; },
  });
  vm.runInContext(sharedSource, context);
  vm.runInContext(source, context);
  return {
    context, document, location, chrome, elements, appended, runtimeListeners, sent, raf, viewport,
    get hook() { return hook; },
    async flush() { await new Promise((resolve) => setImmediate(resolve)); },
  };
}

const record = {
  title: '已记录文档', sourceDomain: 'example.com', stage: 1,
  nextReviewAt: Date.now() + 86_400_000, normalizedUrl: 'https://example.com/first',
  url: 'https://example.com/first',
};

test('1280×720 宿主全局 div 干扰下宠物和卡片仍可见且位于视口内', async () => {
  const harness = createHarness();
  await harness.flush();
  const root = harness.document.getElementById('otter-yidian-root');
  const { pet, card } = harness.hook;
  assert.ok(root, '宠物 root 应存在');
  const petRect = pet.getBoundingClientRect();
  assert.ok(petRect.top >= 0);
  assert.ok(petRect.left >= 0);
  assert.ok(petRect.bottom <= harness.viewport.height);
  assert.ok(petRect.right <= harness.viewport.width);
  const computed = harness.context.getComputedStyle(pet);
  assert.equal(computed.opacity, '1');
  assert.equal(computed.margin, '0');
  assert.equal(computed.padding, '0');
  assert.equal(computed.boxSizing, 'border-box');
  assert.notEqual(computed.display, 'none');
  pet.dispatch('click');
  const cardRect = card.getBoundingClientRect();
  assert.equal(card.hidden, false);
  assert.ok(cardRect.top >= 0);
  assert.ok(cardRect.left >= 0);
  assert.ok(cardRect.bottom <= harness.viewport.height);
  assert.ok(cardRect.right <= harness.viewport.width);
  assert.equal(harness.context.getComputedStyle(card).opacity, '1');
});

test('同一页面重复执行脚本只保留一个宠物', () => {
  const harness = createHarness();
  vm.runInContext(source, harness.context);
  assert.equal(harness.appended.length, 1);
  assert.equal(harness.document.getElementById('otter-yidian-root'), harness.appended[0]);
});

test('卡片展开和拖动期间暂停巡游，pointercancel 正确结束拖动', async () => {
  const harness = createHarness();
  await harness.flush();
  const { pet, card, roam, snapshot } = harness.hook;
  const start = snapshot().x;
  pet.dispatch('click');
  assert.equal(card.hidden, false);
  roam(10_000);
  assert.equal(snapshot().x, start, '卡片展开时位置不应变化');
  pet.dispatch('pointerdown', { pointerId: 7, clientX: 30, clientY: 600 });
  pet.dispatch('pointermove', { pointerId: 7, clientX: 130, clientY: 500 });
  const dragged = snapshot().x;
  roam(10_000);
  assert.equal(snapshot().x, dragged, '拖动期间位置不应被巡游覆盖');
  pet.dispatch('pointercancel', { pointerId: 7 });
  assert.equal(snapshot().dragging, false);
  assert.equal(snapshot().pointerId, null);
});

test('减少动态时停止巡游但仍可拖动', async () => {
  const harness = createHarness({ reducedMotion: true });
  await harness.flush();
  const { pet, card, roam, snapshot } = harness.hook;
  card.hidden = true;
  const start = snapshot().x;
  roam(10_000);
  assert.equal(snapshot().x, start);
  pet.dispatch('pointerdown', { pointerId: 3, clientX: 30, clientY: 600 });
  pet.dispatch('pointermove', { pointerId: 3, clientX: 110, clientY: 520 });
  assert.notEqual(snapshot().x, start);
  pet.dispatch('pointerup', { pointerId: 3 });
});

test('拖动按起点累计 5px，关闭卡片且不误触点击', async () => {
  const harness = createHarness();
  await harness.flush();
  const { pet, card, snapshot } = harness.hook;
  pet.dispatch('click');
  assert.equal(card.hidden, false);
  pet.dispatch('pointerdown', { pointerId: 9, clientX: 30, clientY: 600 });
  assert.equal(card.hidden, true);
  for (let i = 1; i <= 6; i += 1) {
    pet.dispatch('pointermove', { pointerId: 9, clientX: 30 + i, clientY: 600 });
  }
  assert.equal(snapshot().moved, true);
  assert.equal(snapshot().x, 30);
  pet.dispatch('pointerup', { pointerId: 9 });
});

test('点击网页空白处关闭卡片', async () => {
  const harness = createHarness();
  await harness.flush();
  const { pet, card } = harness.hook;
  pet.dispatch('click');
  assert.equal(card.hidden, false);
  harness.document.dispatch('pointerdown', { target: {} });
  assert.equal(card.hidden, true);
});

test('Mark 点击时读取 SPA 路由最新标题和 URL', async () => {
  const harness = createHarness();
  await harness.flush();
  harness.document.title = 'Notion 新页面';
  harness.location.href = 'https://www.notion.so/workspace/new-page';
  const button = new FakeElement('mark-button');
  button.dataset.action = 'mark';
  harness.hook.card.dispatch('click', { target: button });
  await harness.flush();
  const message = harness.sent.findLast((item) => item.type === 'mark-current');
  assert.deepEqual(message.tab, { title: 'Notion 新页面', url: 'https://www.notion.so/workspace/new-page' });
  assert.equal('operationId' in message, false);
});

test('选中文本会显示并随 Mark 保存为收藏上下文', async () => {
  const harness = createHarness({ selection: '  一段值得再见的内容  ' });
  await harness.flush();
  assert.match(harness.hook.card.innerHTML, /一段值得再见的内容/);
  const button = new FakeElement('mark-button');
  button.dataset.action = 'mark';
  harness.hook.card.dispatch('click', { target: button });
  await harness.flush();
  const message = harness.sent.findLast((item) => item.type === 'mark-current');
  assert.equal(message.tab.excerpt, '一段值得再见的内容');
});
test('页面 canonical 链接会随 Mark 一起发送', async () => {
  const harness = createHarness({ canonicalUrl: 'https://example.com/canonical' });
  await harness.flush();
  const button = new FakeElement('mark-button');
  button.dataset.action = 'mark';
  harness.hook.card.dispatch('click', { target: button });
  await harness.flush();
  assert.equal(harness.sent.findLast((item) => item.type === 'mark-current').tab.canonicalUrl, 'https://example.com/canonical');
});


test('工具栏 show-pet 消息会直接打开收藏卡片', async () => {
  const harness = createHarness();
  await harness.flush();
  harness.hook.card.hidden = true;
  const listener = harness.runtimeListeners[0];
  listener({ type: 'show-pet', mode: 'current' });
  await harness.flush();
  assert.equal(harness.hook.card.hidden, false);
  assert.match(harness.hook.card.innerHTML, /共 4 步/);
  assert.match(harness.hook.card.innerHTML, /收下 1 次，再回看 3 次/);
  assert.doesNotMatch(harness.hook.card.innerHTML, /o-card-pet/);
  assert.match(harness.hook.card.innerHTML, /这页，好像还想再见你/);
  assert.match(harness.hook.card.innerHTML, />替我收好<\/button>/);
  assert.doesNotMatch(harness.hook.card.innerHTML, /完成 25%/);
});

test('侧边栏可向已注入的宠物读取当前网页身份', async () => {
  const harness = createHarness();
  await harness.flush();
  let context;
  harness.runtimeListeners[0]({ type: 'get-page-context' }, null, (value) => { context = value; });
  assert.equal(context.url, harness.location.href);
  assert.equal(context.title, harness.document.title);
});

test('到期卡片明确显示状态、进度和完成动作', async () => {
  const harness = createHarness({ record, due: true });
  await harness.flush();
  assert.match(harness.hook.card.innerHTML, /它回来啦。今天再见一面/);
  assert.match(harness.hook.card.innerHTML, /进度 1\/4/);
  assert.match(harness.hook.card.innerHTML, /相见 1\/4/);
  assert.match(harness.hook.card.innerHTML, /已收下 · 下一步是第 1 次回看/);
  assert.match(harness.hook.card.innerHTML, /data-action="used">用上了/);
  assert.match(harness.hook.card.innerHTML, /data-action="later">稍后再看/);
  assert.match(harness.hook.card.innerHTML, /data-action="retire">不再需要/);
  assert.doesNotMatch(harness.hook.card.innerHTML, /这次回来了/);
});

test('未到期卡片由宠物说出具体到分钟的下次见面时间', async () => {
  const harness = createHarness({ record });
  await harness.flush();
  assert.match(harness.hook.card.innerHTML, /我记得它。\d+月\d+日 \d{2}:\d{2}，再带回来/);
});

test('刚刚收下的当前页只确认已经记下', async () => {
  const harness = createHarness({ record, canEncounter: false });
  await harness.flush();
  assert.ok(harness.hook.card.innerHTML.includes('<button class="o-primary" disabled>刚刚已经记下</button>'));
  assert.doesNotMatch(harness.hook.card.innerHTML, /记下这次偶遇/);
});

test('已收藏的当前页把再次点击表达为途中偶遇', async () => {
  const metRecord = {
    ...record,
    encounters: [
      { type: 'saved', at: Date.now() - 86_400_000, stage: 1 },
      { type: 'encounter', at: Date.now(), stage: 1 },
    ],
  };
  const harness = createHarness({ record: metRecord });
  await harness.flush();
  assert.match(harness.hook.card.innerHTML, /记下这次偶遇/);
  assert.match(harness.hook.card.innerHTML, /途中偶遇 <strong>1<\/strong> 次/);
});

test('卡片把删除移到记录页并提供全部记录入口', async () => {
  const harness = createHarness({ record });
  await harness.flush();
  assert.match(harness.hook.card.innerHTML, /data-action="library"/);
  assert.doesNotMatch(harness.hook.card.innerHTML, /data-action="remove"/);
  const button = new FakeElement('library-button');
  button.dataset.action = 'library';
  harness.hook.card.dispatch('click', { target: button });
  await harness.flush();
  assert.ok(harness.sent.some((item) => item.type === 'open-library'));
});

test('宿主网页伪造的按钮点击不能修改扩展记录', async () => {
  const harness = createHarness();
  await harness.flush();
  const before = harness.sent.length;
  const button = new FakeElement('host-forged-button');
  button.dataset.action = 'mark';
  harness.hook.card.dispatch('click', { target: button, isTrusted: false });
  await harness.flush();
  assert.equal(harness.sent.length, before);
  assert.equal(harness.sent.some((item) => item.type === 'mark-current'), false);
});
