import React from 'react';
import { useSessionStore } from './hooks/useSessionStore';
import { SessionCard } from './components/SessionCard';

export function App() {
  const { sessions, dismiss } = useSessionStore();

  if (sessions.length === 0) {
    return (<div className="empty-state"><p>No active Claude Code sessions</p></div>);
  }

  return (
    <div className="session-list">
      {sessions.map((s) => (<SessionCard key={s.dock_id} session={s} onDismiss={dismiss} />))}
    </div>
  );
}
