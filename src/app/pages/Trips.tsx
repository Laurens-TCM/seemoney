// Trips: suggestions from Victorian spending, trips with their ticked lines, and trip totals.
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { applyOverrides, type Bucket, type Line } from '../../lib/classify';
import {
  createGoal, createTrip, deleteTrip, dismissSuggestion, setTripTick, undismiss, updateTrip,
  type StoredTrip, type TripInput,
} from '../../lib/store';
import { coveredDays, daysBetween, perMonth, windowFor } from '../../lib/summary';
import { supabase } from '../../lib/supabase';
import { allocateTrips, suggestTrips, tripDatesFor, type Allocation, type Candidate, type Suggestion } from '../../lib/trips';
import { useDismissed, useGoals, useHousehold, useImports, useLines, useOverrides, useTrips } from '../data';
import { day, money, plural, range } from '../format';

const KINDS: Record<StoredTrip['kind'], string> = { family: 'Friends & family', holiday: 'Holiday', work: 'Work' };
const PLACES: Record<StoredTrip['place'], string> = { melbourne: 'Melbourne & Victoria', overseas: 'Overseas', any: 'Somewhere else' };
const BUCKETS: Bucket[] = ['Flights', 'Accommodation', 'Food & drink', 'Getting around', 'Activities', 'Other'];
const TRIPS_GOAL = 'Trips, next 12 months';

const monthYear = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
const nextYearMonth = () => { const d = new Date(); d.setMonth(d.getMonth() + 12); return d.toISOString().slice(0, 7); };

