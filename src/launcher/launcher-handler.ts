import * as vscode from 'vscode';
import * as path from 'path';
import type { ExtensionMessage, WebViewMessage } from '../shared/types';

const CUSTOM_PATHS_KEY = 'ccdock.customPaths';

export class LauncherHandler {
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly postMessage: (msg: ExtensionMessage) => void,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.sendConfig()),
    );
  }

  handleMessage(msg: WebViewMessage): void {
    switch (msg.type) {
      case 'launcher:launch':
        this.launchTerminal(msg.cwd, msg.args);
        break;
      case 'launcher:browse':
        this.browseFolder();
        break;
      case 'launcher:removePath':
        this.removePath(msg.path);
        break;
    }
  }

  sendConfig(): void {
    this.postMessage({
      type: 'launcher:config',
      workspaceFolders: this.getWorkspaceFolders(),
      customPaths: this.getCustomPaths(),
    });
  }

  private getWorkspaceFolders(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

  private getCustomPaths(): string[] {
    return this.globalState.get<string[]>(CUSTOM_PATHS_KEY, []);
  }

  private async setCustomPaths(paths: string[]): Promise<void> {
    await this.globalState.update(CUSTOM_PATHS_KEY, paths);
  }

  private async browseFolder(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'ワークスペースを追加',
    });
    if (!result || result.length === 0) return;

    const selectedPath = result[0].fsPath;
    const current = this.getCustomPaths();
    if (!current.includes(selectedPath)) {
      await this.setCustomPaths([...current, selectedPath]);
    }
    this.sendConfig();
  }

  private async removePath(targetPath: string): Promise<void> {
    const current = this.getCustomPaths();
    await this.setCustomPaths(current.filter((p) => p !== targetPath));
    this.sendConfig();
  }

  private launchTerminal(cwd: string, args: string[]): void {
    const dirName = path.basename(cwd);
    const terminal = vscode.window.createTerminal({
      name: `Claude Code (${dirName})`,
      cwd,
      location: vscode.TerminalLocation.Editor,
    });
    const cmd = ['claude', ...args].join(' ');
    terminal.sendText(cmd);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
