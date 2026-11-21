"use client"

import { AlertTriangle, Check, Info, MapPin, PlaneLanding, PlaneTakeoff } from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { CipDetails, type CipService } from "@unitravel/contracts"

import { Ltr } from "@/components/badges"
import { ConfirmationPanel, CounterField, DateField, FieldShell, fieldAria, type FieldErrors, ReviewList, Wizard, type WizardContext, type WizardStep } from "@/components/form"
import { inDays, problemFieldErrors, RequestContact, SubmitError, today, useServiceSubmit } from "@/components/service-form"
import { saveDraft } from "@/lib/form-draft"
import { useI18n } from "@/lib/i18n"

import { CIP_OPTIONS, isDepartureOnly, WHEN_TONE } from "./cip-options"

// ADR-0041 S6: the CIP service request (ADR-0015, ADR-0020) as a guided request over the same contract. The CIP:IKA
// REVIEW policy stays server-side: a sent request may go to compliance hold, and nothing here is a booking.

export const CIP_DRAFT_KEY = "svc:CIP"
type Direction = "ARRIVAL" | "DEPARTURE"

interface Values {
  direction: Direction
  flightNumber: string
  date: string
  passengersCount: number
  companions: number
  services: CipService[]
  note: string
}

const S = CipDetails.shape
const STEP_OF: Record<string, string> = {
  direction: "trip", flightNumber: "trip", date: "trip", passengersCount: "trip", companions: "trip", services: "options", note: "notes",
}
const INITIAL: Values = { direction: "DEPARTURE", flightNumber: "", date: inDays(14), passengersCount: 1, companions: 0, services: [], note: "" }

const cardCls = (on: boolean, disabled = false) =>
  `relative flex gap-3 rounded-2xl border bg-white p-4 transition-colors focus-within:ring-[3px] focus-within:ring-royal/50 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-navy-900/40"} ${on ? "border-orange shadow-[var(--shadow-card)]" : "border-line"}`

