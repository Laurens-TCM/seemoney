// Events: trips, labelled purchases and the events worked out from your transactions (capital
// items, the business loan, extra home-loan payments, big one-off income). Trips work as in v1.
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { applyOverrides, type Bucket, type Line } from '../../lib/classify';
import {
  allocateEvents, automaticEvents, EVENT_TYPES, eventLabel, suggestLabels,
  type AutoEvent, type EventAllocation, type EventType, type StoredEvent, type TripKind,
} from '../../lib/events';
import {
  createEvent, createGoal, deleteEvent, dismissLabel, dismissSuggestion, labelLine, saveBigPurchaseThreshold,
  setEventTick, undismiss, undismissLabel, updateEvent, type EventInput,
} from '../../lib/store';
import { coveredDays, daysBetween, perMonth, windowFor } from '../../lib/summary';
import { supabase } from '../../lib/supabase';
import { suggestTrips, tripDatesFor, type Allocation, type Candidate, type Suggestion, type Trip, type TripPlace } from '../../lib/trips';
import { useBigPurchaseThreshold, useDismissed, useDismissedEvents, useEvents, useGoals, useHousehold, useImports, useLines, useOverrides } from '../data';
import { EventChip } from '../EventChip';
import { day, money, plural, range } from '../format';
import { useLoadState } from '../LoadState';

const KINDS: Record<TripKind, string> = { family: 'Friends & family', holiday: 'Holiday', work: 'Work' };
const PLACES: Record<TripPlace, string> = { melbourne: 'Melbourne & Victoria', overseas: 'Overseas', any: 'Somewhere else' };
const BUCKETS: Bucket[] = ['Flights', 'Accommodation', 'Food & drink', 'Getting around', 'Activities', 'Other'];
/** Types you can give a spending line with "Label this?". */
const LABEL_TYPES: EventType[] = ['big', 'bill', 'trip'];
const TRIPS_GOAL = 'Trips, next 12 months';
/** "Label this?" shows this many until you ask for the rest. */
const LABELS_SHOWN = 3;

const monthYear = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
const nextYearMonth = () => { const d = new Date(); d.setMonth(d.getMonth() + 12); return d.toISOString().slice(0, 7); };
const asTrip = (e: StoredEvent): Trip => ({ id: e.id, start: e.start, end: e.end, place: e.place ?? 'any' });
const when = (e: { start: string; end: string }) => (e.start === e.end ? day(e.start) : range({ from: e.start, to: e.end }));

type Item = { kind: 'stored'; event: StoredEvent } | { kind: 'auto'; event: AutoEvent };

