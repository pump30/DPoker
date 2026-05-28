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
    <div style={{ maxWidth: 600, margin: '32px auto', fontFamily: 'system-ui', padding: '0 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>DPoker Lobby</h1>
        <button onClick={() => useAuth.getState().clear()}>Log out</button>
      </div>

      {/* Join by code */}
      <div style={{ marginBottom: 24, display: 'flex', gap: 8 }}>
        <input
          placeholder="Enter table code"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          style={{ flex: 1, padding: '8px 12px', fontSize: 16 }}
          maxLength={6}
        />
        <button onClick={handleJoin} disabled={joinCode.length < 4}>Join</button>
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {/* Table list */}
      <h2>My Tables</h2>
      {tables.length === 0 && <p style={{ color: '#888' }}>No tables yet. Create one!</p>}
      <div style={{ display: 'grid', gap: 8 }}>
        {tables.map((t) => (
          <div
            key={t.id}
            onClick={() => onNavigateTable(t.id)}
            style={{
              padding: 12,
              border: '1px solid #ddd',
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <strong>{t.name}</strong>
              <div style={{ fontSize: 12, color: '#888' }}>Code: {t.shortCode}</div>
            </div>
            <span style={{
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 12,
              background: t.status === 'running' ? '#4caf50' : t.status === 'lobby' ? '#2196f3' : '#999',
              color: 'white',
            }}>
              {t.status}
            </span>
          </div>
        ))}
      </div>

      <button onClick={() => setShowCreate(true)} style={{ marginTop: 16, width: '100%', padding: 12 }}>
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <form onSubmit={handleSubmit} style={{ background: 'white', padding: 24, borderRadius: 12, maxWidth: 400, width: '90%' }}>
        <h2>Create Table</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <input placeholder="Table name" value={name} onChange={(e) => setName(e.target.value)} />
          <label>
            Small Blind:
            <input type="number" min={1} value={smallBlind} onChange={(e) => setSmallBlind(+e.target.value)} />
          </label>
          <label>
            Big Blind:
            <input type="number" min={2} value={bigBlind} onChange={(e) => setBigBlind(+e.target.value)} />
          </label>
          <label>
            Max Seats:
            <select value={maxSeats} onChange={(e) => setMaxSeats(+e.target.value)}>
              {[2,3,4,5,6,7,8,9].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={squidMode} onChange={(e) => setSquidMode(e.target.checked)} />
            Squid Mode
          </label>
          {squidMode && (
            <label>
              Points per Catch:
              <input type="number" min={1} value={squidPoints} onChange={(e) => setSquidPoints(+e.target.value)} />
            </label>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
