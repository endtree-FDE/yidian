#!/usr/bin/env node
// 一键构造"即将到期"测试数据：输出可直接粘贴到扩展 Service Worker 控制台的脚本。
// 因为 chrome.storage 只能在扩展上下文里写，所以这里生成片段而不是直接改数据。
//
// 用法（仓库根目录）：
//   node tools/seed-due.mjs [--count 1] [--in-minutes 1]
//
// 自测步骤：
//   1. edge://extensions 打开扩展的 Service Worker 控制台
//   2. 粘贴本工具输出的片段并回车（把前 N 条记录的到期时间拨到 M 分钟后）
//   3. 在"我的收藏"里打开到期通知 → 等待通知，角标应同步变化
//   4. 恢复：把 --in-minutes 改成大数（如 1440）再贴一次即可拨回未来

function parseArgs(argv) {
  const args = { count: 1, inMinutes: 1 };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--count') args.count = Number(argv[++i]);
    else if (key === '--in-minutes') args.inMinutes = Number(argv[++i]);
    else throw new Error(`未知参数：${key}`);
  }
  if (!Number.isInteger(args.count) || args.count < 1) throw new Error('--count 需为正整数');
  if (!Number.isFinite(args.inMinutes)) throw new Error('--in-minutes 需为数字');
  return args;
}

const args = parseArgs(process.argv);

console.log(`// 一点自测片段：把前 ${args.count} 条记录的到期时间拨到 ${args.inMinutes} 分钟后`);
console.log(`// 粘贴到扩展 Service Worker 控制台执行（未打包扩展闹钟下限 30 秒，建议 >= 1 分钟）`);
console.log(`chrome.storage.local.get('records', ({ records = [] }) => {`);
console.log(`  if (!records.length) return console.warn('库里还没有记录，先收下几个网页再来');`);
console.log(`  const target = Date.now() + ${args.inMinutes * 60_000};`);
console.log(`  records.slice(0, ${args.count}).forEach((record) => {`);
console.log(`    record.stage = Math.min(record.stage, 3); // 第 4 阶段永不到期，拨回可测阶段`);
console.log(`    record.nextReviewAt = target;`);
console.log(`  });`);
console.log(`  chrome.storage.local.set({ records }, () => console.log('ready', target));`);
console.log(`});`);
