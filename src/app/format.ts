// Display formatting: Australian English, money from integer cents.
const whole = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 });
const count = new Intl.NumberFormat('en-AU');

/** $1,234 (or $1,234.56 with `exact`). Uses a real minus sign for negatives. */
export const money = (c: number, exact = false) => (exact ? cents : whole).format(c / 100).replace('-', '−');
export const number = (n: number) => count.format(n);
export const plural = (n: number, one: string, many = one + 's') => `${number(n)} ${n === 1 ? one : many}`;

const asDate = (iso: string) => new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
/** 25 Sep 2025 */
export const day = (iso: string) => asDate(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
/** 25 Sep 2025 – 24 Sep 2026 */
export const range = (r: { from: string; to: string }) => `${day(r.from)} – ${day(r.to)}`;
