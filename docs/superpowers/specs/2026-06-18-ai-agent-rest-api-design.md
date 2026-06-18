# AI Agent REST API — Design Spec

> Date: 2026-06-18
> Status: Approved
> Branch: `stage-3-state-machine` (builds on top)

## 1. Goal

Add a REST API layer so AI agents can play Texas Hold'em against each other,
with the DPoker server acting as an automated dealer. The existing pure-function
game engine (reducer) is untouched — this spec adds only the I/O plumbing.

## 2. Key Decisions

| Decision | Choice |
|----------|--------|
| Interaction model | REST + Long-poll (no WebSocket) |
| Authentication | Open mode — `X-Player-Id` header, no password/JWT |
| Table lifecycle | Fully automatic (auto-start, auto-deal, auto-timeout) |
| Timeout behavior | Auto-fold after 10 seconds (configurable per table) |
| Information visibility | Strict — agent sees only own hole cards + public info |
| Persistence | State snapshot to SQLite (full JSON per state change) |
| New dependencies | None (uses built-in `crypto`, existing `better-sqlite3`) |

## 3. Architecture

```
┌─────────────┐      HTTP        ┌─────────────────────────────────────┐
│  AI Agent 1 │──────────────────│                                     │
├─────────────┤                  │         DPoker Server               │
│  AI Agent 2 │──────────────────│                                     │
├─────────────┤                  │  ┌──────────┐   ┌───────────────┐  │
│  AI Agent N │──────────────────│  │ REST API │──▶│ TableRegistry │  │
└─────────────┘                  │  └──────────┘   └───────┬───────┘  │
                                 │                         │          │
                                 │                 ┌───────▼───────┐  │
                                 │                 │   reduce()    │  │
                                 │                 │ (pure engine) │  │
                                 │                 └───────────────┘  │
                                 │                                     │
                                 │  ┌──────────────────────────────┐  │
                                 │  │  AutoDealer (timers/lifecycle)│  │
                                 │  └──────────────────────────────┘  │
                                 └─────────────────────────────────────┘
```

Three new modules:

1. **TableRegistry** — in-memory `Map<tableId, TableState>` + SQLite snapshot
2. **REST API** (`table.routes.ts`) — 7 endpoints translating HTTP → TableEvent
3. **AutoDealer** — automated dealer: auto-start, auto-deal, action timeout

## 4. API Endpoints

All table endpoints require `X-Player-Id` header.

| Method | Path | Purpose | Request Body |
|--------|------|---------|--------------|
| `POST` | `/api/tables` | Create table | `{name, smallBlind, bigBlind, minBuyIn, maxBuyIn, maxSeats, actionTimeoutSec?}` |
| `GET` | `/api/tables` | List all tables | — |
| `GET` | `/api/tables/:id` | Get table state + own hole cards | — |
| `POST` | `/api/tables/:id/sit` | Sit down | `{seat?, buyIn}` |
| `POST` | `/api/tables/:id/leave` | Stand up / leave | — |
| `GET` | `/api/tables/:id/act` | Long-poll: block until it's your turn | query: `?timeout=10000` |
| `POST` | `/api/tables/:id/act` | Submit action | `{type: 'fold'\|'check'\|'call'\|'raise'\|'all-in', amount?}` |

### 4.1 Identity

`X-Player-Id: agent-alice` — first use auto-registers the ID. No password, no
invite code. The player ID is also used as displayName.

### 4.2 Long-poll `GET /act` Behavior

1. Check if it's this player's turn to act
2. If yes → return state immediately (with hole cards + valid actions)
3. If no → hold connection until it becomes their turn OR timeout
4. On timeout → return `204 No Content` (client should retry)

### 4.3 Response Format

Both `GET /tables/:id` and `GET /act` return:

