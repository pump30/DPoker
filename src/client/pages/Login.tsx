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
    <div className="login-page">
      <div className="login-card">
        {/* Poker chip logo */}
        <div className="login-card__logo">D</div>
        <h1 className="login-card__title">DPoker</h1>

        {/* Tabs */}
        <div className="login-card__tabs">
          <button
            type="button"
            className={`login-card__tab ${tab === 'login' ? 'login-card__tab--active' : ''}`}
            onClick={() => setTab('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={`login-card__tab ${tab === 'register' ? 'login-card__tab--active' : ''}`}
            onClick={() => setTab('register')}
          >
            Register
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="login-card__form">
          <input
            className="input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={tab === 'register' ? 8 : 1}
          />
          {tab === 'register' && (
            <>
              <input
                className="input"
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
              <input
                className="input"
                placeholder="Invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                required
              />
            </>
          )}
          <button type="submit" className="btn btn--lg btn--primary btn--full" disabled={busy}>
            {busy ? '...' : tab === 'login' ? 'Login' : 'Register'}
          </button>
          {error && <div className="login-card__error">{error}</div>}
        </form>
      </div>
    </div>
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
