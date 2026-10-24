"use client"

import { useSyncExternalStore } from "react"

import { PREF_KEYS as KEY } from "./prefs-boot"

/**
 * Per-browser console preferences (theme, density, rail, language). They live in localStorage so a refresh keeps them;
 * the inline script in app/layout.tsx applies theme, density and language before first paint (no flash).
 */
export type Theme = "light" | "dark" | "system"
export type Density = "comfortable" | "compact"
export type Locale = "en" | "fa"

const EVT = "ut-prefs"

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export function applyPrefs() {
  const d = document.documentElement
  const t = (read(KEY.theme) as Theme | null) ?? "system"
  d.dataset.theme = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"
  d.dataset.density = read(KEY.density) === "compact" ? "compact" : "comfortable"
  d.dataset.rail = read(KEY.rail) === "collapsed" ? "collapsed" : "open"
  const fa = read(KEY.locale) === "fa"
  d.lang = fa ? "fa" : "en"
  d.dir = fa ? "rtl" : "ltr"
}

function write(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* private mode: the choice lasts until reload */ }
  applyPrefs()
  window.dispatchEvent(new Event(EVT))
}

const subscribe = (fn: () => void) => {
  window.addEventListener(EVT, fn)
  window.addEventListener("storage", fn)
  return () => { window.removeEventListener(EVT, fn); window.removeEventListener("storage", fn) }
}

function usePref<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null)
  const value = allowed.includes(raw as T) ? (raw as T) : fallback
  return [value, (v) => write(key, v)]
}

export const useTheme = () => usePref<Theme>(KEY.theme, "system", ["light", "dark", "system"])
export const useDensity = () => usePref<Density>(KEY.density, "comfortable", ["comfortable", "compact"])
export const useLocale = () => usePref<Locale>(KEY.locale, "en", ["en", "fa"])
export const useRailCollapsed = (): [boolean, (v: boolean) => void] => {
  const [v, set] = usePref<"open" | "collapsed">(KEY.rail, "open", ["open", "collapsed"])
  return [v === "collapsed", (c) => set(c ? "collapsed" : "open")]
}

const watchAttr = (fn: () => void) => {
  const mo = new MutationObserver(fn)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
  return () => mo.disconnect()
}
/** The theme actually in force ("system" resolved). */
export const useResolvedTheme = (): "light" | "dark" => useSyncExternalStore(watchAttr, () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"), () => "light")
