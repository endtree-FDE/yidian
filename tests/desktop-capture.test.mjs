// 桌面端采集：把一个链接变成「标题 + 一句描述」。
//
// 这一层刻意不启动 Electron：网络那一段（net.fetch）留在 main.mjs，
// 这里用假的 fetchMeta 就能把整条组装链路跑完。
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickUrl, resolveCaptureTab } from '../packages/yidian-desktop/core/capture.mjs';

test('pickUrl：从剪贴板文字里挑出第一个 http 链接', () => {
  assert.equal(pickUrl('看看这个 https://example.com/a?b=1 挺有意思'), 'https://example.com/a?b=1');
  assert.equal(pickUrl('没有链接'), null);
  assert.equal(pickUrl(''), null);
});

test('resolveCaptureTab：抓到标题和描述就一起带上', async () => {
  const tab = await resolveCaptureTab('https://example.com/post', {
    fetchMeta: async (url) => ({
      title: '如何把饭煮熟',
      summary: '一篇讲怎么煮饭的文章。',
      canonicalUrl: url,
    }),
  });
  assert.equal(tab.url, 'https://example.com/post');
  assert.equal(tab.title, '如何把饭煮熟');
  assert.equal(tab.summary, '一篇讲怎么煮饭的文章。');
  assert.equal(tab.excerpt, '');
});

test('resolveCaptureTab：抓不到页面信息也照常收下，标题留空走兜底', async () => {
  const tab = await resolveCaptureTab('https://example.com/post', { fetchMeta: async () => null });
  assert.equal(tab.title, '');
  assert.equal(tab.summary, '');
  assert.equal(tab.url, 'https://example.com/post');
});

test('resolveCaptureTab：抓取抛错不拦着收下', async () => {
  const tab = await resolveCaptureTab('https://example.com/post', {
    fetchMeta: async () => { throw new Error('网络不通'); },
  });
  assert.equal(tab.url, 'https://example.com/post');
  assert.equal(tab.title, '');
});

test('resolveCaptureTab：没有链接就返回 null', async () => {
  assert.equal(await resolveCaptureTab('这里没有链接', { fetchMeta: async () => ({}) }), null);
});
