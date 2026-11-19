/**
 * Magpie plugin entry.
 *
 * The settings-sync work lives in scripts/sync.mjs and is exposed to the
 * desktop app as a Skill plus SessionStart/Stop hooks. This export only makes
 * the folder a loadable Magpie/OpenCode plugin so it appears in the Plugins
 * list and stays available across sessions.
 */
export function MagpieSettingsSyncPlugin() {
  return {
    // Intentionally no provider: this plugin neither signs in nor proxies models.
  };
}
