#!/usr/bin/env node
/**
 * Magpie / WorkBuddy settings sync (no external dependencies).
 * Commands: init | doctor | status | pull | push | sync
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const USER_HOME = process.env.MAGPIE_USER_HOME || os.homedir();
const MAGPIE_HOME = process.env.MAGPIE_CONFIG_HOME || path.join(USER_HOME, '.config', 'magpie');
const DATA_DIR = process.env.MAGPIE_SYNC_DATA_DIR || path.join(MAGPIE_HOME, 'plugin-work', 'magpie-settings-sync');
const CONFIG_PATH = process.env.MAGPIE_SYNC_CONFIG || path.join(DATA_DIR, 'config.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const LOG_PATH = path.join(DATA_DIR, 'sync.log');
const CONFLICT_PATH = path.join(DATA_DIR, 'conflicts.json');
const SNAPSHOT_FILE = 'magpie-snapshot.json';
// 内置同步文档：新设备装上插件后零配置，自动同步到同一份飞书文档。
const BUILTIN_FILE_TOKEN = 'WDHPbZHvhoiQkwxF68PcjJ4GnGd';
const BUILTIN_DOC_URL = 'https://my.feishu.cn/file/WDHPbZHvhoiQkwxF68PcjJ4GnGd';
// 旧版本内置的曹勇账号文档；升级后自动迁移到 Space 账号文档。
const LEGACY_FILE_TOKENS = ['DbkPbGonToQiNUx37r0cQ75lnrp'];
const FILES = {
  'settings.json': path.join(MAGPIE_HOME, 'settings.json'),
  'plugins.json': path.join(MAGPIE_HOME, 'plugins.json')
};

const DEFAULT_CONFIG = {
  schema: 1,
  enabled: true,
  deviceId: '',
  deviceName: os.hostname(),
  backend: 'folder',
  conflictPolicy: 'newer-wins',
  mirrorDeletes: false,
  auto: { pullOnSessionStart: true, pushOnStop: true, debounceSeconds: 15 },
  scope: {
    'settings.json': [
      ['theme'],
      ['lang'],
      ['tray'],
      ['currency'],
      ['textSize'],
      ['keepAwake'],
      ['quitNoAsk'],
      ['updateEvery'],
      ['groupSink'],
      ['groupFirstToken'],
      ['trayUsageEvery'],
      ['trayNoLogos'],
      ['trayNoNumber'],
      ['trayPace'],
      ['chinaMirror'],
      ['hiddenModels'],
      ['pluginCheckins'],
      ['checkinAt']
    ],
    'plugins.json': [['plugins']]
  },
  excludePatterns: [
    '(?i)(token|secret|password|credential|apikey|api_key|authorization|cookie|privatekey|private_key|envelope|wbEncrypted|appsecret|webhook)'
  ],
  folder: { path: '', file: SNAPSHOT_FILE },
  git: { repo: '', branch: 'main', file: SNAPSHOT_FILE },
  http: { getUrl: '', putUrl: '', tokenEnv: '', file: SNAPSHOT_FILE },
  feishu: {
    folderToken: '',
    fileName: SNAPSHOT_FILE,
    tokenEnv: 'MAGPIE_FEISHU_ACCESS_TOKEN',
    appIdEnv: 'MAGPIE_FEISHU_APP_ID',
    appSecretEnv: 'MAGPIE_FEISHU_APP_SECRET'
  },
  lark: {
    fileToken: '',
    fileName: 'Magpie设置同步.md',
    docUrl: ''
  }
};

function larkCliPaths() {
  const home = os.homedir();
  const nodeDirs = [
    path.join(home, '.workbuddy', 'binaries', 'node', 'versions'),
    path.join(home, '.workbuddy', 'binaries', 'node')
  ];
  const out = [];
  for (const d of nodeDirs) {
    try {
      for (const v of fs.readdirSync(d)) {
        const base = path.join(d, v);
        const runJs = path.join(base, 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js');
        if (fs.existsSync(runJs)) out.push({ node: path.join(base, process.platform === 'win32' ? 'node.exe' : 'node'), runJs });
      }
    } catch { /* ignore */ }
  }
  return out;
}

function larkCli(args, opts = {}) {
  const loose = !!opts.loose;
  const candidates = larkCliPaths();
  if (!candidates.length) throw new Error('未找到飞书 CLI（@larksuite/cli）。请确认已安装 WorkBuddy 飞书能力。');
  let lastErr = '';
  for (const c of candidates) {
    if (!fs.existsSync(c.node)) continue;
    const r = spawnSync(c.node, [c.runJs, ...args], {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 20 * 1024 * 1024,
      input: opts.input || undefined
    });
    if (r.error) { lastErr = r.error.message; continue; }
    const raw = `${r.stdout || ''}`;
    let json = null;
    const start = raw.indexOf('{');
    if (start >= 0) { try { json = JSON.parse(raw.slice(start)); } catch { /* keep null */ } }
    if (json && json.ok === true) return json;
    if (loose && json && !json.ok && (json.appId || json.identity)) return json;
    lastErr = (json?.error?.message || r.stderr || raw || '').toString().slice(0, 400);
    if (json && json.ok === false) break;
  }
  throw new Error(`飞书 CLI 调用失败: ${lastErr}`);
}

const DEFAULT_STATE = {
  schema: 1,
  version: 0,
  appliedHash: '',
  lastPullAt: null,
  lastPushAt: null,
  lastRemoteHash: null,
  base: {},
  localBaseline: {}
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function deepMerge(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

function makeRegExp(pattern) {
  let src = String(pattern);
  let flags = '';
  if (src.startsWith('(?i)')) { src = src.slice(4); flags += 'i'; }
  return new RegExp(src, flags);
}

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isObj(v)) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

function hashValue(v) {
  return crypto.createHash('sha256').update(stableStringify(v)).digest('hex');
}

function expandHome(p) {
  if (!p) return '';
  if (p === '~') return USER_HOME;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(USER_HOME, p.slice(2));
  return path.resolve(p);
}

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  const fd = fs.openSync(tmp, 'r+');
  try { fs.fsyncSync(fd); } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EINVAL') throw e; } finally { fs.closeSync(fd); }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES' && e.code !== 'EEXIST') throw e;
    fs.copyFileSync(tmp, file);
    fs.unlinkSync(tmp);
  }
}

function backupFile(file) {
  if (!fs.existsSync(file)) return;
  const backup = `${file}.magpie-sync-bak-${Date.now()}`;
  fs.copyFileSync(file, backup);
  const dir = path.dirname(file);
  const base = path.basename(file);
  const olds = fs.readdirSync(dir)
    .filter((n) => n.startsWith(`${base}.magpie-sync-bak-`))
    .sort();
  while (olds.length > 5) {
    fs.unlinkSync(path.join(dir, olds.shift()));
  }
}

