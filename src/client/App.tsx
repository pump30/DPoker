import { useState } from 'react';
import { Login } from './pages/Login.js';
import { Lobby } from './pages/Lobby.js';
import { Table } from './pages/Table.js';
import { useAuth } from './store/auth.js';

type View = { page: 'lobby' } | { page: 'table'; tableId: string };

export function App() {
  const user = useAuth((s) => s.user);
  const [view, setView] = useState<View>({ page: 'lobby' });

  if (!user) return <Login />;

  if (view.page === 'table') {
    return <Table tableId={view.tableId} onBack={() => setView({ page: 'lobby' })} />;
  }

  return <Lobby onNavigateTable={(id) => setView({ page: 'table', tableId: id })} />;
}
