# Document Revisit Companion MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally stored Chromium extension that lets a user Mark the current web document in five seconds, immediately receive 25% progress, and revisit the original URL on a 1 / 2 / 7 / 30 rhythm with a fluid companion.

**Architecture:** A Manifest V3 service worker is the only writer for document mutations and badge state. A native Side Panel renders four product states from `chrome.storage.local`; pure ES-module domain functions own URL normalization, scheduling, due ordering, and idempotent stage changes. No content script, backend, framework, build step, or document-body access is used.

**Tech Stack:** Chrome 116+ Manifest V3; vanilla HTML, CSS, and JavaScript ES modules; Chrome Side Panel, Commands, Active Tab, Storage, Alarms, Action, Tabs, and Runtime APIs; Node.js 20+ built-in `node:test`.

## Global Constraints

- First Mark creates stage 1 immediately: 25% progress and one completion timestamp.
- Later gaps are exactly 1, 5, and 23 elapsed days from the actual completion time; stage 4 has no next review.
- One due document is shown at a time; order by earliest `nextReviewAt`, then earliest `createdAt`.
- Delays never reset progress, create review debt, or advance more than one stage.
- Store only title, original URL, normalized URL, source hostname, timestamps, stage, and settings; never read or store body text.
- URL normalization validates HTTP(S), trims surrounding whitespace, and removes only the fragment; query parameters remain.
- Use `chrome.storage.local`; no account, backend, sync, analytics, telemetry, or network request.
- Permissions are exactly `activeTab`, `alarms`, `sidePanel`, and `storage`; no `tabs`, host permissions, content scripts, notifications, or unlimited storage.
- The shortcut always opens current-document mode; the toolbar action opens review mode only when something is due.
- The badge is a dot, never an overdue count.
- All user-controlled titles and URLs enter the DOM through properties such as `textContent` and `value`, never interpolated HTML.
- Respect both `prefers-reduced-motion` and the extension’s `reducedMotion` setting.
- UI copy says the document was “seen” or “revisited”; it never claims that 25–100% measures mastery.
- The test version implements one CSS fluid skin. `skinId` remains fixed to `fluid-default`.

---

## Mature Patterns to Borrow Deliberately

