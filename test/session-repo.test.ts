import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../src/db/schema';
import { SessionRepo } from '../src/db/session-repo';
import type { Session } from '../src/shared/types';

describe('SessionRepo', () => {
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

  it('upsert inserts a new session on SessionStart', () => {
    repo.upsert({
      process_key: 'pk-1',
      session_id: 'sid-1',
      event: 'SessionStart',
      cwd: '/home/user/project',
    });
    const sessions = repo.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].process_key).toBe('pk-1');
    expect(sessions[0].status).toBe('active');
    expect(sessions[0].cwd).toBe('/home/user/project');
    expect(sessions[0].dock_id).toBeTruthy();
  });

  it('upsert updates existing session on subsequent events', () => {
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'SessionStart', cwd: '/home/user/project' });
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'UserPromptSubmit', cwd: '/home/user/project' });
    const sessions = repo.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('thinking');
  });

  it('upsert updates session_id on /clear (same process_key, new session_id)', () => {
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'SessionStart', cwd: '/home/user/project' });
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-2', event: 'SessionStart', cwd: '/home/user/project' });
    const sessions = repo.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session_id).toBe('sid-2');
    expect(sessions[0].status).toBe('active');
  });

  it('deleteByProcessKey removes session on SessionEnd', () => {
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'SessionStart', cwd: '/home/user/project' });
    repo.deleteByProcessKey('pk-1');
    expect(repo.getAll()).toHaveLength(0);
  });

  it('getAll returns sessions ordered by updated_at desc', () => {
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'SessionStart', cwd: '/a' });
    repo.upsert({ process_key: 'pk-2', session_id: 'sid-2', event: 'SessionStart', cwd: '/b' });
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'Stop', cwd: '/a' });
    const sessions = repo.getAll();
    expect(sessions[0].process_key).toBe('pk-1');
    expect(sessions[1].process_key).toBe('pk-2');
  });

  it('markStale marks old sessions as stale', () => {
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'SessionStart', cwd: '/a' });
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.prepare('UPDATE sessions SET updated_at = ? WHERE process_key = ?').run(tenMinAgo, 'pk-1');
    repo.markStale(5 * 60 * 1000);
    const sessions = repo.getAll();
    expect(sessions[0].status).toBe('stale');
  });

  it('cleanupOld removes sessions older than threshold', () => {
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'SessionStart', cwd: '/a' });
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE sessions SET updated_at = ? WHERE process_key = ?').run(dayAgo, 'pk-1');
    repo.cleanupOld(24 * 60 * 60 * 1000);
    expect(repo.getAll()).toHaveLength(0);
  });

  it('dismiss removes a session by dock_id', () => {
    repo.upsert({ process_key: 'pk-1', session_id: 'sid-1', event: 'SessionStart', cwd: '/a' });
    const sessions = repo.getAll();
    repo.dismiss(sessions[0].dock_id);
    expect(repo.getAll()).toHaveLength(0);
  });
});
