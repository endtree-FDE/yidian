import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const repo = new URL('../', import.meta.url);
const studio = new URL('../studio/', import.meta.url);
const read = (file) => readFile(new URL(file, studio), 'utf8');

test('官网、扩展和离线缓存使用同一发布版本', async () => {
  const [packageFile, manifestFile, html, worker, readme] = await Promise.all([
    readFile(new URL('package.json', repo), 'utf8'),
    readFile(new URL('extension/manifest.json', repo), 'utf8'),
    read('index.html'), read('service-worker.js'), read('README.md'),
  ]);
  const version = JSON.parse(packageFile).version;
  assert.equal(JSON.parse(manifestFile).version, version);
  assert.ok(html.includes(`href="yidian-${version}.zip"`));
  assert.ok(html.includes(`官网手动版已更新到 ${version}`));
  assert.ok(readme.includes(`\`${version}\``));
  assert.ok(worker.includes(`yidian-site-${version}`));
  const stylesheet = html.match(/href="(styles\.css\?v=\d+)"/)?.[1];
  assert.ok(stylesheet && worker.includes(`'./${stylesheet}'`));
});

test('ModelScope Static 创空间入口与卡片配置完整', async () => {
  const [readme, html] = await Promise.all([read('README.md'), read('index.html')]);
  const frontMatter = readme.replaceAll('\r\n', '\n').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  assert.match(frontMatter, /^sdk: static$/m);
  assert.match(frontMatter, /^entry_file: index\.html$/m);
  assert.match(frontMatter, /^deployspec:\n  entry_file: index\.html$/m);
  assert.match(frontMatter, /^license: MIT License$/m);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>一点｜工作与学习的收藏回看工具<\/title>/);
  assert.match(html, /<p class="kicker">工作与学习的收藏回看工具<\/p>/);
  assert.match(html, /重要的，<br><em>不只见一次。<\/em>/);
  assert.match(html, /<a class="primary" href="#demo">看看怎么用<\/a>/);
  assert.doesNotMatch(html, /<a[^>]+href="#demo"[^>]*>收下一条<\/a>/);
  assert.match(html, /yidian-1\.3\.3\.zip/);
  assert.match(html, /不读取未选择的正文，不上传记录，不要求登录/);
  assert.match(html, /id="features"/);
  assert.match(html, /我的收藏/);
  assert.match(html, /搜索与归档 · 回看统计 · JSON \/ Markdown 导出/);
  assert.match(html, /收下整页或选段/);
  assert.match(html, /第 2、7、30 天再见/);
  assert.match(html, /class="quiet-reminder"/);
  assert.match(html, /<img src="icon\.png" alt=""><i>1<\/i>/);
  assert.match(html, /到期时，图标旁出现数字。/);
  assert.match(html, /数字表示待回看的收藏数量。不弹窗，不催促；你点开时，一次带回一条。/);
  assert.match(html, /id="updates"/);
  assert.match(html, /1\.3\.3 更新速览 · 2026-09-30/);
  assert.match(html, /今天先见一条，<br>看完再做选择。/);
  assert.match(html, /今天一条[\s\S]*用上了[\s\S]*稍后再看[\s\S]*不再需要/);
  assert.match(html, /href="changelog\.html">查看完整更新记录 →<\/a>/);
  assert.match(html, /先选版本，<br>再照着装。/);
  assert.match(html, /microsoftedge\.microsoft\.com\/addons\/detail\/mdpemepjnajchhlagfkpggenllebeacd/);
  assert.match(html, /下载官网 1\.3\.3/);
  assert.match(html, /途中偶遇 2 次/);
  assert.match(html, /相见足迹示意/);
  assert.match(html, /让一点留在浏览器右上角/);
  assert.match(html, /免打扰与每日摘要/);
  assert.match(html, /把旧收藏一起带过来/);
  assert.match(html, /如果你继续使用 Edge 商店版，这里不用看/);
  assert.match(html, /改用官网 1\.3\.3/);
  assert.match(html, /已经装过解压版/);
  assert.match(html, /从商店版换过来/);
  assert.match(html, /推荐给大多数人 · 自动更新/);
  assert.match(html, /官网手动版已更新到 1\.3\.3/);
  assert.match(html, /Edge 商店目前仍是 1\.0\.1/);
  assert.match(html, /功能会少一些/);
  assert.match(html, /完整新功能 · 手动安装/);
  assert.match(html, /去 Edge 商店安装/);
  assert.match(html, /旧收藏回来了，一点还记得你们见过几次/);
  assert.match(html, /同一网页只保留一条/);
  assert.match(html, /点浏览器右上角的“扩展”（拼图图标）/);
  assert.match(html, /class="pin-path"/);
  assert.match(html, /class="privacy-link" href="privacy\.html">查看完整隐私政策 →<\/a>/);
  assert.match(html, /免费 · 无需登录 · 收藏只在这台电脑里/);
  assert.match(html, /href="contact\.html"/);
  assert.doesNotMatch(html, /Codex|艺术与文化管理研究者|任何浏览器/);
  await Promise.all(['index.html','contact.html','changelog.html','privacy.html','styles.css','app.js','icon.png'].map((file) => access(new URL(file, studio))));
  assert.match(html, /在原文件夹更新/);
  assert.match(html, /不要从新文件夹再点“加载解压缩的扩展”/);
});

