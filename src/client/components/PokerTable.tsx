import type { PublicTableState } from '../../shared/protocol.js';
import type { Card } from '../../shared/game-types.js';

type Props = {
  tableState: PublicTableState;
  holeCards: [Card, Card] | null;
  myUserId: string;
};

export function PokerTable({ tableState, holeCards, myUserId }: Props) {
  const { seats, hand } = tableState;
  const maxSeats = tableState.config.maxSeats;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Table felt */}
      <div style={{ width: '80%', maxWidth: 600, aspectRatio: '2/1', background: 'radial-gradient(ellipse, #2d5a27 0%, #1a3a15 100%)', borderRadius: '50%', border: '8px solid #5a3a1a', position: 'relative', boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}>
        {/* Community cards */}
        {hand && hand.board.length > 0 && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', gap: 4 }}>
            {hand.board.map((card, i) => (
              <CardDisplay key={i} card={card} />
            ))}
          </div>
        )}

        {/* Pot display */}
        {hand && hand.pots.length > 0 && (
          <div style={{ position: 'absolute', top: '35%', left: '50%', transform: 'translateX(-50%)', fontSize: 12, color: '#ffd700' }}>
            Pot: {hand.pots.reduce((s, p) => s + p.amount, 0)}
          </div>
        )}

        {/* Seats */}
        {seats.map((seat, i) => {
          const angle = (i / maxSeats) * Math.PI * 2 - Math.PI / 2;
          const x = 50 + 42 * Math.cos(angle);
          const y = 50 + 42 * Math.sin(angle);
          return (
            <div key={i} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}>
              <SeatDisplay
                seat={seat}
                index={i}
                isButton={hand?.buttonSeat === i}
                isActor={hand?.actorSeat === i}
                holeCards={seat?.userId === myUserId ? holeCards : null}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeatDisplay({ seat, index, isButton, isActor, holeCards }: {
  seat: any;
  index: number;
  isButton: boolean;
  isActor: boolean;
  holeCards: [Card, Card] | null;
}) {
  if (!seat) {
    return (
      <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#666', border: '2px dashed #555' }}>
        {index + 1}
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', position: 'relative' }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: seat.folded ? '#555' : isActor ? '#ffd700' : '#2196f3',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 'bold', color: 'white',
        border: isActor ? '3px solid #fff' : '2px solid rgba(255,255,255,0.3)',
        opacity: seat.folded ? 0.5 : 1,
      }}>
        {seat.displayName.slice(0, 3)}
      </div>
      <div style={{ fontSize: 10, marginTop: 2 }}>{seat.stack}</div>
      {seat.bet > 0 && <div style={{ fontSize: 10, color: '#ffd700' }}>Bet: {seat.bet}</div>}
      {isButton && <div style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: '#fff', color: '#000', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>D</div>}
      {seat.allIn && <div style={{ fontSize: 9, color: '#ff5722', fontWeight: 'bold' }}>ALL-IN</div>}
      {holeCards && (
        <div style={{ display: 'flex', gap: 2, justifyContent: 'center', marginTop: 2 }}>
          <CardDisplay card={holeCards[0]} small />
          <CardDisplay card={holeCards[1]} small />
        </div>
      )}
    </div>
  );
}

function CardDisplay({ card, small }: { card: Card; small?: boolean }) {
  const rank = card[0];
  const suit = card[1];
  const suitSymbol = { h: '♥', d: '♦', c: '♣', s: '♠' }[suit] || suit;
  const isRed = suit === 'h' || suit === 'd';
  const size = small ? { width: 24, height: 34, fontSize: 10 } : { width: 36, height: 50, fontSize: 14 };

  return (
    <div style={{
      ...size,
      background: 'white',
      borderRadius: 3,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: isRed ? '#e53935' : '#212121',
      fontWeight: 'bold',
      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    }}>
      <span>{rank}</span>
      <span style={{ fontSize: small ? 8 : 12 }}>{suitSymbol}</span>
    </div>
  );
}
