// Data: pick a Frollo CSV, preview it (classified on this device), import it, see the history.
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ChangeEvent } from 'react';
import { classifyRows, type ClassifyResult, type Line, type SkipReason } from '../../lib/classify';
import { parseFrolloCsv } from '../../lib/csv';
import { importClassified, type ImportOutcome, type ImportRecord } from '../../lib/store';
import { businessRepaymentChecks, missingRanges, summarise, windowFor, type Summary } from '../../lib/summary';
import { supabase } from '../../lib/supabase';
import { useHousehold, useImports, useLines } from '../data';
import { Checks } from './Checks';
import { day, money, number, plural, range } from '../format';

type Preview = { fileName: string; result: ClassifyResult; summary: Summary; checks: Line[] };

const SKIP_TEXT: Record<SkipReason | 'excluded', (n: number) => string> = {
  pending: n => `${plural(n, 'pending card payment')}. They'll come through in your next export.`,
  excluded: n => `${plural(n, 'row')} Frollo marks as not included (like a property valuation).`,
  'no transaction id': n => `${plural(n, 'row')} without a transaction ID.`,
  'no date': n => `${plural(n, 'row')} without a date.`,
  'amount not a number': n => `${plural(n, 'row')} whose amount isn't a number.`,
};

export function Data() {
  const { household } = useHousehold();
  const hid = household!.id;
  const imports = useImports(hid);
  const lines = useLines(hid);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportOutcome | null>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileError(null); setPreview(null); setDone(null);
    try {
      const { rows, missing } = parseFrolloCsv(await file.text());
      if (missing.length) return setFileError(`This doesn't look like a Frollo transactions export: it's missing ${missing.join(', ')}.`);
      const result = classifyRows(rows);
      const summary = summarise(result.lines);
      if (!summary.range) return setFileError('This file has no transactions to import.');
      setPreview({ fileName: file.name, result, summary, checks: businessRepaymentChecks(result.lines) });
    } catch {
      setFileError("Couldn't read that file. Export it from Frollo again and try once more.");
    }
  }

  return (
    <>
      <h1>Data</h1>
      <section className="panel stack" aria-labelledby="add-heading">
        <h2 id="add-heading">Add a Frollo export</h2>
        <p className="muted small">
          The file is read and sorted on this device. Only the sorted transactions are saved to your household.
        </p>
        <div className="file-pick">
          <label htmlFor="csv">Transactions CSV</label>
          <input id="csv" type="file" accept=".csv,text/csv" onChange={pick} />
        </div>
        {fileError && <p className="error" role="alert">{fileError}</p>}
        {done && <p className="in" role="status">Saved {plural(done.saved, 'transaction')}: {number(done.newLines)} new, {number(done.saved - done.newLines)} updated.</p>}
      </section>

      {preview && (
        <PreviewPanel preview={preview} householdId={hid} existing={lines.data}
          onCancel={() => setPreview(null)} onDone={o => { setPreview(null); setDone(o); }} />
      )}

      <Checks householdId={hid} />
      <History imports={imports.data} lines={lines.data} members={household!.members} loading={imports.isLoading || lines.isLoading} />
      <Fixes />
    </>
  );
}

