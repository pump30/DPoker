import type { SquidPanel as SquidPanelType } from '../../shared/table-types.js';

type Props = {
  squid: SquidPanelType;
  squidSettlement: { loserId: string; payouts: Array<{ playerId: string; delta: number }> } | null;
};

export function SquidPanel({ squid, squidSettlement }: Props) {
  const distributed = squid.holders.filter((h) => h.squids > 0).length;

  return (
    <div style={{ padding: '6px 16px', background: '#0f3460', display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
      <span>Squid Mode:</span>
      <span>
        {'🦑'.repeat(distributed)}{'⬜'.repeat(squid.totalSquids - distributed)}
      </span>
      <span style={{ color: '#aaa' }}>({distributed}/{squid.totalSquids})</span>
      {squidSettlement && (
        <span style={{ color: '#ff5722', fontWeight: 'bold', marginLeft: 'auto' }}>
          {squidSettlement.loserId} lost! (-{squid.pointsPerSquid * squid.totalSquids} pts)
        </span>
      )}
    </div>
  );
}
