import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export function openDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}