function appendLog(line) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH, `${nowIso()} ${line}\n`, 'utf8');
    const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);
    if (lines.length > 500) fs.writeFileSync(LOG_PATH, `${lines.slice(-500).join('\n')}\n`, 'utf8');
  } catch { /* logging is best effort */ }
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    // 新设备首次运行：自动用内置文档初始化，免去手动绑定。
    const cfg = clone(DEFAULT_CONFIG);
    cfg.deviceId = crypto.randomUUID();
    cfg.backend = 'lark';
    cfg.conflictPolicy = 'higher-version-wins';
    cfg.lark.fileToken = BUILTIN_FILE_TOKEN;
    cfg.lark.docUrl = BUILTIN_DOC_URL;
    cfg.lark.fileName = 'Magpie设置同步.md';
    writeJsonAtomic(CONFIG_PATH, cfg);
    return cfg;
  }
  const cfg = deepMerge(DEFAULT_CONFIG, readJson(CONFIG_PATH));
  let changed = false;
  if (!cfg.deviceId) {
    cfg.deviceId = crypto.randomUUID();
    changed = true;
  }
  if (LEGACY_FILE_TOKENS.includes(cfg.lark?.fileToken)) {
    cfg.lark.fileToken = BUILTIN_FILE_TOKEN;
    cfg.lark.docUrl = BUILTIN_DOC_URL;
    changed = true;
  }
  if (changed) writeJsonAtomic(CONFIG_PATH, cfg);
  return cfg;
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return clone(DEFAULT_STATE);
  try { return deepMerge(DEFAULT_STATE, readJson(STATE_PATH)); }
  catch { return clone(DEFAULT_STATE); }
}

function writeState(state) { writeJsonAtomic(STATE_PATH, state); }

function writeConflicts(conflicts) {
  if (!conflicts.length) return;
  let all = [];
  if (fs.existsSync(CONFLICT_PATH)) {
    try { all = readJson(CONFLICT_PATH); } catch { all = []; }
  }
  all = [...all, ...conflicts].slice(-100);
  writeJsonAtomic(CONFLICT_PATH, all);
}

function normalizeSegments(p) {
  return (Array.isArray(p) ? p : String(p).split('.')).map(String);
}

function getPath(obj, segs) {
  let cur = obj;
  for (const s of segs) {
    if (!isObj(cur) && !Array.isArray(cur)) return undefined;
    cur = cur[s];
  }
  return cur;
}

function setPath(obj, segs, value) {
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const s = segs[i];
    if (!isObj(cur[s])) cur[s] = {};
    cur = cur[s];
  }
  cur[segs[segs.length - 1]] = value;
}

function isExcludedKey(key, cfg) {
  const patterns = cfg.excludePatterns || [];
  return patterns.some((p) => {
    try { return makeRegExp(p).test(key); } catch { return false; }
  });
}

function looksSecretString(s) {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s) || /^(sk-|ghp_|github_pat_|xox[baprs]-)/i.test(s);
}

function sanitize(value, cfg, key = '') {
  if (key && isExcludedKey(key, cfg)) return undefined;
  if (typeof value === 'string') return looksSecretString(value) ? undefined : value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v, cfg)).filter((v) => v !== undefined);
  }
  if (isObj(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isExcludedKey(k, cfg)) continue;
      const clean = sanitize(v, cfg, k);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  }
  return value;
}

function isShareablePluginSpec(spec) {
  if (typeof spec !== 'string' || !spec.trim()) return false;
  const s = spec.trim();
  if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\\\')) return false;
  if (/^file:/i.test(s)) return false;
  if (/[\\/]Users[\\/]/i.test(s)) return false;
  return true;
}

function entryKey(file, segs) { return JSON.stringify([file, ...segs]); }

function decodeKey(key) {
  try {
    const a = JSON.parse(key);
    if (Array.isArray(a) && a.length >= 2) return { file: a[0], segs: a.slice(1) };
  } catch { /* ignore */ }
  return null;
}

function readableKey(key) {
  const d = decodeKey(key);
  return d ? `${d.file}:${d.segs.join('.')}` : key;
}

function flatten(file, segs, value, out, cfg, meta) {
  // Magpie plugin specs: keep portable npm/GitHub specs, drop absolute local paths.
  if (file === 'plugins.json' && segs.length === 1 && segs[0] === 'plugins' && Array.isArray(value)) {
    const specs = value
      .map((v) => (typeof v === 'string' ? v : v?.spec))
      .filter(isShareablePluginSpec);
    out[entryKey(file, segs)] = { value: specs.map((spec) => ({ spec })), ...meta };
    return;
  }
  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (isExcludedKey(k, cfg)) continue;
      flatten(file, [...segs, k], v, out, cfg, meta);
    }
    return;
  }
  const clean = sanitize(value, cfg, segs[segs.length - 1]);
  if (clean === undefined) return;
  out[entryKey(file, segs)] = { value: clean, ...meta };
}

function buildSnapshot(cfg) {
  const entries = {};
  let latestMtime = 0;
  for (const [label, file] of Object.entries(FILES)) {
    if (!fs.existsSync(file)) continue;
    const st = fs.statSync(file);
    latestMtime = Math.max(latestMtime, st.mtimeMs);
    const doc = readJson(file);
    const meta = { updatedAt: new Date(st.mtimeMs).toISOString(), deviceId: cfg.deviceId, deviceName: cfg.deviceName };
    for (const rawPath of cfg.scope[label] || []) {
      const segs = normalizeSegments(rawPath);
      if (!segs.length) continue;
      const value = getPath(doc, segs);
      if (value === undefined) continue;
      flatten(label, segs, value, entries, cfg, meta);
    }
  }
  return {
    schema: 1,
    generatedAt: nowIso(),
    sourceMtime: latestMtime ? new Date(latestMtime).toISOString() : null,
    deviceId: cfg.deviceId,
    deviceName: cfg.deviceName,
    entries
  };
}

function snapshotHash(snapshot) {
  if (!snapshot) return null;
  const values = {};
  for (const [k, v] of Object.entries(snapshot.entries || {})) values[k] = v.value;
  return hashValue(values);
}

