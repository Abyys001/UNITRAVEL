"use client"

import { useQueryClient } from "@tanstack/react-query"
import { Briefcase, GraduationCap, Info, Plane, Sun, UserPlus, Users, X } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { z } from "zod"

import { VisaDetails, VisaPurpose, type TravellerView } from "@unitravel/contracts"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@unitravel/ui/components/dialog"

import { Auto, Ltr } from "@/components/badges"
import { ComboField, ConfirmationPanel, DateField, FieldShell, fieldAria, type FieldErrors, ReviewList, useWizard, Wizard, type WizardContext, type WizardStep } from "@/components/form"
import { inDays, problemFieldErrors, RequestContact, SubmitError, today, TravellerPicker, useServiceSubmit } from "@/components/service-form"
import { TravellerForm } from "@/components/traveller-form"
import { countryName } from "@/lib/countries"
import { saveDraft } from "@/lib/form-draft"
import { useI18n } from "@/lib/i18n"

import { countryItems } from "./country-items"
import { UploadList, useDocumentUploads } from "./document-uploads"

// ADR-0041 S5: the VISA service request (ADR-0015) as a guided request over the same contract. D8: nothing here says a
// visa will be granted; the issuing authority decides, and the checker above is guidance only.

export type RequestPurpose = z.infer<typeof VisaPurpose>
export interface VisaPrefill { destination: string; purpose: RequestPurpose; date: string }
export const DRAFT_KEY = "svc:VISA"

interface Values {
  destinationCountry: string
  purpose: RequestPurpose
  travellerIds: string[]
  intendedTravelDate: string
  linkedFlightRequestRef: string
  note: string
}

const S = VisaDetails.shape
const PURPOSE_ICON: Record<RequestPurpose, React.ComponentType<{ className?: string }>> = { TOURISM: Sun, BUSINESS: Briefcase, STUDY: GraduationCap, FAMILY: Users, TRANSIT: Plane }
/** Which step owns a details key, so a server error opens the step where it can be fixed. */
const STEP_OF: Record<string, string> = {
  destinationCountry: "destination", purpose: "purpose", travellerIds: "applicants", intendedTravelDate: "applicants", linkedFlightRequestRef: "applicants", note: "documents",
}
const MAX_DOCS = 10

const initialOf = (p: VisaPrefill | null): Values => ({
  destinationCountry: p && p.destination !== "IR" ? p.destination : "",
  purpose: p?.purpose ?? "TOURISM",
  travellerIds: [],
  intendedTravelDate: p?.date && p.date >= today() ? p.date : inDays(30),
  linkedFlightRequestRef: "",
  note: "",
})

