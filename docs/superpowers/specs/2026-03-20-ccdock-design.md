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

## 前提条件と検証事項

### hooks stdin JSON のフィールド

実装前に各イベントの stdin JSON を実機ダンプして以下を検証すること:

| フィールド | 想定 | 検証状態 |
|-----------|------|---------|
| `session_id` | 全イベントに存在。/clear で変わる | 要検証 |
| `transcript_path` | 全イベントに存在。プロセスごとにユニーク | 要検証 |
| `hook_event_name` | 全イベントに存在 | 要検証 |
| `cwd` | 全イベントに存在 | 要検証 |
| `agent_id` / `agent_type` | SubAgent 時のみ存在する可能性 | **要検証（Critical）** |
| コスト・コンテキスト情報 | Stop イベント等で取得できるか | 要検証 |

**検証方法**: 各イベントに `cat > /tmp/ccdock-debug-$HOOK_EVENT.json` のようなダンプフックを一時的に設定し、実際の JSON を収集する。

### SubAgent の判定方式（Critical）

`agent_id` フィールドが hooks stdin に含まれない場合の代替方式:

1. **`session_id` の変化パターン**: 同一 `transcript_path` で `session_id` が異なる場合、SubAgent の可能性がある
2. **`transcript_path` の重複**: SubAgent が親と同じ `transcript_path` を持つ場合、status の上書きが発生する。この場合は status 更新時にタイムスタンプ比較で最新のみ採用する
3. **最終手段**: SubAgent の検出が困難な場合、全イベントを同一カードに反映する方式で割り切る（SubAgent のツール実行も親カードに表示）

実装フェーズで検証結果に基づいて最適な方式を選択する。

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
- `hook_event_name` — イベント種別

**ルール:**
1. `transcript_path` を SHA-256 ハッシュして `process_key` とする
2. 初回書き込み時（SessionStart）に `process_key` → `dock_id` のマッピングを作成
3. 以降のイベントは `process_key` で既存の `dock_id` を引いて UPDATE
4. SubAgent の判定は前提条件セクションの検証結果に基づいて実装時に決定

### SQLite スキーマ

```sql
-- DB を WAL モードで開く
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;

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

-- スキーマバージョン管理（将来のマイグレーション用）
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
```

### 同時書き込みの安全性

- **WAL (Write-Ahead Logging) モード**: 複数プロセスからの同時読み書きをサポート
- **busy_timeout=5000**: 他プロセスがロック中の場合、最大 5 秒待機
- **接続パターン**: ccdock-writer.js は DB 接続を開く → 書き込み → 即座に閉じる（長時間の接続保持を避ける）

### 状態遷移マッピング

| フックイベント | status 値 | 補足 |
|--------------|-----------|------|
| SessionStart | `active` | 新規レコード INSERT または既存レコードの status リセット |
| UserPromptSubmit | `thinking` | ユーザーがプロンプト送信、LLM 処理開始 |
| PreToolUse | `tool_use` | ツール実行中 |
| PostToolUse / PostToolUseFailure | `thinking` | ツール完了後、LLM が次の応答を生成中 |
| Stop | `waiting` | LLM 応答完了、ユーザー入力待ち |
| PreCompact | `compacting` | コンテキストコンパクション中 |
| PostCompact | `thinking` | コンパクション後、LLM 応答が継続する可能性がある |
| SessionEnd | → 行を DELETE | プロセス終了 |

### データフィールドの取得元マッピング

各カラムがどのイベントの stdin から更新されるかを定義する。
（注: 以下は想定であり、実機検証で確認が必要）

| カラム | 更新元イベント | stdin JSON フィールド |
|-------|--------------|---------------------|
| session_id | 全イベント | `session_id` |
| cwd | 全イベント | `cwd` |
| model / model_display | Stop | 要検証（stdin に含まれない可能性あり） |
| status | 全イベント | イベント種別から導出 |
| cost_usd | Stop | 要検証 |
| context_used / context_total | Stop | 要検証 |
| total_input_tokens / total_output_tokens | Stop | 要検証 |
| lines_added / lines_removed | Stop | 要検証 |
| version | SessionStart | 要検証 |

**注意**: hooks stdin にコスト・コンテキスト情報が含まれない場合の代替手段:
- ステータスラインスクリプトに渡される JSON にはこれらの情報が含まれる
- statusLine 用のスクリプトを追加し、そこから DB に書き込む方式も検討する

### ゴーストレコードの清掃

Claude Code プロセスがクラッシュまたは kill -9 された場合、SessionEnd フックは発火しない。ゴーストレコードへの対策:

