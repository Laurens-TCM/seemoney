// Personal patterns for this household. Kept out of the classifier so they can later move into
// the database (a rules editor). See docs/DATA-RULES.md.

export interface HouseholdRules {
  /** Offset → home loan transfers (the offset side of a loan repayment). */
  loanRepaymentPayee: RegExp;
  /** The family business. Money out is a loan to it; money in is pay unless tagged a repayment. */
  businessName: RegExp;
  businessLoanLabel: string;
  capitalItems: { pattern: RegExp; label: string }[];
  remaps: { pattern: RegExp; category: string }[];
  trimDefaults: string[];
  /** Matched against the upper-cased account name. */
  cardAccount: RegExp;
  /** Victorian place names. Names longer than 13 characters also match on their first 13. */
  vicPlaces: string[];
  /** Also common outside Victoria: only count with VIC or MELB in the same description. */
  vicAmbiguous: string[];
  /** Descriptions that never get a `vic` tag, even if they contain a place name. */
  notAPlace: RegExp[];
}

export const householdRules: HouseholdRules = {
  loanRepaymentPayee: /PAYMENT\s+TO GOUD LAURENS/,
  businessName: /TRADE CREATIVE/,
  businessLoanLabel: 'Loan to TCM (LandCruiser)',
  capitalItems: [{ pattern: /ONEROOF SOLAR/, label: 'Solar install (OneRoof)' }],
  remaps: [
    { pattern: /WAGAMAN OSHC/, category: 'Child/Dependent Expenses' },
    { pattern: /ASU UNION/, category: 'Memberships & union' },
  ],
  trimDefaults: ['Eating out & drinks', 'Travel & holidays', 'Shopping', 'Fun & hobbies'],
  cardAccount: /VISA|MASTERCARD|CREDIT CARD/,
  vicPlaces: [
    'MELBOURNE', 'MELB', 'VIC', 'BRUNSWICK', 'FITZROY', 'YARRAVILLE', 'FOOTSCRAY', 'WILLIAMSTOWN',
    'COLLINGWOOD', 'TULLAMARINE', 'NORTHCOTE', 'ST KILDA', 'SEDDON', 'SOUTHBANK', 'DOCKLANDS',
    'COBURG', 'THORNBURY', 'PRAHRAN', 'NEWPORT', 'ALTONA', 'ESSENDON', 'GEELONG', 'ASCOT VALE',
    'MOONEE PONDS', 'ABBOTSFORD', 'PRESTON', 'BALLARAT', 'LORNE', 'TORQUAY', 'APOLLO BAY',
    'DAYLESFORD', 'HEALESVILLE', 'WERRIBEE', 'HAWTHORN', 'CAMBERWELL', 'ELWOOD', 'SOUTH YARRA',
    'MARIBYRNONG', 'SPOTSWOOD', 'WEST FOOTSCRAY', 'KINGSVILLE',
    'RESERVOIR', 'CAMPBELLFIELD', 'FAWKNER', 'LITTLE RIVER', 'ANGLESEA', 'AIREYS INLET',
    'FLEMINGTON', 'PARKVILLE', 'BRAYBROOK', 'LOWER PLENTY', 'MOUNT DUNEED', 'POINT COOK',
    'TRAVANCORE', 'ROMSEY', 'DERRIMUT', 'DANDENONG', 'BLACKBURN', 'BENTLEIGH',
  ],
  vicAmbiguous: ['CARLTON', 'RICHMOND', 'SUNSHINE', 'BRIGHTON', 'WINDSOR', 'KENSINGTON', 'KEW'],
  notAPlace: [
    /\bVIC\s+PTY\b/, /^SP /, /PLAYHQ/, /TICKETMASTER/, /TICKETEBO/, /TRYBOOKING/, /TELSTRA/,
    /CROCS AUSTRALIA/, /MOLLINI/, /WINDSOR SMITH/, /STEPPING STONES/, /GONG CHAR/,
    /NIGHTCLIFF SEABREEZ/, /OFFICEWORKS/, /KLOOK/, /DEFT\*SYNERGY/,
  ],
};
