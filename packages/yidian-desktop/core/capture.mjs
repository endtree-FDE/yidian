// 桌面端采集：把一个链接变成「标题 + 一句描述」。
//
// 分工：
//   这一层   —— 从一段文字里挑链接，把抓到的页面信息组装成一条待收下的记录。
//   main.mjs —— 真正去网络上把页面抓下来（Electron 的 net.fetch）。
//
// 拆开是为了能测：单测里塞一个假的 fetchMeta 就能跑完整条链路，不用真联网。
// 抓不到页面信息也不拦着收下 —— 只是标题退回「域名 · 时间 收藏」的兜底。

export const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

/** 从一段文字里挑出第一个 http(s) 链接。 */
export function pickUrl(text) {
  const match = String(text ?? '').match(/https?:\/\/[^\s"'<>）)】]+/i);
  return match ? match[0].trim() : null;
}

/**
 * 把一段文字（可能是一整段剪贴板内容）解析成一条待收下的记录。
 * 抓不到标题和描述也照常收下 —— 有总比没有强。
 */
export async function resolveCaptureTab(rawUrl, { fetchMeta, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS } = {}) {
  const url = pickUrl(rawUrl);
  if (!url) return null;
  let meta = null;
  if (typeof fetchMeta === 'function') {
    try {
      meta = await fetchMeta(url, { timeoutMs });
    } catch {
      meta = null;
    }
  }
  return {
    title: String(meta?.title || '').trim(),
    url,
    canonicalUrl: String(meta?.canonicalUrl || '').trim(),
    excerpt: '',
    summary: String(meta?.summary || '').trim(),
  };
}
