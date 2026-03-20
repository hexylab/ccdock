# Claude Code Hooks & Status Line 仕様リファレンス

> このドキュメントは公式ドキュメント + 実機検証に基づく。ccdock 開発時の仕様認識誤りを防ぐために維持する。

## 重要な事実

1. **hooks の stdin にはコスト・コンテキスト情報は含まれない**（実機検証済み）
2. **コスト・コンテキスト・モデル情報はステータスラインのみで取得可能**
3. **ステータスラインは単一コマンドのみ**（配列ではない。既存設定を上書きするリスクあり）
4. hooks とステータスラインは完全に独立したシステム

---

## 1. Hooks System

### 全イベント共通の stdin フィールド

```json
{
  "session_id": "unique-session-id",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "permission_mode": "default|plan|acceptEdits|dontAsk|bypassPermissions",
  "hook_event_name": "EventName"
}
```

### イベント別の追加フィールド（実機検証済み）

#### PreToolUse

```json
{
  "tool_name": "Bash|Write|Edit|Read|Glob|Grep|Agent|...",
  "tool_input": { /* ツール固有の入力 */ },
  "tool_use_id": "toolu_xxx"
}
```

#### PostToolUse

```json
{
  "tool_name": "Bash",
  "tool_input": { /* ツール固有の入力 */ },
  "tool_response": {
    "stdout": "...",
    "stderr": "...",
    "interrupted": false,
    "isImage": false,
    "noOutputExpected": false
  },
  "tool_use_id": "toolu_xxx"
}
```

#### PostToolUseFailure

```json
{
  "tool_name": "...",
  "tool_input": { /* */ },
  "tool_result": "error message",
  "tool_result_success": false
}
```

#### SessionStart

```json
{
  "source": "startup|resume|clear|compact"
}
```

#### SessionEnd

```json
{
  "reason": "clear|resume|logout|prompt_input_exit|bypass_permissions_disabled|other"
}
```

#### UserPromptSubmit

```json
{
  "user_prompt": "text of the prompt"
}
```

#### Stop

```json
{
  "stop_hook_active": false
}
```

**重要: Stop イベントにコスト・コンテキスト・モデル情報は含まれない。**

#### StopFailure

```json
{
  "error_type": "rate_limit|authentication_failed|billing_error|invalid_request|server_error|max_output_tokens|unknown"
}
```

#### SubagentStart

```json
{
  "agent_id": "unique-agent-id",
  "agent_type": "Bash|Explore|Plan|CustomAgentName",
  "agent_prompt": "the prompt sent to the subagent"
}
```

#### SubagentStop

```json
{
  "agent_id": "unique-agent-id",
  "agent_type": "agent type",
  "agent_result": "what the subagent produced"
}
```

#### PreCompact

```json
{
  "trigger": "manual|auto"
}
```

#### PostCompact

```json
{
  "trigger": "manual|auto",
  "tokens_freed": 12345
}
```

#### Notification

```json
{
  "notification_type": "permission_prompt|idle_prompt|auth_success|elicitation_dialog"
}
```

#### PermissionRequest

```json
{
  "tool_name": "Bash|ExitPlanMode|etc",
  "permission_prompt": "description of what Claude wants to do"
}
```

### Exit Code の挙動

| Exit Code | 挙動 |
|-----------|------|
| 0 | 成功。stdout にテキストがあればコンテキストに追加。JSON があればパース |
| 2 | ブロック。stderr がエラーメッセージとして Claude にフィードバック |
| その他 | 非ブロックエラー。stderr は verbose モードでログ表示。実行は継続 |

### hooks 設定の構造 (settings.json)

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "path/to/script.sh",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

- 各イベントの値は配列で、複数のフックエントリを持てる
- `matcher` は正規表現でフィルタリング可能（PreToolUse のツール名等）
- 同一イベントの複数フックは並列実行

---

## 2. Status Line System

