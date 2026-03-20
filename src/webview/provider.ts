import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { ExtensionMessage, WebViewMessage } from '../shared/types';

export class SessionPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ccdock.sessionPanel';
  private view?: vscode.WebviewView;
  private onReady?: () => void;
  private onMessage?: (msg: WebViewMessage) => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    callbacks: { onReady: () => void; onMessage: (msg: WebViewMessage) => void; }
  ) {
    this.onReady = callbacks.onReady;
    this.onMessage = callbacks.onMessage;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebViewMessage) => {
      if (msg.type === 'ready') { this.onReady?.(); }
      this.onMessage?.(msg);
    });
  }

  postMessage(msg: ExtensionMessage): void {
    this.view?.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js')
    );
    const nonce = crypto.randomBytes(16).toString('hex');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { padding: 0; margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
    .session-list { padding: 8px; }
    .session-card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; }
    .card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .card-status { display: flex; align-items: center; gap: 4px; }
    .status-text { font-size: 11px; opacity: 0.7; }
    .card-model { margin-left: auto; font-weight: 600; font-size: 12px; }
    .dismiss-btn { background: none; border: none; color: var(--vscode-disabledForeground); cursor: pointer; font-size: 16px; padding: 0 2px; line-height: 1; }
    .dismiss-btn:hover { color: var(--vscode-foreground); }
    .card-cwd { font-size: 11px; opacity: 0.8; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .context-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .context-label { font-size: 10px; opacity: 0.6; min-width: 42px; }
    .context-track { flex: 1; height: 4px; background: var(--vscode-progressBar-background, #333); border-radius: 2px; overflow: hidden; }
    .context-fill { height: 100%; background: var(--vscode-progressBar-background, #0078d4); border-radius: 2px; transition: width 0.3s ease; }
    .context-pct { font-size: 10px; opacity: 0.6; min-width: 28px; text-align: right; }
    .card-footer { display: flex; justify-content: space-between; font-size: 11px; opacity: 0.7; }
    .card-lines { opacity: 0.6; }
    .empty-state { padding: 20px; text-align: center; opacity: 0.5; }
    .status-dot.pulse { animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .session-card.stale { opacity: 0.5; }
    .app-root { display: flex; flex-direction: column; height: 100vh; }
    .session-list { flex: 1; overflow-y: auto; }
    .launcher-panel { position: sticky; bottom: 0; background: var(--vscode-sideBar-background); border-top: 1px solid var(--vscode-panel-border); padding: 10px 8px; }
    .launcher-dir { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
    .launcher-select { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; padding: 4px 6px; font-size: 12px; font-family: var(--vscode-font-family); }
    .launcher-remove-btn { background: none; border: none; color: var(--vscode-disabledForeground); cursor: pointer; font-size: 16px; padding: 0 4px; line-height: 1; }
    .launcher-remove-btn:hover { color: var(--vscode-errorForeground); }
    .launcher-options { display: flex; gap: 12px; margin-bottom: 8px; }
    .launcher-checkbox { display: flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; }
    .launcher-checkbox input { margin: 0; cursor: pointer; }
    .launcher-btn { width: 100%; padding: 6px 0; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; font-size: 12px; font-family: var(--vscode-font-family); cursor: pointer; }
    .launcher-btn:hover { background: var(--vscode-button-hoverBackground); }
    .launcher-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
