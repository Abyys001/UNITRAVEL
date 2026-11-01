"use client"

import { useSyncExternalStore } from "react"

/**
 * What the console knows about the person at the screen (ADR-0022). Only real input counts as activity, so polling in an
 * unattended tab lets the session lapse. `paused` means the session ended while nobody was there; `epoch` moves whenever
 * the session's cookies change, so the event stream can reconnect with them.
 */
const RECENT_INPUT_MS = 60_000
let lastInput = Date.now()
let signedIn = false
let paused = false
let epoch = 0
const subs = new Set<() => void>()
const notify = () => { for (const s of subs) s() }
const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }

export const markInput = () => { lastInput = Date.now() }
export const hasRecentInput = () => Date.now() - lastInput < RECENT_INPUT_MS
export const setSignedIn = (v: boolean) => { signedIn = v }
export const isSignedIn = () => signedIn
export const isPaused = () => paused
export const setPaused = (v: boolean) => { if (paused !== v) { paused = v; notify() } }
export const bumpEpoch = () => { epoch++; notify() }
export const usePaused = () => useSyncExternalStore(subscribe, () => paused, () => false)
export const useSessionEpoch = () => useSyncExternalStore(subscribe, () => epoch, () => 0)
