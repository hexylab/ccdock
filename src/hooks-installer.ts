import * as fs from 'fs';
import * as path from 'path';
import { HOOK_EVENTS, WRITER_MARKER, STATUSLINE_MARKER } from './constants';

interface HookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
    timeout?: number;
  }>;
}

function buildHookCommand(writerPath: string, event: string, dbPath: string): string {
  return `node "${writerPath}" --event ${event} --db "${dbPath}" 2>/dev/null || true`;
}

function buildHookEntry(writerPath: string, event: string, dbPath: string): HookEntry {
  return {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: buildHookCommand(writerPath, event, dbPath),
        timeout: 10,
      },
    ],
  };
}

export function installHooks(
  settingsPath: string,
  writerPath: string,
  dbPath: string,
  statuslinePath?: string,
): void {
  const settings = readSettings(settingsPath);
  if (!settings.hooks) { settings.hooks = {}; }
  let changed = false;

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) { settings.hooks[event] = []; }
    const entries = settings.hooks[event] as HookEntry[];
    const existingIdx = entries.findIndex((e) =>
      e.hooks?.some((h) => h.command?.includes(WRITER_MARKER))
    );

    if (existingIdx >= 0) {
      const currentCmd = entries[existingIdx].hooks[0].command;
      const newCmd = buildHookCommand(writerPath, event, dbPath);
      if (currentCmd !== newCmd) {
        entries[existingIdx] = buildHookEntry(writerPath, event, dbPath);
        changed = true;
      }
    } else {
      entries.push(buildHookEntry(writerPath, event, dbPath));
      changed = true;
    }
  }

  if (statuslinePath) {
    const statusChanged = installStatusLine(settings, statuslinePath, dbPath);
    changed = changed || statusChanged;
  }

  if (changed) { writeSettings(settingsPath, settings); }
}

export function uninstallHooks(settingsPath: string): void {
  if (!fs.existsSync(settingsPath)) return;
  const settings = readSettings(settingsPath);
  let changed = false;

  if (settings.hooks) {
    for (const event of HOOK_EVENTS) {
      const entries = settings.hooks[event] as HookEntry[] | undefined;
      if (!entries) continue;
      const filtered = entries.filter(
        (e) => !e.hooks?.some((h) => h.command?.includes(WRITER_MARKER))
      );
      if (filtered.length !== entries.length) {
        settings.hooks[event] = filtered;
        changed = true;
      }
    }
  }

  if (settings.statusLine?.command?.includes(STATUSLINE_MARKER)) {
    const originalCmd = extractOriginalCmd(settings.statusLine.command);
    if (originalCmd) {
      settings.statusLine = { type: 'command', command: originalCmd };
    } else {
      delete settings.statusLine;
    }
    changed = true;
  }

  if (changed) { writeSettings(settingsPath, settings); }
}

function buildStatusLineCommand(statuslinePath: string, dbPath: string, originalCmd?: string): string {
  let cmd = `node "${statuslinePath}" --db "${dbPath}"`;
  if (originalCmd) {
    const encoded = Buffer.from(originalCmd).toString('base64');
    cmd += ` --original-cmd-b64 ${encoded}`;
  }
  return cmd;
}

function extractOriginalCmd(command: string): string | undefined {
  const marker = '--original-cmd-b64 ';
  const idx = command.indexOf(marker);
  if (idx < 0) return undefined;
  const b64 = command.substring(idx + marker.length).split(/\s/)[0];
  if (!b64) return undefined;
  try {
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    return undefined;
  }
}

function installStatusLine(
  settings: Record<string, any>,
  statuslinePath: string,
  dbPath: string,
): boolean {
  const existing = settings.statusLine;

  if (existing?.command?.includes(STATUSLINE_MARKER)) {
    const currentOriginal = extractOriginalCmd(existing.command);
    const newCmd = buildStatusLineCommand(statuslinePath, dbPath, currentOriginal);
    if (existing.command !== newCmd) {
      settings.statusLine = { type: 'command', command: newCmd };
      return true;
    }
    return false;
  }

  const originalCmd = existing?.type === 'command' ? existing.command : undefined;
  settings.statusLine = {
    type: 'command',
    command: buildStatusLineCommand(statuslinePath, dbPath, originalCmd),
  };
  return true;
}

function readSettings(settingsPath: string): Record<string, any> {
  if (!fs.existsSync(settingsPath)) { return {}; }
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
}

function writeSettings(settingsPath: string, settings: Record<string, any>): void {
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  const tmpPath = settingsPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmpPath, settingsPath);
}
