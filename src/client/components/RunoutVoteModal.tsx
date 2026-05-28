import { useGame } from '../game/store.js';

type Props = {
  tableId: string;
  voteRequest: { deadlineMs: number; defaultCount: 1 | 2 };
};

export function RunoutVoteModal({ tableId, voteRequest: _voteRequest }: Props) {
  function vote(choice: 1 | 2) {
    useGame.getState().send({ type: 'RUNOUT_VOTE', tableId, choice });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: '#1a1a2e', border: '2px solid #ffd700', borderRadius: 12, padding: 24, textAlign: 'center', maxWidth: 300 }}>
        <h3 style={{ margin: '0 0 16px', color: '#ffd700' }}>Run It Twice?</h3>
        <p style={{ margin: '0 0 16px', color: '#ccc', fontSize: 14 }}>All players are all-in. How many boards?</p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <button onClick={() => vote(1)} style={{ padding: '12px 24px', background: '#f44336', color: 'white', border: 'none', borderRadius: 8, fontSize: 16, cursor: 'pointer' }}>
            1 Board
          </button>
          <button onClick={() => vote(2)} style={{ padding: '12px 24px', background: '#4caf50', color: 'white', border: 'none', borderRadius: 8, fontSize: 16, cursor: 'pointer' }}>
            2 Boards
          </button>
        </div>
      </div>
    </div>
  );
}
