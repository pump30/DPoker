# DPoker Stage 2 — 牌局核心引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 DPoker 全部牌局核心逻辑作为**纯函数模块**，覆盖洗牌、牌型评估、下注合法性、边池切分、All-in 多轮发牌、All-in 投票、鱿鱼模式分发与统计。无 IO、无 socket、无 DB —— 全部输入/输出皆为不可变数据结构，便于单测、重放、审计。

**Architecture:** 所有文件落在 `src/server/game/` 下，纯函数，互不依赖运行时层。共享类型放在 `src/shared/game-types.ts`。所有随机性可注入 seed 以支持 commit-reveal 与可重现测试。

**Tech Stack:** TypeScript（已有），pokersolver（手牌评估），crypto.randomInt + crypto.createHash（commit-reveal），vitest。

**Spec:** `docs/superpowers/specs/2026-05-28-dpoker-design.md`，相关章节：§6 鱿鱼模式、§12.7 边池、§12.8 加注合法性、§12.9 Run It Twice、§12.10 Commit-Reveal。

---

## File Structure

```
src/
├── shared/
│   └── game-types.ts              # Card, Rank, Suit, Stage, Action, Pot 等基础类型
└── server/
    └── game/
        ├── deck.ts                # 洗牌 + 发牌（接受 seed）
        ├── deck-commit.ts         # commit-reveal hash + verify
        ├── hand-evaluator.ts      # 包装 pokersolver
        ├── betting.ts             # 下注合法性、minRaise 推进、不完整 all-in 判定
        ├── pot.ts                 # 边池切分算法
        ├── runout.ts              # 按 N 次（1 或 2）发剩余公共牌
        ├── runout-vote.ts         # 投票汇总（一票否决）
        ├── squid-round.ts         # 鱿鱼模式：本轮状态 + 分发 + 结算
        └── squid-stats.ts         # 多维度统计累加（VPIP/PFR/胜率/最大底池等）

tests/server/game/
├── deck.test.ts
├── deck-commit.test.ts
├── hand-evaluator.test.ts
├── betting.test.ts
├── pot.test.ts
├── runout.test.ts
├── runout-vote.test.ts
├── squid-round.test.ts
└── squid-stats.test.ts
```

---

## Task 1: 共享游戏类型

**Files:**
- Create: `src/shared/game-types.ts`
- Create: `tests/shared/game-types.test.ts`

- [ ] **Step 1: 写 `src/shared/game-types.ts`**

```ts
// Cards
export type Suit = 'h' | 'd' | 'c' | 's'; // hearts, diamonds, clubs, spades
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export type Card = `${Rank}${Suit}`; // e.g. "Ah", "Td"

export const ALL_RANKS: Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A',
];
export const ALL_SUITS: Suit[] = ['h', 'd', 'c', 's'];

// Stages of a hand
export type Stage = 'preflop' | 'flop' | 'turn' | 'river';

// Player actions
export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; amount: number }     // total bet amount this round
  | { type: 'all-in' };

// A pot (main or side)
export type Pot = {
  amount: number;
  eligibleIds: string[]; // player ids that may win this pot
};
```

- [ ] **Step 2: 写测试 `tests/shared/game-types.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { ALL_RANKS, ALL_SUITS, type Card } from '@shared/game-types.js';

describe('game-types', () => {
  it('has 13 ranks and 4 suits', () => {
    expect(ALL_RANKS).toHaveLength(13);
    expect(ALL_SUITS).toHaveLength(4);
  });

  it('Card type is Rank+Suit', () => {
    const card: Card = 'Ah';
    expect(card).toBe('Ah');
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npm test -- tests/shared/game-types.test.ts`
Expected: 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/game-types.ts tests/shared/game-types.test.ts
git commit -m "feat(game): add shared game types (Card, Stage, Action, Pot)"
```

---

## Task 2: 洗牌（Deck）

**Files:**
- Create: `src/server/game/deck.ts`
- Create: `tests/server/game/deck.test.ts`

- [ ] **Step 1: 写失败测试 `tests/server/game/deck.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { freshDeck, shuffle, deal } from '@server/game/deck.js';
import type { Card } from '@shared/game-types.js';

