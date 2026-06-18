type Waiter = {
  resolve: (value: 'ready' | 'timeout') => void;
  timer: ReturnType<typeof setTimeout>;
};

export class WaitPool {
  private pool = new Map<string, Waiter[]>();

  wait(tableId: string, playerId: string, timeoutMs: number): Promise<'ready' | 'timeout'> {
    return new Promise<'ready' | 'timeout'>((resolve) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => {
          this.removeWaiter(tableId, waiter);
          resolve('timeout');
        }, timeoutMs),
      };
      const list = this.pool.get(tableId) ?? [];
      list.push(waiter);
      this.pool.set(tableId, list);
    });
  }

  notify(tableId: string): void {
    const waiters = this.pool.get(tableId);
    if (!waiters || waiters.length === 0) return;
    this.pool.delete(tableId);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve('ready');
    }
  }

  cleanup(tableId: string): void {
    const waiters = this.pool.get(tableId);
    if (!waiters) return;
    this.pool.delete(tableId);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve('timeout');
    }
  }

  pendingCount(tableId: string): number {
    return this.pool.get(tableId)?.length ?? 0;
  }

  private removeWaiter(tableId: string, waiter: Waiter): void {
    const list = this.pool.get(tableId);
    if (!list) return;
    const idx = list.indexOf(waiter);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) this.pool.delete(tableId);
  }
}
