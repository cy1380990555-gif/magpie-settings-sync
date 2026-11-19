#!/usr/bin/env node
/** Two-device simulation using folder backend; never touches the real ~/.config/magpie. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SYNC = path.join(HERE, '..', 'scripts', 'sync.mjs');
const ROOT = path.join(HERE, '..', '..', '..', 'magpie-plugin', '.selftest');
const CASE = path.join(ROOT, String(Date.now()));
const SHARED = path.join(CASE, 'shared');

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function makeDevice(name, settings, plugins) {
  const home = path.join(CASE, name, 'home');
  const config = path.join(home, '.config', 'magpie');
  const data = path.join(config, 'plugin-work', 'magpie-settings-sync');
  writeJson(path.join(config, 'settings.json'), settings);
  writeJson(path.join(config, 'plugins.json'), plugins);
  writeJson(path.join(data, 'config.json'), {
    schema: 1,
    enabled: true,
    deviceId: `device-${name}`,
    deviceName: name,
    backend: 'folder',
    conflictPolicy: 'newer-wins',
    folder: { path: SHARED, file: 'magpie-snapshot.json' },
    auto: { pullOnSessionStart: true, pushOnStop: true, debounceSeconds: 0 }
  });
  return {
    settings: path.join(config, 'settings.json'),
    plugins: path.join(config, 'plugins.json'),
    data,
    env: { ...process.env, MAGPIE_USER_HOME: home, MAGPIE_SYNC_DATA_DIR: data }
  };
}

function run(action, env, extraArgs = []) {
  const r = spawnSync(process.execPath, [SYNC, action, ...extraArgs], { encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`${action} 失败:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  console.log(`  PASS ${msg}`);
}

const A = makeDevice(
  'a',
  {
    theme: 'dark',
    lang: 'zh',
    tray: 'panel',
    currency: 'cny',
    textSize: 110,
    keepAwake: true,
    quitNoAsk: true,
    hiddenModels: { dsh: ['model/a'] },
    pluginCheckins: { tabbit: true },
    window: [100, 100],
    otel: { endpoint: 'device-secret' },
    sessionReads: { all: true }
  },
  {
    plugins: [
      { spec: '@magpie-community/opencode-workbuddy-auth@latest' },
      { spec: 'D:\\magpie-plugins\\tabbit' }
    ]
  }
);
const B = makeDevice(
  'b',
  {
    theme: 'light',
    lang: 'en',
    tray: 'window',
    currency: 'usd',
    textSize: 100,
    keepAwake: false,
    quitNoAsk: false,
    hiddenModels: {},
    pluginCheckins: {},
    window: [900, 900],
    otel: {},
    sessionReads: { all: false }
  },
  { plugins: [{ spec: 'D:\\local\\b-only' }] }
);
const C = makeDevice(
  'c',
  {
    theme: 'none',
    lang: 'xx',
    currency: 'xxx',
    window: [1, 1]
  },
  { plugins: [{ spec: 'D:\\local\\c-only' }] }
);

console.log(`[selftest] 临时目录: ${CASE}`);

console.log('[1] 设备 A 推送');
run('push', A.env);
const snapshotPath = path.join(SHARED, 'magpie-snapshot.json');
assert(fs.existsSync(snapshotPath), '远端快照已创建');
const snapText = fs.readFileSync(snapshotPath, 'utf8');
assert(!snapText.includes('device-secret'), 'otel 设备信息被排除');
assert(!snapText.includes('window'), '窗口位置被排除');
assert(!snapText.includes('sessionReads'), '会话读取隐私设置被排除');
assert(!snapText.includes('D:\\\\magpie-plugins'), '本地绝对路径插件被排除');
const snap = readJson(snapshotPath);
assert(Object.keys(snap.entries).some((k) => k.includes('theme')), '主题进入快照');

console.log('[2] 设备 B 拉取');
run('pull', B.env);
const bSettings = readJson(B.settings);
const bPlugins = readJson(B.plugins);
assert(bSettings.theme === 'dark', '主题已同步到 B');
assert(bSettings.lang === 'zh', '语言已同步到 B');
assert(bSettings.currency === 'cny', '货币已同步到 B');
assert(bSettings.window[0] === 900, '窗口位置未被覆盖');
assert(bPlugins.plugins.some((p) => p.spec.includes('opencode-workbuddy-auth')), '可移植插件 spec 已同步');
assert(!bPlugins.plugins.some((p) => p.spec.includes('tabbit')), '本地路径插件未被同步');
assert(bPlugins.plugins.some((p) => p.spec.includes('b-only')), '本机路径插件在拉取后被保留');

console.log('[3] 并发修改冲突（newer-wins）');
{
  const s = readJson(A.settings);
  s.theme = 'light';
  writeJson(A.settings, s);
  const future = Date.now() + 60000;
  fs.utimesSync(A.settings, new Date(future), new Date(future));
}
run('push', A.env);
{
  const s = readJson(B.settings);
  s.theme = 'system';
  writeJson(B.settings, s);
}
run('pull', B.env);
assert(readJson(B.settings).theme === 'light', '较新的远端值胜出');
const conflicts = readJson(path.join(B.data, 'conflicts.json'));
assert(conflicts.length >= 1, '冲突已写入 conflicts.json');

console.log('[4] 导出/导入（飞书文档手动方式）');
{
  const exportFile = path.join(CASE, 'manual-snapshot.json');
  run('export', A.env, ['--out', exportFile]);
  assert(fs.existsSync(exportFile), '快照已导出为可复制文件');
  run('import', C.env, ['--file', exportFile]);
  const cSettings = readJson(C.settings);
  const cPlugins = readJson(C.plugins);
  assert(cSettings.theme === 'light', '手动导入后主题已同步');
  assert(cSettings.window[0] === 1, '手动导入不覆盖窗口位置');
  assert(cPlugins.plugins.some((p) => p.spec.includes('c-only')), '手动导入保留本机路径插件');
}

console.log('[selftest] 全部通过');