function mergeSnapshots(local, remote, state, cfg) {
  const entries = {};
  const conflicts = [];
  let applied = 0;
  let kept = 0;
  let adopted = 0;
  const keys = new Set([...Object.keys(local?.entries || {}), ...Object.keys(remote?.entries || {})]);
  for (const key of keys) {
    const L = local?.entries?.[key];
    const R = remote?.entries?.[key];
    if (!R) { if (L) entries[key] = L; continue; }
    if (!L) { entries[key] = R; applied += 1; continue; }

    const lh = hashValue(L.value);
    const rh = hashValue(R.value);
    if (lh === rh) { entries[key] = L; continue; }

    const baseHash = state.localBaseline?.[key]?.hash;
    let winner = L;
    let resolution = 'local';

    if (!baseHash) {
      // First contact for this path: adopt remote to protect already shared state.
      winner = R; resolution = 'remote-adopt'; adopted += 1;
    } else if (baseHash === lh) {
      winner = R; resolution = 'remote'; // local untouched since last sync
    } else if (baseHash === rh) {
      winner = L; resolution = 'local'; // remote untouched since last sync
    } else {
      if (cfg.conflictPolicy === 'prefer-remote') winner = R;
      else if (cfg.conflictPolicy === 'newer-wins') {
        const lt = Date.parse(L.updatedAt || '') || 0;
        const rt = Date.parse(R.updatedAt || '') || 0;
        winner = rt > lt ? R : L;
      } else {
        winner = L; // prefer-local / manual
      }
      resolution = winner === R ? 'remote' : 'local';
      conflicts.push({
        key,
        readablePath: readableKey(key),
        at: nowIso(),
        policy: cfg.conflictPolicy,
        resolution,
        local: { hash: lh, updatedAt: L.updatedAt, deviceId: L.deviceId },
        remote: { hash: rh, updatedAt: R.updatedAt, deviceId: R.deviceId }
      });
    }
    entries[key] = clone(winner);
    if (winner === R) applied += 1; else kept += 1;
  }
  return { entries, conflicts, applied, kept, adopted };
}

function pluginSpecOf(v) {
  if (typeof v === 'string') return v.trim();
  if (isObj(v) && typeof v.spec === 'string') return v.spec.trim();
  return '';
}

function pluginEntryOf(v) {
  return typeof v === 'string' ? { spec: v } : clone(v);
}

function applyEntries(cfg, entries, state) {
  const docs = {};
  const dirty = new Set();
  for (const [key, entry] of Object.entries(entries || {})) {
    const parsed = decodeKey(key);
    if (!parsed || !FILES[parsed.file] || !fs.existsSync(FILES[parsed.file])) continue;
    if (!docs[parsed.file]) docs[parsed.file] = readJson(FILES[parsed.file]);
    const current = getPath(docs[parsed.file], parsed.segs);
    let next = clone(entry.value);
    // Plugin specs are synced, but machine-local paths must survive a remote plugin-list update.
    if (parsed.file === 'plugins.json' && parsed.segs.length === 1 && parsed.segs[0] === 'plugins' && Array.isArray(next)) {
      const localOnly = (Array.isArray(current) ? current : [])
        .map(pluginEntryOf)
        .filter((p) => {
          const spec = pluginSpecOf(p);
          return spec && !isShareablePluginSpec(spec) && !next.some((r) => pluginSpecOf(r) === spec);
        });
      next = [...next, ...localOnly];
    }
    if (hashValue(current) !== hashValue(next)) {
      setPath(docs[parsed.file], parsed.segs, next);
      dirty.add(parsed.file);
    }
    const baseline = {
      hash: hashValue(entry.value),
      updatedAt: entry.updatedAt || nowIso(),
      deviceId: entry.deviceId || cfg.deviceId
    };
    state.localBaseline[key] = clone(baseline);
    state.base[key] = clone(baseline);
  }
  for (const label of dirty) {
    backupFile(FILES[label]);
    writeJsonAtomic(FILES[label], docs[label]);
  }
  return [...dirty];
}

function git(args, cwd, check = true) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30000 });
  if (check && r.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${(r.stderr || r.stdout || '').trim()}`);
  return r;
}

function ensureGitRepo(cfg) {
  const repoDir = path.join(DATA_DIR, 'git-repo');
  fs.mkdirSync(path.dirname(repoDir), { recursive: true });
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    const r = spawnSync('git', ['clone', '--depth', '1', '--branch', cfg.git.branch, cfg.git.repo, repoDir], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) {
      fs.mkdirSync(repoDir, { recursive: true });
      git(['init'], repoDir);
      git(['remote', 'add', 'origin', cfg.git.repo], repoDir);
      git(['fetch', 'origin', `+refs/heads/${cfg.git.branch}:refs/remotes/origin/${cfg.git.branch}`], repoDir, false);
    }
    git(['config', 'user.email', 'magpie-sync@local'], repoDir, false);
    git(['config', 'user.name', 'Magpie Sync'], repoDir, false);
  }
  const cur = git(['branch', '--show-current'], repoDir, false).stdout.trim();
  if (!cur) git(['checkout', '-b', cfg.git.branch], repoDir, false);
  return repoDir;
}

function gitReadSnapshot(cfg) {
  const repoDir = ensureGitRepo(cfg);
  git(['fetch', 'origin', `+refs/heads/${cfg.git.branch}:refs/remotes/origin/${cfg.git.branch}`], repoDir, false);
  git(['checkout', '-B', cfg.git.branch, `origin/${cfg.git.branch}`], repoDir, false);
  const file = path.join(repoDir, cfg.git.file || SNAPSHOT_FILE);
  return fs.existsSync(file) ? readJson(file) : null;
}

function gitWriteSnapshot(cfg, snapshot, state) {
  const repoDir = ensureGitRepo(cfg);
  const file = path.join(repoDir, cfg.git.file || SNAPSHOT_FILE);
  let current = snapshot;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    git(['fetch', 'origin', `+refs/heads/${cfg.git.branch}:refs/remotes/origin/${cfg.git.branch}`], repoDir, false);
    git(['checkout', '-B', cfg.git.branch, `origin/${cfg.git.branch}`], repoDir, false);
    writeJsonAtomic(file, current);
    git(['add', cfg.git.file || SNAPSHOT_FILE], repoDir);
    const st = git(['status', '--porcelain'], repoDir).stdout.trim();
    if (st) git(['commit', '-m', `magpie settings sync ${nowIso()}`], repoDir);
    const push = git(['push', 'origin', `HEAD:${cfg.git.branch}`], repoDir, false);
    if (push.status === 0) return;
    if (attempt === 0) {
      const fetched = gitReadSnapshot(cfg);
      if (fetched) {
        current = { ...current, entries: mergeSnapshots(current, fetched, state, cfg).entries, generatedAt: nowIso() };
      }
    } else {
      throw new Error(`git push 失败: ${(push.stderr || push.stdout || '').trim()}`);
    }
  }
}

async function withLock(dir, fn) {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.lock');
  let fd = null;
  for (let i = 0; i < 50; i += 1) {
    try { fd = fs.openSync(lock, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      await sleep(100);
    }
  }
  if (fd === null) throw new Error(`同步锁超时: ${lock}`);
  try { return await fn(); }
  finally {
    fs.closeSync(fd);
    try { fs.unlinkSync(lock); } catch { /* ignore */ }
  }
}

function httpHeaders(cfg) {
  const headers = { 'content-type': 'application/json' };
  const tokenName = cfg.http.tokenEnv;
  const token = tokenName ? process.env[tokenName] : '';
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function httpReadSnapshot(cfg) {
  const res = await fetch(cfg.http.getUrl, { headers: httpHeaders(cfg) });
  if (res.status === 404) return { snapshot: null, meta: {} };
  if (!res.ok) throw new Error(`HTTP GET ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { snapshot: await res.json(), meta: { etag: res.headers.get('etag') || '' } };
}

