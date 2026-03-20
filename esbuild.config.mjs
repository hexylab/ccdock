import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', 'better-sqlite3'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
};

const writerConfig = {
  entryPoints: ['src/writer/ccdock-writer.ts'],
  bundle: true,
  outfile: 'dist/writer/ccdock-writer.js',
  external: ['better-sqlite3'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
};

const statuslineConfig = {
  entryPoints: ['src/writer/ccdock-statusline.ts'],
  bundle: true,
  outfile: 'dist/writer/ccdock-statusline.js',
  external: ['better-sqlite3'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
};

const webviewConfig = {
  entryPoints: ['src/webview/app/index.tsx'],
  bundle: true,
  outfile: 'dist/webview/main.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
};

async function build() {
  if (isWatch) {
    const contexts = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(writerConfig),
      esbuild.context(statuslineConfig),
      esbuild.context(webviewConfig),
    ]);
    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(writerConfig),
      esbuild.build(statuslineConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log('Build complete.');
  }
}

build().catch(() => process.exit(1));
