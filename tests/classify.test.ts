import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyRows, missingColumns, REQUIRED_COLUMNS, type Kind } from '../src/lib/classify';
import { parseFrolloCsv } from '../src/lib/csv';
import { summarise } from '../src/lib/summary';
import { byId, classifyFile, referenceShape } from './helpers';

const SAMPLE = 'fixtures/sample-frollo.csv';
const expected = JSON.parse(readFileSync('fixtures/expected-summary.json', 'utf8'));

describe('sample export (DATA-RULES test 1)', () => {
  const result = classifyFile(SAMPLE);
  const shape = referenceShape(result);

  for (const key of Object.keys(expected)) {
    it(`matches expected ${key}`, () => {
      expect(shape[key as keyof typeof shape]).toEqual(expected[key]);
    });
  }

  it('gives every line a unique transaction id, so re-imports can upsert', () => {
    const ids = result.lines.map(l => l.txId);
    expect(new Set(ids).size).toBe(ids.length);
  });

});

describe('kinds (DATA-RULES test 2)', () => {
  const { lines } = classifyFile(SAMPLE);
  const sum = (k: Kind) => lines.filter(l => l.kind === k).reduce((a, l) => a + l.amount, 0);

  it('keeps loan repayments whole: only the loan-account side counts', () => {
    expect(sum('loan_in')).toBe(1_140_000);
    expect(lines.filter(l => l.kind === 'loan_in').every(l => l.amount > 0)).toBe(true);
  });

  it('never lets a kind net a transfer to zero', () => {
    const oneSided: Kind[] = ['loan_in', 'business_loan', 'capital', 'income'];
    for (const k of oneSided) {
      const signs = new Set(lines.filter(l => l.kind === k).map(l => Math.sign(l.amount)));
      expect(signs.size, k).toBe(1);
    }
  });

  it('moves a line out of income when it is tagged a business loan repayment', () => {
    const { rows } = parseFrolloCsv(readFileSync(SAMPLE, 'utf8'));
    const tcmPay = byId(lines, '1003');
    expect(tcmPay.kind).toBe('income');
    const tagged = classifyRows(rows, undefined, [{ txId: '1003', kind: 'business_loan_repaid' }]);
    const line = byId(tagged.lines, '1003');
    expect(line.kind).toBe('business_loan_repaid');
    expect(line.incomeSource).toBeNull();
    const before = summarise(lines).totals, after = summarise(tagged.lines).totals;
    expect(before.income - after.income).toBe(tcmPay.amount);
    expect(after.businessRepaid).toBe(tcmPay.amount);
  });

  it('lets an override recategorise a spend line', () => {
    const { rows } = parseFrolloCsv(readFileSync(SAMPLE, 'utf8'));
    const { lines: fixed } = classifyRows(rows, undefined, [{ txId: '1101', category: 'Healthcare/Medical' }]);
    expect(byId(fixed, '1101')).toMatchObject({ kind: 'spend', category: 'Healthcare/Medical', group: 'Health & fitness' });
  });
});

describe('rows and columns', () => {
  it('names missing required columns', () => {
    expect(missingColumns(['transaction_id', 'amount'])).toEqual(REQUIRED_COLUMNS.filter(c => c !== 'transaction_id' && c !== 'amount'));
  });

  it('keeps two identical purchases on one day', () => {
    const row = { transaction_id: '1', description: 'CAFE', amount: '-5.00', transaction_date: '2026-01-01', posted_date: '2026-01-01', account_name: 'Visa', category_name: 'Cafes & Coffee', merchant_name: 'Cafe', included: 'true' };
    const { lines } = classifyRows([row, { ...row, transaction_id: '2' }]);
    expect(lines).toHaveLength(2);
  });

  it('treats nothing as pending when the export has no posted_date column', () => {
    const row = { transaction_id: '1', description: 'CAFE', amount: '-5.00', transaction_date: '2026-01-01', account_name: 'Visa', category_name: 'Cafes & Coffee', merchant_name: 'Cafe', included: 'true' };
    expect(classifyRows([row]).skipped).toHaveLength(0);
  });
});
