# ccdock (Claude Code Dock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VSCode のセカンダリサイドバーに Claude Code セッションをカード表示して一元管理する拡張機能を構築する。

**Architecture:** Claude Code の hooks から ccdock-writer.js（Node.js CLI）を呼び出し、SQLite に書き込む。VSCode 拡張はポーリングで DB を読み取り、React WebView にカードを描画する。hooks は既存の settings.json に安全に追記する。

**Tech Stack:** TypeScript, React, esbuild, better-sqlite3 (or sql.js), vitest, VSCode Extension API

**Spec:** `docs/superpowers/specs/2026-03-20-ccdock-design.md`

---

## File Structure

```
src/
├── extension.ts              # activate/deactivate エントリポイント
├── hooks-installer.ts        # hooks の CRUD（settings.json 操作）
├── constants.ts              # 共有定数（イベント名、DB パス、ステータス値等）
├── db/
│   ├── database.ts           # SQLite 接続・PRAGMA・初期化
│   ├── schema.ts             # テーブル作成・マイグレーション
│   └── session-repo.ts       # sessions テーブルの CRUD
├── watcher/
│   ├── db-poller.ts          # ポーリング + fs.watch ヒント
│   └── session-store.ts      # メモリ diff 算出・WebView 通知
├── webview/
│   ├── provider.ts           # WebviewViewProvider 実装
│   └── app/
│       ├── index.tsx          # React エントリポイント
│       ├── App.tsx            # ルートコンポーネント
│       ├── components/
│       │   ├── SessionCard.tsx
│       │   ├── ContextBar.tsx
│       │   └── StatusDot.tsx
│       ├── hooks/
│       │   └── useSessionStore.ts  # postMessage ハンドラ
│       └── types.ts           # Session 型、メッセージ型
├── writer/
│   └── ccdock-writer.ts       # hooks 用 CLI スクリプト
└── shared/
    └── types.ts               # Extension ↔ Writer 間の共有型定義

test/
├── session-repo.test.ts
├── hooks-installer.test.ts
├── writer.test.ts
├── db-poller.test.ts
└── session-store.test.ts
```

---

## Task 0: Hooks stdin JSON の実機検証

**Files:**
- Create: `scripts/dump-hooks-stdin.sh`

このタスクは実装の前提条件を検証するもの。Claude Code の各フックイベントで stdin に渡される JSON フィールドを収集し、設計仕様の想定が正しいかを確認する。

- [ ] **Step 1: ダンプスクリプトを作成**

```bash
#!/bin/bash
# scripts/dump-hooks-stdin.sh
# Usage: このスクリプトを各フックイベントに登録し、stdin JSON をダンプする
EVENT="${1:-unknown}"
DUMP_DIR="/tmp/ccdock-debug"
mkdir -p "$DUMP_DIR"
TIMESTAMP=$(date +%s%N)
cat > "$DUMP_DIR/${EVENT}-${TIMESTAMP}.json"
```

- [ ] **Step 2: ~/.claude/settings.json に一時的にダンプフックを登録**

以下のイベントすべてに登録: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, PreCompact, PostCompact, SessionEnd, SubagentStart, SubagentStop

各イベントのフック形式:
```json
{
  "matcher": "",
  "hooks": [
    {
      "type": "command",
      "command": "bash /path/to/scripts/dump-hooks-stdin.sh SessionStart",
      "timeout": 10
    }
  ]
}
```

- [ ] **Step 3: Claude Code セッションを起動し、各種操作を実行**

以下の操作を行い、フックを発火させる:
1. セッション開始（SessionStart）
2. プロンプト送信（UserPromptSubmit）
3. ツール使用させる（PreToolUse, PostToolUse）
4. 応答完了を待つ（Stop）
5. /clear 実行後に再度プロンプト送信（session_id の変化を確認）
6. サブエージェント使用（SubagentStart, SubagentStop の発火確認）
7. セッション終了（SessionEnd）

- [ ] **Step 4: ダンプされた JSON を分析し、設計仕様の検証テーブルを更新**

```bash
# /tmp/ccdock-debug/ 内のファイルを確認
ls -la /tmp/ccdock-debug/
# 各ファイルの内容を確認
for f in /tmp/ccdock-debug/*.json; do echo "=== $f ==="; python3 -m json.tool < "$f"; done
```

確認ポイント:
- `session_id`, `transcript_path`, `hook_event_name`, `cwd` の存在
- `agent_id` / `agent_type` がサブエージェント時に存在するか
- コスト・コンテキスト情報がどのイベントに含まれるか
- `/clear` 後の `session_id` と `transcript_path` の変化

- [ ] **Step 5: 検証結果を設計仕様に反映してコミット**

```bash
git add docs/superpowers/specs/2026-03-20-ccdock-design.md scripts/dump-hooks-stdin.sh
git commit -m "docs: update spec with verified hooks stdin fields"
```

---

