import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import { useAnimatedNumber, useTicker } from '../hooks.js';
import { fmtInt, fmtNum, fmtAgo } from '../lib/format.js';
import { Icon } from './Icons.jsx';

function Counter({ value, lang }) {
  const v = useAnimatedNumber(value);
  return <span className="stat-num">{fmtInt(Math.round(v), lang)}</span>;
}

function SourceDot({ status, t }) {
  const s = status || 'idle';
  return (
    <span className={`src src-${s}`} title={t(`source.${s}`)}>
      <i />
      {t(`source.${s}`)}
    </span>
  );
}

export default function StatsBar() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const stats = useStore((s) => s.stats);
  const sources = useStore((s) => s.sources);
  const satellitesOn = useStore((s) => s.layers.satellites);
  const last = useStore((s) => s.lastFlightUpdate);
  useTicker(1000);

  const now = new Date();
  const utc = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;

  return (
    <section className="statsbar glass" aria-live="polite">
      <div className="stat stat-flights">
        <Icon.plane className="stat-icon" />
        <div>
          <Counter value={stats.airborne} lang={lang} />
          <span className="stat-label">{t('stats.airborne')}</span>
        </div>
        <SourceDot status={sources.flights} t={t} />
      </div>
      <div className="stat">
        <Icon.flag className="stat-icon" />
        <div>
          <Counter value={stats.countries} lang={lang} />
          <span className="stat-label">{t('stats.countries')}</span>
        </div>
      </div>
      <div className="stat stat-quakes">
        <Icon.quake className="stat-icon" />
        <div>
          <Counter value={stats.quakesToday} lang={lang} />
          <span className="stat-label">
            {t('stats.quakes')}
            {stats.maxMag > 0 && (
              <em>
                {' '}
                · {t('stats.maxMag')} M{fmtNum(stats.maxMag, lang, 1)}
              </em>
            )}
          </span>
        </div>
      </div>
      {satellitesOn && (
        <div className="stat">
          <Icon.sat className="stat-icon" />
          <div>
            <Counter value={stats.satellites} lang={lang} />
            <span className="stat-label">{t('stats.sats')}</span>
          </div>
          <SourceDot status={sources.satellites} t={t} />
        </div>
      )}
      <div className="stat stat-clock">
        <div>
          <span className="stat-num mono">{utc}</span>
          <span className="stat-label">
            {t('stats.utc')}
            {last ? ` · ${t('stats.updated')} ${fmtAgo(last, t)}` : ''}
          </span>
        </div>
      </div>
    </section>
  );
}
