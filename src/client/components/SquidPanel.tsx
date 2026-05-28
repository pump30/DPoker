import type { SquidPanel as SquidPanelType } from '../../shared/table-types.js';

type Props = {
  squid: SquidPanelType;
  squidSettlement: { loserId: string; payouts: Array<{ playerId: string; delta: number }> } | null;
};

export function SquidPanel({ squid, squidSettlement }: Props) {
  const distributed = squid.holders.filter((h) => h.squids > 0).length;

  return (
    <div className="squid-panel">
      <span className="squid-panel__label">Squid Mode</span>
      <span className="squid-panel__icons">
        {'🦑'.repeat(distributed)}{'⬜'.repeat(squid.totalSquids - distributed)}
      </span>
      <span className="squid-panel__count">({distributed}/{squid.totalSquids})</span>
      {squidSettlement && (
        <span className="squid-panel__settlement">
          {squidSettlement.loserId} lost! (-{squid.pointsPerSquid * squid.totalSquids} pts)
        </span>
      )}
    </div>
  );
}