async function httpWriteSnapshot(cfg, snapshot, meta) {
  const headers = httpHeaders(cfg);
  if (meta?.etag) headers['if-match'] = meta.etag;
  const res = await fetch(cfg.http.putUrl, { method: 'PUT', headers, body: JSON.stringify(snapshot) });
  if (!res.ok) throw new Error(`HTTP PUT ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
let feishuTokenCache = '';

async function feishuAccessToken(cfg) {
  const direct = process.env[cfg.feishu.tokenEnv || 'MAGPIE_FEISHU_ACCESS_TOKEN'];
  if (direct) return direct;
  if (feishuTokenCache) return feishuTokenCache;
  const appId = process.env[cfg.feishu.appIdEnv || 'MAGPIE_FEISHU_APP_ID'];
  const appSecret = process.env[cfg.feishu.appSecretEnv || 'MAGPIE_FEISHU_APP_SECRET'];
  if (!appId || !appSecret) {
    throw new Error('飞书后端缺少凭证：设置 MAGPIE_FEISHU_APP_ID / MAGPIE_FEISHU_APP_SECRET，或 MAGPIE_FEISHU_ACCESS_TOKEN');
  }
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.code !== 0 || !body.tenant_access_token) {
    throw new Error(`飞书获取 tenant_access_token 失败: ${body.code || res.status} ${body.msg || ''}`.trim());
  }
  feishuTokenCache = body.tenant_access_token;
  return feishuTokenCache;
}

async function feishuApi(apiPath, token, options = {}) {
  const url = `${FEISHU_BASE}${apiPath}`;
  const res = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { msg: text.slice(0, 300) }; }
  if (!res.ok || (body && typeof body.code !== 'undefined' && body.code !== 0)) {
    throw new Error(`飞书 API 失败: ${body.code || res.status} ${body.msg || ''}`.trim());
  }
  return body;
}

async function feishuListFiles(cfg, token) {
  const out = [];
  let pageToken = '';
  for (;;) {
    const q = new URLSearchParams({
      folder_token: cfg.feishu.folderToken,
      page_size: '200',
      order_by: 'EditedTime',
      direction: 'DESC'
    });
    if (pageToken) q.set('page_token', pageToken);
    const body = await feishuApi(`/drive/v1/files?${q.toString()}`, token);
    out.push(...(body?.data?.files || []));
    if (!body?.data?.has_more) break;
    pageToken = body?.data?.page_token || '';
    if (!pageToken) break;
  }
  return out;
}

async function feishuReadSnapshot(cfg) {
  const token = await feishuAccessToken(cfg);
  const fileName = cfg.feishu.fileName || SNAPSHOT_FILE;
  const hit = (await feishuListFiles(cfg, token)).find((f) => f.name === fileName && f.type === 'file');
  if (!hit?.token) return { snapshot: null, meta: {} };
  const res = await fetch(`${FEISHU_BASE}/drive/v1/files/${encodeURIComponent(hit.token)}/download`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (res.status === 404) return { snapshot: null, meta: {} };
  if (!res.ok) throw new Error(`飞书下载快照失败: ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer()).toString('utf8').replace(/^\uFEFF/, '');
  try { return { snapshot: JSON.parse(raw), meta: { fileToken: hit.token } }; }
  catch { throw new Error('飞书快照不是合法 JSON，已停止同步以免覆盖配置'); }
}

async function feishuWriteSnapshot(cfg, snapshot) {
  const token = await feishuAccessToken(cfg);
  const fileName = cfg.feishu.fileName || SNAPSHOT_FILE;
  const oldFiles = (await feishuListFiles(cfg, token)).filter((f) => f.name === fileName && f.type === 'file');
  for (const old of oldFiles) {
    await feishuApi(`/drive/v1/files/${encodeURIComponent(old.token)}?type=file`, token, { method: 'DELETE' });
  }
  const buf = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  const form = new FormData();
  form.append('file_name', fileName);
  form.append('parent_type', 'explorer');
  form.append('parent_node', cfg.feishu.folderToken);
  form.append('size', String(buf.length));
  form.append('file', new Blob([buf], { type: 'application/json' }), fileName);
  const res = await fetch(`${FEISHU_BASE}/drive/v1/files/upload_all`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form
  });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { msg: text.slice(0, 300) }; }
  if (!res.ok || body.code !== 0) {
    throw new Error(`飞书上传快照失败: ${body.code || res.status} ${body.msg || ''}`.trim());
  }
}

async function larkReadSnapshot(cfg) {
  if (!cfg.lark.fileToken) throw new Error('未配置 lark.fileToken');
  const body = larkCli(['markdown', '+fetch', '--file-token', cfg.lark.fileToken, '--format', 'json']);
  const raw = body?.data?.content;
  if (!raw) return { snapshot: null, meta: {} };
  try {
    const cleaned = raw.replace(/^\uFEFF/, '');
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first < 0 || last < first) throw new Error('missing json');
    const snap = JSON.parse(cleaned.slice(first, last + 1));
    if (!snap || !snap.entries) throw new Error('missing entries');
    return { snapshot: snap, meta: {} };
  } catch {
    throw new Error('飞书同步文档内容不是合法的快照 JSON，已停止同步以免覆盖配置');
  }
}

function larkTitle(version) {
  const base = cfgBaseName();
  return `${base} v${Number(version || 0)}`;
}

function cfgBaseName() {
  const cfg = loadConfig();
  return (cfg?.lark?.fileName || 'Magpie设置同步').replace(/ v\d+\s*$/, '').replace(/\.md$/i, '');
}

