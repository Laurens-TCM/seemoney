import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError(error.status === 400
        ? "That email and password don't match. Check them and try again."
        : "Couldn't sign in just now. Check your connection and try again.");
    }
  }

  return (
    <div className="signin">
      <form className="panel stack" onSubmit={submit}>
        <h1>See The Money</h1>
        <p className="muted">Sign in to see where the household money goes.</p>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" inputMode="email" required
            value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