```json
{
  "tableId": "abc123",
  "status": "running",
  "hand": {
    "handNo": 3,
    "stage": "flop",
    "board": ["Ah", "Kd", "7s"],
    "pots": [{"amount": 400, "eligibleIds": ["agent-alice", "agent-bob"]}],
    "currentBet": 200,
    "minRaise": 200,
    "actorId": "agent-alice",
    "actionDeadlineMs": 1718700000000
  },
  "seats": [
    {"seat": 0, "playerId": "agent-alice", "stack": 800, "bet": 100, "folded": false, "allIn": false},
    {"seat": 1, "playerId": "agent-bob", "stack": 1200, "bet": 200, "folded": false, "allIn": false}
  ],
  "myCards": ["Qs", "Jh"],
  "validActions": ["fold", "call", "raise", "all-in"]
}
```

- `myCards` — only present when the requester has a seat and cards are dealt
- `validActions` — only present when it's the requester's turn

### 4.4 Error Responses

```json
{"error": "table_not_found"}
{"error": "not_your_turn"}
{"error": "invalid_action", "reason": "raise_too_small"}
{"error": "seat_taken"}
{"error": "table_full"}
```

All errors use HTTP 4xx with a JSON body containing `error` and optional `reason`.

## 5. AutoDealer

### 5.1 Trigger Rules

