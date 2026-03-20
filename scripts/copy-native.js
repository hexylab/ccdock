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
console.log('Copied better-sqlite3 native addon to dist/');
