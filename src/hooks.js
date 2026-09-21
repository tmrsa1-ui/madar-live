// Small shared React hooks.
import { useEffect, useRef, useState } from 'react';
import { useStore } from './store/useStore.js';
import { satStore } from './services/satellites.js';

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

/** Value that only updates after `ms` without changes. */
export function useDebounced(value, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Re-renders every `ms` (skipped while the tab is hidden). Returns Date.now(). */
export function useTicker(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Tweens a displayed number towards `value` (ease-out cubic). */
export function useAnimatedNumber(value, duration = 800) {
  const target = Number.isFinite(value) ? value : 0;
  const [shown, setShown] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (reduceMotion || Math.abs(target - cur.current) < 0.5) {
      cur.current = target;
      setShown(target);
      return undefined;
    }
    const from = cur.current;
    const start = performance.now();
    let raf = 0;
    const step = (now) => {
      const k = Math.min(1, (now - start) / duration);
      const v = from + (target - from) * (1 - (1 - k) ** 3);
      cur.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return shown;
}

/** The satellite store, re-rendering the caller when the catalogue changes. */
export function useSatStore() {
  useStore((s) => s.satVersion);
  return satStore;
}
