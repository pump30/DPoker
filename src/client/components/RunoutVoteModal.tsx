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
    <div className="modal-overlay">
      <div className="runout-modal">
        <h3 className="runout-modal__title">Run It Twice?</h3>
        <p className="runout-modal__text">All players are all-in. How many boards?</p>
        <div className="runout-modal__buttons">
          <button className="btn btn--lg btn--fold" onClick={() => vote(1)}>
            1 Board
          </button>
          <button className="btn btn--lg btn--check" onClick={() => vote(2)}>
            2 Boards
          </button>
        </div>
      </div>
    </div>
  );
}
