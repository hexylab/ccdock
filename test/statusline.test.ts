import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../src/db/schema';
import { SessionRepo } from '../src/db/session-repo';

// Import deriveProcessKey from writer (reused logic)
import { deriveProcessKey } from '../src/writer/ccdock-writer';

describe('statusline DB write', () => {
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

  it('updateMetadata writes model/cost/context for existing session', () => {
    const processKey = deriveProcessKey('/path/to/transcript.jsonl');
    repo.upsert({ process_key: processKey, session_id: 'sid-1', event: 'SessionStart', cwd: '/a' });

    repo.updateMetadata({
      process_key: processKey,
      model: 'claude-opus-4-6',
      model_display: 'Opus',
      cost_usd: 0.42,
      context_used: 15000,
      context_total: 200000,
      total_input_tokens: 10000,
      total_output_tokens: 5000,
      lines_added: 100,
      lines_removed: 50,
      version: '1.0.80',
    });

    const sessions = repo.getAll();
    expect(sessions[0].model).toBe('claude-opus-4-6');
    expect(sessions[0].model_display).toBe('Opus');
    expect(sessions[0].cost_usd).toBe(0.42);
    expect(sessions[0].context_used).toBe(15000);
    expect(sessions[0].context_total).toBe(200000);
    expect(sessions[0].lines_added).toBe(100);
    expect(sessions[0].version).toBe('1.0.80');
  });

  it('updateMetadata is no-op when session does not exist', () => {
    repo.updateMetadata({ process_key: 'nonexistent', model: 'opus' });
    expect(repo.getAll()).toHaveLength(0);
  });
});