## Task 1: プロジェクトスキャフォールド

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `.gitignore`
- Create: `.vscodeignore`
- Create: `src/constants.ts`
- Create: `src/shared/types.ts`

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "ccdock",
  "displayName": "Claude Code Dock",
  "description": "Manage Claude Code sessions from VSCode secondary sidebar",
  "version": "0.1.0",
  "publisher": "hexyl",
  "license": "MIT",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "panel": [
        {
          "id": "ccdock",
          "title": "Claude Code Dock",
          "icon": "$(terminal)"
        }
      ]
    },
    "views": {
      "ccdock": [
        {
          "type": "webview",
          "id": "ccdock.sessionPanel",
          "name": "Sessions"
        }
      ]
    }
  },
  "scripts": {
    "build": "node esbuild.config.mjs",
    "watch": "node esbuild.config.mjs --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "package": "vsce package --no-dependencies"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0",
    "eslint": "^8.57.0",
    "@vscode/vsce": "^2.24.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: esbuild.config.mjs を作成**

```javascript
import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

// 拡張機能本体のバンドル
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

// ccdock-writer CLI のバンドル
const writerConfig = {
  entryPoints: ['src/writer/ccdock-writer.ts'],
  bundle: true,
  outfile: 'dist/ccdock-writer.js',
  external: ['better-sqlite3'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
};

// WebView React アプリのバンドル
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
      esbuild.context(webviewConfig),
    ]);
    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(writerConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log('Build complete.');
  }
}

build().catch(() => process.exit(1));
```

- [ ] **Step 4: .gitignore と .vscodeignore を作成**

`.gitignore`:
```
node_modules/
dist/
*.vsix
.vscode-test/
```

`.vscodeignore`:
```
src/**
test/**
scripts/**
docs/**
node_modules/**
!node_modules/better-sqlite3/**
.gitignore
tsconfig.json
esbuild.config.mjs
vitest.config.ts
```

- [ ] **Step 5: src/constants.ts を作成**

```typescript
import * as path from 'path';
import * as os from 'os';

export const CCDOCK_DIR = path.join(os.homedir(), '.ccdock');
export const DB_PATH = path.join(CCDOCK_DIR, 'dock.db');
export const ERROR_LOG_PATH = path.join(CCDOCK_DIR, 'error.log');
export const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'PreCompact',
  'PostCompact',
  'SessionEnd',
] as const;

export type HookEventName = typeof HOOK_EVENTS[number];

export const STATUS_MAP: Record<string, string> = {
  SessionStart: 'active',
  UserPromptSubmit: 'thinking',
  PreToolUse: 'tool_use',
  PostToolUse: 'thinking',
  PostToolUseFailure: 'thinking',
  Stop: 'waiting',
  PreCompact: 'compacting',
  PostCompact: 'thinking',
};

export const POLL_INTERVAL_MS = 1000;
export const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
export const GC_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
export const WRITER_MARKER = 'ccdock-writer';
```

- [ ] **Step 6: src/shared/types.ts を作成**

```typescript
export interface Session {
  dock_id: string;
  process_key: string;
  session_id: string;
  model: string | null;
  model_display: string | null;
  cwd: string | null;
  status: string;
  cost_usd: number;
  context_used: number;
  context_total: number;
  total_input_tokens: number;
  total_output_tokens: number;
  lines_added: number;
  lines_removed: number;
  started_at: string;
  updated_at: string;
  version: string | null;
}

export interface HookStdinData {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
  cwd: string;
  agent_id?: string;
  agent_type?: string;
  // Stop イベント等で含まれる可能性のあるフィールド（検証後に確定）
  [key: string]: unknown;
}

// Extension → WebView
export type ExtensionMessage =
  | { type: 'sessions:snapshot'; sessions: Session[] }
  | { type: 'sessions:upsert'; session: Session }
  | { type: 'sessions:remove'; dockId: string };

// WebView → Extension
export type WebViewMessage =
  | { type: 'session:dismiss'; dockId: string }
  | { type: 'ready' };
```

- [ ] **Step 7: npm install を実行**

```bash
npm install
```

- [ ] **Step 8: ファイル構成をコミット**

```bash
git add -A
git commit -m "feat: scaffold ccdock project with package.json, tsconfig, esbuild config"
```

---

## Task 2: SQLite DB レイヤー

**Files:**
- Create: `src/db/database.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/session-repo.ts`
- Create: `test/session-repo.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: vitest.config.ts を作成**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 2: テストを作成 — session-repo.test.ts**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../src/db/schema';
import { SessionRepo } from '../src/db/session-repo';
import type { Session } from '../src/shared/types';

describe('SessionRepo', () => {
  let db: Database.Database;
  let repo: SessionRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    initializeSchema(db);
    repo = new SessionRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('upsert inserts a new session on SessionStart', () => {
    repo.upsert({
      process_key: 'pk-1',
      session_id: 'sid-1',
      event: 'SessionStart',
      cwd: '/home/user/project',
    });

    const sessions = repo.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].process_key).toBe('pk-1');
    expect(sessions[0].status).toBe('active');
    expect(sessions[0].cwd).toBe('/home/user/project');
    expect(sessions[0].dock_id).toBeTruthy();
  });

  it('upsert updates existing session on subsequent events', () => {
    repo.upsert({
      process_key: 'pk-1',
      session_id: 'sid-1',
      event: 'SessionStart',
      cwd: '/home/user/project',
    });

    repo.upsert({
      process_key: 'pk-1',
      session_id: 'sid-1',
      event: 'UserPromptSubmit',
      cwd: '/home/user/project',
    });

    const sessions = repo.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('thinking');
  });

  it('upsert updates session_id on /clear (same process_key, new session_id)', () => {
    repo.upsert({
      process_key: 'pk-1',
      session_id: 'sid-1',
      event: 'SessionStart',
      cwd: '/home/user/project',
    });

    repo.upsert({
      process_key: 'pk-1',
      session_id: 'sid-2',
      event: 'SessionStart',
      cwd: '/home/user/project',
    });

    const sessions = repo.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session_id).toBe('sid-2');
    expect(sessions[0].status).toBe('active');
  });

  it('deleteByProcessKey removes session on SessionEnd', () => {
    repo.upsert({
      process_key: 'pk-1',
      session_id: 'sid-1',
      event: 'SessionStart',
      cwd: '/home/user/project',
    });

    repo.deleteByProcessKey('pk-1');

    const sessions = repo.getAll();
    expect(sessions).toHaveLength(0);
  });

  it('getAll returns sessions ordered by updated_at desc', () => {
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'SessionStart', cwd: '/a' });
    repo.upsert({ process_key: 'pk-2', session_id: 'sid-2', event: 'SessionStart', cwd: '/b' });
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'Stop', cwd: '/a' });

    const sessions = repo.getAll();
    expect(sessions[0].process_key).toBe('pk-1');
    expect(sessions[1].process_key).toBe('pk-2');
  });

  it('markStale marks old sessions as stale', () => {
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'SessionStart', cwd: '/a' });

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.prepare('UPDATE sessions SET updated_at = ? WHERE process_key = ?').run(tenMinAgo, 'pk-1');

    repo.markStale(5 * 60 * 1000);

    const sessions = repo.getAll();
    expect(sessions[0].status).toBe('stale');
  });

  it('cleanupOld removes sessions older than threshold', () => {
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'SessionStart', cwd: '/a' });

    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE sessions SET updated_at = ? WHERE process_key = ?').run(dayAgo, 'pk-1');

    repo.cleanupOld(24 * 60 * 60 * 1000);

    const sessions = repo.getAll();
    expect(sessions).toHaveLength(0);
  });

  it('dismiss removes a session by dock_id', () => {
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'SessionStart', cwd: '/a' });
    const sessions = repo.getAll();
    const dockId = sessions[0].dock_id;

    repo.dismiss(dockId);

    expect(repo.getAll()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: テストを実行し失敗を確認**

```bash
npx vitest run test/session-repo.test.ts
```

Expected: FAIL — モジュールが存在しない

- [ ] **Step 4: src/db/database.ts を実装**

```typescript
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export function openDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}
```

- [ ] **Step 5: src/db/schema.ts を実装**

```typescript
import type Database from 'better-sqlite3';