1. **activate 時のクリーンアップ**: `updated_at` が 24 時間以上前のレコードを DELETE
2. **ポーリング時の stale 検出**: `updated_at` が 5 分以上更新されていないレコードの status を `stale` に変更し、UI でグレーアウト表示
3. **カードの手動 dismiss**: ユーザーがカードの × ボタンで手動削除できる機能を WebView に実装

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
│    - process_key 導出 (transcript_path ハッシュ)            │
│    - better-sqlite3 で INSERT/UPDATE/DELETE               │
│    - エラー時は常に exit 0（Claude Code をブロックしない）     │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────┐
│  SQLite DB (WAL)     │
│  ~/.ccdock/dock.db   │
└─────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  VSCode 拡張 (ccdock)                                    │
│                                                         │
│  ┌───────────────────────────────────┐                  │
│  │ DB Poller (setInterval 1s)        │  ← プライマリ     │
│  │ + fs.watch(dock.db, dock.db-wal)  │  ← ヒント        │
│  └──────────────┬────────────────────┘                  │
│                  ▼                                      │
│         ┌──────────────┐                                │
│         │ SessionStore │  diff検出 → 変更分のみ通知       │
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
| **ccdock-writer.js** | hooks から呼ばれる CLI スクリプト。stdin パース、ID 管理、SQLite 書き込み。esbuild で単一ファイルバンドル（better-sqlite3 の .node は external）。**全エラーを catch し常に exit 0** |
| **DB Poller** | 1 秒間隔のポーリングをプライマリとし、fs.watch（dock.db + dock.db-wal）をヒントとして併用。変更検知時に SessionStore に通知 |
| **SessionStore** | SQLite からセッション一覧を SELECT し、前回との diff を算出。追加・更新・削除を個別に WebView に postMessage |
| **WebView** | React 製のカード UI。postMessage で受け取った差分データを描画 |
| **HooksInstaller** | 拡張機能 activate 時に ~/.claude/settings.json の既存 hooks 配列に追記。アンインストール時に除去 |

---

## セクション 3: Hooks のインストールと管理

### hooks 設定の正しい構造

Claude Code の settings.json における hooks の構造:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "existing-hook-command"
          }
        ]
      },
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/ccdock-writer.js --event SessionStart --db ~/.ccdock/dock.db",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

各イベントキーの値は matcher + hooks の配列。ccdock はこの配列に新しいエントリを追加する。

### インストールフロー

拡張機能の `activate()` 時に以下を実行:

1. `~/.claude/settings.json` を読み取り
2. 各対象イベント（SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, PreCompact, PostCompact, SessionEnd）について:
   - `hooks[eventName]` 配列を確認
   - ccdock のエントリが既に存在するかチェック（コマンド文字列に `ccdock-writer` を含むかで判定）
   - 存在しなければ配列末尾に新しいエントリを追加
   - 配列が存在しなければ新規作成
3. 変更があった場合のみファイルを書き戻す

### hooks コマンドのガード

hooks コマンドは拡張機能がアンインストールされた後にスクリプトが存在しない状態になりうるため、ガード付きで登録する:

```bash
node /path/to/ccdock-writer.js --event SessionStart --db ~/.ccdock/dock.db 2>/dev/null || true
```

`|| true` により、スクリプトが存在しない場合やエラー時でも Claude Code に影響を与えない。

### アンインストール対策

`deactivate()` は確実に呼ばれる保証がないため、多層防御で対応:

1. **deactivate() 時**: `~/.claude/settings.json` から `ccdock-writer` を含むフックエントリを除去（ベストエフォート）
2. **package.json の extensionUninstall**: アンインストール用スクリプトを登録し、hooks 除去を実行
3. **コマンドのガード**: `|| true` により、拡張機能削除後もエラーが出ない
4. **activate() 時のセルフヒーリング**: 前回の deactivate で hooks 除去に失敗していた場合、パスが古い（存在しない）エントリを検出して更新する

### 既存設定への影響最小化

- 読み取り → 変更 → 書き戻しはアトミックに行う（一時ファイル + リネーム）
- JSON のフォーマットは `JSON.stringify` の indent 2 で統一
- hooks の配列に追加するのみで、既存エントリの順序や内容は一切変更しない

---

## セクション 4: WebView UI 設計

### カードレイアウト

各セッションカードに表示する情報:

