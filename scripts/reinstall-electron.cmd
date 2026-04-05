@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo 工作目录: %CD%
echo.
echo 正在结束可能占用 electron 的 Node/Electron 进程...
taskkill /F /IM node.exe 2>nul
taskkill /F /IM electron.exe 2>nul
timeout /t 2 /nobreak >nul

echo.
echo 请先关闭 Cursor/VS Code 及其他打开本目录的窗口，然后按任意键继续...
pause >nul

echo 尝试删除 node_modules\electron ...
rmdir /s /q node_modules\electron 2>nul
if exist node_modules\electron (
    echo 删除失败，目录仍被占用。请：
    echo 1. 完全退出 Cursor 或 IDE
    echo 2. 重启电脑后再运行此脚本
    pause
    exit /b 1
)

echo 正在重新安装依赖（含 Electron）...
call npm install
if errorlevel 1 (
    echo npm install 失败
    pause
    exit /b 1
)

echo.
echo 完成。可运行 npm run electron:dev 测试。
pause
