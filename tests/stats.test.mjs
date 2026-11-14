import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('回看统计只汇总已发生的事实，口径与 summarizeRecords 一致', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('../extension/stats.html', import.meta.url), 'utf8'),
    readFile(new URL('../extension/stats.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /<title>一点 · 回看统计<\/title>/);
  assert.match(html, /id="total"/);
  assert.match(html, /id="completed"/);
  assert.match(html, /id="encounters"/);
  assert.match(html, /最常收下的地方/);
  assert.match(html, /统计只在本地计算，不上传、不比较、不打扰/);
  assert.match(html, /library\.html/);
  assert.match(script, /summarizeRecords/);
  assert.match(script, /type: 'list-records'/);
  assert.match(script, /type: 'list-archived'/);
});

test('统计页坚持无压力设计：没有连胜、倒计时、排名或外部资源', async () => {
  const [html, script, style] = await Promise.all([
    readFile(new URL('../extension/stats.html', import.meta.url), 'utf8'),
    readFile(new URL('../extension/stats.js', import.meta.url), 'utf8'),
    readFile(new URL('../extension/stats.css', import.meta.url), 'utf8'),
  ]);
  const bundle = `${html}\n${script}\n${style}`;
  // 无压力设计红线：任何压力式词汇出现即失败
  assert.doesNotMatch(bundle, /streak|连胜|连续天数|打卡|倒计时|逾期|超期|排名|落后|坚持/i);
  // 纯本地：不引用任何远程资源、图表库或字体 CDN
  assert.doesNotMatch(bundle, /https?:\/\//);
  assert.doesNotMatch(bundle, /<canvas|chart|echarts|d3/i);
  assert.match(style, /prefers-reduced-motion/);
});

test('收藏库提供统计页入口', async () => {
  const html = await readFile(new URL('../extension/library.html', import.meta.url), 'utf8');
  assert.match(html, /href="stats\.html"/);
  assert.match(html, /href="stats\.html">统计</);
});
