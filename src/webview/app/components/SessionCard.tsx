import React from 'react';
import type { Session } from '../types';
import { StatusDot } from './StatusDot';
import { ContextBar } from './ContextBar';

interface SessionCardProps {
  session: Session;
  onDismiss: (dockId: string) => void;
}

function shortenPath(p: string | null): string {
  if (!p) return '';
  return p.replace(/^\/home\/[^/]+/, '~');
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min ago`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ago`;
}

export function SessionCard({ session, onDismiss }: SessionCardProps) {
  return (
    <div className={`session-card ${session.status}`}>
      <div className="card-header">
        <div className="card-status">
          <StatusDot status={session.status} />
          <span className="status-text">{session.status}</span>
        </div>
        <span className="card-model">{session.model_display ?? session.model ?? ''}</span>
        <button className="dismiss-btn" onClick={() => onDismiss(session.dock_id)} title="Dismiss">×</button>
      </div>
      <div className="card-cwd">{shortenPath(session.cwd)}</div>
      <ContextBar used={session.context_used} total={session.context_total} />
      <div className="card-footer">
        <span className="card-cost">
          ${session.cost_usd.toFixed(2)}{' '}
          <span className="card-lines">+{session.lines_added}/-{session.lines_removed}</span>
        </span>
        <span className="card-time">{timeAgo(session.updated_at)}</span>
      </div>
    </div>
  );
}
