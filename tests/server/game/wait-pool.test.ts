import { describe, it, expect, vi, afterEach } from 'vitest';
import { WaitPool } from '@server/game/wait-pool.js';

describe('WaitPool', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('notify resolves waiting promise with ready', async () => {
    const pool = new WaitPool();
    const promise = pool.wait('t1', 'alice', 5000);
    pool.notify('t1');
    expect(await promise).toBe('ready');
  });

  it('resolves with timeout after timeoutMs', async () => {
    vi.useFakeTimers();
    const pool = new WaitPool();
    const promise = pool.wait('t1', 'alice', 100);
    vi.advanceTimersByTime(100);
    expect(await promise).toBe('timeout');
  });

  it('notify only wakes the correct table', async () => {
    const pool = new WaitPool();
    const p1 = pool.wait('t1', 'alice', 5000);
    const p2 = pool.wait('t2', 'bob', 5000);
    pool.notify('t1');
    expect(await p1).toBe('ready');
    // p2 should still be pending — verify with race
    const result = await Promise.race([p2, new Promise(r => setTimeout(() => r('still-waiting'), 10))]);
    expect(result).toBe('still-waiting');
    pool.cleanup('t2');
  });

  it('cleanup resolves all pending with timeout', async () => {
    const pool = new WaitPool();
    const p1 = pool.wait('t1', 'alice', 5000);
    const p2 = pool.wait('t1', 'bob', 5000);
    pool.cleanup('t1');
    expect(await p1).toBe('timeout');
    expect(await p2).toBe('timeout');
  });

  it('pendingCount reports correct number', () => {
    const pool = new WaitPool();
    expect(pool.pendingCount('t1')).toBe(0);
    pool.wait('t1', 'alice', 5000);
    pool.wait('t1', 'bob', 5000);
    expect(pool.pendingCount('t1')).toBe(2);
    pool.notify('t1');
    expect(pool.pendingCount('t1')).toBe(0);
  });

  it('multiple waits from same player both resolve', async () => {
    const pool = new WaitPool();
    const p1 = pool.wait('t1', 'alice', 5000);
    const p2 = pool.wait('t1', 'alice', 5000);
    pool.notify('t1');
    expect(await p1).toBe('ready');
    expect(await p2).toBe('ready');
  });
});
