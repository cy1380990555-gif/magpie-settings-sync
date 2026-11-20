@echo off
chcp 65001 >nul
title Magpie 配置同步插件 - 一键安装
setlocal EnableDelayedExpansion
echo.
echo  ============================================================
echo    Magpie 配置同步插件 - 一键安装（第二台电脑用）
echo  ============================================================
echo.
echo  前提：这台电脑的 WorkBuddy 已登录【和另一台相同】的飞书账号。
echo        （配置存在飞书文档里，必须用同一个账号才读得到）
echo.

REM ---------- 1) 找 WorkBuddy 自带的 Node ----------
set "NODE_EXE="
for /d %%v in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if exist "%%v\node.exe" if not defined NODE_EXE set "NODE_EXE=%%v\node.exe"
)
if not defined NODE_EXE (
  echo  [X] 没找到 WorkBuddy 自带的 Node.exe。
  echo      请先安装并至少打开过一次 WorkBuddy，再运行本脚本。
  echo.
  pause
  exit /b 1
)
echo  [OK] Node: %NODE_EXE%

REM ---------- 2) 找 magpie.exe ----------
set "MAGPIE_EXE="
if exist "D:\magpie\magpie.exe" set "MAGPIE_EXE=D:\magpie\magpie.exe"
if not defined MAGPIE_EXE if exist "%LOCALAPPDATA%\magpie\magpie.exe" set "MAGPIE_EXE=%LOCALAPPDATA%\magpie\magpie.exe"
if not defined MAGPIE_EXE (
  for /f "delims=" %%i in ('where magpie.exe 2^>nul') do if not defined MAGPIE_EXE set "MAGPIE_EXE=%%i"
)
if not defined MAGPIE_EXE (
  echo  [X] 没找到 magpie.exe。
  echo      请用记事本打开本脚本，把 MAGPIE_EXE 改成你电脑上的实际路径。
  echo.
  pause
  exit /b 1
)
echo  [OK] Magpie: %MAGPIE_EXE%

REM ---------- 3) 检测飞书授权（关键前提） ----------
set "LARK_RUN="
for /d %%v in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if exist "%%v\node_modules\@larksuite\cli\scripts\run.js" if not defined LARK_RUN set "LARK_RUN=%%v\node_modules\@larksuite\cli\scripts\run.js"
)
echo.
echo  正在检测飞书授权...
if not defined LARK_RUN (
  echo  [X] 没找到飞书 CLI。请确认 WorkBuddy 的飞书能力已安装。
  echo.
  pause
  exit /b 1
)
"%NODE_EXE%" "%LARK_RUN%" whoami > "%TEMP%\magpie_lark_who.json" 2>nul
findstr /C:"\"available\": true" "%TEMP%\magpie_lark_who.json" >nul
if errorlevel 1 (
  echo  [X] 飞书还没授权/登录。
  echo      请先在 WorkBuddy 里连接飞书（登录和另一台【相同】的账号），
  echo      然后重新双击本脚本。
  echo.
  pause
  exit /b 1
)
for /f "tokens=2 delims=:" %%n in ('findstr /C:"userName" "%TEMP%\magpie_lark_who.json"') do set "LARK_USER=%%n"
echo  [OK] 飞书已授权: %LARK_USER%

REM ---------- 4) 安装插件（GitHub spec，文档已内置，无需绑定） ----------
echo.
echo  正在安装配置同步插件...
"%MAGPIE_EXE%" plugin add github:cy1380990555-gif/magpie-settings-sync 2>&1 | findstr /V "plugin: host starts"
echo.

REM ---------- 5) 立即从飞书拉取最新配置到本地 ----------
set "SYNC=%USERPROFILE%\.config\magpie\plugins\node_modules\magpie-settings-sync\scripts\sync.mjs"
if not exist "%SYNC%" (
  echo  [X] 插件似乎没装成功（找不到 %SYNC%）。
  echo.
  pause
  exit /b 1
)
echo  正在从飞书同步配置到本机...
"%NODE_EXE%" "%SYNC%" apply
echo.
echo  ============================================================
echo   完成！请【重启 Magpie】，新配置才会生效。
echo   以后每次打开 Magpie 都会自动同步，不用再运行本脚本。
echo  ============================================================
echo.
pause
