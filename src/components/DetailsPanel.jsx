import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import { useTicker, useSatStore } from '../hooks.js';
import { flightStore } from '../services/flightStore.js';
import { getCountryInfo } from '../services/countryInfo.js';
import { magColor } from '../services/earthquakes.js';
import { localizedCountry, countryToIso2 } from '../lib/countryNames.js';
import { fmtInt, fmtNum, fmtCompact, fmtAgo, fmtTime, fmtCoord, flagEmoji, flightLevel, mToFt, msToKmh, msToKt } from '../lib/format.js';
import { haversineKm } from '../lib/geo.js';
import { Icon } from './Icons.jsx';

export default function DetailsPanel() {
  const selection = useStore((s) => s.selection);
  const clear = useStore((s) => s.clearSelection);
  const t = useT();
  if (!selection) return null;
  const Body = { flight: FlightDetails, quake: QuakeDetails, country: CountryDetails, sat: SatDetails }[selection.kind];
  if (!Body) return null;
  return (
    <aside className={`panel details glass kind-${selection.kind}`} aria-live="polite">
      <button className="icon-btn ghost details-close" onClick={clear} title={t('details.close')}>
        <Icon.close />
      </button>
      <Body selection={selection} t={t} />
    </aside>
  );
}

/** Great-circle progress between origin and destination, from the aircraft's live position. */
function RouteProgress({ route, g, lang, t }) {
  const o = route.origin;
  const d = route.destination;
  if (![o?.lat, o?.lng, d?.lat, d?.lng].every(Number.isFinite)) return null;
  const total = haversineKm(o.lat, o.lng, d.lat, d.lng);
  const left = haversineKm(g.lat, g.lng, d.lat, d.lng);
  if (!total) return null;
  // Callsign->route databases can be stale; if the aircraft is far off the origin->destination
  // path, a progress figure would be misleading, so show the route without it.
  const detour = haversineKm(o.lat, o.lng, g.lat, g.lng) + left - total;
  if (detour > Math.max(300, total * 0.25)) return null;
  const done = Math.max(0, Math.min(total, total - left));
  const pct = Math.round((done / total) * 100);
  return (
    <div className="route-progress" title={`${pct}%`}>
      <div className="route-progress-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="dim small">
        {t('flight.progress', { done: fmtInt(done, lang), total: fmtInt(total, lang) })} · {pct}%
      </span>
    </div>
  );
}

/** Copies the permalink (camera + selected flight are kept in the URL hash). */
function ShareButton({ t }) {
  const pushToast = useStore((s) => s.pushToast);
  const share = async () => {
    // Let the debounced hash writer catch up with the current selection first.
    await new Promise((r) => setTimeout(r, 650));
    const url = location.href;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: document.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      pushToast({ key: 'share', tone: 'ok', messageKey: 'toast.linkCopied', ttl: 3500 });
    } catch {
      /* user cancelled the share sheet, or clipboard blocked */
    }
  };
  return (
    <button className="btn glass icon-only" onClick={share} title={t('details.share')} aria-label={t('details.share')}>
      <Icon.external />
    </button>
  );
}

