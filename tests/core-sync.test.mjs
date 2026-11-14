// 共享副本守卫：核心与界面文件都有副本，必须与源头一字不差。
//
// 扩展被浏览器沙箱限制只能读自己目录；桌面端打包后不能依赖仓库里的兄弟目录。
// 所以 core/ 与 extension/ 是源，同步出三份副本：
//   1) 扩展包内（扩展的 SW 与页面用）
//   2) 桌面端 vendor/（桌面端内置核心）
//   3) 桌面端 assets/bundle/（桌面端内置界面）
// 副本一旦手改或忘记同步，两端行为就会分叉——这里卡住它。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = path.join(root, 'core');
const extensionDir = path.join(root, 'extension');
const desktopDir = path.join(root, 'packages', 'yidian-desktop');

const CORE_FILES = ['domain.mjs', 'messages.mjs', 'bridge-protocol.mjs', 'page-meta.mjs'];
const BUNDLE_FILES = [
  'library.html', 'library.css', 'library.js',
  'stats.html', 'stats.css', 'stats.js',
  'pet.css', 'shared.js', 'domain.mjs',
  'fonts/ZCOOLXiaoWei-Regular.ttf',
  'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png',
];

function sameBytes(sourcePath, targetPath) {
  if (!fs.existsSync(targetPath)) return false;
  return Buffer.compare(fs.readFileSync(sourcePath), fs.readFileSync(targetPath)) === 0;
}

for (const name of CORE_FILES) {
  test(`扩展包里的 ${name} 与核心一致`, () => {
    assert.ok(
      sameBytes(path.join(coreDir, name), path.join(extensionDir, name)),
      `${name} 与 core/ 不一致 —— 跑 node tools/sync-shared.mjs`,
    );
  });

  test(`桌面端 vendor 里的 ${name} 与核心一致`, () => {
    assert.ok(
      sameBytes(path.join(coreDir, name), path.join(desktopDir, 'vendor', 'yidian-core', name)),
      `桌面端 vendor/${name} 与核心不一致 —— 跑 node tools/sync-shared.mjs`,
    );
  });
}

for (const name of BUNDLE_FILES) {
  test(`桌面端 bundle 里的 ${name} 与扩展包一致`, () => {
    assert.ok(
      sameBytes(path.join(extensionDir, name), path.join(desktopDir, 'assets', 'bundle', name)),
      `桌面端 assets/bundle/${name} 与扩展包不一致 —— 跑 node tools/sync-shared.mjs`,
    );
  });
}

test('桌面端引用的是核心包，不是扩展包的副本', () => {
  const main = fs.readFileSync(path.join(desktopDir, 'main.mjs'), 'utf8');
  assert.match(main, /yidian-core/, '桌面端应该直接吃 core（或它的同步副本）');
  assert.doesNotMatch(main, /yidian-1\.3\.0[\\/]service-worker/, '桌面端不该再 import 扩展的 service-worker');
});

test('扩展不再自带业务逻辑，只做适配器', () => {
  const worker = fs.readFileSync(path.join(extensionDir, 'service-worker.mjs'), 'utf8');
  assert.match(worker, /createMessageLayer/, '扩展的 SW 应该用核心的消息层');
  assert.doesNotMatch(worker, /function markCurrent|function completeReview/, '业务逻辑不该留在扩展里');
});
