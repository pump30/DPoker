import { describe, it, expect } from 'vitest';
import { postBlinds, collectBets } from '@server/game/blinds.js';
import type { PlayerBet } from '@server/game/betting.js';

function pb(id: string, stack = 1000): PlayerBet {
  return { id, stack, bet: 0, folded: false, allIn: false, hasActed: false };
}

describe('blinds.postBlinds', () => {
  it('posts SB and BB and sets state for preflop', () => {
    const players = [pb('a'), pb('b'), pb('c')];
    const s = postBlinds({
      players,
      smallBlind: 10,
      bigBlind: 20,
      sbId: 'b',
      bbId: 'c',
      firstActorId: 'a',
    });
    expect(s.currentBet).toBe(20);
    expect(s.minRaise).toBe(20);
    expect(s.actorId).toBe('a');
    expect(s.players.find((p) => p.id === 'a')!.bet).toBe(0);
    expect(s.players.find((p) => p.id === 'b')!.bet).toBe(10);
    expect(s.players.find((p) => p.id === 'c')!.bet).toBe(20);
    expect(s.players.find((p) => p.id === 'b')!.stack).toBe(990);
    expect(s.players.find((p) => p.id === 'c')!.stack).toBe(980);
  });

  it('skips SB when sbId is null (dead button)', () => {
    const players = [pb('a'), pb('b')];
    const s = postBlinds({
      players,
      smallBlind: 10,
      bigBlind: 20,
      sbId: null,
      bbId: 'a',
      firstActorId: 'b',
    });
    expect(s.players.find((p) => p.id === 'a')!.bet).toBe(20);
    expect(s.players.find((p) => p.id === 'b')!.bet).toBe(0);
  });

  it('puts a short stack BB all-in', () => {
    const players = [pb('a'), pb('b', 5), pb('c')]; // b has only 5 chips
    const s = postBlinds({
      players,
      smallBlind: 10,
      bigBlind: 20,
      sbId: 'a',
      bbId: 'b',
      firstActorId: 'c',
    });
    expect(s.players.find((p) => p.id === 'b')!.bet).toBe(5);
    expect(s.players.find((p) => p.id === 'b')!.stack).toBe(0);
    expect(s.players.find((p) => p.id === 'b')!.allIn).toBe(true);
  });

  it('throws when bbId not in players', () => {
    expect(() =>
      postBlinds({
        players: [pb('a')],
        smallBlind: 10,
        bigBlind: 20,
        sbId: null,
        bbId: 'ghost',
        firstActorId: 'a',
      }),
    ).toThrow();
  });
});

describe('blinds.collectBets', () => {
  it('returns contributions and zeros bets', () => {
    const players = [pb('a'), pb('b'), pb('c')];
    players[0].bet = 50;
    players[1].bet = 50;
    players[2].bet = 50;
    players[1].folded = true;
    const { players: cleared, collected } = collectBets({
      players,
      bigBlind: 20,
      currentBet: 50,
      minRaise: 20,
      lastRaiseAmount: 50,
      actorId: 'a',
    });
    expect(collected).toEqual([
      { id: 'a', amount: 50, folded: false },
      { id: 'b', amount: 50, folded: true },
      { id: 'c', amount: 50, folded: false },
    ]);
    expect(cleared.every((p) => p.bet === 0)).toBe(true);
  });

  it('skips zero-bet players', () => {
    const players = [pb('a'), pb('b'), pb('c')];
    players[0].bet = 100; // a raised
    // b and c folded preflop, never put any chips
    const { collected } = collectBets({
      players,
      bigBlind: 20,
      currentBet: 100,
      minRaise: 100,
      lastRaiseAmount: 100,
      actorId: 'a',
    });
    expect(collected).toEqual([{ id: 'a', amount: 100, folded: false }]);
  });
});
