import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import { useDebounced } from '../hooks.js';
import { searchLocal, searchPlaces, ensureIndex } from '../services/search.js';
import { flightStore } from '../services/flightStore.js';
import { satStore, startSatellites } from '../services/satellites.js';
import { localizedCountry } from '../lib/countryNames.js';
import { flagEmoji } from '../lib/format.js';
import { clamp } from '../lib/geo.js';
import { Icon } from './Icons.jsx';

const KIND_ICON = { airport: Icon.plane, city: Icon.city, country: Icon.flag, flight: Icon.plane, sat: Icon.sat, place: Icon.pin };

export default function SearchBox() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [online, setOnline] = useState(null); // null | 'loading' | []
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const debounced = useDebounced(query, 120);
  const slow = useDebounced(query, 650);

  useEffect(() => {
    let cancelled = false;
    if (debounced.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    searchLocal(debounced, 8).then((r) => {
      if (!cancelled) {
        setResults(r);
        setActive(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  // Anything the local index doesn't know goes to OpenStreetMap (rate-limited, debounced).
  useEffect(() => {
    let cancelled = false;
    setOnline(null);
    if (slow.trim().length < 3) return undefined;
    searchLocal(slow, 8).then((local) => {
      if (cancelled || local.length >= 3) return;
      setOnline('loading');
      searchPlaces(slow, lang)
        .then((r) => !cancelled && setOnline(r))
        .catch(() => !cancelled && setOnline([]));
    });
    return () => {
      cancelled = true;
    };
  }, [slow, lang]);

  useEffect(() => {
    const onDown = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const all = [...results, ...(Array.isArray(online) ? online.filter((o) => !results.some((r) => r.id === o.id)) : [])];

  async function choose(item) {
    const st = useStore.getState();
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    if (!item) return;
    switch (item.kind) {
      case 'flight': {
        const f = flightStore.get(item.icao24);
        if (!f) return;
        if (!st.layers.flights) st.setLayer('flights', true);
        if (st.filters.country !== 'all' && st.filters.country !== f.country) st.setFilter({ country: 'all' });
        st.select({ kind: 'flight', id: f.icao24 });
        const g = flightStore.geoAt(f);
        st.requestFlyTo({ lat: g.lat, lng: g.lng, altitude: 0.42 });
        break;
      }
      case 'sat': {
        if (!st.layers.satellites) st.setLayer('satellites', true);
        await startSatellites({ starlink: st.layers.starlink });
        const norad = item.norad || Number(String(item.id).replace('sat-', ''));
        const index = satStore.indexOfNorad(norad);
        if (index < 0) return;
        st.select({ kind: 'sat', id: norad, index });
        const wait = (tries) => {
          const g = satStore.geo(index);
          if (g) st.requestFlyTo({ lat: g.lat, lng: g.lng, altitude: 1.1 });
          else if (tries > 0) setTimeout(() => wait(tries - 1), 400);
        };
        wait(10);
        break;
      }
      case 'country':
        st.select({ kind: 'country', data: item.props });
        st.requestFlyTo({ lat: item.lat, lng: item.lng, altitude: clamp(0.35 + item.span / 22, 0.5, 2.4) });
        break;
      case 'airport':
        st.requestFlyTo({ lat: item.lat, lng: item.lng, altitude: 0.14 });
        break;
      case 'city':
        st.requestFlyTo({ lat: item.lat, lng: item.lng, altitude: 0.2 });
        break;
      default:
        st.requestFlyTo({ lat: item.lat, lng: item.lng, altitude: clamp(0.08 + (item.span || 1) / 12, 0.1, 2) });
    }
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(all.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(all[active] || all[0]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      e.currentTarget.blur();
    }
  }

  const title = (item) => {
    if (item.kind === 'country') return lang === 'ar' ? item.titleAr || localizedCountry(item.iso2, lang) : item.title;
    if (item.kind === 'city') return lang === 'ar' && item.titleAr ? item.titleAr : item.title;
    return item.title;
  };
  const subtitle = (item) => {
    if (item.kind === 'airport') return `${item.sub} · ${(lang === 'ar' && item.cityAr) || item.city || ''} ${flagEmoji(item.country)}`;
    if (item.kind === 'city') return `${localizedCountry(item.iso2 || item.country, lang)} ${flagEmoji(item.iso2)}`;
    if (item.kind === 'flight') return `${item.sub} · ${localizedCountry(item.country, lang)}`;
    if (item.kind === 'country') return item.props?.iso3 || '';
    return item.sub || '';
  };

  const showList = open && query.trim().length >= 2;

  return (
    <div className="search" ref={boxRef}>
      <label className="search-field glass">
        <Icon.search className="search-icon" />
        <input
          id="madar-search"
          ref={inputRef}
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('search.placeholder')}
          value={query}
          onFocus={() => {
            setOpen(true);
            ensureIndex();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls="madar-search-list"
        />
        <kbd className="search-kbd" title={t('search.hint')}>/</kbd>
      </label>
      {showList && (
        <ul className="search-results glass" id="madar-search-list" role="listbox">
          {all.map((item, i) => {
            const Ico = KIND_ICON[item.kind] || Icon.pin;
            return (
              <li
                key={item.id}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'is-active' : ''}
                onPointerEnter={() => setActive(i)}
                onPointerDown={(e) => {
                  e.preventDefault();
                  choose(item);
                }}
              >
                <span className={`res-icon kind-${item.kind}`}>
                  <Ico width={16} height={16} />
                </span>
                <span className="res-text">
                  <span className="res-title">{title(item)}</span>
                  <span className="res-sub">{subtitle(item)}</span>
                </span>
                <span className="res-kind">{t(`search.kind.${item.kind}`)}</span>
              </li>
            );
          })}
          {online === 'loading' && <li className="res-status">{t('search.searching')}</li>}
          {Array.isArray(online) && online.length > 0 && <li className="res-status small">{t('search.online')}</li>}
          {!all.length && online !== 'loading' && debounced === query && <li className="res-status">{t('search.empty')}</li>}
        </ul>
      )}
    </div>
  );
}
