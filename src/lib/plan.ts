// Planner maths: goals, left to spend, targets and sharing a cut. Ported from
// reference/prototype.html. Money is cents; monthly figures may be fractional cents.
import { householdRules } from '../config/household-rules';

export interface Goal { amount: number | null; saved: number; targetMonth: string | null } // targetMonth YYYY-MM

/** Months from today's month to the target month, counting both: this month → 1. */
export function monthsUntil(targetMonth: string | null, today: string): number {
  if (!targetMonth) return 0;
  const [y, m] = targetMonth.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  return (y - ty) * 12 + (m - tm) + 1;
}

/** Monthly saving still needed. If the month has passed, the whole remainder is due now. */
export function goalMonthly(goal: Goal, today: string): number {
  const left = Math.max(0, (goal.amount ?? 0) - (goal.saved ?? 0));
  if (!left) return 0;
  const months = monthsUntil(goal.targetMonth, today);
  return months > 0 ? left / months : left;
}

/** Income − extra loan principal − goal savings, all per month. */
export const leftToSpend = (incomePm: number, principalPm: number, goalsPm: number) =>
  incomePm - principalPm - goalsPm;

const TEN_DOLLARS = 1000;
const roundToTen = (cents: number) => Math.round(cents / TEN_DOLLARS) * TEN_DOLLARS;

/** A group's target: the saved one, else its monthly average rounded to $10. */
export const targetFor = (group: string, averages: Record<string, number>, saved: Record<string, number | null>) =>
  saved[group] ?? roundToTen(averages[group] ?? 0);

/** Groups ticked "Trim": each saved tick wins, otherwise the household's trim defaults apply. */
export function trimGroups(
  groups: string[],
  saved: Record<string, boolean | null>,
  defaults: string[] = householdRules.trimDefaults,
): Set<string> {
  return new Set(groups.filter(g => saved[g] ?? defaults.includes(g)));
}

export type ShareCutResult =
  | { status: 'fits' }
  | { status: 'nothing-ticked' }
  | { status: 'shared' | 'not-enough'; targets: Record<string, number> };

/**
 * Brings the targets down to what's left to spend by cutting the ticked groups in proportion,
 * rounded to $10. Unticked groups keep their current target. 'not-enough' means even cutting
 * the ticked groups to zero doesn't close the gap.
 */
export function shareCut(
  averages: Record<string, number>,
  savedTargets: Record<string, number | null>,
  trim: Set<string>,
  budget: number,
): ShareCutResult {
  const groups = Object.keys(averages).filter(g => averages[g] > 50); // more than 50c a month
  const current = Object.fromEntries(groups.map(g => [g, targetFor(g, averages, savedTargets)]));
  const need = Object.values(current).reduce((a, b) => a + b, 0) - budget;
  if (need <= 0) return { status: 'fits' };
  const ticked = groups.filter(g => trim.has(g));
  const tickedTotal = ticked.reduce((a, g) => a + current[g], 0);
  if (!ticked.length || tickedTotal <= 0) return { status: 'nothing-ticked' };
  const ratio = Math.max(0, 1 - need / tickedTotal);
  const targets: Record<string, number> = {};
  for (const g of groups) targets[g] = trim.has(g) ? roundToTen(current[g] * ratio) : current[g];
  return { status: ratio === 0 ? 'not-enough' : 'shared', targets };
}

export interface PlanFigures {
  goalsPm: number;
  /** Income − extra loan principal − goal savings, per month. */
  budget: number;
  /** Spending minus budget: positive means a cut is needed, negative means room to spare. */
  cut: number;
  /** Sum of all targets. */
  targetsTotal: number;
  /** Targets minus budget: positive means targets are over what's left to spend. */
  over: number;
}

/** The "What spending needs to look like" numbers, as in the prototype's Plan. */
export function planFigures(input: {
  incomePm: number; principalPm: number; spendPm: number; goals: Goal[]; today: string;
  averages: Record<string, number>; savedTargets: Record<string, number | null>;
}): PlanFigures {
  const goalsPm = input.goals.reduce((a, g) => a + goalMonthly(g, input.today), 0);
  const budget = leftToSpend(input.incomePm, input.principalPm, goalsPm);
  const groups = Object.keys(input.averages).filter(g => input.averages[g] > 50);
  const targetsTotal = groups.reduce((a, g) => a + targetFor(g, input.averages, input.savedTargets), 0);
  return { goalsPm, budget, cut: input.spendPm - budget, targetsTotal, over: targetsTotal - budget };
}

/** What's earmarked for goals (everything set aside) and what's left in the offset. */
export function offsetSplit(balance: number | null, goals: Goal[]): { earmarked: number; free: number | null } {
  const earmarked = goals.reduce((a, g) => a + (g.saved ?? 0), 0);
  return { earmarked, free: balance === null ? null : balance - earmarked };
}
