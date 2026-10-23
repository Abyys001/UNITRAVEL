"use client"

import { useEffect, useState } from "react"

/** Saved queue filters live in this browser only (they are a convenience, not shared configuration). */
export interface SavedView { name: string; query: string }
const KEY = "ut_console_views"
const EVT = "ut-views"

export function readViews(): SavedView[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as SavedView[] } catch { return [] }
}
export function writeViews(v: SavedView[]) {
  localStorage.setItem(KEY, JSON.stringify(v.slice(0, 12)))
  window.dispatchEvent(new Event(EVT))
}
export function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>([])
  useEffect(() => {
    const load = () => setViews(readViews())
    load()
    window.addEventListener(EVT, load)
    window.addEventListener("storage", load)
    return () => { window.removeEventListener(EVT, load); window.removeEventListener("storage", load) }
  }, [])
  return views
}