| Mature case | Borrow | Explicitly do not borrow |
|---|---|---|
| [Readwise Daily Review](https://docs.readwise.io/readwise/docs/faqs/reviewing-highlights) | A focused resurfacing session and a direct path back to source material | Highlight ingestion, full-text library, frequency controls, AI, and a daily workload |
| [RemNote global review queue](https://help.remnote.com/en/articles/6022755-getting-started-with-spaced-repetition) | Select the due item for the user instead of requiring manual tracking | Flashcard creation, recall scoring, streaks, daily goals, SM-2, and FSRS |
| [Finch goal completion](https://help.finchcare.com/hc/en-us/articles/37779940291213-Creating-and-Completing-Goals) | One simple action produces immediate companion energy and visible emotional reward | Currency, shop, quests, social comparison, and daily punishment pressure |
| [flomo review](https://help.flomoapp.com/) | Low-pressure capture and gentle resurfacing of something the user already values | Copying notes into a new knowledge base and adding organization work before the first reward |
| [Cubox review](https://help.cubox.pro/adv/a3ad/) | A reminder card can return the user to the original material | Content extraction, permanent archive, highlight storage, AI, push notifications, and another inbox |
| [Feishu document tasks](https://www.feishu.cn/hc/en-US/articles/545362352539/) | A document can be the anchor for a follow-up action | Assignees, deadlines, task-center synchronization, and obligation-heavy language |
| [Chrome Side Panel sample](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/cookbook.sidepanel-open) | Native side panel opened only from a user gesture | Custom floating windows and persistent page injection |

## Adversarial Review Gates

| Attack on the idea | MVP defense | Evidence required before completion |
|---|---|---|
| “25% looks like mastery even though the user only clicked.” | Label it document growth, use `今天见过了` / `这次看完了`, and never use `掌握度`. | Copy scan in the smoke test. |
| “The pet regresses when switching from a 75% document to a 25% document.” | Keep the current document title next to the pet and label the meter `这份文档的成长`. Do not present a global pet level. | Switch between two records at different stages. |
| “A hidden backlog can starve newer documents.” | Deterministic oldest-due-first ordering, then immediately reveal the next item after completion; still show no count. | Unit test tie-breaking and manual three-record queue check. |
| “The toolbar dot is too easy to ignore.” | Keep the low-pressure dot for this validation round. Measure willingness to return before adding system notifications. | Record this as a product hypothesis in README, not as a technical defect. |
| “A shortcut collision means the core action silently fails.” | Check `chrome.commands.getAll()` in the side panel and show the exact `chrome://extensions/shortcuts` recovery path when unassigned. | Unassign the shortcut manually and verify the recovery message. |
| “Alarm delivery is not guaranteed.” | Recreate the 60-minute alarm whenever the service worker starts, on install, and on browser startup; always recompute due state from stored timestamps. | Clear the alarm in DevTools, restart the worker, and confirm recreation. |
| “MV3 globals disappear, so state or locks are lost.” | Treat storage as the source of truth. A process-wide promise queue only serializes simultaneous messages while the worker is alive; correctness still comes from `nextReviewAt` and stage guards. | Complete the same due record twice rapidly and confirm one stage change. |
| “Notion/Feishu URLs mutate or contain tracking queries.” | Preserve the confirmed rule: remove only fragments. Provide URL editing without resetting progress; do not invent site-specific rewriting. | Fragment de-duplication test plus query-distinction test. |
| “A private URL leaks learning activity.” | No network requests, analytics, console logging of records, body access, or broad host permissions. | Manifest test and DevTools Network inspection. |
| “Local-only data disappears on uninstall.” | State the limitation in README and UI management text. Do not imply backup or sync. | Documentation review. |

## File Map

| File | Responsibility |
|---|---|
| `extension/manifest.json` | Declare the minimum Chrome version, native panel, command, worker, action, and minimal permissions. |
| `extension/lib/domain.mjs` | Pure URL, record creation, scheduling, state classification, and due-selection logic. |
| `extension/lib/storage.mjs` | Small typed-by-convention wrapper around local and session storage keys. |
| `extension/service-worker.mjs` | Entry routing, serialized mutations, alarm recovery, badge refresh, and message handling. |
| `extension/sidepanel.html` | Static semantic structure; no user data is embedded into markup. |
| `extension/sidepanel.css` | Responsive side-panel layout, fluid companion, focus states, and reduced-motion rules. |
| `extension/sidepanel.mjs` | Read state, create a view model, render safely, and send mutation messages. |
| `tests/domain.test.mjs` | Runnable checks for 1 / 2 / 7 / 30, delays, idempotency, URL rules, and due ordering. |
| `tests/manifest.test.mjs` | Prevent accidental permission or architecture expansion. |
| `docs/testing/mvp-smoke-test.md` | Repeatable Notion-first manual validation, including adversarial cases. |
| `README.md` | Unpacked installation, shortcut recovery, privacy boundary, tests, and known MVP limits. |

### Task 1: Lock the Domain Rules with a Runnable Test

**Files:**
- Create: `tests/domain.test.mjs`
- Create: `extension/lib/domain.mjs`

**Interfaces:**
- Produces: `normalizeUrl(rawUrl: string): string`
- Produces: `createDocument({ id, title, url, nowIso }): DocumentRecord`
- Produces: `advanceDocument(record, nowIso): { changed: boolean, record: DocumentRecord }`
- Produces: `getDocumentState(record, nowIso): 'waiting' | 'due' | 'grown'`
- Produces: `selectDueDocument(records, nowIso): DocumentRecord | null`

- [ ] **Step 1: Write the failing domain test**

Create `tests/domain.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceDocument,
  createDocument,
  getDocumentState,
  normalizeUrl,
  selectDueDocument,
} from '../extension/lib/domain.mjs';

const D1 = '2026-07-01T08:00:00.000Z';
const D2 = '2026-07-02T08:00:00.000Z';
const D4 = '2026-07-04T08:00:00.000Z';
const D7 = '2026-07-07T08:00:00.000Z';
const D9 = '2026-07-09T08:00:00.000Z';
const D30 = '2026-07-30T08:00:00.000Z';

test('on-time reviews produce 25, 50, 75, 100 percent on days 1, 2, 7, 30', () => {
  let record = createDocument({
    id: 'doc-1',
    title: '课程第一讲',
    url: 'https://www.notion.so/course?p=1#section',
    nowIso: D1,
  });

  assert.equal(record.stage, 1);
  assert.equal(record.nextReviewAt, D2);
  assert.equal(normalizeUrl(record.url), 'https://www.notion.so/course?p=1');

  ({ record } = advanceDocument(record, D2));
  assert.equal(record.stage, 2);
  assert.equal(record.nextReviewAt, D7);

  ({ record } = advanceDocument(record, D7));
  assert.equal(record.stage, 3);
  assert.equal(record.nextReviewAt, D30);

  ({ record } = advanceDocument(record, D30));
  assert.equal(record.stage, 4);
  assert.equal(record.nextReviewAt, null);
  assert.equal(record.completedAt.length, 4);
  assert.equal(getDocumentState(record, D30), 'grown');
});

test('a late review rebases the next interval without creating debt', () => {
  const first = createDocument({
    id: 'doc-2',
    title: '',
    url: 'https://example.com/lesson',
    nowIso: D1,
  });
  const { changed, record } = advanceDocument(first, D4);

  assert.equal(changed, true);
  assert.equal(record.stage, 2);
  assert.equal(record.nextReviewAt, D9);
  assert.match(record.title, /^example\.com · /);
});

test('early and repeated completion cannot advance a second time', () => {
  const first = createDocument({
    id: 'doc-3',
    title: '幂等检查',
    url: 'https://example.com/idempotent',
    nowIso: D1,
  });
  const early = advanceDocument(first, '2026-07-01T09:00:00.000Z');
  assert.equal(early.changed, false);
  assert.equal(early.record.stage, 1);

  const firstDue = advanceDocument(first, D2);
  const repeated = advanceDocument(firstDue.record, D2);
  assert.equal(firstDue.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.record.stage, 2);
});

test('normalization removes only the fragment and keeps query identity', () => {
  assert.equal(
    normalizeUrl(' https://example.com/doc?block=1#heading '),
    'https://example.com/doc?block=1',
  );
  assert.notEqual(
    normalizeUrl('https://example.com/doc?block=1'),
    normalizeUrl('https://example.com/doc?block=2'),
  );
  assert.throws(() => normalizeUrl('chrome://extensions'), /HTTP/);
});

test('due selection uses nextReviewAt then createdAt and never returns grown records', () => {
  const laterCreated = {
    ...createDocument({
      id: 'later-created',
      title: 'B',
      url: 'https://example.com/b',
      nowIso: '2026-07-01T09:00:00.000Z',
    }),
    nextReviewAt: D2,
  };
  const earlierCreated = createDocument({
    id: 'earlier-created',
    title: 'A',
    url: 'https://example.com/a',
    nowIso: D1,
  });
  const grown = { ...earlierCreated, id: 'grown', stage: 4, nextReviewAt: null };

  assert.equal(
    selectDueDocument([laterCreated, grown, earlierCreated], D2)?.id,
    'earlier-created',
  );
  assert.equal(selectDueDocument([grown], D30), null);
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run:

```powershell
node --test tests\domain.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `extension/lib/domain.mjs`.

- [ ] **Step 3: Implement the pure domain module**

Create `extension/lib/domain.mjs`:

```js
const DAY_MS = 24 * 60 * 60 * 1000;
const NEXT_GAP_DAYS = Object.freeze({ 1: 1, 2: 5, 3: 23 });

function assertIso(value) {
  if (!value || Number.isNaN(Date.parse(value))) throw new TypeError('Invalid ISO timestamp');
}

function addDays(nowIso, days) {
  assertIso(nowIso);
  return new Date(Date.parse(nowIso) + days * DAY_MS).toISOString();
}

export function normalizeUrl(rawUrl) {
  const value = String(rawUrl ?? '').trim();
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('Only HTTP(S) document URLs are supported');
  }
  const fragmentAt = value.indexOf('#');
  return fragmentAt === -1 ? value : value.slice(0, fragmentAt);
}

export function createDocument({ id, title, url, nowIso }) {
  assertIso(nowIso);
  const normalizedUrl = normalizeUrl(url);
  const source = new URL(normalizedUrl).hostname;
  const safeTitle = String(title ?? '').trim()
    || `${source} · ${new Date(nowIso).toLocaleString('zh-CN', { hour12: false })}`;

  return {
    id,
    title: safeTitle,
    url: String(url).trim(),
    normalizedUrl,
    source,
    stage: 1,
    completedAt: [nowIso],
    nextReviewAt: addDays(nowIso, NEXT_GAP_DAYS[1]),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function advanceDocument(record, nowIso) {
  assertIso(nowIso);
  if (
    record.stage >= 4
    || !record.nextReviewAt
    || Date.parse(nowIso) < Date.parse(record.nextReviewAt)
  ) {
    return { changed: false, record };
  }

  const stage = Math.min(4, record.stage + 1);
  return {
    changed: true,
    record: {
      ...record,
      stage,
      completedAt: [...record.completedAt, nowIso],
      nextReviewAt: stage === 4 ? null : addDays(nowIso, NEXT_GAP_DAYS[stage]),
      updatedAt: nowIso,
    },
  };
}

export function getDocumentState(record, nowIso) {
  if (record.stage >= 4) return 'grown';
  return Date.parse(record.nextReviewAt) <= Date.parse(nowIso) ? 'due' : 'waiting';
}

export function selectDueDocument(records, nowIso) {
  return records
    .filter((record) => getDocumentState(record, nowIso) === 'due')
    .sort((a, b) => (
      a.nextReviewAt.localeCompare(b.nextReviewAt)
      || a.createdAt.localeCompare(b.createdAt)
    ))[0] ?? null;
}
```

- [ ] **Step 4: Run the domain test**

Run:

```powershell
node --test tests\domain.test.mjs
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit the domain contract**

```powershell
git add extension\lib\domain.mjs tests\domain.test.mjs
git commit -m "feat: define document revisit schedule"
```

### Task 2: Create a Permission-Minimal Extension Shell

**Files:**
- Create: `tests/manifest.test.mjs`
- Create: `extension/manifest.json`
- Create: `extension/lib/storage.mjs`
- Create: `extension/service-worker.mjs`
- Create: `extension/sidepanel.html`
- Create: `extension/sidepanel.css`
- Create: `extension/sidepanel.mjs`

**Interfaces:**
- Consumes: domain exports from Task 1.
- Produces: `readState()`, `writeDocuments(documents)`, `writeSettings(settings)`, `readEntryContext(windowId)`, `writeEntryContext(windowId, context)`.
- Produces: an unpacked extension that opens a native side panel from the toolbar action and the `open-current-document` command.

- [ ] **Step 1: Write the manifest boundary test**

Create `tests/manifest.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('manifest keeps the MVP on Chrome 116+ with minimal permissions', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'),
  );

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '116');
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ['activeTab', 'alarms', 'sidePanel', 'storage'].sort(),
  );
  assert.equal('host_permissions' in manifest, false);
  assert.equal('content_scripts' in manifest, false);
  assert.equal('notifications' in manifest.permissions, false);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
});
```

- [ ] **Step 2: Run the manifest test and verify the missing-file failure**

Run:

```powershell
node --test tests\manifest.test.mjs
```

Expected: FAIL with `ENOENT` for `extension/manifest.json`.

- [ ] **Step 3: Create the manifest**

Create `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "12730 · 文档回访伙伴",
  "version": "0.1.0",
  "description": "Mark 当前文档，按 1 / 2 / 7 / 30 节奏温和回访。",
  "minimum_chrome_version": "116",
  "permissions": ["activeTab", "alarms", "sidePanel", "storage"],
  "background": {
    "service_worker": "service-worker.mjs",
    "type": "module"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "打开文档回访伙伴"
  },
  "commands": {
    "open-current-document": {
      "suggested_key": {
        "default": "Alt+Shift+M",
        "mac": "Command+Shift+M"
      },
      "description": "Mark 或查看当前文档"
    }
  }
}
```

- [ ] **Step 4: Implement the storage keys without a repository framework**

Create `extension/lib/storage.mjs`:

```js
const DOCUMENTS_KEY = 'documents';
const SETTINGS_KEY = 'settings';
const DEFAULT_SETTINGS = Object.freeze({
  skinId: 'fluid-default',
  reducedMotion: false,
});

export async function readState() {
  const result = await chrome.storage.local.get([DOCUMENTS_KEY, SETTINGS_KEY]);
  return {
    documents: Array.isArray(result[DOCUMENTS_KEY]) ? result[DOCUMENTS_KEY] : [],
    settings: { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] ?? {}) },
  };
}

