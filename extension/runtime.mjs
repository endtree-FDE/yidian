export function explainRuntimeError(error) {
  const message = String(error?.message || error || '');
  if (/Could not establish connection|Receiving end does not exist|message port closed|Extension context invalidated/i.test(message)) {
    return '一点的后台没有响应。请打开浏览器的扩展管理页，确认解压文件夹还在原处，刷新“一点”后重试。';
  }
  if (/Cannot read properties of null.*canonicalUrl/i.test(message)) {
    return '一点可能仍在运行旧版后台。请先导出本地备份，再到扩展管理页刷新“一点”。';
  }
  return message || '操作失败，请重试。';
}

export async function send(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || '操作失败，请重试。');
    return response;
  } catch (error) {
    throw new Error(explainRuntimeError(error), { cause: error });
  }
}

export function openExtensions() {
  const url = navigator.userAgent.includes('Edg/') ? 'edge://extensions/' : 'chrome://extensions/';
  return chrome.tabs.create({ url });
}
