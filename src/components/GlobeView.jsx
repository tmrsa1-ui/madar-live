import { useEffect, useRef } from 'react';
import { GlobeEngine } from '../globe/engine.js';
import { useStore } from '../store/useStore.js';

function fallBackTo2D(messageKey) {
  const st = useStore.getState();
  st.setLoading({ textures: 1, texturesDone: true });
  st.setMode('2d');
  st.pushToast({ key: 'webgl', tone: 'error', messageKey, ttl: 12000 });
}

/** Hosts the imperative Three.js / globe.gl engine. Kept mounted (paused) in 2D mode so textures stay loaded. */
export default function GlobeView({ active }) {
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let engine;
    try {
      engine = new GlobeEngine(hostRef.current);
    } catch (err) {
      console.error('[madar] 3D globe failed to start', err);
      fallBackTo2D('toast.webglFailed');
      return undefined;
    }
    engineRef.current = engine;
    if (!activeRef.current) engine.pause();
    const canvas = hostRef.current.querySelector('canvas');
    const onLost = (e) => {
      e.preventDefault();
      if (useStore.getState().mode === '3d') fallBackTo2D('toast.webglLost');
    };
    canvas?.addEventListener('webglcontextlost', onLost);
    if (import.meta.env.DEV) window.__madarEngine = engine;
    return () => {
      canvas?.removeEventListener('webglcontextlost', onLost);
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    if (active) e.resume();
    else e.pause();
  }, [active]);

  return <div ref={hostRef} className={`view view-3d${active ? '' : ' is-inactive'}`} aria-label="3D globe" role="application" />;
}
