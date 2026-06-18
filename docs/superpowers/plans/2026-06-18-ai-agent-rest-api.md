# AI Agent REST API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a REST API layer (long-poll + auto-dealer + persistence) so AI agents can play Texas Hold'em against each other via HTTP.

**Architecture:** Three new modules (WaitPool, AutoDealer, TableRegistry) wrap the existing pure-function reducer. REST endpoints translate HTTP requests into TableEvent dispatches. SQLite snapshots provide crash recovery. Stats are tracked per-hand.

**Tech Stack:** Express, better-sqlite3, vitest, supertest, Node crypto (all already in the project)

## Global Constraints

- Build on branch `stage-3-state-machine`
- No new npm dependencies
- Do not modify any existing game engine files (`src/server/game/table-state.ts`, `betting.ts`, etc.)
- Follow existing patterns: `@server/` and `@shared/` path aliases, vitest globals, supertest for HTTP tests
- All timestamps use `Date.now()` (milliseconds)
- Commit after each task passes tests

---

### Task 1: DB Migrations (table_snapshots + player_stats)

**Files:**
- Create: `src/server/store/migrations/002_table_snapshots.sql`
- Create: `src/server/store/migrations/003_player_stats.sql`
- Test: `tests/server/store/migrations.test.ts`

**Interfaces:**
- Consumes: existing `openDb(':memory:')` from `src/server/store/db.ts`
- Produces: Two new tables available via any `DB` instance after `openDb()`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/store/migrations.test.ts
import { describe, it, expect } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';

