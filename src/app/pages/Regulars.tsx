// Regulars: subscriptions, bills and repeat payments found in your spending, with the choices you
// make about them together (Keep / Review / Cancel), hand-added regulars and a due-day calendar.
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { applyOverrides, GROUPS } from '../../lib/classify';
import { CADENCES, detectRecurring, recurringInputs, type Cadence } from '../../lib/recurring';
import { BUCKETS, buildRegulars, dueDays, stoppedFrom, type RegularRow, type RegularStatus, type StoredRegular } from '../../lib/regulars';
import { addRegular, deleteRegular, setRegularStatus, setSeriesStatus, updateRegular, type ManualRegular } from '../../lib/store';
import { supabase } from '../../lib/supabase';
import { useHousehold, useLines, useOverrides, useRegulars } from '../data';
import { day, money, plural, today } from '../format';
import { useLoadState } from '../LoadState';

const CADENCE_LABEL: Record<Cadence, string> = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const STATUS_LABEL: Record<Exclude<RegularStatus, 'not_regular'>, string> = { keep: 'Keep', review: 'Review', cancel: 'Cancel' };
const monthYear = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
const shortDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

export function Regulars() {
  const { household } = useHousehold();
  const hid = household!.id;
  const lines = useLines(hid), overrides = useOverrides(hid), regulars = useRegulars(hid);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const now = today();

  const current = useMemo(() => (lines.data && overrides.data ? applyOverrides(lines.data, overrides.data) : null), [lines.data, overrides.data]);
  const dataEnd = useMemo(() => current?.reduce((d, l) => (l.kind !== 'excluded' && l.date > d ? l.date : d), '') ?? '', [current]);
  const series = useMemo(() => (current ? detectRecurring(recurringInputs(current), dataEnd) : []), [current, dataEnd]);
  const view = useMemo(() => (regulars.data ? buildRegulars(series, regulars.data, dataEnd, now) : null), [series, regulars.data, dataEnd, now]);

  const key = ['regulars', hid];
  // Saves run one after another, so a quick second tap sees the row the first one created.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /** Shows a choice straight away, saves it, then refetches (which undoes it if saving failed). */
  function change(optimistic: (rows: StoredRegular[]) => StoredRegular[], save: () => Promise<unknown>) {
    setError(null);
    const before = queryClient.getQueryData<StoredRegular[]>(key);
    if (before) queryClient.setQueryData(key, optimistic(before));
    const next = queue.current.then(async () => {
      try { await save(); } catch (e) { setError(`Couldn't save that (${(e as Error).message}). Try again.`); }
      await queryClient.invalidateQueries({ queryKey: key });
    });
    queue.current = next;
    return next;
  }

  function choose(r: RegularRow, status: RegularStatus) {
    const stamp = new Date().toISOString();
    if (r.series) {
      const s = r.series;
      return change(
        rows => (r.stored ? rows.map(x => (x.id === r.stored!.id ? { ...x, status, statusChangedAt: stamp } : x))
          : [...rows, { id: `pending-${s.txIds[0]}`, seriesKey: null, txIds: s.txIds, status, statusChangedAt: stamp, name: null, amount: null, cadence: null, nextDue: null, group: null, note: null }]),
        () => {
          // The saved row as it is now (a tap just before may have created it).
          const ids = new Set(s.txIds);
          const saved = queryClient.getQueryData<StoredRegular[]>(key)?.find(x => !x.id.startsWith('pending-') && x.txIds.some(id => ids.has(id))) ?? null;
          return setSeriesStatus(supabase, hid, s, saved, status);
        },
      );
    }
    return change(rows => rows.map(x => (x.id === r.id ? { ...x, status, statusChangedAt: stamp } : x)), () => setRegularStatus(supabase, hid, r.id, status));
  }

  const wait = useLoadState([lines, overrides, regulars], 'your regulars');
  if (wait) return <><h1>Regulars</h1>{wait}</>;
  if (!current?.length) {
    return <><h1>Regulars</h1><div className="panel"><p><Link to="/data">Import a Frollo export</Link> first, then regular payments can be found in it.</p></div></>;
  }
  const v = view!;
  const cancelling = v.active.filter(r => r.status === 'cancel');

  return (
    <>
      <div className="page-head">
        <h1>Regulars</h1>
        <button type="button" className="primary" onClick={() => { setAdding(true); setEditing(null); }}>Add a regular</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="panel stack" aria-label="What regulars cost">
        <p className="lead" style={{ margin: 0 }}>Regulars cost <strong>{money(v.perMonth)} a month</strong> <span className="muted">({money(v.perYear)} a year)</span></p>
        <ul className="chips">
          {BUCKETS.filter(b => v.byBucket[b] > 0).map(b => <li key={b}>{b} <strong>{money(v.byBucket[b])}</strong></li>)}
        </ul>
        {cancelling.length > 0 && (
          <p className="small" style={{ margin: 0 }}>
            Cancelling {plural(cancelling.length, 'regular')} would save <strong className="in">{money(cancelling.reduce((a, r) => a + r.perYear, 0))} a year</strong>.
          </p>
        )}
        {v.loanInterest && (
          <p className="muted small" style={{ margin: 0 }}>
            Loan interest is about {money(v.loanInterest.perMonth)} a month. It's the cost of the home loan, so it isn't counted above.
          </p>
        )}
      </section>

      {adding && (
        <section className="panel stack" aria-labelledby="add-regular-heading">
          <h2 id="add-regular-heading">Add a regular</h2>
          <p className="muted small" style={{ margin: 0 }}>For something that isn't in your spending yet, like a new yearly bill.</p>
          <RegularForm submitLabel="Add" onCancel={() => setAdding(false)}
            onSubmit={async m => { await change(rows => rows, () => addRegular(supabase, hid, m)); setAdding(false); }} />
        </section>
      )}

      <section className="panel" aria-labelledby="paying-heading">
        <h2 id="paying-heading">What you pay now</h2>
        {v.active.length === 0 && <p className="muted" style={{ margin: 0 }}>No regular payments found yet.</p>}
        <ul className="list regulars">
          {v.active.map(r => (
            <li key={r.id}>
              {editing === r.id && r.stored ? (
                <RegularForm initial={toManual(r.stored)} submitLabel="Save" onCancel={() => setEditing(null)}
                  onSubmit={async m => { await change(rows => rows, () => updateRegular(supabase, hid, r.id, m)); setEditing(null); }} />
              ) : <RegularItem r={r} now={now} onChoose={s => choose(r, s)}
                onEdit={r.series ? undefined : () => { setEditing(r.id); setAdding(false); }}
                onRemove={r.series ? undefined : () => change(rows => rows.filter(x => x.id !== r.id), () => deleteRegular(supabase, hid, r.id))} />}
            </li>
          ))}
        </ul>
      </section>

      <DueCalendar view={v} month={now.slice(0, 7)} today={now} />

      {v.stopped.length > 0 && (
        <section className="panel" aria-labelledby="stopped-heading">
          <h2 id="stopped-heading">Stopped</h2>
          <p className="muted small">Regulars that haven't come out lately. Handy for checking a cancellation really went through.</p>
          <ul className="list">
            {v.stopped.map(r => {
              const from = stoppedFrom(r);
              return (
                <li key={r.id}>
                  <span><strong>{r.name}</strong><br />
                    <span className="muted small">{CADENCE_LABEL[r.cadence]}, {money(r.typical, true)} · last paid {r.lastDate ? day(r.lastDate) : 'never'}</span></span>
                  <span className="small" style={{ textAlign: 'right' }}>
                    {r.status === 'cancel' && from
                      ? <span className="in">Saving {money(r.perYear)} a year since {monthYear(from)}</span>
                      : <button type="button" className="link muted" onClick={() => choose(r, 'not_regular')}>Not a regular</button>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {v.notRegular.length > 0 && (
        <details className="small panel">
          <summary>Not regulars ({v.notRegular.length})</summary>
          <ul className="list">
            {v.notRegular.map(r => (
              <li key={r.id}><span>{r.name} <span className="muted">({CADENCE_LABEL[r.cadence].toLowerCase()}, {money(r.typical, true)})</span></span>
                <button type="button" className="link" onClick={() => choose(r, 'keep')}>Show again</button></li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

const toManual = (s: StoredRegular): ManualRegular => ({ name: s.name ?? '', amount: s.amount ?? 0, cadence: s.cadence ?? 'monthly', nextDue: s.nextDue, group: s.group, note: s.note });

function RegularItem({ r, now, onChoose, onEdit, onRemove }: {
  r: RegularRow; now: string; onChoose: (s: RegularStatus) => void; onEdit?: () => void; onRemove?: () => void;
}) {
  return (
    <div className="regular">
      <div className="regular-head">
        <span>
          <strong>{r.name}</strong>
          {r.priceChange > 0 && <span className="badge up">Price up {money(r.priceChange, r.priceChange % 100 !== 0)}</span>}
          {r.priceChange < 0 && <span className="badge">Price down {money(-r.priceChange, r.priceChange % 100 !== 0)}</span>}
          {r.isNew && <span className="badge new">New</span>}
          {!r.series && <span className="badge">Added by hand</span>}
        </span>
        <span className="amt">{money(r.perMonth)}<span className="muted small"> a month</span></span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {CADENCE_LABEL[r.cadence]}, {money(r.typical, true)}
        {r.next && <> · {r.next < now ? 'was due' : 'next'} {shortDay(r.next)}</>}
        {r.lastDate && <> · last paid {shortDay(r.lastDate)}</>}
      </p>
      <div className="actions regular-actions">
        <div className="segmented" role="group" aria-label={`What to do with ${r.name}`}>
          {(['keep', 'review', 'cancel'] as const).map(s => (
            <button key={s} type="button" aria-pressed={r.status === s} onClick={() => onChoose(s)}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
        {r.status === 'cancel' && <span className="in small"><strong>Save {money(r.perYear)} a year</strong></span>}
        <span className="actions" style={{ marginLeft: 'auto' }}>
          {onEdit && <button type="button" className="link muted small" onClick={onEdit}>Edit</button>}
          {onRemove
            ? <button type="button" className="link muted small" onClick={onRemove}>Remove</button>
            : <button type="button" className="link muted small" onClick={() => onChoose('not_regular')}>Not a regular</button>}
        </span>
      </div>
    </div>
  );
}

function RegularForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: ManualRegular; submitLabel: string; onSubmit: (m: ManualRegular) => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount / 100) : '');
  const [cadence, setCadence] = useState<Cadence>(initial?.cadence ?? 'yearly');
  const [nextDue, setNextDue] = useState(initial?.nextDue ?? '');
  const [group, setGroup] = useState(initial?.group ?? 'Home & bills');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = initial ? 'edit-regular' : 'new-regular';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const dollars = Number(amount.replace(/[$,\s]/g, ''));
    if (!name.trim()) return setProblem('Give it a name.');
    if (!(dollars > 0)) return setProblem('Enter the amount each time, like 450.');
    setProblem(null); setBusy(true);
    await onSubmit({ name: name.trim(), amount: Math.round(dollars * 100), cadence, nextDue: nextDue || null, group, note: initial?.note ?? null });
    setBusy(false);
  }

  return (
    <form className="trip-form" onSubmit={submit}>
      <div className="full"><label htmlFor={`${id}-name`}>Name</label>
        <input id={`${id}-name`} className="text" value={name} onChange={e => setName(e.target.value)} placeholder="Council rates" /></div>
      <div><label htmlFor={`${id}-amount`}>Amount each time</label>
        <input id={`${id}-amount`} className="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="450" /></div>
      <div><label htmlFor={`${id}-cadence`}>How often</label>
        <select id={`${id}-cadence`} value={cadence} onChange={e => setCadence(e.target.value as Cadence)}>
          {CADENCES.map(c => <option key={c.key} value={c.key}>{CADENCE_LABEL[c.key]}</option>)}
        </select></div>
      <div><label htmlFor={`${id}-next`}>Next due</label>
        <input id={`${id}-next`} className="text" type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} /></div>
      <div><label htmlFor={`${id}-group`}>Group</label>
        <select id={`${id}-group`} value={group} onChange={e => setGroup(e.target.value)}>
          {Object.keys(GROUPS).map(g => <option key={g}>{g}</option>)}
        </select></div>
      {problem && <p className="error full" role="alert" style={{ margin: 0 }}>{problem}</p>}
      <div className="actions full">
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function DueCalendar({ view, month, today: now }: { view: ReturnType<typeof buildRegulars>; month: string; today: string }) {
  const days = dueDays(view, month);
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked ? [[picked, days.get(picked) ?? []] as const] : [...days.entries()].sort((a, b) => a[0] - b[0]);
  const todayDay = now.slice(0, 7) === month ? Number(now.slice(8, 10)) : 0;

  return (
    <section className="panel stack" aria-labelledby="calendar-heading">
      <h2 id="calendar-heading">When they come out in {monthYear(`${month}-01`)}</h2>
      <div className="calendar" role="group" aria-label="Days regulars come out">
        {WEEKDAYS.map(w => <span key={w} className="weekday" aria-hidden="true">{w.slice(0, 1)}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: count }, (_, i) => {
          const d = i + 1, rs = days.get(d) ?? [];
          const label = `${d} ${monthYear(`${month}-01`)}${rs.length ? `: ${rs.map(r => r.name).join(', ')}` : ''}`;
          return rs.length ? (
            <button key={d} type="button" className={`day due${d === todayDay ? ' today' : ''}`} aria-pressed={picked === d} aria-label={label}
              onClick={() => setPicked(picked === d ? null : d)}>
              {d}<span className="dots" aria-hidden="true">{rs.length > 1 ? rs.length : ''}</span>
            </button>
          ) : <span key={d} className={`day${d === todayDay ? ' today' : ''}`}>{d}</span>;
        })}
      </div>
      <ul className="list small">
        {shown.map(([d, rs]) => (
          <li key={d}><span className="muted">{d} {new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { month: 'short', timeZone: 'UTC' })}</span>
            <span style={{ textAlign: 'right' }}>{rs.map(r => `${r.name} ${money(r.typical)}`).join(' · ')}</span></li>
        ))}
      </ul>
    </section>
  );
}