test('创空间互动演示含四阶段成长和真实指针拖动', async () => {
  const script = await read('app.js');
  assert.match(script, /percent:25/);
  assert.match(script, /percent:50/);
  assert.match(script, /percent:75/);
  assert.match(script, /percent:100/);
  assert.match(script, /pointerdown/);
  assert.match(script, /pointermove/);
  assert.match(script, /setPointerCapture/);
  assert.match(script, /reading-journey/);
  assert.match(script, /prefers-reduced-motion:no-preference/);
  assert.match(script, /requestAnimationFrame/);
  assert.match(script, /看看第 2 天/);
  assert.match(script, /看看第 7 天/);
  assert.match(script, /看看第 30 天/);
});

test('反馈与联系页只保留受众需要的反馈、关注和作者入口', async () => {
  const html = await read('contact.html');
  assert.match(html, /<title>反馈与联系 · 一点<\/title>/);
  assert.match(html, /id="feedback"/);
  assert.match(html, /我是终树/);
  assert.match(html, /github\.com\/2487238628/);
  assert.match(html, /docs\.qq\.com\/form\/page\/DZE9LR0hwVkRyemZn/);
  assert.match(html, /写下反馈/);
  assert.match(html, /需要登录腾讯文档/);
  assert.match(html, /xiaohongshu-endtree\.jpg/);
  assert.match(html, /1052658250/);
  assert.match(html, /在小红书找到一点/);
  assert.match(html, /id="social"/);
  assert.doesNotMatch(html, /暂不建群|不同时维护微信群和飞书群|等出现一批|第一版不为|已开放|已公开/);
  await access(new URL('xiaohongshu-endtree.jpg', studio));
});
test('我的收藏用状态、动作和结果解释回看流程', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('extension/library.html', repo), 'utf8'),
    readFile(new URL('extension/library.js', repo), 'utf8'),
  ]);
  assert.match(html, /今天看一条/);
  assert.match(html, /用上了/);
  assert.match(html, /稍后再看/);
  assert.match(html, /不再需要/);
  assert.match(script, /下次回看/);
  assert.match(html, /今天待回看/);
  assert.match(html, /每条内容共 4 步：收下 1 次，再回看 3 次/);
  assert.match(html, /已完成回看计划/);
  assert.match(html, /打开原网页/);
  assert.match(html, /按关系状态查看/);
  assert.match(html, /相见足迹/);
  assert.match(script, /途中偶遇.*原来的计划一直在继续/);
  assert.match(html, /解压版换了文件夹重新加载/);
  assert.match(html, /开启旧版，关闭新版/);
  assert.match(html, /导入会按网页合并/);
  assert.match(script, /进度 \$\{record\.stage\}\/4/);
  assert.match(script, /hour: '2-digit'/);
  assert.match(script, /minute: '2-digit'/);
  assert.match(script, /后可回看/);
  assert.doesNotMatch(`${html}\n${script}`, /今天可回来|已经长成 · 100%|收下一条就已经完成 25%/);
});

