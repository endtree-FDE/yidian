// 最小存储适配器：一点的数据层契约。
// 任何宿主（Edge 扩展、CLI、Obsidian、agent 技能）只要实现这四个方法，
// 就能复用 core/domain.mjs 的全部 1/2/7/30 节奏逻辑。
//
//   readRecords():   Promise<Array<Record>>
//   writeRecords(records: Array<Record>): Promise<void>
//   readSettings():  Promise<Settings>
//   writeSettings(settings: Settings): Promise<void>
//
// 1.2.0 的浏览器扩展仍直接使用 chrome.storage.local，不经过本文件；
// 这里的适配器为浏览器之外的宿主（tools/yidian-cli 等）提供现成实现。

export const DEFAULT_SETTINGS = Object.freeze({
  reducedMotion: false,
  notifyOnDue: false,
  quietHours: Object.freeze({ enabled: true, start: '22:00', end: '08:00' }),
});

export function mergeSettings(raw) {
  const candidate = raw && typeof raw === 'object' ? raw : {};
  return {
    ...DEFAULT_SETTINGS,
    ...candidate,
    quietHours: { ...DEFAULT_SETTINGS.quietHours, ...(candidate.quietHours ?? {}) },
  };
}

function assertAdapter(adapter) {
  for (const method of ['readRecords', 'writeRecords', 'readSettings', 'writeSettings']) {
    if (typeof adapter?.[method] !== 'function') throw new TypeError(`adapter missing ${method}`);
  }
  return adapter;
}

export function createMemoryAdapter(initial = {}) {
  let records = Array.isArray(initial.records) ? structuredClone(initial.records) : [];
  let settings = mergeSettings(initial.settings);
  return assertAdapter({
    async readRecords() { return structuredClone(records); },
    async writeRecords(next) { records = structuredClone(next); },
    async readSettings() { return structuredClone(settings); },
    async writeSettings(next) { settings = mergeSettings(next); },
  });
}

// JSON 文件适配器：fs 由宿主注入（Node 的 node:fs/promises、Obsidian 的 vault adapter 等），
// 数据落为 { version: 2, records: [], settings: {} }，与扩展导出备份同构。
export function createJsonFileAdapter(filePath, fs) {
  async function read() {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const payload = JSON.parse(raw);
      return {
        records: Array.isArray(payload?.records) ? payload.records : [],
        settings: mergeSettings(payload?.settings),
      };
    } catch {
      return { records: [], settings: mergeSettings() };
    }
  }
  return assertAdapter({
    async readRecords() { return (await read()).records; },
    async writeRecords(next) {
      const current = await read();
      const payload = { version: 2, exportedAt: new Date().toISOString(), records: next, settings: current.settings };
      await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    },
    async readSettings() { return (await read()).settings; },
    async writeSettings(next) {
      const current = await read();
      const payload = { version: 2, exportedAt: new Date().toISOString(), records: current.records, settings: mergeSettings(next) };
      await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    },
  });
}
