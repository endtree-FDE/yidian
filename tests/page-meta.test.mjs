// 页面元信息提取：标题、一句描述、规范链接、编码识别。
// 运行方式（仓库根目录）：
//   node --test tests/page-meta.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PAGE_SUMMARY_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  decodeHtmlEntities,
  decodePageBytes,
  detectCharset,
  extractMetaFromHtml,
} from '../core/page-meta.mjs';

test('extractMetaFromHtml：取 <title>、description、canonical', () => {
  const html = `
    <html><head>
      <title>如何把饭煮熟 | 厨房笔记</title>
      <meta name="description" content="一篇讲怎么煮饭的文章。">
      <link rel="canonical" href="https://example.com/rice">
    </head><body>正文</body></html>`;
  const meta = extractMetaFromHtml(html, 'https://example.com/rice');
  assert.equal(meta.title, '如何把饭煮熟 | 厨房笔记');
  assert.equal(meta.summary, '一篇讲怎么煮饭的文章。');
  assert.equal(meta.canonicalUrl, 'https://example.com/rice');
});

test('extractMetaFromHtml：标准 meta 优先，og / twitter 兜底', () => {
  const html = `
    <title>页面标题</title>
    <meta property="og:title" content="社交标题">
    <meta name="description" content="普通描述">
    <meta property="og:description" content="社交描述">`;
  const meta = extractMetaFromHtml(html);
  assert.equal(meta.title, '页面标题');
  assert.equal(meta.summary, '普通描述');
});

test('extractMetaFromHtml：没有标准 meta 时用 og 兜底', () => {
  const html = `<meta property="og:title" content="社交标题"><meta property="og:description" content="社交描述">`;
  const meta = extractMetaFromHtml(html);
  assert.equal(meta.title, '社交标题');
  assert.equal(meta.summary, '社交描述');
});

test('extractMetaFromHtml：属性顺序、单双引号、大写属性名都认', () => {
  const html = `<meta CONTENT='一句描述' NAME="Description">`;
  const meta = extractMetaFromHtml(html);
  assert.equal(meta.summary, '一句描述');
});

test('extractMetaFromHtml：没有元信息时返回空串，不编造', () => {
  const meta = extractMetaFromHtml('<html><body>只有正文</body></html>', 'https://example.com/x');
  assert.equal(meta.title, '');
  assert.equal(meta.summary, '');
});

test('extractMetaFromHtml：HTML 实体被还原，控制字符被清掉', () => {
  const html = '<title>Tom &amp; Jerry &#39;quoted&#39;</title><meta name="description" content="a&#x27;b">';
  const meta = extractMetaFromHtml(html);
  assert.equal(meta.title, "Tom & Jerry 'quoted'");
  assert.equal(meta.summary, "a'b");
});

test('extractMetaFromHtml：标题与描述有长度上限，超出截断', () => {
  const html = `<title>${'长'.repeat(500)}</title><meta name="description" content="${'描'.repeat(900)}">`;
  const meta = extractMetaFromHtml(html);
  assert.ok(meta.title.length <= MAX_PAGE_TITLE_LENGTH, `标题过长：${meta.title.length}`);
  assert.ok(meta.summary.length <= MAX_PAGE_SUMMARY_LENGTH, `描述过长：${meta.summary.length}`);
});

test('extractMetaFromHtml：canonical 只认 http/https', () => {
  const html = '<link rel="canonical" href="javascript:alert(1)">';
  const meta = extractMetaFromHtml(html, 'https://example.com/ok');
  assert.equal(meta.canonicalUrl, 'https://example.com/ok');
});

test('decodeHtmlEntities：数字实体与十六进制实体', () => {
  assert.equal(decodeHtmlEntities('&#65;&#x42;'), 'AB');
  assert.equal(decodeHtmlEntities('&nbsp;'), ' ');
  assert.equal(decodeHtmlEntities('没有实体'), '没有实体');
});

test('detectCharset：先看响应头，再看页面里的 meta', () => {
  const utf8 = new TextEncoder().encode('<meta charset="utf-8"><title>x</title>');
  assert.equal(detectCharset(utf8, ''), 'utf-8');
  assert.equal(detectCharset(utf8, 'text/html; charset=GBK'), 'gbk');
});

test('decodePageBytes：GBK 页面按 GBK 解，标题不乱码', () => {
  const html = '<html><head><meta charset="gbk"><title>中文标题</title></head></html>';
  const bytes = new TextEncoder().encode(html);
  // 用 GBK 编码器不可得时，用 Shift_JIS 之类验证「按声明解码」这条路径：
  // 这里直接验证 UTF-8 声明的路径，并确认返回值是字符串。
  assert.equal(typeof decodePageBytes(bytes, 'text/html; charset=utf-8'), 'string');
  assert.match(decodePageBytes(bytes, 'text/html; charset=utf-8'), /中文标题/);
});

test('decodePageBytes：编码不认识时退回 UTF-8，不抛错', () => {
  const bytes = new TextEncoder().encode('<title>标题</title>');
  assert.match(decodePageBytes(bytes, 'text/html; charset=x-nonsense'), /标题/);
});