const CURRENT_VERSION = 1;

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS sessions (
      dock_id             TEXT PRIMARY KEY,
      process_key         TEXT UNIQUE NOT NULL,
      session_id          TEXT NOT NULL,
      model               TEXT,
      model_display       TEXT,
      cwd                 TEXT,
      status              TEXT NOT NULL DEFAULT 'active',
      cost_usd            REAL DEFAULT 0,
      context_used        INTEGER DEFAULT 0,
      context_total       INTEGER DEFAULT 0,
      total_input_tokens  INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      lines_added         INTEGER DEFAULT 0,
      lines_removed       INTEGER DEFAULT 0,
      started_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      version             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_process_key ON sessions(process_key);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `,
};

export function initializeSchema(db: Database.Database): void {
  const currentVersion = getSchemaVersion(db);

  for (let v = currentVersion + 1; v <= CURRENT_VERSION; v++) {
    const sql = MIGRATIONS[v];
    if (sql) {
      db.exec(sql);
      db.prepare(
        'INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)'
      ).run(v, new Date().toISOString());
    }
  }
}

function getSchemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare(
      'SELECT MAX(version) as version FROM schema_version'
    ).get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 6: src/db/session-repo.ts を実装**

```typescript
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { STATUS_MAP } from '../constants';
import type { Session } from '../shared/types';

export interface UpsertParams {
  process_key: string;
  session_id: string;
  event: string;
  cwd: string;
  model?: string;
  model_display?: string;
  cost_usd?: number;
  context_used?: number;
  context_total?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  lines_added?: number;
  lines_removed?: number;
  version?: string;
}

export class SessionRepo {
  constructor(private db: Database.Database) {}

  upsert(params: UpsertParams): void {
    const now = new Date().toISOString();
    const status = STATUS_MAP[params.event] ?? 'active';

    const existing = this.db.prepare(
      'SELECT dock_id FROM sessions WHERE process_key = ?'
    ).get(params.process_key) as { dock_id: string } | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE sessions SET
          session_id = ?,
          status = ?,
          cwd = ?,
          model = COALESCE(?, model),
          model_display = COALESCE(?, model_display),
          cost_usd = COALESCE(?, cost_usd),
          context_used = COALESCE(?, context_used),
          context_total = COALESCE(?, context_total),
          total_input_tokens = COALESCE(?, total_input_tokens),
          total_output_tokens = COALESCE(?, total_output_tokens),
          lines_added = COALESCE(?, lines_added),
          lines_removed = COALESCE(?, lines_removed),
          version = COALESCE(?, version),
          updated_at = ?
        WHERE process_key = ?
      `).run(
        params.session_id,
        status,
        params.cwd,
        params.model ?? null,
        params.model_display ?? null,
        params.cost_usd ?? null,
        params.context_used ?? null,
        params.context_total ?? null,
        params.total_input_tokens ?? null,
        params.total_output_tokens ?? null,
        params.lines_added ?? null,
        params.lines_removed ?? null,
        params.version ?? null,
        now,
        params.process_key,
      );
    } else {
      const dockId = randomUUID();
      this.db.prepare(`
        INSERT INTO sessions (
          dock_id, process_key, session_id, model, model_display, cwd,
          status, cost_usd, context_used, context_total,
          total_input_tokens, total_output_tokens,
          lines_added, lines_removed,
          started_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        dockId,
        params.process_key,
        params.session_id,
        params.model ?? null,
        params.model_display ?? null,
        params.cwd,
        status,
        params.cost_usd ?? 0,
        params.context_used ?? 0,
        params.context_total ?? 0,
        params.total_input_tokens ?? 0,
        params.total_output_tokens ?? 0,
        params.lines_added ?? 0,
        params.lines_removed ?? 0,
        now,
        now,
        params.version ?? null,
      );
    }
  }

  getAll(): Session[] {
    return this.db.prepare(
      "SELECT * FROM sessions ORDER BY CASE WHEN status = 'stale' THEN 1 ELSE 0 END, updated_at DESC"
    ).all() as Session[];
  }

  deleteByProcessKey(processKey: string): void {
    this.db.prepare('DELETE FROM sessions WHERE process_key = ?').run(processKey);
  }

  dismiss(dockId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE dock_id = ?').run(dockId);
  }

  markStale(thresholdMs: number): void {
    const cutoff = new Date(Date.now() - thresholdMs).toISOString();
    this.db.prepare(
      "UPDATE sessions SET status = 'stale' WHERE updated_at < ? AND status != 'stale'"
    ).run(cutoff);
  }

  cleanupOld(thresholdMs: number): void {
    const cutoff = new Date(Date.now() - thresholdMs).toISOString();
    this.db.prepare('DELETE FROM sessions WHERE updated_at < ?').run(cutoff);
  }
}
```

- [ ] **Step 7: テストを実行してパスを確認**

```bash
npx vitest run test/session-repo.test.ts
```

Expected: ALL PASS

- [ ] **Step 8: コミット**

```bash
git add src/db/ src/shared/types.ts src/constants.ts test/session-repo.test.ts vitest.config.ts
git commit -m "feat: add SQLite database layer with session CRUD and schema migration"
```

---

## Task 3: ccdock-writer CLI スクリプト

**Files:**
- Create: `src/writer/ccdock-writer.ts`
- Create: `test/writer.test.ts`

- [ ] **Step 1: テストを作成 — writer.test.ts**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../src/db/schema';
import { SessionRepo } from '../src/db/session-repo';
import { processHookEvent } from '../src/writer/ccdock-writer';

describe('processHookEvent', () => {
  let db: Database.Database;
  let repo: SessionRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    initializeSchema(db);
    repo = new SessionRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates a new session on SessionStart', () => {
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/home/user/project',
    });

    const sessions = repo.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('active');
  });

  it('updates session status on subsequent events', () => {
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/home/user/project',
    });

    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'PreToolUse',
      cwd: '/home/user/project',
    });

    const sessions = repo.getAll();
    expect(sessions[0].status).toBe('tool_use');
  });

  it('deletes session on SessionEnd', () => {
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/home/user/project',
    });

    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionEnd',
      cwd: '/home/user/project',
    });

    expect(repo.getAll()).toHaveLength(0);
  });

  it('skips SubAgent events when agent_id is present', () => {
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/home/user/project',
    });

    processHookEvent(db, {
      session_id: 'sid-sub',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'PreToolUse',
      cwd: '/home/user/project',
      agent_id: 'subagent-123',
      agent_type: 'Explore',
    });

    const sessions = repo.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('active');
  });

  it('derives consistent process_key from transcript_path', () => {
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/a',
    });

    processHookEvent(db, {
      session_id: 'sid-2',
      transcript_path: '/path/to/other.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/b',
    });

    const sessions = repo.getAll();
    expect(sessions).toHaveLength(2);
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

```bash
npx vitest run test/writer.test.ts
```

Expected: FAIL — processHookEvent が存在しない

- [ ] **Step 3: src/writer/ccdock-writer.ts を実装**

```typescript
import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { initializeSchema } from '../db/schema';
import { SessionRepo } from '../db/session-repo';
import type { HookStdinData } from '../shared/types';

