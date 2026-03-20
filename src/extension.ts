import * as vscode from 'vscode';
import * as path from 'path';
import { openDatabase } from './db/database';
import { initializeSchema } from './db/schema';
import { SessionRepo } from './db/session-repo';
import { installHooks, uninstallHooks } from './hooks-installer';
import { DbPoller } from './watcher/db-poller';
import { SessionStore } from './watcher/session-store';
import { SessionPanelProvider } from './webview/provider';
import {
  DB_PATH,
  CLAUDE_SETTINGS_PATH,
  POLL_INTERVAL_MS,
  STALE_THRESHOLD_MS,
  GC_THRESHOLD_MS,
} from './constants';
import type { WebViewMessage } from './shared/types';

let poller: DbPoller | undefined;
let db: ReturnType<typeof openDatabase> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  try {
    db = openDatabase(DB_PATH);
    initializeSchema(db);
  } catch (err) {
    vscode.window.showErrorMessage(`ccdock: Failed to initialize database: ${err}`);
    return;
  }

  const repo = new SessionRepo(db);
  repo.cleanupOld(GC_THRESHOLD_MS);

  const writerPath = path.join(context.extensionPath, 'dist', 'ccdock-writer.js');
  try {
    installHooks(CLAUDE_SETTINGS_PATH, writerPath, DB_PATH);
  } catch (err) {
    vscode.window.showWarningMessage(`ccdock: Failed to install hooks: ${err}`);
  }

  let sessionStore: SessionStore | undefined;
  let provider: SessionPanelProvider | undefined;

  const sendSnapshot = () => {
    if (provider && sessionStore) {
      provider.postMessage({
        type: 'sessions:snapshot',
        sessions: sessionStore.getSnapshot(),
      });
    }
  };

  provider = new SessionPanelProvider(context.extensionUri, {
    onReady: () => sendSnapshot(),
    onMessage: (msg: WebViewMessage) => {
      if (msg.type === 'session:dismiss') {
        repo.dismiss(msg.dockId);
      }
    },
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SessionPanelProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  sessionStore = new SessionStore((msg) => {
    provider?.postMessage(msg);
  });

  const fetchAndUpdate = () => {
    if (!db) return;
    const localRepo = new SessionRepo(db);
    localRepo.markStale(STALE_THRESHOLD_MS);
    const sessions = localRepo.getAll();
    sessionStore?.update(sessions);
  };

  poller = new DbPoller(fetchAndUpdate, POLL_INTERVAL_MS);
  poller.start(DB_PATH);
  fetchAndUpdate();
}

export function deactivate(): void {
  poller?.stop();
  try { uninstallHooks(CLAUDE_SETTINGS_PATH); } catch { /* best effort */ }
  try { db?.close(); } catch { /* ignore */ }
}
