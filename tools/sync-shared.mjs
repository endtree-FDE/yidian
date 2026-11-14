// 同步共享文件：一份源头，三处副本。
//
// 为什么有副本：扩展被浏览器沙箱限制只能读自己目录；桌面端打包后不能依赖仓库里的兄弟目录。
// 所以核心逻辑与界面文件都以 packages/yidian-core/ 与 packages/yidian-1.3.0/ 为源，
// 同步出三份副本，并由 tests/core-sync.test.mjs 守住「一字不差」。
//
//   1) packages/yidian-1.3.0/            扩展包内的核心副本（扩展的 SW 与页面用）
//   2) packages/yidian-desktop/vendor/   桌面端内置的核心副本（打包后独立）
//   3) packages/yidian-desktop/assets/bundle/  桌面端内置的界面副本（收藏库页、宠物样式、字体图标）
//
// 用法：
//   node tools/sync-shared.mjs          # 写入
//   node tools/sync-shared.mjs --check  # 只校验
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const coreDir = path.join(root, 'packages', 'yidian-core');
const extensionDir = path.join(root, 'packages', 'yidian-1.3.0');
const desktopDir = path.join(root, 'packages', 'yidian-desktop');

// 核心文件（源在 packages/yidian-core/）
const CORE_FILES = ['domain.mjs', 'messages.mjs', 'bridge-protocol.mjs', 'page-meta.mjs'];

// 界面文件（源在扩展包，桌面端打包后要自带一份）
// 注意 domain.mjs 也要带：library.js / stats.js 是 ES 模块，直接 import 它，
// 缺了这两个页面会静默停在「0 条收藏」（模块 404，脚本压根没跑）。
const BUNDLE_FILES = [
  'library.html', 'library.css', 'library.js',
  'stats.html', 'stats.css', 'stats.js',
  'pet.css', 'shared.js', 'domain.mjs',
  'fonts/ZCOOLXiaoWei-Regular.ttf',
  'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png',
];

const checkOnly = process.argv.includes('--check');

async function syncOne(source, target, label) {
  const sourceBytes = await fs.readFile(source);
  let targetBytes = null;
  try {
    targetBytes = await fs.readFile(target);
  } catch {
    targetBytes = null;
  }
  if (targetBytes && Buffer.compare(sourceBytes, targetBytes) === 0) {
    console.log(`一致  ${label}`);
    return true;
  }
  if (checkOnly) {
    console.log(`不一致 ${label}`);
    return false;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, sourceBytes);
  console.log(`已同步 ${label}（${sourceBytes.length} 字节）`);
  return true;
}

async function main() {
  let drift = 0;

  for (const name of CORE_FILES) {
    const ok = await syncOne(path.join(coreDir, name), path.join(extensionDir, name), `扩展包/${name}`);
    if (!ok) drift += 1;
  }

  for (const name of CORE_FILES) {
    const ok = await syncOne(
      path.join(coreDir, name),
      path.join(desktopDir, 'vendor', 'yidian-core', name),
      `桌面端/vendor/${name}`,
    );
    if (!ok) drift += 1;
  }

  for (const name of BUNDLE_FILES) {
    const ok = await syncOne(
      path.join(extensionDir, name),
      path.join(desktopDir, 'assets', 'bundle', name),
      `桌面端/assets/bundle/${name}`,
    );
    if (!ok) drift += 1;
  }

  if (drift) {
    console.error(`有 ${drift} 处与源头不一致`);
    process.exitCode = 1;
  } else {
    console.log('全部一致');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