export function Events() {
  const { household } = useHousehold();
  const hid = household!.id;
  const lines = useLines(hid), overrides = useOverrides(hid), events = useEvents(hid), dismissed = useDismissed(hid);
  const imports = useImports(hid), goals = useGoals(hid), dismissedEvents = useDismissedEvents(hid), threshold = useBigPurchaseThreshold(hid);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<EventType | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allLabels, setAllLabels] = useState(false);

  const current = useMemo(() => (lines.data && overrides.data ? applyOverrides(lines.data, overrides.data) : null), [lines.data, overrides.data]);
  const alloc = useMemo(() => (current && events.data ? allocateEvents(current, events.data.events, events.data.overrides) : null), [current, events.data]);
  const auto = useMemo(() => (current ? automaticEvents(current) : []), [current]);
  const tripSuggestions = useMemo(
    () => (current && events.data && dismissed.data ? suggestTrips(current, events.data.events.filter(e => e.type === 'trip').map(asTrip), dismissed.data) : []),
    [current, events.data, dismissed.data],
  );
  const labels = useMemo(
    () => (current && alloc && dismissedEvents.data && threshold.data != null ? suggestLabels(current, alloc.owner, dismissedEvents.data, threshold.data) : []),
    [current, alloc, dismissedEvents.data, threshold.data],
  );

  const refresh = (...keys: string[]) => Promise.all(keys.map(k => queryClient.invalidateQueries({ queryKey: [k, hid] })));
  async function run(action: () => Promise<unknown>, ...keys: string[]) {
    setError(null);
    try { await action(); await refresh(...keys); } catch (e) { setError(`Couldn't save that (${(e as Error).message}). Try again.`); }
  }

  const wait = useLoadState([lines, overrides, events, dismissed, imports, goals, dismissedEvents, threshold], 'your events');
  if (wait) return <><h1>Events</h1>{wait}</>;
  if (!current?.length) {
    return <><h1>Events</h1><div className="panel"><p><Link to="/data">Import a Frollo export</Link> first, then trips and other events can be found in it.</p></div></>;
  }

  const stored = events.data!.events;
  const trips = stored.filter(e => e.type === 'trip');
  const items: Item[] = [
    ...stored.map(event => ({ kind: 'stored' as const, event })),
    ...auto.map(event => ({ kind: 'auto' as const, event })),
  ].filter(i => filter === 'all' || i.event.type === filter).sort((a, b) => (a.event.start < b.event.start ? 1 : -1));
  const present = EVENT_TYPES.filter(t => stored.some(e => e.type === t.key) || auto.some(e => e.type === t.key));
  const recharge = trips.filter(t => t.kind === 'work' && t.rechargeToBusiness);

  async function addFromSuggestion(s: Suggestion) {
    let id = '';
    await run(async () => { id = await createEvent(supabase, hid, { type: 'trip', name: `Melbourne, ${monthYear(s.start)}`, ...tripDatesFor(s), kind: 'family', place: 'melbourne' }); }, 'events');
    if (id) setOpen(id);
  }

  return (
    <>
      <div className="page-head">
        <h1>Events</h1>
        <button type="button" className="primary" onClick={() => setAdding(true)}>Add a trip</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <TripSummary trips={trips} alloc={alloc!.trips} lines={current} imports={imports.data!.map(i => i.range)}
        hasGoal={!!goals.data?.some(g => /trip/i.test(g.name))}
        onGoal={amount => run(() => createGoal(supabase, hid, { name: TRIPS_GOAL, amount, targetMonth: nextYearMonth(), saved: 0, sort: 0 }), 'goals')} />

      {adding && (
        <section className="panel stack" aria-labelledby="new-trip-heading">
          <h2 id="new-trip-heading">New trip</h2>
          <TripForm submitLabel="Add trip" onCancel={() => setAdding(false)}
            onSubmit={async t => { let id = ''; await run(async () => { id = await createEvent(supabase, hid, t); }, 'events'); if (id) { setAdding(false); setOpen(id); } }} />
        </section>
      )}

      {labels.length > 0 && (
        <section className="panel stack" aria-labelledby="label-heading">
          <h2 id="label-heading">Label this?</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Single purchases of {money(threshold.data!)} or more. Label one as an event and it comes out of regular spending when events are left out.
          </p>
          <ul className="list">
            {(allLabels ? labels : labels.slice(0, LABELS_SHOWN)).map(l => (
              <li key={l.txId} className="check">
                <div className="check-head">
                  <span><strong>{l.name}</strong><br /><span className="muted small">{day(l.date)} · {l.group}</span></span>
                  <strong>{money(-l.amount, true)}</strong>
                </div>
                <div className="actions">
                  {LABEL_TYPES.map(t => (
                    <button key={t} type="button" className="small-button"
                      onClick={async () => {
                        let id = '';
                        await run(async () => {
                          id = t === 'trip'
                            ? await createEvent(supabase, hid, { type: 'trip', name: l.name, start: l.date, end: l.date, kind: 'holiday', place: 'any' }).then(async e => { await setEventTick(supabase, hid, e, l.txId, true); return e; })
                            : await labelLine(supabase, hid, l, { type: t, name: l.name });
                        }, 'events');
                        if (id) setOpen(id);
                      }}>
                      <EventChip type={t} bare /> {eventLabel(t)}
                    </button>
                  ))}
                  <button type="button" className="link muted" onClick={() => run(() => dismissLabel(supabase, hid, l.txId), 'dismissed-events')}>Not an event</button>
                </div>
              </li>
            ))}
          </ul>
          {labels.length > LABELS_SHOWN && (
            <button type="button" className="link" onClick={() => setAllLabels(!allLabels)}>
              {allLabels ? 'Show fewer' : `Show all ${labels.length}`}
            </button>
          )}
        </section>
      )}

      {tripSuggestions.length > 0 && (
        <section className="panel stack" aria-labelledby="suggest-heading">
          <h2 id="suggest-heading">Melbourne visits found in your spending</h2>
          <p className="muted small" style={{ margin: 0 }}>Days with eating out, shopping or getting around in Victoria. Add any that were trips; flights booked beforehand can be ticked on the trip.</p>
          <ul className="list">
            {tripSuggestions.map(s => (
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

      <div className="segmented" role="group" aria-label="Show" style={{ marginBottom: '1rem' }}>
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
        {present.map(t => (
          <button key={t.key} type="button" aria-pressed={filter === t.key} onClick={() => setFilter(t.key)}>{t.plural}</button>
        ))}
      </div>

      {items.length === 0 && !adding && (
        <div className="panel"><p className="muted" style={{ margin: 0 }}>
          {stored.length || auto.length ? 'No events of this type.' : 'No events yet. Add a trip, or pick from the Melbourne visits found in your spending.'}
        </p></div>
      )}
      {items.map(i => (i.kind === 'auto'
        ? <AutoCard key={i.event.id} event={i.event} />
        : i.event.type === 'trip'
          ? <TripCard key={i.event.id} trip={i.event} alloc={alloc!.trips} trips={trips} householdId={hid} open={open === i.event.id}
            onToggle={() => setOpen(open === i.event.id ? null : i.event.id)} run={run} />
          : <LabelledCard key={i.event.id} event={i.event} alloc={alloc!} householdId={hid} open={open === i.event.id}
            onToggle={() => setOpen(open === i.event.id ? null : i.event.id)} run={run} />
      ))}

      {recharge.length > 0 && (
        <section className="panel stack" aria-labelledby="recharge-heading">
          <h2 id="recharge-heading">Recharge to TCM</h2>
          <p className="muted small" style={{ margin: 0 }}>Work trips to pass to the accountant.</p>
          <ul className="list">
            {recharge.map(t => <li key={t.id}><span>{t.name}<br /><span className="muted small">{range({ from: t.start, to: t.end })}</span></span><span>{money(alloc!.trips.perTrip[t.id]?.total ?? 0)}</span></li>)}
          </ul>
        </section>
      )}

      <Threshold value={threshold.data!} onSave={cents => run(() => saveBigPurchaseThreshold(supabase, hid, cents), 'big-purchase')} />

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
      {(dismissedEvents.data?.size ?? 0) > 0 && (
        <details className="small panel">
          <summary>Not events ({dismissedEvents.data!.size})</summary>
          <ul className="list">
            {[...dismissedEvents.data!].map(txId => {
              const l = current.find(x => x.txId === txId);
              return (
                <li key={txId}><span>{l ? `${l.name}, ${day(l.date)}, ${money(-l.amount)}` : 'A transaction no longer in your data'}</span>
                  <button type="button" className="link" onClick={() => run(() => undismissLabel(supabase, hid, txId), 'dismissed-events')}>Show again</button></li>
              );
            })}
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

function TripSummary({ trips, alloc, lines, imports, hasGoal, onGoal }: {
  trips: StoredEvent[]; alloc: Allocation; lines: Line[]; imports: { from: string; to: string }[];
  hasGoal: boolean; onGoal: (amount: number) => void;
}) {
  if (!trips.length) return null;
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
      <p className="lead" style={{ margin: 0 }}><EventChip type="trip" bare /> {plural(trips.length, 'trip')} cost <strong>{money(alloc.total)}</strong>, about {money(pm)} a month.</p>
      <Buckets buckets={buckets} />
      <div className="actions">
        {hasGoal
          ? <span className="muted small">There's a trips goal on the <Link to="/plan">Plan</Link>.</span>
          : <button type="button" onClick={() => onGoal(goal)}>Save for the next 12 months of trips</button>}
      </div>
    </section>
  );
}

type TripInput = { name: string; start: string; end: string; kind: TripKind; place: TripPlace; rechargeToBusiness?: boolean };

function TripForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: TripInput; submitLabel: string; onSubmit: (t: EventInput) => Promise<void>; onCancel?: () => void;
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
    await onSubmit({ ...t, type: 'trip', name: t.name.trim() });
    setBusy(false);
  }

  return (
    <form className="trip-form" onSubmit={submit}>
      <div className="full"><label htmlFor="trip-name">Trip name</label>
        <input id="trip-name" className="text" value={t.name} onChange={e => set('name', e.target.value)} placeholder="Melbourne, October 2025" /></div>
      <div><label htmlFor="trip-start">From</label><input id="trip-start" type="date" className="text" value={t.start} onChange={e => set('start', e.target.value)} /></div>
      <div><label htmlFor="trip-end">To</label><input id="trip-end" type="date" className="text" value={t.end} onChange={e => set('end', e.target.value)} /></div>
      <div><label htmlFor="trip-kind">Type</label>
        <select id="trip-kind" value={t.kind} onChange={e => set('kind', e.target.value as TripKind)}>
          {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
      <div><label htmlFor="trip-place">Where</label>
        <select id="trip-place" value={t.place} onChange={e => set('place', e.target.value as TripPlace)}>
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

type Run = (action: () => Promise<unknown>, ...keys: string[]) => Promise<void>;

function DeleteButton({ what, onDelete }: { what: string; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <div className="notice actions">
      <span>Delete "{what}"? Its costs go back into regular spending.</span>
      <button type="button" className="primary" onClick={onDelete}>Delete</button>
      <button type="button" onClick={() => setConfirm(false)}>Keep it</button>
    </div>
  ) : <button type="button" className="link" onClick={() => setConfirm(true)}>Delete</button>;
}

function TripCard({ trip, alloc, trips, householdId, open, onToggle, run }: {
  trip: StoredEvent; alloc: Allocation; trips: StoredEvent[]; householdId: string; open: boolean; onToggle: () => void; run: Run;
}) {
  const queryClient = useQueryClient();
  const p = alloc.perTrip[trip.id] ?? { total: 0, lines: 0, buckets: {} };
  const nights = daysBetween(trip.start, trip.end);
  const kind = trip.kind ?? 'family', place = trip.place ?? 'any';
  const candidates = (alloc.candidates[trip.id] ?? []).slice().sort((a, b) => (a.line.date < b.line.date ? -1 : 1));
  const before = candidates.filter(c => !c.during), during = candidates.filter(c => c.during);

  async function tick(c: Candidate, included: boolean) {
    // Show the tick straight away, then save it.
    queryClient.setQueryData<{ events: StoredEvent[]; overrides: { eventId: string; txId: string; included: boolean }[] }>(['events', householdId], old => old && {
      ...old, overrides: [...old.overrides.filter(o => !(o.eventId === trip.id && o.txId === c.line.txId)), { eventId: trip.id, txId: c.line.txId, included }],
    });
    await run(() => setEventTick(supabase, householdId, trip.id, c.line.txId, included), 'events');
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
        <span><EventChip type="trip" /> <strong>{trip.name}</strong><br />
          <span className="muted small">{range({ from: trip.start, to: trip.end })} · {plural(nights, 'night')} · {KINDS[kind]}{trip.rechargeToBusiness ? ' · recharge to TCM' : ''}</span></span>
        <span className="amt">{money(p.total)}</span>
      </button>
      <Buckets buckets={p.buckets} />
      {open && (
        <div className="stack" style={{ marginTop: '.75rem' }}>
          <TripForm submitLabel="Save changes" initial={{ name: trip.name, start: trip.start, end: trip.end, kind, place, rechargeToBusiness: trip.rechargeToBusiness }}
            onSubmit={t => run(() => updateEvent(supabase, householdId, trip.id, t), 'events')} />
          <p className="muted small" style={{ margin: 0 }}>
            Ticked lines count toward this trip and come out of regular spending. Spending in {place === 'melbourne' ? 'Victoria' : place === 'overseas' ? 'foreign currency' : 'the travel category'} during the trip is ticked for you.
          </p>
          {before.length > 0 && (<><h3>Flights and stays booked in the 4 months before</h3><ul className="list tx">{before.map(row)}</ul></>)}
          <h3>Spending during the trip</h3>
          {during.length ? <ul className="list tx">{during.map(row)}</ul> : <p className="muted small">Nothing between these dates.</p>}
          <DeleteButton what={trip.name} onDelete={() => run(() => deleteEvent(supabase, householdId, trip.id), 'events')} />
        </div>
      )}
    </section>
  );
}

/** A labelled purchase or bill: the lines ticked onto it, a name and a type. */
function LabelledCard({ event, alloc, householdId, open, onToggle, run }: {
  event: StoredEvent; alloc: EventAllocation; householdId: string; open: boolean; onToggle: () => void; run: Run;
}) {
  const [name, setName] = useState(event.name);
  const [type, setType] = useState(event.type);
  const p = alloc.perEvent[event.id] ?? { lines: [], total: 0 };

  function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    void run(() => updateEvent(supabase, householdId, event.id, { type, name: name.trim(), start: event.start, end: event.end }), 'events');
  }

  return (
    <section className="panel trip" aria-label={event.name}>
      <button type="button" className="trip-head" aria-expanded={open} onClick={onToggle}>
        <span><EventChip type={event.type} /> <strong>{event.name}</strong><br />
          <span className="muted small">{when(event)} · {plural(p.lines.length, 'payment')}</span></span>
        <span className="amt">{money(p.total)}</span>
      </button>
      {open && (
        <div className="stack">
          <form className="trip-form" onSubmit={save}>
            <div className="full"><label htmlFor={`name-${event.id}`}>Name</label>
              <input id={`name-${event.id}`} className="text" value={name} onChange={e => setName(e.target.value)} /></div>
            <div><label htmlFor={`type-${event.id}`}>Type</label>
              <select id={`type-${event.id}`} value={type} onChange={e => setType(e.target.value as EventType)}>
                {LABEL_TYPES.filter(t => t !== 'trip').map(t => <option key={t} value={t}>{eventLabel(t)}</option>)}
              </select></div>
            <div className="actions full"><button type="submit" className="primary">Save changes</button></div>
          </form>
          <ul className="list tx">
            {p.lines.map(l => (
              <li key={l.txId}>
                <span>{l.name}<br /><span className="muted small">{day(l.date)} · {l.group}</span></span>
                <span className="actions">
                  {money(-l.amount, true)}
                  {p.lines.length > 1 && <button type="button" className="link muted small" onClick={() => run(() => setEventTick(supabase, householdId, event.id, l.txId, null), 'events')}>Remove</button>}
                </span>
              </li>
            ))}
          </ul>
          <DeleteButton what={event.name} onDelete={() => run(() => deleteEvent(supabase, householdId, event.id), 'events')} />
        </div>
      )}
    </section>
  );
}

/** Worked out from your transactions each time; nothing to edit here. */
function AutoCard({ event }: { event: AutoEvent }) {
  return (
    <section className="panel trip" aria-label={event.name}>
      <div className="trip-head" style={{ padding: 0 }}>
        <span><EventChip type={event.type} /> <strong>{event.name}</strong><br />
          <span className="muted small">{when(event)}{event.lines.length > 1 ? ` · ${plural(event.lines.length, 'payment')}` : ''} · found in your transactions</span></span>
        <span className={`amt${event.direction === 'in' ? ' in' : ''}`}>{event.direction === 'in' ? '+' : ''}{money(event.total)}</span>
      </div>
    </section>
  );
}

function Threshold({ value, onSave }: { value: number; onSave: (cents: number) => void }) {
  const [text, setText] = useState(String(value / 100));
  function submit(e: FormEvent) {
    e.preventDefault();
    const dollars = Number(text.replace(/[$,\s]/g, ''));
    if (dollars > 0) onSave(Math.round(dollars * 100));
  }
  return (
    <details className="small panel">
      <summary>When to ask "Label this?"</summary>
      <form className="actions" onSubmit={submit} style={{ marginTop: '.5rem' }}>
        <label htmlFor="threshold" style={{ margin: 0 }}>Ask about single purchases of</label>
        <input id="threshold" className="amount" inputMode="decimal" value={text} onChange={e => setText(e.target.value)} />
        <span>or more</span>
        <button type="submit">Save</button>
      </form>
    </details>
  );
}
