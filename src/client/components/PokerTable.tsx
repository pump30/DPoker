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
    <div className="flex-center" style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Table felt */}
      <div className="poker-table">
        {/* Pot display */}
        {hand && hand.pots.length > 0 && (
          <div className="poker-table__pot">
            {hand.pots.reduce((s, p) => s + p.amount, 0)}
          </div>
        )}

        {/* Community cards */}
        {hand && hand.board.length > 0 && (
          <div className="poker-table__community">
            {hand.board.map((card, i) => (
              <CardDisplay key={i} card={card} />
            ))}
          </div>
        )}

        {/* Seats */}
        {seats.map((seat, i) => {
          const angle = (i / maxSeats) * Math.PI * 2 - Math.PI / 2;
          const x = 50 + 43 * Math.cos(angle);
          const y = 50 + 43 * Math.sin(angle);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${x}%`,
                top: `${y}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
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
      <div className="seat__avatar--empty">
        {index + 1}
      </div>
    );
  }

  const avatarClass = seat.folded
    ? 'seat__avatar seat__avatar--folded'
    : isActor
      ? 'seat__avatar seat__avatar--active'
      : 'seat__avatar seat__avatar--occupied';

  return (
    <div className="seat">
      <div className={avatarClass}>
        {seat.displayName.slice(0, 3)}
      </div>
      <div className="seat__stack font-tabular">{seat.stack}</div>
      {seat.bet > 0 && (
        <div className="seat__bet">
          <span className="chip">{seat.bet}</span>
        </div>
      )}
      {isButton && <div className="dealer-btn">D</div>}
      {seat.allIn && <div className="seat__allin">All-In</div>}
      {holeCards && (
        <div style={{ display: 'flex', gap: 3, justifyContent: 'center', marginTop: 3 }}>
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
  const sizeClass = small ? 'playing-card--small' : 'playing-card--normal';
  const colorClass = isRed ? 'playing-card--red' : 'playing-card--black';

  return (
    <div className={`playing-card ${sizeClass} ${colorClass} playing-card--deal`}>
      <span>{rank}</span>
      <span style={{ fontSize: small ? 9 : 13 }}>{suitSymbol}</span>
    </div>
  );
}
