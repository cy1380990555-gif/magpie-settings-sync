---
name: magpie-settings-sync
description: 当用户要求"更新 Magpie 配置""同步配置""把配置同步过来"时使用。自动把本机配置与飞书云端配置按配置项合并成 C，并同步到两边。不要同步密钥、登录态、设备专属路径或窗口位置。
description_zh: "当用户要求更新或同步 Magpie 配置时使用。自动合并本机与云端配置并应用到本机。"
description_en: "Use when the user asks to update or sync Magpie settings. Merges local and cloud settings and applies the result."
---

# Magpie 配置同步

## 用户想更新配置时

正常情况下**不需要用户执行任何命令**：安装插件后打开 Magpie，启动时会自动执行合并同步。

如果需要立即手动合并一次：

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs" merge
```

命令会用中文直接告诉用户结果，例如"✅ 配置已合并同步 / 当前配置版本 v8 / 请重启 Magpie"。**运行后务必提醒用户重启 Magpie**，配置在启动时读取才会生效。

## 查看状态（可选）

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs" version
```

显示当前版本、飞书版本、是否落后、文档链接。

## 首次绑定新电脑

本插件已内置 Space 账号下的飞书文档，新电脑安装后零配置；不需要 `lark-init`，也不需要桌面脚本。

## 同步范围
- 同步：主题、语言、托盘、货币、字号、隐藏模型、插件清单等偏好设置。
- 不同步：密钥、登录态、providers/网关配置、设备专属路径、窗口位置。

## 机制（背景，无需向用户解释）

飞书文档作为中心快照，带全局版本号。启动时 `config` hook 后台执行 `merge`：按配置项做三向合并。

- 只在一侧存在的设置项：直接并入 C。
- 两侧都有但值不同：有共同基线时按“本地未变取远端 / 远端未变留本地”；首次接触或双方都变时按 `updatedAt` 取较新值。
- 合并结果有变化才全局版本 +1 并上传，随后本机写入 C；另一台电脑下次启动也收敛到 C。
- 冲突与细节记录在配置目录的 `conflicts.json` / `sync.log`，常规使用无需关心。
