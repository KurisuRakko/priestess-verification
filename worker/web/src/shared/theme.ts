import { useCallback, useEffect, useState } from "react";

import { storageGet, storageSet } from "./i18n";

/**
 * Light / dark on `<html data-theme>`. The shell's boot script (demo-page.js, admin/page.js)
 * sets it before the first frame from `pv-theme` in localStorage, else the OS
 * preference; this hook keeps following the OS until the visitor picks one.
 */
const KEY = "pv-theme";
const DARK = "(prefers-color-scheme: dark)";

type Theme = "light" | "dark";

function current(): Theme {
  const saved = storageGet(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia(DARK).matches ? "dark" : "light";
}

export function useThemeToggle(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(current);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia(DARK);
    const follow = () => setTheme(current());
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  const toggle = useCallback(() => {
    const next = current() === "dark" ? "light" : "dark";
    storageSet(KEY, next);
    setTheme(next);
  }, []);

  return [theme, toggle];
}
