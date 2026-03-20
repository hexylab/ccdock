import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { installHooks, uninstallHooks } from '../src/hooks-installer';

describe('HooksInstaller', () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccdock-test-'));
    settingsPath = path.join(tmpDir, 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates hooks in empty settings file', () => {
    fs.writeFileSync(settingsPath, '{}');
    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('ccdock-writer');
  });

  it('appends to existing hooks without modifying them', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: 'existing-cmd' }] },
        ],
      },
    }, null, 2));
    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(2);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('existing-cmd');
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('ccdock-writer');
  });

  it('does not duplicate hooks on repeated install', () => {
    fs.writeFileSync(settingsPath, '{}');
    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');
    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it('updates hook path if extension path changed', () => {
    fs.writeFileSync(settingsPath, '{}');
    installHooks(settingsPath, '/old/path/ccdock-writer.js', '/home/.ccdock/dock.db');
    installHooks(settingsPath, '/new/path/ccdock-writer.js', '/home/.ccdock/dock.db');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('/new/path/');
  });

  it('uninstallHooks removes ccdock entries', () => {
    fs.writeFileSync(settingsPath, '{}');
    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');
    uninstallHooks(settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(0);
  });

  it('uninstallHooks preserves non-ccdock entries', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: 'existing-cmd' }] },
        ],
      },
    }, null, 2));
    installHooks(settingsPath, '/ext/dist/ccdock-writer.js', '/home/.ccdock/dock.db');
    uninstallHooks(settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('existing-cmd');
  });
});
