# Magpie 设置同步插件（Magpie 原生）

> ## 当前同步版本：v8
> 更新时间：2026-11-20 · 更新设备：本机-home · 飞书文档：`Magpie设置同步 v8`
>
> 版本号随合并上传自动 +1。打开 Magpie 时自动把本机配置与云端配置合并成 C，并同步到两边。

<!-- SYNC-VERSION-BEGIN -->
当前同步版本：**v8**
<!-- SYNC-VERSION-END -->

## 日常使用（无需命令、无需桌面脚本）

安装插件后，只要打开 Magpie：

1. 启动时把本机配置与飞书云端配置按配置项合并成 C；
2. 有新增或改动时，C 升版并上传到飞书；
3. 本机写入 C，另一台电脑下次打开 Magpie 也会自动拉到 C。

需要手动确认时：

- `node scripts/sync.mjs merge`：立即合并一次（与启动自动同步相同）
- `node scripts/sync.mjs version`：查看当前版本和云端版本

---

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
- 基线哈希在 `state.json`：本地未变取远端，远端未变留本地，双方都变按 `newer-wins`。
- 首次接触某路径不再整份覆盖远端，而是按 `updatedAt` 合并；A1 与 B1 会合成 C。
- 冲突写入 `conflicts.json`；同一项两边都改过时按最后修改时间取较新值。
- 非版本后端策略：`newer-wins`（默认）、`prefer-local`、`prefer-remote`、`manual`。
- `lark`（飞书）后端：启动时执行 `merge`，按路径做三向合并，只有合并结果变化时才全局版本 +1。

## 后端与触发

后端：`folder`（`.lock` 互斥）、`git`（fetch/commit/push，非快进重合并重试）、`http`（Bearer + ETag）、`feishu`（飞书云空间 JSON 文件，tenant_access_token）、`lark`（本机飞书 CLI，免密钥，版本号同步）。
触发：Magpie 启动时的 `config` hook 后台执行 `merge`（不再依赖桌面脚本）；CLI `merge|apply|pull|push|sync|status|doctor|init|lark-init|version|update|export|import`。Hook 失败不阻塞启动，仅写 `launch-sync.log`。

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
- 打开 Magpie 自动 `merge`：本机与云端按配置项合并成 C，有变化才升版上传（+1）
- A 电脑改了、B 电脑改了，下一次打开各自都会收敛到同一份 C
- 手动：`merge` / `version`；旧命令 `apply` 仍保留为“只拉不传”

```powershell
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" version
node "D:\magpie-plugins\magpie-settings-sync\scripts\sync.mjs" update
```

## 版本号三处显示

当前同步版本号在三个地方保持一致：

| 位置 | 显示形式 |
|---|---|
| Magpie 插件页面 | 插件包版本 `version`（如 `1.0.4`，Magpie 原生显示并可更新），描述以 `[同步版本 vN]` 开头 |
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
