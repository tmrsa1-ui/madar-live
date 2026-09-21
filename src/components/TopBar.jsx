import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import SearchBox from './SearchBox.jsx';
import { Icon } from './Icons.jsx';

export default function TopBar() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const panelOpen = useStore((s) => s.panelOpen);
  const setPanelOpen = useStore((s) => s.setPanelOpen);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 40 40" width="34" height="34">
            <defs>
              <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#38e1ff" />
                <stop offset="1" stopColor="#9d6bff" />
              </linearGradient>
            </defs>
            <circle cx="20" cy="20" r="9" fill="none" stroke="url(#bm)" strokeWidth="2.4" />
            <ellipse cx="20" cy="20" rx="17" ry="6.5" fill="none" stroke="url(#bm)" strokeWidth="1.6" transform="rotate(-24 20 20)" opacity="0.85" />
            <circle cx="34.5" cy="13.6" r="2.3" fill="#38e1ff" />
          </svg>
        </span>
        <span className="brand-text">
          <b>{t('app.name')}</b>
          <small>{t('app.tagline')}</small>
        </span>
      </div>

      <SearchBox />

      <div className="top-actions">
        <div className="segmented glass" role="tablist" aria-label={t('mode.toggle')}>
          <button role="tab" aria-selected={mode === '3d'} className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>
            <Icon.globe />
            <span>{t('mode.3d')}</span>
          </button>
          <button role="tab" aria-selected={mode === '2d'} className={mode === '2d' ? 'on' : ''} onClick={() => setMode('2d')}>
            <Icon.map />
            <span>{t('mode.2d')}</span>
          </button>
        </div>
        <button
          className="btn glass lang-btn"
          onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
          lang={lang === 'ar' ? 'en' : 'ar'}
          title={t('lang.toggle')}
          aria-label={t('lang.toggle')}
        >
          <span className="long">{t('lang.toggle')}</span>
          <span className="short" aria-hidden="true">{lang === 'ar' ? 'EN' : 'ع'}</span>
        </button>
        <button
          className={`btn glass icon-btn panel-btn${panelOpen ? ' on' : ''}`}
          onClick={() => setPanelOpen(!panelOpen)}
          aria-expanded={panelOpen}
          aria-controls="layer-panel"
          title={panelOpen ? t('panel.close') : t('panel.open')}
        >
          <Icon.layers />
        </button>
      </div>
    </header>
  );
}
