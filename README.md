# Magpie 设置同步插件（Magpie 原生）

> ## 当前同步版本：v3
> 更新时间：2026-11-19 · 更新设备：本机-home · 飞书文档：`Magpie设置同步 v3`
>
> 版本号随每次配置变化自动 +1，哪台电脑版本高可用哪台。用 `version` 查看、`update` 手动更新。

<!-- SYNC-VERSION-BEGIN -->
当前同步版本：**v3**
<!-- SYNC-VERSION-END -->

这是可被 Magpie 插件市场识别的 Claude Code 风格插件：`.claude-plugin/plugin.json` + Skill + Hooks。

## 同步范围

| 文件 | 同步项 |
|---|---|
| `~/.config/magpie/settings.json` | `theme`、`lang`、`tray`、`currency`、`textSize`、`keepAwake`、`quitNoAsk`、`updateEvery`、`groupSink`、`groupFirstToken`、`trayUsageEvery`、`trayNoLogos`、`trayNoNumber`、`trayPace`、`chinaMirror`、`hiddenModels`、`pluginCheckins`、`checkinAt` |
| `~/.config/magpie/plugins.json` | `plugins[].spec`，仅 npm / GitHub 规格；绝对本地路径（如 `D:\magpie-plugins\tabbit`）不上送，拉取时会保留在本机 |

不同步：`logins.json`、`providers.json`、`plugin-auth.json`、`plugin-providers.json`、`gateway.json`、`settings.json` 的 `window`/`windowAt`/`otel`/`sessionReads`、密钥与登录态。

## 读写与冲突

- 按路径展开叶子值；原子写（临时文件 + rename）；写前备份最多 5 份。
- 快照条目含 `value`、`updatedAt`、`deviceId`、`deviceName`。
- 基线哈希在 `state.json`；本地未变取远端，远端未变留本地，双方变化按 `conflictPolicy`。
- 首次接触某路径取远端；冲突写入 `conflicts.json`。
- 非版本后端策略：`newer-wins`（默认）、`prefer-local`、`prefer-remote`、`manual`。
- `lark`（飞书）后端策略：`higher-version-wins` —— 快照带全局 `version`，谁改配置谁 +1，打开时版本高的整份胜出。

## 后端与触发

后端：`folder`（`.lock` 互斥）、`git`（fetch/commit/push，非快进重合并重试）、`http`（Bearer + ETag）、`feishu`（飞书云空间 JSON 文件，tenant_access_token）、`lark`（本机飞书 CLI，免密钥，版本号同步）。
触发：SessionStart 拉取；Stop/SessionEnd 推送（15 秒防抖）；CLI `pull|push|sync|status|doctor|init|lark-init|version|update|export|import`。Hook 失败不阻塞会话，仅写 `hook.log`。

## 飞书自动同步（推荐，无需建应用/密钥）

前提：WorkBuddy 已连接飞书（`lark-cli whoami` 可用即可）。

**第一台电脑**（建文档并上传当前配置）：

```powershell
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" lark-init --device-name "家里电脑"
```

输出含 `fileToken` 和 `docUrl`（飞书里的同步文档）。记下 `fileToken`。

**其他电脑**（指向同一文档）：

```powershell
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" init --backend lark --file-token "<第一台的fileToken>" --device-name "公司电脑"
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" pull
```

之后每台电脑：
- 打开 Magpie 自动 pull：远端版本更高就采用远端（版本高者胜）
- 关闭 Magpie 自动 push：本地配置有变化才升版本上传（+1）
- 手动：`sync` / `pull` / `push`；`version` 查版本号；`update` 手动检查并更新

```powershell
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" version
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" update
```

## 版本号三处显示

当前同步版本号在三个地方保持一致：

| 位置 | 显示形式 |
|---|---|
| Magpie 插件页面 | 插件 `version` = `1.0.<版本号>`，描述以 `[同步版本 vN]` 开头 |
| 飞书文档标题 | `Magpie设置同步 vN` |
| 飞书文档正文 | 顶部标题、版本、更新设备、更新时间、设置项数量 |

每次 `pull` / `push` / `update` / `lark-init` 版本变化时自动刷新三处。同一份文档只需在一台建一次，其他电脑复用 `fileToken`。

## 安装到 Magpie

```bash
node install-magpie.mjs
```

安装器会：
1. 复制插件到 `D:\magpie-plugins\magpie-settings-sync`
2. 在 `~/.config/magpie/plugins.json` 注册 spec `D:\magpie-plugins\magpie-settings-sync`
3. 备份被修改的 JSON
4. 提示重启 Magpie

然后生成配置：

```bash
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" init --backend folder --folder "Z:\sync\magpie-settings"
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" doctor
```

### 最简单：飞书文档手动中转

不需要建应用、不需要密钥、不需要 `init`。

家里电脑导出：

```powershell
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" export
```

默认生成：

```text
~/.config/magpie/plugin-work/magpie-settings-sync/magpie-snapshot-export.json
```

用记事本打开，全选复制，粘贴到一个飞书文档里。

公司电脑从飞书文档全选复制，粘贴到记事本，保存为：

```text
C:\Users\你的用户名\Documents\magpie-snapshot.json
```

然后导入：

```powershell
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" import --file "C:\Users\你的用户名\Documents\magpie-snapshot.json"
```

反向同步时，在公司 `export`，回家里 `import`。

### 飞书后端（自动，步骤较多）

飞书后端把快照保存为飞书云空间里的 `magpie-snapshot.json` 文件，不是在线文档正文；这样可由程序稳定读写。

准备：

1. 在飞书开放平台创建自建应用，开通“查看、评论、编辑和管理云空间中所有文件”或“上传、下载文件到云空间”权限，并发布版本。
2. 获取应用的 App ID / App Secret。
3. 在飞书云空间建一个专用文件夹，从文件夹链接末尾取得 `folder_token`。
4. 两台电脑都设置环境变量：

```powershell
[Environment]::SetEnvironmentVariable("MAGPIE_FEISHU_APP_ID", "cli_xxx", "User")
[Environment]::SetEnvironmentVariable("MAGPIE_FEISHU_APP_SECRET", "xxx", "User")
```

也可以设置现成访问令牌 `MAGPIE_FEISHU_ACCESS_TOKEN`，优先于 App ID/Secret。

初始化：

```powershell
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" init --backend feishu --folder-token "fldxxx" --device-name "home"
```

公司电脑用同一文件夹 token 初始化，然后 `pull`。

注意：飞书 API 有频控；不要在多台设备同时 `push`。若遇到冲突，稍后重新执行 `sync`。

数据目录：`~/.config/magpie/plugin-work/magpie-settings-sync/`
