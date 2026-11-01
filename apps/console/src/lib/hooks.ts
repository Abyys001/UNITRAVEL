"use client"

import { useEffect, useState } from "react"

/** Mobile admin mode (ch. 15.8) is a layout decision; the API still authorises every command. */
export function useIsMobile(breakpoint = 768) {
  const [m, setM] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const on = () => setM(mql.matches)
    on()
    mql.addEventListener("change", on)
    return () => mql.removeEventListener("change", on)
  }, [breakpoint])
  return m
}

/** Single-key shortcuts that ignore typing in fields and open dialogs. */
export function useKeys(map: Record<string, () => void>, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest("input, textarea, select, [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return
      const fn = map[e.key]
      if (fn) { e.preventDefault(); fn() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
}

/** The value after it has stopped changing for `ms`; keeps a search box from calling the API on every keystroke. */
export function useDebounced<V>(value: V, ms = 300): V {
  const [v, setV] = useState(value)
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id) }, [value, ms])
  return v
}
