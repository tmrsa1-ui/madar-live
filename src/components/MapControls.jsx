import { useStore, defaultAltitude } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import { Icon } from './Icons.jsx';

const clampAlt = (a) => Math.min(6, Math.max(0.06, a));

/** Zoom / reset buttons that work for both the globe and the flat map (via store.flyTo). */
export default function MapControls() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const zoom = (factor) => {
    const st = useStore.getState();
    const v = st.view;
    st.setFollow(false);
    st.requestFlyTo({ lat: v.lat, lng: v.lng, altitude: clampAlt(v.altitude * factor), duration: 650 });
  };
  const reset = () => {
    const st = useStore.getState();
    st.setFollow(false);
    st.requestFlyTo({ lat: 24, lng: st.view.lng, altitude: defaultAltitude() });
  };
  const zin = lang === 'ar' ? 'تكبير' : 'Zoom in';
  const zout = lang === 'ar' ? 'تصغير' : 'Zoom out';
  const rst = lang === 'ar' ? 'العرض الكامل' : 'Reset view';
  return (
    <div className="map-controls glass" role="group" aria-label={t('mode.toggle')}>
      <button className="icon-btn ghost" onClick={() => zoom(0.55)} title={zin} aria-label={zin}>
        <span aria-hidden="true">+</span>
      </button>
      <button className="icon-btn ghost" onClick={() => zoom(1.8)} title={zout} aria-label={zout}>
        <span aria-hidden="true">−</span>
      </button>
      <button className="icon-btn ghost" onClick={reset} title={rst} aria-label={rst}>
        <Icon.globe width={16} height={16} />
      </button>
    </div>
  );
}
