import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, Outlet } from 'react-router';
import { supabase } from '../lib/supabase';
import { useHousehold, useLiveUpdates } from './data';
import { LoadState, OfflineBanner } from './LoadState';

const TABS = [
  { to: '/', label: 'Overview' },
  { to: '/trips', label: 'Trips' },
  { to: '/regulars', label: 'Regulars' },
  { to: '/plan', label: 'Plan' },
  { to: '/data', label: 'Data' },
];

export function Layout() {
  const householdQuery = useHousehold();
  const { household, me, isLoading, error } = householdQuery;
  useLiveUpdates(household?.id);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">See The Money</span>
        <AccountMenu name={me?.displayName ?? null} />
      </header>
      <nav className="tabs" aria-label="Sections">
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <main>
        <OfflineBanner />
        {isLoading || error ? <LoadState queries={[householdQuery]} what="your household" />
          : !household ? (
            <div className="panel">
              <h1>Not in a household yet</h1>
              <p>Your account works, but it hasn't been added to a household. Ask whoever set up See The Money to add you.</p>
            </div>
          ) : <Outlet />}
      </main>
    </div>
  );
}

function AccountMenu({ name }: { name: string | null }) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  async function signOut() {
    await supabase.auth.signOut();
    queryClient.clear();
  }

  return (
    <div className="account" ref={ref}>
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => { setOpen(!open); setChanging(false); }}>
        {name ?? 'Account'}
      </button>
      {open && (
        <div className="menu panel stack">
          {changing ? <ChangePassword onDone={() => setChanging(false)} /> : (
            <>
              <p className="small muted">Signed in{name ? ` as ${name}` : ''}.</p>
              <div className="actions">
                <button type="button" onClick={() => setChanging(true)}>Change password</button>
                <button type="button" onClick={signOut}>Sign out</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const MIN_PASSWORD = 12;

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setMessage({ ok: false, text: `Use at least ${MIN_PASSWORD} characters.` });
    if (password !== confirm) return setMessage({ ok: false, text: "The two passwords don't match." });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setMessage({ ok: false, text: error.message });
    else { setMessage({ ok: true, text: 'Password changed. Update it in your password manager too.' }); setPassword(''); setConfirm(''); }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h2>Change password</h2>
      <div>
        <label htmlFor="new-password">New password</label>
        <input id="new-password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required
          value={password} onChange={e => setPassword(e.target.value)} />
      </div>
      <div>
        <label htmlFor="confirm-password">Type it again</label>
        <input id="confirm-password" type="password" autoComplete="new-password" required
          value={confirm} onChange={e => setConfirm(e.target.value)} />
      </div>
      {message && <p className={message.ok ? 'in' : 'error'} role="status">{message.text}</p>}
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onDone}>Back</button>
      </div>
    </form>
  );
}