### 設定方法 (settings.json)

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 2
  }
}
```

**重要: 単一コマンドのみ。配列ではない。既存設定を置き換える形になる。**

### stdin JSON の完全スキーマ

```json
{
  "cwd": "/current/working/directory",
  "session_id": "abc123...",
  "transcript_path": "/path/to/transcript.jsonl",
  "version": "1.0.80",

  "model": {
    "id": "claude-opus-4-6",
    "display_name": "Opus"
  },

  "workspace": {
    "current_dir": "/current/working/directory",
    "project_dir": "/original/project/directory"
  },

  "cost": {
    "total_cost_usd": 0.01234,
    "total_duration_ms": 45000,
    "total_api_duration_ms": 2300,
    "total_lines_added": 156,
    "total_lines_removed": 23
  },

  "context_window": {
    "total_input_tokens": 15234,
    "total_output_tokens": 4521,
    "context_window_size": 200000,
    "used_percentage": 8,
    "remaining_percentage": 92,
    "current_usage": {
      "input_tokens": 8500,
      "output_tokens": 1200,
      "cache_creation_input_tokens": 5000,
      "cache_read_input_tokens": 2000
    }
  },

  "exceeds_200k_tokens": false,

  "output_style": {
    "name": "default"
  },

  "vim": {
    "mode": "NORMAL"
  },

  "agent": {
    "name": "security-reviewer"
  },

  "worktree": {
    "name": "my-feature",
    "path": "/path/to/.claude/worktrees/my-feature",
    "branch": "worktree-my-feature",
    "original_cwd": "/path/to/project",
    "original_branch": "main"
  }
}
```

### 条件付きフィールド

| フィールド | 存在条件 |
|-----------|---------|
| `vim` | vim モード有効時のみ |
| `agent` | `--agent` フラグ使用時のみ |
| `worktree` | `--worktree` セッション中のみ |
| `context_window.current_usage` | 初回 API 呼び出し前は `null` |

### 更新タイミング

- 各アシスタントメッセージの後
- 権限モード変更時
- vim モード切り替え時
- 300ms デバウンス（連続変更は統合）
- 実行中のスクリプトは新しい更新でキャンセル

### 出力

- 複数行サポート（`echo` 1 行 = 表示 1 行）
- ANSI カラーサポート
- OSC 8 ハイパーリンクサポート
- API トークンを消費しない（ローカル実行）

---

## 3. ccdock への影響と設計方針

### hooks から取得可能な情報

| 情報 | 取得可否 | 取得元イベント |
|------|---------|--------------|
| session_id | ✅ | 全イベント |
| transcript_path | ✅ | 全イベント |
| cwd | ✅ | 全イベント |
| ステータス変化 | ✅ | イベント種別から導出 |
| SubAgent 判定 | ✅ | SubagentStart/Stop の agent_id |
| tool_name | ✅ | PreToolUse/PostToolUse |
| モデル情報 | ❌ | hooks には含まれない |
| コスト情報 | ❌ | hooks には含まれない |
| コンテキスト使用量 | ❌ | hooks には含まれない |
| バージョン | ❌ | hooks には含まれない |

### ステータスラインから取得可能な情報

| 情報 | 取得可否 |
|------|---------|
| モデル (id, display_name) | ✅ |
| コスト (total_cost_usd, duration, lines) | ✅ |
| コンテキスト (used_percentage, tokens) | ✅ |
| バージョン | ✅ |
| session_id | ✅ |
| cwd | ✅ |

### 課題: ステータスラインは単一コマンド

ステータスラインは `settings.json` に 1 つしか設定できない。ユーザーが既にステータスライン（例: `ccstatusline`）を使っている場合、ccdock がそれを置き換えることはできない。

**解決策の候補:**
1. **ラッパースクリプト**: ccdock のスクリプトが既存コマンドをサブプロセスとして呼び出し、その出力をそのまま表示しつつ、stdin JSON を DB に書き込む
2. **既存コマンドの検出と保存**: インストール時に既存の statusLine 設定を記録し、ccdock のスクリプト内で呼び出す
3. **hooks のみで運用**: コスト・コンテキスト情報の表示を諦める（ステータス表示のみ）
