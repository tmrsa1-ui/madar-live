import { useCallback, useEffect } from 'react';
import { strings } from './strings.js';
import { useStore } from '../store/useStore.js';

export function translate(lang, key, vars) {
  let s = strings[lang]?.[key] ?? strings.en[key] ?? key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}

/** Returns a stable t(key, vars) for the current language. */
export function useT() {
  const lang = useStore((s) => s.lang);
  return useCallback((key, vars) => translate(lang, key, vars), [lang]);
}

/** Keeps <html lang/dir> and the page title in sync with the UI language. */
export function useDocumentLanguage() {
  const lang = useStore((s) => s.lang);
  useEffect(() => {
    const el = document.documentElement;
    el.lang = lang;
    el.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = lang === 'ar' ? 'مدار | الأرض الحيّة' : 'Madar | Live Earth';
  }, [lang]);
}