function Row({ label, children, mono }) {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : ''}>{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FlightDetails({ selection, t }) {
  const lang = useStore((s) => s.lang);
  const details = useStore((s) => s.selectedDetails);
  const follow = useStore((s) => s.follow);
  const setFollow = useStore((s) => s.setFollow);
  const requestFlyTo = useStore((s) => s.requestFlyTo);
  useTicker(1000);
  useStore((s) => s.flightsVersion);

  const f = flightStore.get(selection.id);
  if (!f) {
    return (
      <div className="details-body">
        <header className="details-head">
          <span className="kind-badge">
            <Icon.plane /> {t('flight.title')}
          </span>
        </header>
        <p className="dim">{t('flight.gone')}</p>
      </div>
    );
  }

  const g = flightStore.geoAt(f);
  const alt = f.altM ?? 0;
  const v = f.velocity ?? 0;
  const vr = f.vrate ?? 0;
  const route = details?.route;
  const track = details?.track;
  const iso = f.iso2 || countryToIso2(f.country);
  const simulated = flightStore.source === 'demo';
  const vTrend = vr > 1 ? t('flight.climbing') : vr < -1 ? t('flight.descending') : t('flight.level');

  return (
    <div className="details-body">
      <header className="details-head">
        <span className="kind-badge">
          <Icon.plane /> {t('flight.title')}
          {simulated && <em className="sim-badge">{t('flight.simulated')}</em>}
        </span>
        <h2 className="mono callsign">{f.callsign?.trim() || t('flight.unknown')}</h2>
        <p className="sub">
          <span className="flag-emoji">{flagEmoji(iso)}</span> {localizedCountry(f.country, lang)} · <span className="mono">{f.icao24.toUpperCase()}</span>
        </p>
      </header>

      <div className="route-card">
        {route === undefined && <p className="dim small">{t('flight.routeLoading')}</p>}
        {route === null && <p className="dim small">{t('flight.routeUnknown')}</p>}
        {route?.origin && route?.destination && (
          <>
            <div className="route-ends">
              <div>
                <b className="mono">{route.origin.iata || route.origin.icao}</b>
                <small>{route.origin.city || route.origin.name}</small>
              </div>
              <div className="route-line" aria-hidden="true">
                <i />
                <Icon.plane className="route-plane" />
              </div>
              <div>
                <b className="mono">{route.destination.iata || route.destination.icao}</b>
                <small>{route.destination.city || route.destination.name}</small>
              </div>
            </div>
            <RouteProgress route={route} g={g} lang={lang} t={t} />
            {route.airline?.name && (
              <p className="dim small">
                {t('flight.airline')}: {route.airline.name}
              </p>
            )}
          </>
        )}
      </div>

      <div className="big-stats">
        <div>
          <span className="big mono">{f.onGround ? '—' : fmtInt(alt, lang)}</span>
          <small>
            {t('flight.altitude')} ({t('unit.m')})
          </small>
          <em className="mono">{f.onGround ? t('flight.onGround') : `${fmtInt(mToFt(alt), lang)} ${t('unit.ft')} · ${flightLevel(alt)}`}</em>
        </div>
        <div>
          <span className="big mono">{fmtInt(msToKmh(v), lang)}</span>
          <small>
            {t('flight.speed')} ({t('unit.kmh')})
          </small>
          <em className="mono">
            {fmtInt(msToKt(v), lang)} {t('unit.kt')}
          </em>
        </div>
      </div>

      <dl className="rows">
        <Row label={t('flight.heading')} mono>
          <span className="heading-dial" style={{ '--hdg': `${g.hdg}deg` }}>
            <Icon.plane width={14} height={14} />
          </span>
          {fmtInt(g.hdg, lang)}°
        </Row>
        <Row label={t('flight.vrate')} mono>
          {fmtNum(vr, lang, 1)} {t('unit.ms')} · {vTrend}
        </Row>
        <Row label={t('flight.position')} mono>
          {fmtCoord(g.lat, g.lng)}
        </Row>
        {f.squawk && (
          <Row label={t('flight.squawk')} mono>
            {f.squawk}
          </Row>
        )}
        <Row label={t('flight.updated')}>{fmtAgo(f.updatedAt, t)}</Row>
        <Row label={t('flight.track')}>
          {track === undefined ? t('flight.trackLoading') : track ? t('flight.trackPoints', { n: fmtInt(track.length, lang) }) : t('flight.trackNone')}
        </Row>
      </dl>

      <div className="details-actions">
        <button className="btn glass" onClick={() => requestFlyTo({ lat: g.lat, lng: g.lng, altitude: 0.4 })}>
          <Icon.target /> {t('details.flyTo')}
        </button>
        <button className={`btn glass${follow ? ' on' : ''}`} onClick={() => setFollow(!follow)}>
          <Icon.follow /> {follow ? t('details.unfollow') : t('details.follow')}
        </button>
        <ShareButton t={t} />
      </div>
      <p className="source-note dim">
        {t('details.source')}: {simulated ? t('flight.simulated') : 'OpenSky Network'}
        {route && !route.simulated ? ' · adsbdb' : ''}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function QuakeDetails({ selection, t }) {
  const lang = useStore((s) => s.lang);
  const requestFlyTo = useStore((s) => s.requestFlyTo);
  const q = selection.data;
  const c = magColor(q.mag);
  return (
    <div className="details-body">
      <header className="details-head">
        <span className="kind-badge">
          <Icon.quake /> {t('quake.title')}
        </span>
        <div className="mag-hero" style={{ '--mag': c }}>
          <span className="mag-num mono">M{fmtNum(q.mag, lang, 1)}</span>
          <span className="mag-ring" />
        </div>
        <p className="sub">{q.place}</p>
      </header>
      <dl className="rows">
        <Row label={t('quake.time')}>
          {fmtTime(q.time, lang)} · {fmtAgo(q.time, t)}
        </Row>
        <Row label={t('quake.depth')} mono>
          {fmtNum(q.depth, lang, 1)} {t('unit.km')}
        </Row>
        <Row label={t('flight.position')} mono>
          {fmtCoord(q.lat, q.lng)}
        </Row>
        {q.felt ? <Row label={t('quake.felt')}>{fmtInt(q.felt, lang)}</Row> : null}
        {q.alert ? <Row label={t('quake.alert')}>{q.alert}</Row> : null}
        {q.tsunami ? <Row label={t('quake.tsunami')}>⚠️</Row> : null}
      </dl>
      <div className="details-actions">
        <button className="btn glass" onClick={() => requestFlyTo({ lat: q.lat, lng: q.lng, altitude: 0.7 })}>
          <Icon.target /> {t('details.flyTo')}
        </button>
        {q.url && (
          <a className="btn glass" href={q.url} target="_blank" rel="noreferrer">
            <Icon.external /> {t('quake.more')}
          </a>
        )}
      </div>
      {q.demo && <p className="source-note warn">{t('quake.sample')}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CountryDetails({ selection, t }) {
  const lang = useStore((s) => s.lang);
  const setFilter = useStore((s) => s.setFilter);
  const setLayer = useStore((s) => s.setLayer);
  useStore((s) => s.flightsVersion);
  const props = selection.data;
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let alive = true;
    setInfo(null);
    getCountryInfo(props).then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [props]);

  // How many aircraft registered in this country are currently tracked.
  let registryName = null;
  let count = 0;
  for (const [name, n] of flightStore.countryCounts) {
    if (countryToIso2(name) === props.iso2) {
      registryName = name;
      count += n;
    }
  }
  const name = lang === 'ar' ? info?.nameAr || props.nameAr || localizedCountry(props.iso2, lang) : info?.name || props.name;
  const official = lang === 'ar' ? info?.officialAr : info?.official;

  return (
    <div className="details-body">
      <header className="details-head country-head">
        <span className="kind-badge">
          <Icon.flag /> {t('country.title')}
        </span>
        <div className="country-title">
          {info?.flag ? (
            <img className="flag-img" src={info.flag} alt={info.flagAlt || name} loading="lazy" />
          ) : (
            <span className="flag-emoji big">{flagEmoji(props.iso2)}</span>
          )}
          <div>
            <h2>{name}</h2>
            {official && official !== name && <p className="sub">{official}</p>}
          </div>
        </div>
      </header>
      {!info && <p className="dim small">{t('country.loading')}</p>}
      <dl className="rows">
        {info?.capital && <Row label={t('country.capital')}>{info.capital}</Row>}
        <Row label={t('country.population')} mono>
          {fmtInt(info?.population ?? props.pop, lang)} <span className="dim">({fmtCompact(info?.population ?? props.pop, lang)})</span>
        </Row>
        {info?.area ? (
          <Row label={t('country.area')} mono>
            {fmtInt(info.area, lang)} {t('unit.km2')}
          </Row>
        ) : null}
        {(info?.region || props.region) && <Row label={t('country.region')}>{info?.region || props.region}</Row>}
        {info?.currencies && <Row label={t('country.currency')}>{info.currencies}</Row>}
        {info?.languages && <Row label={t('country.languages')}>{info.languages}</Row>}
        <Row label={t('country.flights')} mono>
          {fmtInt(count, lang)}
        </Row>
      </dl>
      {registryName && count > 0 && (
        <div className="details-actions">
          <button
            className="btn glass"
            onClick={() => {
              setLayer('flights', true);
              setFilter({ country: registryName });
            }}
          >
            <Icon.filter /> {t('country.filter')}
          </button>
        </div>
      )}
      {info?.source === 'naturalearth' && <p className="source-note warn">{t('country.offline')}</p>}
      {info?.source === 'restcountries' && <p className="source-note dim">{t('details.source')}: REST Countries</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SatDetails({ selection, t }) {
  const lang = useStore((s) => s.lang);
  const requestFlyTo = useStore((s) => s.requestFlyTo);
  useTicker(1000);
  const satStore = useSatStore();
  const sat = satStore?.sats[selection.index];
  if (!sat) return null;
  const g = satStore.geo(selection.index);

  return (
    <div className="details-body">
      <header className="details-head">
        <span className="kind-badge">
          <Icon.sat /> {t('sat.title')}
          {satStore.simulated && <em className="sim-badge">{t('flight.simulated')}</em>}
        </span>
        <h2 className="mono">{sat.name}</h2>
        <p className="sub">{t(`sat.group.${sat.group}`)}</p>
      </header>
      {g && (
        <div className="big-stats">
          <div>
            <span className="big mono">{fmtInt(g.altKm, lang)}</span>
            <small>
              {t('sat.altitude')} ({t('unit.km')})
            </small>
          </div>
          <div>
            <span className="big mono">{fmtNum(g.speed, lang, 2)}</span>
            <small>
              {t('sat.velocity')} ({t('unit.kms')})
            </small>
            <em className="mono">
              {fmtInt(g.speed * 3600, lang)} {t('unit.kmh')}
            </em>
          </div>
        </div>
      )}
      <dl className="rows">
        <Row label={t('sat.norad')} mono>
          {sat.norad}
        </Row>
        {g && (
          <Row label={t('sat.position')} mono>
            {fmtCoord(g.lat, g.lng)}
          </Row>
        )}
      </dl>
      {g && (
        <div className="details-actions">
          <button className="btn glass" onClick={() => requestFlyTo({ lat: g.lat, lng: g.lng, altitude: 1.2 })}>
            <Icon.target /> {t('details.flyTo')}
          </button>
        </div>
      )}
      <p className="source-note dim">{t('details.source')}: CelesTrak · SGP4 (satellite.js)</p>
    </div>
  );
}