// 把当前同步版本号写进插件清单的 version 字段（1.0.<version>），
// 使 Magpie 插件页面能看到版本号。源目录与已安装目录都更新。
function stampPluginVersion(version) {
  const v = `1.0.${Number(version || 0)}`;
  const label = `[同步版本 v${Number(version || 0)}] `;
  const here = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // .../magpie-plugin
  const roots = new Set([here]);
  // 常见安装位置
  roots.add(path.join('D:\\magpie-plugins', 'magpie-settings-sync'));
  const extra = process.env.MAGPIE_PLUGIN_DIR;
  if (extra) roots.add(extra);
  for (const root of roots) {
    // Magpie 插件详情页渲染 README.md，把版本号写进顶部标记区，用户才能直接看到。
    try {
      const readme = path.join(root, 'README.md');
      if (fs.existsSync(readme)) {
        let text = fs.readFileSync(readme, 'utf8');
        const before = text;
        // 引用块顶部标题
        text = text.replace(/(当前同步版本：)v\d+/g, `$1v${Number(version || 0)}`);
        // 飞书文档名标记
        text = text.replace(/(飞书文档：`Magpie设置同步 v)\d+(`)/g, `$1${Number(version || 0)}$2`);
        // BEGIN/END 标记区内的加粗版本
        text = text.replace(/(<!-- SYNC-VERSION-BEGIN -->[\s\S]*?当前同步版本：\*\*v)\d+(\*\*)/, `$1${Number(version || 0)}$2`);
        if (text !== before) fs.writeFileSync(readme, text, 'utf8');
      }
    } catch { /* README 更新失败不影响同步本身 */ }
    for (const rel of [['package.json'], ['.claude-plugin', 'plugin.json']]) {
      const file = path.join(root, ...rel);
      try {
        if (!fs.existsSync(file)) continue;
        const doc = readJson(file);
        let changed = false;
        if (doc.version !== v) { doc.version = v; changed = true; }
        if (typeof doc.description === 'string') {
          const base = doc.description.replace(/^\[同步版本 v\d+\]\s*/, '');
          const next = `${label}${base}`;
          if (doc.description !== next) { doc.description = next; changed = true; }
        }
        if (changed) writeJsonAtomic(file, doc);
      } catch { /* 版本号写入失败不影响同步本身 */ }
    }
  }
}

// 让飞书文档标题带上当前版本号，便于在飞书列表/标题里直接看到。
function larkUpdateTitle(cfg, version) {
  if (!cfg.lark.fileToken) return;
  try {
    larkCli(['drive', '+update-title', '--token', cfg.lark.fileToken, '--type', 'file', '--title', larkTitle(version), '--format', 'json'], { loose: true });
  } catch (e) {
    appendLog(`lark-title 更新失败（不影响内容同步）: ${e.message}`);
  }
}

async function larkWriteSnapshot(cfg, snapshot) {
  if (!cfg.lark.fileToken) throw new Error('未配置 lark.fileToken');
  const version = Number(snapshot?.version || 0);
  const header = [
    `# Magpie 设置同步 · 当前版本 v${version}`,
    '',
    `- 版本：v${version}`,
    `- 更新设备：${snapshot?.deviceName || '-'}`,
    `- 更新时间：${snapshot?.generatedAt || '-'}`,
    `- 设置项：${Object.keys(snapshot?.entries || {}).length}`,
    '',
    '> 下方为机器读取的快照数据，请勿改动。',
    ''
  ].join('\n');
  const content = `${header}${JSON.stringify(snapshot, null, 2)}\n`;
  larkCli(['markdown', '+overwrite', '--file-token', cfg.lark.fileToken, '--content', '-', '--format', 'json'], { input: content });
  larkUpdateTitle(cfg, version);
}

async function loadRemote(cfg) {
  if (cfg.backend === 'folder') {
    const dir = expandHome(cfg.folder.path);
    if (!dir) throw new Error('未配置 folder.path');
    return withLock(dir, () => {
      const file = path.join(dir, cfg.folder.file || SNAPSHOT_FILE);
      return { snapshot: fs.existsSync(file) ? readJson(file) : null, meta: {} };
    });
  }
  if (cfg.backend === 'git') {
    if (!cfg.git.repo) throw new Error('未配置 git.repo');
    return { snapshot: gitReadSnapshot(cfg), meta: {} };
  }
  if (cfg.backend === 'http') {
    if (!cfg.http.getUrl || !cfg.http.putUrl) throw new Error('未配置 http.getUrl / http.putUrl');
    return httpReadSnapshot(cfg);
  }
  if (cfg.backend === 'feishu') {
    if (!cfg.feishu.folderToken) throw new Error('未配置 feishu.folderToken');
    return feishuReadSnapshot(cfg);
  }
  if (cfg.backend === 'lark') {
    if (!cfg.lark.fileToken) throw new Error('未配置 lark.fileToken');
    return larkReadSnapshot(cfg);
  }
  throw new Error(`未知后端: ${cfg.backend}`);
}

async function uploadRemote(cfg, snapshot, meta, state) {
  if (cfg.backend === 'folder') {
    const dir = expandHome(cfg.folder.path);
    await withLock(dir, () => writeJsonAtomic(path.join(dir, cfg.folder.file || SNAPSHOT_FILE), snapshot));
  } else if (cfg.backend === 'git') {
    gitWriteSnapshot(cfg, snapshot, state);
  } else if (cfg.backend === 'http') {
    await httpWriteSnapshot(cfg, snapshot, meta);
  } else if (cfg.backend === 'feishu') {
    await feishuWriteSnapshot(cfg, snapshot);
  } else if (cfg.backend === 'lark') {
    await larkWriteSnapshot(cfg, snapshot);
  }
}

function validateConfig(cfg) {
  const problems = [];
  if (!cfg.enabled) problems.push('配置 enabled=false，自动同步已关闭');
  if (cfg.backend === 'folder' && !cfg.folder.path) problems.push('folder 后端缺少 folder.path');
  if (cfg.backend === 'git' && !cfg.git.repo) problems.push('git 后端缺少 git.repo');
  if (cfg.backend === 'http' && (!cfg.http.getUrl || !cfg.http.putUrl)) problems.push('http 后端缺少 getUrl/putUrl');
  if (cfg.backend === 'feishu' && !cfg.feishu.folderToken) problems.push('feishu 后端缺少 folderToken');
  if (cfg.backend === 'lark' && !cfg.lark.fileToken) problems.push('lark 后端缺少 fileToken（先运行 lark-init 或 init --backend lark --file-token <token>）');
  for (const [label, scope] of Object.entries(cfg.scope || {})) {
    if (!FILES[label]) problems.push(`未知配置文件标签: ${label}`);
    if (!Array.isArray(scope)) problems.push(`${label}.scope 必须是数组`);
    else if (scope.some((s) => !normalizeSegments(s).length)) problems.push(`${label}.scope 存在空路径`);
  }
  return problems;
}

function pendingChanges(cfg, state) {
  const snapshot = buildSnapshot(cfg);
  return Object.entries(snapshot.entries).filter(([key, e]) => {
    return state.localBaseline?.[key]?.hash !== hashValue(e.value);
  }).map(([key]) => readableKey(key));
}

