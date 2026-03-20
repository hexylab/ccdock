import React from 'react';

interface ContextBarProps { used: number; total: number; }

export function ContextBar({ used, total }: ContextBarProps) {
  const percentage = total > 0 ? Math.round((used / total) * 100) : 0;
  return (
    <div className="context-bar">
      <span className="context-label">Context</span>
      <div className="context-track">
        <div className="context-fill" style={{ width: `${Math.min(percentage, 100)}%` }} />
      </div>
      <span className="context-pct">{percentage}%</span>
    </div>
  );
}
