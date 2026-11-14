// 文件存储：给桌面端当 chrome.storage.local 用。
//
// 语义对齐 chrome.storage.local：
//   get(null) → 全部；get('k') → {k}；get(['a','b']) → {a,b}；get({a:默认值}) → 带默认值
//   set({a:1}) → 合并写；remove('a' | ['a']) → 删键
// 写入走串行队列 + 临时文件 rename，保证不会写出半截 JSON。
import fs from 'node:fs/promises';
import path from 'node:path';

export function createSerialQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

function pickKeys(source, keys) {
  const result = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
  }
  return result;
}

export class JsonStore {
  #file;
  #queue = createSerialQueue();
  #cache = null;

  constructor(file) {
    this.#file = file;
  }

  get file() {
    return this.#file;
  }

  async #load() {
    if (this.#cache) return this.#cache;
    try {
      const raw = await fs.readFile(this.#file, 'utf8');
      const parsed = JSON.parse(raw);
      this.#cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      // 文件不存在或已损坏：从空状态起步，不要让整个应用起不来。
      this.#cache = {};
    }
    return this.#cache;
  }

  async #write() {
    const data = this.#cache ?? {};
    const tmp = `${this.#file}.tmp`;
    await fs.mkdir(path.dirname(this.#file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, this.#file);
  }

  async get(keys = null) {
    const data = await this.#load();
    if (keys === null || keys === undefined) return { ...data };
    if (typeof keys === 'string') return pickKeys(data, [keys]);
    if (Array.isArray(keys)) return pickKeys(data, keys);
    if (keys && typeof keys === 'object') {
      const result = {};
      for (const [key, fallback] of Object.entries(keys)) {
        result[key] = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
      }
      return result;
    }
    return { ...data };
  }

  async set(values) {
    if (!values || typeof values !== 'object') return;
    return this.#queue(async () => {
      const data = await this.#load();
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete data[key];
        else data[key] = value;
      }
      await this.#write();
    });
  }

  async remove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return this.#queue(async () => {
      const data = await this.#load();
      for (const key of list) delete data[key];
      await this.#write();
    });
  }

  // 同步快照：桥与测试用，避免再排一次写队列。
  async snapshot() {
    return { ...(await this.#load()) };
  }
}
