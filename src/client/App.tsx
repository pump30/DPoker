import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Login } from './pages/Login.js';
import { Lobby } from './pages/Lobby.js';
import { TablePage } from './pages/Table.js';
import { useAuth } from './store/auth.js';
import './styles.css';

function PrivateRoutes() {
  const user = useAuth((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <Routes><Route path="/" element={<Lobby />} /><Route path="/tables/:tableId" element={<TablePage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>;
}

export function App() {
  const user = useAuth((s) => s.user);
  return <BrowserRouter><Routes><Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} /><Route path="/*" element={<PrivateRoutes />} /></Routes></BrowserRouter>;
}
