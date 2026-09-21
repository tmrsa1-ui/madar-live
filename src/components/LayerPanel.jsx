import { useMemo } from 'react';
import { OFFLINE } from '../lib/env.js';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import { flightStore } from '../services/flightStore.js';
import { localizedCountry, countryToIso2 } from '../lib/countryNames.js';
import { fmtInt, flightLevel, flagEmoji } from '../lib/format.js';
import { Icon } from './Icons.jsx';

const ALT_MAX = 13000;

function Toggle({ id, icon: Ico, label, hint, status, t, disabled }) {
  const on = useStore((s) => s.layers[id]);
  const toggle = useStore((s) => s.toggleLayer);
  const onClick = () => {
    toggle(id);
    const st = useStore.getState();
    if (id === 'radar' && !on && st.mode === '3d') st.pushToast({ key: 'radar-2d', tone: 'info', messageKey: 'toast.radar2d', ttl: 5000 });
    if (id === 'starlink' && !on && !st.layers.satellites) st.setLayer('satellites', true);
  };
  return (
    <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={!!on} onClick={onClick} disabled={disabled}>
      <span className="toggle-icon">{Ico && <Ico width={17} height={17} />}</span>
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      {status && on && <span className={`src src-${status}`} title={t(`source.${status}`)}><i /></span>}
      <span className="switch" aria-hidden="true">
        <i />
      </span>
    </button>
  );
}

function AltitudeRange({ t, lang }) {
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const { altMin, altMax } = filters;
  const pct = (v) => (v / ALT_MAX) * 100;
  return (
    <div className="field">
      <div className="field-head">
        <span>{t('filter.altitude')}</span>
        <span className="mono dim">
          {fmtInt(altMin, lang)}–{altMax >= ALT_MAX ? '∞' : fmtInt(altMax, lang)} {t('unit.m')}
        </span>
      </div>
      <div className="range2" style={{ '--a': `${pct(altMin)}%`, '--b': `${pct(altMax)}%` }}>
        <div className="range2-track" />
        <input
          type="range"
          min="0"
          max={ALT_MAX}
          step="250"
          value={altMin}
          aria-label={`${t('filter.altitude')} min`}
          onChange={(e) => setFilter({ altMin: Math.min(Number(e.target.value), altMax - 500) })}
        />
        <input
          type="range"
          min="0"
          max={ALT_MAX}
          step="250"
          value={altMax}
          aria-label={`${t('filter.altitude')} max`}
          onChange={(e) => setFilter({ altMax: Math.max(Number(e.target.value), altMin + 500) })}
        />
      </div>
      <div className="range-scale mono dim">
        <span>{flightLevel(altMin)}</span>
        <span>{altMax >= ALT_MAX ? 'FL430+' : flightLevel(altMax)}</span>
      </div>
    </div>
  );
}

function FlightFilters({ t, lang }) {
  const version = useStore((s) => s.flightsVersion);
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const countries = useMemo(() => {
    void version;
    return Array.from(flightStore.countryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 120);
  }, [version]);
  const shown = useMemo(() => {
    void version;
    return flightStore.visible(filters).length;
  }, [version, filters]);
  const dirty = filters.country !== 'all' || filters.altMin > 0 || filters.altMax < ALT_MAX || !filters.hideGround;

  return (
    <div className="filters">
      <div className="field">
        <div className="field-head">
          <span>{t('filter.country')}</span>
        </div>
        <div className="select-wrap">
          <select value={filters.country} onChange={(e) => setFilter({ country: e.target.value })}>
            <option value="all">{t('filter.allCountries')}</option>
            {filters.country !== 'all' && !countries.some(([c]) => c === filters.country) && (
              <option value={filters.country}>{localizedCountry(filters.country, lang)}</option>
            )}
            {countries.map(([c, n]) => (
              <option key={c} value={c}>
                {flagEmoji(countryToIso2(c))} {localizedCountry(c, lang)} ({fmtInt(n, lang)})
              </option>
            ))}
          </select>
          <Icon.chevron className="select-chevron" />
        </div>
      </div>
      <AltitudeRange t={t} lang={lang} />
      <label className="check">
        <input type="checkbox" checked={filters.hideGround} onChange={(e) => setFilter({ hideGround: e.target.checked })} />
        <span>{t('filter.hideGround')}</span>
      </label>
      <div className="filter-foot">
        <span className="dim">{t('filter.showing', { n: fmtInt(shown, lang), total: fmtInt(flightStore.list.length, lang) })}</span>
        {dirty && (
          <button className="link-btn" onClick={() => setFilter({ country: 'all', altMin: 0, altMax: ALT_MAX, hideGround: true })}>
            {t('filter.reset')}
          </button>
        )}
      </div>
    </div>
  );
}