export function writeDocuments(documents) {
  return chrome.storage.local.set({ [DOCUMENTS_KEY]: documents });
}

export function writeSettings(settings) {
  return chrome.storage.local.set({
    [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, ...settings },
  });
}

function entryKey(windowId) {
  return `entryContext:${windowId}`;
}

export async function readEntryContext(windowId) {
  const key = entryKey(windowId);
  const result = await chrome.storage.session.get(key);
  return result[key] ?? null;
}

export function writeEntryContext(windowId, context) {
  return chrome.storage.session.set({ [entryKey(windowId)]: context });
}
```

- [ ] **Step 5: Create a shell that proves both user gestures can open the native panel**

Create `extension/service-worker.mjs`:

```js
import { writeEntryContext } from './lib/storage.mjs';

function pageFromTab(tab) {
  if (!tab?.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { tabId: tab.id, title: tab.title ?? '', url: tab.url };
  } catch {
    return null;
  }
}

function openCurrentDocument(tab) {
  if (!Number.isInteger(tab?.windowId)) return;
  const contextWrite = writeEntryContext(tab.windowId, {
    mode: 'current',
    page: pageFromTab(tab),
    openedAt: Date.now(),
  });
  // Call open synchronously inside the gesture handler; awaiting storage first
  // can consume Chrome's transient user activation.
  const panelOpen = chrome.sidePanel.open({ windowId: tab.windowId });
  return Promise.all([contextWrite, panelOpen]);
}

