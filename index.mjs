/**
 * Magpie plugin entry for magpie-settings-sync.
 *
 * Magpie calls the `config` hook every time it starts and loads plugins.
 * We use that moment to kick off a background settings sync: pull the newest
 * snapshot from Feishu and write it into this computer's Magpie settings.
 *
 * The work itself lives in scripts/sync.mjs. We spawn it detached so the hook
 * returns immediately and never blocks Magpie's startup (Magpie puts a time
 * limit on config hooks).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SYNC = path.join(HERE, 'scripts', 'sync.mjs');
const NODE = process.execPath;
const LOG = path.join(HERE, 'launch-sync.log');
const LOCK = path.join(HERE, 'launch-sync.lock');

function log(msg) {
  try {
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`, 'utf8');
  } catch { /* non-fatal */ }
}

function kickSync() {
  // One run at a time, and don't re-trigger inside the 60s window.
  try {
    const st = fs.statSync(LOCK);
    if (Date.now() - st.mtimeMs < 60_000) return;
  } catch { /* no lock yet */ }
  try { fs.writeFileSync(LOCK, String(Date.now()), 'utf8'); } catch { /* ignore */ }

  log('config hook fired -> launching background apply');
  const child = spawn(NODE, [SYNC, 'apply'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.on('error', (e) => log(`spawn error: ${e.message}`));
  child.unref();
}

export function MagpieSettingsSyncPlugin() {
  return {
    config() {
      try { kickSync(); } catch (e) { log(`hook error: ${e?.message || e}`); }
      // Never mutate the config object; this hook is only a startup trigger.
    },
  };
}
