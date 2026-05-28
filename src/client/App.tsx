import { Login } from './pages/Login.js';
import { useAuth } from './store/auth.js';

export function App() {
  const user = useAuth((s) => s.user);
  if (!user) return <Login />;
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>DPoker</h1>
      <p>Welcome, {user.displayName}!</p>
      <button onClick={() => useAuth.getState().clear()}>Log out</button>
    </div>
  );
}
