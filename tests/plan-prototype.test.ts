// Phase 6 acceptance: the planner matches reference/prototype.html for identical inputs.
// The prototype's own functions are lifted out of the HTML and run unchanged, with its globals
// (plan, stats, the DOM) stubbed and the clock fixed. It works in dollars; plan.ts in cents.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { goalMonthly, monthsUntil, planFigures, shareCut, trimGroups, type Goal } from '../src/lib/plan';

const html = readFileSync('reference/prototype.html', 'utf8');
const grab = (re: RegExp) => { const m = html.match(re); if (!m) throw new Error(`not in prototype: ${re}`); return m[0]; };
const source = [
  grab(/const FLEX_DEFAULT = .*;/),
  grab(/function monthsUntil\(ym\)\{[\s\S]*?\n\}/),
  grab(/function goalMonthly\(g\)\{[\s\S]*?\n\}/),
  grab(/const flexSet = .*;/),
  grab(/const targetFor = .*;/),
  grab(/function shareCut\(\)\{[\s\S]*?\n\}/),
].join('\n');

type ProtoGoal = { name: string; amount: number | null; by: string; saved: number };
type ProtoPlan = { goals: ProtoGoal[]; targets: Record<string, number | null>; flex: string[] | null };
type ProtoStats = { income: number; principal: number; groups: Record<string, number> };

function prototype(plan: ProtoPlan, s: ProtoStats) {
  const status = { textContent: '', innerHTML: '' };
  const api = new Function('plan', 'stats', '$', 'savePlan', 'renderPlan',
    `${source}\nreturn { monthsUntil, goalMonthly, shareCut, targetFor };`,
  )(plan, () => s, () => status, () => {}, () => {});
  return { ...api, status } as { monthsUntil: (ym: string) => number; goalMonthly: (g: ProtoGoal) => number; shareCut: () => void; status: typeof status };
}

// A small deterministic random generator, so failures reproduce.
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 2 ** 32; return seed / 2 ** 32; }; }

const TODAY = '2026-09-25';
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(`${TODAY}T10:00:00`)); });
afterAll(() => { vi.useRealTimers(); });

const GROUPS = ['Home & bills', 'Groceries', 'Eating out & drinks', 'Travel & holidays', 'Shopping', 'Fun & hobbies', 'Pets', 'Other'];
const MONTHS = ['2025-12', '2026-08', '2026-09', '2026-10', '2027-03', '2027-09', '2028-01', ''];

function makeCase(seed: number) {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const cents = (max: number) => Math.round(r() * max * 100); // e.g. 1234.56 dollars as 123456
  const averages: Record<string, number> = {};
  for (const g of GROUPS) if (r() > 0.15) averages[g] = cents(3000);
  const savedTargets: Record<string, number | null> = {};
  for (const g of Object.keys(averages)) if (r() > 0.7) savedTargets[g] = Math.round(r() * 300) * 1000; // whole $10s
  const trim = GROUPS.filter(() => r() > 0.5);
  const goals: Goal[] = Array.from({ length: Math.floor(r() * 4) }, () => ({
    amount: r() > 0.1 ? Math.round(r() * 20000) * 100 : null, saved: Math.round(r() * 5000) * 100, targetMonth: pick(MONTHS) || null,
  }));
  return { averages, savedTargets, trim, goals, incomePm: cents(20000), principalPm: cents(3000) };
}

describe('planner matches the prototype', () => {
  const cases = Array.from({ length: 200 }, (_, i) => makeCase(i + 1));

  it('counts months left and monthly goal saving the same way', () => {
    for (const c of cases) for (const g of c.goals) {
      const p = prototype({ goals: [], targets: {}, flex: null }, { income: 0, principal: 0, groups: {} });
      const pg = { name: 'x', amount: g.amount === null ? null : g.amount / 100, by: g.targetMonth ?? '', saved: g.saved / 100 };
      expect(monthsUntil(g.targetMonth, TODAY)).toBe(p.monthsUntil(pg.by));
      expect(goalMonthly(g, TODAY)).toBeCloseTo(p.goalMonthly(pg) * 100, 6);
    }
  });

  it('shares the cut identically, including the edge cases', () => {
    const seen = new Set<string>();
    for (const c of cases) {
      const plan: ProtoPlan = {
        goals: c.goals.map(g => ({ name: 'x', amount: g.amount === null ? null : g.amount / 100, by: g.targetMonth ?? '', saved: g.saved / 100 })),
        targets: Object.fromEntries(Object.entries(c.savedTargets).map(([k, v]) => [k, v === null ? null : v / 100])),
        flex: c.trim,
      };
      const s: ProtoStats = { income: c.incomePm / 100, principal: c.principalPm / 100, groups: Object.fromEntries(Object.entries(c.averages).map(([k, v]) => [k, v / 100])) };
      const p = prototype(plan, s);
      const before = JSON.stringify(plan.targets);
      p.shareCut();

      const { budget } = planFigures({ ...c, spendPm: 0, today: TODAY });
      const ours = shareCut(c.averages, c.savedTargets, trimGroups(Object.keys(c.averages), {}, c.trim), budget);
      seen.add(ours.status);
      if (ours.status === 'fits') expect(p.status.textContent).toMatch(/Nothing to cut/);
      else if (ours.status === 'nothing-ticked') expect(p.status.textContent).toMatch(/Tick at least one/);
      if (ours.status === 'fits' || ours.status === 'nothing-ticked') { expect(JSON.stringify(plan.targets)).toBe(before); continue; }

      const theirs = Object.fromEntries(Object.entries(plan.targets).map(([k, v]) => [k, Math.round((v ?? 0) * 100)]));
      expect(ours.targets).toEqual(Object.fromEntries(Object.keys(ours.targets).map(k => [k, theirs[k]])));
      expect(ours.status === 'not-enough').toBe(/doesn’t close the gap/.test(p.status.innerHTML));
    }
    expect([...seen].sort()).toEqual(['fits', 'not-enough', 'nothing-ticked', 'shared']); // every path was exercised
  });
});
