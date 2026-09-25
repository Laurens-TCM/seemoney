// Recurring payment detection. Input: spend lines [{id,date,name,amount(out, positive),category,group}], dataEnd 'YYYY-MM-DD'.
function detectRecurring(lines, dataEnd) {
  const DAY = 864e5, d = s => Date.parse(s + 'T00:00:00Z');
  const CADENCES = [
    { key: 'weekly', days: 7, tol: 2, perMonth: 30.4375 / 7, min: 4 },
    { key: 'fortnightly', days: 14, tol: 3, perMonth: 30.4375 / 14, min: 3 },
    { key: 'monthly', days: 30.4, tol: 4, perMonth: 1, min: 3 },
    { key: 'quarterly', days: 91, tol: 10, perMonth: 1 / 3, min: 3 },
    { key: 'yearly', days: 365, tol: 20, perMonth: 1 / 12, min: 2 },
  ];
  const keyOf = n => n.toUpperCase().replace(/\d+/g, ' ').replace(/[^A-Z& ]/g, ' ')
    .replace(/\b(PTY|LTD|AU|AUS|AUSTRALIA|COM|WWW|HTTPS|DARWIN|CASUARINA|NT|SYDNEY|MELBOURNE|NSW|VIC|CITY|THE|INT|SAN FRANCISCO|INTERNET|SINGAPORE|DUBLIN|IRL)\b/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
  const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const groups = {};
  for (const l of lines) { if (l.amount <= 0) continue; const k = keyOf(l.name); if (k.length < 3) continue; (groups[k] ||= []).push(l); }
  const out = [];
  const series = (k, it) => {
      const gaps = it.slice(1).map((l, i) => (d(l.date) - d(it[i].date)) / DAY).filter(g => g > 0);
      if (!gaps.length) return null;
      const g = median(gaps);
      const cad = CADENCES.find(x => Math.abs(g - x.days) <= x.tol);
      if (!cad || it.length < cad.min) return null;
      const regular = gaps.filter(x => Math.abs(x - cad.days) <= cad.tol * 1.5).length / gaps.length;
      if (regular < 0.6) return null;
      const amounts = it.map(i => i.amount), typical = median(amounts);
      if (typical < 1) return null;
      // spending you choose each time (eating out, groceries) only counts if the amount is near-identical
      const spread = (Math.max(...amounts) - Math.min(...amounts)) / typical;
      const choosy = ['Eating out & drinks', 'Groceries', 'Shopping', 'Car & transport', 'Pets', 'Fun & hobbies'].includes(it[0].group);
      const near = amounts.filter(a => Math.abs(a - typical) <= typical * 0.15).length / amounts.length;
      if (choosy && !(spread <= 0.05 && (it.length >= 4 || cad.key === 'yearly')) && !(it.length >= 8 && near >= 0.75)) return null;
      return { cad, it };
  };
  for (const [k, ls] of Object.entries(groups)) {
    if (ls.length < 2) continue;
    ls.sort((a, b) => a.date < b.date ? -1 : 1);
    // amount clusters: split by similar amount (within 15% or $3) so one merchant can hold two subscriptions
    const clusters = [];
    for (const l of ls) {
      const c = clusters.find(c => Math.abs(l.amount - c.ref) <= Math.max(3, c.ref * 0.15));
      c ? (c.items.push(l), c.ref = median(c.items.map(i => i.amount))) : clusters.push({ ref: l.amount, items: [l] });
    }
    // same merchant, same cadence, one price after another (a price rise) = one series
    let found = clusters.map(c => c.items.length >= 2 ? series(k, c.items) : null).filter(Boolean)
      .sort((a, b) => a.it[0].date < b.it[0].date ? -1 : 1);
    const merged = [];
    for (const f of found) {
      const p = merged[merged.length - 1];
      if (p && p.cad.key === f.cad.key && p.it[p.it.length - 1].date < f.it[0].date) p.it = p.it.concat(f.it);
      else merged.push(f);
    }
    for (const { cad, it } of merged) {
      const amounts = it.map(i => i.amount), last = it[it.length - 1];
      const recent = amounts.slice(-3), typical = median(recent);
      const next = new Date(d(last.date) + cad.days * DAY).toISOString().slice(0, 10);
      const active = d(dataEnd) - d(last.date) <= (cad.days + cad.tol * 2) * DAY;
      const prev = amounts.length > 1 ? median(amounts.slice(0, Math.max(1, amounts.length - 3))) : typical;
      out.push({ key: k, name: last.name, category: last.category, group: last.group, cadence: cad.key,
        count: it.length, typical: Math.round(typical * 100) / 100, last: last.amount, lastDate: last.date,
        next: active ? next : null, active, perMonth: Math.round(typical * cad.perMonth * 100) / 100,
        perYear: Math.round(typical * cad.perMonth * 12 * 100) / 100,
        priceChange: Math.abs(typical - prev) > Math.max(1, prev * 0.05) ? Math.round((typical - prev) * 100) / 100 : 0, first: it[0].date,
        ids: it.map(i => i.id) });
    }
  }
  return out.sort((a, b) => b.perMonth - a.perMonth);
}
if (typeof module !== 'undefined') module.exports = { detectRecurring };
