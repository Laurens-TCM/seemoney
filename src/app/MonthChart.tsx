// Month by month: stacked bars (regular spending, then a layer per event type) with an income
// marker. Hand-drawn SVG. Colours are the validated tokens (--chart-*, --ev-*); text stays in ink.
import { useState } from 'react';
import { EVENT_TYPES, type EventType } from '../lib/events';
import type { MonthBar } from '../lib/overview';
import { money } from './format';

const BAR = 22, STEP = 38, TOP = 12, HEIGHT = 170, LEFT = 44, LABEL = 18, GAP = 2, RADIUS = 4;

const monthName = (m: string, style: 'short' | 'long' = 'short') =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-AU', { month: style, ...(style === 'long' ? { year: 'numeric' } : {}) });

/** A bar segment with its top corners rounded (only the top segment of a stack gets rounded). */
function segment(x: number, y: number, w: number, h: number, round: boolean) {
  if (h <= 0) return '';
  const r = round ? Math.min(RADIUS, h, w / 2) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v: number) {
  const step = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  return Math.ceil(v / step) * step;
}

export function MonthChart({ bars, showEvents }: { bars: MonthBar[]; showEvents: boolean }) {
  // Event types with spending in these months, in the fixed order (never re-coloured by rank).
  const types: EventType[] = showEvents ? EVENT_TYPES.map(t => t.key).filter(k => bars.some(b => (b.byType[k] ?? 0) > 0)) : [];
  const plural = (k: EventType) => EVENT_TYPES.find(t => t.key === k)!.plural;
  const spent = (b: MonthBar) => (showEvents ? b.regular : b.regular + b.events);
  const layers = (b: MonthBar) => types.map(k => [k, b.byType[k] ?? 0] as const).filter(([, v]) => v > 0);
  const detail = (b: MonthBar) => layers(b).map(([k, v]) => `${plural(k).toLowerCase()} ${money(v)}`).join(', ');
  const [selected, setSelected] = useState<string | null>(null);
  const max = niceMax(Math.max(...bars.map(b => Math.max(b.regular + b.events, b.income)), 1));
  const y = (v: number) => TOP + HEIGHT - (Math.max(v, 0) / max) * HEIGHT;
  const width = LEFT + bars.length * STEP;
  const ticks = [0, max / 2, max];
  const sel = bars.find(b => b.month === selected);

  return (
    <div className="stack">
      <ul className="legend small" aria-label="Legend">
        <li><span className="swatch" style={{ background: 'var(--chart-spend)' }} />{showEvents ? 'Regular spending' : 'Spending'}</li>
        {types.map(k => <li key={k}><span className={`swatch ev-${k}`} style={{ background: 'var(--ev)' }} />{plural(k)}</li>)}
        <li><span className="swatch line" style={{ background: 'var(--chart-income)' }} />Income</li>
      </ul>
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${width} ${TOP + HEIGHT + LABEL + 4}`} width={Math.max(width, 320)} role="img"
          aria-label="Spending and income by month. Tap a month for details.">
          {ticks.map(t => (
            <g key={t}>
              <line x1={LEFT - 4} x2={width} y1={y(t)} y2={y(t)} className="grid" />
              <text x={LEFT - 8} y={y(t) + 4} textAnchor="end" className="axis">{t === 0 ? '$0' : `$${Math.round(t / 100000)}k`}</text>
            </g>
          ))}
          {bars.map((b, i) => {
            const x = LEFT + i * STEP + (STEP - BAR) / 2;
            const ls = layers(b);
            const regularTop = y(b.regular), totalTop = y(b.regular + b.events);
            const label = `${monthName(b.month, 'long')}: ${showEvents ? 'regular spending' : 'spending'} ${money(spent(b))}`
              + `${ls.length ? `, ${detail(b)}` : ''}, income ${money(b.income)}${b.partial ? ' (part month)' : ''}`;
            let base = b.regular;
            return (
              <g key={b.month} className={`month${b.partial ? ' partial' : ''}${selected === b.month ? ' selected' : ''}`}
                role="button" tabIndex={0} aria-label={label} aria-pressed={selected === b.month}
                onClick={() => setSelected(selected === b.month ? null : b.month)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(selected === b.month ? null : b.month); } }}>
                <rect x={LEFT + i * STEP} y={TOP} width={STEP} height={HEIGHT + LABEL} className="hit" />
                {showEvents ? (
                  <>
                    <path d={segment(x, regularTop, BAR, TOP + HEIGHT - regularTop, !ls.length)} fill="var(--chart-spend)" />
                    {ls.map(([k, v], j) => {
                      const bottom = y(base), top = y(base + v);
                      base += v;
                      return <path key={k} className={`ev-${k}`} d={segment(x, top, BAR, bottom - top - GAP, j === ls.length - 1)} fill="var(--ev)" />;
                    })}
                  </>
                ) : (
                  <path d={segment(x, totalTop, BAR, TOP + HEIGHT - totalTop, true)} fill="var(--chart-spend)" />
                )}
                {b.income > 0 && (
                  <>
                    <line x1={x - 4} x2={x + BAR + 4} y1={y(b.income)} y2={y(b.income)} stroke="var(--surface)" strokeWidth={6} />
                    <line x1={x - 4} x2={x + BAR + 4} y1={y(b.income)} y2={y(b.income)} stroke="var(--chart-income)" strokeWidth={2.5} strokeLinecap="round" />
                  </>
                )}
                <text x={x + BAR / 2} y={TOP + HEIGHT + LABEL} textAnchor="middle" className="axis">{monthName(b.month)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {sel ? (
        <div className="notice small" role="status">
          <strong>{monthName(sel.month, 'long')}{sel.partial ? ' (part month)' : ''}</strong><br />
          {showEvents ? 'Regular spending' : 'Spending'} {money(spent(sel))}
          {layers(sel).map(([k, v]) => <span key={k}> · {plural(k).toLowerCase()} {money(v)}</span>)} · income {money(sel.income)}
        </div>
      ) : <p className="muted small" style={{ margin: 0 }}>Tap a month for its figures. Faded months are only partly covered.</p>}
      <details className="small">
        <summary>Show as a table</summary>
        <table className="table">
          <thead><tr><th scope="col">Month</th><th scope="col">{showEvents ? 'Regular' : 'Spending'}</th>{types.map(k => <th key={k} scope="col">{plural(k)}</th>)}<th scope="col">Income</th></tr></thead>
          <tbody>
            {bars.map(b => (
              <tr key={b.month}>
                <th scope="row">{monthName(b.month, 'long')}{b.partial ? '*' : ''}</th>
                <td>{money(spent(b))}</td>
                {types.map(k => <td key={k}>{money(b.byType[k] ?? 0)}</td>)}
                <td>{money(b.income)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">* Part month.</p>
      </details>
    </div>
  );
}
