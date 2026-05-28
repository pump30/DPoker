import { useEffect } from 'react';
import { useGame } from '../game/store.js';
import { useAuth } from '../store/auth.js';
import { PokerTable } from '../components/PokerTable.js';
import { ActionBar } from '../components/ActionBar.js';
import { RunoutVoteModal } from '../components/RunoutVoteModal.js';
import { SquidPanel } from '../components/SquidPanel.js';

export function Table({ tableId, onBack }: { tableId: string; onBack: () => void }) {
  const { connectToTable, disconnect, tableState, holeCards, voteRequest, squidSettlement, handResult } = useGame();
  const userId = useAuth((s) => s.user?.id);

  useEffect(() => {
    connectToTable(tableId);
    return () => disconnect();
  }, [tableId]);

  if (!tableState) {
    return (
      <div className="flex-center" style={{ height: '100dvh' }}>
        <span className="text-secondary">Connecting...</span>
      </div>
    );
  }

  const myUserId = userId || '';
  const mySeat = tableState.seats.find((s) => s?.userId === myUserId);
  const isHost = tableState.hostId === myUserId;
  const isMyTurn = tableState.hand && mySeat && tableState.hand.actorSeat === mySeat.seat;

  return (
    <div className="table-page">
      {/* Header */}
      <div className="table-header">
        <button className="btn btn--sm btn--ghost" onClick={onBack}>
          ← Back
        </button>
        <span className="table-header__title">{tableState.config.name} | Code: {tableState.shortCode}</span>
        <span className="table-header__status">{tableState.status}</span>
      </div>

      {/* Squid panel if enabled */}
      {tableState.squid && <SquidPanel squid={tableState.squid} squidSettlement={squidSettlement} />}

      {/* Main table area */}
      <div className="table-area">
        <PokerTable tableState={tableState} holeCards={holeCards} myUserId={myUserId} />
      </div>

      {/* Hand result overlay */}
      {handResult && (
        <div className="hand-result">
          <h3 className="hand-result__title">Winners: {handResult.winners.join(', ')}</h3>
          <button className="btn btn--md btn--gold" onClick={() => useGame.getState().clearResult()} style={{ marginTop: 12 }}>
            OK
          </button>
        </div>
      )}

      {/* Vote modal */}
      {voteRequest && <RunoutVoteModal tableId={tableId} voteRequest={voteRequest} />}

      {/* Action bar or host controls */}
      <div className="table-footer">
        {tableState.status === 'lobby' && isHost && !tableState.hand && (
          <button
            className="btn btn--lg btn--gold btn--full"
            onClick={() => useGame.getState().send({ type: 'START_GAME', tableId })}
          >
            Start Game
          </button>
        )}
        {tableState.status === 'lobby' && !mySeat && (
          <SeatPicker tableState={tableState} tableId={tableId} />
        )}
        {isMyTurn && mySeat && tableState.hand && (
          <ActionBar
            tableId={tableId}
            currentBet={tableState.hand.currentBet}
            myBet={mySeat.bet}
            myStack={mySeat.stack}
            bigBlind={tableState.config.bigBlind}
            minRaise={tableState.hand.minRaise}
          />
        )}
      </div>
    </div>
  );
}

function SeatPicker({ tableState, tableId }: { tableState: any; tableId: string }) {
  const openSeats = tableState.seats
    .map((s: any, i: number) => (s === null ? i : -1))
    .filter((i: number) => i >= 0);

  if (openSeats.length === 0) return <p className="text-secondary">Table is full</p>;

  return (
    <div className="seat-picker">
      <span className="seat-picker__label">Pick a seat:</span>
      {openSeats.map((i: number) => (
        <button
          key={i}
          className="btn btn--sm btn--ghost"
          onClick={() => useGame.getState().send({ type: 'SIT_DOWN', tableId, seatIdx: i })}
        >
          Seat {i + 1}
        </button>
      ))}
    </div>
  );
}
