// 一点 · 公共文案与进度定义
// 同时被 library.html（经典 script 引入）和 pet.js（随注入脚本一起加载）使用。
// 不要在这里引用 chrome.* 或 DOM，保持零依赖。
(function () {
  const STAGE_PERCENT = [0, 25, 50, 75, 100];
  const STEP_COPY = [
    '还没有收下',
    '已收下 · 下一步是第 1 次回看',
    '已完成第 1 次回看',
    '已完成第 2 次回看',
    '已完成第 3 次回看',
  ];
  globalThis.YIDIAN_COPY = {
    progress: (stage) => STAGE_PERCENT[stage] ?? 0,
    stepCopy: (stage) => STEP_COPY[stage] ?? '',
  };
})();