export function deriveProcessKey(transcriptPath: string): string {
  return createHash('sha256').update(transcriptPath).digest('hex').slice(0, 16);
}

export function processHookEvent(db: Database.Database, data: HookStdinData): void {
  const repo = new SessionRepo(db);
  const processKey = deriveProcessKey(data.transcript_path);
  const event = data.hook_event_name;

  // SubAgent イベントはスキップ
  if (data.agent_id) {
    return;
  }

  // SessionEnd → DELETE
  if (event === 'SessionEnd') {
    repo.deleteByProcessKey(processKey);
    return;
  }

  // その他 → UPSERT
  repo.upsert({
    process_key: processKey,
    session_id: data.session_id,
    event,
    cwd: data.cwd,
  });
}

function appendErrorLog(logDir: string, error: Error): void {
  const logPath = path.join(logDir, 'error.log');
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const entry = `[${new Date().toISOString()}] ${error.message}\n${error.stack}\n\n`;
    fs.appendFileSync(logPath, entry);
  } catch {
    // ログ書き込みにも失敗した場合は何もしない
  }
}

// CLI エントリポイント
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const eventIdx = args.indexOf('--event');
  const dbIdx = args.indexOf('--db');

  const eventArg = eventIdx >= 0 ? args[eventIdx + 1] : undefined;
  const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : undefined;

  if (!dbPath) {
    process.exit(0);
  }

  // stdin から JSON を読み取り
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf-8').trim();

  if (!input) {
    process.exit(0);
  }

  const data: HookStdinData = JSON.parse(input);

  // --event が指定されていれば stdin より優先
  if (eventArg) {
    data.hook_event_name = eventArg;
  }

  const resolvedDbPath = dbPath.replace(/^~/, process.env.HOME ?? '');
  const dbDir = path.dirname(resolvedDbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(resolvedDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  initializeSchema(db);

  try {
    processHookEvent(db, data);
  } finally {
    db.close();
  }
}

// CLI として実行された場合のみ main を呼ぶ
if (require.main === module) {
  main().catch((err) => {
    const logDir = path.join(process.env.HOME ?? '', '.ccdock');
    appendErrorLog(logDir, err);
    process.exit(0); // 常に exit 0
  });
}
```

- [ ] **Step 4: テストを実行してパスを確認**

```bash
npx vitest run test/writer.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: コミット**

```bash
git add src/writer/ test/writer.test.ts
git commit -m "feat: add ccdock-writer CLI for processing hook events into SQLite"
```

---

## Task 4: Hooks Installer

**Files:**
- Create: `src/hooks-installer.ts`
- Create: `test/hooks-installer.test.ts`

- [ ] **Step 1: テストを作成 — hooks-installer.test.ts**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { installHooks, uninstallHooks } from '../src/hooks-installer';

describe('HooksInstaller', () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccdock-test-'));
    settingsPath = path.join(tmpDir, 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates hooks in empty settings file', () => {
    fs.writeFileSync(settingsPath, '{}');

    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('ccdock-writer');
  });

  it('appends to existing hooks without modifying them', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: 'existing-cmd' }],
          },
        ],
      },
    }, null, 2));

    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(2);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('existing-cmd');
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('ccdock-writer');
  });

  it('does not duplicate hooks on repeated install', () => {
    fs.writeFileSync(settingsPath, '{}');

    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');
    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it('updates hook path if extension path changed', () => {
    fs.writeFileSync(settingsPath, '{}');

    installHooks(settingsPath, '/old/path/ccdock-writer.js', '/home/.ccdock/dock.db');
    installHooks(settingsPath, '/new/path/ccdock-writer.js', '/home/.ccdock/dock.db');

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('/new/path/');
  });

  it('uninstallHooks removes ccdock entries', () => {
    fs.writeFileSync(settingsPath, '{}');

    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');
    uninstallHooks(settingsPath);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(0);
  });

  it('uninstallHooks preserves non-ccdock entries', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: 'existing-cmd' }] },
        ],
      },
    }, null, 2));

    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');
    uninstallHooks(settingsPath);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('existing-cmd');
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

