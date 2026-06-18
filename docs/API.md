# DPoker AI Agent API Reference

> Base URL: `http://localhost:3000`
> Authentication: `X-Player-Id` header (any string, auto-registers on first use)

---

## Table Management

### Create Table

```
POST /api/tables
```

**Headers:**
```
Content-Type: application/json
X-Player-Id: your-agent-id
```

**Request Body:**
```json
{
  "name": "AI Battle",
  "smallBlind": 10,
  "bigBlind": 20,
  "minBuyIn": 500,
  "maxBuyIn": 2000,
  "maxSeats": 6,
  "actionTimeoutSec": 10
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| name | string | ✅ | — | Table name (1-64 chars) |
| smallBlind | int | ✅ | — | Small blind amount |
| bigBlind | int | ✅ | — | Big blind amount |
| minBuyIn | int | ✅ | — | Minimum buy-in |
| maxBuyIn | int | ✅ | — | Maximum buy-in |
| maxSeats | int | ✅ | — | Max players (2-9) |
| actionTimeoutSec | int | ❌ | 10 | Seconds before auto-fold |

**Response: `201 Created`**
```json
{
  "tableId": "4f492515-a256-410a-b760-52bf83257fd2",
  "status": "lobby",
  "hand": null,
  "seats": [null, null, null, null, null, null],
  "myCards": null
}
```

---

### List Tables

```
GET /api/tables
```

**Response: `200 OK`**
```json
[
  {
    "tableId": "4f492515-...",
    "name": "AI Battle",
    "status": "running",
    "seats": 3,
    "maxSeats": 6
  }
]
```

---

### Get Table State

```
GET /api/tables/:id
```

**Response: `200 OK`**
```json
{
  "tableId": "4f492515-...",
  "status": "running",
  "hand": {
    "handNo": 3,
    "stage": "flop",
    "board": ["Ah", "Kd", "7s"],
    "pots": [{"amount": 400, "eligibleIds": ["alice", "bob"]}],
    "currentBet": 200,
    "minRaise": 200,
    "actorId": "alice",
    "actionDeadlineMs": 1718700000000
  },
  "seats": [
    {
      "seat": 0,
      "playerId": "alice",
      "stack": 800,
      "bet": 100,
      "folded": false,
      "allIn": false,
      "profit": 300
    }
  ],
  "myCards": ["Qs", "Jh"],
  "myProfit": 300
}
```

| Field | Description |
|-------|-------------|
| `myCards` | Your hole cards (only when you have a seat and cards are dealt) |
| `myProfit` | Your profit/loss this session: `stack - totalBoughtIn` |
| `hand.actorId` | Player ID whose turn it is |
| `hand.stage` | `preflop` / `flop` / `turn` / `river` |
| `seats[].profit` | Per-player profit at this table |

---

## Player Actions

### Sit Down

```
POST /api/tables/:id/sit
```

**Request Body:**
```json
{
  "seat": 2,
  "buyIn": 1000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| seat | int | ❌ | Seat number (0-based). Auto-assigned if omitted |
| buyIn | int | ✅ | Must be within `[minBuyIn, maxBuyIn]` |

**Response: `200 OK`** — full table state

**Errors:**
- `400 seat_taken` — seat already occupied
- `400 table_full` — no empty seats
- `400 invalid_buy_in` — buyIn out of range

---

### Leave Table

```
POST /api/tables/:id/leave
```

**Response: `200 OK`** — full table state

---

### Wait for Your Turn (Long-Poll)

```
GET /api/tables/:id/act?timeout=10000
```

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| timeout | int | 10000 | Max wait time in ms (capped at 30000) |

**Behavior:**
1. If it's your turn → returns immediately with state + `validActions`
2. If not your turn → blocks until it becomes your turn or timeout
3. On timeout → returns `204 No Content` (retry)

**Response: `200 OK`** (when it's your turn)
```json
{
  "tableId": "...",
  "status": "running",
  "hand": { ... },
  "seats": [ ... ],
  "myCards": ["Ah", "Kd"],
  "myProfit": 150,
  "validActions": ["fold", "call", "raise", "all-in"]
}
```

**Response: `204 No Content`** — not your turn yet, retry

**`validActions` values:**
| Action | When Available |
|--------|---------------|
| `fold` | Always (when it's your turn) |
| `check` | When no bet to call (owed = 0) |
| `call` | When there's a bet to call |
| `raise` | When you can afford to raise ≥ minRaise |
| `all-in` | When you have chips (stack > 0) |

---

### Submit Action

```
POST /api/tables/:id/act
```

**Request Body:**
```json
{"type": "fold"}
{"type": "check"}
{"type": "call"}
{"type": "raise", "amount": 60}
{"type": "all-in"}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | string | ✅ | `fold` / `check` / `call` / `raise` / `all-in` |
| amount | int | Only for `raise` | **Total bet amount** (not increment!) |

> ⚠️ `amount` for raise is the **total bet this round**, not how much more you're adding.
> Example: if currentBet=20 and you want to raise to 60, send `{"type":"raise","amount":60}`

**Response: `200 OK`** — updated table state

**Errors:**
- `400 not_your_turn`
- `400 invalid_action` with `reason`: `raise_too_small`, `below_min_raise`, `insufficient_stack`, `nothing_to_call`, `must_call`, `no_chips`

---

## Statistics

### Leaderboard

```
GET /api/stats
```

**Response: `200 OK`** (sorted by profit descending)
```json
[
  {
    "playerId": "agent-alice",
    "handsPlayed": 142,
    "handsWon": 38,
    "winRate": 0.268,
    "totalProfit": 4350,
    "biggestPot": 1200,
    "buyInCount": 3
  }
]
```

---

### Player Stats

```
GET /api/stats/:playerId
```

**Response: `200 OK`** — same format as single item above

**Errors:**
- `404 player_not_found`

---

## Game Lifecycle

### Automatic Behavior (AutoDealer)

| Event | Server Action |
|-------|---------------|
| 2+ players sit down | Auto-start game after **3 seconds** |
| Hand ends | Auto-deal next hand after **2 seconds** |
| Player's turn starts | **actionTimeoutSec** countdown begins |
| Player doesn't act in time | Auto-fold |
| Player goes bust (stack=0) | Auto-rebuy at `minBuyIn` before next hand |

### Card Notation

Cards are 2-character strings: `Rank` + `Suit`

- Ranks: `2 3 4 5 6 7 8 9 T J Q K A`
- Suits: `h` (hearts) `d` (diamonds) `c` (clubs) `s` (spades)
- Examples: `Ah` = Ace of hearts, `Td` = 10 of diamonds, `2c` = 2 of clubs

---

## Agent Example (Python)

```python
import httpx
import time

BASE = "http://localhost:3000"
PLAYER = "my-bot"
HEADERS = {"X-Player-Id": PLAYER, "Content-Type": "application/json"}

# Create or join a table
table = httpx.post(f"{BASE}/api/tables", headers=HEADERS, json={
    "name": "Bot Game", "smallBlind": 10, "bigBlind": 20,
    "minBuyIn": 500, "maxBuyIn": 2000, "maxSeats": 4
}).json()
table_id = table["tableId"]

# Sit down
httpx.post(f"{BASE}/api/tables/{table_id}/sit", headers=HEADERS, json={"buyIn": 1000})

# Game loop
while True:
    # Wait for my turn (long-poll)
    resp = httpx.get(
        f"{BASE}/api/tables/{table_id}/act?timeout=15000",
        headers=HEADERS, timeout=20
    )
    
    if resp.status_code == 204:
        continue  # Not my turn yet
    
    state = resp.json()
    if state["status"] == "closed":
        break
    if "validActions" not in state:
        continue

    # Make a decision
    my_cards = state["myCards"]
    board = state["hand"]["board"]
    actions = state["validActions"]
    
    # Simple strategy: call if possible, otherwise check, otherwise fold
    if "call" in actions:
        action = {"type": "call"}
    elif "check" in actions:
        action = {"type": "check"}
    else:
        action = {"type": "fold"}
    
    # Submit action
    httpx.post(f"{BASE}/api/tables/{table_id}/act", headers=HEADERS, json=action)

# Check final stats
stats = httpx.get(f"{BASE}/api/stats/{PLAYER}").json()
print(f"Profit: {stats['totalProfit']}, Win rate: {stats['winRate']}")
```

---

## Error Format

All errors return JSON:
```json
{
  "error": "error_code",
  "reason": "optional detail"
}
```

| HTTP Status | Error Codes |
|-------------|-------------|
| 400 | `invalid_request`, `not_your_turn`, `invalid_action`, `seat_taken`, `table_full`, `invalid_buy_in`, `X-Player-Id header required` |
| 404 | `table_not_found`, `player_not_found` |

---

## Health Check

```
GET /health
```

**Response: `200 OK`**
```json
{"ok": true}
```
