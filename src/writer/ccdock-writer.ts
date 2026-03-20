import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { initializeSchema } from '../db/schema';
import { SessionRepo } from '../db/session-repo';
import type { HookStdinData } from '../shared/types';

export function deriveProcessKey(transcriptPath: string): string {
  return createHash('sha256').update(transcriptPath).digest('hex').slice(0, 16);
}

export function processHookEvent(db: Database.Database, data: HookStdinData): void {
  const repo = new SessionRepo(db);
  const processKey = deriveProcessKey(data.transcript_path);
  const event = data.hook_event_name;

  // SubAgent イベントはスキップ
  if (data.agent_id) {
    return;
  }

  // SessionEnd → DELETE
  if (event === 'SessionEnd') {
    repo.deleteByProcessKey(processKey);
    return;
  }

  // その他 → UPSERT
  repo.upsert({
    process_key: processKey,
    session_id: data.session_id,
    event,
    cwd: data.cwd,
    transcript_path: data.transcript_path,
  });
}

function appendErrorLog(logDir: string, error: Error): void {
  const logPath = path.join(logDir, 'error.log');
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const entry = `[${new Date().toISOString()}] ${error.message}\n${error.stack}\n\n`;
    fs.appendFileSync(logPath, entry);
  } catch {
    // ログ書き込みにも失敗した場合は何もしない
  }
}

// CLI エントリポイント
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const eventIdx = args.indexOf('--event');
  const dbIdx = args.indexOf('--db');

  const eventArg = eventIdx >= 0 ? args[eventIdx + 1] : undefined;
  const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : undefined;

  if (!dbPath) {
    process.exit(0);
  }

  // stdin から JSON を読み取り
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf-8').trim();

  if (!input) {
    process.exit(0);
  }

  const data: HookStdinData = JSON.parse(input);

  // --event が指定されていれば stdin より優先
  if (eventArg) {
    data.hook_event_name = eventArg;
  }

  const resolvedDbPath = dbPath.replace(/^~/, process.env.HOME ?? '');
  const dbDir = path.dirname(resolvedDbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(resolvedDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  initializeSchema(db);

  try {
    processHookEvent(db, data);
  } finally {
    db.close();
  }
}

// CLI として実行された場合のみ main を呼ぶ
if (require.main === module) {
  main().catch((err) => {
    const logDir = path.join(process.env.HOME ?? '', '.ccdock');
    appendErrorLog(logDir, err);
    process.exit(0); // 常に exit 0
  });
}
