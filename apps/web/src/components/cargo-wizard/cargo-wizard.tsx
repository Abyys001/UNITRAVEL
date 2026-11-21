"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"

import { ConfirmationPanel, DateField, type FieldErrors, ReviewList, SelectField, Wizard, type WizardContext, type WizardStep } from "@/components/form"
import { api, type ApiError, newIdempotencyKey } from "@/lib/api"
import { countryName } from "@/lib/countries"
import { saveDraft } from "@/lib/form-draft"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"

import { DocumentsField, ItemRows, LaneCards, Num, PartyFields, PieceRows, ServiceCards, useNum, WeightEstimate } from "./fields"
import {
  CONSENTS, contactSchema, type CargoValues, DECLARATIONS, declaredTotalMinor, HANDOVER, initialValues, type Lane, mapServerPath, routeSchema, serviceSchema,
  shipmentSchema, type StepId, toBody, weights,
} from "./model"

const DRAFT_KEY = "cargo"
// The kit's id for its review step; a draft saved with it reopens on review after sign-in.
const REVIEW_STEP = "__review"
// The sea-only terms in the contract enum (FAS, FOB, CFR, CIF) were never offered on this air form.
const INCOTERM_CHOICES = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP"] as const
const DECL_LABEL = { batteries: "cargo.batteries", liquids: "cargo.liquids", medicines: "cargo.medicines", magnets: "cargo.magnets", dangerousGoods: "cargo.dg", insuranceRequested: "cargo.insurance" } as const
const CONSENT_LABEL = { accuracy: "cargo.consentAccuracy", prohibitedItems: "cargo.consentProhibited", privacy: "cargo.consentPrivacy" } as const

const sectionTitle = "text-sm font-bold text-navy-950"
const checkRow = "flex items-start gap-3 rounded-xl px-1 py-1.5 text-sm text-navy-900 pointer-coarse:min-h-11"

