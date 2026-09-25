// Overview: the headline, month by month, where the money goes, and what isn't spending.
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { applyOverrides, type Line } from '../../lib/classify';
import { linesToCheck } from '../../lib/checks';
import { businessBalance, buildOverview, type GroupRow, type Overview as OverviewData } from '../../lib/overview';
import { saveBusinessOwed } from '../../lib/store';
import { supabase } from '../../lib/supabase';
import type { WindowMonths } from '../../lib/summary';
import { allocateTrips } from '../../lib/trips';
import { useBusinessOwed, useHousehold, useImports, useLines, useOverrides, useTrips, useUserSettings } from '../data';
import { day, money, plural, range } from '../format';
import { useLoadState } from '../LoadState';
import { MonthChart } from '../MonthChart';

const WINDOWS: WindowMonths[] = [12, 6, 3];

export function Overview() {
  const { household } = useHousehold();
  const hid = household!.id;
  const lines = useLines(hid), imports = useImports(hid), overrides = useOverrides(hid), trips = useTrips(hid);
  const { settings, save } = useUserSettings(hid);
  const hasTrips = (trips.data?.trips.length ?? 0) > 0;
  // Until someone chooses, trips are left out whenever at least one exists.
  const hideTrips = settings.hideTrips ?? hasTrips;

  const current = useMemo(
    () => (lines.data && overrides.data ? applyOverrides(lines.data, overrides.data) : null),
    [lines.data, overrides.data],
  );
  const o = useMemo(() => {
    if (!current || !imports.data || !trips.data) return null;
    const alloc = trips.data.trips.length ? allocateTrips(current, trips.data.trips, trips.data.overrides) : null;
    return buildOverview({ lines: current, imports: imports.data.map(i => i.range), windowMonths: settings.windowMonths, hideTrips, trips: alloc });
  }, [current, imports.data, trips.data, settings.windowMonths, hideTrips]);
  const unanswered = useMemo(
    () => (lines.data && current && overrides.data ? linesToCheck(lines.data, current, overrides.data).filter(c => !c.answer).length : 0),
    [lines.data, current, overrides.data],
  );

  const wait = useLoadState([lines, imports, overrides, trips], 'your figures');
  if (wait) return <><h1>Overview</h1>{wait}</>;
  if (!o) {
    return (
      <>
        <h1>Overview</h1>
        <div className="panel"><p>No transactions yet. <Link to="/data">Import a Frollo export</Link> to see where the money goes.</p></div>
      </>
    );
  }

  const label = `${settings.windowMonths} months`;
  return (
    <>
      <div className="page-head">
        <h1>Overview</h1>
        <div className="segmented" role="group" aria-label="Period">
          {WINDOWS.map(w => (
            <button key={w} type="button" aria-pressed={settings.windowMonths === w}
              onClick={() => save({ ...settings, windowMonths: w })}>{w} months</button>
          ))}
        </div>
      </div>
      <p className="muted small">{range(o.window)}</p>
      {o.missing.length > 0 && (
        <p className="notice warn small" role="status">Missing data: {o.missing.map(range).join('; ')}. Averages only count the days you have data for.</p>
      )}
      {unanswered > 0 && (
        <p className="notice small"><Link to="/data">{plural(unanswered, 'line')} to check</Link> before these figures are final.</p>
      )}

      <Headline o={o} label={label} />
      {hasTrips && (
        <label className="toggle panel">
          <input type="checkbox" checked={hideTrips} onChange={e => save({ ...settings, hideTrips: e.target.checked })} />
          <span>Leave trips out of regular spending</span>
        </label>
      )}

      <section className="panel stack" aria-labelledby="months-heading">
        <h2 id="months-heading">Month by month</h2>
        <MonthChart bars={o.bars} showTrips={hideTrips && o.pm.trips > 0} />
      </section>

      <WhereItGoes o={o} />
      <NotCounted o={o} lines={current!} householdId={hid} dataStart={imports.data!.reduce((d, i) => (i.range.from < d ? i.range.from : d), o.window.to)} />
    </>
  );
}

function Headline({ o, label }: { o: OverviewData; label: string }) {
  const gap = o.pm.regular - o.pm.income;
  const regular = o.hideTrips ? ' on regular living' : '';
  return (
    <section className="panel headline" aria-label="Summary">
      <p className="lead">
        Over the last {label} you spent <strong className="out">{money(o.pm.regular)}</strong> a month{regular} and
        earned <strong className="in">{money(o.pm.income)}</strong>.
      </p>
      <p className="muted" style={{ margin: 0 }}>
        {o.hideTrips && <>Trips added another {money(o.pm.trips)} a month on top. </>}
        {gap > 0
          ? <>{o.hideTrips ? 'Regular spending' : 'Spending'} is {money(gap)} a month more than pay income, before {money(o.pm.principal)} a month of extra loan principal.</>
          : <>That leaves {money(-gap)} a month after {o.hideTrips ? 'regular ' : ''}spending, before {money(o.pm.principal)} a month of extra loan principal.</>}
      </p>
    </section>
  );
}