export function CipWizard() {
  const { t, date, sep, locale } = useI18n()
  const num = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB")
  const svc = useServiceSubmit("CIP")
  // Shown on the options step after switching to an arrival removed departure-only choices.
  const [cleared, setCleared] = useState(false)
  const signedIn = !!svc.me

  if (svc.sentRef) {
    return (
      <ConfirmationPanel title={t("guide.cip.confirm.title")} lead={t("guide.cip.confirm.lead")} reference={svc.sentRef}
        steps={[t("guide.cip.confirm.step1"), t("guide.cip.confirm.step2"), t("guide.cip.confirm.step3")]}
        primary={{ href: `/services/${svc.sentRef}`, label: t("guide.cip.confirm.track") }} disclaimer={t("guide.cip.good.operator")} />
    )
  }

  const setDirection = ({ values, patch }: WizardContext<Values>, d: Direction) => {
    const kept = d === "ARRIVAL" ? values.services.filter((s) => !isDepartureOnly(s)) : values.services
    setCleared(kept.length !== values.services.length)
    patch({ direction: d, services: kept })
  }

  const steps: WizardStep<Values>[] = [
    {
      id: "airport", title: t("guide.cip.wizard.steps.airport"), description: t("guide.cip.wizard.steps.airportLead"),
      render: () => (
        <fieldset>
          <legend className="sr-only">{t("guide.cip.wizard.steps.airport")}</legend>
          <label className={`${cardCls(true)} max-w-xl`}>
            <input type="radio" name="c-airport" id="c-airport" value="IKA" checked readOnly className="sr-only" aria-describedby="c-airport-note" />
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-navy-950 text-white"><MapPin className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-navy-950">{t("guide.cip.wizard.airportCard")}</span>
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-xs font-semibold text-success-subtle-fg"><Check className="size-3" aria-hidden />{t("guide.cip.wizard.airportSelected")}</span>
            </span>
          </label>
          <p id="c-airport-note" className="mt-3 flex items-start gap-2 text-sm text-steel"><Info className="mt-0.5 size-4 shrink-0 text-royal" aria-hidden />{t("guide.cip.wizard.airportNote")}</p>
        </fieldset>
      ),
    },
    {
      id: "trip", title: t("guide.cip.wizard.steps.trip"), description: t("guide.cip.wizard.steps.tripLead"),
      schema: z.object({
        direction: S.direction, flightNumber: S.flightNumber, date: S.date.refine((d) => d >= today()), passengersCount: S.passengersCount, companions: S.companions,
      }),
      render: (ctx) => {
        const { values, set, errors } = ctx
        return (
          <div className="grid gap-5">
            <fieldset aria-describedby={errors.direction ? "c-dir-error" : undefined}>
              <legend className="mb-2 text-sm font-medium">{t("guide.cip.wizard.direction")}<span aria-hidden className="ms-0.5 text-danger">*</span></legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["DEPARTURE", "ARRIVAL"] as const).map((d) => {
                  const Icon = d === "DEPARTURE" ? PlaneTakeoff : PlaneLanding
                  const on = values.direction === d
                  return (
                    <label key={d} className={cardCls(on)}>
                      <input type="radio" name="c-dir" value={d} checked={on} onChange={() => setDirection(ctx, d)} className="sr-only" />
                      <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-full ${on ? "bg-orange text-navy-950" : "bg-cloud text-navy-900"}`}><Icon className="size-5 rtl:-scale-x-100" /></span>
                      <span className="self-center font-semibold text-navy-950">{t(`services.directions.${d}`)}</span>
                    </label>
                  )
                })}
              </div>
              {errors.direction && <p id="c-dir-error" className="mt-1 text-xs font-medium text-danger">{errors.direction}</p>}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldShell id="c-flight" label={t("guide.cip.wizard.flightNumber")} required hint={t("guide.cip.wizard.flightNumberHint")} error={errors.flightNumber}>
                <input id="c-flight" className="field h-11 w-full font-mono" dir="ltr" placeholder="TK 878" autoComplete="off" value={values.flightNumber}
                  onChange={(e) => set("flightNumber", e.target.value.toUpperCase())} {...fieldAria("c-flight", { hint: true, error: errors.flightNumber, required: true })} />
              </FieldShell>
              <DateField id="c-date" label={t("guide.cip.wizard.date")} required min={today()} value={values.date} onChange={(v) => set("date", v)} error={errors.date} />
            </div>
            {values.date === today() && (
              <p role="status" className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-subtle px-4 py-3 text-sm text-warning-subtle-fg" data-testid="cip-soon">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{t("guide.cip.wizard.soonWarning")}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <CounterField variant="field" id="c-count" label={t("guide.cip.wizard.passengers")} hint={t("guide.cip.wizard.passengersHint")} min={1} max={20}
                value={values.passengersCount} onChange={(n) => set("passengersCount", n)} error={errors.passengersCount} />
              <CounterField variant="field" id="c-companions" label={t("guide.cip.wizard.companions")} hint={t("guide.cip.wizard.companionsHint")} min={0} max={20}
                value={values.companions} onChange={(n) => set("companions", n)} error={errors.companions} />
            </div>
          </div>
        )
      },
    },
    {
      id: "options", title: t("guide.cip.wizard.steps.options"), description: t("guide.cip.wizard.steps.optionsLead"),
      // The contract's own rule (departure-only options refused on arrivals) runs here too, through the full schema.
      schema: z.object({ direction: S.direction, services: S.services }).refine((v) => v.direction === "DEPARTURE" || !v.services?.some(isDepartureOnly), { path: ["services"] }),
      render: ({ values, set, errors }) => {
        const arrival = values.direction === "ARRIVAL"
        const toggle = (id: CipService, on: boolean) => set("services", on ? [...values.services, id] : values.services.filter((s) => s !== id))
        return (
          <fieldset aria-describedby={errors.services ? "c-services-error" : undefined}>
            <legend className="sr-only">{t("guide.cip.wizard.steps.options")}</legend>
            {cleared && arrival && <p role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-info-border bg-info-subtle px-4 py-3 text-sm text-info-subtle-fg"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t("guide.cip.wizard.cleared")}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {CIP_OPTIONS.map(({ id, icon: Icon, when }) => {
                const disabled = arrival && isDepartureOnly(id)
                const on = values.services.includes(id)
                return (
                  <label key={id} className={cardCls(on, disabled)} data-testid={`cip-option-${id}`}>
                    <input type="checkbox" className="mt-1 size-4 shrink-0 accent-orange" checked={on} disabled={disabled} onChange={(e) => toggle(id, e.target.checked)}
                      aria-describedby={`c-opt-${id}-desc`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <Icon className="size-4 shrink-0 text-navy-900" aria-hidden />
                        <span className="font-semibold text-navy-950">{t(`guide.cip.options.${id}.name`)}</span>
                      </span>
                      <span id={`c-opt-${id}-desc`} className="mt-1 block text-sm leading-6 text-steel">
                        {t(`guide.cip.options.${id}.body`)}{" "}
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${disabled ? "bg-danger-subtle text-danger" : WHEN_TONE[when]}`}>
                          {disabled ? t("guide.cip.wizard.departureOnly") : t(`guide.cip.when.${when}`)}
                        </span>
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
            {errors.services && <p id="c-services-error" className="mt-2 text-xs font-medium text-danger">{errors.services}</p>}
          </fieldset>
        )
      },
    },
    {
      id: "notes", title: t("guide.cip.wizard.steps.notes"), description: t("guide.cip.wizard.steps.notesLead"),
      schema: z.object({ note: S.note }),
      render: ({ values, set, errors }) => (
        <FieldShell id="c-note" label={t("guide.cip.wizard.notes")} optional error={errors.note}>
          <textarea id="c-note" className="field min-h-28 w-full" dir="auto" maxLength={1000} value={values.note} onChange={(e) => set("note", e.target.value)} {...fieldAria("c-note", { error: errors.note })} />
        </FieldShell>
      ),
    },
  ]

  const review = ({ values, goTo, errors }: WizardContext<Values>) => (
    <div className="grid gap-5">
      <ReviewList onEdit={goTo} sections={[
        { stepId: "airport", title: t("guide.cip.wizard.reviewAirport"), rows: [{ label: t("guide.cip.wizard.reviewAirport"), value: t("guide.cip.wizard.airportCard") }] },
        {
          stepId: "trip", title: t("guide.cip.wizard.reviewTrip"), rows: [
            { label: t("guide.cip.wizard.direction"), value: t(`services.directions.${values.direction}`) },
            { label: t("guide.cip.wizard.flightNumber"), value: values.flightNumber && <Ltr className="font-mono">{values.flightNumber.trim()}</Ltr> },
            { label: t("guide.cip.wizard.date"), value: values.date && date(values.date, { dateOnly: true, year: true }) },
            { label: t("guide.cip.wizard.passengers"), value: <bdi>{num.format(values.passengersCount)}</bdi> },
            { label: t("guide.cip.wizard.companions"), value: <bdi>{num.format(values.companions)}</bdi> },
          ],
        },
        {
          stepId: "options", title: t("guide.cip.wizard.reviewOptions"), rows: [{
            label: t("guide.cip.wizard.reviewOptions"),
            value: values.services.length ? values.services.map((s) => t(`guide.cip.options.${s}.name`)).join(sep) : t("guide.cip.wizard.noneChosen"),
          }],
        },
        { stepId: "notes", title: t("guide.cip.wizard.reviewNotes"), rows: [{ label: t("guide.cip.wizard.notes"), value: values.note.trim() && <span className="whitespace-pre-wrap" dir="auto">{values.note.trim()}</span> }] },
      ]} />
      <section aria-labelledby="c-contact-title" className="rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)]">
        <h3 id="c-contact-title" className="border-b border-line pb-2 text-sm font-bold text-navy-950">{t("guide.visa.review.contactTitle")}</h3>
        <div className="mt-3"><RequestContact svc={svc} errors={errors} /></div>
      </section>
      <p className="flex items-start gap-2 rounded-xl border border-line bg-cloud px-4 py-3 text-sm text-navy-900"><Info className="mt-0.5 size-4 shrink-0 text-royal" aria-hidden />{t("guide.cip.good.operator")}</p>
      <SubmitError error={svc.error} placed={Object.keys(svc.error ? problemFieldErrors(svc.error, "") : {})} />
    </div>
  )

  const onSubmit = async (values: Values, { setErrors, goTo }: { setErrors: (e: FieldErrors) => void; goTo: (id: string) => void }) => {
    if (!signedIn) {
      // Thrown so the Wizard keeps its draft; the visitor returns to the last step and continues to review.
      svc.signIn(() => saveDraft(CIP_DRAFT_KEY, { values, step: "notes" }))
      throw new Error("sign-in")
    }
    const miss = svc.missing()
    if (Object.keys(miss).length) { setErrors(miss); throw new Error("missing") }
    const details = {
      airport: "IKA", direction: values.direction, flightNumber: values.flightNumber.trim(), date: values.date, passengersCount: values.passengersCount,
      ...(values.companions > 0 ? { companions: values.companions } : {}), ...(values.services.length ? { services: values.services } : {}),
      ...(values.note.trim() ? { note: values.note.trim() } : {}),
    }
    const r = await svc.send(details)
    if ("error" in r) {
      const fe = problemFieldErrors(r.error, t("guide.common.invalid"), "details.")
      const step = Object.keys(fe).map((k) => STEP_OF[k]).find(Boolean)
      if (step) goTo(step)
      setErrors(fe)
      throw r.error
    }
  }

  return <Wizard steps={steps} initial={INITIAL} draftKey={CIP_DRAFT_KEY} review={review} onSubmit={onSubmit} submitLabel={signedIn ? undefined : t("services.signInToSend")} />
}
