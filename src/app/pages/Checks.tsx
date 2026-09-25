// "To check": questions about imported lines, answered with a manual override (undo-able).
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { applyOverrides, GROUPS, type LineOverride } from '../../lib/classify';
import { linesToCheck, type Check } from '../../lib/checks';
import { clearOverride, saveOverride } from '../../lib/store';
import { supabase } from '../../lib/supabase';
import { useLines, useOverrides } from '../data';
import { day, money } from '../format';

const CATEGORIES = Object.values(GROUPS).flat().filter(c => c !== 'Mortgage interest').sort();
const CARD_REPAYMENT = '__card_repayment__';

function answerText(c: Check): string {
  const a = c.answer!;
  if (a.kind === 'business_loan_repaid') return 'Marked as a loan repayment from TCM.';
  if (a.kind === 'income') return 'Confirmed as TCM pay.';
  if (a.kind === 'internal') return 'Marked as a card repayment (not spending).';
  return `Category set to ${a.category}.`;
}

export function Checks({ householdId }: { householdId: string }) {
  const lines = useLines(householdId);
  const overrides = useOverrides(householdId);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checks = useMemo(() => {
    if (!lines.data || !overrides.data) return [];
    return linesToCheck(lines.data, applyOverrides(lines.data, overrides.data), overrides.data);
  }, [lines.data, overrides.data]);

  async function act(txId: string, change: () => Promise<void>) {
    setBusy(txId); setError(null);
    try {
      await change();
      await queryClient.invalidateQueries({ queryKey: ['overrides', householdId] });
    } catch (e) {
      setError(`Couldn't save that (${(e as Error).message}). Try again.`);
    } finally {
      setBusy(null);
    }
  }
  const save = (o: LineOverride) => act(o.txId, () => saveOverride(supabase, householdId, o));
  const undo = (txId: string) => act(txId, () => clearOverride(supabase, householdId, txId));

  if (!checks.length) return null;
  const open = checks.filter(c => !c.answer).length;

  return (
    <section className="panel stack" aria-labelledby="checks-heading">
      <h2 id="checks-heading">To check {open > 0 && <span className="muted small">({open} left)</span>}</h2>
      <p className="muted small">Your answers are saved for both of you and kept when you import again.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="list">
        {checks.map(c => (
          <li key={`${c.question}-${c.line.txId}`} className="check">
            <div className="check-head">
              <span><strong>{c.line.name}</strong><br /><span className="muted small">{day(c.line.date)} · {c.reason}</span></span>
              <span>{money(Math.abs(c.line.amount), true)}</span>
            </div>
            {c.answer ? (
              <div className="actions small">
                <span className="in">{answerText(c)}</span>
                <button type="button" className="link" disabled={busy === c.line.txId} onClick={() => undo(c.line.txId)}>Undo</button>
              </div>
            ) : c.question === 'pay-or-repayment' ? (
              <div className="actions">
                <button type="button" disabled={busy === c.line.txId} onClick={() => save({ txId: c.line.txId, kind: 'income' })}>It's pay</button>
                <button type="button" disabled={busy === c.line.txId} onClick={() => save({ txId: c.line.txId, kind: 'business_loan_repaid' })}>Loan repayment</button>
              </div>
            ) : (
              <CategoryPicker disabled={busy === c.line.txId}
                onPick={v => save(v === CARD_REPAYMENT ? { txId: c.line.txId, kind: 'internal' } : { txId: c.line.txId, category: v })} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CategoryPicker({ disabled, onPick }: { disabled: boolean; onPick: (value: string) => void }) {
  const [value, setValue] = useState('');
  const id = useMemo(() => `cat-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div className="actions">
      <label htmlFor={id} className="visually-hidden">What was this?</label>
      <select id={id} value={value} onChange={e => setValue(e.target.value)}>
        <option value="">What was this?</option>
        <option value={CARD_REPAYMENT}>A card repayment (not spending)</option>
        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <button type="button" disabled={disabled || !value} onClick={() => onPick(value)}>Save</button>
    </div>
  );
}
