import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PublicSeat, TableResponse } from '../../shared/api-types.js';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../store/auth.js';

const suits: Record<string, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };
function Card({ value, hidden = false }: { value?: string; hidden?: boolean }) {
  if (hidden || !value) return <span className="card back">♦</span>;
  const suit = suits[value.at(-1) ?? ''] ?? ''; const rank = value.slice(0, -1);
  return <span className={`card ${value.endsWith('h') || value.endsWith('d') ? 'red' : ''}`}><b>{rank}</b><i>{suit}</i></span>;
}

export function TablePage() {
  const { tableId = '' } = useParams();
  const { token, user } = useAuth();
  const [table, setTable] = useState<TableResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [buyIn, setBuyIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [, tick] = useState(0);
  const mySeat = table?.seats.find(s => s?.playerId === user?.id) ?? null;
  const myTurn = Boolean(table?.hand?.actorId === user?.id);
  const valid = table?.validActions ?? [];

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!token || !tableId) return;
    try {
      let next = await api.getTable(token, tableId, signal);
      if (next.hand?.actorId === user?.id) next = (await api.waitForAction(token, tableId, signal)) ?? next;
      setTable(next); setError('');
    } catch (err) { if ((err as Error).name !== 'AbortError') setError(err instanceof ApiError ? friendly(err.code) : 'Connection interrupted. Retrying…'); }
    finally { setLoading(false); }
  }, [token, tableId, user?.id]);

  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); const id = window.setInterval(() => void refresh(controller.signal), 1500); return () => { controller.abort(); clearInterval(id); }; }, [refresh]);
  useEffect(() => { const id = window.setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (table?.hand) setRaiseTo(Math.max(table.hand.currentBet + table.hand.minRaise, table.hand.minRaise)); }, [table?.hand?.currentBet, table?.hand?.minRaise]);

  async function sit() { if (!token || selectedSeat === null) return; setBusy(true); try { const next = await api.sit(token, tableId, { seat: selectedSeat, buyIn }); setTable(next); setSelectedSeat(null); } catch (e) { setError(e instanceof ApiError ? friendly(e.code) : 'Could not take that seat.'); } finally { setBusy(false); } }
  async function act(type: 'fold'|'check'|'call'|'raise'|'all-in') { if (!token) return; setBusy(true); setError(''); try { setTable(await api.act(token, tableId, type === 'raise' ? { type, amount: raiseTo } : { type })); } catch (e) { setError(e instanceof ApiError ? e.reason ?? friendly(e.code) : 'Action failed.'); await refresh(); } finally { setBusy(false); } }
  async function leave() { if (!token) return; setBusy(true); try { setTable(await api.leave(token, tableId)); } catch (e) { setError(e instanceof ApiError ? friendly(e.code) : 'Could not leave the table.'); } finally { setBusy(false); } }

  const pot = useMemo(() => table?.hand?.pots.reduce((sum, p) => sum + p.amount, 0) ?? table?.seats.reduce((sum, s) => sum + (s?.bet ?? 0), 0) ?? 0, [table]);
  const recentResult = table?.lastHandResult && Date.now() - table.lastHandResult.completedAtMs < 8000
    ? table.lastHandResult
    : null;
  if (loading) return <div className="full-loader"><span className="spinner" />Preparing the felt…</div>;
  if (!table) return <div className="full-loader"><strong>Table unavailable</strong><Link to="/">Return to lobby</Link></div>;
  const seconds = table.hand?.actionDeadlineMs ? Math.max(0, Math.ceil((table.hand.actionDeadlineMs - Date.now()) / 1000)) : null;
  return <main className="table-screen">
    <header className="table-topbar"><Link className="brand" to="/"><span>♦</span> DPoker</Link><div className="table-meta"><strong>{table.name}</strong><span>Blinds {table.config.smallBlind}/{table.config.bigBlind}</span><span>#{table.shortCode}</span></div><Link className="secondary compact" to="/">← Lobby</Link></header>
    {error && <div className="floating-notice" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
    {recentResult && <div className="hand-result" role="status"><strong>{recentResult.winners.map(w => w.playerId === user?.id ? 'You' : w.playerId.slice(0, 10)).join(' & ')} won POT {recentResult.potTotal}</strong><span>{recentResult.winners.map(w => w.handName).join(' · ')}</span></div>}
    <section className="poker-room"><div className="felt"><div className="felt-line" />
      <div className="pot-display"><span>{table.hand ? `${table.hand.stage.toUpperCase()} · HAND ${table.hand.handNo}` : table.status === 'lobby' ? 'WAITING FOR PLAYERS' : table.status.toUpperCase()}</span><strong>POT {pot}</strong></div>
      <div className="board">{table.hand ? Array.from({length:5},(_,i)=><Card key={i} value={table.hand?.board[i]} hidden={!table.hand?.board[i]} />) : <p>Take a seat. The game starts automatically with two players.</p>}</div>
      {table.seats.map((seat, index) => <Seat key={index} seat={seat} index={index} count={table.seats.length} mine={seat?.playerId === user?.id} active={seat?.playerId === table.hand?.actorId} onEmpty={() => { if (!mySeat) { setSelectedSeat(index); setBuyIn(table.config.minBuyIn); } }} />)}
    </div></section>
    <aside className="hand-dock"><div className="my-hand"><span className="eyebrow">YOUR HAND</span><div>{table.myCards?.length ? table.myCards.map(c => <Card key={c} value={c} />) : <><Card hidden/><Card hidden/></>}</div><small>{mySeat ? `Stack ${mySeat.stack} · ${mySeat.profit >= 0 ? '+' : ''}${mySeat.profit}` : 'Choose an open seat to play'}</small></div>
      <div className="action-zone">{mySeat && !myTurn && <div className="turn-message"><span className="spinner small" />Waiting for {table.hand?.actorId ? 'another player' : 'the next hand'}…</div>}{myTurn && <><div className="turn-heading"><strong>Your move</strong>{seconds !== null && <span>{seconds}s</span>}</div><div className="action-buttons">{valid.includes('fold') && <button className="danger" disabled={busy} onClick={() => void act('fold')}>Fold</button>}{valid.includes('check') && <button className="secondary" disabled={busy} onClick={() => void act('check')}>Check</button>}{valid.includes('call') && <button className="primary" disabled={busy} onClick={() => void act('call')}>Call {Math.max(0,(table.hand?.currentBet ?? 0)-(mySeat?.bet ?? 0))}</button>}{valid.includes('raise') && <div className="raise-control"><input aria-label="Raise amount" type="number" value={raiseTo} min={(table.hand?.currentBet ?? 0)+(table.hand?.minRaise ?? 0)} max={(mySeat?.stack ?? 0)+(mySeat?.bet ?? 0)} onChange={e=>setRaiseTo(Number(e.target.value))}/><button className="primary" disabled={busy} onClick={() => void act('raise')}>Raise</button></div>}{valid.includes('all-in') && <button className="secondary" disabled={busy} onClick={() => void act('all-in')}>All in</button>}</div></>} {!mySeat && <button className="primary" onClick={() => { const open = table.seats.findIndex(s => !s); if (open >= 0) { setSelectedSeat(open); setBuyIn(table.config.minBuyIn); } }}>Choose a seat</button>}</div>
      {mySeat && <button className="text-button leave" disabled={busy || Boolean(table.hand)} onClick={() => void leave()}>Leave table</button>}
    </aside>
    {selectedSeat !== null && <div className="modal-backdrop" onMouseDown={() => setSelectedSeat(null)}><div className="modal buyin" onMouseDown={e=>e.stopPropagation()}><button className="modal-close" onClick={() => setSelectedSeat(null)}>×</button><p className="eyebrow">SEAT {selectedSeat + 1}</p><h2>Bring chips</h2><p>Buy in between {table.config.minBuyIn} and {table.config.maxBuyIn}.</p><input type="range" min={table.config.minBuyIn} max={table.config.maxBuyIn} step={table.config.bigBlind} value={buyIn} onChange={e=>setBuyIn(Number(e.target.value))}/><div className="buyin-value">{buyIn}</div><button className="primary wide" disabled={busy} onClick={() => void sit()}>{busy ? 'Taking seat…' : 'Take this seat'}</button></div></div>}
  </main>;
}

