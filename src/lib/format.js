// Number / unit / time formatting. Latin digits are used in both languages for data readouts.

const locales = { ar: 'ar-u-nu-latn', en: 'en-US' };
const nfCache = new Map();

function nf(lang, opts = {}) {
  const key = lang + JSON.stringify(opts);
  if (!nfCache.has(key)) nfCache.set(key, new Intl.NumberFormat(locales[lang] || 'en-US', opts));
  return nfCache.get(key);
}

export const fmtInt = (n, lang) => (n == null || Number.isNaN(n) ? '—' : nf(lang, { maximumFractionDigits: 0 }).format(n));
export const fmtNum = (n, lang, digits = 1) =>
  n == null || Number.isNaN(n) ? '—' : nf(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
export const fmtCompact = (n, lang) =>
  n == null ? '—' : nf(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export const mToFt = (m) => m * 3.28084;
export const msToKt = (ms) => ms * 1.943844;
export const msToKmh = (ms) => ms * 3.6;
export const flightLevel = (m) => `FL${String(Math.max(0, Math.round(mToFt(m) / 100))).padStart(3, '0')}`;

export function fmtAgo(ms, t) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return t('ago.seconds', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('ago.minutes', { n: m });
  const h = Math.round(m / 60);
  return t('ago.hours', { n: h });
}

export function fmtTime(ms, lang) {
  return new Intl.DateTimeFormat(locales[lang] || 'en-US', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(ms);
}

export function fmtCoord(lat, lng) {
  const la = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`;
  return `${la} ${lo}`;
}

export function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
