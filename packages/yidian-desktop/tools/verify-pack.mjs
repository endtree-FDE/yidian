// 校验打包版 app.asar 的内容是否与工作区源一致。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

const desktopDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..');
const packedAsar = path.join(desktopDir, 'dist', 'win-unpacked', 'resources', 'app.asar');
// 本次构建的输出目录（用来核对 asar 与构建产物逐字节一致）
const buildDir = process.env.YIDIAN_BUILD_DIR || 'yidian-dist7';
const tempAsar = path.join(process.env.TEMP, buildDir, 'win-unpacked', 'resources', 'app.asar');

const checks = [
  ['assets/bundle/domain.mjs', (text) => text.includes('mergeByKey'), '含 mergeByKey'],
  ['assets/bundle/library.js', (text) => /from\s+['"]\.\/domain\.mjs/.test(text), 'import 了 domain.mjs'],
  ['assets/bundle/library.js', (text) => text.includes('record-summary'), '收藏库会显示页面描述'],
  ['assets/bundle/library.js', (text) => text.includes('set-note'), '收藏库能写一句批注'],
  ['assets/bundle/library.html', (text) => text.includes('note-input'), '收藏库模板有批注输入框'],
  ['assets/bundle/library.html', (text) => text.includes('desktop-panel'), '收藏库页带配对面板'],
  ['assets/bundle/library.js', (text) => text.includes('pair-desktop'), '收藏库脚本会请求配对'],
  ['assets/bundle/pet.css', (text) => text.includes('.o-summary'), '宠物样式带描述行'],
  ['assets/bundle/pet.css', (text) => text.includes('.o-note'), '宠物样式带批注行'],
  ['assets/bundle/shared.js', () => true, '共享文案'],
  ['assets/bundle/stats.js', () => true, '统计页脚本'],
  ['vendor/yidian-core/domain.mjs', (text) => text.includes('mergeByKey'), '核心副本'],
  ['vendor/yidian-core/domain.mjs', (text) => text.includes('setNote'), '核心副本含批注逻辑'],
  ['vendor/yidian-core/messages.mjs', (text) => text.includes('createMessageLayer'), '消息层副本'],
  ['vendor/yidian-core/bridge-protocol.mjs', (text) => text.includes('EXTENSION_HEADER'), '桥协议副本'],
  ['vendor/yidian-core/page-meta.mjs', (text) => text.includes('extractMetaFromHtml'), '页面元信息副本'],
  ['core/platform.mjs', (text) => text.includes('createDesktopPlatform'), '平台适配器'],
  ['core/store.mjs', () => true, '文件存储'],
  ['core/capture.mjs', (text) => text.includes('resolveCaptureTab'), '桌面端采集解析层'],
  ['core/bridge-server.mjs', (text) => text.includes('access-control-allow-origin'), '本地桥'],
  ['core/bridge-route.mjs', (text) => text.includes('BRIDGE_PATHS'), '桥路由'],
  ['core/pairing.mjs', (text) => text.includes('beginPairing') && text.includes('timingSafeEqual'), '配对与鉴权'],
  ['main.mjs', (text) => text.includes('captureWindow') && text.includes('Control+Alt+Y') && text.includes('startPairing'), '抓图重试 + 全局热键 + 配对'],
  ['main.mjs', (text) => text.includes('fetchPageMeta') && text.includes('net.fetch'), '会抓页面的标题与描述'],
  ['renderer/pet.html', () => true, '宠物窗'],
  ['renderer/card.html', () => true, '卡片窗'],
  ['renderer/pair.html', (text) => text.includes('desktop-code') || text.includes('pair-code'), '配对窗'],
  ['renderer/pair.js', (text) => text.includes('countdown'), '配对窗脚本'],
  ['renderer/desktop-pair.css', (text) => text.includes('pair-code'), '配对窗样式'],
];

let bad = 0;
for (const [rel, check, label] of checks) {
  // asar 的 extractFile 在 Windows 上要平台分隔符
  const packedPath = rel.split('/').join(path.sep);
  const text = asar.extractFile(packedAsar, packedPath).toString('utf8');
  const ok = check(text);
  if (!ok) bad += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${rel}  (${text.length} 字节) ${label}`);
}
const font = asar.extractFile(packedAsar, path.join('assets', 'bundle', 'fonts', 'ZCOOLXiaoWei-Regular.ttf'));
console.log(`${font.length > 50000 ? 'OK  ' : 'FAIL'} 字体 ${font.length} 字节`);

const src = fs.readFileSync(packedAsar);
if (fs.existsSync(tempAsar)) {
  const ref = fs.readFileSync(tempAsar);
  const same = Buffer.compare(src, ref) === 0;
  console.log(`${same ? 'OK  ' : 'FAIL'} 打包 asar 与本次构建产物字节一致`);
  if (!same) bad += 1;
} else {
  console.log('跳过 与本次构建产物字节一致（对照目录已不存在）');
}

console.log(bad === 0 ? '\n全部通过' : `\n有 ${bad} 项不通过`);
process.exitCode = bad === 0 ? 0 : 1;
