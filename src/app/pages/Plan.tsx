// Plan: goals, the offset, what spending needs to look like, monthly targets, this month so far.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { applyOverrides, type Line } from '../../lib/classify';
import { buildOverview, type Overview as OverviewData } from '../../lib/overview';
import { goalMonthly, monthsUntil, offsetSplit, planFigures, shareCut, targetFor, trimGroups } from '../../lib/plan';
import {
  createGoal, deleteGoal, resetTargets, saveOffset, saveTargets, updateGoal,
  type Goal, type Targets,
} from '../../lib/store';
import { supabase } from '../../lib/supabase';
import { allocateTrips } from '../../lib/trips';
import { useGoals, useHousehold, useImports, useLines, useOffset, useOverrides, useTargets, useTrips, useUserSettings } from '../data';
import { day, money } from '../format';
import { useLoadState } from '../LoadState';

/** Today in the phone's own time zone (you're both in Darwin), as YYYY-MM-DD. */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const toCents = (v: string) => { const n = Number(v.replace(/[$,\s]/g, '')); return v.trim() === '' || !Number.isFinite(n) ? null : Math.round(n * 100); };
const dollarsText = (c: number | null) => (c === null ? '' : String(Math.round(c) / 100));
const monthLong = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

export function Plan() {
  const { household } = useHousehold();
  const hid = household!.id;
  const lines = useLines(hid), overrides = useOverrides(hid), trips = useTrips(hid), imports = useImports(hid);
  const goals = useGoals(hid), targets = useTargets(hid), offset = useOffset(hid);
  const { settings } = useUserSettings(hid);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const hasTrips = (trips.data?.trips.length ?? 0) > 0;
  const hideTrips = settings.hideTrips ?? hasTrips;

  const current = useMemo(() => (lines.data && overrides.data ? applyOverrides(lines.data, overrides.data) : null), [lines.data, overrides.data]);
  const alloc = useMemo(() => (current && trips.data?.trips.length ? allocateTrips(current, trips.data.trips, trips.data.overrides) : null), [current, trips.data]);
  const o = useMemo(() => (current && imports.data
    ? buildOverview({ lines: current, imports: imports.data.map(i => i.range), windowMonths: settings.windowMonths, hideTrips, trips: alloc })
    : null), [current, imports.data, settings.windowMonths, hideTrips, alloc]);

  async function run(action: () => Promise<unknown>, ...keys: string[]) {
    setError(null);
    try { await action(); await Promise.all(keys.map(k => queryClient.invalidateQueries({ queryKey: [k, hid] }))); }
    catch (e) { setError(`Couldn't save that (${(e as Error).message}). Try again.`); }
  }

  const wait = useLoadState([lines, overrides, trips, imports, goals, targets, offset], 'your plan');
  if (wait) return <><h1>Plan</h1>{wait}</>;
  if (!o) return <><h1>Plan</h1><div className="panel"><p><Link to="/data">Import a Frollo export</Link> first, so the plan has averages to work from.</p></div></>;

  const averages = Object.fromEntries(o.groups.map(g => [g.group, g.perMonth]));
  const t = targets.data!;
  const trim = trimGroups(Object.keys(averages), t.trim);
  const g = goals.data!;
  const now = today();
  const figures = planFigures({ incomePm: o.pm.income, principalPm: o.pm.principal, spendPm: o.pm.regular, goals: g, today: now, averages, savedTargets: t.amounts });
  const tripGoal = g.some(x => /trip/i.test(x.name));

  return (
    <>
      <h1>Plan</h1>
      <p className="muted small">Averages from the last {settings.windowMonths} months{o.hideTrips ? ', with trips left out' : ''}. Change the period on the <Link to="/">Overview</Link>.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <Goals goals={g} now={now} run={run} householdId={hid} />
      <OffsetPanel offset={offset.data!} goals={g} run={run} householdId={hid} />

      <section className="panel stack" aria-labelledby="need-heading">
        <h2 id="need-heading">What spending needs to look like</h2>
        <dl className="equation">
          <dt>Income</dt><dd className="in">{money(o.pm.income)}</dd>
          <dt className="muted">Extra loan principal</dt><dd>−{money(o.pm.principal)}</dd>
          <dt className="muted">Goal savings</dt><dd className="goal">−{money(figures.goalsPm)}</dd>
          <dt className="total">Left to spend each month</dt><dd className="total">{money(figures.budget)}</dd>
        </dl>
        <p className="verdict">
          {figures.cut > 0
            ? <>To fund these goals, {o.hideTrips ? 'regular ' : ''}spending needs to come down by <strong className="warn">{money(figures.cut)} a month</strong>, from {money(o.pm.regular)} to {money(figures.budget)}.</>
            : <>Your average {o.hideTrips ? 'regular ' : ''}spending fits, with <strong className="in">{money(-figures.cut)} a month</strong> to spare.</>}
        </p>
        {o.hideTrips && !tripGoal && (
          <p className="muted small" style={{ margin: 0 }}>Trips ({money(o.pm.trips)} a month) aren't in these averages. <Link to="/trips">Add a trips goal</Link> so they're covered.</p>
        )}
      </section>

      <TargetsPanel o={o} averages={averages} targets={t} trim={trim} budget={figures.budget} total={figures.targetsTotal} over={figures.over} run={run} householdId={hid} />
      <ThisMonth lines={current!} alloc={o.hideTrips ? alloc : null} averages={averages} targets={t} now={now} />
    </>
  );
}

