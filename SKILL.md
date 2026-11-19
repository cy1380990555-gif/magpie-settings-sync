---
name: magpie-settings-sync
description: 同步 Magpie 跨设备设置时使用。用户要求同步主题、语言、托盘、模型隐藏、插件清单或排查同步冲突时使用。不要同步密钥、登录态、设备专属路径或窗口位置。
description_zh: "同步 Magpie 跨设备设置时使用。用户要求同步主题、语言、托盘、模型隐藏、插件清单或排查同步冲突时使用。不要同步密钥、登录态、设备专属路径或窗口位置。"
description_en: "Use when syncing Magpie settings across devices: theme, language, tray, hidden models, plugin list, or sync conflicts. Never sync credentials, logins, device paths, or window bounds."
---

# Magpie 设置同步

## 何时使用
- 用户说“同步 Magpie 设置”“换电脑插件和偏好保持一致”“另一台机器的主题/语言”。
- 用户询问同步冲突、后端或同步范围。

## 固定流程
1. 脚本路径：`${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs`。
2. 运行 `node <sync.mjs> status` 查看设备、后端、待同步项和冲突。
3. 配置位于 `~/.config/magpie/plugin-work/magpie-settings-sync/config.json`。
4. 执行 `node <sync.mjs> sync`，报告 applied / conflicts / files / uploaded。
5. 有冲突时读取 `conflicts.json`，说明路径、两端设备与时间。
6. 写回后提醒用户重启 Magpie：`settings.json` 与 `plugins.json` 在启动时读取。

## 硬性约束
- 不同步 `logins.json`、`providers.json`、`plugin-auth.json`、`plugin-providers.json`、`gateway.json`。
- 不同步 `settings.json` 的 `window`、`windowAt`、`windowMaximised`、`otel`、`sessionReads`。
- 不同步 `plugins.json` 中的绝对本地路径（如 `D:\magpie-plugins\tabbit`）；只同步 npm / GitHub 规格。
- 同步失败不得清空或覆盖本地配置。

## 常用命令
```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs init --backend folder --folder "Z:\\sync\\magpie-settings"
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs init --backend feishu --folder-token "fldxxx" --device-name "home"
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs doctor
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs status
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs pull
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs push
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs sync
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs export
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs import --file "<从飞书文档复制保存的 json>"
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs lark-init --device-name "家里电脑"
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs init --backend lark --file-token "<fileToken>" --device-name "公司电脑"
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs version
node ${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs update
```

## 飞书自动同步（首选）
`lark` 后端复用本机已授权的飞书 CLI，免 App ID/Secret。快照带全局 `version`，谁改配置谁 +1：`pull` 时远端版本更高则整份采用远端，`push` 时本地有变化才升版本上传。第一台用 `lark-init` 建文档并记下 `fileToken`，其他电脑用 `init --backend lark --file-token` 指向同一文档。

## 版本号三处显示
当前同步版本号会显示在三处，且保持一致：
1. **Magpie 插件页面**：插件清单 `version` 写成 `1.0.<版本号>`，`description` 以 `[同步版本 vN]` 开头。
2. **飞书文档标题**：`Magpie设置同步 vN`。
3. **飞书文档正文**：顶部标题、版本、设备、时间、设置项数量。

每次 `pull` / `push` / `update` / `lark-init` 版本变化时自动刷新三处。

## 手动查看 / 手动更新
- `version`：查看当前版本号、远端版本、是否落后、更新设备/时间、飞书文档链接。
- `update`：检查远端，版本更高则拉取应用；随后把版本号同步到飞书标题与正文。

## 冲突策略
`newer-wins`（默认）、`prefer-local`、`prefer-remote`、`manual`。首次接触以远端为准。
