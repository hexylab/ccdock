import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DbPoller } from '../src/watcher/db-poller';

describe('DbPoller', () => {
  let poller: DbPoller;
  let fetchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchFn = vi.fn().mockReturnValue([]);
  });

  afterEach(() => {
    poller?.stop();
    vi.useRealTimers();
  });

  it('calls fetch function on interval', () => {
    poller = new DbPoller(fetchFn, 1000);
    poller.start();
    vi.advanceTimersByTime(3500);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('stops calling after stop()', () => {
    poller = new DbPoller(fetchFn, 1000);
    poller.start();
    vi.advanceTimersByTime(2500);
    poller.stop();
    vi.advanceTimersByTime(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('trigger() calls fetch immediately', () => {
    poller = new DbPoller(fetchFn, 1000);
    poller.start();
    poller.trigger();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
