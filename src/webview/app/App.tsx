import React from 'react';
import { useSessionStore } from './hooks/useSessionStore';
import { SessionCard } from './components/SessionCard';
import { Launcher } from './components/Launcher';

export function App() {
  const { sessions, dismiss } = useSessionStore();

  return (
    <div className="app-root">
      <div className="session-list">
        {sessions.length === 0
          ? <div className="empty-state"><p>No active Claude Code sessions</p></div>
          : sessions.map((s) => (<SessionCard key={s.dock_id} session={s} onDismiss={dismiss} />))
        }
      </div>
      <Launcher />
    </div>
  );
}
