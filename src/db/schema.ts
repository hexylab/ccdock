import type Database from 'better-sqlite3';

const CURRENT_VERSION = 2;

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
  2: `
    ALTER TABLE sessions ADD COLUMN transcript_path TEXT;
  `,
};

export function initializeSchema(db: Database.Database): void {
  const currentVersion = getSchemaVersion(db);
  for (let v = currentVersion + 1; v <= CURRENT_VERSION; v++) {
    const sql = MIGRATIONS[v];
    if (sql) {
      db.exec(sql);
      db
        .prepare('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)')
        .run(v, new Date().toISOString());
    }
  }
}

function getSchemaVersion(db: Database.Database): number {
  try {
    const row = db
      .prepare('SELECT MAX(version) as version FROM schema_version')
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}
