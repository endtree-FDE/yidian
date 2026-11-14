import test from 'node:test';
import assert from 'node:assert/strict';
import { explainRuntimeError, openExtensions, send } from '../extension/runtime.mjs';

test('连接失败转成可操作的中文提示', async () => {
  globalThis.chrome = {
    runtime: { async sendMessage() { throw new Error('Could not establish connection. Receiving end does not exist.'); } },
  };
  await assert.rejects(send({ type: 'list-records' }), /确认解压文件夹还在原处/);
  assert.equal(explainRuntimeError(new Error('记录不存在')), '记录不存在');
  assert.match(explainRuntimeError(new Error("Cannot read properties of null (reading 'canonicalUrl')")), /旧版后台/);
});

test('恢复入口打开当前浏览器的扩展管理页', async () => {
  const opened = [];
  globalThis.chrome = { tabs: { async create(options) { opened.push(options); } } };
  await openExtensions();
  await openExtensions('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0');
  await openExtensions('Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36');
  await openExtensions('');
  assert.equal(opened.length, 4);
  assert.ok(['chrome://extensions/', 'edge://extensions/'].includes(opened[0].url));
  assert.equal(opened[1].url, 'edge://extensions/');
  assert.equal(opened[2].url, 'chrome://extensions/');
  assert.equal(opened[3].url, 'chrome://extensions/');
});
