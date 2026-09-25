// Month by month: stacked bars (regular spending, trips) with an income marker. Hand-drawn SVG.
// Colours are the validated chart tokens (--chart-*); text stays in ink tokens.
import { useState } from 'react';
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

export function MonthChart({ bars, showTrips }: { bars: MonthBar[]; showTrips: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const max = niceMax(Math.max(...bars.map(b => Math.max(b.regular + b.trips, b.income)), 1));
  const y = (v: number) => TOP + HEIGHT - (Math.max(v, 0) / max) * HEIGHT;
  const width = LEFT + bars.length * STEP;
  const ticks = [0, max / 2, max];
  const sel = bars.find(b => b.month === selected);

  return (
    <div className="stack">
      <ul className="legend small" aria-label="Legend">
        <li><span className="swatch" style={{ background: 'var(--chart-spend)' }} />{showTrips ? 'Regular spending' : 'Spending'}</li>
        {showTrips && <li><span className="swatch" style={{ background: 'var(--chart-trips)' }} />Trips</li>}
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
            const regularTop = y(b.regular), tripsTop = y(b.regular + b.trips);
            const hasTrips = showTrips && b.trips > 0;
            const label = `${monthName(b.month, 'long')}: ${showTrips ? 'regular spending' : 'spending'} ${money(showTrips ? b.regular : b.regular + b.trips)}`
              + `${hasTrips ? `, trips ${money(b.trips)}` : ''}, income ${money(b.income)}${b.partial ? ' (part month)' : ''}`;
            return (
              <g key={b.month} className={`month${b.partial ? ' partial' : ''}${selected === b.month ? ' selected' : ''}`}
                role="button" tabIndex={0} aria-label={label} aria-pressed={selected === b.month}
                onClick={() => setSelected(selected === b.month ? null : b.month)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(selected === b.month ? null : b.month); } }}>
                <rect x={LEFT + i * STEP} y={TOP} width={STEP} height={HEIGHT + LABEL} className="hit" />
                {showTrips ? (
                  <>
                    <path d={segment(x, regularTop, BAR, TOP + HEIGHT - regularTop, !hasTrips)} fill="var(--chart-spend)" />
                    {hasTrips && <path d={segment(x, tripsTop, BAR, regularTop - tripsTop - GAP, true)} fill="var(--chart-trips)" />}
                  </>
                ) : (
                  <path d={segment(x, tripsTop, BAR, TOP + HEIGHT - tripsTop, true)} fill="var(--chart-spend)" />
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
          {showTrips ? 'Regular spending' : 'Spending'} {money(showTrips ? sel.regular : sel.regular + sel.trips)}
          {showTrips && sel.trips > 0 && <> · trips {money(sel.trips)}</>} · income {money(sel.income)}
        </div>
      ) : <p className="muted small" style={{ margin: 0 }}>Tap a month for its figures. Faded months are only partly covered.</p>}
      <details className="small">
        <summary>Show as a table</summary>
        <table className="table">
          <thead><tr><th scope="col">Month</th><th scope="col">{showTrips ? 'Regular' : 'Spending'}</th>{showTrips && <th scope="col">Trips</th>}<th scope="col">Income</th></tr></thead>
          <tbody>
            {bars.map(b => (
              <tr key={b.month}>
                <th scope="row">{monthName(b.month, 'long')}{b.partial ? '*' : ''}</th>
                <td>{money(showTrips ? b.regular : b.regular + b.trips)}</td>
                {showTrips && <td>{money(b.trips)}</td>}
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
