import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url)));

test('Manifest V3 且权限严格等于网页宠物允许列表', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.3.4');
  assert.equal(manifest.name, '一点｜收藏回看工具');
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab','alarms','notifications','scripting','sidePanel','storage','unlimitedStorage'].sort());
  // 唯一的主机权限是回环地址：扩展要连本机桌面端的桥。
  // 没有它，Chrome 会按 Private Network Access 拦掉对 127.0.0.1 的请求。
  // 不给任何其它站点的主机权限——不读网页、不碰用户的浏览器数据。
  assert.deepEqual([...(manifest.host_permissions ?? [])], ['http://127.0.0.1/*']);
  assert.equal('content_scripts' in manifest, false);
  assert.deepEqual(Object.keys(manifest).sort(), [
    'action','background','commands','description','host_permissions','icons','manifest_version',
    'minimum_chrome_version','name','options_ui','permissions','side_panel','version','web_accessible_resources'
  ].sort());
});

test('清单引用的扩展资源全部存在', async () => {
  const files = new Set([
    manifest.background.service_worker, manifest.options_ui.page, manifest.side_panel.default_path,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.web_accessible_resources.flatMap(({ resources }) => resources),
  ]);
  await Promise.all([...files].map((file) => access(new URL(`../extension/${file}`, import.meta.url))));
});

test('使用模块化 service worker、工具栏动作和自定义快捷键', () => {
  assert.deepEqual(manifest.background, { service_worker:'service-worker.mjs', type:'module' });
  assert.equal('default_popup' in manifest.action, false);
  assert.equal('_execute_action' in manifest.commands, false);
  assert.ok(manifest.commands['open-current-document'].description);
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  assert.equal(manifest.commands['open-side-panel'].suggested_key.default, 'Alt+Shift+Y');
  assert.deepEqual(manifest.options_ui, { page:'library.html', open_in_tab:true });
});