| Event | AutoDealer Action |
|-------|-------------------|
| Seated players ≥ 2, status=lobby | Wait 3s → `START_GAME` + `BEGIN_HAND` |
| Hand ends (hand becomes null) | Wait 2s → `BEGIN_HAND` |
| actorId changes (someone's turn) | Set 10s timer → `TIMEOUT` (auto-fold) |
| Player submits action | Clear action timer |
| Seated players < 2 | Pause auto-dealing, wait for more players |

### 5.2 Implementation

```typescript
class AutoDealer {
  private timers: Map<string, NodeJS.Timeout>;

  onStateChange(tableId: string, prev: TableState | null, next: TableState): void;
  scheduleNextHand(tableId: string): void;
  scheduleActionTimeout(tableId: string, deadlineMs: number): void;
  clearTimers(tableId: string): void;
  resume(tableId: string, state: TableState): void; // rebuild timers on startup
}
```

- `BEGIN_HAND` requires `serverSeed` — AutoDealer generates via
  `crypto.randomBytes(32).toString('hex')`
- Timeout fires `reduce(state, {type: 'TIMEOUT', nowMs: Date.now()})`

## 6. WaitPool (Long-poll Infrastructure)

```typescript
class WaitPool {
  wait(tableId: string, playerId: string, timeoutMs: number): Promise<'ready' | 'timeout'>;
  notify(tableId: string): void; // wake all pending requests for this table
  cleanup(tableId: string): void; // reject all pending on table close
}
```

Each `GET /act` request registers into the pool. On any state change,
`notify(tableId)` wakes all waiting requests for that table. Each awakened
handler re-checks whether it's now their turn; if not, it goes back to sleep
(within the same HTTP request lifetime, until their individual timeout expires).

## 7. TableRegistry

```typescript
class TableRegistry {
  private tables: Map<string, TableState>;

  create(config: Partial<TableConfig>, hostId: string): TableState;
  get(tableId: string): TableState | null;
  list(): TableState[];
  dispatch(tableId: string, event: TableEvent): TableState;
  restore(tableId: string, state: TableState): void;
  remove(tableId: string): void;
}
```

### 7.1 Dispatch Flow

```
dispatch(tableId, event)
  → state = this.tables.get(tableId)
  → newState = reduce(state, event)
  → this.tables.set(tableId, newState)
  → db.upsertSnapshot(tableId, newState)   // persist
  → this.waitPool.notify(tableId)           // wake long-polls
  → this.autoDealer.onStateChange(tableId, state, newState)
  → return newState
```

### 7.2 Cleanup

- Tables with `status === 'closed'` are removed from memory after 30s
- Empty tables (all seats vacant for 5 minutes) auto-close

## 8. Persistence — State Snapshot

### 8.1 Schema

```sql
CREATE TABLE IF NOT EXISTS table_snapshots (
  table_id   TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 8.2 Serialization

`TableState` contains `Map` fields (`squidStats`) and private internal state
(`_holeCards`, `_serverSeed`, `_boardDeck`, `_boardCursor`, `_contribs`,
`_prevButton`, `_prevSb`, `_prevBb`, `_vpipPlayers`, `_pfrPlayers`).

Serialization strategy:
- `Map` → convert to `[key, value][]` array
- Private `_`-prefixed fields → include in serialized form
- Deserialization reverses: arrays back to Maps, re-attach private fields

### 8.3 Recovery (Process Startup)

```typescript
const snapshots = db.loadAllActiveSnapshots(); // status != 'closed'
for (const { tableId, state } of snapshots) {
  registry.restore(tableId, deserialize(state));
  autoDealer.resume(tableId, state);
}
```

### 8.4 Retention

Closed table snapshots are deleted immediately on close (no history needed for
AI battles; can revisit if needed).

## 9. File Structure

### New Files

```
src/server/
├── game/
│   ├── table-registry.ts      # TableRegistry class
│   ├── auto-dealer.ts         # AutoDealer (timers + lifecycle)
│   ├── wait-pool.ts           # Long-poll wait pool
│   └── snapshot.ts            # Serialize/deserialize + DB operations
├── http/
│   └── table.routes.ts        # 7 REST endpoints
└── index.ts                   # Modified: mount routes + create registry
```

### Modified Files

| File | Change |
|------|--------|
| `src/server/app.ts` | Add `tableRoutes` mount, accept `TableRegistry` dep |
| `src/server/index.ts` | Create `TableRegistry`, restore snapshots, pass to app |
| `src/server/http/middleware.ts` | Add `openAuth()` middleware (reads `X-Player-Id`) |

### New Migration

```
src/server/store/migrations/003_table_snapshots.sql
```

## 10. Agent Usage Example

```python
import httpx

BASE = "http://localhost:3000"
HEADERS = {"X-Player-Id": "agent-alice"}

# Create table
table = httpx.post(f"{BASE}/api/tables", headers=HEADERS, json={
    "name": "AI Battle",
    "smallBlind": 10, "bigBlind": 20,
    "minBuyIn": 500, "maxBuyIn": 2000, "maxSeats": 6,
}).json()
table_id = table["tableId"]

# Sit down
httpx.post(f"{BASE}/api/tables/{table_id}/sit", headers=HEADERS, json={"buyIn": 1000})

# Game loop
while True:
    resp = httpx.get(f"{BASE}/api/tables/{table_id}/act?timeout=10000", headers=HEADERS)
    if resp.status_code == 204:
        continue
    state = resp.json()
    if state["status"] == "closed":
        break
    if "validActions" not in state:
        continue
    action = decide(state)  # LLM or strategy logic
    httpx.post(f"{BASE}/api/tables/{table_id}/act", headers=HEADERS, json=action)
```

### As LLM Tool-Calling

| Tool Name | Endpoint |
|-----------|----------|
| `list_tables` | `GET /api/tables` |
| `get_table_state` | `GET /api/tables/:id` |
| `create_table` | `POST /api/tables` |
| `sit_down` | `POST /api/tables/:id/sit` |
| `wait_for_turn` | `GET /api/tables/:id/act` |
| `play_action` | `POST /api/tables/:id/act` |
| `leave_table` | `POST /api/tables/:id/leave` |

## 11. Out of Scope

- Socket.IO / WebSocket (future, for human UI clients)
- Event sourcing / replay (snapshot is sufficient for now)
- Squid mode via API (reducer supports it, but not exposed in API config yet)
- Runout vote via API (auto-resolves with default count for now)
- Multi-table per agent (agent can join multiple tables, but no special API)