describe('deck', () => {
  it('freshDeck returns 52 unique cards', () => {
    const d = freshDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
  });

  it('shuffle with same seed is deterministic', () => {
    const seed = Buffer.from('a'.repeat(64), 'hex'); // 32 bytes
    const a = shuffle(freshDeck(), seed);
    const b = shuffle(freshDeck(), seed);
    expect(a).toEqual(b);
  });

  it('shuffle with different seeds differs', () => {
    const a = shuffle(freshDeck(), Buffer.from('a'.repeat(64), 'hex'));
    const b = shuffle(freshDeck(), Buffer.from('b'.repeat(64), 'hex'));
    expect(a).not.toEqual(b);
  });

  it('shuffled deck is a permutation', () => {
    const original = freshDeck();
    const shuffled = shuffle(original, Buffer.from('c'.repeat(64), 'hex'));
    expect(new Set(shuffled)).toEqual(new Set(original));
    expect(shuffled).toHaveLength(52);
  });

  it('deal pops top N cards and returns updated remaining', () => {
    const d: Card[] = ['Ah', 'Kd', 'Qc', 'Js', 'Th'];
    const { dealt, remaining } = deal(d, 3);
    expect(dealt).toEqual(['Ah', 'Kd', 'Qc']);
    expect(remaining).toEqual(['Js', 'Th']);
  });

  it('deal throws if not enough cards', () => {
    expect(() => deal(['Ah'], 2)).toThrow();
  });

  it('shuffle does not mutate input', () => {
    const original = freshDeck();
    const copy = [...original];
    shuffle(original, Buffer.from('d'.repeat(64), 'hex'));
    expect(original).toEqual(copy);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/server/game/deck.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现 `src/server/game/deck.ts`**

```ts
import { createHash } from 'node:crypto';
import { ALL_RANKS, ALL_SUITS, type Card } from '../../shared/game-types.js';

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of ALL_RANKS) {
    for (const s of ALL_SUITS) {
      deck.push(`${r}${s}` as Card);
    }
  }
  return deck;
}

/**
 * Shuffle using Fisher-Yates with a deterministic stream of integers
 * derived from the given seed via SHA-256(seed || counter). Returns a
 * NEW array; does not mutate input.
 *
 * The seed is exactly 32 bytes (the serverSeed of commit-reveal).
 */
export function shuffle(deck: readonly Card[], seed: Buffer): Card[] {
  if (seed.length !== 32) {
    throw new Error('seed must be 32 bytes');
  }
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextInt(seed, i, i + 1); // [0, i]
    const tmp = out[i];
    out[i] = out[r];
    out[r] = tmp;
  }
  return out;
}

/**
 * Return an integer in [0, max) sampled deterministically from
 * sha256(seed || counter).
 *
 * Uses rejection sampling to avoid modulo bias:
 *   threshold = 2^32 - (2^32 % max)
 *   keep first 4-byte chunk < threshold, mod max
 */
function nextInt(seed: Buffer, counter: number, max: number): number {
  if (max <= 0) throw new Error('max must be > 0');
  if (max === 1) return 0;
  const threshold = Math.floor(0x100000000 / max) * max;
  let attempt = 0;
  while (true) {
    const h = createHash('sha256');
    h.update(seed);
    h.update(Buffer.from(`${counter}-${attempt}`, 'utf8'));
    const digest = h.digest();
    // Each digest is 32 bytes = 8 4-byte chunks
    for (let off = 0; off + 4 <= digest.length; off += 4) {
      const v = digest.readUInt32BE(off);
      if (v < threshold) return v % max;
    }
    attempt++;
  }
}

/**
 * Deal N cards off the top of the deck. Returns dealt + remaining.
 */
export function deal(deck: readonly Card[], n: number): { dealt: Card[]; remaining: Card[] } {
  if (n > deck.length) throw new Error('not enough cards to deal');
  return {
    dealt: deck.slice(0, n),
    remaining: deck.slice(n),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/server/game/deck.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/game/deck.ts tests/server/game/deck.test.ts
git commit -m "feat(game): add deterministic deck with seed-based shuffle"
```

---

## Task 3: Commit-Reveal 洗牌审计

**Files:**
- Create: `src/server/game/deck-commit.ts`
- Create: `tests/server/game/deck-commit.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { generateSeed, commitOf, verifyCommit, deriveDeck } from '@server/game/deck-commit.js';
import { shuffle, freshDeck } from '@server/game/deck.js';

describe('deck-commit', () => {
  it('generateSeed returns 32-byte buffer', () => {
    const s = generateSeed();
    expect(s.length).toBe(32);
  });

  it('commitOf is deterministic', () => {
    const seed = Buffer.from('a'.repeat(64), 'hex');
    expect(commitOf(seed)).toBe(commitOf(seed));
  });

  it('commitOf produces 64-hex-char string (sha256)', () => {
    const seed = Buffer.from('a'.repeat(64), 'hex');
    expect(commitOf(seed)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifyCommit accepts matching seed/commit', () => {
    const seed = generateSeed();
    const commit = commitOf(seed);
    expect(verifyCommit(seed, commit)).toBe(true);
  });

  it('verifyCommit rejects tampered seed', () => {
    const seed = generateSeed();
    const commit = commitOf(seed);
    const tampered = Buffer.from(seed);
    tampered[0] ^= 0xff;
    expect(verifyCommit(tampered, commit)).toBe(false);
  });

  it('deriveDeck shuffles using the seed (matches direct shuffle)', () => {
    const seed = Buffer.from('e'.repeat(64), 'hex');
    expect(deriveDeck(seed)).toEqual(shuffle(freshDeck(), seed));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/server/game/deck-commit.test.ts`
Expected: FAIL.

- [ ] **Step 3: 实现 `src/server/game/deck-commit.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';
import type { Card } from '../../shared/game-types.js';
import { freshDeck, shuffle } from './deck.js';

export function generateSeed(): Buffer {
  return randomBytes(32);
}

export function commitOf(seed: Buffer): string {
  return createHash('sha256').update(seed).digest('hex');
}

export function verifyCommit(seed: Buffer, expectedCommit: string): boolean {
  return commitOf(seed) === expectedCommit;
}

export function deriveDeck(seed: Buffer): Card[] {
  return shuffle(freshDeck(), seed);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/server/game/deck-commit.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/game/deck-commit.ts tests/server/game/deck-commit.test.ts
git commit -m "feat(game): add commit-reveal helpers for deck audit"
```

---

## Task 4: 手牌评估

**Files:**
- Create: `src/server/game/hand-evaluator.ts`
- Create: `tests/server/game/hand-evaluator.test.ts`

- [ ] **Step 1: 安装 pokersolver**

```bash
npm install pokersolver
npm install --save-dev @types/pokersolver
```

If `@types/pokersolver` doesn't exist on npm, skip the dev install — declare types locally instead (see Step 3).

- [ ] **Step 2: 写失败测试 `tests/server/game/hand-evaluator.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { evaluateHand, compareWinners, type HandResult } from '@server/game/hand-evaluator.js';
import type { Card } from '@shared/game-types.js';

describe('hand-evaluator', () => {
  it('evaluates a flush', () => {
    const hole: [Card, Card] = ['Ah', 'Kh'];
    const board: Card[] = ['2h', '7h', 'Th', '5d', '3c'];
    const r: HandResult = evaluateHand(hole, board);
    expect(r.rankName.toLowerCase()).toContain('flush');
  });

  it('evaluates a pair', () => {
    const r = evaluateHand(['Ah', 'As'], ['2c', '5d', '7h', 'Tc', 'Ks']);
    expect(r.rankName.toLowerCase()).toContain('pair');
  });

  it('compareWinners picks the better hand', () => {
    const board: Card[] = ['As', 'Kh', 'Qd', 'Jc', '2h'];
    const players = [
      { id: 'p1', hole: ['Td', '9c'] as [Card, Card] }, // straight A-T
      { id: 'p2', hole: ['9s', '9d'] as [Card, Card] }, // pair of 9s
    ];
    const winners = compareWinners(players, board);
    expect(winners.map((w) => w.id)).toEqual(['p1']);
  });

  it('compareWinners returns multiple ids for split pot', () => {
    const board: Card[] = ['Ah', 'Kd', 'Qc', 'Js', 'Th'];
    const players = [
      { id: 'p1', hole: ['2c', '3d'] as [Card, Card] },
      { id: 'p2', hole: ['4c', '5d'] as [Card, Card] },
    ];
    // Both play the board straight A-T → split
    const winners = compareWinners(players, board);
    expect(new Set(winners.map((w) => w.id))).toEqual(new Set(['p1', 'p2']));
  });
});
```

- [ ] **Step 3: 实现 `src/server/game/hand-evaluator.ts`**

If pokersolver lacks types, declare them inline:

```ts
// At the top of the file, before the imports:
declare module 'pokersolver' {
  export class Hand {
    static solve(cards: string[]): Hand;
    static winners(hands: Hand[]): Hand[];
    name: string;
    descr: string;
  }
}
```

Now the implementation:

```ts
import { Hand } from 'pokersolver';
import type { Card } from '../../shared/game-types.js';

export type HandResult = {
  rankName: string;     // e.g. 'Flush', 'Pair', 'Two Pair'
  description: string;  // human-readable e.g. 'Flush, Ah High'
};

export type PlayerCards = {
  id: string;
  hole: [Card, Card];
};

export function evaluateHand(hole: [Card, Card], board: Card[]): HandResult {
  const all = [...hole, ...board];
  const h = Hand.solve(all);
  return { rankName: h.name, description: h.descr };
}

/**
 * Given player hole cards and a 5-card board, return the winning player ids.
 * Multiple ids = split pot.
 */
export function compareWinners(
  players: readonly PlayerCards[],
  board: readonly Card[],
): PlayerCards[] {
  if (board.length !== 5) {
    throw new Error('board must contain exactly 5 cards');
  }
  const hands = players.map((p) => ({
    player: p,
    hand: Hand.solve([...p.hole, ...board]),
  }));
  const winningHands = Hand.winners(hands.map((h) => h.hand));
  return hands.filter((h) => winningHands.includes(h.hand)).map((h) => h.player);
}
```

- [ ] **Step 4: 运行测试**

Run: `npm test -- tests/server/game/hand-evaluator.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/game/hand-evaluator.ts tests/server/game/hand-evaluator.test.ts package.json package-lock.json
git commit -m "feat(game): add hand evaluator wrapping pokersolver"
```

---

## Task 5: 边池切分（Pot）

**Files:**
- Create: `src/server/game/pot.ts`
- Create: `tests/server/game/pot.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { splitIntoPots, type Contribution } from '@server/game/pot.js';

describe('pot.splitIntoPots', () => {
  it('single pot when all bet equal and none folded', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 100, folded: false },
      { id: 'b', amount: 100, folded: false },
      { id: 'c', amount: 100, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(new Set(pots[0].eligibleIds)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('side pot for one all-in short', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 50, folded: false },   // short stack all-in
      { id: 'b', amount: 200, folded: false },
      { id: 'c', amount: 200, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    // main pot at 50 each = 150 (all eligible), side pot at 150 from b/c each = 300
    expect(pots).toEqual([
      { amount: 150, eligibleIds: expect.arrayContaining(['a', 'b', 'c']) },
      { amount: 300, eligibleIds: expect.arrayContaining(['b', 'c']) },
    ]);
  });

  it('three layers when two all-ins of different sizes', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 50, folded: false },
      { id: 'b', amount: 100, folded: false },
      { id: 'c', amount: 200, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    // layer1: 50*3=150 a/b/c, layer2: 50*2=100 b/c, layer3: 100*1=100 c
    expect(pots).toHaveLength(3);
    expect(pots[0]).toEqual({ amount: 150, eligibleIds: expect.arrayContaining(['a', 'b', 'c']) });
    expect(pots[1]).toEqual({ amount: 100, eligibleIds: expect.arrayContaining(['b', 'c']) });
    expect(pots[2]).toEqual({ amount: 100, eligibleIds: ['c'] });
  });

  it('folded player chips contribute but they are not eligible', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 100, folded: true },   // folded
      { id: 'b', amount: 100, folded: false },
      { id: 'c', amount: 100, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(new Set(pots[0].eligibleIds)).toEqual(new Set(['b', 'c']));
  });

  it('multiple players same all-in amount merge', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 50, folded: false },
      { id: 'b', amount: 50, folded: false },
      { id: 'c', amount: 200, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    expect(pots).toHaveLength(2);
    expect(pots[0]).toEqual({ amount: 150, eligibleIds: expect.arrayContaining(['a', 'b', 'c']) });
    expect(pots[1]).toEqual({ amount: 150, eligibleIds: ['c'] });
  });

  it('zero contribution is ignored', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 0, folded: false },
      { id: 'b', amount: 100, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    expect(pots).toEqual([{ amount: 100, eligibleIds: ['b'] }]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/server/game/pot.test.ts`
Expected: FAIL.

- [ ] **Step 3: 实现 `src/server/game/pot.ts`**

```ts
import type { Pot } from '../../shared/game-types.js';

export type Contribution = {
  id: string;
  amount: number;
  folded: boolean;
};

/**
 * Layered side-pot split.
 *
 * Algorithm:
 *  1. Collect distinct positive amounts in ascending order.
 *  2. For each level L, the layer height is (L - prevL).
 *     Contribution to that pot = layerHeight * (#players whose total >= L).
 *     Eligible ids = active (not folded) players whose total >= L.
 *  3. Folded players' chips are still added (via the count of contribs >= L)
 *     but they are not in eligibleIds.
 */
export function splitIntoPots(contribs: readonly Contribution[]): Pot[] {
  const positive = contribs.filter((c) => c.amount > 0);
  if (positive.length === 0) return [];

  const levels = [...new Set(positive.map((c) => c.amount))].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const layerHeight = level - prev;
    const contribsAtOrAbove = positive.filter((c) => c.amount >= level);
    const amount = layerHeight * contribsAtOrAbove.length;
    const eligibleIds = contribsAtOrAbove
      .filter((c) => !c.folded)
      .map((c) => c.id);
    if (amount > 0 && eligibleIds.length > 0) {
      pots.push({ amount, eligibleIds });
    } else if (amount > 0 && eligibleIds.length === 0) {
      // edge: all contributors at this level folded; chips orphaned in
      // the immediately-higher pot. In poker, folded players forfeit chips,
      // and we collapse: add to the next non-empty pot or the previous one.
      // For simplicity we attach to the previous pot if any.
      if (pots.length > 0) {
        pots[pots.length - 1].amount += amount;
      } else {
        // No prior pot — shouldn't happen in practice. Drop the chips.
      }
    }
    prev = level;
  }
  return pots;
}
```

- [ ] **Step 4: 运行测试**

Run: `npm test -- tests/server/game/pot.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/game/pot.ts tests/server/game/pot.test.ts
git commit -m "feat(game): add layered side-pot split with folded-player handling"
```

---

## Task 6: 下注合法性

**Files:**
- Create: `src/server/game/betting.ts`
- Create: `tests/server/game/betting.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { validateAction, applyAction, type BettingState, type PlayerBet } from '@server/game/betting.js';

function makeState(overrides: Partial<BettingState> = {}): BettingState {
  return {
    players: [
      { id: 'a', stack: 1000, bet: 0, folded: false, allIn: false, hasActed: false },
      { id: 'b', stack: 1000, bet: 0, folded: false, allIn: false, hasActed: false },
      { id: 'c', stack: 1000, bet: 0, folded: false, allIn: false, hasActed: false },
    ],
    bigBlind: 20,
    currentBet: 0,
    minRaise: 20,
    lastRaiseAmount: 0,
    actorId: 'a',
    ...overrides,
  };
}

describe('betting.validateAction', () => {
  it('check is OK when no current bet', () => {
    const r = validateAction(makeState(), { type: 'check' });
    expect(r.ok).toBe(true);
  });

  it('check is illegal when there is a bet to call', () => {
    const r = validateAction(makeState({ currentBet: 50 }), { type: 'check' });
    expect(r.ok).toBe(false);
  });

  it('call is OK when there is a bet', () => {
    const r = validateAction(makeState({ currentBet: 50 }), { type: 'call' });
    expect(r.ok).toBe(true);
  });

  it('raise must be at least minRaise above currentBet', () => {
    const s = makeState({ currentBet: 50, minRaise: 50 });
    expect(validateAction(s, { type: 'raise', amount: 99 }).ok).toBe(false);
    expect(validateAction(s, { type: 'raise', amount: 100 }).ok).toBe(true);
  });

  it('raise above stack is rejected (must use all-in)', () => {
    const s = makeState();
    s.players[0].stack = 50;
    expect(validateAction(s, { type: 'raise', amount: 100 }).ok).toBe(false);
  });

  it('all-in is always legal if stack > 0', () => {
    expect(validateAction(makeState(), { type: 'all-in' }).ok).toBe(true);
  });

  it('fold is always legal', () => {
    expect(validateAction(makeState(), { type: 'fold' }).ok).toBe(true);
  });
});

describe('betting.applyAction', () => {
  it('fold marks player folded and ends their turn', () => {
    const s = makeState();
    const ns = applyAction(s, { type: 'fold' });
    const a = ns.players.find((p) => p.id === 'a')!;
    expect(a.folded).toBe(true);
    expect(a.hasActed).toBe(true);
  });

  it('call sets bet to currentBet', () => {
    const s = makeState({ currentBet: 50 });
    const ns = applyAction(s, { type: 'call' });
    const a = ns.players.find((p) => p.id === 'a')!;
    expect(a.bet).toBe(50);
    expect(a.stack).toBe(950);
    expect(a.hasActed).toBe(true);
  });

  it('raise updates currentBet and minRaise; resets others hasActed', () => {
    const s = makeState({ currentBet: 50, minRaise: 50, lastRaiseAmount: 50 });
    s.players[1].hasActed = true;
    const ns = applyAction(s, { type: 'raise', amount: 150 });
    expect(ns.currentBet).toBe(150);
    expect(ns.minRaise).toBe(100); // raise increment
    expect(ns.lastRaiseAmount).toBe(100);
    // other unfolded players reset to hasActed=false
    expect(ns.players.find((p) => p.id === 'b')!.hasActed).toBe(false);
  });

  it('partial all-in (less than min-raise) does NOT reopen action', () => {
    // currentBet=100, minRaise=100. Player short stack 150 goes all-in.
    // 150 > 100 (call) but < 200 (full min-raise). Should not reopen.
    const s = makeState({ currentBet: 100, minRaise: 100, lastRaiseAmount: 100 });
    s.players[0].stack = 150;
    s.players[1].hasActed = true;
    const ns = applyAction(s, { type: 'all-in' });
    const a = ns.players.find((p) => p.id === 'a')!;
    expect(a.allIn).toBe(true);
    expect(a.bet).toBe(150);
    expect(a.stack).toBe(0);
    // currentBet rises to 150 but minRaise stays at 100 (no full raise)
    expect(ns.currentBet).toBe(150);
    expect(ns.lastRaiseAmount).toBe(100);
    // b's hasActed is preserved (no reopen)
    expect(ns.players.find((p) => p.id === 'b')!.hasActed).toBe(true);
  });

  it('full all-in (>= min-raise) reopens action', () => {
    const s = makeState({ currentBet: 100, minRaise: 100, lastRaiseAmount: 100 });
    s.players[0].stack = 300; // can full raise
    s.players[1].hasActed = true;
    const ns = applyAction(s, { type: 'all-in' });
    expect(ns.currentBet).toBe(300);
    expect(ns.lastRaiseAmount).toBe(200);
    expect(ns.minRaise).toBe(200);
    expect(ns.players.find((p) => p.id === 'b')!.hasActed).toBe(false);
  });
});
```

- [ ] **Step 2: 实现 `src/server/game/betting.ts`**

```ts
import type { Action } from '../../shared/game-types.js';

export type PlayerBet = {
  id: string;
  stack: number;
  bet: number;        // current bet in this round
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
};

export type BettingState = {
  players: PlayerBet[];
  bigBlind: number;
  currentBet: number;     // highest bet this round
  minRaise: number;       // minimum legal raise INCREMENT (not total amount)
  lastRaiseAmount: number;
  actorId: string;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateAction(state: BettingState, action: Action): ValidationResult {
  const player = state.players.find((p) => p.id === state.actorId);
  if (!player) return { ok: false, reason: 'no_actor' };
  if (player.folded) return { ok: false, reason: 'folded' };
  if (player.allIn) return { ok: false, reason: 'all_in' };

  const owed = state.currentBet - player.bet;

  switch (action.type) {
    case 'fold':
      return { ok: true };
    case 'check':
      return owed === 0 ? { ok: true } : { ok: false, reason: 'must_call' };
    case 'call':
      if (owed === 0) return { ok: false, reason: 'nothing_to_call' };
      if (owed > player.stack) return { ok: false, reason: 'insufficient_stack' };
      return { ok: true };
    case 'raise': {
      const total = action.amount;
      if (total <= state.currentBet) return { ok: false, reason: 'raise_too_small' };
      if (total - state.currentBet < state.minRaise) {
        return { ok: false, reason: 'below_min_raise' };
      }
      const cost = total - player.bet;
      if (cost > player.stack) return { ok: false, reason: 'insufficient_stack' };
      return { ok: true };
    }
    case 'all-in':
      if (player.stack === 0) return { ok: false, reason: 'no_chips' };
      return { ok: true };
  }
}

export function applyAction(state: BettingState, action: Action): BettingState {
  const players = state.players.map((p) => ({ ...p }));
  const me = players.find((p) => p.id === state.actorId)!;

  let { currentBet, minRaise, lastRaiseAmount } = state;
  let reopened = false;

  switch (action.type) {
    case 'fold':
      me.folded = true;
      me.hasActed = true;
      break;
    case 'check':
      me.hasActed = true;
      break;
    case 'call': {
      const owed = currentBet - me.bet;
      const pay = Math.min(owed, me.stack);
      me.stack -= pay;
      me.bet += pay;
      if (me.stack === 0) me.allIn = true;
      me.hasActed = true;
      break;
    }
    case 'raise': {
      const total = action.amount;
      const cost = total - me.bet;
      me.stack -= cost;
      me.bet = total;
      const raiseIncrement = total - currentBet;
      currentBet = total;
      lastRaiseAmount = raiseIncrement;
      minRaise = raiseIncrement;
      if (me.stack === 0) me.allIn = true;
      me.hasActed = true;
      reopened = true;
      break;
    }
    case 'all-in': {
      const totalBet = me.bet + me.stack;
      const raiseIncrement = totalBet - currentBet;
      const cost = me.stack;
      me.stack = 0;
      me.bet = totalBet;
      me.allIn = true;
      me.hasActed = true;
      // Update currentBet only if this exceeds it
      if (totalBet > currentBet) {
        currentBet = totalBet;
        if (raiseIncrement >= minRaise) {
          // full raise: reopen
          minRaise = raiseIncrement;
          lastRaiseAmount = raiseIncrement;
          reopened = true;
        }
        // else: partial raise, keep minRaise/lastRaiseAmount, do NOT reopen
      }
      break;
    }
  }

  if (reopened) {
    for (const p of players) {
      if (p.id !== me.id && !p.folded && !p.allIn) {
        p.hasActed = false;
      }
    }
  }

  return {
    ...state,
    players,
    currentBet,
    minRaise,
    lastRaiseAmount,
  };
}
```

- [ ] **Step 3: 运行测试**

Run: `npm test -- tests/server/game/betting.test.ts`
Expected: 11 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/game/betting.ts tests/server/game/betting.test.ts
git commit -m "feat(game): add betting validator and reducer with min-raise + partial all-in handling"
```

---

## Task 7: Run-It-Twice 发牌

**Files:**
- Create: `src/server/game/runout.ts`
- Create: `tests/server/game/runout.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { runRemainder, type RunoutInput } from '@server/game/runout.js';
import type { Card } from '@shared/game-types.js';

const deck: Card[] = [
  '2c', '3c', '4c', '5c', '6c', '7c', '8c', '9c', 'Tc', 'Jc',
  'Qc', 'Kc', 'Ac', '2d', '3d', '4d', '5d',
];

describe('runout.runRemainder', () => {
  it('preflop runs 5-card board with 1 burn before flop, 1 before turn, 1 before river when count=1', () => {
    const r = runRemainder({ deck, currentBoard: [], runs: 1 });
    // expected board: deck[1..3] (skip burn at 0), deck[5] (skip burn at 4), deck[7] (skip burn at 6)
    expect(r.boards).toEqual([['3c', '4c', '5c', '7c', '9c']]);
  });

  it('flop already dealt: turn/river have one burn each', () => {
    const r = runRemainder({
      deck,
      currentBoard: ['Ah' as Card, 'Kh' as Card, 'Qh' as Card],
      runs: 1,
    });
    // turn: skip burn at 0, take deck[1]; river: skip burn at 2, take deck[3]
    expect(r.boards).toEqual([['Ah', 'Kh', 'Qh', '3c', '5c']]);
  });

  it('runs=2 produces two distinct boards from same deck (river time)', () => {
    const r = runRemainder({
      deck,
      currentBoard: ['Ah', 'Kh', 'Qh', 'Jh'] as Card[],
      runs: 2,
    });
    // first run: burn deck[0], river deck[1]; second run: burn deck[2], river deck[3]
    expect(r.boards).toEqual([
      ['Ah', 'Kh', 'Qh', 'Jh', '3c'],
      ['Ah', 'Kh', 'Qh', 'Jh', '5c'],
    ]);
  });

  it('runs=2 at flop time: each run burns + flops + burns + turns + burns + rivers (separate streams)', () => {
    const r = runRemainder({ deck, currentBoard: [], runs: 2 });
    // run 1: burn 0, flop 1-3, burn 4, turn 5, burn 6, river 7
    // run 2: burn 8, flop 9-11, burn 12, turn 13, burn 14, river 15 (need 16 cards, deck has 17)
    expect(r.boards[0]).toEqual(['3c', '4c', '5c', '7c', '9c']);
    expect(r.boards[1]).toEqual(['Jc', 'Qc', 'Kc', '3d', '5d']);
  });

  it('throws when not enough cards', () => {
    expect(() =>
      runRemainder({ deck: deck.slice(0, 2), currentBoard: [], runs: 1 }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: 实现 `src/server/game/runout.ts`**

```ts
import type { Card } from '../../shared/game-types.js';

export type RunoutInput = {
  deck: readonly Card[];   // remaining deck (after holes already dealt)
  currentBoard: readonly Card[]; // 0, 3, or 4 cards
  runs: 1 | 2;
};

export type RunoutResult = {
  boards: Card[][]; // length === runs; each is the full 5-card board
};

const STAGES_TO_DEAL: Record<number, { burn: number; reveal: number }[]> = {
  // Map from currentBoard length to the sequence of (burn,reveal) steps remaining
  0: [
    { burn: 1, reveal: 3 }, // flop
    { burn: 1, reveal: 1 }, // turn
    { burn: 1, reveal: 1 }, // river
  ],
  3: [
    { burn: 1, reveal: 1 }, // turn
    { burn: 1, reveal: 1 }, // river
  ],
  4: [
    { burn: 1, reveal: 1 }, // river
  ],
};

export function runRemainder(input: RunoutInput): RunoutResult {
  const seq = STAGES_TO_DEAL[input.currentBoard.length];
  if (!seq) throw new Error(`unsupported board length ${input.currentBoard.length}`);

  const boards: Card[][] = [];
  let cursor = 0;

  for (let r = 0; r < input.runs; r++) {
    const board = [...input.currentBoard];
    for (const step of seq) {
      cursor += step.burn;
      if (cursor + step.reveal > input.deck.length) {
        throw new Error('not enough cards for runout');
      }
      board.push(...input.deck.slice(cursor, cursor + step.reveal));
      cursor += step.reveal;
    }
    boards.push(board);
  }

  return { boards };
}
```

- [ ] **Step 3: 运行测试**

Run: `npm test -- tests/server/game/runout.test.ts`
Expected: 5 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/game/runout.ts tests/server/game/runout.test.ts
git commit -m "feat(game): add runout that completes the board for 1 or 2 runs"
```

---

## Task 8: All-in 投票（一票否决）

**Files:**
- Create: `src/server/game/runout-vote.ts`
- Create: `tests/server/game/runout-vote.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { resolveRunoutVotes, type Vote } from '@server/game/runout-vote.js';

describe('runout-vote.resolveRunoutVotes', () => {
  it('all vote 2 → 2', () => {
    const votes: Vote[] = [
      { playerId: 'a', choice: 2 },
      { playerId: 'b', choice: 2 },
    ];
    expect(resolveRunoutVotes(votes, 2)).toBe(2);
  });

  it('any vote of 1 → 1', () => {
    const votes: Vote[] = [
      { playerId: 'a', choice: 2 },
      { playerId: 'b', choice: 1 },
    ];
    expect(resolveRunoutVotes(votes, 2)).toBe(1);
  });

  it('no votes → defaultCount', () => {
    expect(resolveRunoutVotes([], 2)).toBe(2);
    expect(resolveRunoutVotes([], 1)).toBe(1);
  });

  it('partial votes (some abstain) → existing votes count, abstainers default', () => {
    // 'a' votes 2, 'b' abstains. With defaultCount=1, 'b' counts as 1 → result 1.
    const votes: Vote[] = [{ playerId: 'a', choice: 2 }];
    expect(resolveRunoutVotes(votes, 1, ['a', 'b'])).toBe(1);
    // With defaultCount=2 abstainers count as 2 → result 2
    expect(resolveRunoutVotes(votes, 2, ['a', 'b'])).toBe(2);
  });

  it('duplicate votes from same player: latest wins', () => {
    const votes: Vote[] = [
      { playerId: 'a', choice: 2 },
      { playerId: 'a', choice: 1 },
    ];
    expect(resolveRunoutVotes(votes, 2)).toBe(1);
  });
});
```

- [ ] **Step 2: 实现 `src/server/game/runout-vote.ts`**

```ts
export type Vote = {
  playerId: string;
  choice: 1 | 2;
};

/**
 * Resolve the all-in runout count vote.
 *
 * Rule: any explicit "1" vote forces 1. If voterIds is provided, abstainers
 * are treated as choosing defaultCount.
 *
 * If voterIds is omitted, only the supplied votes count; missing voters
 * are not implicitly counted (caller is responsible for collecting them).
 */
export function resolveRunoutVotes(
  votes: readonly Vote[],
  defaultCount: 1 | 2,
  voterIds?: readonly string[],
): 1 | 2 {
  // Latest vote per player wins
  const latest = new Map<string, 1 | 2>();
  for (const v of votes) {
    latest.set(v.playerId, v.choice);
  }

  if (voterIds) {
    for (const id of voterIds) {
      if (!latest.has(id)) latest.set(id, defaultCount);
    }
  }

  if (latest.size === 0) return defaultCount;

  for (const choice of latest.values()) {
    if (choice === 1) return 1;
  }
  return 2;
}
```

- [ ] **Step 3: 运行测试**

Run: `npm test -- tests/server/game/runout-vote.test.ts`
Expected: 5 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/game/runout-vote.ts tests/server/game/runout-vote.test.ts
git commit -m "feat(game): add runout vote resolver with one-veto rule"
```

---

## Task 9: 鱿鱼模式本轮状态

**Files:**
- Create: `src/server/game/squid-round.ts`
- Create: `tests/server/game/squid-round.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import {
  newSquidRound,
  distributeSquid,
  isRoundComplete,
  settleRound,
  resetForRoster,
  type SquidRoundState,
  type HandOutcome,
} from '@server/game/squid-round.js';

const POINTS = 10;

function freshRound(playerIds: string[]): SquidRoundState {
  return newSquidRound(playerIds, POINTS);
}

const win = (id: string): HandOutcome => ({ kind: 'single-winner', winnerId: id });
const split = (ids: string[]): HandOutcome => ({ kind: 'split', winnerIds: ids });

describe('squid-round', () => {
  it('newSquidRound: totalSquids = N - 1', () => {
    const r = freshRound(['a', 'b', 'c', 'd']);
    expect(r.totalSquids).toBe(3);
    expect(r.holders.size).toBe(0);
    expect(r.pendingCarryOver).toBe(0);
  });

  it('single winner with no held squids gets one squid', () => {
    let r = freshRound(['a', 'b', 'c']); // total 2 squids
    r = distributeSquid(r, win('a'));
    expect(r.holders.get('a')).toBe(1);
    expect(r.pendingCarryOver).toBe(0);
  });

  it('split pot carries over the squid to next hand', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, split(['a', 'b']));
    expect(r.holders.size).toBe(0);
    expect(r.pendingCarryOver).toBe(1);
  });

  it('next hand after split awards 2 squids to single winner (carry+current)', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, split(['a', 'b'])); // pending=1
    r = distributeSquid(r, win('c'));
    expect(r.holders.get('c')).toBe(1);
    // Only 1 squid is awarded (rule: same player cannot hold more than 1)
    // Carryover remaining: 2 - 1 = 1
    expect(r.pendingCarryOver).toBe(1);
  });

  it('winner who already holds a squid → squid carried over', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, win('a'));     // a holds 1
    r = distributeSquid(r, win('a'));     // a already has, carry
    expect(r.holders.get('a')).toBe(1);
    expect(r.pendingCarryOver).toBe(1);
  });

  it('isRoundComplete when N-1 unique holders', () => {
    let r = freshRound(['a', 'b', 'c']);
    expect(isRoundComplete(r)).toBe(false);
    r = distributeSquid(r, win('a'));
    expect(isRoundComplete(r)).toBe(false);
    r = distributeSquid(r, win('b'));
    expect(isRoundComplete(r)).toBe(true); // 2 squids = N-1
  });

  it('settleRound: loser pays POINTS to each holder', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, win('a'));
    r = distributeSquid(r, win('b'));
    const settlement = settleRound(r);
    expect(settlement.loserId).toBe('c');
    expect(settlement.payouts).toEqual([
      { playerId: 'a', delta: POINTS },
      { playerId: 'b', delta: POINTS },
      { playerId: 'c', delta: -POINTS * 2 },
    ]);
  });

  it('settleRound throws if round not complete', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, win('a'));
    expect(() => settleRound(r)).toThrow();
  });

  it('resetForRoster recomputes totalSquids and clears state', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, win('a'));
    const reset = resetForRoster(r, ['a', 'b', 'c', 'd', 'e']);
    expect(reset.totalSquids).toBe(4);
    expect(reset.holders.size).toBe(0);
    expect(reset.pendingCarryOver).toBe(0);
  });
});
```

- [ ] **Step 2: 实现 `src/server/game/squid-round.ts`**

```ts
export type HandOutcome =
  | { kind: 'single-winner'; winnerId: string }
  | { kind: 'split'; winnerIds: string[] };

export type SquidRoundState = {
  roster: string[];            // current roster ids
  totalSquids: number;
  pointsPerSquid: number;
  holders: Map<string, number>;
  pendingCarryOver: number;
};

export type SquidSettlement = {
  loserId: string;
  payouts: Array<{ playerId: string; delta: number }>;
};

export function newSquidRound(playerIds: readonly string[], pointsPerSquid: number): SquidRoundState {
  return {
    roster: [...playerIds],
    totalSquids: Math.max(0, playerIds.length - 1),
    pointsPerSquid,
    holders: new Map(),
    pendingCarryOver: 0,
  };
}

export function distributeSquid(round: SquidRoundState, outcome: HandOutcome): SquidRoundState {
  const toAward = 1 + round.pendingCarryOver;

  if (outcome.kind === 'split') {
    return { ...round, holders: new Map(round.holders), pendingCarryOver: toAward };
  }

  const winner = outcome.winnerId;
  const holders = new Map(round.holders);
  const has = holders.get(winner) ?? 0;
  if (has >= 1) {
    return { ...round, holders, pendingCarryOver: toAward };
  }
  holders.set(winner, 1);
  return { ...round, holders, pendingCarryOver: Math.max(0, toAward - 1) };
}

export function isRoundComplete(round: SquidRoundState): boolean {
  let held = 0;
  for (const v of round.holders.values()) held += v;
  return held === round.totalSquids && round.totalSquids > 0;
}

export function settleRound(round: SquidRoundState): SquidSettlement {
  if (!isRoundComplete(round)) {
    throw new Error('round not complete');
  }
  const losers = round.roster.filter((id) => (round.holders.get(id) ?? 0) === 0);
  if (losers.length !== 1) {
    throw new Error(`expected exactly one loser, got ${losers.length}`);
  }
  const loserId = losers[0];
  const payouts = round.roster.map((id) => {
    if (id === loserId) {
      return { playerId: id, delta: -round.pointsPerSquid * round.totalSquids };
    }
    return { playerId: id, delta: round.pointsPerSquid };
  });
  return { loserId, payouts };
}

export function resetForRoster(round: SquidRoundState, playerIds: readonly string[]): SquidRoundState {
  return newSquidRound(playerIds, round.pointsPerSquid);
}
```

- [ ] **Step 3: 运行测试**

Run: `npm test -- tests/server/game/squid-round.test.ts`
Expected: 9 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/game/squid-round.ts tests/server/game/squid-round.test.ts
git commit -m "feat(game): add squid round state with distribute/settle/reset"
```

---

## Task 10: 多维度统计

**Files:**
- Create: `src/server/game/squid-stats.ts`
- Create: `tests/server/game/squid-stats.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { initStats, applyHand, type StatsState, type HandSummary } from '@server/game/squid-stats.js';

const players = ['a', 'b', 'c'];

describe('squid-stats', () => {
  it('initStats yields zeros for each player', () => {
    const s = initStats(players);
    for (const id of players) {
      const row = s.get(id)!;
      expect(row.handsPlayed).toBe(0);
      expect(row.handsWon).toBe(0);
      expect(row.vpipCount).toBe(0);
      expect(row.pfrCount).toBe(0);
      expect(row.showdownWon).toBe(0);
      expect(row.biggestPot).toBe(0);
    }
  });

  it('applyHand: hands_played increments for everyone in the hand', () => {
    let s = initStats(players);
    const hand: HandSummary = {
      participants: ['a', 'b', 'c'],
      vpipPlayers: ['a', 'b'],
      pfrPlayers: ['a'],
      winners: ['a'],
      showdownReached: true,
      potTotal: 500,
    };
    s = applyHand(s, hand);
    for (const id of players) {
      expect(s.get(id)!.handsPlayed).toBe(1);
    }
    expect(s.get('a')!.handsWon).toBe(1);
    expect(s.get('b')!.handsWon).toBe(0);
    expect(s.get('a')!.vpipCount).toBe(1);
    expect(s.get('b')!.vpipCount).toBe(1);
    expect(s.get('c')!.vpipCount).toBe(0);
    expect(s.get('a')!.pfrCount).toBe(1);
    expect(s.get('b')!.pfrCount).toBe(0);
    expect(s.get('a')!.showdownWon).toBe(1);
    expect(s.get('a')!.biggestPot).toBe(500);
  });

  it('biggestPot tracks max across hands', () => {
    let s = initStats(players);
    const h1: HandSummary = { participants: players, vpipPlayers: [], pfrPlayers: [], winners: ['a'], showdownReached: false, potTotal: 100 };
    const h2: HandSummary = { participants: players, vpipPlayers: [], pfrPlayers: [], winners: ['b'], showdownReached: false, potTotal: 800 };
    const h3: HandSummary = { participants: players, vpipPlayers: [], pfrPlayers: [], winners: ['a'], showdownReached: false, potTotal: 300 };
    s = applyHand(s, h1);
    s = applyHand(s, h2);
    s = applyHand(s, h3);
    expect(s.get('a')!.biggestPot).toBe(300);
    expect(s.get('b')!.biggestPot).toBe(800);
  });

  it('showdownWon only counts when showdownReached', () => {
    let s = initStats(players);
    const h: HandSummary = { participants: players, vpipPlayers: [], pfrPlayers: [], winners: ['a'], showdownReached: false, potTotal: 100 };
    s = applyHand(s, h);
    expect(s.get('a')!.handsWon).toBe(1);
    expect(s.get('a')!.showdownWon).toBe(0);
  });

  it('split pot: each winner counts as a win', () => {
    let s = initStats(players);
    const h: HandSummary = { participants: players, vpipPlayers: [], pfrPlayers: [], winners: ['a', 'b'], showdownReached: true, potTotal: 200 };
    s = applyHand(s, h);
    expect(s.get('a')!.handsWon).toBe(1);
    expect(s.get('b')!.handsWon).toBe(1);
    expect(s.get('c')!.handsWon).toBe(0);
  });

  it('initStats is independent of stats history', () => {
    const s1 = initStats(['a']);
    const s2 = initStats(['a']);
    s1.get('a')!.handsPlayed = 99;
    expect(s2.get('a')!.handsPlayed).toBe(0);
  });
});
```

- [ ] **Step 2: 实现 `src/server/game/squid-stats.ts`**

```ts
export type StatRow = {
  handsPlayed: number;
  handsWon: number;
  vpipCount: number;
  pfrCount: number;
  showdownWon: number;
  biggestPot: number;
};

export type StatsState = Map<string, StatRow>;

export type HandSummary = {
  participants: string[];   // players who paid blinds / hole cards dealt
  vpipPlayers: string[];    // voluntarily put money in pot preflop
  pfrPlayers: string[];     // first preflop raisers
  winners: string[];        // 1+ winning ids
  showdownReached: boolean;
  potTotal: number;
};

export function initStats(playerIds: readonly string[]): StatsState {
  const m: StatsState = new Map();
  for (const id of playerIds) {
    m.set(id, {
      handsPlayed: 0,
      handsWon: 0,
      vpipCount: 0,
      pfrCount: 0,
      showdownWon: 0,
      biggestPot: 0,
    });
  }
  return m;
}

function bump(row: StatRow): StatRow {
  return { ...row };
}

export function applyHand(state: StatsState, hand: HandSummary): StatsState {
  const out: StatsState = new Map();
  for (const [id, row] of state) {
    out.set(id, bump(row));
  }
  // ensure all participants tracked
  for (const id of hand.participants) {
    if (!out.has(id)) out.set(id, { handsPlayed: 0, handsWon: 0, vpipCount: 0, pfrCount: 0, showdownWon: 0, biggestPot: 0 });
  }

  for (const id of hand.participants) {
    const r = out.get(id)!;
    r.handsPlayed++;
  }
  for (const id of hand.vpipPlayers) {
    out.get(id)!.vpipCount++;
  }
  for (const id of hand.pfrPlayers) {
    out.get(id)!.pfrCount++;
  }
  for (const id of hand.winners) {
    const r = out.get(id)!;
    r.handsWon++;
    if (hand.showdownReached) r.showdownWon++;
    if (hand.potTotal > r.biggestPot) r.biggestPot = hand.potTotal;
  }
  return out;
}
```

- [ ] **Step 3: 运行测试**

Run: `npm test -- tests/server/game/squid-stats.test.ts`
Expected: 6 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/game/squid-stats.ts tests/server/game/squid-stats.test.ts
git commit -m "feat(game): add multi-dimensional hand stats accumulator"
```

---

## Task 11: 全测试与 build 校验，标 stage-2-complete

- [ ] **Step 1: 跑全部测试**

Run: `npm test`
Expected: All passing. Stage 1 had 44; Stage 2 adds:
- shared/game-types: 2
- deck: 7
- deck-commit: 6
- hand-evaluator: 4
- pot: 6
- betting: 11
- runout: 5
- runout-vote: 5
- squid-round: 9
- squid-stats: 6
Total = 44 + 61 = 105.

Exact final total may vary by minor ±2 depending on test refinements; aim for ≥ 100.

- [ ] **Step 2: TypeScript 校验**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Build 校验**

```bash
npm run build:client && npm run build:server && rm -rf dist/
```
Expected: success.

- [ ] **Step 4: 标记**

```bash
git tag stage-2-complete
git log --oneline stage-1-complete..HEAD
```
Expected: 11 new commits (Tasks 1-10 each 1, Task 11 no commit).

---

## Stage 2 完成 — 后续阶段

Stage 3 will integrate this engine into a stateful state machine driven by Socket.IO events. Stage 2's pure functions are foundation.

**Stage 2 plan ends.**
