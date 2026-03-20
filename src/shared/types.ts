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
  transcript_path: string | null;
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
  | { type: 'sessions:remove'; dockId: string }
  | { type: 'launcher:config'; workspaceFolders: string[]; customPaths: string[] };

// WebView → Extension
export type WebViewMessage =
  | { type: 'session:dismiss'; dockId: string }
  | { type: 'ready' }
  | { type: 'launcher:launch'; cwd: string; args: string[] }
  | { type: 'launcher:browse' }
  | { type: 'launcher:removePath'; path: string };

export interface StatusLineStdinData {
  cwd: string;
  session_id: string;
  transcript_path: string;
  version?: string;
  model?: {
    id: string;
    display_name: string;
  };
  cost?: {
    total_cost_usd: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
  context_window?: {
    total_input_tokens: number;
    total_output_tokens: number;
    context_window_size: number;
    used_percentage?: number;
  };
  [key: string]: unknown;
}
