import type { Session, ExtensionMessage } from '../shared/types';

export class SessionStore {
  private sessions: Map<string, Session> = new Map();
  private notify: (msg: ExtensionMessage) => void;

  constructor(notify: (msg: ExtensionMessage) => void) {
    this.notify = notify;
  }

  update(newSessions: Session[]): void {
    const newMap = new Map(newSessions.map((s) => [s.dock_id, s]));

    for (const dockId of this.sessions.keys()) {
      if (!newMap.has(dockId)) {
        this.notify({ type: 'sessions:remove', dockId });
      }
    }

    for (const [dockId, session] of newMap) {
      const existing = this.sessions.get(dockId);
      if (!existing || existing.updated_at !== session.updated_at || existing.status !== session.status) {
        this.notify({ type: 'sessions:upsert', session });
      }
    }

    this.sessions = newMap;
  }

  getSnapshot(): Session[] {
    return Array.from(this.sessions.values());
  }
}
