/**
 * 修复 Electron 未正确安装（缺二进制或包不完整）。
 * 先强制重装 electron 包，再执行其 postinstall 下载二进制。
 * 若仍失败，请关闭 Cursor/IDE 后在外层 CMD 执行：rmdir /s /q node_modules\electron && npm install
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const electronDir = path.join(root, 'node_modules', 'electron');

console.log('正在修复 Electron 安装...\n');

// 1. 若 electron 目录不完整（缺少 index.js），先尝试强制重装
const indexPath = path.join(electronDir, 'index.js');
if (!fs.existsSync(indexPath)) {
  console.log('检测到 node_modules/electron 不完整，尝试强制重装 electron 包...');
  try {
    execSync('npm install electron@33.2.0 --no-save --force', { cwd: root, stdio: 'inherit' });
  } catch (e) {
    console.log('\n自动重装失败（可能被占用）。请：');
    console.log('  1. 完全关闭 Cursor / VS Code');
    console.log('  2. 打开系统 CMD，执行：');
    console.log('     cd /d ' + root);
    console.log('     rmdir /s /q node_modules\\electron');
    console.log('     npm install');
    process.exit(1);
  }
  if (!fs.existsSync(indexPath)) {
    console.log('重装后仍不完整，请关闭 IDE 后手动删除 node_modules\\electron 再 npm install');
    process.exit(1);
  }
}

// 2. 若已有 path.txt 和 dist，说明二进制已在
const pathTxt = path.join(electronDir, 'path.txt');
const distDir = path.join(electronDir, 'dist');
if (fs.existsSync(pathTxt) && fs.existsSync(distDir)) {
  console.log('Electron 二进制已存在，无需修复。');
  process.exit(0);
}

// 3. 执行 electron 自带的 install.js 下载二进制
const installJs = path.join(electronDir, 'install.js');
if (!fs.existsSync(installJs)) {
  console.log('未找到 node_modules/electron/install.js，请删除 node_modules/electron 后重新 npm install');
  process.exit(1);
}

console.log('正在运行 electron/install.js 下载二进制...');
try {
  execSync('node install.js', {
    cwd: electronDir,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || '' },
  });
} catch (e) {
  console.error('\n下载失败。可设置国内镜像后重试：');
  console.error('  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/');
  console.error('  npm run electron:fix');
  process.exit(1);
}

if (fs.existsSync(pathTxt) && fs.existsSync(distDir)) {
  console.log('\nElectron 修复完成，可运行 npm run electron:dev');
} else {
  console.log('\n仍未检测到二进制，请删除 node_modules/electron 后重新 npm install（需关闭 IDE）');
  process.exit(1);
}