export function CargoWizard() {
  const { t, money, date, locale, href, sep } = useI18n()
  const num = useNum()
  const { me } = useSession()
  const router = useRouter()
  const path = usePathname()
  const lanesQ = useQuery({ queryKey: ["lanes"], queryFn: () => api<Lane[]>("/v1/cargo/lanes") })
  const lanes = lanesQ.data ?? []
  const [key] = useState(newIdempotencyKey)
  const [problem, setProblem] = useState<ApiError["problem"] | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [initial] = useState(initialValues)
  const phone = me?.identities.find((i) => i.type === "PHONE" && i.verifiedAt)
  const phoneFallback = !!phone
  const today = new Date().toISOString().slice(0, 10)

  if (done) return (
    <ConfirmationPanel
      title={t("request.sentTitle")} lead={t("guide.cargo.doneLead")} reference={done}
      steps={[t("guide.cargo.next1"), t("guide.cargo.next2"), t("guide.cargo.next3")]}
      primary={{ href: `/cargo/${done}`, label: t("guide.cargo.trackShipment") }}
      secondary={{ href: "/shipments", label: t("cargo.trackLink") }}
      disclaimer={t("guide.cargo.doneNote")}
    />
  )

  const laneOf = (v: CargoValues) => lanes.find((l) => l.id === v.laneId)
  const svcLabel = (s: string) => (s ? t(`cargo.${s}` as never) : "")

  const steps: WizardStep<CargoValues>[] = [
    {
      id: "route", title: t("guide.cargo.stepRoute"), description: t("guide.cargo.routeQuestion"), schema: routeSchema(lanes),
      render: ({ values, errors, patch }) => lanesQ.isPending ? <p className="text-sm text-steel" role="status">{t("common.loading")}</p>
        : lanesQ.isError ? <p role="alert" className="rounded-xl bg-danger-subtle px-4 py-3 text-sm text-danger">{t("guide.cargo.lanesError")} <button type="button" className="font-semibold underline" onClick={() => void lanesQ.refetch()}>{t("common.retry")}</button></p>
        : lanes.length === 0 ? <p className="rounded-xl bg-cloud px-4 py-3 text-sm text-steel">{t("guide.cargo.noLanes")}</p>
        : <LaneCards lanes={lanes} value={values.laneId} error={errors.laneId} onPick={(l) => patch({
          laneId: l.id,
          // A service the new lane does not carry is cleared rather than sent and refused.
          service: l.services.includes(values.service) ? values.service : "",
          shipper: { ...values.shipper, address: { ...values.shipper.address, country: l.originCountry } },
          consignee: { ...values.consignee, address: { ...values.consignee.address, country: l.destinationCountry } },
        })} />,
    },
    {
      id: "service", title: t("guide.cargo.stepService"), description: t("guide.cargo.serviceQuestion"), schema: serviceSchema(lanes),
      render: ({ values, errors, set, goTo }) => {
        const lane = laneOf(values)
        if (!lane) return <p className="text-sm text-steel">{t("guide.cargo.chooseRouteFirst")} <button type="button" className="font-semibold text-royal underline" onClick={() => goTo("route")}>{t("guide.cargo.stepRoute")}</button></p>
        return <ServiceCards lane={lane} value={values.service} error={errors.service} onPick={(s) => set("service", s)} />
      },
    },
    {
      id: "shipment", title: t("guide.cargo.stepShipment"), description: t("guide.cargo.shipmentQuestion"), schema: shipmentSchema,
      render: (ctx) => <ShipmentStep ctx={ctx} divisor={laneOf(ctx.values)?.volumetricDivisor ?? 5000} today={today} />,
    },
    {
      id: "contact", title: t("guide.cargo.stepContact"), description: t("guide.cargo.contactQuestion"), schema: contactSchema,
      render: ({ values, errors, set }) => {
        const freight = values.service === "AIR_FREIGHT"
        return (
          <div className="grid gap-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <PartyFields role="shipper" v={values.shipper} set={(p) => set("shipper", p)} freight={freight} errors={errors} phoneFallback={phoneFallback} />
              <PartyFields role="consignee" v={values.consignee} set={(p) => set("consignee", p)} freight={freight} errors={errors} phoneFallback={phoneFallback} />
            </div>
            <DocumentsField signedIn={!!me} docs={values.docs} set={(d) => set("docs", d)} error={errors.docs} />
          </div>
        )
      },
    },
  ]
  const review = ({ values, errors, set, goTo }: WizardContext<CargoValues>) => {
    const lane = laneOf(values)
    const w = weights(values.pieces, lane?.volumetricDivisor ?? 5000)
    const freight = values.service === "AIR_FREIGHT"
    const list = sep
    const partyLine = (p: CargoValues["shipper"]) => [p.name, p.company, p.address.line1, p.address.city, p.address.postcode, countryName(p.address.country, locale)].filter(Boolean).join(list)
    const declared = DECLARATIONS.filter((k) => values.declarations[k]).map((k) => t(DECL_LABEL[k])).join(list)
    return (
      <div className="grid gap-5">
        <ReviewList onEdit={goTo} sections={[
          { stepId: "route", title: t("guide.cargo.stepRoute"), rows: [{ label: t("cargo.lane"), value: lane?.label }] },
          { stepId: "service", title: t("guide.cargo.stepService"), rows: [{ label: t("cargo.service"), value: svcLabel(values.service) }] },
          { stepId: "shipment", title: t("guide.cargo.stepShipment"), rows: [
            { label: t("cargo.pieces"), value: <Num>{num(values.pieces.length)}</Num> },
            { label: t("guide.cargo.estCharge"), value: <><Num>{num(w.charge)}</Num> {t("guide.cargo.kgUnit")}</> },
            { label: t("cargo.items"), value: values.items.map((i) => i.description).filter(Boolean).join(list) },
            { label: t("cargo.summaryValue"), value: <Num>{money({ amountMinor: declaredTotalMinor(values.items), currency: "GBP" })}</Num> },
            { label: t("cargo.readyDate"), value: values.readyDate ? date(values.readyDate, { dateOnly: true }) : "" },
            { label: t("cargo.handover"), value: t(values.handoverMode === "DROP_OFF" ? "cargo.dropOff" : "cargo.pickup") },
            ...(freight ? [{ label: t("cargo.incoterm"), value: <Num>{values.incoterm}</Num> }] : []),
            { label: t("cargo.declarations"), value: declared || t("guide.cargo.noneDeclared") },
          ] },
          { stepId: "contact", title: t("guide.cargo.stepContact"), rows: [
            { label: t("cargo.shipper"), value: <span dir="auto">{partyLine(values.shipper)}</span> },
            { label: t("cargo.consignee"), value: <span dir="auto">{partyLine(values.consignee)}</span> },
            { label: t("cargo.documents"), value: values.docs.length ? values.docs.map((d) => d.filename).join(list) : t("guide.cargo.noDocs") },
          ] },
        ]} />
        <fieldset className="rounded-2xl border border-line bg-white p-4">
          <legend className={`${sectionTitle} px-1`}>{t("guide.cargo.consentsTitle")}</legend>
          <div className="mt-1 grid gap-1">
            {CONSENTS.map((k) => {
              const err = errors[`consents.${k}`]
              return (
                <div key={k}>
                  <label className={checkRow}>
                    <input id={`consents.${k}`} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-orange" checked={values.consents[k]} aria-invalid={err ? true : undefined} aria-describedby={err ? `consents.${k}-error` : undefined}
                      onChange={(e) => set("consents", { ...values.consents, [k]: e.target.checked })} />
                    <span>{t(CONSENT_LABEL[k])}</span>
                  </label>
                  {err ? <p id={`consents.${k}-error`} className="ms-8 text-xs font-medium text-danger">{err}</p> : null}
                </div>
              )
            })}
          </div>
        </fieldset>
        {me && !phone ? <p role="alert" className="rounded-xl border-s-4 border-danger bg-danger-subtle px-4 py-3 text-sm text-danger">{t("guide.cargo.noPhone")} <Link href={href("/account/details")} className="font-semibold underline">{t("guide.cargo.noPhoneLink")}</Link></p> : null}
        {!me ? <p className="text-sm text-steel" data-testid="cargo-sign-in">{t("cargo.signInNote")}</p> : null}
        {problem ? (
          <div role="alert" className="rounded-xl bg-danger-subtle px-4 py-3 text-sm text-danger">
            <p className="font-semibold">{problem.detail ?? problem.title}</p>
            {problem.errors?.filter((x) => mapServerPath(x.path).step === "review").map((x) => <p key={x.path} dir="ltr" className="text-start">{x.path}: {x.message}</p>)}
          </div>
        ) : null}
      </div>
    )
  }

  const onSubmit = async (values: CargoValues, h: { setErrors: (e: FieldErrors) => void; goTo: (id: string) => void }) => {
    setProblem(null)
    const missing = CONSENTS.filter((k) => !values.consents[k])
    if (missing.length) { h.setErrors(Object.fromEntries(missing.map((k) => [`consents.${k}`, t("guide.cargo.consentRequired")]))); throw new Error("consents") }
    if (!me) {
      // Browsing and preparing is open; sign-in is asked when sending. Throwing keeps the kit from clearing the draft.
      saveDraft(DRAFT_KEY, { values, step: REVIEW_STEP })
      router.push(href(`/sign-in?next=${encodeURIComponent(path)}`))
      throw new Error("sign-in")
    }
    if (!phone) throw new Error("phone")
    try {
      const r = await api<{ ref: string }>("/v1/cargo-requests", { headers: { "idempotency-key": key }, body: toBody(values, phone) })
      setDone(r.ref)
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (e) {
      const p = (e as ApiError).problem ?? { title: t("common.error") }
      setProblem(p)
      const fieldErrors: FieldErrors = {}
      let first: StepId | null = null
      const order: StepId[] = ["route", "service", "shipment", "contact", "review"]
      for (const x of p.errors ?? []) {
        const m = mapServerPath(x.path)
        if (m.step === "review") continue
        fieldErrors[m.key] ??= t("guide.common.invalid")
        if (!first || order.indexOf(m.step) < order.indexOf(first)) first = m.step
      }
      if (first) { h.goTo(first); h.setErrors(fieldErrors) }
      throw e
    }
  }

  return (
    <Wizard<CargoValues> steps={steps} initial={initial} draftKey={DRAFT_KEY} review={review} onSubmit={onSubmit} submitLabel={me ? t("cargo.submit") : t("cargo.signInToSend")} />
  )
}

/** Step 3 lives in a component so its hooks and derived totals stay out of the step table. */
function ShipmentStep({ ctx, divisor, today }: { ctx: WizardContext<CargoValues>; divisor: number; today: string }) {
  const { t, money } = useI18n()
  const { values, errors, set } = ctx
  const freight = values.service === "AIR_FREIGHT"
  const w = weights(values.pieces, divisor)
  return (
    <div className="grid gap-6">
      <section aria-labelledby="cargo-pieces" className="grid gap-3">
        <h3 id="cargo-pieces" className="font-display text-lg text-navy-950">{t("cargo.pieces")}</h3>
        <PieceRows pieces={values.pieces} errors={errors} set={(p) => set("pieces", p)} />
        <WeightEstimate w={w} divisor={divisor} />
      </section>
      <section aria-labelledby="cargo-items" className="grid gap-3">
        <h3 id="cargo-items" className="font-display text-lg text-navy-950">{t("cargo.items")}</h3>
        {errors.items ? <p className="text-sm font-medium text-danger">{errors.items}</p> : null}
        <ItemRows items={values.items} errors={errors} freight={freight} set={(i) => set("items", i)} defaultOrigin={values.shipper.address.country} />
        <p className="text-sm text-steel">{t("cargo.summaryValue")}: <Num>{money({ amountMinor: declaredTotalMinor(values.items), currency: "GBP" })}</Num></p>
      </section>
      <section aria-labelledby="cargo-handover" className="grid gap-3">
        <h3 id="cargo-handover" className="font-display text-lg text-navy-950">{t("cargo.stepHandover")}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DateField id="readyDate" label={t("cargo.readyDate")} required min={today} value={values.readyDate} error={errors.readyDate} onChange={(d) => set("readyDate", d)} />
          <SelectField id="handoverMode" label={t("cargo.handover")} required value={values.handoverMode} error={errors.handoverMode}
            options={HANDOVER.map((m) => ({ value: m, label: t(m === "PICKUP" ? "cargo.pickup" : "cargo.dropOff") }))} onChange={(v) => set("handoverMode", v)} />
          {freight ? <SelectField id="incoterm" label={t("cargo.incoterm")} required hint={t("guide.cargo.incotermHint")} value={values.incoterm} error={errors.incoterm}
            options={INCOTERM_CHOICES.map((x) => ({ value: x, label: x }))} onChange={(v) => set("incoterm", v)} /> : null}
        </div>
        <fieldset className="rounded-2xl border border-line bg-white p-4">
          <legend className={`${sectionTitle} px-1`}>{t("cargo.declarations")}</legend>
          <p className="text-xs text-steel">{t("guide.cargo.declarationsHint")}</p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {DECLARATIONS.map((k) => (
              <label key={k} className={checkRow}>
                <input id={`declarations.${k}`} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-orange" checked={values.declarations[k]} onChange={(e) => set("declarations", { ...values.declarations, [k]: e.target.checked })} />
                <span>{t(DECL_LABEL[k])}</span>
              </label>
            ))}
          </div>
          {values.declarations.dangerousGoods ? <p role="alert" className="mt-3 rounded-xl border-s-4 border-danger bg-danger-subtle px-4 py-3 text-sm text-danger">{t("flow.dgWarn")}</p> : null}
        </fieldset>
      </section>
    </div>
  )
}
