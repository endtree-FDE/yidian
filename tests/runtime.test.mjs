import test from 'node:test';
import assert from 'node:assert/strict';
import { explainRuntimeError, send } from '../extension/runtime.mjs';

test('连接失败转成可操作的中文提示', async () => {
  globalThis.chrome = {
    runtime: { async sendMessage() { throw new Error('Could not establish connection. Receiving end does not exist.'); } },
  };
  await assert.rejects(send({ type: 'list-records' }), /确认解压文件夹还在原处/);
  assert.equal(explainRuntimeError(new Error('记录不存在')), '记录不存在');
});
