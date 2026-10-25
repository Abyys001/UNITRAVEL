"use client"

import { useEffect, useId, useRef, useState } from "react"

const KEY = "ut.testSignIn.email"

const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const write = (v: string) => { try { localStorage.setItem(KEY, v) } catch { /* private mode: the prefill is a convenience only */ } }

/**
 * Staging/testing helper (ADR-0012): signs in with an email alone, no code. The API answers `enabled: false` (or 404)
 * outside the testing phase, so the box renders only where the server allows it. Render it beside, never inside, a form.
 */
export function TestSignIn<R>({ client, deviceId, suggestions, labels, api, onSignedIn, onError }: {
  client: "WEB" | "CONSOLE"
  deviceId: string
  suggestions: string[]
  labels: { title: string; hint: string; email: string; submit: string; busy: string; error: string }
  /** The app's own same-origin client (CSRF, refresh); GET when `body` is omitted. */
  api: <T>(path: string, init?: { body?: unknown }) => Promise<T>
  onSignedIn: (result: R) => void | Promise<void>
  onError?: (err: unknown) => void
}) {
  const [enabled, setEnabled] = useState(false)
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const id = useId()
  const latest = useRef({ api, onError })
  latest.current = { api, onError }

  useEffect(() => {
    let stop = false
    setEmail(read() || suggestions[0] || "")
    latest.current.api<{ enabled: boolean }>("/v1/auth/test-sign-in").then((r) => { if (!stop) setEnabled(r.enabled === true) }, () => undefined)
    return () => { stop = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!enabled) return null
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      const r = await latest.current.api<R>("/v1/auth/test-sign-in", { body: { email: email.trim(), deviceId, client } })
      write(email.trim())
      await onSignedIn(r)
    } catch (e2) {
      // A parent that handles the error (for example to say "not staff") owns the message.
      if (latest.current.onError) latest.current.onError(e2); else setErr(labels.error)
    } finally { setBusy(false) }
  }
  return (
    <form className="mt-4 rounded-xl border border-dashed border-orange/60 bg-orange/5 px-4 py-3 text-sm" data-testid="test-sign-in" onSubmit={submit} aria-labelledby={`${id}-t`}>
      <p id={`${id}-t`} className="font-semibold">{labels.title}</p>
      <p className="mt-1 text-steel">{labels.hint}</p>
      <label htmlFor={`${id}-e`} className="mt-3 block font-medium">{labels.email}</label>
      <input id={`${id}-e`} name="email" type="email" dir="ltr" autoComplete="email" list={`${id}-l`} required value={email} onChange={(e) => setEmail(e.target.value)}
        className="mt-1 h-11 w-full rounded-xl border border-rule bg-surface px-3 text-base" />
      <datalist id={`${id}-l`}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      <button type="submit" className="mt-3 h-11 w-full rounded-xl border border-orange/60 font-semibold text-orange-700 disabled:opacity-60 dark:text-orange-300" disabled={busy || !email.trim()}>{busy ? labels.busy : labels.submit}</button>
      <p aria-live="polite" role="status" className="mt-2 text-danger empty:hidden">{err}</p>
    </form>
  )
}
