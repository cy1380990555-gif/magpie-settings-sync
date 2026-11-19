@echo off
chcp 65001 >nul
title Magpie 配置更新
echo.
echo  ==================================
echo     Magpie 配置更新
echo  ==================================
echo.
echo  正在同步配置，请稍候...
echo.

setlocal
set "NODE_EXE="
for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if exist "%%D\node.exe" set "NODE_EXE=%%D\node.exe"
)
if not defined NODE_EXE (
  where node >nul 2>nul && set "NODE_EXE=node"
)
if not defined NODE_EXE (
  echo  [错误] 未找到 Node.js，无法更新配置。
  echo.
  pause
  exit /b 1
)

set "SYNC=%USERPROFILE%\.config\magpie\plugins\node_modules\magpie-settings-sync\scripts\sync.mjs"
if not exist "%SYNC%" (
  echo  [错误] 找不到同步插件：
  echo  %SYNC%
  echo  请确认插件已安装。
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" "%SYNC%" apply

echo.
pause
