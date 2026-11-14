// 渲染进程垫片：把扩展页面里用到的 chrome.runtime 换成桌面端的 IPC 通道。
//
// 上下文隔离关掉（contextIsolation: false），所以这里定义的 chrome 就是页面里的全局 chrome，
// 扩展的 library.html / stats.html 可以原样加载，不需要改一行业务代码。
import { ipcRenderer } from 'electron';

const listeners = new Set();

ipcRenderer.on('yidian:push', (_event, message) => {
  for (const fn of [...listeners]) {
    try { fn(message); } catch { /* 页面监听器异常不影响其他监听器 */ }
  }
});

const runtime = {
  id: 'yidian-desktop',
  lastError: null,
  sendMessage: (message) => ipcRenderer.invoke('yidian:message', message),
  getURL: (target = '') => `app://bundle/${String(target).replace(/^\/+/, '')}`,
  onMessage: {
    addListener(fn) { listeners.add(fn); },
    removeListener(fn) { listeners.delete(fn); },
    hasListener(fn) { return listeners.has(fn); },
  },
};

const api = {
  runtime,
  tabs: {
    create: ({ url }) => ipcRenderer.invoke('yidian:open-url', url),
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => undefined,
      remove: async () => undefined,
    },
    session: {
      get: async () => ({}),
      set: async () => undefined,
    },
  },
};

// Chromium 自带一个 chrome 对象（没有 runtime），优先补上 runtime，别整个覆盖掉。
try {
  if (window.chrome && !window.chrome.runtime) {
    Object.defineProperty(window.chrome, 'runtime', { value: runtime, configurable: true, writable: true });
  } else {
    Object.defineProperty(window, 'chrome', { value: api, configurable: true, writable: true });
  }
} catch {
  try { window.chrome = api; } catch { /* 实在装不上就算了，页面会报错而不是静默 */ }
}

// 桌面端专属小接口（只有我们自己写的渲染页用）
window.yidianDesktop = {
  toggleCard: () => ipcRenderer.invoke('yidian:toggle-card'),
  hideCard: () => ipcRenderer.invoke('yidian:hide-card'),
  drag: (payload) => ipcRenderer.invoke('yidian:drag', payload),
  capture: (payload) => ipcRenderer.invoke('yidian:capture', payload),
  clipboard: () => ipcRenderer.invoke('yidian:clipboard'),
  resizeCard: (size) => ipcRenderer.invoke('yidian:resize-card', size),
  onPush: (fn) => listeners.add(fn),
};
