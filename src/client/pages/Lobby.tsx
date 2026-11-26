import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TableListItem } from '../../shared/api-types.js';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../store/auth.js';

export function Lobby() {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [tables, setTables] = useState<TableListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const refresh = useCallback(async () => { if (!token) return; try { setTables(await api.listTables(token)); setError(''); } catch { setError('Could not refresh tables.'); } finally { setLoading(false); } }, [token]);
  useEffect(() => { void refresh(); const id = window.setInterval(refresh, 4000); return () => clearInterval(id); }, [refresh]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!token) return; const form = new FormData(e.currentTarget); setCreating(true); setError('');
    try { const table = await api.createTable(token, { name: String(form.get('name')), smallBlind: Number(form.get('smallBlind')), bigBlind: Number(form.get('bigBlind')), minBuyIn: Number(form.get('minBuyIn')), maxBuyIn: Number(form.get('maxBuyIn')), maxSeats: Number(form.get('maxSeats')), actionTimeoutSec: 30 }); navigate(`/tables/${table.tableId}`); }
    catch (err) { setError(err instanceof ApiError ? err.reason ?? err.code : 'Could not create table.'); } finally { setCreating(false); }
  }
  const active = tables.filter(t => t.status !== 'closed');
  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="/"><span>♦</span> DPoker</a><div className="account"><span className="online-dot" />{user?.displayName}<button className="text-button" onClick={() => useAuth.getState().clear()}>Log out</button></div></header>
    <section className="lobby-hero"><div><p className="eyebrow">THE CARD ROOM IS OPEN</p><h1>Find your seat.<br/><em>Play your hand.</em></h1><p>Live no-limit Hold’em tables, clean decisions, no distractions.</p></div><div className="hero-mark">D<span>P</span></div></section>
    <section className="lobby-panel"><div className="section-heading"><div><p className="eyebrow">LIVE FLOOR</p><h2>Available tables</h2></div><div className="heading-actions"><button className="secondary" onClick={() => void refresh()}>↻ Refresh</button><button className="primary" onClick={() => setShowCreate(true)}>＋ Create table</button></div></div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {loading ? <div className="empty-state"><span className="spinner" />Dealing the room…</div> : active.length === 0 ? <div className="empty-state"><strong>No tables yet</strong><span>Open the first table and invite another player.</span></div> : <div className="table-list">{active.map(t => <button className="table-row" key={t.tableId} onClick={() => navigate(`/tables/${t.tableId}`)}><span className={`status-badge ${t.status}`}>{t.status}</span><span><strong>{t.name}</strong><small>{t.seats}/{t.maxSeats} seats occupied</small></span><span className="seat-pips">{Array.from({length:t.maxSeats},(_,i)=><i key={i} className={i<t.seats?'filled':''}/>)}</span><span className="join-arrow">Join →</span></button>)}</div>}
    </section>
    {showCreate && <div className="modal-backdrop" onMouseDown={() => setShowCreate(false)}><form className="modal" onSubmit={create} onMouseDown={e => e.stopPropagation()}><button type="button" className="modal-close" onClick={() => setShowCreate(false)}>×</button><p className="eyebrow">NEW TABLE</p><h2>Set the stakes</h2><label>Table name<input name="name" defaultValue="Friday Night" maxLength={64} required /></label><div className="form-grid"><label>Small blind<input name="smallBlind" type="number" min="1" defaultValue="10" required /></label><label>Big blind<input name="bigBlind" type="number" min="2" defaultValue="20" required /></label><label>Min buy-in<input name="minBuyIn" type="number" min="1" defaultValue="500" required /></label><label>Max buy-in<input name="maxBuyIn" type="number" min="1" defaultValue="2000" required /></label></div><label>Seats<select name="maxSeats" defaultValue="6"><option value="2">Heads-up (2)</option><option value="6">6-max</option><option value="9">Full ring (9)</option></select></label><button className="primary wide" disabled={creating}>{creating ? 'Opening table…' : 'Open table'}</button></form></div>}
  </main>;
}