function printSummary(action, summary) {
  console.log(`[magpie-sync] ${action}`);
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
}

async function cmdPull(cfg, state) {
  if (process.argv.includes('--hook') && !cfg.auto.pullOnSessionStart) return { skipped: 'disabled-by-config' };
  const problems = validateConfig(cfg);
  if (problems.length) throw new Error(problems.join('; '));
  const local = buildSnapshot(cfg);
  const { snapshot: remote } = await loadRemote(cfg);
  if (!remote) {
    state.lastPullAt = nowIso();
    writeState(state);
    return { remote: 'empty', applied: 0, conflicts: 0, files: [] };
  }
  // lark 后端：版本高者胜，远端版本更高时整份采用远端。
  if (cfg.backend === 'lark') {
    const rv = Number(remote.version || 0);
    const lv = Number(state.version || 0);
    if (rv > lv) {
      const files = applyEntries(cfg, remote.entries, state);
      state.version = rv;
      state.appliedHash = snapshotHash(remote);
      state.lastPullAt = nowIso();
      state.lastRemoteHash = snapshotHash(remote);
      writeState(state);
      stampPluginVersion(rv);
      appendLog(`pull[version] remote=${rv} local=${lv} applied=${files.length} files=${files.join(',')}`);
      return { strategy: 'higher-version-wins', version: rv, applied: files.length, conflicts: 0, files };
    }
    state.lastPullAt = nowIso();
    writeState(state);
    return { strategy: 'higher-version-wins', version: lv, skipped: 'local-version-not-lower', applied: 0, conflicts: 0, files: [] };
  }
  const merged = mergeSnapshots(local, remote, state, cfg);
  const files = applyEntries(cfg, merged.entries, state);
  state.lastPullAt = nowIso();
  state.lastRemoteHash = snapshotHash(remote);
  writeState(state);
  writeConflicts(merged.conflicts);
  appendLog(`pull hash=${snapshotHash(remote)} applied=${merged.applied} conflicts=${merged.conflicts.length} files=${files.join(',')}`);
  return {
    remote: snapshotHash(remote),
    applied: merged.applied,
    kept: merged.kept,
    conflicts: merged.conflicts.length,
    files
  };
}

function cmdExport() {
  const cfg = loadConfig() || clone(DEFAULT_CONFIG);
  if (!cfg.deviceId) cfg.deviceId = 'manual-export';
  const snapshot = buildSnapshot(cfg);
  const file = argValue('--out') || path.join(DATA_DIR, 'magpie-snapshot-export.json');
  writeJsonAtomic(file, snapshot);
  printSummary('export', { file, entries: Object.keys(snapshot.entries || {}).length });
}

async function cmdImport(cfg, state) {
  const file = argValue('--file') || path.join(DATA_DIR, 'magpie-snapshot-export.json');
  if (!fs.existsSync(file)) throw new Error(`导入文件不存在: ${file}`);
  const remote = readJson(file);
  if (!remote || !remote.entries || typeof remote.entries !== 'object') {
    throw new Error('导入文件内容不是有效的 Magpie 同步快照');
  }
  const local = buildSnapshot(cfg);
  const merged = mergeSnapshots(local, remote, state, cfg);
  const files = applyEntries(cfg, merged.entries, state);
  state.lastPullAt = nowIso();
  state.lastRemoteHash = snapshotHash(remote);
  writeState(state);
  writeConflicts(merged.conflicts);
  appendLog(`import hash=${snapshotHash(remote)} applied=${merged.applied} conflicts=${merged.conflicts.length} files=${files.join(',')}`);
  return {
    file,
    applied: merged.applied,
    kept: merged.kept,
    conflicts: merged.conflicts.length,
    files
  };
}

async function cmdPush(cfg, state) {
  if (process.argv.includes('--hook') && !cfg.auto.pushOnStop) return { skipped: 'disabled-by-config' };
  const problems = validateConfig(cfg);
  if (problems.length) throw new Error(problems.join('; '));
  const local = buildSnapshot(cfg);
  const debounce = Number(cfg.auto.debounceSeconds || 0);
  if (state.lastPushAt && snapshotHash(local) === state.lastPushedHash && debounce > 0) {
    const age = Date.now() - Date.parse(state.lastPushAt);
    if (age < debounce * 1000) return { skipped: 'debounced', hash: snapshotHash(local) };
  }

  const { snapshot: remoteInfo, meta } = await loadRemote(cfg);
  const remote = remoteInfo;
  // lark 后端：版本高者胜。本地内容变化才升版本并上传；否则沿用远端，不做无谓写入。
  if (cfg.backend === 'lark') {
    const rv = Number(remote?.version || 0);
    const lv = Number(state.version || 0);
    const localHash = snapshotHash(local);
    const changed = !state.appliedHash || state.appliedHash !== localHash;
    if (!changed) {
      state.version = Math.max(lv, rv);
      state.lastPushAt = nowIso();
      writeState(state);
      return { strategy: 'higher-version-wins', version: state.version, uploaded: false, skipped: 'local-unchanged', applied: 0, conflicts: 0, files: [] };
    }
    const newVersion = Math.max(rv, lv) + 1;
    const outgoing = {
      ...local,
      version: newVersion,
      generatedAt: nowIso(),
      deviceId: cfg.deviceId,
      deviceName: cfg.deviceName,
      entries: local.entries
    };
    await uploadRemote(cfg, outgoing, meta, state);
    state.version = newVersion;
    state.appliedHash = snapshotHash(outgoing);
    state.lastPushAt = nowIso();
    state.lastPushedHash = snapshotHash(outgoing);
    writeState(state);
    stampPluginVersion(newVersion);
    appendLog(`push[version] version=${newVersion} uploaded=true entries=${Object.keys(outgoing.entries).length}`);
    return { strategy: 'higher-version-wins', version: newVersion, uploaded: true, applied: 0, conflicts: 0, files: [] };
  }
  const merged = mergeSnapshots(local, remote, state, cfg);
  const files = applyEntries(cfg, merged.entries, state);
  const mergedSnapshot = {
    ...local,
    generatedAt: nowIso(),
    deviceId: cfg.deviceId,
    deviceName: cfg.deviceName,
    entries: merged.entries
  };
  const mergedHash = snapshotHash(mergedSnapshot);
  let uploaded = false;
  if (!remote || snapshotHash(remote) !== mergedHash) {
    await uploadRemote(cfg, mergedSnapshot, meta, state);
    uploaded = true;
  }
  state.lastPushAt = nowIso();
  state.lastPushedHash = mergedHash;
  writeState(state);
  writeConflicts(merged.conflicts);
  appendLog(`push hash=${mergedHash} uploaded=${uploaded} applied=${merged.applied} conflicts=${merged.conflicts.length} files=${files.join(',')}`);
  return {
    hash: mergedHash,
    uploaded,
    applied: merged.applied,
    conflicts: merged.conflicts.length,
    files
  };
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : '';
}