function Legend({ t }) {
  return (
    <div className="legend">
      <div className="legend-row">
        <span className="legend-title">{t('filter.altitude')}</span>
        <div className="legend-bar alt-bar" />
        <div className="legend-scale dim">
          <span>0</span>
          <span className="legend-mid">9 {t('unit.km')}</span>
          <span>13+ {t('unit.km')}</span>
        </div>
        <div className="legend-chips">
          <span><i style={{ background: '#8c99b8' }} />{t('legend.ground')}</span>
          <span><i style={{ background: '#ffb23d' }} />{t('legend.selected')}</span>
        </div>
      </div>
      <div className="legend-row">
        <span className="legend-title">{t('legend.magnitude')}</span>
        <div className="legend-chips mags">
          {[
            ['<2', '#b8f5ff'],
            ['2', '#ffe07a'],
            ['3', '#ffb23e'],
            ['4', '#ff7a59'],
            ['5', '#ff4f7b'],
            ['6+', '#ff2f6d'],
          ].map(([m, c]) => (
            <span key={m}>
              <i className="dot" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
              {m}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LayerPanel() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const open = useStore((s) => s.panelOpen);
  const setOpen = useStore((s) => s.setPanelOpen);
  const sources = useStore((s) => s.sources);
  const mode = useStore((s) => s.mode);
  const basemap = useStore((s) => s.basemap);
  const setBasemap = useStore((s) => s.setBasemap);
  const flightsOn = useStore((s) => s.layers.flights);

  return (
    <aside id="layer-panel" className={`panel layer-panel glass${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="panel-head">
        <h2>
          <Icon.layers /> {t('panel.open')}
        </h2>
        <button className="icon-btn ghost" onClick={() => setOpen(false)} title={t('panel.close')}>
          <Icon.close />
        </button>
      </div>
      <div className="panel-body">
        <section>
          <h3>{t('section.aviation')}</h3>
          <Toggle id="flights" icon={Icon.plane} label={t('layer.flights')} status={sources.flights} t={t} />
          <Toggle id="arcs" icon={Icon.arc} label={t('layer.arcs')} t={t} disabled={!flightsOn} />
          <Toggle id="heatmap" icon={Icon.heat} label={t('layer.heatmap')} t={t} disabled={!flightsOn} />
        </section>

        {flightsOn && (
          <section>
            <h3>
              <Icon.filter width={14} height={14} /> {t('section.filters')}
            </h3>
            <FlightFilters t={t} lang={lang} />
          </section>
        )}

        <section>
          <h3>{t('section.earth')}</h3>
          <Toggle id="countries" icon={Icon.borders} label={t('layer.countries')} t={t} />
          <Toggle id="quakes" icon={Icon.quake} label={t('layer.quakes')} status={sources.quakes} t={t} />
          <Toggle id="satellites" icon={Icon.sat} label={t('layer.satellites')} status={sources.satellites} t={t} />
          <Toggle id="starlink" icon={Icon.starlink} label={t('layer.starlink')} t={t} />
          <Toggle id="weather" icon={Icon.cloud} label={t('layer.weather')} status={sources.weather} t={t} />
          {!OFFLINE && <Toggle id="radar" icon={Icon.radar} label={t('layer.radar')} hint={t('layer.radar.hint')} t={t} />}
        </section>

        <section>
          <h3>{t('section.globe')}</h3>
          <Toggle id="dayNight" icon={Icon.sun} label={t('layer.dayNight')} t={t} />
          {mode === '3d' && <Toggle id="clouds" icon={Icon.cloud} label={t('layer.clouds')} t={t} />}
          {mode === '3d' && <Toggle id="autoRotate" icon={Icon.rotate} label={t('layer.autoRotate')} t={t} />}
          {mode === '2d' && !OFFLINE && (
            <div className="field">
              <div className="field-head">
                <span>{t('section.basemap')}</span>
              </div>
              <div className="segmented small">
                {['satellite', 'dark'].map((b) => (
                  <button key={b} className={basemap === b ? 'on' : ''} onClick={() => setBasemap(b)}>
                    {t(`basemap.${b}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section>
          <h3>{t('section.legend')}</h3>
          <Legend t={t} />
        </section>
      </div>
    </aside>
  );
}
