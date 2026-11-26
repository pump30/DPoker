import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../store/auth.js';

type Tab = 'login' | 'register';

export function Login() {
  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result =
        tab === 'login'
          ? await api.login({ username, password })
          : await api.register({ username, password, displayName, inviteCode });
      useAuth.getState().setSession(result.token, result.user);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(translate(err.code));
      } else {
        setError('Network error');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen"><section className="login-art"><div className="brand large"><span>♦</span> DPoker</div><div><p className="eyebrow">PRIVATE TABLES. REAL POKER.</p><h1>The felt is<br/><em>waiting.</em></h1><p>Gather your people. Read the room. Play the hand.</p></div><div className="card-fan"><i>♠</i><i>♥</i><i>♦</i></div></section><section className="login-panel"><div className="login-form"><p className="eyebrow">WELCOME TO THE TABLE</p><h2>{tab === 'login' ? 'Sign in to play' : 'Claim your seat'}</h2><div className="tabs"><button className={tab === 'login' ? 'active' : ''} onClick={() => { setTab('login'); setError(null); }}>Sign in</button><button className={tab === 'register' ? 'active' : ''} onClick={() => { setTab('register'); setError(null); }}>Register</button></div>
      <form onSubmit={onSubmit}>
        <label>Username
        <input
          placeholder="your username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        /></label>
        <label>Password
        <input
          type="password"
          placeholder={tab === 'register' ? 'at least 8 characters' : 'your password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={tab === 'register' ? 8 : 1}
        /></label>
        {tab === 'register' && (
          <>
            <label>Display name<input
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            /></label>
            <label>Invite code<input
              placeholder="Invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              required
            /></label>
          </>
        )}
        {error && <div className="notice error" role="alert">{error}</div>}
        <button className="primary wide" type="submit" disabled={busy}>
          {busy ? 'Checking your seat…' : tab === 'login' ? 'Enter the card room' : 'Create account'}
        </button>
      </form>
      </div></section></main>
  );
}

function translate(code: string): string {
  switch (code) {
    case 'invalid_credentials':
      return 'Wrong username or password';
    case 'username_taken':
      return 'Username already taken';
    case 'invalid_invite':
      return 'Invalid or used invite code';
    case 'invalid_request':
      return 'Please fill all fields correctly';
    default:
      return `Error: ${code}`;
  }
}
