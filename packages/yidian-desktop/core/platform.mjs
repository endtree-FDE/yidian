// 桌面端的平台适配器：把 Electron 的能力接成核心要的 platform。
//
// 核心（core/messages.mjs）不关心自己是跑在浏览器还是桌面，
// 这里负责回答它提的几个问题：存哪儿、怎么打开网页、怎么弹通知。
export function createDesktopPlatform({
  store,
  openExternal,
  openLibrary,
  notify,
  clearNotification,
  onRecordsChanged = () => undefined,
} = {}) {
  if (!store) throw new Error('桌面端平台适配器需要一个存储');
  return {
    storage: {
      get: (keys) => store.get(keys),
      set: (values) => store.set(values),
      remove: (keys) => store.remove(keys),
    },
    openUrl: (url) => openExternal(url),
    openLibrary: () => openLibrary(),
    notify: (id, options) => notify(id, options),
    clearNotification: (id) => clearNotification(id),
    // 桌面端用自己的调度器（每 30 秒 tick 一次），不需要浏览器闹钟
    setAlarm: async () => undefined,
    clearAlarm: async () => undefined,
    // 桌面端没有工具栏角标
    setBadge: async () => undefined,
    onRecordsChanged: () => onRecordsChanged(),
  };
}
