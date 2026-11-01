"use client"

import { Download, WifiOff } from "lucide-react"
import { useEffect, useSyncExternalStore } from "react"

import { useT } from "@/lib/i18n"

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

// The browser fires this once, possibly before any menu has mounted.
let deferred: InstallPrompt | null = null
const subs = new Set<() => void>()
const notify = () => { for (const s of subs) s() }
const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }
const useCanInstall = () => useSyncExternalStore(subscribe, () => !!deferred, () => false)

const subscribeOnline = (fn: () => void) => {
  window.addEventListener("online", fn)
  window.addEventListener("offline", fn)
  return () => { window.removeEventListener("online", fn); window.removeEventListener("offline", fn) }
}

/** Registers the worker, keeps the browser's install prompt for the menu, and says so when the connection drops. */
export function AppInstallHost() {
  const t = useT()
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); deferred = e as InstallPrompt; notify() }
    const onInstalled = () => { deferred = null; notify() }
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined)
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled) }
  }, [])
  if (online) return null
  return <div role="status" data-testid="offline-banner" className="fixed inset-x-0 bottom-0 z-toast flex items-center justify-center gap-2 bg-danger px-4 py-2 text-meta font-medium text-white"><WifiOff className="size-4" aria-hidden />{t("pwa.offline")}</div>
}

export function InstallMenuItem({ onDone }: { onDone: () => void }) {
  const t = useT()
  const canInstall = useCanInstall()
  if (!canInstall) return null
  const install = async () => {
    const p = deferred
    onDone()
    if (!p) return
    await p.prompt()
    await p.userChoice
    deferred = null
    notify()
  }
  return <button type="button" onClick={() => void install()} className="menu-item" data-testid="install-app"><Download className="size-4 text-steel" aria-hidden />{t("pwa.install")}</button>
}