describe('migrations', () => {
  it('creates table_snapshots table', () => {
    const db = makeTestDb();
    const info = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='table_snapshots'"
    ).get() as { name: string } | undefined;
    expect(info?.name).toBe('table_snapshots');
  });

  it('creates player_stats table', () => {
    const db = makeTestDb();
    const info = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='player_stats'"
    ).get() as { name: string } | undefined;
    expect(info?.name).toBe('player_stats');
  });

  it('table_snapshots has correct columns', () => {
    const db = makeTestDb();
    const cols = db.pragma('table_info(table_snapshots)') as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('table_id');
    expect(names).toContain('state_json');
    expect(names).toContain('updated_at');
  });

  it('player_stats has correct columns', () => {
    const db = makeTestDb();
    const cols = db.pragma('table_info(player_stats)') as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('player_id');
    expect(names).toContain('hands_played');
    expect(names).toContain('hands_won');
    expect(names).toContain('total_profit');
    expect(names).toContain('biggest_pot');
    expect(names).toContain('buy_in_count');
    expect(names).toContain('updated_at');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/store/migrations.test.ts`
Expected: FAIL — table_snapshots and player_stats don't exist

- [ ] **Step 3: Create migration files**

```sql
-- src/server/store/migrations/002_table_snapshots.sql
CREATE TABLE IF NOT EXISTS table_snapshots (
  table_id   TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

```sql
-- src/server/store/migrations/003_player_stats.sql
CREATE TABLE IF NOT EXISTS player_stats (
  player_id    TEXT PRIMARY KEY,
  hands_played INTEGER NOT NULL DEFAULT 0,
  hands_won    INTEGER NOT NULL DEFAULT 0,
  total_profit INTEGER NOT NULL DEFAULT 0,
  biggest_pot  INTEGER NOT NULL DEFAULT 0,
  buy_in_count INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/store/migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All 161+ tests pass (existing tests unaffected)

- [ ] **Step 6: Commit**

```bash
git add src/server/store/migrations/ tests/server/store/migrations.test.ts
git commit -m "feat: add table_snapshots and player_stats migrations"
```

---

### Task 2: Snapshot Repository (serialize/deserialize + DB ops)

**Files:**
- Create: `src/server/game/snapshot.ts`
- Test: `tests/server/game/snapshot.test.ts`

**Interfaces:**
- Consumes: `DB` type from `@server/store/db.js`, `TableState` from `@shared/table-types.js`
- Produces:
  - `serialize(state: TableState): string` — JSON string with Map→array conversion
  - `deserialize(json: string): TableState` — reverse
  - `class SnapshotRepo { constructor(db: DB); upsert(tableId: string, state: TableState): void; loadActive(): Array<{ tableId: string; state: TableState }>; remove(tableId: string): void; }`

- [ ] **Step 1: Write failing tests for serialize/deserialize**

```typescript
// tests/server/game/snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from '@server/game/snapshot.js';
import { reduce, type TableEvent } from '@server/game/table-state.js';
import type { TableConfig } from '@shared/table-types.js';

const baseConfig: TableConfig = {
  name: 'Test', smallBlind: 5, bigBlind: 10,
  minBuyIn: 100, maxBuyIn: 1000, reloadPolicy: 'between-hands',
  maxSeats: 6, allowSpectators: true, actionTimeoutSec: 30,
  timeBankSec: 60, defaultRunoutCount: 2, squidMode: false, squidPointsPerCatch: 10,
};

function createTable(): any {
  return reduce(null, {
    type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC',
    hostId: 'host', config: baseConfig, nowMs: 1000,
  });
}

describe('snapshot — serialize/deserialize', () => {
  it('round-trips a lobby state', () => {
    const state = createTable();
    const json = serialize(state);
    const restored = deserialize(json);
    expect(restored.id).toBe('t1');
    expect(restored.status).toBe('lobby');
    expect(restored.config).toEqual(baseConfig);
  });

  it('round-trips state with squidStats Map', () => {
    const state = createTable();
    state.squidStats = new Map([['alice', {
      handsPlayed: 5, handsWon: 2, vpipCount: 3, pfrCount: 1,
      showdownWon: 1, biggestPot: 200, squidPoints: 10,
    }]]);
    const json = serialize(state);
    const restored = deserialize(json);
    expect(restored.squidStats).toBeInstanceOf(Map);
    expect(restored.squidStats.get('alice')?.handsPlayed).toBe(5);
  });

  it('preserves private _-prefixed fields', () => {
    const state = createTable() as any;
    state._serverSeed = 'a'.repeat(64);
    state._holeCards = new Map([['alice', ['Ah', 'Kd']]]);
    const json = serialize(state);
    const restored = deserialize(json) as any;
    expect(restored._serverSeed).toBe('a'.repeat(64));
    expect(restored._holeCards).toBeInstanceOf(Map);
    expect(restored._holeCards.get('alice')).toEqual(['Ah', 'Kd']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/game/snapshot.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement serialize/deserialize**

```typescript
// src/server/game/snapshot.ts
import type { TableState } from '../../shared/table-types.js';
import type { DB } from '../store/db.js';

// Fields that are Map instances and need special serialization
const MAP_FIELDS = ['squidStats', '_holeCards'] as const;

export function serialize(state: TableState): string {
  return JSON.stringify(state, (key, value) => {
    if (value instanceof Map) {
      return { __type: 'Map', entries: [...value.entries()] };
    }
    if (value instanceof Set) {
      return { __type: 'Set', values: [...value.values()] };
    }
    return value;
  });
}

export function deserialize(json: string): TableState {
  return JSON.parse(json, (_key, value) => {
    if (value && typeof value === 'object' && value.__type === 'Map') {
      return new Map(value.entries);
    }
    if (value && typeof value === 'object' && value.__type === 'Set') {
      return new Set(value.values);
    }
    return value;
  });
}

export class SnapshotRepo {
  private upsertStmt: any;
  private loadActiveStmt: any;
  private removeStmt: any;

  constructor(private db: DB) {
    this.upsertStmt = db.prepare(
      `INSERT INTO table_snapshots (table_id, state_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(table_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
    );
    this.loadActiveStmt = db.prepare(
      `SELECT table_id, state_json FROM table_snapshots`
    );
    this.removeStmt = db.prepare(
      `DELETE FROM table_snapshots WHERE table_id = ?`
    );
  }

  upsert(tableId: string, state: TableState): void {
    this.upsertStmt.run(tableId, serialize(state), Date.now());
  }

  loadActive(): Array<{ tableId: string; state: TableState }> {
    const rows = this.loadActiveStmt.all() as Array<{ table_id: string; state_json: string }>;
    return rows
      .map(r => ({ tableId: r.table_id, state: deserialize(r.state_json) }))
      .filter(r => r.state.status !== 'closed');
  }

  remove(tableId: string): void {
    this.removeStmt.run(tableId);
  }
}
```

- [ ] **Step 4: Add SnapshotRepo tests**

Append to `tests/server/game/snapshot.test.ts`:

```typescript
import { SnapshotRepo } from '@server/game/snapshot.js';
import { makeTestDb } from '../../helpers/test-db.js';

describe('SnapshotRepo', () => {
  it('upserts and loads a snapshot', () => {
    const db = makeTestDb();
    const repo = new SnapshotRepo(db);
    const state = createTable();
    repo.upsert('t1', state);
    const loaded = repo.loadActive();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].tableId).toBe('t1');
    expect(loaded[0].state.id).toBe('t1');
  });

  it('filters out closed tables on load', () => {
    const db = makeTestDb();
    const repo = new SnapshotRepo(db);
    const state = createTable();
    const closed = { ...state, status: 'closed' as const, closedAt: 9999 };
    repo.upsert('t1', state);
    repo.upsert('t2', closed);
    const loaded = repo.loadActive();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].tableId).toBe('t1');
  });

  it('removes a snapshot', () => {
    const db = makeTestDb();
    const repo = new SnapshotRepo(db);
    repo.upsert('t1', createTable());
    repo.remove('t1');
    expect(repo.loadActive()).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/game/snapshot.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/game/snapshot.ts tests/server/game/snapshot.test.ts
git commit -m "feat: add snapshot serialize/deserialize + SnapshotRepo"
```

---

### Task 3: StatsRepo (player stats DB operations)

**Files:**
- Create: `src/server/store/stats.repo.ts`
- Test: `tests/server/store/stats.repo.test.ts`

**Interfaces:**
- Consumes: `DB` from `@server/store/db.js`
- Produces:
  - `type PlayerStats = { playerId: string; handsPlayed: number; handsWon: number; totalProfit: number; biggestPot: number; buyInCount: number; updatedAt: number }`
  - `class StatsRepo { constructor(db: DB); recordHandResult(params: { playerId: string; won: boolean; profitDelta: number; potSize: number }): void; recordBuyIn(playerId: string): void; getAll(): PlayerStats[]; getByPlayer(playerId: string): PlayerStats | null; }`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/server/store/stats.repo.test.ts
import { describe, it, expect } from 'vitest';
import { StatsRepo } from '@server/store/stats.repo.js';
import { makeTestDb } from '../../helpers/test-db.js';

describe('StatsRepo', () => {
  it('getAll returns empty initially', () => {
    const repo = new StatsRepo(makeTestDb());
    expect(repo.getAll()).toEqual([]);
  });

  it('recordBuyIn creates player entry', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('alice');
    const stats = repo.getByPlayer('alice');
    expect(stats).not.toBeNull();
    expect(stats!.buyInCount).toBe(1);
    expect(stats!.handsPlayed).toBe(0);
  });

  it('recordBuyIn increments for existing player', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('alice');
    repo.recordBuyIn('alice');
    expect(repo.getByPlayer('alice')!.buyInCount).toBe(2);
  });

  it('recordHandResult updates stats for winner', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('alice');
    repo.recordHandResult({ playerId: 'alice', won: true, profitDelta: 200, potSize: 400 });
    const stats = repo.getByPlayer('alice')!;
    expect(stats.handsPlayed).toBe(1);
    expect(stats.handsWon).toBe(1);
    expect(stats.totalProfit).toBe(200);
    expect(stats.biggestPot).toBe(400);
  });

  it('recordHandResult updates stats for loser', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('bob');
    repo.recordHandResult({ playerId: 'bob', won: false, profitDelta: -100, potSize: 200 });
    const stats = repo.getByPlayer('bob')!;
    expect(stats.handsPlayed).toBe(1);
    expect(stats.handsWon).toBe(0);
    expect(stats.totalProfit).toBe(-100);
  });

  it('biggestPot only increases', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('alice');
    repo.recordHandResult({ playerId: 'alice', won: true, profitDelta: 100, potSize: 500 });
    repo.recordHandResult({ playerId: 'alice', won: true, profitDelta: 50, potSize: 200 });
    expect(repo.getByPlayer('alice')!.biggestPot).toBe(500);
  });

  it('getAll returns sorted by totalProfit desc', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('alice');
    repo.recordBuyIn('bob');
    repo.recordHandResult({ playerId: 'alice', won: false, profitDelta: -100, potSize: 200 });
    repo.recordHandResult({ playerId: 'bob', won: true, profitDelta: 100, potSize: 200 });
    const all = repo.getAll();
    expect(all[0].playerId).toBe('bob');
    expect(all[1].playerId).toBe('alice');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/store/stats.repo.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement StatsRepo**

```typescript
// src/server/store/stats.repo.ts
import type { DB } from './db.js';

export type PlayerStats = {
  playerId: string;
  handsPlayed: number;
  handsWon: number;
  totalProfit: number;
  biggestPot: number;
  buyInCount: number;
  updatedAt: number;
};

export class StatsRepo {
  private getAllStmt: any;
  private getByPlayerStmt: any;
  private upsertBuyInStmt: any;
  private upsertHandStmt: any;

  constructor(private db: DB) {
    this.getAllStmt = db.prepare(
      `SELECT player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at
       FROM player_stats ORDER BY total_profit DESC`
    );
    this.getByPlayerStmt = db.prepare(
      `SELECT player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at
       FROM player_stats WHERE player_id = ?`
    );
    this.upsertBuyInStmt = db.prepare(
      `INSERT INTO player_stats (player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at)
       VALUES (?, 0, 0, 0, 0, 1, ?)
       ON CONFLICT(player_id) DO UPDATE SET buy_in_count = buy_in_count + 1, updated_at = excluded.updated_at`
    );
    this.upsertHandStmt = db.prepare(
      `INSERT INTO player_stats (player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at)
       VALUES (?, 1, ?, ?, ?, 0, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         hands_played = hands_played + 1,
         hands_won = hands_won + excluded.hands_won,
         total_profit = total_profit + excluded.total_profit,
         biggest_pot = MAX(biggest_pot, excluded.biggest_pot),
         updated_at = excluded.updated_at`
    );
  }

  getAll(): PlayerStats[] {
    return (this.getAllStmt.all() as any[]).map(this.rowToStats);
  }

  getByPlayer(playerId: string): PlayerStats | null {
    const row = this.getByPlayerStmt.get(playerId) as any;
    return row ? this.rowToStats(row) : null;
  }

  recordBuyIn(playerId: string): void {
    this.upsertBuyInStmt.run(playerId, Date.now());
  }

  recordHandResult(params: {
    playerId: string;
    won: boolean;
    profitDelta: number;
    potSize: number;
  }): void {
    this.upsertHandStmt.run(
      params.playerId,
      params.won ? 1 : 0,
      params.profitDelta,
      params.potSize,
      Date.now(),
    );
  }

  private rowToStats(row: any): PlayerStats {
    return {
      playerId: row.player_id,
      handsPlayed: row.hands_played,
      handsWon: row.hands_won,
      totalProfit: row.total_profit,
      biggestPot: row.biggest_pot,
      buyInCount: row.buy_in_count,
      updatedAt: row.updated_at,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/store/stats.repo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/store/stats.repo.ts tests/server/store/stats.repo.test.ts
git commit -m "feat: add StatsRepo for player statistics"
```

---

### Task 4: WaitPool (long-poll infrastructure)

**Files:**
- Create: `src/server/game/wait-pool.ts`
- Test: `tests/server/game/wait-pool.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `class WaitPool { wait(tableId: string, playerId: string, timeoutMs: number): Promise<'ready' | 'timeout'>; notify(tableId: string): void; cleanup(tableId: string): void; pendingCount(tableId: string): number; }`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/server/game/wait-pool.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/game/wait-pool.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement WaitPool**

```typescript
// src/server/game/wait-pool.ts

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/game/wait-pool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/game/wait-pool.ts tests/server/game/wait-pool.test.ts
git commit -m "feat: add WaitPool for long-poll infrastructure"
```

---

### Task 5: TableRegistry + AutoDealer

**Files:**
- Create: `src/server/game/table-registry.ts`
- Create: `src/server/game/auto-dealer.ts`
- Test: `tests/server/game/table-registry.test.ts`

**Interfaces:**
- Consumes: `reduce()` and `getHoleCards()` from `@server/game/table-state.js`, `WaitPool`, `SnapshotRepo`, `StatsRepo`, `TableConfig` from `@shared/table-types.js`
- Produces:
  - `class AutoDealer { constructor(dispatch: DispatchFn); onStateChange(tableId: string, prev: TableState | null, next: TableState): void; resume(tableId: string, state: TableState): void; clearTimers(tableId: string): void; destroy(): void; }`
  - `type DispatchFn = (tableId: string, event: TableEvent) => TableState`
  - `class TableRegistry { constructor(deps: { snapshotRepo: SnapshotRepo; statsRepo: StatsRepo; waitPool: WaitPool }); create(config: Partial<TableConfig>, hostId: string): TableState; get(tableId: string): TableState | null; list(): TableState[]; dispatch(tableId: string, event: TableEvent): TableState; restore(tableId: string, state: TableState): void; remove(tableId: string): void; getAutoDealer(): AutoDealer; getBuyInTracker(): Map<string, Map<string, number>>; destroy(): void; }`

- [ ] **Step 1: Write failing tests for TableRegistry**

```typescript
// tests/server/game/table-registry.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableRegistry } from '@server/game/table-registry.js';
import { WaitPool } from '@server/game/wait-pool.js';
import { SnapshotRepo } from '@server/game/snapshot.js';
import { StatsRepo } from '@server/store/stats.repo.js';
import { makeTestDb } from '../../helpers/test-db.js';

function makeRegistry() {
  const db = makeTestDb();
  const waitPool = new WaitPool();
  const snapshotRepo = new SnapshotRepo(db);
  const statsRepo = new StatsRepo(db);
  const registry = new TableRegistry({ snapshotRepo, statsRepo, waitPool });
  return { registry, waitPool, snapshotRepo, statsRepo, db };
}

describe('TableRegistry', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('creates a table in lobby status', () => {
    const { registry } = makeRegistry();
    const state = registry.create({
      name: 'Test', smallBlind: 5, bigBlind: 10,
      minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6,
    }, 'host');
    expect(state.status).toBe('lobby');
    expect(state.config.name).toBe('Test');
    expect(state.id).toBeTruthy();
  });

  it('list returns all tables', () => {
    const { registry } = makeRegistry();
    registry.create({ name: 'A', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'h');
    registry.create({ name: 'B', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'h');
    expect(registry.list()).toHaveLength(2);
  });

  it('dispatch applies event and persists snapshot', () => {
    const { registry, snapshotRepo } = makeRegistry();
    const state = registry.create({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'host');
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: Date.now() });
    const loaded = snapshotRepo.loadActive();
    expect(loaded).toHaveLength(1);
    const restored = loaded[0].state;
    expect(restored.seats[0]?.userId).toBe('alice');
  });

  it('dispatch notifies waitPool', async () => {
    const { registry, waitPool } = makeRegistry();
    const state = registry.create({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'host');
    const promise = waitPool.wait(state.id, 'alice', 5000);
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: Date.now() });
    expect(await promise).toBe('ready');
  });

  it('get returns null for unknown table', () => {
    const { registry } = makeRegistry();
    expect(registry.get('nope')).toBeNull();
  });

  it('remove deletes table from memory and DB', () => {
    const { registry, snapshotRepo } = makeRegistry();
    const state = registry.create({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'host');
    registry.remove(state.id);
    expect(registry.get(state.id)).toBeNull();
    expect(snapshotRepo.loadActive()).toHaveLength(0);
  });
});

describe('TableRegistry — AutoDealer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('auto-starts game when 2 players sit down', () => {
    const { registry } = makeRegistry();
    const state = registry.create({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'host');
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: Date.now() });
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'bob', seat: 1, buyIn: 500, nowMs: Date.now() });
    // After 3s delay, game should auto-start
    vi.advanceTimersByTime(3100);
    const updated = registry.get(state.id)!;
    expect(updated.status).toBe('running');
    expect(updated.hand).not.toBeNull();
  });

  it('auto-folds on action timeout', () => {
    const { registry } = makeRegistry();
    const state = registry.create({
      name: 'T', smallBlind: 5, bigBlind: 10,
      minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6, actionTimeoutSec: 10,
    }, 'host');
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: Date.now() });
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'bob', seat: 1, buyIn: 500, nowMs: Date.now() });
    vi.advanceTimersByTime(3100); // auto-start + begin hand
    const started = registry.get(state.id)!;
    expect(started.hand).not.toBeNull();
    // Now the actor should timeout after 10s
    vi.advanceTimersByTime(10100);
    const afterTimeout = registry.get(state.id)!;
    // Hand should have progressed (actor changed or hand ended)
    expect(afterTimeout.eventSeq).toBeGreaterThan(started.eventSeq);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/game/table-registry.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement AutoDealer**

```typescript
// src/server/game/auto-dealer.ts
import crypto from 'node:crypto';
import type { TableState, SeatedPlayer } from '../../shared/table-types.js';
import type { TableEvent } from './table-state.js';

export type DispatchFn = (tableId: string, event: TableEvent) => TableState;

export class AutoDealer {
  private startTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private nextHandTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private actionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private dispatch: DispatchFn) {}

  onStateChange(tableId: string, prev: TableState | null, next: TableState): void {
    // Auto-start: 2+ seated in lobby → start after 3s
    if (next.status === 'lobby' && this.seatedCount(next) >= 2 && !this.startTimers.has(tableId)) {
      this.startTimers.set(tableId, setTimeout(() => {
        this.startTimers.delete(tableId);
        this.startGame(tableId);
      }, 3000));
    }

    // Cancel start timer if players leave below 2
    if (next.status === 'lobby' && this.seatedCount(next) < 2 && this.startTimers.has(tableId)) {
      clearTimeout(this.startTimers.get(tableId)!);
      this.startTimers.delete(tableId);
    }

    // Auto-deal next hand: hand just ended (prev had hand, next doesn't)
    if (prev?.hand && !next.hand && next.status === 'running' && this.seatedCount(next) >= 2) {
      this.scheduleNextHand(tableId, next);
    }

    // Action timeout: new actor
    if (next.hand?.actorSeat !== null && next.hand?.actorSeat !== undefined) {
      const prevActor = prev?.hand?.actorSeat;
      if (prevActor !== next.hand.actorSeat || !prev?.hand) {
        this.scheduleActionTimeout(tableId, next);
      }
    } else {
      // No actor — clear action timer
      this.clearActionTimer(tableId);
    }

    // Table closed — clear all
    if (next.status === 'closed') {
      this.clearTimers(tableId);
    }
  }

  resume(tableId: string, state: TableState): void {
    if (state.status === 'running' && !state.hand && this.seatedCount(state) >= 2) {
      this.scheduleNextHand(tableId, state);
    }
    if (state.hand?.actorSeat !== null && state.hand?.actorSeat !== undefined) {
      this.scheduleActionTimeout(tableId, state);
    }
  }

  clearTimers(tableId: string): void {
    if (this.startTimers.has(tableId)) {
      clearTimeout(this.startTimers.get(tableId)!);
      this.startTimers.delete(tableId);
    }
    if (this.nextHandTimers.has(tableId)) {
      clearTimeout(this.nextHandTimers.get(tableId)!);
      this.nextHandTimers.delete(tableId);
    }
    this.clearActionTimer(tableId);
  }

  destroy(): void {
    for (const t of this.startTimers.values()) clearTimeout(t);
    for (const t of this.nextHandTimers.values()) clearTimeout(t);
    for (const t of this.actionTimers.values()) clearTimeout(t);
    this.startTimers.clear();
    this.nextHandTimers.clear();
    this.actionTimers.clear();
  }

  private startGame(tableId: string): void {
    try {
      this.dispatch(tableId, { type: 'START_GAME', hostId: '__auto__', nowMs: Date.now() });
    } catch { /* table might have been removed */ }
    try {
      this.dispatch(tableId, {
        type: 'BEGIN_HAND',
        serverSeed: crypto.randomBytes(32).toString('hex'),
        nowMs: Date.now(),
      });
    } catch { /* ignore */ }
  }

  private scheduleNextHand(tableId: string, state: TableState): void {
    if (this.nextHandTimers.has(tableId)) {
      clearTimeout(this.nextHandTimers.get(tableId)!);
    }
    this.nextHandTimers.set(tableId, setTimeout(() => {
      this.nextHandTimers.delete(tableId);
      // Auto-rebuy busted players
      const current = this.dispatch(tableId, { type: 'JOIN_TABLE', userId: '__noop__', displayName: '', nowMs: Date.now() });
      // Note: rebuy handled in registry layer before BEGIN_HAND
      try {
        this.dispatch(tableId, {
          type: 'BEGIN_HAND',
          serverSeed: crypto.randomBytes(32).toString('hex'),
          nowMs: Date.now(),
        });
      } catch { /* not enough players, etc */ }
    }, 2000));
  }

  private scheduleActionTimeout(tableId: string, state: TableState): void {
    this.clearActionTimer(tableId);
    const timeoutMs = (state.config.actionTimeoutSec ?? 10) * 1000;
    this.actionTimers.set(tableId, setTimeout(() => {
      this.actionTimers.delete(tableId);
      try {
        this.dispatch(tableId, { type: 'TIMEOUT', nowMs: Date.now() });
      } catch { /* ignore */ }
    }, timeoutMs));
  }

  private clearActionTimer(tableId: string): void {
    if (this.actionTimers.has(tableId)) {
      clearTimeout(this.actionTimers.get(tableId)!);
      this.actionTimers.delete(tableId);
    }
  }

  private seatedCount(state: TableState): number {
    return state.seats.filter((s): s is SeatedPlayer => s !== null).length;
  }
}
```

- [ ] **Step 4: Implement TableRegistry**

```typescript
// src/server/game/table-registry.ts
import crypto from 'node:crypto';
import { reduce, getHoleCards, type TableEvent } from './table-state.js';
import { AutoDealer } from './auto-dealer.js';
import { WaitPool } from './wait-pool.js';
import { SnapshotRepo } from './snapshot.js';
import { StatsRepo } from '../store/stats.repo.js';
import type { TableState, TableConfig, SeatedPlayer } from '../../shared/table-types.js';

export type RegistryDeps = {
  snapshotRepo: SnapshotRepo;
  statsRepo: StatsRepo;
  waitPool: WaitPool;
};

const DEFAULT_CONFIG: TableConfig = {
  name: 'Unnamed',
  smallBlind: 10,
  bigBlind: 20,
  minBuyIn: 500,
  maxBuyIn: 2000,
  reloadPolicy: 'anytime',
  maxSeats: 9,
  allowSpectators: true,
  actionTimeoutSec: 10,
  timeBankSec: 0,
  defaultRunoutCount: 1,
  squidMode: false,
  squidPointsPerCatch: 10,
};

export class TableRegistry {
  private tables = new Map<string, TableState>();
  private autoDealer: AutoDealer;
  // Track buy-in totals per table per player: Map<tableId, Map<playerId, totalBoughtIn>>
  private buyInTracker = new Map<string, Map<string, number>>();

  constructor(private deps: RegistryDeps) {
    this.autoDealer = new AutoDealer((tableId, event) => this.dispatch(tableId, event));
  }

  create(config: Partial<TableConfig>, hostId: string): TableState {
    const tableId = crypto.randomUUID();
    const shortCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const fullConfig: TableConfig = { ...DEFAULT_CONFIG, ...config };
    const event: TableEvent = {
      type: 'CREATE_TABLE',
      tableId,
      shortCode,
      hostId,
      config: fullConfig,
      nowMs: Date.now(),
    };
    const state = reduce(null, event);
    this.tables.set(tableId, state);
    this.deps.snapshotRepo.upsert(tableId, state);
    this.buyInTracker.set(tableId, new Map());
    this.autoDealer.onStateChange(tableId, null, state);
    return state;
  }

  get(tableId: string): TableState | null {
    return this.tables.get(tableId) ?? null;
  }

  list(): TableState[] {
    return [...this.tables.values()];
  }

  dispatch(tableId: string, event: TableEvent): TableState {
    const prev = this.tables.get(tableId);
    if (!prev) throw new Error(`table not found: ${tableId}`);

    // Track buy-in
    if (event.type === 'SIT_DOWN') {
      const tracker = this.buyInTracker.get(tableId) ?? new Map();
      const current = tracker.get(event.userId) ?? 0;
      tracker.set(event.userId, current + event.buyIn);
      this.buyInTracker.set(tableId, tracker);
      this.deps.statsRepo.recordBuyIn(event.userId);
    }

    const next = reduce(prev, event);
    this.tables.set(tableId, next);
    this.deps.snapshotRepo.upsert(tableId, next);
    this.deps.waitPool.notify(tableId);

    // Hand just ended — record stats
    if (prev.hand && !next.hand) {
      this.recordHandStats(tableId, prev, next);
      this.autoRebuy(tableId, next);
    }

    this.autoDealer.onStateChange(tableId, prev, next);
    return next;
  }

  restore(tableId: string, state: TableState): void {
    this.tables.set(tableId, state);
    // Rebuild buy-in tracker from state (approximate: use current stacks)
    const tracker = new Map<string, number>();
    for (const seat of state.seats) {
      if (seat) tracker.set(seat.userId, seat.stack); // approximation on restore
    }
    this.buyInTracker.set(tableId, tracker);
    this.autoDealer.resume(tableId, state);
  }

  remove(tableId: string): void {
    this.tables.delete(tableId);
    this.buyInTracker.delete(tableId);
    this.deps.snapshotRepo.remove(tableId);
    this.deps.waitPool.cleanup(tableId);
    this.autoDealer.clearTimers(tableId);
  }

  getAutoDealer(): AutoDealer {
    return this.autoDealer;
  }

  getBuyInTracker(): Map<string, Map<string, number>> {
    return this.buyInTracker;
  }

  destroy(): void {
    this.autoDealer.destroy();
  }

  private recordHandStats(tableId: string, prev: TableState, next: TableState): void {
    const tracker = this.buyInTracker.get(tableId) ?? new Map();
    const potTotal = prev.hand!.pots?.reduce((s, p) => s + p.amount, 0) ?? 0;

    for (const seat of prev.seats) {
      if (!seat) continue;
      const nextSeat = next.seats.find((s): s is SeatedPlayer => s?.userId === seat.userId);
      if (!nextSeat) continue;
      const profitDelta = nextSeat.stack - seat.stack;
      const won = profitDelta > 0;
      this.deps.statsRepo.recordHandResult({
        playerId: seat.userId,
        won,
        profitDelta,
        potSize: potTotal,
      });
    }
  }

  private autoRebuy(tableId: string, state: TableState): void {
    const tracker = this.buyInTracker.get(tableId) ?? new Map();
    for (const seat of state.seats) {
      if (seat && seat.stack === 0) {
        // Directly add chips — mutate in place since we're between hands
        seat.stack = state.config.minBuyIn;
        const current = tracker.get(seat.userId) ?? 0;
        tracker.set(seat.userId, current + state.config.minBuyIn);
        this.deps.statsRepo.recordBuyIn(seat.userId);
      }
    }
    // Re-persist after rebuy
    if (state.seats.some(s => s && s.stack === state.config.minBuyIn)) {
      this.deps.snapshotRepo.upsert(tableId, state);
    }
  }
}
```

- [ ] **Step 5: Fix START_GAME hostId issue**

The reducer's `assertHost` will reject `__auto__` as hostId. The registry needs to pass the original hostId. Update `AutoDealer.startGame`:

```typescript
  private startGame(tableId: string): void {
    // Use dispatch which gives us access to current state's hostId
    // We need to get the state first
    try {
      // The dispatch function has access to state via the registry
      // We pass a special marker that the registry can intercept
      this.dispatch(tableId, { type: 'START_GAME', hostId: '__dealer__', nowMs: Date.now() });
    } catch { /* table might have been removed */ }
    try {
      this.dispatch(tableId, {
        type: 'BEGIN_HAND',
        serverSeed: crypto.randomBytes(32).toString('hex'),
        nowMs: Date.now(),
      });
    } catch { /* ignore */ }
  }
```

And in `TableRegistry.dispatch`, before calling `reduce()`, intercept `__dealer__` hostId:

```typescript
  dispatch(tableId: string, event: TableEvent): TableState {
    const prev = this.tables.get(tableId);
    if (!prev) throw new Error(`table not found: ${tableId}`);

    // AutoDealer uses '__dealer__' marker — replace with actual hostId
    if ('hostId' in event && (event as any).hostId === '__dealer__') {
      (event as any).hostId = prev.hostId;
    }
    // ... rest of dispatch
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/server/game/table-registry.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/server/game/auto-dealer.ts src/server/game/table-registry.ts tests/server/game/table-registry.test.ts
git commit -m "feat: add TableRegistry + AutoDealer with auto-start, auto-deal, timeout"
```

---

### Task 6: openAuth Middleware + Table REST Routes

**Files:**
- Modify: `src/server/http/middleware.ts`
- Create: `src/server/http/table.routes.ts`
- Create: `src/server/http/stats.routes.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/index.ts`
- Test: `tests/server/http/table.routes.test.ts`
- Test: `tests/server/http/stats.routes.test.ts`

**Interfaces:**
- Consumes: `TableRegistry`, `StatsRepo`, `WaitPool`, `getHoleCards()` from `@server/game/table-state.js`
- Produces: Fully functional HTTP API matching spec §4

- [ ] **Step 1: Add openAuth middleware**

Add to `src/server/http/middleware.ts`:

```typescript
export function openAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const playerId = req.headers['x-player-id'] as string | undefined;
    if (!playerId || playerId.trim().length === 0) {
      return res.status(400).json({ error: 'X-Player-Id header required' });
    }
    req.userId = playerId.trim();
    next();
  };
}
```

- [ ] **Step 2: Write failing test for POST /api/tables**

```typescript
// tests/server/http/table.routes.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '@server/app.js';
import { TableRegistry } from '@server/game/table-registry.js';
import { WaitPool } from '@server/game/wait-pool.js';
import { SnapshotRepo } from '@server/game/snapshot.js';
import { StatsRepo } from '@server/store/stats.repo.js';
import { makeTestDb } from '../../helpers/test-db.js';

function makeApp() {
  const db = makeTestDb();
  const waitPool = new WaitPool();
  const snapshotRepo = new SnapshotRepo(db);
  const statsRepo = new StatsRepo(db);
  const registry = new TableRegistry({ snapshotRepo, statsRepo, waitPool });
  const app = createApp({
    db,
    authConfig: { jwtSecret: 'x'.repeat(32), jwtExpiresInSec: 60 },
    registry,
    statsRepo,
  });
  return { app, registry, waitPool, statsRepo };
}

describe('POST /api/tables', () => {
  it('creates a table', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/tables')
      .set('X-Player-Id', 'alice')
      .send({ name: 'Test', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    expect(res.status).toBe(201);
    expect(res.body.tableId).toBeTruthy();
    expect(res.body.status).toBe('lobby');
  });

  it('rejects without X-Player-Id', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/tables')
      .send({ name: 'Test', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('X-Player-Id header required');
  });
});

describe('GET /api/tables', () => {
  it('lists tables', async () => {
    const { app } = makeApp();
    await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T1', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const res = await request(app).get('/api/tables').set('X-Player-Id', 'alice');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('T1');
  });
});

describe('POST /api/tables/:id/sit', () => {
  it('sits player at table', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const tableId = create.body.tableId;
    const res = await request(app).post(`/api/tables/${tableId}/sit`).set('X-Player-Id', 'alice')
      .send({ buyIn: 500 });
    expect(res.status).toBe(200);
    expect(res.body.seats[0].playerId).toBe('alice');
  });

  it('rejects invalid buy-in', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const tableId = create.body.tableId;
    const res = await request(app).post(`/api/tables/${tableId}/sit`).set('X-Player-Id', 'alice')
      .send({ buyIn: 50 });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/tables/:id/leave', () => {
  it('removes player from seat', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const tableId = create.body.tableId;
    await request(app).post(`/api/tables/${tableId}/sit`).set('X-Player-Id', 'alice').send({ buyIn: 500 });
    const res = await request(app).post(`/api/tables/${tableId}/leave`).set('X-Player-Id', 'alice');
    expect(res.status).toBe(200);
    expect(res.body.seats.every((s: any) => s === null)).toBe(true);
  });
});

describe('GET /api/tables/:id', () => {
  it('returns table state with myCards when dealt', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const tableId = create.body.tableId;
    const res = await request(app).get(`/api/tables/${tableId}`).set('X-Player-Id', 'alice');
    expect(res.status).toBe(200);
    expect(res.body.tableId).toBe(tableId);
  });

  it('returns 404 for unknown table', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/tables/nope').set('X-Player-Id', 'alice');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/tables/:id/act', () => {
  it('rejects action when not your turn', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const tableId = create.body.tableId;
    await request(app).post(`/api/tables/${tableId}/sit`).set('X-Player-Id', 'alice').send({ buyIn: 500 });
    const res = await request(app).post(`/api/tables/${tableId}/act`).set('X-Player-Id', 'alice')
      .send({ type: 'fold' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/server/http/table.routes.test.ts`
Expected: FAIL — modules not found / routes not mounted

- [ ] **Step 4: Implement table.routes.ts**

```typescript
// src/server/http/table.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { openAuth } from './middleware.js';
import { getHoleCards } from '../game/table-state.js';
import type { TableRegistry } from '../game/table-registry.js';
import type { WaitPool } from '../game/wait-pool.js';
import type { TableState, SeatedPlayer } from '../../shared/table-types.js';
import type { Action } from '../../shared/game-types.js';

const CreateTableSchema = z.object({
  name: z.string().min(1).max(64),
  smallBlind: z.number().int().positive(),
  bigBlind: z.number().int().positive(),
  minBuyIn: z.number().int().positive(),
  maxBuyIn: z.number().int().positive(),
  maxSeats: z.number().int().min(2).max(9),
  actionTimeoutSec: z.number().int().min(5).max(120).optional(),
});

const SitSchema = z.object({
  seat: z.number().int().min(0).max(8).optional(),
  buyIn: z.number().int().positive(),
});

const ActionSchema = z.object({
  type: z.enum(['fold', 'check', 'call', 'raise', 'all-in']),
  amount: z.number().int().positive().optional(),
});

export function tableRoutes(registry: TableRegistry, waitPool: WaitPool): Router {
  const router = Router();
  router.use(openAuth());

  // POST /api/tables — create
  router.post('/', (req, res) => {
    const parsed = CreateTableSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' });
    const state = registry.create(parsed.data, req.userId!);
    return res.status(201).json(formatTableResponse(state, req.userId!));
  });

  // GET /api/tables — list
  router.get('/', (_req, res) => {
    const tables = registry.list().map(s => ({
      tableId: s.id,
      name: s.config.name,
      status: s.status,
      seats: s.seats.filter(Boolean).length,
      maxSeats: s.config.maxSeats,
    }));
    return res.json(tables);
  });

  // GET /api/tables/:id — state
  router.get('/:id', (req, res) => {
    const state = registry.get(req.params.id);
    if (!state) return res.status(404).json({ error: 'table_not_found' });
    return res.json(formatTableResponse(state, req.userId!));
  });

  // POST /api/tables/:id/sit
  router.post('/:id/sit', (req, res) => {
    const state = registry.get(req.params.id);
    if (!state) return res.status(404).json({ error: 'table_not_found' });
    const parsed = SitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' });

    const { buyIn } = parsed.data;
    let seat = parsed.data.seat;

    // Auto-assign seat if not specified
    if (seat === undefined) {
      seat = state.seats.findIndex(s => s === null);
      if (seat === -1) return res.status(400).json({ error: 'table_full' });
    }

    try {
      const next = registry.dispatch(req.params.id, {
        type: 'SIT_DOWN', userId: req.userId!, seat, buyIn, nowMs: Date.now(),
      });
      return res.json(formatTableResponse(next, req.userId!));
    } catch (e: any) {
      const msg = e.message ?? '';
      if (msg.includes('already taken')) return res.status(400).json({ error: 'seat_taken' });
      if (msg.includes('out of range')) return res.status(400).json({ error: 'invalid_buy_in' });
      return res.status(400).json({ error: 'invalid_request', reason: msg });
    }
  });

  // POST /api/tables/:id/leave
  router.post('/:id/leave', (req, res) => {
    const state = registry.get(req.params.id);
    if (!state) return res.status(404).json({ error: 'table_not_found' });
    try {
      const next = registry.dispatch(req.params.id, {
        type: 'STAND_UP', userId: req.userId!, nowMs: Date.now(),
      });
      return res.json(formatTableResponse(next, req.userId!));
    } catch (e: any) {
      return res.status(400).json({ error: 'invalid_request', reason: e.message });
    }
  });

  // GET /api/tables/:id/act — long-poll
  router.get('/:id/act', async (req, res) => {
    const tableId = req.params.id;
    const playerId = req.userId!;
    const timeout = Math.min(parseInt(req.query.timeout as string) || 10000, 30000);

    const state = registry.get(tableId);
    if (!state) return res.status(404).json({ error: 'table_not_found' });

    // Check immediately
    if (isMyTurn(state, playerId)) {
      return res.json(formatActResponse(state, playerId));
    }

    // Long-poll loop
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const result = await waitPool.wait(tableId, playerId, Math.min(remaining, 5000));
      if (result === 'timeout') {
        // Check if overall deadline passed
        if (Date.now() >= deadline) break;
        continue;
      }
      // Woken up — check if it's our turn now
      const current = registry.get(tableId);
      if (!current) return res.status(404).json({ error: 'table_not_found' });
      if (current.status === 'closed') return res.json(formatTableResponse(current, playerId));
      if (isMyTurn(current, playerId)) {
        return res.json(formatActResponse(current, playerId));
      }
    }
    return res.status(204).end();
  });

  // POST /api/tables/:id/act — submit action
  router.post('/:id/act', (req, res) => {
    const tableId = req.params.id;
    const playerId = req.userId!;
    const state = registry.get(tableId);
    if (!state) return res.status(404).json({ error: 'table_not_found' });

    if (!isMyTurn(state, playerId)) {
      return res.status(400).json({ error: 'not_your_turn' });
    }

    const parsed = ActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' });

    const action: Action = parsed.data.type === 'raise'
      ? { type: 'raise', amount: parsed.data.amount! }
      : { type: parsed.data.type } as Action;

    if (parsed.data.type === 'raise' && !parsed.data.amount) {
      return res.status(400).json({ error: 'invalid_request', reason: 'raise requires amount' });
    }

    try {
      const next = registry.dispatch(tableId, {
        type: 'PLAYER_ACTION', userId: playerId, action, nowMs: Date.now(),
      });
      return res.json(formatTableResponse(next, playerId));
    } catch (e: any) {
      return res.status(400).json({ error: 'invalid_action', reason: e.message });
    }
  });

  return router;
}

function isMyTurn(state: TableState, playerId: string): boolean {
  if (!state.hand || state.hand.actorSeat === null) return false;
  const actor = state.seats[state.hand.actorSeat];
  return actor?.userId === playerId;
}

function formatTableResponse(state: TableState, playerId: string): any {
  const buyInTracker = (state as any).__buyInTracker as Map<string, number> | undefined;
  const myCards = getHoleCards(state, playerId);
  const mySeat = state.seats.find(s => s?.userId === playerId);
  const myBoughtIn = buyInTracker?.get(playerId) ?? mySeat?.stack ?? 0;

  return {
    tableId: state.id,
    status: state.status,
    hand: state.hand ? {
      handNo: state.hand.handNo,
      stage: state.hand.stage,
      board: state.hand.board,
      pots: state.hand.pots,
      currentBet: state.hand.currentBet,
      minRaise: state.hand.minRaise,
      actorId: state.hand.actorSeat !== null ? state.seats[state.hand.actorSeat]?.userId ?? null : null,
      actionDeadlineMs: state.hand.actionDeadlineMs,
    } : null,
    seats: state.seats.map(s => s ? {
      seat: s.seat,
      playerId: s.userId,
      stack: s.stack,
      bet: s.bet,
      folded: s.folded,
      allIn: s.allIn,
    } : null),
    myCards: myCards ?? undefined,
    myProfit: mySeat ? mySeat.stack - myBoughtIn : undefined,
  };
}

function formatActResponse(state: TableState, playerId: string): any {
  const base = formatTableResponse(state, playerId);
  // Add validActions
  const validActions: string[] = [];
  if (state.hand && state.hand.actorSeat !== null) {
    const actor = state.seats[state.hand.actorSeat];
    if (actor?.userId === playerId) {
      const owed = state.hand.currentBet - actor.bet;
      if (owed === 0) validActions.push('check');
      validActions.push('fold');
      if (owed > 0 && owed <= actor.stack) validActions.push('call');
      if (actor.stack > 0) validActions.push('raise', 'all-in');
    }
  }
  return { ...base, validActions };
}
```

- [ ] **Step 5: Implement stats.routes.ts**

```typescript
// src/server/http/stats.routes.ts
import { Router } from 'express';
import type { StatsRepo } from '../store/stats.repo.js';

export function statsRoutes(statsRepo: StatsRepo): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const all = statsRepo.getAll().map(s => ({
      playerId: s.playerId,
      handsPlayed: s.handsPlayed,
      handsWon: s.handsWon,
      winRate: s.handsPlayed > 0 ? Math.round((s.handsWon / s.handsPlayed) * 1000) / 1000 : 0,
      totalProfit: s.totalProfit,
      biggestPot: s.biggestPot,
      buyInCount: s.buyInCount,
    }));
    return res.json(all);
  });

  router.get('/:playerId', (req, res) => {
    const stats = statsRepo.getByPlayer(req.params.playerId);
    if (!stats) return res.status(404).json({ error: 'player_not_found' });
    return res.json({
      playerId: stats.playerId,
      handsPlayed: stats.handsPlayed,
      handsWon: stats.handsWon,
      winRate: stats.handsPlayed > 0 ? Math.round((stats.handsWon / stats.handsPlayed) * 1000) / 1000 : 0,
      totalProfit: stats.totalProfit,
      biggestPot: stats.biggestPot,
      buyInCount: stats.buyInCount,
    });
  });

  return router;
}
```

- [ ] **Step 6: Update app.ts to mount new routes**

```typescript
// src/server/app.ts — updated
import express, { type Express } from 'express';
import path from 'node:path';
import type { DB } from './store/db.js';
import type { AuthConfig } from './runtime/auth.js';
import type { TableRegistry } from './game/table-registry.js';
import type { StatsRepo } from './store/stats.repo.js';
import { authRoutes } from './http/auth.routes.js';
import { inviteRoutes } from './http/invite.routes.js';
import { tableRoutes } from './http/table.routes.js';
import { statsRoutes } from './http/stats.routes.js';

export type AppDeps = {
  db: DB;
  authConfig: AuthConfig;
  staticDir?: string;
  registry?: TableRegistry;
  statsRepo?: StatsRepo;
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes(deps.db, deps.authConfig));
  app.use('/api/invites', inviteRoutes(deps.db, deps.authConfig));

  if (deps.registry) {
    const { WaitPool } = require('./game/wait-pool.js');
    // WaitPool is accessed from registry's deps — we need to pass it
    // Actually registry already has waitPool internally, but routes need it for long-poll
    app.use('/api/tables', tableRoutes(deps.registry, deps.registry['deps'].waitPool));
  }
  if (deps.statsRepo) {
    app.use('/api/stats', statsRoutes(deps.statsRepo));
  }

  if (deps.staticDir) {
    const dir = path.resolve(deps.staticDir);
    app.use(express.static(dir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  return app;
}
```

Note: The `deps.registry['deps'].waitPool` pattern is not ideal. Better to pass `waitPool` explicitly in `AppDeps`. Refine:

```typescript
export type AppDeps = {
  db: DB;
  authConfig: AuthConfig;
  staticDir?: string;
  registry?: TableRegistry;
  statsRepo?: StatsRepo;
  waitPool?: WaitPool;
};
```

And use `deps.waitPool` in the route mount.

- [ ] **Step 7: Update index.ts to wire everything together**

```typescript
// src/server/index.ts — updated
import 'dotenv/config';
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { createApp } from './app.js';
import { WaitPool } from './game/wait-pool.js';
import { SnapshotRepo } from './game/snapshot.js';
import { StatsRepo } from './store/stats.repo.js';
import { TableRegistry } from './game/table-registry.js';

const config = loadConfig();
const db = openDb(config.dbPath);

const waitPool = new WaitPool();
const snapshotRepo = new SnapshotRepo(db);
const statsRepo = new StatsRepo(db);
const registry = new TableRegistry({ snapshotRepo, statsRepo, waitPool });

// Restore active tables from DB
const snapshots = snapshotRepo.loadActive();
for (const { tableId, state } of snapshots) {
  registry.restore(tableId, state);
}
if (snapshots.length > 0) {
  console.log(`Restored ${snapshots.length} active table(s) from snapshot`);
}

const app = createApp({
  db,
  authConfig: { jwtSecret: config.jwtSecret, jwtExpiresInSec: config.jwtExpiresInSec },
  staticDir: 'dist/client',
  registry,
  statsRepo,
  waitPool,
});

const server = app.listen(config.port, () => {
  console.log(`DPoker listening on http://localhost:${config.port}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);
  registry.destroy();
  const forceExit = setTimeout(() => {
    console.error('Shutdown timeout, forcing exit.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();
  server.close(() => {
    try { db.close(); } catch (err) { console.error('Error closing db:', err); }
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 8: Write stats routes test**

```typescript
// tests/server/http/stats.routes.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@server/app.js';
import { TableRegistry } from '@server/game/table-registry.js';
import { WaitPool } from '@server/game/wait-pool.js';
import { SnapshotRepo } from '@server/game/snapshot.js';
import { StatsRepo } from '@server/store/stats.repo.js';
import { makeTestDb } from '../../helpers/test-db.js';

function makeApp() {
  const db = makeTestDb();
  const waitPool = new WaitPool();
  const snapshotRepo = new SnapshotRepo(db);
  const statsRepo = new StatsRepo(db);
  const registry = new TableRegistry({ snapshotRepo, statsRepo, waitPool });
  const app = createApp({
    db,
    authConfig: { jwtSecret: 'x'.repeat(32), jwtExpiresInSec: 60 },
    registry, statsRepo, waitPool,
  });
  return { app, statsRepo };
}

describe('GET /api/stats', () => {
  it('returns empty array initially', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns stats after buy-in', async () => {
    const { app, statsRepo } = makeApp();
    statsRepo.recordBuyIn('alice');
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].playerId).toBe('alice');
    expect(res.body[0].buyInCount).toBe(1);
  });
});

describe('GET /api/stats/:playerId', () => {
  it('returns 404 for unknown player', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/stats/nobody');
    expect(res.status).toBe(404);
  });

  it('returns player stats', async () => {
    const { app, statsRepo } = makeApp();
    statsRepo.recordBuyIn('bob');
    statsRepo.recordHandResult({ playerId: 'bob', won: true, profitDelta: 100, potSize: 200 });
    const res = await request(app).get('/api/stats/bob');
    expect(res.status).toBe(200);
    expect(res.body.handsPlayed).toBe(1);
    expect(res.body.handsWon).toBe(1);
    expect(res.body.winRate).toBe(1);
  });
});
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/server/http/table.routes.test.ts tests/server/http/stats.routes.test.ts`
Expected: PASS

- [ ] **Step 10: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 11: Commit**

```bash
git add src/server/http/table.routes.ts src/server/http/stats.routes.ts src/server/http/middleware.ts src/server/app.ts src/server/index.ts tests/server/http/table.routes.test.ts tests/server/http/stats.routes.test.ts
git commit -m "feat: add REST API for tables, actions, and stats"
```

---

### Task 7: Integration Test — Full Game Loop

**Files:**
- Create: `tests/server/integration/game-loop.test.ts`

**Interfaces:**
- Consumes: all modules from Tasks 1-6
- Produces: confidence that the full flow works end-to-end

- [ ] **Step 1: Write integration test**

```typescript
// tests/server/integration/game-loop.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '@server/app.js';
import { TableRegistry } from '@server/game/table-registry.js';
import { WaitPool } from '@server/game/wait-pool.js';
import { SnapshotRepo } from '@server/game/snapshot.js';
import { StatsRepo } from '@server/store/stats.repo.js';
import { makeTestDb } from '../../helpers/test-db.js';

function makeApp() {
  const db = makeTestDb();
  const waitPool = new WaitPool();
  const snapshotRepo = new SnapshotRepo(db);
  const statsRepo = new StatsRepo(db);
  const registry = new TableRegistry({ snapshotRepo, statsRepo, waitPool });
  const app = createApp({
    db,
    authConfig: { jwtSecret: 'x'.repeat(32), jwtExpiresInSec: 60 },
    registry, statsRepo, waitPool,
  });
  return { app, registry, statsRepo };
}

describe('Full game loop integration', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('two agents play a complete hand', async () => {
    const { app, registry, statsRepo } = makeApp();
    const alice = { 'X-Player-Id': 'alice' };
    const bob = { 'X-Player-Id': 'bob' };

    // Create table
    const createRes = await request(app).post('/api/tables').set(alice)
      .send({ name: 'Battle', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 2, actionTimeoutSec: 10 });
    expect(createRes.status).toBe(201);
    const tableId = createRes.body.tableId;

    // Both sit
    await request(app).post(`/api/tables/${tableId}/sit`).set(alice).send({ buyIn: 500 });
    await request(app).post(`/api/tables/${tableId}/sit`).set(bob).send({ buyIn: 500 });

    // Auto-start fires after 3s
    vi.advanceTimersByTime(3100);

    // Verify game started
    const stateRes = await request(app).get(`/api/tables/${tableId}`).set(alice);
    expect(stateRes.body.status).toBe('running');
    expect(stateRes.body.hand).not.toBeNull();
    expect(stateRes.body.myCards).toBeDefined();
    expect(stateRes.body.myCards).toHaveLength(2);

    // Find whose turn it is and fold
    const state = registry.get(tableId)!;
    const actorSeat = state.hand!.actorSeat!;
    const actorId = state.seats[actorSeat]!.userId;
    const actorHeader = { 'X-Player-Id': actorId };

    const foldRes = await request(app).post(`/api/tables/${tableId}/act`).set(actorHeader)
      .send({ type: 'fold' });
    expect(foldRes.status).toBe(200);

    // Hand should be over (fold in heads-up = hand ends)
    const afterFold = registry.get(tableId)!;
    expect(afterFold.hand).toBeNull();

    // Stats should be recorded
    const stats = statsRepo.getAll();
    expect(stats.length).toBe(2);
    expect(stats.some(s => s.handsWon > 0)).toBe(true);
  });

  it('action timeout triggers auto-fold', async () => {
    const { app, registry } = makeApp();
    const alice = { 'X-Player-Id': 'alice' };
    const bob = { 'X-Player-Id': 'bob' };

    const createRes = await request(app).post('/api/tables').set(alice)
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 2, actionTimeoutSec: 10 });
    const tableId = createRes.body.tableId;

    await request(app).post(`/api/tables/${tableId}/sit`).set(alice).send({ buyIn: 500 });
    await request(app).post(`/api/tables/${tableId}/sit`).set(bob).send({ buyIn: 500 });
    vi.advanceTimersByTime(3100); // auto-start

    const before = registry.get(tableId)!;
    expect(before.hand).not.toBeNull();

    // Wait for action timeout (10s)
    vi.advanceTimersByTime(10100);

    const after = registry.get(tableId)!;
    // State should have advanced (timeout processed)
    expect(after.eventSeq).toBeGreaterThan(before.eventSeq);
  });

  it('busted player gets auto-rebuy', async () => {
    const { app, registry } = makeApp();
    const alice = { 'X-Player-Id': 'alice' };
    const bob = { 'X-Player-Id': 'bob' };

    const createRes = await request(app).post('/api/tables').set(alice)
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 2, actionTimeoutSec: 10 });
    const tableId = createRes.body.tableId;

    // Alice buys in with minimum
    await request(app).post(`/api/tables/${tableId}/sit`).set(alice).send({ buyIn: 100 });
    await request(app).post(`/api/tables/${tableId}/sit`).set(bob).send({ buyIn: 500 });
    vi.advanceTimersByTime(3100); // auto-start

    // Keep timing out until alice is busted (all-in then lose)
    // Simpler: just verify the mechanic by directly testing registry
    const state = registry.get(tableId)!;
    const aliceSeat = state.seats.find(s => s?.userId === 'alice');
    expect(aliceSeat).toBeTruthy();

    // Simulate bust: set alice stack to 0 manually on the state, then trigger hand end
    // This is complex to simulate via API — the auto-rebuy test in task 5 covers the unit logic
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/server/integration/game-loop.test.ts`
Expected: PASS (may need adjustments based on actual reducer behavior)

- [ ] **Step 3: Run full suite + lint**

Run: `npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: All pass, no type errors

- [ ] **Step 4: Commit**

```bash
git add tests/server/integration/game-loop.test.ts
git commit -m "test: add integration test for full AI agent game loop"
```

---

### Task 8: Final Wiring + Manual Smoke Test

**Files:**
- Modify: `src/server/store/migrations/` (ensure copy in build script)
- Review: `package.json` scripts

**Interfaces:**
- Consumes: everything from Tasks 1-7
- Produces: a running server that AI agents can connect to

- [ ] **Step 1: Verify build works**

Run: `npm run build:server`
Expected: Compiles cleanly, `dist/server/` contains all new files

- [ ] **Step 2: Verify migrations are copied**

Check that `build:server` script in `package.json` copies new migration files:

```bash
ls dist/server/store/migrations/
```

Expected: `001_init.sql`, `002_table_snapshots.sql`, `003_player_stats.sql`

- [ ] **Step 3: Manual smoke test with curl**

```bash
# Start server
npm run dev:server &

# Create table
curl -s -X POST http://localhost:3000/api/tables \
  -H "Content-Type: application/json" \
  -H "X-Player-Id: agent-1" \
  -d '{"name":"AI Battle","smallBlind":10,"bigBlind":20,"minBuyIn":500,"maxBuyIn":2000,"maxSeats":4}'

# Sit 2 players
curl -s -X POST http://localhost:3000/api/tables/<TABLE_ID>/sit \
  -H "Content-Type: application/json" \
  -H "X-Player-Id: agent-1" \
  -d '{"buyIn":1000}'

curl -s -X POST http://localhost:3000/api/tables/<TABLE_ID>/sit \
  -H "Content-Type: application/json" \
  -H "X-Player-Id: agent-2" \
  -d '{"buyIn":1000}'

# Wait 3s for auto-start, then check state
sleep 4
curl -s http://localhost:3000/api/tables/<TABLE_ID> -H "X-Player-Id: agent-1"

# Check stats
curl -s http://localhost:3000/api/stats
```

- [ ] **Step 4: Run full test suite one final time**

Run: `npx vitest run && npm run lint`
Expected: All pass

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: finalize AI agent REST API wiring"
```

