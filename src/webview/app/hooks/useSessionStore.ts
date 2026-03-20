import { useState, useEffect, useCallback } from 'react';
import type { Session, ExtensionMessage, WebViewMessage } from '../types';

declare const acquireVsCodeApi: () => {
  postMessage: (msg: WebViewMessage) => void;
};

let _vscode: ReturnType<typeof acquireVsCodeApi> | undefined;
function getVsCodeApi() {
  if (!_vscode) { _vscode = acquireVsCodeApi(); }
  return _vscode;
}

export function useSessionStore() {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'sessions:snapshot':
          setSessions(msg.sessions);
          break;
        case 'sessions:upsert':
          setSessions((prev) => {
            const idx = prev.findIndex((s) => s.dock_id === msg.session.dock_id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg.session;
              return next;
            }
            return [msg.session, ...prev];
          });
          break;
        case 'sessions:remove':
          setSessions((prev) => prev.filter((s) => s.dock_id !== msg.dockId));
          break;
      }
    };
    window.addEventListener('message', handler);
    getVsCodeApi().postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const dismiss = useCallback((dockId: string) => {
    getVsCodeApi().postMessage({ type: 'session:dismiss', dockId });
  }, []);

  return { sessions, dismiss };
}