function cmdInit() {
  const backend = argValue('--backend') || 'folder';
  const cfg = clone(DEFAULT_CONFIG);
  cfg.deviceId = crypto.randomUUID();
  cfg.deviceName = argValue('--device-name') || os.hostname();
  cfg.backend = ['git', 'folder', 'http', 'feishu', 'lark'].includes(backend) ? backend : 'folder';
  cfg.conflictPolicy = argValue('--conflict-policy') || cfg.conflictPolicy;
  if (cfg.backend === 'git') {
    cfg.git.repo = argValue('--repo');
    cfg.git.branch = argValue('--branch') || 'main';
  } else if (cfg.backend === 'http') {
    cfg.http.getUrl = argValue('--get-url');
    cfg.http.putUrl = argValue('--put-url');
    cfg.http.tokenEnv = argValue('--token-env') || '';
  } else if (cfg.backend === 'feishu') {
    cfg.feishu.folderToken = argValue('--folder-token');
    cfg.feishu.fileName = argValue('--file-name') || SNAPSHOT_FILE;
    cfg.feishu.tokenEnv = argValue('--token-env') || 'MAGPIE_FEISHU_ACCESS_TOKEN';
  } else if (cfg.backend === 'lark') {
    cfg.lark.fileToken = argValue('--file-token');
    cfg.lark.docUrl = argValue('--doc-url') || '';
  } else {
    cfg.folder.path = argValue('--folder');
  }
  if (fs.existsSync(CONFIG_PATH) && !process.argv.includes('--force')) {
    throw new Error(`配置已存在: ${CONFIG_PATH}（加 --force 覆盖）`);
  }
  writeJsonAtomic(CONFIG_PATH, cfg);
  appendLog(`init backend=${cfg.backend} device=${cfg.deviceId}`);
  printSummary('init', { config: CONFIG_PATH, backend: cfg.backend, deviceId: cfg.deviceId });
}

async function cmdLarkInit() {
  // 检测飞书 CLI 授权
  let who;
  try { who = larkCli(['whoami'], { loose: true }); }
  catch (e) { throw new Error(`飞书未授权，请先在 WorkBuddy 里连接飞书后重试。原因: ${e.message}`); }
  const user = who?.onBehalfOf?.userName || who?.data?.onBehalfOf?.userName || who?.onBehalfOf?.openId || '飞书用户';

  const cfg = loadConfig() || clone(DEFAULT_CONFIG);
  const force = process.argv.includes('--force');
  let fileToken = cfg.lark?.fileToken || '';
  let docUrl = cfg.lark?.docUrl || '';

  if (!fileToken || force) {
    const name = argValue('--name') || `Magpie设置同步-${cfg.deviceName || os.hostname()}`;
    const made = larkCli(['markdown', '+create', '--name', `${name}.md`, '--content', '-', '--format', 'json'], {
      input: `${JSON.stringify({ schema: 1, version: 0, entries: {} }, null, 2)}\n`
    });
    fileToken = made?.data?.file_token || '';
    docUrl = made?.data?.url || '';
    if (!fileToken) throw new Error('创建飞书同步文档失败，未返回 file_token');
  }

  cfg.schema = 1;
  cfg.enabled = true;
  cfg.deviceId = cfg.deviceId || crypto.randomUUID();
  cfg.deviceName = argValue('--device-name') || cfg.deviceName || os.hostname();
  cfg.backend = 'lark';
  cfg.conflictPolicy = 'higher-version-wins';
  cfg.lark = { fileToken, docUrl, fileName: argValue('--name') || cfg.lark?.fileName || 'Magpie设置同步' };
  writeJsonAtomic(CONFIG_PATH, cfg);

  // 首次推送：本地作为 v1 写入文档
  const outgoing = {
    schema: 1,
    version: 1,
    generatedAt: nowIso(),
    deviceId: cfg.deviceId,
    deviceName: cfg.deviceName,
    entries: buildSnapshot(cfg).entries
  };
  await larkWriteSnapshot(cfg, outgoing);
  const state = loadState();
  state.version = 1;
  state.appliedHash = snapshotHash(outgoing);
  state.lastPushAt = nowIso();
  state.lastPushedHash = snapshotHash(outgoing);
  writeState(state);
  stampPluginVersion(1);

  printSummary('lark-init', {
    account: user,
    backend: 'lark',
    fileToken,
    docUrl: docUrl || '(见飞书云文档)',
    version: 1,
    config: CONFIG_PATH,
    next: '另一台电脑运行: init --backend lark --file-token <上面的fileToken>'
  });
}

function cmdDoctor() {
  const rows = [];
  rows.push(['node', process.version]);
  rows.push(['userHome', USER_HOME]);
  rows.push(['magpieHome', MAGPIE_HOME]);
  rows.push(['config', fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : `缺失: ${CONFIG_PATH}`]);
  for (const [label, file] of Object.entries(FILES)) rows.push([label, fs.existsSync(file) ? file : `缺失: ${file}`]);
  rows.push(['git', spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout.trim() || '不可用']);
  rows.push(['dataDirWritable', (() => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.accessSync(DATA_DIR, fs.constants.W_OK); return true; } catch { return false; } })()]);
  printSummary('doctor', Object.fromEntries(rows));
}

// 手动查看版本号：本地版本 + 飞书远端版本 + 更新时间/设备 + 文档链接。
async function cmdVersion(cfg, state) {
  let remoteVersion = null;
  let remoteMeta = {};
  try {
    const { snapshot: remote } = await loadRemote(cfg);
    if (remote) {
      remoteVersion = Number(remote.version || 0);
      remoteMeta = { deviceName: remote.deviceName || '', generatedAt: remote.generatedAt || '' };
    }
  } catch (e) {
    remoteMeta = { error: e.message };
  }
  const localVersion = Number(state.version || 0);
  const behind = remoteVersion !== null && remoteVersion > localVersion;
  return printSummary('version', {
    currentVersion: `v${localVersion}`,
    remoteVersion: remoteVersion === null ? '未知' : `v${remoteVersion}`,
    status: remoteVersion === null ? '无法读取远端' : (behind ? '远端有更新版本，可运行 update' : '已是最新版本'),
    remoteDevice: remoteMeta.deviceName || '-',
    remoteUpdatedAt: remoteMeta.generatedAt || '-',
    lastPullAt: state.lastPullAt || '-',
    lastPushAt: state.lastPushAt || '-',
    docUrl: cfg.lark?.docUrl || '-',
    docTitle: cfg.lark?.fileToken ? larkTitle(behind ? remoteVersion : localVersion) : '-'
  });
}