export function VisaWizard({ prefill }: { prefill: VisaPrefill | null }) {
  const { t, locale, date, sep } = useI18n()
  const svc = useServiceSubmit("VISA", { withTravellers: true })
  const uploads = useDocumentUploads(MAX_DOCS)
  const destinations = useMemo(() => countryItems(locale, { exclude: ["IR"], popular: true }), [locale])
  const signedIn = !!svc.me

  if (svc.sentRef) {
    return (
      <ConfirmationPanel title={t("guide.visa.confirm.title")} lead={t("guide.visa.confirm.lead")} reference={svc.sentRef}
        steps={[t("guide.visa.confirm.step1"), t("guide.visa.confirm.step2"), t("guide.visa.confirm.step3")]}
        primary={{ href: `/services/${svc.sentRef}`, label: t("guide.visa.confirm.track") }} secondary={{ href: "/visa", label: t("guide.visa.confirm.back") }}
        disclaimer={t("guide.visa.nonGuarantee")} />
    )
  }

  const names = (ids: string[]) => ids.map((id) => svc.travellers.data?.find((x) => x.id === id)).filter((x): x is TravellerView => !!x)
    .map((x) => (locale === "fa" && x.nameFa ? x.nameFa : `${x.givenNames} ${x.surname}`))

  const steps: WizardStep<Values>[] = [
    {
      id: "destination", title: t("guide.visa.steps.destination"), description: t("guide.visa.steps.destinationLead"),
      schema: z.object({ destinationCountry: S.destinationCountry.refine((c) => c !== "IR") }),
      render: ({ values, set, errors }) => (
        <div className="max-w-md">
          <ComboField id="v-dest" label={t("guide.visa.destination")} required items={destinations} value={values.destinationCountry}
            onChange={(v) => set("destinationCountry", v)} placeholder={t("guide.visa.destinationSearch")} error={errors.destinationCountry}
            groupLabel={(g) => (g === "popular" ? t("guide.visa.popular") : t("guide.visa.allCountries"))} />
          {prefill && <p className="mt-3 flex items-start gap-2 text-sm text-steel"><Info className="mt-0.5 size-4 shrink-0 text-royal" aria-hidden />{t("guide.visa.prefilled")}</p>}
        </div>
      ),
    },
    {
      id: "purpose", title: t("guide.visa.steps.purpose"), description: t("guide.visa.steps.purposeLead"),
      schema: z.object({ purpose: S.purpose }),
      render: (ctx) => <PurposeCards ctx={ctx} />,
    },
    {
      id: "applicants", title: t("guide.visa.steps.applicants"), description: t("guide.visa.steps.applicantsLead"),
      // Signed out, the applicants are chosen after sign-in; the submit check sends the visitor back here then.
      schema: z.object({
        ...(signedIn ? { travellerIds: S.travellerIds } : {}),
        intendedTravelDate: S.intendedTravelDate.refine((d) => d >= today()),
        linkedFlightRequestRef: z.union([z.literal(""), S.linkedFlightRequestRef.unwrap()]),
      }),
      render: ({ values, set, errors }) => (
        <div className="grid gap-6">
          {signedIn ? (
            <TravellerPicker travellers={svc.travellers.data} loading={svc.travellers.isLoading} chosen={values.travellerIds} onChange={(ids) => set("travellerIds", ids)}
              legend={t("guide.visa.applicants")} hint={svc.travellers.data?.length === 0 ? t("guide.visa.noTravellers") : t("guide.visa.applicantsHint")} error={errors.travellerIds}
              extra={(
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <AddTravellerButton />
                  <Link href={`/${locale}/account/details`} className="text-sm font-semibold text-royal underline-offset-2 hover:underline">{t("guide.visa.manageTravellers")}</Link>
                </div>
              )} />
          ) : (
            <p className="flex items-start gap-2 rounded-xl border border-line bg-cloud px-4 py-3 text-sm text-navy-900" data-testid="visa-applicants-signed-out">
              <Info className="mt-0.5 size-4 shrink-0 text-royal" aria-hidden />{t("guide.visa.signedOutApplicants")}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField id="v-date" label={t("guide.visa.travelDate")} required min={today()} value={values.intendedTravelDate} onChange={(v) => set("intendedTravelDate", v)}
              hint={t("guide.visa.travelDateHint")} error={errors.intendedTravelDate} />
            <FieldShell id="v-ref" label={t("guide.visa.linkedFlight")} optional hint={t("guide.visa.linkedFlightHint")} error={errors.linkedFlightRequestRef}>
              <input id="v-ref" className="field h-11 w-full font-mono" dir="ltr" placeholder="UT-F-…" autoComplete="off" value={values.linkedFlightRequestRef}
                onChange={(e) => set("linkedFlightRequestRef", e.target.value.trim().toUpperCase())} {...fieldAria("v-ref", { hint: true, error: errors.linkedFlightRequestRef })} />
            </FieldShell>
          </div>
        </div>
      ),
    },
    {
      id: "documents", title: t("guide.visa.steps.documents"), description: t("guide.visa.steps.documentsLead"),
      schema: z.object({ note: S.note }),
      render: ({ values, set, errors }) => (
        <div className="grid gap-6">
          <div aria-invalid={errors.documents ? true : undefined} className="grid gap-3">
            {signedIn ? (
              <>
                <p className="text-sm leading-6 text-navy-900">{t("guide.visa.docs.lead")}</p>
                <UploadList uploads={uploads} id="v-files" />
                <p className="text-xs text-steel">{t("guide.visa.docs.later")}</p>
              </>
            ) : (
              <p className="flex items-start gap-2 rounded-xl border border-line bg-cloud px-4 py-3 text-sm text-navy-900" data-testid="visa-docs-signed-out">
                <Info className="mt-0.5 size-4 shrink-0 text-royal" aria-hidden />{t("guide.visa.docs.signedOut")}
              </p>
            )}
            {errors.documents && <p role="alert" className="text-sm font-medium text-danger">{errors.documents}</p>}
          </div>
          <FieldShell id="v-note" label={t("services.note")} optional error={errors.note}>
            <textarea id="v-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={values.note} onChange={(e) => set("note", e.target.value)} {...fieldAria("v-note", { error: errors.note })} />
          </FieldShell>
        </div>
      ),
    },
  ]

  const review = ({ values, goTo, errors }: WizardContext<Values>) => {
    const who = names(values.travellerIds)
    return (
      <div className="grid gap-5">
        <ReviewList onEdit={goTo} sections={[
          {
            stepId: "destination", title: t("guide.visa.review.trip"), rows: [
              { label: t("guide.visa.destination"), value: values.destinationCountry && countryName(values.destinationCountry, locale) },
              { label: t("services.purpose"), value: t(`services.purposes.${values.purpose}`) },
            ],
          },
          {
            stepId: "applicants", title: t("guide.visa.review.applicantsTitle"), rows: [
              { label: t("guide.visa.applicants"), value: signedIn ? (who.length ? <Auto>{who.join(sep)}</Auto> : "") : t("guide.visa.review.noApplicants") },
              { label: t("guide.visa.travelDate"), value: values.intendedTravelDate && date(values.intendedTravelDate, { dateOnly: true, year: true }) },
              { label: t("guide.visa.linkedFlight"), value: values.linkedFlightRequestRef && <Ltr className="font-mono">{values.linkedFlightRequestRef}</Ltr> },
            ],
          },
          {
            stepId: "documents", title: t("guide.visa.review.documentsTitle"), rows: [
              { label: t("guide.visa.review.documentsTitle"), value: uploads.ready.length ? t("guide.visa.docs.count", { n: uploads.ready.length }) : t("guide.visa.docs.none") },
              { label: t("services.note"), value: values.note.trim() && <span className="whitespace-pre-wrap" dir="auto">{values.note.trim()}</span> },
            ],
          },
        ]} />
        <section aria-labelledby="v-contact-title" className="rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)]">
          <h3 id="v-contact-title" className="border-b border-line pb-2 text-sm font-bold text-navy-950">{t("guide.visa.review.contactTitle")}</h3>
          <div className="mt-3"><RequestContact svc={svc} errors={errors} /></div>
        </section>
        <p className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-subtle px-4 py-3 text-sm text-warning-subtle-fg" data-testid="visa-non-guarantee">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t("guide.visa.nonGuarantee")}
        </p>
        <SubmitError error={svc.error} placed={Object.keys(svc.error ? problemFieldErrors(svc.error, "") : {})} />
      </div>
    )
  }

  const onSubmit = async (values: Values, { setErrors, goTo }: { setErrors: (e: FieldErrors) => void; goTo: (id: string) => void }) => {
    if (!signedIn) {
      // Thrown so the Wizard keeps its draft; the visitor comes back to choose the applicants.
      svc.signIn(() => saveDraft(DRAFT_KEY, { values, step: "applicants" }))
      throw new Error("sign-in")
    }
    const miss = svc.missing(values.travellerIds)
    if (miss["details.travellerIds"]) { goTo("applicants"); setErrors({ travellerIds: miss["details.travellerIds"] }); throw new Error("missing") }
    if (uploads.pending) { goTo("documents"); setErrors({ documents: t("guide.visa.docs.waitScan") }); throw new Error("pending") }
    if (Object.keys(miss).length) { setErrors(miss); throw new Error("missing") }
    const details = {
      destinationCountry: values.destinationCountry, purpose: values.purpose, travellerIds: values.travellerIds, intendedTravelDate: values.intendedTravelDate,
      ...(values.linkedFlightRequestRef ? { linkedFlightRequestRef: values.linkedFlightRequestRef } : {}), ...(values.note.trim() ? { note: values.note.trim() } : {}),
    }
    const r = await svc.send(details, { documentIds: uploads.ready })
    if ("error" in r) {
      const fe = problemFieldErrors(r.error, t("guide.common.invalid"), "details.")
      const step = Object.keys(fe).map((k) => STEP_OF[k]).find(Boolean)
      if (step) goTo(step)
      setErrors(fe)
      throw r.error
    }
  }

  return <Wizard steps={steps} initial={initialOf(prefill)} draftKey={DRAFT_KEY} review={review} onSubmit={onSubmit} submitLabel={signedIn ? undefined : t("services.signInToSend")} />
}

/** Purpose as cards: a radio group, so arrow keys move between them like any other single choice. */
function PurposeCards({ ctx: { values, set, errors } }: { ctx: WizardContext<Values> }) {
  const { t } = useI18n()
  const err = errors.purpose
  return (
    <fieldset aria-describedby={err ? "v-purpose-error" : undefined}>
      <legend className="sr-only">{t("services.purpose")}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {VisaPurpose.options.map((p) => {
          const Icon = PURPOSE_ICON[p]
          const on = values.purpose === p
          return (
            <label key={p} className={`relative flex cursor-pointer gap-3 rounded-2xl border bg-white p-4 transition-colors focus-within:ring-[3px] focus-within:ring-royal/50 hover:border-navy-900/40 ${on ? "border-orange shadow-[var(--shadow-card)]" : "border-line"}`}>
              <input type="radio" name="v-purpose" value={p} checked={on} onChange={() => set("purpose", p)} className="sr-only" aria-invalid={err ? true : undefined} />
              <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-full ${on ? "bg-orange text-navy-950" : "bg-cloud text-navy-900"}`}><Icon className="size-5" /></span>
              <span className="min-w-0">
                <span className="block font-semibold text-navy-950">{t(`services.purposes.${p}`)}</span>
                <span className="mt-0.5 block text-sm text-steel">{t(`guide.visa.purposeHints.${p}`)}</span>
              </span>
            </label>
          )
        })}
      </div>
      {err && <p id="v-purpose-error" className="mt-2 text-xs font-medium text-danger">{err}</p>}
    </fieldset>
  )
}

/** Adds a saved traveller without leaving the request, and chooses them for it. */
function AddTravellerButton() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { values, set } = useWizard<Values>()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-navy-900 px-4 text-sm font-semibold text-navy-950 outline-none hover:bg-cloud focus-visible:ring-[3px] focus-visible:ring-royal/50">
        <UserPlus className="size-4" aria-hidden />{t("guide.visa.addTraveller")}
      </button>
      <DialogContent showCloseButton={false} className="max-h-[92dvh] overflow-y-auto !bg-white p-4 sm:max-w-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <DialogTitle className="font-display text-xl">{t("guide.visa.addTravellerTitle")}</DialogTitle>
          <DialogClose className="grid size-9 place-items-center rounded-full text-steel outline-none hover:bg-cloud focus-visible:ring-[3px] focus-visible:ring-royal/50 pointer-coarse:size-11" aria-label={t("guide.visa.close")}><X className="size-4" aria-hidden /></DialogClose>
        </div>
        <DialogDescription className="text-sm text-steel">{t("guide.visa.addTravellerNote")}</DialogDescription>
        {/* Portalled out of the wizard's form in the DOM but not in React: stop the traveller form's submit reaching the wizard. */}
        <div onSubmit={(e) => e.stopPropagation()}>
          <TravellerForm onSaved={(x) => {
            void qc.invalidateQueries({ queryKey: ["travellers"] })
            set("travellerIds", [...values.travellerIds.filter((id) => id !== x.id), x.id])
            setOpen(false)
          }} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
