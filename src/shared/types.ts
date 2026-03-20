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