chrome.action.onClicked.addListener(openCurrentDocument);
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-current-document') openCurrentDocument(tab);
});
```

Create `extension/sidepanel.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>文档回访伙伴</title>
    <link rel="stylesheet" href="sidepanel.css">
  </head>
  <body>
    <main>
      <p class="eyebrow">12730 · DOCUMENT REVISIT</p>
      <h1 id="page-title">正在看看这份文档…</h1>
      <p id="page-url"></p>
    </main>
    <script type="module" src="sidepanel.mjs"></script>
  </body>
</html>
```

Create `extension/sidepanel.css`:

```css
:root { color-scheme: light; font-family: system-ui, sans-serif; }
body { margin: 0; background: #f7f5ff; color: #211f2d; }
main { padding: 24px; }
.eyebrow { color: #6b5ca5; font-size: 12px; letter-spacing: .08em; }
#page-url { overflow-wrap: anywhere; color: #625e70; }
```

Create `extension/sidepanel.mjs`:

```js
import { readEntryContext } from './lib/storage.mjs';

const currentWindow = await chrome.windows.getCurrent();
const context = await readEntryContext(currentWindow.id);
const title = document.querySelector('#page-title');
const url = document.querySelector('#page-url');

if (context?.page) {
  title.textContent = context.page.title || '未命名文档';
  url.textContent = context.page.url;
} else {
  title.textContent = '这里还不能 Mark';
  url.textContent = '请在普通 HTTP(S) 网页中再次呼出伙伴。';
}
```

- [ ] **Step 6: Run static checks and load the unpacked shell**

Run:

```powershell
node --test tests\manifest.test.mjs
node --check extension\service-worker.mjs
node --check extension\sidepanel.mjs
```

Expected: all commands exit 0.

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `C:\12730\extension`.

Verify:

1. Toolbar action opens the side panel and displays the current Notion page title and URL.
2. `Alt+Shift+M` opens the panel on Windows.
3. `chrome://extensions` produces the unsupported-page message instead of a record.

- [ ] **Step 7: Commit the secure shell**

```powershell
git add extension tests\manifest.test.mjs
git commit -m "feat: add minimal side panel extension shell"
```

### Task 3: Make the Service Worker the Mutation and Reminder Authority

**Files:**
- Modify: `extension/service-worker.mjs`
- Modify: `extension/lib/storage.mjs`

**Interfaces:**
- Consumes: `createDocument`, `advanceDocument`, `normalizeUrl`, `selectDueDocument`.
- Consumes: storage functions from Task 2.
- Produces messages:
  - `{ type: 'MARK_DOCUMENT', page: { title, url } }`
  - `{ type: 'COMPLETE_REVIEW', id }`
  - `{ type: 'DELETE_RECORD', id }`
  - `{ type: 'UPDATE_URL', id, url }`
  - `{ type: 'UPDATE_SETTINGS', reducedMotion }`
- Produces response: `{ ok: true, record?, created?, changed? }` or `{ ok: false, error }`.

- [ ] **Step 1: Add a smallest-possible local-storage syntax check**

Run before editing:

```powershell
node --check extension\service-worker.mjs
```

Expected: exit 0. This is the baseline check that must remain green after the mutation work.

- [ ] **Step 2: Replace the shell worker with the complete event flow**

Implement these constants and functions in `extension/service-worker.mjs`:

```js
import {
  advanceDocument,
  createDocument,
  normalizeUrl,
  selectDueDocument,
} from './lib/domain.mjs';
import {
  readState,
  writeDocuments,
  writeEntryContext,
  writeSettings,
} from './lib/storage.mjs';

const ALARM_NAME = 'due-review-check';
const MUTATION_TYPES = new Set([
  'MARK_DOCUMENT',
  'COMPLETE_REVIEW',
  'DELETE_RECORD',
  'UPDATE_URL',
  'UPDATE_SETTINGS',
]);

// ponytail: one worker queue covers simultaneous MVP mutations; use transactional
// storage only if writes later come from multiple devices or a backend.
let mutationQueue = Promise.resolve();

function pageFromTab(tab) {
  if (!tab?.url) return null;
  try {
    const parsed = new URL(tab.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return { tabId: tab.id, title: tab.title ?? '', url: tab.url };
  } catch {
    return null;
  }
}

async function refreshBadge() {
  const { documents } = await readState();
  const due = selectDueDocument(documents, new Date().toISOString());
  await chrome.action.setBadgeText({ text: due ? '•' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#6f5bd3' });
  await chrome.action.setTitle({
    title: due ? '有一份文档想再见你' : '打开文档回访伙伴',
  });
}

async function ensureAlarm() {
  if (!await chrome.alarms.get(ALARM_NAME)) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
  }
}

function openPanel(tab, mode) {
  if (!Number.isInteger(tab?.windowId)) return;
  const contextWrite = writeEntryContext(tab.windowId, {
    mode,
    page: pageFromTab(tab),
    openedAt: Date.now(),
  });
  // Keep sidePanel.open in the user-gesture call stack.
  const panelOpen = chrome.sidePanel.open({ windowId: tab.windowId });
  return Promise.all([contextWrite, panelOpen]);
}

async function handleMutation(message) {
  const nowIso = new Date().toISOString();
  const state = await readState();

  if (message.type === 'MARK_DOCUMENT') {
    const normalizedUrl = normalizeUrl(message.page?.url);
    const existing = state.documents.find(
      (record) => record.normalizedUrl === normalizedUrl,
    );
    if (existing) return { ok: true, record: existing, created: false };

    const record = createDocument({
      id: crypto.randomUUID(),
      title: message.page?.title,
      url: message.page?.url,
      nowIso,
    });
    await writeDocuments([...state.documents, record]);
    await refreshBadge();
    return { ok: true, record, created: true };
  }

  const index = state.documents.findIndex((record) => record.id === message.id);
  if (message.type !== 'UPDATE_SETTINGS' && index === -1) {
    throw new Error('这份记录已经不存在');
  }

  if (message.type === 'COMPLETE_REVIEW') {
    const result = advanceDocument(state.documents[index], nowIso);
    if (result.changed) {
      const documents = state.documents.with(index, result.record);
      await writeDocuments(documents);
      await refreshBadge();
    }
    return { ok: true, record: result.record, changed: result.changed };
  }

  if (message.type === 'DELETE_RECORD') {
    await writeDocuments(state.documents.filter((record) => record.id !== message.id));
    await refreshBadge();
    return { ok: true };
  }

  if (message.type === 'UPDATE_URL') {
    const normalizedUrl = normalizeUrl(message.url);
    const collision = state.documents.some(
      (record, recordIndex) => (
        recordIndex !== index && record.normalizedUrl === normalizedUrl
      ),
    );
    if (collision) throw new Error('这个链接已经属于另一份记录');

    const url = String(message.url).trim();
    const record = {
      ...state.documents[index],
      url,
      normalizedUrl,
      source: new URL(normalizedUrl).hostname,
      updatedAt: nowIso,
    };
    await writeDocuments(state.documents.with(index, record));
    return { ok: true, record };
  }

  await writeSettings({
    ...state.settings,
    reducedMotion: Boolean(message.reducedMotion),
  });
  return { ok: true };
}
```

Register the events exactly once:

```js
chrome.action.onClicked.addListener((tab) => openPanel(tab, 'toolbar'));

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-current-document') openPanel(tab, 'current');
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!MUTATION_TYPES.has(message?.type)) return false;
  mutationQueue = mutationQueue
    .then(() => handleMutation(message))
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refreshBadge();
});
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  refreshBadge();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  refreshBadge();
});

ensureAlarm();
refreshBadge();
```

- [ ] **Step 3: Run the complete automated and syntax checks**

Run:

```powershell
node --test tests\domain.test.mjs tests\manifest.test.mjs
node --check extension\service-worker.mjs
```

Expected: 6 tests PASS and syntax check exits 0.

- [ ] **Step 4: Verify alarm recovery and permission behavior in Chrome**

Reload the unpacked extension. In the extension service worker DevTools console run:

```js
await chrome.alarms.clear('due-review-check');
await chrome.alarms.get('due-review-check');
```

Expected: the second expression is `undefined`.

Stop and restart the worker from `chrome://extensions`, reopen its DevTools, then run:

```js
await chrome.alarms.get('due-review-check');
```

Expected: an alarm object with `periodInMinutes: 60`.

Open the extension detail page and verify the permission description does not claim access to all website data or browsing history.

- [ ] **Step 5: Commit the mutation authority**

```powershell
git add extension\service-worker.mjs extension\lib\storage.mjs
git commit -m "feat: persist reviews and recover reminders"
```

### Task 4: Build the Four-State Side Panel and Fluid Companion

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.css`
- Modify: `extension/sidepanel.mjs`

**Interfaces:**
- Consumes: entry context and local state from Task 2.
- Consumes: mutation messages from Task 3.
- Produces: unmarked, waiting, due, grown, and unsupported-page views.

- [ ] **Step 1: Replace the shell markup with one static, safe DOM**

Use these stable element IDs in `extension/sidepanel.html`; user data must only be assigned by JavaScript properties:

```html
<main class="app">
  <header class="topbar">
    <p class="eyebrow">12730 · DOCUMENT REVISIT</p>
    <p id="mode-label" class="mode-label"></p>
  </header>

  <section class="companion-card" aria-labelledby="document-title">
    <div id="pet" class="pet" data-stage="0" aria-hidden="true">
      <div class="pet-liquid"></div>
      <div class="pet-face"><i></i><i></i><span></span></div>
    </div>
    <p class="meter-label">这份文档的成长</p>
    <p id="progress-text" class="progress-text">还没有开始</p>
    <div class="meter" aria-hidden="true"><span id="meter-fill"></span></div>
  </section>

  <section class="document-card">
    <p id="source" class="source"></p>
    <h1 id="document-title">正在看看这份文档…</h1>
    <p id="status-copy" class="status-copy"></p>
    <p id="next-review" class="next-review"></p>

    <div class="actions">
      <button id="primary-action" type="button"></button>
      <button id="open-original" class="secondary" type="button">打开原文档</button>
    </div>

    <details id="manage">
      <summary>管理这份记录</summary>
      <label for="url-input">原文档链接</label>
      <input id="url-input" type="url" inputmode="url">
      <div class="manage-actions">
        <button id="save-url" type="button">保存链接</button>
        <button id="delete-record" class="danger" type="button">删除记录</button>
      </div>
    </details>
  </section>

  <p id="live-status" role="status" aria-live="polite"></p>

  <footer>
    <label>
      <input id="reduced-motion" type="checkbox">
      减少动态效果
    </label>
    <p id="shortcut-help" hidden>
      快捷键未分配。请打开 <code>chrome://extensions/shortcuts</code> 设置。
    </p>
    <p class="local-note">只保存在本机；卸载扩展会删除记录。</p>
  </footer>
</main>
```

- [ ] **Step 2: Implement a single render path**

In `extension/sidepanel.mjs`, keep one mutable `model` and these helpers:

```js
import {
  getDocumentState,
  normalizeUrl,
  selectDueDocument,
} from './lib/domain.mjs';
import { readEntryContext, readState } from './lib/storage.mjs';

const elements = Object.fromEntries(
  [
    'mode-label', 'pet', 'progress-text', 'meter-fill', 'source',
    'document-title', 'status-copy', 'next-review', 'primary-action',
    'open-original', 'manage', 'url-input', 'save-url', 'delete-record',
    'live-status', 'reduced-motion', 'shortcut-help',
  ].map((id) => [id, document.getElementById(id)]),
);

let model = null;
let busy = false;

function findCurrentRecord(documents, page) {
  if (!page) return null;
  try {
    const key = normalizeUrl(page.url);
    return documents.find((record) => record.normalizedUrl === key) ?? null;
  } catch {
    return null;
  }
}

async function loadModel() {
  const currentWindow = await chrome.windows.getCurrent();
  const [context, state, commands] = await Promise.all([
    readEntryContext(currentWindow.id),
    readState(),
    chrome.commands.getAll(),
  ]);
  const nowIso = new Date().toISOString();
  const due = selectDueDocument(state.documents, nowIso);
  const current = findCurrentRecord(state.documents, context?.page);
  const record = context?.mode === 'toolbar' && due ? due : current;
  const page = context?.mode === 'toolbar' && due
    ? { title: due.title, url: due.url }
    : context?.page ?? null;

  model = {
    context,
    state,
    page,
    record,
    stateName: record ? getDocumentState(record, nowIso) : 'unmarked',
    shortcutMissing: commands.some(
      (command) => command.name === 'open-current-document' && !command.shortcut,
    ),
    reviewMode: context?.mode === 'toolbar' && Boolean(due),
  };
  render();
}

function setVisible(element, visible) {
  element.hidden = !visible;
}

function render() {
  const {
    page, record, stateName, state, shortcutMissing, reviewMode,
  } = model;
  const supported = Boolean(page?.url);
  const stage = record?.stage ?? 0;

  elements['mode-label'].textContent =
    reviewMode ? '今天带回一份' : '当前文档';
  elements.pet.dataset.stage = String(stage);
  elements['progress-text'].textContent =
    stage === 0 ? '还没有开始' : `${stage * 25}% · 第 ${stage} 次见面`;
  elements['meter-fill'].style.width = `${stage * 25}%`;
  elements.source.textContent = record?.source ?? '';
  elements['document-title'].textContent =
    page?.title || record?.title || '这里还不能 Mark';
  elements['reduced-motion'].checked = state.settings.reducedMotion;
  document.documentElement.dataset.reducedMotion =
    state.settings.reducedMotion ? 'true' : 'false';
  setVisible(elements['shortcut-help'], shortcutMissing);
  setVisible(elements.manage, Boolean(record));
  setVisible(elements['open-original'], Boolean(record));

  if (!supported && !record) {
    elements['status-copy'].textContent =
      '请在 Notion、ima、飞书或普通 HTTP(S) 网页中再次呼出伙伴。';
    elements['next-review'].textContent = '';
    setVisible(elements['primary-action'], false);
    return;
  }

  elements['url-input'].value = record?.url ?? page.url;

  const view = {
    unmarked: {
      copy: '今天已经愿意开始，这就值得留下。',
      next: '',
      action: '今天见过了 · 收下 25%',
    },
    waiting: {
      copy: '不用惦记，我会在合适的时候把它带回来。',
      next: `下次见面：${new Date(record?.nextReviewAt).toLocaleString('zh-CN')}`,
      action: '',
    },
    due: {
      copy: '它没有迟到，也没有催你。现在想再看一眼吗？',
      next: '',
      action: '这次看完了',
    },
    grown: {
      copy: '你和这份文档已经见过四次。它长成了。',
      next: '不再自动提醒',
      action: '',
    },
  }[stateName];

  elements['status-copy'].textContent = view.copy;
  elements['next-review'].textContent = view.next;
  elements['primary-action'].textContent = view.action;
  setVisible(elements['primary-action'], Boolean(view.action));
}
```

Add one message helper and explicit handlers; never optimistically show success before storage confirms:

```js
async function mutate(message) {
  if (busy) return null;
  busy = true;
  elements['primary-action'].disabled = true;
  elements['live-status'].textContent = '';
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || '保存失败，请重试');
    await loadModel();
    return response;
  } catch (error) {
    elements['live-status'].textContent = error.message;
    return null;
  } finally {
    busy = false;
    elements['primary-action'].disabled = false;
  }
}

