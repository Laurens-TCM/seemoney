// Lines that need a person's answer, and the answer given so far (a saved override).
import type { Line, LineOverride } from './classify';
import { businessRepaymentChecks } from './summary';

export type Question = 'pay-or-repayment' | 'category';
export interface Check { question: Question; line: Line; reason: string; answer: LineOverride | null }

/**
 * `stored` are lines as imported (with their review reasons); `current` are the same lines after
 * overrides. Business pay-or-repayment checks come from the current lines, so a line already
 * marked a repayment stays listed with its answer. Unanswered checks come first.
 */
export function linesToCheck(stored: Line[], current: Line[], overrides: LineOverride[]): Check[] {
  const answers = new Map(overrides.map(o => [o.txId, o]));
  const checks: Check[] = [
    ...businessRepaymentChecks(current).map(line => ({
      question: 'pay-or-repayment' as const, line, reason: 'Check: pay or loan repayment?',
    })),
    ...stored.filter(l => l.review).map(l => ({
      question: 'category' as const, line: current.find(c => c.txId === l.txId) ?? l, reason: l.review!,
    })),
  ].map(c => ({ ...c, answer: answers.get(c.line.txId) ?? null }));
  return [...checks.filter(c => !c.answer), ...checks.filter(c => c.answer)];
}
