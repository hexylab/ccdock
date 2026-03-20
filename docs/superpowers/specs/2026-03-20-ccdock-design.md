# Claude Code Dock (ccdock) 設計仕様書

## 概要

**正式名称**: Claude Code Dock
**略称/アプリ名**: ccdock

Claude Code のセッションを VSCode のセカンダリサイドバーにカード表示して一元管理する VSCode 拡張機能。マシン上で動作するすべての Claude Code セッションの状態をリアルタイムに表示する。

## 初期リリーススコープ

1. セカンダリサイドバーにセッションカードを表示
2. カードにモデル、コンテキスト使用量（バー）、コスト、作業フォルダを表示
3. カードにセッション状態を表示（active/thinking/tool_use/waiting/compacting）
4. hooks で既存設定を壊さず情報収集
5. プロセス単位でカード管理（SubAgent 等は親に紐づけ）

### 将来スコープ（初期リリースには含めない）

- セカンダリサイドバーからの Claude Code 起動ランチャー機能
  - 起動引数のチェックボックス選択
  - 起動ディレクトリのドロップダウン選択
  - VSCode エディタ部にターミナルを表示して Claude Code を起動

---

## セクション 1: ID 管理とデータモデル

### セッション ID 体系

| ID | 説明 | 由来 |
|----|------|------|
| `dock_id` (UUID v4) | ccdock 内部のカード識別子 | ccdock-writer.js が生成 |
| `process_key` | トップレベルプロセスの識別キー | transcript_path のハッシュ |
| `session_id` | Claude Code のセッション識別子 | hooks の stdin から取得（/clear で変わる） |

### process_key の導出ロジック

hooks の stdin に含まれる情報:
- `session_id` — /clear で変わる
- `transcript_path` — プロセスごとにユニーク、/clear しても同一プロセス内では同じパスを指す
- `agent_id`, `agent_type` — SubAgent 内でのみ存在

**ルール:**
1. `agent_id` が存在する → SubAgent のイベント。**カードを作成しない**、親の `dock_id` に紐づけるか無視する
2. `agent_id` がない → トップレベルプロセス。`transcript_path` を SHA-256 ハッシュして `process_key` とする
3. 初回書き込み時に `process_key` → `dock_id` のマッピングを作成。以降は `process_key` で既存の `dock_id` を引く

### SQLite スキーマ

```sql
CREATE TABLE sessions (
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

CREATE INDEX idx_sessions_process_key ON sessions(process_key);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at);
```

### 状態遷移マッピング

| フックイベント | status 値 |
|--------------|-----------|
| SessionStart | `active` |
| UserPromptSubmit | `thinking` |
| PreToolUse | `tool_use` |
| PostToolUse / PostToolUseFailure | `thinking` |
| Stop | `waiting` (ユーザー入力待ち) |
| PreCompact | `compacting` |
| PostCompact | `active` |
| SessionEnd | → 行を DELETE |

---

## セクション 2: データフローとコンポーネント構成

### 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│  Claude Code プロセス (複数)                               │
│                                                         │
│  hooks (settings.json に登録)                             │
│    SessionStart, UserPromptSubmit, PreToolUse,           │
│    PostToolUse, Stop, PreCompact, PostCompact,           │
│    SessionEnd                                            │
│         │                                                │
│         │ stdin (JSON)                                   │
│         ▼                                                │
│  node <extension_path>/dist/ccdock-writer.js             │
│    - stdin パース                                         │
│    - SubAgent 判定 (agent_id 有無)                        │
│    - process_key 導出 (transcript_path ハッシュ)            │
│    - better-sqlite3 で INSERT/UPDATE/DELETE               │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐
│  SQLite DB           │
│  ~/.ccdock/dock.db   │
└─────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  VSCode 拡張 (ccdock)                                    │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                   │
│  │ DB Watcher   │    │ Polling      │                   │
│  │ (fs.watch    │    │ (setInterval │                   │
│  │  dock.db)    │    │  3s fallback)│                   │
│  └──────┬───────┘    └──────┬───────┘                   │
│         └────────┬──────────┘                           │
│                  ▼                                      │
│         ┌──────────────┐                                │
│         │ SessionStore │                                │
│         └──────┬───────┘                                │
│                │ postMessage                             │
│                ▼                                        │
│  ┌──────────────────────────────┐                       │
│  │ WebView (セカンダリサイドバー)   │                       │
│  │  セッションカード一覧            │                       │
│  └──────────────────────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

