# Launcher Feature Design Spec

## Goal

ccdock のセカンダリサイドバー最下部に固定されたランチャーUIを追加し、ディレクトリ選択とオプション指定付きで Claude Code セッションをVSCodeターミナルから起動できるようにする。

## Architecture

既存の React WebView 内にランチャーコンポーネントを `position: sticky; bottom: 0` で固定配置する。Extension側はターミナル起動・フォルダダイアログ・カスタムパス永続化を担当し、WebViewとは `postMessage` で通信する。

## UI Structure

ランチャーパネルはWebView最下部に常時表示。上から順に:

1. **ディレクトリドロップダウン**
   - VSCodeワークスペースフォルダ（動的取得）
   - ユーザー追加パス（`globalState` から復元、× ボタンで削除可能）
   - 区切り線
   - 「+ ワークスペースを追加...」項目（選択でフォルダダイアログ発火）

2. **オプションチェックボックス**（横並び）
   - `承認スキップモード` → `--dangerously-skip-permissions`
   - `Discord接続` → `--channels plugin:discord@claude-plugins-official`

3. **起動ボタン**
   - テキスト: 「Claude Code を起動」
   - VSCodeテーマカラーのプライマリボタン

## Message Protocol

### WebView → Extension

| type | payload | description |
|------|---------|-------------|
| `launcher:launch` | `{ cwd: string, args: string[] }` | ターミナル起動要求 |
| `launcher:browse` | (none) | フォルダ選択ダイアログ要求（成功時はExtensionが直接globalStateに保存しconfigを返す） |
| `launcher:removePath` | `{ path: string }` | カスタムパス削除 |

### Extension → WebView

| type | payload | description |
|------|---------|-------------|
| `launcher:config` | `{ workspaceFolders: string[], customPaths: string[] }` | 初期データ + 更新時 |

### Type Definitions

既存の discriminated union に統合する:

```typescript
// WebView → Extension
export type WebViewMessage =
  | { type: 'session:dismiss'; dockId: string }
  | { type: 'ready' }
  | { type: 'launcher:launch'; cwd: string; args: string[] }
  | { type: 'launcher:browse' }
  | { type: 'launcher:removePath'; path: string };

// Extension → WebView
export type ExtensionMessage =
  | { type: 'sessions:snapshot'; sessions: Session[] }
  | { type: 'sessions:upsert'; session: Session }
  | { type: 'sessions:remove'; dockId: string }
  | { type: 'launcher:config'; workspaceFolders: string[]; customPaths: string[] };
```

## Data Flow

1. WebView `ready` → Extension が `launcher:config` 送信（ワークスペースフォルダ + globalState のカスタムパス）
2. 「+ ワークスペースを追加...」選択 → WebView が `launcher:browse` → Extension が `showOpenDialog` → 成功時は Extension が直接 `globalState` に保存 → `launcher:config` で最新状態を返す（キャンセル時は何もしない）
3. × ボタン → `launcher:removePath` → Extension が `globalState` 更新 → `launcher:config`
4. 起動ボタン → `launcher:launch` → Extension が `vscode.window.createTerminal()` でターミナル作成、`sendText('claude <args>')` 実行
5. ワークスペースフォルダ変更時 → Extension が `vscode.workspace.onDidChangeWorkspaceFolders` を監視 → `launcher:config` 再送信

## Message Routing

`extension.ts` の `onMessage` コールバック内で `msg.type` により分岐:
- `session:*` / `ready` → 既存処理
- `launcher:*` → `LauncherHandler` に委譲

## Terminal Launch

```typescript
const dirName = path.basename(selectedCwd);
const terminal = vscode.window.createTerminal({
  name: `Claude Code (${dirName})`,
  cwd: selectedCwd,
});
terminal.show();
terminal.sendText(`claude ${args.join(' ')}`);
```

- ターミナルはVSCodeエディタエリアに開く（デフォルト動作）
- ターミナル名にディレクトリ名を含めて複数セッションを区別

## Persistence

- **カスタムパス**: `context.globalState` に `ccdock.customPaths: string[]` として保存
- **チェックボックス状態**: 永続化しない。`--dangerously-skip-permissions` は安全性に関わるため、毎回明示的に選択させる設計判断。Discord接続も同様にリセットし一貫性を保つ。
- **選択中ディレクトリ**: 永続化しない

## Files to Create/Modify

### New Files
- `src/webview/app/components/Launcher.tsx` — ランチャーUIコンポーネント
- `src/launcher/launcher-handler.ts` — Extension側のランチャーメッセージハンドラ（globalState管理、ダイアログ、ターミナル起動）

### Modified Files
- `src/shared/types.ts` — `ExtensionMessage` / `WebViewMessage` union にランチャーバリアント追加
- `src/webview/app/App.tsx` — Launcher コンポーネント配置
- `src/webview/provider.ts` — ランチャー用CSS追加
- `src/extension.ts` — LauncherHandler 初期化、`onMessage` でのルーティング分岐、`onDidChangeWorkspaceFolders` 監視

## Error Handling

- `showOpenDialog` キャンセル → 何もしない
- 重複パス追加 → 無視（既に存在するパスは追加しない）
- ワークスペースフォルダなし → カスタムパスのみ表示（空でも「+ ワークスペースを追加...」は常時表示）

## Testing

- LauncherHandler のユニットテスト（globalState のモック、パス追加/削除/重複チェック、ターミナル起動引数の組み立て）
- メッセージ型の型安全性は TypeScript コンパイルで担保
