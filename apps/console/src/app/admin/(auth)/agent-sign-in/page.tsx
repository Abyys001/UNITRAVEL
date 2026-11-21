"use client"

import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { Logo } from "@unitravel/ui/brand/logo"

import { api, errText } from "@/lib/api"
import { deviceId } from "@/lib/device"
import { useT } from "@/lib/i18n"

/** ADR-0045: the agent's phone lands here from the sign-in QR code; the code is in the fragment, never in a log. */
export default function AgentSignIn() {
  const t = useT()
  const router = useRouter()
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)
  const once = useRef(false)
  useEffect(() => {
    if (once.current) return
    once.current = true
    const code = window.location.hash.slice(1)
    // Drop the code from the address bar and history straight away.
    window.history.replaceState(null, "", window.location.pathname)
    if (!code) { setErr(t("agt.in.noCode")); return }
    void (async () => {
      try {
        await api("/v1/auth/agent-code", { body: { code, deviceId: deviceId() } })
        await qc.invalidateQueries({ queryKey: ["me"] })
        router.replace("/agent")
      } catch (e) { setErr(errText(e)) }
    })()
  }, [qc, router, t])
  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-rule bg-surface-raised p-6 text-center shadow-[var(--tile-shadow)]" data-testid="agent-sign-in">
        <div className="mb-4 flex justify-center"><Logo variant="horizontal" size={26} /></div>
        {err ? (
          <>
            <h1 className="font-display text-title font-bold">{t("agt.in.failed")}</h1>
            <p role="alert" className="mt-2 text-danger">{err}</p>
            <p className="mt-2 text-meta text-steel">{t("agt.in.again")}</p>
            <Link href="/sign-in" className="mt-4 inline-block font-medium text-link hover:underline">{t("agt.in.toSignIn")}</Link>
          </>
        ) : (
          <>
            <div className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-rule border-t-orange" aria-hidden />
            <h1 className="font-display text-title font-bold" aria-live="polite">{t("agt.in.title")}</h1>
          </>
        )}
      </div>
    </main>
  )
}
