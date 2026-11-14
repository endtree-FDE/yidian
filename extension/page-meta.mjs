// 页面元信息：从一段 HTML 里挑出「标题 + 一句描述 + 规范链接」。
//
// 为什么要有它：一点回看时能带回来的内容越多，就越不用重新打开原网页。
// 桌面端只拿到一个链接时，标题走的是「域名 · 时间 收藏」的兜底 —— 卡片上等于没有内容。
// 这里把页面的标题和描述捞回来，桌面端和扩展端用同一套口径。
//
// 纯函数：不碰网络、不碰 DOM，所以能被单测直接覆盖。
// 网络那一段留在各端（桌面端用 Electron 的 net.fetch，扩展端直接读 DOM）。

export const MAX_PAGE_TITLE_LENGTH = 200;
export const MAX_PAGE_SUMMARY_LENGTH = 300;

// 常见的 HTML 实体。名字大小写不敏感（&AMP; 与 &amp; 等价）。
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', middot: '·',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
};

/** 解 HTML 实体：&amp; &lt; &#39; &#x27; 都还原成字符。 */
export function decodeHtmlEntities(text) {
  const input = String(text ?? '');
  if (!input.includes('&')) return input;
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try { return String.fromCodePoint(code); } catch { return match; }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

function readAttributes(tag) {
  const attrs = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g;
  let match = pattern.exec(tag);
  while (match) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (!(name in attrs)) attrs[name] = decodeHtmlEntities(value);
    match = pattern.exec(tag);
  }
  return attrs;
}

function isNoiseCode(code) {
  if (code < 32) return true;                       // 控制字符
  if (code >= 127 && code <= 159) return true;      // C1 控制字符
  if (code === 0x200b || code === 0x200c || code === 0x200d) return true; // 零宽字符
  if (code === 0x2060 || code === 0xfeff) return true; // 零宽不换行 / BOM
  return false;
}

// 控制字符、零宽字符一律换成空格，再把连续空白压成一个。
function collapse(text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    out += isNoiseCode(ch.codePointAt(0)) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function truncate(text, max) {
  const value = collapse(text);
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function httpUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

/**
 * 从 HTML 里挑出标题、一句描述和 canonical 链接。
 * 优先级：标准 meta 优先，og / twitter 兜底 ——
 * 「name=description」通常是站点自己写的那句话，og 多半是投放文案。
 */
export function extractMetaFromHtml(html, url = '') {
  const text = String(html ?? '');
  const metas = new Map();
  for (const tag of text.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = readAttributes(tag);
    const key = String(attrs.name || attrs.property || attrs.itemprop || '').trim().toLowerCase();
    const content = String(attrs.content || '').trim();
    if (!key || !content || metas.has(key)) continue;
    metas.set(key, content);
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  const rawTitle = titleTag ? decodeHtmlEntities(titleTag[1]) : '';

  let canonical = '';
  for (const tag of text.match(/<link\b[^>]*>/gi) || []) {
    const attrs = readAttributes(tag);
    const rel = String(attrs.rel || '').trim().toLowerCase();
    if (rel.split(/\s+/).includes('canonical') && attrs.href) {
      canonical = httpUrl(attrs.href);
      if (canonical) break;
    }
  }

  return {
    title: truncate(rawTitle || metas.get('og:title') || metas.get('twitter:title'), MAX_PAGE_TITLE_LENGTH),
    summary: truncate(metas.get('description') || metas.get('og:description') || metas.get('twitter:description'), MAX_PAGE_SUMMARY_LENGTH),
    canonicalUrl: canonical || httpUrl(url),
  };
}

const CHARSET_ALIASES = {
  utf8: 'utf-8',
  'utf-8': 'utf-8',
  gb2312: 'gbk',
  gb_2312: 'gbk',
  gbk: 'gbk',
  gb18030: 'gb18030',
  big5: 'big5',
  'iso-8859-1': 'windows-1252',
  latin1: 'windows-1252',
  'windows-1252': 'windows-1252',
  ascii: 'utf-8',
};

function normalizeCharset(raw) {
  const value = String(raw || '').trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (!value) return '';
  return CHARSET_ALIASES[value] || value;
}

function toArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes;
  if (ArrayBuffer.isView(bytes)) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return new Uint8Array(0).buffer;
}

/**
 * 猜页面编码。中文站点还有不少是 GBK 的，
 * 直接按 UTF-8 解会得到一堆乱码，标题和描述就白抓了。
 */
export function detectCharset(bytes, contentType = '') {
  const buffer = toArrayBuffer(bytes);
  const fromHeader = /charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/i.exec(String(contentType || ''))?.[1];
  if (fromHeader) return normalizeCharset(fromHeader);
  const head = new TextDecoder('latin1').decode(buffer.slice(0, 4096));
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/i.exec(head)?.[1]
    || /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-zA-Z0-9_-]+)/i.exec(head)?.[1]
    || '';
  return normalizeCharset(fromMeta);
}

/** 按页面声明的编码把字节解成文本；解不了就退回 UTF-8。 */
export function decodePageBytes(bytes, contentType = '') {
  const buffer = toArrayBuffer(bytes);
  const charset = detectCharset(buffer, contentType);
  if (charset) {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      /* 编码不认识就走 UTF-8 */
    }
  }
  return new TextDecoder('utf-8').decode(buffer);
}