function focusRecord(record) {
  model = {
    ...model,
    page: { title: record.title, url: record.url },
    record,
    stateName: getDocumentState(record, new Date().toISOString()),
    reviewMode: false,
  };
  render();
}

elements['primary-action'].addEventListener('click', async () => {
  if (model.stateName === 'unmarked') {
    const response = await mutate({ type: 'MARK_DOCUMENT', page: model.page });
    if (response?.created) {
      focusRecord(response.record);
      elements['live-status'].textContent = '25% 已经属于你。';
    }
  } else if (model.stateName === 'due') {
    const response = await mutate({
      type: 'COMPLETE_REVIEW',
      id: model.record.id,
    });
    if (response?.changed) {
      focusRecord(response.record);
      elements['live-status'].textContent = '这次见面记下了。';
      setTimeout(async () => {
        const { documents } = await readState();
        if (selectDueDocument(documents, new Date().toISOString())) await loadModel();
      }, 900);
    }
  }
});

elements['open-original'].addEventListener('click', () => {
  if (model.record?.url) chrome.tabs.create({ url: model.record.url });
});

elements['save-url'].addEventListener('click', async () => {
  await mutate({
    type: 'UPDATE_URL',
    id: model.record.id,
    url: elements['url-input'].value,
  });
});

elements['delete-record'].addEventListener('click', async () => {
  if (!confirm('删除这份记录？已有进度无法恢复。')) return;
  await mutate({ type: 'DELETE_RECORD', id: model.record.id });
});

