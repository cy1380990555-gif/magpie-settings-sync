#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const action = process.argv[2] === 'push' ? 'push' : 'pull';
const syncScript = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'scripts', 'sync.mjs');
const dataDir = process.env.MAGPIE_SYNC_DATA_DIR || path.join(process.env.MAGPIE_CONFIG_HOME || path.join(process.env.MAGPIE_USER_HOME || os.homedir(), '.config', 'magpie'), 'plugin-work', 'magpie-settings-sync');
const logFile = path.join(dataDir, 'hook.log');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let event = 'unknown';
  try { event = JSON.parse(raw || '{}').hook_event_name || event; } catch { /* ignore */ }

  let status = 'ok';
  let detail = '';
  try {
    const r = spawnSync(process.execPath, [syncScript, action, '--hook'], {
      encoding: 'utf8',
      timeout: 25000,
      env: process.env
    });
    status = r.status === 0 ? 'ok' : `exit-${r.status}`;
    detail = `${r.stdout || ''}${r.stderr || ''}`.trim().slice(-2000);
  } catch (e) {
    status = 'error';
    detail = String(e?.message || e);
  }

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${event} ${action} ${status} ${detail.replace(/\s+/g, ' ')}\n`, 'utf8');
  } catch { /* hooks must never fail because of logging */ }

  process.stdout.write(JSON.stringify({
    continue: true,
    suppressOutput: true,
    systemMessage: status === 'ok' ? undefined : `Magpie 设置同步 ${action} 未成功，已记录到 ${logFile}`
  }));
});
