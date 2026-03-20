import React from 'react';

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--vscode-testing-iconPassed, #4caf50)',
  thinking: 'var(--vscode-editorWarning-foreground, #ff9800)',
  tool_use: 'var(--vscode-editorInfo-foreground, #2196f3)',
  waiting: 'var(--vscode-disabledForeground, #888)',
  compacting: 'var(--vscode-editorWarning-foreground, #ff5722)',
  stale: 'var(--vscode-disabledForeground, #666)',
};

const PULSE_STATUSES = new Set(['thinking', 'tool_use', 'compacting']);

interface StatusDotProps { status: string; }

export function StatusDot({ status }: StatusDotProps) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.active;
  const pulse = PULSE_STATUSES.has(status);
  const hollow = status === 'stale';

  return (
    <span
      className={`status-dot ${pulse ? 'pulse' : ''}`}
      style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        backgroundColor: hollow ? 'transparent' : color,
        border: hollow ? `2px solid ${color}` : 'none',
      }}
    />
  );
}