function Seat({seat,index,count,mine,active,onEmpty}:{seat:PublicSeat|null;index:number;count:number;mine:boolean;active:boolean;onEmpty:()=>void}) {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2; const x = 50 + 48 * Math.cos(angle); const y = 50 + 54 * Math.sin(angle);
  return <div className={`player-seat ${mine?'mine':''} ${active?'active':''}`} style={{left:`${x}%`,top:`${y}%`}}>{seat ? <><div className="avatar">{seat.playerId.slice(0,2).toUpperCase()}</div><div className="player-info"><strong>{mine ? 'You' : seat.playerId.slice(0,10)}</strong><span>{seat.folded ? 'Folded' : seat.allIn ? 'All in' : seat.stack}</span></div>{seat.bet > 0 && <i className="bet-chip">{seat.bet}</i>}</> : <button className="empty-seat" onClick={onEmpty}><b>＋</b><span>Seat {index+1}</span></button>}</div>;
}

function friendly(code:string) { const messages:Record<string,string>={table_not_found:'This table no longer exists.',table_full:'The table is full.',seat_taken:'That seat was just taken.',invalid_buy_in:'Choose a buy-in within the table limits.',not_your_turn:'It is not your turn yet.',invalid_action:'That action is not legal now.',invalid_request:'Please check the values and try again.'}; return messages[code] ?? `Something went wrong (${code}).`; }
