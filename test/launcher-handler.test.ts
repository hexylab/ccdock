import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ExtensionMessage } from '../src/shared/types';

// Mock vscode module
vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [
      { uri: { fsPath: '/home/user/project-a' } },
      { uri: { fsPath: '/home/user/project-b' } },
    ],
    onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  },
  window: {
    showOpenDialog: vi.fn(),
    createTerminal: vi.fn(() => ({
      show: vi.fn(),
      sendText: vi.fn(),
    })),
  },
}));

import * as vscode from 'vscode';
import { LauncherHandler } from '../src/launcher/launcher-handler';

function createMockGlobalState(initial: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: <T>(key: string, defaultValue?: T): T => (store.get(key) as T) ?? defaultValue!,
    update: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    keys: () => [...store.keys()],
    setKeysForSync: vi.fn(),
  };
}

describe('LauncherHandler', () => {
  let handler: LauncherHandler;
  let posted: ExtensionMessage[];
  let globalState: ReturnType<typeof createMockGlobalState>;

  beforeEach(() => {
    posted = [];
    globalState = createMockGlobalState();
    handler = new LauncherHandler(globalState, (msg) => posted.push(msg));
  });

  it('sendConfig returns workspace folders and custom paths', () => {
    handler.sendConfig();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      type: 'launcher:config',
      workspaceFolders: ['/home/user/project-a', '/home/user/project-b'],
      customPaths: [],
    });
  });

  it('removePath removes a custom path and sends updated config', async () => {
    globalState.update('ccdock.customPaths', ['/tmp/foo', '/tmp/bar']);
    posted = [];

    handler.handleMessage({ type: 'launcher:removePath', path: '/tmp/foo' });
    await vi.waitFor(() => expect(posted).toHaveLength(1));

    expect(globalState.update).toHaveBeenCalledWith('ccdock.customPaths', ['/tmp/bar']);
    expect((posted[0] as Extract<ExtensionMessage, { type: 'launcher:config' }>).customPaths).toEqual(['/tmp/bar']);
  });

  it('launch creates terminal with correct name and command', () => {
    const mockTerminal = { show: vi.fn(), sendText: vi.fn() };
    vi.mocked(vscode.window.createTerminal).mockReturnValue(mockTerminal as any);

    handler.handleMessage({
      type: 'launcher:launch',
      cwd: '/home/user/project-a',
      args: ['--dangerously-skip-permissions'],
    });

    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: 'Claude Code (project-a)',
      cwd: '/home/user/project-a',
    });
    expect(mockTerminal.show).toHaveBeenCalled();
    expect(mockTerminal.sendText).toHaveBeenCalledWith('claude --dangerously-skip-permissions');
  });

  it('browse adds selected folder to custom paths', async () => {
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      { fsPath: '/tmp/new-project' } as any,
    ]);

    handler.handleMessage({ type: 'launcher:browse' });
    // Wait for async showOpenDialog
    await vi.waitFor(() => expect(posted).toHaveLength(1));

    expect(globalState.update).toHaveBeenCalledWith('ccdock.customPaths', ['/tmp/new-project']);
    expect((posted[0] as Extract<ExtensionMessage, { type: 'launcher:config' }>).customPaths).toEqual(['/tmp/new-project']);
  });

  it('browse does not add duplicate paths', async () => {
    globalState.update('ccdock.customPaths', ['/tmp/new-project']);
    posted = [];

    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      { fsPath: '/tmp/new-project' } as any,
    ]);

    handler.handleMessage({ type: 'launcher:browse' });
    await vi.waitFor(() => expect(posted).toHaveLength(1));

    // Should still be just one path
    expect((posted[0] as Extract<ExtensionMessage, { type: 'launcher:config' }>).customPaths).toEqual(['/tmp/new-project']);
  });

  it('browse does nothing on cancel', async () => {
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined as any);

    handler.handleMessage({ type: 'launcher:browse' });
    // Give it time to process
    await new Promise((r) => setTimeout(r, 50));

    expect(posted).toHaveLength(0);
  });

  it('dispose cleans up event listeners', () => {
    handler.dispose();
    // No error means success
  });
});
