const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');
const dest = path.join(__dirname, '..', 'dist', 'node_modules', 'better-sqlite3');

// Recursively copy a directory without filtering (used for sub-directories inside build/lib/prebuilds)
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

// Top-level: only enter selected directories; copy select files
function copyTopLevel(srcDir, destDir) {
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

copyTopLevel(src, dest);

// better-sqlite3 の依存パッケージもコピー (bindings → file-uri-to-path)
const nodeModules = path.join(__dirname, '..', 'node_modules');
const distNodeModules = path.join(__dirname, '..', 'dist', 'node_modules');

for (const dep of ['bindings', 'file-uri-to-path']) {
  const depSrc = path.join(nodeModules, dep);
  const depDest = path.join(distNodeModules, dep);
  if (fs.existsSync(depSrc)) {
    copyAll(depSrc, depDest);
  }
}

console.log('Copied better-sqlite3 native addon and dependencies to dist/');