export function Trips() {
  const { household } = useHousehold();
  const hid = household!.id;
  const lines = useLines(hid), overrides = useOverrides(hid), trips = useTrips(hid), dismissed = useDismissed(hid);
  const imports = useImports(hid), goals = useGoals(hid);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StoredTrip['kind'] | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = useMemo(() => (lines.data && overrides.data ? applyOverrides(lines.data, overrides.data) : null), [lines.data, overrides.data]);
  const alloc = useMemo(() => (current && trips.data ? allocateTrips(current, trips.data.trips, trips.data.overrides) : null), [current, trips.data]);
  const suggestions = useMemo(
    () => (current && trips.data && dismissed.data ? suggestTrips(current, trips.data.trips, dismissed.data) : []),
    [current, trips.data, dismissed.data],
  );

  const refresh = (...keys: string[]) => Promise.all(keys.map(k => queryClient.invalidateQueries({ queryKey: [k, hid] })));
  async function run(action: () => Promise<unknown>, ...keys: string[]) {
    setError(null);
    try { await action(); await refresh(...keys); } catch (e) { setError(`Couldn't save that (${(e as Error).message}). Try again.`); }
  }

  if (lines.isLoading || overrides.isLoading || trips.isLoading || dismissed.isLoading || imports.isLoading) return <p className="muted">Loading…</p>;
  if (!current?.length) {
    return <><h1>Trips</h1><div className="panel"><p><Link to="/data">Import a Frollo export</Link> first, then trips can be found in it.</p></div></>;
  }

  const all = trips.data!.trips;
  const shown = [...all].filter(t => filter === 'all' || t.kind === filter).sort((a, b) => (a.start < b.start ? 1 : -1));
  const recharge = all.filter(t => t.kind === 'work' && t.rechargeToBusiness);

  async function addFromSuggestion(s: Suggestion) {
    const dates = tripDatesFor(s);
    let id = '';
    await run(async () => { id = await createTrip(supabase, hid, { name: `Melbourne, ${monthYear(s.start)}`, ...dates, kind: 'family', place: 'melbourne' }); }, 'trips');
    if (id) setOpen(id);
  }

  return (
    <>
      <h1>Trips</h1>
      {error && <p className="error" role="alert">{error}</p>}
      <TripSummary all={all} alloc={alloc!} lines={current} imports={imports.data!.map(i => i.range)}
        hasGoal={!!goals.data?.some(g => /trip/i.test(g.name))}
        onGoal={amount => run(() => createGoal(supabase, hid, { name: TRIPS_GOAL, amount, targetMonth: nextYearMonth(), saved: 0, sort: 0 }), 'goals')} />

      {suggestions.length > 0 && (
        <section className="panel stack" aria-labelledby="suggest-heading">
          <h2 id="suggest-heading">Melbourne visits found in your spending</h2>
          <p className="muted small" style={{ margin: 0 }}>Days with eating out, shopping or getting around in Victoria. Add any that were trips; flights booked beforehand can be ticked on the trip.</p>
          <ul className="list">
            {suggestions.map(s => (
              <li key={s.start}>
                <span><strong>{range({ from: s.start, to: s.end })}</strong><br />
                  <span className="muted small">{plural(s.lines, 'purchase')} in Victoria, {money(s.total)}</span></span>
                <span className="actions" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => addFromSuggestion(s)}>Add trip</button>
                  <button type="button" className="link muted" onClick={() => run(() => dismissSuggestion(supabase, hid, { from: s.start, to: s.end }), 'dismissed')}>Not a trip</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="page-head">
        <div className="segmented" role="group" aria-label="Show">
          {(['all', 'family', 'holiday', 'work'] as const).map(k => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{k === 'all' ? 'All' : KINDS[k]}</button>
          ))}
        </div>
        <button type="button" className="primary" onClick={() => setAdding(true)}>Add a trip</button>
      </div>

      {adding && (
        <section className="panel stack" aria-labelledby="new-trip-heading">
          <h2 id="new-trip-heading">New trip</h2>
          <TripForm submitLabel="Add trip" onCancel={() => setAdding(false)}
            onSubmit={async t => { let id = ''; await run(async () => { id = await createTrip(supabase, hid, t); }, 'trips'); if (id) { setAdding(false); setOpen(id); } }} />
        </section>
      )}

      {shown.length === 0 && !adding && (
        <div className="panel"><p className="muted" style={{ margin: 0 }}>
          {all.length ? 'No trips of this type.' : 'No trips yet. Add one, or pick from the Melbourne visits found in your spending.'}
        </p></div>
      )}
      {shown.map(t => (
        <TripCard key={t.id} trip={t} alloc={alloc!} trips={all} householdId={hid} open={open === t.id}
          onToggle={() => setOpen(open === t.id ? null : t.id)} run={run} />
      ))}

      {recharge.length > 0 && (
        <section className="panel stack" aria-labelledby="recharge-heading">
          <h2 id="recharge-heading">Recharge to TCM</h2>
          <p className="muted small" style={{ margin: 0 }}>Work trips to pass to the accountant.</p>
          <ul className="list">
            {recharge.map(t => <li key={t.id}><span>{t.name}<br /><span className="muted small">{range({ from: t.start, to: t.end })}</span></span><span>{money(alloc!.perTrip[t.id]?.total ?? 0)}</span></li>)}
          </ul>
        </section>
      )}

      {(dismissed.data?.length ?? 0) > 0 && (
        <details className="small panel">
          <summary>Not trips ({dismissed.data!.length})</summary>
          <ul className="list">
            {dismissed.data!.map(r => (
              <li key={r.from}><span>{range(r)}</span>
                <button type="button" className="link" onClick={() => run(() => undismiss(supabase, hid, r), 'dismissed')}>Show again</button></li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function Buckets({ buckets }: { buckets: Partial<Record<Bucket, number>> }) {
  const shown = BUCKETS.filter(b => buckets[b]);
  if (!shown.length) return <p className="muted small" style={{ margin: 0 }}>No costs ticked yet.</p>;
  return <ul className="chips">{shown.map(b => <li key={b}>{b} <strong>{money(buckets[b]!)}</strong></li>)}</ul>;
}

function TripSummary({ all, alloc, lines, imports, hasGoal, onGoal }: {
  all: StoredTrip[]; alloc: Allocation; lines: Line[]; imports: { from: string; to: string }[];
  hasGoal: boolean; onGoal: (amount: number) => void;
}) {
  if (!all.length) return null;
  const buckets: Partial<Record<Bucket, number>> = {};
  for (const p of Object.values(alloc.perTrip)) for (const [b, v] of Object.entries(p.buckets)) buckets[b as Bucket] = (buckets[b as Bucket] ?? 0) + v;
  // "About $X a month": trip spending in the last 12 months over the days covered.
  const newest = lines.reduce((d, l) => (l.kind !== 'excluded' && l.date > d ? l.date : d), '');
  const win = windowFor(newest, 12);
  const inWindow = lines.filter(l => l.kind === 'spend' && l.date >= win.from && l.date <= win.to && alloc.owner.has(l.txId))
    .reduce((a, l) => a - l.amount, 0);
  const pm = perMonth(inWindow, coveredDays(win, imports));
  const goal = Math.round(alloc.total / 10_000) * 10_000; // to the nearest $100

  return (
    <section className="panel stack" aria-label="All trips">
      <p className="lead" style={{ margin: 0 }}>{plural(all.length, 'trip')} cost <strong className="goal">{money(alloc.total)}</strong>, about {money(pm)} a month.</p>
      <Buckets buckets={buckets} />
      <div className="actions">
        {hasGoal
          ? <span className="muted small">There's a trips goal on the <Link to="/plan">Plan</Link>.</span>
          : <button type="button" onClick={() => onGoal(goal)}>Save for the next 12 months of trips</button>}
      </div>
    </section>
  );
}

function TripForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: TripInput; submitLabel: string; onSubmit: (t: TripInput) => Promise<void>; onCancel?: () => void;
}) {
  const [t, setT] = useState<TripInput>(initial ?? { name: '', start: '', end: '', kind: 'family', place: 'melbourne' });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TripInput>(k: K, v: TripInput[K]) => setT(prev => ({ ...prev, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!t.name.trim()) return setProblem('Give the trip a name.');
    if (!t.start || !t.end) return setProblem('Add both dates.');
    if (t.end < t.start) return setProblem('The trip ends before it starts.');
    setProblem(null); setBusy(true);
    await onSubmit({ ...t, name: t.name.trim() });
    setBusy(false);
  }

  return (
    <form className="trip-form" onSubmit={submit}>
      <div className="full"><label htmlFor="trip-name">Trip name</label>
        <input id="trip-name" className="text" value={t.name} onChange={e => set('name', e.target.value)} placeholder="Melbourne, October 2025" /></div>
      <div><label htmlFor="trip-start">From</label><input id="trip-start" type="date" className="text" value={t.start} onChange={e => set('start', e.target.value)} /></div>
      <div><label htmlFor="trip-end">To</label><input id="trip-end" type="date" className="text" value={t.end} onChange={e => set('end', e.target.value)} /></div>
      <div><label htmlFor="trip-kind">Type</label>
        <select id="trip-kind" value={t.kind} onChange={e => set('kind', e.target.value as StoredTrip['kind'])}>
          {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
      <div><label htmlFor="trip-place">Where</label>
        <select id="trip-place" value={t.place} onChange={e => set('place', e.target.value as StoredTrip['place'])}>
          {Object.entries(PLACES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
      {t.kind === 'work' && (
        <label className="toggle full"><input type="checkbox" checked={!!t.rechargeToBusiness} onChange={e => set('rechargeToBusiness', e.target.checked)} /> Recharge to TCM</label>
      )}
      {problem && <p className="error small full" role="alert">{problem}</p>}
      <div className="actions full">
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function TripCard({ trip, alloc, trips, householdId, open, onToggle, run }: {
  trip: StoredTrip; alloc: Allocation; trips: StoredTrip[]; householdId: string; open: boolean;
  onToggle: () => void; run: (action: () => Promise<unknown>, ...keys: string[]) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const p = alloc.perTrip[trip.id] ?? { total: 0, lines: 0, buckets: {} };
  const nights = daysBetween(trip.start, trip.end);
  const candidates = (alloc.candidates[trip.id] ?? []).slice().sort((a, b) => (a.line.date < b.line.date ? -1 : 1));
  const before = candidates.filter(c => !c.during), during = candidates.filter(c => c.during);

  async function tick(c: Candidate, included: boolean) {
    // Show the tick straight away, then save it.
    queryClient.setQueryData<{ trips: StoredTrip[]; overrides: { tripId: string; txId: string; included: boolean }[] }>(['trips', householdId], old => old && {
      ...old, overrides: [...old.overrides.filter(o => !(o.tripId === trip.id && o.txId === c.line.txId)), { tripId: trip.id, txId: c.line.txId, included }],
    });
    await run(() => setTripTick(supabase, householdId, trip.id, c.line.txId, included), 'trips');
  }

  const row = (c: Candidate) => {
    const owner = alloc.owner.get(c.line.txId), mine = owner === trip.id, other = owner && !mine ? trips.find(t => t.id === owner) : null;
    return (
      <li key={c.line.txId} className={mine ? '' : 'off'}>
        <label className="tick">
          <input type="checkbox" checked={mine} disabled={!!other} onChange={e => tick(c, e.target.checked)} />
          <span>{c.line.name}<br /><span className="muted small">{day(c.line.date)} · {c.line.bucket}{other ? ` · in ${other.name}` : ''}</span></span>
        </label>
        <span>{money(-c.line.amount, true)}</span>
      </li>
    );
  };

  return (
    <section className="panel trip" aria-label={trip.name}>
      <button type="button" className="trip-head" aria-expanded={open} onClick={onToggle}>
        <span><strong>{trip.name}</strong><br />
          <span className="muted small">{range({ from: trip.start, to: trip.end })} · {plural(nights, 'night')} · {KINDS[trip.kind]}{trip.rechargeToBusiness ? ' · recharge to TCM' : ''}</span></span>
        <span className="amt goal">{money(p.total)}</span>
      </button>
      <Buckets buckets={p.buckets} />
      {open && (
        <div className="stack" style={{ marginTop: '.75rem' }}>
          <TripForm submitLabel="Save changes" initial={{ name: trip.name, start: trip.start, end: trip.end, kind: trip.kind, place: trip.place, rechargeToBusiness: trip.rechargeToBusiness }}
            onSubmit={t => run(() => updateTrip(supabase, householdId, trip.id, t), 'trips')} />
          <p className="muted small" style={{ margin: 0 }}>
            Ticked lines count toward this trip and come out of regular spending. Spending in {trip.place === 'melbourne' ? 'Victoria' : trip.place === 'overseas' ? 'foreign currency' : 'the travel category'} during the trip is ticked for you.
          </p>
          {before.length > 0 && (<><h3>Flights and stays booked in the 4 months before</h3><ul className="list tx">{before.map(row)}</ul></>)}
          <h3>Spending during the trip</h3>
          {during.length ? <ul className="list tx">{during.map(row)}</ul> : <p className="muted small">Nothing between these dates.</p>}
          {confirmDelete ? (
            <div className="notice actions">
              <span>Delete "{trip.name}"? Its costs go back into regular spending.</span>
              <button type="button" className="primary" onClick={() => run(() => deleteTrip(supabase, householdId, trip.id), 'trips')}>Delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)}>Keep it</button>
            </div>
          ) : <button type="button" className="link" onClick={() => setConfirmDelete(true)}>Delete trip</button>}
        </div>
      )}
    </section>
  );
}

