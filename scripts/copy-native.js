const fs = require('fs');
const path = require('path');

const nodeModules = path.join(__dirname, '..', 'node_modules');
const distNodeModules = path.join(__dirname, '..', 'dist', 'node_modules');
const writerNodeModules = path.join(__dirname, '..', 'dist', 'writer', 'node_modules');

// Recursively copy a directory
function copyAll(srcDir, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyAll(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy only selected top-level directories from better-sqlite3
function copyBetterSqlite3(srcDir, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      if (['build', 'lib', 'prebuilds'].includes(entry.name)) {
        copyAll(srcPath, destPath);
      }
    } else if (
      entry.name === 'package.json' ||
      entry.name.endsWith('.node') ||
      entry.name.endsWith('.js')
    ) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Writer用: システムNode (v24) でコンパイル済みの better-sqlite3 をコピー
//    (npm install 時にシステムNodeでビルドされたもの)
const systemBetterSqlite3 = path.join(nodeModules, 'better-sqlite3');
copyBetterSqlite3(systemBetterSqlite3, path.join(writerNodeModules, 'better-sqlite3'));

// Writer用の依存パッケージもコピー
for (const dep of ['bindings', 'file-uri-to-path']) {
  const depSrc = path.join(nodeModules, dep);
  const depDest = path.join(writerNodeModules, dep);
  if (fs.existsSync(depSrc)) {
    copyAll(depSrc, depDest);
  }
}
console.log('Copied system-Node better-sqlite3 to dist/writer/node_modules/');

// 2. Extension用: VSCode Node (v22) でコンパイル済みの better-sqlite3 をコピー
//    /tmp/ccdock-rebuild/ にNode 22でビルドしたものがある場合はそれを使う
const vscodeRebuildPath = '/tmp/ccdock-rebuild/node_modules/better-sqlite3';
const extensionBetterSqlite3 = fs.existsSync(vscodeRebuildPath)
  ? vscodeRebuildPath
  : systemBetterSqlite3; // フォールバック（同一バージョンの場合）

copyBetterSqlite3(extensionBetterSqlite3, path.join(distNodeModules, 'better-sqlite3'));

for (const dep of ['bindings', 'file-uri-to-path']) {
  const depSrc = path.join(nodeModules, dep);
  const depDest = path.join(distNodeModules, dep);
  if (fs.existsSync(depSrc)) {
    copyAll(depSrc, depDest);
  }
}

if (fs.existsSync(vscodeRebuildPath)) {
  console.log('Copied VSCode-Node better-sqlite3 to dist/node_modules/');
} else {
  console.log('WARNING: No VSCode-Node rebuild found. Using system build (may cause ABI mismatch).');
  console.log('Run: nvm use 22 && cd /tmp/ccdock-rebuild && npm install better-sqlite3');
}