### コンポーネント責務

| コンポーネント | 責務 |
|-------------|------|
| **ccdock-writer.js** | hooks から呼ばれる CLI スクリプト。stdin パース、ID 管理、SQLite 書き込み。単一ファイルバンドルで高速起動 |
| **DB Watcher** | dock.db の変更を fs.watch で検知。fs.watch が信頼できない環境用にポーリング（3 秒間隔）をフォールバック |
| **SessionStore** | SQLite からセッション一覧を読み取り、メモリ上で保持。WebView に postMessage で差分通知 |
| **WebView** | React 製のカード UI。postMessage で受け取ったデータを描画 |
| **HooksInstaller** | 拡張機能 activate 時に ~/.claude/settings.json の既存 hooks 配列に追記。deactivate/アンインストール時に除去 |

---

## セクション 3: Hooks のインストールと管理

### インストールフロー

拡張機能の `activate()` 時に以下を実行:

1. `~/.claude/settings.json` を読み取り
2. 各対象イベント（SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, PreCompact, PostCompact, SessionEnd）について:
   - 既存の hooks 配列を確認
   - ccdock のエントリが既に存在するかチェック（コマンド文字列に `ccdock-writer` を含むかで判定）
   - 存在しなければ配列末尾に追加
3. 変更があった場合のみファイルを書き戻す

### hooks エントリの形式

```json
{
  "matcher": "",
  "hooks": [
    {
      "type": "command",
      "command": "node /path/to/extension/dist/ccdock-writer.js --event SessionStart --db ~/.ccdock/dock.db",
      "timeout": 10
    }
  ]
}
```

- `--event` フラグでどのイベントから呼ばれたかを明示（stdin の hook_event_name でも取得可能だが、フォールバック用）
- `--db` フラグで DB パスを指定
- `timeout` は 10 秒（書き込みは高速なので十分）

### アンインストールフロー

拡張機能の `deactivate()` 時:
1. `~/.claude/settings.json` を読み取り
2. `ccdock-writer` を含むフックエントリを除去
3. 空になった配列は維持（既存の matcher 構造を壊さない）

### 既存設定への影響最小化

- 読み取り → 変更 → 書き戻しはアトミックに行う（一時ファイル + リネーム）
- JSON のフォーマットは読み取り時のインデント設定を保持する（`JSON.stringify` の indent を 2 で統一）
- hooks の配列に追加するのみで、既存エントリの順序や内容は一切変更しない

---

## セクション 4: WebView UI 設計

### カードレイアウト

各セッションカードに表示する情報:

```
┌──────────────────────────────────┐
│ ● active       Opus        v1.0 │  ← ステータスドット + 状態 + モデル + バージョン
│                                  │
│ ~/workspace/my-project           │  ← 作業ディレクトリ（短縮表示）
│                                  │
│ Context  ████████░░░░░░░░  52%   │  ← コンテキスト使用量バー
│                                  │
│ Cost: $0.42  +156/-23 lines      │  ← コスト + 行変更数
│ 2min ago                         │  ← 最終更新からの経過時間
└──────────────────────────────────┘
```

### ステータスドットの色分け

| status | 色 | ドット |
|--------|-----|-------|
| active | 緑 | ● |
| thinking | 黄 | ● (点滅アニメーション) |
| tool_use | 青 | ● (点滅アニメーション) |
| waiting | グレー | ● |
| compacting | オレンジ | ● (点滅アニメーション) |

### カードの並び順

`updated_at` の降順（最近更新されたセッションが上）

### レスポンシブ対応

- セカンダリサイドバーの幅に応じてカードレイアウトを調整
- 狭い場合はコンパクト表示（コスト・行数を折りたたみ）

### テーマ対応

VSCode の `--vscode-*` CSS 変数を使用し、ライト/ダークテーマに自動対応。

---

## セクション 5: 拡張機能ライフサイクル

