import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStore } from '../src/watcher/session-store';
import type { Session } from '../src/shared/types';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    dock_id: 'dock-1', process_key: 'pk-1', session_id: 'sid-1',
    model: 'claude-opus-4-6', model_display: 'Opus', cwd: '/home/user',
    status: 'active', cost_usd: 0, context_used: 0, context_total: 200000,
    total_input_tokens: 0, total_output_tokens: 0,
    lines_added: 0, lines_removed: 0,
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    version: '1.0.0', ...overrides,
  };
}

describe('SessionStore', () => {
  let store: SessionStore;
  let messages: Array<{ type: string; [key: string]: unknown }>;

  beforeEach(() => {
    messages = [];
    store = new SessionStore((msg) => messages.push(msg as never));
  });

  it('emits upsert for new sessions', () => {
    store.update([makeSession()]);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('sessions:upsert');
  });

  it('emits upsert for changed sessions', () => {
    store.update([makeSession()]);
    messages.length = 0;
    store.update([makeSession({ status: 'thinking', updated_at: new Date().toISOString() })]);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('sessions:upsert');
  });

  it('does not emit for unchanged sessions', () => {
    const session = makeSession();
    store.update([session]);
    messages.length = 0;
    store.update([session]);
    expect(messages).toHaveLength(0);
  });

  it('emits remove for deleted sessions', () => {
    store.update([makeSession()]);
    messages.length = 0;
    store.update([]);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('sessions:remove');
  });

  it('getSnapshot returns current sessions', () => {
    const s = makeSession();
    store.update([s]);
    expect(store.getSnapshot()).toEqual([s]);
  });
});
