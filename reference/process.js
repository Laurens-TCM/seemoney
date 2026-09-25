// Household finance processing — turns a Frollo transactions export into a summary.
// Pure function: rows (array of objects keyed by CSV header) -> summary object.
function processRows(rows) {
  const GROUPS = {
    'Home & bills': ['Mortgage interest', 'Utilities', 'Insurance', 'Home Renovation & Maintenance', 'Furniture & Homeware', 'Cable/Satellite/Telecom'],
    'Groceries': ['Groceries'],
    'Eating out & drinks': ['Restaurants', 'Takeaway & Snacks', 'Cafes & Coffee', 'Bars & Pubs', 'Alcohol'],
    'Travel & holidays': ['Travel/Holidays'],
    'Car & transport': ['Automotive', 'Petrol', 'Taxi & Rideshare', 'Public Transport'],
    'Health & fitness': ['Healthcare/Medical', 'Gyms & Fitness', 'Beauty & Well-being'],
    'Kids & school': ['Child/Dependent Expenses', 'Education'],
    'Pets': ['Pets/Pet Care'],
    'Shopping': ['Clothing/Shoes', 'General Merchandise', 'Electronics', 'Gifts'],
    'Fun & hobbies': ['Entertainment/Recreation', 'Hobbies', 'Subscriptions/Renewals', 'Gambling & Lotteries'],
    'Payments to people': ['Payments to people'],
    'Other': ['Memberships & union', 'Other', 'Uncategorised'],
  };
  const catToGroup = {};
  for (const [g, cats] of Object.entries(GROUPS)) for (const c of cats) catToGroup[c] = g;
  const groupOf = c => catToGroup[c] || 'Other';

  const INCOME_CATS = new Set(['Salary/Regular Income', 'Government Benefits', 'Interest Income', 'Taxes']);
  const INTERNAL_CATS = new Set(['Credit Card Payments', 'Transfer Between Accounts', 'Savings', 'Mortgage']);

  const clean = (r) => {
    const m = (r.merchant_name || '').trim();
    if (m && m !== 'Unknown') return m;
    let d = (r.description || '').replace(/\s{2,}/g, ' ').trim();
    d = d.replace(/^ANZ (MOBILE|INTERNET) BANKING (PAYMENT|TRANSFER) \d+\s*/i, '');
    d = d.replace(/^PAYMENT\s+/i, '').replace(/^VISA DEBIT PURCHASE CARD \d+\s*/i, '');
    d = d.replace(/\b\d{5,}\b/g, '').replace(/\s{2,}/g, ' ').trim();
    d = d.replace(/^TO /i, '').replace(/^FROM /i, 'From ');
    return d.slice(0, 34).trim();
  };
  const titleCase = s => s.replace(/\w\S*/g, w => w.length <= 3 && /^(TO|OF|AND|THE|PTY|LTD|NT)$/i.test(w) ? (/^(To|of|and|the)$/i.test(w) ? w.toLowerCase().replace(/^to$/, 'to') : w.toUpperCase()) : w[0].toUpperCase() + w.slice(1).toLowerCase());

  const months = {};
  const M = k => (months[k] ||= { m: k, income: 0, otherIn: 0, spend: 0, byGroup: {}, byCat: {} });
  const totals = { income: 0, otherIn: 0, spend: 0, loanIn: 0, loanInterest: 0, tcmLoan: 0, oneOff: 0, incomeBySource: {} };
  const oneOffs = [];
  const merch = {}; // group -> name -> [total, count]
  let from = null, to = null, used = 0, skipped = 0;
  const accounts = new Set();
  const tx = []; // spending rows: [id, date, name, out, cat, group, bucket, loc]
  // Strong Victorian place names tag a line 'vic'. Ambiguous names (also common elsewhere) only count
  // when the same description also contains VIC or MELB. Card descriptions cut the place to 13
  // characters ("WEST FOOTSCRA"), so longer names also match on their first 13 characters.
  const VIC_PLACES = ['MELBOURNE', 'MELB', 'VIC', 'BRUNSWICK', 'FITZROY', 'YARRAVILLE', 'FOOTSCRAY', 'WILLIAMSTOWN', 'COLLINGWOOD', 'TULLAMARINE', 'NORTHCOTE', 'ST KILDA', 'SEDDON', 'SOUTHBANK', 'DOCKLANDS', 'COBURG', 'THORNBURY', 'PRAHRAN', 'NEWPORT', 'ALTONA', 'ESSENDON', 'GEELONG', 'ASCOT VALE', 'MOONEE PONDS', 'ABBOTSFORD', 'PRESTON', 'BALLARAT', 'LORNE', 'TORQUAY', 'APOLLO BAY', 'DAYLESFORD', 'HEALESVILLE', 'WERRIBEE', 'HAWTHORN', 'CAMBERWELL', 'ELWOOD', 'SOUTH YARRA', 'MARIBYRNONG', 'SPOTSWOOD', 'WEST FOOTSCRAY', 'KINGSVILLE',
    'RESERVOIR', 'CAMPBELLFIELD', 'FAWKNER', 'LITTLE RIVER', 'ANGLESEA', 'AIREYS INLET', 'FLEMINGTON', 'PARKVILLE', 'BRAYBROOK', 'LOWER PLENTY', 'MOUNT DUNEED', 'POINT COOK', 'TRAVANCORE', 'ROMSEY', 'DERRIMUT', 'DANDENONG', 'BLACKBURN', 'BENTLEIGH'];
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const VIC_RE = new RegExp('\\b(' + VIC_PLACES.flatMap(p => p.length > 13 ? [p, p.slice(0, 13)] : [p]).map(esc).join('|') + ')\\b');
  const VIC_AMBIGUOUS_RE = /\b(CARLTON|RICHMOND|SUNSHINE|BRIGHTON|WINDSOR|KENSINGTON|KEW)\b/;
  // Never a place: company names containing "VIC PTY", Shopify online stores ("SP "), and
  // online merchants that bill from a Melbourne address (household-rules `notAPlace`).
  const NOT_A_PLACE = [/\bVIC\s+PTY\b/, /^SP /, /PLAYHQ/, /TICKETMASTER/, /TICKETEBO/, /TRYBOOKING/, /TELSTRA/, /CROCS AUSTRALIA/, /MOLLINI/, /WINDSOR SMITH/, /STEPPING STONES/, /GONG CHAR/, /NIGHTCLIFF SEABREEZ/, /OFFICEWORKS/, /KLOOK/, /DEFT\*SYNERGY/];
  const CARD_ACCOUNT_RE = /VISA|MASTERCARD|CREDIT CARD/;
  const skippedReasons = {};
  const reviews = []; // lines to check by hand: [id, reason]
  const skip = why => { skipped++; skippedReasons[why] = (skippedReasons[why] || 0) + 1; };
  const FX_RE = /\b[A-Z]{3} \d+(\.\d+)? AUD\b|\b(USD|HKD|SGD|KRW|MYR|EUR|GBP|JPY|NZD|IDR|THB)\b/;
  let curRow = null;

  for (const r of rows) {
    const amt = parseFloat(r.amount);
    const date = (r.transaction_date || '').slice(0, 10);
    if (!String(r.transaction_id || '').trim()) { skip('no transaction id'); continue; }
    if (!date) { skip('no date'); continue; }
    if (isNaN(amt)) { skip('amount not a number'); continue; }
    // Pending card authorisations have no posted date. The bank re-issues them with a new id when
    // they post, so storing them would double-count on the next import.
    if ('posted_date' in r && !String(r.posted_date || '').trim()) { skip('pending'); continue; }
    const inc = String(r.included).toLowerCase();
    const desc = (r.description || '').toUpperCase();
    const acct = r.account_name || '';
    const cat0 = r.category_name || 'Uncategorised';
    if (inc === 'false' || /increase account balance/i.test(r.description || '')) { skip('excluded'); continue; }
    accounts.add(acct);
    if (!from || date < from) from = date;
    if (!to || date > to) to = date;
    used++;
    const mk = date.slice(0, 7);
    curRow = r;
    const isLoanAcct = /home loan|mortgage|loan/i.test(acct) && !/offset/i.test(acct);

    // Home loan account: credits are repayments, debits are interest.
    if (isLoanAcct) {
      if (amt > 0) { totals.loanIn += amt; continue; }
      addSpend(mk, 'Mortgage interest', amt, 'Home loan interest');
      totals.loanInterest += -amt;
      continue;
    }
    // Loan repayments leaving the offset.
    if (amt < 0 && /PAYMENT\s+TO GOUD LAURENS/.test(desc)) continue;
    // "Credit Card Payments" is only a card repayment when money goes in to a card account or out of
    // any other account. Frollo sometimes puts ordinary lines in that category.
    if (cat0 === 'Credit Card Payments' && (CARD_ACCOUNT_RE.test(acct.toUpperCase()) !== amt > 0)) {
      if (amt > 0) { M(mk).otherIn += amt; totals.otherIn += amt; continue; }
      reviews.push([String(r.transaction_id).trim(), 'Check category: Frollo called this a card repayment']);
      addSpend(mk, 'Uncategorised', amt, clean(r));
      continue;
    }
    if (INTERNAL_CATS.has(cat0)) continue;

    // Money lent to Trade Creative Media (LandCruiser purchase).
    if (/TRADE CREATIVE/.test(desc) && amt < 0) {
      totals.tcmLoan += -amt;
      oneOffs.push({ d: date, what: 'Loan to TCM (LandCruiser)', amt: -amt, kind: 'loan' });
      continue;
    }
    if (/ONEROOF SOLAR/.test(desc) && amt > 0) { M(mk).otherIn += amt; totals.otherIn += amt; continue; } // refund from a capital payee
    if (/ONEROOF SOLAR/.test(desc)) {
      totals.oneOff += -amt;
      oneOffs.push({ d: date, what: 'Solar install (OneRoof)', amt: -amt, kind: 'capital' });
      continue;
    }

    if (amt > 0) {
      let src = null;
      if (/TRADE CREATIVE/.test(desc)) src = 'TCM pay';
      else if (cat0 === 'Salary/Regular Income') src = 'Salary';
      else if (cat0 === 'Taxes') src = 'Tax refund';
      else if (INCOME_CATS.has(cat0)) src = cat0 === 'Government Benefits' ? 'Government' : 'Interest';
      if (src) {
        M(mk).income += amt; totals.income += amt;
        totals.incomeBySource[src] = (totals.incomeBySource[src] || 0) + amt;
        continue;
      }
      if (cat0 === 'Transfer In' || cat0 === 'Refunds/Adjustments' || cat0 === 'Uncategorised') {
        M(mk).otherIn += amt; totals.otherIn += amt; continue;
      }
      // Positive amount in a spending category = refund/rebate; nets against that category.
      addSpend(mk, mapCat(cat0, desc), amt, clean(r));
      continue;
    }
    addSpend(mk, mapCat(cat0, desc), amt, clean(r));
  }

  function mapCat(c, desc) {
    if (/WAGAMAN OSHC/.test(desc)) return 'Child/Dependent Expenses';
    if (/ASU UNION/.test(desc)) return 'Memberships & union';
    if (c === 'Transfer Out') return 'Payments to people';
    if (c === 'Other Expenses') return 'Other';
    return c;
  }
  function addSpend(mk, cat, amt, name) {
    const g = groupOf(cat), v = -amt; // positive = money out
    const m = M(mk);
    m.spend += v; m.byGroup[g] = (m.byGroup[g] || 0) + v; m.byCat[cat] = (m.byCat[cat] || 0) + v;
    totals.spend += v;
    const gm = (merch[g] ||= {}); const nm = titleCase(name || cat);
    const e = (gm[nm] ||= [0, 0]); e[0] += v; e[1] += 1;
    const raw = (curRow.description || '').toUpperCase();
    let bucket = 'Other';
    if (/QANTAS|JETSTAR|VIRGIN AU|AIRASIA|SINGAPOREAIR|HKEXPRESS|AIRWAYS|AIRLINES|REX AIR|BONZA/.test(raw) && !/INFLIGHT/.test(raw)) bucket = 'Flights';
    else if (/HOTEL|MOTEL|AIRBNB|BOOKING\.COM|BKG\*|LODGE|YOTEL|APARTMENT|RESORT|STAYZ|HOSTEL/.test(raw) && (cat === 'Travel/Holidays')) bucket = 'Accommodation';
    else if (g === 'Eating out & drinks' || g === 'Groceries' || /INFLIGHT/.test(raw)) bucket = 'Food & drink';
    else if (g === 'Car & transport') bucket = 'Getting around';
    else if (g === 'Fun & hobbies') bucket = 'Activities';
    const place = NOT_A_PLACE.some(re => re.test(raw)) ? '' : raw;
    const loc = (VIC_RE.test(place) || (VIC_AMBIGUOUS_RE.test(place) && /\b(VIC|MELB)/.test(place))) ? 'vic' : FX_RE.test(raw) ? 'fx' : '';
    tx.push([String(curRow.transaction_id).trim(), curRow.transaction_date.slice(0, 10), nm, Math.round(v * 100) / 100, cat, g, bucket, loc]);
  }
  const r2 = x => Math.round(x * 100) / 100;
  const monthList = Object.values(months).sort((a, b) => a.m < b.m ? -1 : 1).map(m => ({
    m: m.m, income: r2(m.income), otherIn: r2(m.otherIn), spend: r2(m.spend),
    byGroup: Object.fromEntries(Object.entries(m.byGroup).map(([k, v]) => [k, r2(v)])),
    byCat: Object.fromEntries(Object.entries(m.byCat).map(([k, v]) => [k, r2(v)])),
  }));
  const top = {};
  for (const [g, names] of Object.entries(merch)) {
    top[g] = Object.entries(names).filter(([, v]) => v[0] > 0.5).sort((a, b) => b[1][0] - a[1][0]).slice(0, 12).map(([n, v]) => [n, r2(v[0]), v[1]]);
  }
  const days = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1 : 0;
  const T = {}; for (const [k, v] of Object.entries(totals)) T[k] = typeof v === 'number' ? r2(v) : Object.fromEntries(Object.entries(v).map(([a, b]) => [a, r2(b)]));
  T.loanPrincipal = r2(totals.loanIn - totals.loanInterest);
  return { v: 1, from, to, days, used, skipped, skippedReasons, reviews, accounts: [...accounts].sort(), months: monthList, totals: T,
    oneOffs: oneOffs.map(o => ({ ...o, amt: r2(o.amt) })), top, groupCats: GROUPS, tx };
}
