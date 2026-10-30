"use client"

// Browsing is open; signing in is asked only when a visitor sends a request. A half-filled form survives the sign-in
// round trip in sessionStorage (this tab only, gone after an hour or once restored). Only form values are kept, never
// credentials or files.
const TTL_MS = 3600_000
const k = (key: string) => `ut_draft:${key}`

export function saveDraft(key: string, data: unknown) {
  try { sessionStorage.setItem(k(key), JSON.stringify({ at: Date.now(), data })) } catch { /* storage may be unavailable */ }
}

/** Returns the saved draft once and removes it. */
export function takeDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(k(key))
    sessionStorage.removeItem(k(key))
    if (!raw) return null
    const v = JSON.parse(raw) as { at: number; data: T }
    return Date.now() - v.at <= TTL_MS ? v.data : null
  } catch { return null }
}

type Snap = { id: string; value?: string; checked?: boolean }[]

/** Snapshot of every labelled control in a form, keyed by element id (the service pages own their state, so the DOM is the common ground). */
export function snapshotForm(form: HTMLFormElement): Snap {
  const out: Snap = []
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[id], select[id], textarea[id]").forEach((el) => {
    if (el instanceof HTMLInputElement && ["file", "password", "hidden"].includes(el.type)) return
    out.push(el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? { id: el.id, checked: el.checked } : { id: el.id, value: el.value })
  })
  return out
}

/** Writes values back through the native setters and fires the events React listens to, so controlled inputs update. */
export function restoreForm(form: HTMLFormElement, snap: Snap) {
  for (const s of snap) {
    const el = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${CSS.escape(s.id)}`)
    if (!el) continue
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      if (s.checked !== undefined && el.checked !== s.checked) el.click()
      continue
    }
    if (s.value === undefined) continue
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, s.value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
  }
}
