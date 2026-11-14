// 字体守卫：一点的大字（宠物卡片那句话）用内置的 ZCOOL XiaoWei 子集。
// 漏一个字符，那个字就会掉到系统字体，整句话变成两种字体；更糟的是上游字体里
// 有几个字（「回」「一」）本身被画成实心方块，放进大字会像渲染坏了。
//
// 这个测试卡两件事：
//   1) 内置字体覆盖界面文案里用到的全部字符；
//   2) 内置字体的指纹没被悄悄换掉（换字体要走 tools/build-font-subset.py）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fontPath = path.join(root, 'extension', 'fonts', 'ZCOOLXiaoWei-Regular.ttf');

// 重新生成子集后，用 tools/build-font-subset.py 的输出更新这里。
const FONT_SHA256 = '6a74459b62e483cd6bfb2131cdbc9b39453db0895845021ab8e6cc4d85523812';

// 会被大字渲染的文案来源
const UI_SOURCES = [
  path.join(root, 'extension', 'pet.js'),
  path.join(root, 'packages', 'yidian-desktop', 'renderer', 'card.js'),
  path.join(root, 'extension', 'shared.js'),
];

/** 读出 TTF 的 cmap，返回覆盖的码位集合。 */
function readCmap(buffer) {
  const numTables = buffer.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    const tag = buffer.toString('ascii', record, record + 4);
    if (tag === 'cmap') cmapOffset = buffer.readUInt32BE(record + 8);
  }
  assert.ok(cmapOffset > 0, '字体里没有 cmap 表');

  const subtableCount = buffer.readUInt16BE(cmapOffset + 2);
  let chosen = -1;
  let chosenFormat = 0;
  for (let i = 0; i < subtableCount; i += 1) {
    const record = cmapOffset + 4 + i * 8;
    const platformId = buffer.readUInt16BE(record);
    const encodingId = buffer.readUInt16BE(record + 2);
    const offset = cmapOffset + buffer.readUInt32BE(record + 4);
    const format = buffer.readUInt16BE(offset);
    const isUnicode = platformId === 3 && (encodingId === 1 || encodingId === 10);
    if (isUnicode && (format === 12 || (format === 4 && chosenFormat < 4))) {
      chosen = offset;
      chosenFormat = format;
      if (format === 12) break;
    }
  }
  assert.ok(chosen > 0, '字体里没有可用的 Unicode 子表');

  const covered = new Set();
  if (chosenFormat === 12) {
    const groupCount = buffer.readUInt32BE(chosen + 12);
    for (let i = 0; i < groupCount; i += 1) {
      const group = chosen + 16 + i * 12;
      const start = buffer.readUInt32BE(group);
      const end = buffer.readUInt32BE(group + 4);
      for (let cp = start; cp <= end; cp += 1) covered.add(cp);
    }
    return covered;
  }

  // format 4
  const segCount = buffer.readUInt16BE(chosen + 6) / 2;
  const endCodes = chosen + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  for (let seg = 0; seg < segCount; seg += 1) {
    const end = buffer.readUInt16BE(endCodes + seg * 2);
    const start = buffer.readUInt16BE(startCodes + seg * 2);
    const delta = buffer.readInt16BE(idDeltas + seg * 2);
    const rangeOffset = buffer.readUInt16BE(idRangeOffsets + seg * 2);
    if (start === 0xffff) continue;
    for (let cp = start; cp <= end; cp += 1) {
      if (rangeOffset === 0) {
        const glyph = (cp + delta) & 0xffff;
        if (glyph !== 0) covered.add(cp);
        continue;
      }
      const glyphIndexAddress = idRangeOffsets + seg * 2 + rangeOffset + (cp - start) * 2;
      if (glyphIndexAddress + 1 >= buffer.length) continue;
      const glyph = buffer.readUInt16BE(glyphIndexAddress);
      if (glyph !== 0) covered.add(cp);
    }
  }
  return covered;
}

/**
 * 整行注释不参与字体要求。
 *
 * 注释不会渲染，却会被「扫全文取字」算进去 ——
 * 于是改一句注释就要求重建字体子集，纯噪音。
 * 只跳过「整行都是注释」的行；行尾注释照旧计入（宁可严，不可漏）。
 */
function stripCommentLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (trimmed.startsWith('//')) return false;
      if (trimmed.startsWith('/*') && trimmed.endsWith('*/')) return false;
      if (trimmed.startsWith('*')) return false;
      return true;
    })
    .join('\n');
}

function collectChars(text) {
  const chars = new Set();
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code > 0x2000 && !(code >= 0xe000 && code <= 0xf8ff)) chars.add(code);
  }
  return chars;
}

function collectUiChars() {
  const chars = new Set();
  for (const file of UI_SOURCES) {
    const text = stripCommentLines(fs.readFileSync(file, 'utf8'));
    for (const code of collectChars(text)) chars.add(code);
  }
  return chars;
}

test('内置字体覆盖界面文案里用到的每一个字', () => {
  const buffer = fs.readFileSync(fontPath);
  const covered = readCmap(buffer);
  const used = collectUiChars();
  const missing = [...used].filter((code) => !covered.has(code));
  assert.deepEqual(
    missing.map((code) => String.fromCodePoint(code)),
    [],
    '这些字不在内置字体里，会掉到系统字体。改文案后请跑 tools/build-font-subset.py 重建子集',
  );
});

test('内置字体指纹没被悄悄换掉', () => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(fontPath)).digest('hex');
  assert.equal(digest, FONT_SHA256, '字体资产变了：确认后更新 tests/font-guard.test.mjs 里的指纹');
});

test('注释行不算进字体要求，但界面文案一个字都不能漏', () => {
  const cardSource = fs.readFileSync(path.join(root, 'packages', 'yidian-desktop', 'renderer', 'card.js'), 'utf8');
  const raw = collectChars(cardSource);
  const stripped = collectChars(stripCommentLines(cardSource));
  assert.ok(stripped.size < raw.size, '整行注释应该被排除在字体要求之外');
  assert.ok(stripped.size > 0, '界面文案一个字都不能漏');
  // 真正会用大字渲染的那句话，必须还在要求里
  const kept = stripCommentLines(cardSource);
  assert.ok(kept.includes('它来啦。今天再见一面？'), '大字文案被误删了');
  assert.ok(kept.includes('我记得它。'), '大字文案被误删了');
});