### activate()

1. `~/.ccdock/` ディレクトリの作成（存在しなければ）
2. SQLite DB の初期化（テーブル・インデックス作成）
3. hooks のインストール（セクション 3）
4. DB Watcher の開始（fs.watch + ポーリング）
5. WebView プロバイダーの登録（セカンダリサイドバー）

### deactivate()

1. DB Watcher の停止
2. hooks の除去（セクション 3）
3. SQLite 接続のクローズ

### エラーハンドリング

| シナリオ | 対応 |
|---------|------|
| settings.json のパースエラー | エラー通知を表示、hooks インストールをスキップ |
| SQLite DB の破損 | DB ファイルをリネームしてバックアップ、新規作成 |
| ccdock-writer.js の実行エラー | Claude Code 側に影響を与えない（exit 1 は非ブロックエラー） |
| fs.watch が利用不可 | ポーリングのみにフォールバック |

### ccdock-writer.js のエラーハンドリング

- hooks のスクリプトがエラーを起こしても、exit コード 0 または 1 を返せば Claude Code の動作をブロックしない
- exit コード 2 のみがブロックエラーなので、**ccdock-writer.js は絶対に exit 2 を返さない**
- try-catch で全体をラップし、エラー時は exit 1 で静かに失敗する

---

## セクション 6: 技術スタック

| 領域 | 技術 |
|------|------|
| VSCode 拡張 | TypeScript |
| WebView UI | React + TypeScript |
| ビルド | esbuild（拡張機能本体 + ccdock-writer.js + WebView すべて） |
| SQLite | better-sqlite3 |
| DB ファイルパス | ~/.ccdock/dock.db |
| パッケージマネージャ | npm |
| テスト | vitest |
| lint | ESLint |
| 公開 | GitHub Releases（.vsix）、将来的に VS Marketplace も検討 |

### ディレクトリ構成

```
ccdock/
├── package.json              # VSCode 拡張マニフェスト
├── tsconfig.json
├── esbuild.config.mjs        # ビルド設定
├── src/
│   ├── extension.ts          # activate/deactivate エントリポイント
│   ├── hooks-installer.ts    # hooks のインストール/アンインストール
│   ├── db/
│   │   ├── database.ts       # SQLite 接続・初期化
│   │   ├── schema.ts         # テーブル定義・マイグレーション
│   │   └── session-repo.ts   # セッション CRUD
│   ├── watcher/
│   │   ├── db-watcher.ts     # fs.watch + ポーリング
│   │   └── session-store.ts  # メモリ上のセッション状態管理
│   ├── webview/
│   │   ├── provider.ts       # WebviewViewProvider
│   │   └── app/              # React アプリ
│   │       ├── index.tsx
│   │       ├── App.tsx
│   │       ├── components/
│   │       │   ├── SessionCard.tsx
│   │       │   ├── ContextBar.tsx
│   │       │   └── StatusDot.tsx
│   │       └── types.ts
│   └── writer/
│       └── ccdock-writer.ts  # hooks から呼ばれる CLI スクリプト
├── test/
│   ├── writer.test.ts
│   ├── hooks-installer.test.ts
│   ├── session-repo.test.ts
│   └── db-watcher.test.ts
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-03-20-ccdock-design.md
```

---

## セクション 7: 将来の拡張性

### ランチャー機能への対応

初期アーキテクチャで以下を考慮:

- **WebView ↔ Extension 間の postMessage プロトコル**を拡張可能な形で設計する（メッセージタイプで分岐）
- **sessions テーブル**はランチャー機能で追加カラムが必要になる可能性がある（例: 起動引数、起動元）ため、マイグレーション機構を用意する
- **WebView のコンポーネント構成**はカードリストとランチャーパネルを分離可能な構造にしておく

### postMessage プロトコル

```typescript
// Extension → WebView
type ExtensionMessage =
  | { type: 'sessions:update'; sessions: Session[] }
  | { type: 'sessions:remove'; dockId: string }

// WebView → Extension (将来のランチャー機能用)
type WebViewMessage =
  | { type: 'launch:start'; config: LaunchConfig }
  | { type: 'session:focus'; dockId: string }
```
