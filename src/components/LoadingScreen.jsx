import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';

const MAX_WAIT_MS = 15000;
const MIN_SHOW_MS = 1400;

export default function LoadingScreen() {
  const t = useT();
  const loading = useStore((s) => s.loading);
  const quakesSource = useStore((s) => s.sources.quakes);
  const setLoading = useStore((s) => s.setLoading);
  const [minElapsed, setMinElapsed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const a = setTimeout(() => setMinElapsed(true), MIN_SHOW_MS);
    const b = setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  const texturesDone = !!loading.texturesDone;
  const done = (minElapsed && texturesDone && loading.flights) || timedOut;

  useEffect(() => {
    if (!done || loading.ready) return undefined;
    setLoading({ ready: true });
    const id = setTimeout(() => setGone(true), 900);
    return () => clearTimeout(id);
  }, [done, loading.ready, setLoading]);

  if (gone) return null;
  const pct = Math.round(((loading.textures || 0) * 0.6 + (loading.flights ? 0.3 : 0) + (quakesSource !== 'loading' ? 0.1 : 0)) * 100);

  const steps = [
    ['loading.textures', texturesDone],
    ['loading.flights', !!loading.flights],
    ['loading.quakes', quakesSource !== 'loading'],
  ];

  return (
    <div className={`loader${done ? ' done' : ''}`} aria-busy={!done} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="loader-stars" aria-hidden="true" />
      <div className="loader-core">
        <div className="loader-orbits" aria-hidden="true">
          <div className="planet" />
          <div className="orbit o1">
            <i />
          </div>
          <div className="orbit o2">
            <i />
          </div>
          <div className="orbit o3">
            <i />
          </div>
        </div>
        <h1 className="loader-title">
          <span>{t('app.name')}</span>
          <small>{t('app.tagline')}</small>
        </h1>
        <p className="loader-sub">{t('loading.title')}</p>
        <div className="loader-bar">
          <i style={{ width: `${Math.max(6, pct)}%` }} />
        </div>
        <ul className="loader-steps">
          {steps.map(([key, ok]) => (
            <li key={key} className={ok ? 'ok' : ''}>
              <span className="tick">{ok ? '✓' : ''}</span>
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
