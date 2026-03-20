import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../src/db/schema';
import { SessionRepo } from '../src/db/session-repo';
import { processHookEvent } from '../src/writer/ccdock-writer';

describe('processHookEvent', () => {
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

  it('creates a new session on SessionStart', () => {
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/home/user/project',
    });
    const sessions = repo.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('active');
  });

  it('updates session status on subsequent events', () => {
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/home/user/project',
    });
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'PreToolUse',
      cwd: '/home/user/project',
    });
    const sessions = repo.getAll();
    expect(sessions[0].status).toBe('tool_use');
  });

  it('deletes session on SessionEnd', () => {
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/home/user/project',
    });
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionEnd',
      cwd: '/home/user/project',
    });
    expect(repo.getAll()).toHaveLength(0);
  });

  it('skips SubAgent events when agent_id is present', () => {
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/home/user/project',
    });
    processHookEvent(db, {
      session_id: 'sid-sub',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'PreToolUse',
      cwd: '/home/user/project',
      agent_id: 'subagent-123',
      agent_type: 'Explore',
    });
    const sessions = repo.getAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('active');
  });

  it('derives consistent process_key from transcript_path', () => {
    processHookEvent(db, {
      session_id: 'sid-1',
      transcript_path: '/path/to/transcript.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/a',
    });
    processHookEvent(db, {
      session_id: 'sid-2',
      transcript_path: '/path/to/other.jsonl',
      hook_event_name: 'SessionStart',
      cwd: '/b',
    });
    const sessions = repo.getAll();
    expect(sessions).toHaveLength(2);
  });
});
