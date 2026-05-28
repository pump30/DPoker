import { create } from 'zustand';
import type { PublicTableState, ServerEvent, ClientEvent } from '../../shared/protocol.js';
import type { Card } from '../../shared/game-types.js';
import { getSocket, joinTable, leaveTable, sendEvent } from './socket.js';

type GameState = {
  tableId: string | null;
  tableState: PublicTableState | null;
  holeCards: [Card, Card] | null;
  actionRejected: string | null;
  handResult: ServerEvent & { type: 'HAND_RESULT' } | null;
  voteRequest: { deadlineMs: number; defaultCount: 1 | 2 } | null;
  squidSettlement: { loserId: string; payouts: Array<{ playerId: string; delta: number }> } | null;

  // Actions
  connectToTable: (tableId: string) => void;
  disconnect: () => void;
  send: (event: ClientEvent) => void;
  clearResult: () => void;
};

export const useGame = create<GameState>((set, get) => ({
  tableId: null,
  tableState: null,
  holeCards: null,
  actionRejected: null,
  handResult: null,
  voteRequest: null,
  squidSettlement: null,

  connectToTable: (tableId: string) => {
    const socket = getSocket();

    socket.off('server:event');
    socket.on('server:event', (ev: ServerEvent) => {
      switch (ev.type) {
        case 'TABLE_STATE':
          set({ tableState: ev.state, actionRejected: null });
          break;
        case 'HOLE_CARDS':
          set({ holeCards: ev.cards });
          break;
        case 'ACTION_REJECTED':
          set({ actionRejected: ev.reason });
          break;
        case 'HAND_RESULT':
          set({ handResult: ev as any });
          break;
        case 'RUNOUT_VOTE_REQUEST':
          set({ voteRequest: { deadlineMs: ev.deadlineMs, defaultCount: ev.defaultCount } });
          break;
        case 'RUNOUT_DECIDED':
          set({ voteRequest: null });
          break;
        case 'SQUID_ROUND_SETTLED':
          set({ squidSettlement: { loserId: ev.loserId, payouts: ev.payouts } });
          setTimeout(() => set({ squidSettlement: null }), 5000);
          break;
        default:
          break;
      }
    });

    joinTable(tableId);
    set({ tableId, tableState: null, holeCards: null, handResult: null, voteRequest: null });
  },

  disconnect: () => {
    const { tableId } = get();
    if (tableId) leaveTable(tableId);
    set({ tableId: null, tableState: null, holeCards: null, handResult: null, voteRequest: null });
  },

  send: (event: ClientEvent) => {
    sendEvent(event);
  },

  clearResult: () => set({ handResult: null }),
}));