```
┌──────────────────────────────────┐
│ ● active       Opus             │  ← ステータスドット + 状態 + モデル
│                                  │
│ ~/workspace/my-project           │  ← 作業ディレクトリ（短縮表示）
│                                  │
│ Context  ████████░░░░░░░░  52%   │  ← コンテキスト使用量バー
│                                  │
│ Cost: $0.42  +156/-23 lines      │  ← コスト + 行変更数
│ 2min ago                      ×  │  ← 最終更新からの経過時間 + dismiss ボタン
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
| stale | 薄グレー | ○ (中抜き) |

### カードの並び順

`updated_at` の降順（最近更新されたセッションが上）。stale なカードは最下部。

### レスポンシブ対応

- セカンダリサイドバーの幅に応じてカードレイアウトを調整
- 狭い場合はコンパクト表示（コスト・行数を折りたたみ）

### テーマ対応

VSCode の `--vscode-*` CSS 変数を使用し、ライト/ダークテーマに自動対応。

---

## セクション 5: 拡張機能ライフサイクル

### activate()

1. `~/.ccdock/` ディレクトリの作成（存在しなければ）
2. SQLite DB の初期化（PRAGMA 設定、テーブル・インデックス作成、マイグレーション実行）
3. ゴーストレコードのクリーンアップ（updated_at が 24 時間以上前のレコードを DELETE）
4. hooks のインストール（セクション 3、セルフヒーリング含む）
5. DB Poller の開始（1 秒ポーリング + fs.watch ヒント）
6. WebView プロバイダーの登録（セカンダリサイドバー）

### deactivate()

1. DB Poller の停止
2. hooks の除去（ベストエフォート）
3. SQLite 接続のクローズ

### エラーハンドリング

| シナリオ | 対応 |
|---------|------|
| settings.json のパースエラー | エラー通知を表示、hooks インストールをスキップ |
| SQLite DB の破損 | DB ファイルをリネームしてバックアップ、新規作成 |
| ccdock-writer.js の実行エラー | Claude Code 側に影響なし（`|| true` ガード + exit 0） |
| fs.watch が利用不可 | ポーリングのみで動作（fs.watch はヒントなので問題なし） |

### ccdock-writer.js のエラーハンドリング

- **全エラーを catch し常に exit 0 で終了する**
- PreToolUse を含む全イベントのフックとして登録されるため、exit 0 以外を返すと Claude Code のツール実行をブロックするリスクがある
- エラー発生時は `~/.ccdock/error.log` にログを記録し、exit 0 で終了
- コマンド自体も `|| true` でガードされているため二重の安全策

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

### better-sqlite3 のネイティブアドオン配布

better-sqlite3 は C++ ネイティブアドオン（`.node` ファイル）を含む。以下の方式で対応:

1. **esbuild の external 設定**: `better-sqlite3` を external として除外し、バンドルに含めない
2. **ネイティブアドオンの同梱**: プラットフォームごとのプリビルドバイナリ（`.node` ファイル）を `dist/` にコピー
3. **ccdock-writer.js のモジュール解決**: バンドル後のスクリプトから `better-sqlite3` を解決できるよう、`NODE_PATH` またはランタイムの `require` パスを設定
4. **VSCode の Node.js とシステム Node.js の ABI 互換性**: ccdock-writer.js はシステムの Node.js で実行されるため、`npm rebuild` で正しい ABI のバイナリを生成。`@mapbox/node-pre-gyp` または `prebuild-install` で複数プラットフォーム対応

**代替案（実装時に検証して決定）**:
- better-sqlite3 の代わりに **sql.js**（WASM ベース）を使用する。ネイティブアドオン不要でクロスプラットフォーム対応が容易。ただし WAL モードが使えないため、ファイルロックによる排他制御が必要
- 最終的な技術選定は PoC フェーズで検証する

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
│   │   ├── database.ts       # SQLite 接続・初期化・PRAGMA 設定
│   │   ├── schema.ts         # テーブル定義・マイグレーション
│   │   └── session-repo.ts   # セッション CRUD
│   ├── watcher/
│   │   ├── db-poller.ts      # ポーリング + fs.watch ヒント
│   │   └── session-store.ts  # メモリ上のセッション状態管理・diff 算出
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
│   └── db-poller.test.ts
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
- **sessions テーブル**はランチャー機能で追加カラムが必要になる可能性がある（例: 起動引数、起動元）ため、schema_version テーブルによるマイグレーション機構を用意する
- **WebView のコンポーネント構成**はカードリストとランチャーパネルを分離可能な構造にしておく

### postMessage プロトコル

```typescript
// Extension → WebView
type ExtensionMessage =
  | { type: 'sessions:snapshot'; sessions: Session[] }   // 初回ロード時の全件送信
  | { type: 'sessions:upsert'; session: Session }        // 追加または更新
  | { type: 'sessions:remove'; dockId: string }          // 削除

// WebView → Extension
type WebViewMessage =
  | { type: 'session:dismiss'; dockId: string }          // カードの手動削除
  | { type: 'ready' }                                    // WebView 初期化完了
  // 将来のランチャー機能用
  | { type: 'launch:start'; config: LaunchConfig }
  | { type: 'session:focus'; dockId: string }
```

SessionStore は前回と今回の SELECT 結果を比較し、追加・更新・削除を個別のメッセージとして WebView に送信する。WebView 初回ロード時は `sessions:snapshot` で全件送信。