test('收藏库提供搜索、已归档筛选与归档动作', async () => {
  const [html, script] = await Promise.all([
    readFile(new URL('extension/library.html', repo), 'utf8'),
    readFile(new URL('extension/library.js', repo), 'utf8'),
  ]);
  assert.match(html, /搜索标题、域名或选段/);
  assert.match(html, /data-filter="archived"/);
  assert.match(html, /归档已完成/);
  assert.match(html, /带回收藏库/);
  assert.match(html, /id="quiet-toggle"/);
  assert.match(html, /免打扰开始时间/);
  assert.match(script, /matchesRecordQuery/);
  assert.match(script, /type:'archive-grown'/);
  assert.match(script, /type:'restore-record'/);
  assert.match(script, /type:'list-archived'/);
  assert.match(script, /type:'set-quiet-hours'/);
  assert.match(script, /archived: response\.archived/);
});

test('GitHub 反馈入口区分使用问题和功能建议', async () => {
  const [problem, idea, config] = await Promise.all([
    readFile(new URL('.github/ISSUE_TEMPLATE/problem.yml', repo), 'utf8'),
    readFile(new URL('.github/ISSUE_TEMPLATE/idea.yml', repo), 'utf8'),
    readFile(new URL('.github/ISSUE_TEMPLATE/config.yml', repo), 'utf8'),
  ]);
  assert.match(problem, /name: 使用问题/);
  assert.match(idea, /name: 功能建议/);
  assert.match(config, /blank_issues_enabled: false/);
});

test('更新记录页公开当前版本和反馈去向', async () => {
  const html = await read('changelog.html');
  assert.match(html, /<title>更新记录 · 一点<\/title>/);
  assert.match(html, /1\.3\.0 · 更温柔的回看/);
  assert.match(html, /1\.2\.0 · 收藏库、免打扰、统计与侧边栏/);
  assert.match(html, /1\.0\.3 · 一点说话更像一点/);
  assert.match(html, /1\.0\.1 · 说清楚四步/);
  assert.match(html, /1\.0\.2 · 把重复收藏改成途中偶遇/);
  assert.match(html, /1\.0\.0 · 第一版/);
  assert.match(html, /2026-07-30/);
  assert.match(html, /2026-08-02/);
  assert.match(html, /2026-08-03/);
  assert.match(html, /2026-07-28/);
  assert.match(html, /第 1 天收下，第 2、7、30 天/);
  assert.match(html, /不弹窗，也不强制打扰/);
  assert.match(html, /旧的重复收藏会自动合成一条/);
  assert.match(html, /已在 Edge 中验证收藏、偶遇、导入和回看流程/);
  assert.match(html, /contact\.html#feedback/);
});


test('隐私页准确说明本地数据和最小权限边界', async () => {
  const html = await read('privacy.html');
  assert.match(html, /<title>隐私政策 · 一点<\/title>/);
  assert.match(html, /留在你的浏览器里/);
  assert.match(html, /不把收藏记录上传到服务器/);
  assert.match(html, /未选中的网页正文不会被保存/);
  assert.match(html, /读取当前标签页/);
  assert.match(html, /定时检查/);
  assert.match(html, /导出备份文件/);
  assert.doesNotMatch(html, /JSON 备份/);
  assert.match(html, /本地存储/);
  assert.match(html, /contact\.html#feedback/);
  assert.doesNotMatch(html, /云同步已经|自动收集|第三方分析/);
});

test('创空间不依赖远程脚本、字体或追踪器', async () => {
  const html = await read('index.html');
  assert.doesNotMatch(html, /<(?:script|link)[^>]+https?:\/\//i);
  assert.doesNotMatch(html, /analytics|segment|sentry|gtag/i);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
});


test('官网保留 PWA 离线外壳，但首页不把它混作浏览器扩展', async () => {
  const [html, manifestText, worker, pwa] = await Promise.all([
    read('index.html'),
    read('manifest.webmanifest'),
    read('service-worker.js'),
    read('pwa.js'),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ['192x192', '512x512']);
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.doesNotMatch(html, /data-install-app|把一点装到电脑|安装官网应用/);
  assert.match(worker, /addEventListener\('fetch'/);
  assert.match(worker, /caches\.match\('.\/index\.html'\)/);
  assert.match(worker, /SKIP_WAITING/);
  assert.match(pwa, /beforeinstallprompt/);
  assert.match(pwa, /一点长大了一点/);
  await Promise.all(['manifest.webmanifest', 'service-worker.js', 'pwa.js', 'icon-192.png', 'icon-512.png'].map((file) => access(new URL(file, studio))));
});
