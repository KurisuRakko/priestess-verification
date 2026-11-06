import { useCallback, useEffect, useState } from "react";

/**
 * Two languages, Chinese and English. A page defines its copy once as
 * `defineStrings({ zh: {...}, en: {...} })` — both halves must have the same
 * keys — and picks a half with the current `Lang`.
 *
 *   - the gate pages get their language from the server (`Accept-Language`,
 *     `pickLang` in gate.js) through the page config;
 *   - the showcase picks it in the browser (`pv-lang` in localStorage, then
 *     `navigator.languages`) and can switch it (`useLang`).
 */
export type Lang = "zh" | "en";

export function isLang(value: unknown): value is Lang {
  return value === "zh" || value === "en";
}

export function defineStrings<T extends Record<string, unknown>>(strings: {
  zh: T;
  en: T;
}) {
  return strings;
}

/** `<html lang>` for a language. */
export function htmlLang(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : "en";
}

/** The widget's `data-cap-lang` for a language. */
export function capLang(lang: Lang): string {
  return lang === "zh" ? "zh-cn" : "en";
}

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the preference just isn't kept.
  }
}

/** Saved choice first, then the browser's languages, then English. */
export function pickClientLang(storageKey: string): Lang {
  const saved = storageGet(storageKey);
  if (isLang(saved)) return saved;
  for (const pref of navigator.languages ?? [navigator.language ?? ""]) {
    const code = String(pref).toLowerCase();
    if (code.startsWith("zh")) return "zh";
    if (code.startsWith("en")) return "en";
  }
  return "en";
}

/** A switchable language, remembered under `storageKey`; keeps `<html lang>` in step. */
export function useLang(storageKey: string): [Lang, (lang: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(() => pickClientLang(storageKey));
  useEffect(() => {
    document.documentElement.lang = htmlLang(lang);
  }, [lang]);
  const setLang = useCallback(
    (next: Lang) => {
      storageSet(storageKey, next);
      setLangState(next);
    },
    [storageKey],
  );
  return [lang, setLang];
}

export { storageGet, storageSet };
