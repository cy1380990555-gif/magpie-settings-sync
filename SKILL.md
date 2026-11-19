---
name: magpie-settings-sync
description: 当用户要求"更新 Magpie 配置""同步配置""把配置同步过来"时使用。一键从飞书拉取最新设置并应用到本机。不要同步密钥、登录态、设备专属路径或窗口位置。
description_zh: "当用户要求更新或同步 Magpie 配置时使用。一键从飞书拉取最新设置并应用到本机。"
description_en: "Use when the user asks to update or sync Magpie settings. Applies the latest config from Feishu in one step."
---

# Magpie 配置同步

## 用户想更新配置时
运行一条命令即可完成全部同步（拉取远端 + 上传本机变化 + 刷新飞书文档）：

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs" apply
```

命令会用中文直接告诉用户结果，例如"✅ 配置已同步 / 当前配置版本 v4 / 请重启 Magpie"。**运行后务必提醒用户重启 Magpie**，配置在启动时读取才会生效。

用户桌面上还有一个 `更新Magpie配置.cmd`，双击等同于上面的命令，面向不想用命令行的场景。

## 查看状态（可选）
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs" version
```
显示当前版本、飞书版本、是否落后、文档链接。

## 首次绑定一台新电脑（管理员才需要做）
这台电脑已绑定，无需重复。新电脑需要先安装插件并绑定同一份飞书文档（fileToken），之后才能用 `apply`。绑定后所有同步都自动完成，用户日常只需 `apply` 或双击桌面脚本。

## 同步范围
- 同步：主题、语言、托盘、货币、字号、隐藏模型、插件清单等偏好设置。
- 不同步：密钥、登录态、 providers/网关配置、设备专属路径、窗口位置。

## 机制（背景，无需向用户解释）
飞书文档作为中心快照，带全局版本号，谁改配置谁 +1，版本高者整份胜出。`hooks` 在会话开始自动拉取、结束自动推送（15 秒防抖，失败不阻塞）。冲突与细节记录在配置目录，常规使用无需关心。
