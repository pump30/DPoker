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

  const pot = currentBet; // approximate pot for presets

  function act(action: Action) {
    useGame.getState().send({ type: 'PLAYER_ACTION', tableId, action });
  }

  function setPreset(fraction: number) {
    const amount = Math.min(Math.max(Math.round(pot * fraction), minRaiseTotal), maxRaise);
    setRaiseAmount(amount);
  }

  return (
    <div className="action-bar">
      <button className="btn btn--md btn--fold" onClick={() => act({ type: 'fold' })}>
        Fold
      </button>

      {canCheck ? (
        <button className="btn btn--md btn--check" onClick={() => act({ type: 'check' })}>
          Check
        </button>
      ) : (
        <button
          className="btn btn--md btn--call"
          onClick={() => act({ type: 'call' })}
          disabled={toCall > myStack}
        >
          Call {Math.min(toCall, myStack)}
        </button>
      )}

      {myStack > toCall && (
        <div className="action-bar__raise-group">
          <div className="action-bar__slider-wrap">
            <div className="action-bar__presets">
              <button className="action-bar__preset-btn" onClick={() => setPreset(0.5)} type="button">
                1/2
              </button>
              <button className="action-bar__preset-btn" onClick={() => setPreset(0.75)} type="button">
                3/4
              </button>
              <button className="action-bar__preset-btn" onClick={() => setPreset(1)} type="button">
                Pot
              </button>
            </div>
            <input
              type="range"
              className="raise-slider"
              min={minRaiseTotal}
              max={maxRaise}
              value={raiseAmount}
              onChange={(e) => setRaiseAmount(+e.target.value)}
            />
            <div className="action-bar__amount">{raiseAmount}</div>
          </div>
          <button className="btn btn--md btn--raise" onClick={() => act({ type: 'raise', amount: raiseAmount })}>
            Raise
          </button>
          <button className="btn btn--md btn--allin" onClick={() => act({ type: 'all-in' })}>
            All-In
          </button>
        </div>
      )}
    </div>
  );
}
