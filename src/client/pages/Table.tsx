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

  if (!tableState) return <div style={{ padding: 24, fontFamily: 'system-ui' }}>Connecting...</div>;

  const myUserId = userId || '';
  const mySeat = tableState.seats.find((s) => s?.userId === myUserId);
  const isHost = tableState.hostId === myUserId;
  const isMyTurn = tableState.hand && mySeat && tableState.hand.actorSeat === mySeat.seat;

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui', background: '#1a1a2e', color: 'white', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#16213e' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>← Back</button>
        <span style={{ fontSize: 14 }}>{tableState.config.name} | Code: {tableState.shortCode}</span>
        <span style={{ fontSize: 12, color: '#aaa' }}>{tableState.status}</span>
      </div>

      {/* Squid panel if enabled */}
      {tableState.squid && <SquidPanel squid={tableState.squid} squidSettlement={squidSettlement} />}

      {/* Main table area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <PokerTable tableState={tableState} holeCards={holeCards} myUserId={myUserId} />
      </div>

      {/* Hand result overlay */}
      {handResult && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.9)', padding: 24, borderRadius: 12, zIndex: 50, textAlign: 'center' }}>
          <h3>Winners: {handResult.winners.join(', ')}</h3>
          <button onClick={() => useGame.getState().clearResult()}>OK</button>
        </div>
      )}

      {/* Vote modal */}
      {voteRequest && <RunoutVoteModal tableId={tableId} voteRequest={voteRequest} />}

      {/* Action bar or host controls */}
      <div style={{ padding: '8px 16px', background: '#16213e' }}>
        {tableState.status === 'lobby' && isHost && !tableState.hand && (
          <button onClick={() => useGame.getState().send({ type: 'START_GAME', tableId })} style={{ width: '100%', padding: 12, fontSize: 16, background: '#4caf50', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
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

  if (openSeats.length === 0) return <p>Table is full</p>;

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <span>Pick a seat:</span>
      {openSeats.map((i: number) => (
        <button
          key={i}
          onClick={() => useGame.getState().send({ type: 'SIT_DOWN', tableId, seatIdx: i })}
          style={{ padding: '6px 12px', borderRadius: 4, background: '#333', color: 'white', border: '1px solid #555', cursor: 'pointer' }}
        >
          Seat {i + 1}
        </button>
      ))}
    </div>
  );
}
