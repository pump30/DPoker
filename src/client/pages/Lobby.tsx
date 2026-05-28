import { useState, useEffect } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../store/auth.js';
import type { TableConfig } from '../../shared/table-types.js';

type TableInfo = { id: string; shortCode: string; name: string; status: string; createdAt: number };

export function Lobby({ onNavigateTable }: { onNavigateTable: (id: string) => void }) {
  const token = useAuth((s) => s.token)!;
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTables();
  }, []);

  async function loadTables() {
    try {
      const res = await api.listTables(token);
      setTables(res.tables);
    } catch {}
  }

  async function handleJoin() {
    setError(null);
    try {
      const res = await api.joinTable(token, joinCode.toUpperCase());
      onNavigateTable(res.tableId);
    } catch (err) {
      if (err instanceof ApiError) setError(err.code);
      else setError('Network error');
    }
  }

  async function handleCreate(config: TableConfig) {
    setError(null);
    try {
      const res = await api.createTable(token, config);
      setShowCreate(false);
      onNavigateTable(res.id);
    } catch (err) {
      if (err instanceof ApiError) setError(err.code);
      else setError('Network error');
    }
  }

  return (
    <div className="lobby">
      <div className="lobby__header">
        <h1 className="lobby__title">DPoker</h1>
        <button className="btn btn--sm btn--ghost" onClick={() => useAuth.getState().clear()}>
          Log out
        </button>
      </div>

      {/* Join by code */}
      <div className="lobby__join-bar">
        <input
          className="input"
          placeholder="Enter table code"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          maxLength={6}
        />
        <button className="btn btn--md btn--primary" onClick={handleJoin} disabled={joinCode.length < 4}>
          Join
        </button>
      </div>

      {error && <div className="login-card__error" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Table list */}
      <h2 className="lobby__section-title">My Tables</h2>
      {tables.length === 0 && <p className="lobby__empty">No tables yet. Create one!</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {tables.map((t) => (
          <div
            key={t.id}
            className="table-card"
            onClick={() => onNavigateTable(t.id)}
          >
            <div>
              <div className="table-card__name">{t.name}</div>
              <div className="table-card__code">Code: {t.shortCode}</div>
            </div>
            <span className={`table-card__status table-card__status--${t.status === 'running' ? 'running' : t.status === 'lobby' ? 'lobby' : 'default'}`}>
              {t.status}
            </span>
          </div>
        ))}
      </div>

      <button
        className="btn btn--lg btn--gold btn--full"
        onClick={() => setShowCreate(true)}
        style={{ marginTop: 20 }}
      >
        + Create Table
      </button>

      {showCreate && (
        <CreateTableModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}

function CreateTableModal({ onClose, onCreate }: { onClose: () => void; onCreate: (c: TableConfig) => void }) {
  const [name, setName] = useState('');
  const [smallBlind, setSmallBlind] = useState(1);
  const [bigBlind, setBigBlind] = useState(2);
  const [maxSeats, setMaxSeats] = useState(9);
  const [squidMode, setSquidMode] = useState(false);
  const [squidPoints, setSquidPoints] = useState(10);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onCreate({
      name: name || 'My Table',
      smallBlind,
      bigBlind,
      minBuyIn: bigBlind * 50,
      maxBuyIn: bigBlind * 200,
      reloadPolicy: 'between-hands',
      maxSeats,
      allowSpectators: true,
      actionTimeoutSec: 30,
      timeBankSec: 60,
      defaultRunoutCount: 2,
      squidMode,
      squidPointsPerCatch: squidPoints,
    });
  }

  return (
    <div className="modal-overlay">
      <form onSubmit={handleSubmit} className="modal">
        <h2 className="modal__title">Create Table</h2>
        <div className="modal__form">
          <input className="input" placeholder="Table name" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="modal__label">
            Small Blind
            <input className="input" type="number" min={1} value={smallBlind} onChange={(e) => setSmallBlind(+e.target.value)} />
          </label>
          <label className="modal__label">
            Big Blind
            <input className="input" type="number" min={2} value={bigBlind} onChange={(e) => setBigBlind(+e.target.value)} />
          </label>
          <label className="modal__label">
            Max Seats
            <select className="select" value={maxSeats} onChange={(e) => setMaxSeats(+e.target.value)}>
              {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="modal__label modal__label--row">
            <input type="checkbox" className="checkbox" checked={squidMode} onChange={(e) => setSquidMode(e.target.checked)} />
            Squid Mode
          </label>
          {squidMode && (
            <label className="modal__label">
              Points per Catch
              <input className="input" type="number" min={1} value={squidPoints} onChange={(e) => setSquidPoints(+e.target.value)} />
            </label>
          )}
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--md btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--md btn--gold">Create</button>
        </div>
      </form>
    </div>
  );
}