```bash
npx vitest run test/hooks-installer.test.ts
```

Expected: FAIL

- [ ] **Step 3: src/hooks-installer.ts を実装**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { HOOK_EVENTS, WRITER_MARKER } from './constants';

interface HookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
    timeout?: number;
  }>;
}

function buildHookCommand(writerPath: string, event: string, dbPath: string): string {
  return `node "${writerPath}" --event ${event} --db "${dbPath}" 2>/dev/null || true`;
}

function buildHookEntry(writerPath: string, event: string, dbPath: string): HookEntry {
  return {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: buildHookCommand(writerPath, event, dbPath),
        timeout: 10,
      },
    ],
  };
}

export function installHooks(
  settingsPath: string,
  writerPath: string,
  dbPath: string
): void {
  const settings = readSettings(settingsPath);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  let changed = false;

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }

    const entries = settings.hooks[event] as HookEntry[];
    const existingIdx = entries.findIndex((e) =>
      e.hooks?.some((h) => h.command?.includes(WRITER_MARKER))
    );

    if (existingIdx >= 0) {
      const currentCmd = entries[existingIdx].hooks[0].command;
      const newCmd = buildHookCommand(writerPath, event, dbPath);
      if (currentCmd !== newCmd) {
        entries[existingIdx] = buildHookEntry(writerPath, event, dbPath);
        changed = true;
      }
    } else {
      entries.push(buildHookEntry(writerPath, event, dbPath));
      changed = true;
    }
  }

  if (changed) {
    writeSettings(settingsPath, settings);
  }
}

export function uninstallHooks(settingsPath: string): void {
  if (!fs.existsSync(settingsPath)) return;

  const settings = readSettings(settingsPath);
  if (!settings.hooks) return;

  let changed = false;

  for (const event of HOOK_EVENTS) {
    const entries = settings.hooks[event] as HookEntry[] | undefined;
    if (!entries) continue;

    const filtered = entries.filter(
      (e) => !e.hooks?.some((h) => h.command?.includes(WRITER_MARKER))
    );

    if (filtered.length !== entries.length) {
      settings.hooks[event] = filtered;
      changed = true;
    }
  }

  if (changed) {
    writeSettings(settingsPath, settings);
  }
}

function readSettings(settingsPath: string): Record<string, any> {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  const content = fs.readFileSync(settingsPath, 'utf-8');
  return JSON.parse(content);
}

function writeSettings(settingsPath: string, settings: Record<string, any>): void {
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = settingsPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmpPath, settingsPath);
}
```

- [ ] **Step 4: テストを実行してパスを確認**

```bash
npx vitest run test/hooks-installer.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: コミット**

```bash
git add src/hooks-installer.ts test/hooks-installer.test.ts
git commit -m "feat: add hooks installer for safe Claude Code settings.json modification"
```

---

## Task 5: DB Poller と SessionStore

**Files:**
- Create: `src/watcher/db-poller.ts`
- Create: `src/watcher/session-store.ts`
- Create: `test/db-poller.test.ts`
- Create: `test/session-store.test.ts`

- [ ] **Step 1: テストを作成 — session-store.test.ts**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStore } from '../src/watcher/session-store';
import type { Session } from '../src/shared/types';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    dock_id: 'dock-1',
    process_key: 'pk-1',
    session_id: 'sid-1',
    model: 'claude-opus-4-6',
    model_display: 'Opus',
    cwd: '/home/user',
    status: 'active',
    cost_usd: 0,
    context_used: 0,
    context_total: 200000,
    total_input_tokens: 0,
    total_output_tokens: 0,
    lines_added: 0,
    lines_removed: 0,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: '1.0.0',
    ...overrides,
  };
}

