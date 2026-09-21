// Maps free-text country names (as used by OpenSky / USGS / adsbdb) to ISO-3166 alpha-2 codes
// and renders them in the current UI language via Intl.DisplayNames.

const ALIASES = {
  'united states': 'US', 'united states of america': 'US', usa: 'US',
  'russian federation': 'RU', russia: 'RU',
  'republic of korea': 'KR', 'korea, republic of': 'KR', 'south korea': 'KR',
  "democratic people's republic of korea": 'KP', 'north korea': 'KP',
  'iran, islamic republic of': 'IR', iran: 'IR',
  'viet nam': 'VN', vietnam: 'VN',
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB',
  'kingdom of the netherlands': 'NL', netherlands: 'NL',
  'czech republic': 'CZ', czechia: 'CZ',
  'republic of moldova': 'MD', moldova: 'MD',
  'syrian arab republic': 'SY', syria: 'SY',
  "lao people's democratic republic": 'LA', laos: 'LA',
  'bolivia, plurinational state of': 'BO', bolivia: 'BO',
  'venezuela, bolivarian republic of': 'VE', venezuela: 'VE',
  'tanzania, united republic of': 'TZ', tanzania: 'TZ',
  'the former yugoslav republic of macedonia': 'MK', 'north macedonia': 'MK', macedonia: 'MK',
  'taiwan, province of china': 'TW', taiwan: 'TW',
  'hong kong': 'HK', macao: 'MO', macau: 'MO',
  'turkey': 'TR', 'türkiye': 'TR', turkiye: 'TR',
  'united arab emirates': 'AE', uae: 'AE',
  'saudi arabia': 'SA', 'kingdom of saudi arabia': 'SA',
  'brunei darussalam': 'BN', 'cabo verde': 'CV', 'cape verde': 'CV',
  "côte d'ivoire": 'CI', "cote d'ivoire": 'CI', 'ivory coast': 'CI',
  'congo (kinshasa)': 'CD', 'democratic republic of the congo': 'CD', 'congo, democratic republic of the': 'CD',
  'congo (brazzaville)': 'CG', 'republic of the congo': 'CG', congo: 'CG',
  'micronesia, federated states of': 'FM', 'swaziland': 'SZ', eswatini: 'SZ',
  'palestine, state of': 'PS', palestine: 'PS', 'kosovo': 'XK',
};

const nameToIso = new Map(Object.entries(ALIASES));
let hydrated = false;

/** Adds names from the Natural Earth dataset (name + alternates) once it is loaded. */
export function hydrateCountryNames(features) {
  if (hydrated) return;
  for (const f of features) {
    const p = f.properties;
    if (!p.iso2) continue;
    for (const n of [p.name, ...(p.altNames || [])]) {
      const k = n.toLowerCase();
      if (!nameToIso.has(k)) nameToIso.set(k, p.iso2);
    }
  }
  hydrated = true;
}

export function countryToIso2(name) {
  if (!name) return '';
  if (/^[A-Z]{2}$/.test(name)) return name;
  const k = name.toLowerCase().trim();
  if (nameToIso.has(k)) return nameToIso.get(k);
  // Tolerate "X, Republic of" style names.
  const head = k.split(',')[0].trim();
  return nameToIso.get(head) || '';
}

const displayCache = {};
export function localizedCountry(nameOrIso, lang) {
  const iso = countryToIso2(nameOrIso);
  if (!iso) return nameOrIso || '—';
  try {
    displayCache[lang] ||= new Intl.DisplayNames([lang], { type: 'region' });
    return displayCache[lang].of(iso) || nameOrIso;
  } catch {
    return nameOrIso;
  }
}
