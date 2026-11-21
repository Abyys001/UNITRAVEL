"use client"

import { ArrowLeft, ArrowRight, Check } from "lucide-react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import type { ZodType } from "zod"

import { Spinner } from "@unitravel/ui/components/spinner"

import { saveDraft, takeDraft } from "@/lib/form-draft"
import { useI18n } from "@/lib/i18n"

export type FieldErrors = Record<string, string>

export interface WizardContext<V> {
  values: V
  set: <K extends keyof V>(key: K, value: V[K]) => void
  patch: (p: Partial<V>) => void
  /** Error text keyed by the dotted Zod path ("contact.phone"); pass `errors[path]` to the matching field's `error`. */
  errors: FieldErrors
  setErrors: (e: FieldErrors) => void
  goTo: (stepId: string) => void
  stepId: string
  submitting: boolean
}

export interface WizardStep<V> {
  id: string
  title: string
  description?: string
  /** Checked against all values before Next; usually a `.pick` of the request contract, so extra keys are ignored. */
  schema?: ZodType
  render: (ctx: WizardContext<V>) => React.ReactNode
}

export interface WizardProps<V> {
  steps: WizardStep<V>[]
  initial: V
  /** form-draft key: values survive a reload or the sign-in round trip in this tab for an hour. */
  draftKey?: string
  /** The review step shown after the last step, before submit. */
  review?: (ctx: WizardContext<V>) => React.ReactNode
  /** Throw or reject to stay on the page; call `helpers.setErrors` with server field errors to show them. */
  onSubmit: (values: V, helpers: { setErrors: (e: FieldErrors) => void; goTo: (stepId: string) => void }) => Promise<void> | void
  submitLabel?: string
  className?: string
}

const REVIEW = "__review"
const Ctx = createContext<WizardContext<unknown> | null>(null)

/** For components deep inside a step renderer. */
export function useWizard<V>() {
  const c = useContext(Ctx)
  if (!c) throw new Error("useWizard outside <Wizard>")
  return c as WizardContext<V>
}

const valueAt = (v: unknown, path: PropertyKey[]) => path.reduce<unknown>((o, k) => (o as Record<PropertyKey, unknown> | null | undefined)?.[k], v)
const FOCUSABLE = "input:not([hidden]):not([type=hidden]), button, select, textarea, [tabindex]"

