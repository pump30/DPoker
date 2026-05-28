import { useState } from 'react';
import { useGame } from '../game/store.js';
import type { Action } from '../../shared/game-types.js';

type Props = {
  tableId: string;
  currentBet: number;
  myBet: number;
  myStack: number;
  bigBlind: number;
  minRaise: number;
};

export function ActionBar({ tableId, currentBet, myBet, myStack, bigBlind: _bigBlind, minRaise }: Props) {
  const toCall = currentBet - myBet;
  const canCheck = toCall === 0;
  const minRaiseTotal = currentBet + minRaise;
  const maxRaise = myStack + myBet;
  const [raiseAmount, setRaiseAmount] = useState(Math.min(minRaiseTotal, maxRaise));

  function act(action: Action) {
    useGame.getState().send({ type: 'PLAYER_ACTION', tableId, action });
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button onClick={() => act({ type: 'fold' })} style={{ padding: '10px 16px', background: '#f44336', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>
        Fold
      </button>

      {canCheck ? (
        <button onClick={() => act({ type: 'check' })} style={{ padding: '10px 16px', background: '#4caf50', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>
          Check
        </button>
      ) : (
        <button onClick={() => act({ type: 'call' })} disabled={toCall > myStack} style={{ padding: '10px 16px', background: '#2196f3', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>
          Call {Math.min(toCall, myStack)}
        </button>
      )}

      {myStack > toCall && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="range"
            min={minRaiseTotal}
            max={maxRaise}
            value={raiseAmount}
            onChange={(e) => setRaiseAmount(+e.target.value)}
            style={{ width: 100 }}
          />
          <button onClick={() => act({ type: 'raise', amount: raiseAmount })} style={{ padding: '10px 16px', background: '#ff9800', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>
            Raise {raiseAmount}
          </button>
          <button onClick={() => act({ type: 'all-in' })} style={{ padding: '10px 16px', background: '#9c27b0', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>
            All-In
          </button>
        </div>
      )}
    </div>
  );
}
