// One chip per event type: its colour, an icon and its name, so colour is never the only signal.
// `planned` draws the dashed, hatched style for events that haven't happened yet.
import type { EventType } from '../lib/events';
import { eventLabel } from '../lib/events';

const ICONS: Record<EventType, string> = {
  trip: 'M2 13l8-3 3-7 2 1-1 6 6-2 1 2-6 3 1 6-2 1-3-6-8 1z', // plane
  big: 'M4 8h16v12H4zM2 4h20v4H2zM12 4v16', // parcel
  loan: 'M4 9h13l-3-3M20 15H7l3 3', // arrows both ways
  income: 'M12 20V5M6 11l6-6 6 6', // arrow in
  bill: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4', // receipt
};

export function EventIcon({ type }: { type: EventType }) {
  return (
    <svg className="ev-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path d={ICONS[type]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** `bare` shows only the coloured icon (next to text that already names the type). */
export function EventChip({ type, planned = false, bare = false }: { type: EventType; planned?: boolean; bare?: boolean }) {
  if (bare) return <span className={`ev-dot ev-${type}`}><EventIcon type={type} /></span>;
  return (
    <span className={`ev-chip ev-${type}${planned ? ' planned' : ''}`}>
      <EventIcon type={type} />{eventLabel(type)}{planned ? ', planned' : ''}
    </span>
  );
}