function WhereItGoes({ o }: { o: OverviewData }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = o.groups[0]?.perMonth ?? 1;
  return (
    <section className="panel stack" aria-labelledby="where-heading">
      <h2 id="where-heading">Where it goes</h2>
      <p className="muted small" style={{ margin: 0 }}>Average per month{o.hideTrips ? ', with trips left out' : ''}. Tap a group to see its categories and who got paid.</p>
      <ul className="groups">
        {o.groups.map(g => (
          <li key={g.group}>
            <button type="button" className="group-row" aria-expanded={open === g.group} onClick={() => setOpen(open === g.group ? null : g.group)}>
              <span>{g.group}</span>
              <span className="amt">{money(g.perMonth)}</span>
              <span className="track" aria-hidden="true"><span style={{ width: `${Math.max(0, (g.perMonth / max) * 100).toFixed(1)}%` }} /></span>
            </button>
            {open === g.group && <GroupDetail g={g} tripsIncluded={o.hideTrips} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function GroupDetail({ g, tripsIncluded }: { g: GroupRow; tripsIncluded: boolean }) {
  return (
    <div className="group-detail small">
      {g.categories.length > 1 && (
        <>
          <h3>Categories, per month</h3>
          <table className="table"><tbody>
            {g.categories.map(c => <tr key={c.category}><th scope="row">{c.category}</th><td>{money(c.perMonth)}</td></tr>)}
          </tbody></table>
        </>
      )}
      <h3>Biggest payees, whole period{tripsIncluded ? ', trips included' : ''}</h3>
      <table className="table"><tbody>
        {g.payees.map(p => <tr key={p.name}><th scope="row">{p.name} <span className="muted">× {p.count}</span></th><td>{money(p.total)}</td></tr>)}
      </tbody></table>
    </div>
  );
}

function NotCounted({ o, lines, householdId, dataStart }: { o: OverviewData; lines: Line[]; householdId: string; dataStart: string }) {
  const b = o.business;
  return (
    <section className="panel stack" aria-labelledby="not-counted-heading">
      <h2 id="not-counted-heading">Not counted as spending</h2>
      <ul className="list">
        <li><span>Extra loan principal<br /><span className="muted small">Repayments minus interest, paid down off the home loan</span></span>
          <span>{money(o.pm.principal)}/mo<br /><span className="muted small">{money(o.summary.totals.loanPrincipal)} in total</span></span></li>
        {o.capital.map(c => (
          <li key={c.what}><span>{c.what}<br /><span className="muted small">{c.payments > 1 ? `${c.payments} payments, ${range({ from: c.from, to: c.to })}` : day(c.from)}</span></span><span>{money(c.amount)}</span></li>
        ))}
      </ul>
      <BusinessLoan period={b} lines={lines} householdId={householdId} dataStart={dataStart} />
      {b.lines.length > 0 && (
        <details className="small">
          <summary>TCM loan movements</summary>
          <table className="table"><tbody>
            {b.lines.map(l => <tr key={l.date + l.amount}><th scope="row">{day(l.date)} · {l.kind === 'loan' ? 'Lent' : 'Repaid'}</th><td>{money(l.amount)}</td></tr>)}
          </tbody></table>
          <p className="muted">Mark incoming TCM payments as repayments under <Link to="/data">Data → To check</Link>.</p>
        </details>
      )}
    </section>
  );
}

function BusinessLoan({ period, lines, householdId, dataStart }: {
  period: OverviewData['business']; lines: Line[]; householdId: string; dataStart: string;
}) {
  const owed = useBusinessOwed(householdId);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const balance = owed.data ? businessBalance(lines, owed.data) : null;
  const asOf = owed.data?.asOf ?? dataStart;
  if (!owed.data && period.lent === 0 && period.repaid === 0) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const dollars = Number(value.replace(/[$,s]/g, ''));
    if (!Number.isFinite(dollars) || dollars < 0) return setError('Enter an amount in dollars, like 10000.');
    try {
      await saveBusinessOwed(supabase, householdId, { amount: Math.round(dollars * 100), asOf });
      await queryClient.invalidateQueries({ queryKey: ['business-owed', householdId] });
      setEditing(false); setError(null);
    } catch (err) {
      setError(`Couldn't save that (${(err as Error).message}).`);
    }
  }

  return (
    <div className="stack">
      <ul className="list">
        <li>
          <span>Loan to TCM (LandCruiser)<br />
            <span className="muted small">
              {balance
                ? <>Owed {money(balance.owedBefore)} before {day(balance.asOf)} · lent {money(balance.lent)} · repaid {money(balance.repaid)} since</>
                : <>Lent {money(period.lent)} · repaid {money(period.repaid)} in this period</>}
            </span>
          </span>
          <span>{balance ? money(balance.stillOwed) : money(period.lent - period.repaid)}<br />
            <span className="muted small">{balance ? 'still owed' : 'net lent'}</span></span>
        </li>
      </ul>
      {editing ? (
        <form className="actions" onSubmit={submit}>
          <label htmlFor="owed-before" className="small" style={{ width: '100%' }}>What TCM owed you before {day(asOf)}</label>
          <input id="owed-before" inputMode="decimal" className="amount" placeholder="10000" value={value} onChange={e => setValue(e.target.value)} />
          <button type="submit" className="primary">Save</button>
          <button type="button" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
          {error && <p className="error small" role="alert" style={{ width: '100%', margin: 0 }}>{error}</p>}
        </form>
      ) : (
        <p className="small" style={{ margin: 0 }}>
          {!balance && <span className="muted">Add what TCM owed before {day(asOf)} to see what's still owed. </span>}
          <button type="button" className="link" onClick={() => { setValue(owed.data ? String(owed.data.amount / 100) : ''); setEditing(true); }}>
            {balance ? 'Change the starting amount' : 'Add it'}
          </button>
        </p>
      )}
    </div>
  );
}
