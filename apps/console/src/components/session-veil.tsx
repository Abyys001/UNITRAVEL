"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { markInput, setPaused, usePaused } from "@/lib/activity"
import { resumeSession } from "@/lib/api"
import { useT } from "@/lib/i18n"

/**
 * Covers the panel once a session has ended with nobody there, so customer data does not sit on an unattended screen
 * (ADR-0022). The page underneath stays mounted, so an unsaved form survives. Any input opens a new session.
 */
export function SessionVeil() {
  const paused = usePaused()
  const qc = useQueryClient()
  const t = useT()
  const [failed, setFailed] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const busy = useRef(false)

  useEffect(() => {
    if (!paused) return
    setFailed(false)
    button.current?.focus()
    const resume = async () => {
      if (busy.current) return
      busy.current = true
      markInput()
      const r = await resumeSession()
      busy.current = false
      if (r === "failed") { setFailed(true); return }
      setPaused(false)
      // Everything refetches under the new session; if the device was refused, /v1/me sends this tab to sign-in.
      void qc.invalidateQueries()
    }
    // Capture phase: keystrokes meant to wake the panel must not land in a form hidden underneath.
    const onKey = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); void resume() }
    const onPointer = () => { void resume() }
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("pointerdown", onPointer, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("pointerdown", onPointer, true)
    }
  }, [paused, qc])

  if (!paused) return null
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="session-veil-title" data-testid="session-veil" className="fixed inset-0 z-modal grid place-items-center bg-surface p-6 text-center">
      <div className="max-w-sm">
        <h1 id="session-veil-title" className="text-lead font-semibold">{t("session.paused")}</h1>
        <p className="mt-2 text-meta text-steel">{t("session.pausedHint")}</p>
        {failed && <p role="alert" className="mt-3 text-meta text-danger">{t("session.resumeFailed")}</p>}
        <Button ref={button} className="mt-5">{t("session.continue")}</Button>
      </div>
    </div>
  )
}