elements['reduced-motion'].addEventListener('change', async () => {
  await mutate({
    type: 'UPDATE_SETTINGS',
    reducedMotion: elements['reduced-motion'].checked,
  });
});

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === 'session') loadModel();
});

await loadModel();
```

- [ ] **Step 3: Implement the fluid skin with CSS only**

In `extension/sidepanel.css`, implement:

```css
:root {
  color-scheme: light;
  font-family: Inter, ui-rounded, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --ink: #252133;
  --muted: #6c667a;
  --paper: #fbfaff;
  --violet: #715bd3;
  --violet-dark: #49358d;
  --mint: #75dcc0;
}

* { box-sizing: border-box; }
body {
  min-width: 300px;
  margin: 0;
  background:
    radial-gradient(circle at 20% 0%, #eee9ff 0, transparent 42%),
    var(--paper);
  color: var(--ink);
}
button, input { font: inherit; }
button { min-height: 44px; cursor: pointer; }
button:focus-visible, input:focus-visible, summary:focus-visible {
  outline: 3px solid #2f6fed;
  outline-offset: 3px;
}
.app { display: grid; gap: 18px; padding: 20px; }
.topbar { display: flex; justify-content: space-between; gap: 12px; }
.eyebrow, .mode-label, .source, .meter-label, footer {
  color: var(--muted);
  font-size: 12px;
}
.eyebrow { margin: 0; letter-spacing: .08em; }
.mode-label { margin: 0; }
.companion-card, .document-card {
  border: 1px solid #e3def2;
  border-radius: 24px;
  background: rgb(255 255 255 / 82%);
  box-shadow: 0 14px 40px rgb(63 45 114 / 9%);
}
.companion-card { display: grid; justify-items: center; padding: 22px; }
.document-card { padding: 20px; }
.pet {
  position: relative;
  width: 146px;
  aspect-ratio: 1;
  overflow: hidden;
  border: 5px solid #4e4380;
  border-radius: 46% 54% 48% 52% / 55% 48% 52% 45%;
  background: #eeeafd;
  box-shadow: inset 0 -12px 28px rgb(78 67 128 / 15%);
  transform-origin: 50% 100%;
}
.pet-liquid {
  position: absolute;
  inset: auto 0 0;
  height: 0;
  background: linear-gradient(180deg, var(--mint), var(--violet));
  transition: height 700ms cubic-bezier(.2, .9, .3, 1);
}
.pet[data-stage="1"] .pet-liquid { height: 25%; }
.pet[data-stage="2"] .pet-liquid { height: 50%; }
.pet[data-stage="3"] .pet-liquid { height: 75%; }
.pet[data-stage="4"] .pet-liquid { height: 100%; }
.pet-liquid::before {
  content: "";
  position: absolute;
  width: 180%;
  height: 28px;
  left: -40%;
  top: -15px;
  border-radius: 45%;
  background: rgb(255 255 255 / 38%);
  animation: wave 3.2s linear infinite;
}
.pet-face {
  position: absolute;
  inset: 45% 27% auto;
  display: flex;
  justify-content: space-between;
  z-index: 2;
}
.pet-face i {
  width: 10px;
  height: 14px;
  border-radius: 50%;
  background: var(--ink);
}
.pet-face span {
  position: absolute;
  width: 26px;
  height: 12px;
  left: 50%;
  top: 22px;
  border-bottom: 3px solid var(--ink);
  border-radius: 50%;
  transform: translateX(-50%);
}
.pet[data-stage="4"] { animation: celebrate 700ms ease-out both; }
.meter { width: 100%; height: 8px; overflow: hidden; border-radius: 999px; background: #e9e5f5; }
.meter span { display: block; height: 100%; border-radius: inherit; background: var(--violet); transition: width 500ms ease; }
.progress-text { margin: 4px 0 12px; font-weight: 700; }
h1 { margin: 6px 0 10px; font-size: 22px; line-height: 1.25; overflow-wrap: anywhere; }
.status-copy, .next-review { color: var(--muted); line-height: 1.6; }
.actions, .manage-actions { display: grid; gap: 10px; margin-top: 16px; }
button {
  border: 0;
  border-radius: 14px;
  padding: 10px 14px;
  background: var(--violet);
  color: white;
  font-weight: 700;
}
button.secondary, details button { background: #ece8fa; color: var(--violet-dark); }
button.danger { background: #fff0f0; color: #9c2e35; }
button:disabled { cursor: wait; opacity: .55; }
details { margin-top: 16px; }
summary { cursor: pointer; color: var(--muted); }
label { display: block; margin-top: 12px; }
input[type="url"] { width: 100%; margin-top: 6px; padding: 10px; border: 1px solid #cfc7e4; border-radius: 10px; }
#live-status { min-height: 1.5em; color: #8c3040; }
footer { border-top: 1px solid #e3def2; padding-top: 12px; line-height: 1.5; }
.local-note { margin-bottom: 0; }
@keyframes wave { to { transform: translateX(28%); } }
@keyframes celebrate {
  45% { transform: translateY(-8px) scale(1.04); }
  100% { transform: none; box-shadow: 0 0 34px rgb(117 220 192 / 65%); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation: none !important; transition: none !important; }
}
:root[data-reduced-motion="true"] *, :root[data-reduced-motion="true"] *::before {
  animation: none !important;
  transition: none !important;
}
```

Do not add an animation library or canvas. If `attr()` height support is inconsistent, the four explicit `[data-stage]` selectors are the source of truth.

- [ ] **Step 4: Run checks and execute the primary interaction**

Run:

```powershell
node --test tests\domain.test.mjs tests\manifest.test.mjs
node --check extension\sidepanel.mjs
node --check extension\service-worker.mjs
```

Expected: all tests PASS and both syntax checks exit 0.

Reload the extension, open a Notion document, and Mark it.

Expected:

1. The operation takes no more than one primary click after the panel opens.
2. The panel shows `25% · 第 1 次见面`.
3. Fluid rises to one quarter only after storage succeeds.
4. Reopening from the shortcut shows the same record.
5. No request appears in the Side Panel DevTools Network tab.

- [ ] **Step 5: Commit the complete product surface**

```powershell
git add extension\sidepanel.html extension\sidepanel.css extension\sidepanel.mjs
git commit -m "feat: add four-state fluid companion panel"
```

### Task 5: Prove the MVP Against Mature-Product Failure Modes

**Files:**
- Create: `docs/testing/mvp-smoke-test.md`
- Create: `README.md`
- Modify only if a check fails: files named by Tasks 1–4.

**Interfaces:**
- Consumes: the complete unpacked extension.
- Produces: a repeatable acceptance record and a clear local-only handoff.

- [ ] **Step 1: Write the repeatable smoke test**

Create `docs/testing/mvp-smoke-test.md` with these sections and checkboxes:

```markdown
# MVP Smoke Test

Date:
Chrome version:
Tester:

## Automated

- [ ] `node --test tests\domain.test.mjs tests\manifest.test.mjs` passes.
- [ ] `node --check extension\service-worker.mjs` passes.
- [ ] `node --check extension\sidepanel.mjs` passes.

## Five-second start

- [ ] On an unmarked Notion page, shortcut → one primary click reaches 25%.
- [ ] The text says “见过” rather than “掌握”.
- [ ] Reloading Chrome preserves the record.
- [ ] Repeating the Mark action does not create a duplicate.

## 1 / 2 / 7 / 30

In the service worker DevTools console, make one record due:

`const {documents}=await chrome.storage.local.get('documents'); documents[0].nextReviewAt=new Date(Date.now()-1000).toISOString(); await chrome.storage.local.set({documents});`

- [ ] The toolbar badge becomes a dot after the next alarm/badge refresh.
- [ ] Toolbar click shows one due document.
- [ ] Completing it advances exactly one stage.
- [ ] Double-clicking rapidly still advances exactly one stage.
- [ ] A late completion schedules from the actual completion time.
- [ ] Stage 4 clears `nextReviewAt` and never returns to the due queue.

## Queue pressure

- [ ] With three due records, no due count is shown.
- [ ] The earliest `nextReviewAt` appears first.
- [ ] A tie uses earliest `createdAt`.
- [ ] Completing one reveals the next without showing remaining quantity.

## URL identity and recovery

- [ ] `https://example.com/doc?a=1#one` and `#two` resolve to one record.
- [ ] `?a=1` and `?a=2` remain distinct.
- [ ] Editing a broken URL preserves stage and completion timestamps.
- [ ] Updating to another record’s normalized URL is rejected.

## Entry and browser lifecycle

- [ ] Shortcut always shows the current page even when another record is due.
- [ ] Toolbar action shows the due record when one exists.
- [ ] An unassigned shortcut shows `chrome://extensions/shortcuts` recovery help.
- [ ] Clearing `due-review-check` and restarting the worker recreates the alarm.
- [ ] A `chrome://` page cannot create a record.

## Product semantics

- [ ] Switching 75% → 25% always keeps the corresponding document title next to the pet.
- [ ] The UI never labels progress as knowledge mastery.
- [ ] Missing a date never clears or decreases progress.
- [ ] No streak, overdue count, punishment, quiz, or daily goal appears.

## Privacy and accessibility

- [ ] Manifest has no host permissions, content scripts, `tabs`, notifications, or unlimited storage.
- [ ] DevTools Network shows no product requests.
- [ ] Record data contains no document body or excerpt.
- [ ] Every action is keyboard reachable with a visible focus ring.
- [ ] Progress has number and text, not color alone.
- [ ] System reduced motion and the extension toggle both stop nonessential motion.
- [ ] The UI states that uninstalling removes local records.

## Product validation notes

- Did immediate 25% feel earned?
- Did the dot invite a return without pressure?
- Did the pet make reopening more appealing than a normal reminder?
- What was confusing enough to block a second use?
```

- [ ] **Step 2: Write the README without promising unbuilt capabilities**

Create `README.md` with:

1. One-sentence product definition.
2. `Load unpacked` instructions pointing to `C:\12730\extension`.
3. Shortcut setup and collision recovery via `chrome://extensions/shortcuts`.
4. Test commands:

```powershell
node --test tests\domain.test.mjs tests\manifest.test.mjs
node --check extension\service-worker.mjs
node --check extension\sidepanel.mjs
```

5. Privacy statement: title, URL, source, stage, timestamps, and settings remain in `chrome.storage.local`; no body access or network service.
6. Local-data warning: uninstalling clears records.
7. Explicit test-version exclusions copied from the approved design.
8. The three validation questions from design section 14.

- [ ] **Step 3: Run the automated suite and the entire smoke test**

Run:

```powershell
node --test tests\domain.test.mjs tests\manifest.test.mjs
node --check extension\service-worker.mjs
node --check extension\sidepanel.mjs
git diff --check
```

Expected: all tests PASS; both syntax checks and `git diff --check` exit 0.

Complete every smoke-test checkbox that is testable locally. Record the Chrome version and any failed checkbox directly under that item with the observed behavior; fix failures before committing.

- [ ] **Step 4: Perform the final scope and adversarial scan**

Run:

```powershell
rg -n "掌握度|streak|逾期.*[0-9]|host_permissions|content_scripts|notifications|unlimitedStorage|fetch\\(" extension README.md
```

Expected:

- no `掌握度`, `streak`, overdue-number copy, host permissions, content scripts, notifications, unlimited storage, or product `fetch()` call;
- README may mention excluded features only in its clearly labeled exclusions section.

Inspect `chrome.storage.local` and confirm no property contains body text, excerpts, auth tokens, cookies, or personal account identifiers.

- [ ] **Step 5: Commit the validated MVP handoff**

```powershell
git add README.md docs\testing\mvp-smoke-test.md
git commit -m "docs: add MVP validation and privacy checks"
```

## Final Completion Criteria

Implementation is complete only when:

1. Both Node test files pass without installed dependencies.
2. The extension loads unpacked on Chrome 116+ with no manifest errors.
3. Notion passes the full primary flow; ima and Feishu each pass Mark, persistence, and reopen-original checks.
4. The service worker recreates its missing alarm and the badge recomputes from storage.
5. A rapid duplicate completion changes one stage only.
6. The Side Panel Network tab shows no product network request.
7. Reduced-motion, keyboard focus, unsupported pages, URL editing, deletion, and local-data warnings work.
8. No unrequested subsystem—AI, content ingestion, account, sync, notification, FSRS, skins, currency, or analytics—has entered the codebase.
