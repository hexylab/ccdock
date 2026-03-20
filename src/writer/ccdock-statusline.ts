import { createHash } from 'crypto';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { initializeSchema } from '../db/schema';
import { SessionRepo } from '../db/session-repo';
import type { StatusLineStdinData } from '../shared/types';

function deriveProcessKey(transcriptPath: string): string {
  return createHash('sha256').update(transcriptPath).digest('hex').slice(0, 16);
}

function writeToDb(dbPath: string, data: StatusLineStdinData): void {
  const processKey = deriveProcessKey(data.transcript_path);
  const resolvedDbPath = dbPath.replace(/^~/, process.env.HOME ?? '');
  const dbDir = path.dirname(resolvedDbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const db = new Database(resolvedDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  initializeSchema(db);

  try {
    const repo = new SessionRepo(db);
    const contextUsed = (data.context_window?.total_input_tokens != null && data.context_window?.total_output_tokens != null)
      ? data.context_window.total_input_tokens + data.context_window.total_output_tokens
      : null;

    repo.updateMetadata({
      process_key: processKey,
      model: data.model?.id ?? null,
      model_display: data.model?.display_name ?? null,
      cost_usd: data.cost?.total_cost_usd ?? null,
      context_used: contextUsed,
      context_total: data.context_window?.context_window_size ?? null,
      total_input_tokens: data.context_window?.total_input_tokens ?? null,
      total_output_tokens: data.context_window?.total_output_tokens ?? null,
      lines_added: data.cost?.total_lines_added ?? null,
      lines_removed: data.cost?.total_lines_removed ?? null,
      version: data.version ?? null,
    });
  } finally {
    db.close();
  }
}

function runOriginalCommand(cmd: string, stdinData: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', cmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    child.stdin.write(stdinData);
    child.stdin.end();

    child.stdout.pipe(process.stdout);
    child.stderr.resume();

    child.on('close', () => resolve());
    child.on('error', reject);
  });
}

function appendErrorLog(logDir: string, error: Error): void {
  const logPath = path.join(logDir, 'error.log');
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const entry = `[${new Date().toISOString()}] [statusline] ${error.message}\n${error.stack}\n\n`;
    fs.appendFileSync(logPath, entry);
  } catch {
    // ignore
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf('--db');
  const cmdB64Idx = args.indexOf('--original-cmd-b64');

  const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : undefined;
  const originalCmd = cmdB64Idx >= 0
    ? Buffer.from(args[cmdB64Idx + 1], 'base64').toString('utf-8')
    : undefined;

  if (!dbPath) { process.exit(0); }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const rawInput = Buffer.concat(chunks).toString('utf-8').trim();
  if (!rawInput) { process.exit(0); }

  // DB write (errors logged, never thrown)
  try {
    const data: StatusLineStdinData = JSON.parse(rawInput);
    writeToDb(dbPath, data);
  } catch (err) {
    appendErrorLog(path.join(process.env.HOME ?? '', '.ccdock'), err as Error);
  }

  // Run original statusline command
  if (originalCmd) {
    try {
      await runOriginalCommand(originalCmd, rawInput);
    } catch {
      // ignore subprocess failure
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    appendErrorLog(path.join(process.env.HOME ?? '', '.ccdock'), err);
    process.exit(0);
  });
}