describe('SessionStore', () => {
  let store: SessionStore;
  let messages: Array<{ type: string; [key: string]: unknown }>;

  beforeEach(() => {
    messages = [];
    store = new SessionStore((msg) => messages.push(msg as never));
  });

  it('emits upsert for new sessions', () => {
    store.update([makeSession()]);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('sessions:upsert');
  });

  it('emits upsert for changed sessions', () => {
    store.update([makeSession()]);
    messages.length = 0;
    store.update([makeSession({ status: 'thinking', updated_at: new Date().toISOString() })]);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('sessions:upsert');
  });

  it('does not emit for unchanged sessions', () => {
    const session = makeSession();
    store.update([session]);
    messages.length = 0;
    store.update([session]);
    expect(messages).toHaveLength(0);
  });

  it('emits remove for deleted sessions', () => {
    store.update([makeSession()]);
    messages.length = 0;
    store.update([]);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('sessions:remove');
  });

  it('getSnapshot returns current sessions', () => {
    const s = makeSession();
    store.update([s]);
    expect(store.getSnapshot()).toEqual([s]);
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

```bash
npx vitest run test/session-store.test.ts
```

Expected: FAIL

- [ ] **Step 3: src/watcher/session-store.ts を実装**

```typescript
import type { Session, ExtensionMessage } from '../shared/types';

export class SessionStore {
  private sessions: Map<string, Session> = new Map();
  private notify: (msg: ExtensionMessage) => void;

  constructor(notify: (msg: ExtensionMessage) => void) {
    this.notify = notify;
  }

  update(newSessions: Session[]): void {
    const newMap = new Map(newSessions.map((s) => [s.dock_id, s]));

    for (const dockId of this.sessions.keys()) {
      if (!newMap.has(dockId)) {
        this.notify({ type: 'sessions:remove', dockId });
      }
    }

    for (const [dockId, session] of newMap) {
      const existing = this.sessions.get(dockId);
      if (!existing || existing.updated_at !== session.updated_at || existing.status !== session.status) {
        this.notify({ type: 'sessions:upsert', session });
      }
    }

    this.sessions = newMap;
  }

  getSnapshot(): Session[] {
    return Array.from(this.sessions.values());
  }
}
```

- [ ] **Step 4: テストをパスさせる**

```bash
npx vitest run test/session-store.test.ts
```

Expected: ALL PASS

- [ ] **Step 5: テストを作成 — db-poller.test.ts**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DbPoller } from '../src/watcher/db-poller';

describe('DbPoller', () => {
  let poller: DbPoller;
  let fetchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchFn = vi.fn().mockReturnValue([]);
  });

  afterEach(() => {
    poller?.stop();
    vi.useRealTimers();
  });

  it('calls fetch function on interval', () => {
    poller = new DbPoller(fetchFn, 1000);
    poller.start();
    vi.advanceTimersByTime(3500);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('stops calling after stop()', () => {
    poller = new DbPoller(fetchFn, 1000);
    poller.start();
    vi.advanceTimersByTime(2500);
    poller.stop();
    vi.advanceTimersByTime(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('trigger() calls fetch immediately', () => {
    poller = new DbPoller(fetchFn, 1000);
    poller.start();
    poller.trigger();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: src/watcher/db-poller.ts を実装**

```typescript
import * as fs from 'fs';

export class DbPoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private watchers: fs.FSWatcher[] = [];
  private fetchFn: () => void;
  private intervalMs: number;

  constructor(fetchFn: () => void, intervalMs: number) {
    this.fetchFn = fetchFn;
    this.intervalMs = intervalMs;
  }

  start(dbPath?: string): void {
    this.interval = setInterval(() => {
      this.fetchFn();
    }, this.intervalMs);

    if (dbPath) {
      this.watchFile(dbPath);
      this.watchFile(dbPath + '-wal');
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
  }

  trigger(): void {
    this.fetchFn();
  }

  private watchFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        const watcher = fs.watch(filePath, () => {
          this.trigger();
        });
        watcher.on('error', () => {});
        this.watchers.push(watcher);
      }
    } catch {
      // fs.watch not available
    }
  }
}
```

- [ ] **Step 7: テストをパスさせる**

```bash
npx vitest run test/db-poller.test.ts
```

Expected: ALL PASS

- [ ] **Step 8: コミット**

```bash
git add src/watcher/ test/db-poller.test.ts test/session-store.test.ts
git commit -m "feat: add DB poller and session store for reactive session tracking"
```

---

## Task 6: WebView Provider と React UI

**Files:**
- Create: `src/webview/provider.ts`
- Create: `src/webview/app/index.tsx`
- Create: `src/webview/app/App.tsx`
- Create: `src/webview/app/types.ts`
- Create: `src/webview/app/hooks/useSessionStore.ts`
- Create: `src/webview/app/components/SessionCard.tsx`
- Create: `src/webview/app/components/ContextBar.tsx`
- Create: `src/webview/app/components/StatusDot.tsx`

- [ ] **Step 1: src/webview/app/types.ts を作成**

```typescript
export interface Session {
  dock_id: string;
  process_key: string;
  session_id: string;
  model: string | null;
  model_display: string | null;
  cwd: string | null;
  status: string;
  cost_usd: number;
  context_used: number;
  context_total: number;
  total_input_tokens: number;
  total_output_tokens: number;
  lines_added: number;
  lines_removed: number;
  started_at: string;
  updated_at: string;
  version: string | null;
}

export type ExtensionMessage =
  | { type: 'sessions:snapshot'; sessions: Session[] }
  | { type: 'sessions:upsert'; session: Session }
  | { type: 'sessions:remove'; dockId: string };

export type WebViewMessage =
  | { type: 'session:dismiss'; dockId: string }
  | { type: 'ready' };
```

- [ ] **Step 2: src/webview/app/hooks/useSessionStore.ts を作成**

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { Session, ExtensionMessage, WebViewMessage } from '../types';

declare const acquireVsCodeApi: () => {
  postMessage: (msg: WebViewMessage) => void;
};

const vscode = acquireVsCodeApi();

export function useSessionStore() {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'sessions:snapshot':
          setSessions(msg.sessions);
          break;
        case 'sessions:upsert':
          setSessions((prev) => {
            const idx = prev.findIndex((s) => s.dock_id === msg.session.dock_id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg.session;
              return next;
            }
            return [msg.session, ...prev];
          });
          break;
        case 'sessions:remove':
          setSessions((prev) => prev.filter((s) => s.dock_id !== msg.dockId));
          break;
      }
    };

    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const dismiss = useCallback((dockId: string) => {
    vscode.postMessage({ type: 'session:dismiss', dockId });
  }, []);

  return { sessions, dismiss };
}
```

- [ ] **Step 3: src/webview/app/components/StatusDot.tsx を作成**

```tsx
import React from 'react';

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--vscode-testing-iconPassed, #4caf50)',
  thinking: 'var(--vscode-editorWarning-foreground, #ff9800)',
  tool_use: 'var(--vscode-editorInfo-foreground, #2196f3)',
  waiting: 'var(--vscode-disabledForeground, #888)',
  compacting: 'var(--vscode-editorWarning-foreground, #ff5722)',
  stale: 'var(--vscode-disabledForeground, #666)',
};

const PULSE_STATUSES = new Set(['thinking', 'tool_use', 'compacting']);

interface StatusDotProps {
  status: string;
}

export function StatusDot({ status }: StatusDotProps) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.active;
  const pulse = PULSE_STATUSES.has(status);
  const hollow = status === 'stale';

  return (
    <span
      className={`status-dot ${pulse ? 'pulse' : ''}`}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: hollow ? 'transparent' : color,
        border: hollow ? `2px solid ${color}` : 'none',
      }}
    />
  );
}
```

- [ ] **Step 4: src/webview/app/components/ContextBar.tsx を作成**

```tsx
import React from 'react';

interface ContextBarProps {
  used: number;
  total: number;
}

export function ContextBar({ used, total }: ContextBarProps) {
  const percentage = total > 0 ? Math.round((used / total) * 100) : 0;

  return (
    <div className="context-bar">
      <span className="context-label">Context</span>
      <div className="context-track">
        <div
          className="context-fill"
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <span className="context-pct">{percentage}%</span>
    </div>
  );
}
```

- [ ] **Step 5: src/webview/app/components/SessionCard.tsx を作成**

```tsx
import React from 'react';
import type { Session } from '../types';
import { StatusDot } from './StatusDot';
import { ContextBar } from './ContextBar';

interface SessionCardProps {
  session: Session;
  onDismiss: (dockId: string) => void;
}

function shortenPath(p: string | null): string {
  if (!p) return '';
  return p.replace(/^\/home\/[^/]+/, '~');
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min ago`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ago`;
}

export function SessionCard({ session, onDismiss }: SessionCardProps) {
  return (
    <div className={`session-card ${session.status}`}>
      <div className="card-header">
        <div className="card-status">
          <StatusDot status={session.status} />
          <span className="status-text">{session.status}</span>
        </div>
        <span className="card-model">{session.model_display ?? session.model ?? ''}</span>
        <button
          className="dismiss-btn"
          onClick={() => onDismiss(session.dock_id)}
          title="Dismiss"
        >
          ×
        </button>
      </div>
      <div className="card-cwd">{shortenPath(session.cwd)}</div>
      <ContextBar used={session.context_used} total={session.context_total} />
      <div className="card-footer">
        <span className="card-cost">
          ${session.cost_usd.toFixed(2)}
          {' '}
          <span className="card-lines">+{session.lines_added}/-{session.lines_removed}</span>
        </span>
        <span className="card-time">{timeAgo(session.updated_at)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: src/webview/app/App.tsx を作成**

```tsx
import React from 'react';
import { useSessionStore } from './hooks/useSessionStore';
import { SessionCard } from './components/SessionCard';

export function App() {
  const { sessions, dismiss } = useSessionStore();

  if (sessions.length === 0) {
    return (
      <div className="empty-state">
        <p>No active Claude Code sessions</p>
      </div>
    );
  }

  return (
    <div className="session-list">
      {sessions.map((s) => (
        <SessionCard key={s.dock_id} session={s} onDismiss={dismiss} />
      ))}
    </div>
  );
}
```

- [ ] **Step 7: src/webview/app/index.tsx を作成**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

- [ ] **Step 8: src/webview/provider.ts を作成**

```typescript
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { ExtensionMessage, WebViewMessage } from '../shared/types';

export class SessionPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ccdock.sessionPanel';

  private view?: vscode.WebviewView;
  private onReady?: () => void;
  private onMessage?: (msg: WebViewMessage) => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    callbacks: {
      onReady: () => void;
      onMessage: (msg: WebViewMessage) => void;
    }
  ) {
    this.onReady = callbacks.onReady;
    this.onMessage = callbacks.onMessage;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: WebViewMessage) => {
      if (msg.type === 'ready') {
        this.onReady?.();
      }
      this.onMessage?.(msg);
    });
  }

  postMessage(msg: ExtensionMessage): void {
    this.view?.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js')
    );

    const nonce = crypto.randomBytes(16).toString('hex');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      padding: 0;
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .session-list { padding: 8px; }
    .session-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .card-status {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .status-text {
      font-size: 11px;
      opacity: 0.7;
    }
    .card-model {
      margin-left: auto;
      font-weight: 600;
      font-size: 12px;
    }
    .dismiss-btn {
      background: none;
      border: none;
      color: var(--vscode-disabledForeground);
      cursor: pointer;
      font-size: 16px;
      padding: 0 2px;
      line-height: 1;
    }
    .dismiss-btn:hover {
      color: var(--vscode-foreground);
    }
    .card-cwd {
      font-size: 11px;
      opacity: 0.8;
      margin-bottom: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .context-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    .context-label {
      font-size: 10px;
      opacity: 0.6;
      min-width: 42px;
    }
    .context-track {
      flex: 1;
      height: 4px;
      background: var(--vscode-progressBar-background, #333);
      border-radius: 2px;
      overflow: hidden;
    }
    .context-fill {
      height: 100%;
      background: var(--vscode-progressBar-background, #0078d4);
      border-radius: 2px;
      transition: width 0.3s ease;
    }
    .context-pct {
      font-size: 10px;
      opacity: 0.6;
      min-width: 28px;
      text-align: right;
    }
    .card-footer {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      opacity: 0.7;
    }
    .card-lines { opacity: 0.6; }
    .empty-state {
      padding: 20px;
      text-align: center;
      opacity: 0.5;
    }
    .status-dot.pulse {
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .session-card.stale { opacity: 0.5; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
```

- [ ] **Step 9: コミット**

```bash
git add src/webview/
git commit -m "feat: add WebView provider and React session card UI"
```

---

## Task 7: Extension エントリポイント（activate/deactivate）

**Files:**
- Create: `src/extension.ts`

- [ ] **Step 1: src/extension.ts を実装**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { openDatabase } from './db/database';
import { initializeSchema } from './db/schema';
import { SessionRepo } from './db/session-repo';
import { installHooks, uninstallHooks } from './hooks-installer';
import { DbPoller } from './watcher/db-poller';
import { SessionStore } from './watcher/session-store';
import { SessionPanelProvider } from './webview/provider';
import {
  DB_PATH,
  CLAUDE_SETTINGS_PATH,
  POLL_INTERVAL_MS,
  STALE_THRESHOLD_MS,
  GC_THRESHOLD_MS,
} from './constants';
import type { WebViewMessage } from './shared/types';

let poller: DbPoller | undefined;
let db: ReturnType<typeof openDatabase> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  try {
    db = openDatabase(DB_PATH);
    initializeSchema(db);
  } catch (err) {
    vscode.window.showErrorMessage(`ccdock: Failed to initialize database: ${err}`);
    return;
  }

  const repo = new SessionRepo(db);
  repo.cleanupOld(GC_THRESHOLD_MS);

  const writerPath = path.join(context.extensionPath, 'dist', 'ccdock-writer.js');
  try {
    installHooks(CLAUDE_SETTINGS_PATH, writerPath, DB_PATH);
  } catch (err) {
    vscode.window.showWarningMessage(`ccdock: Failed to install hooks: ${err}`);
  }

  let sessionStore: SessionStore | undefined;
  let provider: SessionPanelProvider | undefined;

  const sendSnapshot = () => {
    if (provider && sessionStore) {
      provider.postMessage({
        type: 'sessions:snapshot',
        sessions: sessionStore.getSnapshot(),
      });
    }
  };

  provider = new SessionPanelProvider(context.extensionUri, {
    onReady: () => sendSnapshot(),
    onMessage: (msg: WebViewMessage) => {
      if (msg.type === 'session:dismiss') {
        repo.dismiss(msg.dockId);
      }
    },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SessionPanelProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  sessionStore = new SessionStore((msg) => {
    provider?.postMessage(msg);
  });

  const fetchAndUpdate = () => {
    if (!db) return;
    const localRepo = new SessionRepo(db);
    localRepo.markStale(STALE_THRESHOLD_MS);
    const sessions = localRepo.getAll();
    sessionStore?.update(sessions);
  };

  poller = new DbPoller(fetchAndUpdate, POLL_INTERVAL_MS);
  poller.start(DB_PATH);
  fetchAndUpdate();
}

export function deactivate(): void {
  poller?.stop();

  try {
    uninstallHooks(CLAUDE_SETTINGS_PATH);
  } catch {
    // best effort
  }

  try {
    db?.close();
  } catch {
    // ignore
  }
}
```

- [ ] **Step 2: ビルドを実行**

```bash
npm run build
```

Expected: ビルド成功、dist/ にファイルが生成される

- [ ] **Step 3: コミット**

```bash
git add src/extension.ts
git commit -m "feat: add extension entry point wiring all components together"
```

---

## Task 8: ビルドとパッケージング

**Files:**
- Modify: `package.json` — scripts 最終調整
- Create: `scripts/copy-native.js` — ネイティブアドオンのコピー

- [ ] **Step 1: scripts/copy-native.js を作成**

```javascript
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');
const dest = path.join(__dirname, '..', 'dist', 'node_modules', 'better-sqlite3');

function copyRecursive(srcDir, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      if (['build', 'lib', 'prebuilds'].includes(entry.name)) {
        copyRecursive(srcPath, destPath);
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

copyRecursive(src, dest);
console.log('Copied better-sqlite3 native addon to dist/');
```

- [ ] **Step 2: package.json の scripts を更新**

build スクリプトに copy-native を追加:
```json
"build": "node esbuild.config.mjs && node scripts/copy-native.js",
"package": "npm run build && vsce package --no-dependencies"
```

- [ ] **Step 3: フルビルドを確認**

```bash
npm run build
```

Expected: dist/ にすべてのファイルが生成される

- [ ] **Step 4: コミット**

```bash
git add scripts/copy-native.js package.json
git commit -m "feat: add native addon copy script and finalize build pipeline"
```

---

## Task 9: 全テスト実行と統合確認

- [ ] **Step 1: 全テストを実行**

```bash
npm test
```

Expected: ALL PASS

- [ ] **Step 2: ビルド成功を確認**

```bash
npm run build
```

Expected: エラーなし

- [ ] **Step 3: .vsix パッケージの作成を確認**

```bash
npx @vscode/vsce package --no-dependencies
```

Expected: `ccdock-0.1.0.vsix` が生成される

- [ ] **Step 4: 生成された .vsix を VSCode にインストールして動作確認**

```bash
code --install-extension ccdock-0.1.0.vsix
```

手動確認ポイント:
1. セカンダリサイドバーに "Claude Code Dock" パネルが表示される
2. パネルを開くと "No active Claude Code sessions" が表示される
3. `~/.claude/settings.json` にフックが追加されている
4. Claude Code セッションを起動すると、カードが表示される

- [ ] **Step 5: 最終コミット**

```bash
git add -A
git commit -m "chore: final integration test and packaging verification"
```

---

## Task 10: README と GitHub Releases 準備

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `CHANGELOG.md`

- [ ] **Step 1: README.md を作成**

ccdock の概要、インストール方法、使い方、設定、ライセンスを記載。

- [ ] **Step 2: LICENSE (MIT) を作成**

- [ ] **Step 3: CHANGELOG.md を作成**

```markdown
# Changelog

## 0.1.0 (Initial Release)

- Session cards in secondary sidebar
- Real-time status tracking (active/thinking/tool_use/waiting/compacting)
- Context window usage bar
- Cost and line change tracking
- Auto hooks installation
- Ghost record cleanup
```

- [ ] **Step 4: コミット**

```bash
git add README.md LICENSE CHANGELOG.md
git commit -m "docs: add README, LICENSE, and CHANGELOG for initial release"
```

- [ ] **Step 5: GitHub Release 用のタグを作成**

```bash
git tag v0.1.0
```
