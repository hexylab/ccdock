import * as fs from 'fs';

export class DbPoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private watchers: fs.FSWatcher[] = [];
  private fetchFn: () => void;
  private intervalMs: number;

  constructor(fetchFn: () => void, intervalMs: number) {
    this.fetchFn = fetchFn;
    this.intervalMs = intervalMs;
  }

  start(dbPath?: string): void {
    this.interval = setInterval(() => { this.fetchFn(); }, this.intervalMs);
    if (dbPath) {
      this.watchFile(dbPath);
      this.watchFile(dbPath + '-wal');
    }
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    for (const w of this.watchers) { w.close(); }
    this.watchers = [];
  }

  trigger(): void {
    this.fetchFn();
  }

  private watchFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        const watcher = fs.watch(filePath, () => { this.trigger(); });
        watcher.on('error', () => {});
        this.watchers.push(watcher);
      }
    } catch { /* fs.watch not available */ }
  }
}