function PreviewPanel({ preview, householdId, existing, onCancel, onDone }: {
  preview: Preview; householdId: string; existing: Line[] | undefined;
  onCancel: () => void; onDone: (o: ImportOutcome) => void;
}) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { fileName, result, summary, checks } = preview;
  const t = summary.totals;

  const already = useMemo(() => {
    if (!existing) return null;
    const ids = new Set(existing.map(l => l.txId));
    return result.lines.filter(l => l.kind !== 'excluded' && ids.has(l.txId)).length;
  }, [existing, result]);

  const skipped = useMemo(() => {
    const counts: Partial<Record<SkipReason | 'excluded', number>> = {};
    for (const s of result.skipped) counts[s.reason] = (counts[s.reason] ?? 0) + 1;
    if (summary.excluded) counts.excluded = summary.excluded;
    return Object.entries(counts) as [SkipReason | 'excluded', number][];
  }, [result, summary]);

  const reviews = result.lines.filter(l => l.review);

  async function save() {
    setError(null); setProgress(0);
    try {
      const outcome = await importClassified(supabase, householdId, fileName, result, (n, total) => setProgress(n / total));
      await Promise.all(['lines', 'imports', 'overrides'].map(k => queryClient.invalidateQueries({ queryKey: [k, householdId] })));
      onDone(outcome);
    } catch (e) {
      setProgress(null);
      setError(`Couldn't save everything (${(e as Error).message}). Nothing was lost: try again.`);
    }
  }

  return (
    <section className="panel stack" aria-labelledby="preview-heading">
      <h2 id="preview-heading">Check before importing</h2>
      <p>
        <strong>{fileName}</strong><br />
        <span className="muted">{range(summary.range!)} · {plural(summary.used, 'transaction')}</span>
        {already !== null && (
          <span className="muted"> · {number(summary.used - already)} new, {number(already)} already in the app</span>
        )}
      </p>
      <div className="figures">
        <Figure label="Income" value={money(t.income)} tone="in" />
        <Figure label="Spending" value={money(t.spend)} tone="out" />
        <Figure label="Other money in" value={money(t.otherIn)} />
        <Figure label="Loan repayments" value={money(t.loanIn)} />
      </div>

      {skipped.length > 0 && (
        <div>
          <h3>Left out</h3>
          <ul className="list small">{skipped.map(([reason, n]) => <li key={reason}>{SKIP_TEXT[reason](n)}</li>)}</ul>
        </div>
      )}

      {(reviews.length > 0 || checks.length > 0) && (
        <div>
          <h3>Worth a check after importing</h3>
          <ul className="list small">
            {checks.map(l => (
              <li key={l.txId}><span>{day(l.date)} · {l.name}<br /><span className="muted">Check: pay or loan repayment?</span></span><span>{money(l.amount)}</span></li>
            ))}
            {reviews.map(l => (
              <li key={l.txId}><span>{day(l.date)} · {l.name}<br /><span className="muted">{l.review}</span></span><span>{money(-l.amount)}</span></li>
            ))}
          </ul>
        </div>
      )}

      {progress !== null && (
        <div className="progress" role="progressbar" aria-label="Saving" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button className="primary" type="button" onClick={save} disabled={progress !== null}>
          {progress !== null ? 'Saving…' : `Import ${plural(summary.used, 'transaction')}`}
        </button>
        <button type="button" onClick={onCancel} disabled={progress !== null}>Cancel</button>
      </div>
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'in' | 'out' }) {
  return <div className="figure"><div className="small muted">{label}</div><div className={`value ${tone ?? ''}`}>{value}</div></div>;
}

function History({ imports, lines, members, loading }: {
  imports: ImportRecord[] | undefined; lines: Line[] | undefined;
  members: { userId: string; displayName: string | null }[]; loading: boolean;
}) {
  const gaps = useMemo(() => {
    const newest = lines?.filter(l => l.kind !== 'excluded').reduce((d, l) => (l.date > d ? l.date : d), '');
    if (!newest || !imports?.length) return null;
    // Only gaps after history starts: the months before the first import aren't "missing".
    const first = imports.reduce((d, i) => (i.range.from < d ? i.range.from : d), newest);
    const win = windowFor(newest, 12);
    return missingRanges({ from: first > win.from ? first : win.from, to: win.to }, imports.map(i => i.range));
  }, [imports, lines]);
  const who = (id: string | null) => members.find(m => m.userId === id)?.displayName ?? 'Someone';

  return (
    <section className="panel stack" aria-labelledby="history-heading">
      <h2 id="history-heading">Imports</h2>
      {loading ? <p className="muted">Loading…</p> : !imports?.length ? (
        <p className="muted">Nothing imported yet. Export your transactions from Frollo and add the file above.</p>
      ) : (
        <>
          {gaps && (gaps.length
            ? <p className="notice warn" role="status">Missing data: {gaps.map(range).join('; ')}. Averages only count the days you have data for.</p>
            : <p className="notice small">No gaps in the last 12 months.</p>)}
          <ul className="list small">
            {imports.map(i => (
              <li key={i.id}>
                <span>
                  <strong>{i.fileName ?? 'Export'}</strong><br />
                  <span className="muted">{range(i.range)} · {who(i.uploadedBy)}, {day(i.createdAt)}</span>
                </span>
                <span>{number(i.lineCount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Fixes() {
  return (
    <section className="panel small muted" aria-label="Built-in fixes">
      <p style={{ margin: 0 }}>
        Built-in fixes: transfers between your own accounts, card repayments and the offset-to-loan payments
        aren't counted as spending; loan interest is; money lent to TCM and the solar install are listed separately;
        pending card payments wait for your next export; and importing an overlapping export updates
        transactions instead of doubling them.
      </p>
    </section>
  );
}