/** A guided multi-step form: one heading and one Zod slice per step, values kept on Back, a draft kept as you type. */
export function Wizard<V extends object>({ steps, initial, draftKey, review, onSubmit, submitLabel, className = "" }: WizardProps<V>) {
  const { t, locale } = useI18n()
  const all = review ? [...steps, { id: REVIEW, title: t("guide.common.review"), render: review } as WizardStep<V>] : steps
  const [values, setValues] = useState<V>(initial)
  const [index, setIndex] = useState(0)
  const [reached, setReached] = useState(0)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [restored, setRestored] = useState(false)
  const loaded = useRef(!draftKey)
  // Focus moves only after the visitor navigates, never on first paint.
  const navigated = useRef(false)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const alertRef = useRef<HTMLParagraphElement | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const step = all[index]!
  const isLast = index === all.length - 1

  useEffect(() => {
    if (!draftKey) return
    const d = takeDraft<{ values: V; step: string }>(draftKey)
    if (d) {
      setValues((v) => ({ ...v, ...d.values }))
      const i = Math.max(0, all.findIndex((s) => s.id === d.step))
      setIndex(i)
      setReached(i)
      setRestored(true)
    }
    loaded.current = true
    // Restore once on mount; the steps array is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  useEffect(() => {
    if (!draftKey || !loaded.current || submitting) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveDraft(draftKey, { values, step: step.id }), 400)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [draftKey, values, step.id, submitting])

  useEffect(() => {
    if (!navigated.current) return
    headingRef.current?.focus()
  }, [index])

  const focusFirstInvalid = () => requestAnimationFrame(() => {
    const bad = bodyRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")
    const target = bad && (bad.matches(FOCUSABLE) ? bad : bad.querySelector<HTMLElement>(FOCUSABLE))
    ;(target ?? alertRef.current)?.focus()
  })

  const issuesFor = (s: WizardStep<V>): FieldErrors | null => {
    if (!s.schema) return null
    const r = s.schema.safeParse(values)
    if (r.success) return null
    const out: FieldErrors = {}
    for (const issue of r.error.issues) {
      const key = issue.path.map(String).join(".")
      if (out[key]) continue
      const v = valueAt(values, issue.path)
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)
      // Contract messages are English developer text; the visitor sees a translated one.
      out[key] = empty ? t("guide.common.required") : t("guide.common.invalid")
    }
    return out
  }

  const move = (i: number) => {
    navigated.current = true
    setErrors({})
    setIndex(i)
    setReached((r) => Math.max(r, i))
  }
  const goTo = (id: string) => {
    const i = all.findIndex((s) => s.id === id)
    if (i >= 0) move(i)
  }

  const showErrors = (e: FieldErrors) => { setErrors(e); focusFirstInvalid() }

  const submit = async () => {
    for (const [i, s] of steps.entries()) {
      const e = issuesFor(s)
      if (e) { if (i !== index) move(i); showErrors(e); return }
    }
    setSubmitting(true)
    try {
      await onSubmit(values, { setErrors: showErrors, goTo })
      if (draftKey) { if (saveTimer.current) clearTimeout(saveTimer.current); takeDraft(draftKey) }
    } catch {
      // The caller shows its own problem message; the form stays as it was.
    } finally {
      setSubmitting(false)
    }
  }

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (isLast) { void submit(); return }
    const errs = issuesFor(step)
    if (errs) { showErrors(errs); return }
    move(index + 1)
  }

  const ctx: WizardContext<V> = {
    values, errors, setErrors: showErrors, goTo, stepId: step.id, submitting,
    set: (k, v) => setValues((x) => ({ ...x, [k]: v })),
    patch: (p) => setValues((x) => ({ ...x, ...p })),
  }
  const pct = Math.round(((index + 1) / all.length) * 100)
  const n = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB")
  const hasErrors = Object.keys(errors).length > 0
  const navBtn = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:opacity-60"

  return (
    <Ctx.Provider value={ctx as WizardContext<unknown>}>
      <form noValidate onSubmit={onFormSubmit} className={className} aria-labelledby="wizard-step-title">
        <div className="mb-6">
          <div className="flex items-baseline justify-between gap-3">
            <p role="status" className="text-sm font-semibold text-navy-950">{t("guide.common.stepOf", { n: index + 1, total: all.length })}</p>
            {/* Always mounted: a live region added with its text already inside is often not announced. */}
            <p role="status" className="text-xs text-steel">{restored ? t("guide.common.draftRestored") : ""}</p>
          </div>
          <div role="progressbar" aria-label={t("guide.common.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={t("guide.common.stepOf", { n: index + 1, total: all.length })} className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-orange motion-safe:transition-[inline-size] motion-safe:duration-300" style={{ inlineSize: `${pct}%` }} />
          </div>
          <ol aria-label={t("guide.common.steps")} className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {all.map((s, i) => {
              const done = i < index || (i <= reached && i !== index)
              const badge = <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${i === index ? "bg-navy-900 text-white" : done ? "bg-success-subtle text-success-subtle-fg" : "bg-cloud text-steel ring-1 ring-line"}`}>{done ? <Check className="size-3" /> : n.format(i + 1)}</span>
              return (
                <li key={s.id} aria-current={i === index ? "step" : undefined}>
                  {done ? (
                    <button type="button" onClick={() => move(i)} aria-label={t("guide.common.stepDone", { title: s.title })} className="flex items-center gap-1.5 rounded-full py-1 font-medium text-navy-900 underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-royal/50 pointer-coarse:min-h-11">
                      {badge}<span>{s.title}</span>
                    </button>
                  ) : (
                    <span className={`flex items-center gap-1.5 py-1 ${i === index ? "font-semibold text-navy-950" : "text-steel"}`}>{badge}{s.title}</span>
                  )}
                </li>
              )
            })}
          </ol>
        </div>

        {/* Keyed by step so each one enters fresh; @starting-style gives the fade without an animation library. */}
        <div key={step.id} ref={bodyRef} className="motion-safe:transition-[opacity,translate] motion-safe:duration-300 motion-safe:ease-out motion-safe:starting:translate-y-2 motion-safe:starting:opacity-0">
          <h2 id="wizard-step-title" ref={headingRef} tabIndex={-1} className="font-display text-xl text-navy-950 outline-none">{step.title}</h2>
          {step.description ? <p className="mt-1 text-sm text-steel">{step.description}</p> : null}
          {hasErrors ? <p ref={alertRef} role="alert" tabIndex={-1} className="mt-4 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm font-medium text-danger outline-none">{t("guide.common.fixErrors")}</p> : null}
          <div className="mt-5">{step.render(ctx)}</div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          {index > 0 ? (
            <button type="button" onClick={() => move(index - 1)} disabled={submitting} className={`${navBtn} border border-line bg-white text-navy-950 hover:bg-cloud`}>
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />{t("guide.common.back")}
            </button>
          ) : <span />}
          <button type="submit" disabled={submitting} aria-disabled={submitting} className="btn-orange min-h-11 px-6">
            {submitting ? <><Spinner role="presentation" aria-hidden aria-label={undefined} className="size-4" />{t("guide.common.submitting")}</>
              : isLast ? (submitLabel ?? t("guide.common.submit"))
              : <>{t("guide.common.next")}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></>}
          </button>
        </div>
      </form>
    </Ctx.Provider>
  )
}
