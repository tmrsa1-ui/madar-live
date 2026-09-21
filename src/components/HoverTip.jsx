import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import { useSatStore } from '../hooks.js';
import { flightStore } from '../services/flightStore.js';
import { magColor } from '../services/earthquakes.js';
import { localizedCountry, countryToIso2 } from '../lib/countryNames.js';
import { fmtInt, fmtNum, flagEmoji, flightLevel, msToKmh, fmtAgo } from '../lib/format.js';

/** Cursor-following tooltip. Its position is written directly by the renderers (no React re-render per mousemove). */
export default function HoverTip() {
  const hover = useStore((s) => s.hover);
  const lang = useStore((s) => s.lang);
  const t = useT();
  const satStore = useSatStore();
  const ref = useRef(null);
  let body = null;

  // Follow the pointer in both 3D and 2D; flip to the other side near the viewport edges.
  useEffect(() => {
    const onMove = (e) => {
      const el = ref.current;
      if (!el || e.pointerType === 'touch') return;
      // Over HUD panels / buttons: nothing on the map is hovered.
      if (!e.target?.closest?.('.view-3d, .deck-host')) {
        if (useStore.getState().hover) useStore.getState().setHover(null);
        return;
      }
      const w = el.offsetWidth || 180;
      const h = el.offsetHeight || 60;
      const x = e.clientX + 16 + w > window.innerWidth ? e.clientX - w - 14 : e.clientX + 16;
      const y = e.clientY + 18 + h > window.innerHeight ? e.clientY - h - 12 : e.clientY + 18;
      el.style.transform = `translate(${x}px, ${y}px)`;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  if (hover?.kind === 'flight') {
    const f = flightStore.get(hover.key);
    if (f) {
      body = (
        <>
          <b className="mono">{f.callsign?.trim() || f.icao24.toUpperCase()}</b>
          <span>
            {flagEmoji(f.iso2 || countryToIso2(f.country))} {localizedCountry(f.country, lang)}
          </span>
          <span className="mono dim">
            {f.onGround ? t('flight.onGround') : `${flightLevel(f.altM || 0)} · ${fmtInt(msToKmh(f.velocity || 0), lang)} ${t('unit.kmh')}`}
          </span>
        </>
      );
    }
  } else if (hover?.kind === 'sat' && satStore) {
    const s = satStore.sats[hover.index];
    const g = satStore.geo(hover.index);
    if (s) {
      body = (
        <>
          <b className="mono">{s.name}</b>
          {g && (
            <span className="mono dim">
              {fmtInt(g.altKm, lang)} {t('unit.km')} · {fmtNum(g.speed, lang, 2)} {t('unit.kms')}
            </span>
          )}
        </>
      );
    }
  } else if (hover?.kind === 'country') {
    const p = hover.data;
    const name = lang === 'ar' ? p.nameAr || localizedCountry(p.iso2, lang) : p.name;
    let n = 0;
    for (const [c, k] of flightStore.countryCounts) if (countryToIso2(c) === p.iso2) n += k;
    body = (
      <>
        <b>
          {flagEmoji(p.iso2)} {name}
        </b>
        {n > 0 && <span className="dim">{t('hover.flights', { n: fmtInt(n, lang) })}</span>}
      </>
    );
  } else if (hover?.kind === 'quake') {
    const q = hover.data;
    body = (
      <>
        <b className="mono" style={{ color: magColor(q.mag) }}>
          M{fmtNum(q.mag, lang, 1)}
        </b>
        <span>{q.place}</span>
        <span className="dim">{fmtAgo(q.time, t)}</span>
      </>
    );
  }

  return (
    <div ref={ref} id="hover-tip" className={`hover-tip glass${body ? ' show' : ''}`} role="tooltip">
      {body}
    </div>
  );
}
