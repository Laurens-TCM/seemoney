// Phase 3 acceptance: importing into the real Supabase project (local only, throwaway household).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyRows } from '../src/lib/classify';
import { parseFrolloCsv } from '../src/lib/csv';
import { countLines, importClassified, loadImports, loadLines } from '../src/lib/store';
import { missingRanges, summarise } from '../src/lib/summary';
import { classifyFile, referenceShape } from './helpers';
import { liveFixture, liveReady, type Client } from './live';

const SAMPLE = 'fixtures/sample-frollo.csv';

it(liveReady ? 'Import tests ran against the Supabase project' : 'Import tests skipped: no Supabase keys in .env.local', () => {});

describe.skipIf(!liveReady)('importing an export', () => {
  const live = liveReady ? liveFixture() : (null as never);
  let db: Client, home = '';

  beforeAll(async () => {
    const member = await live.user('importer');
    db = member.client;
    home = await live.household('Import test', [member.id]);
  }, 60_000);

  afterAll(() => live?.cleanup(), 60_000);

  it('stores every classified line, and reads back exactly what was classified', async () => {
    const result = classifyFile(SAMPLE);
    const outcome = await importClassified(db, home, 'sample-frollo.csv', result);
    expect(outcome).toMatchObject({ saved: result.lines.length, newLines: result.lines.length, total: result.lines.length });

    const stored = await loadLines(db, home);
    const byId = new Map(result.lines.map(l => [l.txId, l]));
    expect(stored).toHaveLength(result.lines.length);
    for (const l of stored) expect(l).toEqual(byId.get(l.txId));
    // The same totals the classifier gives straight from the file.
    expect(referenceShape({ lines: stored, skipped: result.skipped }).totals).toEqual(referenceShape(result).totals);
  }, 60_000);

  it('leaves the same number of lines when the same file is imported again', async () => {
    const before = await countLines(db, home);
    const outcome = await importClassified(db, home, 'sample-frollo.csv', classifyFile(SAMPLE));
    expect(outcome.newLines).toBe(0);
    expect(await countLines(db, home)).toBe(before);
  }, 60_000);

  it('records each import with its date range and skip reasons', async () => {
    const imports = await loadImports(db, home);
    expect(imports).toHaveLength(2);
    expect(imports[0]).toMatchObject({
      fileName: 'sample-frollo.csv', range: { from: '2026-01-02', to: '2026-03-28' }, // the 31 Mar valuation row is excluded
      skippedReasons: { 'no transaction id': 1, pending: 1 },
    });
  });

  it('shows the missing range when a later export leaves a gap', async () => {
    // A fresh household gets January, then March: February is missing.
    const member = await live.user('gap');
    const gapHome = await live.household('Gap test', [member.id]);
    const { rows } = parseFrolloCsv(readFileSync(SAMPLE, 'utf8'));
    const month = (m: string) => classifyRows(rows.filter(r => r.transaction_date?.startsWith(m)));
    await importClassified(member.client, gapHome, 'january.csv', month('2026-01'));
    await importClassified(member.client, gapHome, 'march.csv', month('2026-03'));

    const ranges = (await loadImports(member.client, gapHome)).map(i => i.range);
    const lines = await loadLines(member.client, gapHome);
    const win = { from: '2026-01-02', to: summarise(lines).range!.to };
    // January's lines run 2–31 Jan and March's 2–31 Mar, so 1 Feb to 1 Mar is uncovered.
    expect(missingRanges(win, ranges)).toEqual([{ from: '2026-02-01', to: '2026-03-01' }]);
  }, 60_000);
});
