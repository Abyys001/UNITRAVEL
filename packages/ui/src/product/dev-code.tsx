"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Local test helper: polls a local-only dev sink for a one-time code and fills it into the form once. The sinks answer
 * 404 outside APP_ENV=local, so `load` throws there and the box never renders.
 */
export function DevCode({ load, onCode, title, waiting, refill }: {
  load: () => Promise<string | null>
  onCode: (code: string) => void
  title: string
  waiting: string
  refill: string
}) {
  const [state, setState] = useState<{ on: boolean; code: string | null }>({ on: false, code: null })
  const latest = useRef({ load, onCode })
  latest.current = { load, onCode }

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async (n: number) => {
      try {
        const code = await latest.current.load()
        if (stop) return
        setState({ on: true, code })
        if (code) { latest.current.onCode(code); return }
      } catch { if (!stop) setState({ on: false, code: null }); return }
      if (n < 40) timer = setTimeout(() => void tick(n + 1), 1000)
    }
    void tick(0)
    return () => { stop = true; clearTimeout(timer) }
  }, [])

  if (!state.on) return null
  const again = async () => {
    const code = await latest.current.load().catch(() => null)
    if (code) { setState({ on: true, code }); latest.current.onCode(code) }
  }
  return (
    <div className="mt-4 rounded-xl border border-dashed border-orange/60 bg-orange/5 px-4 py-3 text-sm" data-testid="dev-code" role="status">
      <p className="font-semibold">{title}</p>
      <div className="mt-1 flex items-center justify-between gap-3">
        {state.code ? <span className="font-mono text-lg tracking-[0.3em]" dir="ltr">{state.code}</span> : <span className="text-steel">{waiting}</span>}
        {state.code && <button type="button" className="font-semibold text-orange-700 underline underline-offset-4 dark:text-orange-300" onClick={() => void again()}>{refill}</button>}
      </div>
    </div>
  )
}

/** The newest six-digit code a local SMS or email sink holds for `to`, sent no earlier than `since` (ms). */
export function otpFromSink(msgs: { to: string; body: string; at: string }[], to: string, since: number): string | null {
  return msgs.find((m) => m.to === to && Date.parse(m.at) >= since - 5000)?.body.match(/\b(\d{6})\b/)?.[1] ?? null
}