// 手动更新：检查远端，版本更高则拉取并应用，随后把版本号同步到飞书标题/正文。
async function cmdUpdate(cfg, state) {
  if (!cfg) throw new Error(`缺少配置文件: ${CONFIG_PATH}，先运行 lark-init 或 init`);
  const before = Number(state.version || 0);
  const result = await cmdPull(cfg, state);
  const after = Number(state.version || 0);
  stampPluginVersion(after);
  // 无论是否有应用，都把当前版本号同步到飞书标题，确保三处一致。
  if (cfg.backend === 'lark' && cfg.lark.fileToken) {
    larkUpdateTitle(cfg, after);
    const { snapshot: remote } = await loadRemote(cfg);
    if (remote && typeof remote.version === 'number') {
      larkCli(['markdown', '+overwrite', '--file-token', cfg.lark.fileToken, '--content', '-', '--format', 'json'], {
        input: `${[
          `# Magpie 设置同步 · 当前版本 v${Number(remote.version || 0)}`,
          '',
          `- 版本：v${Number(remote.version || 0)}`,
          `- 更新设备：${remote.deviceName || '-'}`,
          `- 更新时间：${remote.generatedAt || '-'}`,
          `- 设置项：${Object.keys(remote.entries || {}).length}`,
          '',
          '> 下方为机器读取的快照数据，请勿改动。',
          ''
        ].join('\n')}${JSON.stringify(remote, null, 2)}\n`
      });
    }
  }
  return printSummary('update', {
    before: `v${before}`,
    after: `v${after}`,
    changed: after !== before,
    applied: result.applied || 0,
    strategy: result.strategy || '-',
    docTitle: cfg.lark?.fileToken ? larkTitle(after) : '-'
  });
}

// 一键更新：面向普通用户的单一入口。只做一件事——把飞书最新配置拉到本地 Magpie。
// 上传由关闭 Magpie 时的 hook 自动完成；这里绝不上传，避免反复升版/污染远端。
async function cmdApply(cfg, state) {
  if (!cfg) throw new Error(`尚未绑定同步文档。请先在这台电脑配置一次，或联系管理员。`);
  const before = Number(state.version || 0);
  const pull = await cmdPull(cfg, state);
  const after = Number(state.version || 0);

  stampPluginVersion(after);
  if (cfg.backend === 'lark' && cfg.lark.fileToken) {
    larkUpdateTitle(cfg, after);
    const { snapshot: remote } = await loadRemote(cfg);
    if (remote && typeof remote.version === 'number') {
      larkCli(['markdown', '+overwrite', '--file-token', cfg.lark.fileToken, '--content', '-', '--format', 'json'], {
        input: `${[
          `# Magpie 设置同步 · 当前版本 v${Number(remote.version || 0)}`,
          '',
          `- 版本：v${Number(remote.version || 0)}`,
          `- 更新设备：${remote.deviceName || '-'}`,
          `- 更新时间：${remote.generatedAt || '-'}`,
          `- 设置项：${Object.keys(remote.entries || {}).length}`,
          '',
          '> 下方为机器读取的快照数据，请勿改动。',
          ''
        ].join('\n')}${JSON.stringify(remote, null, 2)}\n`
      });
    }
  }

  const changed = after !== before || (pull.applied || 0) > 0;
  const ver = `v${after}`;
  console.log('');
  console.log('  ✅ 配置已同步');
  console.log(`     当前配置版本：${ver}`);
  if ((pull.applied || 0) > 0) {
    console.log('     已从飞书更新本机配置');
  } else if (changed) {
    console.log('     已同步到最新配置');
  } else {
    console.log('     本机已是最新配置，无需改动');
  }
  console.log('');
  console.log('  ⚠ 请重启 Magpie，新配置才会生效');
  console.log('');
  return { applied: pull.applied || 0, version: after, changed };
}

function cmdStatus(cfg, state) {
  const larkMode = cfg.backend === 'lark';
  const localHash = larkMode ? snapshotHash(buildSnapshot(cfg)) : '';
  const pending = larkMode
    ? (state.appliedHash && state.appliedHash === localHash ? [] : ['本地配置有变化，等待推送'])
    : pendingChanges(cfg, state);
  let conflicts = [];
  if (fs.existsSync(CONFLICT_PATH)) { try { conflicts = readJson(CONFLICT_PATH); } catch { conflicts = []; } }
  printSummary('status', {
    config: CONFIG_PATH,
    deviceId: cfg.deviceId,
    deviceName: cfg.deviceName,
    backend: cfg.backend,
    version: state.version || 0,
    conflictPolicy: cfg.conflictPolicy,
    lastPullAt: state.lastPullAt,
    lastPushAt: state.lastPushAt,
    pendingChanges: pending.length,
    pendingPaths: pending,
    unresolvedConflicts: conflicts.length,
    conflictLog: CONFLICT_PATH,
    syncLog: LOG_PATH
  });
}

async function main() {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'init') return cmdInit();
  if (cmd === 'lark-init') return cmdLarkInit();
  if (cmd === 'doctor') return cmdDoctor();
  if (cmd === 'export') return cmdExport();

  if (cmd === 'import') {
    const cfg = loadConfig() || clone(DEFAULT_CONFIG);
    return printSummary('import', await cmdImport(cfg, loadState()));
  }

  const cfg = loadConfig();
  if (!cfg) throw new Error(`缺少配置文件: ${CONFIG_PATH}\n先运行: node scripts/sync.mjs init --backend folder --folder <共享目录>`);
  const state = loadState();

  if (cmd === 'version') return cmdVersion(cfg, state);
  if (cmd === 'update') return cmdUpdate(cfg, state);
  if (cmd === 'apply') return cmdApply(cfg, state);
  if (cmd === 'pull') return printSummary('pull', await cmdPull(cfg, state));
  if (cmd === 'push') return printSummary('push', await cmdPush(cfg, state));
  if (cmd === 'sync') {
    printSummary('pull', await cmdPull(cfg, loadState()));
    printSummary('push', await cmdPush(cfg, loadState()));
    return;
  }
  if (cmd === 'status') return cmdStatus(cfg, state);
  throw new Error(`未知命令: ${cmd}`);
}

main().catch((e) => {
  const msg = String(e?.stack || e?.message || e);
  appendLog(`ERROR ${process.argv[2] || 'status'} ${msg.replace(/\s+/g, ' ').slice(0, 800)}`);
  console.error(`[magpie-sync] 失败: ${e?.message || e}`);
  process.exitCode = 1;
});