type Run = (action: () => Promise<unknown>, ...keys: string[]) => Promise<void>;

/** Shows a change on screen straight away; the save and refetch follow behind it. */
function useShowNow() {
  const queryClient = useQueryClient();
  return <T,>(key: string, householdId: string, update: (old: T) => T) =>
    queryClient.setQueryData<T>([key, householdId], old => (old === undefined ? old : update(old)));
}

function Goals({ goals, now, run, householdId }: { goals: Goal[]; now: string; run: Run; householdId: string }) {
  const add = () => run(() => createGoal(supabase, householdId, {
    name: '', amount: null, targetMonth: `${Number(now.slice(0, 4)) + 1}${now.slice(4, 7)}`, saved: 0, sort: goals.length,
  }), 'goals');
  return (
    <section className="panel stack" aria-labelledby="goals-heading">
      <h2 id="goals-heading">Goals</h2>
      {goals.length === 0 && <p className="muted" style={{ margin: 0 }}>No goals yet. Add one for the next holiday or a big expense.</p>}
      {goals.map(g => <GoalRow key={g.id} goal={g} now={now} run={run} householdId={householdId} />)}
      <div><button type="button" onClick={add}>Add a goal</button></div>
    </section>
  );
}

function GoalRow({ goal, now, run, householdId }: { goal: Goal; now: string; run: Run; householdId: string }) {
  const showNow = useShowNow();
  // A local draft, so typing isn't interrupted; saved when a field is left.
  const [draft, setDraft] = useState({ name: goal.name, amount: dollarsText(goal.amount), month: goal.targetMonth ?? '', saved: dollarsText(goal.saved) });
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (document.activeElement?.closest(`[data-goal="${goal.id}"]`)) return; // don't overwrite while typing
    setDraft({ name: goal.name, amount: dollarsText(goal.amount), month: goal.targetMonth ?? '', saved: dollarsText(goal.saved) });
  }, [goal]);
  const parsed: Goal = { ...goal, name: draft.name.trim(), amount: toCents(draft.amount), targetMonth: draft.month || null, saved: toCents(draft.saved) ?? 0 };
  const save = () => {
    if (JSON.stringify(parsed) === JSON.stringify(goal)) return;
    showNow<Goal[]>('goals', householdId, gs => gs.map(x => (x.id === goal.id ? parsed : x)));
    void run(() => updateGoal(supabase, householdId, parsed), 'goals');
  };
  const pm = goalMonthly(parsed, now), months = monthsUntil(parsed.targetMonth, now);
  const pct = parsed.amount ? Math.min(100, (parsed.saved / parsed.amount) * 100) : 0;
  const when = !parsed.targetMonth ? 'Set a month' : months <= 0 ? 'The month has passed' : `${months} month${months === 1 ? '' : 's'} to go`;
  const id = (f: string) => `goal-${goal.id}-${f}`;

  return (
    <div className="goal-row" data-goal={goal.id}>
      <div className="full goal-name">
        <label htmlFor={id('name')} className="visually-hidden">Goal name</label>
        <input id={id('name')} className="text" placeholder="Goal name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} onBlur={save} />
      </div>
      <div><label htmlFor={id('amount')}>Amount ($)</label>
        <input id={id('amount')} className="text" inputMode="decimal" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} onBlur={save} /></div>
      <div><label htmlFor={id('month')}>Needed by</label>
        <input id={id('month')} className="text" type="month" value={draft.month} onChange={e => setDraft({ ...draft, month: e.target.value })} onBlur={save} /></div>
      <div><label htmlFor={id('saved')}>Set aside so far ($)</label>
        <input id={id('saved')} className="text" inputMode="decimal" value={draft.saved} onChange={e => setDraft({ ...draft, saved: e.target.value })} onBlur={save} /></div>
      <div><span className="label">{when}</span><div className="per-month">{money(pm)} a month</div></div>
      <div className="full">
        <div className="progress" role="progressbar" aria-label={`${draft.name || 'Goal'} progress`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%`, background: 'var(--chart-trips)' }} />
        </div>
        <div className="actions small" style={{ justifyContent: 'space-between', marginTop: '.25rem' }}>
          <span className="muted">{money(parsed.saved)} of {money(parsed.amount ?? 0)} set aside</span>
          {confirm
            ? <span className="actions"><span>Remove this goal?</span>
                <button type="button" className="link" onClick={() => { showNow<Goal[]>('goals', householdId, gs => gs.filter(x => x.id !== goal.id)); void run(() => deleteGoal(supabase, householdId, goal.id), 'goals'); }}>Remove</button>
                <button type="button" className="link" onClick={() => setConfirm(false)}>Keep</button></span>
            : <button type="button" className="link muted" onClick={() => setConfirm(true)}>Remove</button>}
        </div>
      </div>
    </div>
  );
}

function OffsetPanel({ offset, goals, run, householdId }: { offset: { balance: number | null; asOf: string | null }; goals: Goal[]; run: Run; householdId: string }) {
  const showNow = useShowNow();
  const [balance, setBalance] = useState(dollarsText(offset.balance));
  const [asOf, setAsOf] = useState(offset.asOf ?? '');
  useEffect(() => {
    if (document.activeElement?.closest('.offset-inputs')) return;
    setBalance(dollarsText(offset.balance)); setAsOf(offset.asOf ?? '');
  }, [offset]);
  const next = { balance: toCents(balance), asOf: asOf || null };
  const save = () => {
    if (next.balance === offset.balance && next.asOf === offset.asOf) return;
    showNow('settings', householdId, () => next);
    void run(() => saveOffset(supabase, householdId, next), 'settings');
  };
  const split = offsetSplit(next.balance, goals);

  return (
    <section className="panel stack" aria-labelledby="offset-heading">
      <h2 id="offset-heading">The offset</h2>
      <p className="muted small" style={{ margin: 0 }}>All the cash stays in the offset. Goals only earmark part of it.</p>
      <div className="offset-inputs trip-form">
        <div><label htmlFor="offset-balance">Balance ($)</label>
          <input id="offset-balance" className="text" inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)} onBlur={save} /></div>
        <div><label htmlFor="offset-date">As at</label>
          <input id="offset-date" className="text" type="date" value={asOf} onChange={e => setAsOf(e.target.value)} onBlur={save} /></div>
      </div>
      <dl className="equation">
        {next.balance !== null && <><dt>Offset balance</dt><dd>{money(next.balance)}</dd></>}
        <dt className="muted">Earmarked for goals</dt><dd className="goal">{next.balance !== null ? '−' : ''}{money(split.earmarked)}</dd>
        {split.free !== null && <><dt className="total">Free buffer</dt><dd className={`total${split.free < 0 ? ' warn' : ''}`}>{money(split.free)}</dd></>}
      </dl>
      {offset.asOf && <p className="muted small" style={{ margin: 0 }}>Balance as at {day(offset.asOf)}.</p>}
    </section>
  );
}

function TargetsPanel({ o, averages, targets, trim, budget, total, over, run, householdId }: {
  o: OverviewData; averages: Record<string, number>; targets: Targets; trim: Set<string>;
  budget: number; total: number; over: number; run: Run; householdId: string;
}) {
  const showNow = useShowNow();
  const put = (rows: { group: string; amount: number | null; trim: boolean | null }[]) => {
    showNow<Targets>('targets', householdId, old => {
      const next = { amounts: { ...old.amounts }, trim: { ...old.trim } };
      for (const r of rows) { next.amounts[r.group] = r.amount; next.trim[r.group] = r.trim; }
      return next;
    });
    return run(() => saveTargets(supabase, householdId, rows), 'targets');
  };
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const groups = o.groups.map(g => g.group);
  const saveAmount = (group: string, text: string) => {
    const amount = text.trim() === '' ? null : Math.max(0, toCents(text) ?? 0);
    setDrafts(d => { const { [group]: _gone, ...rest } = d; return rest; });
    if (amount !== (targets.amounts[group] ?? null)) void put([{ group, amount, trim: targets.trim[group] ?? null }]);
  };
  const saveTrim = (group: string, on: boolean) => put([{ group, amount: targets.amounts[group] ?? null, trim: on }]);

  async function share() {
    const r = shareCut(averages, targets.amounts, trim, budget);
    if (r.status === 'fits') return setMessage('Nothing to cut: targets already fit.');
    if (r.status === 'nothing-ticked') return setMessage('Tick at least one group to trim.');
    const saving = put(Object.entries(r.targets).map(([group, amount]) => ({ group, amount, trim: targets.trim[group] ?? null })));
    setMessage(r.status === 'not-enough' ? "Even cutting the ticked groups to zero doesn't close the gap. Tick more groups or push a goal date out." : null);
    await saving;
  }

  return (
    <section className="panel stack" aria-labelledby="targets-heading">
      <h2 id="targets-heading">Monthly targets</h2>
      <p className="muted small" style={{ margin: 0 }}>Start from your averages, then tick the groups you're willing to trim and share the cut across them.</p>
      <div className="table-scroll">
        <table className="table targets">
          <thead><tr><th scope="col">Group</th><th scope="col">Average</th><th scope="col">Target</th><th scope="col">Trim</th></tr></thead>
          <tbody>
            {groups.map(g => (
              <tr key={g}>
                <th scope="row">{g}</th>
                <td>{money(averages[g])}</td>
                <td>
                  <label htmlFor={`target-${g}`} className="visually-hidden">Target for {g}</label>
                  <input id={`target-${g}`} className="text amount-cell" inputMode="decimal"
                    value={drafts[g] ?? dollarsText(targetFor(g, averages, targets.amounts))}
                    onChange={e => setDrafts(d => ({ ...d, [g]: e.target.value }))} onBlur={e => saveAmount(g, e.target.value)} />
                </td>
                <td><input type="checkbox" aria-label={`Trim ${g}`} checked={trim.has(g)} onChange={e => saveTrim(g, e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th scope="row">Total</th><td>{money(o.pm.regular)}</td><td>{money(total)}</td><td /></tr></tfoot>
        </table>
      </div>
      <p className="small" role="status" style={{ margin: 0 }}>
        {Math.abs(over) < 100 ? "Your targets add up to what's left to spend."
          : over > 0 ? <>Targets are <span className="warn">{money(over)} a month over</span> what's left to spend.</>
          : <>Targets leave {money(-over)} a month unallocated, which stays in the offset.</>}
        {message && <> <span className="warn">{message}</span></>}
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={share}>Share the cut</button>
        <button type="button" onClick={() => {
          setMessage(null);
          showNow<Targets>('targets', householdId, old => ({ ...old, amounts: Object.fromEntries(Object.keys(old.amounts).map(k => [k, null])) }));
          void run(() => resetTargets(supabase, householdId), 'targets');
        }}>Reset to averages</button>
      </div>
    </section>
  );
}

function ThisMonth({ lines, alloc, averages, targets, now }: {
  lines: Line[]; alloc: ReturnType<typeof allocateTrips> | null; averages: Record<string, number>; targets: Targets; now: string;
}) {
  const month = now.slice(0, 7);
  const spend = lines.filter(l => l.kind === 'spend' && l.date.startsWith(month) && !(alloc?.owner.has(l.txId)));
  const newest = lines.reduce((d, l) => (l.kind !== 'excluded' && l.date > d ? l.date : d), '');
  const byGroup: Record<string, number> = {};
  for (const l of spend) byGroup[l.group!] = (byGroup[l.group!] ?? 0) - l.amount;
  const groups = [...new Set([...Object.keys(averages), ...Object.keys(byGroup)])]
    .map(g => ({ g, actual: byGroup[g] ?? 0, target: targetFor(g, averages, targets.amounts) }))
    .filter(r => r.actual > 0 || r.target > 0)
    .sort((a, b) => b.target - a.target);
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate(), dayOfMonth = Number(now.slice(8, 10));

  return (
    <section className="panel stack" aria-labelledby="month-heading">
      <h2 id="month-heading">This month so far</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {monthLong(month)}, day {dayOfMonth} of {daysInMonth}.{' '}
        {newest < `${month}-01` ? <>No transactions for this month yet. <Link to="/data">Import a newer export</Link>.</>
          : <>Transactions up to {day(newest)}{alloc ? ', trips left out' : ''}.</>}
      </p>
      {newest >= `${month}-01` && (
        <ul className="groups">
          {groups.map(({ g, actual, target }) => (
            <li key={g} className="month-row">
              <div className="group-row" style={{ cursor: 'default' }}>
                <span>{g}</span>
                <span className="amt">{money(actual)} <span className="muted small">of {money(target)}</span></span>
                <span className="track" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, target > 0 ? (actual / target) * 100 : 100)}%`, background: actual > target ? 'var(--warning)' : 'var(--chart-spend)' }} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
