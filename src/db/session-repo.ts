import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { STATUS_MAP } from '../constants';
import type { Session } from '../shared/types';

export interface UpsertParams {
  process_key: string;
  session_id: string;
  event: string;
  cwd: string;
  transcript_path?: string;
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

export interface UpdateMetadataParams {
  process_key: string;
  model?: string | null;
  model_display?: string | null;
  cost_usd?: number | null;
  context_used?: number | null;
  context_total?: number | null;
  total_input_tokens?: number | null;
  total_output_tokens?: number | null;
  lines_added?: number | null;
  lines_removed?: number | null;
  version?: string | null;
}

export function isProcessAlive(transcriptPath: string): boolean {
  try {
    execFileSync('fuser', [transcriptPath], { timeout: 2000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export class SessionRepo {
  constructor(private db: Database.Database) {}

  upsert(params: UpsertParams): void {
    const now = new Date().toISOString();
    const status = STATUS_MAP[params.event] ?? 'active';
    const existing = this.db
      .prepare('SELECT dock_id FROM sessions WHERE process_key = ?')
      .get(params.process_key) as { dock_id: string } | undefined;

    if (existing) {
      this.db
        .prepare(`
        UPDATE sessions SET
          session_id = ?, status = ?, cwd = ?,
          transcript_path = COALESCE(?, transcript_path),
          model = COALESCE(?, model), model_display = COALESCE(?, model_display),
          cost_usd = COALESCE(?, cost_usd), context_used = COALESCE(?, context_used),
          context_total = COALESCE(?, context_total),
          total_input_tokens = COALESCE(?, total_input_tokens),
          total_output_tokens = COALESCE(?, total_output_tokens),
          lines_added = COALESCE(?, lines_added), lines_removed = COALESCE(?, lines_removed),
          version = COALESCE(?, version), updated_at = ?
        WHERE process_key = ?
      `)
        .run(
          params.session_id, status, params.cwd,
          params.transcript_path ?? null,
          params.model ?? null, params.model_display ?? null,
          params.cost_usd ?? null, params.context_used ?? null, params.context_total ?? null,
          params.total_input_tokens ?? null, params.total_output_tokens ?? null,
          params.lines_added ?? null, params.lines_removed ?? null,
          params.version ?? null, now, params.process_key,
        );
    } else {
      const dockId = randomUUID();
      this.db
        .prepare(`
        INSERT INTO sessions (
          dock_id, process_key, session_id, model, model_display, cwd,
          status, cost_usd, context_used, context_total,
          total_input_tokens, total_output_tokens, lines_added, lines_removed,
          started_at, updated_at, version, transcript_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          dockId, params.process_key, params.session_id,
          params.model ?? null, params.model_display ?? null, params.cwd,
          status, params.cost_usd ?? 0, params.context_used ?? 0, params.context_total ?? 0,
          params.total_input_tokens ?? 0, params.total_output_tokens ?? 0,
          params.lines_added ?? 0, params.lines_removed ?? 0,
          now, now, params.version ?? null, params.transcript_path ?? null,
        );
    }
  }

  getAll(): Session[] {
    return this.db
      .prepare("SELECT * FROM sessions ORDER BY CASE WHEN status = 'stale' THEN 1 ELSE 0 END, updated_at DESC")
      .all() as Session[];
  }

  deleteByProcessKey(processKey: string): void {
    this.db.prepare('DELETE FROM sessions WHERE process_key = ?').run(processKey);
  }

  dismiss(dockId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE dock_id = ?').run(dockId);
  }

  markStale(thresholdMs: number): void {
    const cutoff = new Date(Date.now() - thresholdMs).toISOString();
    const candidates = this.db
      .prepare("SELECT process_key, transcript_path FROM sessions WHERE updated_at < ? AND status != 'stale'")
      .all(cutoff) as { process_key: string; transcript_path: string | null }[];

    const now = new Date().toISOString();
    for (const row of candidates) {
      if (row.transcript_path && isProcessAlive(row.transcript_path)) {
        // プロセスが生きている → updated_at をリフレッシュ
        this.db
          .prepare('UPDATE sessions SET updated_at = ? WHERE process_key = ?')
          .run(now, row.process_key);
      } else {
        // プロセスが死んでいる or transcript_path 不明 → stale にする
        this.db
          .prepare("UPDATE sessions SET status = 'stale' WHERE process_key = ?")
          .run(row.process_key);
      }
    }
  }

  cleanupOld(thresholdMs: number): void {
    const cutoff = new Date(Date.now() - thresholdMs).toISOString();
    this.db.prepare('DELETE FROM sessions WHERE updated_at < ?').run(cutoff);
  }

  updateMetadata(params: UpdateMetadataParams): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE sessions SET
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
      params.model ?? null, params.model_display ?? null,
      params.cost_usd ?? null, params.context_used ?? null, params.context_total ?? null,
      params.total_input_tokens ?? null, params.total_output_tokens ?? null,
      params.lines_added ?? null, params.lines_removed ?? null,
      params.version ?? null, now, params.process_key,
    );
  }
}
