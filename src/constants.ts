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
