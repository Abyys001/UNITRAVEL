"use client"

import { useEffect, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"

/** Pages that know a friendlier name for their last URL segment (e.g. a traveller instead of a UUID) register it here. */
let labels: Record<string, string> = {}
const subs = new Set<() => void>()
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
const snapshot = () => labels

export const useCrumbLabels = () => useSyncExternalStore(subscribe, snapshot, snapshot)

export function useCrumbLabel(label: string | null | undefined) {
  const path = usePathname()
  useEffect(() => {
    if (!label) return
    labels = { ...labels, [path]: label }
    subs.forEach((f) => f())
  }, [path, label])
}
