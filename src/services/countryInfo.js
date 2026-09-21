// Country details from REST Countries, with a Natural Earth fallback.
import { OFFLINE } from '../lib/env.js';
import { getJSON } from '../lib/http.js';

const cache = new Map();
const FIELDS = 'name,capital,population,flags,region,subregion,area,currencies,languages,translations,cca2,cca3,timezones';

export async function getCountryInfo(props) {
  const code = props.iso3 || props.iso2;
  if (!code) return fallback(props);
  if (cache.has(code)) return cache.get(code);
  const request = OFFLINE
    ? Promise.reject(new Error('offline build'))
    : getJSON(`https://restcountries.com/v3.1/alpha/${code}?fields=${FIELDS}`, { timeout: 9000 });
  const promise = request
    .then((raw) => {
      const c = Array.isArray(raw) ? raw[0] : raw;
      return {
        source: 'restcountries',
        name: c.name?.common || props.name,
        nameAr: c.translations?.ara?.common || props.nameAr,
        official: c.name?.official,
        officialAr: c.translations?.ara?.official,
        capital: (c.capital || []).join(', '),
        population: c.population,
        area: c.area,
        region: c.subregion || c.region,
        flag: c.flags?.svg || c.flags?.png,
        flagAlt: c.flags?.alt,
        currencies: Object.entries(c.currencies || {}).map(([k, v]) => `${v.name} (${v.symbol || k})`).join(', '),
        languages: Object.values(c.languages || {}).join(', '),
        iso2: c.cca2 || props.iso2,
        iso3: c.cca3 || props.iso3,
      };
    })
    .catch(() => {
      cache.delete(code); // retry next time
      return fallback(props);
    });
  cache.set(code, promise);
  return promise;
}

function fallback(props) {
  return {
    source: 'naturalearth',
    name: props.name,
    nameAr: props.nameAr,
    population: props.pop,
    region: props.region || props.continent,
    iso2: props.iso2,
    iso3: props.iso3,
    flag: null,
  };
}
